import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import {
  DatabaseRunsOnSource,
  DatabaseRuntimePlatform,
  getDatabaseRunsOnLabel,
  getDatabaseRuntimePlatform,
  getDatabaseWorkloadLabel,
} from "../../Pages/Database/Utils/DatabaseServerPresentation";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Runs on" and "Workload" as links: a database found on a Kubernetes
 * cluster, a Docker host or a Podman host links to that cluster's / host's
 * page, and its workload to the StatefulSet / Deployment / DaemonSet / pod
 * page (Kubernetes) or the host's containers (Docker, Podman — a compose
 * service can run several containers, so the list, not one of them).
 *
 * The other products' routes live here, not under Pages/Database, so the
 * Databases pages stay free of other products' identifiers (see
 * DatabaseProductWiring.test.ts).
 */

function idOf(value: unknown): ObjectID | null {
  if (value instanceof ObjectID) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return new ObjectID(value.trim());
  }
  if (value && typeof value === "object" && "toString" in value) {
    const text: string = String(value).trim();
    return text && text !== "[object Object]" ? new ObjectID(text) : null;
  }
  return null;
}

// The parent's page, keyed by platform.
const PARENT_PAGES: Record<DatabaseRuntimePlatform, PageMap> = {
  [DatabaseRuntimePlatform.Kubernetes]: PageMap.KUBERNETES_CLUSTER_VIEW,
  [DatabaseRuntimePlatform.Docker]: PageMap.DOCKER_HOST_VIEW,
  [DatabaseRuntimePlatform.Podman]: PageMap.PODMAN_HOST_VIEW,
};

// Kubernetes workload kinds that have a detail page, keyed by kind.
const KUBERNETES_WORKLOAD_PAGES: Record<string, PageMap> = {
  statefulset: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
  deployment: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
  daemonset: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL,
  pod: PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
};

const CONTAINER_LIST_PAGES: Partial<Record<DatabaseRuntimePlatform, PageMap>> =
  {
    [DatabaseRuntimePlatform.Docker]: PageMap.DOCKER_HOST_VIEW_CONTAINERS,
    [DatabaseRuntimePlatform.Podman]: PageMap.PODMAN_HOST_VIEW_CONTAINERS,
  };

function parentIdOf(
  source: DatabaseRunsOnSource,
  platform: DatabaseRuntimePlatform,
): ObjectID | null {
  switch (platform) {
    case DatabaseRuntimePlatform.Kubernetes:
      return idOf(source.kubernetesClusterId);
    case DatabaseRuntimePlatform.Docker:
      return idOf(source.dockerHostId);
    default:
      return idOf(source.podmanHostId);
  }
}

/**
 * The page of the cluster / host the database runs on, or null when it is
 * not on one or the parent's id was not loaded.
 */
export function getDatabaseRunsOnRoute(
  source: DatabaseRunsOnSource | null | undefined,
): Route | null {
  if (!source) {
    return null;
  }
  const platform: DatabaseRuntimePlatform | null =
    getDatabaseRuntimePlatform(source);
  if (!platform) {
    return null;
  }
  const parentId: ObjectID | null = parentIdOf(source, platform);
  if (!parentId) {
    return null;
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PARENT_PAGES[platform]] as Route,
    { modelId: parentId },
  );
}

/**
 * The page of the workload itself: the Kubernetes StatefulSet / Deployment
 * / DaemonSet / pod page by name, or the Docker / Podman host's containers.
 * Null for a kind without a page (an operator's "Cluster", a ReplicaSet)
 * or when the parent or the name is unknown.
 */
export function getDatabaseWorkloadRoute(
  source: DatabaseRunsOnSource | null | undefined,
): Route | null {
  if (!source) {
    return null;
  }
  const platform: DatabaseRuntimePlatform | null =
    getDatabaseRuntimePlatform(source);
  if (!platform) {
    return null;
  }
  const parentId: ObjectID | null = parentIdOf(source, platform);
  if (!parentId) {
    return null;
  }

  if (platform === DatabaseRuntimePlatform.Kubernetes) {
    const name: string = (source.workloadName || "").trim();
    const page: PageMap | undefined =
      KUBERNETES_WORKLOAD_PAGES[
        (source.workloadKind || "").trim().toLowerCase()
      ];
    if (!name || !page) {
      return null;
    }
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: parentId,
      subModelId: name,
    });
  }

  const containersPage: PageMap | undefined = CONTAINER_LIST_PAGES[platform];
  return containersPage
    ? RouteUtil.populateRouteParams(RouteMap[containersPage] as Route, {
        modelId: parentId,
      })
    : null;
}

export interface ComponentProps {
  source: DatabaseRunsOnSource;
  className?: string | undefined;
}

/** "Kubernetes · prod-eu", linked to the cluster; "—" off-platform. */
export const DatabaseRunsOnLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const label: string = getDatabaseRunsOnLabel(props.source);
  if (label === "—") {
    return <span className="text-sm text-gray-400">—</span>;
  }
  const route: Route | null = getDatabaseRunsOnRoute(props.source);
  if (!route) {
    return (
      <span className={props.className || "text-sm text-gray-700"}>
        {label}
      </span>
    );
  }
  return (
    <AppLink
      to={route}
      className={`${props.className || "text-sm text-gray-700"} hover:underline`}
    >
      {label}
    </AppLink>
  );
};

/** The workload label ("payments/StatefulSet/postgres"), linked when it can be. */
export const DatabaseWorkloadLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const label: string = getDatabaseWorkloadLabel(props.source);
  if (!label) {
    return <span className={props.className}>—</span>;
  }
  const route: Route | null = getDatabaseWorkloadRoute(props.source);
  if (!route) {
    return <span className={props.className}>{label}</span>;
  }
  return (
    <AppLink to={route} className={`${props.className || ""} hover:underline`}>
      {label}
    </AppLink>
  );
};

export default DatabaseRunsOnLink;
