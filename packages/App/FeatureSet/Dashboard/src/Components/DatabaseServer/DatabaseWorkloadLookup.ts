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
 * workload that owns its pods, or after the cluster its labels place it in
 * (an operator's, a Percona cluster's instance, a Helm chart's
 * `${release}-${chart}`), and a container after its Swarm / Compose
 * service. These helpers list those candidates by running discovery's own
 * classifier (DatabaseContainerClassifier) on what the page has; the query
 * matches any of them. Pure (no React, no API) so they are unit-tested on
 * their own.
 *
 * An operator also labels the parts of a cluster that are not database
 * members — a pooler Deployment, a backup repo host — with the cluster's
 * name, and discovery rejects exactly those as members. Such an object is
 * still linked to the cluster's database, but as a cluster it belongs to
 * (`clusterNames`), so the badge never says it runs the database.
 */

export type DatabaseWorkloadPlatform = "kubernetes" | "docker" | "podman";

export interface DatabaseWorkloadTarget {
  platform: DatabaseWorkloadPlatform;
  // The Kubernetes cluster / Docker host / Podman host id.
  parentId: ObjectID | string;
  // Kubernetes only; null when the page could not read it.
  namespace?: string | null | undefined;
  // Every name discovery could have given a database this object runs.
  workloadNames: Array<string>;
  /*
   * Operator clusters the object is only labelled part of, without being
   * one of their members (see above). Asked for too; a database matched
   * only by one of these is "part of", never "runs".
   */
  clusterNames?: Array<string> | undefined;
}

// A Kubernetes object's candidates, split as the target splits them.
export interface DatabaseWorkloadCandidates {
  workloadNames: Array<string>;
  clusterNames: Array<string>;
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
 * The workload names a database on this Kubernetes object could carry, and
 * the operator clusters it is only labelled part of.
 *
 * `workloadNames`: the name the object classifies into exactly as discovery
 * classifies a pod — a pod with its containers when they are known, any
 * object by its labels alone otherwise (a StatefulSet or Deployment carries
 * the same operator, Percona and `app.kubernetes.io/*` labels as its pods,
 * so Bitnami's `shop-redis-master` names `shop-redis`, Percona's
 * `cluster1-pxc` names `cluster1`) — then the object's own name and, for a
 * pod, the workloads that own it (a Deployment behind its ReplicaSet
 * included).
 *
 * `clusterNames`: the cluster its operator labels name (`cnpg.io/cluster`,
 * `cluster-name`, …) when that is not already one of the above — an object
 * discovery does not count as a member (a pooler, a backup repo host) still
 * leads to its cluster's database.
 */
export function getKubernetesDatabaseWorkloadCandidates(data: {
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
}): DatabaseWorkloadCandidates {
  const own: Array<unknown> = [];
  const owners: Array<{
    kind?: string | undefined;
    name?: string | undefined;
  }> =
    data.kind === "Pod" && Array.isArray(data.ownerReferences)
      ? data.ownerReferences
      : [];

  /*
   * With no containers the classifier can only match its label rules, which
   * is exactly the label-only question for a StatefulSet or Deployment: the
   * object stands in as the owner of a pod of its own name.
   */
  const classified: KubernetesDatabaseCandidate | null = classifyKubernetesPod({
    namespaceKey: data.namespace || "",
    name: data.name,
    phase: data.kind === "Pod" ? data.phase : null,
    labels: data.labels,
    ownerReferences: {
      items:
        data.kind === "Pod" ? owners : [{ kind: data.kind, name: data.name }],
    },
    spec: {
      containers:
        data.kind === "Pod" && Array.isArray(data.containers)
          ? data.containers
          : [],
    },
  });
  own.push(classified?.workloadName);

  own.push(data.name);

  for (const owner of owners) {
    const ownerName: string =
      typeof owner?.name === "string" ? owner.name.trim() : "";
    if (!ownerName) {
      continue;
    }
    if ((owner.kind || "").toLowerCase() === "replicaset") {
      own.push(
        deploymentOfReplicaSet(
          ownerName,
          data.labels ? data.labels["pod-template-hash"] : undefined,
        ),
      );
    }
    own.push(ownerName);
  }

  const workloadNames: Array<string> = uniqueNames(own);
  return {
    workloadNames: workloadNames,
    clusterNames: uniqueNames(labelValues(data.labels)).filter(
      (name: string): boolean => {
        return !workloadNames.includes(name);
      },
    ),
  };
}

/**
 * The names a container's inventory row (DockerResource / PodmanResource)
 * may be stored under: its name as the page has it, and with the leading
 * "/" the Docker API puts on names — the row is found either way. Empty
 * for a blank name.
 */
export function getContainerInventoryNames(
  containerName: string,
): Array<string> {
  const name: string = (containerName || "").trim().replace(/^\/+/, "");
  return name ? [name, `/${name}`] : [];
}

/**
 * The workload names a database in this Docker / Podman container could
 * carry: the container's own name, and — when its image is a database —
 * the Swarm / Compose service discovery groups it under. Compose's project
 * and service come from the container's labels, so a page passes the labels
 * of its inventory row (see useContainerDatabaseWorkloadTarget).
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
  const names: Array<string> = uniqueNames([
    ...(target.workloadNames || []),
    ...(target.clusterNames || []),
  ]);
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
    // Where a name came from decides the badge's sentence.
    "\u0001",
    ...uniqueNames(target.clusterNames || []),
  ].join("\u0000");
}

/**
 * Whether a database found for this target was matched only as a cluster
 * the object is labelled part of (see DatabaseWorkloadTarget.clusterNames)
 * — "part of", not "runs".
 */
export function isDatabaseWorkloadClusterMatch(
  target: DatabaseWorkloadTarget | null | undefined,
  workloadName: string | null | undefined,
): boolean {
  const name: string =
    typeof workloadName === "string" ? workloadName.trim() : "";
  if (!target || !name) {
    return false;
  }
  return (
    uniqueNames(target.clusterNames || []).includes(name) &&
    !uniqueNames(target.workloadNames || []).includes(name)
  );
}
