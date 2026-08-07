const express = require('express');
const { getStore } = require('../db/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ok, fail, asyncHandler } = require('../utils/http');
const { requiredString, positiveInt } = require('../utils/validate');

const router = express.Router();

function validateSupplier(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (body.name !== undefined || !partial) {
    const name = requiredString(body.name);
    if (!name) errors.push('name is required');
    else data.name = name;
  }
  if (body.contact !== undefined || !partial) {
    const contact = requiredString(body.contact);
    if (!contact) errors.push('contact is required');
    else data.contact = contact;
  }
  if (body.averageDeliveryDays !== undefined || !partial) {
    const days = positiveInt(body.averageDeliveryDays);
    if (Number.isNaN(days)) errors.push('averageDeliveryDays must be a positive integer');
    else data.averageDeliveryDays = days;
  }
  return { data, errors };
}

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const suppliers = [...getStore().col('suppliers')].sort((a, b) => a.name.localeCompare(b.name));
    return ok(res, suppliers);
  })
);

router.post(
  '/',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { data, errors } = validateSupplier(req.body);
    if (errors.length) return fail(res, 400, errors.join('; '));
    const supplier = await getStore().insert('suppliers', data);
    return ok(res, supplier, 201);
  })
);

router.put(
  '/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!getStore().findById('suppliers', id)) return fail(res, 404, 'Supplier not found');
    const { data, errors } = validateSupplier(req.body, { partial: true });
    if (errors.length) return fail(res, 400, errors.join('; '));
    const supplier = await getStore().update('suppliers', id, data);
    return ok(res, supplier);
  })
);

router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!getStore().findById('suppliers', id)) return fail(res, 404, 'Supplier not found');
    await getStore().remove('suppliers', id);
    return ok(res, { deleted: true, id });
  })
);

module.exports = router;
