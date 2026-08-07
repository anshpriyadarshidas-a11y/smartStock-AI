# SmartStock AI — Machine Learning Service

AI inventory operations agent that predicts product demand, flags shortage risk,
recommends reorder quantities and explains every prediction with a confidence
score.

This service trains a demand/restocking model, exposes it through a Flask API
and integrates with the SmartStock AI **Node.js + Express + MongoDB** backend
via a single `POST /predict` endpoint.

---

## Project Structure

```
ml/
│
├── dataset/                     # generated dataset (inventory_data.csv)
├── models/                      # trained artifacts (.pkl + metadata.json)
├── plots/                       # diagnostic visualizations (.png)
├── logs/                        # application logs
├── tests/                       # pytest unit tests
├── generate_dataset.py          # creates a 6000+ row sample dataset
├── preprocessing.py             # cleaning, feature engineering, encoding, scaling
├── train.py                     # trains + compares models, evaluates, saves artifacts
├── predict.py                   # Predictor class + predict_inventory()
├── app.py                       # Flask REST API (/health, /predict)
├── utils.py                     # logging, paths, pickle & numeric helpers
├── requirements.txt
└── README.md
```

---

## Quick Start

```bash
cd ml

# 1. Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS / Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Generate the sample dataset (6250 records)
python generate_dataset.py

# 4. Train, compare and save the best model
python train.py

# 5. Run the Flask API
python app.py --port 5000
```

---

## Step 1 — Dataset Generation

`generate_dataset.py` simulates **250 products across 8 categories over 25
months** (6,250 records) with realistic monthly inventory snapshots:

| Column                | Description                                      |
|-----------------------|--------------------------------------------------|
| `Product_ID`          | Unique product identifier                        |
| `Product_Name`        | Human readable product name                      |
| `Category`            | Electronics, Clothing, Groceries, ...            |
| `Date`                | First day of the snapshot month                  |
| `Current_Stock`       | Stock on hand at the start of the month          |
| `Minimum_Stock`       | Safety stock threshold                           |
| `Units_Sold`          | Units sold during the month                      |
| `Price`               | Unit selling price                               |
| `Supplier_Lead_Time`  | Days between ordering and receiving              |
| `Market_Trend_Score`  | 0-100 Google-Trends style score (random walk)    |
| `Season`              | Winter / Summer / Monsoon / Autumn / Spring      |
| `Holiday_Flag`        | 1 when the month contains a peak-holiday period  |
| `Weather_Score`       | 0-100 weather attractiveness for demand          |
| `Reorder_Quantity`    | **Target** — what the business actually ordered  |

Demand is driven by a base rate multiplied by seasonal, market-trend, holiday
and weather effects, plus noise. The `Reorder_Quantity` target is produced by a
deterministic restocking policy, so the problem is learnable:

```
expected_next_demand = units_sold × (1 + trend_effect)
reorder_quantity     = max(0, ceil(max(minimum_stock, expected_next_demand) − current_stock))
```

~1% of values are injected as missing (and a few outliers) so the preprocessing
pipeline is exercised for real.

---

## Step 2 — Preprocessing (`preprocessing.py`)

- **Missing values**: numeric → median, categorical → most frequent.
- **Feature engineering**: calendar features (`month`, `day_of_week`,
  `is_weekend`), ratio features (`stock_cover_ratio`) and per-product lag
  (`units_sold_lag_1`, `sales_growth`).
- **Encoding**: `OneHotEncoder` (with `handle_unknown="ignore"`) for
  `Category` and `Season`.
- **Scaling**: `StandardScaler` for numeric features via a single fitted
  `ColumnTransformer`.
- **Train/test split**: *chronological* (last 20% of the timeline), the correct
  choice for time-series data — a random split would leak the future.

---

## Step 3 — Training (`train.py`)

Trains and compares **three models** and automatically selects the best one by
5-fold cross-validation (lowest CV RMSE):

1. **Linear Regression**
2. **Random Forest Regressor**
3. **XGBoost Regressor** *(used automatically when `xgboost` is installed)*

Output for every model:

```
MODEL COMPARISON
================================================================
Model           CV RMSE   CV R2   Test MAE  Test RMSE    Test R2
----------------------------------------------------------------
LinearRegression     88.37   0.716      45.08      82.08    0.858
RandomForest         44.18   0.943      12.50      41.52    0.964
XGBoost              38.21   0.958      10.80      37.74    0.970
================================================================

BEST MODEL FINAL EVALUATION
  Model        : XGBoost
  Test MAE     : 10.805
  Test RMSE    : 37.74
  Test R2      : 0.9699
  5-Fold CV    : RMSE 38.214 ± 8.791 | R2 0.9581
```

**Evaluation metrics:** MAE, RMSE, R², 5-fold cross-validation, and normalized
feature importance (absolute coefficients for linear models,
`feature_importances_` for tree models).

**Visualizations** (saved to `ml/plots/`):

| Plot                          | File                             |
|-------------------------------|----------------------------------|
| Actual vs Predicted Demand    | `actual_vs_predicted.png`        |
| Feature Importance            | `feature_importance.png`         |
| Monthly Demand Trend          | `monthly_demand_trend.png`       |
| Inventory Risk Distribution   | `inventory_risk_distribution.png`|

**Saved artifacts** (in `ml/models/`):

| File                  | Contents                                   |
|-----------------------|--------------------------------------------|
| `inventory_model.pkl` | Best-performing trained model              |
| `preprocessor.pkl`    | Full preprocessing pipeline (transformers) |
| `encoder.pkl`         | Fitted `OneHotEncoder`                     |
| `scaler.pkl`          | Fitted `StandardScaler`                    |
| `model_metadata.json` | Metrics, feature names, training timestamp |

---

## Step 4 — Prediction (`predict.py`)

The `Predictor` class loads the artifacts; the `predict_inventory` function
implements the project-spec signature:

```python
from predict import predict_inventory

result = predict_inventory(
    current_stock=50,
    sales_last_30_days=120,
    market_trend_score=75,
    supplier_lead_time=7,
    season="Winter",
    category="Electronics",
    sales_previous_30_days=90,   # optional: enables growth reasoning
)
```

Returns:

```python
{
  "predicted_demand": 142,                    # stock level the reorder restores to
  "shortage_probability": 0.89,
  "recommended_order_quantity": 92,           # ML prediction (the target column)
  "confidence_score": 89,
  "explanation": "Sales increased 33% in the last month (from 90 to 120 units). "
                 "Market trend score increased by 25 points (current score 75/100). "
                 "Supplier lead time is 7 days; with a 7-day safety buffer the "
                 "planning horizon is 14 days. Predicted stock requirement over the "
                 "horizon is 142 units (about 10.1 units/day). Current inventory "
                 "(50 units) will last about 5 days. Shortage risk is 89% - order "
                 "soon. Recommended reorder quantity is 92 units. Shortage "
                 "probability is 89%. Confidence Score: 89%."
}
```

> **How the numbers fit together:** the model predicts the reorder quantity
> directly. Because the training label was generated by
> `reorder = ceil(max(minimum_stock, expected_next) - current_stock)`, the
> inverse `predicted_demand = current_stock + reorder` is exactly the stock
> level the business should hold on hand for the horizon. All risk metrics
> (days-of-stock, shortage probability) are derived from this single
> model-driven number, so the response is always internally consistent.

**Explainable AI** — every prediction is accompanied by:
- a human-readable `explanation`,
- a list of `reasoning` points (sales growth, market trend, lead time,
  days-of-stock remaining),
- `shortage_risk` and `suggested_order_date`.

---

## Step 5 — Flask API (`app.py`)

```bash
python app.py --port 5000
```

### `GET /health`

```json
{ "success": true, "status": "ok", "model": "RandomForest", "trained_at": "..." }
```

### `POST /predict` — direct payload

```bash
curl -X POST http://localhost:5000/predict \
  -H "Content-Type: application/json" \
  -d '{
        "current_stock": 50,
        "sales_last_30_days": 120,
        "market_trend_score": 75,
        "supplier_lead_time": 7,
        "season": "Winter",
        "category": "Electronics"
      }'
```

### `POST /predict` — Node.js backend payload

The exact shape the backend `mlClient.js` sends:

```json
{
  "product": {
    "id": "P1001",
    "name": "Wireless Mouse",
    "category": "Electronics",
    "currentStock": 50,
    "minimumStock": 24,
    "price": 25.99
  },
  "supplierLeadTime": 7,
  "marketTrendScore": 75,
  "sales": [
    { "date": "2026-07-05", "quantity": 4 },
    { "date": "2026-07-06", "quantity": 6 }
  ]
}
```

### Response (camelCase — consumed directly by the Node backend)

```json
{
  "success": true,
  "forecast": {
    "productId": "P1001",
    "productName": "Wireless Mouse",
    "category": "Electronics",
    "predictedDailyDemand": 10.14,
    "predictedDemand": 142,
    "horizonDays": 14,
    "confidence": 89,
    "shortageProbability": 0.89,
    "shortageRisk": true,
    "recommendedOrderQty": 92,
    "suggestedOrderDate": "2026-08-06",
    "daysOfStockRemaining": 4.9,
    "reasoning": [ "Sales increased 33% in the last month ..." ],
    "model": "XGBoost",
    "inputs": { "current_stock": 50, "sales_last_30_days": 120, ... }
  }
}
```

---

## Step 6 — Node.js + MongoDB Integration

In the backend `.env` set:

```
AI_SERVICE_URL=http://localhost:5000
```

The existing `backend/src/services/mlClient.js` calls `POST /predict` with the
product + sales payload and reads `data.forecast` — no changes needed. The agent
flow stays fully Human-in-the-Loop: the AI proposes a reorder, a manager
approves, and the decision is written to the audit log.

---

## Tests

```bash
cd ml
pytest tests -v
```

The unit tests cover feature construction, derived metrics (demand projection,
shortage probability, confidence), the full `predict_inventory` response and
the empty-artifacts fallback — no trained model required.

---

## Troubleshooting

| Symptom                                | Fix                                                        |
|----------------------------------------|------------------------------------------------------------|
| `Dataset not found`                     | Run `python generate_dataset.py` first                     |
| `Model artifacts not found` on /predict | Run `python train.py` first (endpoint returns HTTP 503)    |
| XGBoost skipped in training             | `pip install xgboost` (it is optional by design)           |
| Port already in use                     | `python app.py --port 5001`                                |
| CORS errors from the frontend           | Flask-CORS is enabled by default in `app.py`               |
