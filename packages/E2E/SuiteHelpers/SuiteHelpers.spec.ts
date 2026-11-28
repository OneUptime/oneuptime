import { expect, Locator, Page, Route, test } from "@playwright/test";
import { cardBodyMisfits } from "./CardBodyFit";
import {
  DrawnBox,
  DrawnBoxes,
  drawnBoxAt,
  drawnPlacesOf,
  readDrawnBoxes,
  recordDrawnBoxes,
  waitForFrames,
} from "./DrawnBoxes";
import {
  boxesInOneFrame,
  FrameBox,
  joinPiecesByLine,
  lineBoxesInOneFrame,
} from "./Frames";
import {
  dashboardLocalesIn,
  dashboardWord,
  expectPageLoadsOnlyItsLanguage,
  LocaleWatch,
  watchDashboardLocales,
} from "./LocaleChunks";
import {
  NO_BREAK_SPACE,
  NO_BREAK_SPACE_SHOWN_AS,
  withSpacesShown,
  withUnit,
} from "./NoBreakSpaces";
import {
  drawnTextOf,
  EMPTY_FIGURE_TEST_ID,
  expectQuietDash,
  heardTextOf,
  NOT_SET,
  QUIET_DASH,
} from "./QuietDash";
import { expectNoSidewaysScroll, sidewaysScrollOf } from "./PageFit";
import {
  AxeViolation,
  axeViolations,
  expectNoAxeViolations,
  SHARED_UI_AXE_RULES,
} from "./Axe";

/*
 * The helpers every focused suite shares, on pages written here: no fixture
 * server, nothing bundled. A helper that stopped doing its one job would
 * let every suite that leans on it pass what it should fail, or fail what
 * it should pass, so each is held to that job here, in Chromium and
 * Firefox.
 */

// A phone's window.
const PHONE: { width: number; height: number } = { width: 390, height: 700 };

/*
 * Holds every requestAnimationFrame callback, as a busy runner's slow frames
 * do: the page draws what it drew before until the callback runs. 250 ms
 * reproduced the suites' failures on a quiet machine (2026-11-02); here it
 * is longer still, so the first read is sure to land before the fitted
 * frame.
 */
function holdEveryFrame(milliseconds: number): string {
  return `(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      return requestFrame(() => {
        setTimeout(() => {
          callback(performance.now());
        }, ${milliseconds});
      });
    };
  })();`;
}

/*
 * A table drawn at its natural width, then fitted to its card two frames
 * later, as Common's Table measures its card after it paints
 * (useTableBoxWidth) and fits its columns on the next frame - with every
 * frame held, from the page's first script (an init script does not reach
 * a page written with setContent in Chromium).
 */
function tableFittedAFrameLater(holdEachFrameInMs: number): string {
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script>${holdEveryFrame(holdEachFrameInMs)}</script></head>
<body style="margin:0">
  <div id="card" style="padding:8px">
    <div id="table" style="width:900px;height:40px;background:#eee">Name Status Owner Labels Updated</div>
  </div>
  <script>
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById("table").style.width = "100%";
      });
    });
  </script>
</body></html>`;
}

function pageOfWidth(contentWidth: string): string {
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0"><div style="width:${contentWidth};height:40px;background:#eee">content</div></body></html>`;
}

async function failureOf(work: Promise<void>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return String((error as Error).message);
  }

  return "it passed";
}

test.describe("expectNoSidewaysScroll", () => {
  test.use({ viewport: PHONE });

  test("passes a page that fits its window, at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(pageOfWidth("100%"));

    expect(await sidewaysScrollOf(page)).toBeLessThanOrEqual(0);
    await expectNoSidewaysScroll(page, { timeout: 1000 });
  });

  test("fails a page that runs past its window, saying by how many pixels", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(pageOfWidth("600px"));

    expect(await sidewaysScrollOf(page)).toBe(600 - PHONE.width);

    const failure: string = await failureOf(
      expectNoSidewaysScroll(page, {
        timeout: 1500,
        message: "the board on a phone",
      }),
    );

    expect(failure).toContain(
      "the board on a phone: how many pixels the page reaches past its window (at most 0)",
    );
    expect(failure).toContain(String(600 - PHONE.width));
  });

  test("waits for a table fitted to its card a frame after it paints, with every frame held", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(tableFittedAFrameLater(1000));

    /*
     * One read lands on the frame before the table is fitted - the race
     * the suites' one-shot reads lost on slow runners.
     */
    expect(await sidewaysScrollOf(page)).toBeGreaterThan(1);

    await expectNoSidewaysScroll(page);

    expect(await sidewaysScrollOf(page)).toBeLessThanOrEqual(0);
  });

  test("takes a tolerance, none when left out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(pageOfWidth(`${PHONE.width + 3}px`));

    await expectNoSidewaysScroll(page, { tolerance: 3, timeout: 1000 });
    expect(
      await failureOf(
        expectNoSidewaysScroll(page, { tolerance: 2, timeout: 1000 }),
      ),
    ).toContain("(at most 2)");

    await page.setContent(pageOfWidth(`${PHONE.width + 1}px`));
    await expectNoSidewaysScroll(page, { tolerance: 1, timeout: 1000 });
    expect(
      await failureOf(expectNoSidewaysScroll(page, { timeout: 1000 })),
    ).toContain("(at most 0)");

    await page.setContent(pageOfWidth(`${PHONE.width}px`));
    await expectNoSidewaysScroll(page, { timeout: 1000 });
  });

  test("reads the page the window scrolls across, not an element that scrolls in its own box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0">
  <div style="overflow-x:auto"><div style="width:2000px;height:40px">a wide table in its own box</div></div>
</body></html>`);

    await expectNoSidewaysScroll(page, { timeout: 1000 });
  });
});

test.describe("boxesInOneFrame", () => {
  test("reads every box at the same moment, while they move", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Two boxes 120 pixels apart, sliding across the page together.
    await page.setContent(`<!doctype html>
<html><body style="margin:0">
  <div id="rail" style="position:absolute;left:0;top:0">
    <div id="first" style="position:absolute;left:0;top:0;width:40px;height:20px;background:#ccc"></div>
    <div id="second" style="position:absolute;left:120px;top:30px;width:40px;height:20px;background:#999"></div>
  </div>
  <script>
    const rail = document.getElementById("rail");
    const started = performance.now();
    const move = () => {
      rail.style.left = Math.round((performance.now() - started) / 4) % 600 + "px";
      requestAnimationFrame(move);
    };
    requestAnimationFrame(move);
  </script>
</body></html>`);

    const first: Locator = page.locator("#first");
    const second: Locator = page.locator("#second");

    for (let read: number = 0; read < 10; read++) {
      const boxes: Array<FrameBox> = await boxesInOneFrame([first, second]);

      expect(boxes[1]!.x - boxes[0]!.x).toBe(120);
      expect(boxes[1]!.y - boxes[0]!.y).toBe(30);
      expect(boxes[0]!.width).toBe(40);
    }
  });

  test("fails naming an element that is not displayed, rather than reading a box of zeros", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(`<!doctype html>
<html><body>
  <div id="shown" style="width:40px;height:20px"></div>
  <div id="hidden" style="display:none;width:40px;height:20px"></div>
  <div id="contents" style="display:contents"><span>text</span></div>
</body></html>`);

    const failure: string = await boxesInOneFrame([
      page.locator("#shown"),
      page.locator("#hidden"),
      page.locator("#contents"),
    ]).then(
      (): string => {
        return "it read three boxes";
      },
      (error: Error): string => {
        return error.message;
      },
    );

    expect(failure).toContain("not displayed");
    expect(failure).toContain("#hidden");
    expect(failure).toContain("#contents");
    expect(failure).not.toContain("#shown");
  });

  test("reads no boxes for no locators", async ({ page }: { page: Page }) => {
    await page.setContent("<!doctype html><html><body></body></html>");

    expect(await boxesInOneFrame([])).toEqual([]);
  });
});

/*
 * #8690: Cloud Connect's Persian Azure health line read OneUptime's words,
 * which started beside Azure's sentence and wrapped onto the next line, by
 * their bounding box - which spans both lines - and found them over Azure's
 * sentence. lineBoxesInOneFrame reads an element line by line.
 */
test.describe("lineBoxesInOneFrame and joinPiecesByLine", () => {
  /*
   * Lines ten monospace characters wide: "abcd efgh" fits the first, and
   * "ijkl" wraps onto the second. "abcd" is set apart as Cloud Connect sets
   * Azure's words apart (<bdi>), so on a right-to-left line it starts the
   * line at its right, and "efgh" follows it, to its left.
   */
  function tenCharacterLines(direction: "ltr" | "rtl"): string {
    return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0">
  <p id="line" dir="${direction}" style="margin:0;width:10ch;font:16px/20px monospace"><bdi id="before">abcd</bdi> <span id="wrapped">efgh ijkl</span></p>
</body></html>`;
  }

  interface TenCharacterLines {
    line: FrameBox;
    before: FrameBox;
    wrapped: Array<FrameBox>;
  }

  // The paragraph's box, "abcd"'s, and the wrapped span's, line by line.
  async function readTenCharacterLines(page: Page): Promise<TenCharacterLines> {
    const read: Array<Array<FrameBox>> = await lineBoxesInOneFrame([
      page.locator("#line"),
      page.locator("#before"),
      page.locator("#wrapped"),
    ]);

    return {
      line: read[0]![0]!,
      before: read[1]![0]!,
      wrapped: read[2]!,
    };
  }

  // Whether two edges are the same, to well under a pixel.
  function expectSameEdge(edge: number, other: number, what: string): void {
    expect(Math.abs(edge - other), what).toBeLessThan(0.5);
  }

  /*
   * Whether two lists of boxes are the same, to a hundredth of a pixel:
   * Firefox's bounding box can be 114.00003 pixels wide over pieces that
   * add up to 114.
   */
  function expectSameBoxes(
    boxes: Array<FrameBox>,
    others: Array<FrameBox>,
  ): void {
    expect(boxes).toHaveLength(others.length);
    for (const [index, box] of boxes.entries()) {
      for (const side of ["x", "y", "width", "height"] as const) {
        expect(box[side], `box ${index + 1}'s ${side}`).toBeCloseTo(
          others[index]![side],
          2,
        );
      }
    }
  }

  /*
   * Whether `lower` is drawn on a line under `upper`'s. An inline box can be
   * taller than its line - Firefox draws a 16px monospace line of 20px in a
   * box of 21 - so the next line's box starts a pixel above where this one
   * ends; it never starts above this one's middle.
   */
  function expectLineUnder(lower: FrameBox, upper: FrameBox): void {
    expect(lower.y).toBeGreaterThan(upper.y + upper.height / 2);
  }

  test("an element on one line has one box, its bounding box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(`<!doctype html><html><body style="margin:0">
  <p style="margin:0;font:16px/20px monospace">abcd <span id="word">efgh</span></p>
  <div id="block" style="width:120px;height:30px"></div>
</body></html>`);

    const [word, block]: Array<Array<FrameBox>> = await lineBoxesInOneFrame([
      page.locator("#word"),
      page.locator("#block"),
    ]);
    const [wordBounds, blockBounds]: Array<FrameBox> = await boxesInOneFrame([
      page.locator("#word"),
      page.locator("#block"),
    ]);

    expectSameBoxes(word!, [wordBounds!]);
    expectSameBoxes(block!, [blockBounds!]);
    expect(block![0]!.width).toBe(120);
  });

  test("an element that wraps has a box on each line, where its bounding box spans them and overlaps what shares its first line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(tenCharacterLines("ltr"));

    const { line, before, wrapped }: TenCharacterLines =
      await readTenCharacterLines(page);
    const [bounds]: Array<FrameBox> = await boxesInOneFrame([
      page.locator("#wrapped"),
    ]);

    expect(wrapped).toHaveLength(2);
    // Its first line after "abcd ", its second from the line's start, under it.
    expect(wrapped[0]!.y).toBe(before.y);
    expect(wrapped[0]!.x).toBeGreaterThanOrEqual(before.x + before.width);
    expectSameEdge(wrapped[1]!.x, line.x, "the second line's start");
    expectLineUnder(wrapped[1]!, wrapped[0]!);
    // The bounding box starts at the first line's top and overlaps "abcd".
    expect(bounds!.y).toBe(wrapped[0]!.y);
    expect(bounds!.x).toBeLessThan(before.x + before.width);
  });

  test("right to left, a wrapped element's first line is left of what starts the line, and its next starts at the right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(tenCharacterLines("rtl"));

    const { line, before, wrapped }: TenCharacterLines =
      await readTenCharacterLines(page);
    const [bounds]: Array<FrameBox> = await boxesInOneFrame([
      page.locator("#wrapped"),
    ]);
    const rightOf: (box: FrameBox) => number = (box: FrameBox): number => {
      return box.x + box.width;
    };

    expect(wrapped).toHaveLength(2);
    // "abcd" starts the line at its right; "efgh" follows it, to its left.
    expectSameEdge(rightOf(before), rightOf(line), "abcd starts the line");
    expect(wrapped[0]!.y).toBe(before.y);
    expect(rightOf(wrapped[0]!)).toBeLessThanOrEqual(before.x + 0.5);
    // "ijkl" starts the next line at its right.
    expectSameEdge(
      rightOf(wrapped[1]!),
      rightOf(line),
      "the second line's start",
    );
    expectLineUnder(wrapped[1]!, wrapped[0]!);
    // The bounding box reaches the right edge, over "abcd": the trap of #8690.
    expect(rightOf(bounds!)).toBeGreaterThan(before.x);
    expect(bounds!.y).toBe(before.y);
  });

  test("a line that runs both ways is one box, whatever pieces the browser draws it in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
  <p dir="rtl" style="margin:0;width:600px;font:16px/20px sans-serif"><span id="mixed">علت آن Azure بود.</span></p>
</body></html>`);

    const [mixed]: Array<Array<FrameBox>> = await lineBoxesInOneFrame([
      page.locator("#mixed"),
    ]);
    const [bounds]: Array<FrameBox> = await boxesInOneFrame([
      page.locator("#mixed"),
    ]);

    expectSameBoxes(mixed!, [bounds!]);
  });

  test("fails naming an element that is not displayed, as boxesInOneFrame does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(`<!doctype html><html><body>
  <div id="shown" style="width:40px;height:20px"></div>
  <div id="hidden" style="display:none"></div>
</body></html>`);

    const failure: string = await lineBoxesInOneFrame([
      page.locator("#shown"),
      page.locator("#hidden"),
    ]).then(
      (): string => {
        return "it read the boxes";
      },
      (error: Error): string => {
        return error.message;
      },
    );

    expect(failure).toContain(
      "lineBoxesInOneFrame: not displayed, so there is no box to compare",
    );
    expect(failure).toContain("#hidden");
    expect(failure).not.toContain("#shown");
    expect(await lineBoxesInOneFrame([])).toEqual([]);
  });

  test("joinPiecesByLine joins the pieces on a line, a pixel apart or out of order, and keeps lines apart, top to bottom", () => {
    expect(joinPiecesByLine([])).toEqual([]);

    // Three pieces of one line, right to left, the Latin one a pixel lower.
    expect(
      joinPiecesByLine([
        { x: 100, y: 10, width: 40, height: 15 },
        { x: 60, y: 11, width: 36, height: 15 },
        { x: 20, y: 10, width: 30, height: 15 },
      ]),
    ).toEqual([{ x: 20, y: 10, width: 120, height: 16 }]);

    // Two lines given bottom first, each in two pieces.
    expect(
      joinPiecesByLine([
        { x: 0, y: 26, width: 30, height: 15 },
        { x: 50, y: 10, width: 30, height: 15 },
        { x: 34, y: 26, width: 10, height: 15 },
        { x: 0, y: 10, width: 40, height: 15 },
      ]),
    ).toEqual([
      { x: 0, y: 10, width: 80, height: 15 },
      { x: 0, y: 26, width: 44, height: 15 },
    ]);

    // Lines that touch are still two: neither middle is within the other.
    expect(
      joinPiecesByLine([
        { x: 0, y: 0, width: 10, height: 20 },
        { x: 0, y: 20, width: 10, height: 20 },
      ]),
    ).toHaveLength(2);
  });

  test("joinPiecesByLine leaves out a piece with no width - the space a line wraps at - unless it is all there is", () => {
    expect(
      joinPiecesByLine([
        { x: 200, y: 0, width: 0, height: 15 },
        { x: 0, y: 16, width: 40, height: 15 },
      ]),
    ).toEqual([{ x: 0, y: 16, width: 40, height: 15 }]);

    expect(joinPiecesByLine([{ x: 12, y: 4, width: 0, height: 15 }])).toEqual([
      { x: 12, y: 4, width: 0, height: 15 },
    ]);
  });
});

/*
 * recordDrawnBoxes keeps where elements are drawn in every frame, from the
 * page's first. Its recorder is an init script, which a page written with
 * setContent never runs in Chromium, so these pages are served at an
 * address of their own (answered here, nothing leaves the browser).
 */
test.describe("recordDrawnBoxes", () => {
  const HOST: string = "http://suite-helpers.test";

  // A page of this body, opened at an address so init scripts run in it.
  const openPage: (page: Page, body: string) => Promise<void> = async (
    page: Page,
    body: string,
  ): Promise<void> => {
    await page.route(`${HOST}/**`, async (route: Route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${body}</body></html>`,
      });
    });
    await page.goto(`${HOST}/page`);
  };

  test("an element drawn once, where it stays, has one place, and no animation", async ({
    page,
  }: {
    page: Page;
  }) => {
    await recordDrawnBoxes(page, { selector: "#box" });
    await openPage(
      page,
      `<div style="padding:10px"><div id="box" style="width:120px;height:40px;background:#ccc"></div></div>`,
    );
    await waitForFrames(page, 10);

    const boxes: Array<DrawnBox> = (await readDrawnBoxes(page))["box"]!;

    expect(drawnPlacesOf(boxes)).toEqual(["120x40 at 10,10"]);
    expect(boxes[0]!.animations).toBe(0);
  });

  test("an element grown into its size is drawn at every size it grew through, with the transition that grew it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await recordDrawnBoxes(page, { selector: "#widget" });
    /*
     * As the dashboard's board drew its widgets until November 2026: a
     * sliver first, its width read (which styles it at that size), then
     * its real width through a transition.
     */
    await openPage(
      page,
      `<div id="board"></div>
<script>
  const widget = document.createElement("div");
  widget.id = "widget";
  widget.style.cssText = "width:20px;height:30px;background:#999;transition:width 0.3s linear";
  document.getElementById("board").appendChild(widget);
  void widget.getBoundingClientRect().width;
  widget.style.width = "300px";
</script>`,
    );
    await waitForFrames(page, 40);

    const boxes: Array<DrawnBox> = (await readDrawnBoxes(page))["widget"]!;
    const places: Array<string> = drawnPlacesOf(boxes);

    expect(places.length).toBeGreaterThan(2);
    expect(places[places.length - 1]).toBe("300x30 at 0,0");
    expect(boxes[0]!.width).toBeLessThan(300);
    expect(
      Math.max(
        ...boxes.map((box: DrawnBox): number => {
          return box.animations;
        }),
      ),
    ).toBeGreaterThan(0);
  });

  test("each box says the frame it was drawn in, and drawnBoxAt reads where an element was in any frame", async ({
    page,
  }: {
    page: Page;
  }) => {
    await recordDrawnBoxes(page, { selector: "#still, #widget" });
    // Two elements drawn together, one of them growing for a while.
    await openPage(
      page,
      `<div id="still" style="width:40px;height:10px"></div>
<div id="board"></div>
<script>
  const widget = document.createElement("div");
  widget.id = "widget";
  widget.style.cssText = "width:20px;height:30px;background:#999;transition:width 0.3s linear";
  document.getElementById("board").appendChild(widget);
  void widget.getBoundingClientRect().width;
  widget.style.width = "300px";
</script>`,
    );
    await waitForFrames(page, 40);

    const drawn: DrawnBoxes = await readDrawnBoxes(page);
    const still: Array<DrawnBox> = drawn["still"]!;
    const grown: Array<DrawnBox> = drawn["widget"]!;

    // Painted together, first.
    expect(still[0]!.frame).toBe(grown[0]!.frame);

    // A frame after another, as it grew.
    for (let index: number = 1; index < grown.length; index++) {
      expect(grown[index]!.frame).toBeGreaterThan(grown[index - 1]!.frame);
    }

    // Where it was in a frame: its last box drawn by then.
    expect(drawnBoxAt(grown, grown[0]!.frame - 1)).toBeNull();
    expect(drawnBoxAt(grown, grown[0]!.frame)).toBe(grown[0]);
    expect(drawnBoxAt(grown, grown[1]!.frame)).toBe(grown[1]);
    expect(drawnBoxAt(grown, grown[grown.length - 1]!.frame + 100)).toBe(
      grown[grown.length - 1],
    );
    // The still one never moved: its first box, in every frame after.
    expect(drawnBoxAt(still, grown[grown.length - 1]!.frame)).toBe(still[0]);
  });

  test("reads each frame as it is painted: a size a ResizeObserver corrects before the paint is never recorded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await recordDrawnBoxes(page, { selector: "#widget" });
    /*
     * A widget laid out for a board 400px wide in a board that turns out
     * 300px wide, put right by the page's ResizeObserver - after the frame
     * is laid out, before it is painted - as the dashboard's board follows
     * its width. Only the size painted is drawn.
     */
    await openPage(
      page,
      `<div id="board" style="width:300px"><div id="probe" style="height:0"></div><div id="widget" style="width:133px;height:30px;background:#999"></div></div>
<script>
  const widget = document.getElementById("widget");
  new ResizeObserver(() => {
    widget.style.width = "100px";
  }).observe(document.getElementById("probe"));
</script>`,
    );
    await waitForFrames(page, 10);

    expect(drawnPlacesOf((await readDrawnBoxes(page))["widget"]!)).toEqual([
      "100x30 at 0,0",
    ]);
  });

  test("an element added later with a ResizeObserver of its own is read after that observer too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await recordDrawnBoxes(page, { selector: "#first, #widget" });
    /*
     * The recorder is watching #first already when the widget comes, with
     * the observer that puts its width right before it is painted - as a
     * dashboard's board comes after the page around it.
     */
    await openPage(
      page,
      `<div id="first" style="width:50px;height:10px"></div><div id="board" style="width:300px"></div>
<script>
  setTimeout(() => {
    const probe = document.createElement("div");
    probe.style.height = "0";
    const widget = document.createElement("div");
    widget.id = "widget";
    widget.style.cssText = "width:133px;height:30px;background:#999";
    document.getElementById("board").append(probe, widget);
    new ResizeObserver(() => {
      widget.style.width = "100px";
    }).observe(probe);
    window.__widgetAdded = true;
  }, 150);
</script>`,
    );
    await page.waitForFunction((): boolean => {
      return Boolean(
        (window as unknown as { __widgetAdded?: boolean }).__widgetAdded,
      );
    });
    await waitForFrames(page, 10);

    const drawn: DrawnBoxes = await readDrawnBoxes(page);

    expect(drawnPlacesOf(drawn["first"]!)).toEqual(["50x10 at 0,0"]);
    expect(drawnPlacesOf(drawn["widget"]!)).toEqual(["100x30 at 0,0"]);
  });

  test("an element added later is recorded from the frame it is drawn in, with its content as it comes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await recordDrawnBoxes(page, {
      selector: "[data-testid='list']",
      contentSelector: "li",
    });
    await openPage(
      page,
      `<div id="board"></div>
<script>
  setTimeout(() => {
    const list = document.createElement("ul");
    list.setAttribute("data-testid", "list");
    list.style.cssText = "margin:0;padding:0;width:200px;height:90px";
    document.getElementById("board").appendChild(list);
    setTimeout(() => {
      list.innerHTML = "<li>one</li><li>two</li><li>three</li>";
      window.__listFilled = true;
    }, 150);
  }, 150);
</script>`,
    );
    await page.waitForFunction((): boolean => {
      return Boolean(
        (window as unknown as { __listFilled?: boolean }).__listFilled,
      );
    });
    await waitForFrames(page, 10);

    const drawn: DrawnBoxes = await readDrawnBoxes(page);
    const boxes: Array<DrawnBox> = drawn["list"]!;

    expect(boxes[0]!.time).toBeGreaterThanOrEqual(150);
    expect(boxes[0]!.content).toBe(0);
    expect(boxes[boxes.length - 1]!.content).toBe(3);
    // Its content came; its box never moved.
    expect(drawnPlacesOf(boxes)).toEqual(["200x90 at 0,0"]);
  });

  test("reading a page nothing records fails, rather than finding nothing moved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `<div id="box"></div>`);

    const failure: string = await readDrawnBoxes(page).then(
      (): string => {
        return "it read a record";
      },
      (error: Error): string => {
        return error.message;
      },
    );

    expect(failure).toContain("nothing is recording");
  });
});

/*
 * A card as Common's Card draws it: its frame, its padding (24px, the card's
 * own), its header with the title, and its body under the header, holding
 * `body`, with `bodyStyle` on the body when the card gives it one (a body
 * bled to the card's edges). `direction` is the page's reading direction.
 */
interface CardOnPage {
  title: string | null;
  body: string;
  bodyStyle?: string | undefined;
}

function cardPage(
  cards: Array<CardOnPage>,
  direction: "ltr" | "rtl" = "ltr",
): string {
  return `<!doctype html>
<html dir="${direction}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font:14px/20px sans-serif">
${cards
  .map((card: CardOnPage): string => {
    return `<div data-testid="card" style="margin:16px">
  <div style="border:1px solid #e5e7eb;border-radius:12px;background:#fff">
    <div style="padding:24px">
      ${
        card.title === null
          ? ""
          : `<div data-testid="card-header"><div><h2 style="margin:0;font-size:16px">${card.title}</h2><p style="margin:0">What the card is for.</p></div></div>`
      }
      <div style="${card.bodyStyle || "margin-top:16px"}">${card.body}</div>
    </div>
  </div>
</div>`;
  })
  .join("\n")}
</body></html>`;
}

test.describe("cardBodyMisfits", () => {
  test("a card whose body is flush with its padding, under its title, has none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        {
          title: "Data",
          body: `<dl style="margin:0">About</dl><p style="margin:8px 0 0">And 3 more.</p>`,
        },
        {
          title: "Lineage",
          body: `<div data-testid="alert-lineage-diagram"><div style="height:200px;background:#f9fafb">drawing</div></div>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([]);
  });

  test("a body that pads the card again is named, with each side's padding, and how far from the title it starts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        {
          title: "Lineage",
          body: `<div data-testid="alert-lineage-diagram" style="padding:0 24px 24px">drawing</div>`,
        },
        {
          title: "Needs Attention",
          body: `<ul style="margin:0;padding:0 16px 8px;list-style:none">One row</ul>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      'Lineage: <div data-testid="alert-lineage-diagram"> pads the card again (left 24px, right 24px, bottom 24px)',
      "Lineage: what it holds starts 24px from its title",
      "Needs Attention: <ul> pads the card again (left 16px, right 16px, bottom 8px)",
      "Needs Attention: what it holds starts 16px from its title",
    ]);
  });

  test("padding on one side only is named too, and the room under the header is not padding", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        { title: "Right", body: `<div style="padding-right:12px">x</div>` },
        { title: "Bottom", body: `<div style="padding-bottom:6px">x</div>` },
        { title: "Top", body: `<div style="padding-top:16px">x</div>` },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      "Right: <div> pads the card again (left 0px, right 12px, bottom 0px)",
      "Bottom: <div> pads the card again (left 0px, right 0px, bottom 6px)",
    ]);
  });

  test("an element that draws a box of its own pads its own content: its box is what lines up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        {
          title: "Notice",
          body: `<p style="margin:0;padding:12px;background:#fefce8">The warehouse could not be read.</p>`,
        },
        {
          title: "Framed",
          body: `<div style="padding:16px;border:1px solid #e5e7eb">A box</div>`,
        },
        {
          title: "Ringed",
          body: `<div style="padding:16px;box-shadow:0 0 0 1px #e5e7eb">A ring</div>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([]);
  });

  test("a box set in from the title is named, though its padding is its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        {
          title: "Notice",
          body: `<p style="margin:0 0 0 24px;padding:12px;background:#fefce8">Set in</p>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      "Notice: what it holds starts 24px from its title",
    ]);
  });

  test("right to left, what a card holds starts at its title's right edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage(
        [
          { title: "داده", body: `<dl style="margin:0">درباره</dl>` },
          {
            title: "تبار",
            body: `<div style="padding-inline-start:24px">نقشه</div>`,
          },
        ],
        "rtl",
      ),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      "تبار: <div> pads the card again (left 0px, right 24px, bottom 0px)",
      "تبار: what it holds starts 24px from its title",
    ]);
  });

  test("an element that bleeds over the card's padding and pads it back has none; one that pads back more than it bleeds is named", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        {
          title: "Columns",
          body: `<div style="margin:0 -24px -24px;padding:0 24px 24px">A table that scrolls</div>`,
        },
        {
          title: "Tabs",
          body: `<div style="margin:-4px;padding:4px;overflow-x:auto">Tabs with room for a focus ring</div>`,
        },
        {
          title: "Rows",
          body: `<div style="margin:0 -24px;padding:0 24px 24px">Bled at the sides only</div>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      "Rows: <div> pads the card again (left 0px, right 0px, bottom 24px)",
    ]);
  });

  test("a list ruled from edge to edge starts where its rows do, and a rule on one side is no box", async ({
    page,
  }: {
    page: Page;
  }) => {
    const ruled: (row: string) => string = (row: string): string => {
      return `<ul style="list-style:none;margin:0 -24px -24px;padding:0;border-top:1px solid #e5e7eb"><li style="padding:${row}">One</li><li style="padding:${row}">Two</li></ul>`;
    };

    await page.setContent(
      cardPage([
        { title: "Owned", body: ruled("12px 24px") },
        { title: "Unpadded rows", body: ruled("12px 0") },
        {
          title: "Ruled",
          body: `<div style="border-top:1px solid #e5e7eb;padding:16px 16px 0">A rule above, padded</div>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      "Unpadded rows: what it holds starts 24px from its title",
      "Ruled: <div> pads the card again (left 16px, right 16px, bottom 0px)",
      "Ruled: what it holds starts 16px from its title",
    ]);
  });

  test("a table ruled from edge to edge, its header a band of grey, starts where its cells do", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A device table as VMware's host page draws it: bled to the card's edges, its first and last cells padded back.
    const ruledTable: (cell: string) => string = (cell: string): string => {
      return `<div style="margin:0 -24px -24px;border-top:1px solid #e5e7eb"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead style="background:#f9fafb"><tr><th style="padding:${cell};text-align:start">Name</th><th style="padding:${cell}">Read</th></tr></thead><tbody style="background:#fff"><tr><td style="padding:${cell}">vmnic0</td><td style="padding:${cell}">12 MB/s</td></tr></tbody></table></div></div>`;
    };

    await page.setContent(
      cardPage([
        { title: "Network adapters", body: ruledTable("12px 24px") },
        { title: "Cells padded less", body: ruledTable("12px 16px") },
        {
          title: "A band set in",
          body: `<div style="background:#f9fafb;margin:0 -8px;padding:8px 16px">A band bled 8px, its text 8px past the title</div>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      "Cells padded less: what it holds starts 8px from its title",
      "A band set in: what it holds starts 8px from its title",
    ]);
  });

  test("a body the card bleeds to its edges lets what it holds pad that back, and no more", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        {
          title: "Needs attention",
          bodyStyle: "margin:12px -24px -24px",
          body: `<div style="padding:8px 24px">Loading</div><div style="padding:12px 24px 24px">A row</div>`,
        },
        {
          title: "Unpadded",
          bodyStyle: "margin:12px -24px -24px",
          body: `<div>Flush with the card's edge</div>`,
        },
        {
          title: "Too far",
          bodyStyle: "margin:12px -24px -24px",
          body: `<div style="padding:0 40px">Further in than the title</div>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      "Unpadded: what it holds starts 24px from its title",
      "Too far: <div> pads the card again (left 16px, right 16px, bottom 0px)",
      "Too far: what it holds starts 16px from its title",
    ]);
  });

  test("a state set in the middle of the card, padded only above and below, has room of its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        {
          title: "Centred text",
          body: `<p style="margin:0;padding:48px 0;text-align:center">Nothing yet.</p>`,
        },
        {
          title: "Centred column",
          body: `<div style="display:flex;flex-direction:column;align-items:center;padding:80px 0">Loading</div>`,
        },
        {
          title: "Centred row",
          body: `<div style="display:flex;justify-content:center;padding:24px 0">Loading</div>`,
        },
        {
          title: "Not centred",
          body: `<div style="padding:8px 0">No resource labels.</div>`,
        },
        {
          title: "Centred on its line only",
          body: `<div style="display:flex;align-items:center;padding:24px 0">A row</div>`,
        },
        {
          title: "Centred and padded",
          body: `<p style="margin:0;padding:24px 16px;text-align:center">Nothing yet.</p>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      "Not centred: <div> pads the card again (left 0px, right 0px, bottom 8px)",
      "Centred on its line only: <div> pads the card again (left 0px, right 0px, bottom 24px)",
      "Centred and padded: <p> pads the card again (left 16px, right 16px, bottom 24px)",
      "Centred and padded: what it holds starts 16px from its title",
    ]);
  });

  test("a bulleted list's bullets sit in its start padding, in either reading direction", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        {
          title: "Bulleted",
          body: `<ul style="margin:0;padding:0 0 0 20px"><li>One</li></ul>`,
        },
        {
          title: "Bulleted at both sides",
          body: `<ul style="margin:0;padding:0 20px"><li>One</li></ul>`,
        },
        {
          title: "No bullets",
          body: `<ul style="margin:0;padding:0 0 0 20px;list-style:none"><li>One</li></ul>`,
        },
        {
          title: "Bullets inside",
          body: `<ul style="margin:0;padding:0 0 0 20px;list-style-position:inside"><li>One</li></ul>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([
      "Bulleted at both sides: <ul> pads the card again (left 0px, right 20px, bottom 0px)",
      "No bullets: <ul> pads the card again (left 20px, right 0px, bottom 0px)",
      "No bullets: what it holds starts 20px from its title",
      "Bullets inside: <ul> pads the card again (left 20px, right 0px, bottom 0px)",
      "Bullets inside: what it holds starts 20px from its title",
    ]);

    await page.setContent(
      cardPage(
        [
          {
            title: "فهرست",
            body: `<ul style="margin:0;padding-inline-start:20px"><li>یک</li></ul>`,
          },
        ],
        "rtl",
      ),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([]);
  });

  test("a card without a header, an empty body and a hidden element are not read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      cardPage([
        { title: null, body: `<div style="padding:24px">No title</div>` },
        { title: "Empty", body: `` },
        {
          title: "Hidden",
          body: `<div style="display:none;padding:24px">Hidden</div><div>Shown</div>`,
        },
      ]),
    );

    expect(await cardBodyMisfits(page.getByTestId("card"))).toEqual([]);
  });
});

/*
 * watchDashboardLocales tells which of the Dashboard's locales a fixture's
 * page loaded (#8366), from the line esbuild heads each module of an
 * unminified bundle with ("// ../../App/FeatureSet/Dashboard/src/Locales/
 * de.json"), in the entry and in every chunk. The pages are served here, at
 * an address of their own: an entry, and the chunks the page asks for
 * before it draws, as a fixture loads its language before it starts.
 */
test.describe("watchDashboardLocales", () => {
  const HOST: string = "http://locale-chunks.test";
  const localeModule: (language: string) => string = (
    language: string,
  ): string => {
    return `// ../../App/FeatureSet/Dashboard/src/Locales/${language}.json\nvar ${language.replace("-", "_")}_default = { Save: "${language}" };\n`;
  };
  // A docs page's translations: a "de-<hash>.js" chunk too, and no locale.
  const DOCS_CHUNK: string =
    "// ../App/FeatureSet/Dashboard/src/Pages/Docker/DocumentationTranslations/de.ts\nexport default {};\n";

  /*
   * A page whose entry holds `entry`, and which loads `chunks` (by name)
   * before it shows #ready, in the language ?lang= names.
   */
  const openPage: (
    page: Page,
    options: { entry: string; chunks: Record<string, string> },
    query?: string,
  ) => Promise<void> = async (
    page: Page,
    options: { entry: string; chunks: Record<string, string> },
    query: string = "",
  ): Promise<void> => {
    await page.route(`${HOST}/**`, async (route: Route) => {
      const url: URL = new URL(route.request().url());

      if (url.pathname === "/dist/Fixture.js") {
        await route.fulfill({
          contentType: "text/javascript",
          body: `${options.entry}\nexport const loaded = true;\n`,
        });
        return;
      }

      if (url.pathname.startsWith("/dist/")) {
        const script: string | undefined =
          options.chunks[url.pathname.slice("/dist/".length)];
        await route.fulfill(
          script === undefined
            ? { status: 404, body: "" }
            : { contentType: "text/javascript", body: script },
        );
        return;
      }

      const language: string = url.searchParams.get("lang") || "en";
      const imports: string = Object.keys(options.chunks)
        .map((name: string): string => {
          return `await import("/dist/${name}");`;
        })
        .join("");
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="${language}"><head><meta charset="utf-8"></head><body><script type="module">await import("/dist/Fixture.js");${imports}document.body.insertAdjacentHTML("beforeend", '<p id="ready">${language}</p>');</script></body></html>`,
      });
    });
    await page.goto(`${HOST}/page${query ? `?${query}` : ""}`);
    await expect(page.locator("#ready")).toBeVisible();
  };

  test("reads the Dashboard's locale modules a script holds, at the head of a line, and nothing else", () => {
    expect(
      dashboardLocalesIn(
        [
          localeModule("en"),
          "// ../../Common/UI/Utils/Translation.ts",
          localeModule("de"),
          DOCS_CHUNK,
          'const note = "// ../App/FeatureSet/Dashboard/src/Locales/fa.json";',
          "// ../App/FeatureSet/StatusPage/src/Locales/ja.json",
          localeModule("zh-CN"),
        ].join("\n"),
      ),
    ).toEqual(["en", "de", "zh-CN"]);
    expect(dashboardLocalesIn("")).toEqual([]);
  });

  test("an English page whose entry holds English alone loaded no other language", async ({
    page,
  }: {
    page: Page;
  }) => {
    const watch: LocaleWatch = watchDashboardLocales(page);

    await openPage(page, { entry: localeModule("en"), chunks: {} });

    expect(await watch.languages()).toEqual([]);
    expect(await watch.scriptBytes()).toBeGreaterThan(0);
  });

  test("a German page loaded German's chunk, and a docs chunk named de- is no locale", async ({
    page,
  }: {
    page: Page;
  }) => {
    const watch: LocaleWatch = watchDashboardLocales(page);

    await openPage(
      page,
      {
        entry: localeModule("en"),
        chunks: {
          "de-ABC123.js": localeModule("de"),
          "de-DOCS99.js": DOCS_CHUNK,
        },
      },
      "lang=de",
    );

    expect(await watch.languages()).toEqual(["de"]);

    // The fixture's own weight leaves German's chunk out, and only it.
    const all: number = await watch.scriptBytes();
    expect(await watch.scriptBytesBesideLocale("de")).toBe(
      all - localeModule("de").length,
    );
    expect(await watch.scriptBytesBesideLocale("fa")).toBe(all);
  });

  test("reads a script wherever its fixture serves it: the Dashboard widget fixtures' /app/", async ({
    page,
  }: {
    page: Page;
  }) => {
    const watch: LocaleWatch = watchDashboardLocales(page);

    await page.route(`${HOST}/**`, async (route: Route) => {
      const url: URL = new URL(route.request().url());

      if (url.pathname.startsWith("/app/")) {
        await route.fulfill({
          contentType: "text/javascript",
          body:
            url.pathname === "/app/AppFixture.js"
              ? `${localeModule("en")}\nexport const loaded = true;\n`
              : localeModule("fa"),
        });
        return;
      }

      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="fa"><head><meta charset="utf-8"></head><body><script type="module">await import("/app/AppFixture.js");await import("/app/fa-XYZ789.js");document.body.insertAdjacentHTML("beforeend", '<p id="ready">fa</p>');</script></body></html>`,
      });
    });
    await page.goto(`${HOST}/page?lang=fa`);
    await expect(page.locator("#ready")).toBeVisible();

    expect(await watch.languages()).toEqual(["fa"]);
  });

  test("an entry that holds German and Persian whole reads as both, on an English page", async ({
    page,
  }: {
    page: Page;
  }) => {
    const watch: LocaleWatch = watchDashboardLocales(page);

    await openPage(page, {
      entry: [localeModule("en"), localeModule("de"), localeModule("fa")].join(
        "\n",
      ),
      chunks: {},
    });

    expect(await watch.languages()).toEqual(["de", "fa"]);
  });

  test("expectPageLoadsOnlyItsLanguage passes a page that loads its own language, and fails one that loads another", async ({
    page,
  }: {
    page: Page;
  }) => {
    const check: {
      address: (language: string) => string;
      ready: (shown: Page) => Locator;
    } = {
      address: (language: string): string => {
        return language === "en"
          ? `${HOST}/page`
          : `${HOST}/page?lang=${language}`;
      },
      ready: (shown: Page): Locator => {
        return shown.locator("#ready");
      },
    };

    await page.route(`${HOST}/**`, async (route: Route) => {
      const url: URL = new URL(route.request().url());
      const language: string = url.searchParams.get("lang") || "en";

      if (url.pathname.startsWith("/dist/")) {
        await route.fulfill({
          contentType: "text/javascript",
          body: localeModule(
            url.pathname.slice("/dist/".length, -".js".length),
          ),
        });
        return;
      }

      // A Persian page that loads German as well: the wrong chunk.
      const chunks: Array<string> =
        language === "en" ? [] : language === "fa" ? ["fa", "de"] : [language];
      const imports: string = chunks
        .map((code: string): string => {
          return `await import("/dist/${code}.js");`;
        })
        .join("");
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="${language}"><head><meta charset="utf-8"></head><body><script type="module">${imports}document.body.insertAdjacentHTML("beforeend", '<p id="ready">ready</p>');</script></body></html>`,
      });
    });

    await expectPageLoadsOnlyItsLanguage(page, check, "en");
    await expectPageLoadsOnlyItsLanguage(page, check, "de");
    await expect(
      expectPageLoadsOnlyItsLanguage(page, check, "fa"),
    ).rejects.toThrow(/the Dashboard locales a page in "fa" loaded/);
  });

  test("dashboardWord reads the Dashboard's words for a language, and English as it is", () => {
    expect(dashboardWord("de", "More monitor types")).toBe(
      "Weitere Monitortypen",
    );
    expect(dashboardWord("en", "More monitor types")).toBe(
      "More monitor types",
    );
    expect(dashboardWord("de", "A sentence no locale holds, 8366")).toBe(
      "A sentence no locale holds, 8366",
    );
  });
});

/*
 * #8689: a spec compared the product's "182 ms" - a number held to its unit
 * by a no-break space (#8302) - with "182 ms" typed with a plain space, and
 * failed on a code point nobody reading it could see. withUnit writes the
 * quantity as the product draws it, and withSpacesShown makes a failure
 * say which space it read.
 */
test.describe("withUnit and withSpacesShown", () => {
  interface WordPlace {
    word: string;
    top: number;
    left: number;
  }

  // Where each word of #line is drawn: the top and left of its first piece.
  async function wordPlaces(page: Page): Promise<Array<WordPlace>> {
    return page.locator("#line").evaluate((line: Element): Array<WordPlace> => {
      const text: Node = line.firstChild as Node;
      const content: string = text.textContent || "";
      const places: Array<WordPlace> = [];
      const words: RegExp = /[^\s\u00A0]+/g;
      let match: RegExpExecArray | null = words.exec(content);

      while (match) {
        const range: Range = document.createRange();
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
        const box: DOMRect = range.getClientRects()[0] as DOMRect;
        places.push({
          word: match[0],
          top: Math.round(box.top),
          left: Math.round(box.left),
        });
        match = words.exec(content);
      }

      return places;
    });
  }

  // A line too narrow for "Up · 182 ms" whole, so it breaks somewhere.
  function narrowLine(text: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><p id="line" style="margin:0;width:9ch;font:16px/20px monospace">${text}</p></body></html>`;
  }

  function placeOf(places: Array<WordPlace>, word: string): WordPlace {
    const place: WordPlace | undefined = places.find(
      (candidate: WordPlace): boolean => {
        return candidate.word === word;
      },
    );

    expect(place, `"${word}" is drawn`).toBeDefined();

    return place!;
  }

  test("writes a figure and its unit joined by U+00A0, the figure as given", () => {
    expect(NO_BREAK_SPACE).toBe(String.fromCharCode(0xa0));
    expect(withUnit(182, "ms")).toBe(`182${String.fromCharCode(0xa0)}ms`);
    expect(withUnit(0.5, "s")).toBe("0.5\u00A0s");
    expect(withUnit(0, "%")).toBe("0\u00A0%");
    expect(withUnit(-3, "°C")).toBe("-3\u00A0°C");
    // A string is kept as the page writes it: its separators and its digits.
    expect(withUnit("2,410", "ms")).toBe("2,410\u00A0ms");
    expect(withUnit("1.5", "MB/s")).toBe("1.5\u00A0MB/s");
    expect(withUnit("۱۸۲", "میلی\u200Cثانیه")).toBe("۱۸۲\u00A0میلی\u200Cثانیه");
    // French's thousands keep their own narrow no-break space.
    expect(withUnit("1\u202F234", "ms")).toBe("1\u202F234\u00A0ms");
    expect(withUnit("2,410", "ms")).not.toBe("2,410 ms");
  });

  test("throws for a figure or a unit a spec got wrong, rather than write a quantity no page draws", () => {
    expect(() => {
      return withUnit("182 ms", "ms");
    }).toThrow('withUnit: the figure "182 ms" holds a space');
    expect(() => {
      return withUnit(182, " ms");
    }).toThrow('withUnit: the unit " ms" holds a space');
    expect(() => {
      return withUnit("182\u00A0", "ms");
    }).toThrow(/the figure .* holds a space/);
    expect(() => {
      return withUnit("", "ms");
    }).toThrow("withUnit: the figure is empty.");
    expect(() => {
      return withUnit(182, "");
    }).toThrow("withUnit: the unit is empty.");
    expect(() => {
      return withUnit(Number.NaN, "ms");
    }).toThrow("withUnit: NaN is no figure");
    expect(() => {
      return withUnit(Number.POSITIVE_INFINITY, "ms");
    }).toThrow("withUnit: Infinity is no figure");
  });

  test("withSpacesShown draws each no-break space as ⍽, and leaves every other space", () => {
    expect(NO_BREAK_SPACE_SHOWN_AS).toBe("⍽");
    expect(withSpacesShown(`Up · ${withUnit(182, "ms")} · HTTP 200`)).toBe(
      "Up · 182⍽ms · HTTP 200",
    );
    expect(withSpacesShown("Up · 182 ms")).toBe("Up · 182 ms");
    expect(withSpacesShown("a\u00A0b\u00A0c d\u202Fe")).toBe("a⍽b⍽c d\u202Fe");
    expect(withSpacesShown("")).toBe("");
    // So the two spaces no longer read alike in a failure.
    expect(withSpacesShown("182\u00A0ms")).not.toBe(withSpacesShown("182 ms"));
    expect(() => {
      return withSpacesShown("182⍽ms");
    }).toThrow('already holds "⍽"');
  });

  test("a quantity withUnit writes stays on its line, where a plain space lets the unit break off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(narrowLine("Up · 182 ms"));
    const broken: Array<WordPlace> = await wordPlaces(page);
    expect(
      placeOf(broken, "ms").top,
      'a plain space lets "ms" start the next line',
    ).toBeGreaterThan(placeOf(broken, "182").top);

    await page.setContent(narrowLine(`Up · ${withUnit(182, "ms")}`));
    const kept: Array<WordPlace> = await wordPlaces(page);
    expect(
      kept.map((place: WordPlace): string => {
        return place.word;
      }),
    ).toEqual(["Up", "·", "182", "ms"]);
    expect(placeOf(kept, "ms").top, "the unit on the figure's line").toBe(
      placeOf(kept, "182").top,
    );
    expect(placeOf(kept, "ms").left).toBeGreaterThan(placeOf(kept, "182").left);
    // The line still breaks: before the quantity, never inside it.
    expect(placeOf(kept, "182").top).toBeGreaterThan(placeOf(kept, "Up").top);
  });

  test("toHaveText folds a no-break space into a plain one, and a string read keeps it: compare the string to hold the space", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"></head><body><p id="line">Up · ${withUnit(182, "ms")}</p></body></html>`,
    );
    const line: Locator = page.locator("#line");

    // Either space passes toHaveText and toContainText: they cannot tell.
    await expect(line).toHaveText("Up · 182 ms");
    await expect(line).toHaveText(`Up · ${withUnit(182, "ms")}`);
    await expect(line).toContainText("182 ms");

    // The text as read keeps the page's space, so a string compare holds it.
    const read: string = (await line.textContent()) || "";
    expect(read).toBe(`Up · ${withUnit(182, "ms")}`);
    expect(read).not.toBe("Up · 182 ms");
    expect(await line.innerText()).toBe(`Up · ${withUnit(182, "ms")}`);
    expect(withSpacesShown(read)).toBe("Up · 182⍽ms");
  });
});

/*
 * #8735, #8749: a figure with no reading is EmptyFigure - the quiet dash on
 * screen, "Not set" for a screen reader - and its textContent, "—Not set",
 * is neither. drawnTextOf and heardTextOf read the two apart.
 */
test.describe("drawnTextOf, heardTextOf and expectQuietDash", () => {
  // A tile's figure as EmptyFigure draws it, or as a figure with a reading.
  function tiles(): string {
    return `<!doctype html><html><head><meta charset="utf-8"><style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style></head><body>
  <p id="empty"><span data-testid="${EMPTY_FIGURE_TEST_ID}"><span aria-hidden="true">—</span><span class="sr-only">Not set</span></span></p>
  <p id="worded"><span data-testid="${EMPTY_FIGURE_TEST_ID}"><span aria-hidden="true">—</span><span class="sr-only">No reading yet</span></span></p>
  <p id="figure">100%</p>
  <p id="bare">—</p>
  <p id="later"></p>
  <script>
    setTimeout(() => {
      document.getElementById("later").innerHTML =
        '<span data-testid="${EMPTY_FIGURE_TEST_ID}"><span aria-hidden="true">—</span><span class="sr-only">Not set</span></span>';
    }, 400);
  </script>
</body></html>`;
  }

  async function failureOfQuietDash(
    locator: Locator,
    heard?: string,
  ): Promise<string> {
    try {
      await expectQuietDash(locator, heard);
    } catch (error) {
      return String((error as Error).message);
    }
    return "it passed";
  }

  test("read the dash drawn and the words heard apart, where textContent runs them together", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(tiles());
    const empty: Locator = page.locator("#empty");

    expect(QUIET_DASH).toBe("—");
    expect(NOT_SET).toBe("Not set");
    expect(await empty.textContent()).toBe("—Not set");
    expect(await drawnTextOf(empty)).toBe("—");
    expect(await heardTextOf(empty)).toBe("Not set");
    // A figure with a reading is drawn and heard alike.
    expect(await drawnTextOf(page.locator("#figure"))).toBe("100%");
    expect(await heardTextOf(page.locator("#figure"))).toBe("100%");
    // Reading leaves the page as it was.
    expect(await empty.textContent()).toBe("—Not set");
  });

  test("expectQuietDash passes EmptyFigure, with its own words when it has some, and waits for it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(tiles());

    await expectQuietDash(page.locator("#empty"));
    await expectQuietDash(page.locator("#worded"), "No reading yet");
    await expectQuietDash(page.locator("#later"));
  });

  test("expectQuietDash fails a figure, a bare dash with nothing to hear, and words other than those expected", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(60000);
    await page.setContent(tiles());

    expect(await failureOfQuietDash(page.locator("#figure"))).toContain(
      "draws the quiet dash",
    );
    // Drawn as a dash, but nothing is said: not EmptyFigure.
    expect(await failureOfQuietDash(page.locator("#bare"))).toContain(
      EMPTY_FIGURE_TEST_ID,
    );
    expect(await failureOfQuietDash(page.locator("#worded"))).toContain(
      "is heard as",
    );
  });
});

/*
 * axeViolations runs axe's rules on the part of a page it is given (#10297).
 * Each rule the shared UI is held to is planted once, beside a part that
 * breaks none, so a helper that ran no rule, ran them on the wrong part or
 * lost what they found would pass every suite that leans on it.
 */
function brokenByEveryRule(): string {
  return `<!doctype html>
<html lang="en"><head><title>axe</title></head><body>
<main>
  <section id="broken">
    <ul role="menu"><li>No menu item in this menu</li></ul>
    <nav aria-label="Pages"><a href="#one">One</a></nav>
    <nav aria-label="Pages"><a href="#two">Two</a></nav>
    <button type="button">Open <a href="#inside">a link inside a button</a></button>
    <div role="made-up">A role ARIA does not have</div>
    <button type="button" role="heading" aria-level="2">A button as a heading</button>
    <button type="button"></button>
    <a href="#nameless"></a>
  </section>
  <section id="sound">
    <ul role="menu" aria-label="Actions"><li role="menuitem" tabindex="-1">Rename</li></ul>
    <nav aria-label="Trail"><a href="#home">Home</a></nav>
    <button type="button">Save</button>
    <a href="#docs">Documentation</a>
  </section>
</main>
</body></html>`;
}

test.describe("axeViolations", () => {
  test("finds each rule the shared UI is held to, broken where it was planted", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(brokenByEveryRule());

    const violations: Array<AxeViolation> = await axeViolations(page, {
      include: ["#broken"],
    });
    const rules: Array<string> = violations
      .map((violation: AxeViolation): string => {
        return violation.rule;
      })
      .sort();

    expect(rules).toEqual([...SHARED_UI_AXE_RULES].sort());
    // Each says where, as a selector that finds the planted element.
    for (const violation of violations) {
      expect(violation.help).not.toBe("");
      expect(violation.targets.length).toBeGreaterThan(0);
      for (const target of violation.targets) {
        expect(
          await page.evaluate((selector: string): boolean => {
            return Boolean(
              document.querySelector(selector)?.closest("#broken"),
            );
          }, target),
          `${violation.rule} at ${target}`,
        ).toBe(true);
      }
    }
  });

  test("reads only the part it is given: the sound part breaks no rule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(brokenByEveryRule());

    expect(await axeViolations(page, { include: ["#sound"] })).toEqual([]);
    await expectNoAxeViolations(page, { include: ["#sound"] });
    // Left out of a part it is given, a broken one is not read either.
    expect(
      await axeViolations(page, { include: ["main"], exclude: ["#broken"] }),
    ).toEqual([]);
  });

  test("runs only the rules it is asked for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(brokenByEveryRule());

    const violations: Array<AxeViolation> = await axeViolations(page, {
      include: ["#broken"],
      rules: ["button-name"],
    });

    expect(
      violations.map((violation: AxeViolation): string => {
        return violation.rule;
      }),
    ).toEqual(["button-name"]);
  });

  test("expectNoAxeViolations fails naming the rule and the element", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setContent(brokenByEveryRule());

    const failure: string = await failureOf(
      expectNoAxeViolations(page, {
        include: ["#broken"],
        rules: ["link-name"],
        message: "the planted page",
      }),
    );

    expect(failure).toContain("the planted page");
    expect(failure).toContain("link-name");
    expect(failure).toContain("#nameless");
  });
});
