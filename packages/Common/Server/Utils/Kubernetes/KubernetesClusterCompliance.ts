import DataSecurityComplianceSetting from "../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  KUBERNETES_CLOUD_PLATFORM_PROVIDERS,
  OPENSHIFT_KUBERNETES_PROVIDER,
} from "../../../Types/Kubernetes/KubernetesClusterProvider";
import {
  KubernetesObjectRef,
  getKubernetesJobCronJob,
  getKubernetesPodWorkload,
} from "../../../Types/Kubernetes/KubernetesHealth";
import { toPodSecurity } from "../../../Types/Kubernetes/KubernetesPodSecurity";
import {
  readRoleBindingSpec,
  readRoleSpec,
  readServiceAccountSpec,
  toNetworkPolicySpec,
} from "../../../Types/Kubernetes/KubernetesPolicyObjects";
import { findPolicyEngine } from "../../../Types/Kubernetes/Compliance/CisKubernetesBenchmark";
import {
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceNamespace,
  KubernetesComplianceResponse,
  KubernetesComplianceTurnedOff,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import {
  KubernetesComplianceFramework,
  isKubernetesComplianceFramework,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceFrameworkResult,
  KubernetesComplianceSetting,
  scoreKubernetesFrameworks,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
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
 * Each read is bounded and reads only the columns the scoring needs: a
 * pod's security block, not its whole spec. The caller has already read the
 * cluster as the person asking; these reads are OneUptime's own, in that
 * cluster of that project.
 */

// The most pods one answer scores; a cluster with more says so.
export const MAX_COMPLIANCE_PODS: number = 25000;

// The most of each kind of policy object, and of settings, one answer reads.
const MAX_POLICY_OBJECTS: number = 20000;
const MAX_SETTINGS: number = 10000;

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
 * A pod as the scoring reads it: the workload whose page a person opens
 * for it - a Job's CronJob, when it has one - or the pod itself, when
 * nothing owns it (a node's static pods included).
 */
export function toCompliancePod(
  row: KubernetesCompliancePodRow,
  cronJobsByJob: Map<string, KubernetesObjectRef>,
): KubernetesCompliancePod | null {
  if (!row.name) {
    return null;
  }

  const namespace: string = row.namespaceKey || "";
  const owner: KubernetesObjectRef | null = getKubernetesPodWorkload({
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

  return {
    namespace,
    name: row.name,
    workload: {
      kind: workload.kind,
      namespace: workload.namespace,
      name: workload.name,
    },
    serviceAccountName: row.serviceAccountName || "default",
    security: toPodSecurity(row.security),
    images: Array.isArray(row.images)
      ? row.images.filter((image: unknown): image is string => {
          return typeof image === "string";
        })
      : [],
  };
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

// Each framework with what is turned off of it, the latest first.
export function withTurnedOff(
  frameworks: Array<KubernetesComplianceFrameworkResult>,
  turnedOff: Array<KubernetesComplianceTurnedOff>,
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
      };
    },
  );
}

export default class KubernetesClusterCompliance {
  @CaptureSpan()
  public static async readCompliance(data: {
    projectId: ObjectID;
    cluster: { id: ObjectID; name: string; provider: string | null };
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
    const jobRows: Array<KubernetesComplianceObjectRow> = await this.query(
      `SELECT "kind", "namespaceKey", "name", "labels", "ownerReferences"
         FROM "KubernetesResource"
        WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
          AND "kind" = 'Job' AND "deletedAt" IS NULL
        LIMIT $3`,
      [...scope, MAX_POLICY_OBJECTS],
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
    const versionRows: Array<{ kubeletVersion: string | null }> =
      await this.query(
        `SELECT "status"->'nodeInfo'->>'kubeletVersion' AS "kubeletVersion"
           FROM "KubernetesResource"
          WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
            AND "kind" = 'Node' AND "deletedAt" IS NULL
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
    const pods: Array<KubernetesCompliancePod> = podRows
      .slice(0, MAX_COMPLIANCE_PODS)
      .map((row: KubernetesCompliancePodRow) => {
        return toCompliancePod(row, cronJobsByJob);
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
    const policies: Pick<
      KubernetesComplianceSnapshot,
      "roles" | "bindings" | "serviceAccounts" | "networkPolicies"
    > = toPolicySnapshot(policyRows);
    const snapshot: KubernetesComplianceSnapshot = {
      version: getPodSecurityStandardVersion(clusterVersion),
      provider: data.cluster.provider,
      pods,
      namespaces,
      ...policies,
      // Every cluster has ClusterRoles: none means the agent does not send them.
      hasPolicyObjects: policies.roles.some(
        (role: KubernetesComplianceRole): boolean => {
          return role.kind === "ClusterRole";
        },
      ),
    };
    const settings: Array<KubernetesComplianceSetting> =
      await this.readSettings(data.projectId, data.cluster.id);
    const turnedOff: Array<KubernetesComplianceTurnedOff> =
      await this.readTurnedOff(data.projectId, data.cluster);

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
      hasPolicyObjects: snapshot.hasPolicyObjects,
      policyEngine: findPolicyEngine(snapshot),
      isTruncated: podRows.length > MAX_COMPLIANCE_PODS,
      namespaces: summarizeNamespaces(pods, namespaces),
      frameworks: withTurnedOff(
        scoreKubernetesFrameworks(snapshot, settings),
        turnedOff,
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
          isEnabled: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: MAX_SETTINGS,
        props: { isRoot: true },
      });
    const settings: Array<KubernetesComplianceSetting> = [];

    for (const row of rows) {
      if (isKubernetesComplianceFramework(row.framework)) {
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
      if (!row.id || !isKubernetesComplianceFramework(row.framework)) {
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
}
