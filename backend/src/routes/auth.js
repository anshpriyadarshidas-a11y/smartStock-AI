const bcrypt = require('bcryptjs');
const express = require('express');
const { getStore } = require('../db/db');
const { signToken, authenticate } = require('../middleware/auth');
const { ok, fail, asyncHandler } = require('../utils/http');
const { requiredString } = require('../utils/validate');

const router = express.Router();

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = requiredString(req.body.email, { max: 120 });
    const password = requiredString(req.body.password, { max: 200 });
    if (!email || !password) return fail(res, 400, 'Email and password are required');

    const user = getStore().findOne(
      'users',
      (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
    );
    if (!user) return fail(res, 401, 'Invalid email or password');

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return fail(res, 401, 'Invalid email or password');

    const token = signToken(user);
    return ok(res, { token, user: publicUser(user) });
  })
);

router.get('/me', authenticate, (req, res) => ok(res, publicUser(req.user)));

module.exports = router;
