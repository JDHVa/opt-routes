"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

export const RouteMapLoader = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});
