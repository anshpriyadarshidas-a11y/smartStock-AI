# ADLC Task Breakdown — SmartStock AI

This document details the Agent-Driven Application Lifecycle (ADLC) task breakdown executed to build, verify, and document SmartStock AI.

---

## Sprint Task Breakdown

### Phase 1: Problem Definition & Architecture Specification
- [x] **TASK-01**: Define product scope, target workflow, and Track A alignment.
- [x] **TASK-02**: Establish architectural rules & non-negotiables in [`constitution.md`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/constitution.md) and [`.clinerules`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/.clinerules).
- [x] **TASK-03**: Document system architecture in [`docs/ARCHITECTURE.md`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/docs/ARCHITECTURE.md) and PRD in [`docs/PRD.md`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/docs/PRD.md).

### Phase 2: Core Platform & Database Layer
- [x] **TASK-04**: Build Express API backend with JSON/MongoDB database adapter.
- [x] **TASK-05**: Implement authentication & role-based access control (`admin`, `manager`, `employee`).
- [x] **TASK-06**: Implement CRUD endpoints for Products, Suppliers, Sales, and Audit Logs.

### Phase 3: Agent & ML Service Development
- [x] **TASK-07**: Build Python Flask ML prediction service (`ml/app.py`, `ml/predict.py`).
- [x] **TASK-08**: Train demand forecasting models (Scikit-Learn/XGBoost) and export model artifacts (`ml/models/`).
- [x] **TASK-09**: Implement Inventory Operations Agent ([`backend/src/services/agent/inventoryAgent.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/services/agent/inventoryAgent.js)).
- [x] **TASK-10**: Implement Market Trend Analyzer Skill ([`backend/src/services/agent/skills/marketTrendAnalyzer.js`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/backend/src/services/agent/skills/marketTrendAnalyzer.js)).
- [x] **TASK-11**: Implement Human-in-the-Loop Approval workflow (`POST /approve`) with automatic stock updates and audit logging.

### Phase 4: Frontend UI & Visualization
- [x] **TASK-12**: Create executive web dashboard (`frontend/index.html`, `frontend/css/styles.css`, `frontend/js/app.js`).
- [x] **TASK-13**: Implement Chart.js demand forecast & stock level charts (`frontend/js/charts.js`).
- [x] **TASK-14**: Build Human Approval modal and recommendation status filters.
- [x] **TASK-15**: Implement graceful client-side demo fallback (`frontend/js/api.js`).

### Phase 5: Verification, CI/CD & Delivery
- [x] **TASK-16**: Write backend unit test suite (`backend/tests/api.test.js`) — 19 tests passing.
- [x] **TASK-17**: Write Python pytest suite (`ml/tests/test_predict.py`) — 6 tests passing.
- [x] **TASK-18**: Write E2E verification workflow script (`backend/e2e.verify.js`).
- [x] **TASK-19**: Configure Playwright E2E UI test suite (`playwright.config.js`, `e2e/dashboard.spec.js`).
- [x] **TASK-20**: Build GitHub Actions CI/CD pipeline (`.github/workflows/ci.yml`).
- [x] **TASK-21**: Create [`AGENTS_AND_SKILLS.md`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/AGENTS_AND_SKILLS.md) to document custom agents & skills.
