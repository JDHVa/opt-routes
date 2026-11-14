"use client";

import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";

export default function LocaleTemplate({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced ? { duration: 0.1 } : { duration: 0.22, ease: [0.2, 0, 0, 1] }
      }
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}
