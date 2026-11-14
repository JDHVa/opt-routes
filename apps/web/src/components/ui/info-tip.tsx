"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type InfoTipFallback = { title: string; body?: string };

export function InfoTip({
  topic,
  fallback,
  className,
  side = "top",
}: {
  topic: string;
  fallback?: InfoTipFallback;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const t = useTranslations("help");
  const descriptionId = useId();
  const [open, setOpen] = useState(false);

  const suppressFocus = useRef(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      suppressFocus.current = true;
      setTimeout(() => {
        suppressFocus.current = false;
      }, 100);
    }
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const known = t.has(`${topic}.title`);
  const title = known ? t(`${topic}.title`) : (fallback?.title ?? "");
  const body = known && t.has(`${topic}.body`) ? t(`${topic}.body`) : (fallback?.body ?? "");
  const example = known && t.has(`${topic}.example`) ? t(`${topic}.example`) : null;

  if (!title) return null;

  return (
    <>
      <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <PopoverPrimitive.Trigger
          openOnHover
          delay={150}
          closeDelay={80}
          aria-label={t("trigger", { name: title })}
          aria-describedby={descriptionId}
          data-slot="info-tip"
          onFocus={(event) => {
            if (!suppressFocus.current && event.currentTarget.matches(":focus-visible")) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          className={cn(
            "inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded-full text-muted transition-colors duration-[120ms] hover:text-accent focus-visible:text-accent data-[popup-open]:text-accent",
            className,
          )}
        >
          <Info size={14} strokeWidth={1.75} aria-hidden="true" />
        </PopoverPrimitive.Trigger>
        {open ? (
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner side={side} sideOffset={6} collisionPadding={8} className="isolate z-50">
              <PopoverPrimitive.Popup
                aria-hidden="true"
                data-slot="info-tip-content"
                className="z-50 flex w-64 max-w-[calc(100vw-16px)] origin-(--transform-origin) flex-col gap-1.5 rounded-lg border border-border bg-popover p-3 text-small text-popover-foreground shadow-sm outline-hidden duration-[180ms] ease-panel data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
              >
                <p className="text-sm font-semibold">{title}</p>
                {body ? <p className="text-muted">{body}</p> : null}
                {example ? (
                  <p className="num rounded-md bg-surface-2 px-2 py-1 text-micro text-foreground">
                    {example}
                  </p>
              ) : null}
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
        ) : null}
      </PopoverPrimitive.Root>
      <span id={descriptionId} className="sr-only">
        {[title, body, example].filter(Boolean).join(". ")}
      </span>
    </>
  );
}
