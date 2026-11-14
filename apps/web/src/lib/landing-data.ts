import problemJson from "@/data/demo/mty-centro-depot-40.problem.json";
import solutionJson from "@/data/demo/mty-centro-depot-40.solution.json";
import type { Problem, Solution } from "@/lib/api/types";

export const demoProblem = problemJson as unknown as Problem;
export const demoSolution = (solutionJson as unknown as { solution: Solution }).solution;
