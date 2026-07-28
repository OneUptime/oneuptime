import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerResource from "../../../../Models/DatabaseModels/DockerResource";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import KubernetesResource from "../../../../Models/DatabaseModels/KubernetesResource";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import { JSONObject } from "../../../../Types/JSON";
import OneUptimeDate from "../../../../Types/Date";
import Permission from "../../../../Types/Permission";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CloudResourceService from "../../../Services/CloudResourceService";
import DockerHostService from "../../../Services/DockerHostService";
import DockerResourceService from "../../../Services/DockerResourceService";
import HostService from "../../../Services/HostService";
import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import KubernetesResourceService from "../../../Services/KubernetesResourceService";
import MonitorStatusTimelineService from "../../../Services/MonitorStatusTimelineService";
import ScheduledMaintenanceService from "../../../Services/ScheduledMaintenanceService";
import ServerlessFunctionService from "../../../Services/ServerlessFunctionService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
  TimeRangeSchemaProperties,
} from "./ToolTypes";

/*
 * How long an agent/collector must have been silent before "it stopped
 * reporting" is a real change signal rather than normal ingest lag. Matches the
 * platform's own disconnect threshold (HostService.markDisconnectedHosts,
 * KubernetesClusterService.markDisconnectedClusters, and siblings), which sits
 * 3x above the 5-minute OTel ingest maintenance fence so healthy resources do
 * not flap.
 */
export const AGENT_SILENCE_THRESHOLD_MINUTES: number = 15;

/*
 * Gate on the union of the read permissions of every model this feed reads —
 * monitors/exceptions/maintenance plus the infrastructure inventory. This is
 * defense-in-depth only: every source query below runs under the requesting
 * user's props, so a user who can see hosts but not monitors gets the
 * infrastructure rows and nothing else — never another user's data. Derived
 * from the model ACLs so the gate can never drift from RBAC, and resolved
 * lazily to avoid the import-time circular-dependency TypeError other tools
 * document.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      const models: Array<BaseModel> = [
        new Monitor(),
        new KubernetesResource(),
        new KubernetesCluster(),
        new DockerResource(),
        new DockerHost(),
        new Host(),
        new CloudResource(),
        new ServerlessFunction(),
      ];

      const merged: Set<Permission> = new Set<Permission>();
      for (const model of models) {
        for (const permission of model.getReadPermissions()) {
          merged.add(permission);
        }
      }

      cachedReadPermissions = Array.from(merged);
    }
    return cachedReadPermissions;
  };

// One normalized entry in the merged "what changed" feed.
interface ChangeEvent {
  at: Date;
  change: string;
  detail: string;
}

/*
 * The shape the "agent went silent" sources share. Every one of these models is
 * an agent-reported inventory row with a name and a lastSeenAt heartbeat, so
 * they collapse into one source in the feed instead of five near-identical
 * ones.
 */
interface SilentAgentRow {
  name?: string | undefined;
  lastSeenAt?: Date | undefined;
}

interface SilentAgentSource {
  // Human label for the feed detail line, e.g. "Host" → "Host web-01 …".
  label: string;
  fetch: (data: {
    limit: number;
    windowStart: Date;
    windowEnd: Date;
  }) => Promise<Array<SilentAgentRow>>;
}

export const RecentChangesTool: ObservabilityTool = {
  name: "recent_changes",
  description:
    "Get a single chronological feed of what changed in a time window, including infrastructure churn: newly-seen exceptions, monitor status changes (up/down), scheduled maintenance overlapping the window, Kubernetes pods and Docker containers created or restarted in the window (with the deployment/cronjob that owns them), and hosts, Kubernetes clusters, Docker hosts, cloud resources and serverless functions that stopped reporting during the window (their agent or OTel collector went silent). This is the highest-yield way to answer 'what changed right before this started?' during root-cause analysis — call it with the window around when a problem began, then use it to tell a deploy/rollout apart from a box that went away.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      limitPerSource: {
        type: "number",
        description:
          "Maximum items to pull from each source (exceptions, monitor changes, maintenance, Kubernetes workloads started, Docker workloads started, agents that went silent) before merging. Default 15, max 30.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const timeRange: { startTime: Date; endTime: Date } = ToolArgs.getTimeRange(
      args,
      { defaultHours: 24, maxDays: 30 },
    );
    const startTime: Date = timeRange.startTime;
    const endTime: Date = timeRange.endTime;

    const limitPerSource: number = ToolArgs.getNumber(args, "limitPerSource", {
      defaultValue: 15,
      min: 1,
      max: 30,
    });

    const events: Array<ChangeEvent> = [];

    // 1) Newly-seen exceptions — their first occurrence falls inside the window.
    try {
      const exceptions: Array<TelemetryException> =
        await TelemetryExceptionService.findBy({
          query: {
            firstSeenAt: QueryHelper.inBetween(startTime, endTime),
          } as never,
          select: {
            message: true,
            exceptionType: true,
            firstSeenAt: true,
            occuranceCount: true,
          },
          sort: { firstSeenAt: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const exception of exceptions) {
        if (!exception.firstSeenAt) {
          continue;
        }
        events.push({
          at: exception.firstSeenAt,
          change: "new_exception",
          detail: `${exception.exceptionType || "Exception"}: ${exception.message || ""} (x${exception.occuranceCount ?? 0})`,
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: exceptions source skipped: ${error}`);
    }

    // 2) Monitor status changes (up/down) inside the window.
    try {
      const statusChanges: Array<MonitorStatusTimeline> =
        await MonitorStatusTimelineService.findBy({
          query: {
            createdAt: QueryHelper.inBetween(startTime, endTime),
          },
          select: {
            createdAt: true,
            monitor: { name: true },
            monitorStatus: { name: true },
          },
          sort: { createdAt: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const statusChange of statusChanges) {
        if (!statusChange.createdAt) {
          continue;
        }
        events.push({
          at: statusChange.createdAt,
          change: "monitor_status_change",
          detail: `${statusChange.monitor?.name || "Monitor"} → ${statusChange.monitorStatus?.name || "unknown"}`,
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: monitor source skipped: ${error}`);
    }

    /*
     * 3) Scheduled maintenance overlapping the window (started before it ended,
     *    ends after it started).
     */
    try {
      const maintenanceEvents: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findBy({
          query: {
            startsAt: QueryHelper.lessThanEqualTo(endTime),
            endsAt: QueryHelper.greaterThanEqualTo(startTime),
          },
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            currentScheduledMaintenanceState: { name: true },
          },
          sort: { startsAt: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const maintenance of maintenanceEvents) {
        if (!maintenance.startsAt) {
          continue;
        }
        events.push({
          at: maintenance.startsAt,
          change: "scheduled_maintenance",
          detail: `${maintenance.title || "Maintenance"} (${maintenance.currentScheduledMaintenanceState?.name || "scheduled"})`,
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: maintenance source skipped: ${error}`);
    }

    /*
     * 4) Kubernetes workloads created inside the window. A Pod whose
     *    metadata.creationTimestamp lands mid-incident is a restart, a rollout
     *    or a reschedule — the single most common "what changed" answer.
     */
    try {
      const kubernetesWorkloads: Array<KubernetesResource> =
        await KubernetesResourceService.findBy({
          query: {
            resourceCreationTimestamp: QueryHelper.inBetween(
              startTime,
              endTime,
            ),
          } as never,
          select: {
            kind: true,
            namespaceKey: true,
            name: true,
            phase: true,
            controllerDeploymentName: true,
            controllerCronJobName: true,
            resourceCreationTimestamp: true,
          },
          sort: { resourceCreationTimestamp: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const workload of kubernetesWorkloads) {
        if (!workload.resourceCreationTimestamp) {
          continue;
        }

        // namespaceKey is "" for cluster-scoped resources, never null.
        const namespace: string = workload.namespaceKey
          ? `${workload.namespaceKey}/`
          : "";
        const controller: string | undefined =
          workload.controllerDeploymentName ||
          workload.controllerCronJobName ||
          undefined;

        const parts: Array<string> = [
          `${workload.kind || "Resource"} ${namespace}${workload.name || "unknown"} created`,
        ];
        if (controller) {
          parts.push(`controller ${controller}`);
        }
        if (workload.phase) {
          parts.push(`phase ${workload.phase}`);
        }

        events.push({
          at: workload.resourceCreationTimestamp,
          change: "kubernetes_workload_started",
          detail: parts.join(" | "),
        });
      }
    } catch (error) {
      logger.debug(
        `recent_changes: kubernetes workload source skipped: ${error}`,
      );
    }

    // 5) Docker workloads created inside the window — same signal, other runtime.
    try {
      const dockerWorkloads: Array<DockerResource> =
        await DockerResourceService.findBy({
          query: {
            resourceCreationTimestamp: QueryHelper.inBetween(
              startTime,
              endTime,
            ),
          } as never,
          select: {
            kind: true,
            name: true,
            imageName: true,
            state: true,
            resourceCreationTimestamp: true,
          },
          sort: { resourceCreationTimestamp: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const workload of dockerWorkloads) {
        if (!workload.resourceCreationTimestamp) {
          continue;
        }

        const parts: Array<string> = [
          `${workload.kind || "Resource"} ${workload.name || "unknown"} created`,
        ];
        if (workload.imageName) {
          parts.push(`image ${workload.imageName}`);
        }
        if (workload.state) {
          parts.push(`state ${workload.state}`);
        }

        events.push({
          at: workload.resourceCreationTimestamp,
          change: "docker_workload_started",
          detail: parts.join(" | "),
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: docker workload source skipped: ${error}`);
    }

    /*
     * 6) Agents/collectors that went silent inside the window: their last
     *    heartbeat landed in the window AND is now older than the silence
     *    threshold, so they stopped reporting *then* and have not come back.
     *
     *    Both halves of that are one range query — lastSeenAt between the
     *    window start and the older of (window end, silence cutoff). When the
     *    whole window is newer than the cutoff nothing can qualify yet, so the
     *    queries are skipped rather than run for a guaranteed-empty answer.
     */
    const silenceCutoff: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -1 * AGENT_SILENCE_THRESHOLD_MINUTES,
    );
    const silenceWindowEnd: Date =
      endTime.getTime() < silenceCutoff.getTime() ? endTime : silenceCutoff;

    if (silenceWindowEnd.getTime() > startTime.getTime()) {
      const silentAgentSources: Array<SilentAgentSource> = [
        {
          label: "Kubernetes cluster",
          fetch: (data: {
            limit: number;
            windowStart: Date;
            windowEnd: Date;
          }): Promise<Array<SilentAgentRow>> => {
            return KubernetesClusterService.findBy({
              query: {
                isArchived: false,
                lastSeenAt: QueryHelper.inBetween(
                  data.windowStart,
                  data.windowEnd,
                ),
              } as never,
              select: { name: true, lastSeenAt: true },
              sort: { lastSeenAt: SortOrder.Descending },
              limit: data.limit,
              skip: 0,
              props: ctx.props,
            });
          },
        },
        {
          label: "Host",
          fetch: (data: {
            limit: number;
            windowStart: Date;
            windowEnd: Date;
          }): Promise<Array<SilentAgentRow>> => {
            return HostService.findBy({
              query: {
                isArchived: false,
                lastSeenAt: QueryHelper.inBetween(
                  data.windowStart,
                  data.windowEnd,
                ),
              } as never,
              select: { name: true, lastSeenAt: true },
              sort: { lastSeenAt: SortOrder.Descending },
              limit: data.limit,
              skip: 0,
              props: ctx.props,
            });
          },
        },
        {
          label: "Docker host",
          fetch: (data: {
            limit: number;
            windowStart: Date;
            windowEnd: Date;
          }): Promise<Array<SilentAgentRow>> => {
            return DockerHostService.findBy({
              query: {
                isArchived: false,
                lastSeenAt: QueryHelper.inBetween(
                  data.windowStart,
                  data.windowEnd,
                ),
              } as never,
              select: { name: true, lastSeenAt: true },
              sort: { lastSeenAt: SortOrder.Descending },
              limit: data.limit,
              skip: 0,
              props: ctx.props,
            });
          },
        },
        {
          label: "Cloud resource",
          fetch: (data: {
            limit: number;
            windowStart: Date;
            windowEnd: Date;
          }): Promise<Array<SilentAgentRow>> => {
            return CloudResourceService.findBy({
              query: {
                isArchived: false,
                lastSeenAt: QueryHelper.inBetween(
                  data.windowStart,
                  data.windowEnd,
                ),
              } as never,
              select: { name: true, lastSeenAt: true },
              sort: { lastSeenAt: SortOrder.Descending },
              limit: data.limit,
              skip: 0,
              props: ctx.props,
            });
          },
        },
        {
          label: "Serverless function",
          fetch: (data: {
            limit: number;
            windowStart: Date;
            windowEnd: Date;
          }): Promise<Array<SilentAgentRow>> => {
            return ServerlessFunctionService.findBy({
              query: {
                isArchived: false,
                lastSeenAt: QueryHelper.inBetween(
                  data.windowStart,
                  data.windowEnd,
                ),
              } as never,
              select: { name: true, lastSeenAt: true },
              sort: { lastSeenAt: SortOrder.Descending },
              limit: data.limit,
              skip: 0,
              props: ctx.props,
            });
          },
        },
      ];

      const silentAgentEvents: Array<ChangeEvent> = [];

      for (const source of silentAgentSources) {
        /*
         * Per-model catch, not one around the group: a project with no cloud
         * resources should still learn that its Kubernetes cluster went dark.
         */
        try {
          const rows: Array<SilentAgentRow> = await source.fetch({
            limit: limitPerSource,
            windowStart: startTime,
            windowEnd: silenceWindowEnd,
          });

          for (const row of rows) {
            if (!row.lastSeenAt) {
              continue;
            }
            silentAgentEvents.push({
              at: row.lastSeenAt,
              change: "agent_stopped_reporting",
              detail: `${source.label} ${row.name || "unknown"} stopped reporting | no data for over ${AGENT_SILENCE_THRESHOLD_MINUTES}m since`,
            });
          }
        } catch (error) {
          logger.debug(
            `recent_changes: ${source.label} silence source skipped: ${error}`,
          );
        }
      }

      /*
       * These five models are one logical source, so they share one
       * limitPerSource budget — five separate budgets would let inventory churn
       * crowd every other source out of the merged feed.
       */
      silentAgentEvents.sort((a: ChangeEvent, b: ChangeEvent) => {
        return b.at.getTime() - a.at.getTime();
      });
      events.push(...silentAgentEvents.slice(0, limitPerSource));
    }

    // Merge into one chronological feed, most recent first.
    events.sort((a: ChangeEvent, b: ChangeEvent) => {
      return b.at.getTime() - a.at.getTime();
    });

    const rows: Array<JSONObject> = events.map((event: ChangeEvent) => {
      return {
        at: event.at,
        change: event.change,
        detail: event.detail,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Changes ${startTime.toISOString()} → ${endTime.toISOString()} (${serialized.rowCount} events)`,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};
