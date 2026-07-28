import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerResource from "../../../../Models/DatabaseModels/DockerResource";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import KubernetesContainer from "../../../../Models/DatabaseModels/KubernetesContainer";
import KubernetesResource from "../../../../Models/DatabaseModels/KubernetesResource";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResourceService from "../../../Services/CloudResourceService";
import DockerHostService from "../../../Services/DockerHostService";
import DockerResourceService from "../../../Services/DockerResourceService";
import HostService from "../../../Services/HostService";
import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import KubernetesContainerService from "../../../Services/KubernetesContainerService";
import KubernetesResourceService from "../../../Services/KubernetesResourceService";
import ServerlessFunctionService from "../../../Services/ServerlessFunctionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import logger from "../../Logger";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * ---------------------------------------------------------------------------
 *                            query_infrastructure
 * ---------------------------------------------------------------------------
 *
 * The rest of the toolbox reads TELEMETRY (what happened over a window). This
 * tool reads the INVENTORY the customer's own agents write into Postgres: the
 * current state of Kubernetes containers/pods/nodes, Docker containers, hosts,
 * cloud resources and serverless functions. It is what answers "is that pod
 * OOMKilled?", "is it restarting?", "is the node under memory pressure?" —
 * questions no log or metric query can answer directly.
 *
 * Everything here is READ-ONLY and goes through the normal service layer under
 * the caller's props, so tenant scoping and RBAC are the database layer's job,
 * exactly as for every other read tool. No raw SQL, no new credentials, no
 * calls out to Kubernetes/Docker/cloud APIs.
 *
 * ---------------------------------------------------------------------------
 */

/*
 * A resource is stale when its agent has not checked in for this long.
 * 15 minutes matches the platform-wide disconnect sweeps
 * (HostService.markDisconnectedHosts, KubernetesClusterService.markDisconnected
 * Clusters, …): lastSeenAt is legitimately up to ~5 minutes behind during
 * healthy continuous telemetry because of the OTel ingest maintenance fence, so
 * anything shorter flags healthy agents as broken.
 */
export const INFRASTRUCTURE_STALE_AFTER_MINUTES: number = 15;

export const INFRASTRUCTURE_DEFAULT_LIMIT: number = 25;
export const INFRASTRUCTURE_MAX_LIMIT: number = 100;

/*
 * When unhealthyOnly is on we over-fetch and then apply the precise predicate
 * in memory, because "unhealthy" is an OR across columns and the find layer
 * only ANDs. The over-fetch is bounded so a huge cluster can never blow up the
 * query; families where the OR *can* be pushed down (pods, containers, docker)
 * push it down first, so the scan cap is a safety net rather than the filter.
 */
const UNHEALTHY_SCAN_MULTIPLIER: number = 4;
const MAX_SCAN_PER_QUERY: number = 300;

// The resource families this tool can read.
export enum InfrastructureResourceType {
  Kubernetes = "kubernetes",
  Docker = "docker",
  Host = "host",
  Cloud = "cloud",
  Serverless = "serverless",
  All = "all",
}

/*
 * Derived from the models' own read ACLs so the tool gate can never drift from
 * RBAC. This is the UNION across every family the tool can touch: a user who
 * holds only ReadHost passes the gate and simply gets nothing back from the
 * Kubernetes families, because each family query still runs under their props.
 *
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the model classes are fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      const models: Array<BaseModel> = [
        new KubernetesCluster(),
        new KubernetesResource(),
        new KubernetesContainer(),
        new DockerHost(),
        new DockerResource(),
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

/*
 * ---------------------------------------------------------------------------
 * Health predicates — pure, exported, and unit-tested directly.
 * ---------------------------------------------------------------------------
 */

export interface InfrastructureHealth {
  isUnhealthy: boolean;
  // Human-readable reasons, in the order an SRE would want to read them.
  signals: Array<string>;
}

function normalizeState(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

/*
 * A container that ran to completion is not broken. Job/CronJob pods sit in
 * terminated/Completed forever, and flagging them would bury the real crash
 * loops under noise.
 */
const BENIGN_CONTAINER_REASONS: Set<string> = new Set<string>(["completed"]);

// Pod phases that mean "nothing to see here".
const HEALTHY_POD_PHASES: Set<string> = new Set<string>([
  "running",
  "succeeded",
]);

const RUNNING_STATE: string = "running";

export interface KubernetesContainerHealthInput {
  state?: string | undefined;
  reason?: string | undefined;
  isReady?: boolean | undefined;
  restartCount?: number | undefined;
}

export function evaluateKubernetesContainerHealth(
  container: KubernetesContainerHealthInput,
): InfrastructureHealth {
  const signals: Array<string> = [];

  const state: string = normalizeState(container.state);
  const reason: string = normalizeState(container.reason);
  const ranToCompletion: boolean = BENIGN_CONTAINER_REASONS.has(reason);

  /*
   * Reason first: OOMKilled / CrashLoopBackOff / ImagePullBackOff is the single
   * most useful string on this row, so it leads the summary line.
   */
  if (reason && !ranToCompletion) {
    signals.push(`reason=${container.reason}`);
  }

  if (
    typeof container.restartCount === "number" &&
    container.restartCount > 0
  ) {
    signals.push(`${container.restartCount} restarts`);
  }

  // Strict false: null means "status not observed yet", which is not a signal.
  if (container.isReady === false && !ranToCompletion) {
    signals.push("not ready");
  }

  if (state && state !== RUNNING_STATE && !ranToCompletion) {
    signals.push(`state=${container.state}`);
  }

  return { isUnhealthy: signals.length > 0, signals };
}

export interface KubernetesResourceHealthInput {
  phase?: string | undefined;
  isReady?: boolean | undefined;
  hasMemoryPressure?: boolean | undefined;
  hasDiskPressure?: boolean | undefined;
  hasPidPressure?: boolean | undefined;
}

export function evaluateKubernetesResourceHealth(
  resource: KubernetesResourceHealthInput,
): InfrastructureHealth {
  const signals: Array<string> = [];

  const phase: string = normalizeState(resource.phase);
  // phase is null for every non-Pod kind — absence is not a signal.
  if (phase && !HEALTHY_POD_PHASES.has(phase)) {
    signals.push(`phase=${resource.phase}`);
  }

  if (resource.isReady === false) {
    signals.push("not ready");
  }

  if (resource.hasMemoryPressure) {
    signals.push("memory pressure");
  }

  if (resource.hasDiskPressure) {
    signals.push("disk pressure");
  }

  if (resource.hasPidPressure) {
    signals.push("pid pressure");
  }

  return { isUnhealthy: signals.length > 0, signals };
}

export interface DockerResourceHealthInput {
  state?: string | undefined;
}

export function evaluateDockerResourceHealth(
  resource: DockerResourceHealthInput,
): InfrastructureHealth {
  const state: string = normalizeState(resource.state);

  // state is null for non-Container kinds (images, volumes, networks).
  if (state && state !== RUNNING_STATE) {
    return { isUnhealthy: true, signals: [`state=${resource.state}`] };
  }

  return { isUnhealthy: false, signals: [] };
}

export interface AgentReportedHealthInput {
  otelCollectorStatus?: string | undefined;
  lastSeenAt?: Date | undefined;
}

/*
 * Shared predicate for everything that is "a thing running an agent": clusters,
 * docker hosts, hosts, cloud resources, serverless functions. For those, broken
 * means the collector is not connected, or the agent stopped checking in.
 */
export function evaluateAgentReportedHealth(
  resource: AgentReportedHealthInput,
  now: Date,
): InfrastructureHealth {
  const signals: Array<string> = [];

  const collectorStatus: string = normalizeState(resource.otelCollectorStatus);
  if (collectorStatus && collectorStatus !== "connected") {
    signals.push(`otel collector ${collectorStatus}`);
  }

  if (!resource.lastSeenAt) {
    signals.push("never checked in");
  } else {
    const lastSeenAt: Date = OneUptimeDate.fromString(resource.lastSeenAt);
    const staleAfter: Date = OneUptimeDate.addRemoveMinutes(
      now,
      -1 * INFRASTRUCTURE_STALE_AFTER_MINUTES,
    );

    if (lastSeenAt.getTime() < staleAfter.getTime()) {
      signals.push(
        `no agent check-in for ${OneUptimeDate.getDifferenceInMinutes(
          now,
          lastSeenAt,
        )}m (stale after ${INFRASTRUCTURE_STALE_AFTER_MINUTES}m)`,
      );
    }
  }

  return { isUnhealthy: signals.length > 0, signals };
}

/*
 * ---------------------------------------------------------------------------
 * Row assembly
 * ---------------------------------------------------------------------------
 */

interface InfrastructureRow {
  id: string | undefined;
  isUnhealthy: boolean;
  lastSeenAt: Date | undefined;
  row: JSONObject;
}

interface FetchParams {
  props: DatabaseCommonInteractionProps;
  nameFilter: string | undefined;
  unhealthyOnly: boolean;
  scanLimit: number;
  now: Date;
}

function toMegabytes(bytes: number | undefined): number | undefined {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    return undefined;
  }
  return Math.round(bytes / (1024 * 1024));
}

function toPercent(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(value * 10) / 10;
}

/*
 * The line the model reads first. It carries the whole diagnosis so the model
 * never has to infer what a column name means or which value is the bad one.
 */
function buildSummary(label: string, health: InfrastructureHealth): string {
  if (!health.isUnhealthy) {
    return `${label} — no problem signals`;
  }
  return `${label} — ${health.signals.join(", ")}`;
}

function buildRow(data: {
  resourceType: string;
  label: string;
  health: InfrastructureHealth;
  id: string | undefined;
  lastSeenAt: Date | undefined;
  fields: JSONObject;
}): InfrastructureRow {
  return {
    id: data.id,
    isUnhealthy: data.health.isUnhealthy,
    lastSeenAt: data.lastSeenAt,
    row: {
      // summary first so it survives any downstream field-level truncation.
      summary: buildSummary(data.label, data.health),
      resourceType: data.resourceType,
      health: data.health.isUnhealthy ? "unhealthy" : "ok",
      ...data.fields,
      lastSeenAt: data.lastSeenAt,
    },
  };
}

// isArchived is nullable, so a `isArchived: false` query would drop NULL rows.
function isArchived(model: { isArchived?: boolean | undefined }): boolean {
  return Boolean(model.isArchived);
}

function dedupeById(rows: Array<InfrastructureRow>): Array<InfrastructureRow> {
  const seen: Set<string> = new Set<string>();
  const deduped: Array<InfrastructureRow> = [];

  for (const row of rows) {
    const key: string | undefined = row.id;
    if (key) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    deduped.push(row);
  }

  return deduped;
}

/*
 * ---------------------------------------------------------------------------
 * Per-family fetchers. Each returns rows already health-evaluated.
 * ---------------------------------------------------------------------------
 */

async function fetchKubernetesContainers(
  params: FetchParams,
): Promise<Array<InfrastructureRow>> {
  const select: Select<KubernetesContainer> = {
    _id: true,
    podNamespaceKey: true,
    podName: true,
    name: true,
    image: true,
    state: true,
    reason: true,
    isReady: true,
    restartCount: true,
    memoryLimitBytes: true,
    latestCpuPercent: true,
    latestMemoryBytes: true,
    lastSeenAt: true,
    kubernetesCluster: {
      name: true,
    },
  };

  const nameQuery: JSONObject = params.nameFilter
    ? {
        /*
         * The OR-joined ILIKE Raw references the listed columns, not the
         * attached property — the established multiSearch attachment pattern.
         */
        name: QueryHelper.multiSearch(
          ["name", "podName", "podNamespaceKey", "image"],
          params.nameFilter,
        ),
      }
    : {};

  /*
   * Push the OR down as two indexed queries when we only want the broken ones:
   * not-ready covers crash loops / image pull failures, restartCount covers a
   * container that already recovered from an OOM kill. The precise predicate
   * then runs over the union, so state/reason still refine the result.
   */
  const queries: Array<JSONObject> = params.unhealthyOnly
    ? [
        { ...nameQuery, isReady: false },
        { ...nameQuery, restartCount: QueryHelper.greaterThan(0) },
      ]
    : [nameQuery];

  const results: Array<Array<KubernetesContainer>> = await Promise.all(
    queries.map((query: JSONObject) => {
      return KubernetesContainerService.findBy({
        query: query as never,
        select: select,
        sort: { lastSeenAt: SortOrder.Descending },
        limit: params.scanLimit,
        skip: 0,
        props: params.props,
      });
    }),
  );

  const rows: Array<InfrastructureRow> = [];

  for (const containers of results) {
    for (const container of containers) {
      const health: InfrastructureHealth =
        evaluateKubernetesContainerHealth(container);

      rows.push(
        buildRow({
          resourceType: "kubernetes_container",
          label: `k8s container ${container.podNamespaceKey || "-"}/${
            container.podName || "-"
          }/${container.name || "-"}`,
          health: health,
          id: container._id?.toString(),
          lastSeenAt: container.lastSeenAt,
          fields: {
            cluster: container.kubernetesCluster?.name,
            namespace: container.podNamespaceKey,
            pod: container.podName,
            container: container.name,
            state: container.state,
            reason: container.reason,
            restartCount: container.restartCount,
            isReady: container.isReady,
            image: container.image,
            cpuPercent: toPercent(container.latestCpuPercent),
            memoryMb: toMegabytes(container.latestMemoryBytes),
            memoryLimitMb: toMegabytes(container.memoryLimitBytes),
          },
        }),
      );
    }
  }

  return dedupeById(rows);
}

/*
 * A one-line-per-container summary of what is actually wrong inside a pod,
 * built from the pod's stored status.
 *
 * This is the cheap half of the crash-loop answer: the pod row already says
 * "not Running", and this adds the kubelet's own explanation — the previous
 * incarnation's terminated reason and exit code, or the waiting reason and
 * message — so the model reads "OOMKilled, exit 137" rather than having to
 * ask a second question to find out. Init containers are included, because a
 * pod stuck in Init:CrashLoopBackOff has no row in the container inventory at
 * all.
 *
 * Kept to a compact string: this runs for every unhealthy pod in a listing,
 * so the raw status JSONB would dominate the payload.
 */
function summarizeFailingContainers(
  status: JSONObject | undefined,
): string | undefined {
  if (!status) {
    return undefined;
  }

  const summaries: Array<string> = [];

  for (const key of ["initContainerStatuses", "containerStatuses"]) {
    const list: unknown = status[key];

    if (!Array.isArray(list)) {
      continue;
    }

    for (const entry of list) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const container: JSONObject = entry as JSONObject;
      const ready: boolean = container["ready"] === true;
      const restartCount: number = (container["restartCount"] as number) || 0;
      const state: string = (container["state"] as string) || "";
      const reason: string = (container["reason"] as string) || "";

      // Only the broken ones — a healthy sidecar is noise here.
      if (ready && restartCount === 0 && !reason) {
        continue;
      }

      const parts: Array<string> = [];
      const isInit: boolean = key === "initContainerStatuses";

      parts.push(
        `${container["name"] || "-"}${isInit ? " (init)" : ""}: ${state || "-"}${
          reason ? `/${reason}` : ""
        }`,
      );

      const lastState: JSONObject | undefined = container["lastState"] as
        | JSONObject
        | undefined;

      if (lastState) {
        const exitCode: unknown = lastState["exitCode"];
        parts.push(
          `last ${lastState["type"] || "-"}${
            lastState["reason"] ? `/${lastState["reason"]}` : ""
          }${
            exitCode === null || exitCode === undefined
              ? ""
              : ` exit ${exitCode}`
          }`,
        );
      }

      const message: string = (container["message"] as string) || "";

      if (message) {
        parts.push(message);
      }

      if (restartCount > 0) {
        parts.push(`${restartCount} restarts`);
      }

      summaries.push(parts.join(", "));
    }
  }

  return summaries.length > 0 ? summaries.join(" | ") : undefined;
}

async function fetchKubernetesResources(
  params: FetchParams,
): Promise<Array<InfrastructureRow>> {
  const select: Select<KubernetesResource> = {
    _id: true,
    kind: true,
    namespaceKey: true,
    name: true,
    phase: true,
    isReady: true,
    hasMemoryPressure: true,
    hasDiskPressure: true,
    hasPidPressure: true,
    containerCount: true,
    controllerDeploymentName: true,
    controllerCronJobName: true,
    latestCpuPercent: true,
    latestMemoryBytes: true,
    latestMemoryPercent: true,
    resourceCreationTimestamp: true,
    lastSeenAt: true,
    /*
     * Read for `failingContainers` below. Deliberately status only, not spec:
     * spec carries environment variable names and values, and this tool lists
     * many resources at once, so pulling it here would ship credentials-shaped
     * text into every broad listing. kubernetes_diagnose_pod reads spec for a
     * single named pod, where that cost is bounded and the detail is the point.
     */
    status: true,
    kubernetesCluster: {
      name: true,
    },
  };

  const nameQuery: JSONObject = params.nameFilter
    ? {
        name: QueryHelper.multiSearch(
          ["name", "namespaceKey", "controllerDeploymentName", "kind"],
          params.nameFilter,
        ),
      }
    : {};

  /*
   * Two pushdowns instead of one scan: pods whose phase is not a healthy
   * terminal phase, plus every Node (nodes are low cardinality — a handful per
   * cluster — and their signals are boolean pressure/ready columns that cannot
   * be OR'd in a single find query).
   */
  const queries: Array<JSONObject> = params.unhealthyOnly
    ? [
        {
          ...nameQuery,
          phase: QueryHelper.notIn(["Running", "Succeeded"]),
        },
        { ...nameQuery, kind: "Node" },
      ]
    : [nameQuery];

  const results: Array<Array<KubernetesResource>> = await Promise.all(
    queries.map((query: JSONObject) => {
      return KubernetesResourceService.findBy({
        query: query as never,
        select: select,
        sort: { lastSeenAt: SortOrder.Descending },
        limit: params.scanLimit,
        skip: 0,
        props: params.props,
      });
    }),
  );

  const rows: Array<InfrastructureRow> = [];

  for (const resources of results) {
    for (const resource of resources) {
      const health: InfrastructureHealth =
        evaluateKubernetesResourceHealth(resource);

      rows.push(
        buildRow({
          resourceType: "kubernetes_resource",
          label: `k8s ${resource.kind || "resource"} ${
            resource.namespaceKey ? `${resource.namespaceKey}/` : ""
          }${resource.name || "-"}`,
          health: health,
          id: resource._id?.toString(),
          lastSeenAt: resource.lastSeenAt,
          fields: {
            cluster: resource.kubernetesCluster?.name,
            kind: resource.kind,
            namespace: resource.namespaceKey,
            name: resource.name,
            phase: resource.phase,
            isReady: resource.isReady,
            hasMemoryPressure: resource.hasMemoryPressure,
            hasDiskPressure: resource.hasDiskPressure,
            hasPidPressure: resource.hasPidPressure,
            containerCount: resource.containerCount,
            controlledBy:
              resource.controllerDeploymentName ||
              resource.controllerCronJobName,
            cpuPercent: toPercent(resource.latestCpuPercent),
            memoryMb: toMegabytes(resource.latestMemoryBytes),
            memoryPercent: toPercent(resource.latestMemoryPercent),
            createdAt: resource.resourceCreationTimestamp,
            failingContainers: summarizeFailingContainers(resource.status),
          },
        }),
      );
    }
  }

  return dedupeById(rows);
}

async function fetchKubernetesClusters(
  params: FetchParams,
): Promise<Array<InfrastructureRow>> {
  const clusters: Array<KubernetesCluster> =
    await KubernetesClusterService.findBy({
      query: (params.nameFilter
        ? { name: QueryHelper.search(params.nameFilter) }
        : {}) as never,
      select: {
        _id: true,
        name: true,
        provider: true,
        nodeCount: true,
        podCount: true,
        namespaceCount: true,
        otelCollectorStatus: true,
        lastSeenAt: true,
        isArchived: true,
      },
      /*
       * Stalest first when hunting for problems: for agent-reported resources
       * the signal IS an old lastSeenAt, so sorting newest-first would put the
       * broken ones past the scan cap.
       */
      sort: {
        lastSeenAt: params.unhealthyOnly
          ? SortOrder.Ascending
          : SortOrder.Descending,
      },
      limit: params.scanLimit,
      skip: 0,
      props: params.props,
    });

  const rows: Array<InfrastructureRow> = [];

  for (const cluster of clusters) {
    if (isArchived(cluster)) {
      continue;
    }

    const health: InfrastructureHealth = evaluateAgentReportedHealth(
      cluster,
      params.now,
    );

    rows.push(
      buildRow({
        resourceType: "kubernetes_cluster",
        label: `k8s cluster ${cluster.name || "-"}`,
        health: health,
        id: cluster._id?.toString(),
        lastSeenAt: cluster.lastSeenAt,
        fields: {
          name: cluster.name,
          provider: cluster.provider,
          nodeCount: cluster.nodeCount,
          podCount: cluster.podCount,
          namespaceCount: cluster.namespaceCount,
          otelCollectorStatus: cluster.otelCollectorStatus,
        },
      }),
    );
  }

  return rows;
}

async function fetchDockerResources(
  params: FetchParams,
): Promise<Array<InfrastructureRow>> {
  const query: JSONObject = params.nameFilter
    ? {
        name: QueryHelper.multiSearch(
          ["name", "imageName", "kind"],
          params.nameFilter,
        ),
      }
    : {};

  /*
   * state is null for non-Container kinds and NOT IN drops NULLs, so this
   * pushdown is exact: it returns every container that is not running and
   * nothing else.
   */
  if (params.unhealthyOnly) {
    query["state"] = QueryHelper.notIn([RUNNING_STATE]);
  }

  const resources: Array<DockerResource> = await DockerResourceService.findBy({
    query: query as never,
    select: {
      _id: true,
      kind: true,
      name: true,
      containerId: true,
      imageName: true,
      state: true,
      latestCpuPercent: true,
      latestMemoryBytes: true,
      lastSeenAt: true,
      dockerHost: {
        name: true,
      },
    },
    sort: { lastSeenAt: SortOrder.Descending },
    limit: params.scanLimit,
    skip: 0,
    props: params.props,
  });

  return resources.map((resource: DockerResource) => {
    const health: InfrastructureHealth = evaluateDockerResourceHealth(resource);

    return buildRow({
      resourceType: "docker_resource",
      label: `docker ${resource.kind || "resource"} ${resource.name || "-"}`,
      health: health,
      id: resource._id?.toString(),
      lastSeenAt: resource.lastSeenAt,
      fields: {
        dockerHost: resource.dockerHost?.name,
        kind: resource.kind,
        name: resource.name,
        state: resource.state,
        image: resource.imageName,
        containerId: resource.containerId,
        cpuPercent: toPercent(resource.latestCpuPercent),
        memoryMb: toMegabytes(resource.latestMemoryBytes),
      },
    });
  });
}

async function fetchDockerHosts(
  params: FetchParams,
): Promise<Array<InfrastructureRow>> {
  const hosts: Array<DockerHost> = await DockerHostService.findBy({
    query: (params.nameFilter
      ? { name: QueryHelper.search(params.nameFilter) }
      : {}) as never,
    select: {
      _id: true,
      name: true,
      osType: true,
      containersRunning: true,
      containersStopped: true,
      containersPaused: true,
      otelCollectorStatus: true,
      lastSeenAt: true,
      isArchived: true,
    },
    sort: {
      lastSeenAt: params.unhealthyOnly
        ? SortOrder.Ascending
        : SortOrder.Descending,
    },
    limit: params.scanLimit,
    skip: 0,
    props: params.props,
  });

  const rows: Array<InfrastructureRow> = [];

  for (const host of hosts) {
    if (isArchived(host)) {
      continue;
    }

    const health: InfrastructureHealth = evaluateAgentReportedHealth(
      host,
      params.now,
    );

    rows.push(
      buildRow({
        resourceType: "docker_host",
        label: `docker host ${host.name || "-"}`,
        health: health,
        id: host._id?.toString(),
        lastSeenAt: host.lastSeenAt,
        fields: {
          name: host.name,
          osType: host.osType,
          containersRunning: host.containersRunning,
          containersStopped: host.containersStopped,
          containersPaused: host.containersPaused,
          otelCollectorStatus: host.otelCollectorStatus,
        },
      }),
    );
  }

  return rows;
}

async function fetchHosts(
  params: FetchParams,
): Promise<Array<InfrastructureRow>> {
  const hosts: Array<Host> = await HostService.findBy({
    query: (params.nameFilter
      ? {
          name: QueryHelper.multiSearch(
            ["name", "hostIdentifier", "hostIpAddresses"],
            params.nameFilter,
          ),
        }
      : {}) as never,
    select: {
      _id: true,
      name: true,
      hostIdentifier: true,
      osType: true,
      osVersion: true,
      hostArch: true,
      hostType: true,
      hostIpAddresses: true,
      cpuCores: true,
      totalMemoryBytes: true,
      otelCollectorStatus: true,
      lastSeenAt: true,
      isArchived: true,
    },
    sort: {
      lastSeenAt: params.unhealthyOnly
        ? SortOrder.Ascending
        : SortOrder.Descending,
    },
    limit: params.scanLimit,
    skip: 0,
    props: params.props,
  });

  const rows: Array<InfrastructureRow> = [];

  for (const host of hosts) {
    if (isArchived(host)) {
      continue;
    }

    const health: InfrastructureHealth = evaluateAgentReportedHealth(
      host,
      params.now,
    );

    rows.push(
      buildRow({
        resourceType: "host",
        label: `host ${host.name || host.hostIdentifier || "-"}`,
        health: health,
        id: host._id?.toString(),
        lastSeenAt: host.lastSeenAt,
        fields: {
          name: host.name,
          hostIdentifier: host.hostIdentifier,
          hostType: host.hostType,
          os:
            [host.osType, host.osVersion].filter(Boolean).join(" ") ||
            undefined,
          arch: host.hostArch,
          ipAddresses: host.hostIpAddresses,
          cpuCores: host.cpuCores,
          totalMemoryMb: toMegabytes(host.totalMemoryBytes),
          otelCollectorStatus: host.otelCollectorStatus,
        },
      }),
    );
  }

  return rows;
}

async function fetchCloudResources(
  params: FetchParams,
): Promise<Array<InfrastructureRow>> {
  const resources: Array<CloudResource> = await CloudResourceService.findBy({
    query: (params.nameFilter
      ? {
          name: QueryHelper.multiSearch(
            ["name", "resourceIdentifier", "cloudRegion"],
            params.nameFilter,
          ),
        }
      : {}) as never,
    select: {
      _id: true,
      name: true,
      cloudProvider: true,
      cloudRegion: true,
      cloudAccountId: true,
      runtimeName: true,
      runtimeVersion: true,
      otelCollectorStatus: true,
      lastSeenAt: true,
      isArchived: true,
    },
    sort: {
      lastSeenAt: params.unhealthyOnly
        ? SortOrder.Ascending
        : SortOrder.Descending,
    },
    limit: params.scanLimit,
    skip: 0,
    props: params.props,
  });

  const rows: Array<InfrastructureRow> = [];

  for (const resource of resources) {
    if (isArchived(resource)) {
      continue;
    }

    const health: InfrastructureHealth = evaluateAgentReportedHealth(
      resource,
      params.now,
    );

    rows.push(
      buildRow({
        resourceType: "cloud_resource",
        label: `cloud resource ${resource.name || "-"}`,
        health: health,
        id: resource._id?.toString(),
        lastSeenAt: resource.lastSeenAt,
        fields: {
          name: resource.name,
          cloudProvider: resource.cloudProvider,
          cloudRegion: resource.cloudRegion,
          cloudAccountId: resource.cloudAccountId,
          runtime:
            [resource.runtimeName, resource.runtimeVersion]
              .filter(Boolean)
              .join(" ") || undefined,
          otelCollectorStatus: resource.otelCollectorStatus,
        },
      }),
    );
  }

  return rows;
}

async function fetchServerlessFunctions(
  params: FetchParams,
): Promise<Array<InfrastructureRow>> {
  const functions: Array<ServerlessFunction> =
    await ServerlessFunctionService.findBy({
      query: (params.nameFilter
        ? {
            name: QueryHelper.multiSearch(
              ["name", "functionIdentifier", "cloudRegion"],
              params.nameFilter,
            ),
          }
        : {}) as never,
      select: {
        _id: true,
        name: true,
        cloudProvider: true,
        cloudRegion: true,
        cloudAccountId: true,
        functionVersion: true,
        runtimeName: true,
        runtimeVersion: true,
        otelCollectorStatus: true,
        lastSeenAt: true,
        isArchived: true,
      },
      sort: {
        lastSeenAt: params.unhealthyOnly
          ? SortOrder.Ascending
          : SortOrder.Descending,
      },
      limit: params.scanLimit,
      skip: 0,
      props: params.props,
    });

  const rows: Array<InfrastructureRow> = [];

  for (const serverlessFunction of functions) {
    if (isArchived(serverlessFunction)) {
      continue;
    }

    const health: InfrastructureHealth = evaluateAgentReportedHealth(
      serverlessFunction,
      params.now,
    );

    rows.push(
      buildRow({
        resourceType: "serverless_function",
        label: `serverless function ${serverlessFunction.name || "-"}`,
        health: health,
        id: serverlessFunction._id?.toString(),
        lastSeenAt: serverlessFunction.lastSeenAt,
        fields: {
          name: serverlessFunction.name,
          cloudProvider: serverlessFunction.cloudProvider,
          cloudRegion: serverlessFunction.cloudRegion,
          cloudAccountId: serverlessFunction.cloudAccountId,
          functionVersion: serverlessFunction.functionVersion,
          runtime:
            [serverlessFunction.runtimeName, serverlessFunction.runtimeVersion]
              .filter(Boolean)
              .join(" ") || undefined,
          otelCollectorStatus: serverlessFunction.otelCollectorStatus,
        },
      }),
    );
  }

  return rows;
}

interface FamilyFetcher {
  name: string;
  fetch: (params: FetchParams) => Promise<Array<InfrastructureRow>>;
}

function getFetchersForResourceType(
  resourceType: InfrastructureResourceType,
): Array<FamilyFetcher> {
  const kubernetes: Array<FamilyFetcher> = [
    { name: "kubernetes_container", fetch: fetchKubernetesContainers },
    { name: "kubernetes_resource", fetch: fetchKubernetesResources },
    { name: "kubernetes_cluster", fetch: fetchKubernetesClusters },
  ];
  const docker: Array<FamilyFetcher> = [
    { name: "docker_resource", fetch: fetchDockerResources },
    { name: "docker_host", fetch: fetchDockerHosts },
  ];
  const host: Array<FamilyFetcher> = [{ name: "host", fetch: fetchHosts }];
  const cloud: Array<FamilyFetcher> = [
    { name: "cloud_resource", fetch: fetchCloudResources },
  ];
  const serverless: Array<FamilyFetcher> = [
    { name: "serverless_function", fetch: fetchServerlessFunctions },
  ];

  switch (resourceType) {
    case InfrastructureResourceType.Kubernetes:
      return kubernetes;
    case InfrastructureResourceType.Docker:
      return docker;
    case InfrastructureResourceType.Host:
      return host;
    case InfrastructureResourceType.Cloud:
      return cloud;
    case InfrastructureResourceType.Serverless:
      return serverless;
    default:
      return [...kubernetes, ...docker, ...host, ...cloud, ...serverless];
  }
}

export function parseResourceType(
  value: string | undefined,
): InfrastructureResourceType {
  const normalized: string = normalizeState(value);

  const match: InfrastructureResourceType | undefined = Object.values(
    InfrastructureResourceType,
  ).find((candidate: InfrastructureResourceType) => {
    return candidate === normalized;
  });

  return match ?? InfrastructureResourceType.All;
}

export const QueryInfrastructureTool: ObservabilityTool = {
  name: "query_infrastructure",
  description:
    "Read the CURRENT state of the infrastructure this project's OneUptime agents report: Kubernetes containers/pods/nodes/clusters, Docker containers and hosts, hosts, cloud resources and serverless functions. This is the tool that answers 'is that pod OOMKilled?', 'is it restarting?', 'is the node under memory pressure?', 'is the container actually running?' — it returns reason (OOMKilled / CrashLoopBackOff / ImagePullBackOff), restart counts, readiness, pod phase, node memory/disk/pid pressure, container state, CPU/memory, and agent connection status. " +
    "IMPORTANT: this is a live snapshot of inventory, NOT historical telemetry — it has no time range and cannot tell you what the state was an hour ago. Every row carries lastSeenAt: that is when the customer's agent last reported this object. If lastSeenAt is more than " +
    `${INFRASTRUCTURE_STALE_AFTER_MINUTES} minutes old the row is stale — say so rather than presenting it as current truth. ` +
    "This complements query_metrics and search_logs (which have history and answer 'what happened over this window') by answering 'what is the state of this thing RIGHT NOW'. A typical investigation pairs them: find the failing service in logs/metrics, then call this to see whether its pod is crash-looping or its node is out of memory. " +
    "By default it returns only resources showing problem signals (unhealthyOnly), so an empty result is meaningful: it means nothing in the inventory currently looks broken.",
  inputSchema: {
    type: "object",
    properties: {
      resourceType: {
        type: "string",
        enum: Object.values(InfrastructureResourceType),
        description:
          "Which family of infrastructure to read. 'kubernetes' covers containers, pods/nodes and clusters; 'docker' covers containers and docker hosts; 'host' covers agent-monitored machines; 'cloud' and 'serverless' cover cloud resources and functions. Default 'all'.",
      },
      nameFilter: {
        type: "string",
        description:
          "Case-insensitive substring match against the resource name, and also the Kubernetes namespace / pod name / image, the Docker image, and the host identifier. Use this to scope to one workload (e.g. 'checkout') instead of scanning everything.",
      },
      unhealthyOnly: {
        type: "boolean",
        description:
          "Default TRUE — return only resources showing a problem signal: containers with restarts / not ready / a non-running state or reason, pods not in Running or Succeeded, nodes under memory/disk/pid pressure or not ready, Docker containers not running, and hosts/clusters/cloud resources whose collector is disconnected or whose agent has stopped checking in. Set false to list everything, including healthy resources.",
      },
      limit: {
        type: "number",
        description: `Maximum rows to return across all families (default ${INFRASTRUCTURE_DEFAULT_LIMIT}, max ${INFRASTRUCTURE_MAX_LIMIT}).`,
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
    const resourceType: InfrastructureResourceType = parseResourceType(
      ToolArgs.getString(args, "resourceType"),
    );
    const nameFilter: string | undefined = ToolArgs.getString(
      args,
      "nameFilter",
    );
    const unhealthyOnly: boolean =
      ToolArgs.getBoolean(args, "unhealthyOnly") ?? true;
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: INFRASTRUCTURE_DEFAULT_LIMIT,
      min: 1,
      max: INFRASTRUCTURE_MAX_LIMIT,
    });

    const now: Date = OneUptimeDate.getCurrentDate();

    const params: FetchParams = {
      props: ctx.props,
      nameFilter: nameFilter,
      unhealthyOnly: unhealthyOnly,
      scanLimit: unhealthyOnly
        ? Math.min(limit * UNHEALTHY_SCAN_MULTIPLIER, MAX_SCAN_PER_QUERY)
        : limit,
      now: now,
    };

    const fetchers: Array<FamilyFetcher> =
      getFetchersForResourceType(resourceType);

    /*
     * One family failing (most often because the caller lacks that family's
     * read permission) must never fail the whole call — the model still gets
     * everything it IS allowed to see. Same posture as recent_changes.
     */
    const perFamilyRows: Array<Array<InfrastructureRow>> = await Promise.all(
      fetchers.map(async (fetcher: FamilyFetcher) => {
        try {
          return await fetcher.fetch(params);
        } catch (error) {
          logger.debug(
            `query_infrastructure: ${fetcher.name} source skipped: ${error}`,
          );
          return [];
        }
      }),
    );

    let allRows: Array<InfrastructureRow> = perFamilyRows.flat();

    if (unhealthyOnly) {
      allRows = allRows.filter((row: InfrastructureRow) => {
        return row.isUnhealthy;
      });
    }

    /*
     * Unhealthy first, then most recently seen first: the model reads top-down
     * and the freshest broken thing is the one worth investigating.
     */
    allRows.sort((a: InfrastructureRow, b: InfrastructureRow) => {
      if (a.isUnhealthy !== b.isUnhealthy) {
        return a.isUnhealthy ? -1 : 1;
      }
      const aTime: number = a.lastSeenAt ? a.lastSeenAt.getTime() : 0;
      const bTime: number = b.lastSeenAt ? b.lastSeenAt.getTime() : 0;
      return bTime - aTime;
    });

    const totalMatched: number = allRows.length;
    const rows: Array<JSONObject> = allRows
      .slice(0, limit)
      .map((row: InfrastructureRow) => {
        return row.row;
      });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const scopeLabel: string = `${resourceType}${
      nameFilter ? ` matching "${nameFilter}"` : ""
    }`;

    /*
     * Snapshot header. Without it the model has no anchor for "how old is
     * this?" and can report a stale row as the current state of the world.
     */
    const header: string = [
      `Current infrastructure inventory (${scopeLabel}), snapshot read at ${now.toISOString()}.`,
      unhealthyOnly
        ? "Filtered to resources showing problem signals only."
        : "All resources, healthy and unhealthy.",
      `This is live state, not history. lastSeenAt is when the agent last reported the resource — treat anything older than ${INFRASTRUCTURE_STALE_AFTER_MINUTES} minutes as stale, not as current truth.`,
      totalMatched > rows.length
        ? `Showing ${rows.length} of ${totalMatched} matching resources — narrow with nameFilter or resourceType to see the rest.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      dataForLlm: `${header}\n\n${serialized.text}`,
      rowCount: serialized.rowCount,
      citationLabel: `Infrastructure state — ${scopeLabel}${
        unhealthyOnly ? ", unhealthy only" : ""
      } (${serialized.rowCount} shown)`,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated || totalMatched > rows.length,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Infrastructure state (${rows.length})`,
              description: `${scopeLabel}${
                unhealthyOnly ? " · unhealthy only" : ""
              } · snapshot at ${now.toISOString()}`,
              columns: [
                { key: "summary", title: "Resource", type: "text" },
                { key: "resourceType", title: "Type", type: "text" },
                { key: "health", title: "Health", type: "text" },
                { key: "lastSeenAt", title: "Last seen", type: "date" },
              ],
              rows: rows,
            })
          : undefined,
    };
  },
};
