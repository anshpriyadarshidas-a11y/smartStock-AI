const fs = require('fs');
const path = require('path');
const config = require('../config');

const COLLECTIONS = [
  'users',
  'suppliers',
  'products',
  'sales',
  'predictions',
  'auditLogs',
  'alerts',
  'notifications',
];

const DEFAULT_DATA = () => Object.fromEntries(COLLECTIONS.map((name) => [name, []]));

class Store {
  constructor(filePath = path.join(config.dataDir, 'db.json')) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        const base = DEFAULT_DATA();
        for (const name of COLLECTIONS) base[name] = Array.isArray(raw[name]) ? raw[name] : [];
        return base;
      } catch (err) {
        console.warn('[store] corrupted db.json, starting fresh:', err.message);
      }
    }
    return DEFAULT_DATA();
  }

  _persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const content = JSON.stringify(this.data, null, 2);
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, content, 'utf8');
      try {
        fs.renameSync(tmp, this.filePath);
      } catch (err) {
        fs.copyFileSync(tmp, this.filePath);
        try {
          fs.unlinkSync(tmp);
        } catch (cleanupErr) {
          console.warn('[store] cleanup temp file failed:', cleanupErr.message);
        }
      }
    } catch (err) {
      fs.writeFileSync(this.filePath, content, 'utf8');
    }
  }

  _nextId(name) {
    const rows = this.data[name];
    if (rows.length === 0) return 1;
    return Math.max(...rows.map((r) => r.id)) + 1;
  }

  col(name) {
    if (!COLLECTIONS.includes(name)) throw new Error(`Unknown collection: ${name}`);
    return this.data[name];
  }

  insert(name, doc) {
    const row = { id: this._nextId(name), ...doc, createdAt: doc.createdAt || new Date().toISOString() };
    this.data[name].push(row);
    this._persist();
    return row;
  }

  insertMany(name, docs) {
    const rows = docs.map((doc) => ({
      id: this._nextId(name),
      ...doc,
      createdAt: doc.createdAt || new Date().toISOString(),
    }));
    this.data[name].push(...rows);
    this._persist();
    return rows;
  }

  find(name, predicate = () => true) {
    return this.data[name].filter(predicate);
  }

  findOne(name, predicate = () => true) {
    return this.data[name].find(predicate) || null;
  }

  findById(name, id) {
    const key = Number(id);
    return this.data[name].find((r) => r.id === key) || null;
  }

  update(name, id, patch) {
    const idx = this.data[name].findIndex((r) => r.id === Number(id));
    if (idx === -1) return null;
    this.data[name][idx] = { ...this.data[name][idx], ...patch, updatedAt: new Date().toISOString() };
    this._persist();
    return this.data[name][idx];
  }

  remove(name, id) {
    const idx = this.data[name].findIndex((r) => r.id === Number(id));
    if (idx === -1) return false;
    this.data[name].splice(idx, 1);
    this._persist();
    return true;
  }

  count(name) {
    return this.data[name].length;
  }
}

module.exports = { Store, COLLECTIONS };
