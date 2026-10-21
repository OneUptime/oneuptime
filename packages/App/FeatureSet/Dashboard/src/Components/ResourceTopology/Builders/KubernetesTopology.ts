import KubernetesContainer from "Common/Models/DatabaseModels/KubernetesContainer";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyIssue,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  ResourceTopologyText,
  ResourceTopologyTruncation,
  buildResourceTopologyGraph,
} from "../ResourceTopologyModel";
import {
  OpenIssueRecord,
  attachOpenIssues,
  readSeriesLabel,
} from "../ResourceTopologyIssues";
import {
  formatTopologyBytes,
  formatTopologyPercent,
  isRecent,
  toFiniteNumber,
} from "../ResourceTopologyFormat";

/*
 * A Kubernetes cluster's topology, read from the cluster's inventory (the
 * KubernetesResource and KubernetesContainer rows its pages list), two ways:
 *
 *   - Workloads: namespace > deployment, StatefulSet, DaemonSet, CronJob
 *     (with its jobs) or job > pods, with each namespace's volume claims and
 *     the cluster's persistent volumes. "What runs, and is it healthy?"
 *   - Nodes: node > the pods scheduled on it, and the pods not scheduled
 *     anywhere yet. "Where does it run, and is the machine healthy?"
 *
 * A pod is linked to its node ("Runs on") and to the claims it mounts
 * ("Uses"), and a claim to the volume it is bound to ("Bound to"), so a
 * focused pod shows its node and storage beside it in either reading.
 *
 * Health is what the cluster's own pages show: a node that is not ready is
 * critical, one under memory, disk or PID pressure needs attention; a pod
 * that failed, or whose container waits in CrashLoopBackOff or
 * ImagePullBackOff, is critical, a pending or not-ready one needs
 * attention, a completed one is off; a workload with no ready replica is
 * critical, one short of replicas needs attention.
 */

export const KUBERNETES_ROOT_ID: string = "cluster";
export const KUBERNETES_UNSCHEDULED_ID: string = "section:unscheduled";

export const KUBERNETES_WORKLOADS_ARRANGEMENT: string = "workloads";
export const KUBERNETES_NODES_ARRANGEMENT: string = "nodes";

export const KUBERNETES_METRIC_STALE_MS: number = 15 * 60 * 1000;

/* Container waits that mean the pod cannot run as it is. */
export const KUBERNETES_FAILING_WAIT_REASONS: ReadonlySet<string> =
  new Set<string>([
    "CrashLoopBackOff",
    "ImagePullBackOff",
    "ErrImagePull",
    "InvalidImageName",
    "CreateContainerConfigError",
    "CreateContainerError",
    "RunContainerError",
    "ContainerCannotRun",
    "OOMKilled",
  ]);

export interface KubernetesTopologyCluster {
  id: string;
  name: string;
  lastSeenAt?: Date | null | undefined;
}

export interface KubernetesTopologyInput {
  cluster: KubernetesTopologyCluster;
  rows: Array<KubernetesResource>;
  containers?: Array<KubernetesContainer> | undefined;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

export interface KubernetesTopology {
  workloads: ResourceTopologyGraph;
  nodes: ResourceTopologyGraph;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function asArray(value: unknown): Array<Json> {
  return Array.isArray(value)
    ? value.filter((item: unknown): boolean => {
        return Boolean(item) && typeof item === "object";
      }) as Array<Json>
    : [];
}

function readNumber(source: Json, key: string): number | null {
  return toFiniteNumber(source[key]);
}

function readString(source: Json, key: string): string {
  const value: unknown = source[key];

  return typeof value === "string" ? value : "";
}

function text(
  value: string,
  values?: Record<string, string> | undefined,
): ResourceTopologyText {
  return values ? { text: value, values: values } : { text: value };
}

const WORKLOAD_KIND_BY_OWNER: Record<string, string> = {
  Deployment: "k8s.deployment",
  StatefulSet: "k8s.statefulset",
  DaemonSet: "k8s.daemonset",
  Job: "k8s.job",
  CronJob: "k8s.cronjob",
};

const DETAIL_PAGE_BY_KIND: Record<string, PageMap> = {
  "k8s.namespace": PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL,
  "k8s.node": PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
  "k8s.deployment": PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
  "k8s.statefulset": PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
  "k8s.daemonset": PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL,
  "k8s.job": PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL,
  "k8s.cronjob": PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL,
  "k8s.pod": PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
  "k8s.pvc": PageMap.KUBERNETES_CLUSTER_VIEW_PVC_DETAIL,
  "k8s.pv": PageMap.KUBERNETES_CLUSTER_VIEW_PV_DETAIL,
};

const KIND_BY_ROW_KIND: Record<string, string> = {
  Namespace: "k8s.namespace",
  Node: "k8s.node",
  Deployment: "k8s.deployment",
  StatefulSet: "k8s.statefulset",
  DaemonSet: "k8s.daemonset",
  Job: "k8s.job",
  CronJob: "k8s.cronjob",
  Pod: "k8s.pod",
  PersistentVolumeClaim: "k8s.pvc",
  PersistentVolume: "k8s.pv",
};

/* "k8s.pod:payments/checkout-7d9f": unique within a cluster. */
export function kubernetesNodeId(
  kind: string,
  namespace: string,
  name: string,
): string {
  return namespace ? `${kind}:${namespace}/${name}` : `${kind}:${name}`;
}

/*
 * The deployment a ReplicaSet belongs to: Kubernetes names a ReplicaSet
 * `<deployment>-<pod-template-hash>`.
 */
const REPLICA_SET_HASH: RegExp = /-[a-z0-9]{5,10}$/;

export function deploymentNameFromReplicaSet(replicaSet: string): string {
  return replicaSet.replace(REPLICA_SET_HASH, "");
}

function ownersOf(row: KubernetesResource): Array<{ kind: string; name: string }> {
  return asArray(asObject(row.ownerReferences)["items"])
    .map((owner: Json): { kind: string; name: string } => {
      return { kind: readString(owner, "kind"), name: readString(owner, "name") };
    })
    .filter((owner: { kind: string; name: string }): boolean => {
      return Boolean(owner.kind && owner.name);
    });
}

interface Assessment {
  health: ResourceTopologyHealth;
  status?: ResourceTopologyText | undefined;
  reasons: Array<ResourceTopologyText>;
  facts: Array<ResourceTopologyFact>;
}

function metricFacts(
  row: KubernetesResource,
  now: Date,
): Array<ResourceTopologyFact> {
  if (!isRecent(row.metricsUpdatedAt, now, KUBERNETES_METRIC_STALE_MS)) {
    return [];
  }

  const facts: Array<ResourceTopologyFact> = [];
  const cpu: number | null = toFiniteNumber(row.latestCpuPercent);
  const memory: number | null = toFiniteNumber(row.latestMemoryBytes);

  if (cpu !== null) {
    facts.push({
      label: translationKey("CPU"),
      value: formatTopologyPercent(cpu),
    });
  }

  if (memory !== null) {
    facts.push({
      label: translationKey("Memory"),
      value: formatTopologyBytes(memory),
    });
  }

  return facts;
}

function assessNode(row: KubernetesResource, now: Date): Assessment {
  const facts: Array<ResourceTopologyFact> = metricFacts(row, now);

  if (row.isReady === false) {
    return {
      health: "critical",
      status: text(translationKey("Not ready")),
      reasons: [
        text(
          translationKey(
            "The node is not ready: new pods cannot be scheduled on it.",
          ),
        ),
      ],
      facts: facts,
    };
  }

  const pressures: Array<ResourceTopologyText> = [];

  if (row.hasMemoryPressure) {
    pressures.push(text(translationKey("Memory pressure")));
  }

  if (row.hasDiskPressure) {
    pressures.push(text(translationKey("Disk pressure")));
  }

  if (row.hasPidPressure) {
    pressures.push(text(translationKey("PID pressure")));
  }

  if (pressures.length > 0) {
    return {
      health: "warning",
      status: pressures[0],
      reasons: pressures,
      facts: facts,
    };
  }

  if (row.isReady === true) {
    return {
      health: "healthy",
      status: text(translationKey("Ready")),
      reasons: [],
      facts: facts,
    };
  }

  return {
    health: "unknown",
    status: text(translationKey("No data yet")),
    reasons: [],
    facts: facts,
  };
}

function assessPod(
  row: KubernetesResource,
  containers: Array<KubernetesContainer>,
  now: Date,
): Assessment {
  const facts: Array<ResourceTopologyFact> = metricFacts(row, now);
  const restarts: number = containers.reduce(
    (total: number, container: KubernetesContainer): number => {
      return total + (toFiniteNumber(container.restartCount) || 0);
    },
    0,
  );

  if (restarts > 0) {
    facts.push({
      label: translationKey("Restarts"),
      value: String(restarts),
    });
  }

  const failing: KubernetesContainer | undefined = containers.find(
    (container: KubernetesContainer): boolean => {
      return Boolean(
        container.reason && KUBERNETES_FAILING_WAIT_REASONS.has(container.reason),
      );
    },
  );
  const phase: string = row.phase || "";

  if (phase === "Failed") {
    return {
      health: "critical",
      status: text(translationKey("Failed")),
      reasons: failing?.reason
        ? [
            text(translationKey("Container {{container}}: {{reason}}"), {
              container: failing.name || "",
              reason: failing.reason,
            }),
          ]
        : [],
      facts: facts,
    };
  }

  if (failing?.reason && phase !== "Succeeded") {
    return {
      health: "critical",
      status: { text: failing.reason },
      reasons: [
        text(translationKey("Container {{container}}: {{reason}}"), {
          container: failing.name || "",
          reason: failing.reason,
        }),
      ],
      facts: facts,
    };
  }

  if (phase === "Succeeded") {
    return {
      health: "off",
      status: text(translationKey("Completed")),
      reasons: [],
      facts: facts,
    };
  }

  if (phase === "Pending") {
    const waiting: KubernetesContainer | undefined = containers.find(
      (container: KubernetesContainer): boolean => {
        return Boolean(container.reason);
      },
    );

    return {
      health: "warning",
      status: text(translationKey("Pending")),
      reasons: waiting?.reason
        ? [
            text(translationKey("Container {{container}}: {{reason}}"), {
              container: waiting.name || "",
              reason: waiting.reason,
            }),
          ]
        : [text(translationKey("The pod is waiting to be scheduled or started."))],
      facts: facts,
    };
  }

  if (phase === "Running") {
    const notReady: Array<KubernetesContainer> = containers.filter(
      (container: KubernetesContainer): boolean => {
        return container.isReady === false;
      },
    );

    if (notReady.length > 0) {
      return {
        health: "warning",
        status: text(translationKey("Not ready")),
        reasons: [
          text(translationKey("Containers not ready: {{containers}}"), {
            containers: notReady
              .map((container: KubernetesContainer): string => {
                return container.name || "";
              })
              .join(", "),
          }),
        ],
        facts: facts,
      };
    }

    return {
      health: "healthy",
      status: text(translationKey("Running")),
      reasons: [],
      facts: facts,
    };
  }

  if (phase === "Unknown") {
    return {
      health: "warning",
      status: text(translationKey("Unknown")),
      reasons: [
        text(
          translationKey(
            "Kubernetes cannot tell this pod's state: its node may have stopped reporting.",
          ),
        ),
      ],
      facts: facts,
    };
  }

  return {
    health: "unknown",
    status: text(translationKey("No data yet")),
    reasons: [],
    facts: facts,
  };
}

/* Ready replicas out of the ones asked for: "2/3 ready". */
function assessReplicas(desired: number | null, ready: number | null): Assessment {
  if (desired === null && ready === null) {
    return { health: "unknown", reasons: [], facts: [] };
  }

  const want: number = desired ?? ready ?? 0;
  const have: number = ready ?? 0;
  const facts: Array<ResourceTopologyFact> = [
    {
      label: translationKey("Ready"),
      value: `${have}/${want}`,
      tone: want > 0 && have === 0 ? "critical" : have < want ? "warning" : undefined,
    },
  ];

  if (want === 0) {
    return {
      health: "off",
      status: text(translationKey("Scaled to zero")),
      reasons: [],
      facts: facts,
    };
  }

  if (have === 0) {
    return {
      health: "critical",
      status: text(translationKey("No ready replicas")),
      reasons: [
        text(translationKey("None of its {{count}} replicas are ready."), {
          count: String(want),
        }),
      ],
      facts: facts,
    };
  }

  if (have < want) {
    return {
      health: "warning",
      status: text(translationKey("{{ready}} of {{desired}} ready"), {
        ready: String(have),
        desired: String(want),
      }),
      reasons: [
        text(translationKey("{{ready}} of {{desired}} replicas are ready."), {
          ready: String(have),
          desired: String(want),
        }),
      ],
      facts: facts,
    };
  }

  return {
    health: "healthy",
    status: text(translationKey("{{ready}} of {{desired}} ready"), {
      ready: String(have),
      desired: String(want),
    }),
    reasons: [],
    facts: facts,
  };
}

function assessWorkload(row: KubernetesResource): Assessment {
  const spec: Json = asObject(row.spec);
  const status: Json = asObject(row.status);

  switch (row.kind) {
    case "Deployment":
    case "StatefulSet":
      return assessReplicas(
        readNumber(spec, "replicas"),
        readNumber(status, "readyReplicas"),
      );
    case "DaemonSet":
      return assessReplicas(
        readNumber(status, "desiredNumberScheduled"),
        readNumber(status, "numberReady"),
      );
    case "Job": {
      const active: number = readNumber(status, "active") || 0;
      const succeeded: number = readNumber(status, "succeeded") || 0;
      const failed: number = readNumber(status, "failed") || 0;

      if (active > 0) {
        return {
          health: "healthy",
          status: text(translationKey("Running")),
          reasons: [],
          facts: [],
        };
      }

      if (failed > 0 && succeeded === 0) {
        return {
          health: "critical",
          status: text(translationKey("Failed")),
          reasons: [
            text(translationKey("The job failed {{count}} times."), {
              count: String(failed),
            }),
          ],
          facts: [],
        };
      }

      return {
        health: "off",
        status: text(translationKey("Completed")),
        reasons: [],
        facts: [],
      };
    }
    case "CronJob": {
      if (spec["suspend"] === true) {
        return {
          health: "off",
          status: text(translationKey("Suspended")),
          reasons: [],
          facts: [],
        };
      }

      const schedule: string = readString(spec, "schedule");

      return {
        health: "healthy",
        status: schedule ? { text: schedule } : text(translationKey("Scheduled")),
        reasons: [],
        facts: [],
      };
    }
    default:
      return { health: "unknown", reasons: [], facts: [] };
  }
}

function assessNamespace(row: KubernetesResource): Assessment {
  const phase: string = readString(asObject(row.status), "phase");

  if (phase === "Terminating") {
    return {
      health: "warning",
      status: text(translationKey("Terminating")),
      reasons: [],
      facts: [],
    };
  }

  return {
    health: "healthy",
    status: phase ? { text: phase } : undefined,
    reasons: [],
    facts: [],
  };
}

function assessVolume(row: KubernetesResource): Assessment {
  const status: Json = asObject(row.status);
  const phase: string = readString(status, "phase");
  const capacity: string = readString(asObject(status["capacity"]), "storage");
  const facts: Array<ResourceTopologyFact> = capacity
    ? [{ label: translationKey("Capacity"), value: capacity }]
    : [];

  if (phase === "Lost" || phase === "Failed") {
    return {
      health: "critical",
      status: { text: phase },
      reasons: [],
      facts: facts,
    };
  }

  if (phase === "Pending") {
    return {
      health: "warning",
      status: text(translationKey("Pending")),
      reasons: [
        text(translationKey("The claim is waiting for a volume to bind to.")),
      ],
      facts: facts,
    };
  }

  if (phase === "Released") {
    return {
      health: "off",
      status: { text: phase },
      reasons: [],
      facts: facts,
    };
  }

  return {
    health: phase ? "healthy" : "unknown",
    status: phase ? { text: phase } : undefined,
    reasons: [],
    facts: facts,
  };
}

export function buildKubernetesTopology(
  input: KubernetesTopologyInput,
): KubernetesTopology {
  const clusterId: string = input.cluster.id;
  const byKind: Map<string, Array<KubernetesResource>> = new Map<
    string,
    Array<KubernetesResource>
  >();

  for (const row of input.rows) {
    if (!row.kind || !row.name) {
      continue;
    }

    const list: Array<KubernetesResource> = byKind.get(row.kind) || [];
    list.push(row);
    byKind.set(row.kind, list);
  }

  const rowsOf: (kind: string) => Array<KubernetesResource> = (
    kind: string,
  ): Array<KubernetesResource> => {
    return byKind.get(kind) || [];
  };

  const containersByPod: Map<string, Array<KubernetesContainer>> = new Map<
    string,
    Array<KubernetesContainer>
  >();

  for (const container of input.containers || []) {
    const key: string = `${container.podNamespaceKey || ""}/${container.podName || ""}`;
    const list: Array<KubernetesContainer> = containersByPod.get(key) || [];
    list.push(container);
    containersByPod.set(key, list);
  }

  const reporting: boolean =
    isRecent(input.cluster.lastSeenAt, input.now, KUBERNETES_METRIC_STALE_MS) ||
    input.rows.some((row: KubernetesResource): boolean => {
      return isRecent(row.lastSeenAt, input.now, KUBERNETES_METRIC_STALE_MS);
    });

  const root: ResourceTopologyNodeInput = {
    id: KUBERNETES_ROOT_ID,
    parentId: null,
    kind: "k8s.cluster",
    name: input.cluster.name || "Kubernetes",
    health: reporting
      ? "healthy"
      : input.rows.length === 0 && !input.cluster.lastSeenAt
        ? "unknown"
        : "warning",
    status: reporting
      ? text(translationKey("Reporting"))
      : input.rows.length === 0 && !input.cluster.lastSeenAt
        ? text(translationKey("No data yet"))
        : text(translationKey("Not reporting")),
    reasons: reporting
      ? []
      : input.rows.length === 0 && !input.cluster.lastSeenAt
        ? []
        : [
            text(
              translationKey(
                "Nothing has arrived from this cluster's agent for more than 15 minutes.",
              ),
            ),
          ],
    link: { page: PageMap.KUBERNETES_CLUSTER_VIEW, modelId: clusterId },
  };

  const linkFor: (kind: string, name: string) => ResourceTopologyNodeInput["link"] = (
    kind: string,
    name: string,
  ): ResourceTopologyNodeInput["link"] => {
    const page: PageMap | undefined = DETAIL_PAGE_BY_KIND[kind];

    return page ? { page: page, modelId: clusterId, subModelId: name } : null;
  };

  // Every part once, with its own facts; parents are set per reading below.
  const parts: Map<string, ResourceTopologyNodeInput> = new Map<
    string,
    ResourceTopologyNodeInput
  >();
  const rowIdToNodeId: Map<string, string> = new Map<string, string>();

  const addPart: (
    row: KubernetesResource,
    kind: string,
    assessment: Assessment,
    keywords?: Array<string> | undefined,
  ) => string = (
    row: KubernetesResource,
    kind: string,
    assessment: Assessment,
    keywords?: Array<string> | undefined,
  ): string => {
    const namespace: string = row.namespaceKey || "";
    const id: string = kubernetesNodeId(kind, namespace, row.name!);

    if (!parts.has(id)) {
      parts.set(id, {
        id: id,
        parentId: KUBERNETES_ROOT_ID,
        kind: kind,
        name: row.name!,
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        facts: assessment.facts,
        context: namespace || undefined,
        keywords: keywords,
        link: linkFor(kind, row.name!),
      });
    }

    if (row.id) {
      rowIdToNodeId.set(row.id.toString(), id);
    }

    return id;
  };

  for (const row of rowsOf("Namespace")) {
    addPart(row, "k8s.namespace", assessNamespace(row));
  }

  for (const row of rowsOf("Node")) {
    addPart(row, "k8s.node", assessNode(row, input.now));
  }

  for (const kind of ["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"]) {
    for (const row of rowsOf(kind)) {
      addPart(row, KIND_BY_ROW_KIND[kind]!, assessWorkload(row));
    }
  }

  for (const row of rowsOf("PersistentVolumeClaim")) {
    addPart(row, "k8s.pvc", assessVolume(row));
  }

  for (const row of rowsOf("PersistentVolume")) {
    addPart(row, "k8s.pv", assessVolume(row));
  }

  // A namespace a part names but whose own row has not arrived.
  const ensureNamespace: (namespace: string) => string = (
    namespace: string,
  ): string => {
    if (!namespace) {
      return KUBERNETES_ROOT_ID;
    }

    const id: string = kubernetesNodeId("k8s.namespace", "", namespace);

    if (!parts.has(id)) {
      parts.set(id, {
        id: id,
        parentId: KUBERNETES_ROOT_ID,
        kind: "k8s.namespace",
        name: namespace,
        health: "healthy",
        link: linkFor("k8s.namespace", namespace),
      });
    }

    return id;
  };

  const workloadParent: Map<string, string> = new Map<string, string>();

  // Workloads sit in their namespace; a job a CronJob made sits in that CronJob.
  for (const kind of ["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"]) {
    for (const row of rowsOf(kind)) {
      const id: string = kubernetesNodeId(
        KIND_BY_ROW_KIND[kind]!,
        row.namespaceKey || "",
        row.name!,
      );
      let parent: string = ensureNamespace(row.namespaceKey || "");

      if (kind === "Job") {
        const cronJob: { kind: string; name: string } | undefined = ownersOf(
          row,
        ).find((owner: { kind: string; name: string }): boolean => {
          return owner.kind === "CronJob";
        });
        const cronJobId: string | null = cronJob
          ? kubernetesNodeId("k8s.cronjob", row.namespaceKey || "", cronJob.name)
          : null;

        if (cronJobId && parts.has(cronJobId)) {
          parent = cronJobId;
        }
      }

      workloadParent.set(id, parent);
    }
  }

  for (const row of rowsOf("PersistentVolumeClaim")) {
    workloadParent.set(
      kubernetesNodeId("k8s.pvc", row.namespaceKey || "", row.name!),
      ensureNamespace(row.namespaceKey || ""),
    );
  }

  // Pods: their workload, their node, the claims they mount.
  const relations: Array<ResourceTopologyRelation> = [];
  const podWorkload: Map<string, string> = new Map<string, string>();
  const podNode: Map<string, string | null> = new Map<string, string | null>();

  for (const row of rowsOf("Pod")) {
    const namespace: string = row.namespaceKey || "";
    const containers: Array<KubernetesContainer> =
      containersByPod.get(`${namespace}/${row.name}`) || [];
    const spec: Json = asObject(row.spec);
    const nodeName: string = readString(spec, "nodeName");
    const id: string = addPart(
      row,
      "k8s.pod",
      assessPod(row, containers, input.now),
      [nodeName],
    );

    // Its workload, most specific first.
    let workload: string | null = null;
    const findWorkload: (kind: string, name: string) => string | null = (
      kind: string,
      name: string,
    ): string | null => {
      const candidate: string = kubernetesNodeId(kind, namespace, name);

      return parts.has(candidate) ? candidate : null;
    };

    if (row.controllerDeploymentName) {
      workload = findWorkload("k8s.deployment", row.controllerDeploymentName);
    }

    for (const owner of ownersOf(row)) {
      if (workload) {
        break;
      }

      const kind: string | undefined = WORKLOAD_KIND_BY_OWNER[owner.kind];

      if (kind) {
        workload = findWorkload(kind, owner.name);
      } else if (owner.kind === "ReplicaSet") {
        workload = findWorkload(
          "k8s.deployment",
          deploymentNameFromReplicaSet(owner.name),
        );
      }
    }

    if (!workload && row.controllerCronJobName) {
      workload = findWorkload("k8s.cronjob", row.controllerCronJobName);
    }

    podWorkload.set(id, workload || ensureNamespace(namespace));

    const nodeId: string | null = nodeName
      ? kubernetesNodeId("k8s.node", "", nodeName)
      : null;
    podNode.set(id, nodeId && parts.has(nodeId) ? nodeId : null);

    if (nodeId && parts.has(nodeId)) {
      relations.push({
        from: id,
        to: nodeId,
        label: translationKey("Runs on"),
        inverseLabel: translationKey("Runs here"),
      });
    }

    for (const volume of asArray(spec["volumes"])) {
      if (readString(volume, "type") !== "persistentVolumeClaim") {
        continue;
      }

      const claimId: string = kubernetesNodeId(
        "k8s.pvc",
        namespace,
        readString(volume, "source"),
      );

      if (parts.has(claimId)) {
        relations.push({
          from: id,
          to: claimId,
          label: translationKey("Uses"),
          inverseLabel: translationKey("Used by"),
        });
      }
    }
  }

  // Claims and the volumes they are bound to.
  for (const row of rowsOf("PersistentVolumeClaim")) {
    const volumeName: string = readString(asObject(row.spec), "volumeName");
    const volumeId: string = kubernetesNodeId("k8s.pv", "", volumeName);

    if (volumeName && parts.has(volumeId)) {
      relations.push({
        from: kubernetesNodeId("k8s.pvc", row.namespaceKey || "", row.name!),
        to: volumeId,
        label: translationKey("Bound to"),
        inverseLabel: translationKey("Bound to"),
      });
    }
  }

  /*
   * An open incident or alert is about the part its links or labels name
   * most precisely: the inventory row it is linked to, then a pod, a
   * workload, a node, a claim, a namespace — or else the cluster.
   */
  const containerRowPod: Map<string, string> = new Map<string, string>();

  for (const container of input.containers || []) {
    if (container.id) {
      containerRowPod.set(
        container.id.toString(),
        kubernetesNodeId(
          "k8s.pod",
          container.podNamespaceKey || "",
          container.podName || "",
        ),
      );
    }
  }

  const locate: (record: OpenIssueRecord) => string | null = (
    record: OpenIssueRecord,
  ): string | null => {
    for (const rowId of record.relatedIds["kubernetesResources"] || []) {
      const nodeId: string | undefined = rowIdToNodeId.get(rowId);

      if (nodeId) {
        return nodeId;
      }
    }

    for (const rowId of record.relatedIds["kubernetesContainers"] || []) {
      const podId: string | undefined = containerRowPod.get(rowId);

      if (podId && parts.has(podId)) {
        return podId;
      }
    }

    const labels: OpenIssueRecord["seriesLabels"] = record.seriesLabels;
    const namespace: string = readSeriesLabel(labels, "k8s.namespace.name") || "";
    const candidates: Array<[string, string]> = [
      ["k8s.pod.name", "k8s.pod"],
      ["k8s.deployment.name", "k8s.deployment"],
      ["k8s.statefulset.name", "k8s.statefulset"],
      ["k8s.daemonset.name", "k8s.daemonset"],
      ["k8s.job.name", "k8s.job"],
      ["k8s.cronjob.name", "k8s.cronjob"],
      ["k8s.persistentvolumeclaim.name", "k8s.pvc"],
    ];

    for (const [label, kind] of candidates) {
      const name: string | null = readSeriesLabel(labels, label);

      if (!name) {
        continue;
      }

      const id: string = kubernetesNodeId(kind, namespace, name);

      if (parts.has(id)) {
        return id;
      }
    }

    const node: string | null = readSeriesLabel(labels, "k8s.node.name");

    if (node && parts.has(kubernetesNodeId("k8s.node", "", node))) {
      return kubernetesNodeId("k8s.node", "", node);
    }

    if (namespace && parts.has(kubernetesNodeId("k8s.namespace", "", namespace))) {
      return kubernetesNodeId("k8s.namespace", "", namespace);
    }

    return null;
  };

  const issues: Map<string, Array<ResourceTopologyIssue>> = attachOpenIssues({
    records: input.issues || [],
    rootId: KUBERNETES_ROOT_ID,
    locate: locate,
  });

  // Workloads: namespaces, their workloads, their pods.
  const workloadNodes: Array<ResourceTopologyNodeInput> = [root];

  for (const part of parts.values()) {
    if (part.kind === "k8s.node") {
      continue;
    }

    let parentId: string = KUBERNETES_ROOT_ID;

    if (part.kind === "k8s.pod") {
      parentId = podWorkload.get(part.id) || KUBERNETES_ROOT_ID;
    } else if (workloadParent.has(part.id)) {
      parentId = workloadParent.get(part.id)!;
    }

    workloadNodes.push({ ...part, parentId: parentId });
  }

  // Nodes: each node and the pods scheduled on it.
  const nodeNodes: Array<ResourceTopologyNodeInput> = [root];
  let unscheduled: number = 0;

  for (const part of parts.values()) {
    if (part.kind === "k8s.node") {
      nodeNodes.push({ ...part, parentId: KUBERNETES_ROOT_ID });
    } else if (part.kind === "k8s.pod") {
      const nodeId: string | null = podNode.get(part.id) || null;

      if (!nodeId) {
        unscheduled++;
      }

      nodeNodes.push({
        ...part,
        parentId: nodeId || KUBERNETES_UNSCHEDULED_ID,
      });
    }
  }

  if (unscheduled > 0) {
    nodeNodes.push({
      id: KUBERNETES_UNSCHEDULED_ID,
      parentId: KUBERNETES_ROOT_ID,
      kind: "section",
      isSection: true,
      name: translationKey("Not on a node"),
      health: "healthy",
    });
  }

  /*
   * A reading that does not draw the part an issue is about (the Nodes
   * reading has no deployments) shows the issue on the cluster, so both
   * readings count the same open incidents and alerts.
   */
  const issuesWithin: (
    nodes: Array<ResourceTopologyNodeInput>,
  ) => Map<string, Array<ResourceTopologyIssue>> = (
    nodes: Array<ResourceTopologyNodeInput>,
  ): Map<string, Array<ResourceTopologyIssue>> => {
    const drawn: Set<string> = new Set<string>(
      nodes.map((node: ResourceTopologyNodeInput): string => {
        return node.id;
      }),
    );
    const result: Map<string, Array<ResourceTopologyIssue>> = new Map<
      string,
      Array<ResourceTopologyIssue>
    >();

    for (const [nodeId, list] of issues) {
      const target: string = drawn.has(nodeId) ? nodeId : KUBERNETES_ROOT_ID;
      result.set(target, [...(result.get(target) || []), ...list]);
    }

    return result;
  };

  return {
    workloads: buildResourceTopologyGraph({
      rootId: KUBERNETES_ROOT_ID,
      nodes: workloadNodes,
      relations: relations,
      issues: issuesWithin(workloadNodes),
      truncations: input.truncations,
    }),
    nodes: buildResourceTopologyGraph({
      rootId: KUBERNETES_ROOT_ID,
      nodes: nodeNodes,
      relations: relations,
      issues: issuesWithin(nodeNodes),
      truncations: input.truncations,
    }),
  };
}
