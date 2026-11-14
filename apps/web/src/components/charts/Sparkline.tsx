"use client";

import { Line, LineChart, YAxis } from "recharts";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";

export function Sparkline({
  values,
  width = 160,
  height = 32,
  label,
  highlight = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  label: string;
  highlight?: boolean;
}) {
  const reduced = useReducedMotion();
  const data = values.map((value, index) => ({ index, value }));
  return (
    <div role="img" aria-label={label} style={{ width, height }}>
      <LineChart width={width} height={height} data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={highlight ? "var(--signal)" : "var(--accent)"}
          strokeWidth={highlight ? 2.5 : 1.5}
          dot={false}
          isAnimationActive={!reduced}
          animationDuration={300}
          animationEasing="ease-out"
        />
      </LineChart>
    </div>
  );
}
