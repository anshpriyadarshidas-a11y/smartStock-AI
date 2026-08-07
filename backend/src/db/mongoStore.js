const path = require('path');
const { MongoClient } = require('mongodb');
const { Store, COLLECTIONS } = require('./store');
const config = require('../config');

/**
 * MongoDB-backed store that keeps the exact Store interface used by the
 * business logic (sync reads from an in-memory cache, async writes flushed
 * to MongoDB). This lets the agent/auth/route code work unchanged whether
 * the data layer is the local file store or MongoDB.
 */
class MongoStore extends Store {
  constructor(uri, options = {}) {
    super(path.join(config.dataDir, 'db.json'));
    this.uri = uri;
    this.dbName = options.dbName || config.mongoDbName;
    this.client = null;
    this.db = null;
    this.connected = false;
    this.connectTimeoutMS = options.connectTimeoutMS ?? 8000;
  }

  async init() {
    this.client = new MongoClient(this.uri, {
      serverSelectionTimeoutMS: this.connectTimeoutMS,
      connectTimeoutMS: this.connectTimeoutMS,
    });
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.connected = true;

    for (const name of COLLECTIONS) {
      const rows = await this.db.collection(name).find().toArray();
      this.data[name] = rows.map((r) => {
        const rest = { ...r };
        delete rest._id;
        return rest;
      });
    }
    this._persist();
    return this;
  }

  async close() {
    if (this.client) await this.client.close();
    this.connected = false;
  }

  async _flush(name) {
    if (!this.connected || !this.db) return;
    const collection = this.db.collection(name);
    await collection.deleteMany({});
    const rows = this.data[name].map(({ id, ...rest }) => ({ _id: id, id, ...rest }));
    if (rows.length > 0) await collection.insertMany(rows);
  }

  async seedFrom(data) {
    this.data = data;
    if (this.connected) {
      for (const name of COLLECTIONS) await this._flush(name);
    } else {
      this._persist();
    }
    return this;
  }

  async insert(name, doc) {
    const row = super.insert(name, doc);
    await this._flush(name);
    return row;
  }

  async insertMany(name, docs) {
    const rows = super.insertMany(name, docs);
    await this._flush(name);
    return rows;
  }

  async update(name, id, patch) {
    const row = super.update(name, id, patch);
    await this._flush(name);
    return row;
  }

  async remove(name, id) {
    const ok = super.remove(name, id);
    await this._flush(name);
    return ok;
  }
}

module.exports = { MongoStore };
