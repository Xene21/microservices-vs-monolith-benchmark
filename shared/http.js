// Small HTTP helpers shared by every service and the monolith.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Express 5 forwards rejected promises to this handler automatically.
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  // Unique-constraint violations (PostgreSQL 23505, MongoDB 11000)
  if (err.code === '23505' || err.code === 11000) return res.status(409).json({ error: 'Resource already exists' });
  // Foreign key points at a record that does not exist (monolith's shared schema)
  if (err.code === '23503') return res.status(404).json({ error: 'Referenced record not found' });
  // Malformed UUID or out-of-range value in PostgreSQL
  if (err.code === '22P02' || err.code === '22003') return res.status(400).json({ error: 'Invalid identifier or value' });
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === '');
  if (missing.length) throw new HttpError(400, `Missing field(s): ${missing.join(', ')}`);
}

function paging(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

async function retry(fn, { attempts = 30, delayMs = 2000, label = 'operation' } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`${label} failed (attempt ${i}/${attempts}): ${err.message}. Retrying...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return undefined;
}

module.exports = { HttpError, errorHandler, notFound, requireFields, paging, retry };
