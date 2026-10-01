import { ActionForm, SubmitButton } from "@/components/app/forms";
import type { DemoFlags } from "@/db/schema";
import { demoAction } from "@/server/actions";

/** Demo-only: stand in for the outside world (a card, the calendar, a failing provider). */
export function DemoControls({ flags, canClose }: { flags: DemoFlags; canClose: boolean }) {
  return (
    <section aria-labelledby="demo-controls" className="rounded-[1.375rem] border border-dashed border-cobalt/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded bg-orange px-1.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wider text-ink">Demo</span>
        <h2 id="demo-controls" className="text-[1.15rem] font-semibold">
          Demo controls
        </h2>
      </div>
      <p className="mt-1 text-[0.95rem] text-muted">Play the parts SPARE does not control. These buttons exist only in the demo.</p>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <ActionForm action={demoAction} hidden={{ op: "purchases" }}>
          <p className="text-sm font-semibold">The card</p>
          <p className="mb-3 text-sm text-muted">Deliver more example purchases, including a pending one that posts.</p>
          <SubmitButton className="btn btn-outline w-full">Make example purchases</SubmitButton>
        </ActionForm>
        <ActionForm action={demoAction} hidden={{ op: "refund" }}>
          <p className="text-sm font-semibold">A merchant</p>
          <p className="mb-3 text-sm text-muted">Refund the most recent counted purchase and watch what changes.</p>
          <SubmitButton className="btn btn-outline w-full">Refund latest purchase</SubmitButton>
        </ActionForm>
        <ActionForm action={demoAction} hidden={{ op: "close" }}>
          <p className="text-sm font-semibold">The calendar</p>
          <p className="mb-3 text-sm text-muted">Run Sunday night&apos;s cutoff now instead of waiting for it.</p>
          <SubmitButton className="btn btn-solid w-full" disabled={!canClose}>
            Close this week now
          </SubmitButton>
        </ActionForm>
      </div>

      <ActionForm key={JSON.stringify(flags)} action={demoAction} hidden={{ op: "flags" }} className="mt-6 border-t border-line pt-5">
        <p className="text-sm font-semibold">Make the next attempt go wrong</p>
        <p className="text-sm text-muted">Each switch applies once, to the next attempt after you approve a week.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Funding</span>
            <select name="funding" defaultValue={flags.nextFunding ?? ""} className="field !h-11">
              <option value="">Succeeds</option>
              <option value="fail">Is declined</option>
              <option value="uncertain">Times out, then is found</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Order</span>
            <select name="order" defaultValue={flags.nextOrder ?? ""} className="field !h-11">
              <option value="">Fills</option>
              <option value="fail">Is rejected</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Delivery</span>
            <select name="settlement" defaultValue={flags.nextSettlement ?? ""} className="field !h-11">
              <option value="">Normal</option>
              <option value="slow">Slow</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <SubmitButton className="btn btn-outline">Save switches</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
