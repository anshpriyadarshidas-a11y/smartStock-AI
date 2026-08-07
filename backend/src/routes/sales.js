const express = require('express');
const { getStore } = require('../db/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ok, fail, asyncHandler } = require('../utils/http');
const { positiveInt, optionalString } = require('../utils/validate');

const router = express.Router();

router.post(
  '/',
  authenticate,
  requireRole('admin', 'manager', 'employee'),
  asyncHandler(async (req, res) => {
    const productId = positiveInt(req.body.productId);
    const quantity = positiveInt(req.body.quantity);
    if (Number.isNaN(productId)) return fail(res, 400, 'productId must be a positive integer');
    if (Number.isNaN(quantity)) return fail(res, 400, 'quantity must be a positive integer');

    const date = optionalString(req.body.date, { max: 10 }) || new Date().toISOString().slice(0, 10);

    const product = getStore().findById('products', productId);
    if (!product) return fail(res, 404, 'Product not found');

    const revenue = Number((quantity * product.price).toFixed(2));

    const sale = await getStore().insert('sales', {
      productId,
      quantity,
      date,
      revenue,
    });

    // Recording a sale consumes inventory (documented workflow: sales -> inventory).
    const nextStock = Math.max(0, product.currentStock - quantity);
    const updated = await getStore().update('products', productId, { currentStock: nextStock });

    return ok(res, { sale, product: updated }, 201);
  })
);

router.get(
  '/history',
  authenticate,
  asyncHandler(async (req, res) => {
    const { productId, from, to, limit } = req.query;
    let sales = getStore().col('sales');

    if (productId) {
      const pid = Number(productId);
      sales = sales.filter((s) => s.productId === pid);
    }
    if (from) sales = sales.filter((s) => s.date >= String(from));
    if (to) sales = sales.filter((s) => s.date <= String(to));

    sales = [...sales].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const max = Math.min(Number(limit) || sales.length, 5000);
    return ok(res, sales.slice(0, max));
  })
);

module.exports = router;
