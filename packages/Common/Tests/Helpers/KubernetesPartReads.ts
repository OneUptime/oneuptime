import {
  KubernetesAttentionFinding,
  KubernetesHealthRow,
  getKubernetesAttentionFindings,
  getKubernetesHealthSeverity,
  getKubernetesPodWorkload,
} from "../../Types/Kubernetes/KubernetesHealth";

/*
 * WHAT THE SERVER ANSWERS A KUBERNETES PAGE, OVER ROWS HELD IN MEMORY.
 *
 * The Overview reads what needs attention (POST
 * /kubernetes-resource/needs-attention/:clusterId), and a pod's, a
 * workload's or a node's page reads the object with what it runs (POST
 * /kubernetes-resource/part/:clusterId). KubernetesResourceService answers
 * both in SQL; these give the same answers over rows held in memory, for
 * the browser fixtures, so a page under test reads what it would read from
 * the server. They follow the service's rules, which
 * KubernetesResourceHealthPostgres pins on a migrated database and
 * KubernetesPartReads.test pins here on the same rows:
 *
 *   - what needs attention is every row the ingest would flag
 *     (getKubernetesHealthSeverity, the healthSeverity column), with the
 *     workloads of their namespaces, through getKubernetesAttentionFindings;
 *   - an object is the first of its kind and name, by namespace, in the
 *     namespace asked for if one is; a Deployment's, StatefulSet's,
 *     DaemonSet's, Job's or DeploymentConfig's pods are the ones its owner
 *     rule gives it (getKubernetesPodWorkload), a CronJob's its Jobs' pods,
 *     a node's the ones scheduled on it.
 */

export interface KubernetesPartReadRequest {
  kind: string;
  name: string;
  namespace?: string | undefined;
}

export interface KubernetesPartReadAnswer<Row extends KubernetesHealthRow> {
  part: Row | null;
  pods: Array<Row>;
  jobs: Array<Row>;
  isPodsTruncated: boolean;
}

// As KubernetesResourceService's.
const NEEDS_ATTENTION_FINDING_LIMIT: number = 500;
const PART_POD_LIMIT: number = 1000;

const NEEDS_ATTENTION_WORKLOAD_KINDS: ReadonlySet<string> = new Set<string>([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "DeploymentConfig",
]);

const KINDS_WITH_PODS: ReadonlySet<string> = new Set<string>([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "DeploymentConfig",
  "Node",
]);

function timeOf(value: Date | string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time: number = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

// The newest report first, as the service orders a part's pods.
function byNewestReport<Row extends KubernetesHealthRow>(
  a: Row,
  b: Row,
): number {
  return timeOf(b.lastSeenAt) - timeOf(a.lastSeenAt);
}

export function readKubernetesNeedsAttention(
  rows: ReadonlyArray<KubernetesHealthRow>,
): { findings: Array<KubernetesAttentionFinding>; isTruncated: boolean } {
  const flagged: Array<KubernetesHealthRow> = rows.filter(
    (row: KubernetesHealthRow): boolean => {
      return getKubernetesHealthSeverity(row) !== null;
    },
  );

  const namespaces: Set<string> = new Set<string>(
    flagged
      .map((row: KubernetesHealthRow): string => {
        return row.namespaceKey || "";
      })
      .filter(Boolean),
  );

  const workloads: Array<KubernetesHealthRow> = rows.filter(
    (row: KubernetesHealthRow): boolean => {
      return (
        NEEDS_ATTENTION_WORKLOAD_KINDS.has(row.kind || "") &&
        namespaces.has(row.namespaceKey || "") &&
        !flagged.includes(row)
      );
    },
  );

  const findings: Array<KubernetesAttentionFinding> =
    getKubernetesAttentionFindings([...workloads, ...flagged]);

  return {
    findings: findings.slice(0, NEEDS_ATTENTION_FINDING_LIMIT),
    isTruncated: findings.length > NEEDS_ATTENTION_FINDING_LIMIT,
  };
}

export function readKubernetesPart<Row extends KubernetesHealthRow>(
  rows: ReadonlyArray<Row>,
  request: KubernetesPartReadRequest,
): KubernetesPartReadAnswer<Row> {
  const part: Row | null =
    rows
      .filter((row: Row): boolean => {
        return (
          row.kind === request.kind &&
          row.name === request.name &&
          (request.namespace === undefined ||
            (row.namespaceKey || "") === request.namespace)
        );
      })
      .sort((a: Row, b: Row): number => {
        return (a.namespaceKey || "").localeCompare(b.namespaceKey || "");
      })[0] || null;

  if (!part || !KINDS_WITH_PODS.has(request.kind)) {
    return { part: part, pods: [], jobs: [], isPodsTruncated: false };
  }

  const namespace: string = part.namespaceKey || "";
  const podsOf: Array<Row> = rows.filter((row: Row): boolean => {
    return row.kind === "Pod";
  });

  if (request.kind === "Node") {
    const pods: Array<Row> = podsOf
      .filter((pod: Row): boolean => {
        const spec: Record<string, unknown> =
          (pod.spec as Record<string, unknown> | null | undefined) || {};
        return spec["nodeName"] === request.name;
      })
      .sort(byNewestReport);
    return {
      part: part,
      pods: pods.slice(0, PART_POD_LIMIT),
      jobs: [],
      isPodsTruncated: pods.length > PART_POD_LIMIT,
    };
  }

  const inNamespace: Array<Row> = podsOf.filter((pod: Row): boolean => {
    return (pod.namespaceKey || "") === namespace;
  });

  if (request.kind === "CronJob") {
    const jobs: Array<Row> = rows
      .filter((row: Row): boolean => {
        if (row.kind !== "Job" || (row.namespaceKey || "") !== namespace) {
          return false;
        }
        const items: unknown = (
          row.ownerReferences as Record<string, unknown> | null | undefined
        )?.["items"];
        return (
          Array.isArray(items) &&
          items.some((item: unknown): boolean => {
            const owner: Record<string, unknown> =
              (item as Record<string, unknown> | null) || {};
            return (
              owner["kind"] === "CronJob" && owner["name"] === request.name
            );
          })
        );
      })
      .sort((a: Row, b: Row): number => {
        return (
          timeOf(b.resourceCreationTimestamp) -
          timeOf(a.resourceCreationTimestamp)
        );
      });
    const jobNames: Set<string> = new Set<string>(
      jobs.map((job: Row): string => {
        return job.name || "";
      }),
    );
    const pods: Array<Row> = inNamespace
      .filter((pod: Row): boolean => {
        const workload: { kind: string; name: string } | null =
          getKubernetesPodWorkload(pod);
        return Boolean(
          workload && workload.kind === "Job" && jobNames.has(workload.name),
        );
      })
      .sort(byNewestReport);
    return {
      part: part,
      pods: pods.slice(0, PART_POD_LIMIT),
      jobs: jobs,
      isPodsTruncated: pods.length > PART_POD_LIMIT,
    };
  }

  const pods: Array<Row> = inNamespace
    .filter((pod: Row): boolean => {
      const workload: { kind: string; name: string } | null =
        getKubernetesPodWorkload(pod);
      return Boolean(
        workload &&
          workload.kind === request.kind &&
          workload.name === request.name,
      );
    })
    .sort(byNewestReport);

  return {
    part: part,
    pods: pods.slice(0, PART_POD_LIMIT),
    jobs: [],
    isPodsTruncated: pods.length > PART_POD_LIMIT,
  };
}
