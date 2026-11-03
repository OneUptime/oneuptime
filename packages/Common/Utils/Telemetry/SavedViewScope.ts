import ColumnLength from "../../Types/Database/ColumnLength";
import IsNull from "../../Types/BaseDatabase/IsNull";
import ObjectID from "../../Types/ObjectID";

/*
 * The page a saved log view belongs to (issue #5549).
 *
 * A saved view is offered only on the page it was saved on. A view made on
 * the Logs page stays on the Logs page; a view made on a Kubernetes cluster's
 * Logs tab stays on that cluster's Logs tab - not on the Logs page, and not
 * on another cluster's. Before views had a page, every page that shows logs
 * listed all of the project's views, the filters of one cluster's included.
 *
 * The Logs page is the explorer. Its views are stored with no scope, as is
 * every view saved before views had one, so none of them goes missing: they
 * stay where they were made or, for one saved on a resource's page back
 * then, on the Logs page, which still applies its filters. A resource's page
 * is named by its kind and the resource: "kubernetes-cluster:<cluster id>".
 *
 * A viewer that is given no scope offers no saved views at all: a panel about
 * one moment - an incident's, an alert's, a trace's - is not a page a view
 * could be made for.
 */

export enum SavedViewScopeKind {
  Service = "service",
  Host = "host",
  KubernetesCluster = "kubernetes-cluster",
  // A pod's, a container's and a workload's or node's Logs tab in a cluster.
  KubernetesPod = "kubernetes-pod",
  KubernetesContainer = "kubernetes-container",
  KubernetesWorkload = "kubernetes-workload",
  DockerHost = "docker-host",
  DockerContainer = "docker-container",
  DockerSwarmCluster = "docker-swarm-cluster",
  PodmanHost = "podman-host",
  PodmanContainer = "podman-container",
  ProxmoxCluster = "proxmox-cluster",
  CephCluster = "ceph-cluster",
  StorageArray = "storage-array",
  VMwareVCenter = "vmware-vcenter",
  VMwareHost = "vmware-host",
  DatabaseServer = "database-server",
  ServerlessFunction = "serverless-function",
  CloudResource = "cloud-resource",
  CloudApp = "cloud-app",
  RumApplication = "rum-application",
  IoTFleet = "iot-fleet",
  NetworkDevice = "network-device",
  InventoryItem = "inventory-item",
}

/*
 * The Logs page's own views. Never stored: they are the views with no scope
 * (getSavedViewScopeColumnValue).
 */
export const EXPLORER_SAVED_VIEW_SCOPE: string = "explorer";

// The `scope` column's length (LogSavedView).
export const SAVED_VIEW_SCOPE_MAX_LENGTH: number = ColumnLength.LongText;

const SCOPE_PART_SEPARATOR: string = ":";

/*
 * A resource page's scope: its kind, then each part that names the resource
 * - a cluster's id, or a cluster and a pod's namespace and name. Each part is
 * URI-encoded, so a part holding the separator cannot make two pages one. A
 * scope longer than the column keeps its first SAVED_VIEW_SCOPE_MAX_LENGTH
 * characters: two pages would share their views only when they agree on all
 * of those, and a view is organized by its page, not protected by it - every
 * view of a project is open to the project's telemetry readers either way.
 */
export function buildSavedViewScope(
  kind: SavedViewScopeKind,
  ...parts: Array<string | ObjectID>
): string {
  const scope: string = [
    kind,
    ...parts.map((part: string | ObjectID): string => {
      return encodeURIComponent(part.toString());
    }),
  ].join(SCOPE_PART_SEPARATOR);

  return scope.slice(0, SAVED_VIEW_SCOPE_MAX_LENGTH);
}

/*
 * A scope as the `scope` column holds it: the explorer's, and anything
 * blank, as no scope at all. The service writes every create through this,
 * so a view made through the API with "explorer" or "" lands on the Logs
 * page with the rest of its views rather than on a page nobody shows.
 */
export function getSavedViewScopeColumnValue(scope: unknown): string | null {
  if (typeof scope !== "string") {
    return null;
  }

  const trimmed: string = scope.trim();

  if (trimmed.length === 0 || trimmed === EXPLORER_SAVED_VIEW_SCOPE) {
    return null;
  }

  return trimmed;
}

// The condition on the `scope` column that lists one page's views.
export function getSavedViewScopeQueryValue(scope: string): string | IsNull {
  const columnValue: string | null = getSavedViewScopeColumnValue(scope);

  return columnValue === null ? new IsNull() : columnValue;
}
