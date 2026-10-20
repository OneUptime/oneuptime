import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

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
      /Your services spent \d+% of their CPU time in JSON\.parse\./,
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
      "checkout spent 42% of its CPU time in JSON.parse.",
    );

    // The deploy is in the compare menu, with when it shipped.
    await page.getByTestId("profiles-compare-picker").click();
    await page.getByText("Deploy: v2.4.0 · 40 minutes ago").click();

    await expect(page).toHaveURL(/compare=change/);
    await expect(page.getByTestId("profiles-headline-text")).toContainText(
      "JSON.parse went from 21% to 47% of the CPU time.",
    );
    await expect(page.getByTestId("profiles-headline-own")).toContainText(
      "In your own code, parseOrder grew the most",
    );
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
    await expect(
      rows.first().getByTestId("profiles-function-change"),
    ).toContainText("points");

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

    await strip.getByTestId("profiles-fix-repository").click();
    await page.getByText("acme/platform", { exact: true }).click();
    await strip.getByTestId("profiles-fix-with-ai").click();

    await expect(strip.getByTestId("profiles-fix-task-link")).toBeVisible();
    expect((await fixture(page)).fixRequests[0]!["repositoryId"]).toBe(
      "90000000-0000-4000-8000-0000000000c2",
    );
  });

  test.describe("what stands in the way is said in its place", () => {
    test("no repository connected: Connect GitHub", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openLoaded(page, `${PARSE_ORDER}&repo=none`);
      await expect(page.getByTestId("profiles-fix-connect")).toHaveText(
        "Connect GitHub to fix this with AI",
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
      await expect(page.getByTestId("code-blocker")).toBeVisible();
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
      "checkout spent 42% of its CPU time in JSON.parse.",
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
