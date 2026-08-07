/**
 * Consistent JSON response envelope: { success: true, data } / { success: false, error }.
 */
function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, status, error) {
  return res.status(status).json({ success: false, error });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { ok, fail, asyncHandler };
