// JWT verification and role checks.
// The same file is copied into every service and the monolith so that
// both architectures enforce access control in exactly the same way.
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role, matricNumber: payload.matricNumber };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) =>
    roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Forbidden for this role' });
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, matricNumber: user.matricNumber || null },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
  );
}

module.exports = { authenticate, requireRole, signToken };
