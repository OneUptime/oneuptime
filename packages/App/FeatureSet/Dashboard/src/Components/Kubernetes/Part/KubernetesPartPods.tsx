import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import KubernetesResourceTable, {
  ResourceColumn,
} from "../KubernetesResourceTable";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/KubernetesResourceMetricDescriptions";
import {
  KubernetesPartRead,
  KubernetesPartRow,
  KubernetesPodFacts,
  getKubernetesPodFacts,
  sortKubernetesPodFacts,
} from "../../../Pages/Kubernetes/Utils/KubernetesPartFacts";
import KubernetesResourceUtils, {
  KubernetesResource,
  kubernetesHealthTextInEnglish,
} from "../../../Pages/Kubernetes/Utils/KubernetesResourceUtils";
import { KubernetesPartRoutes } from "../../../Pages/Kubernetes/Utils/KubernetesPartRoutes";

/*
 * The pods a workload runs, or a node runs, on its own page: what k9s and
 * Lens show first for a Deployment - each pod's state in Kubernetes' own
 * words, coloured where it needs a look, how many of its containers are
 * ready, how often they restarted, where it runs and how busy it is. The
 * ones that need attention come first, by the cluster's own rules
 * (KubernetesHealth), so a crash-looping replica is never on page two.
 * Each opens the pod's page, in its namespace.
 */

export interface ComponentProps {
  kind: string;
  read: KubernetesPartRead | null;
  isLoading: boolean;
  error: string;
  routes: KubernetesPartRoutes;
  onRefreshClick?: (() => void) | undefined;
}

type Json = Record<string, unknown>;

// What the pod's containers may use at most, added up.
function memoryLimitOf(row: KubernetesPartRow): number | null {
  const spec: Json =
    row.spec && typeof row.spec === "object" ? (row.spec as Json) : {};
  const containers: Array<Json> = Array.isArray(spec["containers"])
    ? (spec["containers"] as Array<Json>)
    : [];
  let total: number = 0;
  for (const container of containers) {
    const resources: Json =
      (container?.["resources"] as Json | undefined) || {};
    const limits: Json = (resources["limits"] as Json | undefined) || {};
    const memory: unknown = limits["memory"];
    if (typeof memory === "string" && memory) {
      total += KubernetesResourceUtils.parseK8sMemoryToBytes(memory);
    }
  }
  return total > 0 ? total : null;
}

function freshNumber(
  row: KubernetesPartRow,
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const updatedAt: number = row.metricsUpdatedAt
    ? new Date(row.metricsUpdatedAt).getTime()
    : NaN;
  if (
    !Number.isFinite(updatedAt) ||
    Date.now() - updatedAt > KubernetesResourceUtils.METRIC_STALE_MS
  ) {
    return null;
  }
  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const KubernetesPartPods: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.error && !props.read) {
    return (
      <ErrorMessage
        message={props.error}
        onRefreshClick={props.onRefreshClick}
      />
    );
  }

  const rows: Array<KubernetesPartRow> = props.read?.pods || [];
  const facts: Array<KubernetesPodFacts> = sortKubernetesPodFacts(
    rows.map(getKubernetesPodFacts),
  );
  const rowsByKey: Map<string, KubernetesPartRow> = new Map<
    string,
    KubernetesPartRow
  >(
    rows.map((row: KubernetesPartRow): [string, KubernetesPartRow] => {
      return [`${row.namespaceKey || ""}/${row.name || ""}`, row];
    }),
  );

  const resources: Array<KubernetesResource> = facts.map(
    (pod: KubernetesPodFacts): KubernetesResource => {
      const row: KubernetesPartRow | undefined = rowsByKey.get(
        `${pod.namespace}/${pod.name}`,
      );
      const created: string | undefined = row?.resourceCreationTimestamp
        ? OneUptimeDate.toString(new Date(row.resourceCreationTimestamp))
        : undefined;
      return {
        name: pod.name,
        namespace: pod.namespace,
        cpuUtilization: row ? freshNumber(row, row.latestCpuPercent) : null,
        memoryUsageBytes: row ? freshNumber(row, row.latestMemoryBytes) : null,
        memoryLimitBytes: row ? memoryLimitOf(row) : null,
        // English for the filter and the sort; drawn in the reader's words.
        status: kubernetesHealthTextInEnglish(pod.assessment.status),
        statusText: pod.assessment.status.values
          ? {
              text: pod.assessment.status.text,
              values: pod.assessment.status.values,
            }
          : { text: pod.assessment.status.text },
        statusTone: pod.assessment.tone,
        age: KubernetesResourceUtils.formatAge(created),
        additionalAttributes: {
          ready: pod.ready || "-",
          restarts: String(pod.restarts),
          node: pod.nodeName || "-",
          owner: pod.ownerName || "-",
        },
      };
    },
  );

  const columns: Array<ResourceColumn> = [
    {
      title: "Ready",
      key: "ready",
      description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podReady,
    },
    {
      title: "Restarts",
      key: "restarts",
      description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podRestarts,
    },
  ];

  if (props.kind === "Node") {
    columns.push({
      title: "Workload",
      key: "owner",
      description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podWorkload,
    });
  } else {
    columns.push({
      title: "Node",
      key: "node",
      description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podNode,
    });
  }

  if (props.kind === "CronJob") {
    columns.push({
      title: "Job",
      key: "owner",
      description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podJob,
    });
  }

  return (
    <div data-testid={`kubernetes-${props.kind.toLowerCase()}-pods`}>
      {props.error ? (
        <div className="mb-4">
          <ErrorMessage message={props.error} />
        </div>
      ) : (
        <></>
      )}
      <KubernetesResourceTable
        title="Pods"
        description={
          props.kind === "Node"
            ? "The pods scheduled on this node, those that need attention first."
            : props.kind === "CronJob"
              ? "The pods of this CronJob's runs, those that need attention first."
              : "The pods this workload runs, those that need attention first."
        }
        resources={resources}
        isLoading={props.isLoading && !props.read}
        showNamespace={props.kind === "Node"}
        onRefreshClick={props.onRefreshClick}
        builtInColumnDescriptions={{
          status: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podStatus,
          cpu: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podCpu,
          memory: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podMemory,
        }}
        columns={columns}
        emptyMessage={
          props.kind === "Node"
            ? "No pods are scheduled on this node."
            : "No pods. They appear here once the Kubernetes agent reports them, within five minutes."
        }
        getViewRoute={(resource: KubernetesResource): Route => {
          return (
            props.routes.getPartRoute({
              kind: "Pod",
              name: resource.name,
              namespace: resource.namespace,
            }) || props.routes.clusterRoute
          );
        }}
      />
    </div>
  );
};

export default KubernetesPartPods;
