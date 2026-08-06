# constitution.md — SmartStock AI

This document is the constitution for the SmartStock AI project. It encodes the
non-negotiable principles, decision rules, and working agreements that every
contributor, agent, and automated pipeline in this repository MUST follow.

## 1. Mission

Build an agent-driven inventory operations platform that predicts demand,
detects shortage risks, generates explainable restocking recommendations, and
routes every decision through a human approval workflow with a complete audit
trail.

## 2. Non-Negotiables

1. **Human-in-the-loop**: No AI recommendation is ever executed without explicit
   human approval. The AI proposes; a human disposes.
2. **Explainability**: Every AI output MUST include reasoning, a confidence score,
   and the inputs that drove the decision. Never say "order 50 units" without
   explaining why.
3. **Traceability**: Every AI decision and every approval MUST be recorded in the
   audit log with a timestamp, decision, and actor.
4. **Working software over features**: A complete, working workflow beats many
   half-built features. The primary demo flow MUST always run end-to-end.
5. **Tests are mandatory**: No feature lands without tests. The CI pipeline must
   stay green.
6. **Secrets never commit**: No API keys, tokens, or connection strings in the
   repository. Use environment variables only.
7. **Clean commits**: Small, focused, incrementally-reviewable commits.

## 3. Architecture Rules

- Backend is the single source of truth for business rules.
- Frontend NEVER performs data mutations directly; it only calls the API.
- The AI agent is a discrete service boundary; forecasting logic is swappable
  (built-in engine or Python ML service).
- The data layer is behind an adapter interface so MongoDB can replace the local
  file store without touching business logic.

## 4. Agent Code of Conduct

- Never mutate inventory without an approval record.
- Never fabricate data; if trend data is unavailable, mark the trend score as neutral.
- Always degrade gracefully: if the Python ML service is down, use the built-in
  engine and log the fallback.

## 5. Definition of Done

A task is done when:

- Code is implemented and self-documented by naming.
- Backend tests pass (`npm test`).
- ESLint passes (`npm run lint`).
- The affected endpoint is verified against a running server.
- Relevant documentation (ARCHITECTURE/PRD/AGENTS) is updated if behavior changed.
