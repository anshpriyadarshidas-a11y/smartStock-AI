"""Flask REST API exposing the SmartStock AI prediction engine.

Endpoints
---------
GET  /health            - liveness + readiness (reports whether model is loaded)
POST /predict           - predict demand & recommend a reorder quantity

The POST /predict endpoint accepts either:

1. The direct payload from the project spec:
   { "current_stock": 50, "sales_last_30_days": 120,
     "market_trend_score": 75, "supplier_lead_time": 7,
     "season": "Winter", "category": "Electronics" }

2. The backend integration payload used by the Node.js service:
   { "product": { "id", "name", "category", "currentStock",
                  "minimumStock", "price", ... },
     "supplierLeadTime": 7, "sales": [{ "date", "quantity" }],
     "marketTrendScore": 75 }

The response wraps the forecast under a top-level ``forecast`` key so the
Node.js ``mlClient`` can consume it unchanged:

    { "success": true, "forecast": { predictedDemand, confidence, ... } }

Run:
    python app.py               # listens on 0.0.0.0:5000
    python app.py --port 5001
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
from typing import Any, Dict, Tuple

from flask import Flask, jsonify, request
from flask_cors import CORS

from predict import ModelNotReadyError, Predictor, predict_inventory
from utils import LOG

app = Flask(__name__)
CORS(app)  # allow the frontend / backend to call this service cross-origin

# Singleton predictor instance; artifacts are loaded once at startup.
predictor = Predictor()

SEASON_BY_MONTH = {1: "Winter", 2: "Winter", 3: "Summer", 4: "Summer",
                   5: "Summer", 6: "Monsoon", 7: "Monsoon", 8: "Monsoon",
                   9: "Monsoon", 10: "Autumn", 11: "Autumn", 12: "Winter"}


# ----------------------------------------------------------------------------
# Input parsing
# ----------------------------------------------------------------------------
def _parse_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return date.today()


def _sum_recent_sales(sales: list, days: int = 30) -> float:
    """Sum sale quantities inside the last ``days`` days."""
    cutoff = date.today() - timedelta(days=days)
    total = 0.0
    for sale in sales or []:
        if not isinstance(sale, dict):
            continue
        if _parse_date(sale.get("date")) >= cutoff:
            total += float(sale.get("quantity", 0))
    return total


def _extract_inputs(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
    """Normalise either payload shape into predict_inventory() kwargs."""
    product = payload.get("product")
    if isinstance(product, dict):
        today = date.today()
        kwargs: Dict[str, Any] = {
            "current_stock": product.get("currentStock", product.get("current_stock", 0)),
            "sales_last_30_days": _sum_recent_sales(payload.get("sales", [])),
            "market_trend_score": payload.get("marketTrendScore", product.get("marketTrendScore", 50)),
            "supplier_lead_time": payload.get("supplierLeadTime", product.get("supplierLeadTime", 5)),
            "season": product.get("season") or SEASON_BY_MONTH[today.month],
            "category": product.get("category", "General"),
            "price": product.get("price"),
            "minimum_stock": product.get("minimumStock", product.get("minimum_stock")),
            "holiday_flag": product.get("holidayFlag", 0),
            "weather_score": product.get("weatherScore", 50),
            "product_id": product.get("id", product.get("productId")),
            "product_name": product.get("name", product.get("productName")),
        }
        return kwargs, str(kwargs["category"])

    required = ["current_stock", "sales_last_30_days", "market_trend_score",
                "supplier_lead_time", "season", "category"]
    missing = [key for key in required if key not in payload]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")
    kwargs = {key: payload.get(key) for key in required}
    kwargs.update({
        "price": payload.get("price"),
        "holiday_flag": payload.get("holiday_flag", 0),
        "weather_score": payload.get("weather_score", 50),
        "minimum_stock": payload.get("minimum_stock"),
        "date": _parse_date(payload.get("date")),
        "product_id": payload.get("product_id"),
        "product_name": payload.get("product_name"),
        "sales_previous_30_days": payload.get("sales_previous_30_days"),
    })
    return kwargs, str(kwargs["category"])


def _to_backend_contract(result: Dict[str, Any], product_id: str,
                         product_name: str, category: str) -> Dict[str, Any]:
    """Map snake_case results to the camelCase contract the Node backend uses."""
    return {
        "productId": product_id,
        "productName": product_name,
        "category": category,
        "predictedDailyDemand": result["predicted_daily_demand"],
        "predictedDemand": result["predicted_demand"],
        "horizonDays": result["horizon_days"],
        "confidence": result["confidence_score"],
        "shortageProbability": result["shortage_probability"],
        "shortageRisk": result["shortage_risk"],
        "recommendedOrderQty": result["recommended_order_quantity"],
        "suggestedOrderDate": result["suggested_order_date"],
        "daysOfStockRemaining": result["days_of_stock_remaining"],
        "reasoning": result["reasoning"],
        "model": result["model"],
        "inputs": result["inputs"],
    }


# ----------------------------------------------------------------------------
# Routes
# ----------------------------------------------------------------------------
@app.get("/health")
def health() -> Any:
    """Readiness probe used by the Node backend / deployment platforms."""
    return jsonify({
        "success": True,
        "status": "ok" if predictor.ready else "not_ready",
        "model": predictor.model_name if predictor.ready else None,
        "trained_at": predictor.metadata.get("trained_at"),
        "time": datetime.now().isoformat(),
    })


@app.post("/predict")
def predict_route() -> Any:
    """Predict demand and recommend a reorder quantity for one product."""
    try:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")

        kwargs, category = _extract_inputs(payload)
        result = predict_inventory(predictor=predictor, **kwargs)

        product_id = str(kwargs.get("product_id") or "unknown")
        product_name = str(kwargs.get("product_name") or "Unknown Product")
        forecast = _to_backend_contract(result, product_id, product_name, category)

        LOG.info("Prediction served for %s (reorder %s, confidence %s%%)",
                 product_id, forecast["recommendedOrderQty"], forecast["confidence"])
        return jsonify({"success": True, "forecast": forecast})

    except ModelNotReadyError as exc:
        LOG.error("Prediction failed - model not trained: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 503
    except ValueError as exc:
        LOG.warning("Bad request: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001 - surface unexpected failures
        LOG.exception("Unexpected error during prediction")
        return jsonify({"success": False, "error": f"Internal server error: {exc}"}), 500


@app.get("/")
def index() -> Any:
    """Small service banner for humans."""
    return jsonify({
        "service": "SmartStock AI - ML Prediction Service",
        "endpoints": ["GET /health", "POST /predict"],
        "model_ready": predictor.ready,
    })


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SmartStock AI prediction service")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5000)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if not predictor.ready:
        LOG.warning("Model artifacts not found. Run `python train.py` before calling /predict.")
    LOG.info("Starting SmartStock AI API on http://%s:%d", args.host, args.port)
    app.run(host=args.host, port=args.port, debug=False)
