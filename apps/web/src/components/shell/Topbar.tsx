"use client";

import { Menu, Search } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, usePathname } from "@/i18n/navigation";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { LocaleSwitch } from "./LocaleSwitch";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

export const NAV_ITEMS = [
  { id: "planner", href: "/planner" },
  { id: "compare", href: "/compare" },
  { id: "pareto", href: "/pareto" },
  { id: "simulate", href: "/simulate" },
] as const;

export function Topbar() {
  const t = useTranslations("nav");
  const tb = useTranslations("topbar");
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const togglePalette = useUi((state) => state.togglePalette);

  return (
    <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={tb("menu")}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
          >
            <Menu size={16} strokeWidth={1.75} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {NAV_ITEMS.map((item) => (
              <DropdownMenuItem
                key={item.id}
                render={<Link href={item.href} />}
                data-active={pathname.startsWith(item.href) || undefined}
              >
                {t(item.id)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Wordmark />

      <nav aria-label={tb("primaryNav")} className="ml-4 hidden items-center gap-1 md:flex">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-8 items-center rounded-md px-3 text-sm transition-colors duration-[120ms]",
                active ? "font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="nav-active"
                  aria-hidden="true"
                  transition={
                    reduced ? { duration: 0.1 } : { type: "spring", stiffness: 260, damping: 30 }
                  }
                  className="absolute inset-0 rounded-md bg-accent-soft"
                />
              ) : null}
              <span className="relative">{t(item.id)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          onClick={togglePalette}
          aria-label={tb("openPalette")}
          className="hidden w-48 justify-between text-muted md:inline-flex"
        >
          <span className="flex items-center gap-2">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            {tb("search")}
          </span>
          <kbd className="num rounded-sm border border-border bg-surface-2 px-1.5 text-micro text-muted">
            ⌘K
          </kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={togglePalette}
          aria-label={tb("openPalette")}
          className="md:hidden"
        >
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        </Button>
        <LocaleSwitch />
        <ThemeToggle />
      </div>
    </header>
  );
}
