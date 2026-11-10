import TelemetryIngestionKeyService from "../../Services/TelemetryIngestionKeyService";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import logger from "../Logger";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetDayCounters,
  TelemetryIngestionBudgetDayKeyParts,
} from "./TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings, {
  TelemetryIngestionBudgetInstanceSettings,
} from "./TelemetryIngestionBudgetSettings";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ObjectID from "../../../Types/ObjectID";
import {
  computeTelemetryIngestionBudgetPercentUsed,
  getTelemetryIngestionBudgetDay,
  getTelemetryIngestionBudgetSignalSlug,
  getTelemetryIngestionBudgetState,
  hasAnyTelemetryIngestionBudgetSetting,
  readTelemetryIngestionBudgetStoredSettings,
  resolveTelemetryIngestionBudget,
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TelemetryIngestionBudgetDay,
  TelemetryIngestionBudgetResolved,
  TelemetryIngestionBudgetResolvedScope,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * Today's ingestion budgets for one project, as the status API answers them
 * (Project Settings > Telemetry & APM > Usage, the explorers' budget banner,
 * and the Admin Dashboard's project page): every signal's budget and rate,
 * where each was set, and what the counters say - for the project and for
 * each of its ingestion keys that has a budget of its own.
 *
 * Read fresh from the database, not from the ingest cache: this answers a
 * person who may have just saved a budget. A counter that cannot be read is
 * null, never 0.
 */

const SELECT_KEY_BUDGETS: Record<string, boolean> = Object.fromEntries([
  ["_id", true],
  ["name", true],
  ...TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES.map(
    (column: string): [string, boolean] => {
      return [column, true];
    },
  ),
]);

interface BudgetedKey {
  id: string;
  name: string;
  budgets: TelemetryIngestionBudgetStoredSettings;
}

// One signal's status in one scope, from its limits and its counters. Pure.
export const buildTelemetryIngestionBudgetSignalStatus: (data: {
  signal: TelemetryIngestionBudgetSignal;
  limits: TelemetryIngestionBudgetResolvedScope;
  counters: TelemetryIngestionBudgetDayCounters | null;
  warningPercent: number;
}) => TelemetryIngestionBudgetSignalStatus = (data: {
  signal: TelemetryIngestionBudgetSignal;
  limits: TelemetryIngestionBudgetResolvedScope;
  counters: TelemetryIngestionBudgetDayCounters | null;
  warningPercent: number;
}): TelemetryIngestionBudgetSignalStatus => {
  const counters: TelemetryIngestionBudgetDayCounters | null = data.counters;
  const usedBytes: number | null = counters ? counters.usedBytes : null;
  const dailyBudgetBytes: number | null = data.limits.dailyBudget.bytes;

  return {
    signal: data.signal,
    dailyBudgetBytes: dailyBudgetBytes,
    dailyBudgetSource: data.limits.dailyBudget.source,
    rateLimitBytesPerSecond: data.limits.rateLimit.bytes,
    rateLimitSource: data.limits.rateLimit.source,
    usedBytes: usedBytes,
    droppedBytes: counters ? counters.droppedBytes : null,
    droppedRequests: counters ? counters.droppedRequests : null,
    throttledRequests: counters ? counters.throttledRequests : null,
    percentUsed: computeTelemetryIngestionBudgetPercentUsed({
      usedBytes: usedBytes,
      dailyBudgetBytes: dailyBudgetBytes,
    }),
    state: getTelemetryIngestionBudgetState({
      usedBytes: usedBytes,
      dailyBudgetBytes: dailyBudgetBytes,
      warningPercent: data.warningPercent,
    }),
    warningCrossedAt: counters?.warningCrossedAt
      ? counters.warningCrossedAt.toISOString()
      : null,
    exhaustedAt: counters?.exhaustedAt
      ? counters.exhaustedAt.toISOString()
      : null,
  };
};

// The limits a scope's signal resolves to, for the project or one key.
const getScopeLimits: (data: {
  signal: TelemetryIngestionBudgetSignal;
  instance: TelemetryIngestionBudgetInstanceSettings;
  project: TelemetryIngestionBudgetStoredSettings | null;
  key: BudgetedKey | null;
}) => TelemetryIngestionBudgetResolvedScope = (data: {
  signal: TelemetryIngestionBudgetSignal;
  instance: TelemetryIngestionBudgetInstanceSettings;
  project: TelemetryIngestionBudgetStoredSettings | null;
  key: BudgetedKey | null;
}): TelemetryIngestionBudgetResolvedScope => {
  const resolved: TelemetryIngestionBudgetResolved =
    resolveTelemetryIngestionBudget({
      signal: data.signal,
      instance: data.instance.budgets,
      project: data.project,
      ingestionKey: data.key ? data.key.budgets : null,
    });

  if (!data.key) {
    return resolved.project;
  }

  return (
    resolved.ingestionKey || {
      dailyBudget: { bytes: null, source: null },
      rateLimit: { bytes: null, source: null },
    }
  );
};

export default class TelemetryIngestionBudgetStatusReader {
  public static async getProjectStatus(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<TelemetryIngestionBudgetStatus> {
    const now: Date = data.now || new Date();

    const instance: TelemetryIngestionBudgetInstanceSettings =
      await this.readInstanceSettings();
    const project: TelemetryIngestionBudgetStoredSettings | null =
      await this.readProjectOverrides(data.projectId);
    const keys: Array<BudgetedKey> = await this.readBudgetedKeys(
      data.projectId,
    );

    const day: TelemetryIngestionBudgetDay = getTelemetryIngestionBudgetDay({
      now: now,
      resetTime: instance.resetTime,
      timezone: instance.timezone,
    });

    // Every scope's counters, project first, then each key, five signals each.
    const scopes: Array<{
      scope: TelemetryIngestionBudgetScope;
      scopeId: string;
      key: BudgetedKey | null;
    }> = [
      {
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: data.projectId.toString(),
        key: null,
      },
      ...keys.map(
        (
          key: BudgetedKey,
        ): {
          scope: TelemetryIngestionBudgetScope;
          scopeId: string;
          key: BudgetedKey | null;
        } => {
          return {
            scope: TelemetryIngestionBudgetScope.IngestionKey,
            scopeId: key.id,
            key: key,
          };
        },
      ),
    ];

    const dayKeys: Array<TelemetryIngestionBudgetDayKeyParts> = [];

    for (const scope of scopes) {
      for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
        dayKeys.push({
          dayId: day.id,
          scope: scope.scope,
          scopeId: scope.scopeId,
          signalSlug: getTelemetryIngestionBudgetSignalSlug(signal),
        });
      }
    }

    const counters: Array<TelemetryIngestionBudgetDayCounters> | null =
      await TelemetryIngestionBudgetCounter.readDayCounters(dayKeys);

    let index: number = 0;

    const statuses: Array<TelemetryIngestionBudgetScopeStatus> = scopes.map(
      (scope: {
        scope: TelemetryIngestionBudgetScope;
        scopeId: string;
        key: BudgetedKey | null;
      }): TelemetryIngestionBudgetScopeStatus => {
        const signals: Array<TelemetryIngestionBudgetSignalStatus> =
          TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
            (
              signal: TelemetryIngestionBudgetSignal,
            ): TelemetryIngestionBudgetSignalStatus => {
              const signalCounters: TelemetryIngestionBudgetDayCounters | null =
                counters ? counters[index] || null : null;
              index++;

              return buildTelemetryIngestionBudgetSignalStatus({
                signal: signal,
                limits: getScopeLimits({
                  signal: signal,
                  instance: instance,
                  project: project,
                  key: scope.key,
                }),
                counters: signalCounters,
                warningPercent: instance.warningPercent,
              });
            },
          );

        return {
          scope: scope.scope,
          ...(scope.key
            ? {
                ingestionKeyId: scope.key.id,
                ingestionKeyName: scope.key.name,
              }
            : {}),
          signals: signals,
        };
      },
    );

    return {
      dayStartsAt: day.startsAt.toISOString(),
      resetsAt: day.resetsAt.toISOString(),
      resetTime: instance.resetTime,
      timezone: instance.timezone,
      warningPercent: instance.warningPercent,
      countersAvailable: counters !== null,
      project: statuses[0]!,
      ingestionKeys: statuses.slice(1),
    };
  }

  // Whether any signal of a status is past its warning or used up.
  public static getWorstState(
    status: TelemetryIngestionBudgetScopeStatus,
  ): TelemetryIngestionBudgetState {
    const states: Array<TelemetryIngestionBudgetState> = status.signals.map(
      (signal: TelemetryIngestionBudgetSignalStatus) => {
        return signal.state;
      },
    );

    if (states.includes(TelemetryIngestionBudgetState.Exhausted)) {
      return TelemetryIngestionBudgetState.Exhausted;
    }

    if (states.includes(TelemetryIngestionBudgetState.Warning)) {
      return TelemetryIngestionBudgetState.Warning;
    }

    return TelemetryIngestionBudgetState.Ok;
  }

  private static async readInstanceSettings(): Promise<TelemetryIngestionBudgetInstanceSettings> {
    try {
      return await TelemetryIngestionBudgetSettings.getInstanceSettings({
        fresh: true,
      });
    } catch (err) {
      logger.warn(
        "TelemetryIngestionBudgetStatusReader: could not read the instance's ingestion budgets fresh; answering from the cache",
      );
      logger.warn(err);
      return TelemetryIngestionBudgetSettings.getInstanceSettings();
    }
  }

  private static async readProjectOverrides(
    projectId: ObjectID,
  ): Promise<TelemetryIngestionBudgetStoredSettings | null> {
    try {
      return await TelemetryIngestionBudgetSettings.getProjectOverrides(
        projectId,
        { fresh: true },
      );
    } catch (err) {
      logger.warn(
        `TelemetryIngestionBudgetStatusReader: could not read project ${projectId.toString()}'s ingestion budgets fresh; answering from the cache`,
      );
      logger.warn(err);
      return TelemetryIngestionBudgetSettings.getProjectOverrides(projectId);
    }
  }

  // The project's ingestion keys that set a budget or a rate of their own.
  private static async readBudgetedKeys(
    projectId: ObjectID,
  ): Promise<Array<BudgetedKey>> {
    const rows: Array<TelemetryIngestionKey> =
      await TelemetryIngestionKeyService.findBy({
        query: { projectId: projectId },
        select: SELECT_KEY_BUDGETS as never,
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    const keys: Array<BudgetedKey> = [];

    for (const row of rows) {
      const budgets: TelemetryIngestionBudgetStoredSettings =
        readTelemetryIngestionBudgetStoredSettings(row);

      if (!row.id || !hasAnyTelemetryIngestionBudgetSetting(budgets)) {
        continue;
      }

      keys.push({
        id: row.id.toString(),
        name: typeof row.name === "string" ? row.name : "",
        budgets: budgets,
      });
    }

    return keys.sort((a: BudgetedKey, b: BudgetedKey): number => {
      return a.name.localeCompare(b.name);
    });
  }
}
