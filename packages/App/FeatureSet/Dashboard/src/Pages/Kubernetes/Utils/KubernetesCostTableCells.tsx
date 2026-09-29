import React, { ReactElement } from "react";
import { formatCost, formatEfficiency } from "./KubernetesCostUtils";

/*
 * Shared cell renderers for the Kubernetes cost breakdown tables (project
 * Costs page and cluster Costs page), so both read as one table family:
 * money is tabular and right-weighted, the total column carries a share-of
 * -window bar, and efficiency is a threshold-colored pill.
 */

/** Secondary money cell — the per-component splits (cpu / memory / …). */
export function getCostElement(value: number): ReactElement {
  return (
    <span className="tabular-nums text-gray-600">{formatCost(value)}</span>
  );
}

/**
 * Primary money cell: the amount, its share of the whole window, and a bar
 * for that share — so the line items actually driving the bill are obvious
 * without reading every row.
 */
export function getTotalCostElement(
  value: number,
  windowTotal: number,
): ReactElement {
  const share: number =
    windowTotal > 0
      ? Math.min(100, Math.max(0, (value / windowTotal) * 100))
      : 0;

  return (
    <div className="w-32">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular-nums font-medium text-gray-900">
          {formatCost(value)}
        </span>
        <span className="tabular-nums text-xs text-gray-400">
          {windowTotal > 0
            ? `${share < 1 && share > 0 ? "<1" : Math.round(share)}%`
            : "-"}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100">
        <div
          className="h-1.5 rounded-full bg-indigo-500"
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}

/*
 * Request-vs-usage efficiency. Higher is better: a workload at 20% is
 * paying for five times the capacity it actually uses, so the pill goes
 * red as efficiency falls.
 */
export function getEfficiencyElement(efficiency: number | null): ReactElement {
  if (efficiency === null || !Number.isFinite(efficiency)) {
    return <span className="text-gray-400">-</span>;
  }

  const percent: number = efficiency * 100;
  const badgeClassName: string =
    percent >= 70
      ? "bg-green-50 text-green-700"
      : percent >= 40
        ? "bg-yellow-50 text-yellow-700"
        : "bg-red-50 text-red-700";

  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium tabular-nums ${badgeClassName}`}
    >
      {formatEfficiency(efficiency)}
    </span>
  );
}

/** Namespace pill — same treatment as the Kubernetes Events table. */
export function getNamespaceElement(namespace: string): ReactElement {
  if (!namespace) {
    return <span className="text-gray-400">-</span>;
  }

  return (
    <span className="inline-flex rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
      {namespace}
    </span>
  );
}

/** Controller kind pill (Deployment, StatefulSet, DaemonSet, …). */
export function getControllerKindElement(kind: string): ReactElement {
  if (!kind) {
    return <span className="text-gray-400">-</span>;
  }

  return (
    <span className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
      {kind}
    </span>
  );
}

function getInlineCodeElement(text: string): ReactElement {
  return (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-700">
      {text}
    </code>
  );
}

/*
 * Shown in place of an empty table. Cost is opt-in, so "no rows" almost
 * always means the agent was never told to ship it — say how to turn it
 * on rather than leaving an empty grid.
 */
export const noCostDataMessage: ReactElement = (
  <div className="mx-auto max-w-xl space-y-2">
    <div className="font-medium text-gray-700">
      No cost data reported for the selected time range.
    </div>
    <div>
      Cost data is shipped by the OneUptime Kubernetes agent — enable it with{" "}
      {getInlineCodeElement("cost.enabled=true")} in the kubernetes-agent Helm
      chart. That alone is a complete install; if you already run OpenCost or
      Kubecost, set {getInlineCodeElement("cost.engine.url")} to it instead.
    </div>
  </div>
);
