import { setRequestLocale } from "next-intl/server";
import { CompareView } from "@/components/compare/CompareView";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CompareView />;
}
