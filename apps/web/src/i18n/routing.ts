import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

export const INTL_LOCALE: Record<Locale, string> = {
  es: "es-MX",
  en: "en-US",
};
