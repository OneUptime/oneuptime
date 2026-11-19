import {
  KUBERNETES_COST_EFFICIENCY_WEIGHT_DEFAULT_EXPRESSION,
  KUBERNETES_COST_WEIGHTED_EFFICIENCY_DEFAULT_EXPRESSION,
  KubernetesCostEfficiencyRow,
  KubernetesCostEfficiencySums,
  addToKubernetesCostEfficiencySums,
  getKubernetesCostEfficiency,
  getKubernetesCostEfficiencyWeight,
  getKubernetesCostWeightedEfficiency,
} from "../../../Types/Kubernetes/KubernetesCostEfficiency";
import {
  KUBERNETES_COST_IDLE_NAMESPACE,
  KUBERNETES_COST_UNALLOCATED_NAMESPACE,
} from "../../../Types/Kubernetes/KubernetesCostIngest";
import KubernetesCostAllocation from "../../../Models/AnalyticsModels/KubernetesCostAllocation";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";

/*
 * One Kubernetes cost efficiency, wherever it is shown (#9635).
 *
 * The cluster overview's Cost card weighted each workload by its cost, while
 * the Costs pages took a plain average of the rows (the project page's
 * included the idle rows, which have no requests and read 0%). So one
 * cluster showed two efficiencies for the same hours. Now every page, and
 * the efficiency metric, works a group's efficiency out from the two sums
 * this module defines.
 */

function sumsOf(
  rows: Array<KubernetesCostEfficiencyRow>,
): KubernetesCostEfficiencySums {
  const sums: KubernetesCostEfficiencySums = {
    weightedEfficiency: 0,
    weight: 0,
  };

  for (const row of rows) {
    addToKubernetesCostEfficiencySums(sums, row);
  }

  return sums;
}

/*
 * OpenCost's own definition of one allocation's total efficiency: the
 * cost-weighted average of its CPU and RAM efficiency.
 */
function openCostTotalEfficiency(row: {
  cpuEfficiency: number;
  ramEfficiency: number;
  cpuCost: number;
  ramCost: number;
}): number {
  return (
    (row.cpuEfficiency * row.cpuCost + row.ramEfficiency * row.ramCost) /
    (row.cpuCost + row.ramCost)
  );
}

describe("getKubernetesCostEfficiencyWeight", () => {
  test("is what the row's CPU and memory cost", () => {
    expect(
      getKubernetesCostEfficiencyWeight({
        namespace: "shop",
        cpuCost: 0.3,
        ramCost: 0.2,
      }),
    ).toBeCloseTo(0.5, 12);
  });

  test("counts a negative cost as nothing rather than against the others", () => {
    expect(
      getKubernetesCostEfficiencyWeight({
        namespace: "shop",
        cpuCost: -1,
        ramCost: 0.25,
      }),
    ).toBe(0.25);
  });

  test("counts a missing or non-finite cost as nothing", () => {
    expect(getKubernetesCostEfficiencyWeight({ namespace: "shop" })).toBe(0);
    expect(
      getKubernetesCostEfficiencyWeight({
        namespace: "shop",
        cpuCost: Number.NaN,
        ramCost: Number.POSITIVE_INFINITY,
      }),
    ).toBe(0);
  });

  test.each([
    KUBERNETES_COST_IDLE_NAMESPACE,
    KUBERNETES_COST_UNALLOCATED_NAMESPACE,
  ])(
    "gives %s capacity no weight: nothing requested it",
    (namespace: string) => {
      expect(
        getKubernetesCostEfficiencyWeight({
          namespace,
          cpuCost: 10,
          ramCost: 5,
        }),
      ).toBe(0);
    },
  );
});

describe("getKubernetesCostWeightedEfficiency", () => {
  test("is the row's efficiency times its weight", () => {
    expect(
      getKubernetesCostWeightedEfficiency({
        namespace: "shop",
        cpuCost: 0.3,
        ramCost: 0.1,
        totalEfficiency: 0.5,
      }),
    ).toBeCloseTo(0.2, 12);
  });

  test("keeps use above the request above it", () => {
    expect(
      getKubernetesCostWeightedEfficiency({
        namespace: "shop",
        cpuCost: 1,
        ramCost: 1,
        totalEfficiency: 1.5,
      }),
    ).toBe(3);
  });

  test("is nothing for a row that weighs nothing or has no readable efficiency", () => {
    expect(
      getKubernetesCostWeightedEfficiency({
        namespace: KUBERNETES_COST_IDLE_NAMESPACE,
        cpuCost: 1,
        ramCost: 1,
        totalEfficiency: 0.9,
      }),
    ).toBe(0);
    expect(
      getKubernetesCostWeightedEfficiency({
        namespace: "shop",
        cpuCost: 1,
        ramCost: 1,
        totalEfficiency: Number.NaN,
      }),
    ).toBe(0);
    expect(
      getKubernetesCostWeightedEfficiency({
        namespace: "shop",
        cpuCost: 1,
        ramCost: 1,
      }),
    ).toBe(0);
  });
});

describe("getKubernetesCostEfficiency", () => {
  test("divides the weighted sum by the weights", () => {
    expect(
      getKubernetesCostEfficiency({ weightedEfficiency: 3, weight: 4 }),
    ).toBe(0.75);
  });

  test("is null when nothing cost anything to weigh by", () => {
    expect(
      getKubernetesCostEfficiency({ weightedEfficiency: 0, weight: 0 }),
    ).toBeNull();
    expect(
      getKubernetesCostEfficiency({ weightedEfficiency: 1, weight: -1 }),
    ).toBeNull();
  });

  test("is null for sums that are not numbers, as an empty aggregate reads", () => {
    expect(
      getKubernetesCostEfficiency({
        weightedEfficiency: Number.NaN,
        weight: 1,
      }),
    ).toBeNull();
    expect(
      getKubernetesCostEfficiency({
        weightedEfficiency: 1,
        weight: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull();
  });
});

describe("a group's efficiency", () => {
  /*
   * Why this weighting is the right one: for any group of allocations, it is
   * exactly OpenCost's total efficiency of the group taken as one
   * allocation - the cost-weighted average of its CPU and RAM efficiency -
   * which is what OpenCost and Kubecost show for a namespace.
   */
  test("equals OpenCost's total efficiency of the rows taken together", () => {
    const parts: Array<{
      cpuEfficiency: number;
      ramEfficiency: number;
      cpuCost: number;
      ramCost: number;
    }> = [
      { cpuEfficiency: 0.9, ramEfficiency: 0.7, cpuCost: 3, ramCost: 1 },
      { cpuEfficiency: 0.1, ramEfficiency: 0.2, cpuCost: 0.05, ramCost: 0.05 },
      { cpuEfficiency: 1.4, ramEfficiency: 0.6, cpuCost: 0.5, ramCost: 2 },
    ];

    const sums: KubernetesCostEfficiencySums = sumsOf(
      parts.map((part: (typeof parts)[number]): KubernetesCostEfficiencyRow => {
        return {
          namespace: "shop",
          cpuCost: part.cpuCost,
          ramCost: part.ramCost,
          totalEfficiency: openCostTotalEfficiency(part),
        };
      }),
    );

    let cpuWeighted: number = 0;
    let ramWeighted: number = 0;
    let cost: number = 0;

    for (const part of parts) {
      cpuWeighted += part.cpuEfficiency * part.cpuCost;
      ramWeighted += part.ramEfficiency * part.ramCost;
      cost += part.cpuCost + part.ramCost;
    }

    expect(getKubernetesCostEfficiency(sums)).toBeCloseTo(
      (cpuWeighted + ramWeighted) / cost,
      12,
    );
  });

  test("is not dragged down by a tiny workload, as a plain average of the rows was", () => {
    const rows: Array<KubernetesCostEfficiencyRow> = [
      // The service that is the bill: 80% of what it reserves is used.
      { namespace: "shop", cpuCost: 9, ramCost: 3, totalEfficiency: 0.8 },
      // A one-cent job that used nothing.
      { namespace: "shop", cpuCost: 0.005, ramCost: 0.005, totalEfficiency: 0 },
    ];

    const efficiency: number | null = getKubernetesCostEfficiency(sumsOf(rows));

    // A plain average says 40%, as if half the money bought nothing.
    expect(efficiency).toBeGreaterThan(0.79);
    expect(efficiency).toBeLessThan(0.8);
  });

  test("leaves idle capacity out instead of averaging it in at 0%", () => {
    const rows: Array<KubernetesCostEfficiencyRow> = [
      { namespace: "shop", cpuCost: 1, ramCost: 1, totalEfficiency: 0.6 },
      {
        namespace: KUBERNETES_COST_IDLE_NAMESPACE,
        cpuCost: 50,
        ramCost: 50,
        totalEfficiency: 0,
      },
    ];

    expect(getKubernetesCostEfficiency(sumsOf(rows))).toBeCloseTo(0.6, 12);
  });

  test("weighs by CPU and memory only: a workload's storage does not count", () => {
    const rows: Array<KubernetesCostEfficiencyRow & { pvCost: number }> = [
      {
        namespace: "db",
        cpuCost: 1,
        ramCost: 1,
        pvCost: 500,
        totalEfficiency: 0.2,
      },
      {
        namespace: "web",
        cpuCost: 1,
        ramCost: 1,
        pvCost: 0,
        totalEfficiency: 1,
      },
    ];

    expect(getKubernetesCostEfficiency(sumsOf(rows))).toBeCloseTo(0.6, 12);
  });

  test("adds up the same in any order and in any grouping", () => {
    const rows: Array<KubernetesCostEfficiencyRow> = [
      { namespace: "a", cpuCost: 1, ramCost: 2, totalEfficiency: 0.3 },
      { namespace: "b", cpuCost: 4, ramCost: 1, totalEfficiency: 0.9 },
      { namespace: "c", cpuCost: 0.2, ramCost: 0.1, totalEfficiency: 1.2 },
    ];

    const whole: number | null = getKubernetesCostEfficiency(sumsOf(rows));

    // Per namespace first, then the namespaces' sums: what a page grouping by namespace adds.
    const byNamespace: KubernetesCostEfficiencySums = rows
      .map((row: KubernetesCostEfficiencyRow): KubernetesCostEfficiencySums => {
        return sumsOf([row]);
      })
      .reduce(
        (
          total: KubernetesCostEfficiencySums,
          part: KubernetesCostEfficiencySums,
        ): KubernetesCostEfficiencySums => {
          return {
            weightedEfficiency:
              total.weightedEfficiency + part.weightedEfficiency,
            weight: total.weight + part.weight,
          };
        },
        { weightedEfficiency: 0, weight: 0 },
      );

    expect(getKubernetesCostEfficiency(byNamespace)).toBeCloseTo(whole!, 12);
    expect(
      getKubernetesCostEfficiency(sumsOf([...rows].reverse())),
    ).toBeCloseTo(whole!, 12);
  });
});

describe("the ClickHouse DEFAULT expressions say what the functions say", () => {
  /*
   * A row stored before the two columns existed reads these. A tiny
   * evaluator of exactly the shapes they are written in keeps the SQL and
   * the TypeScript from drifting apart.
   */
  function evaluate(
    expression: string,
    row: {
      namespace: string;
      cpuCost: number;
      ramCost: number;
      totalEfficiency: number;
    },
  ): number {
    const sentinel: RegExpMatchArray | null = expression.match(
      /^if\(namespace IN \('([^']+)', '([^']+)'\), 0, (.*)\)$/,
    );

    expect(sentinel).not.toBeNull();

    if ([sentinel![1], sentinel![2]].includes(row.namespace)) {
      return 0;
    }

    const body: string = sentinel![3]!;
    const weight: number = Math.max(row.cpuCost, 0) + Math.max(row.ramCost, 0);

    if (body === "(greatest(cpuCost, 0) + greatest(ramCost, 0))") {
      return weight;
    }

    expect(body).toBe(
      "totalEfficiency * (greatest(cpuCost, 0) + greatest(ramCost, 0))",
    );

    return row.totalEfficiency * weight;
  }

  const ROWS: Array<{
    namespace: string;
    cpuCost: number;
    ramCost: number;
    totalEfficiency: number;
  }> = [
    { namespace: "shop", cpuCost: 0.3, ramCost: 0.2, totalEfficiency: 0.5 },
    { namespace: "shop", cpuCost: -0.3, ramCost: 0.2, totalEfficiency: 0.5 },
    { namespace: "shop", cpuCost: 1, ramCost: 1, totalEfficiency: 1.7 },
    { namespace: "shop", cpuCost: 0, ramCost: 0, totalEfficiency: 0 },
    {
      namespace: KUBERNETES_COST_IDLE_NAMESPACE,
      cpuCost: 3,
      ramCost: 3,
      totalEfficiency: 0,
    },
    {
      namespace: KUBERNETES_COST_UNALLOCATED_NAMESPACE,
      cpuCost: 3,
      ramCost: 3,
      totalEfficiency: 0.4,
    },
  ];

  test.each(ROWS)(
    "weight of %o",
    (row: {
      namespace: string;
      cpuCost: number;
      ramCost: number;
      totalEfficiency: number;
    }) => {
      expect(
        evaluate(KUBERNETES_COST_EFFICIENCY_WEIGHT_DEFAULT_EXPRESSION, row),
      ).toBeCloseTo(getKubernetesCostEfficiencyWeight(row), 12);
    },
  );

  test.each(ROWS)(
    "weighted efficiency of %o",
    (row: {
      namespace: string;
      cpuCost: number;
      ramCost: number;
      totalEfficiency: number;
    }) => {
      expect(
        evaluate(KUBERNETES_COST_WEIGHTED_EFFICIENCY_DEFAULT_EXPRESSION, row),
      ).toBeCloseTo(getKubernetesCostWeightedEfficiency(row), 12);
    },
  );

  test("names the sentinels the ingest contract names", () => {
    for (const expression of [
      KUBERNETES_COST_EFFICIENCY_WEIGHT_DEFAULT_EXPRESSION,
      KUBERNETES_COST_WEIGHTED_EFFICIENCY_DEFAULT_EXPRESSION,
    ]) {
      expect(expression).toContain(`'${KUBERNETES_COST_IDLE_NAMESPACE}'`);
      expect(expression).toContain(
        `'${KUBERNETES_COST_UNALLOCATED_NAMESPACE}'`,
      );
    }
  });
});

describe("KubernetesCostAllocation stores both sums on every row", () => {
  const model: KubernetesCostAllocation = new KubernetesCostAllocation();

  test.each([
    ["efficiencyWeight", KUBERNETES_COST_EFFICIENCY_WEIGHT_DEFAULT_EXPRESSION],
    [
      "weightedEfficiency",
      KUBERNETES_COST_WEIGHTED_EFFICIENCY_DEFAULT_EXPRESSION,
    ],
  ])(
    "%s is a required Decimal whose DEFAULT works it out for rows stored before it",
    (key: string, expression: string) => {
      const column: AnalyticsTableColumn | null = model.getTableColumn(key);

      expect(column).not.toBeNull();
      expect(column!.type).toBe(TableColumnType.Decimal);
      expect(column!.required).toBe(true);
      expect(column!.defaultExpression).toBe(expression);
      // Written into the column's DDL, for CREATE TABLE and ADD COLUMN alike.
      expect(StatementGenerator.toDefaultExpressionClause(column!)).toBe(
        ` DEFAULT ${expression}`,
      );
    },
  );

  test("the columns sit with the other measures, readable by whoever reads costs", () => {
    const weight: AnalyticsTableColumn | null =
      model.getTableColumn("efficiencyWeight");
    const cost: AnalyticsTableColumn | null = model.getTableColumn("totalCost");

    expect(weight!.accessControl?.read).toEqual(cost!.accessControl?.read);
    expect(weight!.accessControl?.update).toEqual([]);
  });
});
