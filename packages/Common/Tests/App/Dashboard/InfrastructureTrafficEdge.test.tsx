import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { EdgeProps, Position } from "reactflow";
import {
  TrafficEdgeData,
  TrafficRouteEdge,
  trafficDirectPath,
  trafficLanePath,
  trafficRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph";
import { InfrastructureTrafficLink } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";

/*
 * The edge that draws the Infrastructure map's traffic, rendered with the
 * real React Flow BaseEdge (the map's own tests replace React Flow). Which
 * path it draws depends on what the layout gave the line: a lane, slots to
 * run through, or a label position on a direct line.
 */

const LINK: InfrastructureTrafficLink = {
  id: "a\u0000b",
  from: "a",
  to: "b",
  calls: 900,
  errors: 0,
  avgDurationMs: 12,
  health: "healthy",
  serviceCalls: [],
};

function edgeProps(
  data: TrafficEdgeData,
  overrides: Partial<EdgeProps<TrafficEdgeData>> = {},
): EdgeProps<TrafficEdgeData> {
  return {
    id: "traffic:0",
    source: "a",
    target: "b",
    sourceX: 256,
    sourceY: 60,
    targetX: 612,
    targetY: 60,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data,
    label: "60/min",
    labelShowBg: true,
    style: { stroke: "#16a34a", strokeWidth: 2 },
    markerEnd: "url(#arrow)",
    interactionWidth: 20,
    ...overrides,
  } as EdgeProps<TrafficEdgeData>;
}

function drawnPath(props: EdgeProps<TrafficEdgeData>): {
  d: string | null;
  label: string | null;
  labelTransform: string | null;
  markerEnd: string | null;
} {
  const { container } = render(
    <svg>
      <TrafficRouteEdge {...props} />
    </svg>,
  );
  const path: Element | null = container.querySelector(
    "path.react-flow__edge-path",
  );
  const label: Element | null = container.querySelector(
    ".react-flow__edge-textwrapper",
  );
  return {
    d: path?.getAttribute("d") || null,
    label: label?.textContent || null,
    labelTransform: label?.getAttribute("transform") || null,
    markerEnd: path?.getAttribute("marker-end") || null,
  };
}

beforeAll(() => {
  /* jsdom has no SVG layout; EdgeText measures its label with getBBox. */
  (
    window.SVGElement.prototype as unknown as {
      getBBox: () => { x: number; y: number; width: number; height: number };
    }
  ).getBBox = () => {
    return { x: 0, y: 0, width: 40, height: 14 };
  };
});

afterEach(() => {
  cleanup();
});

describe("TrafficRouteEdge", () => {
  test("a direct line is the default curve, labeled where the layout said", () => {
    const drawn: ReturnType<typeof drawnPath> = drawnPath(
      edgeProps({ link: LINK, labelT: 0.25 }),
    );
    const expected: { path: string; labelX: number; labelY: number } =
      trafficDirectPath({
        sourceX: 256,
        sourceY: 60,
        targetX: 612,
        targetY: 60,
        t: 0.25,
      });
    expect(drawn.d).toBe(expected.path);
    expect(drawn.d).toBe("M 256,60 C 434,60 434,60 612,60");
    expect(drawn.label).toBe("60/min");
    // The label sits a quarter of the way along, not in the middle.
    expect(drawn.labelTransform).toContain(`translate(${expected.labelX - 20}`);
    expect(expected.labelX).toBeLessThan((256 + 612) / 2);
    expect(drawn.markerEnd).toBe("url(#arrow)");
  });

  test("a line through slots runs at the height it leaves its source card", () => {
    const drawn: ReturnType<typeof drawnPath> = drawnPath(
      edgeProps(
        {
          link: LINK,
          waypoints: [{ x: 356, y: 152 }],
          sourceTop: 10,
        },
        { targetX: 968 },
      ),
    );
    /* The source's handle is 50 below its top, so the route runs 50 below the slot's. */
    expect(drawn.d).toBe(
      trafficRoutePath({
        sourceX: 256,
        sourceY: 60,
        targetX: 968,
        targetY: 60,
        waypoints: [{ x: 356, y: 152 }],
        handleOffset: 50,
      }).path,
    );
    expect(drawn.d).toContain("L 612,202");
  });

  test("a lane wins over everything else the line was given", () => {
    const drawn: ReturnType<typeof drawnPath> = drawnPath(
      edgeProps(
        {
          link: LINK,
          laneY: -40,
          waypoints: [{ x: 356, y: 152 }],
          labelT: 0.25,
        },
        { sourceX: 868, targetX: 256 },
      ),
    );
    expect(drawn.d).toBe(
      trafficLanePath({
        sourceX: 868,
        sourceY: 60,
        targetX: 256,
        targetY: 60,
        laneY: -40,
      }).path,
    );
  });

  test("a line with nothing from the layout is drawn direct, labeled in the middle", () => {
    const props: EdgeProps<TrafficEdgeData> = edgeProps({ link: LINK });
    delete props.label;
    delete props.markerEnd;
    const drawn: ReturnType<typeof drawnPath> = drawnPath(props);
    expect(drawn.d).toBe("M 256,60 C 434,60 434,60 612,60");
    expect(drawn.label).toBeNull();
    expect(drawn.markerEnd).toBeNull();
  });
});
