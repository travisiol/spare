import type { Tone } from "@/lib/status";

const TONES: Record<Tone, string> = {
  neutral: "text-muted",
  active: "text-cobalt",
  good: "text-cobalt bg-cobalt/8",
  warn: "text-ember",
};

export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`pill ${TONES[tone]}`}>
      {tone === "active" && <span aria-hidden className="size-1.5 rounded-full bg-orange" />}
      {children}
    </span>
  );
}

export function Card({ children, className = "", as: Tag = "section" }: { children: React.ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={`card p-5 sm:p-6 ${className}`}>{children}</Tag>;
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn"; title?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border px-4 py-3.5 text-[0.95rem] leading-relaxed ${tone === "warn" ? "border-line border-l-4 border-l-orange bg-white/70" : "border-line bg-white/60"}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className="text-muted">{children}</div>
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-7">
      <h1 className="display text-[2.4rem] sm:text-[3rem]">{title}</h1>
      {children && <p className="mt-2 max-w-2xl text-[1.05rem] text-muted">{children}</p>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-right font-medium">{children}</dd>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
      <p className="text-[1.1rem] font-semibold">{title}</p>
      <div className="mx-auto mt-1 max-w-md text-[0.95rem] text-muted">{children}</div>
    </div>
  );
}

export function formatDateTime(d: Date, timezone: string): string {
  return d.toLocaleString("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDate(d: Date, timezone: string): string {
  return d.toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" });
}
