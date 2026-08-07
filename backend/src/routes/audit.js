const express = require('express');
const { getStore } = require('../db/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ok, asyncHandler } = require('../utils/http');

const router = express.Router();

/**
 * GET /audit
 * Full decision history (AI recommendation -> human approval), newest first.
 * Visible to managers and admins.
 */
router.get(
  '/',
  authenticate,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const logs = [...getStore().col('auditLogs')].sort((a, b) => {
      const da = a.timestamp || '';
      const db = b.timestamp || '';
      return db.localeCompare(da) || (b.id || 0) - (a.id || 0);
    });
    const max = Math.min(Number(req.query.limit) || logs.length, 2000);
    return ok(res, logs.slice(0, max));
  })
);

/**
 * GET /audit/:productId - audit history for a single product.
 */
router.get(
  '/:productId',
  authenticate,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const productId = Number(req.params.productId);
    const logs = getStore()
      .find('auditLogs', (l) => l.productId === productId)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return ok(res, logs);
  })
);

module.exports = router;
