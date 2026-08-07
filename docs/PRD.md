# Product Requirement Document (PRD) — SmartStock AI

## Track: Track A – Business Process Automation
**Product Name**: SmartStock AI  
**Goal**: Automate real-world inventory operations workflows with human-in-the-loop governance, demand forecasting, shortage risk detection, and transparent audit logging.

---

## 1. Executive Summary & Value Proposition

Manual inventory tracking in retail, warehousing, and e-commerce leads to stockouts, overstocking, and delayed replenishment. SmartStock AI transforms inventory management from reactive monitoring into an **agent-driven predictive workflow**.

The system:
1. Continually monitors inventory levels, historical sales, lead times, and market trend signals.
2. Predicts future demand and identifies shortage risks using machine learning.
3. Automatically formulates reorder recommendations with natural language justifications.
4. Enforces a **Human-in-the-Loop approval gate** before executing purchase orders.
5. Records every decision state in an immutable audit trail.

---

## 2. User Stories & Acceptance Criteria

### User Story 1: Automated Shortage Risk Detection & Forecasting (AI Agent)
> **As an** Operations Manager,  
> **I want** the AI agent to continuously analyze stock levels and sales trends,  
> **So that** I am alerted to stockouts before they occur.

#### Acceptance Criteria
- **AC 1.1**: The system must calculate expected daily demand over a planning horizon ($L + S$, where $L$ = supplier lead time, $S$ = safety buffer).
- **AC 1.2**: If stock coverage falls below lead time or shortage probability exceeds $50\%$, an alert with severity `high` or `medium` must be created.
- **AC 1.3**: The forecast must provide an explanation string containing mathematical reasoning, confidence score, and input parameters.

---

### User Story 2: Human-in-the-Loop Recommendation Approval (Manager Role)
> **As an** Inventory Manager,  
> **I want** to review, approve, or reject pending AI reorder recommendations,  
> **So that** automated purchasing is never executed without human authorization.

#### Acceptance Criteria
- **AC 2.1**: AI recommendations are initially saved with status `pending`.
- **AC 2.2**: Only authenticated users with `admin` or `manager` roles can approve or reject recommendations (`POST /approve`).
- **AC 2.3**: Approving a recommendation automatically updates the product's `currentStock` by adding the `recommendedOrderQty`.
- **AC 2.4**: Rejecting a recommendation leaves current inventory untouched and updates status to `rejected`.
- **AC 2.5**: Non-manager users (`employee`) attempting to approve recommendations must receive an HTTP `403 Forbidden` response.

---

### User Story 3: Immutable Audit Trail & Decision Lineage
> **As an** Auditor or Business Owner,  
> **I want** a full decision history of all AI recommendations and manager actions,  
> **So that** every inventory modification is traceable and auditable.

#### Acceptance Criteria
- **AC 3.1**: Every approval or rejection action creates an entry in the `auditLogs` collection.
- **AC 3.2**: Audit entries must store `productId`, `prediction`, `aiReason`, `managerDecision`, `approvedBy` user name, manager `comment`, `timestamp`, and `confidence`.
- **AC 3.3**: The audit log must be retrievable via `GET /audit` sorted newest-first.

---

### User Story 4: System Resilience & Seamless Fallbacks
> **As a** System Administrator,  
> **I want** the backend and frontend to degrade gracefully when external services fail,  
> **So that** the core platform never crashes end-to-end.

#### Acceptance Criteria
- **AC 4.1**: If the Python Flask ML service is unreachable, the backend must log a warning and fall back to the built-in linear regression forecast engine without throwing an error to the user.
- **AC 4.2**: If MongoDB is unreachable, the backend must use local JSON file storage (`data/db.json`).
- **AC 4.3**: If the backend API is offline, the frontend dashboard must switch to demo mode using client-side mock data.
