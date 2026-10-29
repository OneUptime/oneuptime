import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Walks Data Security's real pages - the product's Overview, its data
 * stores and issues, a store's own pages with its Timeline, an issue's page
 * with Fix it from here, and the Checks settings - against the offline
 * fixture (Fixture/Fixture.js): the product's real route tree, with only
 * the data boundary and the signed-in user synthetic. Every test pins the
 * browser clock, puts up a network fence that aborts anything leaving the
 * fixture server, and fails on an uncaught page error, on a request the
 * fence had to abort and on a request the fixture does not model.
 *
 * Laptop (1280) and phone (390) widths, light and dark, English, German and
 * Persian (right to left). Screenshots land in
 * output/playwright/data-security-ui/.
 */

const PORT: string = process.env["DATA_SECURITY_FIXTURE_PORT"] || "4255";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");

const BASE: string = `/dashboard/${PROJECT_ID}/data-security`;
const BUCKET: string = "20000000-0000-4000-8000-000000000001";
const PUBLIC_BUCKET_ISSUE: string = "30000000-0000-4000-8000-000000000001";

const PATHS: Readonly<Record<string, string>> = {
  overview: BASE,
  stores: `${BASE}/stores`,
  store: `${BASE}/stores/${BUCKET}`,
  inside: `${BASE}/stores/${BUCKET}/inside`,
  access: `${BASE}/stores/${BUCKET}/access`,
  storeTimeline: `${BASE}/stores/${BUCKET}/timeline`,
  issues: `${BASE}/issues`,
  issue: `${BASE}/issues/${PUBLIC_BUCKET_ISSUE}`,
  issueTimeline: `${BASE}/issues/${PUBLIC_BUCKET_ISSUE}/timeline`,
  checks: `${BASE}/settings/checks`,
};

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/data-security-ui",
);

interface UnhandledRequest {
  kind: string;
  modelName?: string;
  method?: string;
  url?: string;
}

interface RecordedApiRequest {
  method: string;
  url: string;
  body?: Record<string, unknown> | null;
}

interface FixtureState {
  apiRequests: Array<RecordedApiRequest>;
  unhandled: Array<UnhandledRequest>;
}

interface OpenOptions {
  width?: number | undefined;
  lang?: "en" | "de" | "fa" | undefined;
  theme?: "light" | "dark" | undefined;
  role?: "owner" | "viewer" | undefined;
  response?: "on" | "off" | undefined;
}

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap();
const abortedRequests: WeakMap<Page, Array<string>> = new WeakMap();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const state: FixtureState | null = await fixture(page).catch(() => {
    return null;
  });
  if (state) {
    expect(state.unhandled, "requests the fixture does not model").toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(
  page: Page,
  pathname: string,
  options: OpenOptions = {},
): Promise<void> {
  await page.setViewportSize({
    width: options.width || 1280,
    height: 1000,
  });
  await page.clock.setFixedTime(NOW);
  const params: URLSearchParams = new URLSearchParams();
  if (options.lang && options.lang !== "en") {
    params.set("lang", options.lang);
  }
  if (options.theme === "dark") {
    params.set("theme", "dark");
  }
  if (options.role && options.role !== "owner") {
    params.set("role", options.role);
  }
  if (options.response === "off") {
    params.set("response", "off");
  }
  const query: string = params.toString();
  await page.goto(query ? `${pathname}?${query}` : pathname);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __dataSecurityFixture: FixtureState })
          .__dataSecurityFixture,
      ),
    ) as FixtureState;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// How far the page scrolls sideways: 0 when everything fits its width.
async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

function responsePanel(page: Page): Locator {
  return page.getByTestId("data-security-issue-response");
}

/*
 * ---------------------------------------------------------------------------
 * The product's pages
 * ---------------------------------------------------------------------------
 */

test.describe("the Overview", () => {
  test("ranks the open issues by risk, and each opens its issue", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["overview"]!);

    const fixFirst: Locator = page.getByTestId("data-security-overview-charts");
    await expect(
      fixFirst.getByText("Anyone on the internet can read this bucket"),
    ).toBeVisible();

    // Riskiest first: the public bucket, then the unencrypted database.
    const text: string = await fixFirst.innerText();
    expect(
      text.indexOf("Anyone on the internet can read this bucket"),
    ).toBeLessThan(text.indexOf("The database is not encrypted at rest"));
    // An accepted risk is not open, so it is not ranked.
    expect(text).not.toContain("Reads over plain HTTP are allowed");

    await screenshot(page, "overview-1280");

    await fixFirst
      .getByText("Anyone on the internet can read this bucket")
      .click();
    await expect(page).toHaveURL(new RegExp(`${PUBLIC_BUCKET_ISSUE}$`));
    await expect(responsePanel(page)).toBeVisible();
  });

  test("the half-width cards keep their description under the title, across the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["store"]!);

    const title: Locator = page.getByRole("heading", { name: "What's Inside" });
    const description: Locator = page.getByText(
      "The kinds of sensitive data its scans found, from samples of its content.",
    );
    await expect(description).toBeVisible();

    const titleBox: { y: number; height: number } | null =
      await title.boundingBox();
    const descriptionBox: { width: number; y: number } | null =
      await description.boundingBox();
    // Beside two buttons it was squeezed to a word or two a line.
    expect(descriptionBox!.width).toBeGreaterThan(300);
    expect(descriptionBox!.y).toBeGreaterThanOrEqual(
      titleBox!.y + titleBox!.height - 2,
    );
  });
});

test.describe("a data store's Timeline", () => {
  test("is in the store's menu, and says who changed what on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["store"]!);
    await page.getByRole("link", { name: "Timeline" }).first().click();
    await expect(page).toHaveURL(new RegExp(`${BUCKET}/timeline$`));

    await expect(
      page.getByText("was discovered by Data Security.").first(),
    ).toBeVisible();
    await expect(page.getByText("was updated by").first()).toBeVisible();
    await page.getByText("Show details").first().click();
    await expect(page.getByText("Public By Design").first()).toBeVisible();

    await screenshot(page, "store-timeline-1280");
  });
});

test.describe("Fix it from here", () => {
  test("blocks the bucket's public access after asking, and both timelines say so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["issue"]!);

    const panel: Locator = responsePanel(page);
    await expect(panel).toContainText("Fix it from here");
    await screenshot(page, "issue-fix-it-from-here-1280");

    await panel.getByRole("button", { name: "Block Public Access" }).click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "Block public access to customer-exports?",
    );
    await expect(dialog).toContainText("through the store's cloud connection");
    await screenshot(page, "issue-block-public-access-confirm-1280");

    await dialog.getByRole("button", { name: "Block Public Access" }).click();
    await expect(
      page.getByTestId("data-security-issue-response-result"),
    ).toContainText("Public access is blocked.");

    const respond: RecordedApiRequest | undefined = (
      await fixture(page)
    ).apiRequests.find((request: RecordedApiRequest): boolean => {
      return request.url.endsWith(`/data-store/${BUCKET}/respond`);
    });
    expect(respond?.body).toEqual({
      action: "Block public access",
      dataSecurityIssueId: PUBLIC_BUCKET_ISSUE,
    });

    await page.getByRole("link", { name: "Timeline" }).first().click();
    await expect(
      page.getByText("on the store, through its cloud connection").first(),
    ).toBeVisible();
  });

  test("with the connection's response off, says what to turn on and where", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["issue"]!, { response: "off" });

    const panel: Locator = responsePanel(page);
    await expect(
      page.getByTestId("data-security-issue-response-unavailable"),
    ).toContainText("turn on Data security response");
    await expect(
      panel.getByRole("button", { name: "Block Public Access" }),
    ).toBeDisabled();
    await expect(
      page.getByTestId("data-security-issue-response-connections"),
    ).toBeVisible();
  });

  test("a Security Viewer reads the issue but cannot run it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["issue"]!, { role: "viewer" });

    await expect(
      responsePanel(page).getByRole("button", { name: "Block Public Access" }),
    ).toBeDisabled();
    expect(
      (await fixture(page)).apiRequests.filter(
        (request: RecordedApiRequest): boolean => {
          return request.url.endsWith("/respond");
        },
      ),
    ).toEqual([]);
  });
});

test.describe("an issue's status", () => {
  test("reads Open in English and Offen in German, never the Open button's verb", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["issue"]!, { lang: "de" });

    const header: Locator = page.locator("main, body").first();
    await expect(
      header.getByText("Offen", { exact: true }).first(),
    ).toBeVisible();
    await expect(header.getByText("Öffnen", { exact: true })).toHaveCount(0);

    await screenshot(page, "issue-de-1280");

    await open(page, PATHS["issue"]!);
    await expect(page.getByText("Open", { exact: true }).first()).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every page, on a phone, dark, and right to left
 * ---------------------------------------------------------------------------
 */

const WALKED: ReadonlyArray<[string, string]> = [
  ["overview", PATHS["overview"]!],
  ["stores", PATHS["stores"]!],
  ["store", PATHS["store"]!],
  ["inside", PATHS["inside"]!],
  ["access", PATHS["access"]!],
  ["store-timeline", PATHS["storeTimeline"]!],
  ["issues", PATHS["issues"]!],
  ["issue", PATHS["issue"]!],
  ["issue-timeline", PATHS["issueTimeline"]!],
  ["checks", PATHS["checks"]!],
];

test.describe("on a phone", () => {
  for (const [name, pathname] of WALKED) {
    test(`${name} fits 390 pixels, with nothing to scroll sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, pathname, { width: 390 });
      await expect(page.locator("h1, h2").first()).toBeVisible();
      // Let the page's reads settle before it is measured.
      await page.waitForLoadState("networkidle");
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
      await screenshot(page, `${name}-390`);
    });
  }
});

test.describe("dark", () => {
  for (const [name, pathname] of [
    ["overview", PATHS["overview"]!],
    ["issue", PATHS["issue"]!],
    ["store-timeline", PATHS["storeTimeline"]!],
  ] as ReadonlyArray<[string, string]>) {
    test(`${name} is drawn on the dark theme`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, pathname, { theme: "dark" });
      await expect(page.locator("html")).toHaveClass(/dark/);
      await page.waitForLoadState("networkidle");
      const background: string = await page.evaluate((): string => {
        return getComputedStyle(document.body).backgroundColor;
      });
      expect(background).not.toBe("rgb(255, 255, 255)");
      await screenshot(page, `${name}-dark-1280`);
    });
  }
});

test.describe("German and Persian", () => {
  test("German: the store's Timeline is in German, left to right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["storeTimeline"]!, { lang: "de" });
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    // The menu entry and the card are the German Dashboard's Timeline.
    await expect(
      page.getByRole("link", { name: "Zeitachse" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Zeitachse" }).first(),
    ).toBeVisible();
    await screenshot(page, "store-timeline-de-1280");
  });

  test("Persian: the issue reads right to left, on a phone, dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["issue"]!, {
      lang: "fa",
      theme: "dark",
      width: 390,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.waitForLoadState("networkidle");
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    await screenshot(page, "issue-fa-dark-390");
  });

  test("Persian: the Overview at a laptop's width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["overview"]!, { lang: "fa" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.waitForLoadState("networkidle");
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    await screenshot(page, "overview-fa-1280");
  });
});
