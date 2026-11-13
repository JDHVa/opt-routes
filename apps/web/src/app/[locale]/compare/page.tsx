import { PlaceholderPage } from "@/components/shell/PlaceholderPage";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <PlaceholderPage locale={locale} screen="compare" />;
}
