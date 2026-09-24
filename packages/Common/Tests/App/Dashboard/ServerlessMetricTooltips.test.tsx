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
 * The (i) tooltips on the Serverless function overview: the texts
 * themselves (rules plus what the page really computes), and the page,
 * rendered for real over a fake API, showing each text beside the right
 * tile and chart.
 *
 * Everything the page fetches through is stubbed inline - jest.mock is
 * hoisted above the imports, so the factories may only close over names
 * that start with "mock".
 */

interface MockAggregateCall {
  modelType: { name: string };
  aggregateBy: {
    aggregationType: string;
    query: Record<string, unknown>;
  };
}

interface MockCountCall {
  modelType: { name: string };
  query: Record<string, unknown>;
}

const mockAggregateCalls: Array<MockAggregateCall> = [];
const mockCountCalls: Array<MockCountCall> = [];
let mockInstanceCount: number = 7;
// Keep the span aggregates and the instance count pending forever.
let mockHold: boolean = false;

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (call: MockAggregateCall): Promise<unknown> => {
        mockAggregateCalls.push(call);
        if (mockHold) {
          return new Promise<unknown>(() => {});
        }
        const at: Date = new Date("2026-09-24T10:00:00.000Z");
        const type: string = call.aggregateBy.aggregationType;

        if (type === "P95") {
          // 250 ms, in nanoseconds.
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
          name: "checkout-handler",
          functionIdentifier: "checkout-handler",
          otelCollectorStatus: "connected",
          cloudPlatform: "aws_lambda",
          cloudRegion: "us-east-1",
          runtimeName: "nodejs",
          runtimeVersion: "20",
        });
      },
      count: (call: MockCountCall): Promise<number> => {
        mockCountCalls.push(call);
        if (mockHold) {
          return new Promise<number>(() => {});
        }
        return Promise.resolve(mockInstanceCount);
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
          "bbbbbbbb-0000-4000-8000-000000000002",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (): string => {
        return "failed";
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

// Recharts does not lay out in jsdom; what is under test is the header.
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

import ServerlessFunctionOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/View/Overview";
import {
  SERVERLESS_METRIC_DESCRIPTIONS,
  ServerlessMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/ServerlessMetricDescriptions";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/serverless/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

const D: Record<ServerlessMetric, string> = SERVERLESS_METRIC_DESCRIPTIONS;

// Title on the page -> the text its (i) must show, in page order.
const TILES: Array<[string, ServerlessMetric]> = [
  ["Invocations", "invocations"],
  ["Error rate", "errorRate"],
  ["p95 duration", "p95Duration"],
  ["Instances", "instances"],
];

const CHARTS: Array<[string, ServerlessMetric]> = [
  ["Invocations", "invocationsChart"],
  ["p95 duration", "p95DurationChart"],
];

describe("SERVERLESS_METRIC_DESCRIPTIONS", () => {
  test("every text reads as a short, finished, jargon-explaining sentence", () => {
    expectReadableDescriptionRecord(D, "SERVERLESS_METRIC_DESCRIPTIONS");
  });

  test("covers exactly the tiles and charts on the page", () => {
    expect(
      [...TILES, ...CHARTS]
        .map((entry: [string, ServerlessMetric]): string => {
          return entry[1];
        })
        .sort(),
    ).toEqual(Object.keys(D).sort());
  });

  test.each([...TILES, ...CHARTS])(
    "the %s text explains any percentile its title names",
    (title: string, key: ServerlessMetric) => {
      expectTitleExplained(title, D[key]);
    },
  );

  test("Invocations is honest that it counts spans, not invocations", () => {
    // fetchSpanMetrics has no root-span filter: every span with the faas.name.
    expect(D.invocations).toMatch(/spans/i);
    expect(D.invocations).toContain("faas.name");
    expect(D.invocations).toMatch(/higher than the true invocation count/);
    expect(D.invocationsChart).toMatch(/several spans/);
  });

  test("the p95 tile says it is an average of per-interval p95s", () => {
    expect(D.p95Duration).toMatch(/95%/);
    expect(D.p95Duration).toContain(
      "Worked out for each interval on the chart",
    );
    expect(D.p95Duration).toMatch(/averaged over the selected range/);
    // The Service, Cloud and RUM p95 tiles say the same.
    expect(D.p95Duration).toContain(
      "so quiet and busy intervals count equally",
    );
  });

  test("the p95 chart is per interval and does not claim a range average", () => {
    expect(D.p95DurationChart).toMatch(/in each interval/);
    expect(D.p95DurationChart).not.toMatch(/averaged/);
  });

  test("Error rate names the bar's thresholds the page actually uses", () => {
    expect(D.errorRate).toContain("amber at 1%");
    expect(D.errorRate).toContain("red at 5%");
    expect(D.errorRate).toMatch(/status was set to Error/);
  });

  test("Instances says it ignores the time picker and how rows age out", () => {
    // ModelAPI.count with no lastSeenAt filter; the cleanup job prunes rows.
    expect(D.instances).toMatch(/whatever the selected range/);
    expect(D.instances).toMatch(/15 minutes/);
    expect(D.instances).toMatch(/idle function keeps its last list/);
    /*
     * Serverless:CleanupStaleResources prunes only CONNECTED functions, and
     * anchors the cutoff to the function's own lastSeenAt - so an
     * environment goes only while the function keeps reporting.
     */
    expect(D.instances).toMatch(/while the function keeps reporting/);
    expect(D.instances).toContain("faas.instance");
  });

  test("Invocations does not promise a span per invocation", () => {
    // Nothing in the fetch guarantees one; the text must hedge.
    expect(D.invocations).toMatch(/usually produces one span/);
    expect(D.invocations).not.toMatch(/at least one span/);
  });
});

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <ServerlessFunctionOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  // The instance count is the last thing the page fetches.
  await screen.findByText(String(mockInstanceCount));
  await screen.findByText("250 ms");
}

function infoButtons(title: string): Array<HTMLElement> {
  return screen.getAllByRole("button", { name: `About ${title}` });
}

describe("Serverless function overview page", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAggregateCalls.length = 0;
    mockCountCalls.length = 0;
    mockInstanceCount = 7;
    mockHold = false;
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test("renders one (i) per tile and per chart, and no more", async () => {
    await renderOverview();

    const all: Array<HTMLElement> = screen.getAllByRole("button", {
      name: /^About /,
    });

    expect(all).toHaveLength(TILES.length + CHARTS.length);
  });

  test.each(TILES)(
    "the %s tile explains itself on hover",
    async (title: string, key: ServerlessMetric) => {
      await renderOverview();

      // Tiles render before the charts, so the tile's (i) is the first.
      await hover(infoButtons(title)[0]!);

      expect(screen.getByRole("tooltip")).toHaveTextContent(D[key]);
    },
  );

  test.each(CHARTS)(
    "the %s chart explains itself on hover",
    async (title: string, key: ServerlessMetric) => {
      await renderOverview();

      const buttons: Array<HTMLElement> = infoButtons(title);

      await hover(buttons[buttons.length - 1]!);

      expect(screen.getByRole("tooltip")).toHaveTextContent(D[key]);
    },
  );

  test("the loading tiles and charts keep their (i)", async () => {
    mockHold = true;

    render(
      <MemoryRouter>
        <ServerlessFunctionOverview {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    await screen.findByText("Loading Invocations");

    for (const [title, key] of TILES) {
      expect(screen.getByText(`Loading ${title}`)).toBeInTheDocument();

      const button: HTMLElement = infoButtons(title)[0]!;

      await hover(button);

      const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");

      expect(tooltips[tooltips.length - 1]).toHaveTextContent(D[key]);
      fireEvent.mouseLeave(button);
    }

    for (const [title, key] of CHARTS) {
      const buttons: Array<HTMLElement> = infoButtons(title);
      const button: HTMLElement = buttons[buttons.length - 1]!;

      await hover(button);

      const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");

      expect(tooltips[tooltips.length - 1]).toHaveTextContent(D[key]);
      fireEvent.mouseLeave(button);
    }
  });

  test("the Instances count it explains is not bounded by the time range", async () => {
    await renderOverview();

    const instanceCounts: Array<MockCountCall> = mockCountCalls.filter(
      (call: MockCountCall): boolean => {
        return call.modelType.name === "ServerlessFunctionInstance";
      },
    );

    expect(instanceCounts).toHaveLength(1);
    // Only the function, no lastSeenAt window: "whatever the selected range".
    expect(Object.keys(instanceCounts[0]!.query)).toEqual([
      "serverlessFunctionId",
    ]);
  });

  test("no (i) sits inside a link or another button", async () => {
    await renderOverview();

    for (const button of screen.getAllByRole("button", { name: /^About / })) {
      expect(button.closest("a")).toBeNull();
      expect(button.parentElement?.closest("button") ?? null).toBeNull();
    }
  });

  test("the linked Instances tile still links, beside its (i)", async () => {
    await renderOverview();

    const link: HTMLElement = screen.getByRole("link", {
      name: "View Instances",
    });

    expect(link.getAttribute("href")).toMatch(/instances/);

    const tile: HTMLElement = link.parentElement as HTMLElement;

    expect(
      tile.querySelector('button[aria-label="About Instances"]'),
    ).not.toBeNull();
  });

  test("the span metrics it explains are scoped by faas.name alone", async () => {
    /*
     * The Invocations text says "matched by its faas.name attribute"; pin
     * that the fetch really is that scope, with no primary-entity filter.
     */
    await renderOverview();

    const spanCalls: Array<MockAggregateCall> = mockAggregateCalls.filter(
      (call: MockAggregateCall): boolean => {
        return call.modelType.name === "Span";
      },
    );

    expect(spanCalls.length).toBeGreaterThan(0);

    for (const call of spanCalls) {
      expect(call.aggregateBy.query["attributes"]).toEqual({
        "resource.faas.name": "checkout-handler",
      });
      expect(call.aggregateBy.query["primaryEntityId"]).toBeUndefined();
      // Every span, not only root or server spans.
      expect(call.aggregateBy.query["kind"]).toBeUndefined();
      expect(call.aggregateBy.query["parentSpanId"]).toBeUndefined();
    }
  });
});
