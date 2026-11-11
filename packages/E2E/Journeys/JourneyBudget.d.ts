// Types for JourneyBudget.js, which the guard in Tests/Ops reads as plain CommonJS.

export type Measure =
  | "screens"
  | "dialogs"
  | "clicks"
  | "fieldsTyped"
  | "products"
  | "keystrokes"
  | "defaultsKept"
  | "choices"
  | "words";

export type Counts = Record<Measure, number>;

export interface JourneyStep {
  step: string;
  words: number;
  choices: number;
}

export interface JourneyRunDetails {
  screens: Array<string>;
  dialogs: Array<string>;
  products: Array<string>;
  fieldsTyped: Array<string>;
  defaultsKept: Array<string>;
  choices: Array<{ step: string; picked: string; offered: number }>;
  steps: Array<JourneyStep>;
}

export interface JourneyRun {
  measures: Counts;
  details: JourneyRunDetails;
}

export interface JourneyBudgetEntry {
  title: string;
  path: "manual" | "guided";
  startsAt: string;
  endsWhen: string;
  budget: Counts;
}

export interface JourneyBudgetFile {
  about?: Array<string>;
  failOn: Array<Measure>;
  reported: Array<Measure>;
  journeys: Record<string, JourneyBudgetEntry>;
}

export const BUDGET_FILE: string;
export const MEASURES: Array<Measure>;
export const FAIL_ON: Array<Measure>;
export const REPORTED: Array<Measure>;
export const MEASURE_NAMES: Record<Measure, string>;

export function problemsWithBudgetFile(file: unknown): Array<string>;

export function compareWithBudget(
  file: JourneyBudgetFile,
  id: string,
  run: JourneyRun,
): Array<string>;

export function reportTable(
  file: JourneyBudgetFile,
  runs: Record<string, JourneyRun>,
): string;
