import { setRequestLocale } from "next-intl/server";
import { ParetoView } from "@/components/pareto/ParetoView";

export default async function ParetoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ParetoView />;
}
