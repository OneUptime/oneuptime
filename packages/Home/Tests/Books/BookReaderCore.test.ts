import { describe, expect, jest, test } from "@jest/globals";

/*
 * The reader's pure logic (Static/js/book-reader-core.js): layout, pagination
 * maps, spreads, reading positions, deep links and the page-fold geometry.
 *
 * The module is plain browser JavaScript with a CommonJS export for exactly
 * this suite, so it is loaded as-is and typed by the interface below.
 */

interface Point {
  x: number;
  y: number;
}

interface Layout {
  mode: "spread" | "single";
  pageWidth: number;
  pageHeight: number;
  bookWidth: number;
  bookHeight: number;
  padding: { top: number; bottom: number; inner: number; outer: number };
  contentWidth: number;
  contentHeight: number;
  columnGap: number;
  fontStep: number;
  fontSize: number;
  lineHeight: number;
}

interface LayoutOptions {
  fontStep?: number;
  chromeTop?: number;
  chromeBottom?: number;
}

interface PageMap {
  counts: Array<number>;
  starts: Array<number>;
  total: number;
}

interface Located {
  section: number;
  offset: number;
}

interface Position {
  sectionId: string;
  fraction: number;
}

interface StoredPosition extends Position {
  label: string;
  progress: number;
  updatedAt: number;
}

interface StoredSettings {
  fontStep: number;
  theme: string;
}

interface TocEntry {
  label?: string;
  sectionId?: string;
  anchorId?: string;
  children?: Array<TocEntry>;
}

interface FoldOptions {
  width: number;
  height: number;
  side?: number;
  corner?: "top" | "bottom";
  point: Point;
}

interface FoldGeometry {
  point: Point;
  progress: number;
  folded: boolean;
  front: Array<Point>;
  flap: Array<Point>;
  reveal: Array<Point>;
  matrix: Array<number>;
  foldOrigin: Point;
  foldAngle: number;
}

interface ReaderCore {
  FONT_STEPS: Array<number>;
  DEFAULT_FONT_STEP: number;
  THEMES: Array<string>;
  DEFAULT_THEME: string;
  clamp: (value: number, min: number, max: number) => number;
  isSectionId: (value: unknown) => boolean;
  computeLayout: (viewport: unknown, options?: LayoutOptions) => Layout;
  layoutKey: (layout: Layout) => string;
  createPageMap: (counts: Array<unknown>) => PageMap;
  locatePage: (map: PageMap | null, page: number) => Located | null;
  pageOf: (map: PageMap | null, section: number, offset: number) => number;
  viewCount: (total: number, mode: string) => number;
  viewForPage: (page: number, mode: string) => number;
  viewPages: (view: number, mode: string) => Array<number>;
  primaryPage: (view: number, mode: string, total: number) => number;
  readingPage: (map: PageMap | null, view: number, mode: string) => number;
  positionForPage: (
    map: PageMap,
    sectionIds: Array<string>,
    page: number,
  ) => Position | null;
  pageForPosition: (
    map: PageMap | null,
    sectionIds: Array<string>,
    position: Partial<Position> | null,
  ) => number;
  parseReaderHash: (hash: unknown) => { sectionId: string | null } | null;
  readerHash: (sectionId: unknown) => string;
  parseStoredPosition: (raw: unknown) => StoredPosition | null;
  parseStoredSettings: (raw: unknown) => StoredSettings;
  isPartEntry: (entry: TocEntry | null | undefined) => boolean;
  stripNumberPrefix: (label: unknown, number: string) => unknown;
  pageLabel: (view: number, mode: string, total: number) => string;
  clipPolygon: (
    polygon: Array<Point>,
    origin: Point,
    normal: Point,
    sign: number,
  ) => Array<Point>;
  constrainFoldPoint: (
    point: Point,
    width: number,
    height: number,
    cornerY: number,
  ) => Point;
  foldGeometry: (options: FoldOptions) => FoldGeometry;
  easeInOutCubic: (t: number) => number;
  turnPath: (t: number, from: Point, to: Point, height: number) => Point;
  shouldCompleteTurn: (options: {
    direction: string;
    point: Point;
    velocityX?: unknown;
  }) => boolean;
}

const Core: ReaderCore = jest.requireActual(
  "../../Static/js/book-reader-core.js",
) as ReaderCore;

// A small deterministic PRNG, so the property-style tests are reproducible.
const seededRandom: (seed: number) => () => number = (
  seed: number,
): (() => number) => {
  let state: number = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value: number = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const randomCounts: (random: () => number) => Array<number> = (
  random: () => number,
): Array<number> => {
  const sections: number = 1 + Math.floor(random() * 30);
  const counts: Array<number> = [];

  for (let index: number = 0; index < sections; index++) {
    counts.push(1 + Math.floor(random() * 9));
  }

  return counts;
};

const polygonArea: (polygon: Array<Point>) => number = (
  polygon: Array<Point>,
): number => {
  let area: number = 0;

  for (let index: number = 0; index < polygon.length; index++) {
    const current: Point = polygon[index]!;
    const next: Point = polygon[(index + 1) % polygon.length]!;
    area += current.x * next.y - next.x * current.y;
  }

  return Math.abs(area) / 2;
};

const reflect: (point: Point, origin: Point, normal: Point) => Point = (
  point: Point,
  origin: Point,
  normal: Point,
): Point => {
  const distance: number =
    (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y;

  return {
    x: point.x - 2 * distance * normal.x,
    y: point.y - 2 * distance * normal.y,
  };
};

const applyMatrix: (matrix: Array<number>, point: Point) => Point = (
  matrix: Array<number>,
  point: Point,
): Point => {
  const [a, b, c, d, e, f] = matrix as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
};

const expectPointClose: (actual: Point, expected: Point) => void = (
  actual: Point,
  expected: Point,
): void => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
};

const distance: (a: Point, b: Point) => number = (
  a: Point,
  b: Point,
): number => {
  return Math.hypot(a.x - b.x, a.y - b.y);
};

describe("clamp and section ids", () => {
  test("clamp keeps values in range and maps NaN to the minimum", () => {
    expect(Core.clamp(5, 0, 10)).toBe(5);
    expect(Core.clamp(-5, 0, 10)).toBe(0);
    expect(Core.clamp(15, 0, 10)).toBe(10);
    expect(Core.clamp(Number.NaN, 2, 10)).toBe(2);
  });

  test.each([
    ["m05", true],
    ["why", true],
    ["worksheets-2", true],
    ["0abc", true],
    ["M05", false],
    ["-m05", false],
    ["m05/", false],
    ["../etc", false],
    ["<script>", false],
    ["", false],
    ["a".repeat(65), false],
  ])("isSectionId(%j) is %s", (value: string, expected: boolean) => {
    expect(Core.isSectionId(value)).toBe(expected);
  });

  test("non-strings are never section ids", () => {
    for (const value of [null, undefined, 5, {}, ["m05"]]) {
      expect(Core.isSectionId(value)).toBe(false);
    }
  });
});

describe("computeLayout", () => {
  const CHROME: number = 64 + 76;

  test.each([
    [1440, 900, "spread"],
    [1366, 768, "spread"],
    [1024, 768, "spread"],
    [1000, 600, "spread"],
    [768, 1024, "single"],
    [390, 844, "single"],
    [320, 568, "single"],
    [899, 600, "single"],
    [900, 900, "single"],
    [1200, 1600, "single"],
  ])(
    "%ix%i lays out as a %s",
    (width: number, height: number, mode: string) => {
      const layout: Layout = Core.computeLayout({ width, height });

      expect(layout.mode).toBe(mode);
      expect(layout.bookWidth).toBe(
        mode === "spread" ? layout.pageWidth * 2 : layout.pageWidth,
      );
      expect(layout.bookHeight).toBe(layout.pageHeight);
      expect(layout.bookWidth).toBeLessThanOrEqual(width);
      expect(layout.pageHeight).toBeLessThanOrEqual(height - CHROME);
      expect(Number.isInteger(layout.pageWidth)).toBe(true);
      expect(Number.isInteger(layout.pageHeight)).toBe(true);
    },
  );

  test("a spread needs a wide, landscape viewport with room for two pages", () => {
    for (let width: number = 600; width <= 2400; width += 37) {
      for (let height: number = 400; height <= 1600; height += 53) {
        const expected: string =
          width >= 900 && (width - 176) / 2 >= 300 && width > height * 1.05
            ? "spread"
            : "single";

        expect(Core.computeLayout({ width, height }).mode).toBe(expected);
      }
    }
  });

  test("spread pages keep a book-like aspect ratio", () => {
    for (const [width, height] of [
      [1440, 900],
      [1366, 768],
      [1920, 1080],
      [2560, 1440],
      [1024, 768],
    ] as Array<[number, number]>) {
      const layout: Layout = Core.computeLayout({ width, height });

      expect(layout.mode).toBe("spread");
      expect(layout.pageWidth / layout.pageHeight).toBeGreaterThan(0.665);
      expect(layout.pageWidth / layout.pageHeight).toBeLessThan(0.69);
      expect(layout.pageHeight).toBeLessThanOrEqual(900);
    }
  });

  test("single pages on phones use the width they are given and stay portrait", () => {
    for (const [width, height] of [
      [390, 844],
      [320, 568],
      [414, 896],
      [360, 740],
    ] as Array<[number, number]>) {
      const layout: Layout = Core.computeLayout({ width, height });

      expect(layout.mode).toBe("single");
      expect(layout.pageWidth).toBe(width - 20);
      expect(layout.pageHeight / layout.pageWidth).toBeGreaterThanOrEqual(1.2);
    }
  });

  test("margins, text block and column gap are consistent", () => {
    const random: () => number = seededRandom(7);

    for (let run: number = 0; run < 200; run++) {
      const layout: Layout = Core.computeLayout(
        {
          width: 300 + Math.floor(random() * 2400),
          height: 480 + Math.floor(random() * 1400),
        },
        { fontStep: Math.floor(random() * 6) },
      );
      const lines: number = layout.contentHeight / layout.lineHeight;

      expect(layout.contentWidth).toBe(
        layout.pageWidth - layout.padding.inner - layout.padding.outer,
      );
      expect(layout.columnGap).toBe(
        layout.padding.inner + layout.padding.outer,
      );
      expect(layout.contentWidth).toBeGreaterThan(0);
      // The text block is a whole number of lines, and at least four.
      expect(Math.abs(lines - Math.round(lines))).toBeLessThan(0.01);
      expect(Math.round(lines)).toBeGreaterThanOrEqual(4);
      expect(layout.lineHeight).toBeCloseTo(layout.fontSize * 1.58, 0);
    }
  });

  test("the text block never runs past the page margins on a normal page", () => {
    const layout: Layout = Core.computeLayout({ width: 1440, height: 900 });

    expect(layout.contentHeight).toBeLessThanOrEqual(
      layout.pageHeight - layout.padding.top - layout.padding.bottom,
    );
    expect(
      layout.pageHeight -
        layout.padding.top -
        layout.padding.bottom -
        layout.contentHeight,
    ).toBeLessThan(layout.lineHeight);
  });

  test("font steps are clamped and rounded, and each step is larger than the last", () => {
    const viewport: { width: number; height: number } = {
      width: 1440,
      height: 900,
    };
    const sizes: Array<number> = Core.FONT_STEPS.map(
      (_step: number, index: number): number => {
        return Core.computeLayout(viewport, { fontStep: index }).fontSize;
      },
    );

    for (let index: number = 1; index < sizes.length; index++) {
      expect(sizes[index]!).toBeGreaterThan(sizes[index - 1]!);
    }

    expect(Core.computeLayout(viewport).fontStep).toBe(Core.DEFAULT_FONT_STEP);
    expect(Core.computeLayout(viewport, { fontStep: -3 }).fontStep).toBe(0);
    expect(Core.computeLayout(viewport, { fontStep: 99 }).fontStep).toBe(
      Core.FONT_STEPS.length - 1,
    );
    expect(Core.computeLayout(viewport, { fontStep: 2.4 }).fontStep).toBe(2);
    expect(Core.computeLayout(viewport, { fontStep: 2.6 }).fontStep).toBe(3);
  });

  test("taller chrome leaves a shorter page", () => {
    const normal: Layout = Core.computeLayout({ width: 1366, height: 768 });
    const tall: Layout = Core.computeLayout(
      { width: 1366, height: 768 },
      { chromeTop: 120, chromeBottom: 120 },
    );

    expect(tall.pageHeight).toBeLessThan(normal.pageHeight);
  });

  test("a missing or nonsensical viewport still produces a usable single page", () => {
    for (const viewport of [
      null,
      undefined,
      {},
      { width: Number.NaN, height: -5 },
      { width: "wide", height: "tall" },
    ]) {
      const layout: Layout = Core.computeLayout(viewport);

      expect(layout.mode).toBe("single");
      for (const value of [
        layout.pageWidth,
        layout.pageHeight,
        layout.contentWidth,
        layout.contentHeight,
        layout.fontSize,
        layout.lineHeight,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  test("layoutKey changes exactly when pagination would", () => {
    const base: Layout = Core.computeLayout({ width: 1440, height: 900 });

    expect(Core.layoutKey(base)).toBe(
      Core.layoutKey(Core.computeLayout({ width: 1440, height: 900 })),
    );
    expect(Core.layoutKey(base)).not.toBe(
      Core.layoutKey(
        Core.computeLayout({ width: 1440, height: 900 }, { fontStep: 4 }),
      ),
    );
    expect(Core.layoutKey(base)).not.toBe(
      Core.layoutKey(Core.computeLayout({ width: 390, height: 844 })),
    );
  });
});

describe("page maps", () => {
  test("every section gets at least one whole page", () => {
    const map: PageMap = Core.createPageMap([
      3,
      0,
      -2,
      Number.NaN,
      "4",
      2.7,
      undefined,
    ]);

    expect(map.counts).toEqual([3, 1, 1, 1, 4, 2, 1]);
    expect(map.starts).toEqual([0, 3, 4, 5, 6, 10, 12]);
    expect(map.total).toBe(13);
  });

  test("an empty book has no pages", () => {
    const map: PageMap = Core.createPageMap([]);

    expect(map.total).toBe(0);
    expect(Core.locatePage(map, 0)).toBeNull();
    expect(Core.viewCount(map.total, "spread")).toBe(0);
    expect(Core.viewCount(map.total, "single")).toBe(0);
  });

  test("locatePage agrees with a linear scan for many random books", () => {
    const random: () => number = seededRandom(42);

    for (let run: number = 0; run < 60; run++) {
      const map: PageMap = Core.createPageMap(randomCounts(random));

      for (let page: number = -2; page < map.total + 2; page++) {
        let expected: Located | null = null;

        if (page >= 0 && page < map.total) {
          let section: number = 0;

          while (
            section + 1 < map.starts.length &&
            map.starts[section + 1]! <= page
          ) {
            section++;
          }

          expected = { section, offset: page - map.starts[section]! };
        }

        expect(Core.locatePage(map, page)).toEqual(expected);
      }
    }
  });

  test("locatePage rejects missing maps and non-numbers", () => {
    const map: PageMap = Core.createPageMap([2, 2]);

    expect(Core.locatePage(null, 0)).toBeNull();
    expect(Core.locatePage(map, Number.NaN)).toBeNull();
    expect(Core.locatePage(map, 4)).toBeNull();
    expect(Core.locatePage(map, -1)).toBeNull();
  });

  test("pageOf clamps the offset into its section and ignores unknown sections", () => {
    const map: PageMap = Core.createPageMap([2, 3, 1]);

    expect(Core.pageOf(map, 1, 0)).toBe(2);
    expect(Core.pageOf(map, 1, 2)).toBe(4);
    expect(Core.pageOf(map, 1, 99)).toBe(4);
    expect(Core.pageOf(map, 1, -4)).toBe(2);
    expect(Core.pageOf(map, 1, 1.9)).toBe(3);
    expect(Core.pageOf(map, 7, 0)).toBe(0);
    expect(Core.pageOf(map, -1, 0)).toBe(0);
    expect(Core.pageOf(null, 0, 0)).toBe(0);
  });
});

describe("views", () => {
  test("a spread starts with the inside cover facing the first page", () => {
    expect(Core.viewPages(0, "spread")).toEqual([-1, 0]);
    expect(Core.viewPages(1, "spread")).toEqual([1, 2]);
    expect(Core.viewPages(4, "spread")).toEqual([7, 8]);
    expect(Core.viewPages(4, "single")).toEqual([4]);
  });

  test.each([1, 2, 3, 17, 18, 40, 41])(
    "every one of %i pages is shown by exactly the view it maps to",
    (total: number) => {
      for (const mode of ["spread", "single"]) {
        const views: number = Core.viewCount(total, mode);

        for (let page: number = 0; page < total; page++) {
          const view: number = Core.viewForPage(page, mode);

          expect(view).toBeGreaterThanOrEqual(0);
          expect(view).toBeLessThan(views);
          expect(Core.viewPages(view, mode)).toContain(page);
        }

        for (let view: number = 0; view < views; view++) {
          const primary: number = Core.primaryPage(view, mode, total);

          expect(primary).toBeGreaterThanOrEqual(0);
          expect(primary).toBeLessThan(total);
          expect(Core.viewForPage(primary, mode)).toBe(view);
        }

        // The last view shows the last page; nothing lies beyond it.
        expect(Core.viewForPage(total - 1, mode)).toBe(views - 1);
      }
    },
  );

  test("spreads end on the back endpaper when the page count is even", () => {
    expect(Core.viewCount(18, "spread")).toBe(10);
    expect(Core.viewPages(9, "spread")).toEqual([17, 18]);
    expect(Core.viewCount(17, "spread")).toBe(9);
    expect(Core.viewPages(8, "spread")).toEqual([15, 16]);
    expect(Core.viewCount(18, "single")).toBe(18);
  });

  test("viewForPage treats negative and fractional pages as the start", () => {
    expect(Core.viewForPage(-4, "spread")).toBe(0);
    expect(Core.viewForPage(Number.NaN, "single")).toBe(0);
    expect(Core.viewForPage(2.9, "single")).toBe(2);
  });

  test("the reading page is the left page unless a chapter starts only on the right", () => {
    // Sections start on pages 0, 1, 4 (counts 1, 3, 2).
    const map: PageMap = Core.createPageMap([1, 3, 2]);

    expect(Core.readingPage(map, 0, "spread")).toBe(0);
    // Pages 1 (start) and 2: the left page.
    expect(Core.readingPage(map, 1, "spread")).toBe(1);
    // Pages 3 (middle of a section) and 4 (a new section): the right page.
    expect(Core.readingPage(map, 2, "spread")).toBe(4);
    // Pages 5 and past the end.
    expect(Core.readingPage(map, 3, "spread")).toBe(5);
  });

  test("when chapters start on both pages of a spread, the left one is read first", () => {
    const map: PageMap = Core.createPageMap([1, 1, 1, 1]);

    expect(Core.readingPage(map, 1, "spread")).toBe(1);
    expect(Core.readingPage(map, 2, "spread")).toBe(3);
  });

  test("a single page is always its own reading page", () => {
    const map: PageMap = Core.createPageMap([1, 3, 2]);

    for (let view: number = 0; view < map.total; view++) {
      expect(Core.readingPage(map, view, "single")).toBe(view);
    }
    expect(Core.readingPage(null, 3, "single")).toBe(0);
  });
});

describe("reading positions", () => {
  test("every page survives a position round trip", () => {
    const random: () => number = seededRandom(1234);

    for (let run: number = 0; run < 25; run++) {
      const counts: Array<number> = randomCounts(random);
      const map: PageMap = Core.createPageMap(counts);
      const ids: Array<string> = counts.map(
        (_count: number, index: number): string => {
          return `s${index}`;
        },
      );

      for (let page: number = 0; page < map.total; page++) {
        const position: Position | null = Core.positionForPage(map, ids, page);

        expect(position).not.toBeNull();
        expect(position!.fraction).toBeGreaterThanOrEqual(0);
        expect(position!.fraction).toBeLessThan(1);
        expect(Core.pageForPosition(map, ids, position)).toBe(page);
      }
    }
  });

  test("a position is a fraction of its section, so it survives repagination", () => {
    const ids: Array<string> = ["a", "b", "c"];
    const small: PageMap = Core.createPageMap([2, 4, 2]);
    const large: PageMap = Core.createPageMap([3, 8, 3]);
    const position: Position | null = Core.positionForPage(small, ids, 4);

    expect(position).toEqual({ sectionId: "b", fraction: 0.5 });
    expect(Core.pageForPosition(large, ids, position)).toBe(3 + 4);
  });

  test("unknown sections, missing maps and out-of-range pages fall back safely", () => {
    const map: PageMap = Core.createPageMap([2, 2]);

    expect(Core.positionForPage(map, ["a", "b"], 9)).toBeNull();
    expect(
      Core.pageForPosition(map, ["a", "b"], { sectionId: "z", fraction: 0.5 }),
    ).toBe(0);
    expect(Core.pageForPosition(map, ["a", "b"], null)).toBe(0);
    expect(
      Core.pageForPosition(null, ["a"], { sectionId: "a", fraction: 0 }),
    ).toBe(0);
    expect(
      Core.pageForPosition(map, ["a", "b"], { sectionId: "b", fraction: 7 }),
    ).toBe(3);
    expect(
      Core.pageForPosition(map, ["a", "b"], { sectionId: "b", fraction: -1 }),
    ).toBe(2);
  });
});

describe("deep links", () => {
  test.each([
    ["#read", null],
    ["#read/", null],
    ["read", null],
    ["#read/m05", "m05"],
    ["read/m05", "m05"],
    ["#read/m%30%35", "m05"],
    ["#read/worksheets", "worksheets"],
    ["#read/%E0%A4%A", null],
    ["#read/<script>alert(1)</script>", null],
    ["#read/%3Cscript%3E", null],
    ["#read/../../etc/passwd", null],
    ["#read/M05", null],
    ["#read/m05?x=1", null],
    [`#read/${"a".repeat(65)}`, null],
  ])("%s opens the reader at %s", (hash: string, sectionId: string | null) => {
    expect(Core.parseReaderHash(hash)).toEqual({ sectionId });
  });

  test.each([
    "",
    "#",
    "#reading",
    "#readme",
    "#READ",
    "#inside-the-book",
    "#main-content",
  ])("%j is not a reader link", (hash: string) => {
    expect(Core.parseReaderHash(hash)).toBeNull();
  });

  test("non-string hashes are not reader links", () => {
    for (const value of [null, undefined, 5, {}, ["#read"]]) {
      expect(Core.parseReaderHash(value)).toBeNull();
    }
  });

  test("readerHash only ever writes valid section ids", () => {
    expect(Core.readerHash("m05")).toBe("#read/m05");
    expect(Core.readerHash(null)).toBe("#read");
    expect(Core.readerHash("")).toBe("#read");
    expect(Core.readerHash("<script>")).toBe("#read");
    expect(Core.readerHash("../x")).toBe("#read");
  });

  test("readerHash and parseReaderHash round trip", () => {
    for (const id of ["m01", "why", "contents", "worksheets-2"]) {
      expect(Core.parseReaderHash(Core.readerHash(id))).toEqual({
        sectionId: id,
      });
    }
  });
});

describe("stored state", () => {
  test("a stored position is parsed and normalised", () => {
    expect(
      Core.parseStoredPosition(
        JSON.stringify({
          sectionId: "m05",
          fraction: 0.25,
          label: "Move 05",
          progress: 0.4,
          updatedAt: 1700000000000,
        }),
      ),
    ).toEqual({
      sectionId: "m05",
      fraction: 0.25,
      label: "Move 05",
      progress: 0.4,
      updatedAt: 1700000000000,
    });
  });

  test("objects are accepted as well as JSON strings", () => {
    expect(Core.parseStoredPosition({ sectionId: "why" })).toEqual({
      sectionId: "why",
      fraction: 0,
      label: "",
      progress: 0,
      updatedAt: 0,
    });
  });

  test.each([
    ["{", null],
    ["null", null],
    ["[]", null],
    ['"m05"', null],
    [JSON.stringify({ sectionId: "M05" }), null],
    [JSON.stringify({ sectionId: "<b>" }), null],
    [JSON.stringify({ fraction: 0.5 }), null],
  ])("garbage %s is rejected", (raw: string, expected: null) => {
    expect(Core.parseStoredPosition(raw)).toBe(expected);
  });

  test("wrong types and out-of-range numbers are clamped", () => {
    const parsed: StoredPosition | null = Core.parseStoredPosition(
      JSON.stringify({
        sectionId: "m01",
        fraction: 3,
        label: "x".repeat(500),
        progress: 7,
        updatedAt: "yesterday",
      }),
    );

    expect(parsed).toEqual({
      sectionId: "m01",
      fraction: 0.9999,
      label: "x".repeat(160),
      progress: 1,
      updatedAt: 0,
    });
    expect(
      Core.parseStoredPosition({
        sectionId: "m01",
        fraction: "abc",
        label: 42,
        progress: -1,
      }),
    ).toEqual({
      sectionId: "m01",
      fraction: 0,
      label: "",
      progress: 0,
      updatedAt: 0,
    });
  });

  test("settings default when missing or broken", () => {
    const defaults: StoredSettings = {
      fontStep: Core.DEFAULT_FONT_STEP,
      theme: Core.DEFAULT_THEME,
    };

    for (const raw of [null, undefined, "", "{", "[]", "42", '"night"']) {
      expect(Core.parseStoredSettings(raw)).toEqual(defaults);
    }
  });

  test("settings are clamped, rounded and limited to known themes", () => {
    const last: number = Core.FONT_STEPS.length - 1;

    expect(Core.parseStoredSettings('{"fontStep":9,"theme":"night"}')).toEqual({
      fontStep: last,
      theme: "night",
    });
    expect(Core.parseStoredSettings({ fontStep: -1, theme: "sepia" })).toEqual({
      fontStep: 0,
      theme: "sepia",
    });
    expect(Core.parseStoredSettings({ fontStep: "3", theme: "paper" })).toEqual(
      { fontStep: 3, theme: "paper" },
    );
    expect(Core.parseStoredSettings({ fontStep: 2.6 })).toEqual({
      fontStep: 3,
      theme: Core.DEFAULT_THEME,
    });
    expect(
      Core.parseStoredSettings({ fontStep: "big", theme: "blue" }),
    ).toEqual({ fontStep: Core.DEFAULT_FONT_STEP, theme: Core.DEFAULT_THEME });
    expect(Core.THEMES).toEqual(["paper", "sepia", "night"]);
  });
});

describe("labels", () => {
  test.each([
    ["01 · The bill", "01", "The bill"],
    ["1 - The bill", "01", "The bill"],
    ["01: The bill", "1", "The bill"],
    ["01 – The bill", "01", "The bill"],
    ["01 — The bill", "01", "The bill"],
    ["01. The bill", "01", "The bill"],
    ["02 · Other", "01", "02 · Other"],
    ["10 · Ten", "1", "10 · Ten"],
    ["The bill", "01", "The bill"],
    ["01 · The bill", "", "01 · The bill"],
  ])(
    "stripNumberPrefix(%j, %j) is %j",
    (label: string, number: string, expected: string) => {
      expect(Core.stripNumberPrefix(label, number)).toBe(expected);
    },
  );

  test("stripNumberPrefix leaves non-strings alone", () => {
    expect(Core.stripNumberPrefix(null, "01")).toBeNull();
    expect(Core.stripNumberPrefix(7, "01")).toBe(7);
  });

  test.each([
    [0, "spread", 18, "Page 1 of 18"],
    [1, "spread", 18, "Pages 2–3 of 18"],
    [8, "spread", 18, "Pages 16–17 of 18"],
    [9, "spread", 18, "Page 18 of 18"],
    [8, "spread", 17, "Pages 16–17 of 17"],
    [10, "spread", 18, "Page 18 of 18"],
    [0, "single", 18, "Page 1 of 18"],
    [4, "single", 18, "Page 5 of 18"],
    [0, "spread", 1, "Page 1 of 1"],
    [0, "spread", 0, ""],
    [0, "single", 0, ""],
  ])(
    "pageLabel(%i, %s, %i) is %j",
    (view: number, mode: string, total: number, expected: string) => {
      expect(Core.pageLabel(view, mode, total)).toBe(expected);
    },
  );

  test("a part is a table of contents entry with whole chapters under it", () => {
    expect(
      Core.isPartEntry({
        label: "Stage 1",
        children: [{ sectionId: "m01" }, { sectionId: "m02" }],
      }),
    ).toBe(true);
    expect(
      Core.isPartEntry({
        label: "Stage 2",
        children: [{ sectionId: "m03" }],
      }),
    ).toBe(true);
    expect(
      Core.isPartEntry({
        label: "Worksheets",
        children: [
          { sectionId: "worksheets", anchorId: "a" },
          { sectionId: "worksheets", anchorId: "b" },
        ],
      }),
    ).toBe(false);
    expect(Core.isPartEntry({ label: "Why", children: [] })).toBe(false);
    expect(Core.isPartEntry({ label: "Why" })).toBe(false);
    expect(Core.isPartEntry(null)).toBe(false);
    expect(Core.isPartEntry(undefined)).toBe(false);
  });
});

describe("clipPolygon", () => {
  const WIDTH: number = 400;
  const HEIGHT: number = 600;
  const PAGE: Array<Point> = [
    { x: 0, y: 0 },
    { x: WIDTH, y: 0 },
    { x: WIDTH, y: HEIGHT },
    { x: 0, y: HEIGHT },
  ];

  test("the two sides of any line partition the page", () => {
    const random: () => number = seededRandom(99);

    for (let run: number = 0; run < 400; run++) {
      const origin: Point = {
        x: random() * WIDTH * 1.4 - WIDTH * 0.2,
        y: random() * HEIGHT * 1.4 - HEIGHT * 0.2,
      };
      const angle: number = random() * Math.PI * 2;
      const normal: Point = { x: Math.cos(angle), y: Math.sin(angle) };
      const inside: Array<Point> = Core.clipPolygon(PAGE, origin, normal, 1);
      const outside: Array<Point> = Core.clipPolygon(PAGE, origin, normal, -1);

      expect(polygonArea(inside) + polygonArea(outside)).toBeCloseTo(
        WIDTH * HEIGHT,
        3,
      );

      for (const point of inside) {
        expect(
          (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y,
        ).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  test("a line clear of the page keeps all of it on one side", () => {
    const origin: Point = { x: 1000, y: 0 };
    const normal: Point = { x: 1, y: 0 };

    expect(Core.clipPolygon(PAGE, origin, normal, 1)).toEqual(PAGE);
    expect(Core.clipPolygon(PAGE, origin, normal, -1)).toEqual([]);
  });
});

describe("constrainFoldPoint", () => {
  test("the corner stays within reach of the spine", () => {
    const random: () => number = seededRandom(5);
    const width: number = 400;
    const height: number = 600;
    const diagonal: number = Math.hypot(width, height);

    for (let run: number = 0; run < 500; run++) {
      for (const cornerY of [0, height]) {
        const point: Point = {
          x: random() * width * 6 - width * 3,
          y: random() * height * 5 - height * 2,
        };
        const constrained: Point = Core.constrainFoldPoint(
          point,
          width,
          height,
          cornerY,
        );

        expect(distance(constrained, { x: 0, y: cornerY })).toBeLessThanOrEqual(
          width + 1e-6,
        );
        expect(
          distance(constrained, { x: 0, y: height - cornerY }),
        ).toBeLessThanOrEqual(diagonal + 1e-6);
      }
    }
  });

  test("a point that is already reachable is left alone", () => {
    expect(Core.constrainFoldPoint({ x: 200, y: 500 }, 400, 600, 600)).toEqual({
      x: 200,
      y: 500,
    });
    expect(Core.constrainFoldPoint({ x: -400, y: 0 }, 400, 600, 0)).toEqual({
      x: -400,
      y: 0,
    });
  });
});

describe("foldGeometry", () => {
  const WIDTH: number = 420;
  const HEIGHT: number = 640;

  const cases: Array<{ side: number; corner: "top" | "bottom" }> = [
    { side: 1, corner: "bottom" },
    { side: 1, corner: "top" },
    { side: -1, corner: "bottom" },
    { side: -1, corner: "top" },
  ];

  test.each(cases)(
    "invariants hold for random drags (side $side, $corner corner)",
    ({ side, corner }: { side: number; corner: "top" | "bottom" }) => {
      const random: () => number = seededRandom(side * 10 + corner.length);
      const cornerPoint: Point = {
        x: side * WIDTH,
        y: corner === "top" ? 0 : HEIGHT,
      };

      for (let run: number = 0; run < 300; run++) {
        const geometry: FoldGeometry = Core.foldGeometry({
          width: WIDTH,
          height: HEIGHT,
          side,
          corner,
          point: {
            x: random() * WIDTH * 4 - WIDTH * 2,
            y: random() * HEIGHT * 2 - HEIGHT * 0.5,
          },
        });

        expect(geometry.progress).toBeGreaterThanOrEqual(0);
        expect(geometry.progress).toBeLessThanOrEqual(1);

        if (!geometry.folded) {
          continue;
        }

        const length: number = distance(cornerPoint, geometry.point);
        const normal: Point = {
          x: (cornerPoint.x - geometry.point.x) / length,
          y: (cornerPoint.y - geometry.point.y) / length,
        };
        const origin: Point = {
          x: (cornerPoint.x + geometry.point.x) / 2,
          y: (cornerPoint.y + geometry.point.y) / 2,
        };
        const [a, b, c, d] = geometry.matrix as [
          number,
          number,
          number,
          number,
        ];

        expectPointClose(geometry.foldOrigin, origin);
        expect(Math.cos((geometry.foldAngle * Math.PI) / 180)).toBeCloseTo(
          normal.x,
          6,
        );
        expect(Math.sin((geometry.foldAngle * Math.PI) / 180)).toBeCloseTo(
          normal.y,
          6,
        );

        // A rotation, never a mirror: the back page is not drawn reversed.
        expect(a * d - b * c).toBeCloseTo(1, 9);

        expect(geometry.flap).toHaveLength(geometry.reveal.length);
        geometry.reveal.forEach((vertex: Point, index: number) => {
          const flapVertex: Point = geometry.flap[index]!;

          // The flap is the part of the page beyond the fold, folded over.
          expectPointClose(flapVertex, reflect(vertex, origin, normal));
          // The back page, drawn flat across the spine, lands on the flap.
          expectPointClose(
            applyMatrix(geometry.matrix, { x: -vertex.x, y: vertex.y }),
            flapVertex,
          );
        });

        expect(
          polygonArea(geometry.front) + polygonArea(geometry.reveal),
        ).toBeCloseTo(WIDTH * HEIGHT, 2);
        expect(polygonArea(geometry.flap)).toBeCloseTo(
          polygonArea(geometry.reveal),
          2,
        );
        expect(
          distance(geometry.point, { x: 0, y: cornerPoint.y }),
        ).toBeLessThanOrEqual(WIDTH + 1e-6);
      }
    },
  );

  test.each(cases)(
    "resting at the corner nothing is folded (side $side, $corner corner)",
    ({ side, corner }: { side: number; corner: "top" | "bottom" }) => {
      const cornerPoint: Point = {
        x: side * WIDTH,
        y: corner === "top" ? 0 : HEIGHT,
      };
      const geometry: FoldGeometry = Core.foldGeometry({
        width: WIDTH,
        height: HEIGHT,
        side,
        corner,
        point: cornerPoint,
      });

      expect(geometry.folded).toBe(false);
      expect(geometry.progress).toBe(0);
      expect(geometry.flap).toEqual([]);
      expect(geometry.reveal).toEqual([]);
      expect(polygonArea(geometry.front)).toBeCloseTo(WIDTH * HEIGHT, 6);
      expect(geometry.matrix).toEqual([1, 0, 0, 1, 0, 0]);

      for (const vertex of geometry.front) {
        expect(side * vertex.x).toBeGreaterThanOrEqual(0);
        expect(side * vertex.x).toBeLessThanOrEqual(WIDTH);
      }
    },
  );

  test.each(cases)(
    "turned all the way over the flap is the opposite page (side $side, $corner corner)",
    ({ side, corner }: { side: number; corner: "top" | "bottom" }) => {
      const geometry: FoldGeometry = Core.foldGeometry({
        width: WIDTH,
        height: HEIGHT,
        side,
        corner,
        point: { x: -side * WIDTH, y: corner === "top" ? 0 : HEIGHT },
      });

      expect(geometry.folded).toBe(true);
      expect(geometry.progress).toBe(1);
      expect(polygonArea(geometry.front)).toBeCloseTo(0, 6);
      expect(polygonArea(geometry.reveal)).toBeCloseTo(WIDTH * HEIGHT, 6);
      expect(polygonArea(geometry.flap)).toBeCloseTo(WIDTH * HEIGHT, 6);

      for (const vertex of geometry.flap) {
        expect(-side * vertex.x).toBeGreaterThanOrEqual(-1e-9);
        expect(-side * vertex.x).toBeLessThanOrEqual(WIDTH + 1e-9);
      }

      // The back page is drawn exactly where it rests: no transform at all.
      [1, 0, 0, 1, 0, 0].forEach((value: number, index: number) => {
        expect(geometry.matrix[index]!).toBeCloseTo(value, 9);
      });
    },
  );

  test("progress grows as the corner moves across the book", () => {
    let previous: number = -1;

    for (let x: number = WIDTH; x >= -WIDTH; x -= WIDTH / 20) {
      const geometry: FoldGeometry = Core.foldGeometry({
        width: WIDTH,
        height: HEIGHT,
        side: 1,
        corner: "bottom",
        point: { x, y: HEIGHT },
      });

      expect(geometry.progress).toBeGreaterThan(previous);
      previous = geometry.progress;
    }

    expect(previous).toBe(1);
  });

  test("a point pulled far from the spine is kept within reach", () => {
    const geometry: FoldGeometry = Core.foldGeometry({
      width: WIDTH,
      height: HEIGHT,
      side: 1,
      corner: "bottom",
      point: { x: -5000, y: -5000 },
    });

    expect(distance(geometry.point, { x: 0, y: HEIGHT })).toBeLessThanOrEqual(
      WIDTH + 1e-6,
    );
    expect(geometry.progress).toBeLessThanOrEqual(1);
  });

  test("side defaults to the right-hand page and corner to the bottom", () => {
    const geometry: FoldGeometry = Core.foldGeometry({
      width: WIDTH,
      height: HEIGHT,
      point: { x: WIDTH, y: HEIGHT },
    });

    expect(geometry.folded).toBe(false);
    expect(geometry.foldOrigin).toEqual({ x: WIDTH, y: HEIGHT });
  });
});

describe("motion", () => {
  test("easeInOutCubic runs from 0 to 1, symmetrically and without overshoot", () => {
    expect(Core.easeInOutCubic(0)).toBe(0);
    expect(Core.easeInOutCubic(1)).toBe(1);
    expect(Core.easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
    expect(Core.easeInOutCubic(-1)).toBe(0);
    expect(Core.easeInOutCubic(2)).toBe(1);

    let previous: number = 0;

    for (let t: number = 0.01; t <= 1; t += 0.01) {
      const value: number = Core.easeInOutCubic(t);

      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      expect(value + Core.easeInOutCubic(1 - t)).toBeCloseTo(1, 9);
      previous = value;
    }
  });

  test("an automatic turn runs corner to corner, lifting the bottom corner up", () => {
    const from: Point = { x: 400, y: 600 };
    const to: Point = { x: -400, y: 600 };

    expectPointClose(Core.turnPath(0, from, to, 600), from);
    expectPointClose(Core.turnPath(1, from, to, 600), to);

    const middle: Point = Core.turnPath(0.5, from, to, 600);

    expect(middle.x).toBeCloseTo(0, 6);
    expect(middle.y).toBeCloseTo(600 - 60, 6);

    for (let t: number = 0.05; t < 1; t += 0.05) {
      expect(Core.turnPath(t, from, to, 600).y).toBeLessThan(600);
    }
  });

  test("a top-corner turn lifts down into the page", () => {
    const from: Point = { x: 400, y: 0 };
    const to: Point = { x: -400, y: 0 };

    expect(Core.turnPath(0.5, from, to, 600).y).toBeCloseTo(60, 6);
    expectPointClose(Core.turnPath(1, from, to, 600), to);
  });

  test("backward turns run the same path in reverse", () => {
    const forward: Point = Core.turnPath(
      0.3,
      { x: 400, y: 600 },
      { x: -400, y: 600 },
      600,
    );
    const backward: Point = Core.turnPath(
      0.7,
      { x: -400, y: 600 },
      { x: 400, y: 600 },
      600,
    );

    expectPointClose(forward, backward);
  });

  test.each([
    ["forward", -1, 0, true],
    ["forward", 10, 0, false],
    ["forward", 10, -0.5, true],
    ["forward", 10, -0.4, false],
    ["forward", -10, 2, true],
    ["backward", 1, 0, true],
    ["backward", -10, 0, false],
    ["backward", -10, 0.5, true],
    ["backward", -10, 0.2, false],
    ["backward", 10, -3, true],
  ])(
    "a %s drag released at x=%d with velocity %d completes: %s",
    (direction: string, x: number, velocityX: number, expected: boolean) => {
      expect(
        Core.shouldCompleteTurn({ direction, point: { x, y: 0 }, velocityX }),
      ).toBe(expected);
    },
  );

  test("an unknown velocity counts as standing still", () => {
    expect(
      Core.shouldCompleteTurn({
        direction: "forward",
        point: { x: 5, y: 0 },
        velocityX: "fast",
      }),
    ).toBe(false);
    expect(
      Core.shouldCompleteTurn({
        direction: "backward",
        point: { x: -5, y: 0 },
      }),
    ).toBe(false);
  });
});
