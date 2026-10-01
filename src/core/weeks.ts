/**
 * Timezone-aware week boundaries. A week runs Monday 00:00:00 to the next
 * Monday 00:00:00 in the account's IANA timezone.
 */

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Milliseconds `tz` is ahead of UTC at `instant`. */
function offsetMs(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which local midnight of `ymd` occurs in `tz`. */
export function localMidnightToInstant(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let result = guess - offsetMs(new Date(guess), tz);
  // Second pass settles days on which the offset changes (DST).
  result = guess - offsetMs(new Date(result), tz);
  return new Date(result);
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Local Monday (YYYY-MM-DD) of the week containing `instant` in `tz`. */
export function weekStartFor(instant: Date, tz: string): string {
  const p = localParts(instant, tz);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
  return addDays(ymd(p.year, p.month, p.day), -((dow + 6) % 7));
}

/** The instant the week starting on `weekStart` ends (exclusive cutoff). */
export function weekEndInstant(weekStart: string, tz: string): Date {
  return localMidnightToInstant(addDays(weekStart, 7), tz);
}

export function formatWeekRange(weekStart: string): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  return `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;
}
