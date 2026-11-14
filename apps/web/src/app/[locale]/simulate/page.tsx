import { setRequestLocale } from "next-intl/server";
import { SimulateView } from "@/components/simulate/SimulateView";

export default async function SimulatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SimulateView />;
}
