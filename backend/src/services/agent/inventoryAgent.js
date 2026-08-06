const { getStore } = require('../../db/db');
const { predict } = require('../mlClient');
const trendSkill = require('./skills/marketTrendAnalyzer');

function getSales(store, productId) {
  return store
    .find('sales', (s) => s.productId === productId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getSupplier(store, product) {
  return product.supplierId ? store.findById('suppliers', product.supplierId) : null;
}

async function analyzeProduct(store, product, opts = {}) {
  const sales = getSales(store, product.id);
  const supplier = getSupplier(store, product);

  const trend = opts.trendScore !== undefined
    ? { score: opts.trendScore, note: 'explicit trend score', source: 'manual' }
    : await trendSkill.analyze(product);

  const result = await predict(product, supplier, sales, trend.score);

  const prediction = {
    productId: product.id,
    productName: product.name,
    category: product.category,
    forecastDemand: result.predictedDemand,
    predictedDailyDemand: result.predictedDailyDemand,
    confidence: result.confidence,
    recommendedOrderQty: result.recommendedOrderQty,
    suggestedOrderDate: result.suggestedOrderDate,
    shortageProbability: result.shortageProbability,
    shortageRisk: result.shortageRisk,
    reason: result.reasoning.join(' '),
    trendScore: trend.score,
    trendNote: trend.note,
    trendSource: trend.source,
    model: result.model,
    status: 'pending',
  };
  return { prediction, forecast: result, trend };
}

/**
 * Run the Inventory Operations Agent across all products (or one).
 * Fetches inventory, analyzes sales, applies market trends, forecasts demand,
 * detects shortage risk and generates recommendations.
 */
async function runAnalysis({ productId = null } = {}) {
  const store = getStore();
  const products = productId ? [store.findById('products', productId)].filter(Boolean) : store.col('products');
  const results = [];

  for (const product of products) {
    const { prediction } = await analyzeProduct(store, product);
    store.insert('predictions', prediction);
    results.push(prediction);

    if (prediction.shortageRisk) {
      const message =
        `Shortage risk for ${product.name}: stock (${product.currentStock}) covers ~` +
        `${prediction.forecastDemand ? (product.currentStock / Math.max(prediction.predictedDailyDemand, 0.001)).toFixed(1) : '?'} days. ` +
        `Recommended order ${prediction.recommendedOrderQty} units (confidence ${prediction.confidence}%).`;
      store.insert('alerts', {
        type: prediction.shortageProbability >= 0.7 ? 'critical' : 'shortage_risk',
        productId: product.id,
        message,
        severity: prediction.shortageProbability >= 0.7 ? 'high' : 'medium',
        read: false,
      });
    }
  }

  return results;
}

module.exports = { runAnalysis, analyzeProduct };
