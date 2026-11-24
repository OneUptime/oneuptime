import zlib from "zlib";
import {
  Browser,
  BrowserContext,
  BrowserType,
  Page,
  Route,
  chromium,
  firefox,
} from "playwright";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import PlaywrightCapabilityBroker from "../../../../Utils/Monitors/SyntheticRuntime/PlaywrightCapabilityBroker";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";

/*
 * A SCRIPT THAT RUNS OUT OF TIME SHOWS WHERE IT STOPPED.
 *
 * A synthetic script that hits the probe's time limit is stopped where it
 * stands. Its run used to report "Synthetic monitor script timed out after
 * 180000 ms." and nothing else: no screenshot of the page it was on, and
 * none of the screenshots it took if it kept them in an object of its own
 * to return. A sign-in check can time out on every run for days with
 * nothing to show what the sign-in page asks for: a script that waits
 * longer for its dashboard than the probe allows never reaches its own
 * catch block, with its failure screenshot.
 *
 * Now the probe photographs every page the script still has open when the
 * time runs out, in a real browser here: each page these tests open is one
 * solid colour, and each screenshot's top-left pixel says which page it
 * shows.
 */

jest.setTimeout(120_000);

const TARGET_URL: string = "https://synthetic-target.invalid/";

type Colour = [number, number, number];

const RED: Colour = [220, 20, 60];
const GREEN: Colour = [34, 139, 34];
const BLUE: Colour = [30, 144, 255];

const PNG_SIGNATURE: Buffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/*
 * Long enough for a script's setup - three navigations and two new pages at
 * most - to finish on a busy runner before the deadline cuts it off: a
 * script cut off early leaves fewer pages open than the test expects.
 */
const TIMEOUT_IN_MS: number = 5_000;

// A page that is one colour all over: /colour/220-20-60.
const COLOUR_PAGE_PATH: RegExp = /\/colour\/(\d+)-(\d+)-(\d+)$/;

function pageOf(colour: Colour): string {
  return `${TARGET_URL}colour/${colour.join("-")}`;
}

interface PngFacts {
  width: number;
  height: number;
  topLeft: Colour;
}

/*
 * The size and the top-left pixel of an 8-bit RGB or RGBA PNG - what a
 * browser's screenshot is. Every PNG filter leaves the first pixel of the
 * first row as it was stored, as it has no neighbour to the left or above,
 * so the pixel is read without undoing the filters.
 */
function readPng(image: Buffer): PngFacts {
  expect(image.subarray(0, 8)).toEqual(PNG_SIGNATURE);

  let offset: number = 8;
  let width: number = 0;
  let height: number = 0;
  let bitDepth: number = 0;
  let colourType: number = 0;
  const data: Array<Buffer> = [];

  while (offset + 8 <= image.length) {
    const length: number = image.readUInt32BE(offset);
    const type: string = image.toString("latin1", offset + 4, offset + 8);
    const body: Buffer = image.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body.readUInt8(8);
      colourType = body.readUInt8(9);
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  if (bitDepth !== 8 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(
      `Expected an 8-bit RGB or RGBA screenshot, got bit depth ${bitDepth} and colour type ${colourType}.`,
    );
  }

  // Each row starts with its filter's byte.
  const rows: Buffer = zlib.inflateSync(Buffer.concat(data));

  return {
    width,
    height,
    topLeft: [rows.readUInt8(1), rows.readUInt8(2), rows.readUInt8(3)],
  };
}

function colourOf(image: Buffer | undefined): Colour {
  if (!image) {
    throw new Error("Expected a screenshot.");
  }

  return readPng(image).topLeft;
}

function expectColour(actual: Colour, expected: Colour): void {
  // A browser may round a colour by a step or two on its way to the PNG.
  for (let channel: number = 0; channel < 3; channel++) {
    expect(
      Math.abs((actual[channel] ?? -1) - (expected[channel] ?? -1)),
    ).toBeLessThanOrEqual(3);
  }
}

describe.each([
  { name: "Chromium", launcher: chromium },
  { name: "Firefox", launcher: firefox },
])(
  "a synthetic script that runs out of time in $name",
  (data: { name: string; launcher: BrowserType }) => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await data.launcher.launch({ headless: true });
    });

    afterAll(async () => {
      await browser?.close();
    });

    async function run(options: {
      code: string;
      timeoutInMs?: number | undefined;
    }): Promise<SandboxExecutionResult> {
      const browserContext: BrowserContext = await browser.newContext({
        viewport: { width: 800, height: 600 },
      });
      await browserContext.route(`${TARGET_URL}**`, async (route: Route) => {
        const match: RegExpExecArray | null = COLOUR_PAGE_PATH.exec(
          new URL(route.request().url()).pathname,
        );
        const background: string = match
          ? `rgb(${match[1]}, ${match[2]}, ${match[3]})`
          : "white";

        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!doctype html><title>Synthetic target</title><style>html, body { margin: 0; height: 100%; background: ${background}; }</style><main></main>`,
        });
      });
      const page: Page = await browserContext.newPage();

      try {
        return await WorkerController.execute({
          browserContext,
          page,
          code: options.code,
          browserType: data.name,
          screenSizeType: "Desktop",
          args: {},
          timeoutInMs: options.timeoutInMs ?? TIMEOUT_IN_MS,
        });
      } finally {
        await browserContext.close();
      }
    }

    test("photographs the page the script stopped on, and says it timed out as it always did", async () => {
      const result: SandboxExecutionResult = await run({
        code: `
          await page.goto(${JSON.stringify(pageOf(RED))});
          console.log("signed out");
          await page.goto(${JSON.stringify(pageOf(GREEN))});
          await page.waitForSelector("#dashboard", { timeout: 600000 });
        `,
      });

      expect(result.scriptError).toBe(
        `Synthetic monitor script timed out after ${TIMEOUT_IN_MS} ms.`,
      );
      expect(result.logMessages).toEqual(["signed out"]);
      expect(Object.keys(result.screenshots)).toEqual(["timed-out-page"]);

      const facts: PngFacts = readPng(
        result.screenshots["timed-out-page"] as Buffer,
      );
      // The viewport, as the script's own screenshots are, never the full page.
      expect({ width: facts.width, height: facts.height }).toEqual({
        width: 800,
        height: 600,
      });
      expectColour(facts.topLeft, GREEN);
    });

    test("shows where a legacy script stopped, though the screenshots it kept to return are lost", async () => {
      /*
       * A legacy sign-in check: its own screenshots object, a screenshot
       * after signing in, then a wait for the dashboard far longer than
       * the probe allows, so its catch block never runs.
       */
      const result: SandboxExecutionResult = await run({
        code: `
          const screenshots = {};
          try {
            await page.goto(${JSON.stringify(pageOf(RED))});
            await page.goto(${JSON.stringify(pageOf(BLUE))});
            screenshots["after sign-in"] = await page.screenshot();
            await page.locator("#breadcrumbs").getByText("Dashboard").waitFor({ timeout: 2000000 });
            return { screenshots };
          } catch (error) {
            screenshots["failure"] = await page.screenshot();
            console.log(error.message);
            return { screenshots, data: "The dashboard did not load." };
          }
        `,
      });

      expect(result.scriptError).toBe(
        `Synthetic monitor script timed out after ${TIMEOUT_IN_MS} ms.`,
      );
      expect(result.returnValue).toBeUndefined();
      expect(Object.keys(result.screenshots)).toEqual(["timed-out-page"]);
      expectColour(colourOf(result.screenshots["timed-out-page"]), BLUE);
    });

    test("keeps the script's own screenshots first and adds the page after them", async () => {
      const result: SandboxExecutionResult = await run({
        code: `
          await page.goto(${JSON.stringify(pageOf(RED))});
          screenshots["sign-in"] = await page.screenshot();
          await page.goto(${JSON.stringify(pageOf(GREEN))});
          await new Promise(() => {});
        `,
      });

      expect(Object.keys(result.screenshots)).toEqual([
        "sign-in",
        "timed-out-page",
      ]);
      expectColour(colourOf(result.screenshots["sign-in"]), RED);
      expectColour(colourOf(result.screenshots["timed-out-page"]), GREEN);
    });

    test("photographs every page the script left open, numbered in the order they were opened", async () => {
      const result: SandboxExecutionResult = await run({
        code: `
          await page.goto(${JSON.stringify(pageOf(RED))});
          const second = await page.context().newPage();
          await second.goto(${JSON.stringify(pageOf(GREEN))});
          const third = await page.context().newPage();
          await third.goto(${JSON.stringify(pageOf(BLUE))});
          await new Promise(() => {});
        `,
      });

      expect(Object.keys(result.screenshots)).toEqual([
        "timed-out-page",
        "timed-out-page-2",
        "timed-out-page-3",
      ]);
      expectColour(colourOf(result.screenshots["timed-out-page"]), RED);
      expectColour(colourOf(result.screenshots["timed-out-page-2"]), GREEN);
      expectColour(colourOf(result.screenshots["timed-out-page-3"]), BLUE);
    });

    test("leaves out a page the script closed", async () => {
      const result: SandboxExecutionResult = await run({
        code: `
          await page.goto(${JSON.stringify(pageOf(RED))});
          const popup = await page.context().newPage();
          await popup.goto(${JSON.stringify(pageOf(GREEN))});
          await page.close();
          await popup.waitForSelector("#approved", { timeout: 600000 });
        `,
      });

      expect(Object.keys(result.screenshots)).toEqual(["timed-out-page"]);
      expectColour(colourOf(result.screenshots["timed-out-page"]), GREEN);
    });

    test("keeps the script's screenshot under a name it already used, and the page's beside it", async () => {
      const result: SandboxExecutionResult = await run({
        code: `
          await page.goto(${JSON.stringify(pageOf(RED))});
          screenshots["timed-out-page"] = await page.screenshot();
          await page.goto(${JSON.stringify(pageOf(GREEN))});
          await new Promise(() => {});
        `,
      });

      expect(Object.keys(result.screenshots)).toEqual([
        "timed-out-page",
        "timed-out-page (2)",
      ]);
      expectColour(colourOf(result.screenshots["timed-out-page"]), RED);
      expectColour(colourOf(result.screenshots["timed-out-page (2)"]), GREEN);
    });

    test("photographs nothing when the script finishes or throws in time", async () => {
      const finished: SandboxExecutionResult = await run({
        code: `
          await page.goto(${JSON.stringify(pageOf(GREEN))});
          return { data: "signed in" };
        `,
      });
      expect(finished.scriptError).toBeUndefined();
      expect(finished.screenshots).toEqual({});

      const threw: SandboxExecutionResult = await run({
        code: `
          await page.goto(${JSON.stringify(pageOf(RED))});
          screenshots["failure"] = await page.screenshot();
          throw new Error("The dashboard did not load.");
        `,
      });
      expect(threw.scriptError).toBe("The dashboard did not load.");
      expect(Object.keys(threw.screenshots)).toEqual(["failure"]);
    });
  },
);

describe("the screenshot limits when a script runs out of time", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function run(code: string): Promise<SandboxExecutionResult> {
    const browserContext: BrowserContext = await browser.newContext({
      viewport: { width: 320, height: 240 },
    });
    await browserContext.route(`${TARGET_URL}**`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><title>Synthetic target</title><main>ready</main>",
      });
    });
    const page: Page = await browserContext.newPage();

    try {
      return await WorkerController.execute({
        browserContext,
        page,
        code,
        browserType: "Chromium",
        screenSizeType: "Desktop",
        args: {},
        // Room for twenty screenshots on a busy runner before the deadline.
        timeoutInMs: 10_000,
      });
    } finally {
      await browserContext.close();
    }
  }

  test("the script's own screenshots come first: with the limit reached, the page is left out", async () => {
    const result: SandboxExecutionResult = await run(`
      await page.goto(${JSON.stringify(TARGET_URL)});
      for (let index = 1; index <= 20; index++) {
        screenshots["step " + index] = await page.screenshot();
      }
      await new Promise(() => {});
    `);

    expect(result.scriptError).toContain("timed out");
    expect(Object.keys(result.screenshots)).toHaveLength(20);
    expect(Object.keys(result.screenshots)).not.toContain("timed-out-page");
  });

  test("screenshots a legacy script kept to return, never reported once it timed out, do not hold the limit against the page", async () => {
    const result: SandboxExecutionResult = await run(`
      const screenshots = {};
      await page.goto(${JSON.stringify(TARGET_URL)});
      for (let index = 1; index <= 20; index++) {
        screenshots["step " + index] = await page.screenshot();
      }
      await new Promise(() => {});
      return { screenshots };
    `);

    expect(result.scriptError).toContain("timed out");
    expect(Object.keys(result.screenshots)).toEqual(["timed-out-page"]);
  });
});

describe("a timed-out run whose pages cannot be photographed", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("still reports its timeout and keeps the script's own screenshots", async () => {
    jest
      .spyOn(PlaywrightCapabilityBroker.prototype, "captureTimedOutPages")
      .mockRejectedValue(new Error("The browser went away."));

    const browserContext: BrowserContext = await browser.newContext({
      viewport: { width: 320, height: 240 },
    });
    await browserContext.route(`${TARGET_URL}**`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><title>Synthetic target</title><main>ready</main>",
      });
    });
    const page: Page = await browserContext.newPage();

    try {
      const result: SandboxExecutionResult = await WorkerController.execute({
        browserContext,
        page,
        code: `
          await page.goto(${JSON.stringify(TARGET_URL)});
          console.log("before the wait");
          screenshots["before the wait"] = await page.screenshot();
          await new Promise(() => {});
        `,
        browserType: "Chromium",
        screenSizeType: "Desktop",
        args: {},
        timeoutInMs: TIMEOUT_IN_MS,
      });

      expect(result.scriptError).toBe(
        `Synthetic monitor script timed out after ${TIMEOUT_IN_MS} ms.`,
      );
      expect(result.logMessages).toEqual(["before the wait"]);
      expect(Object.keys(result.screenshots)).toEqual(["before the wait"]);
    } finally {
      await browserContext.close();
    }
  });
});

describe("the bound on a timed-out run's screenshots", () => {
  test.each([0, -1, 1.5, Number.NaN, 120_001])(
    "refuses %p ms",
    async (timedOutPageScreenshotTimeoutInMs: number) => {
      await expect(
        WorkerController.execute({
          browserContext: {} as BrowserContext,
          page: {} as Page,
          code: "return {};",
          browserType: "Chromium",
          screenSizeType: "Desktop",
          timeoutInMs: 1_000,
          timedOutPageScreenshotTimeoutInMs,
        }),
      ).rejects.toThrow(
        "Synthetic runtime timed-out page screenshot timeout is invalid.",
      );
    },
  );
});
