/*
 * THE METRICS ONEUPTIME WRITES FROM A CLUSTER'S COST ALLOCATIONS (#9548).
 *
 * The cost agent ships pre-priced allocation rows, one per container and
 * window (an hour by default), to /kubernetes-cost/ingest. They feed the
 * cluster's Costs pages, but rows in their own table cannot be charted in
 * the Metrics explorer, put on a dashboard or alerted on. And the metrics
 * the agent's collector scrapes from OpenCost are no help there: they are
 * prices per node and allocations in cores and bytes, so "what did this
 * namespace cost" needs a join across them that no chart or monitor can
 * write.
 *
 * So the ingest writes four metrics from every window it stores, priced and
 * named for what they are:
 *
 *   oneuptime.kubernetes.cost.total       what the cluster cost in the
 *                                         window, idle capacity included
 *   oneuptime.kubernetes.cost.idle        the part of it no workload used:
 *                                         idle and unallocated capacity
 *   oneuptime.kubernetes.cost.workload    what each workload cost; its sum
 *                                         over a namespace is the
 *                                         namespace's cost
 *   oneuptime.kubernetes.cost.efficiency  how much of what each workload
 *                                         reserves it used, cost-weighted
 *
 * The three costs are Delta Sums in the payload's currency (USD unless the
 * agent says otherwise), one point per window stamped at the window's start,
 * so a day's cost is the sum of that day's points whatever the window length.
 * Efficiency is a Gauge, in percent (above 100 when use exceeds requests).
 *
 * They carry the attributes the agent's own Kubernetes metrics do, with the
 * `resource.` prefix ingest gives a resource attribute: the cluster
 * (resource.k8s.cluster.name), the namespace (resource.k8s.namespace.name)
 * and the workload's name under its kind (resource.k8s.deployment.name,
 * resource.k8s.statefulset.name, ...), so a Kubernetes monitor's cluster,
 * namespace and workload scopes, and the cluster's Metrics page, find them
 * as they find every other cluster metric.
 *
 * The names are OneUptime's: OTLP ingest drops a sent metric under the
 * prefix, a recording rule cannot write one, and billing leaves them out,
 * because they are worked out from what the cluster already sent.
 *
 * Isomorphic: the telemetry worker writes them, the dashboard's monitor
 * catalog and the docs read the names.
 */

export const KUBERNETES_COST_METRIC_NAME_PREFIX: string =
  "oneuptime.kubernetes.cost.";

export enum KubernetesCostMetric {
  Total = "oneuptime.kubernetes.cost.total",
  Idle = "oneuptime.kubernetes.cost.idle",
  Workload = "oneuptime.kubernetes.cost.workload",
  Efficiency = "oneuptime.kubernetes.cost.efficiency",
}

// Every cost metric, in the order the catalog and the docs list them.
export const KUBERNETES_COST_METRICS: ReadonlyArray<KubernetesCostMetric> = [
  KubernetesCostMetric.Total,
  KubernetesCostMetric.Idle,
  KubernetesCostMetric.Workload,
  KubernetesCostMetric.Efficiency,
];

// The three that are money; efficiency is a ratio.
export const KUBERNETES_COST_MONEY_METRICS: ReadonlyArray<KubernetesCostMetric> =
  [
    KubernetesCostMetric.Total,
    KubernetesCostMetric.Idle,
    KubernetesCostMetric.Workload,
  ];

// The currency a cost is written in when the agent names none.
export const KUBERNETES_COST_DEFAULT_CURRENCY: string = "USD";

// An ISO 4217 code, as the agent's cost.agent.currency should be.
const CURRENCY_CODE: RegExp = /^[A-Z]{3}$/;

/*
 * Efficiency is written in percent, as the Costs pages show it. A 0-1 ratio
 * in UCUM's "1" is drawn as a percentage only on a metric whose name ends in
 * .ratio or .utilization (ValueFormatter.isFractionMetric), and a monitor's
 * threshold would have to be typed as 0.3 for 30% - so it is 30 here.
 */
export const KUBERNETES_COST_EFFICIENCY_UNIT: string = "%";

/*
 * The attributes the points carry, as they are stored: resource attributes,
 * so with the `resource.` prefix OTLP ingest gives them.
 */
export const KUBERNETES_COST_CLUSTER_ATTRIBUTE: string =
  "resource.k8s.cluster.name";
export const KUBERNETES_COST_NAMESPACE_ATTRIBUTE: string =
  "resource.k8s.namespace.name";
export const KUBERNETES_COST_POD_ATTRIBUTE: string = "resource.k8s.pod.name";

/*
 * The engine's names for capacity that is no workload's, in the namespace
 * column of an allocation row (the cost agent's AllocationMapper puts them
 * there). Their spend is idle spend, never a workload's.
 */
export const KUBERNETES_COST_IDLE_NAMESPACE: string = "__idle__";
export const KUBERNETES_COST_UNALLOCATED_NAMESPACE: string = "__unallocated__";

export function isKubernetesCostSentinelNamespace(
  namespace: string | null | undefined,
): boolean {
  return (
    namespace === KUBERNETES_COST_IDLE_NAMESPACE ||
    namespace === KUBERNETES_COST_UNALLOCATED_NAMESPACE
  );
}

/*
 * Whether a metric name is in OneUptime's Kubernetes cost namespace.
 * Case-insensitive, because OTLP ingest lowercases names before it stores
 * them: a name that differed only in case would land on the same series.
 */
export function isKubernetesCostMetricName(
  name: string | null | undefined,
): boolean {
  return (
    typeof name === "string" &&
    name.trim().toLowerCase().startsWith(KUBERNETES_COST_METRIC_NAME_PREFIX)
  );
}

export function isKubernetesCostMoneyMetric(
  metric: KubernetesCostMetric,
): boolean {
  return KUBERNETES_COST_MONEY_METRICS.includes(metric);
}

/*
 * The unit a metric's catalog entry and points are written in: the
 * payload's currency for the costs, upper-cased (USD when it names none),
 * and the dimensionless unit for efficiency.
 */
export function getKubernetesCostMetricUnit(data: {
  metric: KubernetesCostMetric;
  currency?: string | null | undefined;
}): string {
  if (!isKubernetesCostMoneyMetric(data.metric)) {
    return KUBERNETES_COST_EFFICIENCY_UNIT;
  }

  const currency: string = (data.currency || "").trim().toUpperCase();

  return CURRENCY_CODE.test(currency)
    ? currency
    : KUBERNETES_COST_DEFAULT_CURRENCY;
}

const KUBERNETES_COST_METRIC_DESCRIPTIONS: Readonly<
  Record<KubernetesCostMetric, string>
> = {
  [KubernetesCostMetric.Total]:
    "What the Kubernetes cluster cost in each allocation window (an hour by default), idle capacity included, as its cost engine priced it. Sum it over a day for the day's cost.",
  [KubernetesCostMetric.Idle]:
    "The part of the cluster's cost in each window that no workload used: node capacity nothing requested or used, and cost the engine could not allocate. Divide by oneuptime.kubernetes.cost.total for the idle share.",
  [KubernetesCostMetric.Workload]:
    "What each workload (a Deployment, StatefulSet, DaemonSet, Job and so on) cost in each window, by k8s.namespace.name and the workload's own name. Sum it by namespace for a namespace's cost.",
  [KubernetesCostMetric.Efficiency]:
    "How much of the CPU and memory each workload reserved it used in each window, weighted by what each part cost, in percent: 100 is all of it, above 100 more than it reserved.",
};

export function getKubernetesCostMetricDescription(
  metric: KubernetesCostMetric,
): string {
  return KUBERNETES_COST_METRIC_DESCRIPTIONS[metric];
}

/*
 * The attribute a workload's name is written under: its kind's own, as the
 * agent's metrics write it (k8s.deployment.name for a Deployment's pods), so
 * a Kubernetes monitor's Workload scope matches it. Letters only, because
 * the kind becomes part of an attribute key; null for no kind.
 */
export function getKubernetesCostWorkloadAttribute(
  controllerKind: string | null | undefined,
): string | null {
  const kind: string = (controllerKind || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  if (!kind) {
    return null;
  }

  return `resource.k8s.${kind}.name`;
}

// One stored allocation row, as much of it as the metrics read.
export interface KubernetesCostMetricSourceRow {
  windowStart: Date;
  windowEnd: Date;
  namespace: string;
  controllerKind: string;
  controllerName: string;
  podName: string;
  totalCost: number;
  cpuCost: number;
  ramCost: number;
  totalEfficiency: number;
}

export interface KubernetesCostMetricPoint {
  metric: KubernetesCostMetric;
  windowStart: Date;
  windowEnd: Date;
  // As stored: resource attributes with their `resource.` prefix.
  attributes: Record<string, string>;
  value: number;
}

interface WorkloadTotals {
  attributes: Record<string, string>;
  cost: number;
  // Σ efficiency × weight and Σ weight, for the cost-weighted efficiency.
  weightedEfficiency: number;
  weight: number;
}

interface WindowTotals {
  windowStart: Date;
  windowEnd: Date;
  total: number;
  idle: number;
  workloads: Map<string, WorkloadTotals>;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/*
 * The attributes that tell one workload's points from another's, or null
 * for a row that names nothing to attribute its cost to.
 *
 *   - A row of a controller: its namespace and its name under its kind.
 *   - A pod no controller owns: its namespace and the pod's name.
 *   - A row with a namespace and nothing else (a volume no pod mounts, a
 *     load balancer): its namespace alone, so the namespace's sum still
 *     adds up to what the Costs page shows for it.
 */
function workloadAttributes(data: {
  clusterName: string;
  row: KubernetesCostMetricSourceRow;
}): Record<string, string> | null {
  const namespace: string = (data.row.namespace || "").trim();
  const controllerName: string = (data.row.controllerName || "").trim();
  const podName: string = (data.row.podName || "").trim();

  if (!namespace && !controllerName && !podName) {
    return null;
  }

  const attributes: Record<string, string> = {
    [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: data.clusterName,
  };

  if (namespace) {
    attributes[KUBERNETES_COST_NAMESPACE_ATTRIBUTE] = namespace;
  }

  const kindAttribute: string | null = getKubernetesCostWorkloadAttribute(
    data.row.controllerKind,
  );

  if (controllerName && kindAttribute) {
    attributes[kindAttribute] = controllerName;
  } else if (podName) {
    attributes[KUBERNETES_COST_POD_ATTRIBUTE] = podName;
  }

  return attributes;
}

/*
 * The points one batch of a cluster's allocation rows makes: per window, the
 * cluster's total and idle cost, and each workload's cost and efficiency.
 *
 * A window wider than the agent's batch size arrives in several batches, and
 * each makes its own points for the window. That adds up: the costs are
 * Delta Sums, so the batches' points of one window sum to the window's cost,
 * as a chart or a monitor that sums them reads it. (A batch with no idle row
 * writes an idle point of 0, which adds nothing.) Efficiency is averaged
 * within a batch; across batches of one window a monitor averages averages,
 * which is close but not exact - and a workload's rows are rarely split.
 */
export function buildKubernetesCostMetricPoints(data: {
  clusterName: string;
  rows: ReadonlyArray<KubernetesCostMetricSourceRow>;
}): Array<KubernetesCostMetricPoint> {
  const windows: Map<string, WindowTotals> = new Map<string, WindowTotals>();

  for (const row of data.rows) {
    const startMs: number = row.windowStart.getTime();
    const endMs: number = row.windowEnd.getTime();

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      continue;
    }

    const windowKey: string = `${startMs}:${endMs}`;
    let window: WindowTotals | undefined = windows.get(windowKey);

    if (!window) {
      window = {
        windowStart: new Date(startMs),
        windowEnd: new Date(endMs),
        total: 0,
        idle: 0,
        workloads: new Map<string, WorkloadTotals>(),
      };
      windows.set(windowKey, window);
    }

    const cost: number = finite(row.totalCost);
    window.total += cost;

    if (isKubernetesCostSentinelNamespace(row.namespace)) {
      window.idle += cost;
      continue;
    }

    const attributes: Record<string, string> | null = workloadAttributes({
      clusterName: data.clusterName,
      row: row,
    });

    if (!attributes) {
      continue;
    }

    const workloadKey: string = JSON.stringify(
      Object.keys(attributes)
        .sort()
        .map((key: string): [string, string] => {
          return [key, attributes[key] as string];
        }),
    );

    let workload: WorkloadTotals | undefined =
      window.workloads.get(workloadKey);

    if (!workload) {
      workload = {
        attributes: attributes,
        cost: 0,
        weightedEfficiency: 0,
        weight: 0,
      };
      window.workloads.set(workloadKey, workload);
    }

    workload.cost += cost;

    /*
     * Efficiency is about CPU and memory, so each row counts by what its CPU
     * and memory cost: a sidecar that reserves little cannot drag a large
     * container's figure down to its own.
     */
    const weight: number =
      Math.max(0, finite(row.cpuCost)) + Math.max(0, finite(row.ramCost));
    const efficiency: number = row.totalEfficiency;

    if (weight > 0 && Number.isFinite(efficiency)) {
      workload.weightedEfficiency += efficiency * weight;
      workload.weight += weight;
    }
  }

  const points: Array<KubernetesCostMetricPoint> = [];
  const clusterAttributes: Record<string, string> = {
    [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: data.clusterName,
  };

  const sortedWindows: Array<WindowTotals> = Array.from(windows.values()).sort(
    (a: WindowTotals, b: WindowTotals): number => {
      return a.windowStart.getTime() - b.windowStart.getTime();
    },
  );

  for (const window of sortedWindows) {
    points.push({
      metric: KubernetesCostMetric.Total,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      attributes: { ...clusterAttributes },
      value: window.total,
    });

    points.push({
      metric: KubernetesCostMetric.Idle,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      attributes: { ...clusterAttributes },
      value: window.idle,
    });

    for (const workload of window.workloads.values()) {
      points.push({
        metric: KubernetesCostMetric.Workload,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        attributes: { ...workload.attributes },
        value: workload.cost,
      });

      if (workload.weight > 0) {
        points.push({
          metric: KubernetesCostMetric.Efficiency,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          attributes: { ...workload.attributes },
          value: (workload.weightedEfficiency / workload.weight) * 100,
        });
      }
    }
  }

  return points;
}
