import type { components } from "./schema";

type S = components["schemas"];

export type Problem = S["Problem"];
export type Solution = S["Solution"];
export type Route = S["Route"];
export type Visit = S["Visit"];
export type Stop = S["Stop"];
export type Driver = S["Driver"];
export type Location = S["Location"];
export type VehicleType = S["VehicleType"];
export type VehicleCatalog = S["VehicleCatalog"];
export type AlgorithmInfo = S["AlgorithmInfo"];
export type AlgorithmRun = S["AlgorithmRun"];
export type ScenarioInfo = S["ScenarioInfo"];
export type SolveRequest = S["SolveRequest"];
export type SolveResponse = S["SolveResponse"];
export type ProgressPayload = S["ProgressPayload"];
export type ErrorPayload = S["ErrorPayload"];
export type SolutionMetrics = S["SolutionMetrics"];
export type HistoryPoint = S["HistoryPoint"];
export type ObjectiveWeights = S["ObjectiveWeights"];
export type ConstraintToggles = S["ConstraintToggles"];
export type ProblemMode = S["ProblemMode"];
export type Priority = S["Priority"];
export type ParetoPoint = S["ParetoPoint"];
