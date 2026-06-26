import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import {
  HoneycombLegendItem,
  HoneycombTile,
  HoneycombTileDetail,
} from "./DashboardResourceHoneycomb";
import Route from "Common/Types/API/Route";

export const READINESS_COLORS: {
  ready: string;
  notReady: string;
  unknown: string;
} = {
  ready: "#10b981",
  notReady: "#ef4444",
  unknown: "#9ca3af",
};

export const READINESS_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Ready", color: READINESS_COLORS.ready },
  { label: "Not Ready", color: READINESS_COLORS.notReady },
  { label: "Unknown", color: READINESS_COLORS.unknown },
];

export function readinessToColor(isReady: boolean | undefined): string {
  if (isReady === true) {
    return READINESS_COLORS.ready;
  }
  if (isReady === false) {
    return READINESS_COLORS.notReady;
  }
  return READINESS_COLORS.unknown;
}

export function readinessToStatus(isReady: boolean | undefined): string {
  if (isReady === true) {
    return "Ready";
  }
  if (isReady === false) {
    return "Not Ready";
  }
  return "Unknown";
}

export function buildReadinessTile(options: {
  resource: KubernetesResource;
  route?: Route | undefined;
  extraDetails?: Array<HoneycombTileDetail> | undefined;
}): HoneycombTile {
  const r: KubernetesResource = options.resource;
  const id: string = (r._id as string) || "";
  const name: string = (r.name as string) || "Unnamed";
  const namespace: string | undefined = r.namespaceKey as string | undefined;
  const clusterName: string = (r.kubernetesCluster?.name as string) || "—";
  const isReady: boolean | undefined = r.isReady as boolean | undefined;

  const details: Array<HoneycombTileDetail> = [];
  if (namespace) {
    details.push({ label: "Namespace", value: namespace });
  }
  details.push({ label: "Cluster", value: clusterName });
  if (options.extraDetails) {
    for (const d of options.extraDetails) {
      details.push(d);
    }
  }

  return {
    id: id || name,
    status: readinessToStatus(isReady),
    color: readinessToColor(isReady),
    route: options.route,
    tooltip: {
      title: name,
      details: details,
    },
  };
}
