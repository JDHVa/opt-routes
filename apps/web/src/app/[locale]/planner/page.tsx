import { setRequestLocale } from "next-intl/server";
import { PlannerView } from "@/components/planner/PlannerView";

export default async function PlannerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PlannerView />;
}
