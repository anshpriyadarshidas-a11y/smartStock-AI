# Custom Agents and Custom Skills Documentation — SmartStock AI

This repository defines and implements custom AI agents and skills to automate complex operational inventory workflows.

---

## 1. Custom Agent: Inventory Operations Agent

* **File Location**: [`backend/src/services/agent/inventoryAgent.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/services/agent/inventoryAgent.js)
* **Type**: Operational Decision Agent
* **Role**: Autonomous Inventory Supervisor & Reorder Specialist

### Operational Workflow
1. **Fetch Inventory**: Retrieves current stock levels, safety thresholds, and supplier lead times for target products.
2. **Analyze Sales**: Aggregates 30-day and 90-day daily sales history.
3. **Collect Trends**: Invokes the **Market Trend Analyzer Skill** to get real-time market sentiment and search index scores.
4. **Forecast Demand**: Calls the ML prediction service (`ml/app.py`) or falls back to built-in weighted regression.
5. **Detect Risk**: Calculates shortage probability and days of remaining stock.
6. **Generate Recommendation**: Formulates precise reorder quantities and suggested order dates.
7. **Explain Decision**: Constructs natural-language prose explaining the exact mathematical reasoning and risk factors.
8. **Human Approval Routing**: Marks the recommendation as `pending` and dispatches alerts to management for human-in-the-loop review.

---

## 2. Custom Skill: Market Trend Analyzer

* **File Location**: [`backend/src/services/agent/skills/marketTrendAnalyzer.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/services/agent/skills/marketTrendAnalyzer.js)
* **Type**: Intelligence & Signal Processing Skill
* **Role**: External Market Demand & Category Trend Extraction

### Capability Overview
- **Category Baseline Benchmarking**: Maps product categories (e.g., Fitness, Electronics, Seasonal Apparel) to market velocity curves.
- **External API Signal Integration**: Connects with Trend APIs / Google Trends / News APIs to derive consumer interest scores (0-100).
- **Prose Context Generation**: Produces human-readable notes explaining why demand for a given category is trending up or down.

---

## 3. Custom Skill: Demand & Risk Forecasting Skill

* **File Location**: [`ml/predict.py`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/ml/predict.py) & [`backend/src/services/agent/forecast.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/services/agent/forecast.js)
* **Type**: ML Predictive Skill
* **Role**: Machine-Learning Demand Prediction & Safety Buffer Calculation

### Capability Overview
- Uses trained Scikit-Learn / XGBoost models (`inventory_model.pkl`) to compute optimal reorder quantities based on stock cover ratios, seasonality, and price elasticities.
- Calculates logistic shortage probability curves $P = \frac{1}{1 + e^{-(L - S)}}$.
- Derives model confidence scores calibrated against cross-validation $R^2$ metrics.

---

## 4. Agent Execution & Human-in-the-Loop Governance

| Trigger | Agent Action | Human Action Required |
| :--- | :--- | :--- |
| Low Stock Event / Scheduled Run | Inventory Agent runs analysis & generates pending recommendation | Manager receives alert & reviews proposal |
| Manager Approves | Agent logs audit entry & executes purchase order (raises stock) | Order fulfilled |
| Manager Rejects | Agent logs audit entry & leaves inventory untouched | Decision recorded in audit log |

---

## Recent Operational Notes (2026-08-08)

- The local ML pytest suite passes: `6 passed` (unit tests for `predict.py`). The runtime emits `scikit-learn` unpickle warnings when loading older artifacts; this is a non-fatal compatibility warning to be addressed during model retraining.

- To run a full agent analysis and generate live predictions from the running ML service:

```bash
# trigger the Inventory Agent from the backend (requires backend server running)
curl -X POST http://localhost:4000/predict -H "Authorization: Bearer <admin-token>" -d '{}'
# or run the agent directly in-node
node backend/src/services/agent/inventoryAgent.js
```

- To seed realistic ML-driven predictions and produce manager audit logs, run the helper script:

```bash
node backend/scripts/seed_real_data.js
```

Seed output and service logs (if using the PowerShell job approach) are available under `service-logs/` in the repository root.
