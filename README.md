# Student Portal Benchmark: Microservices vs Monolith

Backend implementation for the final-year project *Design and Implementation of a Containerized Microservices Architecture: A Comparative Performance Evaluation Against a Monolithic System*.

The same university student portal is built twice:

| | Microservices | Monolith |
|---|---|---|
| Entry point | API Gateway, `http://localhost:8080` | Monolith, `http://localhost:3000` |
| Application | 4 services + gateway (Node.js, Express) | 1 Express app with 4 modules |
| Data | Database per service: Auth and Results on PostgreSQL, Course Registration and Fee Payment on MongoDB | One shared PostgreSQL database |
| Compose file | `docker-compose.microservices.yml` | `docker-compose.monolith.yml` |

Both expose **the same API contract** (same paths, request bodies, response shapes and status codes), so the React frontend and the load tests can target either one by changing only the base URL.

## Project structure

```
gateway/                    API Gateway: routing, JWT check, optional rate limit
services/auth-service/      registration, login, users           (PostgreSQL)
services/course-service/    course catalogue, registration       (MongoDB)
services/results-service/   upload and view results              (PostgreSQL)
services/payment-service/   invoices and fee payment             (MongoDB)
monolith/                   all four modules in one app          (PostgreSQL)
mock-payment-gateway/       stands in for an external payment provider
shared/                     code used by every service and the monolith
scripts/smoke-test.js       end-to-end functional test (34 checks)
scripts/seed.js             loads identical test data into either backend
scripts/sync-shared.js      copies shared/ into each service
```

`shared/` holds the JWT check, error handling, grading scale, unit cap and payment client. It is copied into each service (`src/shared/`) so both architectures run identical business rules and each Docker image builds on its own. After editing anything in `shared/`, run `node scripts/sync-shared.js`.

## Requirements

- Docker Desktop (or Docker Engine with the Compose plugin)
- Node.js 20 or newer (only for the scripts)

## Run the microservices backend

```bash
cp .env.example .env              # then edit the secrets
docker compose -f docker-compose.microservices.yml up -d --build
docker compose -f docker-compose.microservices.yml ps      # wait until all are healthy
curl http://localhost:8080/health/services                 # {"auth":"up","course":"up",...}
```

## Run the monolith

```bash
docker compose -f docker-compose.monolith.yml up -d --build
curl http://localhost:3000/health
```

Run only one backend at a time when benchmarking, so they do not compete for CPU and memory. Stop one with `docker compose -f <file> down`. Add `-v` to also wipe its data.

## Check that both backends behave the same

```bash
node scripts/smoke-test.js http://localhost:8080   # microservices
node scripts/smoke-test.js http://localhost:3000   # monolith
```

The smoke test registers users, checks access control, creates courses, tests the prerequisite and unit-cap rules, uploads and edits results, generates an invoice, pays it, and blocks a second payment. Each run uses fresh data, so it can be run repeatedly. Both backends should report `34 passed, 0 failed`.

## Load test data

```bash
node scripts/seed.js http://localhost:8080 --students 500
node scripts/seed.js http://localhost:3000 --students 500
```

This creates an admin (`admin@portal.test`), a lecturer (`lecturer@portal.test`), 12 courses, the students, first-semester results and one pending invoice per student. Every account's password is `Password123`. It writes `scripts/output/students-<host>-<port>.csv` (email, password, studentId, invoiceId) for JMeter to read. It is safe to re-run.

## Fault-isolation test

Stop one service while the rest keep running:

```bash
docker compose -f docker-compose.microservices.yml stop results-service
curl http://localhost:8080/health/services     # results: "down", others "up"
# /api/results/* now returns 503; courses, auth and payments still work.
# Registering for a course WITH prerequisites returns 503 (it needs the Results Service);
# courses without prerequisites still register.
docker compose -f docker-compose.microservices.yml start results-service
```

The monolith equivalent is stopping the single `monolith` container, which takes every function down at once.

## API reference

All routes except register and login need `Authorization: Bearer <token>`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | public | Create an account. Students need `matricNumber`; lecturer and admin need `adminKey` |
| POST | `/api/auth/login` | public | Returns `{ token, user }` |
| GET | `/api/auth/me` | any | Current user |
| GET | `/api/auth/users?role=student` | admin, lecturer | List users |
| GET | `/api/courses` | any | Course catalogue (`?semester=first`) |
| GET | `/api/courses/:code` | any | One course |
| POST | `/api/courses` | admin | Create a course `{ code, title, unitLoad, semester, prerequisites[] }` |
| PUT | `/api/courses/:code` | admin | Update a course |
| POST | `/api/registrations` | student | Register `{ courseCodes: [...] }`. Checks prerequisites and the 24-unit cap |
| GET | `/api/registrations/me` | student | Own registrations |
| GET | `/api/registrations?courseCode=` | admin, lecturer | Enrolment report |
| GET | `/api/results/me` | student | Own results |
| GET | `/api/results?courseCode=` | lecturer, admin | Results for a course |
| POST | `/api/results` | lecturer, admin | Upload `{ studentId, courseCode, score }`. Grade is computed (A–F) |
| PUT | `/api/results/:id` | lecturer, admin | Edit a score |
| POST | `/api/invoices` | admin | Generate `{ studentId, amount, description }` |
| GET | `/api/invoices/me` | student | Own invoices |
| GET | `/api/invoices?status=` | admin | All invoices |
| POST | `/api/payments` | student | Pay `{ invoiceId }`, returns a receipt |
| GET | `/api/payments/me` | student | Payment history |

Errors always look like `{ "error": "message" }`, with 400, 401, 403, 404, 409, 422, 502 or 503.

## Pointing the React frontend at either backend

```
VITE_API_BASE_URL=http://localhost:8080   # microservices
VITE_API_BASE_URL=http://localhost:3000   # monolith
```

## Design notes (for Chapter 4)

- **Authentication.** The Auth Service issues a JWT signed with `JWT_SECRET`. The gateway verifies the signature on every protected request before forwarding, and each service verifies it again. Verification is local (no call to the Auth Service per request), so the Auth Service is not a bottleneck and stopping it does not lock out users who already hold a token.
- **Inter-service call.** The Course Registration Service calls the Results Service (`/internal/results/:id/passed`, protected by `INTERNAL_API_KEY` and not exposed by the gateway) to check prerequisites. The monolith does the same check with a direct SQL query.
- **Payment safety.** An invoice is moved from `pending` to `processing` before the gateway is charged, so it cannot be paid twice even under concurrent requests. A failed or declined charge returns it to `pending`.
- **Same business rules.** Grading (70+ A, 60–69 B, 50–59 C, 45–49 D, 40–44 E, below 40 F), the 24-unit cap and bcrypt cost come from `shared/`, so both backends do identical work per request.
- **Fairness settings for benchmarking.** Keep `RATE_LIMIT_ENABLED=false`, use the same `MOCK_LATENCY_MS` and `BCRYPT_ROUNDS` for both runs, run one backend at a time on the same machine, and record the machine's CPU and RAM. The monolith runs as one Node.js process while the microservices backend runs six, which is part of what the study measures.
- **Referential checks.** The monolith's shared schema enforces foreign keys, so an invoice or result for a non-existent student returns 404. The microservices have separate databases and cannot enforce this across services without an extra call. This is a known trade-off of database-per-service.
