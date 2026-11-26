import { BrowserContext, Page } from "playwright";
import PlaywrightCapabilityBroker from "../../../../Utils/Monitors/SyntheticRuntime/PlaywrightCapabilityBroker";
import { MAX_SCREENSHOT_BYTES } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";
import SyntheticEgressProxy from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticEgressProxy";

/*
 * When a synthetic script runs out of time, the broker photographs every
 * page the script still has open (captureTimedOutPages). These tests hold
 * its bounds with pages whose screenshots are scripted: one that never
 * finishes, one that fails, one that finishes too late - what a real
 * browser does only now and then, and never on cue. The real browser's
 * side is in WorkerControllerTimedOutPages.
 */

interface FakePage {
  page: Page;
  screenshot: jest.Mock<Promise<Buffer>, [Record<string, unknown>?]>;
}

function fakePage(data: {
  screenshot: () => Promise<Buffer>;
  isClosed?: boolean | undefined;
}): FakePage {
  const screenshot: jest.Mock<
    Promise<Buffer>,
    [Record<string, unknown>?]
  > = jest.fn((): Promise<Buffer> => {
    return data.screenshot();
  });

  const page: Page = {
    keyboard: {},
    mouse: {},
    touchscreen: {},
    isClosed: (): boolean => {
      return data.isClosed ?? false;
    },
    url: (): string => {
      return "https://synthetic-target.invalid/";
    },
    viewportSize: (): { width: number; height: number } => {
      return { width: 800, height: 600 };
    },
    screenshot,
  } as unknown as Page;

  return { page, screenshot };
}

function drawn(text: string, afterInMs: number = 0): () => Promise<Buffer> {
  return (): Promise<Buffer> => {
    return new Promise<Buffer>((resolve: (value: Buffer) => void): void => {
      setTimeout((): void => {
        resolve(Buffer.from(text));
      }, afterInMs);
    });
  };
}

function neverDrawn(): Promise<Buffer> {
  return new Promise<Buffer>((): void => {
    // A browser that never answers.
  });
}

function createBroker(data: {
  contextPages: Array<Page>;
  controllerPage?: Page | undefined;
  internalPages?: Set<Page> | undefined;
}): PlaywrightCapabilityBroker {
  const controllerPage: Page =
    data.controllerPage ?? fakePage({ screenshot: neverDrawn }).page;
  const browserContext: BrowserContext = {
    on: jest.fn(),
    pages: (): Array<Page> => {
      return data.contextPages;
    },
  } as unknown as BrowserContext;

  return new PlaywrightCapabilityBroker({
    executionId: "execution-timed-out-pages",
    page:
      data.contextPages.find((page: Page): boolean => {
        return page !== controllerPage && !data.internalPages?.has(page);
      }) ?? fakePage({ screenshot: neverDrawn }).page,
    browserContext,
    controllerPage,
    internalPages: data.internalPages,
    signal: new AbortController().signal,
    onRuntimeReady: (): void => {
      // The sandbox never starts here.
    },
    // No request is made here, so the egress proxy is never started.
    egress: new SyntheticEgressProxy(),
  });
}

function asText(screenshots: Record<string, Buffer>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(screenshots).map(
      ([name, image]: [string, Buffer]): [string, string] => {
        return [name, image.toString()];
      },
    ),
  );
}

describe("PlaywrightCapabilityBroker.captureTimedOutPages", () => {
  test("photographs every open page, named in the order the browser context lists them", async () => {
    const first: FakePage = fakePage({ screenshot: drawn("first") });
    const second: FakePage = fakePage({ screenshot: drawn("second") });
    const third: FakePage = fakePage({ screenshot: drawn("third") });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [first.page, second.page, third.page],
    });

    await broker.captureTimedOutPages({ timeoutInMs: 1_000 });

    expect(asText(broker.getScreenshots())).toEqual({
      "timed-out-page": "first",
      "timed-out-page-2": "second",
      "timed-out-page-3": "third",
    });
    expect(Object.keys(broker.getScreenshots())).toEqual([
      "timed-out-page",
      "timed-out-page-2",
      "timed-out-page-3",
    ]);
  });

  test("with no page open, keeps nothing and waits for nothing", async () => {
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [],
    });
    const startedAt: number = Date.now();

    await broker.captureTimedOutPages({ timeoutInMs: 5_000 });

    expect(broker.getScreenshots()).toEqual({});
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  test("asks Playwright for the page's viewport, within the time left", async () => {
    const only: FakePage = fakePage({ screenshot: drawn("only") });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [only.page],
    });

    await broker.captureTimedOutPages({ timeoutInMs: 2_000 });

    expect(only.screenshot).toHaveBeenCalledTimes(1);
    const options: Record<string, unknown> | undefined =
      only.screenshot.mock.calls[0]?.[0];
    expect(options?.["fullPage"]).toBeUndefined();
    expect(options?.["timeout"]).toBeGreaterThan(0);
    expect(options?.["timeout"]).toBeLessThanOrEqual(2_000);
  });

  test("leaves out a page that is never drawn, keeps the others, and returns at the deadline", async () => {
    const stuck: FakePage = fakePage({ screenshot: neverDrawn });
    const healthy: FakePage = fakePage({ screenshot: drawn("healthy") });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [stuck.page, healthy.page],
    });
    const startedAt: number = Date.now();

    await broker.captureTimedOutPages({ timeoutInMs: 300 });

    const elapsedInMs: number = Date.now() - startedAt;
    expect(asText(broker.getScreenshots())).toEqual({
      "timed-out-page-2": "healthy",
    });
    expect(elapsedInMs).toBeGreaterThanOrEqual(250);
    expect(elapsedInMs).toBeLessThan(2_000);
  });

  test("leaves out a page that fails as it is drawn", async () => {
    const closing: FakePage = fakePage({
      screenshot: (): Promise<Buffer> => {
        return Promise.reject(
          new Error("Target page, context or browser has been closed"),
        );
      },
    });
    const healthy: FakePage = fakePage({ screenshot: drawn("healthy") });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [closing.page, healthy.page],
    });

    await broker.captureTimedOutPages({ timeoutInMs: 1_000 });

    expect(asText(broker.getScreenshots())).toEqual({
      "timed-out-page-2": "healthy",
    });
  });

  test("does not keep a page drawn after the deadline", async () => {
    const late: FakePage = fakePage({ screenshot: drawn("late", 400) });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [late.page],
    });

    await broker.captureTimedOutPages({ timeoutInMs: 100 });
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 500);
    });

    expect(broker.getScreenshots()).toEqual({});
  });

  test("a screenshot that fails after the deadline is no one's: nothing goes unhandled", async () => {
    const unhandled: Array<unknown> = [];
    const onUnhandled: (reason: unknown) => void = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const failingLate: FakePage = fakePage({
        screenshot: (): Promise<Buffer> => {
          return new Promise<Buffer>(
            (
              _resolve: (value: Buffer) => void,
              reject: (reason: Error) => void,
            ): void => {
              setTimeout((): void => {
                reject(new Error("Browser has been closed"));
              }, 200);
            },
          );
        },
      });
      const broker: PlaywrightCapabilityBroker = createBroker({
        contextPages: [failingLate.page],
      });

      await broker.captureTimedOutPages({ timeoutInMs: 50 });
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 400);
      });

      expect(broker.getScreenshots()).toEqual({});
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("draws the pages side by side, so one slow page does not spend another's time", async () => {
    const first: FakePage = fakePage({ screenshot: drawn("first", 300) });
    const second: FakePage = fakePage({ screenshot: drawn("second", 300) });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [first.page, second.page],
    });

    // One after another, the second would finish after the deadline.
    await broker.captureTimedOutPages({ timeoutInMs: 500 });

    expect(asText(broker.getScreenshots())).toEqual({
      "timed-out-page": "first",
      "timed-out-page-2": "second",
    });
  });

  test("skips a closed page, which takes no number", async () => {
    const closed: FakePage = fakePage({
      screenshot: drawn("closed"),
      isClosed: true,
    });
    const open: FakePage = fakePage({ screenshot: drawn("open") });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [closed.page, open.page],
    });

    await broker.captureTimedOutPages({ timeoutInMs: 1_000 });

    expect(closed.screenshot).not.toHaveBeenCalled();
    expect(asText(broker.getScreenshots())).toEqual({
      "timed-out-page": "open",
    });
  });

  test("never photographs the runtime's own pages: the controller page and abandoned bootstrap pages", async () => {
    const controller: FakePage = fakePage({ screenshot: drawn("controller") });
    const abandoned: FakePage = fakePage({ screenshot: drawn("abandoned") });
    const tenant: FakePage = fakePage({ screenshot: drawn("tenant") });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [controller.page, abandoned.page, tenant.page],
      controllerPage: controller.page,
      internalPages: new Set<Page>([abandoned.page]),
    });

    await broker.captureTimedOutPages({ timeoutInMs: 1_000 });

    expect(controller.screenshot).not.toHaveBeenCalled();
    expect(abandoned.screenshot).not.toHaveBeenCalled();
    expect(asText(broker.getScreenshots())).toEqual({
      "timed-out-page": "tenant",
    });
  });

  test("leaves out a screenshot past the per-image limit and keeps the others", async () => {
    const huge: FakePage = fakePage({
      screenshot: (): Promise<Buffer> => {
        return Promise.resolve(Buffer.alloc(MAX_SCREENSHOT_BYTES + 1));
      },
    });
    const small: FakePage = fakePage({ screenshot: drawn("small") });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [huge.page, small.page],
    });

    await broker.captureTimedOutPages({ timeoutInMs: 1_000 });

    expect(asText(broker.getScreenshots())).toEqual({
      "timed-out-page-2": "small",
    });
  });

  test("keeps each screenshot as its own copy", async () => {
    const image: Buffer = Buffer.from("original");
    const only: FakePage = fakePage({
      screenshot: (): Promise<Buffer> => {
        return Promise.resolve(image);
      },
    });
    const broker: PlaywrightCapabilityBroker = createBroker({
      contextPages: [only.page],
    });

    await broker.captureTimedOutPages({ timeoutInMs: 1_000 });
    image.write("changed!");

    expect(asText(broker.getScreenshots())).toEqual({
      "timed-out-page": "original",
    });
  });
});
