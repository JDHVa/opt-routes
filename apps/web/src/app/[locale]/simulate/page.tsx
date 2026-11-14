import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { SimulateView } from "@/components/simulate/SimulateView";

export default async function SimulatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={null}>
      <SimulateView />
    </Suspense>
  );
}
