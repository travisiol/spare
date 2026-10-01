import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, AutoRefresh, SubmitButton } from "@/components/app/forms";
import { PurchaseList } from "@/components/app/PurchaseList";
import { Card, EmptyState, formatDateTime, Notice, PageTitle, Row, StatusPill } from "@/components/app/ui";
import { instrumentBySymbol } from "@/config/instruments";
import { POLICY } from "@/config/policy";
import { onboardingState } from "@/core/accounts";
import { formatTokenQty, formatUsd } from "@/core/money";
import { getReview, IN_FLIGHT, listBatches, reviewTarget } from "@/core/queries";
import { formatWeekRange } from "@/core/weeks";
import { BATCH_STATUS, PIPELINE } from "@/lib/status";
import { approveBatchAction, declineBatchAction, requestRefundAction, retryFundingAction, retryOrderAction } from "@/server/actions";
import { getRuntime } from "@/server/runtime";
import { requireUser } from "@/server/session";

export default async function WeeklyReview({ searchParams }: PageProps<"/app/weekly-review">) {
  const user = await requireUser();
  const { db, resolve } = await getRuntime();
  if (!(await onboardingState(db, user.id)).complete) redirect("/app/onboarding");
  const requested = (await searchParams).batch;
  const target = typeof requested === "string" ? { id: requested } : await reviewTarget(db, user.id);
  const review = target ? await getReview(db, resolve, user, target.id) : null;
  const history = (await listBatches(db, user.id)).filter((b) => b.status !== "tracking");

  if (!review) {
    return (
      <>
        <PageTitle title="Weekly review">Once a week you see one fixed amount and decide whether to invest it.</PageTitle>
        <EmptyState title="No week to review yet">Your current week is still open. It closes on Sunday night in your timezone, and then it will be here for your decision.</EmptyState>
      </>
    );
  }

  const { batch } = review;
  const status = BATCH_STATUS[batch.status];
  const instrument = instrumentBySymbol(batch.instrumentSymbol);
  const demo = user.env === "demo";
  const approvable = batch.status === "ready_for_approval";
  const order = review.orders.at(-1);
  const failedFunding = review.fundingAttempts.filter((a) => a.status === "failed").at(-1);

  return (
    <>
      <AutoRefresh active={IN_FLIGHT.includes(batch.status)} />
      <PageTitle title={`Week of ${formatWeekRange(batch.weekStart)}`}>
        <span className="mr-2 inline-block align-middle">
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </span>
        {status.detail}
      </PageTitle>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        <div className="space-y-6">
          {batch.totalCents !== null && batch.status !== "empty" && batch.status !== "carried_forward" && <Progress status={batch.status} />}

          {batch.status === "funding_failed" && (
            <Notice tone="warn" title="The charge did not go through">
              {failedFunding?.error ?? batch.failureReason} Nothing was collected. Trying again uses the same approved amount of {formatUsd(batch.authorizedCents ?? 0)}; it can never be collected twice.
              <ActionForm action={retryFundingAction} hidden={{ batchId: batch.id }} className="mt-3">
                <SubmitButton>Try funding again</SubmitButton>
              </ActionForm>
            </Notice>
          )}

          {batch.status === "order_failed" && (
            <Notice tone="warn" title="The order was not filled">
              {order?.error ?? batch.failureReason} Your {formatUsd(batch.authorizedCents ?? 0)} was collected and is being held for you. It was not spent, and it will not be collected again.
              <div className="mt-3 flex flex-wrap gap-3">
                {review.ordersLeft > 0 && (
                  <ActionForm action={retryOrderAction} hidden={{ batchId: batch.id }}>
                    <SubmitButton>Try the order again</SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={requestRefundAction} hidden={{ batchId: batch.id }}>
                  <SubmitButton className="btn btn-outline">Refund {formatUsd(batch.authorizedCents ?? 0)}</SubmitButton>
                </ActionForm>
              </div>
              {review.ordersLeft <= 0 && <p className="mt-2">The order has been tried {POLICY.maxOrderAttempts} times. A refund is the remaining option.</p>}
            </Notice>
          )}

          {(batch.status === "carried_forward" || batch.status === "empty" || batch.status === "cancelled" || batch.status === "expired" || batch.status === "refunded") && batch.failureReason && (
            <Notice>{batch.failureReason}</Notice>
          )}

          <Card>
            <h2 className="text-[1.25rem] font-semibold">Included purchases</h2>
            {review.entries.length > 0 ? (
              <div className="mt-2">
                <PurchaseList items={review.entries} timezone={user.timezone} />
              </div>
            ) : (
              <p className="mt-2 text-muted">{batch.status === "carried_forward" ? "This week's round-ups moved into the next week." : "No purchases were counted in this week."}</p>
            )}
            {approvable && <p className="mt-3 text-sm text-muted">This list is closed. Purchases that arrive now are counted in a later week.</p>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="eyebrow">{review.approval ? "What you approved" : "What you would approve"}</h2>
            <p className="num mt-2 text-[3.6rem] font-bold leading-none tracking-[-0.04em] text-orange">{formatUsd(batch.authorizedCents ?? batch.totalCents ?? 0)}</p>
            <dl className="mt-4 divide-y divide-line">
              <Row label="Total round-ups">{formatUsd(batch.totalCents ?? 0)}</Row>
              <Row label="Fees">{formatUsd(batch.feeCents ?? 0)}</Row>
              <Row label="Total being authorized">{formatUsd(batch.authorizedCents ?? 0)}</Row>
              <Row label="Company">
                {batch.instrumentSymbol} · {instrument?.company}
              </Row>
              <Row label="Funding method">{review.fundingMethod?.label ?? "Not connected"}</Row>
              <Row label="Delivered to">{review.destination}</Row>
            </dl>
          </Card>

          <Card>
            <h2 className="eyebrow">Execution</h2>
            <dl className="mt-2 divide-y divide-line">
              <Row label="Method">{review.execution.label}</Row>
              {order?.status === "filled" && instrument ? (
                <>
                  <Row label="Filled">
                    {formatTokenQty(order.filledQty!, instrument.decimals)} {order.instrumentSymbol}
                  </Row>
                  <Row label="Fill price">${order.fillPrice}</Row>
                </>
              ) : review.estimate && instrument ? (
                <>
                  <Row label="Estimated quantity">
                    ≈ {formatTokenQty(review.estimate.qty, instrument.decimals)} {batch.instrumentSymbol}
                  </Row>
                  <Row label="Reference price">${review.estimate.price}</Row>
                </>
              ) : null}
              {review.settlement?.status === "settled" && <Row label="Delivery reference">{review.settlement.providerRef}</Row>}
            </dl>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {review.execution.method}{" "}
              {review.estimate
                ? `Reference price from: ${review.estimate.source}, as of ${review.estimate.asOf.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC. `
                : approvable
                  ? "No price is available right now, so no quantity is estimated. "
                  : ""}
              {approvable &&
                `The final price is set when the order fills, after funding. What you approve is the dollar amount: at most ${formatUsd(batch.authorizedCents ?? 0)} is collected, whatever the price.`}
            </p>
          </Card>

          {approvable && (
            <Card className="!border-cobalt">
              <h2 className="text-[1.25rem] font-semibold">Your decision</h2>
              {review.statement && review.fundingMethod && review.execution.available && review.fundingAvailable.available ? (
                <ActionForm action={approveBatchAction} hidden={{ batchId: batch.id, snapshotHash: batch.snapshotHash!, fundingConnectionId: review.fundingMethod.id }} className="mt-3">
                  <label className="flex cursor-pointer gap-3 rounded-2xl border border-line bg-white/70 p-4 text-[0.98rem] leading-relaxed">
                    <input type="checkbox" name="confirm" className="mt-1 size-5 shrink-0 accent-[#103b76]" />
                    <span>{review.statement}</span>
                  </label>
                  <div className="mt-4">
                    <SubmitButton className="btn btn-primary btn-hero w-full" pendingLabel="Approving…">
                      Approve {formatUsd(batch.authorizedCents ?? 0)}
                    </SubmitButton>
                  </div>
                </ActionForm>
              ) : (
                <div className="mt-3">
                  <Notice tone="warn" title="This week cannot be approved right now">
                    {!review.fundingMethod
                      ? "No funding method is connected. Connect one in Settings."
                      : !review.execution.available
                        ? (review.execution.reason ?? "No supported execution route.")
                        : (review.fundingAvailable.reason ?? "Funding is unavailable.")}
                  </Notice>
                </div>
              )}
              <ActionForm action={declineBatchAction} hidden={{ batchId: batch.id }} className="mt-4">
                <SubmitButton className="link font-medium">Skip this week</SubmitButton>
              </ActionForm>
              <p className="mt-3 text-sm text-muted">
                Decide by {batch.approveBy ? formatDateTime(batch.approveBy, user.timezone) : "the deadline"}. After that the week expires and nothing is charged.
                {demo && " In the demo, funding, the order and delivery are simulated."}
              </p>
            </Card>
          )}
        </div>
      </div>

      {history.length > 1 && (
        <section className="mt-12" aria-labelledby="history">
          <h2 id="history" className="text-[1.25rem] font-semibold">
            Earlier weeks
          </h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {history.map((b) => (
              <li key={b.id}>
                <Link href={`/app/weekly-review?batch=${b.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3.5 hover:bg-surface" aria-current={b.id === batch.id ? "true" : undefined}>
                  <span className={b.id === batch.id ? "font-semibold" : ""}>{formatWeekRange(b.weekStart)}</span>
                  <span className="flex items-center gap-4">
                    <span className="num text-muted">{b.totalCents !== null ? formatUsd(b.totalCents) : "—"}</span>
                    <StatusPill tone={BATCH_STATUS[b.status].tone}>{BATCH_STATUS[b.status].label}</StatusPill>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** The four stages after approval. Each one is shown as done only when it really is. */
function Progress({ status }: { status: keyof typeof BATCH_STATUS }) {
  if (status === "ready_for_approval" || status === "cancelled" || status === "expired") return null;
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Progress after approval">
      {PIPELINE.map((step) => {
        const reached = step.reached.includes(status);
        const active = step.active.includes(status);
        return (
          <li key={step.key} className={`border-t-[3px] pt-2.5 ${reached ? "border-cobalt" : active ? "border-orange" : "border-line"}`}>
            <span className={`block text-sm font-semibold ${reached || active ? "" : "text-muted"}`}>{step.label}</span>
            <span className="block text-xs text-muted">{reached ? "Done" : active ? "In progress" : "Not yet"}</span>
          </li>
        );
      })}
    </ol>
  );
}
