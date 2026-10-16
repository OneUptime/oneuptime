import Icon, {
  ComponentProps as IconComponentProps,
  ThickProp,
} from "../../../UI/Components/Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { getGlyphOfIcon } from "./MenuItemIcons";

/*
 * IconProp.Timeline: the icon of a timeline. A status timeline's Timeline |
 * Table switch shows it beside the table's grid, and the menu entries of the
 * pages that draw a timeline (status and state timelines, the on-call
 * Schedule Timeline) show it too.
 *
 * The switch used to show Heroicons' chart-bar for Timeline - three upright
 * bars, a bar chart, which a timeline is not ("Timeline icon should be better
 * and more relevant", the maintainer). The glyph that replaced it is three
 * stretches of time stepping down to the right, each starting halfway
 * through the one above it: the steps a timeline view draws, and a status
 * band with one status to a row.
 *
 * The first drawing of it had shorter bars, each a little shorter than the
 * one above. Beside the icons it sits with - the table's grid in the
 * switch, a calendar and a chart in the menus and in Cmd+K - it looked
 * small and light, three dashes rather than three stretches of time. Its
 * bars are now all the same length and as long as the box allows, and the
 * glyph is centred: the same turned half a turn about the icon's centre.
 *
 * Its geometry is read from the path data, so a redraw that loses what makes
 * it a timeline - the steps, the overlap, stretches long enough to read as
 * stretches, bars that stay crisp at the 16px it is drawn at - fails here,
 * not on somebody's screen.
 */

const TIMELINE_PATH: string = "M4.5 6h7.5M8.25 12h7.5M12 18h7.5";

// The house outline stroke, from Icon's SVG wrapper.
const OUTLINE_STROKE: number = 1.5;

// Every IconProp is drawn in a 24-unit box.
const BOX: number = 24;

// The sizes the icon is drawn at: 16px (h-4 w-4), and the same on a 2x screen.
const PIXEL_SIZES: Array<number> = [16, 32];

interface Bar {
  y: number;
  from: number;
  to: number;
}

/*
 * The tokens of a path: a command letter, or a number. Hoisted: eslint's
 * wrap-regex and prettier disagree about an inline literal.
 */
const PATH_TOKEN: RegExp = /[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g;

/*
 * The horizontal bars a path draws. Only what bars need is read - a moveto
 * and a horizontal lineto, absolute or relative - so a redraw in curves or
 * slants says so here rather than being half-read.
 */
const barsOf: (pathData: string) => Array<Bar> = (
  pathData: string,
): Array<Bar> => {
  const tokens: Array<string> = pathData.match(PATH_TOKEN) || [];
  const bars: Array<Bar> = [];
  let index: number = 0;
  let x: number = 0;
  let y: number = 0;

  const readNumber: () => number = (): number => {
    const token: string | undefined = tokens[index];
    const value: number = Number(token);

    if (token === undefined || Number.isNaN(value)) {
      throw new Error(`Expected a number at token ${index} of "${pathData}"`);
    }

    index++;

    return value;
  };

  while (index < tokens.length) {
    const command: string = tokens[index] as string;

    index++;

    if (command === "M" || command === "m") {
      const nextX: number = readNumber();
      const nextY: number = readNumber();

      x = command === "M" ? nextX : x + nextX;
      y = command === "M" ? nextY : y + nextY;
    } else if (command === "H" || command === "h") {
      const length: number = readNumber();
      const end: number = command === "H" ? length : x + length;

      bars.push({ y: y, from: Math.min(x, end), to: Math.max(x, end) });
      x = end;
    } else {
      throw new Error(
        `The timeline glyph is drawn with "${command}"; it is read as horizontal bars (M, m, H, h).`,
      );
    }
  }

  return bars;
};

interface DrawnTimeline {
  svg: SVGSVGElement;
  path: SVGPathElement;
  bars: Array<Bar>;
  // How thick each bar is drawn, in the icon's 24 units.
  thickness: number;
}

// The Timeline icon as Icon draws it: its one path, read as bars.
const drawTimeline: (
  props?: Partial<IconComponentProps> | undefined,
) => DrawnTimeline = (
  props?: Partial<IconComponentProps> | undefined,
): DrawnTimeline => {
  const { container } = render(<Icon {...props} icon={IconProp.Timeline} />);
  const svg: SVGSVGElement | null = container.querySelector("svg");
  const paths: NodeListOf<SVGPathElement> =
    container.querySelectorAll<SVGPathElement>("svg path");

  expect(svg).not.toBeNull();
  expect(paths).toHaveLength(1);

  const path: SVGPathElement = paths[0] as SVGPathElement;

  return {
    svg: svg as SVGSVGElement,
    path: path,
    bars: barsOf(path.getAttribute("d") || ""),
    thickness: Number(path.getAttribute("stroke-width")),
  };
};

describe("reading a path's bars", () => {
  /*
   * Every check below is only as good as this reader, and one that read
   * nothing would make them pass. Two paths whose bars are obvious.
   */
  it("reads absolute and relative bars, in the order they are drawn", () => {
    expect(barsOf("M1 2h3M10 20H4")).toEqual([
      { y: 2, from: 1, to: 4 },
      { y: 20, from: 4, to: 10 },
    ]);
    expect(barsOf("M1 2h3m-1 5h.5")).toEqual([
      { y: 2, from: 1, to: 4 },
      { y: 7, from: 3, to: 3.5 },
    ]);
  });

  it("refuses a path it cannot read as bars", () => {
    expect(() => {
      return barsOf("M3 3l4 4");
    }).toThrow('drawn with "l"');
  });
});

describe("the Timeline icon", () => {
  it("is named Timeline", () => {
    expect(IconProp.Timeline).toBe("Timeline");
  });

  it("draws three stretches of time, one under another, stepping down to the right", () => {
    const drawn: DrawnTimeline = drawTimeline();

    expect(drawn.path.getAttribute("d")).toBe(TIMELINE_PATH);
    expect(drawn.bars).toEqual([
      { y: 6, from: 4.5, to: 12 },
      { y: 12, from: 8.25, to: 15.75 },
      { y: 18, from: 12, to: 19.5 },
    ]);
  });

  it("steps evenly: the stretches are the same length, and each starts halfway through the one above", () => {
    const bars: Array<Bar> = drawTimeline().bars;
    const lengthOf: (bar: Bar) => number = (bar: Bar): number => {
      return bar.to - bar.from;
    };
    const first: Bar = bars[0] as Bar;

    for (let index: number = 1; index < bars.length; index++) {
      const above: Bar = bars[index - 1] as Bar;
      const bar: Bar = bars[index] as Bar;

      // Not stairs that shrink as they go: every stretch as long as the first.
      expect(lengthOf(bar)).toBe(lengthOf(first));
      // Starting halfway through the one above, so the steps are even.
      expect(bar.from).toBe(above.from + lengthOf(above) / 2);
    }
  });

  it("reads as stretches of time, not dashes: each bar is longer than half the glyph is wide", () => {
    const drawn: DrawnTimeline = drawTimeline();
    const drawnLength: (bar: Bar) => number = (bar: Bar): number => {
      // A round end reaches half the bar's thickness past each end point.
      return bar.to - bar.from + drawn.thickness;
    };
    const left: number = Math.min(
      ...drawn.bars.map((bar: Bar): number => {
        return bar.from - drawn.thickness / 2;
      }),
    );
    const right: number = Math.max(
      ...drawn.bars.map((bar: Bar): number => {
        return bar.to + drawn.thickness / 2;
      }),
    );

    for (const bar of drawn.bars) {
      expect({
        y: bar.y,
        longerThanHalf: drawnLength(bar) > (right - left) / 2,
      }).toEqual({
        y: bar.y,
        longerThanHalf: true,
      });
    }
  });

  it("is balanced: turned half a turn about the icon's centre, it draws itself", () => {
    const bars: Array<Bar> = drawTimeline().bars;
    const turned: Array<Bar> = bars
      .map((bar: Bar): Bar => {
        return { y: BOX - bar.y, from: BOX - bar.to, to: BOX - bar.from };
      })
      .sort((a: Bar, b: Bar): number => {
        return a.y - b.y;
      });

    expect(turned).toEqual(bars);
  });

  it("is one timeline, not scattered dashes: each stretch starts after the one above it starts, and before it ends", () => {
    const bars: Array<Bar> = drawTimeline().bars;

    expect(bars).toHaveLength(3);

    for (let index: number = 1; index < bars.length; index++) {
      const above: Bar = bars[index - 1] as Bar;
      const bar: Bar = bars[index] as Bar;

      // Below the one before it...
      expect(bar.y).toBeGreaterThan(above.y);
      // ...starting and ending later than it does...
      expect(bar.from).toBeGreaterThan(above.from);
      expect(bar.to).toBeGreaterThan(above.to);
      // ...but beginning before it is over.
      expect(bar.from).toBeLessThan(above.to);
    }
  });

  it("draws solid bars with round ends, twice the outline stroke, so they keep their shape at 16px", () => {
    const drawn: DrawnTimeline = drawTimeline();

    expect(drawn.thickness).toBe(2 * OUTLINE_STROKE);
    expect(drawn.path).toHaveAttribute("stroke-linecap", "round");
    expect(drawn.path).toHaveAttribute("stroke-linejoin", "round");

    // The wrapper is every other icon's: outline stroke, no fill.
    expect(Number(drawn.svg.getAttribute("stroke-width"))).toBe(OUTLINE_STROKE);
    expect(drawn.svg).toHaveAttribute("fill", "none");
    expect(drawn.svg).toHaveAttribute("stroke", "currentColor");
    expect(drawn.svg).toHaveAttribute("viewBox", `0 0 ${BOX} ${BOX}`);
  });

  it("keeps its bars when an icon is asked to draw thick: the bars' own width wins", () => {
    expect(drawTimeline({ thick: ThickProp.Thick }).thickness).toBe(
      2 * OUTLINE_STROKE,
    );
  });

  it.each(PIXEL_SIZES)(
    "puts every bar's edges on whole pixels when drawn %ipx square",
    (size: number) => {
      const drawn: DrawnTimeline = drawTimeline();
      const scale: number = size / BOX;

      for (const bar of drawn.bars) {
        const top: number = (bar.y - drawn.thickness / 2) * scale;
        const bottom: number = (bar.y + drawn.thickness / 2) * scale;

        expect({ y: bar.y, top: top, bottom: bottom }).toEqual({
          y: bar.y,
          top: Math.round(top),
          bottom: Math.round(bottom),
        });
      }
    },
  );

  it("leaves at least a pixel of air between the bars at 16px, so they never run together", () => {
    const drawn: DrawnTimeline = drawTimeline();
    const scale: number = 16 / BOX;

    for (let index: number = 1; index < drawn.bars.length; index++) {
      const gap: number =
        ((drawn.bars[index] as Bar).y -
          (drawn.bars[index - 1] as Bar).y -
          drawn.thickness) *
        scale;

      expect(gap).toBeGreaterThanOrEqual(1);
    }
  });

  it("sits centred in its box, inside the keyline the other icons keep (2.25 to 21.75)", () => {
    const drawn: DrawnTimeline = drawTimeline();

    // A round end, like the bar's half-thickness, reaches past its end points.
    const reach: number = drawn.thickness / 2;
    const left: number = Math.min(
      ...drawn.bars.map((bar: Bar): number => {
        return bar.from - reach;
      }),
    );
    const right: number = Math.max(
      ...drawn.bars.map((bar: Bar): number => {
        return bar.to + reach;
      }),
    );
    const top: number = (drawn.bars[0] as Bar).y - reach;
    const bottom: number = (drawn.bars[drawn.bars.length - 1] as Bar).y + reach;

    expect({ left: left, right: right, top: top, bottom: bottom }).toEqual({
      left: 3,
      right: 21,
      top: 4.5,
      bottom: 19.5,
    });
    expect(left + right).toBe(BOX);
    expect(top + bottom).toBe(BOX);
  });

  it("is a glyph of its own: no other IconProp draws it", () => {
    const timeline: string = getGlyphOfIcon(IconProp.Timeline);

    expect(timeline).not.toBe("");

    const sameGlyph: Array<string> = Object.values(IconProp).filter(
      (icon: IconProp): boolean => {
        return icon !== IconProp.Timeline && getGlyphOfIcon(icon) === timeline;
      },
    );

    expect(sameGlyph).toEqual([]);
  });

  it.each([
    // What the Timeline option drew before: a bar chart.
    IconProp.ChartBar,
    // The Table option beside it.
    IconProp.TableCells,
    // What the timeline pages' menu entries drew, shared with Audit Logs.
    IconProp.List,
    // What the on-call Schedule Timeline drew.
    IconProp.ViewColumns,
    // The traces' span waterfall: bars too, but hung from the left edge.
    IconProp.Waterfall,
  ])("is not %s", (other: IconProp) => {
    expect(getGlyphOfIcon(IconProp.Timeline)).not.toBe(getGlyphOfIcon(other));
  });

  it("is decorative beside a label: hidden from a screen reader, drawn at the size it is given", () => {
    const drawn: DrawnTimeline = drawTimeline({ className: "h-4 w-4" });

    expect(drawn.svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
    expect(drawn.svg).toHaveClass("h-4", "w-4");
  });

  it("is an image with a name when it stands alone", () => {
    drawTimeline({ ariaLabel: "Timeline" });

    expect(screen.getByRole("img", { name: "Timeline" })).toBeInTheDocument();
  });
});
