"use client";

import {
  BookOpen,
  Cpu,
  Rocket,
  Languages,
  Map as MapIcon,
  Monitor,
  Moon,
  Play,
  Square,
  Sun,
  Warehouse,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { GLOSSARY_TERMS } from "@/lib/glossary";
import { presetHref, START_PRESETS } from "@/lib/presets";
import { usePlanner } from "@/stores/planner";
import { useUi } from "@/stores/ui";

const PAGES = ["planner", "compare", "pareto", "simulate"] as const;

export function CommandPalette() {
  const t = useTranslations("cmd");
  const tn = useTranslations("nav");
  const th = useTranslations("help.glossary");
  const tp = useTranslations("startPresets");
  const tt = useTranslations("topbar");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme } = useTheme();
  const open = useUi((state) => state.paletteOpen);
  const setOpen = useUi((state) => state.setPaletteOpen);
  const togglePalette = useUi((state) => state.togglePalette);

  const algorithms = usePlanner((state) => state.algorithms);
  const status = usePlanner((state) => state.status);
  const hasProblem = usePlanner((state) => state.problem !== null);
  const loadCatalog = usePlanner((state) => state.loadCatalog);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette]);

  useEffect(() => {
    if (open) void loadCatalog();
  }, [open, loadCatalog]);

  const run = useCallback(
    (action: () => void) => {
      setOpen(false);
      action();
    },
    [setOpen],
  );

  const goToPlanner = useCallback(() => {
    if (!pathname.startsWith("/planner")) router.push("/planner");
  }, [pathname, router]);

  const running = status === "running" || status === "loading";

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("title")}
      description={t("description")}
    >
      <Command>
        <CommandInput placeholder={t("placeholder")} />
        <CommandList>
          <CommandEmpty>{t("empty")}</CommandEmpty>

          <CommandGroup heading={t("groups.actions")}>
            <CommandItem
              value={t("loadDemo")}
              keywords={["demo", "monterrey", "escenario", "scenario"]}
              onSelect={() =>
                run(() => {
                  goToPlanner();
                  void usePlanner.getState().loadScenario();
                })
              }
            >
              <Warehouse size={16} strokeWidth={1.75} aria-hidden="true" />
              {t("loadDemo")}
            </CommandItem>
            {running ? (
              <CommandItem
                value={t("stop")}
                onSelect={() => run(() => usePlanner.getState().stop())}
              >
                <Square size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("stop")}
              </CommandItem>
            ) : (
              <CommandItem
                value={t("optimize")}
                disabled={!hasProblem}
                keywords={["solve", "resolver", "run"]}
                onSelect={() =>
                  run(() => {
                    goToPlanner();
                    void usePlanner.getState().optimize();
                  })
                }
              >
                <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("optimize")}
                <CommandShortcut>⌘↵</CommandShortcut>
              </CommandItem>
            )}
          </CommandGroup>

          {algorithms.length > 0 ? (
            <CommandGroup heading={t("groups.algorithm")}>
              {algorithms.map((algorithm) => (
                <CommandItem
                  key={algorithm.name}
                  value={`${t("algorithmPrefix")} ${algorithm.name} ${algorithm.label}`}
                  onSelect={() =>
                    run(() => usePlanner.getState().setAlgorithm(algorithm.name))
                  }
                >
                  <Cpu size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t("useAlgorithm", { name: algorithm.name.toUpperCase() })}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          <CommandGroup heading={t("groups.presets")}>
            {START_PRESETS.map((preset) => (
              <CommandItem
                key={preset.id}
                value={`${tp("try")} ${tp(`items.${preset.id}.name`)}`}
                onSelect={() => run(() => router.push(presetHref(preset)))}
              >
                <Rocket size={16} strokeWidth={1.75} aria-hidden="true" />
                {tp(`items.${preset.id}.name`)}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading={t("groups.glossary")}>
            {GLOSSARY_TERMS.map((term) => (
              <CommandItem
                key={term}
                value={`${t("glossaryPrefix")} ${th(`${term}.title`)} ${th(`${term}.body`)}`}
                onSelect={() => undefined}
                className="items-start"
              >
                <BookOpen size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>{t("glossaryLabel", { term: th(`${term}.title`) })}</span>
                  <span className="text-small whitespace-normal text-muted">{th(`${term}.body`)}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading={t("groups.language")}>
            {routing.locales.map((id) => (
              <CommandItem
                key={id}
                value={`${t("languagePrefix")} ${tt(`locales.${id}`)}`}
                disabled={id === locale}
                onSelect={() => run(() => router.replace(pathname, { locale: id }))}
              >
                <Languages size={16} strokeWidth={1.75} aria-hidden="true" />
                {tt(`locales.${id}`)}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading={t("groups.theme")}>
            <CommandItem value={t("themeLight")} onSelect={() => run(() => setTheme("light"))}>
              <Sun size={16} strokeWidth={1.75} aria-hidden="true" />
              {t("themeLight")}
            </CommandItem>
            <CommandItem value={t("themeDark")} onSelect={() => run(() => setTheme("dark"))}>
              <Moon size={16} strokeWidth={1.75} aria-hidden="true" />
              {t("themeDark")}
            </CommandItem>
            <CommandItem value={t("themeSystem")} onSelect={() => run(() => setTheme("system"))}>
              <Monitor size={16} strokeWidth={1.75} aria-hidden="true" />
              {t("themeSystem")}
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading={t("groups.go")}>
            {PAGES.map((page) => (
              <CommandItem
                key={page}
                value={`${t("goTo")} ${tn(page)}`}
                onSelect={() => run(() => router.push(`/${page}`))}
              >
                <MapIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("goToPage", { page: tn(page) })}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
