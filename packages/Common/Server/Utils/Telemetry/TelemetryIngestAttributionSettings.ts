import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import ProjectService from "../../Services/ProjectService";
import TelemetryIngestionTeamLabelBudgetService from "../../Services/TelemetryIngestionTeamLabelBudgetService";
import type { OwnerTablePair } from "../../Types/Database/Permissions/OwnerTableRegistry";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import TelemetryReadScopeUtil from "./TelemetryReadScope";
import Project from "../../../Models/DatabaseModels/Project";
import TelemetryIngestionTeamLabelBudget from "../../../Models/DatabaseModels/TelemetryIngestionTeamLabelBudget";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import {
  hasAnyTelemetryIngestionBudgetSetting,
  readTelemetryIngestionBudgetStoredSettings,
  TELEMETRY_INGESTION_BUDGET_COLUMNS,
  TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import ArrayUtil from "../../../Utils/Array";

/*
 * What the telemetry worker needs to know about a project to attribute its
 * batches (TelemetryIngestAttribution), cached in process:
 *
 *   - whether it publishes its usage as metrics (Project.publishTelemetry-
 *     UsageMetrics, issue #6355);
 *   - its team and label budgets (issue #6386), and the resources each one
 *     counts: every service, host, cluster and other resource telemetry is
 *     filed under (a row's primaryEntityId) that the team owns or that
 *     carries the label (#10101).
 *
 * WHO OWNS A RESOURCE, AND WHICH LABELS IT CARRIES, is decided as the rest
 * of the product decides it, from the same tables: the owner table
 * registry's kinds whose ids a telemetry row can name (canOwnTelemetry) -
 * the ones a role limited to its team's resources, or to some labels, reads
 * the telemetry of (ModelPermission.getReadScope) - each through its own
 * owner team table and its own labels. A kind added to the registry is
 * counted here too. Every read is pinned to the project: another project's
 * resources, owners and labels never count against its budgets.
 *
 * Ingest is the hottest path in the product, and most projects use neither,
 * so a project that does not costs two lookups in in-process sets per batch
 * and nothing else: which projects publish usage metrics, and which have a
 * team or label budget, are each read with ONE query for every project,
 * once a minute per server. Only a project in one of those sets is read on
 * its own, once a minute per server, for a project with budgets: its
 * budgets, then for each kind of resource (a few at a time) one query for
 * what the budgets' teams own and one for what carries the budgets' labels.
 *
 * NO BATCH WAITS FOR A READ AGAIN once something was read: what was read
 * last is served while the next read runs, and a read that fails keeps it,
 * tried again a few seconds later - a Postgres outage never turns into a
 * query per batch, nor into budgets that stop counting. Only the first read
 * of a project, or the first after its budgets were saved on this server
 * (forgetProject), is waited for, once for all of its batches, and a read
 * that started before the save stores nothing. A change applies at once on
 * the server that saved it and within a minute on every other, as the
 * project budgets do.
 */

export const TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS: number = 60 * 1000;
const FAILED_READ_TTL_MS: number = 10 * 1000;
/*
 * How long a project's attribution is kept with no read of it: one that
 * stops sending is forgotten after it, one that sends is read every minute.
 */
const PROJECT_KEPT_MS: number = 60 * 60 * 1000;
const PROJECT_CACHE_MAX_ENTRIES: number = 10_000;
const FAILED_READ_LOG_INTERVAL_MS: number = 60 * 1000;
// How many kinds of resource one project's read asks about at once.
const KIND_READ_CONCURRENCY: number = 3;

// A team's or a label's budget, as the worker holds it.
export interface TelemetryIngestTeamLabelBudget {
  scope: TelemetryIngestionBudgetScope;
  // The team's id, or the label's.
  scopeId: string;
  // Its own daily budgets, as stored (GB, or null for none).
  dailyBudgetsInGB: TelemetryIngestionBudgetStoredSettings;
}

export interface TelemetryIngestAttributionConfig {
  publishesUsageMetrics: boolean;
  budgets: Array<TelemetryIngestTeamLabelBudget>;
  /*
   * A resource's budgets, as indexes into `budgets`, by its id in lower case,
   * as the read scope compares ids (TelemetryReadScopeUtil.normalizeId):
   * every service, host, cluster or other resource a budget's team owns or
   * that carries a budget's label.
   */
  budgetsByResourceId: Map<string, Array<number>>;
}

/*
 * One kind of resource telemetry is filed under, as the owner table registry
 * holds it: its model's name, the service of its owner team rows and the
 * column they name it by, and its own service, whose rows carry its labels.
 */
export interface TelemetryIngestOwnerKind {
  kind: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ownerTeamService: { findAllBy: (findAllBy: any) => Promise<Array<any>> };
  fkColumn: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelService?: { findAllBy: (findAllBy: any) => Promise<Array<any>> };
}

// A project's attribution as last read, and when it is read again.
interface CachedProject {
  config: TelemetryIngestAttributionConfig | null;
  refreshAt: number;
  // Its budgets were saved on this server since: the next batch waits for a read.
  isForgotten: boolean;
}

// A read in flight: it stores what it read only while it is still the one.
interface Load<T> {
  promise: Promise<T>;
}

/*
 * A set of every project, read with one query: what was read last while
 * the next read runs, the first read waited for, and a read that fails
 * keeps what was read last.
 */
class ProjectSet {
  private cached: { value: Set<string>; expiresAt: number } | null = null;
  // What was read last, kept through forget(): a failed read falls back on it.
  private lastRead: Set<string> | null = null;
  private load: Load<Set<string>> | null = null;

  public constructor(
    private readonly what: string,
    private readonly read: () => Promise<Set<string>>,
    private readonly logFailedRead: (what: string, err: unknown) => void,
  ) {}

  public get(): Promise<Set<string>> {
    if (this.cached) {
      if (this.cached.expiresAt <= Date.now() && !this.load) {
        void this.start().promise;
      }

      return Promise.resolve(this.cached.value);
    }

    return (this.load || this.start()).promise;
  }

  // The next get() waits for a read, and a read in flight stores nothing.
  public forget(): void {
    this.cached = null;
    this.load = null;
  }

  // Forget everything: for tests.
  public clear(): void {
    this.forget();
    this.lastRead = null;
  }

  private start(): Load<Set<string>> {
    const load: Load<Set<string>> = {
      promise: Promise.resolve(new Set<string>()),
    };

    this.load = load;

    load.promise = (async (): Promise<Set<string>> => {
      let value: Set<string>;
      let isRead: boolean = true;

      try {
        value = await this.read();
      } catch (err) {
        this.logFailedRead(this.what, err);
        value = this.lastRead || new Set<string>();
        isRead = false;
      }

      // Forgotten meanwhile: what this read found is not stored.
      if (this.load === load) {
        this.load = null;
        this.cached = {
          value: value,
          expiresAt:
            Date.now() +
            (isRead
              ? TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS
              : FAILED_READ_TTL_MS),
        };

        if (isRead) {
          this.lastRead = value;
        }
      }

      return value;
    })();

    return load;
  }
}

const BUDGET_SELECT: Record<string, boolean> = Object.fromEntries([
  ["_id", true],
  ["teamId", true],
  ["labelId", true],
  ...TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS.map(
    (signal: TelemetryIngestionBudgetSignal): [string, boolean] => {
      return [TELEMETRY_INGESTION_BUDGET_COLUMNS[signal].dailyBudgetInGB, true];
    },
  ),
]);

export default class TelemetryIngestAttributionSettings {
  private static failedReadLastLoggedAt: number = 0;

  private static usageProjects: ProjectSet = new ProjectSet(
    "which projects publish their telemetry usage as metrics",
    async (): Promise<Set<string>> => {
      const projects: Array<Project> = await ProjectService.findAllBy({
        query: { publishTelemetryUsageMetrics: true },
        select: { _id: true },
        props: { isRoot: true },
      });

      return new Set<string>(
        projects
          .map((project: Project): string => {
            return project.id?.toString() || "";
          })
          .filter(Boolean),
      );
    },
    (what: string, err: unknown): void => {
      TelemetryIngestAttributionSettings.logFailedRead(what, err);
    },
  );

  private static budgetProjects: ProjectSet = new ProjectSet(
    "which projects have team or label budgets",
    async (): Promise<Set<string>> => {
      const budgets: Array<TelemetryIngestionTeamLabelBudget> =
        await TelemetryIngestionTeamLabelBudgetService.findAllBy({
          query: {},
          select: { projectId: true },
          props: { isRoot: true },
        });

      return new Set<string>(
        budgets
          .map((budget: TelemetryIngestionTeamLabelBudget): string => {
            return budget.projectId?.toString() || "";
          })
          .filter(Boolean),
      );
    },
    (what: string, err: unknown): void => {
      TelemetryIngestAttributionSettings.logFailedRead(what, err);
    },
  );

  private static projects: InMemoryTTLCache<CachedProject> =
    new InMemoryTTLCache(PROJECT_CACHE_MAX_ENTRIES);
  // The reads in flight, one a project.
  private static projectLoads: Map<
    string,
    Load<TelemetryIngestAttributionConfig | null>
  > = new Map();

  /*
   * A project's attribution settings, or null when it needs none: no usage
   * metrics and no team or label budget - most projects, which cost two set
   * lookups here.
   */
  public static async getProjectConfig(
    projectId: ObjectID | string,
  ): Promise<TelemetryIngestAttributionConfig | null> {
    const key: string = projectId.toString();

    const [usageProjects, budgetProjects]: [Set<string>, Set<string>] =
      await Promise.all([
        this.getUsageMetricProjects(),
        this.getTeamLabelBudgetProjects(),
      ]);

    const publishesUsageMetrics: boolean = usageProjects.has(key);
    const hasBudgets: boolean = budgetProjects.has(key);

    if (!publishesUsageMetrics && !hasBudgets) {
      return null;
    }

    if (!hasBudgets) {
      return {
        publishesUsageMetrics: true,
        budgets: [],
        budgetsByResourceId: new Map(),
      };
    }

    const budgets: TelemetryIngestAttributionConfig | null =
      await this.getProjectBudgets(key);

    if (!budgets && !publishesUsageMetrics) {
      return null;
    }

    return {
      publishesUsageMetrics: publishesUsageMetrics,
      budgets: budgets ? budgets.budgets : [],
      budgetsByResourceId: budgets ? budgets.budgetsByResourceId : new Map(),
    };
  }

  /*
   * Whether a project's batches are attributed at all, from the two sets of
   * every project alone - never a read of the project's own budgets: what
   * the request path asks (TelemetryIngestAttribution.getRequestBytesToShare).
   */
  public static async isAttributedProject(
    projectId: ObjectID | string,
  ): Promise<boolean> {
    const key: string = projectId.toString();

    const [usageProjects, budgetProjects]: [Set<string>, Set<string>] =
      await Promise.all([
        this.getUsageMetricProjects(),
        this.getTeamLabelBudgetProjects(),
      ]);

    return usageProjects.has(key) || budgetProjects.has(key);
  }

  /*
   * Forget what is cached about a project, on this server: its budgets, or
   * its usage metrics setting, were just saved. Its next batch waits for a
   * read, and a read already in flight stores nothing; what was read last
   * stays, should that read fail.
   */
  public static forgetProject(
    projectId: ObjectID | string | null | undefined,
  ): void {
    if (projectId) {
      const key: string = projectId.toString();
      const cached: CachedProject | undefined = this.projects.get(key);

      if (cached) {
        this.projects.set(
          key,
          { ...cached, isForgotten: true },
          PROJECT_KEPT_MS,
        );
      }

      this.projectLoads.delete(key);
    }

    this.usageProjects.forget();
    this.budgetProjects.forget();
  }

  // Forget everything: for tests.
  public static clearCaches(): void {
    this.projects.clear();
    this.projectLoads.clear();
    this.usageProjects.clear();
    this.budgetProjects.clear();
  }

  // The projects that publish their usage as metrics.
  public static async getUsageMetricProjects(): Promise<Set<string>> {
    return this.usageProjects.get();
  }

  // The projects with at least one team or label budget.
  public static async getTeamLabelBudgetProjects(): Promise<Set<string>> {
    return this.budgetProjects.get();
  }

  /*
   * The kinds of resource telemetry is filed under, as the owner table
   * registry holds them (canOwnTelemetry): Service, Host, KubernetesCluster,
   * IoTFleet, ... - the kinds the telemetry read scope works out ownership
   * and labels over (ModelPermission.getTelemetryResourceTypes).
   *
   * The registry is read when first needed rather than imported, as every
   * other reader of it does: it imports every owner service, and this file
   * is reached from ProjectService, so an import here could hand the
   * registry services that are not loaded yet.
   */
  public static getTelemetryOwnerKinds(): Array<TelemetryIngestOwnerKind> {
    const registry: Map<string, OwnerTablePair> =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Types/Database/Permissions/OwnerTableRegistry").default;

    return Array.from(registry.entries())
      .filter(([, entry]: [string, OwnerTablePair]): boolean => {
        return Boolean(entry.canOwnTelemetry);
      })
      .map(
        ([kind, entry]: [string, OwnerTablePair]): TelemetryIngestOwnerKind => {
          return {
            kind: kind,
            ownerTeamService: entry.ownerTeamService,
            fkColumn: entry.fkColumn,
            modelService: entry.modelService,
          };
        },
      );
  }

  // Exported through the class for tests: the reads, uncached.
  public static async readProjectBudgets(
    projectId: ObjectID,
  ): Promise<TelemetryIngestAttributionConfig | null> {
    const rows: Array<TelemetryIngestionTeamLabelBudget> =
      await TelemetryIngestionTeamLabelBudgetService.findAllBy({
        query: { projectId: projectId },
        select: BUDGET_SELECT as never,
        props: { isRoot: true },
      });

    const budgets: Array<TelemetryIngestTeamLabelBudget> = [];

    for (const row of rows) {
      const dailyBudgetsInGB: TelemetryIngestionBudgetStoredSettings =
        readTelemetryIngestionBudgetStoredSettings(row);

      if (!hasAnyTelemetryIngestionBudgetSetting(dailyBudgetsInGB)) {
        continue;
      }

      if (row.teamId) {
        budgets.push({
          scope: TelemetryIngestionBudgetScope.Team,
          scopeId: row.teamId.toString(),
          dailyBudgetsInGB: dailyBudgetsInGB,
        });
      } else if (row.labelId) {
        budgets.push({
          scope: TelemetryIngestionBudgetScope.Label,
          scopeId: row.labelId.toString(),
          dailyBudgetsInGB: dailyBudgetsInGB,
        });
      }
    }

    if (budgets.length === 0) {
      return null;
    }

    // The budgets' indexes, by their team's or label's id in lower case.
    const teamIndexes: Map<string, number> = new Map();
    const labelIndexes: Map<string, number> = new Map();

    budgets.forEach(
      (budget: TelemetryIngestTeamLabelBudget, index: number): void => {
        (budget.scope === TelemetryIngestionBudgetScope.Team
          ? teamIndexes
          : labelIndexes
        ).set(TelemetryReadScopeUtil.normalizeId(budget.scopeId), index);
      },
    );

    const toIds: (keys: Map<string, number>) => Array<ObjectID> = (
      keys: Map<string, number>,
    ): Array<ObjectID> => {
      return Array.from(keys.keys()).map((id: string): ObjectID => {
        return new ObjectID(id);
      });
    };

    const teamIds: Array<ObjectID> = toIds(teamIndexes);
    const labelIds: Array<ObjectID> = toIds(labelIndexes);

    const budgetsByResourceId: Map<string, Array<number>> = new Map();

    const add: (resourceId: unknown, index: number | undefined) => void = (
      resourceId: unknown,
      index: number | undefined,
    ): void => {
      if (!resourceId || index === undefined) {
        return;
      }

      const key: string = TelemetryReadScopeUtil.normalizeId(
        resourceId as ObjectID | string,
      );
      const indexes: Array<number> = budgetsByResourceId.get(key) || [];

      if (!indexes.includes(index)) {
        indexes.push(index);
        indexes.sort((a: number, b: number): number => {
          return a - b;
        });
      }

      budgetsByResourceId.set(key, indexes);
    };

    const indexOf: (
      keys: Map<string, number>,
      id: unknown,
    ) => number | undefined = (
      keys: Map<string, number>,
      id: unknown,
    ): number | undefined => {
      return id
        ? keys.get(TelemetryReadScopeUtil.normalizeId(id as ObjectID | string))
        : undefined;
    };

    // Each kind of resource, a few at a time: what its owners, then its labels, count.
    await ArrayUtil.mapWithConcurrency(
      this.getTelemetryOwnerKinds(),
      KIND_READ_CONCURRENCY,
      async (kind: TelemetryIngestOwnerKind): Promise<void> => {
        if (teamIds.length > 0) {
          // What the budgets' teams own of this kind: one read for every team.
          const owners: Array<Record<string, unknown>> =
            await kind.ownerTeamService.findAllBy({
              query: {
                projectId: projectId,
                teamId: QueryHelper.any(teamIds),
              },
              select: { [kind.fkColumn]: true, teamId: true },
              sort: { _id: SortOrder.Ascending },
              props: { isRoot: true },
            });

          for (const owner of owners) {
            add(owner[kind.fkColumn], indexOf(teamIndexes, owner["teamId"]));
          }
        }

        if (labelIds.length > 0 && kind.modelService) {
          /*
           * What carries a budget's label, of this kind: one read for every
           * label, each resource read with all its labels.
           */
          const resources: Array<Record<string, unknown>> =
            await kind.modelService.findAllBy({
              query: { projectId: projectId, labels: labelIds },
              select: { _id: true, labels: { _id: true } },
              sort: { _id: SortOrder.Ascending },
              props: { isRoot: true },
            });

          for (const resource of resources) {
            const labels: Array<Record<string, unknown>> = Array.isArray(
              resource["labels"],
            )
              ? (resource["labels"] as Array<Record<string, unknown>>)
              : [];

            for (const label of labels) {
              add(
                resource["_id"] || resource["id"],
                indexOf(labelIndexes, label?.["_id"] || label?.["id"]),
              );
            }
          }
        }
      },
    );

    return {
      publishesUsageMetrics: false,
      budgets: budgets,
      budgetsByResourceId: budgetsByResourceId,
    };
  }

  /*
   * A project's team and label budgets, and the resources each counts, or
   * null when it has none with a daily budget set: what was read last while
   * the next read runs, the first read (and the first after a save) waited
   * for, once for every batch.
   */
  private static async getProjectBudgets(
    projectId: string,
  ): Promise<TelemetryIngestAttributionConfig | null> {
    const cached: CachedProject | undefined = this.projects.get(projectId);

    if (cached && !cached.isForgotten) {
      if (cached.refreshAt <= Date.now() && !this.projectLoads.has(projectId)) {
        // Read again behind the batches, which keep what was read last.
        void this.startProjectLoad(projectId, cached).promise;
      }

      return cached.config;
    }

    const load: Load<TelemetryIngestAttributionConfig | null> =
      this.projectLoads.get(projectId) ||
      this.startProjectLoad(projectId, cached || null);

    return load.promise;
  }

  private static startProjectLoad(
    projectId: string,
    previous: CachedProject | null,
  ): Load<TelemetryIngestAttributionConfig | null> {
    const load: Load<TelemetryIngestAttributionConfig | null> = {
      promise: Promise.resolve(null),
    };

    this.projectLoads.set(projectId, load);

    load.promise =
      (async (): Promise<TelemetryIngestAttributionConfig | null> => {
        let config: TelemetryIngestAttributionConfig | null;
        let refreshInMs: number = TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS;

        try {
          config = await this.readProjectBudgets(new ObjectID(projectId));
        } catch (err) {
          this.logFailedRead(
            `project ${projectId}'s team and label budgets`,
            err,
          );
          // What was read last stays, tried again in a few seconds.
          config = previous ? previous.config : null;
          refreshInMs = FAILED_READ_TTL_MS;
        }

        // Its budgets were saved meanwhile on this server: this read is not stored.
        if (this.projectLoads.get(projectId) === load) {
          this.projectLoads.delete(projectId);
          this.projects.set(
            projectId,
            {
              config: config,
              refreshAt: Date.now() + refreshInMs,
              isForgotten: false,
            },
            PROJECT_KEPT_MS,
          );
        }

        return config;
      })();

    return load;
  }

  private static logFailedRead(what: string, err: unknown): void {
    const now: number = Date.now();

    if (now - this.failedReadLastLoggedAt < FAILED_READ_LOG_INTERVAL_MS) {
      return;
    }

    this.failedReadLastLoggedAt = now;
    logger.warn(
      `TelemetryIngestAttributionSettings: could not read ${what}; telemetry keeps arriving as it was attributed before`,
    );
    logger.warn(err);
  }
}
