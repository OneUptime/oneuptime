import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The (i) tooltips on the Service overview: the span tiles and charts, the
 * log and exception charts, and the runtime charts picked by the service's
 * language - whose texts live on RuntimeChartDef so the chart and the
 * fourth tile share one. The texts are held to the shared rules and to what
 * the page computes (a tile averages a level over the range and totals a
 * counter; the runtime fetch averages every series of a metric), and the
 * page is rendered for real over a fake API to show each text beside the
 * right title.
 *
 * jest.mock is hoisted above the imports, so the factories only close over
 * names that start with "mock".
 */

interface MockAggregateCall {
  modelType: { name: string };
  aggregateBy: {
    aggregationType: string;
    query: Record<string, unknown>;
  };
}

interface MockRow {
  timestamp: Date;
  value: number;
}

const mockAggregateCalls: Array<MockAggregateCall> = [];
let mockSdkLanguage: string = "nodejs";
// Keep every span / metric aggregate pending, to see the loading tiles.
let mockHoldAggregates: boolean = false;
// Metric name -> the rows the metric aggregate returns for it.
let mockRuntimeRows: Record<string, Array<MockRow>> = {};

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (call: MockAggregateCall): Promise<unknown> => {
        mockAggregateCalls.push(call);
        if (mockHoldAggregates) {
          return new Promise<unknown>(() => {});
        }
        const at: Date = new Date("2026-09-24T10:00:00.000Z");

        if (call.modelType.name === "Metric") {
          const name: string = String(call.aggregateBy.query["name"]);
          return Promise.resolve({ data: mockRuntimeRows[name] || [] });
        }
        if (call.aggregateBy.aggregationType === "P95") {
          return Promise.resolve({ data: [{ timestamp: at, value: 2.5e8 }] });
        }
        if (call.aggregateBy.query["statusCode"] !== undefined) {
          return Promise.resolve({ data: [{ timestamp: at, value: 3 }] });
        }
        return Promise.resolve({ data: [{ timestamp: at, value: 100 }] });
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve({
          name: "checkout",
          telemetrySdkLanguage: mockSdkLanguage,
          lastSeenAt: new Date(),
        });
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return Promise.resolve({
          data: {
            buckets: [
              {
                time: "2026-09-24T10:00:00.000Z",
                severity: "Error",
                series: "unhandled",
                count: 2,
              },
            ],
          },
        });
      },
      getFriendlyMessage: (): string => {
        return "failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  const ObjectIDModule: { default: new (id: string) => unknown } =
    jest.requireActual("../../../Types/ObjectID") as {
      default: new (id: string) => unknown;
    };
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return new ObjectIDModule.default(
          "aaaaaaaa-0000-4000-8000-000000000001",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  const ObjectIDModule: { default: new (id: string) => unknown } =
    jest.requireActual("../../../Types/ObjectID") as {
      default: new (id: string) => unknown;
    };
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        return new ObjectIDModule.default(
          "dddddddd-0000-4000-8000-000000000004",
        );
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

// Its own counts and cards; not part of this page's metric tooltips.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import ServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Index";
import ChartCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard";
import {
  getRuntimeChartDefs,
  RuntimeChartDef,
  SERVICE_LANGUAGE_DISPLAY_NAMES,
  ServiceLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/serviceGoldenMetrics";
import {
  SERVICE_METRIC_DESCRIPTIONS,
  SERVICE_RUNTIME_METRIC_DESCRIPTIONS,
  ServiceMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/ServiceMetricDescriptions";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/services/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

const D: Record<ServiceMetric, string> = SERVICE_METRIC_DESCRIPTIONS;

const LANGUAGES: Array<ServiceLanguage | null> = [
  ...(Object.keys(SERVICE_LANGUAGE_DISPLAY_NAMES) as Array<ServiceLanguage>),
  null,
];

// Every runtime chart any language can get, once, by key.
function allRuntimeDefs(): Array<RuntimeChartDef> {
  const byKey: Map<string, RuntimeChartDef> = new Map<
    string,
    RuntimeChartDef
  >();

  for (const language of LANGUAGES) {
    for (const def of getRuntimeChartDefs(language)) {
      byKey.set(def.key, def);
    }
  }

  return Array.from(byKey.values());
}

const RUNTIME_DEFS: Array<RuntimeChartDef> = allRuntimeDefs();

// [title, definition] rows for test.each.
const RUNTIME_CASES: Array<[string, RuntimeChartDef]> = RUNTIME_DEFS.map(
  (def: RuntimeChartDef): [string, RuntimeChartDef] => {
    return [def.title, def];
  },
);

// Whether the Service page's fourth tile totals (true) or averages the chart.
function tileTotalsRange(def: RuntimeChartDef): boolean {
  return (
    def.aggregationType === AggregationType.Sum ||
    def.cumulativeCounter === true
  );
}

// The three fixed tiles; the fourth is the first runtime chart, or Technology.
const FIXED_TILES: Array<[string, ServiceMetric]> = [
  ["Requests", "requests"],
  ["Error rate", "errorRate"],
  ["Latency (p95)", "latencyP95"],
];

const FIXED_CHARTS: Array<[string, ServiceMetric]> = [
  ["Requests", "requestsChart"],
  ["Latency (p95)", "latencyP95Chart"],
  ["Logs", "logsChart"],
  ["Exceptions", "exceptionsChart"],
];

describe("SERVICE_METRIC_DESCRIPTIONS", () => {
  test("every text reads as a short, finished, jargon-explaining sentence", () => {
    expectReadableDescriptionRecord(D, "SERVICE_METRIC_DESCRIPTIONS");
  });

  test("covers exactly the fixed tiles, the Technology tile and the fixed charts", () => {
    expect(
      [...FIXED_TILES, ["Technology", "technology"], ...FIXED_CHARTS]
        .map((entry: Array<string>): string => {
          return entry[1] as string;
        })
        .sort(),
    ).toEqual(Object.keys(D).sort());
  });

  test.each([...FIXED_TILES, ...FIXED_CHARTS])(
    "the %s text explains any percentile its title names",
    (title: string, key: ServiceMetric) => {
      expectTitleExplained(title, D[key]);
    },
  );

  test("Requests is honest that it counts every span", () => {
    expect(D.requests).toMatch(/^Every span/);
    // "usually": a request with a single span is one request and one span.
    expect(D.requests).toMatch(/usually higher than the request count/);
    expect(D.requestsChart).toMatch(/Every operation counts/);
  });

  test("the p95 tile is an average of per-interval p95s; the chart is per interval", () => {
    expect(D.latencyP95).toMatch(/95%/);
    expect(D.latencyP95).toMatch(/averaged over the selected range/);
    expect(D.latencyP95).toContain("so quiet and busy intervals count equally");
    expect(D.latencyP95Chart).toMatch(/in each interval/);
    expect(D.latencyP95Chart).not.toMatch(/averaged/);
  });

  test("Error rate names the thresholds the tile uses", () => {
    expect(D.errorRate).toContain("amber at 1%");
    expect(D.errorRate).toContain("red at 5%");
  });

  test("the Logs chart's error line is the severities the histogram counts", () => {
    // ERROR_LOG_SEVERITY_SET in telemetryMetrics.ts.
    expect(D.logsChart).toContain("Error and Fatal");
    expect(D.logsChart).toMatch(/every severity/);
  });

  test("the Exceptions chart explains its two series", () => {
    /*
     * ExceptionAggregationService.mapEscapedToSeries: escaped = true is
     * "unhandled", anything else - false or not set - is "handled". So the
     * text must not promise every handled exception was caught.
     */
    expect(D.exceptionsChart).toMatch(/Unhandled ones were marked as escaping/);
    expect(D.exceptionsChart).toMatch(/handled ones are the rest/);
    expect(D.exceptionsChart).toMatch(/not marked either way/);
    expect(D.exceptionsChart).not.toMatch(/handled ones were caught/);
  });

  test("Technology says where the language comes from and why it is shown", () => {
    expect(D.technology).toContain("telemetry.sdk.language");
    expect(D.technology).toMatch(/no runtime metrics/);
  });
});

describe("SERVICE_RUNTIME_METRIC_DESCRIPTIONS and the runtime chart definitions", () => {
  test("every text reads as a short, finished, jargon-explaining sentence", () => {
    expectReadableDescriptionRecord(
      SERVICE_RUNTIME_METRIC_DESCRIPTIONS,
      "SERVICE_RUNTIME_METRIC_DESCRIPTIONS",
    );
  });

  test("every chart any language can get has its own text, and every text is used", () => {
    const used: Array<string> = RUNTIME_DEFS.map(
      (def: RuntimeChartDef): string => {
        return def.description;
      },
    );

    expect(new Set(used).size).toBe(RUNTIME_DEFS.length);
    expect([...used].sort()).toEqual(
      Object.values(SERVICE_RUNTIME_METRIC_DESCRIPTIONS).sort(),
    );
  });

  test.each(LANGUAGES)(
    "every chart offered for %s carries a description",
    (language: ServiceLanguage | null) => {
      const defs: Array<RuntimeChartDef> = getRuntimeChartDefs(language);

      expect(defs.length).toBeGreaterThan(0);

      for (const def of defs) {
        expect(typeof def.description).toBe("string");
        expect(def.description.length).toBeGreaterThan(0);
      }
    },
  );

  test.each(RUNTIME_CASES)(
    "%s: the text explains any percentile the title names",
    (_title: string, def: RuntimeChartDef) => {
      expectTitleExplained(def.title, def.description);
    },
  );

  test.each(RUNTIME_CASES)(
    "%s: the text says what the tile does with it (total or average)",
    (_title: string, def: RuntimeChartDef) => {
      if (tileTotalsRange(def)) {
        expect(def.description).toMatch(/the total for the selected range/);
        // Max-of-cumulative then deltas follows one series.
        expect(def.description).toMatch(/approximate/);
      } else {
        expect(def.description).toMatch(/average/);
        expect(def.description).not.toMatch(/the total for the selected range/);
        // One wording for the tile's window across every runtime chart.
        expect(def.description).toMatch(
          /[Aa]s a tile it shows the average over the selected range/,
        );
      }
    },
  );

  test.each(
    RUNTIME_CASES.filter((row: [string, RuntimeChartDef]): boolean => {
      return row[1].unit === "percent";
    }),
  )(
    "%s: a percentage says what 100%% means",
    (_title: string, def: RuntimeChartDef) => {
      expect(def.description).toMatch(/100%/);
      // In words, not "100% = ...".
      expect(def.description).not.toContain("100% =");
    },
  );

  test("metrics split by attribute say the value is a per-series average", () => {
    const byKey: Record<string, RuntimeChartDef> = {};

    for (const def of RUNTIME_DEFS) {
      byKey[def.key] = def;
    }

    // Avg over every datapoint of a metric that is split by pool / generation / space / state / mode.
    expect(byKey["jvm-heap"]!.description).toMatch(/not the total heap/);
    expect(byKey["dotnet-gc-heap"]!.description).toMatch(/not the total/);
    expect(byKey["node-heap"]!.description).toMatch(/not the total heap/);
    expect(byKey["jvm-threads"]!.description).toMatch(
      /rather than their total/,
    );
    expect(byKey["process-cpu"]!.description).toMatch(
      /rather than adding them/,
    );
  });

  test("a chart with a fallback metric says what the fallback shows", () => {
    const nodeHeap: RuntimeChartDef | undefined = RUNTIME_DEFS.find(
      (def: RuntimeChartDef): boolean => {
        return def.key === "node-heap";
      },
    );

    expect(
      nodeHeap!.candidates.map((c: { metricName: string }): string => {
        return c.metricName;
      }),
    ).toContain("process.memory.usage");
    expect(nodeHeap!.description).toMatch(/process physical memory/);
  });

  test.each(RUNTIME_CASES)(
    "%s: the chart card shows the text in its (i)",
    async (_title: string, def: RuntimeChartDef) => {
      jest.useFakeTimers();

      try {
        render(
          <ChartCard
            title={def.title}
            icon={def.icon}
            iconColor={def.iconColor}
            series={[]}
            windowStart={null}
            windowEnd={null}
            syncId="runtime-test"
            loading={true}
            description={def.description}
          />,
        );

        await hover(screen.getByRole("button", { name: `About ${def.title}` }));

        expect(screen.getByRole("tooltip")).toHaveTextContent(def.description);
      } finally {
        cleanup();
        jest.useRealTimers();
      }
    },
  );
});

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

function infoButtons(title: string): Array<HTMLElement> {
  return screen.getAllByRole("button", { name: `About ${title}` });
}

function rows(values: Array<number>): Array<MockRow> {
  return values.map((value: number, index: number): MockRow => {
    return {
      timestamp: new Date(Date.UTC(2026, 8, 24, 10, index)),
      value: value,
    };
  });
}

function runtimeDef(key: string): RuntimeChartDef {
  const def: RuntimeChartDef | undefined = RUNTIME_DEFS.find(
    (candidate: RuntimeChartDef): boolean => {
      return candidate.key === key;
    },
  );

  if (!def) {
    throw new Error(`No runtime chart "${key}"`);
  }

  return def;
}

const NODE_ROWS: Record<string, Array<MockRow>> = {
  "nodejs.eventloop.utilization": rows([0.4, 0.44]),
  "nodejs.eventloop.delay.p99": rows([0.012]),
  "v8js.memory.heap.used": rows([50 * 1024 * 1024]),
  "process.cpu.utilization": rows([0.1]),
  "process.memory.usage": rows([80 * 1024 * 1024]),
};

// In the order getRuntimeChartDefs("nodejs") offers them, cut to four.
const NODE_CHART_KEYS: Array<string> = [
  "node-eventloop-util",
  "node-eventloop-delay",
  "node-heap",
  "process-cpu",
];

async function renderService(waitFor: string): Promise<void> {
  render(
    <MemoryRouter>
      <ServiceView {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  // Some values (the language) also appear in the chips and details.
  await screen.findAllByText(waitFor);
  await screen.findByText("250 ms");
}

describe("Service overview page", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAggregateCalls.length = 0;
    mockSdkLanguage = "nodejs";
    mockRuntimeRows = { ...NODE_ROWS };
    mockHoldAggregates = false;
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test("renders one (i) per tile and per chart, runtime charts included", async () => {
    await renderService("42.0%");

    expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(
      FIXED_TILES.length + 1 + FIXED_CHARTS.length + NODE_CHART_KEYS.length,
    );
  });

  test.each(FIXED_TILES)(
    "the %s tile explains itself on hover",
    async (title: string, key: ServiceMetric) => {
      await renderService("42.0%");

      await hover(infoButtons(title)[0]!);

      expect(screen.getByRole("tooltip")).toHaveTextContent(D[key]);
    },
  );

  test.each(FIXED_CHARTS)(
    "the %s chart explains itself on hover",
    async (title: string, key: ServiceMetric) => {
      await renderService("42.0%");

      const buttons: Array<HTMLElement> = infoButtons(title);

      await hover(buttons[buttons.length - 1]!);

      expect(screen.getByRole("tooltip")).toHaveTextContent(D[key]);
    },
  );

  test("the fourth tile is the first runtime chart and shares its text", async () => {
    await renderService("42.0%");

    const def: RuntimeChartDef = runtimeDef("node-eventloop-util");
    const buttons: Array<HTMLElement> = infoButtons(def.title);

    // Once on the tile, once on the chart.
    expect(buttons).toHaveLength(2);

    for (const button of buttons) {
      await hover(button);

      const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");

      expect(tooltips[tooltips.length - 1]).toHaveTextContent(def.description);
      fireEvent.mouseLeave(button);
    }
  });

  test.each(NODE_CHART_KEYS)(
    "the %s runtime chart explains itself on hover",
    async (key: string) => {
      await renderService("42.0%");

      const def: RuntimeChartDef = runtimeDef(key);
      const buttons: Array<HTMLElement> = infoButtons(def.title);

      await hover(buttons[buttons.length - 1]!);

      expect(screen.getByRole("tooltip")).toHaveTextContent(def.description);
    },
  );

  test("a counter chart's tile totals the range, as its text says", async () => {
    /*
     * Python with only GC data: the first (and only) runtime chart is the
     * cumulative GC counter. 10 -> 15 -> 22 gives deltas 5 and 7, so the
     * tile reads 12 - the total its text promises.
     */
    mockSdkLanguage = "python";
    mockRuntimeRows = { "cpython.gc.collections": rows([10, 15, 22]) };

    await renderService("12");

    const def: RuntimeChartDef = runtimeDef("python-gc");

    expect(def.description).toMatch(/the total for the selected range/);

    await hover(infoButtons(def.title)[0]!);

    expect(screen.getByRole("tooltip")).toHaveTextContent(def.description);
  });

  test("with no runtime metrics the Technology tile explains itself", async () => {
    mockRuntimeRows = {};

    await renderService("Node.js");

    await hover(screen.getByRole("button", { name: "About Technology" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(D.technology);
    expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(
      FIXED_TILES.length + 1 + FIXED_CHARTS.length,
    );
  });

  test("the loading tiles and charts keep their (i)", async () => {
    mockHoldAggregates = true;

    render(
      <MemoryRouter>
        <ServiceView {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    await screen.findByText("Loading Requests");

    for (const [title, key] of FIXED_TILES) {
      expect(screen.getByText(`Loading ${title}`)).toBeInTheDocument();

      const button: HTMLElement = infoButtons(title)[0]!;

      await hover(button);

      const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");

      expect(tooltips[tooltips.length - 1]).toHaveTextContent(D[key]);
      fireEvent.mouseLeave(button);
    }

    for (const [title, key] of FIXED_CHARTS) {
      const buttons: Array<HTMLElement> = infoButtons(title);
      const button: HTMLElement = buttons[buttons.length - 1]!;

      await hover(button);

      const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");

      expect(tooltips[tooltips.length - 1]).toHaveTextContent(D[key]);
      fireEvent.mouseLeave(button);
    }

    // No runtime chart is known yet, so the fourth tile is Technology.
    expect(
      screen.getByRole("button", { name: "About Technology" }),
    ).toBeInTheDocument();
  });

  test("no (i) sits inside a link or another button", async () => {
    await renderService("42.0%");

    for (const button of screen.getAllByRole("button", { name: /^About / })) {
      expect(button.closest("a")).toBeNull();
      expect(button.parentElement?.closest("button") ?? null).toBeNull();
    }
  });

  test("the span metrics it explains are every span of this service", async () => {
    await renderService("42.0%");

    const spanCalls: Array<MockAggregateCall> = mockAggregateCalls.filter(
      (call: MockAggregateCall): boolean => {
        return call.modelType.name === "Span";
      },
    );

    expect(spanCalls.length).toBeGreaterThan(0);

    for (const call of spanCalls) {
      expect(call.aggregateBy.query["primaryEntityId"]).toBeDefined();
      // No kind / root filter: "Every span", as the text says.
      expect(call.aggregateBy.query["kind"]).toBeUndefined();
      expect(call.aggregateBy.query["parentSpanId"]).toBeUndefined();
      expect(call.aggregateBy.query["name"]).toBeUndefined();
    }
  });

  test("the runtime metrics it explains are averaged per interval", async () => {
    await renderService("42.0%");

    const gaugeCalls: Array<MockAggregateCall> = mockAggregateCalls.filter(
      (call: MockAggregateCall): boolean => {
        return (
          call.modelType.name === "Metric" &&
          call.aggregateBy.query["name"] === "nodejs.eventloop.utilization"
        );
      },
    );

    expect(gaugeCalls).toHaveLength(1);
    expect(gaugeCalls[0]!.aggregateBy.aggregationType).toBe(
      AggregationType.Avg,
    );
  });
});
