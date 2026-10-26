// Monolith: the same four functional areas as the microservices backend,
// built as modules inside one Express application with one shared database.
// It exposes exactly the same API contract, so the frontend and the load
// tests can target either backend without changes.
const express = require('express');
const { pool, initDb } = require('./db');
const { errorHandler, notFound, retry } = require('./shared/http');

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');

// CORS: lets the browser frontend (a different port) call the API.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
app.use(express.json());

app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', service: 'monolith' });
});

app.use('/api/auth', require('./modules/auth'));
app.use('/api', require('./modules/courses'));
app.use('/api/results', require('./modules/results'));
app.use('/api', require('./modules/payments'));

app.use(notFound);
app.use(errorHandler);

retry(initDb, { label: 'monolith-db connection' }).then(() => {
  app.listen(PORT, () => console.log(`monolith listening on ${PORT}`));
});
