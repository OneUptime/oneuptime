import AlertSeverityService from "./AlertSeverityService";
import DatabaseService from "./DatabaseService";
import IncidentSeverityService from "./IncidentSeverityService";
import KubernetesClusterLabelRuleEngineService from "./KubernetesClusterLabelRuleEngineService";
import KubernetesClusterOwnerRuleEngineService from "./KubernetesClusterOwnerRuleEngineService";
import KubernetesResourceChangeEventService from "./KubernetesResourceChangeEventService";
import LogService from "./LogService";
import MetricService from "./MetricService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import Log from "../../Models/AnalyticsModels/Log";
import Metric from "../../Models/AnalyticsModels/Metric";
import Model from "../../Models/DatabaseModels/KubernetesCluster";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import KubernetesResourceChangeEvent from "../../Models/DatabaseModels/KubernetesResourceChangeEvent";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../Types/BaseDatabase/InBetween";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import {
  getKubernetesAlertTemplateById,
  KubernetesAlertTemplate,
  RECOMMENDED_KUBERNETES_ALERT_TEMPLATE_IDS,
} from "../../Types/Monitor/KubernetesAlertTemplates";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import AnalyticsQuery from "../Types/AnalyticsDatabase/Query";
import {
  ParsedKubernetesEventLog,
  parseKubernetesEventLogBody,
} from "../Utils/Kubernetes/KubernetesEventParser";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";

const LAST_SEEN_CACHE_NAMESPACE: string = "k8s-cluster-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "k8s-cluster-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/*
 * Default pricing: a rough blend of on-demand cloud rates for
 * general-purpose instances (AWS / GCP / Azure), amortized per resource
 * hour. Users can override per cluster via costPerCpuCoreHour /
 * costPerGbMemoryHour on the KubernetesCluster row.
 */
const DEFAULT_COST_PER_CPU_CORE_HOUR: number = 0.032;
const DEFAULT_COST_PER_GB_MEMORY_HOUR: number = 0.004;
const DEFAULT_CURRENCY_CODE: string = "USD";
const HOURS_PER_MONTH: number = 730;
const BYTES_PER_GB: number = 1024 * 1024 * 1024;
const BYTES_PER_MI: number = 1024 * 1024;

const RIGHTSIZING_TOP_WORKLOADS: number = 15;
const RIGHTSIZING_MAX_CONTAINERS_PER_WORKLOAD: number = 4;

/*
 * Only suggest downsizing when there is meaningful headroom to reclaim:
 * requests already at (or near) the suggestion floors would produce
 * noise-level savings.
 */
const MIN_CPU_REQUEST_CORES_FOR_SUGGESTION: number = 0.05;
const MIN_MEMORY_REQUEST_BYTES_FOR_SUGGESTION: number = 64 * BYTES_PER_MI;
const CPU_SUGGESTION_FLOOR_CORES: number = 0.01;
const MEMORY_SUGGESTION_FLOOR_BYTES: number = 32 * BYTES_PER_MI;
const SUGGESTION_HEADROOM_MULTIPLIER: number = 1.3;

// kubeletstats receiver: cpu.utilization is a misnamed cores gauge.
const CONTAINER_CPU_METRIC: string = "container.cpu.utilization";
const CONTAINER_MEMORY_METRIC: string = "container.memory.working_set";

const TIMELINE_MAX_ITEMS: number = 300;
const TIMELINE_MAX_CHANGE_EVENTS: number = 200;
const TIMELINE_MAX_LOG_EVENTS: number = 500;
const MAX_CHANGED_FIELDS: number = 20;

export interface ProvisionedRecommendedMonitor {
  templateId: string;
  monitorId: string;
  monitorName: string;
}

export interface SkippedRecommendedMonitor {
  templateId: string;
  reason: string;
}

export interface FailedRecommendedMonitor {
  templateId: string;
  error: string;
}

export interface ProvisionRecommendedMonitorsResult {
  created: Array<ProvisionedRecommendedMonitor>;
  skipped: Array<SkippedRecommendedMonitor>;
  failed: Array<FailedRecommendedMonitor>;
}

export interface KubernetesCostReportPricing {
  cpuPerCoreHour: number;
  memoryPerGbHour: number;
  isDefaultPricing: boolean;
}

export interface KubernetesCostReportTotals {
  cpuRequestCores: number;
  memoryRequestGb: number;
  estimatedMonthlyCost: number;
}

export interface KubernetesNamespaceCost {
  namespace: string;
  podCount: number;
  cpuRequestCores: number;
  memoryRequestGb: number;
  estimatedMonthlyCost: number;
}

export interface KubernetesWorkloadCost {
  kind: string;
  name: string;
  namespace: string;
  podCount: number;
  cpuRequestCores: number;
  memoryRequestGb: number;
  estimatedMonthlyCost: number;
}

export interface KubernetesRightsizingEntry {
  workloadKind: string;
  workloadName: string;
  namespace: string;
  containerName: string;
  podCount: number;
  requestedCpuCores: number;
  requestedMemoryGb: number;
  p95CpuCores: number | null;
  p95MemoryGb: number | null;
  suggestedCpuCores: number | null;
  suggestedMemoryGb: number | null;
  vpaTargetCpuCores: number | null;
  vpaTargetMemoryBytes: number | null;
  estimatedMonthlySavings: number;
  suggestion: string;
}

export interface KubernetesCostReport {
  windowHours: number;
  currencyCode: string;
  pricing: KubernetesCostReportPricing;
  totals: KubernetesCostReportTotals;
  byNamespace: Array<KubernetesNamespaceCost>;
  topWorkloads: Array<KubernetesWorkloadCost>;
  rightsizing: Array<KubernetesRightsizingEntry>;
}

export type WorkloadTimelineSource =
  | "SpecChange"
  | "Deleted"
  | "KubernetesEvent";

export interface WorkloadTimelineChangedField {
  path: string;
  oldValue: string;
  newValue: string;
}

export interface WorkloadTimelineItem {
  occurredAt: string; // ISO timestamp
  source: WorkloadTimelineSource;
  title: string;
  message: string;
  involvedObject: {
    kind: string;
    name: string;
    namespace: string;
  };
  details: {
    changedFields?: Array<WorkloadTimelineChangedField> | undefined;
    eventType?: string | undefined;
    reason?: string | undefined;
  };
}

export interface WorkloadTimelineResult {
  items: Array<WorkloadTimelineItem>;
}

// Internal cost-report aggregation shapes.
interface ContainerRequestAggregate {
  requestedCpuCores: number;
  requestedMemoryBytes: number;
  podCount: number;
}

interface WorkloadAggregate {
  kind: string;
  name: string;
  namespace: string;
  podCount: number;
  cpuRequestCores: number;
  memoryRequestBytes: number;
  containers: Map<string, ContainerRequestAggregate>;
}

interface PodInventoryRow {
  namespaceKey: string;
  name: string;
  spec: JSONObject | null;
  ownerReferences: JSONValue | null;
}

interface VpaInventoryRow {
  namespaceKey: string;
  name: string;
  spec: JSONObject | null;
  status: JSONObject | null;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await KubernetesClusterLabelRuleEngineService.applyRulesToKubernetesCluster(
            createdItem,
          );
        })
        .then(async () => {
          await KubernetesClusterOwnerRuleEngineService.applyRulesToKubernetesCluster(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying kubernetes cluster rules in KubernetesClusterService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              kubernetesClusterId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByClusterIdentifier(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
  }): Promise<Model> {
    /*
     * Look up case-insensitively. The unique guard on name/clusterIdentifier
     * (checkUniqueColumnBy -> findWithSameText) compares case-insensitively,
     * so a case-sensitive lookup would miss an existing row on casing drift
     * (k8s.cluster.name), then fail to create it ("KubernetesCluster with the
     * same name already exists") and wedge ingest. Mirrors
     * LabelService.findOrCreateLabelByName. Unlike HostService we keep the
     * stored casing as-is: k8s.cluster.name is not normalized at ingest, so
     * lowering the identifier here would desync it from the raw-cased
     * resource.k8s.cluster.name attribute the detail page filters on.
     */
    const existingCluster: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        clusterIdentifier: QueryHelper.findWithSameText(data.clusterIdentifier),
      },
      select: {
        _id: true,
        projectId: true,
        clusterIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingCluster) {
      return existingCluster;
    }

    try {
      // Create new cluster
      const newCluster: Model = new Model();
      newCluster.projectId = data.projectId;
      newCluster.name = data.clusterIdentifier;
      newCluster.clusterIdentifier = data.clusterIdentifier;
      newCluster.otelCollectorStatus = "connected";
      newCluster.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdCluster: Model = await this.create({
        data: newCluster,
        props: {
          isRoot: true,
        },
      });

      return createdCluster;
    } catch {
      /*
       * Race condition: another request created the cluster concurrently.
       * Re-fetch the existing cluster.
       */
      const reFetchedCluster: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          clusterIdentifier: QueryHelper.findWithSameText(
            data.clusterIdentifier,
          ),
        },
        select: {
          _id: true,
          projectId: true,
          clusterIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedCluster) {
        return reFetchedCluster;
      }

      throw new Error(
        "Failed to create or find cluster: " + data.clusterIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    clusterId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
    },
  ): Promise<void> {
    const cacheKey: string = clusterId.toString();
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
        }),
      )
      .digest("hex");

    let cached: string | null = null;
    try {
      cached = await GlobalCache.getString(LAST_SEEN_CACHE_NAMESPACE, cacheKey);
    } catch {
      /*
       * Cache unavailable — fail open and refresh lastSeenAt anyway. A
       * cache error must never skip the DB write below, otherwise the
       * resource is wrongly marked "disconnected" while telemetry is
       * still flowing. Mirrors shouldRunMaintenance's fail-open stance.
       */
      cached = null;
    }

    if (cached === extrasFingerprint) {
      return; // same data was written recently
    }

    try {
      await GlobalCache.setString(
        LAST_SEEN_CACHE_NAMESPACE,
        cacheKey,
        extrasFingerprint,
        { expiresInSeconds: LAST_SEEN_THROTTLE_SECONDS },
      );
    } catch {
      // Best-effort throttle write; proceed with the DB update regardless.
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    if (extra?.agentVersion) {
      data.agentVersion = extra.agentVersion;
    }

    /*
     * Heartbeat write: a single-statement UPDATE with no hooks and no
     * `version` bump, avoiding the hot-row Postgres lock convoy that the
     * full updateOneById pipeline causes. See ServiceService.updateLastSeen.
     */
    await this.updateColumnsByIdWithoutHooks({
      id: clusterId,
      data: data,
    });
  }

  /**
   * Additively attach labels to a Kubernetes cluster. Existing labels
   * are never removed — manual labels set via the UI survive ingest.
   * The set of labelIds passed in is fingerprinted and cached for 60s
   * so the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    kubernetesClusterId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.kubernetesClusterId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const clusterIdStr: string = data.kubernetesClusterId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(clusterIdStr)
        .loadMany();

      const existingIds: Set<string> = new Set();
      for (const lbl of existingLabels) {
        const idStr: string | undefined = lbl._id?.toString();
        if (idStr) {
          existingIds.add(idStr);
        }
      }

      const toAddIds: Array<string> = [];
      const seen: Set<string> = new Set();
      for (const id of data.labelIds) {
        const idStr: string = id.toString();
        if (existingIds.has(idStr) || seen.has(idStr)) {
          continue;
        }
        seen.add(idStr);
        toAddIds.push(idStr);
      }

      if (toAddIds.length > 0) {
        await this.getRepository()
          .createQueryBuilder()
          .relation(Model, "labels")
          .of(clusterIdStr)
          .add(toAddIds);
      }

      await GlobalCache.setString(
        LABELS_APPLIED_CACHE_NAMESPACE,
        cacheKey,
        fingerprint,
        { expiresInSeconds: LABELS_APPLIED_CACHE_TTL_SECONDS },
      );
    } catch (err) {
      logger.warn(
        `KubernetesClusterService.attachLabels failed for cluster ${data.kubernetesClusterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedClusters(): Promise<void> {
    /*
     * Threshold must stay well above the 5-minute OTel ingest
     * maintenance fence (MAINTENANCE_FENCE_TTL_SECONDS in
     * OtelIngestBaseService) — lastSeenAt is legitimately up to
     * ~5 minutes stale during continuous telemetry, so a threshold
     * equal to the fence TTL flaps healthy resources. 15 minutes
     * gives 3x headroom.
     */
    const fifteenMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -15,
    );

    const connectedClusters: Array<Model> = await this.findBy({
      query: {
        otelCollectorStatus: "connected",
        lastSeenAt: QueryHelper.lessThan(fifteenMinutesAgo),
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const cluster of connectedClusters) {
      if (cluster._id) {
        await this.updateOneById({
          id: new ObjectID(cluster._id.toString()),
          data: {
            otelCollectorStatus: "disconnected",
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  /**
   * One-click provisioning of the recommended Kubernetes alert monitors
   * for a cluster. Idempotent: templates already provisioned for this
   * cluster (matched via customFields stamp or deterministic name) are
   * skipped. Per-template failures (e.g. free-plan monitor cap) are
   * reported and do not abort the remaining templates.
   *
   * `props` must be the caller's DatabaseCommonInteractionProps so
   * monitor create-ACLs are enforced.
   */
  @CaptureSpan()
  public async provisionRecommendedMonitors(data: {
    projectId: ObjectID;
    clusterName: string;
    clusterIdentifier: string;
    templateIds?: Array<string> | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<ProvisionRecommendedMonitorsResult> {
    const templateIds: Array<string> =
      data.templateIds && data.templateIds.length > 0
        ? data.templateIds
        : [...RECOMMENDED_KUBERNETES_ALERT_TEMPLATE_IDS];

    const result: ProvisionRecommendedMonitorsResult = {
      created: [],
      skipped: [],
      failed: [],
    };

    const [onlineStatus, offlineStatus, incidentSeverity, alertSeverity]: [
      MonitorStatus | null,
      MonitorStatus | null,
      IncidentSeverity | null,
      AlertSeverity | null,
    ] = await Promise.all([
      MonitorStatusService.findOneBy({
        query: {
          projectId: data.projectId,
          isOperationalState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      }),
      MonitorStatusService.findOneBy({
        query: {
          projectId: data.projectId,
          isOfflineState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      }),
      IncidentSeverityService.findOneBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      }),
      AlertSeverityService.findOneBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      }),
    ]);

    if (!onlineStatus || !onlineStatus.id) {
      throw new BadDataException(
        "This project has no operational monitor status. Please add a monitor status marked as operational before provisioning monitors.",
      );
    }

    if (!offlineStatus || !offlineStatus.id) {
      throw new BadDataException(
        "This project has no offline monitor status. Please add a monitor status marked as offline before provisioning monitors.",
      );
    }

    if (!incidentSeverity || !incidentSeverity.id) {
      throw new BadDataException(
        "This project has no incident severity. Please add an incident severity before provisioning monitors.",
      );
    }

    if (!alertSeverity || !alertSeverity.id) {
      throw new BadDataException(
        "This project has no alert severity. Please add an alert severity before provisioning monitors.",
      );
    }

    const onlineMonitorStatusId: ObjectID = onlineStatus.id;
    const offlineMonitorStatusId: ObjectID = offlineStatus.id;
    const defaultIncidentSeverityId: ObjectID = incidentSeverity.id;
    const defaultAlertSeverityId: ObjectID = alertSeverity.id;

    /*
     * Idempotency snapshot: query the project's Kubernetes monitors ONCE
     * before the loop. Monitor has no unique name constraint, so this
     * query-first check is the only guard against duplicates.
     */
    const existingMonitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        monitorType: MonitorType.Kubernetes,
      },
      select: {
        name: true,
        customFields: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const existingNames: Set<string> = new Set();
    const existingTemplateStamps: Set<string> = new Set();

    for (const monitor of existingMonitors) {
      if (monitor.name) {
        existingNames.add(monitor.name);
      }
      const customFields: JSONObject = monitor.customFields || {};
      const stampTemplateId: JSONValue =
        customFields["provisionedFromK8sTemplateId"];
      const stampClusterIdentifier: JSONValue =
        customFields["kubernetesClusterIdentifier"];
      if (
        typeof stampTemplateId === "string" &&
        typeof stampClusterIdentifier === "string"
      ) {
        existingTemplateStamps.add(
          `${stampTemplateId}\u0000${stampClusterIdentifier}`,
        );
      }
    }

    for (const templateId of templateIds) {
      const template: KubernetesAlertTemplate | undefined =
        getKubernetesAlertTemplateById(templateId);

      if (!template) {
        result.failed.push({
          templateId,
          error: "Unknown template id",
        });
        continue;
      }

      const monitorName: string = `${template.name} - ${data.clusterName}`;

      if (
        existingTemplateStamps.has(
          `${template.id}\u0000${data.clusterIdentifier}`,
        )
      ) {
        result.skipped.push({
          templateId,
          reason:
            "A monitor provisioned from this template already exists for this cluster",
        });
        continue;
      }

      if (existingNames.has(monitorName)) {
        result.skipped.push({
          templateId,
          reason: `A monitor named "${monitorName}" already exists`,
        });
        continue;
      }

      try {
        const step: MonitorStep = template.getMonitorStep({
          clusterIdentifier: data.clusterIdentifier,
          onlineMonitorStatusId,
          offlineMonitorStatusId,
          defaultIncidentSeverityId,
          defaultAlertSeverityId,
          monitorName,
        });

        const monitorSteps: MonitorSteps = new MonitorSteps();
        monitorSteps.data = {
          monitorStepsInstanceArray: [step],
          defaultMonitorStatusId: onlineMonitorStatusId,
        };

        const monitor: Monitor = new Monitor();
        monitor.name = monitorName;
        monitor.description = template.description;
        monitor.monitorType = MonitorType.Kubernetes;
        monitor.monitorSteps = monitorSteps;
        monitor.monitoringInterval = "* * * * *";
        monitor.customFields = {
          provisionedFromK8sTemplateId: template.id,
          kubernetesClusterIdentifier: data.clusterIdentifier,
        };

        const createdMonitor: Monitor = await MonitorService.create({
          data: monitor,
          props: data.props,
        });

        result.created.push({
          templateId,
          monitorId: createdMonitor.id?.toString() || "",
          monitorName,
        });

        // Guard against duplicate template ids inside the same request.
        existingNames.add(monitorName);
        existingTemplateStamps.add(
          `${template.id}\u0000${data.clusterIdentifier}`,
        );
      } catch (err) {
        result.failed.push({
          templateId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  /**
   * Cost + rightsizing report for a cluster. Inventory (requests) comes
   * from the Postgres KubernetesResource snapshot; observed usage comes
   * from ClickHouse container metrics (P95 over the window). Safe to run
   * as root internally — the API layer has already ACL-checked the
   * cluster, and every query below pins projectId + kubernetesClusterId.
   */
  @CaptureSpan()
  public async getCostReport(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    clusterIdentifier: string;
    costPerCpuCoreHour?: number | undefined;
    costPerGbMemoryHour?: number | undefined;
    currencyCode?: string | undefined;
    windowHours: number;
  }): Promise<KubernetesCostReport> {
    const cpuPerCoreHour: number =
      data.costPerCpuCoreHour ?? DEFAULT_COST_PER_CPU_CORE_HOUR;
    const memoryPerGbHour: number =
      data.costPerGbMemoryHour ?? DEFAULT_COST_PER_GB_MEMORY_HOUR;
    const isDefaultPricing: boolean =
      (data.costPerCpuCoreHour === null ||
        data.costPerCpuCoreHour === undefined) &&
      (data.costPerGbMemoryHour === null ||
        data.costPerGbMemoryHour === undefined);

    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveHours(
      endDate,
      -data.windowHours,
    );

    const [podRows, vpaRows]: [Array<PodInventoryRow>, Array<VpaInventoryRow>] =
      await Promise.all([
        this.getRepository().manager.query(
          `SELECT "namespaceKey", "name", "spec", "ownerReferences"
           FROM "KubernetesResource"
           WHERE "projectId" = $1
             AND "kubernetesClusterId" = $2
             AND "kind" = 'Pod'
             AND "deletedAt" IS NULL`,
          [data.projectId.toString(), data.kubernetesClusterId.toString()],
        ),
        this.getRepository().manager.query(
          `SELECT "namespaceKey", "name", "spec", "status"
           FROM "KubernetesResource"
           WHERE "projectId" = $1
             AND "kubernetesClusterId" = $2
             AND "kind" = 'VerticalPodAutoscaler'
             AND "deletedAt" IS NULL`,
          [data.projectId.toString(), data.kubernetesClusterId.toString()],
        ),
      ]);

    let totalCpuCores: number = 0;
    let totalMemoryBytes: number = 0;
    const byNamespace: Map<
      string,
      { podCount: number; cpuCores: number; memoryBytes: number }
    > = new Map();
    const byWorkload: Map<string, WorkloadAggregate> = new Map();

    for (const row of podRows) {
      const namespace: string = row.namespaceKey || "";
      const spec: JSONObject = row.spec || {};
      const containersRaw: unknown = spec["containers"];
      const containers: Array<JSONObject> = Array.isArray(containersRaw)
        ? (containersRaw as Array<JSONObject>)
        : [];

      let podCpuCores: number = 0;
      let podMemoryBytes: number = 0;
      const podContainers: Array<{
        name: string;
        cpuCores: number;
        memoryBytes: number;
      }> = [];

      for (const container of containers) {
        const containerName: string =
          typeof container["name"] === "string"
            ? (container["name"] as string)
            : "";
        const resources: JSONObject =
          (container["resources"] as JSONObject) || {};
        const requests: JSONObject =
          (resources["requests"] as JSONObject) || {};

        const cpuCores: number = parseKubernetesCpuQuantityToCores(
          requests["cpu"] as string | undefined,
        );
        const memoryBytes: number = parseKubernetesMemoryQuantityToBytes(
          requests["memory"] as string | undefined,
        );

        podCpuCores += cpuCores;
        podMemoryBytes += memoryBytes;
        if (containerName) {
          podContainers.push({ name: containerName, cpuCores, memoryBytes });
        }
      }

      totalCpuCores += podCpuCores;
      totalMemoryBytes += podMemoryBytes;

      const nsAggregate: {
        podCount: number;
        cpuCores: number;
        memoryBytes: number;
      } = byNamespace.get(namespace) || {
        podCount: 0,
        cpuCores: 0,
        memoryBytes: 0,
      };
      nsAggregate.podCount += 1;
      nsAggregate.cpuCores += podCpuCores;
      nsAggregate.memoryBytes += podMemoryBytes;
      byNamespace.set(namespace, nsAggregate);

      const owner: { kind: string; name: string } = resolveWorkloadOwner({
        podName: row.name,
        ownerReferences: row.ownerReferences,
      });
      const workloadKey: string = `${namespace}\u0000${owner.kind}\u0000${owner.name}`;
      const workload: WorkloadAggregate = byWorkload.get(workloadKey) || {
        kind: owner.kind,
        name: owner.name,
        namespace,
        podCount: 0,
        cpuRequestCores: 0,
        memoryRequestBytes: 0,
        containers: new Map(),
      };
      workload.podCount += 1;
      workload.cpuRequestCores += podCpuCores;
      workload.memoryRequestBytes += podMemoryBytes;
      for (const podContainer of podContainers) {
        const containerAggregate: ContainerRequestAggregate =
          workload.containers.get(podContainer.name) || {
            requestedCpuCores: 0,
            requestedMemoryBytes: 0,
            podCount: 0,
          };
        containerAggregate.podCount += 1;
        /*
         * Pods of one workload share a template, so per-pod requests for
         * the same container name should be identical — max() keeps the
         * report stable across a mid-rollout mix of old and new pods.
         */
        containerAggregate.requestedCpuCores = Math.max(
          containerAggregate.requestedCpuCores,
          podContainer.cpuCores,
        );
        containerAggregate.requestedMemoryBytes = Math.max(
          containerAggregate.requestedMemoryBytes,
          podContainer.memoryBytes,
        );
        workload.containers.set(podContainer.name, containerAggregate);
      }
      byWorkload.set(workloadKey, workload);
    }

    const namespaceCosts: Array<KubernetesNamespaceCost> = Array.from(
      byNamespace.entries(),
    )
      .map(
        (
          entry: [
            string,
            { podCount: number; cpuCores: number; memoryBytes: number },
          ],
        ): KubernetesNamespaceCost => {
          const [namespace, aggregate] = entry;
          return {
            namespace,
            podCount: aggregate.podCount,
            cpuRequestCores: roundTo(aggregate.cpuCores, 3),
            memoryRequestGb: roundTo(aggregate.memoryBytes / BYTES_PER_GB, 2),
            estimatedMonthlyCost: roundTo(
              estimateMonthlyCost(
                aggregate.cpuCores,
                aggregate.memoryBytes,
                cpuPerCoreHour,
                memoryPerGbHour,
              ),
              2,
            ),
          };
        },
      )
      .sort((a: KubernetesNamespaceCost, b: KubernetesNamespaceCost) => {
        return b.estimatedMonthlyCost - a.estimatedMonthlyCost;
      });

    const workloadCosts: Array<{
      workload: WorkloadAggregate;
      monthlyCost: number;
    }> = Array.from(byWorkload.values())
      .map(
        (
          workload: WorkloadAggregate,
        ): { workload: WorkloadAggregate; monthlyCost: number } => {
          return {
            workload,
            monthlyCost: estimateMonthlyCost(
              workload.cpuRequestCores,
              workload.memoryRequestBytes,
              cpuPerCoreHour,
              memoryPerGbHour,
            ),
          };
        },
      )
      .sort(
        (
          a: { workload: WorkloadAggregate; monthlyCost: number },
          b: { workload: WorkloadAggregate; monthlyCost: number },
        ) => {
          return b.monthlyCost - a.monthlyCost;
        },
      );

    const topWorkloadCosts: Array<{
      workload: WorkloadAggregate;
      monthlyCost: number;
    }> = workloadCosts.slice(0, RIGHTSIZING_TOP_WORKLOADS);

    const topWorkloads: Array<KubernetesWorkloadCost> = topWorkloadCosts.map(
      (entry: {
        workload: WorkloadAggregate;
        monthlyCost: number;
      }): KubernetesWorkloadCost => {
        return {
          kind: entry.workload.kind,
          name: entry.workload.name,
          namespace: entry.workload.namespace,
          podCount: entry.workload.podCount,
          cpuRequestCores: roundTo(entry.workload.cpuRequestCores, 3),
          memoryRequestGb: roundTo(
            entry.workload.memoryRequestBytes / BYTES_PER_GB,
            2,
          ),
          estimatedMonthlyCost: roundTo(entry.monthlyCost, 2),
        };
      },
    );

    const rightsizing: Array<KubernetesRightsizingEntry> = [];

    /*
     * ClickHouse P95 lookups: parallel within a workload (max 4
     * containers x 2 metrics), sequential across workloads to bound
     * the query fan-out.
     */
    for (const { workload } of topWorkloadCosts) {
      const containerNames: Array<string> = Array.from(
        workload.containers.keys(),
      ).slice(0, RIGHTSIZING_MAX_CONTAINERS_PER_WORKLOAD);

      if (containerNames.length === 0) {
        continue;
      }

      const usageByContainer: Array<{
        containerName: string;
        p95CpuCores: number | null;
        p95MemoryBytes: number | null;
      }> = await Promise.all(
        containerNames.map(
          async (
            containerName: string,
          ): Promise<{
            containerName: string;
            p95CpuCores: number | null;
            p95MemoryBytes: number | null;
          }> => {
            const [p95CpuCores, p95MemoryBytes]: [
              number | null,
              number | null,
            ] = await Promise.all([
              this.getP95ContainerMetricValue({
                projectId: data.projectId,
                clusterIdentifier: data.clusterIdentifier,
                namespace: workload.namespace,
                containerName,
                metricName: CONTAINER_CPU_METRIC,
                startDate,
                endDate,
              }),
              this.getP95ContainerMetricValue({
                projectId: data.projectId,
                clusterIdentifier: data.clusterIdentifier,
                namespace: workload.namespace,
                containerName,
                metricName: CONTAINER_MEMORY_METRIC,
                startDate,
                endDate,
              }),
            ]);
            return { containerName, p95CpuCores, p95MemoryBytes };
          },
        ),
      );

      for (const usage of usageByContainer) {
        const containerAggregate: ContainerRequestAggregate | undefined =
          workload.containers.get(usage.containerName);
        if (!containerAggregate) {
          continue;
        }

        const requestedCpuCores: number = containerAggregate.requestedCpuCores;
        const requestedMemoryBytes: number =
          containerAggregate.requestedMemoryBytes;

        let suggestedCpuCores: number | null = null;
        let suggestedMemoryBytes: number | null = null;
        let monthlySavings: number = 0;
        let suggestion: string;

        if (usage.p95CpuCores === null && usage.p95MemoryBytes === null) {
          suggestion = "No usage data in window";
        } else {
          if (
            usage.p95CpuCores !== null &&
            requestedCpuCores >= MIN_CPU_REQUEST_CORES_FOR_SUGGESTION &&
            usage.p95CpuCores < 0.5 * requestedCpuCores
          ) {
            const candidate: number = roundTo(
              Math.max(
                usage.p95CpuCores * SUGGESTION_HEADROOM_MULTIPLIER,
                CPU_SUGGESTION_FLOOR_CORES,
              ),
              3,
            );
            if (candidate < requestedCpuCores) {
              suggestedCpuCores = candidate;
              monthlySavings +=
                (requestedCpuCores - candidate) *
                cpuPerCoreHour *
                HOURS_PER_MONTH *
                containerAggregate.podCount;
            }
          }

          if (
            usage.p95MemoryBytes !== null &&
            requestedMemoryBytes >= MIN_MEMORY_REQUEST_BYTES_FOR_SUGGESTION &&
            usage.p95MemoryBytes < 0.5 * requestedMemoryBytes
          ) {
            // Round up to a whole Mi so it reads like a manifest value.
            const candidate: number =
              Math.ceil(
                Math.max(
                  usage.p95MemoryBytes * SUGGESTION_HEADROOM_MULTIPLIER,
                  MEMORY_SUGGESTION_FLOOR_BYTES,
                ) / BYTES_PER_MI,
              ) * BYTES_PER_MI;
            if (candidate < requestedMemoryBytes) {
              suggestedMemoryBytes = candidate;
              monthlySavings +=
                ((requestedMemoryBytes - candidate) / BYTES_PER_GB) *
                memoryPerGbHour *
                HOURS_PER_MONTH *
                containerAggregate.podCount;
            }
          }

          if (suggestedCpuCores !== null && suggestedMemoryBytes !== null) {
            suggestion = `Reduce CPU request from ${roundTo(
              requestedCpuCores,
              3,
            )} to ${suggestedCpuCores} cores and memory request from ${formatMemoryBytes(
              requestedMemoryBytes,
            )} to ${formatMemoryBytes(suggestedMemoryBytes)}`;
          } else if (suggestedCpuCores !== null) {
            suggestion = `Reduce CPU request from ${roundTo(
              requestedCpuCores,
              3,
            )} to ${suggestedCpuCores} cores`;
          } else if (suggestedMemoryBytes !== null) {
            suggestion = `Reduce memory request from ${formatMemoryBytes(
              requestedMemoryBytes,
            )} to ${formatMemoryBytes(suggestedMemoryBytes)}`;
          } else {
            suggestion = "Requests look right-sized for observed usage";
          }
        }

        const vpaTarget: {
          cpuCores: number | null;
          memoryBytes: number | null;
        } = findVpaTargetRecommendation({
          vpaRows,
          workload,
          containerName: usage.containerName,
        });

        rightsizing.push({
          workloadKind: workload.kind,
          workloadName: workload.name,
          namespace: workload.namespace,
          containerName: usage.containerName,
          podCount: containerAggregate.podCount,
          requestedCpuCores: roundTo(requestedCpuCores, 3),
          requestedMemoryGb: roundTo(requestedMemoryBytes / BYTES_PER_GB, 2),
          p95CpuCores:
            usage.p95CpuCores !== null ? roundTo(usage.p95CpuCores, 3) : null,
          p95MemoryGb:
            usage.p95MemoryBytes !== null
              ? roundTo(usage.p95MemoryBytes / BYTES_PER_GB, 2)
              : null,
          suggestedCpuCores,
          suggestedMemoryGb:
            suggestedMemoryBytes !== null
              ? roundTo(suggestedMemoryBytes / BYTES_PER_GB, 2)
              : null,
          vpaTargetCpuCores:
            vpaTarget.cpuCores !== null ? roundTo(vpaTarget.cpuCores, 3) : null,
          vpaTargetMemoryBytes: vpaTarget.memoryBytes,
          estimatedMonthlySavings: roundTo(monthlySavings, 2),
          suggestion,
        });
      }
    }

    return {
      windowHours: data.windowHours,
      currencyCode: data.currencyCode || DEFAULT_CURRENCY_CODE,
      pricing: {
        cpuPerCoreHour,
        memoryPerGbHour,
        isDefaultPricing,
      },
      totals: {
        cpuRequestCores: roundTo(totalCpuCores, 3),
        memoryRequestGb: roundTo(totalMemoryBytes / BYTES_PER_GB, 2),
        estimatedMonthlyCost: roundTo(
          estimateMonthlyCost(
            totalCpuCores,
            totalMemoryBytes,
            cpuPerCoreHour,
            memoryPerGbHour,
          ),
          2,
        ),
      },
      byNamespace: namespaceCosts,
      topWorkloads,
      rightsizing,
    };
  }

  /**
   * Merge Postgres spec-change events and ClickHouse Kubernetes events
   * into one descending timeline for a workload. Safe to run as root
   * internally — the API layer has already ACL-checked the cluster, and
   * every query below pins projectId (+ cluster).
   */
  @CaptureSpan()
  public async getWorkloadTimeline(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    clusterIdentifier: string;
    kind: string;
    name: string;
    namespace?: string | undefined;
    startDate: Date;
    endDate: Date;
  }): Promise<WorkloadTimelineResult> {
    const logQuery: AnalyticsQuery<Log> = {
      projectId: data.projectId,
      time: new InBetween<Date>(data.startDate, data.endDate),
      attributes: {
        "event.domain": "k8s",
        "k8s.resource.name": "events",
      } as Dictionary<string>,
    };

    const [changeEvents, eventLogs]: [
      Array<KubernetesResourceChangeEvent>,
      Array<Log>,
    ] = await Promise.all([
      KubernetesResourceChangeEventService.findBy({
        query: {
          projectId: data.projectId,
          kubernetesClusterId: data.kubernetesClusterId,
          kind: data.kind,
          namespaceKey: data.namespace || "",
          name: data.name,
          occurredAt: new InBetween<Date>(data.startDate, data.endDate),
        },
        select: {
          changeType: true,
          oldSpec: true,
          newSpec: true,
          occurredAt: true,
        },
        sort: {
          occurredAt: SortOrder.Descending,
        },
        limit: TIMELINE_MAX_CHANGE_EVENTS,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
      LogService.findBy({
        query: logQuery,
        select: {
          time: true,
          body: true,
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        limit: TIMELINE_MAX_LOG_EVENTS,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
    ]);

    const items: Array<WorkloadTimelineItem> = [];

    for (const changeEvent of changeEvents) {
      if (!changeEvent.occurredAt) {
        continue;
      }

      const involvedObject: { kind: string; name: string; namespace: string } =
        {
          kind: data.kind,
          name: data.name,
          namespace: data.namespace || "",
        };

      if (changeEvent.changeType === "Deleted") {
        items.push({
          occurredAt: OneUptimeDate.toString(changeEvent.occurredAt),
          source: "Deleted",
          title: "Resource deleted",
          message: `${data.kind} ${data.name} was removed from the cluster inventory`,
          involvedObject,
          details: {},
        });
        continue;
      }

      const changedFields: Array<WorkloadTimelineChangedField> =
        diffSpecObjects(
          changeEvent.oldSpec || null,
          changeEvent.newSpec || null,
        );

      const hasImageChange: boolean = changedFields.some(
        (field: WorkloadTimelineChangedField) => {
          return field.path === "image" || field.path.endsWith(".image");
        },
      );

      const changedPathsPreview: string = changedFields
        .slice(0, 3)
        .map((field: WorkloadTimelineChangedField) => {
          return field.path;
        })
        .join(", ");

      items.push({
        occurredAt: OneUptimeDate.toString(changeEvent.occurredAt),
        source: "SpecChange",
        title: hasImageChange ? "Image updated" : "Spec changed",
        message:
          changedFields.length > 0
            ? `${changedFields.length} field${
                changedFields.length === 1 ? "" : "s"
              } changed: ${changedPathsPreview}`
            : "Spec changed",
        involvedObject,
        details: {
          changedFields,
        },
      });
    }

    for (const log of eventLogs) {
      if (!log.time) {
        continue;
      }

      const attributes: JSONObject = log.attributes || {};
      const clusterAttribute: JSONValue | undefined =
        attributes["resource.k8s.cluster.name"] ||
        attributes["k8s.cluster.name"];
      if (clusterAttribute !== data.clusterIdentifier) {
        continue;
      }

      if (typeof log.body !== "string") {
        continue;
      }

      const parsed: ParsedKubernetesEventLog | null =
        parseKubernetesEventLogBody(log.body);
      if (!parsed) {
        continue;
      }

      const matchesWorkloadExactly: boolean =
        parsed.regardingKind.toLowerCase() === data.kind.toLowerCase() &&
        parsed.regardingName === data.name &&
        (!data.namespace ||
          !parsed.regardingNamespace ||
          parsed.regardingNamespace === data.namespace);

      // Controller-owned pods: "<workload-name>-<suffix>" in the same namespace.
      const matchesChildPod: boolean =
        parsed.regardingKind === "Pod" &&
        parsed.regardingName.startsWith(`${data.name}-`) &&
        (!data.namespace || parsed.regardingNamespace === data.namespace);

      if (!matchesWorkloadExactly && !matchesChildPod) {
        continue;
      }

      items.push({
        occurredAt: OneUptimeDate.toString(log.time),
        source: "KubernetesEvent",
        title: parsed.reason || "Kubernetes event",
        message: parsed.note,
        involvedObject: {
          kind: parsed.regardingKind || data.kind,
          name: parsed.regardingName || data.name,
          namespace: parsed.regardingNamespace || data.namespace || "",
        },
        details: {
          eventType: parsed.eventType,
          reason: parsed.reason,
        },
      });
    }

    // ISO timestamps sort lexicographically in chronological order.
    items.sort((a: WorkloadTimelineItem, b: WorkloadTimelineItem) => {
      if (a.occurredAt < b.occurredAt) {
        return 1;
      }
      if (a.occurredAt > b.occurredAt) {
        return -1;
      }
      return 0;
    });

    return {
      items: items.slice(0, TIMELINE_MAX_ITEMS),
    };
  }

  /**
   * P95 of a container metric over the window, filtered to one
   * (cluster, namespace, container) series set. ClickHouse aggregateBy
   * may return one aggregated row per time bucket — take the max so the
   * suggestion never undercuts the busiest bucket.
   */
  @CaptureSpan()
  private async getP95ContainerMetricValue(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
    namespace: string;
    containerName: string;
    metricName: string;
    startDate: Date;
    endDate: Date;
  }): Promise<number | null> {
    const query: AnalyticsQuery<Metric> = {
      projectId: data.projectId,
      time: new InBetween<Date>(data.startDate, data.endDate),
      name: data.metricName,
    };
    query.attributes = {
      "resource.k8s.cluster.name": data.clusterIdentifier,
      "resource.k8s.namespace.name": data.namespace,
      "resource.k8s.container.name": data.containerName,
    } as Dictionary<string>;

    const result: AggregatedResult = await MetricService.aggregateBy({
      query,
      aggregationType: AggregationType.P95,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: data.startDate,
      endTimestamp: data.endDate,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    let max: number | null = null;
    for (const row of result.data) {
      const aggregatedRow: AggregatedModel = row;
      if (
        typeof aggregatedRow.value === "number" &&
        !isNaN(aggregatedRow.value)
      ) {
        if (max === null || aggregatedRow.value > max) {
          max = aggregatedRow.value;
        }
      }
    }

    return max;
  }
}

function fingerprintLabelIds(labelIds: Array<ObjectID>): string {
  const sorted: Array<string> = labelIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex");
}

/**
 * Parse a Kubernetes CPU quantity ("100m", "1", "0.5") to cores.
 * Also accepts the rarer sub-milli suffixes ("u", "n") that VPA
 * recommendations can carry. Missing/invalid values parse to 0.
 */
function parseKubernetesCpuQuantityToCores(
  value: string | null | undefined,
): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const trimmed: string = String(value).trim();
  if (!trimmed) {
    return 0;
  }

  const divisorBySuffix: Dictionary<number> = {
    m: 1e3,
    u: 1e6,
    n: 1e9,
  };
  const suffix: string = trimmed.slice(-1);
  const divisor: number | undefined = divisorBySuffix[suffix];
  if (divisor) {
    const numeric: number = parseFloat(trimmed.slice(0, -1));
    return isNaN(numeric) ? 0 : numeric / divisor;
  }

  const numeric: number = parseFloat(trimmed);
  return isNaN(numeric) ? 0 : numeric;
}

/**
 * Parse a Kubernetes memory quantity ("128Mi", "1Gi", "512M", "1024",
 * ...) to bytes. Binary (Ki/Mi/Gi/Ti/Pi/Ei) and decimal (K/M/G/T/P/E)
 * suffixes plus plain byte counts. Missing/invalid values parse to 0.
 */
function parseKubernetesMemoryQuantityToBytes(
  value: string | null | undefined,
): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const trimmed: string = String(value).trim();
  if (!trimmed) {
    return 0;
  }

  const binaryMultipliers: Dictionary<number> = {
    Ki: Math.pow(2, 10),
    Mi: Math.pow(2, 20),
    Gi: Math.pow(2, 30),
    Ti: Math.pow(2, 40),
    Pi: Math.pow(2, 50),
    Ei: Math.pow(2, 60),
  };
  const decimalMultipliers: Dictionary<number> = {
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
  };

  const twoCharSuffix: string = trimmed.slice(-2);
  const binaryMultiplier: number | undefined = binaryMultipliers[twoCharSuffix];
  if (binaryMultiplier !== undefined) {
    const numeric: number = parseFloat(trimmed.slice(0, -2));
    return isNaN(numeric) ? 0 : numeric * binaryMultiplier;
  }

  const oneCharSuffix: string = trimmed.slice(-1);
  const decimalMultiplier: number | undefined =
    decimalMultipliers[oneCharSuffix];
  if (decimalMultiplier !== undefined) {
    const numeric: number = parseFloat(trimmed.slice(0, -1));
    return isNaN(numeric) ? 0 : numeric * decimalMultiplier;
  }

  const numeric: number = parseFloat(trimmed);
  return isNaN(numeric) ? 0 : numeric;
}

function roundTo(value: number, decimals: number): number {
  const factor: number = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function estimateMonthlyCost(
  cpuCores: number,
  memoryBytes: number,
  cpuPerCoreHour: number,
  memoryPerGbHour: number,
): number {
  return (
    cpuCores * cpuPerCoreHour * HOURS_PER_MONTH +
    (memoryBytes / BYTES_PER_GB) * memoryPerGbHour * HOURS_PER_MONTH
  );
}

function formatMemoryBytes(bytes: number): string {
  if (bytes >= BYTES_PER_GB) {
    return `${roundTo(bytes / BYTES_PER_GB, 2)} Gi`;
  }
  return `${Math.round(bytes / BYTES_PER_MI)} Mi`;
}

/**
 * Attribute a pod to its owning workload from ownerReferences (stored
 * either as an {items: [...]} wrapper or a plain array). ReplicaSets
 * are collapsed to their Deployment by stripping the trailing
 * pod-template-hash segment; ownerless pods count as standalone Pods.
 */
function resolveWorkloadOwner(data: {
  podName: string;
  ownerReferences: JSONValue | null;
}): { kind: string; name: string } {
  let items: Array<JSONObject> = [];
  const ownerReferences: unknown = data.ownerReferences;
  if (Array.isArray(ownerReferences)) {
    items = ownerReferences as Array<JSONObject>;
  } else if (ownerReferences && typeof ownerReferences === "object") {
    const wrapped: unknown = (ownerReferences as JSONObject)["items"];
    if (Array.isArray(wrapped)) {
      items = wrapped as Array<JSONObject>;
    }
  }

  const first: JSONObject | undefined = items[0];
  const ownerKind: string =
    first && typeof first["kind"] === "string" ? (first["kind"] as string) : "";
  const ownerName: string =
    first && typeof first["name"] === "string" ? (first["name"] as string) : "";

  if (!ownerKind || !ownerName) {
    return { kind: "Pod", name: data.podName };
  }

  if (ownerKind === "ReplicaSet") {
    // ReplicaSet names are "<deployment>-<pod-template-hash>".
    const lastDash: number = ownerName.lastIndexOf("-");
    return {
      kind: "Deployment",
      name: lastDash > 0 ? ownerName.substring(0, lastDash) : ownerName,
    };
  }

  return { kind: ownerKind, name: ownerName };
}

/**
 * Find the VPA target recommendation for one container of a workload:
 * spec.targetRef must name the workload (same namespace; kind compared
 * when present), then status.recommendation.containerRecommendations
 * is matched by container name.
 */
function findVpaTargetRecommendation(data: {
  vpaRows: Array<VpaInventoryRow>;
  workload: WorkloadAggregate;
  containerName: string;
}): { cpuCores: number | null; memoryBytes: number | null } {
  for (const vpa of data.vpaRows) {
    if ((vpa.namespaceKey || "") !== data.workload.namespace) {
      continue;
    }

    const spec: JSONObject = vpa.spec || {};
    const targetRef: JSONObject = (spec["targetRef"] as JSONObject) || {};
    const targetName: string =
      typeof targetRef["name"] === "string"
        ? (targetRef["name"] as string)
        : "";
    if (targetName !== data.workload.name) {
      continue;
    }

    const targetKind: string =
      typeof targetRef["kind"] === "string"
        ? (targetRef["kind"] as string)
        : "";
    if (
      targetKind &&
      targetKind.toLowerCase() !== data.workload.kind.toLowerCase()
    ) {
      continue;
    }

    const status: JSONObject = vpa.status || {};
    const recommendation: JSONObject =
      (status["recommendation"] as JSONObject) || {};
    const recommendationsRaw: unknown =
      recommendation["containerRecommendations"];
    const recommendations: Array<JSONObject> = Array.isArray(recommendationsRaw)
      ? (recommendationsRaw as Array<JSONObject>)
      : [];

    for (const containerRecommendation of recommendations) {
      if (containerRecommendation["containerName"] !== data.containerName) {
        continue;
      }
      const target: JSONObject =
        (containerRecommendation["target"] as JSONObject) || {};
      const cpuCores: number | null =
        typeof target["cpu"] === "string"
          ? parseKubernetesCpuQuantityToCores(target["cpu"] as string)
          : null;
      const memoryBytes: number | null =
        typeof target["memory"] === "string"
          ? parseKubernetesMemoryQuantityToBytes(target["memory"] as string)
          : null;
      return { cpuCores, memoryBytes };
    }
  }

  return { cpuCores: null, memoryBytes: null };
}

function stringifyDiffLeaf(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isPlainObject(value: unknown): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursive spec diff for the workload timeline. Objects recurse by
 * key union, arrays by index; anything else is a leaf compared by its
 * stringified value. Capped at MAX_CHANGED_FIELDS entries.
 */
function diffSpecObjects(
  oldSpec: JSONObject | null,
  newSpec: JSONObject | null,
): Array<WorkloadTimelineChangedField> {
  const changes: Array<WorkloadTimelineChangedField> = [];
  diffValues(oldSpec || {}, newSpec || {}, "", changes);
  return changes;
}

function diffValues(
  oldValue: unknown,
  newValue: unknown,
  path: string,
  out: Array<WorkloadTimelineChangedField>,
): void {
  if (out.length >= MAX_CHANGED_FIELDS) {
    return;
  }

  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    const keys: Set<string> = new Set([
      ...Object.keys(oldValue),
      ...Object.keys(newValue),
    ]);
    for (const key of keys) {
      if (out.length >= MAX_CHANGED_FIELDS) {
        return;
      }
      diffValues(
        oldValue[key],
        newValue[key],
        path ? `${path}.${key}` : key,
        out,
      );
    }
    return;
  }

  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const length: number = Math.max(oldValue.length, newValue.length);
    for (let i: number = 0; i < length; i++) {
      if (out.length >= MAX_CHANGED_FIELDS) {
        return;
      }
      diffValues(oldValue[i], newValue[i], `${path}[${i}]`, out);
    }
    return;
  }

  const oldString: string = stringifyDiffLeaf(oldValue);
  const newString: string = stringifyDiffLeaf(newValue);
  if (oldString !== newString) {
    out.push({
      path: path || "(root)",
      oldValue: oldString,
      newValue: newString,
    });
  }
}

export default new Service();
