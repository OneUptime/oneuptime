import { describe, expect, test } from "@jest/globals";
import {
  GAUGE_END_ANGLE,
  GAUGE_START_ANGLE,
  GaugeArcGeometry,
  GaugeArcPoint,
  buildGaugeArcPath,
  computeGaugeArcGeometry,
  computeGaugePercentage,
  gaugeAngleForPercentage,
  gaugePointAtAngle,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/GaugeArcData";

/*
 * The gauge draws a coloured value arc on top of a grey background track.
 * Both must lie on the same circle, at every value — a value arc that asks
 * SVG for a different circle leaves the track, bulges away from it, and
 * rejoins only at the indicator dot. These tests check that geometrically
 * (by deriving the circle each path actually implies) rather than by pinning
 * path strings, so they describe the defect and not the formatting.
 */

// A gauge big enough that mis-centred arcs are unmistakable in the numbers.
const GAUGE_SIZE: number = 200;
const STROKE_WIDTH: number = 12;
const RADIUS: number = (GAUGE_SIZE - STROKE_WIDTH) / 2; // 94
const CENTER: number = GAUGE_SIZE / 2; // 100

interface ParsedArcPath {
  start: GaugeArcPoint;
  end: GaugeArcPoint;
  radius: number;
  largeArcFlag: number;
  sweepFlag: number;
}

const ARC_PATH_PATTERN: RegExp =
  /^M (\S+) (\S+) A (\S+) (\S+) 0 (\d) (\d) (\S+) (\S+)$/;

function parseArcPath(path: string): ParsedArcPath {
  const match: RegExpMatchArray | null = path.match(ARC_PATH_PATTERN);
  if (!match) {
    throw new Error(`Not a single-arc path: ${path}`);
  }
  return {
    start: { x: Number(match[1]), y: Number(match[2]) },
    radius: Number(match[3]),
    largeArcFlag: Number(match[5]),
    sweepFlag: Number(match[6]),
    end: { x: Number(match[7]), y: Number(match[8]) },
  };
}

/*
 * SVG's endpoint-to-centre parameterisation (spec appendix F.6.5), reduced to
 * the circular, unrotated case. This is what a renderer does with the flags,
 * so it is the honest way to ask "which circle did we just draw on?".
 */
function arcCenter(arc: ParsedArcPath): GaugeArcPoint {
  const halfDx: number = (arc.start.x - arc.end.x) / 2;
  const halfDy: number = (arc.start.y - arc.end.y) / 2;
  const chordSquared: number = halfDx * halfDx + halfDy * halfDy;
  const radiusSquared: number = arc.radius * arc.radius;
  // Clamped per the spec; a half-turn makes this exactly zero.
  const scale: number = Math.sqrt(
    Math.max(0, (radiusSquared - chordSquared) / chordSquared),
  );
  const sign: number = arc.largeArcFlag === arc.sweepFlag ? -1 : 1;
  return {
    x: sign * scale * halfDy + (arc.start.x + arc.end.x) / 2,
    y: -sign * scale * halfDx + (arc.start.y + arc.end.y) / 2,
  };
}

function geometryAt(percentage: number): GaugeArcGeometry {
  return computeGaugeArcGeometry({
    gaugeSize: GAUGE_SIZE,
    strokeWidth: STROKE_WIDTH,
    percentage,
  });
}

// Values straddling the midpoint, where the large-arc-flag regression began.
const PERCENTAGES: Array<number> = [
  0.01, 0.25, 0.49, 0.5, 0.500001, 0.51, 0.6667, 0.75, 0.9, 0.99, 1,
];

describe("GaugeArcData.computeGaugePercentage", () => {
  test("maps a value to its position within min..max", () => {
    expect(computeGaugePercentage(50, 0, 100)).toBe(0.5);
    expect(computeGaugePercentage(0, 0, 100)).toBe(0);
    expect(computeGaugePercentage(100, 0, 100)).toBe(1);
  });

  test("handles a range that does not start at zero", () => {
    expect(computeGaugePercentage(75, 50, 100)).toBe(0.5);
  });

  test("clamps values outside the range", () => {
    expect(computeGaugePercentage(-20, 0, 100)).toBe(0);
    expect(computeGaugePercentage(250, 0, 100)).toBe(1);
  });

  test("a non-positive range reads as empty instead of dividing by zero", () => {
    expect(computeGaugePercentage(5, 10, 10)).toBe(0);
    expect(computeGaugePercentage(5, 10, 0)).toBe(0);
  });
});

describe("GaugeArcData.gaugeAngleForPercentage", () => {
  test("sweeps from the left end of the track to the right end", () => {
    expect(gaugeAngleForPercentage(0)).toBe(GAUGE_START_ANGLE);
    expect(gaugeAngleForPercentage(1)).toBe(GAUGE_END_ANGLE);
    expect(gaugeAngleForPercentage(0.5)).toBeCloseTo(Math.PI / 2, 10);
  });

  test("never exceeds a half turn, which is why the arc is never large", () => {
    for (const percentage of PERCENTAGES) {
      const swept: number =
        GAUGE_START_ANGLE - gaugeAngleForPercentage(percentage);
      expect(swept).toBeLessThanOrEqual(Math.PI);
    }
  });
});

describe("GaugeArcData.gaugePointAtAngle", () => {
  test("places the track ends level with the centre, left and right", () => {
    const left: GaugeArcPoint = gaugePointAtAngle(
      CENTER,
      CENTER,
      RADIUS,
      GAUGE_START_ANGLE,
    );
    const right: GaugeArcPoint = gaugePointAtAngle(
      CENTER,
      CENTER,
      RADIUS,
      GAUGE_END_ANGLE,
    );

    expect(left.x).toBeCloseTo(CENTER - RADIUS, 9);
    expect(left.y).toBeCloseTo(CENTER, 9);
    expect(right.x).toBeCloseTo(CENTER + RADIUS, 9);
    expect(right.y).toBeCloseTo(CENTER, 9);
  });

  test("the midpoint sits at the top of the arc (SVG y grows downward)", () => {
    const top: GaugeArcPoint = gaugePointAtAngle(
      CENTER,
      CENTER,
      RADIUS,
      Math.PI / 2,
    );
    expect(top.x).toBeCloseTo(CENTER, 9);
    expect(top.y).toBeCloseTo(CENTER - RADIUS, 9);
  });
});

describe("GaugeArcData.buildGaugeArcPath", () => {
  test("always emits large-arc-flag 0 and sweep-flag 1", () => {
    const path: string = buildGaugeArcPath(
      { x: 6, y: 100 },
      { x: 194, y: 100 },
      94,
    );
    expect(path).toBe("M 6 100 A 94 94 0 0 1 194 100");
  });
});

describe("GaugeArcData.computeGaugeArcGeometry", () => {
  test("derives the radius and centre from the gauge box", () => {
    const arc: GaugeArcGeometry = geometryAt(0.5);
    expect(arc.radius).toBe(RADIUS);
    expect(arc.centerX).toBe(CENTER);
    expect(arc.centerY).toBe(CENTER);
  });

  test("the background track is a single non-large arc", () => {
    const track: ParsedArcPath = parseArcPath(geometryAt(0).backgroundPath);
    expect(track.largeArcFlag).toBe(0);
    expect(track.sweepFlag).toBe(1);
    expect(track.radius).toBe(RADIUS);
  });

  /*
   * The regression: past the midpoint the value arc used large-arc-flag 1,
   * asking for the long way round between the same two endpoints. That is
   * only satisfiable on a different circle, so the arc left the track.
   */
  test("the value arc is never flagged large, at any value", () => {
    for (const percentage of PERCENTAGES) {
      const value: ParsedArcPath = parseArcPath(
        geometryAt(percentage).valuePath,
      );
      expect(value.largeArcFlag).toBe(0);
      expect(value.sweepFlag).toBe(1);
    }
  });

  test("the value arc stays on the track's circle, at any value", () => {
    for (const percentage of PERCENTAGES) {
      const arc: GaugeArcGeometry = geometryAt(percentage);
      const center: GaugeArcPoint = arcCenter(parseArcPath(arc.valuePath));

      expect(center.x).toBeCloseTo(CENTER, 6);
      expect(center.y).toBeCloseTo(CENTER, 6);
    }
  });

  test("value arc and background track agree on their circle", () => {
    const arc: GaugeArcGeometry = geometryAt(0.75);
    const track: ParsedArcPath = parseArcPath(arc.backgroundPath);
    const value: ParsedArcPath = parseArcPath(arc.valuePath);

    expect(value.radius).toBe(track.radius);
    expect(value.start).toEqual(track.start);
    expect(arcCenter(value).x).toBeCloseTo(arcCenter(track).x, 6);
    expect(arcCenter(value).y).toBeCloseTo(arcCenter(track).y, 6);
  });

  test("a full gauge draws exactly the background track", () => {
    const arc: GaugeArcGeometry = geometryAt(1);
    expect(arc.valuePath).toBe(arc.backgroundPath);
  });

  test("the indicator dot sits on the end of the value arc, on the track", () => {
    for (const percentage of PERCENTAGES) {
      const arc: GaugeArcGeometry = geometryAt(percentage);
      const value: ParsedArcPath = parseArcPath(arc.valuePath);

      expect(arc.arcCurrent.x).toBeCloseTo(value.end.x, 9);
      expect(arc.arcCurrent.y).toBeCloseTo(value.end.y, 9);

      const distanceFromCenter: number = Math.hypot(
        arc.arcCurrent.x - CENTER,
        arc.arcCurrent.y - CENTER,
      );
      expect(distanceFromCenter).toBeCloseTo(RADIUS, 9);
    }
  });
});

/*
 * The reported repros, end to end: percentage from the widget's configured
 * range, then the arc that percentage produces.
 */
describe("GaugeArcData dashboard template repros", () => {
  test("Largest Contentful Paint at 4000ms of 0..6000 stays on the track", () => {
    const percentage: number = computeGaugePercentage(4000, 0, 6000);
    expect(percentage).toBeCloseTo(2 / 3, 10);

    const center: GaugeArcPoint = arcCenter(
      parseArcPath(geometryAt(percentage).valuePath),
    );
    expect(center.x).toBeCloseTo(CENTER, 6);
    expect(center.y).toBeCloseTo(CENTER, 6);
  });

  test("CPU Utilization above 50% stays on the track", () => {
    for (const cpuPercent of [51, 62.5, 80, 99.9]) {
      const percentage: number = computeGaugePercentage(cpuPercent, 0, 100);
      const center: GaugeArcPoint = arcCenter(
        parseArcPath(geometryAt(percentage).valuePath),
      );
      expect(center.x).toBeCloseTo(CENTER, 6);
      expect(center.y).toBeCloseTo(CENTER, 6);
    }
  });
});
