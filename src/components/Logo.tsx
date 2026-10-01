/** The wordmark: lowercase "spare" followed by four orange squares in a 2×2 block. */
export function Logo({ className = "", tone = "cobalt" }: { className?: string; tone?: "cobalt" | "light" }) {
  return (
    <span className={`inline-flex items-center gap-[0.22em] leading-none ${className}`} aria-label="SPARE">
      <span aria-hidden className={`font-sans font-black tracking-[-0.045em] ${tone === "light" ? "text-ice" : "text-cobalt"}`} style={{ fontVariationSettings: '"opsz" 14' }}>
        spare
      </span>
      <svg aria-hidden viewBox="0 0 20 20" className="mt-[0.06em] h-[0.62em] w-[0.62em] shrink-0">
        <g fill="#FF5B2B">
          <rect x="0" y="0" width="8.6" height="8.6" rx="2.4" />
          <rect x="11.4" y="0" width="8.6" height="8.6" rx="2.4" />
          <rect x="0" y="11.4" width="8.6" height="8.6" rx="2.4" />
          <rect x="11.4" y="11.4" width="8.6" height="8.6" rx="2.4" />
        </g>
      </svg>
    </span>
  );
}
