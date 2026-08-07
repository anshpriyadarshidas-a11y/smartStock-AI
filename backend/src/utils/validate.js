/**
 * Small validation helpers shared across routes. All helpers return the
 * cleaned value or null; routes combine them with `fail()`.
 */

function optionalString(value, { max = 200 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (s.length > max) return null;
  return s;
}

function requiredString(value, { max = 200 } = {}) {
  const s = optionalString(value, { max });
  return s === null || s === '' ? null : s;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function nonNegativeNumber(value) {
  const n = toNumber(value);
  if (Number.isNaN(n) || n < 0) return NaN;
  return n;
}

function positiveInt(value) {
  const n = toNumber(value);
  if (!Number.isInteger(n) || n <= 0) return NaN;
  return n;
}

function nonNegativeInt(value) {
  const n = toNumber(value);
  if (!Number.isInteger(n) || n < 0) return NaN;
  return n;
}

function positiveNumber(value) {
  const n = toNumber(value);
  if (Number.isNaN(n) || n <= 0) return NaN;
  return n;
}

module.exports = {
  optionalString,
  requiredString,
  toNumber,
  nonNegativeNumber,
  positiveInt,
  nonNegativeInt,
  positiveNumber,
};
