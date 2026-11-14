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
import { boxesInOneFrame, FrameBox } from "./Frames";
import { expectNoSidewaysScroll, sidewaysScrollOf } from "./PageFit";

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
