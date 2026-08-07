# Architecture Document — SmartStock AI

## Executive Overview
**SmartStock AI** is an Agent-Driven Inventory Operations Platform built for **Track A: Business Process Automation**. It automates inventory monitoring, demand forecasting, market trend analysis, and shortage risk detection while requiring **human-in-the-loop manager approval** before any purchase order is executed.

---

## 1. System Architecture

```
                               ┌─────────────────────────────┐
                               │     Frontend (SPA Dashboard)│
                               │   HTML5 / JS / Tailwind CSS │
                               └──────────────┬──────────────┘
                                              │ HTTP / REST (JWT Auth)
                                              ▼
                               ┌─────────────────────────────┐
                               │   Backend (Express API)     │
                               │  - Product / Sales / Auth   │
                               │  - Inventory Operations     │
                               │    Agent & Approval Engine  │
                               └───────┬─────────────┬───────┘
                                       │             │
                    HTTP POST /predict │             │ Local File / Mongo Adapter
       (Fallback to Built-in Engine)   ▼             ▼
          ┌──────────────────────────────┐  ┌─────────────────────────┐
          │  ML Service (Python Flask)   │  │ Persistence Layer       │
          │  - Scikit-Learn / XGBoost    │  │ - JSON Data Store       │
          │  - Demand & Reorder Model    │  │ - MongoDB Atlas         │
          └──────────────────────────────┘  └─────────────────────────┘
```

---

## 2. Component Specifications

### A. Frontend Layer (`/frontend`)
- **Stack**: HTML5, Vanilla JavaScript (ES6+), Tailwind CSS, Chart.js.
- **Server**: Served via lightweight Node HTTP server ([`frontend/server.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/frontend/server.js)).
- **Key Responsibilities**:
  - Executive Dashboard displaying stock metrics, forecasts, shortage alerts, and supplier statuses.
  - Interactive Human-in-the-Loop Approval Interface for pending AI reorder recommendations.
  - Real-time audit log viewer showing decision history.
  - Resilience: Automatic client-side fallback to mock dataset if backend is unreachable.

### B. Backend API & Agent Layer (`/backend`)
- **Stack**: Node.js, Express, JWT, Bcrypt, Dotenv.
- **Key Services**:
  - **Inventory Operations Agent** ([`backend/src/services/agent/inventoryAgent.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/services/agent/inventoryAgent.js)): Coordinates the multi-step inventory analysis workflow.
  - **Market Trend Skill** ([`backend/src/services/agent/skills/marketTrendAnalyzer.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/services/agent/skills/marketTrendAnalyzer.js)): Analyzes external search trends and market demand signals.
  - **ML Client** ([`backend/src/services/mlClient.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/services/mlClient.js)): Interfaces with Python ML service with automatic fallback to built-in linear regression.
  - **Approval & Audit Engine**: Enforces role-based permissions (`admin`, `manager`, `employee`) and logs all decision states (`pending`, `approved`, `rejected`, `superseded`).

### C. Machine Learning Service (`/ml`)
- **Stack**: Python 3.11+, Flask, Scikit-Learn, Pandas, NumPy, XGBoost.
- **Artifacts**: Model pipeline ([`ml/models/inventory_model.pkl`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/ml/models/inventory_model.pkl)), preprocessor, and scalers.
- **REST Endpoints**:
  - `GET /health`: Model readiness probe.
  - `POST /predict`: Receives product sales history, lead times, and market scores; returns demand forecasts, shortage probability, and suggested order dates.

---

## 3. Data Model & Schema

```json
{
  "products": {
    "id": "number (PK)",
    "name": "string",
    "category": "string",
    "warehouse": "string",
    "currentStock": "number",
    "minimumStock": "number",
    "price": "number",
    "supplierId": "number (FK)"
  },
  "sales": {
    "id": "number (PK)",
    "productId": "number (FK)",
    "quantity": "number",
    "date": "YYYY-MM-DD",
    "revenue": "number"
  },
  "predictions": {
    "id": "number (PK)",
    "productId": "number (FK)",
    "forecastDemand": "number",
    "recommendedOrderQty": "number",
    "confidence": "number (0-100)",
    "shortageProbability": "number (0-1)",
    "shortageRisk": "boolean",
    "reason": "string (prose explanation)",
    "status": "pending | approved | rejected | superseded"
  },
  "auditLogs": {
    "id": "number (PK)",
    "productId": "number (FK)",
    "managerDecision": "approved | rejected",
    "approvedBy": "string",
    "comment": "string",
    "timestamp": "ISO8601 string"
  }
}
```

---

## 4. Resilience & Fallback Strategy

1. **DB Adapter Fallback**: If MongoDB connection string is absent or unreachable, the system automatically uses the local JSON document store ([`backend/src/db/db.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/db/db.js)).
2. **ML Service Fallback**: If the Python Flask service is down or times out (>9s), the backend uses built-in linear regression forecast logic ([`backend/src/services/agent/forecast.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/services/agent/forecast.js)).
3. **Frontend Demo Mode**: If the backend is down, the frontend API layer ([`frontend/js/api.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/frontend/js/api.js)) serves bundled mock data so the dashboard remains interactive.
