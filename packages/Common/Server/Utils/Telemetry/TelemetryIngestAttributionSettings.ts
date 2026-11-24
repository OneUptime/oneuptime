import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import ProjectService from "../../Services/ProjectService";
import ServiceOwnerTeamService from "../../Services/ServiceOwnerTeamService";
import ServiceService from "../../Services/ServiceService";
import TelemetryIngestionTeamLabelBudgetService from "../../Services/TelemetryIngestionTeamLabelBudgetService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import Project from "../../../Models/DatabaseModels/Project";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceOwnerTeam from "../../../Models/DatabaseModels/ServiceOwnerTeam";
import TelemetryIngestionTeamLabelBudget from "../../../Models/DatabaseModels/TelemetryIngestionTeamLabelBudget";
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

/*
 * What the telemetry worker needs to know about a project to attribute its
 * batches (TelemetryIngestAttribution), cached in process:
 *
 *   - whether it publishes its usage as metrics (Project.publishTelemetry-
 *     UsageMetrics, issue #6355);
 *   - its team and label budgets (issue #6386), and the services each one
 *     counts: the services a team owns, and the services that carry a label.
 *
 * Ingest is the hottest path in the product, and most projects use neither,
 * so a project that does not costs two lookups in in-process sets per batch
 * and nothing else: which projects publish usage metrics, and which have a
 * team or label budget, are each read with ONE query for every project,
 * once a minute per server. Only a project in one of those sets is read on
 * its own, once a minute per server, for a project with budgets: its
 * budgets, the services its budgets' teams own (one query for every team),
 * and the services that carry each of its budgets' labels (one query a
 * label).
 *
 * A change applies at once on the server that saved it (forgetProject) and
 * within a minute on every other, as the project budgets do. A read that
 * fails keeps what was read last (or nothing, the first time) for a few
 * seconds: a Postgres outage never turns into a query per batch.
 */

export const TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS: number = 60 * 1000;
const FAILED_READ_TTL_MS: number = 10 * 1000;
const PROJECT_CACHE_MAX_ENTRIES: number = 10_000;
const FAILED_READ_LOG_INTERVAL_MS: number = 60 * 1000;

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
  // A service's budgets, as indexes into `budgets`.
  budgetsByServiceId: Map<string, Array<number>>;
}

interface CachedSet {
  value: Set<string>;
  expiresAt: number;
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
  private static usageProjects: CachedSet | null = null;
  private static usageProjectsLoad: Promise<Set<string>> | null = null;

  private static budgetProjects: CachedSet | null = null;
  private static budgetProjectsLoad: Promise<Set<string>> | null = null;

  private static projects: InMemoryTTLCache<TelemetryIngestAttributionConfig | null> =
    new InMemoryTTLCache(PROJECT_CACHE_MAX_ENTRIES);
  private static projectLoads: Map<
    string,
    Promise<TelemetryIngestAttributionConfig | null>
  > = new Map();

  private static failedReadLastLoggedAt: number = 0;

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
        budgetsByServiceId: new Map(),
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
      budgetsByServiceId: budgets ? budgets.budgetsByServiceId : new Map(),
    };
  }

  /*
   * Forget what is cached about a project, on this server: its budgets, or
   * its usage metrics setting, were just saved.
   */
  public static forgetProject(
    projectId: ObjectID | string | null | undefined,
  ): void {
    if (projectId) {
      this.projects.delete(projectId.toString());
    }

    this.usageProjects = null;
    this.budgetProjects = null;
  }

  // Forget everything: for tests.
  public static clearCaches(): void {
    this.projects.clear();
    this.projectLoads.clear();
    this.usageProjects = null;
    this.usageProjectsLoad = null;
    this.budgetProjects = null;
    this.budgetProjectsLoad = null;
  }

  // The projects that publish their usage as metrics.
  public static async getUsageMetricProjects(): Promise<Set<string>> {
    const cached: CachedSet | null = this.usageProjects;

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (!this.usageProjectsLoad) {
      this.usageProjectsLoad = this.loadSet({
        what: "which projects publish their telemetry usage as metrics",
        previous: cached,
        load: async (): Promise<Set<string>> => {
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
        store: (value: CachedSet): void => {
          this.usageProjects = value;
        },
      }).finally(() => {
        this.usageProjectsLoad = null;
      });
    }

    return this.usageProjectsLoad;
  }

  // The projects with at least one team or label budget.
  public static async getTeamLabelBudgetProjects(): Promise<Set<string>> {
    const cached: CachedSet | null = this.budgetProjects;

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (!this.budgetProjectsLoad) {
      this.budgetProjectsLoad = this.loadSet({
        what: "which projects have team or label budgets",
        previous: cached,
        load: async (): Promise<Set<string>> => {
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
        store: (value: CachedSet): void => {
          this.budgetProjects = value;
        },
      }).finally(() => {
        this.budgetProjectsLoad = null;
      });
    }

    return this.budgetProjectsLoad;
  }

  /*
   * A project's team and label budgets, and the services each counts, or
   * null when it has none with a daily budget set.
   */
  private static async getProjectBudgets(
    projectId: string,
  ): Promise<TelemetryIngestAttributionConfig | null> {
    const cached: TelemetryIngestAttributionConfig | null | undefined =
      this.projects.get(projectId);

    if (cached !== undefined) {
      return cached;
    }

    let load: Promise<TelemetryIngestAttributionConfig | null> | undefined =
      this.projectLoads.get(projectId);

    if (!load) {
      load = this.loadProjectBudgets(projectId).finally(() => {
        this.projectLoads.delete(projectId);
      });
      this.projectLoads.set(projectId, load);
    }

    return load;
  }

  private static async loadProjectBudgets(
    projectId: string,
  ): Promise<TelemetryIngestAttributionConfig | null> {
    try {
      const config: TelemetryIngestAttributionConfig | null =
        await this.readProjectBudgets(new ObjectID(projectId));

      this.projects.set(
        projectId,
        config,
        TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS,
      );

      return config;
    } catch (err) {
      this.logFailedRead(`project ${projectId}'s team and label budgets`, err);
      this.projects.set(projectId, null, FAILED_READ_TTL_MS);
      return null;
    }
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

    const budgetsByServiceId: Map<string, Array<number>> = new Map();

    const add: (serviceId: string, index: number) => void = (
      serviceId: string,
      index: number,
    ): void => {
      const indexes: Array<number> = budgetsByServiceId.get(serviceId) || [];

      if (!indexes.includes(index)) {
        indexes.push(index);
      }

      budgetsByServiceId.set(serviceId, indexes);
    };

    const teamIndexes: Map<string, number> = new Map();

    budgets.forEach(
      (budget: TelemetryIngestTeamLabelBudget, index: number): void => {
        if (budget.scope === TelemetryIngestionBudgetScope.Team) {
          teamIndexes.set(budget.scopeId, index);
        }
      },
    );

    // The services the budgets' teams own: one read for every team.
    if (teamIndexes.size > 0) {
      const owners: Array<ServiceOwnerTeam> =
        await ServiceOwnerTeamService.findAllBy({
          query: {
            projectId: projectId,
            teamId: QueryHelper.any(Array.from(teamIndexes.keys())),
          },
          select: { serviceId: true, teamId: true },
          props: { isRoot: true },
        });

      for (const owner of owners) {
        const index: number | undefined = owner.teamId
          ? teamIndexes.get(owner.teamId.toString())
          : undefined;

        if (owner.serviceId && index !== undefined) {
          add(owner.serviceId.toString(), index);
        }
      }
    }

    // The services that carry each budget's label.
    for (let index: number = 0; index < budgets.length; index++) {
      const budget: TelemetryIngestTeamLabelBudget = budgets[index]!;

      if (budget.scope !== TelemetryIngestionBudgetScope.Label) {
        continue;
      }

      const services: Array<Service> = await ServiceService.findAllBy({
        query: {
          projectId: projectId,
          labels: [new ObjectID(budget.scopeId)],
        } as never,
        select: { _id: true },
        props: { isRoot: true },
      });

      for (const service of services) {
        if (service.id) {
          add(service.id.toString(), index);
        }
      }
    }

    return {
      publishesUsageMetrics: false,
      budgets: budgets,
      budgetsByServiceId: budgetsByServiceId,
    };
  }

  private static async loadSet(data: {
    what: string;
    previous: CachedSet | null;
    load: () => Promise<Set<string>>;
    store: (value: CachedSet) => void;
  }): Promise<Set<string>> {
    try {
      const value: Set<string> = await data.load();

      data.store({
        value: value,
        expiresAt: Date.now() + TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS,
      });

      return value;
    } catch (err) {
      this.logFailedRead(data.what, err);

      const value: Set<string> = data.previous
        ? data.previous.value
        : new Set<string>();

      data.store({ value: value, expiresAt: Date.now() + FAILED_READ_TTL_MS });

      return value;
    }
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
