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
 * "USED BY" ON THE REAL ON-CALL SCHEDULE OVERVIEW (#7438).
 *
 * A schedule's Overview says which on-call policies page whoever is on call
 * on it, and which escalation rules of each do, in the order they escalate -
 * each policy a link to its Escalation Rules page, where those rules are
 * (#9701), and a policy the member may not see counted, never named
 * (UsedByService, #6813). Nothing paging it, the card says nobody on it is
 * paged and where to add it. The fixture answers GET
 * /used-by/on-call-schedule/:id as UsedByService does (?usedBy=used); the
 * card's rules are held by jsdom (Common/Tests/App/Dashboard/
 * UsedByCard.test.tsx). Checked at 1280 and 390, light and dark, in German
 * and in Persian; screenshots go to output/playwright/owner-filters-ui.
 */

const PORT: string = process.env["OWNER_FILTERS_FIXTURE_PORT"] || "4481";
const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f1";
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
// Payments Primary, the fixture's first schedule.
const SCHEDULE_ID: string = "60000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/owner-filters-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();

test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture: a request to a real host is a test bug.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  // Every read the page made is one the fixture answers as the API does.
  expect(
    await page.evaluate((): Array<unknown> => {
      return (window as unknown as { __fixture: { unhandled: Array<unknown> } })
        .__fixture.unhandled;
    }),
  ).toEqual([]);
});

async function open(
  page: Page,
  options: {
    usedBy?: "used";
    theme?: "dark";
    lang?: "de" | "fa";
    width?: number;
  } = {},
): Promise<Locator> {
  const width: number = options.width || 1280;
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const query: URLSearchParams = new URLSearchParams();
  for (const key of ["usedBy", "theme", "lang"] as const) {
    if (options[key]) {
      query.set(key, options[key] as string);
    }
  }
  await page.goto(
    `${DASHBOARD}/on-call-duty/schedules/${SCHEDULE_ID}?${query}`,
  );
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  const card: Locator = page.getByTestId("used-by-card");
  // The first load parses a large bundle.
  await expect(card).toBeVisible({ timeout: 60000 });
  await expect(card.getByTestId("used-by-loading")).toHaveCount(0, {
    timeout: 30000,
  });
  return card;
}

// The card's frame: the Card around the card's body.
function frame(card: Locator): Locator {
  return card.locator("xpath=ancestor::*[@data-testid='card'][1]");
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box as Box;
}

async function shoot(locator: Locator, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    path: path.join(SCREENSHOTS, `schedule-used-by-${name}.png`),
  });
}

test.describe("Used by on the on-call schedule overview", () => {
  test("names the policies that page it and their escalation rules, and counts the one the member may not see", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page, { usedBy: "used" });
    const groups: Locator = card.getByTestId("used-by-group");

    await expect(frame(card)).toContainText("Used by");
    await expect(groups).toHaveCount(1);
    await expect(groups).toHaveAttribute(
      "data-relation",
      "ScheduleOnCallPolicies",
    );
    await expect(groups).toContainText("On-call policies that page it");
    await expect(groups.getByTestId("used-by-count")).toHaveText("2");

    // Each policy, then the escalation rules of it that page the schedule.
    const rows: Locator = groups.getByTestId("used-by-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByRole("link")).toHaveText("Payments on-call");
    await expect(rows.nth(0).getByTestId("used-by-row-detail")).toHaveText(
      "Primary, Second line",
    );
    await expect(rows.nth(1).getByTestId("used-by-row-detail")).toHaveText(
      "Night cover",
    );
    // A policy opens on its Escalation Rules, the rules its line names (#9701).
    await expect(rows.nth(0).getByRole("link")).toHaveAttribute(
      "href",
      `${DASHBOARD}/on-call-duty/policies/a1000000-0000-4000-8000-000000000001/escalation`,
    );
    await expect(groups.getByTestId("used-by-hidden")).toHaveText(
      "and 1 you can't see",
    );

    await shoot(frame(card), "1280");
  });

  test("nothing pages it: the card says nobody on it is paged, and where to add it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await open(page);
    const empty: Locator = card.getByTestId("used-by-empty");

    await expect(empty).toContainText("Nothing uses this schedule yet");
    await expect(empty).toContainText(
      "No on-call policy pages it, so nobody on it is paged.",
    );
    await expect(card.getByTestId("used-by-empty-action")).toHaveAttribute(
      "href",
      `${DASHBOARD}/on-call-duty/policies`,
    );
    await shoot(frame(card), "empty-1280");
  });

  test("reads in the dark theme, and fits a phone with no sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    const wide: Locator = await open(page, { usedBy: "used", theme: "dark" });

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(wide.getByTestId("used-by-row")).toHaveCount(2);
    await shoot(frame(wide), "1280-dark");

    const phone: Locator = await open(page, { usedBy: "used", width: 390 });

    await expect(phone.getByTestId("used-by-row")).toHaveCount(2);
    await expectNoSidewaysScroll(page);
    await shoot(frame(phone), "390");

    const darkPhone: Locator = await open(page, {
      usedBy: "used",
      width: 390,
      theme: "dark",
    });

    await expect(darkPhone.getByTestId("used-by-row")).toHaveCount(2);
    await expectNoSidewaysScroll(page);
    await shoot(frame(darkPhone), "390-dark");
  });

  test("reads in German and Persian", async ({ page }: { page: Page }) => {
    const german: Locator = await open(page, { usedBy: "used", lang: "de" });

    await expect(frame(german)).toContainText("Verwendet von");
    await expect(german.getByTestId("used-by-group")).toContainText(
      "Alarmierende Bereitschaftsrichtlinien",
    );
    await expect(german.getByTestId("used-by-hidden")).toHaveText(
      "und 1 für Sie nicht sichtbar",
    );
    // A rule's name is the project's own: never translated.
    await expect(german.getByTestId("used-by-row-detail").first()).toHaveText(
      "Primary, Second line",
    );
    await shoot(frame(german), "de-1280");

    const persian: Locator = await open(page, {
      usedBy: "used",
      lang: "fa",
      width: 390,
    });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(frame(persian)).toContainText("استفاده‌شده توسط");
    await expect(persian.getByTestId("used-by-group")).toContainText(
      "سیاست‌های آنکالی که آن را فرا می‌خوانند",
    );

    /*
     * A policy's rules sit under its name, on the page's side, though both
     * are named in Latin letters: each reads left to right, both end at
     * the right.
     */
    const firstRow: Locator = persian.getByTestId("used-by-row").first();
    const name: Box = await boxOf(firstRow.getByRole("link"));
    const detail: Box = await boxOf(
      firstRow.getByTestId("used-by-row-detail").locator("span"),
    );
    expect(
      Math.abs(name.x + name.width - (detail.x + detail.width)),
    ).toBeLessThan(1);

    await expectNoSidewaysScroll(page);
    await shoot(frame(persian), "fa-390");
  });
});
