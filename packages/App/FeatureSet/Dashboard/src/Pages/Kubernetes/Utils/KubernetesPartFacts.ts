import { JSONObject } from "Common/Types/JSON";
import {
  KubernetesAttentionFinding,
  KubernetesHealthAssessment,
  KubernetesHealthRow,
  KubernetesHealthSeverity,
  KubernetesHealthText,
  assessKubernetesCronJobWithRuns,
  assessKubernetesResource,
  getKubernetesAttentionFindings,
  getKubernetesJobCronJob,
  getKubernetesPodWorkload,
  getNewestKubernetesJobs,
  kubernetesObjectKey,
} from "Common/Types/Kubernetes/KubernetesHealth";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../Components/ResourcePart/ResourceAttention";
import {
  OpenIssueRecord,
  readSeriesLabel,
  sameName,
} from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import {
  ResourcePartStatus,
  ResourcePartTone,
} from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  KubernetesPartRouteFor,
  toKubernetesAttentionItem,
} from "./KubernetesAttention";

/*
 * WHAT A KUBERNETES OBJECT'S OWN PAGE SAYS ABOUT IT, ABOVE ITS TABS.
 *
 * A pod's, a workload's or a node's page reads the object with what it runs
 * (POST /kubernetes-resource/part/:clusterId: a workload's pods, a node's
 * pods, a CronJob's Jobs) and works out, with the same rules the cluster's
 * Overview uses (Common/Types/Kubernetes/KubernetesHealth):
 *
 *   - its status, for the hero's pill: "CrashLoopBackOff", "1 of 3
 *     available", "Ready", in its tone;
 *   - what needs attention on it: its own row ("This Deployment"), then each
 *     of its pods that needs a look, each a step from that pod's page - on
 *     the Overview the pods fold into the workload, here they stand alone;
 *   - which open incidents and alerts are about it;
 *   - the facts of a pod the Pods tab lists: its state, how many of its
 *     containers are ready, its restarts, its node.
 *
 * React-free (pages hand in routeFor), so App tests can read it.
 */

/*
 * An inventory row as the part read sends it: the rules' columns with its
 * id and latest metrics. Dates arrive as text.
 */
export interface KubernetesPartRow extends KubernetesHealthRow {
  _id?: string | undefined;
  latestCpuPercent?: number | string | null | undefined;
  latestMemoryBytes?: number | string | null | undefined;
  latestMemoryPercent?: number | string | null | undefined;
  metricsUpdatedAt?: Date | string | null | undefined;
}

export interface KubernetesPartRead {
  part: KubernetesPartRow | null;
  pods: Array<KubernetesPartRow>;
  jobs: Array<KubernetesPartRow>;
  isPodsTruncated: boolean;
}

// What the hero's pill means, behind it and for a screen reader.
const STATUS_DESCRIPTION: string = translationKey(
  "What needs attention on it, from the latest inventory the Kubernetes agent sent.",
);

const TONES: Record<KubernetesHealthAssessment["tone"], ResourcePartTone> = {
  positive: "positive",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
};

function rowsOf(value: unknown): Array<KubernetesPartRow> {
  return Array.isArray(value)
    ? (value.filter((item: unknown): boolean => {
        return Boolean(item) && typeof item === "object";
      }) as Array<KubernetesPartRow>)
    : [];
}

/*
 * The part read's answer. Defensive: an answer from an older or newer
 * server never breaks the page - what cannot be read is left out.
 */
export function parseKubernetesPartRead(
  body: JSONObject | null | undefined,
): KubernetesPartRead {
  const part: unknown = body?.["part"];
  return {
    part:
      part && typeof part === "object" && !Array.isArray(part)
        ? (part as KubernetesPartRow)
        : null,
    pods: rowsOf(body?.["pods"]),
    jobs: rowsOf(body?.["jobs"]),
    isPodsTruncated: body?.["isPodsTruncated"] === true,
  };
}

export function toResourcePartStatus(
  assessment: KubernetesHealthAssessment,
): ResourcePartStatus {
  const status: ResourcePartStatus = {
    label: assessment.status.text,
    tone: TONES[assessment.tone],
    description: STATUS_DESCRIPTION,
  };
  if (assessment.status.values) {
    status.values = assessment.status.values;
  }
  return status;
}

/*
 * The part's own verdict: its kind's rules, and for a CronJob its newest
 * run's too ("Last run failed").
 */
export function assessKubernetesPart(
  read: Pick<KubernetesPartRead, "part" | "jobs">,
): KubernetesHealthAssessment | null {
  if (!read.part) {
    return null;
  }
  if (read.part.kind === "CronJob") {
    return assessKubernetesCronJobWithRuns(read.part, read.jobs);
  }
  return assessKubernetesResource(read.part);
}

function findingOf(
  row: KubernetesHealthRow,
  assessment: KubernetesHealthAssessment,
): KubernetesAttentionFinding | null {
  if (!assessment.severity) {
    return null;
  }
  const finding: KubernetesAttentionFinding = {
    key: kubernetesObjectKey(
      row.kind || "",
      row.namespaceKey || "",
      row.name || "",
    ),
    kind: row.kind || "",
    namespace: row.namespaceKey || "",
    name: row.name || "",
    severity: assessment.severity,
    reasons: assessment.reasons,
  };
  if (assessment.message) {
    finding.message = assessment.message;
  }
  return finding;
}

/*
 * What needs attention on the part's page: the part itself first (the card
 * names it "This Deployment"), then a CronJob's newest run, then each pod
 * that needs a look, the worst first - every one a step from its own page.
 */
export function getKubernetesPartAttentionItems(data: {
  read: KubernetesPartRead;
  routeFor: KubernetesPartRouteFor;
}): Array<ResourceAttentionItem> {
  const part: KubernetesPartRow | null = data.read.part;
  if (!part) {
    return [];
  }

  const own: KubernetesHealthAssessment | null = assessKubernetesPart(
    data.read,
  );
  const ownFinding: KubernetesAttentionFinding | null = own
    ? findingOf(part, own)
    : null;

  // A CronJob's newest run: an older one a newer run followed is history.
  const newestJob: KubernetesHealthRow | undefined =
    part.kind === "CronJob"
      ? getNewestKubernetesJobs(data.read.jobs).get(
          kubernetesObjectKey(
            "CronJob",
            part.namespaceKey || "",
            part.name || "",
          ),
        )
      : undefined;
  const runs: Array<KubernetesHealthRow> = newestJob ? [newestJob] : [];
  const runNames: Set<string> = new Set<string>(
    runs.map((job: KubernetesHealthRow): string => {
      return job.name || "";
    }),
  );

  // On a CronJob's page, only the newest run's pods.
  const pods: Array<KubernetesPartRow> =
    part.kind === "CronJob"
      ? data.read.pods.filter((pod: KubernetesPartRow): boolean => {
          const workload: { kind: string; name: string } | null =
            getKubernetesPodWorkload(pod);
          return Boolean(
            workload && workload.kind === "Job" && runNames.has(workload.name),
          );
        })
      : data.read.pods;

  const others: Array<KubernetesAttentionFinding> =
    getKubernetesAttentionFindings([...runs, ...pods], {
      foldPods: false,
    }).filter((finding: KubernetesAttentionFinding): boolean => {
      return !ownFinding || finding.key !== ownFinding.key;
    });

  /*
   * The most urgent first, as the card says - its own row first among
   * equals, as on a Proxmox node's page: a Deployment one replica short
   * (to look at) lists the pod crash-looping in it (critical) above
   * itself. The sort is stable, so the others keep the rules' order.
   */
  const rank: (finding: KubernetesAttentionFinding) => number = (
    finding: KubernetesAttentionFinding,
  ): number => {
    return finding.severity === KubernetesHealthSeverity.Critical ? 0 : 1;
  };
  const findings: Array<KubernetesAttentionFinding> = [
    ...(ownFinding ? [ownFinding] : []),
    ...others,
  ].sort((a: KubernetesAttentionFinding, b: KubernetesAttentionFinding) => {
    return rank(a) - rank(b);
  });

  return findings.map(
    (finding: KubernetesAttentionFinding): ResourceAttentionItem => {
      return toKubernetesAttentionItem(finding, data.routeFor);
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * Which open incidents and alerts are about the part
 * ---------------------------------------------------------------------------
 *
 * A Kubernetes monitor links what it opens to the cluster; the record's
 * series labels say which part crossed the line (a CrashLoopBackOff alert
 * groups by namespace, pod and container; Deployment Replica Mismatch by the
 * Deployment), and ingest links a record to the inventory rows it names. A
 * record is about the part when it names the part, or one of its pods, in
 * its namespace - so the same name in another namespace never counts.
 */

const NAME_LABELS: Record<string, string> = {
  Pod: "k8s.pod.name",
  Node: "k8s.node.name",
  Deployment: "k8s.deployment.name",
  StatefulSet: "k8s.statefulset.name",
  DaemonSet: "k8s.daemonset.name",
  Job: "k8s.job.name",
  CronJob: "k8s.cronjob.name",
  PersistentVolumeClaim: "k8s.persistentvolumeclaim.name",
  HorizontalPodAutoscaler: "k8s.hpa.name",
  // Its pods carry the label the chart's collectors extract, not a name.
  DeploymentConfig: "k8s.pod.label.deploymentconfig",
};

function namesThe(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  row: KubernetesHealthRow,
): boolean {
  const label: string | undefined = NAME_LABELS[row.kind || ""];
  if (!label) {
    return false;
  }
  const name: string | null = readSeriesLabel(record.seriesLabels, label);
  if (!name || !sameName(name, row.name)) {
    return false;
  }
  if (!row.namespaceKey) {
    return true;
  }
  const namespace: string | null = readSeriesLabel(
    record.seriesLabels,
    "k8s.namespace.name",
  );
  // A record with no namespace label is the name's alone to claim.
  return !namespace || sameName(namespace, row.namespaceKey);
}

export function isKubernetesIssueAbout(
  record: Pick<OpenIssueRecord, "seriesLabels" | "relatedIds">,
  read: Pick<KubernetesPartRead, "part" | "pods" | "jobs">,
): boolean {
  const part: KubernetesPartRow | null = read.part;
  if (!part) {
    return false;
  }

  const ids: Set<string> = new Set<string>(
    [part, ...read.pods, ...read.jobs]
      .map((row: KubernetesPartRow): string => {
        return row._id || "";
      })
      .filter(Boolean),
  );
  for (const id of record.relatedIds?.["kubernetesResources"] || []) {
    if (ids.has(id)) {
      return true;
    }
  }

  if (namesThe(record, part)) {
    return true;
  }

  // A workload's or node's page: an alert about one of its pods or runs.
  for (const row of [...read.pods, ...read.jobs]) {
    if (namesThe(record, row)) {
      return true;
    }
  }

  // A pod's page: an alert about its workload names the workload, not it.
  return false;
}

/*
 * ---------------------------------------------------------------------------
 * A pod's facts, for the Pods tab
 * ---------------------------------------------------------------------------
 */

export interface KubernetesPodFacts {
  name: string;
  namespace: string;
  assessment: KubernetesHealthAssessment;
  // "1/2": containers ready of the pod's containers; "" when unknown.
  ready: string;
  restarts: number;
  nodeName: string;
  // The Job a CronJob's pod ran for, or the workload it belongs to.
  ownerName: string;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

export function getKubernetesPodFacts(
  row: KubernetesPartRow,
): KubernetesPodFacts {
  const status: Json = asObject(row.status);
  const spec: Json = asObject(row.spec);
  const containers: Array<Json> = Array.isArray(status["containerStatuses"])
    ? (status["containerStatuses"] as Array<Json>).filter(
        (item: unknown): boolean => {
          return Boolean(item) && typeof item === "object";
        },
      )
    : [];

  const readyCount: number = containers.filter((container: Json): boolean => {
    return container["ready"] === true || container["ready"] === "true";
  }).length;

  const restarts: number = containers.reduce(
    (total: number, container: Json): number => {
      const value: number = Number(container["restartCount"]);
      return total + (Number.isFinite(value) ? value : 0);
    },
    0,
  );

  const nodeName: unknown = spec["nodeName"];
  const workload: { kind: string; name: string } | null =
    getKubernetesPodWorkload(row);

  return {
    name: row.name || "",
    namespace: row.namespaceKey || "",
    assessment: assessKubernetesResource(row),
    ready: containers.length > 0 ? `${readyCount}/${containers.length}` : "",
    restarts: restarts,
    nodeName: typeof nodeName === "string" ? nodeName : "",
    ownerName: workload?.name || "",
  };
}

// Pods that need attention first, the worst first, then by name.
export function sortKubernetesPodFacts(
  pods: Array<KubernetesPodFacts>,
): Array<KubernetesPodFacts> {
  const rank: (facts: KubernetesPodFacts) => number = (
    facts: KubernetesPodFacts,
  ): number => {
    if (facts.assessment.severity === KubernetesHealthSeverity.Critical) {
      return 0;
    }
    if (facts.assessment.severity === KubernetesHealthSeverity.Warning) {
      return 1;
    }
    return 2;
  };
  return [...pods].sort(
    (a: KubernetesPodFacts, b: KubernetesPodFacts): number => {
      const severity: number = rank(a) - rank(b);
      if (severity !== 0) {
        return severity;
      }
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    },
  );
}

// The CronJob a Job row belongs to, for its Pods tab's "Job" column.
export function getKubernetesJobOwnerName(row: KubernetesHealthRow): string {
  return getKubernetesJobCronJob(row)?.name || "";
}

/*
 * The severity of the part as the Needs attention card's tone reads it,
 * for the hero's status - kept beside the items so a test can pair them.
 */
export function toResourceAttentionSeverity(
  severity: KubernetesHealthSeverity | null,
): ResourceAttentionSeverity | null {
  if (severity === KubernetesHealthSeverity.Critical) {
    return ResourceAttentionSeverity.Critical;
  }
  if (severity === KubernetesHealthSeverity.Warning) {
    return ResourceAttentionSeverity.Warning;
  }
  return null;
}

// Whether a status text is a Kubernetes word drawn as written.
export function isKubernetesWordAsWritten(text: KubernetesHealthText): boolean {
  return text.text === "{{reason}}";
}

/*
 * ---------------------------------------------------------------------------
 * The words of a part's page, kind by kind
 * ---------------------------------------------------------------------------
 *
 * Whole sentences per kind, so each language words its own ("dieses
 * Deployment", "dieser Knoten") rather than slotting a kind into one.
 */

export interface KubernetesPartCopy {
  attentionDescription: string;
  openTitle: string;
  openDescription: string;
  alertsTitle: string;
  alertsDescription: string;
}

export const KUBERNETES_PART_COPY: Record<string, KubernetesPartCopy> = {
  Pod: {
    attentionDescription: translationKey(
      "What about this pod is broken or needs a look.",
    ),
    openTitle: translationKey("Open on this pod"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this pod, incidents first.",
    ),
    alertsTitle: translationKey("Pod alerts"),
    alertsDescription: translationKey(
      "The cluster's alerts that watch every pod, this one included: each is one monitor that fires for any pod that crosses it.",
    ),
  },
  Deployment: {
    attentionDescription: translationKey(
      "What about this Deployment and its pods is broken or needs a look, the most urgent first.",
    ),
    openTitle: translationKey("Open on this Deployment"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this Deployment and its pods, incidents first.",
    ),
    alertsTitle: translationKey("Deployment alerts"),
    alertsDescription: translationKey(
      "The cluster's alerts that watch every Deployment and its pods, this one included: each is one monitor that fires for any that crosses it.",
    ),
  },
  StatefulSet: {
    attentionDescription: translationKey(
      "What about this StatefulSet and its pods is broken or needs a look, the most urgent first.",
    ),
    openTitle: translationKey("Open on this StatefulSet"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this StatefulSet and its pods, incidents first.",
    ),
    alertsTitle: translationKey("StatefulSet alerts"),
    alertsDescription: translationKey(
      "The cluster's alerts that watch every StatefulSet and its pods, this one included: each is one monitor that fires for any that crosses it.",
    ),
  },
  DaemonSet: {
    attentionDescription: translationKey(
      "What about this DaemonSet and its pods is broken or needs a look, the most urgent first.",
    ),
    openTitle: translationKey("Open on this DaemonSet"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this DaemonSet and its pods, incidents first.",
    ),
    alertsTitle: translationKey("DaemonSet alerts"),
    alertsDescription: translationKey(
      "The cluster's alerts that watch every DaemonSet and its pods, this one included: each is one monitor that fires for any that crosses it.",
    ),
  },
  Job: {
    attentionDescription: translationKey(
      "What about this Job and its pods is broken or needs a look, the most urgent first.",
    ),
    openTitle: translationKey("Open on this Job"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this Job and its pods, incidents first.",
    ),
    alertsTitle: translationKey("Job alerts"),
    alertsDescription: translationKey(
      "The cluster's alerts that watch every Job and its pods, this one included: each is one monitor that fires for any that crosses it.",
    ),
  },
  CronJob: {
    attentionDescription: translationKey(
      "What about this CronJob, its newest run and that run's pods is broken or needs a look.",
    ),
    openTitle: translationKey("Open on this CronJob"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this CronJob's runs and their pods, incidents first.",
    ),
    alertsTitle: translationKey("CronJob alerts"),
    alertsDescription: translationKey(
      "The cluster's alerts that watch every Job and its pods, this CronJob's runs included: each is one monitor that fires for any that crosses it.",
    ),
  },
  Node: {
    attentionDescription: translationKey(
      "What about this node and the pods on it is broken or needs a look, the most urgent first.",
    ),
    openTitle: translationKey("Open on this node"),
    openDescription: translationKey(
      "Unresolved incidents and alerts about this node and the pods on it, incidents first.",
    ),
    alertsTitle: translationKey("Node alerts"),
    alertsDescription: translationKey(
      "The cluster's alerts that watch every node, this one included: each is one monitor that fires for any node that crosses it.",
    ),
  },
};

/*
 * The cluster's recommended alerts that watch parts of each kind, in the
 * order the part's alerts card lists them (KubernetesAlertTemplates ids).
 * Each is one monitor on the cluster that fires per part.
 */
export const KUBERNETES_PART_ALERT_TEMPLATE_IDS: Record<
  string,
  Array<string>
> = {
  Pod: [
    "k8s-crashloopbackoff",
    "k8s-pod-pending",
    "k8s-pod-memory-limit-saturation",
    "k8s-pod-cpu-limit-saturation",
  ],
  Deployment: [
    "k8s-deployment-replica-mismatch",
    "k8s-crashloopbackoff",
    "k8s-pod-memory-limit-saturation",
    "k8s-pod-cpu-limit-saturation",
    "k8s-hpa-at-max-replicas",
  ],
  StatefulSet: [
    "k8s-statefulset-replica-mismatch",
    "k8s-crashloopbackoff",
    "k8s-pod-memory-limit-saturation",
    "k8s-pod-cpu-limit-saturation",
  ],
  DaemonSet: [
    "k8s-daemonset-pods-not-ready",
    "k8s-daemonset-unavailable",
    "k8s-crashloopbackoff",
  ],
  Job: ["k8s-job-failures", "k8s-crashloopbackoff"],
  CronJob: ["k8s-job-failures", "k8s-crashloopbackoff"],
  Node: [
    "k8s-node-not-ready",
    "k8s-node-pressure",
    "k8s-high-cpu",
    "k8s-high-memory",
    "k8s-high-disk-usage",
    "k8s-node-cpu-request-utilization",
    "k8s-node-memory-request-utilization",
  ],
};
