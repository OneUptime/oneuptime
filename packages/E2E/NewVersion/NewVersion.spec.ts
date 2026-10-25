import {
  APIRequestContext,
  BrowserContext,
  Locator,
  Page,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import path from "path";

/*
 * A new version of OneUptime deployed while a tab is open.
 *
 * The fixture serves build A of a small app made of the real new-version
 * pieces (Common/UI/Utils/NewVersion, Components/NewVersion, ErrorBoundary,
 * ContainedErrorBoundary, Link, Navigation), built with Common's own
 * build(), and "deploys" build B on request: the files change under the
 * open tab exactly as a deploy changes them, the old chunks gone.
 *
 * What a reader should see, and never: no "Something went wrong" and no
 * sudden reload. A quiet notice says a new version is ready; the next page
 * they open loads in the new version, at its address; a page whose code is
 * gone says it is updating and reloads into the same address and scroll;
 * nothing reloads while something typed is unsaved; offline, or with the
 * server restarting, the page says so and loads once it can; a part gone
 * for good says it could not be loaded after one reload, never a loop.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/new-version-ui",
);

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// Nothing looks for a new version but a page that fails to load.
const NO_LOOKING: string = `gap=${DAY_IN_MS}`;

interface FixtureState {
  build: string;
  stats: { documents: number; manifests: number; lastDocument: string };
}

interface FixtureWindow {
  __newVersionFixture: { boots: number; buildId: string };
}

interface Screen {
  step: string;
  variant: string;
  title: string;
  text: string;
}

const fixture: (
  request: APIRequestContext,
  command: string,
  query?: string,
) => Promise<FixtureState> = async (
  request: APIRequestContext,
  command: string,
  query?: string,
): Promise<FixtureState> => {
  const response: Awaited<ReturnType<APIRequestContext["post"]>> =
    await request.post(`/__fixture/${command}${query || ""}`);

  expect(response.ok()).toBe(true);

  return (await response.json()) as FixtureState;
};

const deploy: (request: APIRequestContext) => Promise<void> = async (
  request: APIRequestContext,
): Promise<void> => {
  await fixture(request, "deploy", "?build=b");
};

/*
 * The browser stays on the page it has when the reload a page starts is
 * answered with no content: what the page says as it reloads stays on
 * screen, to be read and drawn.
 */
const holdReloads: (request: APIRequestContext) => Promise<void> = async (
  request: APIRequestContext,
): Promise<void> => {
  await fixture(request, "hold-documents", "?on=1");
};

// How many times the app has booted in this tab: one more per full load.
const boots: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  return await page.evaluate((): number => {
    return (window as unknown as FixtureWindow).__newVersionFixture.boots;
  });
};

const runningBuild: (page: Page) => Promise<string> = async (
  page: Page,
): Promise<string> => {
  return await page.evaluate((): string => {
    return (window as unknown as FixtureWindow).__newVersionFixture.buildId;
  });
};

/*
 * Every screen the tab's pages showed while moving onto the new version,
 * recorded by the fixture as they were drawn - the page that showed one is
 * gone by the time the spec can look.
 */
const screensShown: (page: Page) => Promise<Array<Screen>> = async (
  page: Page,
): Promise<Array<Screen>> => {
  return await page.evaluate((): Array<Screen> => {
    return JSON.parse(
      window.sessionStorage.getItem("new-version-fixture-screens") || "[]",
    ) as Array<Screen>;
  });
};

// A moment to look for a new version: the tab getting focus.
const lookNow: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.evaluate((): void => {
    window.dispatchEvent(new Event("focus"));
  });
};

/*
 * Two frames and every finite animation done: the card's 260ms entrance
 * and the fixture's Tailwind writing its CSS as elements appear.
 */
const atRest: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.evaluate(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });

    await Promise.all(
      document
        .getAnimations()
        .filter((animation: Animation): boolean => {
          const timing: ComputedEffectTiming | undefined =
            animation.effect?.getComputedTiming();
          return Boolean(timing && timing.endTime !== Infinity);
        })
        .map((animation: Animation): Promise<Animation> => {
          return animation.finished;
        }),
    );
  });
};

const shoot: (page: Page, testInfo: TestInfo, name: string) => Promise<void> =
  async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
    await atRest(page);
    await page.screenshot({
      path: path.join(SCREENSHOTS, `${name}-${testInfo.project.name}.png`),
    });
  };

// Nothing runs past the screen's right edge: no sideways scroll.
const fitsTheScreen: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  expect(
    await page.evaluate((): boolean => {
      return (
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
      );
    }),
  ).toBe(true);
};

const notice: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("new-version-notice");
};

const recovery: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("chunk-load-recovery");
};

const pageErrors: Array<string> = [];

test.beforeEach(
  async ({ page, request }: { page: Page; request: APIRequestContext }) => {
    pageErrors.length = 0;
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
    await fixture(request, "reset");
  },
);

test.afterEach(async ({ request }: { request: APIRequestContext }) => {
  await fixture(request, "reset");
  // Nothing escaped as an uncaught error: every failure was handled.
  expect(pageErrors).toEqual([]);
});

test.describe("with no new version", () => {
  test("pages open inside the tab, and nothing is said", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/dashboard/home?gap=0");
    await expect(page.getByTestId("page-home")).toHaveAttribute(
      "data-build",
      "A",
    );

    await lookNow(page);
    await page.getByTestId("nav-monitors").click();

    await expect(page.getByTestId("page-monitors")).toHaveAttribute(
      "data-build",
      "A",
    );
    expect(await boots(page)).toBe(1);
    await expect(notice(page)).toHaveCount(0);
    await expect(recovery(page)).toHaveCount(0);
  });
});

test.describe("a deploy under the open tab", () => {
  const openThenDeploy: (
    page: Page,
    request: APIRequestContext,
    address?: string,
  ) => Promise<void> = async (
    page: Page,
    request: APIRequestContext,
    address?: string,
  ): Promise<void> => {
    await page.goto(address || "/dashboard/home?gap=0");
    await expect(page.locator("[data-build='A']").first()).toBeVisible();
    await deploy(request);
    await lookNow(page);
    await expect(notice(page)).toBeVisible();
  };

  test("is noticed quietly: the notice says what happens next, and nothing reloads by itself", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await openThenDeploy(page, request);

    await expect(page.getByTestId("new-version-notice-title")).toHaveText(
      "A new version of OneUptime is available",
    );
    await expect(page.getByTestId("new-version-notice-message")).toHaveText(
      "The next page you open will use it.",
    );
    await expect(page.getByTestId("new-version-notice-reload")).toHaveText(
      "Reload",
    );
    await expect(page.getByTestId("new-version-notice-dismiss")).toHaveAttribute(
      "aria-label",
      "Dismiss",
    );

    await page.waitForTimeout(1500);

    expect(await boots(page)).toBe(1);
    expect(await runningBuild(page)).toBe("fixture-build-a");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);

    await shoot(page, testInfo, "notice");
  });

  test("the notice sits in a corner of the screen, inside its gutters, and the page does not scroll sideways", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await openThenDeploy(page, request);
    await atRest(page);

    const box: { x: number; y: number; width: number; height: number } | null =
      await notice(page).boundingBox();
    const viewport: { width: number; height: number } = page.viewportSize() || {
      width: 0,
      height: 0,
    };

    expect(box).not.toBeNull();

    if (testInfo.project.name === "phone") {
      // 16px gutters, the full width between them.
      expect(Math.round(box!.x)).toBe(16);
      expect(Math.round(box!.x + box!.width)).toBe(viewport.width - 16);
    } else {
      // The reading side's corner: bottom left on a left-to-right page.
      expect(Math.round(box!.x)).toBe(24);
      expect(box!.width).toBeLessThanOrEqual(384);
    }

    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 15);

    await fitsTheScreen(page);
  });

  test("the next page opened loads in full, in the new version, at its address and query", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await openThenDeploy(page, request);

    await page.getByTestId("nav-incidents").click();

    await expect(page.getByTestId("page-incidents")).toHaveAttribute(
      "data-build",
      "B",
    );

    const url: URL = new URL(page.url());

    expect(`${url.pathname}${url.search}`).toBe(
      "/dashboard/incidents?state=open",
    );
    expect(await boots(page)).toBe(2);
    expect(await runningBuild(page)).toBe("fixture-build-b");
    // Straight to the new version: no screen in between.
    expect(await screensShown(page)).toEqual([]);
    // The tab runs the new version: nothing more to say.
    await expect(notice(page)).toHaveCount(0);
  });

  test("a router link and Back load the new version too, and only once each", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await openThenDeploy(page, request);

    await page.getByTestId("nav-settings").click();

    await expect(page.getByTestId("page-settings")).toHaveAttribute(
      "data-build",
      "B",
    );
    expect(await boots(page)).toBe(2);

    await page.goBack();

    await expect(page.getByTestId("page-home")).toHaveAttribute(
      "data-build",
      "B",
    );

    const bootsAfterBack: number = await boots(page);

    await page.waitForTimeout(1500);

    expect(await boots(page)).toBe(bootsAfterBack);
    expect(await runningBuild(page)).toBe("fixture-build-b");
  });

  test("Reload loads the new version on the same page, at the same address and scroll", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.goto("/dashboard/home?gap=0#latest");
    await expect(page.getByTestId("page-home")).toBeVisible();
    await page.evaluate((): void => {
      window.scrollTo(0, 1200);
    });
    await deploy(request);
    await lookNow(page);
    await expect(notice(page)).toBeVisible();

    await page.getByTestId("new-version-notice-reload").click();

    await expect(page.getByTestId("page-home")).toHaveAttribute(
      "data-build",
      "B",
    );
    expect(await boots(page)).toBe(2);

    const url: URL = new URL(page.url());

    expect(`${url.pathname}${url.search}${url.hash}`).toBe(
      "/dashboard/home?gap=0#latest",
    );

    await expect
      .poll(async (): Promise<number> => {
        return await page.evaluate((): number => {
          return Math.round(window.scrollY);
        });
      })
      .toBe(1200);
  });

  test("Dismiss puts the notice away, and the next page still loads the new version", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await openThenDeploy(page, request);

    await page.getByTestId("new-version-notice-dismiss").click();
    await expect(notice(page)).toHaveCount(0);

    await lookNow(page);
    await page.waitForTimeout(500);
    await expect(notice(page)).toHaveCount(0);

    await page.getByTestId("nav-monitors").click();
    await expect(page.getByTestId("page-monitors")).toHaveAttribute(
      "data-build",
      "B",
    );
  });
});

test.describe("unsaved changes", () => {
  test("Reload asks first, and only Reload anyway reloads", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await page.goto("/dashboard/settings?gap=0");
    await expect(page.getByTestId("page-settings")).toHaveAttribute(
      "data-build",
      "A",
    );
    await page
      .getByTestId("settings-description")
      .fill("Planned maintenance on Sunday");
    await deploy(request);
    await lookNow(page);
    await expect(notice(page)).toBeVisible();

    await page.getByTestId("new-version-notice-reload").click();

    await expect(notice(page)).toHaveAttribute("data-confirming", "true");
    await expect(page.getByTestId("new-version-notice-message")).toHaveText(
      "Reload now? Changes you haven't saved on this page will be lost.",
    );
    await expect(page.getByTestId("new-version-notice-reload")).toHaveText(
      "Reload anyway",
    );
    await expect(page.getByTestId("new-version-notice-cancel")).toHaveText(
      "Cancel",
    );
    expect(await boots(page)).toBe(1);

    await shoot(page, testInfo, "notice-unsaved");

    await page.getByTestId("new-version-notice-cancel").click();
    await expect(notice(page)).toHaveAttribute("data-confirming", "false");
    await expect(page.getByTestId("settings-description")).toHaveValue(
      "Planned maintenance on Sunday",
    );
    expect(await boots(page)).toBe(1);

    await page.getByTestId("new-version-notice-reload").click();
    await page.getByTestId("new-version-notice-reload").click();

    await expect(page.getByTestId("page-settings")).toHaveAttribute(
      "data-build",
      "B",
    );
    expect(await boots(page)).toBe(2);
  });

  test("something typed that stays on screen keeps the next page inside the tab, and a page that then needs the new version asks", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await page.goto("/dashboard/home?gap=0");
    await expect(page.getByTestId("page-home")).toBeVisible();
    await page.getByTestId("chat").fill("Why is checkout slow?");
    await deploy(request);
    await lookNow(page);
    await expect(notice(page)).toBeVisible();

    await page.getByTestId("nav-monitors").click();

    await expect(recovery(page)).toHaveAttribute("data-step", "needs-reload");
    await expect(page.getByTestId("chunk-load-recovery-title")).toHaveText(
      "A new version of OneUptime is ready",
    );
    await expect(recovery(page)).toContainText(
      "This page needs it to load. Reloading discards changes you haven't saved.",
    );
    // Nothing reloaded: what was typed is still there.
    await expect(page.getByTestId("chat")).toHaveValue("Why is checkout slow?");
    expect(await boots(page)).toBe(1);
    // One message at a time: the page says it, so the notice does not.
    await expect(notice(page)).toHaveCount(0);

    await shoot(page, testInfo, "needs-reload");

    await page.getByTestId("chunk-load-recovery-reload").click();

    await expect(page.getByTestId("page-monitors")).toHaveAttribute(
      "data-build",
      "B",
    );
    expect(await boots(page)).toBe(2);
  });
});

test.describe("a page whose code is gone after a deploy", () => {
  test("NEVER SOMETHING WENT WRONG: it says it is updating to the new version, and reloads into the same address", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.goto(`/dashboard/home?${NO_LOOKING}`);
    await expect(page.getByTestId("page-home")).toHaveAttribute(
      "data-build",
      "A",
    );
    await deploy(request);

    await page.getByTestId("nav-incidents").click();

    await expect(page.getByTestId("page-incidents")).toHaveAttribute(
      "data-build",
      "B",
    );

    const url: URL = new URL(page.url());

    expect(`${url.pathname}${url.search}`).toBe(
      "/dashboard/incidents?state=open",
    );
    expect(await boots(page)).toBe(2);

    // What the old page said before it reloaded: updating, never an error.
    const screens: Array<Screen> = await screensShown(page);

    expect(
      screens.map((screen: Screen): string => {
        return screen.step;
      }),
    ).toEqual(["checking", "updating"]);
    expect(screens[1]!.title).toBe("Updating to the new version");
    expect(screens[1]!.text).toContain(
      "OneUptime was updated while this page was open. You'll stay on this page while the new version loads.",
    );
    expect(JSON.stringify(screens)).not.toContain("Something went wrong");
  });

  test("while it reloads, the page says what is happening", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await page.goto(`/dashboard/home?${NO_LOOKING}`);
    await expect(page.getByTestId("page-home")).toBeVisible();
    await deploy(request);
    await holdReloads(request);

    await page.getByTestId("nav-incidents").click();

    await expect(recovery(page)).toHaveAttribute("data-step", "updating");
    await expect(page.getByTestId("chunk-load-recovery-title")).toHaveText(
      "Updating to the new version",
    );
    await expect(recovery(page)).toContainText(
      "OneUptime was updated while this page was open. You'll stay on this page while the new version loads.",
    );
    // The menus outside the page stay where they were.
    await expect(page.getByTestId("nav-home")).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    // Already on its way: no notice offering a reload.
    await expect(notice(page)).toHaveCount(0);

    // It asked for the same address, query and all.
    expect((await fixture(request, "stats")).stats.lastDocument).toBe(
      "/dashboard/incidents?state=open",
    );

    await fitsTheScreen(page);
    await shoot(page, testInfo, "updating");
  });

  test("a status page's visitor is told the page has a newer version, never about OneUptime, and gets no notice", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await page.goto(`/dashboard/home?audience=visitors&${NO_LOOKING}`);
    await expect(page.getByTestId("page-home")).toBeVisible();
    await deploy(request);
    await holdReloads(request);

    await page.getByTestId("nav-monitors").click();

    await expect(page.getByTestId("chunk-load-recovery-title")).toHaveText(
      "Loading the latest version",
    );
    await expect(recovery(page)).toContainText(
      "A newer version of this page is available. It's loading now.",
    );
    expect(await recovery(page).textContent()).not.toContain("OneUptime");
    await expect(notice(page)).toHaveCount(0);

    await shoot(page, testInfo, "updating-visitors");
  });

  test("a status page's visitor gets the new version on the next page, and no notice", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.goto("/dashboard/home?audience=visitors&gap=0");
    await expect(page.getByTestId("page-home")).toBeVisible();
    await deploy(request);
    await lookNow(page);
    await page.waitForTimeout(1000);

    await expect(notice(page)).toHaveCount(0);

    await page.getByTestId("nav-monitors").click();

    await expect(page.getByTestId("page-monitors")).toHaveAttribute(
      "data-build",
      "B",
    );
    expect(await boots(page)).toBe(2);
  });

  test("OFFLINE: it says so instead of reloading onto the browser's error page, and loads once back online", async ({
    page,
    request,
    context,
  }: {
    page: Page;
    request: APIRequestContext;
    context: BrowserContext;
  }, testInfo: TestInfo) => {
    await page.goto(`/dashboard/home?${NO_LOOKING}`);
    await expect(page.getByTestId("page-home")).toBeVisible();
    await deploy(request);
    await context.setOffline(true);

    await page.getByTestId("nav-monitors").click();

    await expect(recovery(page)).toHaveAttribute("data-step", "offline");
    await expect(page.getByTestId("chunk-load-recovery-title")).toHaveText(
      "You're offline",
    );
    await expect(recovery(page)).toContainText(
      "This page needs an internet connection to load. It will load as soon as you're back online.",
    );
    await expect(page.getByTestId("chunk-load-recovery-retry")).toHaveText(
      "Try again",
    );
    expect(await boots(page)).toBe(1);

    await fitsTheScreen(page);
    await shoot(page, testInfo, "offline");

    await context.setOffline(false);

    await expect(page.getByTestId("page-monitors")).toHaveAttribute(
      "data-build",
      "B",
      { timeout: 20000 },
    );
    expect(await boots(page)).toBe(2);
  });

  for (const [label, serverState] of [
    ["answering 503", "unavailable"],
    ["dropping the connection", "down"],
  ] as Array<[string, string]>) {
    test(`with the server ${label}: it says it can't reach the server, and loads once it is back`, async ({
      page,
      request,
    }: {
      page: Page;
      request: APIRequestContext;
    }, testInfo: TestInfo) => {
      await page.goto(`/dashboard/home?${NO_LOOKING}`);
      await expect(page.getByTestId("page-home")).toBeVisible();
      await fixture(request, "server", `?state=${serverState}`);

      await page.getByTestId("nav-monitors").click();

      await expect(recovery(page)).toHaveAttribute("data-step", "unreachable");
      await expect(page.getByTestId("chunk-load-recovery-title")).toHaveText(
        "Can't reach the server",
      );
      await expect(recovery(page)).toContainText(
        "It may be restarting after an update. This page will load as soon as the server is back.",
      );
      await expect(page.getByTestId("chunk-load-recovery-retry")).toHaveText(
        "Try now",
      );
      // Not reloaded onto an error page while the server is away.
      expect(await boots(page)).toBe(1);

      if (serverState === "unavailable") {
        await shoot(page, testInfo, "unreachable");
      }

      await fixture(request, "server", "?state=up");
      await deploy(request);
      await page.getByTestId("chunk-load-recovery-retry").click();

      await expect(page.getByTestId("page-monitors")).toHaveAttribute(
        "data-build",
        "B",
        { timeout: 20000 },
      );
      expect(await boots(page)).toBe(2);
    });
  }

  test("A PART GONE FOR GOOD: one reload, then it says the page couldn't be loaded - never a loop", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await page.goto(`/dashboard/home?${NO_LOOKING}`);
    await expect(page.getByTestId("page-home")).toBeVisible();
    // The build being served has lost the page's chunk.
    await fixture(request, "missing", "?chunk=Monitors");

    await page.getByTestId("nav-monitors").click();

    await expect(recovery(page)).toHaveAttribute("data-step", "failed", {
      timeout: 20000,
    });
    // One reload: the one that would have fetched it again.
    expect(await boots(page)).toBe(2);
    await expect(page.getByTestId("error-boundary-title")).toHaveText(
      "This page couldn't be loaded",
    );
    await expect(page.getByTestId("error-boundary-fallback")).toContainText(
      "A file it needs couldn't be downloaded from the server. Try reloading in a moment.",
    );
    await expect(page.getByTestId("error-boundary-reload")).toHaveText(
      "Reload page",
    );
    // Drawing it again would fail the same way.
    await expect(page.getByTestId("error-boundary-try-again")).toHaveCount(0);
    await expect(page.getByText("Something went wrong")).toHaveCount(0);

    await fitsTheScreen(page);
    await shoot(page, testInfo, "failed");

    // No loop.
    await page.waitForTimeout(3000);
    expect(await boots(page)).toBe(2);
    expect(new URL(page.url()).pathname).toBe("/dashboard/monitors");
  });
});

test.describe("one part of a page whose code is gone after a deploy", () => {
  test("says it is loading the latest version in its place, and the page reloads into it", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.goto(`/dashboard/widgets?${NO_LOOKING}`);
    await expect(page.getByTestId("page-widgets")).toHaveAttribute(
      "data-build",
      "A",
    );
    await deploy(request);

    await page.getByTestId("show-chart").click();

    await expect(page.getByTestId("page-widgets")).toHaveAttribute(
      "data-build",
      "B",
    );
    expect(await boots(page)).toBe(2);

    const screens: Array<Screen> = await screensShown(page);

    expect(
      screens.map((screen: Screen): string => {
        return `${screen.variant}:${screen.step}`;
      }),
    ).toEqual(["part:checking", "part:updating"]);
    expect(screens[1]!.text).toBe("Loading the latest version...");
  });

  test("while the page reloads, only the part's place says so", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await page.goto(`/dashboard/widgets?${NO_LOOKING}`);
    await expect(page.getByTestId("page-widgets")).toBeVisible();
    await deploy(request);
    await holdReloads(request);

    await page.getByTestId("show-chart").click();

    await expect(recovery(page)).toHaveAttribute("data-variant", "part");
    await expect(recovery(page)).toHaveAttribute("data-step", "updating");
    await expect(recovery(page)).toHaveText("Loading the latest version...");
    // The rest of the page stays, and the widget's own fallback never shows.
    await expect(page.getByTestId("widgets-note")).toBeVisible();
    await expect(page.getByTestId("widget-fallback")).toHaveCount(0);

    await shoot(page, testInfo, "part-updating");
  });

  test("with something typed on the page it asks, and nothing reloads", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await page.goto(`/dashboard/widgets?${NO_LOOKING}`);
    await expect(page.getByTestId("page-widgets")).toBeVisible();
    await page.getByTestId("widgets-note").fill("Latency doubled at 14:05");
    await deploy(request);

    await page.getByTestId("show-chart").click();

    await expect(recovery(page)).toHaveAttribute("data-step", "needs-reload");
    await expect(recovery(page)).toContainText(
      "This needs the latest version of the page. Save your changes, then reload the page.",
    );
    await expect(page.getByTestId("chunk-load-recovery-reload")).toHaveText(
      "Reload page",
    );
    await page.waitForTimeout(1000);
    expect(await boots(page)).toBe(1);
    await expect(page.getByTestId("widgets-note")).toHaveValue(
      "Latency doubled at 14:05",
    );

    await shoot(page, testInfo, "part-needs-reload");
  });
});

/*
 * The screens as they look, for the review: dark, German (long words) and
 * Persian (right to left), each checked to sit inside the screen.
 */
test.describe("as it looks", () => {
  for (const variant of [
    { name: "dark", query: "theme=dark" },
    { name: "de", query: "lang=de" },
    { name: "fa", query: "lang=fa" },
    { name: "fa-dark", query: "lang=fa&theme=dark" },
  ]) {
    test(`in ${variant.name}: the notice, a page updating, and a page that could not be loaded`, async ({
      page,
      request,
    }: {
      page: Page;
      request: APIRequestContext;
    }, testInfo: TestInfo) => {
      await page.goto(`/dashboard/home?gap=0&${variant.query}`);
      await expect(page.getByTestId("page-home")).toBeVisible();
      await deploy(request);
      await lookNow(page);
      await expect(notice(page)).toBeVisible();
      await atRest(page);

      if (variant.name.startsWith("fa") && testInfo.project.name === "desktop") {
        // The start side of a right-to-left page is the right.
        const box: { x: number; width: number } | null =
          await notice(page).boundingBox();
        const width: number = page.viewportSize()?.width || 0;
        expect(Math.round(width - (box!.x + box!.width))).toBe(24);
      }

      await fitsTheScreen(page);
      await shoot(page, testInfo, `notice-${variant.name}`);

      // A page whose code is gone: it says it is updating.
      await fixture(request, "deploy", "?build=a");
      await page.goto(`/dashboard/home?${NO_LOOKING}&${variant.query}`);
      await expect(page.getByTestId("page-home")).toHaveAttribute(
        "data-build",
        "A",
      );
      await deploy(request);
      await holdReloads(request);
      await page.getByTestId("nav-incidents").click();
      await expect(recovery(page)).toHaveAttribute("data-step", "updating");
      await expect(notice(page)).toHaveCount(0);
      await fitsTheScreen(page);
      await shoot(page, testInfo, `updating-${variant.name}`);

      // A part gone for good, after its one reload.
      await fixture(request, "reset");
      await fixture(request, "missing", "?chunk=Settings");
      await page.goto(`/dashboard/settings?${NO_LOOKING}&${variant.query}`);
      await expect(recovery(page)).toHaveAttribute("data-step", "failed", {
        timeout: 20000,
      });
      await fitsTheScreen(page);
      await shoot(page, testInfo, `failed-${variant.name}`);
    });
  }
});
