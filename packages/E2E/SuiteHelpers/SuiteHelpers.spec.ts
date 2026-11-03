import { expect, Locator, Page, test } from "@playwright/test";
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
