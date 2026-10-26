// API Gateway: the single entry point for the microservices backend.
// Responsibilities: route requests to the right service, verify JWTs on
// protected routes, optional rate limiting, and clean errors when a service is down.
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { rateLimit } = require('express-rate-limit');
const { authenticate } = require('./shared/auth');

const PORT = Number(process.env.PORT || 8080);

const SERVICES = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  course: process.env.COURSE_SERVICE_URL || 'http://localhost:3002',
  results: process.env.RESULTS_SERVICE_URL || 'http://localhost:3003',
  payment: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3004',
};

// Path prefix -> service. Order does not matter; prefixes do not overlap.
const ROUTES = [
  { prefix: '/api/auth', service: 'auth' },
  { prefix: '/api/courses', service: 'course' },
  { prefix: '/api/registrations', service: 'course' },
  { prefix: '/api/results', service: 'results' },
  { prefix: '/api/invoices', service: 'payment' },
  { prefix: '/api/payments', service: 'payment' },
];

// Routes reachable without a token.
const PUBLIC = new Set(['POST /api/auth/register', 'POST /api/auth/login']);

const app = express();
app.disable('x-powered-by');

// CORS: lets the browser frontend (a different port) call the API.
// Answered before the token check, so browser preflight requests always succeed.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gateway' }));

// Reports which downstream services are reachable (useful during the fault test).
app.get('/health/services', async (req, res) => {
  const checks = await Promise.all(
    Object.entries(SERVICES).map(async ([name, url]) => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
        return [name, r.ok ? 'up' : `down (${r.status})`];
      } catch {
        return [name, 'down'];
      }
    })
  );
  res.json(Object.fromEntries(checks));
});

// Optional rate limiting. Keep it OFF for benchmark runs so the gateway
// does not reject load-test traffic the monolith would accept.
if (process.env.RATE_LIMIT_ENABLED === 'true') {
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 600),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    })
  );
}

// Verify the JWT here so unauthenticated traffic never reaches a service.
app.use('/api', (req, res, next) => {
  if (PUBLIC.has(`${req.method} ${req.baseUrl}${req.path}`)) return next();
  return authenticate(req, res, next);
});

for (const { prefix, service } of ROUTES) {
  app.use(
    createProxyMiddleware({
      target: SERVICES[service],
      pathFilter: (path) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
      proxyTimeout: Number(process.env.PROXY_TIMEOUT_MS || 10000),
      on: {
        error: (err, req, res) => {
          if (!res.headersSent) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
          }
          res.end(JSON.stringify({ error: `${service} service unavailable` }));
        },
      },
    })
  );
}

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

app.listen(PORT, () => console.log(`gateway listening on ${PORT}`, SERVICES));
