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
import TelemetryIngestionTeamLabelBudget from "../../../Models/DatabaseModels/TelemetryIngestionTeamLabelBudget";
import TelemetryIngestionTeamLabelBudgetService from "../../Services/TelemetryIngestionTeamLabelBudgetService";
import ObjectID from "../../../Types/ObjectID";
import {
  computeTelemetryIngestionBudgetPercentUsed,
  getTelemetryIngestionBudgetDay,
  getTelemetryIngestionBudgetSignalSlug,
  getTelemetryIngestionBudgetState,
  hasAnyTelemetryIngestionBudgetSetting,
  readTelemetryIngestionBudgetStoredSettings,
  resolveTelemetryIngestionBudget,
  resolveTelemetryIngestionTeamLabelBudget,
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_COLUMNS,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS,
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

// A team's or a label's budget (#6386), as the status names it.
interface BudgetedTeamOrLabel {
  scope: TelemetryIngestionBudgetScope;
  // The team's id, or the label's.
  id: string;
  name: string;
  color: string | null;
  budgets: TelemetryIngestionBudgetStoredSettings;
}

const SELECT_TEAM_LABEL_BUDGETS: Record<string, unknown> = Object.fromEntries([
  ["_id", true],
  ["teamId", true],
  ["labelId", true],
  ["team", { name: true }],
  ["label", { name: true, color: true }],
  ...TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS.map(
    (signal: TelemetryIngestionBudgetSignal): [string, boolean] => {
      return [TELEMETRY_INGESTION_BUDGET_COLUMNS[signal].dailyBudgetInGB, true];
    },
  ),
]);

/*
 * The limits a team's or a label's signal resolves to: its own daily
 * budget, held to the project's, and no rate (they have none).
 */
const getTeamLabelLimits: (data: {
  signal: TelemetryIngestionBudgetSignal;
  instance: TelemetryIngestionBudgetInstanceSettings;
  project: TelemetryIngestionBudgetStoredSettings | null;
  owner: BudgetedTeamOrLabel;
}) => TelemetryIngestionBudgetResolvedScope = (data: {
  signal: TelemetryIngestionBudgetSignal;
  instance: TelemetryIngestionBudgetInstanceSettings;
  project: TelemetryIngestionBudgetStoredSettings | null;
  owner: BudgetedTeamOrLabel;
}): TelemetryIngestionBudgetResolvedScope => {
  const resolved: TelemetryIngestionBudgetResolved =
    resolveTelemetryIngestionBudget({
      signal: data.signal,
      instance: data.instance.budgets,
      project: data.project,
      ingestionKey: null,
    });

  return {
    dailyBudget: resolveTelemetryIngestionTeamLabelBudget({
      scope: data.owner.scope,
      ownDailyBudgetInGB: data.owner.budgets[data.signal].dailyBudgetInGB,
      projectDailyBudget: resolved.project.dailyBudget,
    }),
    rateLimit: { bytes: null, source: null },
  };
};

// A scope of the status, and the signals it is shown with.
interface StatusScope {
  scope: TelemetryIngestionBudgetScope;
  scopeId: string;
  key: BudgetedKey | null;
  owner: BudgetedTeamOrLabel | null;
  signals: ReadonlyArray<TelemetryIngestionBudgetSignal>;
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
    const owners: Array<BudgetedTeamOrLabel> =
      await this.readBudgetedTeamsAndLabels(data.projectId);

    const day: TelemetryIngestionBudgetDay = getTelemetryIngestionBudgetDay({
      now: now,
      resetTime: instance.resetTime,
      timezone: instance.timezone,
    });

    /*
     * Every scope's counters, project first, then each key, five signals
     * each, then each team and label, with the four signals they budget.
     */
    const scopes: Array<StatusScope> = [
      {
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: data.projectId.toString(),
        key: null,
        owner: null,
        signals: TELEMETRY_INGESTION_BUDGET_SIGNALS,
      },
      ...keys.map((key: BudgetedKey): StatusScope => {
        return {
          scope: TelemetryIngestionBudgetScope.IngestionKey,
          scopeId: key.id,
          key: key,
          owner: null,
          signals: TELEMETRY_INGESTION_BUDGET_SIGNALS,
        };
      }),
      ...owners.map((owner: BudgetedTeamOrLabel): StatusScope => {
        return {
          scope: owner.scope,
          scopeId: owner.id,
          key: null,
          owner: owner,
          signals: TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS,
        };
      }),
    ];

    const dayKeys: Array<TelemetryIngestionBudgetDayKeyParts> = [];

    for (const scope of scopes) {
      for (const signal of scope.signals) {
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
      (scope: StatusScope): TelemetryIngestionBudgetScopeStatus => {
        const signals: Array<TelemetryIngestionBudgetSignalStatus> =
          scope.signals.map(
            (
              signal: TelemetryIngestionBudgetSignal,
            ): TelemetryIngestionBudgetSignalStatus => {
              const signalCounters: TelemetryIngestionBudgetDayCounters | null =
                counters ? counters[index] || null : null;
              index++;

              return buildTelemetryIngestionBudgetSignalStatus({
                signal: signal,
                limits: scope.owner
                  ? getTeamLabelLimits({
                      signal: signal,
                      instance: instance,
                      project: project,
                      owner: scope.owner,
                    })
                  : getScopeLimits({
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
          ...(scope.owner &&
          scope.owner.scope === TelemetryIngestionBudgetScope.Team
            ? { teamId: scope.owner.id, teamName: scope.owner.name }
            : {}),
          ...(scope.owner &&
          scope.owner.scope === TelemetryIngestionBudgetScope.Label
            ? {
                labelId: scope.owner.id,
                labelName: scope.owner.name,
                ...(scope.owner.color ? { labelColor: scope.owner.color } : {}),
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
      ingestionKeys: statuses.slice(1, 1 + keys.length),
      teamsAndLabels: statuses.slice(1 + keys.length),
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

  /*
   * The project's teams and labels with a budget of their own (#6386),
   * teams first, each by name.
   */
  private static async readBudgetedTeamsAndLabels(
    projectId: ObjectID,
  ): Promise<Array<BudgetedTeamOrLabel>> {
    const rows: Array<TelemetryIngestionTeamLabelBudget> =
      await TelemetryIngestionTeamLabelBudgetService.findBy({
        query: { projectId: projectId },
        select: SELECT_TEAM_LABEL_BUDGETS as never,
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    const owners: Array<BudgetedTeamOrLabel> = [];

    for (const row of rows) {
      const budgets: TelemetryIngestionBudgetStoredSettings =
        readTelemetryIngestionBudgetStoredSettings(row);

      if (!hasAnyTelemetryIngestionBudgetSetting(budgets)) {
        continue;
      }

      if (row.teamId) {
        owners.push({
          scope: TelemetryIngestionBudgetScope.Team,
          id: row.teamId.toString(),
          name: typeof row.team?.name === "string" ? row.team.name : "",
          color: null,
          budgets: budgets,
        });
      } else if (row.labelId) {
        owners.push({
          scope: TelemetryIngestionBudgetScope.Label,
          id: row.labelId.toString(),
          name: typeof row.label?.name === "string" ? row.label.name : "",
          color: row.label?.color ? row.label.color.toString() : null,
          budgets: budgets,
        });
      }
    }

    return owners.sort(
      (a: BudgetedTeamOrLabel, b: BudgetedTeamOrLabel): number => {
        if (a.scope !== b.scope) {
          return a.scope === TelemetryIngestionBudgetScope.Team ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
      },
    );
  }
}
