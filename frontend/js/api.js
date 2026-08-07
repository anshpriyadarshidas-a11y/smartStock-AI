/* SmartStock AI — API layer with graceful offline fallback */
(function () {
  const API_BASE = window.SMARTSTOCK_API_BASE || 'http://localhost:4000';

  let token = null;
  let demoMode = false;
  let cache = null;

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function mockStore() {
    if (!cache) cache = clone(window.MockData);
    return cache;
  }

  async function request(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...opts
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  async function api(path, opts) {
    try {
      const json = await request(path, opts);
      if (json && json.success === false) throw new Error(json.error || 'Request failed');
      demoMode = false;
      return json && json.success !== undefined ? json.data : json;
    } catch (err) {
      demoMode = true;
      throw err;
    }
  }

  const API = {
    get base() { return API_BASE; },
    get demo() { return demoMode; },
    setToken(t) { token = t; },

    async login(email, password) {
      try {
        const data = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        token = data.token || null;
        return { user: data.user || data, token, demo: false };
      } catch (err) {
        const user = mockStore().users.find((u) => u.email === email) ||
          (email.includes('manager') ? mockStore().users[1] : email.includes('employee') ? mockStore().users[2] : mockStore().users[0]);
        token = 'demo-token';
        demoMode = true;
        return { user, token, demo: true, error: err.message };
      }
    },

    async getProducts() {
      try {
        return await api('/products');
      } catch (err) {
        return clone(mockStore().products);
      }
    },

    async getSuppliers() {
      try {
        return await api('/suppliers');
      } catch (err) {
        return clone(mockStore().suppliers);
      }
    },

    async getSales() {
      try {
        return await api('/sales/history');
      } catch (err) {
        return clone(mockStore().sales);
      }
    },

    async getForecast() {
      try {
        return await api('/forecast');
      } catch (err) {
        return clone(mockStore().predictions);
      }
    },

    async getRecommendations() {
      try {
        return await api('/recommendations');
      } catch (err) {
        return clone(mockStore().predictions);
      }
    },

    async getAlerts() {
      try {
        return await api('/alerts');
      } catch (err) {
        return clone(mockStore().alerts);
      }
    },

    async getAuditLogs() {
      try {
        return await api('/audit');
      } catch (err) {
        return clone(mockStore().auditLogs);
      }
    },

    async runAnalysis() {
      try {
        return await api('/predict', { method: 'POST', body: JSON.stringify({}) });
      } catch (err) {
        return clone(mockStore().predictions);
      }
    },

    async approve({ id, decision, comment }) {
      try {
        return await api('/approve', {
          method: 'POST',
          body: JSON.stringify({ id, decision, comment })
        });
      } catch (err) {
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
