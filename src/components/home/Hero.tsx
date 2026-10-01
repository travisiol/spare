import { StartCta, type Viewer } from "@/components/StartButtons";

/**
 * The approved composition: centred editorial headline, actions, a wide glass
 * dish underneath, one annotation on each side, then the three-step band.
 * Everything except the dish photograph is real HTML.
 */
export function Hero({ viewer }: { viewer: Viewer | null }) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-[1536px] px-5 pt-2 text-center sm:px-8 lg:pt-3">
        <h1 className="display animate-rise text-[clamp(2.55rem,7.6vw,7.3rem)] tracking-[-0.056em]">
          Keep the change.
          <br />
          Own the company.
        </h1>
        <p className="animate-rise mt-5 text-[clamp(1.1rem,1.75vw,1.7rem)] [animation-delay:80ms] lg:mt-6">Every payment rounds up into tokenized stock.</p>
        <div className="animate-rise mt-6 flex flex-col items-center justify-center gap-x-8 gap-y-4 [animation-delay:160ms] sm:flex-row lg:mt-7">
          <StartCta viewer={viewer} />
          <a href="#how" className="link text-[1.05rem] font-medium">
            See how it works
          </a>
        </div>
      </div>

      {/* Dish and annotations share one box with the mockup's proportions (1536 × 418). */}
      <div className="animate-rise mx-auto mt-4 max-w-[1536px] [animation-delay:240ms] [container-type:inline-size] lg:mt-3">
        <div className="relative mx-auto w-[112%] max-w-none -translate-x-[5.4%] sm:w-full sm:translate-x-0 lg:aspect-[1536/418]">
          <picture>
            <source media="(min-width: 900px)" srcSet="/hero/dish@2x.webp" />
            <img
              src="/hero/dish.webp"
              width={1084}
              height={418}
              alt="A low, wide dish of frosted cobalt glass holding a handful of silver coins and one small orange disc. A few coins rest on the surface beside it."
              fetchPriority="high"
              decoding="async"
              className="mx-auto h-auto w-full lg:absolute lg:left-[14.06%] lg:top-0 lg:w-[70.57%]"
            />
          </picture>

          <svg viewBox="0 0 1536 418" aria-hidden className="pointer-events-none absolute inset-0 hidden size-full text-cobalt lg:block">
            <path d="M277 78 L378 118" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="378" cy="118" r="3.5" fill="currentColor" />
            <path d="M1250 76 L1163 118" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="1163" cy="118" r="3.5" fill="currentColor" />
          </svg>

          <div className="absolute left-[7.55%] top-[13.5%] hidden text-left lg:block">
            <Annotation label="Coffee $4.63" value="+$0.37" caption="Set aside" />
          </div>
          <div className="absolute left-[82.9%] top-[13.5%] hidden text-left lg:block">
            <Annotation label="This week" value="$1.42" caption="Ready to invest" pill="AAPL" />
          </div>
        </div>

        {/* Below the desktop breakpoint the annotations sit under the dish, side by side. */}
        <div className="relative mx-auto mt-3 grid max-w-md grid-cols-2 gap-4 px-5 pb-8 lg:hidden">
          <Annotation label="Coffee $4.63" value="+$0.37" caption="Set aside" compact />
          <Annotation label="This week" value="$1.42" caption="Ready to invest" pill="AAPL" compact />
        </div>
        <p className="sr-only">These figures are an example, not an account balance.</p>
      </div>

      <Steps />
    </section>
  );
}

function Annotation({ label, value, caption, pill, compact = false }: { label: string; value: string; caption: string; pill?: string; compact?: boolean }) {
  // Desktop sizes follow the dish (container units); compact sizes are fixed for small screens.
  const small = compact ? "text-[1.05rem]" : "text-[1.56cqw]";
  const big = compact ? "text-[2.4rem]" : "text-[3.55cqw]";
  return (
    <div className="leading-tight">
      <p className={small}>{label}</p>
      <p className={`num font-bold tracking-[-0.03em] text-orange ${big} leading-[1.08]`}>{value}</p>
      <p className={small}>{caption}</p>
      {pill && <span className={`pill mt-3 ${compact ? "" : "!h-[2.4cqw] !px-[1.4cqw] !text-[1.15cqw]"}`}>{pill}</span>}
    </div>
  );
}

function Steps() {
  const steps = ["Pick a company", "Pay like always", "Your change becomes stock"];
  return (
    <div className="bg-navy text-ice">
      <ol className="mx-auto grid max-w-[1536px] gap-y-4 px-6 py-7 sm:px-10 md:grid-cols-3 md:justify-items-center md:py-10">
        {steps.map((step, i) => (
          <li key={step} className="flex items-baseline gap-5">
            <span className="num text-[1.75rem] font-bold tracking-tight text-orange md:text-[1.9rem]">0{i + 1}</span>
            <span className="text-[1.15rem] md:text-[1.4rem]">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
