const config = require('../../../config');

const CATEGORY_TRENDS = {
  'Outdoor': { score: 78, note: 'Seasonal weather demand (rain season); search interest rising.' },
  'Electronics': { score: 68, note: 'Steady consumer electronics demand; new-model seasonality.' },
  'Home & Garden': { score: 52, note: 'Near-baseline search interest.' },
  'Apparel': { score: 58, note: 'Mild upward interest for basics.' },
  'Fitness': { score: 55, note: 'Slightly above baseline interest.' },
  'Toys': { score: 82, note: 'Approaching holiday period; search interest climbing.' },
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Market Trend Analyzer skill.
 *
 * Computes a market trend score (0-100) for a product by combining category
 * baseline interest with live signals when configured:
 *
 *   1. TREND_API_URL      - generic trend endpoint (e.g. a Google Trends proxy)
 *      GET ?q=<product>&category=<category>  -> { score: 0..100 }
 *   2. GOOGLE_TRENDS_URL  - Google Trends proxy returning { interest: 0..100 }
 *   3. NEWS_API_KEY       - News API mention volume for the product keyword
 *
 * When no live source is configured (or they fail), it falls back to the
 * simulated category baseline so the score is always available and the agent
 * never fabricates data silently.
 */
async function analyze(product) {
  const category = product.category || 'General';
  const base = CATEGORY_TRENDS[category] || { score: 50, note: 'No category baseline; neutral trend.' };

  let score = base.score;
  let note = base.note;
  let source = 'simulated';

  const trendEndpoints = [];
  if (config.trendApiUrl) trendEndpoints.push(config.trendApiUrl);
  if (config.googleTrendsUrl) trendEndpoints.push(config.googleTrendsUrl);

  for (const endpoint of trendEndpoints) {
    try {
      const query = new URL(endpoint);
      query.searchParams.set('q', product.name);
      query.searchParams.set('category', category);
      const res = await fetch(query.toString(), { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = Number(data.score ?? data.interest ?? data.value);
      if (Number.isFinite(raw)) {
        score = clamp(raw, 0, 100);
        source = 'live';
        if (data.note) note = data.note;
        break;
      }
    } catch (err) {
      console.warn('[trend-analyzer] live trend fetch failed, trying next source:', err.message);
    }
  }

  if (source === 'simulated' && config.newsApiKey) {
    try {
      const res = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(product.name)}` +
        `&language=en&sortBy=relevancy&pageSize=5&apiKey=${config.newsApiKey}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (res.ok) {
        const data = await res.json();
        const total = Number(data.totalResults) || 0;
        if (total > 0) {
          const bump = clamp((total / 250) * 18, -10, 12);
          score = clamp(score + bump, 0, 100);
          note = `${data.articles ? data.articles.length : 0} recent news stories mention this product (${total} total results).`;
          source = 'news';
        }
      }
    } catch (err) {
      console.warn('[trend-analyzer] news fetch failed, using simulated score:', err.message);
    }
  }

  return {
    score: clamp(score, 0, 100),
    note,
    source,
    keyword: product.name,
  };
}

module.exports = { analyze };
