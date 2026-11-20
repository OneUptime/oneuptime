import DataSecurityComplianceSetting from "../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import {
  KUBERNETES_CLOUD_PLATFORM_PROVIDERS,
  OPENSHIFT_KUBERNETES_PROVIDER,
} from "../../../Types/Kubernetes/KubernetesClusterProvider";
import {
  KubernetesObjectRef,
  getKubernetesJobCronJob,
  getKubernetesOwners,
  getKubernetesPodWorkload,
} from "../../../Types/Kubernetes/KubernetesHealth";
import {
  KubernetesNodeBenchmarkBlock,
  toNodeBenchmarkBlock,
} from "../../../Types/Kubernetes/KubernetesNodeBenchmark";
import { toPodSecurity } from "../../../Types/Kubernetes/KubernetesPodSecurity";
import {
  OneUptimeAgentComponent,
  getOneUptimeAgentComponent,
} from "../../../Types/Kubernetes/Compliance/KubernetesAgentWorkloads";
import {
  getNodeBenchmarkScope,
  summarizeNodeBenchmark,
} from "../../../Types/Kubernetes/Compliance/KubernetesNodeBenchmarkScoring";
import {
  readRoleBindingSpec,
  readRoleSpec,
  readServiceAccountSpec,
  toNetworkPolicySpec,
} from "../../../Types/Kubernetes/KubernetesPolicyObjects";
import { findPolicyEngine } from "../../../Types/Kubernetes/Compliance/CisKubernetesBenchmark";
import {
  KubernetesComplianceAcceptanceEntry,
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceNamespace,
  KubernetesComplianceResponse,
  KubernetesComplianceTurnedOff,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import {
  KubernetesComplianceObject,
  getComplianceObjectKey,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import {
  KubernetesComplianceFramework,
  isClusterScopedComplianceObjectKind,
  isKubernetesAcceptanceInForce,
  isKubernetesComplianceFramework,
  isKubernetesComplianceObjectKind,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceAcceptance,
  KubernetesComplianceFrameworkResult,
  KubernetesComplianceSetting,
  scoreKubernetesFrameworks,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KubernetesComplianceNodeBenchmarkRun,
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
  KubernetesComplianceTemplate,
  getTemplatesToScore,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
import {
  KubernetesComplianceBinding,
  KubernetesComplianceRole,
} from "../../../Types/Kubernetes/Compliance/KubernetesRbac";
import {
  KubernetesVersion,
  formatKubernetesVersion,
  getNewestKubernetesVersion,
  getPodSecurityStandardVersion,
} from "../../../Types/Kubernetes/Compliance/KubernetesVersion";
import DataSecurityComplianceSettingService from "../../Services/DataSecurityComplianceSettingService";
import KubernetesResourceService from "../../Services/KubernetesResourceService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A KUBERNETES CLUSTER'S OWN COMPLIANCE (#9627), read from its inventory.
 *
 * The cluster's pods - each with what it says about its security, kept at
 * ingest (KubernetesPodSecurity) - its namespaces and their Pod Security
 * Admission labels, its nodes' Kubernetes version and, when the agent sends
 * them, its RBAC, service accounts and network policies, scored against the
 * Pod Security Standards and the CIS Kubernetes Benchmark
 * (Types/Kubernetes/Compliance) with what the cluster's Compliance page
 * turned off, and who turned it off and why.
 *
 * A workload that runs no pod now - a Deployment scaled to zero, a CronJob
 * between runs, a DaemonSet on no node - is scored from its pod template,
 * kept on the workload at ingest the same way (#9880).
 *
 * Each read is bounded and reads only the columns the scoring needs: a
 * pod's or a workload's security block, not its whole spec. The caller has
 * already read the cluster as the person asking; these reads are
 * OneUptime's own, in that cluster of that project.
 */

// The most pods one answer scores; a cluster with more says so.
export const MAX_COMPLIANCE_PODS: number = 25000;

// The most of each kind of policy object, and of settings, one answer reads.
const MAX_POLICY_OBJECTS: number = 20000;
const MAX_SETTINGS: number = 10000;

// The most workloads one answer reads, their Jobs included (#9880).
export const MAX_COMPLIANCE_WORKLOADS: number = 25000;

/*
 * The kinds that hold a pod template (#9880): the workloads a pod names, a
 * ReplicaSet nothing owns, and the Jobs a CronJob runs, which fold into it.
 */
export const KUBERNETES_TEMPLATE_KINDS: ReadonlyArray<string> = [
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Job",
  "CronJob",
  "DeploymentConfig",
];

const POLICY_KINDS: Array<string> = [
  "Role",
  "ClusterRole",
  "RoleBinding",
  "ClusterRoleBinding",
  "ServiceAccount",
  "NetworkPolicy",
];

const POD_SECURITY_LABEL_PREFIX: string = "pod-security.kubernetes.io/";

export interface KubernetesCompliancePodRow {
  namespaceKey: string | null;
  name: string | null;
  labels: JSONObject | null;
  ownerReferences: JSONObject | null;
  security: unknown;
  serviceAccountName: string | null;
  images: unknown;
}

export interface KubernetesComplianceObjectRow {
  kind: string;
  namespaceKey: string | null;
  name: string | null;
  labels: JSONObject | null;
  ownerReferences?: JSONObject | null | undefined;
  spec?: JSONObject | null | undefined;
  // A workload's pod template block (#9880), as stored on its spec.
  security?: unknown;
}

function readLabels(labels: unknown): Record<string, string> {
  const result: Record<string, string> = {};

  if (labels && typeof labels === "object" && !Array.isArray(labels)) {
    for (const [key, value] of Object.entries(labels as JSONObject)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
  }

  return result;
}

/*
 * Each Job's CronJob, so a CronJob's runs fold into the CronJob a person
 * opens: keyed "<namespace>/<job>".
 */
export function getCronJobsByJob(
  jobs: ReadonlyArray<KubernetesComplianceObjectRow>,
): Map<string, KubernetesObjectRef> {
  const byJob: Map<string, KubernetesObjectRef> = new Map();

  for (const job of jobs) {
    const cronJob: KubernetesObjectRef | null = getKubernetesJobCronJob({
      namespaceKey: job.namespaceKey,
      ownerReferences: job.ownerReferences || null,
    });

    if (cronJob && job.name) {
      byJob.set(`${job.namespaceKey || ""}/${job.name}`, cronJob);
    }
  }

  return byJob;
}

/*
 * The ReplicaSets nothing owns (#9880), keyed "<namespace>/<name>": their
 * pods are theirs, not a Deployment's. A Deployment's ReplicaSets are its
 * revisions, and their pods its own.
 */
export function getUnownedReplicaSets(
  rows: ReadonlyArray<KubernetesComplianceObjectRow>,
): Set<string> {
  const unowned: Set<string> = new Set<string>();

  for (const row of rows) {
    if (
      row.kind === "ReplicaSet" &&
      row.name &&
      getKubernetesOwners({ ownerReferences: row.ownerReferences || null })
        .length === 0
    ) {
      unowned.add(`${row.namespaceKey || ""}/${row.name}`);
    }
  }

  return unowned;
}

// A workload row's key, as a finding's object names it.
function getWorkloadRowKey(row: KubernetesComplianceObjectRow): string {
  return getComplianceObjectKey({
    kind: row.kind,
    namespace: row.namespaceKey || "",
    name: row.name || "",
  });
}

/*
 * The OneUptime agent's own workloads (#9929), by key: each workload the
 * chart made, by its labels, and the agent's component it is.
 */
export function getAgentComponentsByWorkload(
  rows: ReadonlyArray<KubernetesComplianceObjectRow>,
): Map<string, OneUptimeAgentComponent> {
  const components: Map<string, OneUptimeAgentComponent> = new Map();

  for (const row of rows) {
    const component: OneUptimeAgentComponent | null = row.name
      ? getOneUptimeAgentComponent({
          kind: row.kind,
          labels: readLabels(row.labels),
        })
      : null;

    if (component) {
      components.set(getWorkloadRowKey(row), component);
    }
  }

  return components;
}

/*
 * The namespaces the OneUptime agent runs in: those of its workloads other
 * than kube-bench's CronJobs. Only pods there are read for kube-bench's
 * results (#9873), so whoever could fake them can already change the agent.
 */
export function getOneUptimeAgentNamespaces(
  rows: ReadonlyArray<KubernetesComplianceObjectRow>,
): Set<string> {
  const namespaces: Set<string> = new Set<string>();

  for (const row of rows) {
    const component: OneUptimeAgentComponent | null =
      getOneUptimeAgentComponent({
        kind: row.kind,
        labels: readLabels(row.labels),
      });

    if (
      row.namespaceKey &&
      component &&
      component !== OneUptimeAgentComponent.NodeBenchmark
    ) {
      namespaces.add(row.namespaceKey);
    }
  }

  return namespaces;
}

export interface KubernetesNodeBenchmarkPodRow {
  namespaceKey: string | null;
  name: string | null;
  nodeName: string | null;
  nodeBenchmark: unknown;
}

/*
 * kube-bench's runs (#9873), from the pods the chart's CronJobs ran: each
 * one's node and what it found, as the pod's stored block holds it. Pods
 * outside the agent's namespaces, on no node, or with no block of this
 * version are left out.
 */
export function toNodeBenchmarkRuns(
  rows: ReadonlyArray<KubernetesNodeBenchmarkPodRow>,
  agentNamespaces: ReadonlySet<string>,
): Array<KubernetesComplianceNodeBenchmarkRun> {
  const runs: Array<KubernetesComplianceNodeBenchmarkRun> = [];

  for (const row of rows) {
    const namespace: string = row.namespaceKey || "";
    const result: KubernetesNodeBenchmarkBlock | null = toNodeBenchmarkBlock(
      row.nodeBenchmark,
    );

    if (
      !row.name ||
      !row.nodeName ||
      !result ||
      !agentNamespaces.has(namespace)
    ) {
      continue;
    }

    runs.push({
      node: row.nodeName,
      pod: { namespace, name: row.name },
      result,
    });
  }

  return runs;
}

/*
 * A pod as the scoring reads it: the workload whose page a person opens
 * for it - a Job's CronJob, when it has one - or the pod itself, when
 * nothing owns it (a node's static pods included), and the agent's
 * component that workload is, when it is the agent's (#9929).
 */
export function toCompliancePod(
  row: KubernetesCompliancePodRow,
  cronJobsByJob: Map<string, KubernetesObjectRef>,
  unownedReplicaSets: ReadonlySet<string> = new Set<string>(),
  agentComponents: ReadonlyMap<string, OneUptimeAgentComponent> = new Map(),
): KubernetesCompliancePod | null {
  if (!row.name) {
    return null;
  }

  const namespace: string = row.namespaceKey || "";
  const replicaSet: { kind: string; name: string } | undefined =
    getKubernetesOwners({ ownerReferences: row.ownerReferences }).find(
      (candidate: { kind: string; name: string }): boolean => {
        return (
          candidate.kind === "ReplicaSet" &&
          unownedReplicaSets.has(`${namespace}/${candidate.name}`)
        );
      },
    );
  const owner: KubernetesObjectRef | null = replicaSet
    ? { kind: "ReplicaSet", namespace, name: replicaSet.name }
    : getKubernetesPodWorkload({
        kind: "Pod",
        namespaceKey: namespace,
        name: row.name,
        labels: row.labels,
        ownerReferences: row.ownerReferences,
      });
  const workload: KubernetesObjectRef = (owner?.kind === "Job"
    ? cronJobsByJob.get(`${namespace}/${owner.name}`)
    : undefined) ||
    owner || { kind: "Pod", namespace, name: row.name };
  const workloadObject: KubernetesComplianceObject = {
    kind: workload.kind,
    namespace: workload.namespace,
    name: workload.name,
  };
  /*
   * The agent's component its workload is; a pod whose workload is not in
   * the inventory yet, by its own labels, which kube-bench's carry whole.
   */
  const agentComponent: OneUptimeAgentComponent | undefined =
    agentComponents.get(getComplianceObjectKey(workloadObject)) ||
    getOneUptimeAgentComponent({
      kind: workload.kind,
      labels: readLabels(row.labels),
    }) ||
    undefined;
  const pod: KubernetesCompliancePod = {
    namespace,
    name: row.name,
    workload: workloadObject,
    serviceAccountName: row.serviceAccountName || "default",
    security: toPodSecurity(row.security),
    images: Array.isArray(row.images)
      ? row.images.filter((image: unknown): image is string => {
          return typeof image === "string";
        })
      : [],
  };

  if (agentComponent) {
    pod.agentComponent = agentComponent;
  }

  return pod;
}

/*
 * The workloads' pod templates, as the scoring reads them (#9880): each
 * workload a pod would be named by. A Job a CronJob runs folds into the
 * CronJob, whose template it was made from, and a Deployment's ReplicaSet
 * into the Deployment - only one nothing owns is a workload of its own.
 * Which of them run no pod is the scoring's to say (getTemplatesToScore).
 */
export function toComplianceTemplates(
  rows: ReadonlyArray<KubernetesComplianceObjectRow>,
): Array<KubernetesComplianceTemplate> {
  const templates: Array<KubernetesComplianceTemplate> = [];

  for (const row of rows) {
    if (!row.name || !KUBERNETES_TEMPLATE_KINDS.includes(row.kind)) {
      continue;
    }

    const owners: Array<{ kind: string; name: string }> = getKubernetesOwners({
      ownerReferences: row.ownerReferences || null,
    });

    if (row.kind === "Job" && owners.some(isCronJobOwner)) {
      continue;
    }

    if (row.kind === "ReplicaSet" && owners.length > 0) {
      continue;
    }

    const template: KubernetesComplianceTemplate = {
      workload: {
        kind: row.kind,
        namespace: row.namespaceKey || "",
        name: row.name,
      },
      security: toPodSecurity(row.security),
    };
    // The agent's own workload says so, from its template too (#9929).
    const agentComponent: OneUptimeAgentComponent | null =
      getOneUptimeAgentComponent({
        kind: row.kind,
        labels: readLabels(row.labels),
      });

    if (agentComponent) {
      template.agentComponent = agentComponent;
    }

    templates.push(template);
  }

  return templates;
}

function isCronJobOwner(owner: { kind: string }): boolean {
  return owner.kind === "CronJob";
}

// The policy objects of a cluster, as the scoring reads them.
export function toPolicySnapshot(
  rows: ReadonlyArray<KubernetesComplianceObjectRow>,
): Pick<
  KubernetesComplianceSnapshot,
  "roles" | "bindings" | "serviceAccounts" | "networkPolicies"
> {
  const snapshot: Pick<
    KubernetesComplianceSnapshot,
    "roles" | "bindings" | "serviceAccounts" | "networkPolicies"
  > = { roles: [], bindings: [], serviceAccounts: [], networkPolicies: [] };

  for (const row of rows) {
    const namespace: string = row.namespaceKey || "";
    const name: string = row.name || "";

    if (!name) {
      continue;
    }

    switch (row.kind) {
      case "Role":
      case "ClusterRole":
        snapshot.roles.push({
          kind: row.kind,
          namespace: row.kind === "Role" ? namespace : "",
          name,
          labels: readLabels(row.labels),
          spec: readRoleSpec(row.spec),
        } as KubernetesComplianceRole);
        break;
      case "RoleBinding":
      case "ClusterRoleBinding":
        snapshot.bindings.push({
          kind: row.kind,
          namespace: row.kind === "RoleBinding" ? namespace : "",
          name,
          labels: readLabels(row.labels),
          spec: readRoleBindingSpec(row.spec),
        } as KubernetesComplianceBinding);
        break;
      case "ServiceAccount":
        snapshot.serviceAccounts.push({
          namespace,
          name,
          spec: readServiceAccountSpec(row.spec),
        });
        break;
      case "NetworkPolicy":
        snapshot.networkPolicies.push({
          namespace,
          name,
          spec: toNetworkPolicySpec(row.spec),
        });
        break;
      default:
        break;
    }
  }

  return snapshot;
}

// Every namespace that runs pods, the most pods first, with its Pod Security Admission levels.
export function summarizeNamespaces(
  pods: ReadonlyArray<KubernetesCompliancePod>,
  namespaces: ReadonlyArray<{ name: string; labels: Record<string, string> }>,
): Array<KubernetesComplianceNamespace> {
  const podCounts: Map<string, number> = new Map();

  for (const pod of pods) {
    podCounts.set(pod.namespace, (podCounts.get(pod.namespace) || 0) + 1);
  }

  const labelsOf: Map<string, Record<string, string>> = new Map();

  for (const namespace of namespaces) {
    labelsOf.set(namespace.name, namespace.labels);
  }

  return Array.from(podCounts.entries())
    .filter(([name]: [string, number]): boolean => {
      return Boolean(name);
    })
    .map(
      ([name, podCount]: [string, number]): KubernetesComplianceNamespace => {
        const labels: Record<string, string> = labelsOf.get(name) || {};

        return {
          name,
          podCount,
          enforce: labels[`${POD_SECURITY_LABEL_PREFIX}enforce`] || null,
          audit: labels[`${POD_SECURITY_LABEL_PREFIX}audit`] || null,
          warn: labels[`${POD_SECURITY_LABEL_PREFIX}warn`] || null,
        };
      },
    )
    .sort(
      (
        a: KubernetesComplianceNamespace,
        b: KubernetesComplianceNamespace,
      ): number => {
        return b.podCount - a.podCount || a.name.localeCompare(b.name);
      },
    );
}

// Whether a platform runs the cluster's control plane for its owner.
export function isManagedControlPlane(provider: string | null): boolean {
  return Boolean(
    provider &&
      Object.values(KUBERNETES_CLOUD_PLATFORM_PROVIDERS)
        .filter((label: string): boolean => {
          return label !== OPENSHIFT_KUBERNETES_PROVIDER;
        })
        .includes(provider),
  );
}

/*
 * Each framework with what is turned off of it and the findings accepted
 * for one object (#9874), each the latest first.
 */
export function withTurnedOff(
  frameworks: Array<KubernetesComplianceFrameworkResult>,
  turnedOff: Array<KubernetesComplianceTurnedOff>,
  acceptances: Array<KubernetesComplianceAcceptanceEntry> = [],
): Array<KubernetesComplianceFrameworkResponse> {
  return frameworks.map(
    (
      framework: KubernetesComplianceFrameworkResult,
    ): KubernetesComplianceFrameworkResponse => {
      return {
        ...framework,
        turnedOff: turnedOff.filter(
          (entry: KubernetesComplianceTurnedOff): boolean => {
            return entry.framework === framework.framework;
          },
        ),
        acceptances: acceptances.filter(
          (entry: KubernetesComplianceAcceptanceEntry): boolean => {
            return entry.framework === framework.framework;
          },
        ),
      };
    },
  );
}

/*
 * Whether a setting accepts one object's finding (#9874): it names the
 * object. The settings that turn a framework or a control off name none.
 */
export function isAcceptanceSetting(
  row: Pick<DataSecurityComplianceSetting, "objectName">,
): boolean {
  return Boolean((row.objectName || "").trim());
}

/*
 * The object an accepted finding names, as a finding names it: a namespaced
 * object in its namespace, a ClusterRole or a ClusterRoleBinding in none.
 * Null for a row that names no object a finding can.
 */
export function readAcceptedObject(
  row: Pick<
    DataSecurityComplianceSetting,
    "objectKind" | "objectName" | "namespace"
  >,
): KubernetesComplianceObject | null {
  const kind: string = (row.objectKind || "").trim();
  const name: string = (row.objectName || "").trim();

  if (!name || !isKubernetesComplianceObjectKind(kind)) {
    return null;
  }

  return {
    kind,
    namespace: isClusterScopedComplianceObjectKind(kind)
      ? ""
      : (row.namespace || "").trim() || (kind === "Namespace" ? name : ""),
    name,
  };
}

/*
 * The acceptances in force, as the scoring reads them: expired ones accept
 * nothing, and their findings fail again.
 */
export function getAcceptancesInForce(
  entries: ReadonlyArray<KubernetesComplianceAcceptanceEntry>,
): Array<KubernetesComplianceAcceptance> {
  return entries
    .filter((entry: KubernetesComplianceAcceptanceEntry): boolean => {
      return !entry.isExpired;
    })
    .map(
      (
        entry: KubernetesComplianceAcceptanceEntry,
      ): KubernetesComplianceAcceptance => {
        return {
          id: entry.id,
          framework: entry.framework,
          requirement: entry.requirement || "",
          object: entry.object,
        };
      },
    );
}

/*
 * The objects the inventory holds now, by key: every pod's workload, every
 * workload, every policy object and every namespace. An acceptance whose
 * object is none of them names one that is gone from the cluster.
 */
export function getObjectsOnCluster(data: {
  pods: ReadonlyArray<KubernetesCompliancePod>;
  rows: ReadonlyArray<KubernetesComplianceObjectRow>;
}): Set<string> {
  const keys: Set<string> = new Set<string>();

  for (const pod of data.pods) {
    keys.add(getComplianceObjectKey(pod.workload));
  }

  for (const row of data.rows) {
    if (!row.name) {
      continue;
    }

    keys.add(
      getComplianceObjectKey({
        kind: row.kind,
        namespace:
          row.kind === "Namespace"
            ? row.name
            : isClusterScopedComplianceObjectKind(row.kind)
              ? ""
              : row.namespaceKey || "",
        name: row.name,
      }),
    );
  }

  return keys;
}

export default class KubernetesClusterCompliance {
  @CaptureSpan()
  public static async readCompliance(data: {
    projectId: ObjectID;
    cluster: { id: ObjectID; name: string; provider: string | null };
    // The time an accepted finding's expiry is read against; now by default.
    now?: Date | undefined;
  }): Promise<KubernetesComplianceResponse> {
    const scope: Array<unknown> = [
      data.projectId.toString(),
      data.cluster.id.toString(),
    ];
    const podRows: Array<KubernetesCompliancePodRow> = await this.query(
      `SELECT "namespaceKey", "name", "labels", "ownerReferences",
              "spec"->'security' AS "security",
              "spec"->>'serviceAccountName' AS "serviceAccountName",
              jsonb_path_query_array(COALESCE("spec", '{}'::jsonb), '$.containers[*].image') AS "images"
         FROM "KubernetesResource"
        WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
          AND "kind" = 'Pod' AND "deletedAt" IS NULL
        ORDER BY "namespaceKey", "name"
        LIMIT $3`,
      [...scope, MAX_COMPLIANCE_PODS + 1],
    );
    // The workloads, with their pod templates' blocks (#9880), and the Jobs.
    const workloadRows: Array<KubernetesComplianceObjectRow> = await this.query(
      `SELECT "kind", "namespaceKey", "name", "labels", "ownerReferences",
                "spec"->'security' AS "security"
           FROM "KubernetesResource"
          WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
            AND "kind" = ANY($3) AND "deletedAt" IS NULL
          ORDER BY "kind", "namespaceKey", "name"
          LIMIT $4`,
      [...scope, [...KUBERNETES_TEMPLATE_KINDS], MAX_COMPLIANCE_WORKLOADS],
    );
    const jobRows: Array<KubernetesComplianceObjectRow> = workloadRows.filter(
      (row: KubernetesComplianceObjectRow): boolean => {
        return row.kind === "Job";
      },
    );
    const namespaceRows: Array<KubernetesComplianceObjectRow> =
      await this.query(
        `SELECT "kind", "namespaceKey", "name", "labels"
           FROM "KubernetesResource"
          WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
            AND "kind" = 'Namespace' AND "deletedAt" IS NULL
          LIMIT $3`,
        [...scope, MAX_POLICY_OBJECTS],
      );
    const versionRows: Array<{
      name: string | null;
      kubeletVersion: string | null;
    }> = await this.query(
      `SELECT "name", "status"->'nodeInfo'->>'kubeletVersion' AS "kubeletVersion"
           FROM "KubernetesResource"
          WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
            AND "kind" = 'Node' AND "deletedAt" IS NULL
          LIMIT $3`,
      [...scope, MAX_POLICY_OBJECTS],
    );
    /*
     * kube-bench's runs (#9873): the pods whose stored spec holds what it
     * found on their node, the chart's kube-bench pods alone.
     */
    const nodeBenchmarkRows: Array<KubernetesNodeBenchmarkPodRow> =
      await this.query(
        `SELECT "namespaceKey", "name",
                "spec"->>'nodeName' AS "nodeName",
                "spec"->'nodeBenchmark' AS "nodeBenchmark"
           FROM "KubernetesResource"
          WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
            AND "kind" = 'Pod' AND "deletedAt" IS NULL
            AND "spec"->'nodeBenchmark' IS NOT NULL
          LIMIT $3`,
        [...scope, MAX_POLICY_OBJECTS],
      );
    const policyRows: Array<KubernetesComplianceObjectRow> = await this.query(
      `SELECT "kind", "namespaceKey", "name", "labels", "spec"
         FROM "KubernetesResource"
        WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
          AND "kind" = ANY($3) AND "deletedAt" IS NULL
        LIMIT $4`,
      [...scope, POLICY_KINDS, MAX_POLICY_OBJECTS * POLICY_KINDS.length],
    );

    const cronJobsByJob: Map<string, KubernetesObjectRef> =
      getCronJobsByJob(jobRows);
    const unownedReplicaSets: Set<string> = getUnownedReplicaSets(workloadRows);
    const agentComponents: Map<string, OneUptimeAgentComponent> =
      getAgentComponentsByWorkload(workloadRows);
    const pods: Array<KubernetesCompliancePod> = podRows
      .slice(0, MAX_COMPLIANCE_PODS)
      .map((row: KubernetesCompliancePodRow) => {
        return toCompliancePod(
          row,
          cronJobsByJob,
          unownedReplicaSets,
          agentComponents,
        );
      })
      .filter(
        (
          pod: KubernetesCompliancePod | null,
        ): pod is KubernetesCompliancePod => {
          return Boolean(pod);
        },
      );
    const namespaces: Array<{ name: string; labels: Record<string, string> }> =
      namespaceRows
        .filter((row: KubernetesComplianceObjectRow): boolean => {
          return Boolean(row.name);
        })
        .map((row: KubernetesComplianceObjectRow) => {
          return { name: row.name!, labels: readLabels(row.labels) };
        });
    const clusterVersion: KubernetesVersion | null = getNewestKubernetesVersion(
      versionRows.map((row: { kubeletVersion: string | null }) => {
        return row.kubeletVersion;
      }),
    );
    const nodeRows: Array<KubernetesComplianceObjectRow> = versionRows.map(
      (row: { name: string | null }): KubernetesComplianceObjectRow => {
        return {
          kind: "Node",
          namespaceKey: null,
          name: row.name,
          labels: null,
        };
      },
    );
    const policies: Pick<
      KubernetesComplianceSnapshot,
      "roles" | "bindings" | "serviceAccounts" | "networkPolicies"
    > = toPolicySnapshot(policyRows);
    const snapshot: KubernetesComplianceSnapshot = {
      version: getPodSecurityStandardVersion(clusterVersion),
      provider: data.cluster.provider,
      pods,
      templates: toComplianceTemplates(workloadRows),
      namespaces,
      ...policies,
      // Every cluster has ClusterRoles: none means the agent does not send them.
      hasPolicyObjects: policies.roles.some(
        (role: KubernetesComplianceRole): boolean => {
          return role.kind === "ClusterRole";
        },
      ),
      nodeBenchmarks: toNodeBenchmarkRuns(
        nodeBenchmarkRows,
        getOneUptimeAgentNamespaces(workloadRows),
      ),
    };
    const settings: Array<KubernetesComplianceSetting> =
      await this.readSettings(data.projectId, data.cluster.id);
    const turnedOff: Array<KubernetesComplianceTurnedOff> =
      await this.readTurnedOff(data.projectId, data.cluster);
    const acceptances: Array<KubernetesComplianceAcceptanceEntry> =
      await this.readAcceptances({
        projectId: data.projectId,
        clusterId: data.cluster.id,
        now: data.now || OneUptimeDate.getCurrentDate(),
        objectsOnCluster: getObjectsOnCluster({
          pods,
          rows: [...workloadRows, ...namespaceRows, ...policyRows, ...nodeRows],
        }),
      });

    return {
      clusterId: data.cluster.id.toString(),
      kubernetesVersion: clusterVersion
        ? formatKubernetesVersion(clusterVersion)
        : null,
      standardVersion: formatKubernetesVersion(snapshot.version),
      provider: data.cluster.provider,
      isManagedControlPlane: isManagedControlPlane(data.cluster.provider),
      podCount: pods.length,
      podsRead: pods.filter((pod: KubernetesCompliancePod): boolean => {
        return Boolean(pod.security);
      }).length,
      templateCount: getTemplatesToScore(snapshot).filter(
        (template: KubernetesComplianceTemplate): boolean => {
          return Boolean(template.security);
        },
      ).length,
      hasPolicyObjects: snapshot.hasPolicyObjects,
      policyEngine: findPolicyEngine(snapshot),
      isTruncated: podRows.length > MAX_COMPLIANCE_PODS,
      namespaces: summarizeNamespaces(pods, namespaces),
      nodeBenchmark: summarizeNodeBenchmark(
        getNodeBenchmarkScope(snapshot.nodeBenchmarks),
        data.cluster.provider,
      ),
      frameworks: withTurnedOff(
        scoreKubernetesFrameworks(
          snapshot,
          settings,
          getAcceptancesInForce(acceptances),
        ),
        turnedOff,
        acceptances,
      ),
    };
  }

  private static async query<T>(
    sql: string,
    parameters: Array<unknown>,
  ): Promise<Array<T>> {
    return (await KubernetesResourceService.getRepository().manager.query(
      sql,
      parameters,
    )) as Array<T>;
  }

  // The cluster's settings of its own frameworks, oldest first: the last one wins.
  private static async readSettings(
    projectId: ObjectID,
    clusterId: ObjectID,
  ): Promise<Array<KubernetesComplianceSetting>> {
    const rows: Array<DataSecurityComplianceSetting> =
      await DataSecurityComplianceSettingService.findBy({
        query: {
          projectId,
          resourceType: DataStoreResourceKind.KubernetesCluster,
          resourceId: clusterId,
        },
        select: {
          _id: true,
          framework: true,
          requirement: true,
          namespace: true,
          objectName: true,
          isEnabled: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: MAX_SETTINGS,
        props: { isRoot: true },
      });
    const settings: Array<KubernetesComplianceSetting> = [];

    for (const row of rows) {
      // An accepted finding turns nothing off for its namespace (readAcceptances).
      if (
        isKubernetesComplianceFramework(row.framework) &&
        !isAcceptanceSetting(row)
      ) {
        settings.push({
          framework: row.framework,
          requirement: (row.requirement || "").trim(),
          namespace: (row.namespace || "").trim(),
          isEnabled: row.isEnabled !== false,
        });
      }
    }

    return settings;
  }

  // What is turned off of the cluster's frameworks, with why and by whom, the latest first.
  private static async readTurnedOff(
    projectId: ObjectID,
    cluster: { id: ObjectID; name: string },
  ): Promise<Array<KubernetesComplianceTurnedOff>> {
    const rows: Array<DataSecurityComplianceSetting> =
      await DataSecurityComplianceSettingService.findBy({
        query: {
          projectId,
          resourceType: DataStoreResourceKind.KubernetesCluster,
          resourceId: cluster.id,
          isEnabled: false,
        },
        select: {
          _id: true,
          framework: true,
          requirement: true,
          namespace: true,
          objectName: true,
          note: true,
          turnedOffAt: true,
          turnedOffByUser: { name: true, email: true },
        },
        sort: { updatedAt: SortOrder.Descending },
        skip: 0,
        limit: MAX_SETTINGS,
        props: { isRoot: true },
      });
    const entries: Array<KubernetesComplianceTurnedOff> = [];

    for (const row of rows) {
      if (
        !row.id ||
        !isKubernetesComplianceFramework(row.framework) ||
        isAcceptanceSetting(row)
      ) {
        continue;
      }

      entries.push({
        id: row.id.toString(),
        framework: row.framework as KubernetesComplianceFramework,
        resource: {
          kind: DataStoreResourceKind.KubernetesCluster,
          id: cluster.id.toString(),
          name: cluster.name,
        },
        requirement: (row.requirement || "").trim() || null,
        namespace: (row.namespace || "").trim() || null,
        note: (row.note || "").trim(),
        turnedOffAt: row.turnedOffAt
          ? new Date(row.turnedOffAt).toISOString()
          : null,
        turnedOffBy:
          row.turnedOffByUser?.name?.toString() ||
          row.turnedOffByUser?.email?.toString() ||
          null,
      });
    }

    return entries.sort(
      (
        a: KubernetesComplianceTurnedOff,
        b: KubernetesComplianceTurnedOff,
      ): number => {
        return (b.turnedOffAt || "").localeCompare(a.turnedOffAt || "");
      },
    );
  }

  /*
   * The findings accepted for one object (#9874), with why, who accepted
   * each and when, and until when - the latest first, expired ones too, so
   * they stay listed and can be revoked. Each says whether its object is
   * still on the cluster.
   */
  private static async readAcceptances(data: {
    projectId: ObjectID;
    clusterId: ObjectID;
    now: Date;
    objectsOnCluster: ReadonlySet<string>;
  }): Promise<Array<KubernetesComplianceAcceptanceEntry>> {
    const rows: Array<DataSecurityComplianceSetting> =
      await DataSecurityComplianceSettingService.findBy({
        query: {
          projectId: data.projectId,
          resourceType: DataStoreResourceKind.KubernetesCluster,
          resourceId: data.clusterId,
          isEnabled: false,
        },
        select: {
          _id: true,
          framework: true,
          requirement: true,
          namespace: true,
          objectKind: true,
          objectName: true,
          note: true,
          expiresAt: true,
          turnedOffAt: true,
          turnedOffByUser: { name: true, email: true },
        },
        sort: { updatedAt: SortOrder.Descending },
        skip: 0,
        limit: MAX_SETTINGS,
        props: { isRoot: true },
      });
    const entries: Array<KubernetesComplianceAcceptanceEntry> = [];

    for (const row of rows) {
      const object: KubernetesComplianceObject | null = isAcceptanceSetting(row)
        ? readAcceptedObject(row)
        : null;

      if (
        !row.id ||
        !object ||
        !isKubernetesComplianceFramework(row.framework)
      ) {
        continue;
      }

      entries.push({
        id: row.id.toString(),
        framework: row.framework as KubernetesComplianceFramework,
        requirement: (row.requirement || "").trim() || null,
        object,
        note: (row.note || "").trim(),
        acceptedAt: row.turnedOffAt
          ? new Date(row.turnedOffAt).toISOString()
          : null,
        acceptedBy:
          row.turnedOffByUser?.name?.toString() ||
          row.turnedOffByUser?.email?.toString() ||
          null,
        expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
        isExpired: !isKubernetesAcceptanceInForce(row.expiresAt, data.now),
        isOnCluster: data.objectsOnCluster.has(getComplianceObjectKey(object)),
      });
    }

    return entries.sort(
      (
        a: KubernetesComplianceAcceptanceEntry,
        b: KubernetesComplianceAcceptanceEntry,
      ): number => {
        return (b.acceptedAt || "").localeCompare(a.acceptedAt || "");
      },
    );
  }
}
