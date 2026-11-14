import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { PlannerView } from "@/components/planner/PlannerView";

export default async function PlannerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={null}>
      <PlannerView />
    </Suspense>
  );
}
