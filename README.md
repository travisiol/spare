# SPARE

**Keep the change. Own the company.** SPARE rounds each eligible purchase up to the next dollar, adds the differences up over a week, and — only after the user approves that week — uses the amount to buy one tokenized stock on Robinhood Chain.

This repository is the whole application: marketing site, onboarding, user app, backend, provider boundaries and admin.

## Run it locally

Requires Node 22.13+ (built on Node 24).

```bash
npm install
npm run dev
```

Open http://localhost:3658 and choose **Start rounding up → Explore the demo**. No configuration is needed: without `DATABASE_URL` the app runs an embedded PostgreSQL (PGlite) in `./data/pg` and applies the migrations in `drizzle/` on start.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3658, with the background worker inside it |
| `npm test` | 29 tests against an in-memory Postgres: arithmetic, ingestion, batches, pipeline, isolation, sign-in |
| `npm run typecheck` / `npm run lint` / `npm run build` | Static checks and production build |
| `node scripts/verify-api.mjs` | 23 HTTP checks against a running server (auth, webhook signatures, admin, cron). Needs `ADMIN_TOKEN`, `CRON_SECRET` and `SPARE_TXN_WEBHOOK_SECRET` in `.env.local` |
| `node scripts/e2e-shots.mjs` | Walks the demo in headless Chrome and saves desktop + phone screenshots to `shots/` |
| `npm run verify:instruments` | Re-checks the chain id and every token address against the issuer's list and the chain |
| `npm run demo:seed` | Adds one demo account with history for the admin screens (stop the dev server first when using the embedded database) |
| `npm run db:generate` / `npm run db:migrate` | Create a migration from `src/db/schema.ts` / apply migrations |
| `npm run worker` | Standalone worker for PostgreSQL deployments |

Configuration is in [.env.example](.env.example). Provider setup is in [docs/PROVIDERS.md](docs/PROVIDERS.md), admin setup in [docs/ADMIN.md](docs/ADMIN.md), and what works versus what is blocked in [docs/STATUS.md](docs/STATUS.md).

## The demo

The demo is a real account in the real database with `env = "demo"`. It uses the same ingestion, batching, approval, ledger and job code as a live account; only the five provider adapters are simulated (`src/core/adapters/demo.ts`). It is labelled "Demo" on every screen, its references are prefixed `demo:`, and it never produces a transaction hash.

In the demo you can connect the demo card, pick a company, see example purchases (three round-ups adding up to $1.42, plus an exact-dollar purchase, a transfer, a EUR purchase and a pending one), close the week early, review and approve it, and watch funding → order → delivery. The **Demo controls** panel on the overview also delivers more purchases, refunds one, and makes the next funding, order or delivery fail so the retry and refund paths can be seen.

## How it is built

```
src/config/     network, instrument catalogue, policy (fees, minimums, cap range) — the single sources
src/db/         Drizzle schema + client (PostgreSQL, or embedded PGlite locally)
src/core/       all business rules, framework-free and tested directly
  money.ts        integer-cent arithmetic: roundUp = (100 - cents % 100) % 100
  weeks.ts        timezone-aware Monday–Sunday weeks
  ingest.ts       provider events → one canonical purchase + one round-up entry
  batches.ts      weekly cutoff, freeze, approval, decline, expiry, carry-forward, retries
  pipeline.ts     funding → order → settlement → refund, one durable job per step
  ledger.ts       double-entry ledger; balances are derived from it
  jobs.ts         durable job queue in Postgres (leases, backoff, dead-letter)
  auth.ts         Sign-In with Ethereum, sessions, admin
  adapters/       provider boundaries: demo.ts (simulated) and live.ts (real or "not connected")
  admin.ts        operator read models and reconciliation
src/server/     Next.js bindings: session cookies, server actions, worker bootstrap
src/app/        routes: /, /app/*, /admin, /api/*
drizzle/        SQL migrations
tests/          node:test suites
```

Rules worth knowing before changing anything:

- **Four separate permissions.** Wallet identity, transaction data, funding and execution/settlement are separate adapters and separate connections. Reading purchases never authorizes a charge.
- **Tracked is not held.** Round-ups are rows in `roundup_entries`, not money. Nothing enters the ledger until a funding attempt succeeds.
- **Idempotency is in the database.** Unique keys on provider event ids, canonical transaction ids, one approval per batch, one live funding attempt per batch, one live order per batch, one settlement per order, and one line per ledger journal key.
- **Approval binds to a snapshot.** A batch closes at the cutoff; later purchases go to a later batch. The approval carries the hash of what the user reviewed and is refused if the batch changed (a refund landed) in between.
- **Reconcile before retry.** Each step stores its attempt, then asks the provider about that idempotency key before submitting anything. An unknown outcome is "uncertain", never a second charge.
- **Refunds after approval change nothing.** They are recorded in `adjustments` (`record_only` policy): no sale, no extra charge.
- **Demo and live never mix.** Every provider-facing row carries its `env`; `createAdapterResolver` is the only place an env maps to providers; demo adapters refuse to act for a live account.

## Production requirements

See [docs/STATUS.md](docs/STATUS.md) for the full list. In short: PostgreSQL (`DATABASE_URL`), `SPARE_APP_DOMAIN`, HTTPS, an admin identity, a long-lived worker or a cron on `/api/internal/tick`, and — before any live money action can be enabled — a transaction-data provider, a funding provider, a compliant execution and settlement route for the stock tokens, and legal review of eligibility (the issuer excludes US persons and other jurisdictions).

Nothing in this repository has been deployed, and no real funds have been moved.
