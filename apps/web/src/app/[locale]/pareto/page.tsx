import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { ParetoView } from "@/components/pareto/ParetoView";

export default async function ParetoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={null}>
      <ParetoView />
    </Suspense>
  );
}
