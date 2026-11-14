import ProductType from "../../../../Types/MeteredPlan/ProductType";
import {
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * Statuses as the ingestion budget status API answers them (issue #5917),
 * for the UI tests of the budget card and the explorers' banner. Not a test
 * file itself (jest only collects *.test.ts).
 */

export const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;

export const KEY_ID: string = "22222222-2222-4222-8222-222222222222";
export const OTHER_KEY_ID: string = "33333333-3333-4333-8333-333333333333";

// A signal with nothing in force and nothing counted.
export function unbudgeted(
  signal: TelemetryIngestionBudgetSignal,
): TelemetryIngestionBudgetSignalStatus {
  return {
    signal: signal,
    dailyBudgetBytes: null,
    dailyBudgetSource: null,
    rateLimitBytesPerSecond: null,
    rateLimitSource: null,
    usedBytes: 0,
    droppedBytes: 0,
    droppedRequests: 0,
    throttledRequests: 0,
    percentUsed: null,
    state: TelemetryIngestionBudgetState.NoBudget,
    warningCrossedAt: null,
    exhaustedAt: null,
  };
}

export function budgeted(
  signal: TelemetryIngestionBudgetSignal,
  data: Partial<TelemetryIngestionBudgetSignalStatus>,
): TelemetryIngestionBudgetSignalStatus {
  return {
    ...unbudgeted(signal),
    dailyBudgetBytes: 10 * GB,
    dailyBudgetSource: TelemetryIngestionBudgetLimitSource.Instance,
    state: TelemetryIngestionBudgetState.Ok,
    percentUsed: 0,
    ...data,
  };
}

// Every signal of a scope, the given ones as given and the rest unbudgeted.
export function scope(
  signals: Array<TelemetryIngestionBudgetSignalStatus>,
  key?: { id: string; name: string },
): TelemetryIngestionBudgetScopeStatus {
  return {
    scope: key
      ? TelemetryIngestionBudgetScope.IngestionKey
      : TelemetryIngestionBudgetScope.Project,
    ingestionKeyId: key?.id,
    ingestionKeyName: key?.name,
    signals: TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
      (signal: TelemetryIngestionBudgetSignal) => {
        return (
          signals.find((each: TelemetryIngestionBudgetSignalStatus) => {
            return each.signal === signal;
          }) || unbudgeted(signal)
        );
      },
    ),
  };
}

export function status(data: {
  project?: Array<TelemetryIngestionBudgetSignalStatus>;
  ingestionKeys?: Array<TelemetryIngestionBudgetScopeStatus>;
  countersAvailable?: boolean;
  timezone?: string;
}): TelemetryIngestionBudgetStatus {
  return {
    dayStartsAt: "2026-11-09T00:00:00.000Z",
    resetsAt: "2026-11-10T00:00:00.000Z",
    resetTime: "00:00",
    timezone: data.timezone || "UTC",
    warningPercent: 80,
    countersAvailable: data.countersAvailable ?? true,
    project: scope(data.project || []),
    ingestionKeys: data.ingestionKeys || [],
  };
}

export const LOGS: TelemetryIngestionBudgetSignal = ProductType.Logs;
export const TRACES: TelemetryIngestionBudgetSignal = ProductType.Traces;

/*
 * What a status never holds in a place, put there by hostileAnswers: what a
 * proxy, an older server or a test double might answer instead (issue
 * #6486, where an offline test double answered {} and every explorer threw
 * while it drew).
 */
export const HOSTILE_VALUES: ReadonlyArray<unknown> = [
  undefined,
  null,
  {},
  [],
  "",
  "text",
  0,
  -1,
  1.5,
  true,
  false,
  [null],
  [{}],
  { signals: null },
  { signal: ProductType.Logs },
];

// Every path into a value, the value itself (the empty path) included.
const pathsOf: (value: unknown, path: Array<string>) => Array<Array<string>> = (
  value: unknown,
  path: Array<string>,
): Array<Array<string>> => {
  if (typeof value !== "object" || value === null) {
    return [path];
  }

  const paths: Array<Array<string>> = [path];

  for (const key of Object.keys(value)) {
    paths.push(
      ...pathsOf((value as Record<string, unknown>)[key], [...path, key]),
    );
  }

  return paths;
};

// A copy of the value with what is at the path replaced; the value untouched.
const replacedAt: (
  value: unknown,
  path: Array<string>,
  replacement: unknown,
) => unknown = (
  value: unknown,
  path: Array<string>,
  replacement: unknown,
): unknown => {
  if (path.length === 0) {
    return replacement;
  }

  // An earlier change replaced what the path went through: nothing to do.
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const [head, ...rest] = path as [string, ...Array<string>];
  const copy: Record<string, unknown> | Array<unknown> = Array.isArray(value)
    ? [...value]
    : { ...(value as Record<string, unknown>) };

  (copy as Record<string, unknown>)[head] = replacedAt(
    (value as Record<string, unknown>)[head],
    rest,
    replacement,
  );

  return copy;
};

/*
 * Answers drawn from a well-formed one, each with one to three of its fields
 * - anywhere in it, the whole answer included - replaced by one of
 * HOSTILE_VALUES. The same answers for the same seed on every run.
 */
export function hostileAnswers(data: {
  from: unknown;
  seed: number;
  count: number;
}): Array<unknown> {
  const random: SeededRandom = seededRandom(data.seed);
  const paths: Array<Array<string>> = pathsOf(data.from, []);
  const answers: Array<unknown> = [];

  for (let index: number = 0; index < data.count; index++) {
    const changes: number = 1 + random(3);
    let answer: unknown = data.from;

    for (let change: number = 0; change < changes; change++) {
      answer = replacedAt(
        answer,
        paths[random(paths.length)]!,
        HOSTILE_VALUES[random(HOSTILE_VALUES.length)],
      );
    }

    answers.push(answer);
  }

  return answers;
}
