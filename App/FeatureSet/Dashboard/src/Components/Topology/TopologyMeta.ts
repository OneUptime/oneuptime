import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";

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
  [EntityType.CephCluster]: { label: "Ceph Cluster", color: "#dc2626" },
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
};

export function metaForEntityType(
  entityType: EntityType | string | undefined,
): EntityTypeMeta {
  if (!entityType) {
    return DEFAULT_META;
  }
  return META_BY_TYPE[entityType as EntityType] || DEFAULT_META;
}

const RELATIONSHIP_LABELS: Record<EntityRelationshipType, string> = {
  [EntityRelationshipType.RunsOn]: "runs on",
  [EntityRelationshipType.MemberOf]: "member of",
  [EntityRelationshipType.HostedOn]: "hosted on",
  [EntityRelationshipType.PartOf]: "part of",
  [EntityRelationshipType.InstanceOf]: "instance of",
  [EntityRelationshipType.DependsOn]: "depends on",
};

export function labelForRelationship(
  relationshipType: EntityRelationshipType | string | undefined,
): string {
  if (!relationshipType) {
    return "related to";
  }
  return (
    RELATIONSHIP_LABELS[relationshipType as EntityRelationshipType] ||
    String(relationshipType)
  );
}

/*
 * Traffic-health thresholds shared by edges and service nodes: no errors
 * is healthy, under 5% is degraded, 5%+ is critical.
 */
export type TrafficHealth = "healthy" | "degraded" | "critical" | "unknown";

export function healthForErrorRate(
  callCount: number | undefined,
  errorCount: number | undefined,
): TrafficHealth {
  if (!callCount || callCount <= 0) {
    return "unknown";
  }
  const rate: number = (errorCount || 0) / callCount;
  if (rate <= 0) {
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

export function formatDurationMs(avgDurationMs: number | undefined): string {
  if (avgDurationMs === undefined || avgDurationMs === null) {
    return "—";
  }
  if (avgDurationMs >= 1000) {
    return `${(avgDurationMs / 1000).toFixed(2)}s`;
  }
  return `${Math.round(avgDurationMs)}ms`;
}
