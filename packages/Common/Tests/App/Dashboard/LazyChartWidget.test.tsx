import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A chart Ask AI draws in an answer is a file of its own (LazyChartWidget),
 * asked for as the panel opens. The panel is part of every Dashboard page,
 * and its static import of the chart put recharts and Common's chart
 * library in the first load of every page, some 183 KiB gzipped (issue
 * #9335).
 *
 * These hold the chart's file back until the test lets it arrive, so the
 * place it is drawn in is seen before and after, and pin the imports that
 * keep it out of every page's first load.
 */

const chartRenderMock: MockFunction = getJestMockFunction();

// What the chart draws is not the point here: whether, and with what, it is drawn.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/ChartWidget",
  () => {
    return {
      __esModule: true,
      default: (props: { widget: { title: string } }): React.ReactElement => {
        chartRenderMock(props);
        return <div data-testid="ai-chart">{props.widget.title}</div>;
      },
    };
  },
);

import LazyChartWidget, {
  CHART_PLOT_HEIGHT_IN_PX,
  CHART_ZOOM_ROW_HEIGHT_IN_PX,
  getChartSkeletonHeightInPx,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/LazyChartWidget";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import { AIChatWidget, AIChatWidgetType } from "../../../Types/AI/AIChatTypes";
import { CHART_SKELETON_TEST_ID } from "../../../UI/Components/Skeleton/ChartSkeleton";
import { LazyLibrary } from "../../../UI/Utils/LazyLibrary";
import { CHUNK_LOAD_RELOAD_STORAGE_KEY } from "../../../UI/Utils/NewVersion/ChunkLoadError";
import TabMemory from "../../../UI/Utils/NewVersion/TabMemory";

const DASHBOARD_COMPONENTS: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components",
);

const read: (relative: string) => string = (relative: string): string => {
  return fs.readFileSync(path.join(DASHBOARD_COMPONENTS, relative), "utf8");
};

const timeSeriesWidget: (title?: string) => AIChatWidget = (
  title: string = "p95 latency of checkout",
): AIChatWidget => {
  return {
    id: "W1",
    type: AIChatWidgetType.TimeSeriesChart,
    title,
    data: {
      unit: "ms",
      series: [
        {
          name: "checkout",
          points: [
            { x: "2026-11-18T10:00:00.000Z", y: 640 },
            { x: "2026-11-18T10:05:00.000Z", y: 655 },
          ],
        },
      ],
    },
  };
};

const categoryWidget: AIChatWidget = {
  id: "W2",
  type: AIChatWidgetType.BarChart,
  title: "Errors by service",
  data: {
    xIsTime: false,
    series: [
      {
        name: "errors",
        points: [
          { x: "checkout", y: 12 },
          { x: "payments", y: 4 },
        ],
      },
    ],
  },
};

interface HeldLoad {
  library: LazyLibrary<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

// What the real load would have done: LazyLibrary.load, not held back.
const realLoad: () => Promise<unknown> = LazyLibrary.prototype.load;

let held: Array<HeldLoad> = [];

const tick: () => Promise<void> = async (): Promise<void> => {
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
};

// Lets the file asked for arrive.
const arrive: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    while (held.length > 0) {
      const load: HeldLoad = held.shift() as HeldLoad;

      realLoad.call(load.library).then(load.resolve, load.reject);

      await tick();
    }

    await tick();
  });
};

interface CrashBoundaryProps {
  children: React.ReactNode;
}

interface CrashBoundaryState {
  error: Error | null;
}

// Stands for an error boundary over the answer, which the Ask AI panel has not.
class CrashBoundary extends React.Component<
  CrashBoundaryProps,
  CrashBoundaryState
> {
  public constructor(props: CrashBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  public static getDerivedStateFromError(error: Error): CrashBoundaryState {
    return { error: error };
  }

  public override render(): React.ReactNode {
    if (this.state.error) {
      return <div data-testid="crashed">{this.state.error.message}</div>;
    }

    return this.props.children;
  }
}

const skeletonHeight: () => string = (): string => {
  const plot: HTMLElement = screen.getByTestId(
    `${CHART_SKELETON_TEST_ID}-plot`,
  );

  // The plot's column, whose height ChartSkeleton sets to the chart's.
  return (plot.parentElement?.parentElement as HTMLElement).style.height;
};

beforeEach(() => {
  held = [];
  chartRenderMock.mockReset();
  // No reload into a new version is remembered from an earlier test.
  TabMemory.remove(CHUNK_LOAD_RELOAD_STORAGE_KEY);

  // Nothing has loaded, whatever an earlier test let arrive.
  jest.spyOn(LazyLibrary.prototype, "getLoaded").mockReturnValue(null);

  jest.spyOn(LazyLibrary.prototype, "load").mockImplementation(function (
    this: LazyLibrary<unknown>,
  ): Promise<unknown> {
    return new Promise(
      (
        resolve: (value: unknown) => void,
        reject: (error: unknown) => void,
      ): void => {
        held.push({ library: this, resolve, reject });
      },
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a chart Ask AI draws, as an answer draws it", () => {
  test("its place holds the chart's skeleton while its file comes, and the chart once it arrives, with the widget it was given", async () => {
    const widget: AIChatWidget = timeSeriesWidget();

    render(<LazyChartWidget widget={widget} />);

    // On its way: the skeleton, a busy status, and the file asked for once.
    expect(screen.getByTestId(CHART_SKELETON_TEST_ID)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("ai-chart")).toBeNull();
    expect(held).toHaveLength(1);

    await arrive();

    expect(screen.getByTestId("ai-chart")).toHaveTextContent(
      "p95 latency of checkout",
    );
    expect(screen.queryByTestId(CHART_SKELETON_TEST_ID)).toBeNull();
    expect(
      (
        chartRenderMock.mock.calls[
          chartRenderMock.mock.calls.length - 1
        ]?.[0] as { widget: AIChatWidget }
      ).widget,
    ).toBe(widget);
  });

  test("the skeleton is as tall as the chart: the zoom hint's row over the plot on a time axis, the plot alone on another", () => {
    expect(CHART_PLOT_HEIGHT_IN_PX).toBe(240);
    expect(CHART_ZOOM_ROW_HEIGHT_IN_PX).toBe(24);

    expect(getChartSkeletonHeightInPx({ widget: timeSeriesWidget() })).toBe(
      264,
    );
    expect(getChartSkeletonHeightInPx({ widget: categoryWidget })).toBe(240);

    render(<LazyChartWidget widget={timeSeriesWidget()} />);
    expect(skeletonHeight()).toBe("264px");
    cleanup();

    render(<LazyChartWidget widget={categoryWidget} />);
    expect(skeletonHeight()).toBe("240px");
  });

  test("the heights are ChartWidget's own: its plot is h-60, and a time axis's zoom hint sits in a min-h-6 row", () => {
    const source: string = read("AIChat/Widgets/ChartWidget.tsx");

    expect(source).toContain('<div className="h-60 w-full">');
    expect(source).toContain("heightInPx={240}");
    expect(source).toContain(
      '<div className="flex min-h-6 items-center justify-end gap-2">',
    );
    expect(source).toContain("widget.data.xIsTime !== false");
  });

  test("once its file is there, a chart drawn after draws from its first frame, asking for nothing", () => {
    const loaded: { default: unknown } = jest.requireMock(
      "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/ChartWidget",
    ) as { default: unknown };

    jest
      .spyOn(LazyLibrary.prototype, "getLoaded")
      .mockReturnValue(loaded.default);

    render(<LazyChartWidget widget={timeSeriesWidget("Checkout errors")} />);

    expect(screen.getByTestId("ai-chart")).toHaveTextContent("Checkout errors");
    expect(screen.queryByTestId(CHART_SKELETON_TEST_ID)).toBeNull();
    expect(held).toHaveLength(0);
  });

  test("if its file does not arrive, the chart's place says so, nothing is thrown, and the rest of the answer stays", async () => {
    render(
      <CrashBoundary>
        <p>{"The checkout's p95 rose at 10:05."}</p>
        <LazyChartWidget widget={timeSeriesWidget()} />
      </CrashBoundary>,
    );

    await act(async () => {
      (held.shift() as HeldLoad).reject(
        new Error("The file could not be read"),
      );

      await tick();
    });

    expect(
      await screen.findByText("This couldn't be loaded."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chunk-load-recovery")).toHaveAttribute(
      "data-variant",
      "part",
    );
    // The way out: a reload.
    expect(screen.getByTestId("chunk-load-recovery-reload")).toBeEnabled();

    // The Ask AI panel has no error boundary of its own: nothing reached one.
    expect(screen.queryByTestId("crashed")).toBeNull();
    expect(screen.getByText("The checkout's p95 rose at 10:05.")).toBeVisible();
    expect(screen.queryByTestId("ai-chart")).toBeNull();
    expect(screen.queryByTestId(CHART_SKELETON_TEST_ID)).toBeNull();
  });

  test("an answer's chart widget is drawn through it", async () => {
    render(<WidgetRenderer widgets={[timeSeriesWidget()]} />);

    expect(screen.getByTestId(CHART_SKELETON_TEST_ID)).toBeInTheDocument();
    expect(screen.getByText("p95 latency of checkout")).toBeInTheDocument();

    await arrive();

    expect(screen.getByTestId("ai-chart")).toBeInTheDocument();
  });
});

describe("the imports that keep the chart out of every page's first load", () => {
  test("WidgetRenderer draws a chart through LazyChartWidget", () => {
    const source: string = read("AIChat/Widgets/WidgetRenderer.tsx");

    expect(source).toContain(
      'import LazyChartWidget from "./LazyChartWidget";',
    );
    expect(source).not.toMatch(/from "\.\/ChartWidget"/);
  });

  test("LazyChartWidget reads the chart's types, and loads the chart only with import()", () => {
    const source: string = read("AIChat/Widgets/LazyChartWidget.tsx");

    const staticImports: Array<string> = Array.from(
      source.matchAll(/^import[^;]*from "\.\/ChartWidget";$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[0];
    });

    expect(staticImports).toEqual([
      'import type ChartWidget from "./ChartWidget";',
      'import type { ComponentProps } from "./ChartWidget";',
    ]);
    expect(source).toContain('await import("./ChartWidget")');
  });

  test("the Ask AI panel asks for the chart's file as it opens", () => {
    const source: string = read("AIChat/AskAiPanel.tsx");

    expect(source).toContain(
      'import { loadChartWidget } from "./Widgets/LazyChartWidget";',
    );
    expect(source).toMatch(
      /if \(isOpen\) \{\s*loadChartWidget\(\)\.catch\(\(\): void => \{\}\);\s*\}/,
    );
  });
});
