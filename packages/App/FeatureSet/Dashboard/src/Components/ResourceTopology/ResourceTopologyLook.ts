import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNode,
} from "./ResourceTopologyModel";
import {
  ResourceTopologyBranch,
  getBranchPath,
} from "./ResourceTopologyLayout";

/*
 * How health reads on a resource topology: one colour and one word per
 * state, the same on the map, in the list, in the legend and in the panel.
 * The colours are the master topology's (healthy green, degraded amber,
 * critical red), so a red part means the same thing on every map in the
 * product.
 *
 * The map is calm where everything is fine and loud where it is not: a
 * healthy part is a plain card with a green dot, a part that needs attention
 * is tinted amber and one that is critical red, and the lines that lead to
 * them take the same colour all the way from the resource.
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

/* Amber that reads as text on white and on the dark surfaces alike. */
export const RESOURCE_TOPOLOGY_ATTENTION_TEXT_COLOR: string = "#d97706";

/*
 * A card's surface for how it is doing: a trouble tint mixed into the
 * theme's own surface, so it reads in the light and in the dark.
 */
export interface ResourceTopologyTone {
  background: string;
  border: string;
  /* The edge at the start of the card; transparent when all is well. */
  edge: string;
}

export function getResourceTopologyTone(
  health: ResourceTopologyHealth,
): ResourceTopologyTone {
  if (health === "critical" || health === "warning") {
    const color: string = RESOURCE_TOPOLOGY_HEALTH_COLORS[health];

    return {
      background: `color-mix(in srgb, ${color} 7%, var(--ou-surface-primary, #ffffff))`,
      border: `color-mix(in srgb, ${color} 45%, var(--ou-border-default, #e5e7eb))`,
      edge: color,
    };
  }

  return {
    background: "var(--ou-surface-primary, #ffffff)",
    border: "var(--ou-border-default, #e5e7eb)",
    edge: "transparent",
  };
}

/*
 * The line from a part to what it holds: grey when all is well that way,
 * amber when a part that needs attention is, red when a critical one is.
 */
export type ResourceTopologyBranchTone = "critical" | "warning" | "calm";

export const RESOURCE_TOPOLOGY_BRANCH_COLORS: Record<
  ResourceTopologyBranchTone,
  string
> = {
  critical: RESOURCE_TOPOLOGY_HEALTH_COLORS.critical,
  warning: RESOURCE_TOPOLOGY_HEALTH_COLORS.warning,
  calm: "var(--ou-border-strong, #cbd5e1)",
};

/* The worst a line leads to: the parts it reaches and everything in them. */
export function getBranchTone(
  graph: ResourceTopologyGraph,
  nodeIds: ReadonlyArray<string>,
): ResourceTopologyBranchTone {
  let tone: ResourceTopologyBranchTone = "calm";

  for (const id of nodeIds) {
    const node: ResourceTopologyNode | undefined = graph.nodes.get(id);

    if (!node) {
      continue;
    }

    if (node.effectiveHealth === "critical" || node.criticalBelow > 0) {
      return "critical";
    }

    if (node.effectiveHealth === "warning" || node.attentionBelow > 0) {
      tone = "warning";
    }
  }

  return tone;
}

/* Drawn on top of the others: a red line over the grey one it shares a leg with. */
export const BRANCH_TONE_ORDER: Record<ResourceTopologyBranchTone, number> = {
  calm: 0,
  warning: 1,
  critical: 2,
};

/* A line from a part to what it holds, as the map draws it. */
export interface ResourceTopologyBranchLine {
  branch: ResourceTopologyBranch;
  /* Its SVG path, turns rounded. */
  path: string;
  tone: ResourceTopologyBranchTone;
  /* On the way from the resource to the part someone picked: indigo. */
  isOnPath: boolean;
}

/*
 * Every line from a part to what it holds, coloured by the worst it leads
 * to, in the order they are drawn: calm first, then amber, then red, so a
 * red line is drawn over the grey one it shares a leg with - and the picked
 * part's path over them all. Lines of one rank keep the layout's order.
 */
export function describeTopologyBranches(
  graph: ResourceTopologyGraph,
  branches: ReadonlyArray<ResourceTopologyBranch>,
  pathIds: ReadonlySet<string>,
): Array<ResourceTopologyBranchLine> {
  const lines: Array<{ line: ResourceTopologyBranchLine; index: number }> =
    branches.map((branch: ResourceTopologyBranch, index: number) => {
      return {
        line: {
          branch: branch,
          path: getBranchPath(branch.points),
          tone: getBranchTone(graph, branch.nodeIds),
          isOnPath:
            pathIds.has(branch.fromNodeId) &&
            branch.nodeIds.some((id: string): boolean => {
              return pathIds.has(id);
            }),
        },
        index: index,
      };
    });
  const rank: (line: ResourceTopologyBranchLine) => number = (
    line: ResourceTopologyBranchLine,
  ): number => {
    return line.isOnPath
      ? BRANCH_TONE_ORDER.critical + 1
      : BRANCH_TONE_ORDER[line.tone];
  };

  return lines
    .sort(
      (
        a: { line: ResourceTopologyBranchLine; index: number },
        b: { line: ResourceTopologyBranchLine; index: number },
      ): number => {
        return rank(a.line) - rank(b.line) || a.index - b.index;
      },
    )
    .map(
      (entry: {
        line: ResourceTopologyBranchLine;
        index: number;
      }): ResourceTopologyBranchLine => {
        return entry.line;
      },
    );
}

/* Below this zoom a card drops its smaller lines: they could not be read. */
export const RESOURCE_TOPOLOGY_DETAIL_ZOOM: number = 0.5;

/*
 * How much a card says at a zoom: everything near, only its name, its
 * colour and its issue counts far out, where its smaller lines would be
 * specks, so the shape of a large resource stays readable.
 */
export type ResourceTopologyDetailLevel = "near" | "far";

export function getResourceTopologyDetailLevel(
  zoom: number,
): ResourceTopologyDetailLevel {
  return zoom < RESOURCE_TOPOLOGY_DETAIL_ZOOM ? "far" : "near";
}

/*
 * The shares of a part's insides by how they are doing, worst first, for
 * the bar under what it holds. Health with nothing in it is left out.
 */
export interface ResourceTopologyHealthShare {
  health: ResourceTopologyHealth;
  count: number;
  share: number;
}

export function getHealthShares(
  counts: Record<ResourceTopologyHealth, number>,
): Array<ResourceTopologyHealthShare> {
  let total: number = 0;

  for (const health of RESOURCE_TOPOLOGY_LEGEND) {
    total += counts[health] || 0;
  }

  if (total === 0) {
    return [];
  }

  return RESOURCE_TOPOLOGY_LEGEND.filter(
    (health: ResourceTopologyHealth): boolean => {
      return (counts[health] || 0) > 0;
    },
  ).map((health: ResourceTopologyHealth): ResourceTopologyHealthShare => {
    return {
      health: health,
      count: counts[health],
      share: counts[health] / total,
    };
  });
}
