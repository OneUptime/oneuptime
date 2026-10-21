import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardWidgetTimeRangeZoom, {
  DashboardHistogramWindow,
  DashboardWidgetTimeRangeZoomHandlers,
  DashboardWidgetTimeRangeZoomProps,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardWidgetTimeRangeZoom";
import { HistogramSelectionWindow } from "Common/UI/Components/Charts/Utils/HistogramSelection";

/*
 * Issue #4105 wiring pins for custom dashboards (both shells) and the AI
 * chat charts.
 *
 * The behaviour is exercised against rendered components in Common's RTL
 * suites:
 *
 *   Common/Tests/App/Dashboard/DashboardBoardWideZoomShell.test.tsx  (authenticated shell, every widget)
 *   Common/Tests/App/Dashboard/PublicDashboardBoardWideZoom.test.tsx  (public shell)
 *   Common/Tests/App/Dashboard/DashboardHistogramWidgetZoom.test.tsx  (log + trace charts)
 *   Common/Tests/App/Dashboard/DashboardSloAndDataSourceChartZoom.test.tsx
 *   Common/Tests/App/Dashboard/ValueWidgetSparklineZoom.test.tsx
 *   Common/Tests/App/Dashboard/DashboardSettingsPreviewZoom.test.tsx   (settings preview + canvas)
 *   Common/Tests/App/Dashboard/AIChatChartWidgetZoom.test.tsx
 *
 * App's jest runs in node and cannot render React, so what is pinned here
 * is the wiring those suites cannot see break from where they stand: which
 * files hand which handlers to what, and which surfaces must never offer a
 * page's zoom. Sources are whitespace-squashed so prettier's wrapping does
 * not matter. The pure helper behind every widget's gates is tested for
 * real at the bottom.
 */

function readSource(relative: string): string {
  return fs.readFileSync(path.join(__dirname, "../..", relative), "utf8");
}

function readSquashed(relative: string): string {
  return readSource(relative).replace(/\s+/g, " ");
}

/*
 * The same source with its comments removed, for "never mentions" pins:
 * these files explain in prose the very identifiers the pins look for.
 * Block comments and whole-line // comments go; a // inside a string (a
 * URL) is left alone.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const DASHBOARD_SRC: string = "FeatureSet/Dashboard/src";
const WIDGETS: string = `${DASHBOARD_SRC}/Components/Dashboard/Components`;

const AUTHENTICATED_SHELL: string = `${DASHBOARD_SRC}/Components/Dashboard/DashboardView.tsx`;
const PUBLIC_SHELL: string =
  "FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage.tsx";
const PUBLIC_CANVAS: string =
  "FeatureSet/PublicDashboard/src/Components/DashboardCanvas.tsx";
const CANVAS: string = `${DASHBOARD_SRC}/Components/Dashboard/Canvas/Index.tsx`;
const SETTINGS_MODAL: string = `${DASHBOARD_SRC}/Components/Dashboard/Canvas/ComponentSettingsModal.tsx`;
const HISTOGRAM_ZOOM: string = `${DASHBOARD_SRC}/Components/Dashboard/Utils/UseDashboardHistogramZoom.ts`;

const METRIC_CHART_WIDGET: string = `${WIDGETS}/DashboardChartComponent.tsx`;
const DATA_SOURCE_CHART_WIDGET: string = `${WIDGETS}/DashboardDataSourceChartComponent.tsx`;
const LOG_CHART_WIDGET: string = `${WIDGETS}/DashboardLogChartComponent.tsx`;
const TRACE_CHART_WIDGET: string = `${WIDGETS}/DashboardTraceChartComponent.tsx`;
const SLO_WIDGET: string = `${WIDGETS}/DashboardSloComponent.tsx`;
const VALUE_WIDGET: string = `${WIDGETS}/DashboardValueComponent.tsx`;
const DATA_SOURCE_VALUE_WIDGET: string = `${WIDGETS}/DashboardDataSourceValueComponent.tsx`;
const VALUE_VIEW: string = `${WIDGETS}/ValueWidgetView.tsx`;

const APP_ROOT: string = `${DASHBOARD_SRC}/App.tsx`;
const AI_COPILOT_PAGE: string = `${DASHBOARD_SRC}/Pages/AICopilot/AICopilot.tsx`;
const AI_CHAT_PANEL: string = `${DASHBOARD_SRC}/Components/AIChat/AIChatPanel.tsx`;
const CHAT_MESSAGE_LIST: string = `${DASHBOARD_SRC}/Components/AIChat/ChatMessageList.tsx`;
const WIDGET_RENDERER: string = `${DASHBOARD_SRC}/Components/AIChat/Widgets/WidgetRenderer.tsx`;
const CHART_WIDGET: string = `${DASHBOARD_SRC}/Components/AIChat/Widgets/ChartWidget.tsx`;
const EVIDENCE_LIST: string = `${DASHBOARD_SRC}/Components/AI/InvestigationReport/InvestigationEvidenceList.tsx`;

describe("both dashboard shells drive every widget's zoom", () => {
  test.each([
    ["the authenticated dashboard", AUTHENTICATED_SHELL],
    ["the public dashboard", PUBLIC_SHELL],
  ])(
    "%s hands its one zoom to the canvas",
    (_name: string, shellPath: string) => {
      const shell: string = readSquashed(shellPath);

      expect(shell).toContain(
        "onDashboardTimeRangeSelect={timeRangeZoom.zoomToTimeRange}",
      );
      expect(shell).toContain(
        "onDashboardTimeRangeReset={timeRangeZoom.resetZoom}",
      );
      expect(shell).toContain(
        "isDashboardTimeRangeZoomed={timeRangeZoom.isZoomed}",
      );
    },
  );

  test("the public dashboard renders the very same canvas, so every widget's wiring applies there too", () => {
    expect(readSquashed(PUBLIC_CANVAS)).toContain(
      '"../../../Dashboard/src/Components/Dashboard/Canvas/Index"',
    );
  });

  test("the canvas threads the board's zoom to every widget and withdraws any page's", () => {
    const canvas: string = readSquashed(CANVAS);

    expect(canvas).toContain(
      "onDashboardTimeRangeSelect={props.onDashboardTimeRangeSelect}",
    );
    expect(canvas).toContain(
      "onDashboardTimeRangeReset={props.onDashboardTimeRangeReset}",
    );
    expect(canvas).toContain(
      "isDashboardTimeRangeZoomed={props.isDashboardTimeRangeZoomed}",
    );
    expect(canvas).toContain(
      "return <TimeRangeZoomProvider zoom={null}>{canvas}</TimeRangeZoomProvider>;",
    );
  });
});

describe("every time-series widget gates the board's gestures the same way", () => {
  test.each([
    ["Data Source chart", DATA_SOURCE_CHART_WIDGET],
    ["Log chart", LOG_CHART_WIDGET],
    ["Trace chart", TRACE_CHART_WIDGET],
    ["SLO chart", SLO_WIDGET],
    ["metric Value", VALUE_WIDGET],
    ["Data Source Value", DATA_SOURCE_VALUE_WIDGET],
  ])(
    "the %s widget reads its handlers from the shared gate, and its memo lets a change through",
    (_name: string, widgetPath: string) => {
      const widget: string = readSquashed(widgetPath);

      expect(widget).toContain(
        "DashboardWidgetTimeRangeZoom.getHandlers(props)",
      );
      /*
       * Every widget is React.memo'd on a comparator that skips most prop
       * changes. Without this line a board that becomes zoomed would never
       * arm the widget's double-click.
       */
      expect(widget).toContain(
        "!DashboardWidgetTimeRangeZoom.isSameZoom(prev, next) ||",
      );
    },
  );

  test("the metric chart widget still hands MetricCharts explicit handlers, so no page zoom can override them", () => {
    const widget: string = readSquashed(METRIC_CHART_WIDGET);

    expect(widget).toContain(
      "onTimeRangeSelect={ enableChartZoom ? handleChartTimeRangeSelect : undefined }",
    );
    expect(widget).toContain(
      "onTimeRangeReset={ canResetChartZoom ? handleChartTimeRangeReset : undefined }",
    );
  });

  test("the Data Source chart hands MetricCharts the board's handlers", () => {
    const widget: string = readSquashed(DATA_SOURCE_CHART_WIDGET);

    expect(widget).toContain(
      "onTimeRangeSelect={timeRangeZoom.onTimeRangeSelect}",
    );
    expect(widget).toContain(
      "onTimeRangeReset={timeRangeZoom.onTimeRangeReset}",
    );
  });

  test("the SLO chart hands its line chart the board's handlers and takes no other zoom", () => {
    const widget: string = readSquashed(SLO_WIDGET);

    expect(widget).toContain(
      "onTimeRangeSelect={timeRangeZoom.onTimeRangeSelect}",
    );
    expect(widget).toContain(
      "onTimeRangeReset={timeRangeZoom.onTimeRangeReset}",
    );
    expect(widget).toContain(
      "disableTimeRangeZoom={ !timeRangeZoom.onTimeRangeSelect && !timeRangeZoom.onTimeRangeReset }",
    );
    // A zoom into a stretch with no history still has its way back.
    expect(widget).toContain("onDoubleClick={timeRangeZoom.onTimeRangeReset}");
  });

  test.each([
    ["metric Value", VALUE_WIDGET],
    ["Data Source Value", DATA_SOURCE_VALUE_WIDGET],
  ])(
    "the %s widget hands its sparkline the board's handlers",
    (_name: string, widgetPath: string) => {
      const widget: string = readSquashed(widgetPath);

      expect(widget).toContain(
        "onTimeRangeSelect={timeRangeZoom.onTimeRangeSelect}",
      );
      expect(widget).toContain(
        "onTimeRangeReset={timeRangeZoom.onTimeRangeReset}",
      );
    },
  );

  test("the value view passes both gestures on to the sparkline and its empty state", () => {
    const view: string = readSquashed(VALUE_VIEW);

    expect(view).toContain("onTimeRangeSelect={props.onTimeRangeSelect}");
    expect(view).toContain("onTimeRangeReset={props.onTimeRangeReset}");
    expect(view).toContain("onDoubleClick={props.onTimeRangeReset}");
    // The drag ends even when released outside the tiny line.
    expect(view).toContain('window.addEventListener("mouseup", finishDrag);');
    expect(view).toContain(
      'window.removeEventListener("mouseup", finishDrag);',
    );
  });
});

describe("the log and trace charts wire the histogram gesture into every chart type", () => {
  test.each([
    ["Log chart", LOG_CHART_WIDGET],
    ["Trace chart", TRACE_CHART_WIDGET],
  ])("the %s widget", (_name: string, widgetPath: string) => {
    const widget: string = readSquashed(widgetPath);

    expect(widget).toContain(
      "const selection: HistogramRangeSelectionState = useDashboardHistogramZoom({ zoom: timeRangeZoom,",
    );

    // Line, area and bar: a chart type left out would silently not zoom.
    for (const handler of ["onMouseDown", "onMouseMove", "onMouseUp"]) {
      const wired: RegExpMatchArray | null = widget.match(
        new RegExp(`${handler}=\\{selection\\.${handler}\\}`, "g"),
      );
      expect([handler, wired?.length]).toEqual([handler, 3]);
    }

    const bands: RegExpMatchArray | null = widget.match(/\{selectionBand\}/g);
    expect(bands?.length).toBe(3);

    expect(widget).toContain("onDoubleClick={selection.onDoubleClick}");
    expect(widget).toContain(
      "{...(selection.isDragging ? { active: false } : {})}",
    );
  });

  test("a plain click never zooms a dashboard: the bucket width is kept from the shared hook", () => {
    const hook: string = readCode(HISTOGRAM_ZOOM);

    expect(hook).toContain("return useHistogramRangeSelection({");
    /*
     * Handing the hook bucketIntervalMs turns a single click on a bar into
     * a zoom into that bar, which on a board retimes every panel at once.
     */
    expect(hook).not.toContain("bucketIntervalMs");
    expect(hook).toContain(
      "DashboardWidgetTimeRangeZoom.getHistogramZoomWindow({",
    );
  });

  test("the trace chart remembers the bucket width its rows were fetched at", () => {
    const widget: string = readSquashed(TRACE_CHART_WIDGET);

    expect(widget).toContain(
      'bucketSizeInMinutes: Number(requestData["bucketSizeInMinutes"]),',
    );
    expect(widget).toContain("fetchedWindow: chartWindow,");
  });
});

describe("the Component Settings preview zooms itself, never the board", () => {
  test("the preview widget is handed the preview's own zoom and range", () => {
    const modal: string = readSquashed(SETTINGS_MODAL);

    expect(modal).toContain("dashboardStartAndEndDate={previewRange}");
    expect(modal).toContain(
      "onDashboardTimeRangeSelect={previewZoom.zoomToTimeRange}",
    );
    expect(modal).toContain(
      "onDashboardTimeRangeReset={previewZoom.resetZoom}",
    );
    expect(modal).toContain(
      "isDashboardTimeRangeZoomed={previewZoom.isZoomed}",
    );
    expect(modal).toContain(
      "<TimeRangeZoomProvider zoom={previewZoom}> <ResetTimeRangeZoomButton /> </TimeRangeZoomProvider>",
    );
  });

  test("the board's handlers never reach the modal", () => {
    const modalCode: string = readCode(SETTINGS_MODAL);
    const canvas: string = readSquashed(CANVAS);

    expect(modalCode).not.toContain("props.onDashboardTimeRange");
    expect(modalCode).not.toContain("props.isDashboardTimeRangeZoomed");

    const modalElementIndex: number = canvas.indexOf("<ComponentSettingsModal");
    expect(modalElementIndex).toBeGreaterThan(-1);
    const modalElement: string = canvas.slice(
      modalElementIndex,
      canvas.indexOf(
        "/>",
        canvas.indexOf("totalCurrentDashboardWidthInPx=", modalElementIndex),
      ),
    );
    expect(modalElement).not.toContain("onDashboardTimeRange");
    expect(modalElement).not.toContain("isDashboardTimeRangeZoomed");
  });
});

describe("AI chat charts zoom on their own and never retime the page behind them", () => {
  test("the chat panel is mounted at the app root with no zoom around it", () => {
    const appRoot: string = readCode(APP_ROOT);

    expect(appRoot).toContain("<AIChatPanel />");
    /*
     * A scope at this level would make every time-series chart in the chat
     * retime whatever page happens to be open behind the panel.
     */
    expect(appRoot).not.toContain("TimeRangeZoom");
  });

  test.each([
    ["the AI Copilot page", AI_COPILOT_PAGE],
    ["the chat panel", AI_CHAT_PANEL],
    ["the chat transcript", CHAT_MESSAGE_LIST],
    ["the investigation evidence list", EVIDENCE_LIST],
  ])(
    "%s owns no time range for its charts to zoom",
    (_name: string, sourcePath: string) => {
      expect(readCode(sourcePath)).not.toContain("TimeRangeZoomScope");
    },
  );

  test("every AI widget reaches the charts through the renderer, which withdraws a page's zoom", () => {
    expect(readSquashed(CHAT_MESSAGE_LIST)).toContain(
      "<WidgetRenderer widgets={widgets} />",
    );
    expect(readSquashed(EVIDENCE_LIST)).toContain(
      "<WidgetRenderer widgets={[response.widget]} />",
    );
    expect(readSquashed(WIDGET_RENDERER)).toContain(
      "<TimeRangeZoomProvider zoom={null}>",
    );
  });

  test("the chart widget zooms itself: explicit handlers, its own provider, categories excluded", () => {
    const widget: string = readSquashed(CHART_WIDGET);

    expect(widget).toContain(
      "const isTimeAxis: boolean = widget.data.xIsTime !== false;",
    );
    expect(widget).toContain("<TimeRangeZoomProvider zoom={ownZoom}>");
    const explicit: RegExpMatchArray | null = widget.match(
      /onTimeRangeSelect=\{onTimeRangeSelect\} onTimeRangeReset=\{onTimeRangeReset\} disableTimeRangeZoom=\{!isTimeAxis\}/g,
    );
    // Both the line and the bar variant.
    expect(explicit?.length).toBe(2);
  });

  test("the chart widget never writes to the widget it was handed", () => {
    const widget: string = readCode(CHART_WIDGET);

    expect(widget).not.toMatch(/widget\.data\.[A-Za-z]+\s*=[^=]/);
    expect(widget).not.toMatch(/\.points\s*=[^=]/);
  });
});

describe("non-time-series visuals stay out of drag-to-zoom", () => {
  test.each([
    ["the gauge", `${WIDGETS}/GaugeWidgetView.tsx`],
    ["the metric gauge widget", `${WIDGETS}/DashboardGaugeComponent.tsx`],
    [
      "the Data Source gauge widget",
      `${WIDGETS}/DashboardDataSourceGaugeComponent.tsx`,
    ],
    [
      "the security events flow",
      `${WIDGETS}/DashboardSecurityEventsFlowComponent.tsx`,
    ],
    [
      "the LLM usage breakdown",
      `${DASHBOARD_SRC}/Components/AI/LlmUsageBreakdown.tsx`,
    ],
    [
      "the chat's PDF chart",
      `${DASHBOARD_SRC}/Components/AIChat/Export/PdfChart.ts`,
    ],
  ])("%s", (_name: string, sourcePath: string) => {
    const code: string = readCode(sourcePath);

    expect(code).not.toContain("onDashboardTimeRangeSelect");
    expect(code).not.toContain("onTimeRangeSelect");
    expect(code).not.toContain("DashboardWidgetTimeRangeZoom");
  });
});

describe("DashboardWidgetTimeRangeZoom", () => {
  const select: (startTime: Date, endTime: Date) => void = (): void => {
    // Stands for the shell's identity-stable handler.
  };
  const reset: () => void = (): void => {
    // Stands for the shell's identity-stable handler.
  };

  function props(
    overrides: Partial<DashboardWidgetTimeRangeZoomProps> = {},
  ): DashboardWidgetTimeRangeZoomProps {
    return {
      isEditMode: false,
      onDashboardTimeRangeSelect: select,
      onDashboardTimeRangeReset: reset,
      isDashboardTimeRangeZoomed: false,
      ...overrides,
    };
  }

  describe("getHandlers", () => {
    test("a board that is not zoomed offers the drag and no reset", () => {
      const handlers: DashboardWidgetTimeRangeZoomHandlers =
        DashboardWidgetTimeRangeZoom.getHandlers(props());

      expect(handlers.onTimeRangeSelect).toBe(select);
      expect(handlers.onTimeRangeReset).toBeUndefined();
    });

    test("a zoomed board offers both", () => {
      const handlers: DashboardWidgetTimeRangeZoomHandlers =
        DashboardWidgetTimeRangeZoom.getHandlers(
          props({ isDashboardTimeRangeZoomed: true }),
        );

      expect(handlers.onTimeRangeSelect).toBe(select);
      expect(handlers.onTimeRangeReset).toBe(reset);
    });

    test("edit mode offers neither, zoomed or not", () => {
      for (const isDashboardTimeRangeZoomed of [false, true]) {
        const handlers: DashboardWidgetTimeRangeZoomHandlers =
          DashboardWidgetTimeRangeZoom.getHandlers(
            props({ isEditMode: true, isDashboardTimeRangeZoomed }),
          );

        expect(handlers.onTimeRangeSelect).toBeUndefined();
        expect(handlers.onTimeRangeReset).toBeUndefined();
      }
    });

    test("a host that owns no range offers nothing", () => {
      const handlers: DashboardWidgetTimeRangeZoomHandlers =
        DashboardWidgetTimeRangeZoom.getHandlers({
          isEditMode: false,
          isDashboardTimeRangeZoomed: true,
        });

      expect(handlers.onTimeRangeSelect).toBeUndefined();
      expect(handlers.onTimeRangeReset).toBeUndefined();
    });
  });

  describe("isSameZoom", () => {
    test("new handler identities alone are the same zoom", () => {
      expect(
        DashboardWidgetTimeRangeZoom.isSameZoom(
          props(),
          props({
            onDashboardTimeRangeSelect: (): void => {
              // A fresh lambda from a re-rendering parent.
            },
            onDashboardTimeRangeReset: (): void => {
              // A fresh lambda from a re-rendering parent.
            },
          }),
        ),
      ).toBe(true);
    });

    test("the board becoming zoomed is a different zoom", () => {
      expect(
        DashboardWidgetTimeRangeZoom.isSameZoom(
          props(),
          props({ isDashboardTimeRangeZoomed: true }),
        ),
      ).toBe(false);
    });

    test("a gesture appearing or going away is a different zoom", () => {
      expect(
        DashboardWidgetTimeRangeZoom.isSameZoom(
          props(),
          props({ onDashboardTimeRangeSelect: undefined }),
        ),
      ).toBe(false);
      expect(
        DashboardWidgetTimeRangeZoom.isSameZoom(
          props(),
          props({ onDashboardTimeRangeReset: undefined }),
        ),
      ).toBe(false);
    });

    test("undefined and false zoom state are the same", () => {
      expect(
        DashboardWidgetTimeRangeZoom.isSameZoom(
          props({ isDashboardTimeRangeZoomed: undefined }),
          props({ isDashboardTimeRangeZoomed: false }),
        ),
      ).toBe(true);
    });
  });

  describe("getHistogramZoomWindow", () => {
    const MINUTE_MS: number = 60 * 1000;
    const fetched: DashboardHistogramWindow = {
      startTime: new Date("2026-09-28T10:00:00.000Z"),
      endTime: new Date("2026-09-28T10:59:30.000Z"),
      bucketSizeInMinutes: 1,
    };

    test("runs from the first bar through the END of the last", () => {
      const zoomWindow: HistogramSelectionWindow =
        DashboardWidgetTimeRangeZoom.getHistogramZoomWindow({
          firstBucketStart: new Date("2026-09-28T10:15:00.000Z"),
          lastBucketStart: new Date("2026-09-28T10:17:00.000Z"),
          fetchedWindow: fetched,
        });

      expect(zoomWindow.startTime.toISOString()).toBe(
        "2026-09-28T10:15:00.000Z",
      );
      expect(zoomWindow.endTime.toISOString()).toBe("2026-09-28T10:18:00.000Z");
    });

    test("is the same window whichever way the drag went", () => {
      const forwards: HistogramSelectionWindow =
        DashboardWidgetTimeRangeZoom.getHistogramZoomWindow({
          firstBucketStart: new Date("2026-09-28T10:15:00.000Z"),
          lastBucketStart: new Date("2026-09-28T10:17:00.000Z"),
          fetchedWindow: fetched,
        });
      const backwards: HistogramSelectionWindow =
        DashboardWidgetTimeRangeZoom.getHistogramZoomWindow({
          firstBucketStart: new Date("2026-09-28T10:17:00.000Z"),
          lastBucketStart: new Date("2026-09-28T10:15:00.000Z"),
          fetchedWindow: fetched,
        });

      expect(backwards).toEqual(forwards);
    });

    test("stops at the end of the fetched window when the last bar is still filling", () => {
      const zoomWindow: HistogramSelectionWindow =
        DashboardWidgetTimeRangeZoom.getHistogramZoomWindow({
          firstBucketStart: new Date("2026-09-28T10:57:00.000Z"),
          lastBucketStart: new Date("2026-09-28T10:59:00.000Z"),
          fetchedWindow: fetched,
        });

      expect(zoomWindow.endTime).toEqual(fetched.endTime);
    });

    test("uses the bucket width the bars were fetched at", () => {
      const zoomWindow: HistogramSelectionWindow =
        DashboardWidgetTimeRangeZoom.getHistogramZoomWindow({
          firstBucketStart: new Date("2026-09-28T10:00:00.000Z"),
          lastBucketStart: new Date("2026-09-28T10:15:00.000Z"),
          fetchedWindow: { ...fetched, bucketSizeInMinutes: 15 },
        });

      expect(zoomWindow.endTime.getTime()).toBe(
        new Date("2026-09-28T10:15:00.000Z").getTime() + 15 * MINUTE_MS,
      );
    });

    test("without a fetched window it runs label to label", () => {
      const zoomWindow: HistogramSelectionWindow =
        DashboardWidgetTimeRangeZoom.getHistogramZoomWindow({
          firstBucketStart: new Date("2026-09-28T10:15:00.000Z"),
          lastBucketStart: new Date("2026-09-28T10:17:00.000Z"),
          fetchedWindow: null,
        });

      expect(zoomWindow.endTime.toISOString()).toBe("2026-09-28T10:17:00.000Z");
    });

    test("an unusable bucket width is ignored rather than trusted", () => {
      for (const bucketSizeInMinutes of [0, -5, Number.NaN]) {
        const zoomWindow: HistogramSelectionWindow =
          DashboardWidgetTimeRangeZoom.getHistogramZoomWindow({
            firstBucketStart: new Date("2026-09-28T10:15:00.000Z"),
            lastBucketStart: new Date("2026-09-28T10:17:00.000Z"),
            fetchedWindow: { ...fetched, bucketSizeInMinutes },
          });

        expect(zoomWindow.endTime.toISOString()).toBe(
          "2026-09-28T10:17:00.000Z",
        );
      }
    });
  });
});
