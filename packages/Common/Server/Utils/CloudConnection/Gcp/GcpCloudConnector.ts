import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  GCP_ALIGNMENT_PERIOD_SECONDS,
  GCP_KEY_METRICS,
  GcpKeyMetric,
  getGcpKeyMetricTypes,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudMonitoredResource } from "../../../../Types/Cloud/CloudMonitoredResource";
import { splitCloudConnectionList } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
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
  CloudDiscoveredResource,
  CloudReadBudget,
  CloudReadBudgetSpent,
  CloudReadOptions,
  CloudReadResult,
  getCloudSecretValues,
  readCloudSetting,
} from "../CloudConnectorTypes";
import GcpMonitoring, { GcpTimeSeries } from "./GcpMonitoring";

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
    const projects: Array<string> = this.getProjects(settings);
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
