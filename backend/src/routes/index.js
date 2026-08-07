const express = require('express');
const authRoutes = require('./auth');
const productRoutes = require('./products');
const saleRoutes = require('./sales');
const aiRoutes = require('./ai');
const auditRoutes = require('./audit');
const supplierRoutes = require('./suppliers');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/sales', saleRoutes);
router.use(aiRoutes); // /predict, /forecast, /recommendations, /alerts, /approve
router.use('/audit', auditRoutes);
router.use('/suppliers', supplierRoutes);

module.exports = router;
