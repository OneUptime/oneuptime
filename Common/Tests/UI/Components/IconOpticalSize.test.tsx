import Icon from "../../../UI/Components/Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";

/*
 * Edit and Pencil share a diagonal glyph. A uniform reduction made the old
 * pencil shorter but also left a thin barrel that disappeared at button size.
 * These geometry checks protect both dimensions: a compact outline and enough
 * width to remain legible, without tying future redraws to an exact path.
 */

/*
 * Hoisted rather than written inline: eslint's `wrap-regex` wants a literal in
 * parentheses and prettier takes them straight back out, so an inline one can
 * never satisfy both.
 */
const DIGIT: RegExp = /[0-9]/;
const COMMAND_LETTER: RegExp = /[a-zA-Z]/;

type GetIconPathsFunction = (icon: IconProp) => Array<string>;

const getIconPaths: GetIconPathsFunction = (icon: IconProp): Array<string> => {
  const { container } = render(<Icon icon={icon} />);

  return Array.from(container.querySelectorAll("path")).map(
    (path: SVGPathElement) => {
      return path.getAttribute("d") || "";
    },
  );
};

interface Point {
  x: number;
  y: number;
}

/*
 * The vertices of an SVG path: every on-path point the path data names, in
 * user units.
 *
 * Deliberately vertices and not a true outline. Curves and arcs extend past
 * their endpoints, especially the pencil's rounded cap. These measurements
 * protect proportions in the path data; browser checks cover the rendered
 * outline and alignment. Bounds below allow for the cap being omitted here.
 *
 * Control points of curves are skipped rather than treated as vertices: they
 * routinely sit outside the drawn shape and would report ink that is not
 * there.
 */
type ParsePathVerticesFunction = (pathData: string) => Array<Point>;

const parsePathVertices: ParsePathVerticesFunction = (
  pathData: string,
): Array<Point> => {
  const vertices: Array<Point> = [];

  let cursor: number = 0;
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };
  let command: string = "";

  type SkipSeparatorsFunction = () => void;

  const skipSeparators: SkipSeparatorsFunction = (): void => {
    while (cursor < pathData.length && " ,\t\n\r".includes(pathData[cursor]!)) {
      cursor++;
    }
  };

  type ReadNumberFunction = () => number;

  const readNumber: ReadNumberFunction = (): number => {
    skipSeparators();

    const start: number = cursor;

    if (pathData[cursor] === "-" || pathData[cursor] === "+") {
      cursor++;
    }

    /*
     * At most one decimal point, because path data may run two numbers
     * together with no separator at all: "-1.518.904" is -1.518 followed by
     * 0.904, and ".64.64" is 0.64 twice. Consuming greedily reads them as one
     * malformed token.
     */
    let hasDecimalPoint: boolean = false;

    while (cursor < pathData.length) {
      const character: string = pathData[cursor] as string;

      if (character === ".") {
        if (hasDecimalPoint) {
          break;
        }

        hasDecimalPoint = true;
      } else if (!DIGIT.test(character)) {
        break;
      }

      cursor++;
    }

    // Scientific notation does not appear in this file, but reject it loudly.
    if (pathData[cursor] === "e" || pathData[cursor] === "E") {
      throw new Error(`Unsupported exponent in path data at ${cursor}`);
    }

    const value: number = Number(pathData.substring(start, cursor));

    if (start === cursor || Number.isNaN(value)) {
      throw new Error(
        `Expected a number at ${start} in path data: ${pathData.substring(start, start + 24)}`,
      );
    }

    return value;
  };

  /*
   * Arc flags may be written without any separator - "a1.5 1.5 0 112.122
   * 2.652" packs `large-arc=1`, `sweep=1` and `x=2.122` into "112.122" - so
   * they are read one character at a time rather than as numbers.
   */
  type ReadFlagFunction = () => void;

  const readFlag: ReadFlagFunction = (): void => {
    skipSeparators();

    if (pathData[cursor] !== "0" && pathData[cursor] !== "1") {
      throw new Error(`Expected an arc flag at ${cursor} in path data`);
    }

    cursor++;
  };

  while (cursor < pathData.length) {
    skipSeparators();

    if (cursor >= pathData.length) {
      break;
    }

    if (COMMAND_LETTER.test(pathData[cursor] as string)) {
      command = pathData[cursor] as string;
      cursor++;
    } else if (!command) {
      throw new Error(`Path data does not start with a command: ${pathData}`);
    }

    const isRelative: boolean = command === command.toLowerCase();
    const absolute: string = command.toUpperCase();

    if (absolute === "Z") {
      current = { ...subpathStart };
      vertices.push({ ...current });
      continue;
    }

    const originX: number = isRelative ? current.x : 0;
    const originY: number = isRelative ? current.y : 0;

    if (absolute === "H") {
      current = { x: originX + readNumber(), y: current.y };
    } else if (absolute === "V") {
      current = { x: current.x, y: originY + readNumber() };
    } else if (absolute === "A") {
      // rx ry rotation, then the two flags, then the endpoint.
      readNumber();
      readNumber();
      readNumber();
      readFlag();
      readFlag();
      current = { x: originX + readNumber(), y: originY + readNumber() };
    } else if (absolute === "C" || absolute === "S" || absolute === "Q") {
      // Control points are read and dropped; only the endpoint is on the path.
      const controlPointCount: number = absolute === "C" ? 2 : 1;

      for (let index: number = 0; index < controlPointCount; index++) {
        readNumber();
        readNumber();
      }

      current = { x: originX + readNumber(), y: originY + readNumber() };
    } else if (absolute === "M" || absolute === "L" || absolute === "T") {
      current = { x: originX + readNumber(), y: originY + readNumber() };

      if (absolute === "M") {
        subpathStart = { ...current };
        // An implicit repeat after a moveto is a lineto, per the SVG grammar.
        command = isRelative ? "l" : "L";
      }
    } else {
      throw new Error(`Unsupported path command "${command}"`);
    }

    /*
     * A command may be followed by several argument sets ("l1 2 3 4" is two
     * linetos); the loop simply comes round again, finds no command letter,
     * and reuses the one still in `command`.
     */
    vertices.push({ ...current });
  }

  return vertices;
};

/*
 * The longest straight line that fits inside a set of vertices - the number
 * the eye compares when two icons sit side by side. For the pencil this is
 * its length; for the trash can it is its height; for a circle its diameter.
 */
type LongestSpanFunction = (vertices: Array<Point>) => number;

const longestSpan: LongestSpanFunction = (vertices: Array<Point>): number => {
  let longest: number = 0;

  for (let i: number = 0; i < vertices.length; i++) {
    for (let j: number = i + 1; j < vertices.length; j++) {
      const a: Point = vertices[i] as Point;
      const b: Point = vertices[j] as Point;

      longest = Math.max(longest, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }

  return longest;
};

type MeasurePathFunction = (pathData: string) => number;

const measurePath: MeasurePathFunction = (pathData: string): number => {
  return longestSpan(parsePathVertices(pathData));
};

// Project onto the axis perpendicular to the pencil's 45-degree barrel.
// Its axis-aligned bounding box cannot distinguish a wide pencil from a line.
type DiagonalWidthFunction = (vertices: Array<Point>) => number;

const diagonalWidth: DiagonalWidthFunction = (
  vertices: Array<Point>,
): number => {
  const transverseCoordinates: Array<number> = vertices.map((point: Point) => {
    return (point.x + point.y) / Math.SQRT2;
  });

  return (
    Math.max(...transverseCoordinates) - Math.min(...transverseCoordinates)
  );
};

// The same measurement, for an icon rendered by the component under test.
type InkExtentFunction = (icon: IconProp) => number;

const inkExtent: InkExtentFunction = (icon: IconProp): number => {
  const vertices: Array<Point> = getIconPaths(icon).flatMap(
    (pathData: string) => {
      return parsePathVertices(pathData);
    },
  );

  expect(vertices.length).toBeGreaterThan(1);

  return longestSpan(vertices);
};

/*
 * Heroicons' stock pencil, the glyph this file exists to keep out. Kept here
 * as the negative control: it proves the measurement below can actually tell
 * the two apart, so a broken parser fails the suite instead of quietly
 * agreeing with everything.
 */
const OVERSIZED_HEROICONS_PENCIL: string =
  "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125";

// The previous 80% pencil had an approximately three-unit barrel. Keeping it
// as a control proves that length checks alone do not prevent this regression.
const NARROW_PENCIL: string =
  "M15.89 5.99l1.35-1.35a1.5 1.5 0 112.122 2.122L7.866 18.256a3.6 3.6 0 01-1.518.904l-2.148.64.64-2.148a3.6 3.6 0 01.904-1.518L15.89 5.99zm0 0L18 8.1";

describe("path measurement", () => {
  /*
   * Every assertion in the suite below is only as good as the parser, and a
   * parser that silently returns nothing would make all of them pass. These
   * measure two icons whose geometry can be read straight off their path data
   * by hand.
   */
  it("measures a path whose geometry is obvious by inspection", () => {
    // "M6 18L18 6M6 6l12 12" - an X across a 12x12 square, so 12 * sqrt(2).
    expect(measurePath("M6 18L18 6M6 6l12 12")).toBeCloseTo(16.97, 2);

    // "M12 4.5v15m7.5-7.5h-15" - a plus with 15-unit arms.
    expect(measurePath("M12 4.5v15m7.5-7.5h-15")).toBeCloseTo(15, 2);
  });

  it("measures width perpendicular to a diagonal instead of its bounding box", () => {
    const diagonal: Array<Point> = parsePathVertices("M0 8L8 0");
    const wideDiagonal: Array<Point> = parsePathVertices("M0 4L4 0L8 4L4 8Z");

    expect(diagonalWidth(diagonal)).toBeCloseTo(0, 6);
    expect(diagonalWidth(wideDiagonal)).toBeCloseTo(4 * Math.SQRT2, 6);
  });

  it("reads arc flags that are packed against their coordinates", () => {
    /*
     * "a1.875 1.875 0 112.652 2.652" is large-arc=1, sweep=1, dx=2.652 - not
     * a coordinate of 112.652. Getting this wrong is the one parsing mistake
     * that would silently mismeasure the pencil, which is an arc-carrying
     * path, so it is asserted directly.
     */
    expect(measurePath("M0 0a1.875 1.875 0 112.652 2.652")).toBeCloseTo(
      Math.hypot(2.652, 2.652),
      3,
    );
  });
});

/*
 * The icons a discovery scan's row actions put next to each other, and the
 * ones every other ModelTable row shows: Rename (pencil), Review Results
 * (list), Delete (trash).
 */
describe("Icon optical size", () => {
  it("draws a pencil no larger than the icons it shares a row with", () => {
    const pencil: number = inkExtent(IconProp.Pencil);
    const trash: number = inkExtent(IconProp.Trash);
    const list: number = inkExtent(IconProp.List);

    /*
     * The trash can is the biggest thing in a standard row of actions, so it
     * is the ceiling. A little slack, because a diagonal glyph is allowed to
     * be marginally longer than an upright one at the same apparent size -
     * but nothing like the 25% the stock Heroicon was over.
     */
    expect(pencil).toBeLessThanOrEqual(trash * 1.05);

    // A compact pencil still needs to be legible. Its rounded cap extends
    // past these vertices, so allow more inset than for an upright glyph.
    expect(pencil).toBeGreaterThanOrEqual(list * 0.8);
  });

  it("would fail for the stock Heroicons pencil", () => {
    const stock: number = measurePath(OVERSIZED_HEROICONS_PENCIL);
    const trash: number = inkExtent(IconProp.Trash);

    // The regression this test exists for: 25 units of ink against the bin's 20.
    expect(stock).toBeGreaterThan(trash * 1.2);
  });

  it.each([IconProp.Pencil, IconProp.Edit])(
    "%s has a wider barrel and a shorter outline than the previous pencil",
    (icon: IconProp) => {
      const vertices: Array<Point> = getIconPaths(icon).flatMap(
        (pathData: string) => {
          return parsePathVertices(pathData);
        },
      );
      const width: number = diagonalWidth(vertices);
      const length: number = longestSpan(vertices);

      // At 20px, this leaves a visible barrel interior even after the 1.5-unit
      // outline is drawn. A width ceiling preserves the familiar pencil shape.
      expect(width).toBeGreaterThanOrEqual(4.5);
      expect(width).toBeLessThanOrEqual(6.5);
      expect(length / width).toBeGreaterThanOrEqual(2.5);
      expect(length / width).toBeLessThanOrEqual(4);
      expect(length).toBeLessThanOrEqual(measurePath(NARROW_PENCIL) * 0.85);
    },
  );

  it("rejects the previous narrow pencil even though it passed the size checks", () => {
    const vertices: Array<Point> = parsePathVertices(NARROW_PENCIL);
    const width: number = diagonalWidth(vertices);
    const length: number = longestSpan(vertices);

    expect(length).toBeLessThanOrEqual(inkExtent(IconProp.Trash) * 1.05);
    expect(width).toBeLessThan(4.5);
    expect(length / width).toBeGreaterThan(4);
  });

  it("draws the same pencil for Pencil and Edit", () => {
    /*
     * Both names route to one branch in Icon.tsx, and a good deal of the
     * dashboard reaches for whichever it thought of first. If they ever
     * diverge, half the product's edit buttons change shape and nothing says
     * so.
     */
    expect(getIconPaths(IconProp.Edit)).toEqual(getIconPaths(IconProp.Pencil));
  });

  /*
   * A second, blunter statement of the same fix, so a redraw that happened to
   * keep the ink length while pushing the glyph back into the corners fails
   * here. This is the pencil's OWN keyline box — the icons around it are not
   * all inside it (the trash can runs from 2.25 to 21.75 vertically), and they
   * do not need to be: an upright shape is read by its height, a lone diagonal
   * by its length, and only the diagonal has to be pulled in to match.
   */
  it("keeps the pencil inside its keyline box", () => {
    const vertices: Array<Point> = getIconPaths(IconProp.Pencil).flatMap(
      (pathData: string) => {
        return parsePathVertices(pathData);
      },
    );

    for (const vertex of vertices) {
      expect(vertex.x).toBeGreaterThanOrEqual(4);
      expect(vertex.x).toBeLessThanOrEqual(20);
      expect(vertex.y).toBeGreaterThanOrEqual(4);
      expect(vertex.y).toBeLessThanOrEqual(20);
    }
  });
});
