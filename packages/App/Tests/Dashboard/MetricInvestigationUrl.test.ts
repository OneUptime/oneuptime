import { describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import TimeRange from "Common/Types/Time/TimeRange";
import MetricInvestigationTime, {
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
  MetricInvestigationTimeSelection,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationTime";
import MetricInvestigationQueryUtil, {
  MetricInvestigationQueries,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationQueries";
import MetricInvestigationUrl, {
  MetricInvestigationUrlParamNames,
  MetricInvestigationUrlState,
  ReadUrlParamFunction,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationUrl";

/*
 * Where a metric investigation is remembered (issue #5954): in the page's
 * URL, under names of its own, and only what the reader changed.
 */

const PREFIX: string = "metrics";

const PRESETS: Array<MetricInvestigationTimePreset> = [
  {
    id: "around-start",
    label: "Around the start",
    window: new InBetween<Date>(
      new Date("2026-11-05T05:14:00.000Z"),
      new Date("2026-11-05T06:14:00.000Z"),
    ),
  },
];

const QUERIES: MetricInvestigationQueries = {
  queryConfigs: [
    {
      metricAliasData: {
        metricVariable: "a",
        title: "",
        description: "",
        legend: "",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "pod_cpu_saturation",
          attributes: { "resource.k8s.pod.name": "api-0" } as never,
          aggegationType: MetricsAggregationType.Max,
        },
      },
    } as MetricQueryConfigData,
  ],
  formulaConfigs: [
    {
      metricAliasData: {
        metricVariable: "b",
        title: "",
        description: "",
        legend: "",
        legendUnit: "",
      },
      metricFormulaData: { metricFormula: "a * 100" },
    },
  ],
};

function reader(params: Dictionary<string | null>): ReadUrlParamFunction {
  return (name: string): string | null => {
    return params[name] ?? null;
  };
}

describe("the names", () => {
  test("every name starts with the page's prefix", () => {
    const names: MetricInvestigationUrlParamNames =
      MetricInvestigationUrl.getParamNames(PREFIX);

    expect(names).toEqual({
      time: "metricsTime",
      start: "metricsStart",
      end: "metricsEnd",
      queries: "metricsQueries",
      formulas: "metricsFormulas",
    });
  });

  test("never one of the metric explorer's own names", () => {
    const explorerNames: Array<string> = [
      "metricQueries",
      "metricFormulas",
      "startTime",
      "endTime",
      "range",
      "services",
    ];

    for (const name of Object.values(
      MetricInvestigationUrl.getParamNames(PREFIX),
    )) {
      expect(explorerNames).not.toContain(name);
    }
  });
});

describe("buildParams", () => {
  test("an untouched investigation takes every one of its names out", () => {
    expect(
      MetricInvestigationUrl.buildParams({
        prefix: PREFIX,
        state: { selection: null, queries: null },
      }),
    ).toEqual({
      metricsTime: null,
      metricsStart: null,
      metricsEnd: null,
      metricsQueries: null,
      metricsFormulas: null,
    });
  });

  test("a preset or a relative range is one name", () => {
    expect(
      MetricInvestigationUrl.buildParams({
        prefix: PREFIX,
        state: {
          selection: {
            kind: MetricInvestigationTimeKind.Preset,
            presetId: "around-start",
          },
          queries: null,
        },
      })["metricsTime"],
    ).toBe("around-start");

    const relative: Dictionary<string | null> =
      MetricInvestigationUrl.buildParams({
        prefix: PREFIX,
        state: {
          selection: {
            kind: MetricInvestigationTimeKind.Relative,
            range: TimeRange.PAST_ONE_DAY,
          },
          queries: null,
        },
      });

    expect(relative["metricsTime"]).toBe("Past 1 Day");
    expect(relative["metricsStart"]).toBeNull();
    expect(relative["metricsEnd"]).toBeNull();
  });

  test("a custom window keeps both instants", () => {
    const params: Dictionary<string | null> =
      MetricInvestigationUrl.buildParams({
        prefix: PREFIX,
        state: {
          selection: {
            kind: MetricInvestigationTimeKind.Custom,
            window: new InBetween<Date>(
              new Date("2026-11-05T05:20:00.000Z"),
              new Date("2026-11-05T05:30:00.000Z"),
            ),
          },
          queries: null,
        },
      });

    expect(params["metricsTime"]).toBe("custom");
    expect(params["metricsStart"]).toBe("2026-11-05T05:20:00.000Z");
    expect(params["metricsEnd"]).toBe("2026-11-05T05:30:00.000Z");
  });

  test("changed metrics keep their queries and formulas", () => {
    const params: Dictionary<string | null> =
      MetricInvestigationUrl.buildParams({
        prefix: PREFIX,
        state: { selection: null, queries: QUERIES },
      });

    expect(params["metricsTime"]).toBeNull();
    expect(params["metricsQueries"]).toContain("pod_cpu_saturation");
    expect(params["metricsFormulas"]).toContain("a * 100");
  });
});

describe("readState", () => {
  test.each([
    [
      "a preset",
      {
        kind: MetricInvestigationTimeKind.Preset,
        presetId: "around-start",
      } as MetricInvestigationTimeSelection,
    ],
    [
      "a relative range",
      {
        kind: MetricInvestigationTimeKind.Relative,
        range: TimeRange.PAST_ONE_WEEK,
      } as MetricInvestigationTimeSelection,
    ],
    [
      "a custom window",
      {
        kind: MetricInvestigationTimeKind.Custom,
        window: new InBetween<Date>(
          new Date("2026-11-05T05:20:00.000Z"),
          new Date("2026-11-05T05:30:00.000Z"),
        ),
      } as MetricInvestigationTimeSelection,
    ],
  ])(
    "%s and changed metrics read back as written",
    (_name: string, selection: MetricInvestigationTimeSelection) => {
      const written: MetricInvestigationUrlState = {
        selection: selection,
        queries: QUERIES,
      };
      const readBack: MetricInvestigationUrlState =
        MetricInvestigationUrl.readState({
          prefix: PREFIX,
          read: reader(
            MetricInvestigationUrl.buildParams({
              prefix: PREFIX,
              state: written,
            }),
          ),
          presets: PRESETS,
        });

      expect(
        MetricInvestigationTime.isSameSelection(readBack.selection, selection),
      ).toBe(true);
      expect(
        MetricInvestigationQueryUtil.isSame(readBack.queries, QUERIES),
      ).toBe(true);
    },
  );

  test("a URL without the investigation reads as untouched", () => {
    expect(
      MetricInvestigationUrl.readState({
        prefix: PREFIX,
        read: reader({ page: "2", logsRange: "Past 1 Hour" }),
        presets: PRESETS,
      }),
    ).toEqual({ selection: null, queries: null });
  });

  test("another prefix's params are not this investigation's", () => {
    const params: Dictionary<string | null> =
      MetricInvestigationUrl.buildParams({
        prefix: "other",
        state: {
          selection: {
            kind: MetricInvestigationTimeKind.Relative,
            range: TimeRange.PAST_ONE_DAY,
          },
          queries: QUERIES,
        },
      });

    expect(
      MetricInvestigationUrl.readState({
        prefix: PREFIX,
        read: reader(params),
        presets: PRESETS,
      }),
    ).toEqual({ selection: null, queries: null });
  });

  test("what this page cannot show is read as untouched", () => {
    expect(
      MetricInvestigationUrl.readState({
        prefix: PREFIX,
        read: reader({
          metricsTime: "start-to-end",
          metricsQueries: "[]",
        }),
        presets: PRESETS,
      }),
    ).toEqual({ selection: null, queries: null });
  });
});

describe("hasAnyParam", () => {
  test("says whether any of the investigation's names is in the URL", () => {
    expect(
      MetricInvestigationUrl.hasAnyParam({
        prefix: PREFIX,
        read: reader({}),
      }),
    ).toBe(false);
    expect(
      MetricInvestigationUrl.hasAnyParam({
        prefix: PREFIX,
        read: reader({ metricsEnd: "garbage" }),
      }),
    ).toBe(true);
    expect(
      MetricInvestigationUrl.hasAnyParam({
        prefix: PREFIX,
        read: reader({ metricQueries: "[]" }),
      }),
    ).toBe(false);
  });
});

describe("applyParams", () => {
  const HREF: string =
    "https://oneuptime.example/dashboard/p1/incidents/i1?tab=logs&metricsTime=hour-before#notes";

  test("sets and takes out the investigation's names, keeping the rest", () => {
    const applied: string = MetricInvestigationUrl.applyParams(HREF, {
      metricsTime: "custom",
      metricsStart: "2026-11-05T05:20:00.000Z",
      metricsEnd: "2026-11-05T05:30:00.000Z",
      metricsQueries: null,
    });
    const url: URL = new URL(applied);

    expect(url.pathname).toBe("/dashboard/p1/incidents/i1");
    expect(url.hash).toBe("#notes");
    expect(url.searchParams.get("tab")).toBe("logs");
    expect(url.searchParams.get("metricsTime")).toBe("custom");
    expect(url.searchParams.get("metricsStart")).toBe(
      "2026-11-05T05:20:00.000Z",
    );
    expect(url.searchParams.has("metricsQueries")).toBe(false);
  });

  test("an untouched investigation leaves a clean address", () => {
    const applied: string = MetricInvestigationUrl.applyParams(
      HREF,
      MetricInvestigationUrl.buildParams({
        prefix: PREFIX,
        state: { selection: null, queries: null },
      }),
    );

    expect(applied).toBe(
      "https://oneuptime.example/dashboard/p1/incidents/i1?tab=logs#notes",
    );
  });

  test("JSON in a value survives the trip through the address", () => {
    const params: Dictionary<string | null> =
      MetricInvestigationUrl.buildParams({
        prefix: PREFIX,
        state: { selection: null, queries: QUERIES },
      });
    const applied: string = MetricInvestigationUrl.applyParams(HREF, params);
    const url: URL = new URL(applied);

    expect(
      MetricInvestigationQueryUtil.isSame(
        MetricInvestigationQueryUtil.fromUrlValue({
          queries: url.searchParams.get("metricsQueries"),
          formulas: url.searchParams.get("metricsFormulas"),
        }),
        QUERIES,
      ),
    ).toBe(true);
  });

  test("an address that cannot be read comes back as it was", () => {
    expect(
      MetricInvestigationUrl.applyParams("not a url", { metricsTime: "x" }),
    ).toBe("not a url");
  });
});

/*
 * The two halves (issue #6251): the time range, which a card with no
 * metrics of its own keeps too (an incident's logs, traces or exceptions,
 * under "telemetry"), and the metrics. Each is kept and read on its own, and
 * the whole is exactly the two together, so a metric investigation keeps
 * what it always kept.
 */
describe("the time range's half and the metrics' half", () => {
  const SELECTIONS: Array<[string, MetricInvestigationTimeSelection | null]> = [
    ["nothing picked", null],
    [
      "a preset",
      {
        kind: MetricInvestigationTimeKind.Preset,
        presetId: "around-start",
      },
    ],
    [
      "a relative range",
      {
        kind: MetricInvestigationTimeKind.Relative,
        range: TimeRange.PAST_ONE_DAY,
      },
    ],
    [
      "a custom window",
      {
        kind: MetricInvestigationTimeKind.Custom,
        window: new InBetween<Date>(
          new Date("2026-11-05T05:20:00.000Z"),
          new Date("2026-11-05T05:30:00.000Z"),
        ),
      },
    ],
  ];

  test("the time range's names and the metrics' names, under the page's prefix, never the same", () => {
    expect(MetricInvestigationUrl.getTimeParamNames("telemetry")).toEqual({
      time: "telemetryTime",
      start: "telemetryStart",
      end: "telemetryEnd",
    });
    expect(MetricInvestigationUrl.getQueryParamNames("telemetry")).toEqual({
      queries: "telemetryQueries",
      formulas: "telemetryFormulas",
    });
    expect(MetricInvestigationUrl.getParamNames(PREFIX)).toEqual({
      ...MetricInvestigationUrl.getTimeParamNames(PREFIX),
      ...MetricInvestigationUrl.getQueryParamNames(PREFIX),
    });

    const timeNames: Array<string> = Object.values(
      MetricInvestigationUrl.getTimeParamNames(PREFIX),
    );
    for (const name of Object.values(
      MetricInvestigationUrl.getQueryParamNames(PREFIX),
    )) {
      expect(timeNames).not.toContain(name);
    }
  });

  test.each(SELECTIONS)(
    "%s: the time range's params name every time name and nothing else",
    (_name: string, selection: MetricInvestigationTimeSelection | null) => {
      const params: Dictionary<string | null> =
        MetricInvestigationUrl.buildTimeParams({
          prefix: "telemetry",
          selection: selection,
        });

      expect(Object.keys(params).sort()).toEqual([
        "telemetryEnd",
        "telemetryStart",
        "telemetryTime",
      ]);
    },
  );

  test.each(SELECTIONS)(
    "%s with changed metrics, and without: the whole is the two halves together",
    (_name: string, selection: MetricInvestigationTimeSelection | null) => {
      for (const queries of [null, QUERIES]) {
        expect(
          MetricInvestigationUrl.buildParams({
            prefix: PREFIX,
            state: { selection: selection, queries: queries },
          }),
        ).toEqual({
          ...MetricInvestigationUrl.buildTimeParams({
            prefix: PREFIX,
            selection: selection,
          }),
          ...MetricInvestigationUrl.buildQueryParams({
            prefix: PREFIX,
            queries: queries,
          }),
        });
      }
    },
  );

  test.each(SELECTIONS.slice(1))(
    "%s reads back from the time range's half alone",
    (_name: string, selection: MetricInvestigationTimeSelection | null) => {
      const readBack: MetricInvestigationTimeSelection | null =
        MetricInvestigationUrl.readSelection({
          prefix: "telemetry",
          read: reader(
            MetricInvestigationUrl.buildTimeParams({
              prefix: "telemetry",
              selection: selection,
            }),
          ),
          presets: PRESETS,
        });

      expect(
        MetricInvestigationTime.isSameSelection(readBack, selection!),
      ).toBe(true);
    },
  );

  test("the metrics read back from their half alone, and a time range is not metrics", () => {
    expect(
      MetricInvestigationQueryUtil.isSame(
        MetricInvestigationUrl.readQueries({
          prefix: PREFIX,
          read: reader(
            MetricInvestigationUrl.buildQueryParams({
              prefix: PREFIX,
              queries: QUERIES,
            }),
          ),
        }),
        QUERIES,
      ),
    ).toBe(true);

    expect(
      MetricInvestigationUrl.readQueries({
        prefix: PREFIX,
        read: reader({ metricsTime: "around-start" }),
      }),
    ).toBeNull();
    expect(
      MetricInvestigationUrl.readSelection({
        prefix: PREFIX,
        read: reader(
          MetricInvestigationUrl.buildQueryParams({
            prefix: PREFIX,
            queries: QUERIES,
          }),
        ),
        presets: PRESETS,
      }),
    ).toBeNull();
  });

  test("a range kept under another prefix is not this card's", () => {
    expect(
      MetricInvestigationUrl.readSelection({
        prefix: "telemetry",
        read: reader({ metricsTime: "around-start" }),
        presets: PRESETS,
      }),
    ).toBeNull();
    expect(
      MetricInvestigationUrl.readSelection({
        prefix: PREFIX,
        read: reader({ telemetryTime: "around-start" }),
        presets: PRESETS,
      }),
    ).toBeNull();
  });

  test("readState is the two halves read together", () => {
    const params: Dictionary<string | null> =
      MetricInvestigationUrl.buildParams({
        prefix: PREFIX,
        state: { selection: SELECTIONS[3]![1], queries: QUERIES },
      });
    const state: MetricInvestigationUrlState = MetricInvestigationUrl.readState(
      {
        prefix: PREFIX,
        read: reader(params),
        presets: PRESETS,
      },
    );

    expect(state.selection).toEqual(
      MetricInvestigationUrl.readSelection({
        prefix: PREFIX,
        read: reader(params),
        presets: PRESETS,
      }),
    );
    expect(
      MetricInvestigationQueryUtil.isSame(
        state.queries,
        MetricInvestigationUrl.readQueries({
          prefix: PREFIX,
          read: reader(params),
        }),
      ),
    ).toBe(true);
  });

  test("each half says whether the URL holds any of its own names", () => {
    const cases: Array<[Dictionary<string | null>, boolean, boolean]> = [
      [{}, false, false],
      [{ telemetryTime: "hour-before" }, true, false],
      [{ telemetryEnd: "garbage" }, true, false],
      [{ telemetryQueries: "[]" }, false, true],
      [{ telemetryFormulas: "[]" }, false, true],
      [{ telemetryTime: "custom", telemetryQueries: "[]" }, true, true],
      // Another card's names, or the explorer's own, are none of these.
      [{ metricsTime: "hour-before", metricQueries: "[]" }, false, false],
      // An empty value is no value.
      [{ telemetryTime: "" }, false, false],
    ];

    for (const [params, hasTime, hasQueries] of cases) {
      const input: { prefix: string; read: ReadUrlParamFunction } = {
        prefix: "telemetry",
        read: reader(params),
      };

      expect({
        params,
        time: MetricInvestigationUrl.hasAnyTimeParam(input),
        queries: MetricInvestigationUrl.hasAnyQueryParam(input),
        any: MetricInvestigationUrl.hasAnyParam(input),
      }).toEqual({
        params,
        time: hasTime,
        queries: hasQueries,
        any: hasTime || hasQueries,
      });
    }
  });
});
