"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: string };

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  columns,
  spacing = 0,
}: {
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  columns?: number;
  spacing?: number;
}) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={value === null ? [] : [value]}
      onValueChange={(next) => {
        const chosen = next[0];
        if (chosen) onChange(chosen as T);
      }}
      spacing={spacing}
      variant="outline"
      className={cn("grid w-full", className)}
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="h-8 min-w-0 px-2 text-small aria-pressed:bg-accent-soft aria-pressed:text-accent-strong aria-pressed:font-semibold data-[pressed]:bg-accent-soft data-[pressed]:text-accent-strong active:scale-[0.97] active:bg-accent-press"
        >
          <span className="truncate">{option.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
