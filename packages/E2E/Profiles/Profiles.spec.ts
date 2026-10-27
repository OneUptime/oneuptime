import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";

/*
 * The real Profiler against the offline fixture (Fixture/Fixture.js): the
 * layout, the overview, the function panel and a service's Profiles tab
 * are production components; only the data boundary is synthetic - a small
 * profile store answering the Profiler's reads the way the server does.
 * checkout shipped v2.4.0 forty minutes before the clock here, and its
 * order parser has parsed a much bigger payload since.
 *
 * Each test asserts what the page drew and, through window.__profilesFixture,
 * what it asked the server for - on a laptop and on a phone, in light and
 * dark.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CHECKOUT: string = "60000000-0000-4000-8000-0000000000a1";
const NOW: Date = new Date("2026-10-20T12:00:00.000Z");
const PROFILES: string = `/dashboard/${PROJECT_ID}/profiles`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/profiles-ui",
);

interface RecordedRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

interface FixtureState {
  apiRequests: Array<RecordedRequest>;
  fixRequests: Array<Record<string, unknown>>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    // React's DOM nesting warnings arrive as console errors.
    if (
      message.type() === "error" &&
      message.text().includes("validateDOMNesting")
    ) {
      errors.push(message.text());
    }
  });
  await page.clock.setFixedTime(NOW);
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
});

function isPhone(testInfo: TestInfo): boolean {
  return testInfo.project.name === "phone";
}

async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(
      SCREENSHOTS,
      `${name}-${testInfo.project.name}-synthetic.png`,
    ),
    fullPage: true,
    animations: "disabled",
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __profilesFixture: FixtureState })
          .__profilesFixture,
      ),
    ) as FixtureState;
  });
}

async function requestsTo(
  page: Page,
  route: string,
): Promise<Array<RecordedRequest>> {
  return (await fixture(page)).apiRequests.filter(
    (request: RecordedRequest): boolean => {
      return request.url.includes(route);
    },
  );
}

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${PROFILES}${query}`);
}

async function openLoaded(page: Page, query: string = ""): Promise<void> {
  await open(page, query);
  await expect(page.getByTestId("profiles-headline-text")).toBeVisible({
    timeout: 60000,
  });
}

/*
 * Boxes compared with each other are read in one frame (SuiteHelpers/Frames):
 * the function panel slides in from the side (SideOver, 200 ms), and each
 * boundingBox() is a frame of its own, so two read one by one while it moves
 * came from two moments of the slide (the AI credits notice and the words it
 * lines up with read 54 to 126 pixels apart on a busy machine).
 */

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("where the time goes", () => {
  test("every profiled service: the answer in words, the flame graph, the functions and what is profiled", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openLoaded(page);

    await expect(page.getByTestId("profiles-headline-text")).toHaveText(
      /JSON\.parse takes \d+% of the CPU time across your services\./,
    );
    await expect(page.getByTestId("profiles-headline-own")).toContainText(
      "In your own code, parseOrder takes the most",
    );
    await expect(page.getByTestId("profiles-headline-window")).toHaveText(
      "The last hour",
    );

    // Only kinds with data: CPU time, memory, allocations, locks, goroutines.
    await expect(page.getByTestId("profiles-kind-cpu")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("profiles-kind-wall")).toHaveCount(0);

    await expect(page.getByTestId("profiles-flame")).toBeVisible();
    await expect(page.getByTestId("profiles-functions")).toBeVisible();

    // Values read as a person writes them: "553 s", never "553.00 s".
    await expect(page.getByTestId("profiles-flame")).toContainText("Total:");
    await expect(page.getByTestId("profiles-flame")).not.toContainText(".00 ");
    await expect(page.getByTestId("profiles-functions")).not.toContainText(
      ".00 s",
    );

    // The flame graph names whose code a frame is as the list beside it does.
    const flame: Locator = page.getByTestId("profiles-flame");
    for (const word of ["Your code", "Library", "Runtime", "System"]) {
      await expect(flame).toContainText(word);
    }
    await expect(flame).not.toContainText("Dependencies");

    // The kernel thread the eBPF profiler profiled is folded away.
    const services: Locator = page.getByTestId("profiles-service-row");
    await expect(services.first()).toContainText("checkout");
    await expect(page.getByTestId("profiles-services")).not.toContainText(
      "kworker",
    );
    await expect(page.getByTestId("profiles-services-kernel")).toHaveText(
      "Show 1 kernel thread",
    );

    // CPU time is read in nanoseconds: the eBPF samples are a raw type.
    const types: Array<RecordedRequest> = await requestsTo(
      page,
      "/telemetry/profiles/function-list",
    );
    expect(types[types.length - 1]!.body["profileTypes"]).toEqual(["cpu"]);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
    await screenshot(page, testInfo, "overview");
  });

  test("one service, picked from what is profiled: its deploys to compare across", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    await page.getByTestId("profiles-service-row").first().click();
    await expect(page).toHaveURL(new RegExp(`serviceId=${CHECKOUT}`));
    await expect(page.getByTestId("profiles-headline-text")).toContainText(
      "JSON.parse takes 42% of the CPU time in checkout.",
    );

    // The deploy is in the compare menu, with when it shipped.
    await page.getByTestId("profiles-compare-picker").click();
    await expect(page.getByText("Before and after a change")).toBeVisible();
    await page.getByText("Deploy: v2.4.0 · 40 minutes ago").click();

    await expect(page).toHaveURL(/compare=change/);
    await expect(page.getByTestId("profiles-headline-text")).toContainText(
      "JSON.parse went from 21% to 47% of the CPU time.",
    );
    // The headline names the change it compares across, and when it was.
    await expect(page.getByTestId("profiles-headline-text")).toContainText(
      "Compared with before the change 40 minutes ago (Deploy: v2.4.0).",
    );
    await expect(page.getByTestId("profiles-headline-own")).toContainText(
      "In your own code, parseOrder grew the most",
    );
  });
});

test.describe("the scope bar", () => {
  test("every kind stays in reach - wrapped, never scrolled out of sight - and the raw types sit at their end", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openLoaded(page);

    const bar: Locator = page.getByTestId("profiles-scope-bar");
    const kinds: Locator = page.getByTestId("profiles-kind-picker");
    const barBox: { x: number; width: number } | null = await bar.boundingBox();
    expect(barBox).not.toBeNull();

    for (const kind of [
      "cpu",
      "memory",
      "allocations",
      "locks",
      "goroutines",
    ]) {
      const button: Locator = page.getByTestId(`profiles-kind-${kind}`);
      await expect(button).toBeVisible();
      const box: { x: number; width: number } | null =
        await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(barBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        barBox!.x + barBox!.width,
      );
    }

    // The eBPF profiler's CPU sample counts: at the end of the kinds.
    const more: Locator = kinds.getByTestId("profiles-raw-type-picker");
    await expect(more).toHaveText("More profile types");
    await more.click();
    await page
      .getByRole("menuitemradio", { name: "samples (CPU time)" })
      .click();

    await expect(page).toHaveURL(/profileType=samples/);
    await expect(more).toHaveText("samples (CPU time)");
    await expect(page.getByTestId("profiles-kind-cpu")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByTestId("profiles-headline-text")).toBeVisible();
    const lists: Array<RecordedRequest> = await requestsTo(
      page,
      "/telemetry/profiles/function-list",
    );
    expect(lists[lists.length - 1]!.body["profileTypes"]).toEqual(["samples"]);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
    await screenshot(page, testInfo, "scope-raw-type");
  });
});

test.describe("what changed", () => {
  test("compared with the period before: the diff graph and the functions that moved", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openLoaded(page, `?serviceId=${CHECKOUT}&compare=previous`);

    await expect(page.getByTestId("profiles-headline-text")).toContainText(
      "went from",
    );
    await expect(page.getByTestId("profiles-flame-compare")).toBeVisible();
    await expect(page.getByTestId("profiles-functions-explained")).toHaveText(
      "Each function's share of the window, before and after. Busier traffic alone moves nothing here.",
    );

    const rows: Locator = page.getByTestId("profiles-function-row");
    await expect(rows.first()).toContainText("JSON.parse");

    /*
     * On a phone the change sits under the name, which keeps the whole
     * width; from sm it sits beside it.
     */
    const compact: Locator = rows
      .first()
      .getByTestId("profiles-function-change-compact");
    const side: Locator = rows.first().getByTestId("profiles-function-change");
    if (isPhone(testInfo)) {
      await expect(compact).toBeVisible();
      await expect(compact).toContainText("points");
      await expect(side).toBeHidden();

      const name: { width: number } | null = await rows
        .first()
        .getByTestId("profiles-function-name")
        .boundingBox();
      // The name is not cut short by figures beside it.
      expect(name!.width).toBeGreaterThan(70);
    } else {
      await expect(side).toBeVisible();
      await expect(side).toContainText("points");
      await expect(compact).toBeHidden();
    }

    // Your code ranks the application's own functions by own-code share.
    await page.getByTestId("profiles-functions-view-own").click();
    await expect(
      page.getByTestId("profiles-function-row").first(),
    ).toContainText("parseOrder");

    const comparisons: Array<RecordedRequest> = await requestsTo(
      page,
      "/function-comparison",
    );
    expect(comparisons[0]!.body["afterEndTime"]).toBe(NOW.toISOString());

    await screenshot(page, testInfo, "compare");
  });
});

test.describe("one function", () => {
  test("from the headline: its shares, callers, callees, source and a monitor on its share", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openLoaded(page, `?serviceId=${CHECKOUT}`);

    await page
      .getByTestId("profiles-headline-own")
      .getByTestId("profiles-headline-function")
      .click();

    const panel: Locator = page.getByTestId("profiles-panel");
    await expect(panel.getByTestId("profiles-panel-name")).toHaveText(
      "parseOrder",
    );
    await expect(page).toHaveURL(/function=parseOrder/);
    await expect(panel.getByTestId("profiles-panel-own")).toHaveText("42%");
    await expect(panel.getByTestId("profiles-panel-callers")).toContainText(
      "handleCheckout",
    );
    await expect(panel.getByTestId("profiles-panel-callees")).toContainText(
      "JSON.parse",
    );
    await expect(
      panel.getByTestId("profiles-panel-source-link"),
    ).toHaveAttribute(
      "href",
      "https://github.com/acme/checkout/blob/main/src/orders/parse.ts#L88",
    );

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);

      /*
       * On a phone each figure is one row - what it counts on the left,
       * the share on the right - so the three take a third of the height
       * they took stacked, and Fix with AI stays in view.
       */
      for (const testId of [
        "profiles-panel-self",
        "profiles-panel-total",
        "profiles-panel-own",
      ]) {
        const [box, figure] = await boxesInOneFrame([
          panel.getByTestId(`${testId}-box`),
          panel.getByTestId(testId),
        ]);
        expect(box!.height).toBeLessThan(72);
        expect(box!.x + box!.width - (figure!.x + figure!.width)).toBeLessThan(
          20,
        );
      }
      await expect(panel.getByTestId("profiles-fix-with-ai")).toBeInViewport();
    } else {
      /*
       * Side by side, the three figures line up whatever the length of
       * the hint above each ("Your code with the library code it calls"
       * wraps where "Self in its own code" does not).
       */
      const tops: Array<number> = [];
      for (const testId of [
        "profiles-panel-self",
        "profiles-panel-total",
        "profiles-panel-own",
      ]) {
        const box: { y: number } | null = await panel
          .getByTestId(testId)
          .boundingBox();
        expect(box).not.toBeNull();
        tops.push(box!.y);
      }
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    }
    await screenshot(page, testInfo, "function-panel");

    // The flame graphs, for those who want them.
    await panel.getByTestId("profiles-panel-graphs-toggle").click();
    await expect(panel.getByTestId("profiles-panel-graphs")).toBeVisible();

    // A monitor on its share: Create Monitor, with what it needs.
    await panel.getByTestId("profiles-panel-watch").click();
    await expect(page.getByTestId("monitor-create-page")).toContainText(
      "profileFunction=parseOrder",
    );
    await expect(page.getByTestId("monitor-create-page")).toContainText(
      `profileServiceId=${CHECKOUT}`,
    );
  });

  test("code that is not the application's own points at the own code calling it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(
      page,
      `?serviceId=${CHECKOUT}&function=JSON.parse&file=node%3Ainternal%2Fjson`,
    );

    const panel: Locator = page.getByTestId("profiles-panel");
    await expect(panel.getByTestId("profiles-panel-not-yours")).toContainText(
      "starting with parseOrder",
    );
    await expect(panel.getByTestId("profiles-fix")).toHaveCount(0);

    await panel.getByTestId("profiles-panel-own-caller").click();
    await expect(page.getByTestId("profiles-panel-name")).toHaveText(
      "parseOrder",
    );
  });
});

test.describe("Fix with AI", () => {
  const PARSE_ORDER: string = `?serviceId=${CHECKOUT}&function=parseOrder&file=src%2Forders%2Fparse.ts`;

  test("says why, and starts a Code task with the profile", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openLoaded(page, PARSE_ORDER);

    const strip: Locator = page.getByTestId("profiles-fix");
    await expect(strip.getByTestId("profiles-fix-finding")).toContainText(
      "This is your code, and with the library code it calls it takes 42% of the CPU time.",
    );

    await strip.getByTestId("profiles-fix-with-ai").click();
    await expect(strip.getByTestId("profiles-fix-task-link")).toBeVisible();

    const sent: Array<Record<string, unknown>> = (await fixture(page))
      .fixRequests;
    expect(sent[0]).toMatchObject({
      serviceId: CHECKOUT,
      functionName: "parseOrder",
      fileName: "src/orders/parse.ts",
      profileType: "cpu",
    });

    await screenshot(page, testInfo, "fix-started");

    await strip.getByTestId("profiles-fix-task-link").click();
    await expect(page.getByTestId("code-task-page")).toBeVisible();
  });

  test("the repository is picked when none was found to hold the code", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page, `${PARSE_ORDER}&repo=pick`);

    const strip: Locator = page.getByTestId("profiles-fix");
    await expect(strip.getByTestId("profiles-fix-with-ai")).toBeDisabled();
    // It looks it, until a repository is picked.
    await expect(strip.getByTestId("profiles-fix-with-ai")).toHaveCSS(
      "opacity",
      "0.5",
    );

    await strip.getByTestId("profiles-fix-repository").click();
    await page.getByText("acme/platform", { exact: true }).click();
    await strip.getByTestId("profiles-fix-with-ai").click();

    await expect(strip.getByTestId("profiles-fix-task-link")).toBeVisible();
    expect((await fixture(page)).fixRequests[0]!["repositoryId"]).toBe(
      "90000000-0000-4000-8000-0000000000c2",
    );
  });

  test.describe("what stands in the way is said in its place", () => {
    test("no repository connected: Connect a repository", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openLoaded(page, `${PARSE_ORDER}&repo=none`);
      await expect(page.getByTestId("profiles-fix-connect")).toHaveText(
        "Connect a repository to fix this with AI",
      );
      await expect(page.getByTestId("profiles-fix-with-ai")).toHaveCount(0);
    });

    test("a fix already on its way: a link to it", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openLoaded(page, `${PARSE_ORDER}&fix=running`);
      await expect(page.getByTestId("profiles-fix-task-link")).toBeVisible();
    });

    test("no AI credits: Code's own words, with the way to add them", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openLoaded(page, `${PARSE_ORDER}&blocker=credits`);
      const blocker: Locator = page.getByTestId("code-blocker");
      await expect(blocker).toBeVisible();

      // In the strip's own amber, lined up with its words: no box inside it.
      const [words, notice] = await boxesInOneFrame([
        page.getByTestId("profiles-fix-finding"),
        blocker,
      ]);
      expect(Math.abs(notice!.x - words!.x)).toBeLessThanOrEqual(1);
      await expect(blocker).toHaveCSS("padding-left", "0px");
    });

    test("AI off: nothing is asked, nothing is drawn", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openLoaded(page, `${PARSE_ORDER}&ai=off`);
      await expect(page.getByTestId("profiles-panel-own")).toBeVisible();
      await expect(page.getByTestId("profiles-fix")).toHaveCount(0);
      expect(await requestsTo(page, "/profile-fix-suggestion")).toHaveLength(0);
    });

    test("a refusal is said beside the button", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openLoaded(page, `${PARSE_ORDER}&fail=fix`);
      await page.getByTestId("profiles-fix-with-ai").click();
      await expect(page.getByTestId("profiles-fix-error")).toContainText(
        "Could not start the fix: Pick the repository that holds this code.",
      );
    });
  });
});

test.describe("first steps and empty windows", () => {
  test("no profile anywhere: the Profiler's first steps and the setup guide", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await open(page, "?data=empty");

    await expect(page.getByTestId("profiles-first-steps")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("profiles-scope-bar")).toHaveCount(0);
    await screenshot(page, testInfo, "first-steps");

    await page.getByRole("button", { name: "Set up profiling" }).click();
    await expect(page.getByTestId("setup-guide-page")).toBeVisible();
  });

  test("profiles came in lately, none in this window: the past week, one click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?data=quiet");

    const empty: Locator = page.getByTestId("profiles-empty-window");
    await expect(empty).toContainText("No profiles in this window", {
      timeout: 60000,
    });

    await empty.getByRole("button", { name: "Show the past week" }).click();
    await expect(page).toHaveURL(/rangeMinutes=10080/);
    await expect(page.getByTestId("profiles-headline-text")).toBeVisible();
  });
});

test.describe("a service's own Profiles tab", () => {
  test("the overview locked to the service, over its profiles one by one", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`/dashboard/${PROJECT_ID}/service/${CHECKOUT}/profiles`);

    await expect(page.getByTestId("profiles-headline-text")).toContainText(
      "JSON.parse takes 42% of the CPU time in checkout.",
      { timeout: 60000 },
    );
    await expect(page.getByTestId("profiles-service-picker")).toHaveCount(0);
    await expect(page.getByTestId("profiles-services")).toHaveCount(0);

    const typeReads: Array<RecordedRequest> = await requestsTo(
      page,
      "/profile-types",
    );
    expect(typeReads[0]!.body["serviceIds"]).toEqual([CHECKOUT]);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
    await screenshot(page, testInfo, "service-tab");
  });

  test("a service with nothing profiled: the first steps alone - no bar, no empty list under them", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(
      `/dashboard/${PROJECT_ID}/service/${CHECKOUT}/profiles?data=empty`,
    );

    await expect(page.getByTestId("profiles-first-steps")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("profiles-scope-bar")).toHaveCount(0);
    await expect(page.getByText("All profiles", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("No profiles found for this service."),
    ).toHaveCount(0);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
    await screenshot(page, testInfo, "service-tab-empty");
  });
});

test.describe("the functions, ranked", () => {
  test("ranked by Total, Total is the bold figure with its value; Self steps back", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openLoaded(page, `?serviceId=${CHECKOUT}`);

    await page.getByTestId("profiles-functions-view-total").click();
    await expect(page.getByTestId("profiles-functions")).toHaveAttribute(
      "data-view",
      "total",
    );

    const first: Locator = page.getByTestId("profiles-function-row").first();
    await expect(first).toContainText("main");

    if (isPhone(testInfo)) {
      await expect(
        first.getByTestId("profiles-function-shares-compact"),
      ).toContainText(/^Total \d+% · /);
    } else {
      await expect(
        first.getByTestId("profiles-function-total"),
      ).toHaveAttribute("data-ranked", "true");
      await expect(first.getByTestId("profiles-function-self")).toHaveAttribute(
        "data-ranked",
        "false",
      );
      const weight: string = await first
        .getByTestId("profiles-function-total")
        .evaluate((element: Element): string => {
          return getComputedStyle(element).fontWeight;
        });
      expect(Number(weight)).toBeGreaterThanOrEqual(600);
    }
    await screenshot(page, testInfo, "ranked-by-total");
  });
});

test.describe("a read that fails", () => {
  test("the functions failing: no headline says there are no profiles, and the card offers a retry", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await open(page, `?serviceId=${CHECKOUT}&fail=functions`);

    await expect(page.getByTestId("profiles-flame")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("refresh-button")).toBeVisible();
    await expect(page.getByTestId("profiles-headline")).toHaveCount(0);
    await expect(
      page.getByText("No CPU time profiles in this window."),
    ).toHaveCount(0);
    await screenshot(page, testInfo, "functions-failed");
  });
});

test.describe("dark mode", () => {
  test("the overview and the panel draw on dark surfaces, flame labels readable", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openLoaded(
      page,
      `?serviceId=${CHECKOUT}&function=parseOrder&file=src%2Forders%2Fparse.ts&theme=dark`,
    );

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("profiles-panel")).toBeVisible();
    await screenshot(page, testInfo, "dark");
  });
});
