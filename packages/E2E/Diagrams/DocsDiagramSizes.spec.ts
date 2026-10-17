import { Page, TestInfo, expect, test } from "@playwright/test";

/*
 * How big the docs draw a diagram, in a real browser: mermaid lays a diagram
 * out at a size of its own, and the docs' diagram script (App/FeatureSet/
 * Docs/Views/Partials/Head.ejs) fits that to the article's column.
 *
 *   - Narrower than the column: drawn at its own size, in the middle of the
 *     column. (The script used to stretch every diagram to the column's full
 *     width: a 263px diagram was drawn 590px wide, its labels 36px high.)
 *   - A little wider: drawn smaller to fit the column, down to 13/16 of its
 *     size - its 16px labels no smaller than the 13px caption under it.
 *   - Wider still: drawn at 13/16 of its size, in a box that scrolls.
 *
 * And every diagram the docs draw, in English and German (whose words run
 * longest), fits the column at 13/16 of its size at most, so none scrolls
 * sideways at 1280px: the final pass of the docs overhaul found 85 that did,
 * in all 17 languages, and redrew them.
 *
 * The fixture (Fixture/server.js) gives each diagram the box the docs'
 * article gives it at 1280px: 590px inside its padding.
 */

const COLUMN: number = 590;
const MIN_SCALE: number = 13 / 16;
// What the browser may round a drawn width by.
const ROUNDING: number = 1.5;

interface DrawnDiagram {
  source: string;
  // The size mermaid laid it out at (its viewBox).
  natural: number;
  // How wide it is drawn, and where, inside its box's padding.
  drawn: number;
  left: number;
  column: number;
  scrolls: boolean;
}

type DrawnDiagramsFunction = (page: Page) => Promise<Array<DrawnDiagram>>;

// Waits until every diagram of the page is drawn, then measures each.
const drawnDiagrams: DrawnDiagramsFunction = async (
  page: Page,
): Promise<Array<DrawnDiagram>> => {
  await expect
    .poll(
      async (): Promise<number> => {
        return page.evaluate((): number => {
          return Array.from(
            document.querySelectorAll(".docs-diagram .mermaid"),
          ).filter((element: Element): boolean => {
            return !element.getAttribute("data-diagram");
          }).length;
        });
      },
      { timeout: 300000, intervals: [1000] },
    )
    .toBe(0);

  return page.evaluate((): Array<DrawnDiagram> => {
    return Array.from(document.querySelectorAll(".docs-diagram")).map(
      (box: Element): DrawnDiagram => {
        const svg: SVGSVGElement | null = box.querySelector(".mermaid svg");
        const style: CSSStyleDeclaration = getComputedStyle(box);
        const boxRect: DOMRect = box.getBoundingClientRect();
        const svgRect: DOMRect | null = svg
          ? svg.getBoundingClientRect()
          : null;
        const paddingLeft: number = parseFloat(style.paddingLeft);
        const viewBox: Array<number> = (svg?.getAttribute("viewBox") || "")
          .split(/[\s,]+/)
          .map(Number);

        return {
          source:
            box.getAttribute("data-source") ||
            box.querySelector(".docs-diagram__caption")?.textContent ||
            "",
          natural: viewBox[2] || 0,
          drawn: svgRect ? svgRect.width : 0,
          left: svgRect
            ? svgRect.left - boxRect.left - box.clientLeft - paddingLeft
            : 0,
          column:
            box.clientWidth - paddingLeft - parseFloat(style.paddingRight),
          scrolls: box.scrollWidth > box.clientWidth + 1,
        };
      },
    );
  });
};

test.describe("the docs draw a diagram", () => {
  test("narrower than the column at its own size, in the middle of the column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/docs?diagrams=sizes");

    const [narrow] = (await drawnDiagrams(page)) as [DrawnDiagram];

    expect(narrow.column).toBeCloseTo(COLUMN, 0);
    expect(narrow.natural).toBeGreaterThan(50);
    expect(narrow.natural).toBeLessThan(COLUMN / 2);
    // Not stretched to the column's width.
    expect(Math.abs(narrow.drawn - narrow.natural)).toBeLessThanOrEqual(
      ROUNDING,
    );
    // As far from the column's left edge as from its right.
    expect(
      Math.abs(narrow.left - (narrow.column - narrow.drawn) / 2),
    ).toBeLessThanOrEqual(ROUNDING);
    expect(narrow.scrolls).toBe(false);
  });

  test("a little wider than the column smaller, to fit it, without scrolling", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/docs?diagrams=sizes");

    const [, wider] = (await drawnDiagrams(page)) as [
      DrawnDiagram,
      DrawnDiagram,
    ];

    // Wider than the column, but it fits at 13/16 of its size.
    expect(wider.natural).toBeGreaterThan(COLUMN);
    expect(wider.natural * MIN_SCALE).toBeLessThanOrEqual(COLUMN);
    expect(Math.abs(wider.drawn - wider.column)).toBeLessThanOrEqual(ROUNDING);
    expect(wider.drawn / wider.natural).toBeGreaterThanOrEqual(MIN_SCALE);
    expect(wider.scrolls).toBe(false);
  });

  test("too wide to fit at 13/16 of its size at that size, in a box that scrolls", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/docs?diagrams=sizes");

    const [, , widest] = (await drawnDiagrams(page)) as [
      DrawnDiagram,
      DrawnDiagram,
      DrawnDiagram,
    ];

    expect(widest.natural * MIN_SCALE).toBeGreaterThan(COLUMN);
    expect(
      Math.abs(widest.drawn - Math.ceil(widest.natural * MIN_SCALE)),
    ).toBeLessThanOrEqual(ROUNDING);
    expect(widest.scrolls).toBe(true);
    // The box scrolls from the diagram's left edge.
    expect(Math.abs(widest.left)).toBeLessThanOrEqual(ROUNDING);
  });
});

test.describe("every docs diagram", () => {
  for (const lang of ["en", "de"]) {
    test(`in ${lang} fits the 590px column at 13/16 of its size at most, so none scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }, testInfo: TestInfo) => {
      // Mermaid lays out the same in both browsers; one draw of every diagram is enough.
      test.skip(
        testInfo.project.name !== "chromium",
        "Drawn once, in Chromium",
      );
      test.setTimeout(600000);

      await page.goto(`/docs?source=${lang}`);

      const diagrams: Array<DrawnDiagram> = await drawnDiagrams(page);

      // Every page's diagrams, each drawn: mermaid parsed them all.
      expect(diagrams.length).toBeGreaterThan(300);
      expect(
        diagrams
          .filter((diagram: DrawnDiagram): boolean => {
            return diagram.natural <= 0;
          })
          .map((diagram: DrawnDiagram): string => {
            return diagram.source;
          }),
      ).toEqual([]);

      // Too wide: "<page>#<n>: <width>px".
      expect(
        diagrams
          .filter((diagram: DrawnDiagram): boolean => {
            return diagram.scrolls || diagram.natural * MIN_SCALE > COLUMN;
          })
          .map((diagram: DrawnDiagram): string => {
            return `${diagram.source}: ${Math.round(diagram.natural)}px`;
          }),
      ).toEqual([]);

      // None is drawn larger than mermaid laid it out.
      expect(
        diagrams
          .filter((diagram: DrawnDiagram): boolean => {
            return diagram.drawn > diagram.natural + ROUNDING;
          })
          .map((diagram: DrawnDiagram): string => {
            return diagram.source;
          }),
      ).toEqual([]);
    });
  }
});
