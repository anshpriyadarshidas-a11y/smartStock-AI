const express = require('express');
const { getStore } = require('../db/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ok, fail, asyncHandler } = require('../utils/http');
const {
  requiredString,
  nonNegativeNumber,
  nonNegativeInt,
  positiveInt,
  optionalString,
} = require('../utils/validate');

const router = express.Router();

const PRODUCT_FIELDS = ['name', 'category', 'warehouse', 'currentStock', 'minimumStock', 'price', 'supplierId'];

function validateProduct(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  const pick = (key) => body[key];

  if (pick('name') !== undefined || !partial) {
    const name = requiredString(pick('name'));
    if (!name) errors.push('name is required');
    else data.name = name;
  }
  if (pick('category') !== undefined || !partial) {
    const category = requiredString(pick('category'));
    if (!category) errors.push('category is required');
    else data.category = category;
  }
  if (pick('warehouse') !== undefined || !partial) {
    const warehouse = optionalString(pick('warehouse'), { max: 120 }) || 'Main Warehouse';
    data.warehouse = warehouse;
  }
  if (pick('currentStock') !== undefined || !partial) {
    const currentStock = nonNegativeInt(pick('currentStock'));
    if (Number.isNaN(currentStock)) errors.push('currentStock must be a non-negative integer');
    else data.currentStock = currentStock;
  }
  if (pick('minimumStock') !== undefined || !partial) {
    const minimumStock = nonNegativeInt(pick('minimumStock'));
    if (Number.isNaN(minimumStock)) errors.push('minimumStock must be a non-negative integer');
    else data.minimumStock = minimumStock;
  }
  if (pick('price') !== undefined || !partial) {
    const price = nonNegativeNumber(pick('price'));
    if (Number.isNaN(price)) errors.push('price must be a non-negative number');
    else data.price = Number(price.toFixed(2));
  }
  if (pick('supplierId') !== undefined || !partial) {
    const supplierId = positiveInt(pick('supplierId'));
    if (Number.isNaN(supplierId)) errors.push('supplierId must be a positive integer');
    else data.supplierId = supplierId;
  }

  return { data, errors };
}

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { category, search, warehouse } = req.query;
    let products = getStore().col('products');
    if (category && category !== 'all') {
      products = products.filter((p) => p.category === category);
    }
    if (warehouse) {
      products = products.filter((p) => p.warehouse === warehouse);
    }
    if (search) {
      const q = String(search).toLowerCase();
      products = products.filter(
        (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
      );
    }
    products = [...products].sort((a, b) => a.name.localeCompare(b.name));
    return ok(res, products);
  })
);

router.post(
  '/',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { data, errors } = validateProduct(req.body);
    if (errors.length) return fail(res, 400, errors.join('; '));

    const supplier = data.supplierId ? getStore().findById('suppliers', data.supplierId) : null;
    if (!supplier) return fail(res, 400, `supplier ${data.supplierId} does not exist`);

    const product = await getStore().insert('products', data);
    return ok(res, product, 201);
  })
);

router.put(
  '/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = getStore().findById('products', id);
    if (!existing) return fail(res, 404, 'Product not found');

    const { data, errors } = validateProduct(req.body, { partial: true });
    if (errors.length) return fail(res, 400, errors.join('; '));

    if (data.supplierId) {
      const supplier = getStore().findById('suppliers', data.supplierId);
      if (!supplier) return fail(res, 400, `supplier ${data.supplierId} does not exist`);
    }

    const product = await getStore().update('products', id, data);
    return ok(res, product);
  })
);

router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = getStore().findById('products', id);
    if (!existing) return fail(res, 404, 'Product not found');

    await getStore().remove('products', id);
    for (const p of getStore().find('predictions', (r) => r.productId === id)) {
      await getStore().update('predictions', p.id, { status: 'superseded' });
    }
    return ok(res, { deleted: true, id });
  })
);

module.exports = router;
module.exports.PRODUCT_FIELDS = PRODUCT_FIELDS;
