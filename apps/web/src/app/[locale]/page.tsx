import { ArrowDown, ArrowRight, ExternalLink } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LandingMap } from "@/components/landing/LandingMap";
import { StartPresets } from "@/components/presets/StartPresets";
import { ParetoDiagram, PheromoneDiagram, SplitDiagram } from "@/components/landing/Diagrams";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { REPO_URL } from "@/lib/env";
import { cn } from "@/lib/utils";

type Params = { params: Promise<{ locale: string }> };

export default async function LandingPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");

  const techniques = [
    { id: "split", diagram: <SplitDiagram /> },
    { id: "pheromone", diagram: <PheromoneDiagram /> },
    { id: "pareto", diagram: <ParetoDiagram /> },
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 md:px-6">
      <section className="grid items-center gap-8 pt-8 pb-10 md:pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.02em] md:text-display md:leading-10">
              {t("title")}
            </h1>
            <p className="max-w-xl text-base text-muted">{t("subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="#presets"
              className={cn(buttonVariants({ variant: "default", size: "lg" }), "px-4")}
            >
              {t("ctaPresets")}
              <ArrowDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </a>
            <Link
              href="/planner?demo=1"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-4")}
            >
              {t("ctaDemo")}
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "px-3")}
            >
              {t("ctaCode")}
              <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </div>
        </div>
        <section aria-label={t("map.label")} className="min-w-0">
          <LandingMap />
        </section>
      </section>

      <section id="presets" className="scroll-mt-16 pb-12">
        <StartPresets />
      </section>

      {techniques.map(({ id, diagram }) => (
        <section
          key={id}
          className="grid gap-6 border-t border-border py-10 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-12"
        >
          <div className="flex flex-col gap-3">
            <h2 className="text-h2 font-semibold">{t(`diagrams.${id}.title`)}</h2>
            <p className="text-muted">{t(`diagrams.${id}.body`)}</p>
            <p className="text-small text-muted">{t(`diagrams.${id}.note`)}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-surface p-4">{diagram}</div>
        </section>
      ))}

      <footer className="mt-4 flex flex-col gap-2 border-t border-border py-8 text-small text-muted">
        <p className="font-medium text-foreground">{t("footer.dataTitle")}</p>
        <ul className="flex flex-col gap-1">
          <li>{t("footer.denue")}</li>
          <li>{t("footer.osm")}</li>
          <li>{t("footer.amazon")}</li>
        </ul>
        <p>{t("footer.project")}</p>
      </footer>
    </div>
  );
}
