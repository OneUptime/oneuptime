import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Renders the real exception detail pages against the offline fixture
 * (Fixture/Fixture.js): the layout, side menu, header and all seven pages are
 * production components; only the data boundary is synthetic. Each test
 * asserts what the page drew and, through window.__exceptionFixture, what it
 * asked the API for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const EXCEPTION_ID: string = "50000000-0000-4000-8000-000000000001";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";
const TASK_ID: string = "70000000-0000-4000-8000-000000000002";
const FINGERPRINT: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const EXCEPTION_TYPE: string = "InventoryReservationError";
const BASE: string = `/dashboard/${PROJECT_ID}/exceptions/${EXCEPTION_ID}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../output/playwright/exception-detail-ui",
);

interface RecordedApiRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

interface RecordedListRequest {
  modelName: string;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

interface RecordedUpdate {
  modelName: string;
  id: string;
  data: Record<string, unknown>;
}

interface FixtureState {
  apiRequests: Array<RecordedApiRequest>;
  analyticsListRequests: Array<RecordedListRequest>;
  getItemRequests: Array<{ modelName: string; select: Record<string, unknown> }>;
  updates: Array<RecordedUpdate>;
  deletes: Array<{ modelName: string; id: string }>;
  createdTasks: Array<Record<string, unknown>>;
}

interface DetailPage {
  title: string;
  suffix: string;
  section: string;
}

const DETAIL_PAGES: ReadonlyArray<DetailPage> = [
  { title: "Overview", suffix: "", section: "Investigate" },
  { title: "Stack Trace", suffix: "/stack-trace", section: "Investigate" },
  { title: "Occurrences", suffix: "/occurrences", section: "Investigate" },
  { title: "Context", suffix: "/context", section: "Investigate" },
  { title: "Logs", suffix: "/logs", section: "Investigate" },
  { title: "AI Assistance", suffix: "/ai-assistance", section: "Resolve" },
  { title: "Settings", suffix: "/settings", section: "Manage" },
];

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
});

async function open(
  page: Page,
  suffix: string,
  query: string = "",
): Promise<void> {
  await page.goto(`${BASE}${suffix}${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("exception-summary")).toBeVisible({
    timeout: 60000,
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __exceptionFixture: FixtureState })
          .__exceptionFixture,
      ),
    ) as FixtureState;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

function sideMenu(page: Page): Locator {
  return page.locator("aside[role='navigation'][aria-label='Main navigation']");
}

function card(page: Page, heading: string): Locator {
  return page
    .getByTestId("card")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("header", () => {
  test("names the exception, its state, where it runs and how often", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    const summary: Locator = page.getByTestId("exception-summary");

    await expect(page.getByTestId("exception-summary-status")).toHaveText(
      "Unresolved",
    );
    await expect(page.getByTestId("exception-summary-unhandled")).toHaveText(
      "Unhandled",
    );
    await expect(page.getByTestId("exception-summary-error-class")).toHaveText(
      "Code fault",
    );
    await expect(page.getByTestId("exception-summary-environment")).toHaveText(
      "production",
    );
    await expect(page.getByTestId("exception-summary-type")).toHaveText(
      EXCEPTION_TYPE,
    );
    await expect(page.getByTestId("exception-summary-message")).toContainText(
      "Could not reserve 3 units of SKU-4821",
    );
    await expect(
      page.getByTestId("exception-summary-stat-occurrences"),
    ).toContainText("1,284");
    await expect(
      page.getByTestId("exception-summary-stat-first-seen"),
    ).toContainText("6 days ago");
    await expect(
      page.getByTestId("exception-summary-stat-first-seen"),
    ).toContainText("in checkout-api@2026.09.08");
    await expect(
      page.getByTestId("exception-summary-stat-last-seen"),
    ).toContainText("4 minutes ago");
    await expect(
      page.getByTestId("exception-summary-stat-service"),
    ).toContainText("checkout-api");
    await expect(
      summary.getByRole("button", { name: "Copy exception message" }),
    ).toBeVisible();

    // Only what the header needs is read up front.
    const state: FixtureState = await fixture(page);
    const exceptionRead: { select: Record<string, unknown> } | undefined =
      state.getItemRequests.find((request: { modelName: string }) => {
        return request.modelName === "TelemetryException";
      });
    expect(exceptionRead?.select).toMatchObject({
      unhandled: true,
      errorClass: true,
    });
    expect(exceptionRead?.select).not.toHaveProperty("stackTrace");
  });

  test("a long message is clamped until expanded", async ({ page }: { page: Page }) => {
    await open(page, "", "exception=long");

    const message: Locator = page.getByTestId("exception-summary-message");
    await expect(message).toHaveClass(/line-clamp-3/);
    await page.getByRole("button", { name: "Expand exception message" }).click();
    await expect(message).not.toHaveClass(/line-clamp-3/);
  });

  test("a sparse exception reads with fallbacks, not blanks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "", "exception=minimal");

    await expect(page.getByTestId("exception-summary-type")).toHaveText(
      "Application exception",
    );
    await expect(page.getByTestId("exception-summary-message")).toHaveText(
      "No exception message was recorded.",
    );
    await expect(page.getByTestId("exception-summary")).not.toContainText(
      /undefined|Invalid date|NaN/,
    );
    await expect(
      card(page, "Occurrence Trend").getByText(
        "No fingerprint was recorded, so occurrences cannot be charted.",
      ),
    ).toBeVisible();
  });

  test("resolves, reopens, archives and unarchives in one click each", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    const actions: Locator = page.getByTestId("exception-summary-actions");

    await actions.getByTestId("exception-triage-resolve").click();
    await expect(page.getByTestId("exception-summary-status")).toHaveText(
      "Resolved",
    );
    await expect(actions.getByTestId("exception-triage-unresolve")).toHaveText(
      "Reopen",
    );

    await actions.getByTestId("exception-triage-archive").click();
    await expect(page.getByTestId("exception-summary-archived")).toBeVisible();

    await actions.getByTestId("exception-triage-unresolve").click();
    await expect(page.getByTestId("exception-summary-status")).toHaveText(
      "Archived",
    );

    await actions.getByTestId("exception-triage-unarchive").click();
    await expect(page.getByTestId("exception-summary-status")).toHaveText(
      "Unresolved",
    );

    const updates: Array<RecordedUpdate> = (await fixture(page)).updates;
    expect(
      updates.map((update: RecordedUpdate) => {
        return Object.keys(update.data)
          .filter((key: string) => {
            return key === "isResolved" || key === "isArchived";
          })
          .map((key: string) => {
            return `${key}=${update.data[key]}`;
          })
          .join(",");
      }),
    ).toEqual([
      "isResolved=true",
      "isArchived=true",
      "isResolved=false",
      "isArchived=false",
    ]);
    expect(updates[0]!.id).toBe(EXCEPTION_ID);
    expect(updates[0]!.data["markedAsResolvedAt"]).toBeTruthy();
    expect(updates[0]!.data["markedAsResolvedByUserId"]).toBeTruthy();
    expect(updates[2]!.data["markedAsResolvedAt"]).toBeNull();
  });

  test("a refused update is explained inline and can be dismissed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "", "fail=update");

    await page.getByTestId("exception-triage-resolve").click();

    const error: Locator = page.getByTestId("exception-triage-error");
    await expect(error).toContainText("Could not update this exception.");
    await expect(error).toContainText(
      "You do not have permission to edit this exception.",
    );
    await expect(page.getByTestId("exception-summary-status")).toHaveText(
      "Unresolved",
    );

    await error.getByRole("button", { name: "Dismiss" }).click();
    await expect(error).toBeHidden();
  });

  test("shows a loader until the exception arrives, and an error if it cannot", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${BASE}?hold=exception`);
    await page.waitForFunction((): boolean => {
      return Boolean(
        (window as unknown as { __exceptionFixture?: unknown })
          .__exceptionFixture,
      );
    });
    await expect(page.getByTestId("exception-summary")).toBeHidden();
    await page.evaluate((): void => {
      (
        window as unknown as {
          __exceptionFixture: { releaseException: () => void };
        }
      ).__exceptionFixture.releaseException();
    });
    await expect(page.getByTestId("exception-summary")).toBeVisible();

    await page.goto(`${BASE}?fail=exception`);
    await expect(
      page.getByText("The exception store is unavailable."),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("exception-summary")).toBeHidden();
  });
});

test.describe("navigation", () => {
  test("every page is in the side menu, bookmarkable, and keeps the header", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");

    for (const detailPage of DETAIL_PAGES) {
      const link: Locator = sideMenu(page).getByRole("link", {
        name: detailPage.title,
        exact: true,
      });

      await expect(link).toHaveAttribute("href", `${BASE}${detailPage.suffix}`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${BASE}${detailPage.suffix}$`));
      await expect(link).toHaveClass(/bg-indigo-50/);
      await expect(
        page
          .getByRole("navigation", { name: "Breadcrumb" })
          .getByText(detailPage.title, { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("exception-summary")).toContainText(
        EXCEPTION_TYPE,
      );

      // Settings carries the triage buttons itself, so the header does not.
      await expect(page.getByTestId("exception-summary-actions")).toHaveCount(
        detailPage.title === "Settings" ? 0 : 1,
      );
    }
  });

  test("the mobile menu names the current section and page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/logs");

    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");
    await expect(toggle).toContainText("Investigate / Logs");
    await toggle.click();
    await page
      .locator("div[role='navigation'][aria-label='Main navigation']:visible")
      .getByRole("link", { name: "AI Assistance", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/ai-assistance$`));
    await expect(toggle).toContainText("Resolve / AI Assistance");
  });

  test("no page scrolls sideways on a phone", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const detailPage of DETAIL_PAGES.filter((candidate: DetailPage) => {
      // The span and log explorers own their own horizontal scrolling.
      return candidate.title !== "Occurrences" && candidate.title !== "Logs";
    })) {
      await open(page, detailPage.suffix);
      await page.waitForTimeout(500);
      await expectNoHorizontalOverflow(page);
    }
  });
});

test.describe("overview", () => {
  test("charts this exception's occurrences and switches windows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    const trend: Locator = card(page, "Occurrence Trend");

    await expect(trend.getByTestId("exception-trend-chart")).toBeVisible();
    await expect(trend).toContainText(/occurrences in the last 24 hours/);
    await expect(trend.locator(".recharts-bar-rectangle").first()).toBeVisible();

    await trend.getByTestId("exception-trend-window-30d").click();
    await expect(trend).toContainText(/occurrences in the last 30 days/);

    const histograms: Array<RecordedApiRequest> = (
      await fixture(page)
    ).apiRequests.filter((request: RecordedApiRequest) => {
      return request.url.includes("/telemetry/exceptions/histogram");
    });
    expect(histograms.length).toBeGreaterThanOrEqual(2);
    expect(histograms[0]!.body).toMatchObject({
      fingerprints: [FINGERPRINT],
      serviceIds: [SERVICE_ID],
      bucketSizeInMinutes: 30,
    });
    expect(histograms[histograms.length - 1]!.body).toMatchObject({
      bucketSizeInMinutes: 1440,
    });

    await screenshot(page, "overview");
  });

  test("an empty or failed trend degrades inline", async ({ page }: { page: Page }) => {
    await open(page, "", "histogram=empty");
    await expect(page.getByTestId("exception-trend-empty")).toContainText(
      "No occurrences in the last 24 hours",
    );

    await open(page, "", "histogram=fail");
    await expect(page.getByTestId("exception-trend-error")).toContainText(
      "Could not load the occurrence trend",
    );
    await expect(card(page, "Details")).toBeVisible();
  });

  test("details and the latest occurrence lead into the investigation", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");

    await expect(page.getByTestId("exception-detail-fingerprint")).toContainText(
      FINGERPRINT,
    );
    await expect(page.getByTestId("exception-detail-active-for")).toContainText(
      "6 days",
    );
    await expect(
      page.getByTestId("exception-latest-occurrence-release"),
    ).toContainText("checkout-api@2026.09.14");
    await expect(
      page.getByTestId("exception-latest-occurrence-trace").getByRole("link"),
    ).toHaveAttribute("href", new RegExp(TRACE_ID));

    await card(page, "Latest Occurrence")
      .getByRole("link", { name: "View stack trace" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/stack-trace$`));
    await expect(card(page, "Stack Trace")).toBeVisible();
  });
});

test.describe("stack trace", () => {
  test("opens on the crash point with its original source", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/stack-trace");
    const stack: Locator = card(page, "Stack Trace");

    await expect(stack).toContainText("10 frames · 3 in your code · 3 source mapped");
    await expect(page.getByTestId("stack-trace-headline")).toContainText(
      `${EXCEPTION_TYPE}: Could not reserve 3 units`,
    );
    await expect(page.getByTestId("stack-trace-crash-point")).toContainText(
      "Most likely crash point: InventoryService.reserveInventory",
    );

    const crashFrame: Locator = page.locator("[data-testid='stack-frame'][data-frame-index='0']");
    await expect(crashFrame.getByRole("button").first()).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(crashFrame.getByTestId("stack-frame-badge-crash")).toBeVisible();
    await expect(crashFrame.getByTestId("stack-frame-badge-mapped")).toBeVisible();
    await expect(
      crashFrame.locator("tr[data-highlighted='true']"),
    ).toContainText("throw new InventoryReservationError");

    const resolve: RecordedApiRequest | undefined = (
      await fixture(page)
    ).apiRequests.find((request: RecordedApiRequest) => {
      return request.url.includes("/telemetry/exceptions/resolve-stack-trace");
    });
    expect(resolve?.body).toMatchObject({
      serviceId: SERVICE_ID,
      serviceVersion: "checkout-api@2026.09.14",
    });

    await screenshot(page, "stack-trace");
  });

  test("folds library frames and switches views, order and expansion", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/stack-trace");
    const frames: Locator = page.getByTestId("stack-frame");

    await expect(frames).toHaveCount(5);
    await expect(page.getByTestId("stack-frame-group")).toContainText(
      "5 library frames hidden in .../express/lib/router",
    );
    await expect(
      page.locator("[data-frame-index='3'] [data-testid='stack-frame-badge-origin']"),
    ).toHaveText("node");

    await page.getByTestId("stack-trace-view-app").click();
    await expect(frames).toHaveCount(3);

    await page.getByTestId("stack-trace-view-all").click();
    await expect(frames).toHaveCount(10);
    await expect(frames.first()).toHaveAttribute("data-frame-index", "0");

    await page.getByTestId("stack-trace-order-oldest").click();
    await expect(frames.first()).toHaveAttribute("data-frame-index", "9");

    await page.getByTestId("stack-trace-expand-all").click();
    await expect(page.getByTestId("stack-frame-detail")).toHaveCount(10);
    await page.getByTestId("stack-trace-expand-all").click();
    await expect(page.getByTestId("stack-frame-detail")).toHaveCount(0);
  });

  test("the raw tab shows every line and can wrap them", async ({ page }: { page: Page }) => {
    await open(page, "/stack-trace");

    await page.getByTestId("stack-trace-tab-raw").click();
    const raw: Locator = page.getByTestId("raw-stack-trace");
    await expect(raw.locator("tr")).toHaveCount(11);
    await expect(raw).toHaveAttribute("data-wrap", "false");
    await page.getByTestId("stack-trace-wrap").click();
    await expect(raw).toHaveAttribute("data-wrap", "true");
  });

  test("without source maps frames keep their minified locations", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/stack-trace", "frames=unmapped");

    await expect(card(page, "Stack Trace")).toContainText("10 frames · 3 in your code");
    await expect(page.getByTestId("stack-frame-badge-mapped")).toHaveCount(0);
    await expect(
      page.locator("[data-frame-index='0'] [data-testid='stack-frame-function']"),
    ).toHaveText("reserveInventory");
  });

  test("without parsed frames the raw trace is the page", async ({ page }: { page: Page }) => {
    await open(page, "/stack-trace", "frames=raw");

    await expect(page.getByTestId("raw-stack-trace")).toBeVisible();
    await expect(page.getByTestId("stack-trace-tab")).toHaveCount(0);
    await expect(card(page, "Stack Trace")).toContainText(
      "Structured frames were not recorded",
    );
  });
});

test.describe("occurrences", () => {
  test("lists the spans that raised this exception, scoped on the server", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/occurrences");

    await expect(
      page.getByRole("heading", { name: "Spans that raised this exception" }),
    ).toBeVisible();
    // The locked scope chip renders its key and value as separate elements.
    await expect(
      page.getByText(new RegExp(`Exception:\\s*${EXCEPTION_TYPE}`)).first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("POST /api/checkout").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Showing 1-24 of 24")).toBeVisible();

    const state: FixtureState = await fixture(page);
    const spanList: RecordedListRequest | undefined =
      state.analyticsListRequests.find((request: RecordedListRequest) => {
        return Boolean(request.query["exceptionScope"]);
      });
    expect(spanList?.query["exceptionScope"]).toEqual({
      fingerprint: FINGERPRINT,
      primaryEntityId: SERVICE_ID,
    });

    const histogram: RecordedApiRequest | undefined = state.apiRequests.find(
      (request: RecordedApiRequest) => {
        return request.url.includes("/telemetry/traces/histogram");
      },
    );
    const facets: RecordedApiRequest | undefined = state.apiRequests.find(
      (request: RecordedApiRequest) => {
        return request.url.includes("/telemetry/traces/facets");
      },
    );
    expect(histogram?.body["exceptionScope"]).toEqual({
      fingerprint: FINGERPRINT,
      primaryEntityId: SERVICE_ID,
    });
    expect(facets?.body["exceptionScope"]).toEqual({
      fingerprint: FINGERPRINT,
      primaryEntityId: SERVICE_ID,
    });

    await screenshot(page, "occurrences-spans");
  });

  test("the details view keeps release, environment and trace per occurrence", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/occurrences");

    await page.getByTestId("exception-occurrences-view-details").click();
    await expect(
      page.getByRole("heading", { name: "Occurrence details" }),
    ).toBeVisible();

    const table: Locator = page.getByTestId("table-content");
    await expect(table.getByTestId("occurrence-time").first()).toContainText(
      "4 minutes ago",
      { timeout: 30000 },
    );
    await expect(table.getByTestId("occurrence-release").first()).toContainText(
      "checkout-api@2026.09.14",
    );
    await expect(table.getByText("Unhandled").first()).toBeVisible();
    await expect(page.getByText("Showing 1-10 of 24 occurrences")).toBeVisible();
  });
});

test.describe("context", () => {
  test("anchors replay and breadcrumbs on the latest occurrence", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/context");

    await expect(card(page, "Latest Occurrence")).toContainText(
      "The session replay and breadcrumbs below come from this occurrence.",
    );
    await expect(
      card(page, "Latest Occurrence").getByRole("link", { name: "View logs" }),
    ).toHaveAttribute("href", `${BASE}/logs`);
    await expect(page.getByRole("button", { name: "Show Logs" })).toHaveCount(0);

    const breadcrumbs: Locator = card(page, "Breadcrumbs");
    await expect(breadcrumbs).toContainText(
      "8 events in the 880 ms before the exception",
    );
    const rows: Locator = breadcrumbs.getByTestId("breadcrumb-row");
    await expect(rows).toHaveCount(7);
    await expect(rows.last()).toHaveAttribute("data-category", "EXCEPTION");
    await expect(rows.first().getByTestId("breadcrumb-time")).toHaveText("-880 ms");

    await breadcrumbs.getByTestId("breadcrumb-filter-DB").click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("breadcrumb-count")).toHaveText("×2");
    await breadcrumbs.getByTestId("breadcrumb-filter-all").click();
    await expect(rows).toHaveCount(7);

    await breadcrumbs.getByTestId("breadcrumb-time-format-clock").click();
    await expect(rows.first().getByTestId("breadcrumb-time")).toHaveText(
      /^\d{2}:\d{2}:\d{2}\.\d{3}$/,
    );

    await rows.nth(5).getByRole("button").first().click();
    await expect(rows.nth(5).getByTestId("breadcrumb-attributes")).toContainText(
      "http.status_code",
    );

    const spanRead: RecordedListRequest | undefined = (
      await fixture(page)
    ).analyticsListRequests.find((request: RecordedListRequest) => {
      return request.query["traceId"] === TRACE_ID;
    });
    expect(spanRead).toBeTruthy();

    await screenshot(page, "context");
  });

  test("with no stored occurrence the page explains what is missing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/context", "occurrence=none");

    await expect(page.getByTestId("exception-context-empty")).toBeVisible();
    await expect(card(page, "Breadcrumbs")).toHaveCount(0);
    await expect(card(page, "Latest Occurrence")).toHaveCount(0);
  });
});

test.describe("logs", () => {
  test("shows the log explorer for the latest trace, and the service around it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/logs");

    await expect(
      page.getByRole("heading", { name: /Logs around the latest occurrence/ }),
    ).toBeVisible();
    await expect(page.getByTestId("exception-logs-scope-trace")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      page.getByText("stock version changed for SKU-4821 (expected 41, got 42)"),
    ).toBeVisible({ timeout: 30000 });

    const traceLogRead: RecordedListRequest | undefined = (
      await fixture(page)
    ).analyticsListRequests.find((request: RecordedListRequest) => {
      return (
        request.modelName.toLowerCase().includes("log") &&
        JSON.stringify(request.query).includes(TRACE_ID)
      );
    });
    expect(traceLogRead).toBeTruthy();

    await screenshot(page, "logs");

    await page.getByTestId("exception-logs-scope-service").click();
    await expect(page.getByTestId("exception-logs-scope-description")).toContainText(
      "Everything this service logged",
    );
    await expect(
      page.getByText("Loaded cart for customer cus_12 (3 items)"),
    ).toBeVisible({ timeout: 30000 });

    const serviceLogRead: RecordedListRequest | undefined = (
      await fixture(page)
    ).analyticsListRequests.find((request: RecordedListRequest) => {
      return (
        request.modelName.toLowerCase().includes("log") &&
        JSON.stringify(request.query).includes(SERVICE_ID) &&
        !JSON.stringify(request.query).includes(TRACE_ID)
      );
    });
    expect(serviceLogRead).toBeTruthy();
  });

  test("an occurrence without a trace goes straight to the service's logs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/logs", "occurrence=no-trace");

    await expect(page.getByTestId("exception-logs-scope")).toHaveCount(0);
    await expect(page.getByTestId("exception-logs-scope-description")).toContainText(
      "Everything this service logged",
    );
  });

  test("with no occurrence there is nothing to correlate", async ({ page }: { page: Page }) => {
    await open(page, "/logs", "occurrence=none");

    await expect(page.getByTestId("exception-logs-empty")).toBeVisible();
  });
});

test.describe("AI assistance", () => {
  test("starts a task after confirmation and opens it", async ({ page }: { page: Page }) => {
    await open(page, "/ai-assistance");

    await expect(page.getByTestId("exception-ai-ready")).toBeVisible();
    const regression: Locator = page.getByTestId(
      "exception-ai-task-WriteRegressionTest",
    );
    await expect(regression.getByTestId("exception-ai-task-status")).toHaveText(
      "Not started",
    );

    await screenshot(page, "ai-assistance-ready");

    await regression.getByTestId("exception-ai-task-start").click();
    const modal: Locator = page.getByTestId("modal");
    await expect(
      modal.getByRole("heading", { name: "Confirm Generate Regression Test" }),
    ).toBeVisible();
    await modal.getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("ai-task-page")).toHaveText(TASK_ID);
    expect((await fixture(page)).createdTasks).toEqual([
      { taskType: "WriteRegressionTest" },
    ]);
  });

  test("an incomplete setup shows the checklist and locks the tasks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/ai-assistance", "ai=setup");

    await expect(
      page.getByRole("heading", { name: "Set up AI for this exception" }),
    ).toBeVisible();
    await expect(page.getByTestId("exception-ai-readiness-progress")).toHaveText(
      "1 of 3 ready",
    );
    await expect(
      page
        .getByTestId("exception-ai-readiness-repositoryConnected")
        .getByRole("link", { name: "Connect a Code Repository" }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("exception-ai-task-FixException")
        .getByTestId("exception-ai-task-start"),
    ).toBeDisabled();

    await screenshot(page, "ai-assistance-setup");
  });

  test("each task card reflects its latest run", async ({ page }: { page: Page }) => {
    await open(page, "/ai-assistance", "ai=mixed");

    const fix: Locator = page.getByTestId("exception-ai-task-FixException");
    const regression: Locator = page.getByTestId(
      "exception-ai-task-WriteRegressionTest",
    );
    const handling: Locator = page.getByTestId(
      "exception-ai-task-ImproveExceptionHandling",
    );

    await expect(fix.getByTestId("exception-ai-task-status")).toHaveText("Completed");
    await expect(fix.getByTestId("exception-ai-task-start")).toHaveText("Fix Again");
    await expect(regression.getByTestId("exception-ai-task-status")).toHaveText(
      "Queued",
    );
    await expect(regression.getByTestId("exception-ai-task-start")).toHaveCount(0);
    await expect(handling.getByTestId("exception-ai-task-status")).toHaveText(
      "Failed",
    );
    await expect(handling.getByTestId("exception-ai-task-start")).toHaveText(
      "Retry Error Handling",
    );
    await expect(handling.getByTestId("exception-ai-task-message")).toContainText(
      "The agent stopped responding after 20 minutes.",
    );

    await screenshot(page, "ai-assistance-mixed");
  });

  test("a refused start is explained inline", async ({ page }: { page: Page }) => {
    await open(page, "/ai-assistance", "fail=create-task");

    await page
      .getByTestId("exception-ai-task-FixException")
      .getByTestId("exception-ai-task-start")
      .click();
    await page.getByTestId("modal-footer-submit-button").click();

    await expect(page.getByText("Could not start AI task")).toBeVisible();
    await expect(
      page.getByText("No AI agent is online for this project."),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${BASE}/ai-assistance`));
  });

  test("a resolved exception pauses AI tasks", async ({ page }: { page: Page }) => {
    await open(page, "/ai-assistance", "status=resolved&ai=completed");

    await expect(page.getByText("AI assistance is paused")).toBeVisible();
    await expect(
      page
        .getByTestId("exception-ai-task-FixException")
        .getByTestId("exception-ai-task-start"),
    ).toBeDisabled();
    await expect(
      page
        .getByTestId("exception-ai-task-FixException")
        .getByTestId("exception-ai-task-view"),
    ).toBeVisible();
  });
});

test.describe("settings", () => {
  test("shows who resolved and archived it, and changes both", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/settings", "status=resolved-archived");

    await expect(
      page.getByTestId("exception-settings-resolution-history"),
    ).toHaveText("Resolved 2 hours ago by Priya Raman");
    await expect(page.getByTestId("exception-settings-archive-history")).toHaveText(
      "Archived 1 day ago by Priya Raman",
    );

    await screenshot(page, "settings");

    await page.getByTestId("exception-settings-unresolve").click();
    await expect(
      page.getByTestId("exception-settings-resolution-state"),
    ).toHaveText("Unresolved");
    await expect(page.getByTestId("exception-summary-status")).toHaveText(
      "Archived",
    );

    await page.getByTestId("exception-settings-unarchive").click();
    await expect(page.getByTestId("exception-settings-archive-state")).toHaveText(
      "Not archived",
    );
    await expect(page.getByTestId("exception-summary-status")).toHaveText(
      "Unresolved",
    );

    // The history columns are only read on this page.
    const reads: Array<{ modelName: string; select: Record<string, unknown> }> =
      (await fixture(page)).getItemRequests.filter(
        (request: { modelName: string }) => {
          return request.modelName === "TelemetryException";
        },
      );
    expect(reads[0]!.select).toHaveProperty("markedAsResolvedByUser");
  });

  test("deletes the exception after confirmation and returns to the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/settings");

    await page.getByRole("button", { name: "Delete Exception" }).click();
    await page
      .getByTestId("modal")
      .getByRole("button", { name: "Delete Exception" })
      .click();

    await expect(page.getByTestId("exceptions-list-page")).toBeVisible();
    expect((await fixture(page)).deletes).toEqual([
      { modelName: "TelemetryException", id: EXCEPTION_ID },
    ]);
  });
});
