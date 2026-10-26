import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  GCP_ALIGNMENT_PERIOD_SECONDS,
  GCP_KEY_METRICS,
  GcpKeyMetric,
  getGcpKeyMetricTypes,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudMonitoredResource } from "../../../../Types/Cloud/CloudMonitoredResource";
import { splitCloudConnectionList } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionSetupScope } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
  countCloudConnectionValues,
} from "../../../../Types/CloudConnection/CloudConnectionTest";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import GoogleMonitoringClient from "../../LlmObservability/Connectors/GoogleVertexAI/GoogleMonitoringClient";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import GoogleSecOpsClient from "../../SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import { Settled, mapWithConcurrency } from "../CloudConcurrency";
import {
  CloudMetricGroup,
  OtlpAttribute,
  buildMetricsPayloads,
  connectionResourceAttributes,
  countPayloadPoints,
  resolveCloudResourceOf,
  stringAttribute,
} from "../CloudMetricPayload";
import {
  GCP_METRIC_DELAY_MS,
  MetricWindow,
  getMetricWindow,
  getMetricWindowPolicy,
} from "../CloudMetricWindows";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudConnectorCallOptions,
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudDiscoveredResource,
  CloudInventoryItem,
  CloudInventoryOptions,
  CloudInventoryResult,
  CloudReadBudget,
  CloudReadBudgetSpent,
  CloudReadOptions,
  CloudReadResult,
  CLOUD_MAX_ORGANIZATION_ACCOUNTS,
  getCloudSecretValues,
  getOrganizationLimitWarning,
  orderLeastRecentlyRead,
  readCloudSetting,
} from "../CloudConnectorTypes";
import GcpInventoryClient, {
  GCP_INVENTORY_TYPES,
  GcpAsset,
  GcpAssetListing,
  GcpInventoryType,
  addGcpTopicEdges,
  buildGcpInventoryItem,
} from "./GcpInventory";
import GcpMonitoring, { GcpTimeSeries } from "./GcpMonitoring";
import { readGcpAuditEntry, readGcpHealthEvent } from "./GcpChanges";
import {
  getChangePlace,
  getChangeWindowStart,
  getHealthWindowStart,
  isHealthPaused,
  keepNewChanges,
  markHealthRead,
  pauseHealth,
} from "../CloudChangeWindow";
import { JSONObject } from "../../../../Types/JSON";

/*
 * GOOGLE CLOUD: the projects a service account may read, from Cloud
 * Monitoring.
 *
 * Every read asks each project for each key metric (CloudKeyMetrics) since
 * the last read, aligned to a minute: one call per metric type returns it
 * for every resource of the project, so a VM, a Cloud SQL instance, a
 * Cloud Run service is found the moment it reports. Each series becomes
 * the export the googlecloudmonitoring receiver sends: the monitored
 * resource's type and labels on the OTel resource, the metric's labels on
 * its datapoints, the metric named by its type.
 */

const PROVIDER_TITLE: string = "Google Cloud";
const CONCURRENCY: number = 6;
export const GCP_MAX_PROJECTS: number = 20;
// The most projects of an organization one connection reads.
export const GCP_MAX_ORGANIZATION_PROJECTS: number =
  CLOUD_MAX_ORGANIZATION_ACCOUNTS;
const DAY_MS: number = 24 * 60 * 60 * 1000;
// How often Service Health is asked, and how long after a refusal it is not.
const HEALTH_INTERVAL_MS: number = 15 * 60 * 1000;
const HEALTH_PAUSE_MS: number = DAY_MS;

function isOlderThan(
  iso: string | undefined,
  ageMs: number,
  now: Date,
): boolean {
  const time: number = iso ? Date.parse(iso) : NaN;
  return !Number.isFinite(time) || now.getTime() - time >= ageMs;
}
// A test looks back this far, for the first metric of each resource type.
const TEST_LOOK_BACK_MS: number = 30 * 60 * 1000;

interface ParsedKey {
  projectId: string;
  clientEmail: string;
}

export default class GcpCloudConnector implements CloudConnector {
  public provider: CloudProvider = CloudProvider.GCP;

  // The key's own project and service account, from its JSON.
  public static readKey(serviceAccountJson: string): ParsedKey {
    const credentials: { clientEmail: string } =
      GoogleSecOpsClient.parseServiceAccountJson(serviceAccountJson);
    let projectId: string = "";

    try {
      const parsed: unknown = JSON.parse(serviceAccountJson);

      if (parsed && typeof parsed === "object") {
        const value: unknown = (parsed as Dictionary<unknown>)["project_id"];
        projectId = typeof value === "string" ? value.trim() : "";
      }
    } catch {
      projectId = "";
    }

    return { projectId, clientEmail: credentials.clientEmail };
  }

  public getProjects(settings: CloudConnectionSettings): Array<string> {
    const named: Array<string> = splitCloudConnectionList(
      readCloudSetting(settings.config, "projectIds"),
    );

    if (named.length > 0) {
      return named;
    }

    const key: ParsedKey = GcpCloudConnector.readKey(
      readCloudSetting(settings.secrets, "serviceAccountJson"),
    );

    return key.projectId ? [key.projectId] : [];
  }

  // Whether the connection reads every project of a Google Cloud organization.
  public isOrganization(settings: CloudConnectionSettings): boolean {
    return (
      readCloudSetting(settings.config, "readScope") ===
      CloudConnectionSetupScope.Organization
    );
  }

  /*
   * The projects a read reads: those the connection names (or the key's
   * own) - or, for an organization, every active project the service
   * account may see, searched once a day and kept in the read state.
   */
  public async resolveProjects(data: {
    settings: CloudConnectionSettings;
    options: CloudConnectorCallOptions;
    budget: CloudReadBudget;
    state: CloudConnectionPullState;
    now: Date;
  }): Promise<Array<string>> {
    if (!this.isOrganization(data.settings)) {
      return this.getProjects(data.settings);
    }

    const known: Array<{ id: string; name: string }> =
      data.state.organizationAccounts || [];

    if (
      known.length > 0 &&
      !isOlderThan(data.state.organizationListedAt, DAY_MS, data.now)
    ) {
      return known.map((project: { id: string }): string => {
        return project.id;
      });
    }

    const client: GcpInventoryClient = new GcpInventoryClient({
      serviceAccountJson: readCloudSetting(
        data.settings.secrets,
        "serviceAccountJson",
      ),
      transport: data.options.transport,
      requestTimeoutInMs: data.options.requestTimeoutInMs,
      budget: data.budget,
      sleep: data.options.sleep,
    });
    const all: Array<{ projectId: string; displayName: string }> =
      await client.searchProjects();
    const found: Array<{ projectId: string; displayName: string }> = all.slice(
      0,
      GCP_MAX_ORGANIZATION_PROJECTS,
    );

    data.state.organizationAccounts = found.map(
      (project: { projectId: string; displayName: string }) => {
        return { id: project.projectId, name: project.displayName };
      },
    );
    data.state.organizationAccountCount = all.length;
    data.state.organizationListedAt = data.now.toISOString();

    return found.length > 0
      ? found.map((project: { projectId: string }): string => {
          return project.projectId;
        })
      : this.getProjects(data.settings);
  }

  public validateSettings(settings: CloudConnectionSettings): void {
    const json: string = readCloudSetting(
      settings.secrets,
      "serviceAccountJson",
    );

    if (!json) {
      throw new BadDataException("Service account key (JSON) is required.");
    }

    GcpCloudConnector.readKey(json);

    const projects: Array<string> = this.getProjects(settings);

    if (projects.length === 0) {
      throw new BadDataException(
        "The key names no project: list the projects to read under Projects.",
      );
    }

    if (projects.length > GCP_MAX_PROJECTS) {
      throw new BadDataException(
        `Projects can list at most ${GCP_MAX_PROJECTS} projects.`,
      );
    }

    for (const project of projects) {
      GoogleMonitoringClient.validateProjectId(project);
    }
  }

  private monitoring(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions,
    budget?: CloudReadBudget | undefined,
  ): GcpMonitoring {
    return new GcpMonitoring({
      serviceAccountJson: readCloudSetting(
        settings.secrets,
        "serviceAccountJson",
      ),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
      budget,
    });
  }

  // A project's own read state, by id (an organization's projects, or the named ones).
  private markProjectRead(data: {
    state: CloudConnectionPullState;
    projectId: string;
    field: "inventoryReadAt" | "changesReadAt";
    now: Date;
  }): void {
    data.state.accountStates = {
      ...(data.state.accountStates || {}),
      [data.projectId]: {
        ...(data.state.accountStates?.[data.projectId] || {}),
        [data.field]: data.now.toISOString(),
      },
    };
  }

  /*
   * What changed in each project since the last read (its Admin Activity
   * audit log) and - every 15 minutes - Google Cloud's Service Health
   * events about it. A look back for an investigation reads only the
   * projects it names and moves no cursor.
   *
   * The projects are read least recently read first, so a read that stops
   * at its limit reaches the others next time; the audit log is listed
   * oldest first, so a project busier than one read takes carries on next
   * time from the newest change read (CloudChangeWindow).
   */
  public async readChanges(
    settings: CloudConnectionSettings,
    options: CloudChangesOptions,
  ): Promise<CloudChangesResult> {
    const now: Date = options.now ? options.now() : new Date();
    const state: CloudConnectionPullState = options.state;
    const client: GcpInventoryClient = new GcpInventoryClient({
      serviceAccountJson: readCloudSetting(
        settings.secrets,
        "serviceAccountJson",
      ),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
      budget: options.budget,
      sleep: options.sleep,
    });
    const isLookBack: boolean = Boolean(options.since);
    const result: CloudChangesResult = {
      changes: [],
      warnings: [],
      complete: true,
    };
    let projects: Array<string> = orderLeastRecentlyRead({
      accounts: this.isOrganization(settings)
        ? (state.organizationAccounts || []).map(
            (project: { id: string }): string => {
              return project.id;
            },
          )
        : this.getProjects(settings),
      readAt: (projectId: string): string | undefined => {
        return state.accountStates?.[projectId]?.changesReadAt;
      },
    });

    if (options.only) {
      const wanted: Set<string> = new Set(
        options.only.map((entry: { accountId: string }): string => {
          return entry.accountId;
        }),
      );
      projects = projects.filter((projectId: string): boolean => {
        return wanted.has(projectId);
      });
    }

    let refused: boolean = false;
    const busy: Array<string> = [];

    const outcomes: Array<
      Settled<{ changes: Array<CloudChange>; complete: boolean }>
    > = await mapWithConcurrency(
      projects,
      3,
      async (
        projectId: string,
      ): Promise<{ changes: Array<CloudChange>; complete: boolean }> => {
        const listing: { entries: Array<JSONObject>; complete: boolean } =
          await client.listAuditEntries({
            projectId,
            start: getChangeWindowStart({
              state,
              place: getChangePlace(projectId, ""),
              now,
              since: options.since,
            }),
            end: now,
          });

        return {
          changes: listing.entries
            .map((entry: JSONObject): CloudChange | null => {
              return readGcpAuditEntry({ entry, projectId });
            })
            .filter((change: CloudChange | null): boolean => {
              return change !== null;
            }) as Array<CloudChange>,
          complete: listing.complete,
        };
      },
    );

    outcomes.forEach(
      (
        outcome: Settled<{ changes: Array<CloudChange>; complete: boolean }>,
        index: number,
      ) => {
        const projectId: string = projects[index]!;

        if (outcome.ok) {
          result.changes.push(
            ...keepNewChanges({
              state,
              place: getChangePlace(projectId, ""),
              changes: outcome.value.changes,
              now,
              complete: outcome.value.complete,
              isLookBack,
              order: "oldest-first",
            }),
          );

          if (!outcome.value.complete) {
            busy.push(projectId);
          }

          if (!isLookBack) {
            this.markProjectRead({
              state,
              projectId,
              field: "changesReadAt",
              now,
            });
          }

          return;
        }

        result.complete = false;

        if (outcome.error instanceof CloudReadBudgetSpent) {
          return;
        }

        if (
          outcome.error instanceof LlmProviderError &&
          outcome.error.kind === CloudConnectionFailureKind.Authentication
        ) {
          throw outcome.error;
        }

        if (!isLookBack) {
          this.markProjectRead({
            state,
            projectId,
            field: "changesReadAt",
            now,
          });
        }

        if (
          outcome.error instanceof LlmProviderError &&
          outcome.error.kind === CloudConnectionFailureKind.Permission
        ) {
          refused = true;
          return;
        }

        // A project whose Logging API is off: its message says how to turn it on.
        result.warnings.push(
          `Could not read what changed in ${projectId}: ${
            outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error)
          }`,
        );
      },
    );

    if (busy.length > 0) {
      result.warnings.push(
        `More changed in ${busy.slice(0, 5).join(", ")} than one read takes: the next read carries on from the newest change read.`,
      );
    }

    if (refused) {
      result.warnings.push(
        "The service account may not read a project's audit log. Run the setup command again: it gives it the Logs Viewer role.",
      );
    }

    // Service Health: a bonus, paused for a day for a project that does not allow it.
    const healthDue: boolean =
      !isLookBack && isOlderThan(state.healthReadAt, HEALTH_INTERVAL_MS, now);

    if (healthDue) {
      for (const projectId of projects) {
        if (options.budget.isSpent()) {
          break;
        }

        if (isHealthPaused({ state, accountId: projectId, now })) {
          continue;
        }

        try {
          const events: Array<JSONObject> =
            await client.listServiceHealthEvents({
              projectId,
              start: getHealthWindowStart({
                state,
                accountId: projectId,
                now,
              }),
            });

          result.changes.push(
            ...keepNewChanges({
              state,
              place: getChangePlace(projectId, "health"),
              changes: events
                .map((event: JSONObject): CloudChange | null => {
                  return readGcpHealthEvent({ event, projectId });
                })
                .filter((change: CloudChange | null): boolean => {
                  return change !== null;
                }) as Array<CloudChange>,
              now,
              complete: true,
              isLookBack,
            }),
          );
          markHealthRead({ state, accountId: projectId, now });
        } catch (error) {
          if (
            error instanceof LlmProviderError &&
            (error.kind === CloudConnectionFailureKind.Permission ||
              error.kind === CloudConnectionFailureKind.Settings)
          ) {
            pauseHealth({
              state,
              accountId: projectId,
              now,
              forMs: HEALTH_PAUSE_MS,
            });
          }
        }
      }

      state.healthReadAt = now.toISOString();
    }

    return result;
  }

  /*
   * The projects' inventory (GcpInventory): every asset of the inventory's
   * types in each project read, and each project's name - the project
   * listed least recently first, so a listing that stops at its limit lists
   * the others next time. A project whose Cloud Asset API is off, or that
   * the service account may not list, is a warning that says what to run.
   */
  public async readInventory(
    settings: CloudConnectionSettings,
    options: CloudInventoryOptions,
  ): Promise<CloudInventoryResult> {
    const now: Date = options.now ? options.now() : new Date();
    const client: GcpInventoryClient = new GcpInventoryClient({
      serviceAccountJson: readCloudSetting(
        settings.secrets,
        "serviceAccountJson",
      ),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
      budget: options.budget,
      sleep: options.sleep,
    });
    const organization: Array<{ id: string; name: string }> =
      this.isOrganization(settings)
        ? options.state.organizationAccounts || []
        : [];
    const projects: Array<string> = orderLeastRecentlyRead({
      accounts:
        organization.length > 0
          ? organization.map((project: { id: string }): string => {
              return project.id;
            })
          : this.getProjects(settings).slice(0, GCP_MAX_PROJECTS),
      readAt: (projectId: string): string | undefined => {
        return options.state.accountStates?.[projectId]?.inventoryReadAt;
      },
    });
    const organizationNames: Map<string, string> = new Map(
      organization.map((project: { id: string; name: string }) => {
        return [project.id, project.name];
      }),
    );
    const items: Array<CloudInventoryItem> = [];
    const accounts: Array<{ accountId: string; name?: string | undefined }> =
      [];
    const completelyListed: Array<{
      accountId: string;
      resourceTypes: Array<string>;
    }> = [];
    const warnings: Array<string> = [];
    let complete: boolean = true;

    for (const projectId of projects) {
      if (options.budget.isSpent()) {
        complete = false;
        break;
      }

      let listing: GcpAssetListing;

      try {
        listing = await client.listAssets(projectId);
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          complete = false;
          break;
        }

        if (
          error instanceof LlmProviderError &&
          error.kind === CloudConnectionFailureKind.Authentication
        ) {
          throw error;
        }

        this.markProjectRead({
          state: options.state,
          projectId,
          field: "inventoryReadAt",
          now,
        });

        warnings.push(
          error instanceof LlmProviderError &&
            error.kind === CloudConnectionFailureKind.Permission
            ? `The service account may not list the resources of ${projectId}. Run the setup command again: it gives it the Cloud Asset Viewer role.`
            : `Could not list the resources of ${projectId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
        );
        accounts.push({ accountId: projectId });
        continue;
      }

      this.markProjectRead({
        state: options.state,
        projectId,
        field: "inventoryReadAt",
        now,
      });

      const assets: Map<CloudInventoryItem, GcpAsset> = new Map();
      const projectItems: Array<CloudInventoryItem> = [];

      for (const asset of listing.assets) {
        const item: CloudInventoryItem | null = buildGcpInventoryItem(asset, {
          projectId,
        });

        if (item) {
          projectItems.push(item);
          assets.set(item, asset);
        }
      }

      addGcpTopicEdges({ items: projectItems, assets });
      items.push(...projectItems);

      if (listing.complete) {
        completelyListed.push({
          accountId: projectId,
          resourceTypes: Array.from(
            new Set(
              GCP_INVENTORY_TYPES.map((type: GcpInventoryType): string => {
                return type.monitoredType || type.assetType;
              }),
            ),
          ),
        });
      } else {
        complete = false;
      }

      accounts.push({
        accountId: projectId,
        name:
          organizationNames.get(projectId) ||
          (await client.getProjectName(projectId)) ||
          undefined,
      });
    }

    const tooMany: string | null = this.isOrganization(settings)
      ? getOrganizationLimitWarning({
          total: options.state.organizationAccountCount || organization.length,
          noun: "projects",
        })
      : null;

    if (tooMany) {
      warnings.unshift(tooMany);
    }

    return { accounts, items, completelyListed, warnings, complete };
  }

  private resourceAttributes(data: {
    serviceName: string;
    connectionId: string;
    series: GcpTimeSeries;
  }): Array<OtlpAttribute> {
    const attributes: Array<OtlpAttribute> = [
      ...connectionResourceAttributes({
        serviceName: data.serviceName,
        connectionId: data.connectionId,
        cloudProvider: CloudProvider.GCP,
      }),
      stringAttribute("gcp.resource_type", data.series.resourceType),
    ];

    for (const key of Object.keys(data.series.resourceLabels).sort()) {
      attributes.push(stringAttribute(key, data.series.resourceLabels[key]!));
    }

    if (data.series.metadataName && !data.series.resourceLabels["name"]) {
      attributes.push(stringAttribute("name", data.series.metadataName));
    }

    return attributes;
  }

  private datapointAttributes(series: GcpTimeSeries): Array<OtlpAttribute> {
    return Object.keys(series.metricLabels)
      .sort()
      .map((key: string): OtlpAttribute => {
        return stringAttribute(key, series.metricLabels[key]!);
      });
  }

  private resolve(series: GcpTimeSeries): CloudMonitoredResource | null {
    return resolveCloudResourceOf({
      metricName: series.metricType,
      resourceAttributes: this.resourceAttributes({
        serviceName: "",
        connectionId: "",
        series,
      }),
      datapointAttributes: this.datapointAttributes(series),
    });
  }

  public async testConnection(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions,
  ): Promise<CloudConnectionTestResult> {
    const startedAt: number = Date.now();

    try {
      this.validateSettings(settings);

      const monitoring: GcpMonitoring = this.monitoring(settings, options);
      const projects: Array<string> = this.getProjects(settings);
      const now: Date = options.now ? options.now() : new Date();
      const end: Date = new Date(
        Math.floor(now.getTime() / 60000) * 60000 - GCP_METRIC_DELAY_MS,
      );
      const start: Date = new Date(end.getTime() - TEST_LOOK_BACK_MS);

      // The first key metric of each resource type, in each project.
      const asks: Array<{ projectId: string; metric: GcpKeyMetric }> = [];

      for (const projectId of projects.slice(0, 3)) {
        for (const entry of GCP_KEY_METRICS) {
          asks.push({ projectId, metric: entry.metrics[0]! });
        }
      }

      const outcomes: Array<Settled<Array<GcpTimeSeries>>> =
        await mapWithConcurrency(
          asks,
          CONCURRENCY,
          async (ask: {
            projectId: string;
            metric: GcpKeyMetric;
          }): Promise<Array<GcpTimeSeries>> => {
            return await monitoring.listTimeSeries({
              projectId: ask.projectId,
              metricType: ask.metric.metricType,
              aligner: ask.metric.aligner,
              alignmentPeriodSeconds: 300,
              start,
              end,
              firstPageOnly: true,
            });
          },
        );

      const resources: Map<string, CloudMonitoredResource> = new Map();
      let succeeded: number = 0;
      let firstError: unknown = undefined;

      for (const outcome of outcomes) {
        if (!outcome.ok) {
          firstError = firstError || outcome.error;
          continue;
        }

        succeeded++;

        for (const series of outcome.value) {
          const resource: CloudMonitoredResource | null = this.resolve(series);

          if (resource) {
            resources.set(resource.identityKey, resource);
          }
        }
      }

      if (succeeded === 0 && firstError) {
        throw firstError;
      }

      const found: Array<CloudMonitoredResource> = Array.from(
        resources.values(),
      );

      return {
        provider: CloudProvider.GCP,
        status: found.length > 0 ? "pass" : "warn",
        message:
          found.length > 0
            ? `Signed in and found ${found.length} resources reporting to Cloud Monitoring in ${projects.length} projects.`
            : `Signed in to ${projects.join(", ")}, but found no resources reporting to Cloud Monitoring in the last half hour.`,
        accounts: projects,
        resourceCount: found.length,
        resourceTypes: countCloudConnectionValues(
          found.map((resource: CloudMonitoredResource): string => {
            return resource.resourceType;
          }),
        ).map((entry: { value: string; count: number }) => {
          return { type: entry.value, count: entry.count };
        }),
        regions: countCloudConnectionValues(
          found.map((resource: CloudMonitoredResource): string => {
            return resource.region;
          }),
        ).map((entry: { value: string; count: number }) => {
          return { region: entry.value, count: entry.count };
        }),
        isSample: true,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return GcpCloudConnector.failedTest({ error, settings, startedAt });
    }
  }

  public static failedTest(data: {
    error: unknown;
    settings: CloudConnectionSettings;
    startedAt: number;
  }): CloudConnectionTestResult {
    if (data.error instanceof BadDataException) {
      return {
        provider: CloudProvider.GCP,
        status: "fail",
        message: data.error.message,
        failureKind: CloudConnectionFailureKind.Settings,
        durationMs: Date.now() - data.startedAt,
      };
    }

    const failure: LlmProviderError = LlmProviderError.from({
      error: data.error,
      step: "test",
      providerTitle: PROVIDER_TITLE,
      secretValues: getCloudSecretValues(data.settings),
    });

    return {
      provider: CloudProvider.GCP,
      status: "fail",
      message: failure.message,
      failureKind: failure.kind,
      durationMs: Date.now() - data.startedAt,
    };
  }

  public async read(
    settings: CloudConnectionSettings,
    options: CloudReadOptions,
  ): Promise<CloudReadResult> {
    const now: Date = options.now ? options.now() : new Date();
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: options.maxRequests,
      maxDurationMs: options.maxDurationMs,
    });
    const state: CloudConnectionPullState = { ...options.state };
    const warnings: Array<string> = [];
    const monitoring: GcpMonitoring = this.monitoring(
      settings,
      options,
      budget,
    );
    const projects: Array<string> = await this.resolveProjects({
      settings,
      options,
      budget,
      state,
      now,
    });
    const cursors: Record<string, string> = { ...(state.cursors || {}) };
    const window: MetricWindow | null = getMetricWindow({
      policy: getMetricWindowPolicy({
        periodSeconds: GCP_ALIGNMENT_PERIOD_SECONDS,
        delayMs: GCP_METRIC_DELAY_MS,
      }),
      cursor: cursors[String(GCP_ALIGNMENT_PERIOD_SECONDS)],
      now,
    });

    const resources: Map<string, CloudDiscoveredResource> = new Map();
    const groups: Map<string, CloudMetricGroup> = new Map();

    if (window) {
      const asks: Array<{
        projectId: string;
        metric: GcpKeyMetric & { resourceType: string };
      }> = [];

      for (const projectId of projects) {
        for (const metric of getGcpKeyMetricTypes()) {
          asks.push({ projectId, metric });
        }
      }

      const outcomes: Array<Settled<Array<GcpTimeSeries>>> =
        await mapWithConcurrency(
          asks,
          CONCURRENCY,
          async (ask: {
            projectId: string;
            metric: GcpKeyMetric;
          }): Promise<Array<GcpTimeSeries>> => {
            return await monitoring.listTimeSeries({
              projectId: ask.projectId,
              metricType: ask.metric.metricType,
              aligner: ask.metric.aligner,
              alignmentPeriodSeconds: GCP_ALIGNMENT_PERIOD_SECONDS,
              start: window.start,
              end: window.end,
            });
          },
        );

      let succeeded: number = 0;
      let failedMetrics: number = 0;
      let firstError: unknown = undefined;

      outcomes.forEach(
        (outcome: Settled<Array<GcpTimeSeries>>, index: number) => {
          if (!outcome.ok) {
            if (outcome.error instanceof CloudReadBudgetSpent) {
              return;
            }

            if (
              outcome.error instanceof LlmProviderError &&
              (outcome.error.kind ===
                CloudConnectionFailureKind.Authentication ||
                outcome.error.kind === CloudConnectionFailureKind.Settings)
            ) {
              throw outcome.error;
            }

            failedMetrics++;
            firstError = firstError || outcome.error;
            return;
          }

          succeeded++;
          const ask: { metric: GcpKeyMetric } = asks[index]!;

          for (const series of outcome.value) {
            const resource: CloudMonitoredResource | null =
              this.resolve(series);

            if (!resource) {
              continue;
            }

            if (!resources.has(resource.identityKey)) {
              resources.set(resource.identityKey, {
                resource,
                displayName: series.metadataName || undefined,
              });
            }

            let group: CloudMetricGroup | undefined = groups.get(
              resource.identityKey,
            );

            if (!group) {
              group = {
                resourceAttributes: this.resourceAttributes({
                  serviceName: options.serviceName,
                  connectionId: options.connectionId,
                  series,
                }),
                metrics: [],
              };
              groups.set(resource.identityKey, group);
            }

            let metric: CloudMetricGroup["metrics"][number] | undefined =
              group.metrics.find((candidate: { name: string }): boolean => {
                return candidate.name === series.metricType;
              });

            if (!metric) {
              metric = {
                name: series.metricType,
                unit: ask.metric.unit,
                datapointSets: [],
              };
              group.metrics.push(metric);
            }

            metric.datapointSets.push({
              attributes: this.datapointAttributes(series),
              points: series.points,
            });
          }
        },
      );

      if (succeeded === 0 && firstError) {
        throw firstError;
      }

      if (failedMetrics > 0) {
        warnings.push(
          `Could not read ${failedMetrics} metrics this time: ${
            firstError instanceof Error
              ? firstError.message
              : String(firstError)
          }`,
        );
      }

      if (!budget.isSpent()) {
        cursors[String(GCP_ALIGNMENT_PERIOD_SECONDS)] =
          window.end.toISOString();
      }
    }

    state.cursors = cursors;
    state.accounts = projects;
    state.inventoryAt = now.toISOString();

    const tooMany: string | null = this.isOrganization(settings)
      ? getOrganizationLimitWarning({
          total: state.organizationAccountCount || projects.length,
          noun: "projects",
        })
      : null;

    if (tooMany) {
      warnings.unshift(tooMany);
    }

    const metricGroups: Array<CloudMetricGroup> = budget.isSpent()
      ? []
      : Array.from(groups.values());

    if (budget.isSpent()) {
      warnings.push(
        "This read stopped at its limit and carries on within a minute. Name fewer projects to read them in one go.",
      );
    }

    return {
      accounts: projects,
      resources: Array.from(resources.values()),
      completelyListedAccounts: [],
      payloads: buildMetricsPayloads(metricGroups),
      pointsWritten: countPayloadPoints(metricGroups),
      requestCount: budget.getUsed(),
      warnings,
      complete: !budget.isSpent(),
      nextState: state,
    };
  }
}
