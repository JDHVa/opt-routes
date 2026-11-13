import { PlaceholderPage } from "@/components/shell/PlaceholderPage";

export default async function ParetoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <PlaceholderPage locale={locale} screen="pareto" />;
}
