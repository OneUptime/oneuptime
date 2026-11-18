import {
  KUBERNETES_COST_CLUSTER_ATTRIBUTE,
  KUBERNETES_COST_DEFAULT_CURRENCY,
  KUBERNETES_COST_EFFICIENCY_UNIT,
  KUBERNETES_COST_METRICS,
  KUBERNETES_COST_METRIC_NAME_PREFIX,
  KUBERNETES_COST_MONEY_METRICS,
  KUBERNETES_COST_NAMESPACE_ATTRIBUTE,
  KUBERNETES_COST_POD_ATTRIBUTE,
  KubernetesCostMetric,
  KubernetesCostMetricPoint,
  KubernetesCostMetricSourceRow,
  buildKubernetesCostMetricPoints,
  getKubernetesCostMetricDescription,
  getKubernetesCostMetricUnit,
  getKubernetesCostWorkloadAttribute,
  isKubernetesCostMetricName,
  isKubernetesCostMoneyMetric,
  isKubernetesCostSentinelNamespace,
} from "../../../Types/Kubernetes/KubernetesCostMetrics";
import { describe, expect, test } from "@jest/globals";

/*
 * The metrics the cost ingest writes from a cluster's allocation rows
 * (#9548), so cost can be charted and alerted on like any other metric.
 */

const WINDOW_START: Date = new Date("2026-11-18T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-18T11:00:00.000Z");
const NEXT_START: Date = new Date("2026-11-18T11:00:00.000Z");
const NEXT_END: Date = new Date("2026-11-18T12:00:00.000Z");

function row(
  overrides: Partial<KubernetesCostMetricSourceRow> = {},
): KubernetesCostMetricSourceRow {
  return {
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    namespace: "shop",
    controllerKind: "deployment",
    controllerName: "checkout",
    podName: "checkout-7d9f-2xk",
    totalCost: 1,
    cpuCost: 0.6,
    ramCost: 0.3,
    totalEfficiency: 0.5,
    ...overrides,
  };
}

function pointsOf(
  points: Array<KubernetesCostMetricPoint>,
  metric: KubernetesCostMetric,
): Array<KubernetesCostMetricPoint> {
  return points.filter((point: KubernetesCostMetricPoint): boolean => {
    return point.metric === metric;
  });
}

function build(
  rows: Array<KubernetesCostMetricSourceRow>,
): Array<KubernetesCostMetricPoint> {
  return buildKubernetesCostMetricPoints({ clusterName: "prod", rows: rows });
}

describe("the names", () => {
  test("are four, under OneUptime's Kubernetes cost prefix", () => {
    expect(KUBERNETES_COST_METRICS).toEqual([
      "oneuptime.kubernetes.cost.total",
      "oneuptime.kubernetes.cost.idle",
      "oneuptime.kubernetes.cost.workload",
      "oneuptime.kubernetes.cost.efficiency",
    ]);

    for (const metric of KUBERNETES_COST_METRICS) {
      expect(metric.startsWith(KUBERNETES_COST_METRIC_NAME_PREFIX)).toBe(true);
      expect(isKubernetesCostMetricName(metric)).toBe(true);
    }
  });

  test("lists every member of the enum", () => {
    expect([...KUBERNETES_COST_METRICS].sort()).toEqual(
      Object.values(KubernetesCostMetric).sort(),
    );
  });

  test("reserves the whole prefix, in any case and with spaces around it", () => {
    expect(isKubernetesCostMetricName("oneuptime.kubernetes.cost.later")).toBe(
      true,
    );
    expect(isKubernetesCostMetricName("OneUptime.Kubernetes.Cost.Total")).toBe(
      true,
    );
    expect(
      isKubernetesCostMetricName("  oneuptime.kubernetes.cost.idle "),
    ).toBe(true);
  });

  test.each([
    "oneuptime.kubernetes.cost",
    "oneuptime.kubernetes.costs.total",
    "custom.oneuptime.kubernetes.cost.total",
    "node_total_hourly_cost",
    "",
  ])("leaves %p alone", (name: string) => {
    expect(isKubernetesCostMetricName(name)).toBe(false);
  });

  test("leaves a missing name alone", () => {
    expect(isKubernetesCostMetricName(undefined)).toBe(false);
    expect(isKubernetesCostMetricName(null)).toBe(false);
  });

  test("describes every metric", () => {
    for (const metric of KUBERNETES_COST_METRICS) {
      expect(getKubernetesCostMetricDescription(metric).length).toBeGreaterThan(
        40,
      );
    }
  });
});

describe("the units", () => {
  test("are the payload's currency for the three costs", () => {
    expect(KUBERNETES_COST_MONEY_METRICS).toEqual([
      KubernetesCostMetric.Total,
      KubernetesCostMetric.Idle,
      KubernetesCostMetric.Workload,
    ]);

    for (const metric of KUBERNETES_COST_MONEY_METRICS) {
      expect(isKubernetesCostMoneyMetric(metric)).toBe(true);
      expect(getKubernetesCostMetricUnit({ metric, currency: "eur" })).toBe(
        "EUR",
      );
    }
  });

  test("are USD when the agent names no currency, or something that is not one", () => {
    for (const currency of [undefined, null, "", "  ", "dollars", "US"]) {
      expect(
        getKubernetesCostMetricUnit({
          metric: KubernetesCostMetric.Total,
          currency: currency,
        }),
      ).toBe(KUBERNETES_COST_DEFAULT_CURRENCY);
    }
  });

  test("is percent for efficiency, whatever the currency", () => {
    expect(isKubernetesCostMoneyMetric(KubernetesCostMetric.Efficiency)).toBe(
      false,
    );
    expect(
      getKubernetesCostMetricUnit({
        metric: KubernetesCostMetric.Efficiency,
        currency: "EUR",
      }),
    ).toBe(KUBERNETES_COST_EFFICIENCY_UNIT);
    expect(KUBERNETES_COST_EFFICIENCY_UNIT).toBe("%");
  });
});

describe("the workload attribute", () => {
  test.each([
    ["deployment", "resource.k8s.deployment.name"],
    ["Deployment", "resource.k8s.deployment.name"],
    ["statefulset", "resource.k8s.statefulset.name"],
    ["daemonset", "resource.k8s.daemonset.name"],
    ["job", "resource.k8s.job.name"],
    ["cronjob", "resource.k8s.cronjob.name"],
    ["replicaset", "resource.k8s.replicaset.name"],
    ["rollout", "resource.k8s.rollout.name"],
  ])("is %p's own name attribute", (kind: string, attribute: string) => {
    expect(getKubernetesCostWorkloadAttribute(kind)).toBe(attribute);
  });

  test("keeps letters only, so a kind cannot write another key", () => {
    expect(getKubernetesCostWorkloadAttribute("deploy.ment name")).toBe(
      "resource.k8s.deploymentname.name",
    );
  });

  test("is null for no kind", () => {
    expect(getKubernetesCostWorkloadAttribute("")).toBeNull();
    expect(getKubernetesCostWorkloadAttribute(" - ")).toBeNull();
    expect(getKubernetesCostWorkloadAttribute(undefined)).toBeNull();
  });
});

describe("the sentinel namespaces", () => {
  test("are the engine's idle and unallocated capacity", () => {
    expect(isKubernetesCostSentinelNamespace("__idle__")).toBe(true);
    expect(isKubernetesCostSentinelNamespace("__unallocated__")).toBe(true);
    expect(isKubernetesCostSentinelNamespace("idle")).toBe(false);
    expect(isKubernetesCostSentinelNamespace("")).toBe(false);
    expect(isKubernetesCostSentinelNamespace(undefined)).toBe(false);
  });
});

describe("buildKubernetesCostMetricPoints", () => {
  test("writes nothing for no rows", () => {
    expect(build([])).toEqual([]);
  });

  test("totals a window, idle included, and splits out what no workload used", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ totalCost: 2 }),
      row({ controllerName: "cart", podName: "cart-1", totalCost: 3 }),
      row({
        namespace: "__idle__",
        controllerKind: "",
        controllerName: "",
        podName: "",
        totalCost: 4,
      }),
      row({
        namespace: "__unallocated__",
        controllerKind: "",
        controllerName: "",
        podName: "",
        totalCost: 0.5,
      }),
    ]);

    expect(pointsOf(points, KubernetesCostMetric.Total)).toEqual([
      {
        metric: KubernetesCostMetric.Total,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        attributes: { [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: "prod" },
        value: 9.5,
      },
    ]);
    expect(pointsOf(points, KubernetesCostMetric.Idle)).toEqual([
      {
        metric: KubernetesCostMetric.Idle,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        attributes: { [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: "prod" },
        value: 4.5,
      },
    ]);
  });

  test("never charges idle capacity to a workload", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({
        namespace: "__idle__",
        controllerKind: "",
        controllerName: "",
        podName: "",
        totalCost: 4,
      }),
    ]);

    expect(pointsOf(points, KubernetesCostMetric.Workload)).toEqual([]);
    expect(pointsOf(points, KubernetesCostMetric.Efficiency)).toEqual([]);
  });

  test("writes an idle point of 0 when nothing was idle, so a ratio has its operand", () => {
    const points: Array<KubernetesCostMetricPoint> = build([row()]);

    expect(pointsOf(points, KubernetesCostMetric.Idle)[0]!.value).toBe(0);
  });

  test("adds up a workload's containers and replicas into one point, under its kind's name attribute", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ podName: "checkout-a", totalCost: 1.25 }),
      row({ podName: "checkout-b", totalCost: 0.75 }),
    ]);

    expect(pointsOf(points, KubernetesCostMetric.Workload)).toEqual([
      {
        metric: KubernetesCostMetric.Workload,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        attributes: {
          [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: "prod",
          [KUBERNETES_COST_NAMESPACE_ATTRIBUTE]: "shop",
          "resource.k8s.deployment.name": "checkout",
        },
        value: 2,
      },
    ]);
  });

  test("tells apart workloads of the same name in two namespaces, and of two kinds", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ namespace: "shop", totalCost: 1 }),
      row({ namespace: "staging", totalCost: 2 }),
      row({ controllerKind: "statefulset", totalCost: 4 }),
    ]);

    const workloads: Array<Record<string, string>> = pointsOf(
      points,
      KubernetesCostMetric.Workload,
    ).map((point: KubernetesCostMetricPoint): Record<string, string> => {
      return { ...point.attributes, value: String(point.value) };
    });

    expect(workloads).toEqual([
      {
        [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: "prod",
        [KUBERNETES_COST_NAMESPACE_ATTRIBUTE]: "shop",
        "resource.k8s.deployment.name": "checkout",
        value: "1",
      },
      {
        [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: "prod",
        [KUBERNETES_COST_NAMESPACE_ATTRIBUTE]: "staging",
        "resource.k8s.deployment.name": "checkout",
        value: "2",
      },
      {
        [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: "prod",
        [KUBERNETES_COST_NAMESPACE_ATTRIBUTE]: "shop",
        "resource.k8s.statefulset.name": "checkout",
        value: "4",
      },
    ]);
  });

  test("names a pod no controller owns by the pod", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ controllerKind: "", controllerName: "", podName: "debug" }),
    ]);

    expect(
      pointsOf(points, KubernetesCostMetric.Workload)[0]!.attributes,
    ).toEqual({
      [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: "prod",
      [KUBERNETES_COST_NAMESPACE_ATTRIBUTE]: "shop",
      [KUBERNETES_COST_POD_ATTRIBUTE]: "debug",
    });
  });

  test("keeps what only a namespace names on the namespace, so its sum is the namespace's cost", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ totalCost: 2 }),
      row({
        controllerKind: "",
        controllerName: "",
        podName: "",
        totalCost: 0.5,
      }),
    ]);

    const inShop: number = pointsOf(points, KubernetesCostMetric.Workload)
      .filter((point: KubernetesCostMetricPoint): boolean => {
        return point.attributes[KUBERNETES_COST_NAMESPACE_ATTRIBUTE] === "shop";
      })
      .reduce((sum: number, point: KubernetesCostMetricPoint): number => {
        return sum + point.value;
      }, 0);

    expect(inShop).toBe(2.5);
    expect(
      pointsOf(points, KubernetesCostMetric.Workload)[1]!.attributes,
    ).toEqual({
      [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: "prod",
      [KUBERNETES_COST_NAMESPACE_ATTRIBUTE]: "shop",
    });
  });

  test("counts a row that names nothing in the total alone", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({
        namespace: "",
        controllerKind: "",
        controllerName: "",
        podName: "",
        totalCost: 3,
      }),
    ]);

    expect(pointsOf(points, KubernetesCostMetric.Total)[0]!.value).toBe(3);
    expect(pointsOf(points, KubernetesCostMetric.Workload)).toEqual([]);
  });

  test("weights efficiency by what each container's CPU and memory cost", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      // The app: costs 9 in CPU and memory, uses 80% of what it reserves.
      row({ podName: "a", cpuCost: 6, ramCost: 3, totalEfficiency: 0.8 }),
      // A sidecar: costs 1, uses 10%. A plain average would read 45%.
      row({ podName: "a", cpuCost: 0.5, ramCost: 0.5, totalEfficiency: 0.1 }),
    ]);

    const efficiency: Array<KubernetesCostMetricPoint> = pointsOf(
      points,
      KubernetesCostMetric.Efficiency,
    );

    expect(efficiency).toHaveLength(1);
    expect(efficiency[0]!.value).toBeCloseTo(
      ((0.8 * 9 + 0.1 * 1) / 10) * 100,
      10,
    );
    expect(efficiency[0]!.attributes).toEqual(
      pointsOf(points, KubernetesCostMetric.Workload)[0]!.attributes,
    );
  });

  test("writes efficiency in percent, and keeps it above 100 where use exceeded requests", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ totalEfficiency: 1.6 }),
    ]);

    expect(pointsOf(points, KubernetesCostMetric.Efficiency)[0]!.value).toBe(
      160,
    );
  });

  test("writes no efficiency for a workload whose CPU and memory cost nothing", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ cpuCost: 0, ramCost: 0, totalCost: 0.2, totalEfficiency: 0 }),
    ]);

    expect(pointsOf(points, KubernetesCostMetric.Workload)).toHaveLength(1);
    expect(pointsOf(points, KubernetesCostMetric.Efficiency)).toEqual([]);
  });

  test("lets no negative component pull the weight below zero", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ cpuCost: -1, ramCost: 0, totalEfficiency: 0.9 }),
    ]);

    expect(pointsOf(points, KubernetesCostMetric.Efficiency)).toEqual([]);
  });

  test("reads a cost that is not a number as 0, never NaN", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ totalCost: Number.NaN }),
      row({ podName: "b", totalCost: 2 }),
    ]);

    expect(pointsOf(points, KubernetesCostMetric.Total)[0]!.value).toBe(2);
    expect(pointsOf(points, KubernetesCostMetric.Workload)[0]!.value).toBe(2);
  });

  test("skips a row whose window is not a date", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ windowStart: new Date("not a date") }),
      row(),
    ]);

    expect(pointsOf(points, KubernetesCostMetric.Total)).toHaveLength(1);
    expect(pointsOf(points, KubernetesCostMetric.Total)[0]!.value).toBe(1);
  });

  test("writes each window apart, in time order, whatever order the rows came in", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row({ windowStart: NEXT_START, windowEnd: NEXT_END, totalCost: 5 }),
      row({ totalCost: 1 }),
    ]);

    expect(
      pointsOf(points, KubernetesCostMetric.Total).map(
        (point: KubernetesCostMetricPoint): [string, number] => {
          return [point.windowStart.toISOString(), point.value];
        },
      ),
    ).toEqual([
      [WINDOW_START.toISOString(), 1],
      [NEXT_START.toISOString(), 5],
    ]);
  });

  test("hands each point attributes of its own, so changing one changes no other", () => {
    const points: Array<KubernetesCostMetricPoint> = build([row()]);
    const total: KubernetesCostMetricPoint = pointsOf(
      points,
      KubernetesCostMetric.Total,
    )[0]!;
    const idle: KubernetesCostMetricPoint = pointsOf(
      points,
      KubernetesCostMetric.Idle,
    )[0]!;

    total.attributes["changed"] = "yes";

    expect(idle.attributes).toEqual({
      [KUBERNETES_COST_CLUSTER_ATTRIBUTE]: "prod",
    });
  });

  test("stamps every point with the cluster it came from", () => {
    const points: Array<KubernetesCostMetricPoint> = build([
      row(),
      row({
        namespace: "__idle__",
        controllerKind: "",
        controllerName: "",
        podName: "",
      }),
    ]);

    for (const point of points) {
      expect(point.attributes[KUBERNETES_COST_CLUSTER_ATTRIBUTE]).toBe("prod");
    }
  });
});
