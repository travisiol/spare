"use server";

/**
 * Every mutation the interface can make. Each action authenticates the caller
 * first and passes only that caller's id to the core, which enforces ownership.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as accounts from "@/core/accounts";
import { adminRequeueJob } from "@/core/admin";
import { revokeAdminSession, revokeSession, signInAdminWithToken } from "@/core/auth";
import * as batches from "@/core/batches";
import * as demo from "@/core/demo";
import { isDomainError } from "@/core/errors";
import { parseUsdToCents } from "@/core/money";
import { ADMIN_COOKIE, SESSION_COOKIE, cookieOptions, currentAdmin, currentUser } from "./session";
import { getRuntime } from "./runtime";

export interface ActionState {
  error?: string;
  ok?: string;
}

type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

async function asUser(fn: (ctx: { user: User; now: Date } & Awaited<ReturnType<typeof getRuntime>>) => Promise<string | void>): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Your session has ended. Sign in again." };
  try {
    const ok = await fn({ user, now: new Date(), ...(await getRuntime()) });
    revalidatePath("/app", "layout");
    return { ok: ok ?? "Saved." };
  } catch (e) {
    if (isDomainError(e)) return { error: e.message };
    console.error("[spare] action failed:", e);
    return { error: "Something went wrong on our side. Nothing was changed." };
  }
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/* --------------------------------------------------------------- onboarding */

export async function attestEligibilityAction(_: ActionState, form: FormData): Promise<ActionState> {
  if (form.get("confirm") !== "on") return { error: "Confirm the statement to continue." };
  return asUser(({ db, user, now }) => accounts.attestEligibility(db, user, now));
}

export async function chooseInstrumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const symbol = field(form, "symbol");
  if (!symbol) return { error: "Pick a company to continue." };
  return asUser(async ({ db, resolve, user, now }) => {
    await accounts.chooseInstrument(db, resolve, user, symbol, now);
    return `${symbol} selected for future weeks.`;
  });
}

export async function connectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const kind = field(form, "kind");
  if (kind !== "transaction_source" && kind !== "funding") return { error: "Unknown connection." };
  return asUser(async ({ db, resolve, user, now }) => {
    await accounts.connect(db, resolve, user, kind, now);
    return "Connected.";
  });
}

export async function disconnectAction(_: ActionState, form: FormData): Promise<ActionState> {
  return asUser(async ({ db, user, now }) => {
    await accounts.disconnect(db, user, field(form, "connectionId"), now);
    return "Disconnected.";
  });
}

export async function setCapAction(_: ActionState, form: FormData): Promise<ActionState> {
  const cents = parseUsdToCents(field(form, "cap"));
  if (cents === null) return { error: "Enter an amount in dollars, like 10 or 7.50." };
  return asUser(async ({ db, user, now }) => {
    await accounts.setWeeklyCap(db, user, cents, now);
    return "Weekly cap saved.";
  });
}

export async function acknowledgeApprovalAction(): Promise<ActionState> {
  return asUser(({ db, user, now }) => accounts.acknowledgeApproval(db, user, now));
}

export async function activateAction(): Promise<ActionState> {
  const state = await asUser(async ({ db, user, now }) => {
    await accounts.activateTracking(db, user, now);
    // The demo card "makes" its example purchases once tracking is on.
    if (user.env === "demo") await demo.deliverFirstWeek(db, user, now);
  });
  if (state.error) return state;
  redirect("/app");
}

/* ----------------------------------------------------------------- settings */

export async function setPausedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const paused = field(form, "paused") === "1";
  return asUser(async ({ db, user, now }) => {
    await accounts.setPaused(db, user, paused, now);
    return paused ? "Tracking paused. New purchases will not round up." : "Tracking resumed.";
  });
}

export async function setTimezoneAction(_: ActionState, form: FormData): Promise<ActionState> {
  return asUser(async ({ db, user }) => {
    await accounts.setTimezone(db, user, field(form, "timezone"));
    return "Timezone saved. It applies from the next week that opens.";
  });
}

export async function closeAccountAction(): Promise<ActionState> {
  const state = await asUser(({ db, user, now }) => accounts.closeAccount(db, user, now));
  if (state.error) return state;
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const { db } = await getRuntime();
  const jar = await cookies();
  await revokeSession(db, jar.get(SESSION_COOKIE)?.value, new Date());
  jar.delete(SESSION_COOKIE);
  redirect("/");
}

/* ------------------------------------------------------------ weekly review */

export async function approveBatchAction(_: ActionState, form: FormData): Promise<ActionState> {
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm the amount before approving." };
  return asUser(async ({ db, resolve, user, now }) => {
    await batches.approveBatch(
      db,
      resolve,
      { userId: user.id, batchId: field(form, "batchId"), snapshotHash: field(form, "snapshotHash"), fundingConnectionId: field(form, "fundingConnectionId") },
      now,
    );
    return "Approved. Funding has started.";
  });
}

export async function declineBatchAction(_: ActionState, form: FormData): Promise<ActionState> {
  return asUser(async ({ db, user, now }) => {
    await batches.declineBatch(db, user.id, field(form, "batchId"), now);
    return "Skipped. Nothing was charged.";
  });
}

export async function retryFundingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return asUser(async ({ db, user, now }) => {
    await batches.retryFunding(db, user.id, field(form, "batchId"), now);
    return "Trying the same approved amount again.";
  });
}

export async function retryOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  return asUser(async ({ db, user, now }) => {
    await batches.retryOrder(db, { type: "user", id: user.id }, field(form, "batchId"), now, user.id);
    return "Trying the order again with the funds already collected.";
  });
}

export async function requestRefundAction(_: ActionState, form: FormData): Promise<ActionState> {
  return asUser(async ({ db, user, now }) => {
    await batches.requestRefund(db, { type: "user", id: user.id }, field(form, "batchId"), now, user.id);
    return "Refund started.";
  });
}

/* --------------------------------------------------------------------- demo */

export async function demoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const op = field(form, "op");
  return asUser(async ({ db, user, now }) => {
    switch (op) {
      case "purchases": {
        const n = await demo.deliverMorePurchases(db, user, now);
        return `${n} example purchase events delivered.`;
      }
      case "refund":
        return `${await demo.deliverRefund(db, user, now)} refunded its purchase.`;
      case "close": {
        const status = await demo.closeWeekNow(db, user, now);
        return status === "ready_for_approval"
          ? "Week closed. It is ready for your review."
          : status === "carried_forward"
            ? "Week closed below the minimum. Its round-ups carried forward."
            : "Week closed with nothing to invest.";
      }
      case "flags": {
        await demo.setDemoFlags(db, user, {
          ...(field(form, "funding") === "fail" || field(form, "funding") === "uncertain" ? { nextFunding: field(form, "funding") as "fail" | "uncertain" } : {}),
          ...(field(form, "order") === "fail" ? { nextOrder: "fail" as const } : {}),
          ...(field(form, "settlement") === "slow" ? { nextSettlement: "slow" as const } : {}),
        });
        return "Saved. The switch applies to the next attempt only.";
      }
      default:
        return "Nothing to do.";
    }
  });
}

/* -------------------------------------------------------------------- admin */

async function asAdmin(fn: (ctx: { actor: NonNullable<Awaited<ReturnType<typeof currentAdmin>>>; now: Date } & Awaited<ReturnType<typeof getRuntime>>) => Promise<string>): Promise<ActionState> {
  const actor = await currentAdmin();
  if (!actor) return { error: "Admin access required." };
  try {
    const ok = await fn({ actor, now: new Date(), ...(await getRuntime()) });
    revalidatePath("/admin");
    return { ok };
  } catch (e) {
    if (isDomainError(e)) return { error: e.message };
    console.error("[spare] admin action failed:", e);
    return { error: "The action failed. Nothing was changed." };
  }
}

export async function adminSignInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { db } = await getRuntime();
  try {
    const session = await signInAdminWithToken(db, field(form, "token"), new Date());
    (await cookies()).set(ADMIN_COOKIE, session.token, cookieOptions(session.expiresAt));
  } catch (e) {
    return { error: isDomainError(e) ? e.message : "Sign-in failed." };
  }
  redirect("/admin");
}

export async function adminSignOutAction(): Promise<void> {
  const { db } = await getRuntime();
  const jar = await cookies();
  await revokeAdminSession(db, jar.get(ADMIN_COOKIE)?.value, new Date());
  jar.delete(ADMIN_COOKIE);
  redirect("/admin");
}

export async function adminRequeueJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(async ({ db, actor, now }) => ((await adminRequeueJob(db, actor, field(form, "jobId"), now)) ? "Job queued again." : "That job is no longer dead; nothing changed."));
}

export async function adminRetryOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(async ({ db, actor, now }) => {
    await batches.retryOrder(db, actor, field(form, "batchId"), now);
    return "Order retry queued. No new charge is made.";
  });
}

export async function adminRefundAction(_: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(async ({ db, actor, now }) => {
    await batches.requestRefund(db, actor, field(form, "batchId"), now);
    return "Refund queued.";
  });
}
