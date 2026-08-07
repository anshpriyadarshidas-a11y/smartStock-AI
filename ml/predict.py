"""Prediction service for SmartStock AI.

Loads the trained artifacts (model + preprocessing pipeline + metadata) and
exposes two entry points:

* :class:`Predictor`          - object-oriented wrapper around the artifacts
* :func:`predict_inventory`   - the convenience function used by the Flask API

The function signature matches the project spec:

    predict_inventory(
        current_stock, sales_last_30_days, market_trend_score,
        supplier_lead_time, season, category
    ) -> { predicted_demand, shortage_probability,
           recommended_order_quantity, confidence_score, explanation }

The ML model predicts the ``Reorder_Quantity`` (the supervised target). The
remaining outputs are derived from that prediction so the whole response stays
internally consistent:

* ``predicted_demand``          - the stock level the reorder restores inventory
  to (``current_stock + reorder``), i.e. the demand + safety buffer the model
  accounts for over the planning horizon
* ``shortage_probability``      - logistic curve of days-of-stock vs lead time
* ``confidence_score``          - calibrated from CV R2 and data variability
* ``explanation``               - natural language reasoning
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from preprocessing import CATEGORICAL_FEATURES, NUMERIC_FEATURES
from utils import (
    LOG,
    METADATA_FILE,
    MODEL_FILE,
    MODELS_DIR,
    PREPROCESSOR_FILE,
    clamp,
    load_object,
    round_up,
    safe_div,
)

SAFETY_DAYS = 7  # safety buffer added on top of the supplier lead time
SEASON_LIFT = {  # generic demand multiplier per season (used in explanations)
    "Winter": 1.15, "Summer": 1.10, "Monsoon": 1.00, "Autumn": 1.20, "Spring": 1.00,
}
DEFAULT_PRICE_BY_CATEGORY = {
    "Electronics": 250.0, "Clothing": 40.0, "Groceries": 8.0,
    "Home & Kitchen": 60.0, "Sports": 90.0, "Beauty": 20.0,
    "Toys": 30.0, "Office Supplies": 15.0,
}


class ModelNotReadyError(RuntimeError):
    """Raised when prediction is requested before artifacts are trained."""


class Predictor:
    """Thin, object-oriented wrapper over the persisted ML artifacts."""

    def __init__(self, models_dir: Path = MODELS_DIR) -> None:
        self.models_dir = Path(models_dir)
        self.model = load_object(self.models_dir / MODEL_FILE)
        self.preprocessor = load_object(self.models_dir / PREPROCESSOR_FILE)
        self.metadata = self._load_metadata()

    # ------------------------------------------------------------------ #
    @property
    def ready(self) -> bool:
        """True when both the model and the preprocessor were loaded."""
        return self.model is not None and self.preprocessor is not None

    def _load_metadata(self) -> Dict[str, Any]:
        meta_path = self.models_dir / METADATA_FILE
        if not meta_path.exists():
            return {}
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    def _require_ready(self) -> None:
        if not self.ready:
            raise ModelNotReadyError(
                "Model artifacts not found. Run `python generate_dataset.py` "
                "and `python train.py` first."
            )

    # ------------------------------------------------------------------ #
    def predict_reorder(self, features: Dict[str, Any]) -> float:
        """Run the model on one feature dictionary and return raw reorder qty."""
        self._require_ready()
        row = pd.DataFrame([features])
        transformed = self.preprocessor.transform(row)
        return float(np.asarray(self.model.predict(transformed)).ravel()[0])

    @property
    def cv_r2(self) -> float:
        """Cross-validation R2 of the trained model (from metadata)."""
        return float(self.metadata.get("cross_validation", {}).get("cv_r2_mean", 0.85))

    @property
    def model_name(self) -> str:
        """Name of the trained model (e.g. RandomForest)."""
        return str(self.metadata.get("model", "unknown"))


# ----------------------------------------------------------------------------
# Feature construction
# ----------------------------------------------------------------------------
def _estimate_minimum_stock(sales_last_30_days: float) -> int:
    """Default safety stock ~20% of monthly sales (matches the generator)."""
    return max(1, round(0.2 * max(sales_last_30_days, 0.0)))


def build_feature_row(
    current_stock: float,
    sales_last_30_days: float,
    market_trend_score: float,
    supplier_lead_time: int,
    season: str,
    category: str,
    **kwargs: Any,
) -> Dict[str, Any]:
    """Build the exact feature vector the trained model expects.

    Extra keyword arguments (price, holiday_flag, weather_score, ...) are
    optional; when omitted sensible defaults are used so the function always
    produces a valid feature row.
    """
    today = kwargs.get("date") or date.today()
    day_of_week = today.weekday()
    month = today.month

    # Optional fields default to documented values when omitted OR null.
    price = kwargs.get("price")
    price = DEFAULT_PRICE_BY_CATEGORY.get(category, 50.0) if price is None else float(price)
    weather = kwargs.get("weather_score")
    weather = 50.0 if weather is None else float(weather)
    holiday = kwargs.get("holiday_flag")
    holiday = 0 if holiday is None else int(holiday)
    min_stock_raw = kwargs.get("minimum_stock")
    min_stock = (_estimate_minimum_stock(sales_last_30_days)
                 if min_stock_raw is None else int(min_stock_raw))

    return {
        "Current_Stock": float(current_stock),
        "Minimum_Stock": float(min_stock),
        "Units_Sold": float(sales_last_30_days),
        "Price": price,
        "Supplier_Lead_Time": float(supplier_lead_time),
        "Market_Trend_Score": float(market_trend_score),
        "Weather_Score": weather,
        "Holiday_Flag": holiday,
        "month": month,
        "day_of_week": day_of_week,
        "is_weekend": int(day_of_week >= 5),
        "stock_cover_ratio": float(current_stock) / (float(sales_last_30_days) + 1e-6),
        "units_sold_lag_1": float(sales_last_30_days),  # flat-sales assumption
        "sales_growth": 0.0,
        "Category": str(category),
        "Season": str(season),
    }


# ----------------------------------------------------------------------------
# Derived metrics
# ----------------------------------------------------------------------------
def _shortage_probability(days_of_stock: float, lead_time: float) -> float:
    """Logistic probability that stock runs out before the next delivery.

    P = 0.5 when the stock covers exactly the lead time; P approaches 1.0 as
    coverage drops below the lead time and 0.0 as it grows well beyond it.
    """
    if days_of_stock is None or days_of_stock <= 0:
        return 1.0
    z = clamp(lead_time - days_of_stock, -30, 30)  # avoid exp() overflow
    return clamp(1 / (1 + np.exp(-z)))


def _confidence_score(cv_r2: float, days_of_stock: Optional[float],
                      horizon_days: int, shortage_prob: float) -> int:
    """Blend model quality and problem difficulty into a 40-98 confidence."""
    confidence = 95 - (1 - cv_r2) * 20 - min(horizon_days, 30) * 0.3
    if days_of_stock is not None:
        confidence -= min(days_of_stock, 60) * 0.1  # long horizons are less certain
    confidence -= (1 - shortage_prob) * 5
    return int(round(clamp(confidence, 40, 98)))


# ----------------------------------------------------------------------------
# Natural language explanation
# ----------------------------------------------------------------------------
def build_explanation(reasoning: List[str], recommended_order_quantity: int,
                      shortage_probability: float, confidence: int) -> str:
    """Collapse the reasoning points into a single prose explanation."""
    summary = (
        f"Recommended reorder quantity is {recommended_order_quantity} units. "
        f"Shortage probability is {shortage_probability * 100:.0f}%. "
        f"Confidence Score: {confidence}%."
    )
    return " ".join(reasoning + [summary])


# ----------------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------------
def predict_inventory(
    current_stock: float,
    sales_last_30_days: float,
    market_trend_score: float,
    supplier_lead_time: int,
    season: str,
    category: str,
    **kwargs: Any,
) -> Dict[str, Any]:
    """Predict demand and recommend a reorder for a single product.

    Parameters mirror the project specification. Extra optional inputs:
    ``price``, ``holiday_flag``, ``weather_score``, ``minimum_stock``,
    ``date``, ``product_id``, ``product_name`` and
    ``sales_previous_30_days`` (used to describe month-over-month growth).
    """
    predictor = kwargs.get("predictor")
    if predictor is None:
        predictor = Predictor()
    predictor._require_ready()

    # --- Normalise inputs ---------------------------------------------------
    current_stock = max(0.0, float(current_stock))
    sales_last_30_days = max(0.0, float(sales_last_30_days))
    market_trend_score = clamp(float(market_trend_score), 0, 100)
    lead_time = max(1, int(supplier_lead_time))
    weather_score = clamp(float(kwargs.get("weather_score", 50.0)), 0, 100)
    holiday_flag = int(kwargs.get("holiday_flag", 0))
    prev_sales = kwargs.get("sales_previous_30_days")

    horizon_days = lead_time + SAFETY_DAYS

    # --- Core ML prediction ---------------------------------------------------
    features = build_feature_row(
        current_stock, sales_last_30_days, market_trend_score, lead_time,
        season, category, **kwargs,
    )
    raw_reorder = predictor.predict_reorder(features)
    recommended_order_quantity = max(0, round_up(raw_reorder))

    # --- Derived metrics ------------------------------------------------------
    # The reorder restores stock to predicted_demand = current_stock + reorder
    # (the exact inverse of the training label's business rule). All risk
    # metrics flow from this single model-driven number, so the response is
    # internally consistent.
    predicted_demand = int(current_stock + recommended_order_quantity)
    predicted_daily_demand = safe_div(predicted_demand, horizon_days)

    if recommended_order_quantity > 0:
        days_of_stock = safe_div(current_stock, predicted_daily_demand)
    else:
        # No reorder recommended -> current stock already covers the horizon.
        days_of_stock = float(horizon_days)

    shortage_probability = _shortage_probability(days_of_stock, lead_time)
    shortage_risk = shortage_probability >= 0.5 or days_of_stock <= lead_time
    confidence = _confidence_score(predictor.cv_r2, days_of_stock, horizon_days,
                                   shortage_probability)
    suggested_order_date = (
        date.today()
        if shortage_risk
        else date.today() + timedelta(days=max(0, int(days_of_stock - lead_time)))
    )

    # --- Reasoning -------------------------------------------------------------
    reasoning: List[str] = []
    if prev_sales is not None and float(prev_sales) > 0:
        growth = safe_div(sales_last_30_days - float(prev_sales), float(prev_sales))
        direction = "increased" if growth >= 0 else "decreased"
        reasoning.append(
            f"Sales {direction} {abs(growth) * 100:.0f}% in the last month "
            f"(from {float(prev_sales):.0f} to {sales_last_30_days:.0f} units)."
        )
    else:
        reasoning.append(
            f"Average daily sales are {safe_div(sales_last_30_days, 30):.1f} units "
            f"over the last 30 days."
        )

    trend_delta = market_trend_score - 50
    if abs(trend_delta) > 3:
        direction = "increased" if trend_delta > 0 else "decreased"
        reasoning.append(
            f"Market trend score {direction} by {abs(trend_delta):.0f} points "
            f"(current score {market_trend_score:.0f}/100)."
        )
    else:
        reasoning.append("Market trend is neutral.")

    reasoning.append(
        f"Supplier lead time is {lead_time} days; with a {SAFETY_DAYS}-day safety "
        f"buffer the planning horizon is {horizon_days} days."
    )
    reasoning.append(
        f"Predicted stock requirement over the horizon is {predicted_demand} units "
        f"(about {predicted_daily_demand:.1f} units/day). Current inventory "
        f"({current_stock:.0f} units) will last about {days_of_stock:.0f} days."
    )
    if shortage_risk:
        reasoning.append(
            f"Shortage risk is {shortage_probability * 100:.0f}% - order soon."
        )
    else:
        reasoning.append(
            f"No immediate shortage risk ({shortage_probability * 100:.0f}%). "
            f"Next review suggested for {suggested_order_date.isoformat()}."
        )

    explanation = build_explanation(reasoning, recommended_order_quantity,
                                    shortage_probability, confidence)

    return {
        "predicted_demand": predicted_demand,
        "predicted_daily_demand": round(predicted_daily_demand, 2),
        "shortage_probability": round(float(shortage_probability), 2),
        "shortage_risk": bool(shortage_risk),
        "recommended_order_quantity": recommended_order_quantity,
        "confidence_score": confidence,
        "explanation": explanation,
        "reasoning": reasoning,
        "days_of_stock_remaining": None if days_of_stock is None else round(float(days_of_stock), 1),
        "suggested_order_date": suggested_order_date.isoformat(),
        "horizon_days": horizon_days,
        "model": predictor.model_name,
        "inputs": {
            "current_stock": current_stock,
            "sales_last_30_days": sales_last_30_days,
            "market_trend_score": market_trend_score,
            "supplier_lead_time": lead_time,
            "season": season,
            "category": category,
            "minimum_stock": features["Minimum_Stock"],
        },
    }
