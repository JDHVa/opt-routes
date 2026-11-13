"use client";

import {
  Cpu,
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
import { usePlanner } from "@/stores/planner";
import { useUi } from "@/stores/ui";

const PAGES = ["planner", "compare", "pareto", "simulate"] as const;

export function CommandPalette() {
  const t = useTranslations("cmd");
  const tn = useTranslations("nav");
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
