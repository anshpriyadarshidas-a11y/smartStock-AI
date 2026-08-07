const config = require('../config');
const { forecast: builtinForecast } = require('./agent/forecast');

/**
 * Client for the optional Python ML service (Flask + scikit-learn / XGBoost).
 * Falls back to the built-in forecast engine when the service is unreachable,
 * not configured, or returns an error, so the product always works end-to-end.
 */
async function predict(product, supplier, sales, marketTrendScore = 50) {
  if (!config.aiServiceUrl) {
    return { model: 'builtin-linear-regression', ...builtinForecast(product, supplier, sales, { marketTrendScore }) };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(`${config.aiServiceUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product,
        supplierLeadTime: supplier ? supplier.averageDeliveryDays : 5,
        sales: sales.map((s) => ({ date: s.date, quantity: s.quantity })),
        marketTrendScore,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`AI service returned ${res.status}`);
    const data = await res.json();
    if (data.success === false) throw new Error(data.error || 'AI service error');
    return { model: 'python-scikit-learn', ...data.forecast };
  } catch (err) {
    console.warn(`[mlClient] python service unavailable (${err.message}); using built-in engine.`);
    return { model: 'builtin-linear-regression', ...builtinForecast(product, supplier, sales, { marketTrendScore }) };
  }
}

module.exports = { predict };
