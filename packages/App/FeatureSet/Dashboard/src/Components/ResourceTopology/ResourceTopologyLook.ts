import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourceTopologyHealth } from "./ResourceTopologyModel";

/*
 * How health reads on a resource topology: one colour and one word per
 * state, the same on the map, in the list, in the legend and in the panel.
 * The colours are the master topology's (healthy green, degraded amber,
 * critical red), so a red part means the same thing on every map in the
 * product.
 */

export const RESOURCE_TOPOLOGY_HEALTH_COLORS: Record<
  ResourceTopologyHealth,
  string
> = {
  critical: "#dc2626",
  warning: "#f59e0b",
  healthy: "#16a34a",
  off: "#94a3b8",
  unknown: "#cbd5e1",
};

export const RESOURCE_TOPOLOGY_HEALTH_LABELS: Record<
  ResourceTopologyHealth,
  string
> = {
  critical: translationKey("Critical"),
  warning: translationKey("Needs attention"),
  healthy: translationKey("Healthy"),
  off: translationKey("Off"),
  unknown: translationKey("No data"),
};

/* The legend, worst first. */
export const RESOURCE_TOPOLOGY_LEGEND: ReadonlyArray<ResourceTopologyHealth> = [
  "critical",
  "warning",
  "healthy",
  "off",
  "unknown",
];

export const RESOURCE_TOPOLOGY_SELECTED_COLOR: string = "#6366f1";
export const RESOURCE_TOPOLOGY_MATCH_COLOR: string = "#818cf8";
export const RESOURCE_TOPOLOGY_RELATION_COLOR: string = "#6366f1";
