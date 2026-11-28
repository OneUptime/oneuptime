import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  lazyDashboardWidget,
  LazyDashboardWidgetShape,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/LazyDashboardWidget";
import { CHART_SKELETON_TEST_ID } from "../../../UI/Components/Skeleton/ChartSkeleton";
import { TABLE_SKELETON_TEST_ID } from "../../../UI/Components/Skeleton/TableSkeleton";

/*
 * A WIDGET THE BOARD LOADS THE FIRST TIME IT DRAWS ONE (LazyDashboardWidget).
 *
 * The widgets a public dashboard cannot draw - logs, traces, security
 * events, product analytics and cloud costs - are files of their own in the
 * board's registry (DashboardBaseComponent), so a public dashboard's visitor
 * does not download them, and the models they read, before the board draws
 * (packages/Common/Scripts/first-load-budgets.js). These hold the widget's
 * file back until the test lets it arrive: its place draws the widget's own
 * skeleton meanwhile, and the widget, with what the board hands it, after.
 */

interface WidgetProps {
  title: string;
}

const Widget: React.FunctionComponent<WidgetProps> = (
  props: WidgetProps,
): React.ReactElement => {
  return <div data-testid="the-widget">{props.title}</div>;
};

interface HeldLoad {
  resolve: (widget: React.ComponentType<WidgetProps>) => void;
  reject: (error: Error) => void;
}

interface HeldLoader {
  loadWidget: () => Promise<React.ComponentType<WidgetProps>>;
  held: Array<HeldLoad>;
}

// A widget's file, which arrives (or does not) when the test says so.
function heldLoader(): HeldLoader {
  const held: Array<HeldLoad> = [];

  return {
    held: held,
    loadWidget: (): Promise<React.ComponentType<WidgetProps>> => {
      return new Promise(
        (
          resolve: (widget: React.ComponentType<WidgetProps>) => void,
          reject: (error: Error) => void,
        ): void => {
          held.push({ resolve, reject });
        },
      );
    },
  };
}

interface CrashBoundaryProps {
  children: React.ReactNode;
}

interface CrashBoundaryState {
  error: Error | null;
}

// Stands for the boundary the board draws each widget in.
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

afterEach(() => {
  cleanup();
});

describe("a widget the board loads the first time it draws one", () => {
  test("draws a chart's skeleton until its file arrives, then the widget with what the board hands it", async () => {
    const loader: HeldLoader = heldLoader();
    const LazyWidget: React.FunctionComponent<WidgetProps> =
      lazyDashboardWidget<WidgetProps>({
        loadWidget: loader.loadWidget,
        shape: LazyDashboardWidgetShape.Chart,
      });

    render(<LazyWidget title="Errors by service" />);

    expect(screen.getByTestId(CHART_SKELETON_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByTestId("the-widget")).not.toBeInTheDocument();
    // Asked for as soon as it is drawn, not before.
    expect(loader.held).toHaveLength(1);

    await act(async () => {
      loader.held[0]!.resolve(Widget);
    });

    expect(screen.getByTestId("the-widget")).toHaveTextContent(
      "Errors by service",
    );
    expect(
      screen.queryByTestId(CHART_SKELETON_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a table's widget draws a table's rows meanwhile", () => {
    const loader: HeldLoader = heldLoader();
    const LazyWidget: React.FunctionComponent<WidgetProps> =
      lazyDashboardWidget<WidgetProps>({
        loadWidget: loader.loadWidget,
        shape: LazyDashboardWidgetShape.Table,
      });

    render(<LazyWidget title="Slowest operations" />);

    expect(screen.getByTestId(TABLE_SKELETON_TEST_ID)).toBeInTheDocument();
    expect(
      screen.queryByTestId(CHART_SKELETON_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("asks for its file once however many of it a board draws, and one drawn after it arrived is there from the first frame", async () => {
    const loader: HeldLoader = heldLoader();
    const LazyWidget: React.FunctionComponent<WidgetProps> =
      lazyDashboardWidget<WidgetProps>({
        loadWidget: loader.loadWidget,
        shape: LazyDashboardWidgetShape.Chart,
      });

    render(
      <>
        <LazyWidget title="First" />
        <LazyWidget title="Second" />
      </>,
    );

    expect(loader.held).toHaveLength(1);

    await act(async () => {
      loader.held[0]!.resolve(Widget);
    });

    expect(screen.getAllByTestId("the-widget")).toHaveLength(2);

    cleanup();
    render(<LazyWidget title="Third" />);

    expect(screen.getByTestId("the-widget")).toHaveTextContent("Third");
    expect(loader.held).toHaveLength(1);
  });

  test("a file that does not arrive is thrown to the widget's place, and the next draw asks for it again", async () => {
    const loader: HeldLoader = heldLoader();
    const LazyWidget: React.FunctionComponent<WidgetProps> =
      lazyDashboardWidget<WidgetProps>({
        loadWidget: loader.loadWidget,
        shape: LazyDashboardWidgetShape.Chart,
      });

    render(
      <CrashBoundary>
        <LazyWidget title="Errors by service" />
      </CrashBoundary>,
    );

    await act(async () => {
      loader.held[0]!.reject(
        new Error("Failed to fetch dynamically imported module"),
      );
    });

    // The board's boundary says so in the widget's place (ChunkLoadRecovery).
    expect(screen.getByTestId("crashed")).toHaveTextContent(
      "Failed to fetch dynamically imported module",
    );

    cleanup();
    render(
      <CrashBoundary>
        <LazyWidget title="Errors by service" />
      </CrashBoundary>,
    );

    expect(loader.held).toHaveLength(2);

    await act(async () => {
      loader.held[1]!.resolve(Widget);
    });

    expect(screen.getByTestId("the-widget")).toHaveTextContent(
      "Errors by service",
    );
  });
});
