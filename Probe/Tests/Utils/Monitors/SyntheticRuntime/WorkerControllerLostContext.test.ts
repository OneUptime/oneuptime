import {
  Browser,
  BrowserContext,
  BrowserType,
  Page,
  chromium,
  firefox,
} from "playwright";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import { SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN } from "../../../../Utils/Monitors/SyntheticRuntime/ControllerOrigin";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";

jest.setTimeout(120_000);

/*
 * Firefox sometimes completes the controller navigation, after the controller
 * document's process switch, without ever reporting that document's main-world
 * JavaScript context to Playwright: goto resolves, and every evaluate on the
 * page waits forever. A fresh page in the same browser is unaffected. It
 * happens to a few percent of bootstraps and cannot be triggered on demand.
 *
 * This reproduces exactly the state Playwright is left in -- the document
 * loaded, the utility world present, the main world missing -- by dropping
 * the main-world contexts Playwright's in-process server is told about for the
 * first controller document. That reaches into Playwright's private server
 * objects (pinned by the lockfile), so a Playwright upgrade that renames them
 * fails this test loudly at the setup assertions below rather than passing.
 */

interface ServerFrame {
  _page: unknown;
  contextCreated: (world: string, context: unknown) => unknown;
}

interface LostContextInjection {
  droppedMainContexts: () => number;
  restore: () => void;
}

function loseFirstControllerDocumentMainWorld(data: {
  browserType: BrowserType;
  anyPage: Page;
}): LostContextInjection {
  const connection: { toImpl: (value: unknown) => any } = (
    data.browserType as unknown as {
      _connection: { toImpl: (value: unknown) => any };
    }
  )._connection;
  expect(typeof connection?.toImpl).toBe("function");

  const pagePrototype: {
    goto: (url: string, ...rest: Array<unknown>) => Promise<unknown>;
  } = Object.getPrototypeOf(data.anyPage);
  const framePrototype: ServerFrame = Object.getPrototypeOf(
    connection.toImpl(data.anyPage).frameManager.mainFrame(),
  );
  expect(typeof pagePrototype.goto).toBe("function");
  expect(typeof framePrototype.contextCreated).toBe("function");

  const originalGoto: typeof pagePrototype.goto = pagePrototype.goto;
  const originalContextCreated: ServerFrame["contextCreated"] =
    framePrototype.contextCreated;
  let lostServerPage: unknown = null;
  let dropped: number = 0;

  // Armed as the first controller navigation is sent, so only that document's contexts are lost.
  pagePrototype.goto = function (
    this: Page,
    url: string,
    ...rest: Array<unknown>
  ): Promise<unknown> {
    if (
      lostServerPage === null &&
      url.startsWith(SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN)
    ) {
      lostServerPage = connection.toImpl(this);
    }
    return originalGoto.call(this, url, ...rest);
  };
  framePrototype.contextCreated = function (
    this: ServerFrame,
    world: string,
    context: unknown,
  ): unknown {
    if (world === "main" && lostServerPage && this._page === lostServerPage) {
      dropped++;
      return undefined;
    }
    return originalContextCreated.call(this, world, context);
  };

  return {
    droppedMainContexts: (): number => {
      return dropped;
    },
    restore: (): void => {
      pagePrototype.goto = originalGoto;
      framePrototype.contextCreated = originalContextCreated;
    },
  };
}

describe("SyntheticRuntime WorkerController with a controller page whose JavaScript context is lost", () => {
  test.each([
    ["Chromium", chromium],
    ["Firefox", firefox],
  ] as const)(
    "recovers on a fresh controller page in %s instead of waiting out the sandbox start-up",
    async (browserName: "Chromium" | "Firefox", browserType: BrowserType) => {
      const browser: Browser = await browserType.launch({ headless: true });
      /*
       * Everything after the launch sits inside the try, the injection
       * included: its setup asserts on Playwright internals, and a Playwright
       * upgrade that fails those assertions must not leave a browser behind.
       */
      let injection: LostContextInjection | undefined;

      try {
        const browserContext: BrowserContext = await browser.newContext();
        const page: Page = await browserContext.newPage();
        const controllerPages: Page[] = [];
        browserContext.on("page", (opened: Page): void => {
          controllerPages.push(opened);
        });
        injection = loseFirstControllerDocumentMainWorld({
          browserType,
          anyPage: page,
        });
        const startedAtInMs: number = Date.now();

        const result: SandboxExecutionResult = await WorkerController.execute({
          browserContext,
          page,
          code: "return { data: 42 };",
          browserType: browserName,
          screenSizeType: "Desktop",
          args: {},
          timeoutInMs: 10_000,
        });

        expect(result.scriptError).toBeUndefined();
        expect(result.returnValue).toEqual({ data: 42 });
        // The injection really took the first page's main world away...
        expect(injection.droppedMainContexts()).toBeGreaterThan(0);
        // ...and the bootstrap moved to a second page, which worked.
        expect(controllerPages).toHaveLength(2);
        expect(controllerPages[0]!.isClosed()).toBe(true);
        /*
         * Seconds for the check on the silent page, not the 30-second sandbox
         * start-up timeout that used to be the first thing to notice.
         */
        expect(Date.now() - startedAtInMs).toBeLessThan(20_000);
      } finally {
        injection?.restore();
        // Closing the browser closes its context too.
        await browser.close();
      }
    },
  );
});
