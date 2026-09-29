import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The bucket inspector ("Investigate this moment") and a double-click on a
 * chart that has no zoom to reset (issue #4105, found driving Kubernetes
 * Insights in a real browser).
 *
 * With no reset on offer, a chart acts on a click at once, so the first
 * click of a double-click opens the inspector at the pointer. Clamped into
 * the viewport, the inspector covers the pointer, and the rest of the
 * double-click landed on it: its second press selected the word under the
 * pointer ("Pod" of "Pod CPU Utilization"), and its click pressed whatever
 * button was there - "Investigate this moment" opened the drawer. The
 * inspector now ignores the rest of the click sequence that opened it, and
 * its chrome is not selectable at all. Its values still are.
 *
 * Real MetricCharts on real recharts (ResponsiveContainer given a size):
 * the plot click resolves a bucket exactly as it does in the page.
 */

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, {
        width: 600,
        height: 300,
      } as Record<string, unknown>);
    },
  };
});

const fetchExemplarsMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchExemplars: (...args: Array<any>) => {
          fetchExemplarsMock(...args);
          // Never settles: no exemplar dots, no late setState.
          return new Promise(() => {
            // Intentionally never settles.
          });
        },
        setQueryTopNOverride: () => {
          return undefined;
        },
        getQueryConfigTopNKey: (
          _queryConfig: unknown,
          index: number,
          scope?: string,
        ) => {
          return `${scope || ""}:${index}`;
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
        serializeAttributeFiltersForKey: (attributes: unknown) => {
          return JSON.stringify(attributes || {});
        },
      },
      DEFAULT_TOP_N_SERIES: 10,
      SHOW_ALL_SERIES_TOP_N: 10_000,
      sanitizeAttributeFilters: (attributes: unknown) => {
        return attributes;
      },
    };
  },
);

// What the drawer shows is not the point here, only whether it opened.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }) => {
        return <div data-testid="investigation-drawer-stub">{props.title}</div>;
      },
    };
  },
);

import MetricCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-1111-4111-8111-777777777777",
);

const WINDOW_START: Date = new Date("2026-08-20T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-20T10:30:00.000Z");
const MINUTE_MS: number = 60 * 1000;

function buildViewData(): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "a",
          title: "Pod CPU Utilization",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "k8s.pod.cpu.utilization",
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
          groupByAttributeKeys: ["k8s.pod.name"],
        },
      } as unknown as MetricQueryConfigData,
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as MetricViewData;
}

// Two pods, one point a minute across the whole window.
function buildResults(): Array<AggregatedResult> {
  const data: Array<Record<string, unknown>> = [];
  for (const pod of ["api-7d9f", "worker-5c2b"]) {
    for (let minute: number = 0; minute < 30; minute++) {
      data.push({
        timestamp: new Date(WINDOW_START.getTime() + minute * MINUTE_MS),
        value: pod === "api-7d9f" ? 40 + minute : 10 + minute,
        attributes: { "k8s.pod.name": pod },
      });
    }
  }
  return [{ data, truncated: false } as unknown as AggregatedResult];
}

function renderCharts(): HTMLElement {
  const { container } = render(
    <MetricCharts
      metricViewData={buildViewData()}
      metricResults={buildResults()}
      metricTypes={[]}
      /*
       * As MetricView hands them over while nothing is zoomed: a drag
       * zooms, and there is no reset, so a click is acted on at once.
       */
      onTimeRangeSelect={() => {
        return undefined;
      }}
    />,
  );
  return container;
}

/*
 * The first click of a double-click on the plot: it opens the inspector,
 * as a lone click does.
 */
function clickPlot(container: HTMLElement): HTMLElement {
  const wrapper: Element | null = container.querySelector(".recharts-wrapper");
  const ticks: Array<Element> = Array.from(
    container.querySelectorAll(
      ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value",
    ),
  );
  if (!wrapper || ticks.length < 2) {
    throw new Error("the chart did not render its plot");
  }
  const clientX: number = Number(ticks[1]!.getAttribute("x"));
  const at: { clientX: number; clientY: number } = {
    clientX: clientX,
    clientY: 60,
  };

  fireEvent.mouseMove(wrapper, at);
  fireEvent.mouseDown(wrapper, { ...at, button: 0, detail: 1 });
  fireEvent.mouseUp(wrapper, { ...at, button: 0, detail: 1 });
  fireEvent.click(wrapper, { ...at, button: 0, detail: 1 });

  return screen.getByRole("dialog", { name: /^Values at/ });
}

function queryInspector(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: /^Values at/ });
}

function drawerOpened(): boolean {
  return screen.queryByTestId("investigation-drawer-stub") !== null;
}

interface InspectorParts {
  title: HTMLElement;
  window: HTMLElement;
  rowNumber: HTMLElement;
  seriesName: HTMLElement;
  value: HTMLElement;
  close: HTMLElement;
  investigate: HTMLElement;
}

function partsOf(inspector: HTMLElement): InspectorParts {
  const paragraphs: Array<HTMLElement> = Array.from(
    inspector.querySelectorAll("p"),
  );
  const rowNumber: HTMLElement | undefined = Array.from(
    inspector.querySelectorAll("span"),
  ).find((span: HTMLElement): boolean => {
    return span.textContent === "1.";
  });
  const seriesName: HTMLElement | undefined = rowNumber?.parentElement as
    | HTMLElement
    | undefined;
  const value: HTMLElement | undefined = seriesName?.nextElementSibling as
    | HTMLElement
    | undefined;
  const buttons: Array<HTMLElement> = Array.from(
    inspector.querySelectorAll("button"),
  );

  if (
    paragraphs.length < 2 ||
    !rowNumber ||
    !seriesName ||
    !value ||
    buttons.length !== 2
  ) {
    throw new Error("the inspector is not laid out as expected");
  }

  return {
    title: paragraphs[0]!,
    window: paragraphs[1]!,
    rowNumber: rowNumber,
    seriesName: seriesName,
    value: value,
    close: buttons[0]!,
    investigate: buttons[1]!,
  };
}

// A press; false when something prevented its default (no selection).
function press(target: HTMLElement, clickCount: number): boolean {
  return fireEvent.mouseDown(target, { button: 0, detail: clickCount });
}

// A whole press-release-click at one spot, counted as `clickCount`.
function pressAndClick(target: HTMLElement, clickCount: number): void {
  press(target, clickCount);
  fireEvent.mouseUp(target, { button: 0, detail: clickCount });
  fireEvent.click(target, { button: 0, detail: clickCount });
}

beforeEach(() => {
  fetchExemplarsMock.mockReset();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

describe("the bucket inspector a click on an unzoomed chart opens", () => {
  test("a lone click on the plot opens it, with the chart's title, the bucket's window and each series' value", () => {
    const container: HTMLElement = renderCharts();

    const inspector: HTMLElement = clickPlot(container);
    const parts: InspectorParts = partsOf(inspector);

    expect(parts.title).toHaveTextContent("Pod CPU Utilization");
    expect(parts.window.textContent).toMatch(/\S/);
    expect(parts.seriesName.textContent).toContain("api-7d9f");
    expect(parts.investigate).toHaveTextContent("Investigate this moment");
    expect(drawerOpened()).toBe(false);
  });

  test.each([
    ["the title", "title"],
    ["the bucket's window", "window"],
    ["a row number", "rowNumber"],
    ["a series name", "seriesName"],
    ["a value", "value"],
    ["the Close button", "close"],
    ["the Investigate button", "investigate"],
  ])(
    "the second press of the double-click that opened it selects no word of %s",
    (_label: string, part: string) => {
      const container: HTMLElement = renderCharts();
      const parts: InspectorParts = partsOf(clickPlot(container));

      const target: HTMLElement = parts[part as keyof InspectorParts];

      // Its default is a word selection: prevented.
      expect(press(target, 2)).toBe(false);
    },
  );

  test("the rest of that double-click presses no button: Investigate this moment opens no drawer", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.investigate, 2);
    fireEvent.doubleClick(parts.investigate, { button: 0, detail: 2 });

    expect(drawerOpened()).toBe(false);
    // The inspector the first click opened is still there to use.
    expect(queryInspector()).toBe(parts.investigate.closest('[role="dialog"]'));
  });

  test("...and Close does not close the inspector the first click opened", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.close, 2);

    expect(queryInspector()).not.toBeNull();
  });

  test("a triple-click's third press and click are ignored the same way", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.investigate, 2);
    expect(press(parts.investigate, 3)).toBe(false);
    fireEvent.mouseUp(parts.investigate, { button: 0, detail: 3 });
    fireEvent.click(parts.investigate, { button: 0, detail: 3 });

    expect(drawerOpened()).toBe(false);
    expect(queryInspector()).not.toBeNull();
  });

  test("once pressed afresh it is an ordinary card: a double-click may select a value's word", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    expect(press(parts.seriesName, 1)).toBe(true);
    expect(press(parts.seriesName, 2)).toBe(true);
  });

  test("once pressed afresh, a click presses its button: Investigate this moment opens the drawer", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.investigate, 1);

    expect(drawerOpened()).toBe(true);
    expect(screen.getByTestId("investigation-drawer-stub")).toHaveTextContent(
      "Pod CPU Utilization",
    );
    expect(queryInspector()).toBeNull();
  });

  test("once pressed afresh, Close closes it", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.close, 1);

    expect(queryInspector()).toBeNull();
  });

  test("a button pressed from the keyboard (a click counted 0) works with no press at all", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    fireEvent.click(parts.investigate, { detail: 0 });

    expect(drawerOpened()).toBe(true);
  });

  test("each opening starts over: a press on the last inspector lets no later double-click through", () => {
    const container: HTMLElement = renderCharts();
    const first: InspectorParts = partsOf(clickPlot(container));

    // Used, then closed.
    expect(press(first.seriesName, 1)).toBe(true);
    pressAndClick(first.close, 1);
    expect(queryInspector()).toBeNull();

    // A later double-click opens a new one, whose rest is ignored again.
    const second: InspectorParts = partsOf(clickPlot(container));
    expect(press(second.title, 2)).toBe(false);
    pressAndClick(second.investigate, 2);
    expect(drawerOpened()).toBe(false);
  });

  test("its chrome is not selectable; the window, the series names and the values are", () => {
    const container: HTMLElement = renderCharts();
    const inspector: HTMLElement = clickPlot(container);
    const parts: InspectorParts = partsOf(inspector);

    expect(inspector).toHaveClass("select-none");
    for (const chrome of [
      parts.title,
      parts.close,
      parts.investigate,
    ] as Array<HTMLElement>) {
      expect(chrome).not.toHaveClass("select-text");
    }
    // The row number sits inside the selectable name, so it opts out.
    expect(parts.rowNumber).toHaveClass("select-none");

    for (const value of [
      parts.window,
      parts.seriesName,
      parts.value,
    ] as Array<HTMLElement>) {
      expect(value).toHaveClass("select-text");
    }
  });
});
