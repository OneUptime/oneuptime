/*
 * WHETHER A RESOURCE IS A HOST'S OWN TELEMETRY (issue #11257).
 *
 * OneUptime registers a Host - a row under Infrastructure → Hosts, and a Host
 * item in Inventory - from what a machine's own collector sends about it: the
 * OpenTelemetry Collector's hostmetrics, journald, filelog or Windows event
 * log receivers, with the `host.name` and `os.type` its resourcedetection
 * processor sets, or OneUptime's Android Agent describing its device. Plenty
 * of other telemetry names a host in `host.name` and an OS in `os.type`, and
 * none of it describes a machine of its own:
 *
 *   - KUBERNETES. A pod's, a node's or a cluster's telemetry carries their
 *     identity (`k8s.*`). Kubernetes nodes and pods are under Kubernetes.
 *   - A CONTAINER ENGINE. The Docker and Podman agents stamp
 *     `container.runtime` on everything they send, with the machine's name in
 *     `host.name` (DOCKER_HOST_NAME). That machine is a Docker (Podman) host,
 *     under Infrastructure → Docker (Podman), and one Docker (Podman) host
 *     item in Inventory. It used to become a Host as well whenever its Docker
 *     host did not resolve in the same batch.
 *   - A CONTAINER. `container.id` is set by the OpenTelemetry SDKs' container
 *     detectors (Java, Node.js, .NET) and by docker_stats for each container.
 *     What runs in a container is no host; in Kubernetes its `host.name` is
 *     the pod's name, one per replica.
 *   - AN APPLICATION. Every OpenTelemetry SDK stamps `telemetry.sdk.name` and
 *     `telemetry.sdk.language` on its resource, and no collector receiver
 *     does. An application's resource describes the application: the
 *     `host.name` and `os.type` the SDKs' host and OS detectors set say where
 *     it runs - in a pod, the pod - and its `process.runtime.*` metrics are
 *     the runtime's, not a machine's. An app in a pod that exports straight
 *     to OneUptime carries no Kubernetes attribute at all, so before this it
 *     became a Host named after the pod, and one more with every rollout.
 *
 * Each case is read from the resource's attributes, never from its name: a
 * pod's name looks like any other host's.
 *
 * What still names a machine: an application's `host.name` is where it runs,
 * so its telemetry stays a member of the Host of that name, when the
 * machine's own collector registered one - a Host's Logs and Topology show
 * the apps on it. It just never registers the Host itself.
 *
 * Shared by the ingest's Host gate and its batch enrichment
 * (OtelIngestBaseService, OtelMetricsIngestService), the Inventory's
 * heuristic Host resolver (Server/Utils/Telemetry/TelemetryEntity) and the
 * Hosts dashboard's scope (Types/Dashboard/DashboardResourceScope), so a
 * resource is a Host's in all of them or in none.
 */

// Why a resource is not a host's own telemetry.
export enum NotAHostReason {
  Kubernetes = "Kubernetes",
  ContainerEngine = "ContainerEngine",
  Container = "Container",
  Application = "Application",
}

/*
 * A Kubernetes object's identity. UID-only pod / node resources count, since
 * their resolvers accept the UID when the name is absent; a cluster's UID does
 * not, as cluster identity is name-keyed throughout OneUptime. The same keys
 * the Inventory's Kubernetes resolvers read (TelemetryEntity).
 */
export const KUBERNETES_IDENTITY_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "k8s.cluster.name",
  "k8s.namespace.name",
  "k8s.node.name",
  "k8s.node.uid",
  "k8s.pod.name",
  "k8s.pod.uid",
  "k8s.deployment.name",
];

// Stamped by the Docker and Podman agents (and docker_stats) on everything.
export const CONTAINER_ENGINE_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "container.runtime",
];

// A container's own id: from inside it (SDK detectors) or about it.
export const CONTAINER_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "container.id",
];

// Required on every OpenTelemetry SDK's resource; no collector sets them.
export const APPLICATION_SDK_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "telemetry.sdk.name",
  "telemetry.sdk.language",
];

interface NotAHostAttributeGroup {
  reason: NotAHostReason;
  keys: ReadonlyArray<string>;
}

// In the order a reason is reported: the most specific owner first.
const NOT_A_HOST_ATTRIBUTE_GROUPS: ReadonlyArray<NotAHostAttributeGroup> = [
  {
    reason: NotAHostReason.Kubernetes,
    keys: KUBERNETES_IDENTITY_ATTRIBUTE_KEYS,
  },
  {
    reason: NotAHostReason.ContainerEngine,
    keys: CONTAINER_ENGINE_ATTRIBUTE_KEYS,
  },
  { reason: NotAHostReason.Container, keys: CONTAINER_ATTRIBUTE_KEYS },
  {
    reason: NotAHostReason.Application,
    keys: APPLICATION_SDK_ATTRIBUTE_KEYS,
  },
];

/*
 * Every resource attribute whose value means the resource is not a host's:
 * for a reader that keeps a host's telemetry apart from the rest by those
 * attributes, such as the Hosts dashboard (each stored as `resource.<key>`).
 */
export const NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS: ReadonlyArray<string> =
  NOT_A_HOST_ATTRIBUTE_GROUPS.reduce(
    (keys: Array<string>, group: NotAHostAttributeGroup): Array<string> => {
      return [...keys, ...group.keys];
    },
    [],
  );

/*
 * One resource attribute's value as text, or null when the resource has none.
 * Callers read their own shape (an OTLP attribute list, a flattened map).
 */
export type ReadResourceAttribute = (key: string) => string | null;

function hasValue(read: ReadResourceAttribute, key: string): boolean {
  const value: string | null = read(key);
  return typeof value === "string" && value.trim().length > 0;
}

/*
 * Why the resource read through `read` is not a host's own telemetry, or null
 * when nothing on it says so. Whether it IS a host's - it names one in
 * `host.name`, with an OS or host metrics - is the caller's to ask; this only
 * answers what rules it out.
 */
export function getNotAHostReason(
  read: ReadResourceAttribute,
): NotAHostReason | null {
  for (const group of NOT_A_HOST_ATTRIBUTE_GROUPS) {
    if (
      group.keys.some((key: string): boolean => {
        return hasValue(read, key);
      })
    ) {
      return group.reason;
    }
  }

  return null;
}

// The same, for a flattened attribute map (`{"host.name": "web-1", ...}`).
export function getNotAHostReasonOfAttributes(
  attributes: Record<string, unknown> | null | undefined,
): NotAHostReason | null {
  return getNotAHostReason((key: string): string | null => {
    const value: unknown = attributes ? attributes[key] : undefined;

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    return null;
  });
}
