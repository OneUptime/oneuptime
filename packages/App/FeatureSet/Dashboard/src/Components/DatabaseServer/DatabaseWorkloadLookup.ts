import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import {
  ContainerDatabaseClassification,
  DATABASE_OPERATOR_LABEL_KEYS,
  KubernetesContainerLike,
  KubernetesDatabaseCandidate,
  classifyContainer,
  classifyKubernetesPod,
} from "Common/Types/DatabaseServer/DatabaseContainerClassifier";
import ObjectID from "Common/Types/ObjectID";

/*
 * The reverse of a database's "Runs on" / "Workload" links: from a
 * Kubernetes StatefulSet / Deployment / pod page, or a Docker / Podman
 * container page, to the Database discovered on it.
 *
 * Container discovery stores what a database runs as on its row — the
 * parent (kubernetesClusterId / dockerHostId / podmanHostId), the
 * Kubernetes namespace and the workload's name — so a page finds its
 * database with ONE query on those columns. What the page must work out is
 * which workload names could be its: discovery names a database after the
 * workload that owns its pods, or after the operator cluster its labels
 * name, and a container after its Swarm / Compose service. These helpers
 * list those candidates; the query matches any of them. Pure (no React, no
 * API) so they are unit-tested on their own.
 */

export type DatabaseWorkloadPlatform = "kubernetes" | "docker" | "podman";

export interface DatabaseWorkloadTarget {
  platform: DatabaseWorkloadPlatform;
  // The Kubernetes cluster / Docker host / Podman host id.
  parentId: ObjectID | string;
  // Kubernetes only; null when the page could not read it.
  namespace?: string | null | undefined;
  // Every name discovery could have given the database (see above).
  workloadNames: Array<string>;
}

// A few, for the odd pod that is a member of more than one row.
export const DATABASE_WORKLOAD_LOOKUP_LIMIT: number = 5;

function uniqueNames(values: Array<unknown>): Array<string> {
  const names: Array<string> = [];
  for (const value of values) {
    const name: string = typeof value === "string" ? value.trim() : "";
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function labelValues(
  labels: Record<string, unknown> | null | undefined,
): Array<unknown> {
  if (!labels || typeof labels !== "object") {
    return [];
  }
  return DATABASE_OPERATOR_LABEL_KEYS.map((key: string): unknown => {
    return labels[key];
  });
}

/*
 * The Deployment a ReplicaSet belongs to: `${deployment}-${pod-template-hash}`,
 * stripped exactly by the pod's own hash label (as discovery does).
 */
function deploymentOfReplicaSet(
  replicaSetName: string,
  podTemplateHash: unknown,
): string | null {
  const hash: string =
    typeof podTemplateHash === "string" ? podTemplateHash.trim() : "";
  const suffix: string = `-${hash}`;
  if (
    !hash ||
    !replicaSetName.endsWith(suffix) ||
    replicaSetName.length <= suffix.length
  ) {
    return null;
  }
  return replicaSetName.substring(0, replicaSetName.length - suffix.length);
}

/**
 * The workload names a database on this Kubernetes object could carry: the
 * object's own name, the operator cluster its labels name
 * (`cnpg.io/cluster`, `cluster-name`, …) and, for a pod, the workloads that
 * own it (a Deployment behind its ReplicaSet included). A pod whose
 * containers are known is also classified exactly as discovery classifies
 * it, which names a Helm chart's or Percona operator's cluster the way
 * discovery did.
 */
export function getKubernetesDatabaseWorkloadNames(data: {
  kind: "Pod" | "StatefulSet" | "Deployment";
  name: string;
  namespace?: string | null | undefined;
  phase?: string | null | undefined;
  labels?: Record<string, unknown> | null | undefined;
  ownerReferences?:
    | Array<{ kind?: string | undefined; name?: string | undefined }>
    | null
    | undefined;
  containers?: Array<KubernetesContainerLike> | null | undefined;
}): Array<string> {
  const candidates: Array<unknown> = [];

  if (data.kind === "Pod" && Array.isArray(data.containers)) {
    const classified: KubernetesDatabaseCandidate | null =
      classifyKubernetesPod({
        namespaceKey: data.namespace || "",
        name: data.name,
        phase: data.phase,
        labels: data.labels,
        ownerReferences: {
          items: Array.isArray(data.ownerReferences)
            ? data.ownerReferences
            : [],
        },
        spec: { containers: data.containers },
      });
    candidates.push(classified?.workloadName);
  }

  candidates.push(data.name);

  if (data.kind === "Pod") {
    for (const owner of Array.isArray(data.ownerReferences)
      ? data.ownerReferences
      : []) {
      const ownerName: string =
        typeof owner?.name === "string" ? owner.name.trim() : "";
      if (!ownerName) {
        continue;
      }
      if ((owner.kind || "").toLowerCase() === "replicaset") {
        candidates.push(
          deploymentOfReplicaSet(
            ownerName,
            data.labels ? data.labels["pod-template-hash"] : undefined,
          ),
        );
      }
      candidates.push(ownerName);
    }
  }

  candidates.push(...labelValues(data.labels));
  return uniqueNames(candidates);
}

/**
 * The workload names a database in this Docker / Podman container could
 * carry: the container's own name, and — when its image is a database —
 * the Swarm / Compose service discovery groups it under.
 */
export function getContainerDatabaseWorkloadNames(data: {
  containerName: string;
  imageName?: string | null | undefined;
  labels?: Record<string, unknown> | null | undefined;
}): Array<string> {
  const classification: ContainerDatabaseClassification | null =
    classifyContainer({
      name: data.containerName,
      imageName: data.imageName || null,
      labels: data.labels || null,
    });
  return uniqueNames([classification?.workloadName, data.containerName]);
}

/**
 * The DatabaseServer query for a page's workload, or null when there is
 * nothing to look for (no parent, no name). Archived databases are left
 * out: the page links to a database that is still there.
 */
export function buildDatabaseWorkloadQuery(
  target: DatabaseWorkloadTarget | null | undefined,
): Query<DatabaseServer> | null {
  if (!target) {
    return null;
  }
  const parentId: string = target.parentId
    ? target.parentId.toString().trim()
    : "";
  const names: Array<string> = uniqueNames(target.workloadNames || []);
  if (!parentId || names.length === 0) {
    return null;
  }

  const query: Query<DatabaseServer> = {
    workloadName: names.length === 1 ? names[0]! : new Includes(names),
    isArchived: false,
  } as Query<DatabaseServer>;

  if (target.platform === "kubernetes") {
    query.kubernetesClusterId = new ObjectID(parentId);
    const namespace: string =
      typeof target.namespace === "string" ? target.namespace.trim() : "";
    if (namespace) {
      query.kubernetesNamespace = namespace;
    }
  } else if (target.platform === "docker") {
    query.dockerHostId = new ObjectID(parentId);
  } else {
    query.podmanHostId = new ObjectID(parentId);
  }

  return query;
}

/** A stable identity for a target, so a page re-render never re-queries. */
export function getDatabaseWorkloadTargetKey(
  target: DatabaseWorkloadTarget | null | undefined,
): string {
  if (!target) {
    return "";
  }
  return [
    target.platform,
    target.parentId ? target.parentId.toString() : "",
    target.namespace || "",
    ...uniqueNames(target.workloadNames || []),
  ].join("\u0000");
}
