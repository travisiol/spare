import Link from "next/link";
import { redirect } from "next/navigation";
import { PurchaseList } from "@/components/app/PurchaseList";
import { Card, EmptyState, PageTitle } from "@/components/app/ui";
import { onboardingState } from "@/core/accounts";
import { listActivity } from "@/core/queries";
import { getRuntime } from "@/server/runtime";
import { requireUser } from "@/server/session";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "tracked", label: "Counted" },
  { key: "pending", label: "Pending" },
  { key: "excluded", label: "Left out" },
  { key: "reversed", label: "Refunded or reversed" },
] as const;

export default async function Activity({ searchParams }: PageProps<"/app/activity">) {
  const user = await requireUser();
  const { db } = await getRuntime();
  if (!(await onboardingState(db, user.id)).complete) redirect("/app/onboarding");
  const show = (await searchParams).show;
  const filter = FILTERS.find((f) => f.key === show)?.key ?? "all";
  const all = await listActivity(db, user.id);
  const items = all.filter((p) => {
    if (filter === "all") return true;
    if (filter === "reversed") return p.status === "refunded" || p.status === "reversed" || p.entryStatus === "reversed";
    return p.entryStatus === filter;
  });

  return (
    <>
      <PageTitle title="Activity">Every purchase SPARE has seen from your connected source, what it rounded up by, and why anything was left out.</PageTitle>
      <nav aria-label="Filter activity" className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/app/activity" : `/app/activity?show=${f.key}`}
            aria-current={filter === f.key ? "true" : undefined}
            className={`inline-flex h-10 items-center rounded-full border-[1.5px] px-4 text-sm font-medium ${filter === f.key ? "border-cobalt bg-cobalt text-ice" : "border-line text-muted hover:border-sky"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <Card>
        {items.length > 0 ? (
          <>
            <div className="eyebrow hidden grid-cols-[1fr_5.5rem_5rem_8rem] gap-x-4 border-b border-line pb-3 sm:grid">
              <span>Merchant</span>
              <span className="text-right">Paid</span>
              <span className="text-right">Round-up</span>
              <span className="text-right">Status</span>
            </div>
            <PurchaseList items={items} timezone={user.timezone} detailed />
          </>
        ) : (
          <EmptyState title={all.length === 0 ? "No purchases yet" : "Nothing matches this filter"}>
            {all.length === 0 ? "Purchases appear here as your connected source reports them. Nothing is invented to fill the list." : "Try another filter."}
          </EmptyState>
        )}
      </Card>
    </>
  );
}
