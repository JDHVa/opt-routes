"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { CsvImportError, importCsv } from "@/lib/api/client";
import { usePlanner } from "@/stores/planner";

export function useCsvImport() {
  const t = useTranslations("planner.stops");
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const replaceStops = usePlanner((state) => state.replaceStops);
  const setCsvErrors = usePlanner((state) => state.setCsvErrors);

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setImporting(true);
      try {
        const stops = await importCsv(await file.text());
        await replaceStops(stops);
        toast.success(t("importDone", { count: stops.length }));
      } catch (error) {
        if (error instanceof CsvImportError) setCsvErrors(error.rows);
        else toast.error(t("importFailed"));
      } finally {
        setImporting(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [replaceStops, setCsvErrors, t],
  );

  return { inputRef, openPicker, onFile, importing };
}
