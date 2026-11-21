import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * DATA SECURITY → AI (#10364) in a browser, against the offline fixture
 * (Fixture/Fixture.js, ?ai=on): what OneUptime AI proposes for the issues,
 * what it made without asking and the issues it left alone, under the AI
 * notice and its one switch.
 *
 *   - at 1280, beside the side menu: the switch first, then Waiting for
 *     you, Done by AI and Why AI did not act, every list inside its card,
 *     and AI's amber count of what waits in the menu;
 *   - Approve opens the change before it is made - what will change, why,
 *     how it is proven, how to undo it and why it asks - and the made
 *     change leaves the list;
 *   - on a phone (390), each row is a card that keeps its title and its
 *     button, and nothing scrolls sideways;
 *   - a Security Viewer's press is refused in the dialog, in the server's
 *     words, and the proposal still waits.
 */

const PORT: string = process.env["DATA_SECURITY_FIXTURE_PORT"] || "4255";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const AI_PAGE: string = `/dashboard/${PROJECT_ID}/data-security/ai`;

const WAITING_PROPOSAL: string = "1d000000-0000-4000-8000-000000000001";
const WAITING_TITLE: string =
  "Scrub Email address in log.body of checkout · Logs";
const MADE_TITLE: string = "Scrub Phone number in log.body of checkout · Logs";
const EMAIL_IN_LOGS_ISSUE: string = "30000000-0000-4000-8000-000000000003";
const OVERVIEW: string = `/dashboard/${PROJECT_ID}/data-security`;
// The database's issue, which no Data Security AI rule matches.
const LEFT_ALONE_ISSUE_TITLE: string = "Its data is not encrypted at rest";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/data-security-ui",
);

const LAPTOP: number = 1280;
const PHONE: number = 390;

interface FixtureState {
  apiRequests: Array<{ method: string; url: string; body: unknown }>;
  unhandled: Array<unknown>;
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

async function open(
  page: Page,
  options: {
    width?: number;
    role?: "owner" | "viewer";
    // Another Data Security page than Data Security → AI.
    pathname?: string;
  } = {},
): Promise<void> {
  await page.setViewportSize({ width: options.width || LAPTOP, height: 1000 });
  await page.clock.setFixedTime(NOW);
  const params: URLSearchParams = new URLSearchParams();
  params.set("ai", "on");
  if (options.role && options.role !== "owner") {
    params.set("role", options.role);
  }
  await page.goto(`${options.pathname || AI_PAGE}?${params.toString()}`);
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

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  // A dialog or a menu grows in over 150ms: read boxes once it is at rest.
  await page.waitForTimeout(300);
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

// A card of the page, by its title.
function card(page: Page, title: string): Locator {
  return page
    .getByTestId("card")
    .filter({
      has: page.getByTestId("card-details-heading").getByText(title, {
        exact: true,
      }),
    })
    .first();
}

// How far each list runs past its card, in pixels: none should.
async function listOverflows(page: Page): Promise<Array<number>> {
  return page.evaluate((): Array<number> => {
    return Array.from(document.querySelectorAll("table")).map(
      (table: HTMLTableElement): number => {
        const holder: HTMLElement | null = table.closest(
          '[data-testid="card"]',
        );

        if (!holder) {
          return 0;
        }

        return Math.max(
          0,
          Math.round(
            table.getBoundingClientRect().right -
              holder.getBoundingClientRect().right,
          ),
        );
      },
    );
  });
}

test.describe("Data Security → AI", () => {
  test("at 1280: the switch, then what waits, what was made and what was left alone, each list inside its card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await expect(page.getByTestId("data-security-ai-switches")).toContainText(
      "Work on new issues",
    );

    const headings: Array<string> = (
      await page.getByTestId("card-details-heading").allInnerTexts()
    ).map((text: string): string => {
      return text.trim();
    });

    expect(
      headings.filter((title: string): boolean => {
        return [
          "What OneUptime AI does",
          "Waiting for you",
          "Done by AI",
          "Why AI did not act",
        ].includes(title);
      }),
    ).toEqual([
      "What OneUptime AI does",
      "Waiting for you",
      "Done by AI",
      "Why AI did not act",
    ]);

    await expect(card(page, "Waiting for you")).toContainText(WAITING_TITLE);
    // Which rule decided it, by its name.
    await expect(card(page, "Waiting for you")).toContainText(
      "Production stores",
    );
    await expect(card(page, "Done by AI")).toContainText(MADE_TITLE);
    // The AI rules, each with what every kind of work may do.
    await expect(card(page, "AI Rules")).toContainText("Production stores");
    await expect(card(page, "AI Rules")).toContainText(
      "Analyze: Without asking",
    );
    await expect(card(page, "Why AI did not act")).toContainText(
      "No Data Security AI rule matches this issue.",
    );
    await expect(card(page, "Why AI did not act")).toContainText(
      LEFT_ALONE_ISSUE_TITLE,
    );

    // The menu counts what waits beside AI.
    const menuEntry: Locator = page
      .getByRole("link", { name: /^AI/ })
      .filter({ has: page.locator("span.rounded-full") })
      .first();
    await expect(menuEntry).toContainText("1");

    await settle(page);
    const overflows: Array<number> = await listOverflows(page);
    expect(overflows.length).toBeGreaterThanOrEqual(3);
    expect(overflows).toEqual(
      overflows.map((): number => {
        return 0;
      }),
    );
    await expectNoSidewaysScroll(page);

    await screenshot(page, "ai-inbox-1280");
  });

  test("Approve shows the change before it is made, and the made change leaves the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const waiting: Locator = card(page, "Waiting for you");
    await expect(waiting).toContainText(WAITING_TITLE);

    await waiting.getByRole("button", { name: "Approve" }).first().click();

    const review: Locator = page.getByTestId(
      "data-security-ai-proposal-review",
    );
    await expect(review).toBeVisible();

    for (const heading of [
      "What Will Change",
      "Why",
      "How It Is Proven",
      "How to Undo It",
      "Why It Asks",
    ]) {
      await expect(
        review.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }

    await expect(review).toContainText(
      "Out of the box, a change is made without asking only once it is proven safe, and this one is not.",
    );

    await settle(page);
    await screenshot(page, "ai-inbox-approve-1280");

    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Approve", exact: true })
      .click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(waiting).toContainText("No proposals waiting yet");

    const approvals: Array<{ method: string; url: string }> = (
      await fixture(page)
    ).apiRequests.filter((request: { method: string; url: string }) => {
      return request.url.endsWith(
        `/data-security-ai-proposal/${WAITING_PROPOSAL}/approve`,
      );
    });
    expect(approvals).toHaveLength(1);
  });

  test("on a phone, each row is a card with its title and its button, and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: PHONE });

    const waiting: Locator = card(page, "Waiting for you");
    await expect(waiting).toContainText(WAITING_TITLE);
    await expect(
      waiting.getByRole("button", { name: "Approve" }).first(),
    ).toBeVisible();
    await expect(card(page, "Done by AI")).toContainText(MADE_TITLE);
    await expect(
      card(page, "Done by AI").getByRole("button", { name: "Undo" }).first(),
    ).toBeVisible();

    await settle(page);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ai-inbox-390");
  });

  test("an issue's OneUptime AI card sits above How to Fix, with the proposal and its Approve", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, {
      pathname: `/dashboard/${PROJECT_ID}/data-security/issues/${EMAIL_IN_LOGS_ISSUE}`,
    });

    const aiCard: Locator = page.getByTestId("data-security-issue-ai-card");
    await expect(aiCard).toContainText(WAITING_TITLE);
    await expect(aiCard).toContainText("Waiting for you");
    await expect(
      aiCard.getByRole("button", { name: "Approve", exact: true }),
    ).toBeVisible();

    const aiTop: number = (await aiCard.boundingBox())!.y;
    const fixTop: number = (await card(page, "How to Fix").boundingBox())!.y;
    expect(aiTop).toBeLessThan(fixTop);

    await settle(page);
    await screenshot(page, "ai-issue-card-1280");
  });

  test("on a phone, the issue's AI card gives each proposal's title its own row, with its buttons under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, {
      width: PHONE,
      pathname: `/dashboard/${PROJECT_ID}/data-security/issues/${EMAIL_IN_LOGS_ISSUE}`,
    });

    const aiCard: Locator = page.getByTestId("data-security-issue-ai-card");
    const title: Locator = aiCard.getByText(WAITING_TITLE, { exact: true });
    const approve: Locator = aiCard.getByRole("button", {
      name: "Approve",
      exact: true,
    });
    await expect(approve).toBeVisible();
    await settle(page);

    const titleBox: { y: number; height: number; width: number } =
      (await title.boundingBox())!;
    const approveTop: number = (await approve.boundingBox())!.y;
    const cardWidth: number = (await aiCard.boundingBox())!.width;

    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(approveTop + 1);
    // The title is not squeezed beside its buttons: it reads in a line or two.
    expect(titleBox.width).toBeGreaterThan(cardWidth * 0.6);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ai-issue-card-390");
  });

  test("the Overview says what OneUptime AI contained this week and what waits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { pathname: OVERVIEW });

    const line: Locator = page.getByTestId("data-security-ai-overview-line");
    await expect(line).toContainText(
      "OneUptime AI contained 1 leak this week. 1 proposal waits for you.",
    );
    await expect(line.getByRole("link")).toHaveAttribute("href", AI_PAGE);
  });

  test("a Security Viewer's Approve is refused in the dialog, in the server's words, and the proposal still waits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { role: "viewer" });

    const waiting: Locator = card(page, "Waiting for you");
    await expect(waiting).toContainText(WAITING_TITLE);

    await waiting.getByRole("button", { name: "Approve" }).first().click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Approve", exact: true })
      .click();

    await expect(page.getByRole("dialog")).toContainText(
      "You do not have permission to do this in Data Security.",
    );

    await page.keyboard.press("Escape");
    await expect(waiting).toContainText(WAITING_TITLE);
  });
});
