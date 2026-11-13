import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import { translationKey } from "Common/Types/Translator";

/*
 * Shared presentation metadata for the topology views: raw enum values
 * ("k8s.pod", "runs-on") never reach the user — every type and
 * relationship gets a plain-language label, and every type a color so the
 * graph reads by shape and hue instead of by reading raw strings.
 */

export interface EntityTypeMeta {
  label: string;
  /** Border / accent color for nodes of this type. */
  color: string;
}

const DEFAULT_META: EntityTypeMeta = { label: "Other", color: "#64748b" };

const META_BY_TYPE: Record<EntityType, EntityTypeMeta> = {
  [EntityType.Service]: { label: "Service", color: "#6366f1" },
  [EntityType.ServiceInstance]: { label: "Service Instance", color: "#818cf8" },
  [EntityType.Host]: { label: "Host", color: "#475569" },
  [EntityType.Container]: { label: "Container", color: "#0891b2" },
  [EntityType.Process]: { label: "Process", color: "#64748b" },
  [EntityType.KubernetesCluster]: { label: "K8s Cluster", color: "#2563eb" },
  [EntityType.KubernetesNamespace]: {
    label: "K8s Namespace",
    color: "#3b82f6",
  },
  [EntityType.KubernetesNode]: { label: "K8s Node", color: "#1d4ed8" },
  [EntityType.KubernetesPod]: { label: "K8s Pod", color: "#60a5fa" },
  [EntityType.KubernetesDeployment]: {
    label: "K8s Deployment",
    color: "#3b82f6",
  },
  [EntityType.ProxmoxCluster]: { label: "Proxmox Cluster", color: "#ea580c" },
  [EntityType.ProxmoxNode]: { label: "Proxmox Node", color: "#f97316" },
  [EntityType.ProxmoxGuest]: { label: "Proxmox Guest", color: "#fb923c" },
  [EntityType.OpenStackCloud]: { label: "OpenStack Cloud", color: "#dc2626" },
  [EntityType.OpenStackHypervisor]: {
    label: "OpenStack Hypervisor",
    color: "#ef4444",
  },
  [EntityType.OpenStackInstance]: {
    label: "OpenStack Instance",
    color: "#f87171",
  },
  /*
   * VMware family in sky blues — distinct from the Kubernetes royal blues and
   * the Proxmox oranges next to it.
   */
  [EntityType.VMwareVCenter]: { label: "vCenter", color: "#0369a1" },
  [EntityType.VMwareCluster]: { label: "vSphere Cluster", color: "#0284c7" },
  [EntityType.VMwareHost]: { label: "ESXi Host", color: "#0ea5e9" },
  [EntityType.VMwareVirtualMachine]: {
    label: "VMware VM",
    color: "#38bdf8",
  },
  [EntityType.VMwareDatastore]: {
    label: "VMware Datastore",
    color: "#7dd3fc",
  },
  [EntityType.CephCluster]: { label: "Ceph Cluster", color: "#dc2626" },
  [EntityType.StorageArray]: { label: "Storage Array", color: "#ea580c" },
  [EntityType.DockerSwarmCluster]: {
    label: "Swarm Cluster",
    color: "#0e7490",
  },
  [EntityType.DockerSwarmNode]: { label: "Swarm Node", color: "#0891b2" },
  [EntityType.DockerSwarmService]: {
    label: "Swarm Service",
    color: "#06b6d4",
  },
  [EntityType.DockerSwarmTask]: { label: "Swarm Task", color: "#22d3ee" },
  [EntityType.TelemetrySdk]: { label: "Telemetry SDK", color: "#94a3b8" },
  /*
   * Dependencies discovered from client spans: a database in violet, a remote
   * endpoint in slate-teal — both clearly "not one of your services".
   */
  [EntityType.Database]: { label: "Database", color: "#7c3aed" },
  [EntityType.RemoteService]: { label: "Remote Service", color: "#0f766e" },
  /*
   * Membership-only (never a registry row, so never a graph node in
   * practice); listed so the Record stays total and a stray key still reads
   * as part of the database family.
   */
  [EntityType.DatabaseServer]: {
    label: "Database Endpoint",
    color: "#8b5cf6",
  },
  /*
   * Membership-only as well (the Queues product's key); a darker teal than
   * the Remote Service a queue's broker becomes on the service map.
   */
  [EntityType.MessageQueue]: { label: "Message Queue", color: "#115e59" },
  // Membership-only too: what an OpenStack trace says it touched.
  [EntityType.OpenStackResource]: {
    label: "OpenStack Resource",
    color: "#7c2d12",
  },
  /*
   * Inventory-mirrored types. Greens, to read as one family distinct from the
   * telemetry-derived types above — on the graph these are things OneUptime
   * polls rather than things that report in.
   */
  [EntityType.NetworkDevice]: { label: "Network Device", color: "#059669" },
  [EntityType.CloudResource]: { label: "Cloud Resource", color: "#10b981" },
  [EntityType.ServerlessFunction]: {
    label: "Serverless Function",
    color: "#34d399",
  },
  [EntityType.RumApplication]: { label: "RUM Application", color: "#14b8a6" },
  [EntityType.IoTDevice]: { label: "IoT Device", color: "#047857" },
  [EntityType.DockerHost]: { label: "Docker Host", color: "#0d9488" },
  [EntityType.PodmanHost]: { label: "Podman Host", color: "#0f766e" },
  /*
   * Manual types. Amber, deliberately unlike everything else: these are the
   * parts of the graph OneUptime cannot see for itself and is taking a
   * human's word for.
   */
  [EntityType.ExternalService]: {
    label: "External Service",
    color: "#d97706",
  },
  [EntityType.ExternalDatabase]: {
    label: "External Database",
    color: "#b45309",
  },
  [EntityType.Appliance]: { label: "Appliance", color: "#f59e0b" },
};

export function metaForEntityType(
  entityType: EntityType | string | undefined,
): EntityTypeMeta {
  if (!entityType) {
    return DEFAULT_META;
  }
  return META_BY_TYPE[entityType as EntityType] || DEFAULT_META;
}

/*
 * A relationship as one sentence naming both ends, read the way the stored
 * edge points: {{from}} is its source, {{to}} its target, whichever of them
 * the drawer is about. The drawer used to glue "{{from}} " + t(verb) + "
 * {{to}}" together: English word order in every language, and only "runs
 * on" and "depends on" were keys at all, so "member of", "hosted on",
 * "part of" and "instance of" read in English everywhere (#7326). Each
 * sentence is a key of its own, which a language words with both ends
 * where its grammar puts them.
 */
export const RELATIONSHIP_SENTENCES: Readonly<
  Record<EntityRelationshipType, string>
> = {
  [EntityRelationshipType.RunsOn]: translationKey("{{from}} runs on {{to}}"),
  [EntityRelationshipType.MemberOf]: translationKey(
    "{{from}} is a member of {{to}}",
  ),
  [EntityRelationshipType.HostedOn]: translationKey(
    "{{from}} is hosted on {{to}}",
  ),
  [EntityRelationshipType.PartOf]: translationKey("{{from}} is part of {{to}}"),
  [EntityRelationshipType.InstanceOf]: translationKey(
    "{{from}} is an instance of {{to}}",
  ),
  [EntityRelationshipType.DependsOn]: translationKey(
    "{{from}} depends on {{to}}",
  ),
};

// An edge with no type.
export const RELATED_TO_RELATIONSHIP_SENTENCE: string = translationKey(
  "{{from}} is related to {{to}}",
);

// A type's hyphens, and braces that could be read as a placeholder.
const RELATIONSHIP_HYPHENS: RegExp = /-/g;
const RELATIONSHIP_BRACES: RegExp = /[{}]/g;

/**
 * The sentence for an edge, with {{from}} and {{to}} for its two ends. A type
 * this Dashboard does not know (a newer server's) reads as its raw words
 * between the two ends: no key, so English, and never the hyphenated value.
 */
export function sentenceForRelationship(
  relationshipType: EntityRelationshipType | string | undefined,
): string {
  if (!relationshipType) {
    return RELATED_TO_RELATIONSHIP_SENTENCE;
  }
  const known: string | undefined =
    RELATIONSHIP_SENTENCES[relationshipType as EntityRelationshipType];
  if (known) {
    return known;
  }
  const words: string = String(relationshipType)
    .replace(RELATIONSHIP_HYPHENS, " ")
    .replace(RELATIONSHIP_BRACES, "")
    .trim();
  return words ? `{{from}} ${words} {{to}}` : RELATED_TO_RELATIONSHIP_SENTENCE;
}

/*
 * Traffic-health thresholds shared by edges and service nodes: an error rate
 * at or below the tolerated rate is healthy, under 5% is degraded, 5%+ is
 * critical. A single trace tolerates nothing (one failed call in it matters);
 * a project-wide window tolerates SERVICE_MAP_TOLERATED_ERROR_RATE, because at
 * volume nearly every busy connection has *some* errors and painting all of
 * them amber leaves nothing that stands out.
 */
export type TrafficHealth = "healthy" | "degraded" | "critical" | "unknown";

export const SERVICE_MAP_TOLERATED_ERROR_RATE: number = 0.01;

export function healthForErrorRate(
  callCount: number | undefined,
  errorCount: number | undefined,
  toleratedErrorRate: number = 0,
): TrafficHealth {
  if (!callCount || callCount <= 0) {
    return "unknown";
  }
  const rate: number = (errorCount || 0) / callCount;
  if (rate <= toleratedErrorRate && rate < 0.05) {
    return "healthy";
  }
  if (rate < 0.05) {
    return "degraded";
  }
  return "critical";
}

export const HEALTH_COLORS: Record<TrafficHealth, string> = {
  healthy: "#16a34a",
  degraded: "#f59e0b",
  critical: "#dc2626",
  unknown: "#94a3b8",
};

/** "1.2k/min", "45/min", "0.4/min" — human call-rate over a window. */
export function formatCallRate(
  callCount: number,
  windowSeconds: number,
): string {
  if (windowSeconds <= 0) {
    return `${callCount} calls`;
  }
  const perMinute: number = (callCount / windowSeconds) * 60;
  if (perMinute >= 1000) {
    return `${(perMinute / 1000).toFixed(1)}k/min`;
  }
  if (perMinute >= 10) {
    return `${Math.round(perMinute)}/min`;
  }
  return `${perMinute.toFixed(1)}/min`;
}

export function formatErrorRate(
  callCount: number | undefined,
  errorCount: number | undefined,
): string {
  if (!callCount || callCount <= 0) {
    return "—";
  }
  const percent: number = ((errorCount || 0) / callCount) * 100;
  if (percent === 0) {
    return "0%";
  }
  if (percent < 0.1) {
    return "<0.1%";
  }
  return `${percent.toFixed(1)}%`;
}

/** Edge stroke width scaled by call volume (log so heavy edges stay sane). */
export function edgeWidthForCalls(callCount: number | undefined): number {
  if (!callCount || callCount <= 0) {
    return 1.5;
  }
  return Math.min(6, 1.5 + Math.log10(callCount + 1) * 1.2);
}

export function formatDurationMs(avgDurationMs: number | undefined): string {
  if (avgDurationMs === undefined || avgDurationMs === null) {
    return "—";
  }
  if (avgDurationMs >= 1000) {
    return `${(avgDurationMs / 1000).toFixed(2)}s`;
  }
  return `${Math.round(avgDurationMs)}ms`;
}
