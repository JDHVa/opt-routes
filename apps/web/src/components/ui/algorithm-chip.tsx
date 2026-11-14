import { algorithmDisplayName } from "@/lib/planner/algorithms";
import { algorithmSeriesStyle } from "@/lib/routes/palette";
import { cn } from "@/lib/utils";

export function AlgorithmChip({
  algorithm,
  className,
}: {
  algorithm: string;
  className?: string;
}) {
  const style = algorithmSeriesStyle(algorithm);
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-surface px-2 text-micro font-medium text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={
          style.dashed
            ? { border: `1.5px dashed ${style.color}` }
            : { backgroundColor: style.color }
        }
      />
      {algorithmDisplayName(algorithm)}
    </span>
  );
}
