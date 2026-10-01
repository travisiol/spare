# Admin setup

The admin area is at `/admin`. Access is decided on the server on every request and every action (`currentAdmin()` in `src/server/session.ts`).

## Two ways in

1. **Admin wallet.** Put one or more addresses in `ADMIN_WALLETS` (comma-separated). Sign in on the site with that wallet; `/admin` then opens. Only a live wallet session counts — a demo account can never be an admin.
2. **Operator token.** Set `ADMIN_TOKEN` to a random value of at least 16 characters (`openssl rand -hex 24`). `/admin` shows a sign-in form; the token is compared in constant time and exchanged for an 8-hour session stored hashed in `admin_sessions`. Use this for local review or where no admin wallet exists. Rotate the token to cut off future sign-ins; revoke existing sessions by deleting their rows.

With neither variable set, nobody can reach the admin area.

## What it shows

Switch between **demo records** and **live records** at the top; they are never listed together.

- **Provider configuration** — each adapter, whether it is connected, and what is missing.
- **Health** — accounts, queued and dead jobs, connections by provider and status, transaction ingestion outcomes (applied, duplicate, stale, ignored) with the last time each was seen.
- **Fees, minimums and instruments** — current policy and which instruments have an execution route.
- **Reconciliation exceptions** — the ledger compared with batches, orders and settlements: unbalanced journals, held cash that no batch accounts for, tokens owed that no order accounts for, attempts unresolved for more than 10 minutes, and funded batches whose order failed.
- **Dead jobs**, **weekly batches**, **funding attempts**, **orders**, **settlements**, **audit history**.

## What an operator can do

| Action | Effect | Safe to repeat |
| --- | --- | --- |
| Run a dead job again | Re-queues it. Handlers check state first, so a finished step does nothing. | Yes — only a dead job changes |
| Retry order | For a funded batch whose order failed: places a new order with the funds already collected (up to 3 orders per batch). | Yes — refused unless the last order definitively failed |
| Refund | For the same case: returns the collected amount to the user. | Yes — refused once a refund is under way |

Every action is written to the audit log with the admin's identity.

## What an operator cannot do

- Approve a batch, or change its amount or company.
- Start or retry a charge. Funding only ever starts from the user's own approval, and a funding retry can only be requested by the batch's owner. The funding job itself refuses to run without an approval record.
- See or act on demo and live records in one view.

## Local review

```bash
npm run demo:seed   # with the dev server stopped (embedded database)
npm run dev
```

Then open http://localhost:3658/admin and sign in with the `ADMIN_TOKEN` from `.env.local`. The seeded account has one completed week, one week whose order failed (visible as a reconciliation exception with **Retry order** and **Refund**), and one open week.
