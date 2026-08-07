const express = require('express');
const { getStore } = require('../db/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ok, fail, asyncHandler } = require('../utils/http');
const { runAnalysis } = require('../services/agent/inventoryAgent');
const notify = require('../services/notify');
const { optionalString } = require('../utils/validate');

const router = express.Router();

function byIdDesc(a, b) {
  return (b.id || 0) - (a.id || 0);
}

function latestPerProduct(predictions) {
  const latest = new Map();
  for (const p of predictions) {
    const cur = latest.get(p.productId);
    if (!cur || (p.id || 0) > (cur.id || 0)) latest.set(p.productId, p);
  }
  return [...latest.values()];
}

function isActiveStatus(p) {
  return p.status === 'pending' || p.status === 'approved' || p.status === 'rejected';
}

/**
 * POST /predict
 * Runs the Inventory Operations Agent (forecast -> risk -> recommendation ->
 * explanation -> notify). Accepts an optional { productId } to analyze a
 * single product instead of all of them.
 */
router.post(
  '/predict',
  authenticate,
  asyncHandler(async (req, res) => {
    let productId = null;
    if (req.body && req.body.productId !== undefined && req.body.productId !== null) {
      productId = Number(req.body.productId);
      if (!Number.isInteger(productId) || productId <= 0) {
        return fail(res, 400, 'productId must be a positive integer');
      }
    }

    const results = await runAnalysis({ productId });
    if (productId && results.length === 0) return fail(res, 404, 'Product not found');

    return ok(res, { predictions: results, count: results.length }, 201);
  })
);

/**
 * GET /forecast
 * Latest prediction per product (feeds charts + trend badges).
 */
router.get(
  '/forecast',
  authenticate,
  asyncHandler(async (req, res) => {
    const all = getStore().col('predictions');
    const latest = latestPerProduct(all).sort(byIdDesc);
    return ok(res, latest);
  })
);

/**
 * GET /recommendations
 * Latest recommendation per product, optionally filtered by status
 * (all | pending | approved | rejected).
 */
router.get(
  '/recommendations',
  authenticate,
  asyncHandler(async (req, res) => {
    const filter = String(req.query.status || 'all');
    let list = latestPerProduct(getStore().col('predictions')).filter(isActiveStatus);
    if (filter !== 'all') list = list.filter((p) => p.status === filter);
    list = list.sort(byIdDesc);
    return ok(res, list);
  })
);

/**
 * GET /alerts
 * Inventory shortage notifications, unread first.
 */
router.get(
  '/alerts',
  authenticate,
  asyncHandler(async (req, res) => {
    const alerts = [...getStore().col('alerts')].sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      return byIdDesc(a, b);
    });
    return ok(res, alerts);
  })
);

/**
 * POST /approve
 * Human-in-the-loop approval. A manager/admin approves or rejects a pending
 * AI recommendation. The decision (with actor, timestamp and comment) is
 * written to the audit log. Approving executes the supplier order by raising
 * the product stock; rejecting leaves inventory untouched.
 */
router.post(
  '/approve',
  authenticate,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const { id, decision, comment } = req.body;

    if (decision !== 'approved' && decision !== 'rejected') {
      return fail(res, 400, "decision must be 'approved' or 'rejected'");
    }
    if (id === undefined || id === null) return fail(res, 400, 'id is required');

    const store = getStore();
    const key = Number(id);
    let prediction = store.findById('predictions', key);

    if (!prediction && Number.isInteger(key)) {
      prediction = store
        .find('predictions', (p) => p.productId === key && p.status === 'pending')
        .sort(byIdDesc)[0] || null;
    }

    if (!prediction) return fail(res, 404, 'Recommendation not found');
    if (prediction.status !== 'pending') {
      return fail(res, 409, `Recommendation already ${prediction.status}`);
    }

    const manager = req.user;
    const cleanComment = optionalString(comment, { max: 500 }) || '';

    const updated = await store.update('predictions', prediction.id, {
      status: decision,
      decisionComment: cleanComment,
      approvedBy: manager.name,
      approvedAt: new Date().toISOString(),
    });

    let product = null;
    if (decision === 'approved' && prediction.recommendedOrderQty > 0) {
      product = store.findById('products', prediction.productId);
      if (product) {
        const nextStock = product.currentStock + prediction.recommendedOrderQty;
        product = await store.update('products', product.id, { currentStock: nextStock });
      }
    }

    const audit = await store.insert('auditLogs', {
      productId: prediction.productId,
      productName: prediction.productName,
      prediction: `Demand ${prediction.forecastDemand} units over ${prediction.horizonDays || 14} days`,
      aiReason: prediction.reason,
      managerDecision: decision,
      approvedBy: manager.name,
      comment: cleanComment,
      confidence: prediction.confidence,
      timestamp: new Date().toISOString(),
      recommendedOrderQty: prediction.recommendedOrderQty,
    });

    await notify.send({
      type: decision,
      message:
        decision === 'approved'
          ? `${manager.name} approved reordering ${prediction.recommendedOrderQty} units of ${prediction.productName}.`
          : `${manager.name} rejected the recommendation for ${prediction.productName}.`,
      payload: { productId: prediction.productId, auditId: audit.id },
      via: ['log'],
    });

    return ok(res, { prediction: updated, audit, product });
  })
);

module.exports = router;
