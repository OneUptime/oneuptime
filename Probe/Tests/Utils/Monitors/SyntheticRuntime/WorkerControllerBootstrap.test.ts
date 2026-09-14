import { BrowserContext, Page, Route } from "playwright";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import { SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN } from "../../../../Utils/Monitors/SyntheticRuntime/ControllerOrigin";
import { SYNTHETIC_RUNTIME_FAULT_KIND } from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticRuntimeFault";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";

/*
 * These cover the sandbox's own start-up, not the tenant's script, so they run
 * against fakes rather than a real browser: the point is what happens when the
 * controller page's navigation never comes back, which is not something a
 * healthy Chromium will do on demand.
 *
 * The failure being pinned here is the one a customer reported --
 *
 *   page.goto: Timeout 30000ms exceeded.
 *   Call log: - navigating to "https://synthetic-runtime.oneuptime.invalid/<id>",
 *             waiting until "domcontentloaded"
 *       at WorkerController.execute (.../WorkerController.ts)
 *
 * -- which reached them as their monitor's script error, on an internal URL
 * they had no way to recognise, after a single attempt.
 */

type BindingHandler = (
  source: { page: Page; frame: unknown },
  request: unknown,
) => Promise<unknown>;

type RouteHandler = (route: Route) => Promise<void>;

interface FakePageRecord {
  page: FakePage;
  gotoUrls: string[];
  gotoTimeouts: Array<number | undefined>;
  routePatterns: string[];
  bindingNames: string[];
}

const WORKER_COMPLETION: Record<string, unknown> = {
  returnValue: { data: { ok: true } },
  logMessages: [],
  capturedMetrics: [],
  screenshotAssignments: {},
};

class FakePage {
  public closeCount: number = 0;
  public readonly gotoUrls: string[] = [];
  public readonly gotoTimeouts: Array<number | undefined> = [];
  public readonly routePatterns: string[] = [];
  public readonly routeHandlers: RouteHandler[] = [];
  public readonly bindingNames: string[] = [];
  public readonly bindingHandlers: BindingHandler[] = [];

  private isPageClosed: boolean = false;
  private readonly frame: Record<string, unknown> = { name: "main" };

  public constructor(
    private readonly context: FakeBrowserContext,
    private readonly index: number,
  ) {}

  public async route(pattern: string, handler: RouteHandler): Promise<void> {
    this.routePatterns.push(pattern);
    this.routeHandlers.push(handler);
  }

  public async exposeBinding(
    name: string,
    handler: BindingHandler,
  ): Promise<void> {
    this.bindingNames.push(name);
    this.bindingHandlers.push(handler);
  }

  public async goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<null> {
    this.gotoUrls.push(url);
    this.gotoTimeouts.push(options?.timeout);

    const failure: Error | undefined = this.context.gotoFailureFor(this.index);
    if (failure) {
      throw failure;
    }

    return null;
  }

  public mainFrame(): unknown {
    return this.frame;
  }

  public async evaluate(
    _callback: unknown,
    argument?: unknown,
  ): Promise<unknown> {
    /*
     * WorkerController drives the page with exactly two evaluate calls: one to
     * start the sandbox (an object payload) and one to stop it (the control
     * key, a bare string).
     */
    if (typeof argument === "string") {
      return undefined;
    }

    if (this.context.onStartWorker) {
      await this.context.onStartWorker(this);
    }

    return WORKER_COMPLETION;
  }

  public isClosed(): boolean {
    return this.isPageClosed;
  }

  public async close(): Promise<void> {
    this.closeCount++;
    this.isPageClosed = true;
  }
}

class FakeBrowserContext {
  public readonly pages: FakePage[] = [];
  public readonly listenerEvents: string[] = [];
  public onStartWorker?: ((page: FakePage) => Promise<void>) | undefined;

  /*
   * How many of the first navigations fail, and with what. A zero here is a
   * probe that is behaving; anything else is a probe under the load it
   * predictably sees whenever monitor intervals line up on a wall clock.
   */
  public constructor(
    private readonly failingNavigations: number = 0,
    private readonly failure: Error = timeoutError(),
  ) {}

  public async newPage(): Promise<Page> {
    const page: FakePage = new FakePage(this, this.pages.length);
    this.pages.push(page);
    return page as unknown as Page;
  }

  public on(event: string, _listener: unknown): void {
    this.listenerEvents.push(event);
  }

  public gotoFailureFor(pageIndex: number): Error | undefined {
    return pageIndex < this.failingNavigations ? this.failure : undefined;
  }
}

/*
 * Playwright's real shape for this: the message carries the call log, and the
 * stack repeats it. Both halves matter -- the supervisor concatenates them,
 * which is why the customer saw the same paragraph twice.
 */
function timeoutError(): Error {
  const message: string = [
    "page.goto: Timeout 30000ms exceeded.",
    "Call log:",
    `  - navigating to "${SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN}/6f0d1f6e-1f0a-4d0e-9d0e-6f0d1f6e1f0a", waiting until "domcontentloaded"`,
  ].join("\n");
  const error: Error = new Error(message);
  error.name = "TimeoutError";
  error.stack = `${message}\n    at WorkerController.execute (/usr/src/app/Utils/Monitors/SyntheticRuntime/WorkerController.ts:148:28)`;
  return error;
}

function execute(
  context: FakeBrowserContext,
  overrides: {
    bootstrapAttempts?: number;
    bootstrapTimeoutInMs?: number;
  } = {},
): Promise<SandboxExecutionResult> {
  return WorkerController.execute({
    browserContext: context as unknown as BrowserContext,
    page: { name: "monitored-page" } as unknown as Page,
    code: "return { data: { ok: true } };",
    browserType: "Chromium",
    screenSizeType: "Desktop",
    args: {},
    timeoutInMs: 10_000,
    bootstrapAttempts: overrides.bootstrapAttempts ?? 3,
    /*
     * Small enough to keep the suite fast, large enough that the retry delays
     * do not themselves exhaust the total bootstrap budget -- which is derived
     * from this number, so a 50ms budget would leave no room to retry at all.
     */
    bootstrapTimeoutInMs: overrides.bootstrapTimeoutInMs ?? 500,
  });
}

function describeFakePages(context: FakeBrowserContext): FakePageRecord[] {
  return context.pages.map((page: FakePage) => {
    return {
      page,
      gotoUrls: page.gotoUrls,
      gotoTimeouts: page.gotoTimeouts,
      routePatterns: page.routePatterns,
      bindingNames: page.bindingNames,
    };
  });
}

describe("SyntheticRuntime WorkerController bootstrap", () => {
  test("opens exactly one controller page when the first navigation lands", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(0);

    const result: SandboxExecutionResult = await execute(context);

    expect(result.returnValue).toEqual({ data: { ok: true } });
    expect(context.pages).toHaveLength(1);
    expect(context.pages[0]!.gotoUrls).toHaveLength(1);
    expect(context.pages[0]!.gotoUrls[0]).toContain(
      SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN,
    );
  });

  test("recovers from a stalled bootstrap navigation by retrying on a fresh page", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(1);

    const result: SandboxExecutionResult = await execute(context);

    expect(result.returnValue).toEqual({ data: { ok: true } });
    expect(context.pages).toHaveLength(2);
    // The stalled page is abandoned, not reused: its request is still paused.
    expect(context.pages[0]!.gotoUrls).toHaveLength(1);
    expect(context.pages[1]!.gotoUrls).toHaveLength(1);
  });

  test("closes the page from every abandoned attempt", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(2);

    await execute(context);

    expect(context.pages).toHaveLength(3);
    expect(context.pages[0]!.closeCount).toBe(1);
    expect(context.pages[1]!.closeCount).toBe(1);
  });

  test("navigates every attempt to the same execution's sentinel URL", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(2);

    await execute(context);

    const urls: string[] = context.pages.flatMap((page: FakePage) => {
      return page.gotoUrls;
    });
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(1);
  });

  test("re-installs the route and the RPC binding on each fresh attempt", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(1);

    await execute(context);

    for (const record of describeFakePages(context)) {
      expect(record.routePatterns).toEqual(["**/*"]);
      expect(record.bindingNames).toHaveLength(1);
      expect(record.bindingNames[0]).toMatch(/^__oneuptimeRpc_[0-9a-f]{32}$/);
    }
  });

  test("subscribes to the browser context once, however many attempts it takes", async () => {
    /*
     * A broker per attempt would be the obvious way to write the retry, and
     * would leak a "page" listener onto the shared context for every attempt
     * that failed.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(2);

    await execute(context);

    expect(context.listenerEvents).toEqual(["page"]);
  });

  test("gives each attempt the configured bootstrap budget", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(1);

    await execute(context, { bootstrapTimeoutInMs: 1234 });

    expect(context.pages[0]!.gotoTimeouts).toEqual([1234]);
    expect(context.pages[1]!.gotoTimeouts).toEqual([1234]);
  });

  test("reports a probe-side runtime fault once the attempts are spent", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(99);

    await expect(
      execute(context, { bootstrapAttempts: 2 }),
    ).rejects.toMatchObject({
      kind: SYNTHETIC_RUNTIME_FAULT_KIND,
      name: "SyntheticRuntimeFault",
    });
    expect(context.pages).toHaveLength(2);
  });

  test("keeps the sentinel URL and the Playwright stack out of the tenant-facing message", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(99);

    const error: Error = await execute(context, {
      bootstrapAttempts: 1,
    }).then(
      (): Error => {
        throw new Error("Expected the bootstrap to fail.");
      },
      (caught: Error): Error => {
        return caught;
      },
    );

    // What the customer reads must not be OneUptime's internals.
    expect(error.message).not.toContain("synthetic-runtime.oneuptime.invalid");
    expect(error.message).not.toContain("WorkerController.ts");
    expect(error.message).not.toContain("page.goto");
    expect(error.message).toContain("could not start on this probe");
    expect(error.message).toContain(
      "does not reflect the health of the monitored site",
    );

    // ...while the probe's own logs keep every bit of it.
    const detail: string = (error as { internalDetail?: string })
      .internalDetail as string;
    expect(detail).toContain("page.goto: Timeout 30000ms exceeded.");
    expect(detail).toContain("WorkerController.ts:148:28");
  });

  test("reports the number of attempts and the budget it spent on each", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(99);

    await expect(
      execute(context, { bootstrapAttempts: 3, bootstrapTimeoutInMs: 250 }),
    ).rejects.toThrow(/3 attempt\(s\) of up to 250 ms/);
  });

  test("stops retrying once the whole bootstrap budget is spent", async () => {
    /*
     * Retrying has to fit inside the startup allowance the supervisor already
     * reserved. Past it, the supervisor's own deadline fires first and the
     * check dies as a bare execution timeout that explains nothing.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(99);

    /*
     * Ten attempts are allowed, but each one burns its full 40ms budget
     * against a total of 10 x 40ms, so the elapsed retry delays (250ms each)
     * exhaust it well before the tenth.
     */
    await expect(
      execute(context, { bootstrapAttempts: 10, bootstrapTimeoutInMs: 40 }),
    ).rejects.toThrow(/could not start on this probe/);

    expect(context.pages.length).toBeGreaterThan(1);
    expect(context.pages.length).toBeLessThan(10);
  });

  test("binds the RPC guard to the page of its own attempt", async () => {
    /*
     * The binding installed on a page that was later abandoned must not accept
     * calls, and the surviving page's binding must not reject its own.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(1);
    const outcomes: string[] = [];

    context.onStartWorker = async (page: FakePage): Promise<void> => {
      const stale: BindingHandler = context.pages[0]!.bindingHandlers[0]!;
      const live: BindingHandler = page.bindingHandlers[0]!;
      const source: { page: Page; frame: unknown } = {
        page: page as unknown as Page,
        frame: page.mainFrame(),
      };

      await stale(source, {}).then(
        (): void => {
          outcomes.push("stale-accepted");
        },
        (error: Error): void => {
          outcomes.push(`stale-rejected:${error.message}`);
        },
      );

      await live(source, {}).then(
        (): void => {
          outcomes.push("live-accepted");
        },
        (error: Error): void => {
          outcomes.push(`live-rejected:${error.message}`);
        },
      );
    };

    await execute(context);

    expect(outcomes[0]).toBe(
      "stale-rejected:Rejected synthetic runtime RPC source.",
    );
    /*
     * The live binding reaches the broker, which rejects the empty request on
     * its own terms -- never as a bad source.
     */
    expect(outcomes[1]).not.toBe(
      "live-rejected:Rejected synthetic runtime RPC source.",
    );
    expect(outcomes[1]).not.toBe("live-accepted");
  });

  test("rejects a bootstrap attempt count that is not a usable number", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(0);

    await expect(execute(context, { bootstrapAttempts: 0 })).rejects.toThrow(
      "Synthetic runtime bootstrap attempt count is invalid.",
    );
    await expect(execute(context, { bootstrapAttempts: 99 })).rejects.toThrow(
      "Synthetic runtime bootstrap attempt count is invalid.",
    );
    expect(context.pages).toHaveLength(0);
  });

  test("rejects a bootstrap timeout that is not a usable number", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(0);

    await expect(execute(context, { bootstrapTimeoutInMs: 0 })).rejects.toThrow(
      "Synthetic runtime bootstrap timeout is invalid.",
    );
    await expect(
      execute(context, { bootstrapTimeoutInMs: 1.5 }),
    ).rejects.toThrow("Synthetic runtime bootstrap timeout is invalid.");
  });
});

describe("SyntheticRuntime WorkerController sentinel route", () => {
  async function captureRouteHandler(): Promise<{
    handler: RouteHandler;
    url: string;
  }> {
    const context: FakeBrowserContext = new FakeBrowserContext(0);
    await execute(context);
    return {
      handler: context.pages[0]!.routeHandlers[0]!,
      url: context.pages[0]!.gotoUrls[0]!,
    };
  }

  function fakeRoute(data: {
    url: string;
    resourceType: string;
    fulfill?: () => Promise<void>;
  }): { route: Route; fulfilled: string[]; aborted: string[] } {
    const fulfilled: string[] = [];
    const aborted: string[] = [];
    const route: Route = {
      request: (): { url: () => string; resourceType: () => string } => {
        return {
          url: (): string => {
            return data.url;
          },
          resourceType: (): string => {
            return data.resourceType;
          },
        };
      },
      fulfill: async (): Promise<void> => {
        if (data.fulfill) {
          await data.fulfill();
        }
        fulfilled.push(data.url);
      },
      abort: async (errorCode?: string): Promise<void> => {
        aborted.push(errorCode || "");
      },
    } as unknown as Route;

    return { route, fulfilled, aborted };
  }

  test("serves the sentinel document from memory and blocks everything else", async () => {
    const { handler, url } = await captureRouteHandler();

    const sentinel: ReturnType<typeof fakeRoute> = fakeRoute({
      url,
      resourceType: "document",
    });
    await handler(sentinel.route);
    expect(sentinel.fulfilled).toEqual([url]);
    expect(sentinel.aborted).toEqual([]);

    const other: ReturnType<typeof fakeRoute> = fakeRoute({
      url: "https://example.com/tracker.js",
      resourceType: "script",
    });
    await handler(other.route);
    expect(other.fulfilled).toEqual([]);
    expect(other.aborted).toEqual(["blockedbyclient"]);
  });

  test("blocks a non-document request even on the sentinel URL", async () => {
    const { handler, url } = await captureRouteHandler();

    const disguised: ReturnType<typeof fakeRoute> = fakeRoute({
      url,
      resourceType: "fetch",
    });
    await handler(disguised.route);

    expect(disguised.fulfilled).toEqual([]);
    expect(disguised.aborted).toEqual(["blockedbyclient"]);
  });

  test("always settles the route, so a failed fulfil cannot strand the navigation", async () => {
    /*
     * A handler that returns without fulfilling, aborting, or continuing leaves
     * the request paused in the browser with nothing to end it but the
     * navigation timeout -- the 30-second stall this whole file is about.
     */
    const { handler, url } = await captureRouteHandler();

    const broken: ReturnType<typeof fakeRoute> = fakeRoute({
      url,
      resourceType: "document",
      fulfill: async (): Promise<void> => {
        throw new Error("Target page, context or browser has been closed");
      },
    });

    await expect(handler(broken.route)).resolves.toBeUndefined();
    expect(broken.fulfilled).toEqual([]);
    expect(broken.aborted).toEqual(["failed"]);
  });
});
