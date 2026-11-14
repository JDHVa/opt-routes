export type TooltipRow = {
  label: string;
  value: string;
  swatch?: { color: string; dashed: boolean };
};

export function ChartTooltip({ title, rows }: { title?: string; rows: TooltipRow[] }) {
  return (
    <div className="flex min-w-36 flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-small text-foreground shadow-sm">
      {title ? <p className="num font-medium">{title}</p> : null}
      <dl className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-muted">
              {row.swatch ? (
                <span
                  aria-hidden="true"
                  className="h-0.5 w-3 shrink-0"
                  style={
                    row.swatch.dashed
                      ? {
                          backgroundImage: `repeating-linear-gradient(90deg, ${row.swatch.color} 0 4px, transparent 4px 6px)`,
                        }
                      : { backgroundColor: row.swatch.color }
                  }
                />
              ) : null}
              {row.label}
            </dt>
            <dd className="num">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
