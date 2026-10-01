import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ActionForm, SubmitButton } from "@/components/app/forms";
import { Card, StatusPill } from "@/components/app/ui";
import { adminOverview } from "@/core/admin";
import { formatTokenQty, formatUsd } from "@/core/money";
import { BATCH_STATUS } from "@/lib/status";
import { adminRefundAction, adminRequeueJobAction, adminRetryOrderAction, adminSignInAction, adminSignOutAction } from "@/server/actions";
import { getRuntime } from "@/server/runtime";
import { currentAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

const short = (id: string | null) => (id ? (id.length > 14 ? `${id.slice(0, 8)}…` : id) : "—");
const time = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");

export default async function Admin({ searchParams }: PageProps<"/admin">) {
  const admin = await currentAdmin();

  if (!admin) {
    const tokenConfigured = (process.env.ADMIN_TOKEN ?? "").length >= 16;
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-16">
        <Logo className="text-[2rem]" />
        <h1 className="display mt-8 text-[2.4rem]">Admin</h1>
        <p className="mt-2 text-muted">
          Access is checked on the server. Sign in with a wallet listed in <code className="font-mono text-sm">ADMIN_WALLETS</code>, or with the operator token.
        </p>
        {tokenConfigured ? (
          <ActionForm action={adminSignInAction} className="mt-6">
            <label htmlFor="token" className="block text-sm font-semibold">
              Operator token
            </label>
            <input id="token" name="token" type="password" autoComplete="off" required className="field mt-2" />
            <div className="mt-4">
              <SubmitButton className="btn btn-solid w-full">Sign in</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="mt-6 rounded-2xl border border-line bg-surface p-4 text-[0.95rem] text-muted">
            No operator token is configured. Set <code className="font-mono text-sm">ADMIN_TOKEN</code> (16+ characters) or <code className="font-mono text-sm">ADMIN_WALLETS</code> on the server.
          </p>
        )}
        <Link href="/" className="link mt-6 inline-block text-sm font-medium">
          Back to the site
        </Link>
      </main>
    );
  }

  const env = (await searchParams).env === "live" ? "live" : "demo";
  const { db, resolve } = await getRuntime();
  const a = await adminOverview(db, resolve, env, new Date());
  const th = "eyebrow whitespace-nowrap pb-2 pr-4 text-left font-semibold";
  const td = "num whitespace-nowrap border-t border-line py-2.5 pr-4 align-top text-sm";

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-5 py-6 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Logo className="text-[1.8rem]" />
          <span className="pill text-muted">Admin</span>
        </div>
        <div className="flex items-center gap-2">
          {(["demo", "live"] as const).map((e) => (
            <Link
              key={e}
              href={`/admin?env=${e}`}
              aria-current={env === e ? "true" : undefined}
              className={`inline-flex h-10 items-center rounded-full border-[1.5px] px-4 text-sm font-medium capitalize ${env === e ? "border-cobalt bg-cobalt text-ice" : "border-line text-muted"}`}
            >
              {e} records
            </Link>
          ))}
          <form action={adminSignOutAction}>
            <button type="submit" className="link ml-2 text-sm font-medium">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <p className="mt-3 text-sm text-muted">
        Signed in as {admin.id}. Demo and live records are never mixed: this page shows <strong className="text-cobalt">{env}</strong> records only. Operators cannot approve a week or start a charge.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-[1.15rem] font-semibold">Provider configuration</h2>
          <ul className="mt-3 divide-y divide-line">
            {a.providers.map((p) => (
              <li key={p.role} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {p.role} <span className="font-normal text-muted">· {p.label}</span>
                  </span>
                  {p.available ? <StatusPill tone="good">Connected</StatusPill> : <StatusPill tone="warn">Not connected</StatusPill>}
                </div>
                {p.reason && <p className="mt-1 text-sm text-muted">{p.reason}</p>}
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="text-[1.15rem] font-semibold">Health</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Stat label="Accounts" value={a.userCount} />
              <Stat label="Jobs queued" value={a.queuedJobs} />
              <Stat label="Dead jobs" value={a.deadJobs.length} warn={a.deadJobs.length > 0} />
              <Stat label="Exceptions" value={a.exceptions.length} warn={a.exceptions.length > 0} />
            </dl>
            <h3 className="eyebrow mt-5">Connections</h3>
            {a.connections.length === 0 ? (
              <p className="mt-1 text-sm text-muted">None.</p>
            ) : (
              <ul className="mt-1 text-sm">
                {a.connections.map((c) => (
                  <li key={`${c.kind}-${c.provider}-${c.status}`} className="flex justify-between py-1">
                    <span>
                      {c.kind === "funding" ? "Funding" : "Transaction data"} · {c.provider} · {c.status}
                    </span>
                    <span className="num font-medium">{c.n}</span>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="eyebrow mt-4">Transaction ingestion</h3>
            {a.events.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No events received.</p>
            ) : (
              <ul className="mt-1 text-sm">
                {a.events.map((e) => (
                  <li key={e.outcome} className="flex justify-between py-1">
                    <span>
                      {e.outcome} <span className="text-muted">· last {time(e.last)} UTC</span>
                    </span>
                    <span className="num font-medium">{e.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-[1.15rem] font-semibold">Fees, minimums and instruments</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Stat label="Fee" value={`${(a.policy.feeBps / 100).toFixed(2)}%`} />
              <Stat label="Minimum batch" value={formatUsd(a.policy.minOrderCents)} />
              <Stat label="Approval window" value={`${a.policy.approvalWindowHours} h`} />
              <Stat label="Order attempts" value={a.policy.maxOrderAttempts} />
            </dl>
            <ul className="mt-4 divide-y divide-line text-sm">
              {a.instruments.map((i) => (
                <li key={i.symbol} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-semibold">{i.symbol}</span> <span className="font-mono text-xs text-muted">{i.address}</span>
                  </span>
                  <span className={i.route ? "font-medium" : "text-muted"}>{i.route ? "Route available" : "No execution route"}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Section title="Reconciliation exceptions" empty={a.exceptions.length === 0 ? "The ledger agrees with batches, orders and settlements." : null}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Kind</th>
              <th className={th}>Subject</th>
              <th className={th}>Detail</th>
              <th className={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {a.exceptions.map((e, i) => (
              <tr key={i}>
                <td className={`${td} font-semibold text-ember`}>{e.kind}</td>
                <td className={td}>{short(e.subject)}</td>
                <td className={`${td} !whitespace-normal`}>{e.detail}</td>
                <td className={td}>
                  {e.kind === "funds_held_after_failed_order" && (
                    <div className="flex gap-2">
                      <ActionForm action={adminRetryOrderAction} hidden={{ batchId: e.subject }}>
                        <SubmitButton className="link font-medium">Retry order</SubmitButton>
                      </ActionForm>
                      <ActionForm action={adminRefundAction} hidden={{ batchId: e.subject }}>
                        <SubmitButton className="link font-medium">Refund</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Dead jobs" empty={a.deadJobs.length === 0 ? "No job has run out of retries." : null}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Job</th>
              <th className={th}>Key</th>
              <th className={th}>Last error</th>
              <th className={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {a.deadJobs.map((j) => (
              <tr key={j.id}>
                <td className={td}>{j.kind}</td>
                <td className={td}>{short(j.key)}</td>
                <td className={`${td} !whitespace-normal`}>{j.lastError}</td>
                <td className={td}>
                  <ActionForm action={adminRequeueJobAction} hidden={{ jobId: j.id }}>
                    <SubmitButton className="link font-medium">Run again</SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Weekly batches" empty={a.batches.length === 0 ? "No batches yet." : null}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Week</th>
              <th className={th}>Account</th>
              <th className={th}>Status</th>
              <th className={th}>Round-ups</th>
              <th className={th}>Authorized</th>
              <th className={th}>Company</th>
              <th className={th}>Updated (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {a.batches.map(({ batch: b, wallet }) => (
              <tr key={b.id}>
                <td className={td}>{b.weekStart}</td>
                <td className={td}>{wallet ? short(wallet) : short(b.userId)}</td>
                <td className={td}>
                  <StatusPill tone={BATCH_STATUS[b.status].tone}>{BATCH_STATUS[b.status].label}</StatusPill>
                </td>
                <td className={td}>{b.totalCents !== null ? formatUsd(b.totalCents) : "—"}</td>
                <td className={td}>{b.authorizedCents !== null ? formatUsd(b.authorizedCents) : "—"}</td>
                <td className={td}>{b.instrumentSymbol ?? "—"}</td>
                <td className={td}>{time(b.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="grid gap-x-6 lg:grid-cols-3">
        <Section title="Funding attempts" empty={a.funding.length === 0 ? "None." : null}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Batch</th>
                <th className={th}>Amount</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {a.funding.map((f) => (
                <tr key={f.id} title={f.error ?? f.providerRef ?? ""}>
                  <td className={td}>{short(f.batchId)}</td>
                  <td className={td}>{formatUsd(f.amountCents)}</td>
                  <td className={td}>{f.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Orders" empty={a.orders.length === 0 ? "None." : null}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Batch</th>
                <th className={th}>Notional</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {a.orders.map((o) => (
                <tr key={o.id} title={o.error ?? o.providerRef ?? ""}>
                  <td className={td}>{short(o.batchId)}</td>
                  <td className={td}>
                    {formatUsd(o.notionalCents)} {o.instrumentSymbol}
                  </td>
                  <td className={td}>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Settlements" empty={a.settlements.length === 0 ? "None." : null}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Batch</th>
                <th className={th}>Quantity</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {a.settlements.map((s) => (
                <tr key={s.id} title={s.error ?? s.providerRef ?? ""}>
                  <td className={td}>{short(s.batchId)}</td>
                  <td className={td}>
                    {formatTokenQty(s.qty, 18)} {s.instrumentSymbol}
                  </td>
                  <td className={td}>{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <Section title="Audit history" empty={a.audit.length === 0 ? "Nothing recorded yet." : null}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>When (UTC)</th>
              <th className={th}>Actor</th>
              <th className={th}>Action</th>
              <th className={th}>Subject</th>
              <th className={th}>Data</th>
            </tr>
          </thead>
          <tbody>
            {a.audit.map((e) => (
              <tr key={e.id}>
                <td className={td}>{time(e.createdAt)}</td>
                <td className={td}>
                  {e.actorType}
                  {e.actorId ? ` ${short(e.actorId)}` : ""}
                </td>
                <td className={`${td} font-medium`}>{e.action}</td>
                <td className={td}>{e.subjectType ? `${e.subjectType} ${short(e.subjectId)}` : "—"}</td>
                <td className={`${td} !whitespace-normal font-mono text-xs text-muted`}>{e.data ? JSON.stringify(e.data) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </main>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`num text-[1.5rem] font-bold leading-tight ${warn ? "text-ember" : ""}`}>{value}</dd>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string | null; children: React.ReactNode }) {
  return (
    <section className="card mt-6 p-5 sm:p-6">
      <h2 className="text-[1.15rem] font-semibold">{title}</h2>
      {empty ? <p className="mt-2 text-sm text-muted">{empty}</p> : <div className="mt-3 overflow-x-auto">{children}</div>}
    </section>
  );
}
