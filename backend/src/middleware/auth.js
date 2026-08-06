const jwt = require('jsonwebtoken');
const config = require('../config');
const { getStore } = require('../db/db');

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpires,
  });
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = getStore().findById('users', payload.id);
    if (!user) return res.status(401).json({ success: false, error: 'User no longer exists' });
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    return next();
  };
}

module.exports = { signToken, authenticate, requireRole };
