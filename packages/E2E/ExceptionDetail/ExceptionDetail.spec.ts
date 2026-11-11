import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";

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
// The task the fixture's API opens for each kind (Fixture.js TASK_IDS).
const TASK_IDS: Record<string, string> = {
  FixException: "70000000-0000-4000-8000-000000000001",
  WriteRegressionTest: "70000000-0000-4000-8000-000000000002",
  ImproveExceptionHandling: "70000000-0000-4000-8000-000000000003",
};
const FINGERPRINT: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const EXCEPTION_TYPE: string = "InventoryReservationError";
const BASE: string = `/dashboard/${PROJECT_ID}/exceptions/${EXCEPTION_ID}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/exception-detail-ui",
);

// An explorer's total, "24 spans" (TelemetryResultTotal).
const RESULT_TOTAL_TEST_ID: string = "telemetry-result-total";

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

interface RecordedCountRequest {
  modelName: string;
  query: Record<string, unknown>;
  // Whether it asked for the exact total (CountBy.exact).
  exact: boolean;
}

interface RecordedUpdate {
  modelName: string;
  id: string;
  data: Record<string, unknown>;
}

interface FixtureState {
  apiRequests: Array<RecordedApiRequest>;
  analyticsListRequests: Array<RecordedListRequest>;
  analyticsCountRequests: Array<RecordedCountRequest>;
  getItemRequests: Array<{
    modelName: string;
    select: Record<string, unknown>;
  }>;
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
  { title: "Fix with AI", suffix: "/ai-assistance", section: "Resolve" },
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

/*
 * A side-menu section's toggle, by its heading's text. Rarely used sections
 * (here Manage, which holds Settings) start folded down to their titles:
 * their rows are hidden until the section is opened, or until one of its
 * pages is the one open.
 */
function sideMenuSectionToggle(page: Page, section: string): Locator {
  return sideMenu(page).locator(
    `xpath=.//h6[normalize-space(.)='${section}']/ancestor::button[1]`,
  );
}

async function openSideMenuSection(page: Page, section: string): Promise<void> {
  const toggle: Locator = sideMenuSectionToggle(page, section);

  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

function card(page: Page, heading: string): Locator {
  return page
    .getByTestId("card")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
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

    /*
     * One read of the exception: what the header needs, and - on the
     * Overview, for Where it happened - its stack trace.
     */
    const state: FixtureState = await fixture(page);
    const exceptionReads: Array<{ select: Record<string, unknown> }> =
      state.getItemRequests.filter((request: { modelName: string }) => {
        return request.modelName === "TelemetryException";
      });
    const headerRead: { select: Record<string, unknown> } | undefined =
      exceptionReads.find((request: { select: Record<string, unknown> }) => {
        return "message" in request.select;
      });
    expect(headerRead?.select).toMatchObject({
      unhandled: true,
      errorClass: true,
      stackTrace: true,
    });
    /*
     * Besides it, nothing reads the exception: the security events above the
     * overview ask once for the fingerprints its occurrences carry, its own
     * and those merged into it (#5468).
     */
    expect(
      exceptionReads
        .filter((request: { select: Record<string, unknown> }) => {
          return request !== headerRead;
        })
        .map((request: { select: Record<string, unknown> }) => {
          return request.select;
        }),
    ).toEqual([]);
    expect(
      state.apiRequests
        .filter((request: RecordedApiRequest) => {
          return request.url.includes(
            "/telemetry-exception/group-fingerprints",
          );
        })
        .map((request: RecordedApiRequest) => {
          return request.body;
        }),
    ).toEqual([{ telemetryExceptionIds: [EXCEPTION_ID] }]);
  });

  test("a page that does not show the stack trace does not read it", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const suffix of ["/occurrences", "/logs", "/settings"]) {
      await open(page, suffix);

      const reads: Array<{
        modelName: string;
        select: Record<string, unknown>;
      }> = (await fixture(page)).getItemRequests.filter(
        (request: { modelName: string }) => {
          return request.modelName === "TelemetryException";
        },
      );

      expect(reads.length, `the exception read on ${suffix}`).toBeGreaterThan(
        0,
      );

      for (const read of reads) {
        expect([suffix, "stackTrace" in read.select]).toEqual([suffix, false]);
      }
    }
  });

  test("a long message is clamped until expanded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "", "exception=long");

    const message: Locator = page.getByTestId("exception-summary-message");
    await expect(message).toHaveClass(/line-clamp-3/);
    await page
      .getByRole("button", { name: "Expand exception message" })
      .click();
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
    // Who turned it, and when, is the server's to record: only the switch is sent.
    for (const update of updates) {
      expect(Object.keys(update.data)).toHaveLength(1);
    }
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

    // Manage, which holds Settings, starts folded away on the Overview.
    await expect(sideMenuSectionToggle(page, "Manage")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(
      sideMenu(page).locator(`a[href='${BASE}/settings']`),
    ).toBeHidden();

    for (const detailPage of DETAIL_PAGES) {
      await openSideMenuSection(page, detailPage.section);

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
      .getByRole("link", { name: "Fix with AI", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/ai-assistance$`));
    await expect(toggle).toContainText("Resolve / Fix with AI");
  });

  test("no page scrolls sideways on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const detailPage of DETAIL_PAGES.filter((candidate: DetailPage) => {
      // The span and log explorers own their own horizontal scrolling.
      return candidate.title !== "Occurrences" && candidate.title !== "Logs";
    })) {
      await open(page, detailPage.suffix);
      await page.waitForTimeout(500);
      await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expect(
      trend.locator(".recharts-bar-rectangle").first(),
    ).toBeVisible();

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

  /*
   * The Overview reads top to bottom, one card a row: where the exception
   * happened, how often, then its latest occurrence - each as wide as the
   * page, so no card stands beside a shorter one over blank page.
   */
  test("reads where it happened, how often, then the latest occurrence, each card as wide as the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, "");
      await expect(card(page, "Latest Occurrence")).toBeVisible();
      await expect(card(page, "Where it happened")).toBeVisible();

      const headings: Array<string> = (
        await page.getByTestId("card-details-heading").allTextContents()
      ).map((text: string): string => {
        return text.trim();
      });
      const order: Array<string> = [
        "Where it happened",
        "Occurrence Trend",
        "Latest Occurrence",
      ];

      expect([
        width,
        headings.filter((heading: string): boolean => {
          return order.includes(heading);
        }),
      ]).toEqual([width, order]);
      // The facts the header already gives are not a card of their own.
      expect([width, headings.includes("Details")]).toEqual([width, false]);

      const boxes: Array<FrameBox> = await boxesInOneFrame(
        order.map((title: string): Locator => {
          return card(page, title);
        }),
      );

      for (const [index, box] of boxes.entries()) {
        expect([
          width,
          order[index],
          Math.round(box.x - boxes[0]!.x),
          Math.round(box.width - boxes[0]!.width),
        ]).toEqual([width, order[index], 0, 0]);
      }

      await expectNoSidewaysScroll(page, { tolerance: 1 });
    }
  });

  /*
   * Across the page, the latest occurrence's facts run three a row on a
   * wide screen, two beside the side menu of a smaller one and one on a
   * phone. The long ones - the trace and the fingerprint - take a row of
   * their own.
   */
  test("the latest occurrence's facts run three a row on a wide screen, two on a smaller one, one on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    const ACROSS: Record<number, number> = {
      1440: 3,
      1024: 3,
      768: 2,
      390: 1,
    };

    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, "");

      const latest: Locator = card(page, "Latest Occurrence");
      const fingerprint: Locator = latest.getByTestId(
        "exception-latest-occurrence-fingerprint",
      );

      await expect(fingerprint).toBeVisible();

      const lefts: Array<number> = await latest
        .locator("dl > div")
        .evaluateAll((items: Array<Element>): Array<number> => {
          return items.map((item: Element): number => {
            return Math.round(item.getBoundingClientRect().left);
          });
        });

      expect([width, new Set(lefts).size]).toEqual([width, ACROSS[width]]);

      const [fingerprintBox, listBox] = await boxesInOneFrame([
        fingerprint,
        latest.locator("dl"),
      ]);

      expect([
        width,
        Math.round(fingerprintBox!.width - listBox!.width),
      ]).toEqual([width, 0]);

      await expectNoSidewaysScroll(page, { tolerance: 1 });
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, "", "exception=long");
    await screenshot(page, "overview-cards-long");
  });

  // Alone on its row, the empty box is as tall as its words: no blank card.
  test("with no occurrence stored, the latest occurrence says so, its box as tall as its words", async ({
    page,
  }: {
    page: Page;
  }) => {
    interface EmptyBoxes {
      headerBottom: number;
      boxTop: number;
      boxBottom: number;
      wordsTop: number;
      wordsBottom: number;
      boxPaddingY: number;
      boxBorderY: number;
    }

    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, "", "occurrence=none");

      const latest: Locator = card(page, "Latest Occurrence");
      const empty: Locator = latest.getByTestId(
        "exception-latest-occurrence-empty",
      );

      await expect(empty).toContainText(
        "No individual occurrence is stored for this exception yet.",
      );

      const boxes: EmptyBoxes = await latest.evaluate(
        (element: Element): EmptyBoxes => {
          const header: Element = element.querySelector(
            '[data-testid="card-header"]',
          ) as Element;
          const box: Element = element.querySelector(
            '[data-testid="exception-latest-occurrence-empty"]',
          ) as Element;
          const words: Element = box.querySelector("p") as Element;
          const boxStyle: CSSStyleDeclaration = getComputedStyle(box);

          return {
            headerBottom: header.getBoundingClientRect().bottom,
            boxTop: box.getBoundingClientRect().top,
            boxBottom: box.getBoundingClientRect().bottom,
            wordsTop: words.getBoundingClientRect().top,
            wordsBottom: words.getBoundingClientRect().bottom,
            boxPaddingY:
              parseFloat(boxStyle.paddingTop) +
              parseFloat(boxStyle.paddingBottom),
            boxBorderY:
              parseFloat(boxStyle.borderTopWidth) +
              parseFloat(boxStyle.borderBottomWidth),
          };
        },
      );
      const label: string = `${width}px`;

      expect([
        label,
        Math.round(
          boxes.boxBottom -
            boxes.boxTop -
            (boxes.wordsBottom - boxes.wordsTop) -
            boxes.boxPaddingY -
            boxes.boxBorderY,
        ),
      ]).toEqual([label, 0]);
      // Under the card's header.
      expect(boxes.boxTop).toBeGreaterThan(boxes.headerBottom);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, "", "occurrence=none");
    await screenshot(page, "overview-cards-no-occurrence");
  });

  test("an empty or failed trend degrades inline", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "", "histogram=empty");
    await expect(page.getByTestId("exception-trend-empty")).toContainText(
      "No occurrences in the last 24 hours",
    );

    await open(page, "", "histogram=fail");
    await expect(page.getByTestId("exception-trend-error")).toContainText(
      "Could not load the occurrence trend",
    );
    await expect(card(page, "Latest Occurrence")).toBeVisible();
    await expect(card(page, "Where it happened")).toBeVisible();
  });

  test("the latest occurrence names its fingerprint and leads into the investigation", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    const latest: Locator = card(page, "Latest Occurrence");

    await expect(
      latest.getByTestId("exception-latest-occurrence-fingerprint"),
    ).toContainText(FINGERPRINT);
    await expect(
      latest.getByTestId("exception-latest-occurrence-release"),
    ).toContainText("checkout-api@2026.09.14");
    await expect(
      latest.getByTestId("exception-latest-occurrence-trace").getByRole("link"),
    ).toHaveAttribute("href", new RegExp(TRACE_ID));
    await expect(
      latest.getByRole("link", { name: "All occurrences" }),
    ).toHaveAttribute("href", `${BASE}/occurrences`);

    await latest.getByRole("link", { name: "View context" }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/context$`));
  });
});

/*
 * ---------------------------------------------------------------------------
 * Where it happened, on the Overview
 * ---------------------------------------------------------------------------
 * What a person opening an exception reads first: the line it was most
 * likely raised from - where the release's source map put it, with the
 * source around it - and the frames of their own code that called it,
 * without opening the Stack Trace page.
 */
test.describe("where it happened", () => {
  test("names the crash point where the source map put it, its source, and the application's frames that called it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    const crash: Locator = card(page, "Where it happened");

    await expect(crash).toContainText(
      "The first frame in your own code: the most likely place the error was raised.",
    );
    await expect(
      crash.getByTestId("exception-crash-point-frame"),
    ).toHaveAttribute("data-in-app", "true");
    await expect(
      crash.getByTestId("exception-crash-point-function"),
    ).toHaveText("InventoryService.reserveInventory");
    await expect(
      crash.getByTestId("exception-crash-point-location"),
    ).toHaveText("src/services/inventory.ts:187:13");
    await expect(crash.locator("tr[data-highlighted='true']")).toContainText(
      "throw new InventoryReservationError",
    );

    // The application's own frames under it, the runtime's and Express's left out.
    const callers: Locator = crash.getByTestId("exception-crash-point-caller");

    await expect(callers).toHaveCount(2);
    await expect(callers.nth(0)).toContainText("OrderService.submitOrder");
    await expect(callers.nth(0)).toContainText("src/services/order.ts:64:9");
    await expect(callers.nth(1)).toContainText("handleCheckout");
    await expect(crash.getByTestId("exception-crash-point-summary")).toHaveText(
      "10 frames · 3 in your code",
    );

    // Resolved through the same source map the Stack Trace page reads.
    const resolve: RecordedApiRequest | undefined = (
      await fixture(page)
    ).apiRequests.find((request: RecordedApiRequest) => {
      return request.url.includes("/telemetry/exceptions/resolve-stack-trace");
    });
    expect(resolve?.body).toMatchObject({
      serviceId: SERVICE_ID,
      serviceVersion: "checkout-api@2026.09.14",
    });

    await screenshot(page, "overview-where-it-happened");

    await crash.getByRole("link", { name: "View full stack trace" }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/stack-trace$`));
    await expect(card(page, "Stack Trace")).toBeVisible();
  });

  test("without source maps it keeps the minified location, and draws no source", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "", "frames=unmapped");
    const crash: Locator = card(page, "Where it happened");

    await expect(
      crash.getByTestId("exception-crash-point-function"),
    ).toHaveText("reserveInventory");
    await expect(
      crash.getByTestId("exception-crash-point-location"),
    ).toHaveAttribute("title", "/app/dist/services/inventory.js:212:17");
    await expect(crash.getByTestId("stack-frame-source-snippet")).toHaveCount(
      0,
    );
  });

  test("without structured frames it shows the trace's first lines, and counts the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "", "frames=raw");
    const crash: Locator = card(page, "Where it happened");

    await expect(crash).toContainText(
      "Structured frames were not recorded for the latest occurrence.",
    );

    const raw: Locator = crash.getByTestId("exception-crash-point-raw");

    await expect(raw).toContainText(
      `${EXCEPTION_TYPE}: Could not reserve 3 units`,
    );
    await expect(raw).toContainText("at reserveInventory");
    await expect(raw).not.toContainText(
      "/app/node_modules/express/lib/router/index.js",
    );
    await expect(crash.getByTestId("exception-crash-point-summary")).toHaveText(
      "3 more lines",
    );
    await expect(crash.getByTestId("exception-crash-point-frame")).toHaveCount(
      0,
    );
  });

  test("an exception without a stack trace has no card for it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "", "exception=minimal");
    await expect(card(page, "Latest Occurrence")).toBeVisible();
    await expect(card(page, "Where it happened")).toHaveCount(0);
  });

  test("on a phone the crash point's long location stays inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "");
    const crash: Locator = card(page, "Where it happened");

    await expect(
      crash.getByTestId("exception-crash-point-function"),
    ).toBeVisible();

    const [cardBox, frameBox] = await boxesInOneFrame([
      crash,
      crash.getByTestId("exception-crash-point-frame"),
    ]);

    expect(frameBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
    expect(frameBox!.x + frameBox!.width).toBeLessThanOrEqual(
      cardBox!.x + cardBox!.width + 0.5,
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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

    await expect(stack).toContainText(
      "10 frames · 3 in your code · 3 source mapped",
    );
    await expect(page.getByTestId("stack-trace-headline")).toContainText(
      `${EXCEPTION_TYPE}: Could not reserve 3 units`,
    );
    await expect(page.getByTestId("stack-trace-crash-point")).toContainText(
      "Most likely crash point: InventoryService.reserveInventory",
    );

    const crashFrame: Locator = page.locator(
      "[data-testid='stack-frame'][data-frame-index='0']",
    );
    await expect(crashFrame.getByRole("button").first()).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      crashFrame.getByTestId("stack-frame-badge-crash"),
    ).toBeVisible();
    await expect(
      crashFrame.getByTestId("stack-frame-badge-mapped"),
    ).toBeVisible();
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
      page.locator(
        "[data-frame-index='3'] [data-testid='stack-frame-badge-origin']",
      ),
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

  test("the raw tab shows every line and can wrap them", async ({
    page,
  }: {
    page: Page;
  }) => {
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

    await expect(card(page, "Stack Trace")).toContainText(
      "10 frames · 3 in your code",
    );
    await expect(page.getByTestId("stack-frame-badge-mapped")).toHaveCount(0);
    await expect(
      page.locator(
        "[data-frame-index='0'] [data-testid='stack-frame-function']",
      ),
    ).toHaveText("reserveInventory");
  });

  test("without parsed frames the raw trace is the page", async ({
    page,
  }: {
    page: Page;
  }) => {
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
    // Neither explorer can narrow to one exception, so no pivot promises to.
    await expect(
      page.getByRole("button", { name: "View logs for this scope" }),
    ).toBeHidden();

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

    /*
     * The list's total is counted exactly, with the list's own query, so it
     * counts this exception's spans and no others (issue #4202).
     */
    await expect(page.getByTestId(RESULT_TOTAL_TEST_ID)).toHaveText("24 spans");
    const spanCount: RecordedCountRequest | undefined = (
      await fixture(page)
    ).analyticsCountRequests.find((request: RecordedCountRequest) => {
      return Boolean(request.query["exceptionScope"]);
    });
    expect(spanCount?.exact).toBe(true);
    expect(spanCount?.query["exceptionScope"]).toEqual({
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
    await expect(
      page.getByText("Showing 1-10 of 24 occurrences"),
    ).toBeVisible();
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
    await expect(page.getByRole("button", { name: "Show Logs" })).toHaveCount(
      0,
    );

    const breadcrumbs: Locator = card(page, "Breadcrumbs");
    await expect(breadcrumbs).toContainText(
      "8 events in the 880 ms before the exception",
    );
    const rows: Locator = breadcrumbs.getByTestId("breadcrumb-row");
    await expect(rows).toHaveCount(7);
    await expect(rows.last()).toHaveAttribute("data-category", "EXCEPTION");
    await expect(rows.first().getByTestId("breadcrumb-time")).toHaveText(
      "-880 ms",
    );

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
    await expect(
      rows.nth(5).getByTestId("breadcrumb-attributes"),
    ).toContainText("http.status_code");

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
    await expect(
      page.getByTestId("exception-logs-scope-trace"),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByText(
        "stock version changed for SKU-4821 (expected 41, got 42)",
      ),
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
    // The total counts the trace's logs, with the list's own query.
    await expect(page.getByTestId(RESULT_TOTAL_TEST_ID)).toHaveText("4 logs");

    await screenshot(page, "logs");

    await page.getByTestId("exception-logs-scope-service").click();
    await expect(
      page.getByTestId("exception-logs-scope-description"),
    ).toContainText("Everything this service logged");
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
    // And then everything the service logged around it.
    await expect(page.getByTestId(RESULT_TOTAL_TEST_ID)).toHaveText("5 logs");
  });

  test("an occurrence without a trace goes straight to the service's logs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/logs", "occurrence=no-trace");

    await expect(page.getByTestId("exception-logs-scope")).toHaveCount(0);
    await expect(
      page.getByTestId("exception-logs-scope-description"),
    ).toContainText("Everything this service logged");
  });

  test("with no occurrence there is nothing to correlate", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/logs", "occurrence=none");

    await expect(page.getByTestId("exception-logs-empty")).toBeVisible();
  });
});

/*
 * "Why not just one?" - the maintainer, of three AI tasks side by side. The
 * page leads with one, Fix with AI: a fix of the code, or - for an exception
 * OneUptime AI's triage found to be an expected error - better handling of
 * it. The other two wait folded under it, as Other AI tasks.
 */
test.describe("Fix with AI", () => {
  function otherTasksToggle(page: Page): Locator {
    return page
      .getByTestId("exception-ai-other-tasks")
      .getByTestId("folded-section-header");
  }

  test("leads with Fix with AI, which fixes the code after confirmation and opens the task", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/ai-assistance");

    await expect(page.getByTestId("exception-ai-ready")).toBeVisible();
    const fix: Locator = page.getByTestId("exception-ai-task-FixException");

    await expect(fix).toHaveAttribute("data-primary", "true");
    await expect(
      fix.getByRole("heading", { name: "Fix with AI", exact: true }),
    ).toBeVisible();
    await expect(fix.getByTestId("exception-ai-task-description")).toHaveText(
      "OneUptime AI finds the root cause of this exception in your code, fixes it, and opens a pull request for you to review.",
    );
    // How it works, in three steps, over the line saying AI is ready.
    const howItWorks: Locator = fix.getByTestId("exception-ai-how-it-works");

    await expect(
      howItWorks.locator("ol").first().locator(":scope > li"),
    ).toHaveCount(3);
    await expect(howItWorks).toContainText(
      "Reads the stack trace and finds the code that threw it.",
    );
    await expect(howItWorks).toContainText(
      "Opens a pull request for you to review. Nothing changes until you merge it.",
    );
    // One button to press: the rest wait folded, out of sight.
    await expect(
      page.locator("[data-testid='exception-ai-task-start']:visible"),
    ).toHaveCount(1);
    await expect(otherTasksToggle(page)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await screenshot(page, "ai-assistance-ready");

    const start: Locator = fix.getByTestId("exception-ai-task-start");

    await expect(start).toHaveText("Fix with AI");
    await start.click();

    const modal: Locator = page.getByTestId("modal");
    await expect(
      modal.getByRole("heading", { name: "Fix with AI", exact: true }),
    ).toBeVisible();
    await modal.getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("ai-task-page")).toHaveText(
      TASK_IDS["FixException"]!,
    );
    // A fix of the code is the server's default task: the request names none.
    expect((await fixture(page)).createdTasks).toEqual([{}]);
  });

  test("the other tasks wait folded under it, and start the same way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/ai-assistance");

    const toggle: Locator = otherTasksToggle(page);

    await expect(toggle).toContainText("Other AI tasks");
    await expect(
      page.getByTestId("exception-ai-task-WriteRegressionTest"),
    ).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const handling: Locator = page.getByTestId(
      "exception-ai-task-ImproveExceptionHandling",
    );
    const regression: Locator = page.getByTestId(
      "exception-ai-task-WriteRegressionTest",
    );

    await expect(handling).toContainText("Handle the error better");
    await expect(regression).toContainText("Write a regression test");
    await expect(regression).toContainText("It does not fix the bug");

    await screenshot(page, "ai-assistance-other-tasks");

    const start: Locator = regression.getByTestId("exception-ai-task-start");

    await expect(start).toHaveText("Start");
    await start.click();

    const modal: Locator = page.getByTestId("modal");
    await expect(
      modal.getByRole("heading", { name: "Write a regression test" }),
    ).toBeVisible();
    await modal.getByTestId("modal-footer-submit-button").click();

    await expect(page.getByTestId("ai-task-page")).toHaveText(
      TASK_IDS["WriteRegressionTest"]!,
    );
    expect((await fixture(page)).createdTasks).toEqual([
      { taskType: "WriteRegressionTest" },
    ]);
  });

  test("for an expected error, Fix with AI handles it better, and a fix of the code waits folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/ai-assistance", "errorClass=user-error");

    const handling: Locator = page.getByTestId(
      "exception-ai-task-ImproveExceptionHandling",
    );

    await expect(handling).toHaveAttribute("data-primary", "true");
    await expect(
      handling.getByRole("heading", { name: "Fix with AI", exact: true }),
    ).toBeVisible();
    await expect(
      handling.getByTestId("exception-ai-task-description"),
    ).toContainText("OneUptime AI found this is an expected error");

    await otherTasksToggle(page).click();
    await expect(
      page.getByTestId("exception-ai-task-FixException"),
    ).toContainText("Fix the code");
    await expect(
      page.getByTestId("exception-ai-task-FixException"),
    ).not.toHaveAttribute("data-primary", "true");

    await handling.getByTestId("exception-ai-task-start").click();
    await page
      .getByTestId("modal")
      .getByTestId("modal-footer-submit-button")
      .click();

    await expect(page.getByTestId("ai-task-page")).toHaveText(
      TASK_IDS["ImproveExceptionHandling"]!,
    );
    expect((await fixture(page)).createdTasks).toEqual([
      { taskType: "ImproveExceptionHandling" },
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
    await expect(
      page.getByTestId("exception-ai-readiness-progress"),
    ).toHaveText("1 of 3 ready");
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

  test("each task card reflects its latest run", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/ai-assistance", "ai=mixed");

    const fix: Locator = page.getByTestId("exception-ai-task-FixException");
    const regression: Locator = page.getByTestId(
      "exception-ai-task-WriteRegressionTest",
    );
    const handling: Locator = page.getByTestId(
      "exception-ai-task-ImproveExceptionHandling",
    );

    await expect(fix.getByTestId("exception-ai-task-status")).toHaveText(
      "Completed",
    );
    await expect(fix.getByTestId("exception-ai-task-start")).toHaveText(
      "Fix again",
    );
    // Another task has run: the fold is open, so it is seen.
    await expect(otherTasksToggle(page)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(regression.getByTestId("exception-ai-task-status")).toHaveText(
      "Queued",
    );
    await expect(regression.getByTestId("exception-ai-task-start")).toHaveCount(
      0,
    );
    await expect(handling.getByTestId("exception-ai-task-status")).toHaveText(
      "Failed",
    );
    await expect(handling.getByTestId("exception-ai-task-start")).toHaveText(
      "Try again",
    );
    await expect(
      handling.getByTestId("exception-ai-task-message"),
    ).toContainText("The agent stopped responding after 20 minutes.");

    await screenshot(page, "ai-assistance-mixed");
  });

  test("a refused start is explained inline", async ({
    page,
  }: {
    page: Page;
  }) => {
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

  test("with AI switched off: no Fix with AI in the menu, and its page says so, with Turn AI on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "", "enableAi=off");

    // Nothing on it could start: the menu does not offer it.
    await expect(
      sideMenu(page).getByRole("link", { name: "Fix with AI", exact: true }),
    ).toHaveCount(0);
    await expect(sideMenuSectionToggle(page, "Resolve")).toHaveCount(0);

    // A link that still leads there says why, with the one step to take.
    await open(page, "/ai-assistance", "enableAi=off");
    const notice: Locator = page.getByTestId("exception-ai-off");
    await expect(notice).toContainText("AI is turned off for this project.");
    await expect(
      notice.getByRole("link", { name: "Turn AI on" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/settings/ai-features`);
    await expect(
      page.getByTestId("exception-ai-task-FixException"),
    ).toHaveCount(0);
    await expect(page.getByTestId("exception-ai-task-start")).toHaveCount(0);
    await screenshot(page, "ai-assistance-ai-off");
  });

  test("a resolved exception pauses AI tasks", async ({
    page,
  }: {
    page: Page;
  }) => {
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
    await expect(
      page.getByTestId("exception-settings-archive-history"),
    ).toHaveText("Archived 1 day ago by Priya Raman");

    await screenshot(page, "settings");

    await page.getByTestId("exception-settings-unresolve").click();
    await expect(
      page.getByTestId("exception-settings-resolution-state"),
    ).toHaveText("Unresolved");
    await expect(page.getByTestId("exception-summary-status")).toHaveText(
      "Archived",
    );

    await page.getByTestId("exception-settings-unarchive").click();
    await expect(
      page.getByTestId("exception-settings-archive-state"),
    ).toHaveText("Not archived");
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

/*
 * Create monitor on an exception's page: an Exceptions monitor for this
 * exception's type in its service (TelemetryMonitorLink), beside Resolve
 * and Archive. With three buttons, the header puts them beside the
 * exception only when the card itself is wide enough (a container query):
 * from lg up beside the side menu they left the message a word a line at
 * 1024px.
 */
/*
 * "There are so many buttons in the header" - the maintainer. The header
 * keeps two: Resolve (or Reopen) and Archive (or Unarchive). What an
 * exception takes now and then - Resolve in next release, Create monitor -
 * waits in its ⋯, and who it is assigned to is one of its facts.
 */
test.describe("the header's actions", () => {
  test("are two buttons and a ⋯, which holds Create monitor, leading to an Exceptions monitor for this type in its service", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");

    const actions: Locator = page.getByTestId("exception-summary-actions");

    await expect(
      actions.getByTestId("exception-summary-buttons").getByRole("button"),
    ).toHaveText(["Resolve", "Archive"]);
    await expect(actions.getByTestId("exception-create-monitor")).toHaveCount(
      0,
    );

    await actions.getByTestId("exception-more-actions").click();

    const menu: Locator = page.getByRole("menu");

    await expect(menu.getByRole("menuitem")).toHaveText([
      "Resolve in next release",
      "Create monitor",
    ]);
    await screenshot(page, "exception-header-more");

    await menu.getByTestId("exception-create-monitor").click();
    await page.waitForURL(
      (url: URL): boolean => {
        return url.pathname === `/dashboard/${PROJECT_ID}/monitors/create`;
      },
      { timeout: 30000 },
    );

    const link: URL = new URL(page.url());
    expect(link.searchParams.get("monitorType")).toBe("Exceptions");
    expect(JSON.parse(link.searchParams.get("telemetryQuery") || "{}")).toEqual(
      {
        serviceIds: [SERVICE_ID],
        exceptionTypes: [EXCEPTION_TYPE],
      },
    );
  });

  test("Resolve in next release, from the ⋯, resolves it for occurrences after the release it was last seen in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");

    await page
      .getByTestId("exception-summary-actions")
      .getByTestId("exception-more-actions")
      .click();
    await page
      .getByRole("menu")
      .getByTestId("exception-triage-resolve-next-release")
      .click();

    await expect(page.getByTestId("exception-summary-status")).toHaveText(
      "Resolved",
    );

    const update: RecordedUpdate | undefined = (
      await fixture(page)
    ).updates.find((each: RecordedUpdate) => {
      return each.modelName === "TelemetryException";
    });

    expect(update?.data).toMatchObject({
      isResolved: true,
      resolvedInReleaseAfter: "checkout-api@2026.09.14",
    });
  });

  test("who it is assigned to is one of the header's facts, not a button among the actions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");

    const fact: Locator = page.getByTestId("exception-summary-stat-assignee");

    await expect(fact).toContainText("Assignee");
    await expect(fact.getByTestId("exception-assignee-assign")).toHaveText(
      "Assign",
    );
    await expect(
      page
        .getByTestId("exception-summary-actions")
        .getByTestId("exception-assignee"),
    ).toHaveCount(0);
  });

  /*
   * Two buttons and a ⋯ fit beside the pills on a desktop's header, beside
   * the side menu: the header works out the width they need from their
   * words (data-actions-beside-from) and puts them under the title on a
   * narrower one. The message keeps a reading width at every width.
   */
  test("sit beside the pills on a header wide enough for them, under the title on a narrower one, and the message stays readable", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, "", "exception=long");

      const header: Locator = page.getByTestId("exception-summary");
      const from: string | null = await header.getAttribute(
        "data-actions-beside-from",
      );

      expect(from, `where the actions go at ${width}px`).toMatch(/^\d+rem$/);

      const headerWidth: number = await header.evaluate(
        (element: Element): number => {
          return (element as HTMLElement).clientWidth;
        },
      );
      const isBeside: boolean =
        headerWidth >= Number((from || "").replace("rem", "")) * 16;
      const [pills, title, actions, message] = await boxesInOneFrame([
        page.getByTestId("exception-summary-pills"),
        page.getByTestId("exception-summary-type"),
        page.getByTestId("exception-summary-actions"),
        page.getByTestId("exception-summary-message"),
      ]);

      if (width >= 1280) {
        // A desktop's header holds them beside the pills.
        expect([width, isBeside]).toEqual([width, true]);
      }

      if (isBeside) {
        // On the pills' line, after them; the title under both.
        expect(
          actions!.x,
          `the actions after the pills at ${width}px`,
        ).toBeGreaterThan(pills!.x + pills!.width);
        expect(
          actions!.y,
          `the actions above the title at ${width}px`,
        ).toBeLessThan(title!.y);
      } else {
        expect(
          actions!.y,
          `the actions under the title at ${width}px`,
        ).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
      }

      if (width >= 1024) {
        // Never a word a line: the message keeps a reading width.
        expect(
          message!.width,
          `the message's width at ${width}px`,
        ).toBeGreaterThan(420);
      }

      await expectNoSidewaysScroll(page, { tolerance: 1 });
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, "");
    await screenshot(page, "exception-header-1440");
    await page.setViewportSize({ width: 1024, height: 1000 });
    await screenshot(page, "exception-header-1024");
  });
});
