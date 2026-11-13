import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type PlaceholderKey = "compare" | "pareto" | "simulate";

export async function PlaceholderPage({
  locale,
  screen,
}: {
  locale: string;
  screen: PlaceholderKey;
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: `placeholders.${screen}` });
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-h1 font-semibold tracking-[-0.01em]">{t("title")}</h1>
      <p className="max-w-prose text-muted">{t("body")}</p>
      <div>
        <Link href="/planner" className={cn(buttonVariants({ variant: "default" }))}>
          {t("action")}
        </Link>
      </div>
    </section>
  );
}
