const { getStore } = require('../../db/db');
const { predict } = require('../mlClient');
const trendSkill = require('./skills/marketTrendAnalyzer');
const notify = require('../notify');

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
    daysOfStockRemaining: result.daysOfStockRemaining,
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
 * Implements the documented workflow:
 * Fetch Inventory -> Analyze Sales -> Collect Trends -> Forecast Demand ->
 * Compare Stock -> Detect Risk -> Generate Recommendation -> Explain Decision
 * -> Notify Manager (waiting for approval happens via the approve endpoint).
 */
async function runAnalysis({ productId = null } = {}) {
  const store = getStore();
  const products = productId ? [store.findById('products', productId)].filter(Boolean) : store.col('products');
  const results = [];

  for (const product of products) {
    const { prediction } = await analyzeProduct(store, product);

    // A newer run supersedes the previous pending recommendation so only the
    // latest one waits for approval while history stays intact.
    const previous = store.find(
      'predictions',
      (p) => p.productId === product.id && p.status === 'pending'
    );
    for (const old of previous) {
      await store.update('predictions', old.id, { status: 'superseded' });
    }

    await store.insert('predictions', prediction);
    results.push(prediction);

    if (prediction.shortageRisk) {
      const message =
        `Shortage risk for ${product.name}: stock (${product.currentStock}) covers ~` +
        `${prediction.predictedDailyDemand ? (product.currentStock / Math.max(prediction.predictedDailyDemand, 0.001)).toFixed(1) : '?'} days. ` +
        `Recommended order ${prediction.recommendedOrderQty} units (confidence ${prediction.confidence}%).`;
      await store.insert('alerts', {
        type: prediction.shortageProbability >= 0.7 ? 'critical' : 'shortage_risk',
        productId: product.id,
        message,
        severity: prediction.shortageProbability >= 0.7 ? 'high' : 'medium',
        read: false,
      });
      await notify.send({
        type: prediction.shortageProbability >= 0.7 ? 'critical' : 'shortage_risk',
        message,
        payload: { productId: product.id },
        via: ['log', 'telegram'],
      });
    }
  }

  return results;
}

module.exports = { runAnalysis, analyzeProduct };
