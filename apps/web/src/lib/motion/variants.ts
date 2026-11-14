import type { Transition, Variants } from "motion/react";

export const SPRING: Transition = { type: "spring", stiffness: 260, damping: 30 };
export const STAGGER_S = 0.04;
export const FADE_S = 0.1;

export function riseVariants(reduced: boolean, distance = 10): Variants {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { duration: FADE_S } },
    };
  }
  return {
    hidden: { opacity: 0, y: distance },
    show: { opacity: 1, y: 0, transition: SPRING },
  };
}

export function staggerVariants(reduced: boolean, stagger = STAGGER_S, delay = 0): Variants {
  return {
    hidden: {},
    show: {
      transition: {
        staggerChildren: reduced ? 0 : stagger,
        delayChildren: reduced ? 0 : delay,
      },
    },
  };
}

export function scaleInVariants(reduced: boolean): Variants {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { duration: FADE_S } },
    };
  }
  return {
    hidden: { opacity: 0, scale: 0.6 },
    show: { opacity: 1, scale: 1, transition: SPRING },
  };
}
