/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The trace monitor's preview, on the overview and in the criteria form.
 * TraceTable is stubbed to record what it is handed. Three things are
 * pinned: the query never carries the evaluation window toQuery() stamps
 * (a window frozen when the page opened empties out a minute later), the
 * table neither reads nor writes the page URL, and the query object is only
 * rebuilt when the filter itself changes - TraceTable refetches whenever it
 * is handed a new one.
 */

const mockTraceTableProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceTable",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        mockTraceTableProps.push(props);
        const ReactModule: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        return ReactModule.createElement(
          "div",
          { "data-testid": "trace-table" },
          "Trace table",
        );
      },
    };
  },
);

import TraceMonitorPreview, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TraceMonitor/TraceMonitorPreview";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../../Types/Monitor/MonitorStepTraceMonitor";

const traceMonitor: (
  overrides?: Partial<MonitorStepTraceMonitor>,
) => MonitorStepTraceMonitor = (
  overrides?: Partial<MonitorStepTraceMonitor>,
): MonitorStepTraceMonitor => {
  return {
    ...MonitorStepTraceMonitorUtil.getDefault(),
    spanName: "checkout",
    spanStatuses: [SpanStatus.Error],
    lastXSecondsOfSpans: 300,
    ...overrides,
  };
};

const lastTableProps: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  const props: Record<string, unknown> | undefined =
    mockTraceTableProps[mockTraceTableProps.length - 1];

  if (!props) {
    throw new Error("TraceTable was never rendered");
  }

  return props;
};

const renderPreview: (props: ComponentProps) => RenderResult = (
  props: ComponentProps,
): RenderResult => {
  return render(<TraceMonitorPreview {...props} />);
};

afterEach(() => {
  cleanup();
  mockTraceTableProps.length = 0;
});

describe("TraceMonitorPreview", () => {
  test("the span query has the monitor's filter but no startTime window", () => {
    // toQuery() itself does stamp the window: that is what must be removed.
    expect(
      Object.keys(MonitorStepTraceMonitorUtil.toQuery(traceMonitor())),
    ).toContain("startTime");

    renderPreview({ monitorStepTraceMonitor: traceMonitor() });

    const query: Query<Span> = lastTableProps()["spanQuery"] as Query<Span>;

    expect(Object.keys(query)).not.toContain("startTime");
    expect(query.name).toBeInstanceOf(Search);
    expect((query.name as Search<string>).toString()).toBe("checkout");
    expect(Object.keys(query)).toContain("statusCode");
  });

  test("the table is minimal, ignores the URL, and says what an empty result means", () => {
    renderPreview({ monitorStepTraceMonitor: traceMonitor() });

    const props: Record<string, unknown> = lastTableProps();
    expect(props["disableUrlState"]).toBe(true);
    expect(props["isMinimalTable"]).toBe(true);
    expect(props["noItemsMessage"]).toBe(
      "No spans match this monitor's filter right now.",
    );
  });

  test("an equal trace monitor keeps the same query object across re-renders", () => {
    const view: RenderResult = renderPreview({
      monitorStepTraceMonitor: traceMonitor(),
    });
    const first: unknown = lastTableProps()["spanQuery"];

    // A new object with the same content, as a poll hands down.
    view.rerender(
      <TraceMonitorPreview monitorStepTraceMonitor={traceMonitor()} />,
    );
    expect(mockTraceTableProps.length).toBeGreaterThan(1);
    expect(lastTableProps()["spanQuery"]).toBe(first);

    view.rerender(
      <TraceMonitorPreview
        monitorStepTraceMonitor={traceMonitor({ spanName: "payments" })}
      />,
    );
    const second: Query<Span> = lastTableProps()["spanQuery"] as Query<Span>;
    expect(second).not.toBe(first);
    expect((second.name as Search<string>).toString()).toBe("payments");
  });

  test("no trace monitor gives an empty query", () => {
    renderPreview({ monitorStepTraceMonitor: undefined });

    expect(lastTableProps()["spanQuery"]).toEqual({});
  });

  test("on the overview it is a card of its own", () => {
    renderPreview({
      monitorStepTraceMonitor: traceMonitor(),
      context: "overview",
    });

    expect(
      screen.getByRole("heading", { name: "Traces preview" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "The newest spans that match this monitor's filter.",
    );
    expect(screen.getByTestId("card")).toContainElement(
      screen.getByTestId("trace-table"),
    );
  });

  test("the overview card's description can say which step is shown", () => {
    renderPreview({
      monitorStepTraceMonitor: traceMonitor(),
      context: "overview",
      description: "Previewing the first of 3 criteria steps.",
    });

    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Previewing the first of 3 criteria steps.",
    );
  });

  test("in the criteria form it is just the table, under the form's own heading", () => {
    renderPreview({ monitorStepTraceMonitor: traceMonitor() });

    expect(screen.queryByTestId("card")).toBeNull();
    expect(screen.getByTestId("trace-table")).toBeInTheDocument();
  });
});
