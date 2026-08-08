# Architecture Document — SmartStock AI

Please refer to the detailed architecture documentation located at [`docs/ARCHITECTURE.md`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/docs/ARCHITECTURE.md).

## Quick Overview

- **Track**: Track A – Business Process Automation
- **Stack**: Node.js / Express (Backend), Python / Flask / Scikit-Learn (ML Service), Vanilla JS / Tailwind CSS (Frontend).
- **Core Workflow**: Continuous Inventory Monitoring $\rightarrow$ Demand Forecasting $\rightarrow$ Risk Detection $\rightarrow$ Restock Recommendation $\rightarrow$ Human-in-the-Loop Approval $\rightarrow$ Order Execution & Audit Trail.

## Runtime Details (local / demo)

- **Backend API**: Express server (default port `4000`) — falls back to a local JSON file store when `MONGO_URI` is not configured or MongoDB is unreachable.
- **Frontend**: Static server serving `index.html` on port `3000`.
- **ML Service**: Flask application (default port `5000`) — exposes `GET /health` and `POST /predict` and is used by the backend agent via `mlClient`.

When running the demo locally, the three services may be launched concurrently (see `README.md` for commands). Service logs can be captured into a `service-logs/` directory for easier inspection.
