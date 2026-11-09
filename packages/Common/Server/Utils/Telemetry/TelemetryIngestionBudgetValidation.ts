import TelemetryIngestionBudgetSettings, {
  TelemetryIngestionBudgetInstanceSettings,
} from "./TelemetryIngestionBudgetSettings";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  formatTelemetryIngestionBudgetGB,
  formatTelemetryIngestionBudgetMBPerSecond,
  getTelemetryIngestionBudgetResetTime,
  getTelemetryIngestionBudgetResetTimeProblem,
  getTelemetryIngestionBudgetSignalWords,
  getTelemetryIngestionBudgetTimezoneProblem,
  getTelemetryIngestionBudgetValueProblem,
  getTelemetryIngestionBudgetWarningPercentProblem,
  normalizeTelemetryIngestionBudgetValue,
  resolveTelemetryIngestionBudget,
  TELEMETRY_INGESTION_BUDGET_COLUMNS,
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN,
  TELEMETRY_INGESTION_BUDGET_RESET_TIMEZONE_COLUMN,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN,
  telemetryIngestionBudgetGBToBytes,
  telemetryIngestionBudgetMBToBytes,
  TelemetryIngestionBudgetResolved,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStoredSettings,
  TelemetryIngestionBudgetValueKind,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * The write side of telemetry ingestion budgets: what may be saved, for the
 * three services that save them (GlobalConfigService, ProjectService and
 * TelemetryIngestionKeyService). The read side forgives anything a row holds
 * (TelemetryIngestionBudget's readers treat garbage as "not set"); this is
 * strict, so nothing it has to forgive can be written through the API.
 */

/*
 * "Touched" is present in the patch with a value that is not undefined: an
 * explicit null is how a cleared form field arrives, and clears the value.
 */
const isTouched: (data: Record<string, unknown>, key: string) => boolean = (
  data: Record<string, unknown>,
  key: string,
): boolean => {
  return (
    Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined
  );
};

export const isTelemetryIngestionBudgetColumnTouched: (
  data: Record<string, unknown>,
) => boolean = (data: Record<string, unknown>): boolean => {
  return TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES.some(
    (column: string): boolean => {
      return isTouched(data, column);
    },
  );
};

export const isTelemetryIngestionBudgetInstanceSettingTouched: (
  data: Record<string, unknown>,
) => boolean = (data: Record<string, unknown>): boolean => {
  return (
    isTelemetryIngestionBudgetColumnTouched(data) ||
    [
      TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN,
      TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN,
      TELEMETRY_INGESTION_BUDGET_RESET_TIMEZONE_COLUMN,
    ].some((column: string): boolean => {
      return isTouched(data, column);
    })
  );
};

export default class TelemetryIngestionBudgetValidation {
  /*
   * Check and normalize every budget and rate column a write touches, in
   * place. allowZero only on a project, where 0 is "no limit for this
   * project" (an exemption from the instance default).
   */
  public static applyBudgetColumnRules(
    data: Record<string, unknown>,
    options: { allowZero: boolean },
  ): void {
    for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
      const columns: {
        dailyBudgetInGB: string;
        rateLimitInMBPerSecond: string;
      } = TELEMETRY_INGESTION_BUDGET_COLUMNS[signal];

      const pairs: Array<[string, TelemetryIngestionBudgetValueKind]> = [
        [
          columns.dailyBudgetInGB,
          TelemetryIngestionBudgetValueKind.DailyBudget,
        ],
        [
          columns.rateLimitInMBPerSecond,
          TelemetryIngestionBudgetValueKind.RateLimit,
        ],
      ];

      for (const [column, kind] of pairs) {
        if (!isTouched(data, column)) {
          continue;
        }

        const problem: string | null = getTelemetryIngestionBudgetValueProblem({
          value: data[column],
          kind: kind,
          allowZero: options.allowZero,
        });

        if (problem) {
          throw new BadDataException(
            `${this.describeColumn(signal, kind)}: ${problem}`,
          );
        }

        data[column] = normalizeTelemetryIngestionBudgetValue(data[column]);
      }
    }
  }

  // Check and normalize the instance-wide warning threshold and reset time.
  public static applyInstanceSettingRules(data: Record<string, unknown>): void {
    const checks: Array<[string, (value: unknown) => string | null]> = [
      [
        TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN,
        getTelemetryIngestionBudgetWarningPercentProblem,
      ],
      [
        TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN,
        getTelemetryIngestionBudgetResetTimeProblem,
      ],
      [
        TELEMETRY_INGESTION_BUDGET_RESET_TIMEZONE_COLUMN,
        getTelemetryIngestionBudgetTimezoneProblem,
      ],
    ];

    for (const [column, getProblem] of checks) {
      if (!isTouched(data, column)) {
        continue;
      }

      const problem: string | null = getProblem(data[column]);

      if (problem) {
        throw new BadDataException(problem);
      }

      const value: unknown = data[column];

      if (value === null || value === "") {
        data[column] = null;
      } else if (column === TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN) {
        data[column] = Number(value);
      } else if (column === TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN) {
        // "9:30" is stored as "09:30", as it is shown.
        data[column] = getTelemetryIngestionBudgetResetTime(value);
      } else if (typeof value === "string") {
        data[column] = value.trim();
      }
    }
  }

  /*
   * A key's budgets only subdivide its project's: refuse a write that would
   * give a key more than the project may send, for the signals it touches.
   * The project's limits are read fresh, not from the ingest cache, so a
   * budget the instance admin lowered a moment ago is the one compared.
   */
  public static async assertIngestionKeyBudgetsWithinProject(data: {
    projectId: ObjectID;
    patch: Record<string, unknown>;
  }): Promise<void> {
    if (!isTelemetryIngestionBudgetColumnTouched(data.patch)) {
      return;
    }

    const instance: TelemetryIngestionBudgetInstanceSettings =
      await TelemetryIngestionBudgetSettings.getInstanceSettings({
        fresh: true,
      });
    const project: TelemetryIngestionBudgetStoredSettings | null =
      await TelemetryIngestionBudgetSettings.getProjectOverrides(
        data.projectId,
        { fresh: true },
      );

    for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
      const resolved: TelemetryIngestionBudgetResolved =
        resolveTelemetryIngestionBudget({
          signal: signal,
          instance: instance.budgets,
          project: project,
          ingestionKey: null,
        });
      const columns: {
        dailyBudgetInGB: string;
        rateLimitInMBPerSecond: string;
      } = TELEMETRY_INGESTION_BUDGET_COLUMNS[signal];

      const daily: unknown = data.patch[columns.dailyBudgetInGB];

      if (
        typeof daily === "number" &&
        resolved.project.dailyBudget.bytes !== null &&
        telemetryIngestionBudgetGBToBytes(daily) >
          resolved.project.dailyBudget.bytes
      ) {
        throw new BadDataException(
          `This key's daily ${getTelemetryIngestionBudgetSignalWords(
            signal,
          )} budget (${formatTelemetryIngestionBudgetGB(
            telemetryIngestionBudgetGBToBytes(daily),
          )}) is more than the project's (${formatTelemetryIngestionBudgetGB(
            resolved.project.dailyBudget.bytes,
          )}). A key's budget can only subdivide its project's: set ${formatTelemetryIngestionBudgetGB(
            resolved.project.dailyBudget.bytes,
          )} or less, or leave it empty to use the project's.`,
        );
      }

      const rate: unknown = data.patch[columns.rateLimitInMBPerSecond];

      if (
        typeof rate === "number" &&
        resolved.project.rateLimit.bytes !== null &&
        telemetryIngestionBudgetMBToBytes(rate) >
          resolved.project.rateLimit.bytes
      ) {
        throw new BadDataException(
          `This key's ${getTelemetryIngestionBudgetSignalWords(
            signal,
          )} rate limit (${formatTelemetryIngestionBudgetMBPerSecond(
            telemetryIngestionBudgetMBToBytes(rate),
          )}) is more than the project's (${formatTelemetryIngestionBudgetMBPerSecond(
            resolved.project.rateLimit.bytes,
          )}). A key's limit can only subdivide its project's: set ${formatTelemetryIngestionBudgetMBPerSecond(
            resolved.project.rateLimit.bytes,
          )} or less, or leave it empty to use the project's.`,
        );
      }
    }
  }

  private static describeColumn(
    signal: TelemetryIngestionBudgetSignal,
    kind: TelemetryIngestionBudgetValueKind,
  ): string {
    const words: string = getTelemetryIngestionBudgetSignalWords(signal);
    const capitalized: string = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

    return kind === TelemetryIngestionBudgetValueKind.DailyBudget
      ? `${capitalized} daily budget`
      : `${capitalized} rate limit`;
  }
}
