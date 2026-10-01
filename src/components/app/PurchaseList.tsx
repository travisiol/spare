import { StatusPill } from "@/components/app/ui";
import { EXCLUSION_REASONS } from "@/core/ingest";
import { formatUsd } from "@/core/money";
import type { listActivity } from "@/core/queries";
import { ENTRY_STATUS, PURCHASE_STATUS } from "@/lib/status";

type Item = Awaited<ReturnType<typeof listActivity>>[number];

function money(cents: number, currency: string) {
  return currency === "USD" ? formatUsd(cents) : `${(cents / 100).toFixed(2)} ${currency}`;
}

/** One purchase per row: what was paid, what it rounded up by, and — if it did not count — why. */
export function PurchaseList({ items, timezone, detailed = false }: { items: Item[]; timezone: string; detailed?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((p) => {
        const entry = ENTRY_STATUS[p.entryStatus];
        const counted = p.entryStatus === "tracked";
        const reason = p.reason ? (EXCLUSION_REASONS[p.reason] ?? p.reason) : null;
        return (
          <li key={p.id} className="py-3.5">
            <div className="grid grid-cols-[1fr_auto_4.2rem] items-baseline gap-x-3 gap-y-1.5 sm:grid-cols-[1fr_5.5rem_5rem_8rem] sm:gap-x-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{p.merchant}</p>
                <p className="text-sm text-muted">
                  {p.at.toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" })} · {PURCHASE_STATUS[p.status]}
                  {detailed && ` · ${p.currency}`}
                </p>
              </div>
              <p className="num text-right text-muted sm:text-[1.02rem]">{money(p.amountCents, p.currency)}</p>
              <p className={`num text-right font-semibold ${counted ? "" : "text-muted"} ${p.entryStatus === "reversed" || p.entryStatus === "excluded" ? "line-through decoration-1" : ""}`}>
                {p.entryStatus === "excluded" && p.roundupCents === 0 ? "—" : `+${formatUsd(p.roundupCents)}`}
              </p>
              <p className="col-span-3 sm:col-span-1 sm:text-right">
                <StatusPill tone={entry.tone}>{p.carried && counted ? "Carried over" : entry.label}</StatusPill>
              </p>
            </div>
            {detailed && reason && (
              <details className="mt-1.5 text-sm">
                <summary className="link cursor-pointer text-muted">Why was this left out?</summary>
                <p className="mt-1 text-muted">{reason}</p>
              </details>
            )}
            {detailed && p.adjusted && (
              <p className="mt-1.5 text-sm text-muted">
                Refunded after its week was approved. Recorded as an adjustment: no stock was sold and no extra charge was made.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
