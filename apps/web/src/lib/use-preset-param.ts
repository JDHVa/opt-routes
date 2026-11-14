"use client";

import { useSearchParams } from "next/navigation";
import {
  findStartPreset,
  PRESET_QUERY_PARAM,
  type StartPreset,
  type StartPresetTarget,
} from "@/lib/presets";

export function usePresetParam(target: StartPresetTarget): StartPreset | null {
  const params = useSearchParams();
  const preset = findStartPreset(params.get(PRESET_QUERY_PARAM));
  return preset && preset.target === target ? preset : null;
}

export function clearPresetParam(): void {
  window.history.replaceState(null, "", window.location.pathname);
}
