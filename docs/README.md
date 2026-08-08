# 📦 SmartStock AI — Agent-Driven Inventory Operations Platform

[![CI/CD Pipeline](https://github.com/anshpriyadarshidas-a11y/smartStock-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/anshpriyadarshidas-a11y/smartStock-AI/actions/workflows/ci.yml)
![Track](https://img.shields.io/badge/Hackathon-Track_A:_Business_Process_Automation-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Node](https://img.shields.io/badge/Node.js-%3E%3D20.0-brightgreen)
![Python](https://img.shields.io/badge/Python-3.11%2B-blue)

> **Deploy or Die: HowToAlgo x GDG on Campus KIIT Hackathon** Submission  
> Track A: Business Process Automation

SmartStock AI is an AI-powered inventory operations platform designed to automate demand forecasting, shortage risk detection, and purchase order generation while enforcing strict **human-in-the-loop manager approval** and immutable audit logging.

---

## 🏛️ Hackathon Non-Negotiables Checkpoints

| Checkpoint | File Path | Status |
| :--- | :--- | :---: |
| **1. Architecture Document** | [`docs/ARCHITECTURE.md`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/docs/ARCHITECTURE.md) & [`ARCHITECTURE.md`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/ARCHITECTURE.md) | ✅ Verified |
| **2. Agent Rules & Constitution** | [`.clinerules`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/.clinerules) & [`constitution.md`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/constitution.md) | ✅ Verified |
| **3. Working Code & Demo** | Backend (`/backend`), ML Service (`/ml`), Frontend (`/frontend`) | ✅ Verified |
| **4. Custom Agents & Skills** | [`AGENTS_AND_SKILLS.md`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/AGENTS_AND_SKILLS.md) | ✅ Verified |
| **5. Green CI/CD Pipeline** | [`.github/workflows/ci.yml`](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/.github/workflows/ci.yml) | ✅ Verified |

---

## 🚀 Key Features

* 🤖 **Inventory Operations Agent**: Automatically monitors stock, sales velocity, supplier lead times, and market search trends.
* 🔮 **ML Predictive Forecasting**: Uses trained Scikit-Learn & XGBoost models to compute demand and safety buffer requirements.
* 🛡️ **Human-in-the-Loop Approval**: Reorder recommendations wait in a `pending` state until an authorized manager approves or rejects them.
* 📜 **Auditable Decision Trail**: Records every manager decision, reasoning string, confidence score, and timestamp in an immutable audit log.
* 🔄 **Resilience & Fallbacks**:
  * **ML Fallback**: Seamless fallback to built-in linear regression if the Python ML service is offline.
  * **DB Fallback**: Automatic fallback from MongoDB Atlas to local JSON file storage.
  * **UI Fallback**: Client-side mock data fallback if backend is unreachable.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla JS (ES6+), Tailwind CSS, Chart.js.
- **Backend API**: Node.js, Express, JWT, Dotenv, Bcrypt.
- **ML Service**: Python 3.11+, Flask, Scikit-Learn, Pandas, NumPy, XGBoost.
- **Testing**: Node test runner (`node --test`), `pytest`, Playwright E2E.
- **CI/CD**: GitHub Actions.

---

## ⚡ Quick Start

### 1. Prerequisites
- Node.js >= 20.0
- Python 3.11+

### 2. Installation
```bash
# Install dependencies for Node workspaces and Python ML service
npm run install:all
```

### 3. Running Services Concurrently
```bash
# Start Backend Express API (Port 4000)
npm start

# Start Python Flask ML Service (Port 5000)
npm run start:ml

# Start Frontend Dashboard (Port 3000)
npm run start:frontend
```

Open `http://localhost:3000` in your web browser to view the interactive dashboard.

---

## ⚙️ Current Runtime Status (2026-08-08)

- **Backend**: running at `http://localhost:4000` (file-based DB fallback active when MongoDB is unavailable).
- **Frontend**: running at `http://localhost:3000` (static dashboard server).
- **ML Service**: running at `http://localhost:5000` (Flask). Note: ML unit tests passed locally (`6 passed`) but there are `scikit-learn` unpickle warnings due to a minor version mismatch when loading saved artifacts.

Logs for the locally-launched services are written to the repository `service-logs/` directory when started via the included PowerShell helper in this project.

### Run all services quickly (PowerShell background jobs)
```powershell
# from repository root
$logDir = Join-Path (Get-Location) 'service-logs'; if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
Start-Job -Name backend -ScriptBlock { Set-Location (Get-Location); npm run start --workspace backend 2>&1 | Tee-Object -FilePath (Join-Path $PWD 'service-logs\backend.log') }
Start-Job -Name frontend -ScriptBlock { Set-Location (Get-Location); node frontend/server.js 2>&1 | Tee-Object -FilePath (Join-Path $PWD 'service-logs\frontend.log') }
Start-Job -Name ml -ScriptBlock { Set-Location (Get-Location); python -u ml/app.py 2>&1 | Tee-Object -FilePath (Join-Path $PWD 'service-logs\ml.log') }
Get-Job -Name backend,frontend,ml | Select Name,State
```


## 🧪 Testing & Verification

```bash
# Run Backend Unit Tests (19 passing)
npm test

# Run ML Pytest Suite (6 passing)
pytest ml -v

# Run End-to-End Workflow Verification Script
node backend/e2e.verify.js

# Run Playwright UI End-to-End Tests
npm run test:e2e
```

---

## 📚 Project Documentation

- [**PRD & User Stories**](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/docs/PRD.md)
- [**Architecture Specification**](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/docs/ARCHITECTURE.md)
- [**Custom Agents & Skills**](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/AGENTS_AND_SKILLS.md)
- [**Project Constitution**](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/constitution.md)
- [**ADLC Task Breakdown**](file:///c:/Users/asus/OneDrive/Documents/projects/smartStock-AI/docs/TASKS.md)
