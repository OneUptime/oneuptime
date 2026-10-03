import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import FlameGraph from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/FlameGraph";
import Span from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";

/*
 * The trace view's flame graph draws whichever spans the view's search and
 * filters leave. A search that matches no span hands the mounted graph an
 * empty list, and clearing it hands the spans back.
 *
 * The graph's hovered-span lookup (a useMemo) sat below its "No spans to
 * display" return, after eight other hooks. Emptying the list made the
 * graph call one hook fewer, so React threw "Rendered fewer hooks than
 * expected" and the page fell back to its error screen; giving the spans
 * back to an empty graph threw "Rendered more hooks than during the previous
 * render".
 */

const MS: number = 1_000_000;
const START: number = Date.UTC(2026, 8, 14, 12, 0, 0) * MS;
const CHECKOUT_SERVICE: string = "60000000-0000-4000-8000-000000000003";

function span(data: {
  spanId: string;
  parentSpanId: string;
  name: string;
  startMs: number;
  durationMs: number;
}): Span {
  return Object.assign(new Span(), {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: data.spanId,
    parentSpanId: data.parentSpanId,
    name: data.name,
    primaryEntityId: new ObjectID(CHECKOUT_SERVICE),
    startTimeUnixNano: START + data.startMs * MS,
    endTimeUnixNano: START + (data.startMs + data.durationMs) * MS,
    durationUnixNano: data.durationMs * MS,
  });
}

const SPANS: Array<Span> = [
  span({
    spanId: "root",
    parentSpanId: "",
    name: "POST /api/v1/checkout",
    startMs: 0,
    durationMs: 1000,
  }),
  span({
    spanId: "validate",
    parentSpanId: "root",
    name: "OrderService.validateCart",
    startMs: 100,
    durationMs: 600,
  }),
];

const SERVICES: Array<Service> = [
  Object.assign(new Service(), {
    _id: CHECKOUT_SERVICE,
    name: "checkout",
    serviceColor: new Color("#4f46e5"),
  }),
];

function flameGraph(spans: Array<Span>): ReactElement {
  return (
    <FlameGraph
      spans={spans}
      telemetryServices={SERVICES}
      selectedSpanId={undefined}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("FlameGraph", () => {
  test("a graph whose spans are all filtered away, and given back, keeps drawing", () => {
    const { rerender } = render(flameGraph(SPANS));
    expect(screen.getByText("POST /api/v1/checkout")).toBeInTheDocument();

    // Hovering a span opens its tooltip, which the hook in question finds.
    fireEvent.mouseEnter(screen.getByTitle(/^OrderService\.validateCart/));
    expect(screen.getByText("Self Time:")).toBeInTheDocument();

    rerender(flameGraph([]));
    expect(screen.getByText("No spans to display")).toBeInTheDocument();

    rerender(flameGraph(SPANS));
    expect(screen.getByText("POST /api/v1/checkout")).toBeInTheDocument();
    expect(screen.queryByText("No spans to display")).not.toBeInTheDocument();
  });
});
