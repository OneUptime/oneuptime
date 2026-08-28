import Icon from "../../../UI/Components/Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";

/*
 * WHY THIS FILE EXISTS
 *
 * Every icon in Icon.tsx is hand-written path data in one long if/else chain,
 * and they all share a 24x24 viewBox. The viewBox is not what the eye
 * measures, though - the INK is. An icon whose drawing runs corner to corner
 * reads as bigger than one that sits inside a keyline square, at the same
 * nominal size, on the same row, in the same button.
 *
 * That is what happened to the pencil. Heroicons' pencil is a single unbroken
 * diagonal spanning the full box, so its ink ran ~25 units tip to eraser
 * while the Trash and List it sits beside in a table row's action buttons run
 * ~20. Rendered by Button at 20px (Button.tsx pins the icon to `w-5 h-5`), the
 * pencil drew a stroke longer than the box it was sized into, and looked a
 * size larger than every button next to it (OneUptime issue #3444's
 * screenshot).
 *
 * A path string pinned by equality would catch a revert and nothing else - it
 * says nothing about WHY the string is what it is, and it goes stale the
 * moment anyone redraws the glyph for an unrelated reason. So this measures
 * the geometry instead: the pencil's ink must stay in the same size class as
 * the icons it is rendered beside. Redraw the pencil however you like; it just
 * may not go back to overshooting its neighbours.
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
 * Deliberately vertices and not a true outline. Curves and arcs bulge past
 * their endpoints - the pencil's eraser cap is a semicircle that reaches
 * ~0.4 units beyond its own arc endpoint - so this under-measures every icon
 * by a fraction of a unit. That is fine and it is why the comparison below is
 * relative: every icon is measured the same way, so the bias cancels, and the
 * question being asked ("is the pencil in the same size class as the trash
 * can") is not sensitive to a rounding of a stroke width.
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

    // And not shrunk into a different size class either.
    expect(pencil).toBeGreaterThanOrEqual(list * 0.9);
  });

  it("would fail for the stock Heroicons pencil", () => {
    const stock: number = measurePath(OVERSIZED_HEROICONS_PENCIL);
    const trash: number = inkExtent(IconProp.Trash);

    // The regression this test exists for: 25 units of ink against the bin's 20.
    expect(stock).toBeGreaterThan(trash * 1.2);
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
