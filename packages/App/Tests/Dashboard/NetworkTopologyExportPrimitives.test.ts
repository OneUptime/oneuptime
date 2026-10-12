import { describe, expect, test } from "@jest/globals";
import {
  PRINT_FALLBACK_COLOR,
  clampOpacity,
  resolvePrintColor,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportColor";
import {
  PdfStringCollector,
  TEXT_ELLIPSIS,
  TextMeasure,
  formatCount,
  pluralize,
  truncateText,
  wrapText,
  wrapTextToLines,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportText";
import {
  ExportItem,
  ExportLineItem,
  ExportPathItem,
  ExportTextItem,
  baselineFor,
  orientationOfPage,
  textItem,
  transformExportItem,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportItems";
import {
  ELLIPSE_KAPPA,
  shapeItems,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportShapes";
import {
  cylinderCapHalfHeight,
  geometryForShape,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyNodeShape";
import {
  LINK_STATE_COLORS,
  NODE_STATUS_COLORS,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";

/*
 * Issue #4616: the small pieces the topology PDF is built from — light
 * colours whatever the theme, text that wraps and shortens to a width, the
 * drawing items and the node silhouettes.
 */

// One width per character, so every expectation can be worked out by hand.
const CHAR_WIDTH: number = 0.5;
const measure: TextMeasure = (
  text: string,
  fontSize: number,
  isBold: boolean,
): number => {
  return Array.from(text).length * fontSize * (isBold ? 0.6 : CHAR_WIDTH);
};

const HEX: RegExp = /^#[0-9a-f]{6}$/;

describe("resolvePrintColor: every colour on paper is its light value", () => {
  test("a theme variable resolves to its light-mode fallback", () => {
    expect(resolvePrintColor("var(--ou-chart-series-neutral, #64748b)")).toBe(
      "#64748b",
    );
    expect(resolvePrintColor("var(--ou-border-strong, #cbd5e1)")).toBe(
      "#cbd5e1",
    );
    expect(resolvePrintColor("var(--ou-surface-primary, #ffffff)")).toBe(
      "#ffffff",
    );
  });

  test("a nested variable resolves through every level", () => {
    expect(resolvePrintColor("var(--a, var(--b, #ABCDEF))")).toBe("#abcdef");
  });

  test("short and upper-case hex come back as lower-case #rrggbb", () => {
    expect(resolvePrintColor("#FFF")).toBe("#ffffff");
    expect(resolvePrintColor("#0aF")).toBe("#00aaff");
    expect(resolvePrintColor("#DC2626")).toBe("#dc2626");
  });

  test("anything it cannot read becomes the muted grey, never black or nothing", () => {
    expect(resolvePrintColor("var(--no-fallback)")).toBe(PRINT_FALLBACK_COLOR);
    expect(resolvePrintColor("red")).toBe(PRINT_FALLBACK_COLOR);
    expect(resolvePrintColor("")).toBe(PRINT_FALLBACK_COLOR);
    expect(resolvePrintColor(undefined)).toBe(PRINT_FALLBACK_COLOR);
    expect(resolvePrintColor(null)).toBe(PRINT_FALLBACK_COLOR);
    expect(resolvePrintColor("#12345")).toBe(PRINT_FALLBACK_COLOR);
  });

  test("a caller's own fallback is resolved too", () => {
    expect(resolvePrintColor("bogus", "var(--x, #123456)")).toBe("#123456");
    expect(resolvePrintColor("bogus", "bogus too")).toBe(PRINT_FALLBACK_COLOR);
  });

  test("every status and link colour the map uses prints as plain hex", () => {
    for (const color of [
      ...Object.values(NODE_STATUS_COLORS),
      ...Object.values(LINK_STATE_COLORS),
    ]) {
      expect(resolvePrintColor(color)).toMatch(HEX);
    }
    expect(resolvePrintColor(NODE_STATUS_COLORS.up)).toBe("#16a34a");
    expect(resolvePrintColor(NODE_STATUS_COLORS.down)).toBe("#dc2626");
    expect(resolvePrintColor(NODE_STATUS_COLORS.unknown)).toBe("#64748b");
  });
});

describe("clampOpacity: an opacity PDF accepts", () => {
  test("a number from 0 to 1 passes through", () => {
    expect(clampOpacity(0)).toBe(0);
    expect(clampOpacity(0.2)).toBe(0.2);
    expect(clampOpacity(1)).toBe(1);
  });

  test("out of range is clamped, and nothing usable is opaque", () => {
    expect(clampOpacity(7)).toBe(1);
    expect(clampOpacity(-3)).toBe(0);
    expect(clampOpacity(Number.NaN)).toBe(1);
    expect(clampOpacity(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampOpacity(undefined)).toBe(1);
    expect(clampOpacity(null)).toBe(1);
  });
});

describe("counts and pages", () => {
  test("counts are written with thousands separators, in English", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1203)).toBe("1,203");
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  test("one of a thing is singular, and every other count plural", () => {
    expect(pluralize(1, "device", "devices")).toBe("1 device");
    expect(pluralize(0, "device", "devices")).toBe("0 devices");
    expect(pluralize(1203, "device", "devices")).toBe("1,203 devices");
  });

  test("a page wider than it is tall is landscape", () => {
    expect(orientationOfPage({ width: 841.89, height: 595.28 })).toBe(
      "landscape",
    );
    expect(orientationOfPage({ width: 595.28, height: 841.89 })).toBe(
      "portrait",
    );
    expect(orientationOfPage({ width: 600, height: 600 })).toBe("portrait");
  });
});

describe("wrapText and friends: text laid out to a width", () => {
  test("words wrap greedily onto as many lines as they need", () => {
    // 10pt at 0.5 per character: 5pt a character, so 40pt holds 8.
    expect(wrapText("core switch one two", 40, measure, 10)).toEqual([
      "core",
      "switch",
      "one two",
    ]);
    expect(wrapText("a b c", 1000, measure, 10)).toEqual(["a b c"]);
  });

  test("a word wider than a line is broken between characters", () => {
    expect(wrapText("core-1.dc-east.example.com", 40, measure, 10)).toEqual([
      "core-1.d",
      "c-east.e",
      "xample.c",
      "om",
    ]);
  });

  test("every wrapped line fits the width", () => {
    const lines: Array<string> = wrapText(
      "Edge router for the north east distribution centre and its warehouse",
      60,
      measure,
      10,
    );
    for (const line of lines) {
      expect(measure(line, 10, false)).toBeLessThanOrEqual(60);
    }
    expect(lines.join(" ")).toBe(
      "Edge router for the north east distribution centre and its warehouse",
    );
  });

  test("blank text wraps to no lines", () => {
    expect(wrapText("", 40, measure, 10)).toEqual([]);
    expect(wrapText("   ", 40, measure, 10)).toEqual([]);
  });

  test("bold text is measured as bold", () => {
    // 0.6 per character bold: 6pt each, so 40pt holds 6.
    expect(wrapText("abcdefgh", 40, measure, 10, true)).toEqual([
      "abcdef",
      "gh",
    ]);
  });

  test("truncateText leaves text that fits alone, and ends what does not with ...", () => {
    expect(truncateText("short", 100, measure, 10)).toBe("short");
    const shortened: string = truncateText(
      "a very long device name",
      50,
      measure,
      10,
    );
    expect(shortened.endsWith(TEXT_ELLIPSIS)).toBe(true);
    expect(TEXT_ELLIPSIS).toBe("...");
    expect(measure(shortened, 10, false)).toBeLessThanOrEqual(50);
    expect(shortened).toBe("a very...");
  });

  test("wrapTextToLines folds what does not fit into an ellipsis on the last line", () => {
    const lines: Array<string> = wrapTextToLines(
      "one two three four five six seven",
      40,
      2,
      measure,
      10,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("one two");
    expect(lines[1]!.endsWith("...")).toBe(true);
    expect(measure(lines[1]!, 10, false)).toBeLessThanOrEqual(40);
    expect(wrapTextToLines("fits", 40, 2, measure, 10)).toEqual(["fits"]);
  });
});

describe("PdfStringCollector: names the PDF font can draw", () => {
  test("Latin-1, accents included, passes through untouched", () => {
    const strings: PdfStringCollector = new PdfStringCollector();
    expect(strings.clean("Zürich café — Ålesund")).toBe(
      "Zürich café - Ålesund",
    );
    expect(strings.isLossy).toBe(false);
  });

  test("typographic punctuation is transliterated without loss", () => {
    const strings: PdfStringCollector = new PdfStringCollector();
    expect(strings.clean("“core” → edge…")).toBe('"core" -> edge...');
    expect(strings.isLossy).toBe(false);
  });

  test("a script the font cannot draw is replaced, and remembered", () => {
    const strings: PdfStringCollector = new PdfStringCollector();
    expect(strings.clean("東京 router")).toBe("?? router");
    expect(strings.isLossy).toBe(true);
    // Once lossy, the document stays lossy.
    expect(strings.clean("plain")).toBe("plain");
    expect(strings.isLossy).toBe(true);
  });

  test("missing text is an empty string", () => {
    const strings: PdfStringCollector = new PdfStringCollector();
    expect(strings.clean(undefined)).toBe("");
    expect(strings.clean(null)).toBe("");
  });
});

describe("export items", () => {
  test("baselineFor puts the baseline an ascender below the top", () => {
    expect(baselineFor(100, 10)).toBeCloseTo(107.8, 6);
  });

  test("textItem defaults to regular, left-aligned text", () => {
    const item: ExportTextItem = textItem("t", "Hello", 1, 2, 9, "#111111");
    expect(item).toEqual({
      type: "text",
      tag: "t",
      x: 1,
      y: 2,
      text: "Hello",
      fontSize: 9,
      isBold: false,
      color: "#111111",
      align: "left",
    });
  });

  test("transformExportItem scales positions, sizes, line widths, dashes and fonts", () => {
    const line: ExportLineItem = {
      type: "line",
      tag: "l",
      x1: 1,
      y1: 2,
      x2: 3,
      y2: 4,
      stroke: { color: "#000000", width: 0.5, dash: [3, 2] },
      roundCaps: true,
    };
    expect(transformExportItem(line, 2, 10, 20)).toEqual({
      ...line,
      x1: 12,
      y1: 24,
      x2: 16,
      y2: 28,
      stroke: { color: "#000000", width: 1, dash: [6, 4] },
    });

    const text: ExportItem = {
      ...textItem("t", "x", 5, 6, 8, "#000000"),
      halo: { color: "#ffffff", width: 2 },
    };
    expect(transformExportItem(text, 3)).toMatchObject({
      x: 15,
      y: 18,
      fontSize: 24,
      halo: { color: "#ffffff", width: 6 },
    });

    const path: ExportPathItem = {
      type: "path",
      tag: "p",
      commands: [
        { op: "m", points: [1, 1] },
        { op: "c", points: [1, 2, 3, 4, 5, 6] },
      ],
      closed: true,
    };
    expect(
      (transformExportItem(path, 2, 100, 1000) as ExportPathItem).commands,
    ).toEqual([
      { op: "m", points: [102, 1002] },
      { op: "c", points: [102, 1004, 106, 1008, 110, 1012] },
    ]);
  });

  test("transparency survives a transform untouched", () => {
    const item: ExportItem = {
      ...textItem("t", "x", 5, 6, 8, "#000000"),
      fillOpacity: 0.2,
      strokeOpacity: 0.2,
    };
    expect(transformExportItem(item, 3)).toMatchObject({
      fillOpacity: 0.2,
      strokeOpacity: 0.2,
    });
  });

  test("an identity transform hands back the same item", () => {
    const item: ExportTextItem = textItem("t", "x", 1, 1, 8, "#000000");
    expect(transformExportItem(item, 1)).toBe(item);
  });
});

describe("shapeItems: the silhouettes the canvas draws", () => {
  const paint: { fill: string; stroke: { color: string; width: number } } = {
    fill: "#16a34a",
    stroke: { color: "#16a34a", width: 2 },
  };

  test("a router is a circle of the geometry's radius", () => {
    const items: Array<ExportItem> = shapeItems(
      "n",
      geometryForShape("circle", 16),
      100,
      50,
      0.5,
      paint,
    );
    expect(items).toEqual([
      {
        type: "circle",
        tag: "n",
        cx: 100,
        cy: 50,
        r: 8,
        fill: "#16a34a",
        stroke: paint.stroke,
      },
    ]);
  });

  test("a switch is a rounded box, with its corner radius scaled", () => {
    const items: Array<ExportItem> = shapeItems(
      "n",
      geometryForShape("rounded-square", 16),
      0,
      0,
      1,
      paint,
    );
    expect(items[0]).toMatchObject({
      type: "rect",
      x: -14.08,
      y: -14.08,
      width: 28.16,
      height: 28.16,
      radius: 3.52,
    });
  });

  test("a firewall diamond is a closed path through its four corners", () => {
    const items: Array<ExportItem> = shapeItems(
      "n",
      geometryForShape("diamond", 16),
      10,
      10,
      1,
      paint,
    );
    const path: ExportPathItem = items[0] as ExportPathItem;
    expect(path.type).toBe("path");
    expect(path.closed).toBe(true);
    // A diamond's half-extents are 1.15 times the base radius: 18.4.
    const expected: Array<[string, number, number]> = [
      ["m", 10, -8.4],
      ["l", 28.4, 10],
      ["l", 10, 28.4],
      ["l", -8.4, 10],
    ];
    expect(path.commands).toHaveLength(expected.length);
    expected.forEach(([op, x, y]: [string, number, number], index: number) => {
      expect(path.commands[index]!.op).toBe(op);
      expect(path.commands[index]!.points[0]).toBeCloseTo(x, 6);
      expect(path.commands[index]!.points[1]).toBeCloseTo(y, 6);
    });
  });

  test("a storage drum is its outline plus the rim of its top cap, all Béziers", () => {
    const geometry: ReturnType<typeof geometryForShape> = geometryForShape(
      "cylinder",
      16,
    );
    const items: Array<ExportItem> = shapeItems("n", geometry, 0, 0, 1, paint);
    expect(items).toHaveLength(2);
    const body: ExportPathItem = items[0] as ExportPathItem;
    const rim: ExportPathItem = items[1] as ExportPathItem;
    expect(body.closed).toBe(true);
    expect(body.fill).toBe("#16a34a");
    expect(rim.tag).toBe("n:rim");
    expect(rim.closed).toBe(false);
    expect(rim.fill).toBeUndefined();
    expect(rim.stroke).toEqual(paint.stroke);
    // The top cap's highest point is a cap's height above its straight edge.
    const ry: number = cylinderCapHalfHeight(geometry.halfHeight);
    const top: number = -geometry.halfHeight + ry;
    expect(body.commands[1]!.points.slice(4)).toEqual([0, top - ry]);
    expect(body.commands[1]!.points[1]).toBeCloseTo(
      top - ry * ELLIPSE_KAPPA,
      6,
    );
  });

  test("an endpoint leaf is the small rect the canvas draws", () => {
    const items: Array<ExportItem> = shapeItems(
      "n",
      geometryForShape("rect", 9),
      0,
      0,
      2,
      paint,
    );
    // 9 x 7 half-extents, the endpoint's historical size, at twice the scale.
    expect(items[0]).toMatchObject({
      type: "rect",
      width: 36,
      height: 28,
    });
  });
});
