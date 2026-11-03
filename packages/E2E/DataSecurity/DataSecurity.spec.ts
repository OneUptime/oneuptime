import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";

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
// The database a role unused for months can still read.
const ORDERS_DB: string = "20000000-0000-4000-8000-000000000002";
const PUBLIC_BUCKET_ISSUE: string = "30000000-0000-4000-8000-000000000001";
// The same bucket's deleted files cannot be recovered: Turn On Versioning.
const VERSIONING_ISSUE: string = "30000000-0000-4000-8000-000000000006";
// The security case, alert and incident the public bucket's Critical issue started.
const ITS_CASE: string = "d0000000-0000-4000-8000-000000000001";
const ITS_ALERT: string = "e0000000-0000-4000-8000-000000000001";
const ITS_INCIDENT: string = "f0000000-0000-4000-8000-000000000001";

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
  scanning: `${BASE}/settings/scanning`,
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

interface RecordedUpdate {
  modelName: string;
  id: string;
  data: Record<string, unknown>;
}

interface FixtureState {
  apiRequests: Array<RecordedApiRequest>;
  unhandled: Array<UnhandledRequest>;
  updates: Array<RecordedUpdate>;
}

interface OpenOptions {
  width?: number | undefined;
  lang?: "en" | "de" | "fa" | undefined;
  theme?: "light" | "dark" | undefined;
  role?: "owner" | "viewer" | undefined;
  response?: "on" | "off" | undefined;
  // A new project's, or a busy one's.
  data?: "empty" | "busy" | undefined;
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
  if (options.data) {
    params.set("data", options.data);
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
      fixFirst.getByText("Anyone on the internet can read it"),
    ).toBeVisible();

    // Riskiest first: the public bucket, then the unencrypted database.
    const text: string = await fixFirst.innerText();
    expect(text.indexOf("Anyone on the internet can read it")).toBeLessThan(
      text.indexOf("Its data is not encrypted at rest"),
    );
    // An accepted risk is not open, so it is not ranked.
    expect(text).not.toContain("Unencrypted connections are allowed");

    await screenshot(page, "overview-1280");

    await fixFirst.getByText("Anyone on the internet can read it").click();
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

    const [titleBox, descriptionBox] = await boxesInOneFrame([
      title,
      description,
    ]);
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

  test("hardens the bucket from another of its issues: Turn On Versioning, after saying what it costs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/issues/${VERSIONING_ISSUE}`);

    const panel: Locator = responsePanel(page);
    await expect(panel).toContainText(
      "OneUptime can turn on versioning for this bucket through its cloud connection",
    );
    // The issue's own fix, and none of the bucket's other actions.
    await expect(
      panel.getByRole("button", { name: "Block Public Access" }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Turn Off Object ACLs" }),
    ).toHaveCount(0);

    await panel.getByRole("button", { name: "Turn On Versioning" }).click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "Turn on versioning for customer-exports?",
    );
    // What it costs, before a person confirms it.
    await expect(dialog).toContainText(
      "Earlier versions are kept, and billed, until a lifecycle rule removes them.",
    );
    await screenshot(page, "issue-turn-on-versioning-confirm-1280");

    await dialog.getByRole("button", { name: "Turn On Versioning" }).click();
    await expect(
      page.getByTestId("data-security-issue-response-result"),
    ).toContainText("Versioning is on.");

    const respond: RecordedApiRequest | undefined = (
      await fixture(page)
    ).apiRequests.find((request: RecordedApiRequest): boolean => {
      return request.url.endsWith(`/data-store/${BUCKET}/respond`);
    });
    expect(respond?.body).toEqual({
      action: "Turn on versioning",
      dataSecurityIssueId: VERSIONING_ISSUE,
    });
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

test.describe("what a Critical issue started", () => {
  test("its page links to its security case, its alert and its incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["issue"]!);

    const header: Locator = page.getByTestId("data-security-issue-header");
    const links: Array<[string, string]> = [
      [
        "Security case",
        `/dashboard/${PROJECT_ID}/security-events/cases/${ITS_CASE}`,
      ],
      ["Alert", `/dashboard/${PROJECT_ID}/alerts/${ITS_ALERT}`],
      ["Incident", `/dashboard/${PROJECT_ID}/incidents/${ITS_INCIDENT}`],
    ];

    for (const [name, href] of links) {
      await expect(
        header.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", href);
    }

    await screenshot(page, "issue-links-1280");
  });

  test("Settings > Scan Settings: incidents beside alerts, each with its own severity", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["scanning"]!);

    const card: Locator = page.getByTestId("data-security-scanning-issues");
    await expect(
      card.getByTestId("data-security-declare-incidents"),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      card.getByTestId("data-security-incident-severity"),
    ).toContainText("Incident Severity");
    await expect(
      card.getByTestId("data-security-alert-severity"),
    ).toContainText("Alert Severity");
    await expectNoSidewaysScroll(page);

    await screenshot(page, "scanning-when-an-issue-opens-1280");
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
  ["identities", `${BASE}/access`],
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
      await expectNoSidewaysScroll(page);
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
    await expectNoSidewaysScroll(page);
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
    await expectNoSidewaysScroll(page);
    await screenshot(page, "overview-fa-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Who can reach the data: identities, the riskiest first
 * ---------------------------------------------------------------------------
 */

const PUBLIC_IDENTITY: string = "1a000000-0000-4000-8000-000000000001";
const EXPORTER_IDENTITY: string = "1a000000-0000-4000-8000-000000000002";
const LEGACY_IDENTITY: string = "1a000000-0000-4000-8000-000000000004";
const SERVICE_IDENTITY: string = "1a000000-0000-4000-8000-000000000005";
const IDENTITY_PATH: string = `${BASE}/access/${EXPORTER_IDENTITY}`;

// What a monospace principal's computed font names: Tailwind's font-mono stack.
const MONOSPACE: RegExp = /mono/i;

// The identities list's rows: its body is the table's id with "-body".
function identityRows(page: Page): Locator {
  return page
    .locator("#data-security-identities-body tr")
    .filter({ has: page.getByTestId("data-security-identity-name") });
}

/*
 * A row's action: on the row when it fits, else under its More actions
 * menu. The row's button shows a short word ("View") and is named by the
 * action's whole title ("View Data Security Identity"), which starts with
 * it.
 */
async function rowAction(
  page: Page,
  row: Locator,
  name: string,
): Promise<void> {
  const inline: Locator = row.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(name)}`),
  });

  if ((await inline.count()) > 0) {
    await inline.click();
    return;
  }

  await row.getByRole("button", { name: /^More actions/ }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test.describe("who can reach the data", () => {
  test("Access lists every identity, the riskiest first, and says what each is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/access`);

    const rows: Locator = identityRows(page);

    await expect(rows).toHaveCount(5);
    await expect(rows.getByTestId("data-security-identity-name")).toHaveText([
      /^Everyone/,
      /^finance-exporter/,
      /^210987654321/,
      /^legacy-etl/,
      /^checkout/,
    ]);
    // What matters most about each, as a chip.
    await expect(rows.nth(0)).toContainText("Anyone on the internet");
    await expect(rows.nth(2)).toContainText("Outside your accounts");
    await expect(rows.nth(3)).toContainText("Not used in 90 days");
    await expect(rows.nth(4)).toContainText("Seen in traces");
    // The most it may do, and its risk.
    await expect(rows.nth(1)).toContainText("Write");
    await expect(rows.nth(1)).toContainText("Can change sensitive data");
    await expect(rows.nth(1)).toContainText("67");
    await screenshot(page, "access-identities-1280");

    // Each opens its own page.
    await rowAction(page, rows.nth(1), "View");
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(IDENTITY_PATH)}$`));
  });

  test("an identity's page says what it reaches, how, and why it ranks where it does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, IDENTITY_PATH);

    await expect(
      page.getByTestId("data-security-identity-about"),
    ).toContainText("arn:aws:iam::123456789012:role/finance-exporter");
    await expect(
      page.getByTestId("data-security-identity-risk-score"),
    ).toBeVisible();

    // Its principal reads as the identifier it is, in monospace.
    const principal: Locator = page
      .getByTestId("data-security-identity-about")
      .locator("bdi.font-mono");

    await expect(principal).toHaveText(
      "arn:aws:iam::123456789012:role/finance-exporter",
    );
    expect(
      await principal.evaluate((element: Element): string => {
        return getComputedStyle(element).fontFamily;
      }),
    ).toMatch(MONOSPACE);

    // When it was last used, and that it is inside the 90 days.
    await expect(page.getByText("Used in the last 90 days")).toBeVisible();

    // Every store it reaches, at what access level, and through what.
    const reach: Locator = page.getByTestId("data-security-identity-reach");

    await expect(reach).toContainText("customer-exports");
    await expect(reach).toContainText("Bucket policy");
    await expect(reach).toContainText("orders-db");
    await expect(reach).toContainText("IAM policy AmazonRDSReadOnlyAccess");
    await expect(
      reach.getByRole("columnheader", { name: "Access Level" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "identity-1280");
  });

  test("an identity whose last use no cloud reports says so, and a service seen in traces opens its service", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Anyone on the internet: no cloud says when it last read the bucket.
    await open(page, `${BASE}/access/${PUBLIC_IDENTITY}`);
    await expect(
      page.getByText("Its cloud does not say when it was last used"),
    ).toBeVisible();
    await expect(page.getByText("Unknown", { exact: true })).toBeVisible();

    // A role nobody has used for months: its grant is marked where it is listed.
    await open(page, `${BASE}/access/${LEGACY_IDENTITY}`);
    await expect(
      page.getByTestId("data-security-identity-reach-unused"),
    ).toHaveText("Not used in 90 days");

    // A service seen in traces: no id under its name, and a way to its service.
    await open(page, `${BASE}/access/${SERVICE_IDENTITY}`);
    await expect(
      page.getByTestId("data-security-identity-about"),
    ).not.toContainText("66666666-6666-4666-8666-666666666666");
    await expect(
      page.getByTestId("data-security-identity-service"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/66666666-6666-4666-8666-666666666666`,
    );
    await screenshot(page, "identity-service-1280");
  });

  test("an account outside reaches the bucket through a role it may assume", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["access"]!);

    const row: Locator = page
      .locator("tbody tr")
      .filter({ hasText: "210987654321" });

    await expect(row).toContainText("Outside your accounts");
    await expect(row).toContainText(
      "Can assume role vendor-reader: IAM policy AmazonS3ReadOnlyAccess",
    );
  });

  test("an identity's page reads inside a phone in the dark, and right to left in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, IDENTITY_PATH, { width: 390, theme: "dark" });
    await expect(
      page.getByTestId("data-security-identity-about"),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "identity-390-dark");

    await open(page, IDENTITY_PATH, { lang: "fa" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByTestId("data-security-identity-about"),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "identity-fa-1280");
  });

  test("a store's Who Can Reach It marks the access not used in 90 days, as its issue asks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/stores/${ORDERS_DB}/access`);

    await expect(
      page
        .locator("tbody tr")
        .filter({ hasText: "legacy-etl" })
        .getByTestId("data-store-access-unused"),
    ).toHaveText("Not used in 90 days");
    // Access in use is not marked.
    const service: Locator = page
      .locator("tbody tr")
      .filter({ hasText: "checkout" });

    await expect(service.getByTestId("data-store-access-unused")).toHaveCount(
      0,
    );
    // A service seen in traces goes by its name: its id means nothing to a reader.
    await expect(service).not.toContainText(
      "66666666-6666-4666-8666-666666666666",
    );

    const legacy: Locator = page
      .locator("tbody tr")
      .filter({ hasText: "legacy-etl" });
    // A role's ARN, under its name, in monospace.
    const arn: Locator = legacy.locator("bdi.font-mono");

    await expect(arn).toHaveText("arn:aws:iam::123456789012:role/legacy-etl");
    expect(
      await arn.evaluate((element: Element): string => {
        return getComputedStyle(element).fontFamily;
      }),
    ).toMatch(MONOSPACE);
    // Its access level is a pill, as on Access and an identity's page.
    await expect(legacy.getByTestId("pill-text")).toContainText(["Read"]);
    await screenshot(page, "store-access-unused-1280");

    // Each row opens its identity's page: what else it reaches.
    await rowAction(page, legacy, "View");
    await expect(page).toHaveURL(
      new RegExp(`${escapeRegExp(`${BASE}/access/${LEGACY_IDENTITY}`)}$`),
    );
    await expect(
      page.getByTestId("data-security-identity-about"),
    ).toContainText("arn:aws:iam::123456789012:role/legacy-etl");
  });

  test("a new project's Access says nothing reaches its stores yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BASE}/access`, { data: "empty" });

    // The list's empty state: what is missing, then when it is read.
    await expect(
      page.getByText(
        "No identity can reach your stores yet, or their access has not been read",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("It is read with each store's configuration."),
    ).toBeVisible();
    await screenshot(page, "access-empty-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * OneUptime AI's suggestions, and a person's confirmation
 * ---------------------------------------------------------------------------
 */

function findingRow(page: Page, location: string): Locator {
  return page.locator("tbody tr").filter({ hasText: location });
}

test.describe("OneUptime AI's suggestions on What's Inside", () => {
  test("a suggestion says it is OneUptime AI's and why, matched no value, and counts once confirmed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["inside"]!);

    const suggested: Locator = findingRow(page, "geb_datum");

    await expect(suggested).toContainText("Date of birth");
    // OneUptime AI's on a line of its own: being its suggestion says it is unsure.
    await expect(
      suggested.getByTestId("data-store-finding-ai-suggestion"),
    ).toContainText("Suggested by OneUptime AI");
    await expect(suggested).not.toContainText("Low confidence");
    await expect(
      suggested.getByTestId("data-store-finding-ai-reason"),
    ).toHaveText(
      "Geb. Datum is German for date of birth, and every value has the shape of a date.",
    );
    await expect(suggested).toContainText("No value matched");
    await expect(suggested).toContainText("500 values read");

    // One a person confirmed already reads as theirs, and is not offered again.
    const confirmed: Locator = findingRow(page, "steuer_nr");

    await expect(confirmed).toContainText("Suggested by OneUptime AI");
    await expect(confirmed).toContainText("Confirmed");
    await expect(confirmed).not.toContainText("Low confidence");
    await screenshot(page, "inside-suggestions-1280");

    await rowAction(page, suggested, "Confirm");

    const dialog: Locator = page.getByRole("dialog");

    await expect(dialog).toContainText("Confirm This Finding");
    await expect(dialog).toContainText(
      "You confirm this field holds this kind of data.",
    );
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(suggested).toContainText("Confirmed");
    await expect(suggested).not.toContainText("Low confidence");
    expect(
      (await fixture(page)).updates.filter(
        (update: RecordedUpdate): boolean => {
          return update.modelName === "DataStoreFinding";
        },
      ),
    ).toEqual([
      {
        modelName: "DataStoreFinding",
        id: "40000000-0000-4000-8000-000000000004",
        data: { isConfirmed: true },
      },
    ]);
  });

  test("a Security Viewer reads the suggestion but cannot confirm it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["inside"]!, { role: "viewer" });

    const suggested: Locator = findingRow(page, "geb_datum");

    await expect(suggested).toContainText("Suggested by OneUptime AI");

    const inline: Locator = suggested.getByRole("button", {
      name: "Confirm",
      exact: true,
    });

    if ((await inline.count()) > 0) {
      await expect(inline).toBeDisabled();
    } else {
      await suggested.getByRole("button", { name: /^More actions/ }).click();
      await expect(
        page.getByRole("menuitem", { name: "Confirm", exact: true }),
      ).toBeDisabled();
    }

    expect((await fixture(page)).updates).toEqual([]);
  });

  test("in German, a suggestion's reason stays in OneUptime AI's words, inside its column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PATHS["inside"]!, { lang: "de" });

    await expect(
      findingRow(page, "geb_datum").getByTestId("data-store-finding-ai-reason"),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "inside-suggestions-de-1280");
  });
});
