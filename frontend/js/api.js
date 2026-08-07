/* SmartStock AI — API layer.
 *
 * Connects the dashboard to the Express backend. Two failure modes:
 *  - network error  -> graceful fallback to the bundled mock dataset (offline)
 *  - HTTP API error -> rethrown so the UI can show the real error message
 */
(function () {
  const API_BASE = window.SMARTSTOCK_API_BASE || 'http://localhost:4000';

  let token = localStorage.getItem('ssai_token') || null;
  let demoMode = false;
  let cache = null;

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function mockStore() {
    if (!cache) cache = clone(window.MockData);
    return cache;
  }

  async function request(path, opts = {}) {
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...opts
      });
    } catch (err) {
      const e = new Error('Cannot reach backend. Showing demo data.');
      e.network = true;
      throw e;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const e = new Error(body.error || `Request failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
    return res.json();
  }

  async function api(path, opts) {
    const json = await request(path, opts);
    if (json && json.success === false) throw new Error(json.error || 'Request failed');
    demoMode = false;
    return json && json.success !== undefined ? json.data : json;
  }

  async function withFallback(promise, fallback) {
    try {
      return await promise;
    } catch (err) {
      if (err.network) return fallback();
      throw err;
    }
  }

  const API = {
    get base() { return API_BASE; },
    get demo() { return demoMode; },
    setToken(t) { token = t; if (t) localStorage.setItem('ssai_token', t); else localStorage.removeItem('ssai_token'); },

    async login(email, password) {
      try {
        const data = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        token = data.token || null;
        if (token) localStorage.setItem('ssai_token', token);
        return { user: data.user, token, demo: false };
      } catch (err) {
        if (!err.network) throw err;
        const user = mockStore().users.find((u) => u.email === email) ||
          (email.includes('manager') ? mockStore().users[1] : email.includes('employee') ? mockStore().users[2] : mockStore().users[0]);
        token = 'demo-token';
        demoMode = true;
        return { user, token, demo: true, error: err.message };
      }
    },

    getProducts() {
      return withFallback(api('/products'), () => clone(mockStore().products));
    },

    getSuppliers() {
      return withFallback(api('/suppliers'), () => clone(mockStore().suppliers));
    },

    getSales() {
      return withFallback(api('/sales/history'), () => clone(mockStore().sales));
    },

    getForecast() {
      return withFallback(api('/forecast'), () => clone(mockStore().predictions));
    },

    getRecommendations(status) {
      const qs = status && status !== 'all' ? `?status=${status}` : '';
      return withFallback(api(`/recommendations${qs}`), () => clone(mockStore().predictions));
    },

    getAlerts() {
      return withFallback(api('/alerts'), () => clone(mockStore().alerts));
    },

    getAuditLogs() {
      return withFallback(api('/audit'), () => clone(mockStore().auditLogs));
    },

    createProduct(product) {
      return withFallback(api('/products', { method: 'POST', body: JSON.stringify(product) }), () => {
        const p = { ...clone(product), id: mockStore().products.length + 1 };
        mockStore().products.push(p);
        return p;
      });
    },

    updateProduct(id, patch) {
      return withFallback(api(`/products/${id}`, { method: 'PUT', body: JSON.stringify(patch) }), () => {
        const p = mockStore().products.find((x) => x.id === id);
        if (p) Object.assign(p, patch);
        return p ? clone(p) : {};
      });
    },

    deleteProduct(id) {
      return withFallback(api(`/products/${id}`, { method: 'DELETE' }), () => {
        mockStore().products = mockStore().products.filter((p) => p.id !== id);
        return { deleted: true, id };
      });
    },

    recordSale({ productId, quantity, date }) {
      return withFallback(api('/sales', {
        method: 'POST',
        body: JSON.stringify({ productId, quantity, date })
      }), () => {
        const store = mockStore();
        const product = store.products.find((p) => p.id === Number(productId));
        const sale = {
          id: Date.now(),
          productId: Number(productId),
          quantity: Number(quantity),
          date: date || new Date().toISOString().slice(0, 10),
          revenue: product ? Number((quantity * product.price).toFixed(2)) : 0
        };
        store.sales.push(sale);
        if (product) product.currentStock = Math.max(0, product.currentStock - Number(quantity));
        return { sale, product };
      });
    },

    runAnalysis() {
      return withFallback(api('/predict', { method: 'POST', body: JSON.stringify({}) }), () => clone(mockStore().predictions));
    },

    async approve({ id, decision, comment }) {
      try {
        return await api('/approve', {
          method: 'POST',
          body: JSON.stringify({ id, decision, comment })
        });
      } catch (err) {
        if (!err.network) throw err;
        const store = mockStore();
        const rec = store.predictions.find((r) => r.id === id || r.productId === id);
        if (rec) {
          rec.status = decision;
          rec.decisionComment = comment;
          const user = store.users.find((u) => u.role === 'manager') || store.users[0];
          store.auditLogs.unshift({
            id: Date.now(),
            productId: rec.productId,
            productName: rec.productName,
            prediction: `Demand ${rec.forecastDemand} in ${Math.ceil(rec.predictedDailyDemand * 10) || 16} days`,
            aiReason: rec.reason,
            managerDecision: decision,
            approvedBy: user.name,
            comment: comment || '',
            timestamp: new Date().toISOString().slice(0, 10),
            confidence: rec.confidence
          });
          if (decision === 'approved') {
            const product = store.products.find((p) => p.id === rec.productId);
            if (product) product.currentStock = product.currentStock + rec.recommendedOrderQty;
          }
        }
        return clone(rec || {});
      }
    }
  };

  window.SmartStockAPI = API;
})();
