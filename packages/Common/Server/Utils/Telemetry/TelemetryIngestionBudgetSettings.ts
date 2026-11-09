import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import GlobalConfigService from "../../Services/GlobalConfigService";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import {
  getTelemetryIngestionBudgetResetTime,
  getTelemetryIngestionBudgetTimezone,
  getTelemetryIngestionBudgetWarningPercent,
  hasAnyTelemetryIngestionBudgetSetting,
  readTelemetryIngestionBudgetStoredSettings,
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN,
  TELEMETRY_INGESTION_BUDGET_RESET_TIMEZONE_COLUMN,
  TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * The budget settings the ingest path reads, cached in process.
 *
 * Ingest is the hottest path in the product, and a Postgres read per request
 * for settings that change a few times a year would be the slowest thing on
 * it. So, like ingestion key policies (TelemetryIngestionKeyService), the
 * instance defaults and each project's overrides are kept for a minute: a
 * change applies at once on the server that saved it (the services clear
 * their entry on update) and within SETTINGS_TTL_MS on every other one.
 *
 * A project with no override of its own is cached too ("none"), so the
 * common case - nothing set anywhere - costs two map lookups per request and
 * no Redis round trip at all.
 *
 * A read that fails is answered as "no budget" (fail open, as the counters
 * do) and remembered for a few seconds, so a Postgres outage does not turn
 * into a query per ingest request.
 */

export const TELEMETRY_INGESTION_BUDGET_SETTINGS_TTL_MS: number = 60 * 1000;
const FAILED_READ_TTL_MS: number = 10 * 1000;
const PROJECT_CACHE_MAX_ENTRIES: number = 50_000;
const FAILED_READ_LOG_INTERVAL_MS: number = 60 * 1000;

export interface TelemetryIngestionBudgetInstanceSettings {
  // Every project's default limits; a project's override wins over them.
  budgets: TelemetryIngestionBudgetStoredSettings;
  warningPercent: number;
  resetTime: string;
  timezone: string;
}

interface CachedInstanceSettings {
  value: TelemetryIngestionBudgetInstanceSettings;
  expiresAt: number;
}

const toSelect: (columns: ReadonlyArray<string>) => Record<string, boolean> = (
  columns: ReadonlyArray<string>,
): Record<string, boolean> => {
  const select: Record<string, boolean> = {};

  for (const column of columns) {
    select[column] = true;
  }

  return select;
};

export const getDefaultTelemetryIngestionBudgetInstanceSettings: () => TelemetryIngestionBudgetInstanceSettings =
  (): TelemetryIngestionBudgetInstanceSettings => {
    return {
      budgets: readTelemetryIngestionBudgetStoredSettings(null),
      warningPercent: getTelemetryIngestionBudgetWarningPercent(null),
      resetTime: getTelemetryIngestionBudgetResetTime(null),
      timezone: getTelemetryIngestionBudgetTimezone(null),
    };
  };

// The instance settings a GlobalConfig row holds.
export const readTelemetryIngestionBudgetInstanceSettings: (
  row: unknown,
) => TelemetryIngestionBudgetInstanceSettings = (
  row: unknown,
): TelemetryIngestionBudgetInstanceSettings => {
  const record: Record<string, unknown> =
    row && typeof row === "object" ? (row as Record<string, unknown>) : {};

  return {
    budgets: readTelemetryIngestionBudgetStoredSettings(record),
    warningPercent: getTelemetryIngestionBudgetWarningPercent(
      record[TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN],
    ),
    resetTime: getTelemetryIngestionBudgetResetTime(
      record[TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN],
    ),
    timezone: getTelemetryIngestionBudgetTimezone(
      record[TELEMETRY_INGESTION_BUDGET_RESET_TIMEZONE_COLUMN],
    ),
  };
};

export default class TelemetryIngestionBudgetSettings {
  private static instance: CachedInstanceSettings | null = null;
  private static instanceLoad: Promise<TelemetryIngestionBudgetInstanceSettings> | null =
    null;

  private static projects: InMemoryTTLCache<TelemetryIngestionBudgetStoredSettings | null> =
    new InMemoryTTLCache(PROJECT_CACHE_MAX_ENTRIES);
  private static projectLoads: Map<
    string,
    Promise<TelemetryIngestionBudgetStoredSettings | null>
  > = new Map();

  private static failedReadLastLoggedAt: number = 0;

  /*
   * The instance's settings. `fresh` reads them from the database whatever
   * the cache holds: for checking a write against them, never on ingest.
   */
  public static async getInstanceSettings(options?: {
    fresh?: boolean | undefined;
  }): Promise<TelemetryIngestionBudgetInstanceSettings> {
    if (options?.fresh) {
      return this.loadInstanceSettings({ throwOnError: true });
    }

    const cached: CachedInstanceSettings | null = this.instance;

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Requests that miss together share one read.
    if (!this.instanceLoad) {
      this.instanceLoad = this.loadInstanceSettings().finally(() => {
        this.instanceLoad = null;
      });
    }

    return this.instanceLoad;
  }

  /*
   * A project's own overrides, or null when the instance admin set none for
   * it - the common case, cached like any other answer.
   */
  public static async getProjectOverrides(
    projectId: ObjectID,
    options?: { fresh?: boolean | undefined },
  ): Promise<TelemetryIngestionBudgetStoredSettings | null> {
    if (options?.fresh) {
      return this.loadProjectOverrides(projectId, { throwOnError: true });
    }

    const key: string = projectId.toString();
    const cached: TelemetryIngestionBudgetStoredSettings | null | undefined =
      this.projects.get(key);

    if (cached !== undefined) {
      return cached;
    }

    let load:
      | Promise<TelemetryIngestionBudgetStoredSettings | null>
      | undefined = this.projectLoads.get(key);

    if (!load) {
      load = this.loadProjectOverrides(projectId).finally(() => {
        this.projectLoads.delete(key);
      });
      this.projectLoads.set(key, load);
    }

    return load;
  }

  // Forget the instance settings: they were just saved on this server.
  public static clearInstanceCache(): void {
    this.instance = null;
  }

  // Forget one project's overrides, or every project's.
  public static clearProjectCache(projectId?: ObjectID | string | null): void {
    if (projectId) {
      this.projects.delete(projectId.toString());
      return;
    }

    this.projects.clear();
  }

  /*
   * throwOnError for a write being checked: a failed read must refuse the
   * write, not pass it as if nothing were set.
   */
  private static async loadInstanceSettings(options?: {
    throwOnError?: boolean | undefined;
  }): Promise<TelemetryIngestionBudgetInstanceSettings> {
    try {
      const row: GlobalConfig | null = await GlobalConfigService.findOneById({
        id: ObjectID.getZeroObjectID(),
        select: toSelect([
          ...TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
          TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN,
          TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN,
          TELEMETRY_INGESTION_BUDGET_RESET_TIMEZONE_COLUMN,
        ]) as never,
        props: { isRoot: true },
      });

      const settings: TelemetryIngestionBudgetInstanceSettings =
        readTelemetryIngestionBudgetInstanceSettings(row);

      this.instance = {
        value: settings,
        expiresAt: Date.now() + TELEMETRY_INGESTION_BUDGET_SETTINGS_TTL_MS,
      };

      return settings;
    } catch (err) {
      if (options?.throwOnError) {
        throw err;
      }

      this.logFailedRead("the instance's ingestion budgets", err);

      const settings: TelemetryIngestionBudgetInstanceSettings =
        getDefaultTelemetryIngestionBudgetInstanceSettings();

      this.instance = {
        value: settings,
        expiresAt: Date.now() + FAILED_READ_TTL_MS,
      };

      return settings;
    }
  }

  private static async loadProjectOverrides(
    projectId: ObjectID,
    options?: { throwOnError?: boolean | undefined },
  ): Promise<TelemetryIngestionBudgetStoredSettings | null> {
    const key: string = projectId.toString();

    try {
      const row: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: toSelect(TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES) as never,
        props: { isRoot: true },
      });

      const settings: TelemetryIngestionBudgetStoredSettings =
        readTelemetryIngestionBudgetStoredSettings(row);
      const overrides: TelemetryIngestionBudgetStoredSettings | null =
        hasAnyTelemetryIngestionBudgetSetting(settings) ? settings : null;

      this.projects.set(
        key,
        overrides,
        TELEMETRY_INGESTION_BUDGET_SETTINGS_TTL_MS,
      );

      return overrides;
    } catch (err) {
      if (options?.throwOnError) {
        throw err;
      }

      this.logFailedRead(`project ${key}'s ingestion budgets`, err);
      this.projects.set(key, null, FAILED_READ_TTL_MS);
      return null;
    }
  }

  private static logFailedRead(what: string, err: unknown): void {
    const now: number = Date.now();

    if (now - this.failedReadLastLoggedAt < FAILED_READ_LOG_INTERVAL_MS) {
      return;
    }

    this.failedReadLastLoggedAt = now;
    logger.warn(
      `TelemetryIngestionBudgetSettings: could not read ${what}; telemetry is admitted without a budget until it can be read`,
    );
    logger.warn(err);
  }
}
