import {
  KUBERNETES_COST_IDLE_NAMESPACE,
  KUBERNETES_COST_UNALLOCATED_NAMESPACE,
  isKubernetesCostSentinelNamespace,
} from "./KubernetesCostIngest";

/*
 * ONE KUBERNETES COST EFFICIENCY, WHEREVER IT IS SHOWN (#9635).
 *
 * Efficiency answers "how much of the CPU and memory we pay for gets used".
 * Each allocation row (a container's hour) carries the cost engine's own
 * answer for that row, totalEfficiency: OpenCost's cost-weighted average of
 * the row's CPU and RAM efficiency, (cpuEff x cpuCost + ramEff x ramCost) /
 * (cpuCost + ramCost). For a group of rows - a workload, a namespace, a
 * cluster, a day - the same definition gives
 *
 *   sum(totalEfficiency x weight) / sum(weight),  weight = cpuCost + ramCost
 *
 * which is exactly OpenCost's figure for the group taken as one allocation,
 * and so what OpenCost and Kubecost show for a namespace. Every row counts by
 * what its CPU and memory cost:
 *
 *   - not equally, as a plain average of the rows does: there a container
 *     that costs a cent and uses nothing pulls the figure down as much as
 *     the biggest spender, so the figure stops saying anything about money;
 *   - not by its total cost: storage, network and load balancers are in the
 *     total, and efficiency does not measure them.
 *
 * Idle and unallocated capacity is no workload's, so it has no efficiency:
 * its rows weigh nothing.
 *
 * Every row stores its weight and its weighted efficiency (the
 * KubernetesCostAllocation columns efficiencyWeight and weightedEfficiency),
 * so any page adds them up for any grouping with two sums and hands them to
 * getKubernetesCostEfficiency. The cluster overview's Cost card, the Costs
 * pages and the oneuptime.kubernetes.cost.efficiency metric all read
 * efficiency through this module, so they cannot disagree.
 */

// One allocation row, as much of it as efficiency reads.
export interface KubernetesCostEfficiencyRow {
  namespace?: string | null | undefined;
  cpuCost?: number | null | undefined;
  ramCost?: number | null | undefined;
  totalEfficiency?: number | null | undefined;
}

// The two sums a group's efficiency is worked out from.
export interface KubernetesCostEfficiencySums {
  // Sum of each row's efficiency times its weight.
  weightedEfficiency: number;
  // Sum of the rows' weights: what their CPU and memory cost.
  weight: number;
}

function nonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/*
 * What a row's efficiency counts for: what its CPU and memory cost. A
 * negative cost (an engine's reconciliation can take a component below
 * zero) counts as nothing rather than against the others, and idle or
 * unallocated capacity counts for nothing at all.
 */
export function getKubernetesCostEfficiencyWeight(
  row: KubernetesCostEfficiencyRow,
): number {
  if (isKubernetesCostSentinelNamespace(row.namespace)) {
    return 0;
  }

  return nonNegative(row.cpuCost) + nonNegative(row.ramCost);
}

// A row's efficiency times its weight: what it adds to its group's sum.
export function getKubernetesCostWeightedEfficiency(
  row: KubernetesCostEfficiencyRow,
): number {
  const weight: number = getKubernetesCostEfficiencyWeight(row);
  const efficiency: number | null | undefined = row.totalEfficiency;

  if (
    weight <= 0 ||
    typeof efficiency !== "number" ||
    !Number.isFinite(efficiency)
  ) {
    return 0;
  }

  return efficiency * weight;
}

/*
 * A group's efficiency from its two sums, 0-1 and above (above 1 when the
 * group used more than it requested), or null when nothing in it cost
 * anything to weigh by - an idle-only range, or no rows at all.
 */
export function getKubernetesCostEfficiency(
  sums: KubernetesCostEfficiencySums,
): number | null {
  const weight: number = Number(sums.weight);
  const weightedEfficiency: number = Number(sums.weightedEfficiency);

  if (
    !Number.isFinite(weight) ||
    !Number.isFinite(weightedEfficiency) ||
    weight <= 0
  ) {
    return null;
  }

  return weightedEfficiency / weight;
}

// Adds one row to a group's sums, in place; returns them for chaining.
export function addToKubernetesCostEfficiencySums(
  sums: KubernetesCostEfficiencySums,
  row: KubernetesCostEfficiencyRow,
): KubernetesCostEfficiencySums {
  sums.weight += getKubernetesCostEfficiencyWeight(row);
  sums.weightedEfficiency += getKubernetesCostWeightedEfficiency(row);
  return sums;
}

/*
 * The same two values in ClickHouse, as the DEFAULT expressions of the
 * columns that store them: what a row stored before the columns existed
 * reads. ADD COLUMN rewrites no part, and ClickHouse works the expression out
 * from the row's own namespace, costs and efficiency when it reads a part
 * with no file for the column, so every row ever stored weighs the same way
 * with no backfill. Ingest writes the values for new rows with the functions
 * above; KubernetesCostEfficiency.test.ts holds the two spellings to each
 * other.
 *
 * greatest(x, 0) is nonNegative() (costs are stored finite: ingest writes 0
 * for anything else).
 */
const SENTINEL_NAMESPACES_SQL: string = `('${KUBERNETES_COST_IDLE_NAMESPACE}', '${KUBERNETES_COST_UNALLOCATED_NAMESPACE}')`;

const WEIGHT_SQL: string = "(greatest(cpuCost, 0) + greatest(ramCost, 0))";

export const KUBERNETES_COST_EFFICIENCY_WEIGHT_DEFAULT_EXPRESSION: string = `if(namespace IN ${SENTINEL_NAMESPACES_SQL}, 0, ${WEIGHT_SQL})`;

export const KUBERNETES_COST_WEIGHTED_EFFICIENCY_DEFAULT_EXPRESSION: string = `if(namespace IN ${SENTINEL_NAMESPACES_SQL}, 0, totalEfficiency * ${WEIGHT_SQL})`;
