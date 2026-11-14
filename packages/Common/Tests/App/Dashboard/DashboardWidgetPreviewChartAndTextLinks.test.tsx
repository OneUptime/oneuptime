import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #6859: A CHART'S AND A TEXT WIDGET'S CLICK-THROUGHS IN THE WIDGET
 * SETTINGS' LIVE PREVIEW.
 *
 * The widget settings dialog draws the widget as a reader sees it, out of
 * edit mode, over a board being edited - and nothing asks before leaving
 * a board with widgets not saved yet. So in the preview:
 *
 *   - a metric chart offers neither Open in Metric Explorer nor
 *     Investigate, no series menus and no exemplar menus (each goes to
 *     another page), and its incident markers open nothing;
 *   - a text widget's links are their words: no link to click, to a page
 *     of the app or to another site.
 *
 * The same widgets on the board, out of edit mode, keep every one of them.
 * The preview's own zoom stays: it narrows the preview, never the board
 * (DashboardSettingsPreviewZoom).
 *
 * MetricCharts is stood in for by a component that shows what the chart
 * widget hands it - its series and exemplar switches and its event
 * markers, each a button that does what the marker's click does. The
 * markers come from the app's own hook (useEventTimeReferenceLines) over
 * a read of the board's incidents.
 */

jest.setTimeout(120000);

const fetchResultsMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

interface MetricChartsStubProps {
  enableSeriesActions?: boolean | undefined;
  enableExemplarActions?: boolean | undefined;
  timeReferenceLines?:
    | Array<{ label?: string | undefined; onClick?: (() => void) | undefined }>
    | undefined;
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (props: MetricChartsStubProps): React.ReactElement => {
        return react.createElement(
          "div",
          {
            "data-testid": "metric-charts",
            "data-series-actions": String(props.enableSeriesActions !== false),
            "data-exemplar-actions": String(
              props.enableExemplarActions !== false,
            ),
          },
          ...(props.timeReferenceLines || []).map(
            (
              line: {
                label?: string | undefined;
                onClick?: (() => void) | undefined;
              },
              index: number,
            ): React.ReactElement => {
              return react.createElement(
                "button",
                {
                  key: index,
                  type: "button",
                  "data-testid": "event-marker",
                  "data-opens": line.onClick ? "yes" : "no",
                  onClick: () => {
                    line.onClick?.();
                  },
                },
                line.label || "",
              );
            },
          ),
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

// The incidents, alerts and changes the event markers are read from.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

/*
 * react-markdown is ESM and does not run under Common's jest. This one
 * reads a text's [words](address) links and draws each through the
 * viewer's own `a`, as react-markdown does; the rest is words.
 */
jest.mock("react-markdown", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  type LinkComponent = (props: {
    href: string;
    node: unknown;
    children: React.ReactNode;
  }) => React.ReactElement;

  return {
    __esModule: true,
    default: (props: {
      children?: string;
      components?: { a?: LinkComponent };
    }): React.ReactElement => {
      const parts: Array<React.ReactNode> = [];
      let rest: string = String(props.children || "");

      for (;;) {
        const open: number = rest.indexOf("[");
        const middle: number = open < 0 ? -1 : rest.indexOf("](", open);
        const close: number = middle < 0 ? -1 : rest.indexOf(")", middle);

        if (close < 0) {
          parts.push(rest);
          break;
        }

        parts.push(rest.slice(0, open));

        const Link: LinkComponent | string = props.components?.a || "a";

        parts.push(
          react.createElement(Link as LinkComponent, {
            key: parts.length,
            href: rest.slice(middle + 2, close),
            node: {},
            children: rest.slice(open + 1, middle),
          }),
        );
        rest = rest.slice(close + 1);
      }

      return react.createElement(
        "div",
        { "data-testid": "react-markdown" },
        ...parts,
      );
    },
    defaultUrlTransform: (url: string): string => {
      return url;
    },
  };
});

// The settings form is not under test; the preview above it is.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import { MARKDOWN_LINK_TEXT_CLASS_NAME } from "../../../UI/Components/Markdown.tsx/MarkdownLink";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import {
  PREVIEW_BOARD_END,
  PREVIEW_BOARD_START,
  PREVIEW_WIDGET_ID,
  PreviewResizeObserver,
  boardCard,
  drawWidgetOnBoard,
  linksIn,
  openWidgetSettings,
  previewBox,
  roleButtonsIn,
} from "./WidgetPreviewHarness";

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const INCIDENT_ID: string = "11111111-0000-4000-8000-000000006859";

// Midway through the board's week.
const INCIDENT_AT: Date = new Date(
  (PREVIEW_BOARD_START.getTime() + PREVIEW_BOARD_END.getTime()) / 2,
);

function chartComponent(): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: PREVIEW_WIDGET_ID,
    componentType: DashboardComponentType.Chart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: {
      chartTitle: "Checkout latency",
      chartType: DashboardChartType.Line,
      metricQueryConfig: {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "http.server.duration",
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    },
  } as unknown as DashboardBaseComponent;
}

// An in-app page of the same project, and another site.
const RUNBOOK_PATH: string = `/dashboard/${PROJECT_ID.toString()}/runbooks`;
const STATUS_SITE: string = "https://status.example.com/";

function textComponent(): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: PREVIEW_WIDGET_ID,
    componentType: DashboardComponentType.Text,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 1,
    arguments: {
      isMarkdown: true,
      text: `On call? Start with the [runbook](${RUNBOOK_PATH}), then the [status site](${STATUS_SITE}).`,
    },
  } as unknown as DashboardBaseComponent;
}

const OPEN_IN_EXPLORER: string = "Open in Metric Explorer";
const INVESTIGATE: string = "Investigate this time window in a side panel";

function chartIn(element: HTMLElement): HTMLElement {
  return within(element).getByTestId("metric-charts");
}

async function waitForMarker(within: () => HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(
      within().querySelectorAll('[data-testid="event-marker"]').length,
    ).toBe(1);
  });
}

function markerIn(element: HTMLElement): HTMLElement {
  return within(element).getByTestId("event-marker");
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    PreviewResizeObserver;

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: readDashboardLocale("en") } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });

  getListMock.mockReset();
  getListMock.mockImplementation((args: unknown) => {
    const modelName: string = (args as { modelType: { name: string } })
      .modelType.name;

    return Promise.resolve({
      data:
        modelName === "Incident"
          ? [
              {
                id: new ObjectID(INCIDENT_ID),
                createdAt: INCIDENT_AT.toISOString(),
                title: "Checkout is slow",
                incidentSeverity: { name: "Sev1", color: "#ef4444" },
              },
            ]
          : [],
    });
  });

  analyticsGetListMock.mockReset();
  analyticsGetListMock.mockResolvedValue({ data: [] });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
  // The app's router is there to open a page of the app in.
  jest.spyOn(Navigation, "canNavigateInApp").mockReturnValue(true);
  // The board's page, which a link to the same project's runbooks leaves.
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/dashboards/board`,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

describe("a metric chart", () => {
  test("in the settings' preview: no Open in Metric Explorer, no Investigate, no series or exemplar menus", async () => {
    openWidgetSettings(chartComponent());

    await waitFor(() => {
      expect(chartIn(previewBox())).toBeInTheDocument();
    });

    // Its title is drawn, as on the board.
    expect(within(previewBox()).getByText("Checkout latency")).toBeVisible();
    expect(
      within(previewBox()).queryByRole("button", { name: OPEN_IN_EXPLORER }),
    ).toBeNull();
    expect(
      within(previewBox()).queryByRole("button", { name: INVESTIGATE }),
    ).toBeNull();
    expect(chartIn(previewBox())).toHaveAttribute(
      "data-series-actions",
      "false",
    );
    expect(chartIn(previewBox())).toHaveAttribute(
      "data-exemplar-actions",
      "false",
    );
    expect(linksIn(previewBox())).toEqual([]);
    expect(roleButtonsIn(previewBox())).toEqual([]);
  });

  test("in the settings' preview: an incident's marker is drawn, and opens nothing", async () => {
    openWidgetSettings(chartComponent());
    await waitForMarker(previewBox);

    const marker: HTMLElement = markerIn(previewBox());

    expect(marker).toHaveTextContent("Checkout is slow");
    expect(marker).toHaveAttribute("data-opens", "no");

    fireEvent.click(marker);

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("on the board, out of edit mode: Open in Metric Explorer, Investigate, series and exemplar menus", async () => {
    drawWidgetOnBoard(chartComponent());

    await waitFor(() => {
      expect(chartIn(boardCard())).toBeInTheDocument();
    });

    expect(
      within(boardCard()).getByRole("button", { name: INVESTIGATE }),
    ).toBeVisible();
    expect(chartIn(boardCard())).toHaveAttribute("data-series-actions", "true");
    expect(chartIn(boardCard())).toHaveAttribute(
      "data-exemplar-actions",
      "true",
    );

    fireEvent.click(
      within(boardCard()).getByRole("button", { name: OPEN_IN_EXPLORER }),
    );

    // The board's page is left for the Metric Explorer's.
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toContain("/metrics");
  });

  test("on the board, out of edit mode: an incident's marker opens the incident", async () => {
    drawWidgetOnBoard(chartComponent());
    await waitForMarker(boardCard);

    const marker: HTMLElement = markerIn(boardCard());

    expect(marker).toHaveAttribute("data-opens", "yes");

    fireEvent.click(marker);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toContain(INCIDENT_ID);
  });

  test("the preview reads the same markers as the board: it leaves out their clicks, not the read", async () => {
    openWidgetSettings(chartComponent());
    await waitForMarker(previewBox);

    const previewReads: number = getListMock.mock.calls.length;

    cleanup();
    getListMock.mockClear();

    drawWidgetOnBoard(chartComponent());
    await waitForMarker(boardCard);

    expect(getListMock.mock.calls.length).toBe(previewReads);
  });
});

describe("a text widget's links", () => {
  test("in the settings' preview: its links are their words, drawn as links look", async () => {
    openWidgetSettings(textComponent());

    const runbook: HTMLElement =
      await within(previewBox()).findByText("runbook");
    const statusSite: HTMLElement =
      within(previewBox()).getByText("status site");

    expect(linksIn(previewBox())).toEqual([]);

    for (const words of [runbook, statusSite]) {
      expect(words.tagName).toBe("SPAN");
      expect(words.className).toBe(MARKDOWN_LINK_TEXT_CLASS_NAME);
      expect(words).not.toHaveAttribute("href");
      expect(words).not.toHaveAttribute("target");

      fireEvent.click(words);
    }

    // The rest of the text is drawn as on the board.
    expect(previewBox()).toHaveTextContent(
      "On call? Start with the runbook, then the status site.",
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("on the board, out of edit mode: the runbook opens in the app, the status site in a tab of its own", async () => {
    drawWidgetOnBoard(textComponent());

    const runbook: HTMLElement =
      await within(boardCard()).findByText("runbook");
    const statusSite: HTMLElement =
      within(boardCard()).getByText("status site");

    expect(runbook.tagName).toBe("A");
    expect(runbook).toHaveAttribute("href", RUNBOOK_PATH);
    expect(statusSite.tagName).toBe("A");
    expect(statusSite).toHaveAttribute("href", STATUS_SITE);
    expect(statusSite).toHaveAttribute("target", "_blank");

    fireEvent.click(runbook);

    // The board's page is left for the runbooks'.
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(RUNBOOK_PATH);
  });
});
