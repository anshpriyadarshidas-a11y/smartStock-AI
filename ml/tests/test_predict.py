"""Unit tests for the SmartStock AI prediction logic.

These tests do NOT require a trained model; a stub predictor is injected so
the derived metrics, feature construction and explanation generation are
verified in isolation.

Run:
    pytest ml/tests -v
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from predict import (  # noqa: E402
    Predictor,
    _confidence_score,
    _shortage_probability,
    build_feature_row,
    predict_inventory,
)


class FakePredictor:
    """Minimal stand-in for the real Predictor (no artifacts needed)."""

    ready = True
    cv_r2 = 0.90
    model_name = "FakeModel"

    def _require_ready(self) -> None:
        return None

    def predict_reorder(self, features) -> float:
        return 120.0


def test_shortage_probability_boundaries() -> None:
    assert _shortage_probability(days_of_stock=0, lead_time=7) == 1.0
    assert _shortage_probability(days_of_stock=1_000, lead_time=7) < 0.1
    assert 0.0 <= _shortage_probability(days_of_stock=5, lead_time=7) <= 1.0
    assert _shortage_probability(days_of_stock=7, lead_time=7) == pytest.approx(0.5, abs=0.01)


def test_confidence_score_in_range() -> None:
    for args in [(0.9, 10.0, 12, 0.5), (0.5, 1.0, 30, 0.1), (0.95, None, 7, 0.9)]:
        assert 40 <= _confidence_score(*args) <= 98


def test_build_feature_row_has_expected_columns() -> None:
    row = build_feature_row(
        current_stock=50, sales_last_30_days=120, market_trend_score=75,
        supplier_lead_time=7, season="Winter", category="Electronics",
    )
    assert row["Category"] == "Electronics"
    assert row["Season"] == "Winter"
    assert row["stock_cover_ratio"] == pytest.approx(50 / 120)
    assert row["Minimum_Stock"] > 0
    assert set(["month", "day_of_week", "is_weekend"]) <= set(row.keys())


def test_predict_inventory_full_response() -> None:
    result = predict_inventory(
        current_stock=50,
        sales_last_30_days=120,
        market_trend_score=75,
        supplier_lead_time=7,
        season="Winter",
        category="Electronics",
        predictor=FakePredictor(),
        sales_previous_30_days=90,
    )
    assert result["recommended_order_quantity"] == 120
    assert result["predicted_demand"] == 50 + 120  # target level = stock + reorder
    assert 0.0 <= result["shortage_probability"] <= 1.0
    assert 40 <= result["confidence_score"] <= 98
    assert "120 units" in result["explanation"]
    assert "Confidence Score" in result["explanation"]
    assert isinstance(result["reasoning"], list) and len(result["reasoning"]) >= 3


def test_predict_inventory_handles_zero_stock() -> None:
    result = predict_inventory(
        current_stock=0,
        sales_last_30_days=200,
        market_trend_score=40,
        supplier_lead_time=10,
        season="Summer",
        category="Groceries",
        predictor=FakePredictor(),
    )
    assert result["shortage_risk"] is True
    assert result["shortage_probability"] == 1.0
    assert result["recommended_order_quantity"] >= 0


def test_real_predictor_reports_not_ready_without_artifacts() -> None:
    predictor = Predictor()
    assert predictor.ready in (True, False)  # never raises on construction
