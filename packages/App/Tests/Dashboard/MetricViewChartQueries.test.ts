import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import Dictionary from "Common/Types/Dictionary";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import MetricViewChartQueries from "../../FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricViewChartQueries";

/*
 * Issue #6264: a metric view whose charts read its queries narrowed (a
 * monitor step form's, to the cluster or host the monitor watches) while
 * its query editor edits them as written. The charts get the narrowed
 * queries; whatever the charts change goes back onto the written ones,
 * never with the narrowing.
 */

const queryOf: (data: {
  variable?: string;
  metricName?: string;
  attributes?: Dictionary<unknown> | undefined;
  withoutAttributes?: boolean;
  topN?: number;
}) => MetricQueryConfigData = (data: {
  variable?: string;
  metricName?: string;
  attributes?: Dictionary<unknown> | undefined;
  withoutAttributes?: boolean;
  topN?: number;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: data.variable || "a",
      title: "CPU",
      description: "",
      legend: "",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName || "pve_cpu_usage_ratio",
        aggegationType: MetricsAggregationType.Avg,
        ...(data.withoutAttributes ? {} : { attributes: data.attributes }),
      },
      groupByAttributeKeys: ["id"],
      ...(data.topN !== undefined ? { topN: data.topN } : {}),
    },
  } as unknown as MetricQueryConfigData;
};

const SCOPE: Dictionary<unknown> = {
  "resource.proxmox.cluster.name": "pve-prod",
  "pve.scope": "node",
};

// The chart's copy of a query: its own filters with the monitor's scope.
const chartedOf: (
  query: MetricQueryConfigData,
  scope?: Dictionary<unknown>,
) => MetricQueryConfigData = (
  query: MetricQueryConfigData,
  scope: Dictionary<unknown> = SCOPE,
): MetricQueryConfigData => {
  return {
    ...query,
    metricQueryData: {
      ...query.metricQueryData,
      filterData: {
        ...query.metricQueryData.filterData,
        attributes: {
          ...((query.metricQueryData.filterData.attributes as
            | Dictionary<unknown>
            | undefined) || {}),
          ...scope,
        },
      } as never,
    },
  };
};

// The chart's query with what a chart control changes on it.
const withTopN: (
  query: MetricQueryConfigData,
  topN: number,
) => MetricQueryConfigData = (
  query: MetricQueryConfigData,
  topN: number,
): MetricQueryConfigData => {
  return {
    ...query,
    metricQueryData: { ...query.metricQueryData, topN: topN },
  };
};

const withAttributes: (
  query: MetricQueryConfigData,
  attributes: Dictionary<unknown>,
) => MetricQueryConfigData = (
  query: MetricQueryConfigData,
  attributes: Dictionary<unknown>,
): MetricQueryConfigData => {
  return {
    ...query,
    metricQueryData: {
      ...query.metricQueryData,
      filterData: {
        ...query.metricQueryData.filterData,
        attributes: attributes,
      } as never,
    },
  };
};

const attributesOf: (
  query: MetricQueryConfigData,
) => Dictionary<unknown> | undefined = (
  query: MetricQueryConfigData,
): Dictionary<unknown> | undefined => {
  return query.metricQueryData.filterData.attributes as
    | Dictionary<unknown>
    | undefined;
};

const dataOf: (queryConfigs: Array<MetricQueryConfigData>) => MetricViewData = (
  queryConfigs: Array<MetricQueryConfigData>,
): MetricViewData => {
  return {
    startAndEndDate: new InBetween<Date>(
      new Date("2026-11-07T10:00:00.000Z"),
      new Date("2026-11-07T11:00:00.000Z"),
    ),
    queryConfigs: queryConfigs,
    formulaConfigs: [
      {
        metricAliasData: {
          metricVariable: "f",
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricFormulaData: { metricFormula: "a * 100" },
      },
    ],
    rangeToken: "Past 1 Hour",
  };
};

describe("what the charts fetch and draw", () => {
  test("the chart's queries in place of the view's own; the window, formulas and range as they are", () => {
    const editor: Array<MetricQueryConfigData> = [queryOf({})];
    const charted: Array<MetricQueryConfigData> = [chartedOf(editor[0]!)];
    const data: MetricViewData = dataOf(editor);

    const chartData: MetricViewData = MetricViewChartQueries.getChartData({
      data: data,
      chartQueryConfigs: charted,
    });

    expect(chartData.queryConfigs).toBe(charted);
    expect(chartData.formulaConfigs).toBe(data.formulaConfigs);
    expect(chartData.startAndEndDate).toBe(data.startAndEndDate);
    expect(chartData.rangeToken).toBe("Past 1 Hour");
    // The view's own data is not touched.
    expect(data.queryConfigs).toBe(editor);
  });

  test.each([
    ["no chart queries", undefined],
    ["null", null],
    ["fewer than the view's queries", []],
    [
      "more than the view's queries",
      [chartedOf(queryOf({})), chartedOf(queryOf({ variable: "b" }))],
    ],
  ])(
    "%s: the view's own data, the very same object",
    (_name: string, chartQueryConfigs: unknown) => {
      const data: MetricViewData = dataOf([queryOf({})]);

      expect(
        MetricViewChartQueries.getChartData({
          data: data,
          chartQueryConfigs: chartQueryConfigs as never,
        }),
      ).toBe(data);
    },
  );

  test("the view's own queries handed in as chart queries change nothing", () => {
    const data: MetricViewData = dataOf([queryOf({})]);

    expect(
      MetricViewChartQueries.getChartData({
        data: data,
        chartQueryConfigs: data.queryConfigs,
      }),
    ).toBe(data);
  });

  test("a view with no query yet and no chart query lines up", () => {
    expect(
      MetricViewChartQueries.isUsable({ queryConfigs: [], chartQueryConfigs: [] }),
    ).toBe(true);
    expect(
      MetricViewChartQueries.isUsable({
        queryConfigs: [],
        chartQueryConfigs: undefined,
      }),
    ).toBe(false);
  });
});

describe("a change the charts make reaches the host on the editor's queries", () => {
  test("a Top-N set on a chart: the written query with its Top-N, and no scope saved", () => {
    const editor: MetricQueryConfigData = queryOf({
      attributes: { "own.key": "kept" },
    });
    const charted: MetricQueryConfigData = chartedOf(editor);

    const [saved] = MetricViewChartQueries.toEditorQueryConfigs({
      editorQueryConfigs: [editor],
      chartQueryConfigs: [charted],
      changedQueryConfigs: [withTopN(charted, 5)],
    });

    expect(saved).toEqual(withTopN(editor, 5));
    expect(attributesOf(saved!)).toEqual({ "own.key": "kept" });
  });

  test.each([
    ["no attributes key", queryOf({ withoutAttributes: true })],
    ["an attributes key holding nothing", queryOf({ attributes: undefined })],
    ["an empty map", queryOf({ attributes: {} })],
  ])(
    "a written query with %s keeps that shape",
    (_name: string, editor: MetricQueryConfigData) => {
      const charted: MetricQueryConfigData = chartedOf(editor);

      const [saved] = MetricViewChartQueries.toEditorQueryConfigs({
        editorQueryConfigs: [editor],
        chartQueryConfigs: [charted],
        changedQueryConfigs: [withTopN(charted, 3)],
      });

      expect(Object.keys(saved!.metricQueryData.filterData)).toEqual(
        Object.keys(editor.metricQueryData.filterData),
      );
      expect(attributesOf(saved!)).toEqual(attributesOf(editor));
      expect(saved).toEqual(withTopN(editor, 3));
    },
  );

  test("'Filter to this series': the series' filter is saved, the scope is not", () => {
    const editor: MetricQueryConfigData = queryOf({ withoutAttributes: true });
    const charted: MetricQueryConfigData = chartedOf(editor);

    const [saved] = MetricViewChartQueries.toEditorQueryConfigs({
      editorQueryConfigs: [editor],
      chartQueryConfigs: [charted],
      changedQueryConfigs: [
        withAttributes(charted, {
          ...attributesOf(charted),
          id: "node/pve1",
        }),
      ],
    });

    expect(attributesOf(saved!)).toEqual({ id: "node/pve1" });
  });

  test("a scope attribute the charts set to another value is the reader's own filter, and saved", () => {
    const editor: MetricQueryConfigData = queryOf({ withoutAttributes: true });
    const charted: MetricQueryConfigData = chartedOf(editor);

    const [saved] = MetricViewChartQueries.toEditorQueryConfigs({
      editorQueryConfigs: [editor],
      chartQueryConfigs: [charted],
      changedQueryConfigs: [
        withAttributes(charted, {
          ...attributesOf(charted),
          "pve.scope": "guest",
        }),
      ],
    });

    expect(attributesOf(saved!)).toEqual({ "pve.scope": "guest" });
  });

  test("a filter the charts take away goes from the written query too", () => {
    const editor: MetricQueryConfigData = queryOf({
      attributes: { "own.key": "x", "own.other": "y" },
    });
    const charted: MetricQueryConfigData = chartedOf(editor);
    const changed: Dictionary<unknown> = { ...attributesOf(charted) };
    delete changed["own.key"];
    delete changed["pve.scope"];

    const [saved] = MetricViewChartQueries.toEditorQueryConfigs({
      editorQueryConfigs: [editor],
      chartQueryConfigs: [charted],
      changedQueryConfigs: [withAttributes(charted, changed)],
    });

    expect(attributesOf(saved!)).toEqual({ "own.other": "y" });
  });

  test("every filter the charts take away leaves the written query with none, not its old ones", () => {
    const editor: MetricQueryConfigData = queryOf({
      attributes: { "own.key": "x" },
    });
    const charted: MetricQueryConfigData = chartedOf(editor);

    const [saved] = MetricViewChartQueries.toEditorQueryConfigs({
      editorQueryConfigs: [editor],
      chartQueryConfigs: [charted],
      changedQueryConfigs: [withAttributes(charted, {})],
    });

    expect(attributesOf(saved!)).toEqual({});
  });

  test("an operator is compared by what it matches, not by which object holds it", () => {
    const editor: MetricQueryConfigData = queryOf({ withoutAttributes: true });
    const charted: MetricQueryConfigData = chartedOf(editor, {
      "resource.iot.fleet.name": new Wildcard<string>(["sensors"]),
      "resource.docker.swarm.task.id": new NotNull(),
    });

    const [saved] = MetricViewChartQueries.toEditorQueryConfigs({
      editorQueryConfigs: [editor],
      chartQueryConfigs: [charted],
      changedQueryConfigs: [
        withTopN(
          withAttributes(charted, {
            "resource.iot.fleet.name": new Wildcard<string>(["sensors"]),
            "resource.docker.swarm.task.id": new NotNull(),
          }),
          4,
        ),
      ],
    });

    expect(saved).toEqual(withTopN(editor, 4));
  });

  test("a query the charts did not touch is the written one, the same object", () => {
    const first: MetricQueryConfigData = queryOf({ variable: "a" });
    const second: MetricQueryConfigData = queryOf({ variable: "b" });
    const charted: Array<MetricQueryConfigData> = [
      chartedOf(first),
      chartedOf(second),
    ];

    const saved: Array<MetricQueryConfigData> =
      MetricViewChartQueries.toEditorQueryConfigs({
        editorQueryConfigs: [first, second],
        chartQueryConfigs: charted,
        changedQueryConfigs: [charted[0]!, withTopN(charted[1]!, 10)],
      });

    expect(saved[0]).toBe(first);
    expect(saved[1]).toEqual(withTopN(second, 10));
  });

  test("a view whose charts read the editor's own queries hands the change on as it is", () => {
    const editor: Array<MetricQueryConfigData> = [queryOf({})];
    const changed: Array<MetricQueryConfigData> = [withTopN(editor[0]!, 2)];

    expect(
      MetricViewChartQueries.toEditorQueryConfigs({
        editorQueryConfigs: editor,
        chartQueryConfigs: editor,
        changedQueryConfigs: changed,
      }),
    ).toBe(changed);
  });

  test("lists that do not line up are handed on as they are", () => {
    const editor: Array<MetricQueryConfigData> = [queryOf({})];
    const changed: Array<MetricQueryConfigData> = [queryOf({}), queryOf({})];

    expect(
      MetricViewChartQueries.toEditorQueryConfigs({
        editorQueryConfigs: editor,
        chartQueryConfigs: [chartedOf(editor[0]!)],
        changedQueryConfigs: changed,
      }),
    ).toBe(changed);
    expect(
      MetricViewChartQueries.toEditorQueryConfigs({
        editorQueryConfigs: editor,
        chartQueryConfigs: [],
        changedQueryConfigs: [queryOf({})],
      }),
    ).toHaveLength(1);
  });

  test("nothing it is handed is changed in place", () => {
    const editor: MetricQueryConfigData = queryOf({ attributes: { a: "1" } });
    const charted: MetricQueryConfigData = chartedOf(editor);
    const changed: MetricQueryConfigData = withAttributes(
      withTopN(charted, 7),
      { ...attributesOf(charted), b: "2" },
    );
    const before: string = JSON.stringify([editor, charted, changed]);

    MetricViewChartQueries.toEditorQueryConfigs({
      editorQueryConfigs: [editor],
      chartQueryConfigs: [charted],
      changedQueryConfigs: [changed],
    });

    expect(JSON.stringify([editor, charted, changed])).toBe(before);
  });
});

describe("whatever the charts change (seeded)", () => {
  const KEYS: Array<string> = ["a", "b", "c", "d", "e", "f"];

  test("the saved query has its own filters and the charts' edits, never the scope", () => {
    const random: SeededRandom = seededRandom(6264);

    for (let round: number = 0; round < 500; round++) {
      const own: Dictionary<unknown> = {};
      const scope: Dictionary<unknown> = {};

      for (const key of KEYS) {
        const draw: number = random(3);
        if (draw === 0) {
          own[`k.${key}`] = `own-${random(3)}`;
        } else if (draw === 1) {
          scope[`k.${key}`] = `scope-${random(3)}`;
        }
      }

      // The scope wins where both name a key, as the worker's does.
      const editor: MetricQueryConfigData = queryOf({
        attributes: { ...own },
      });
      const charted: MetricQueryConfigData = chartedOf(editor, scope);
      const chartedAttributes: Dictionary<unknown> = attributesOf(charted)!;

      // What a chart control does to its copy: add, change, drop, or nothing.
      const changedAttributes: Dictionary<unknown> = { ...chartedAttributes };
      const added: Dictionary<unknown> = {};
      const removed: Array<string> = [];
      for (const key of KEYS) {
        const name: string = `k.${key}`;
        const draw: number = random(6);
        if (draw === 0) {
          changedAttributes[name] = `edit-${round}`;
          added[name] = `edit-${round}`;
        } else if (draw === 1 && name in changedAttributes) {
          delete changedAttributes[name];
          removed.push(name);
        }
      }

      const changed: MetricQueryConfigData = withAttributes(
        withTopN(charted, 1 + random(20)),
        changedAttributes,
      );

      const [saved] = MetricViewChartQueries.toEditorQueryConfigs({
        editorQueryConfigs: [editor],
        chartQueryConfigs: [charted],
        changedQueryConfigs: [changed],
      });

      const savedAttributes: Dictionary<unknown> = attributesOf(saved!) || {};

      for (const key of Object.keys(savedAttributes)) {
        // Every saved filter is the reader's own or one the charts set.
        expect(key in added || key in own).toBe(true);
      }

      for (const key of Object.keys(own)) {
        if (removed.includes(key)) {
          expect(key in savedAttributes).toBe(false);
        } else if (key in added) {
          expect(savedAttributes[key]).toBe(added[key]);
        } else if (key in scope) {
          // The scope covered it on the chart, and the charts left it be.
          expect(savedAttributes[key]).toBe(own[key]);
        } else {
          expect(savedAttributes[key]).toBe(own[key]);
        }
      }

      for (const key of Object.keys(added)) {
        expect(savedAttributes[key]).toBe(added[key]);
      }

      for (const key of Object.keys(scope)) {
        if (!(key in own) && !(key in added)) {
          expect(key in savedAttributes).toBe(false);
        }
      }

      expect(saved!.metricQueryData.topN).toBe(changed.metricQueryData.topN);
    }
  });
});
