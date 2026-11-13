"use client";

import { Line, LineChart, YAxis } from "recharts";

export function Sparkline({
  values,
  width = 160,
  height = 32,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  label: string;
}) {
  const data = values.map((value, index) => ({ index, value }));
  return (
    <div role="img" aria-label={label} style={{ width, height }}>
      <LineChart width={width} height={height} data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--accent)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}
