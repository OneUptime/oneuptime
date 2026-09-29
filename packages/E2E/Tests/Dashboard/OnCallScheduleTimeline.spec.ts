import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  APIRequestContext,
  APIResponse,
  Browser,
  Locator,
  Page,
  expect,
  request as playwrightRequest,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { buildUrl, createItem, JSONish, toId } from "./Helpers/MonitorAlerting";

/*
 * On-call schedule timeline, end to end: every schedule in the project side
 * by side on one week/month grid.
 *
 * The page had unit coverage only. This spec drives it against a real stack:
 * the empty state of a fresh project, schedules created through the API
 * showing up as rows in name order, the week/month switch and the range
 * navigation, the search filter, the row link to the schedule itself, and the
 * JSON endpoint behind it - including that a caller with no session is told
 * to authenticate (401) rather than handed a 4xx the client cannot recover
 * from.
 *
 * Anti-flake notes:
 * - run-unique schedule names, so a re-run never matches leftover rows
 * - no assertion depends on who is on call: the schedules have no layers, so
 *   nothing a background job computes is on the critical path
 * - chromium only: this is server behaviour and one grid, not engine quirks
 *
 * To run locally against a full stack:
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/OnCallScheduleTimeline.spec.ts --project=chromium
 */

interface Ctx {
  page: Page;
  projectId: string;
  alphaName: string;
  alphaId: string;
  bravoName: string;
  bravoId: string;
}

const ctx: Ctx = {
  page: null as unknown as Page,
  projectId: "",
  alphaName: "",
  alphaId: "",
  bravoName: "",
  bravoId: "",
};

const timelineUrl: () => string = (): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${ctx.projectId}/on-call-duty/schedule-timeline`)
    .toString();
};

const timelineApiPath: (from: Date, to: Date) => string = (
  from: Date,
  to: Date,
): string => {
  const params: URLSearchParams = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });

  return `/api/on-call-schedule-timeline?${params.toString()}`;
};

test.describe.configure({ mode: "serial" });

test.describe("On-call schedule timeline", () => {
  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "server behaviour and a single grid, one engine is enough");

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);

    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "Schedule Timeline E2E",
      // On-call schedules are a Growth feature when billing is on.
      preferredPlanName: IS_BILLING_ENABLED ? "Growth" : undefined,
    });

    const unique: string = Faker.generateName().toString().replace(/\s/g, "");
    ctx.alphaName = `Alpha rotation ${unique}`;
    ctx.bravoName = `Bravo rotation ${unique}`;
  });

  test.afterAll(async () => {
    await ctx.page?.close();
  });

  test("a project with no schedules shows the empty state", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: timelineUrl(),
      ready: page.getByText("No on-call schedules yet"),
    });

    await expect(page.getByTestId("timeline-schedule-row")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Go to On-Call Schedules" }),
    ).toBeVisible();
  });

  test("schedules created in the project appear as rows, in name order", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    // Created out of order: the timeline sorts by name, not by creation.
    const bravo: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/on-call-duty-policy-schedule",
      item: {
        name: ctx.bravoName,
        description: "Created by OnCallScheduleTimeline.spec.ts",
        projectId: ctx.projectId,
      },
    });
    const alpha: JSONish = await createItem({
      page,
      projectId: ctx.projectId,
      path: "/api/on-call-duty-policy-schedule",
      item: {
        name: ctx.alphaName,
        description: "Created by OnCallScheduleTimeline.spec.ts",
        projectId: ctx.projectId,
      },
    });

    ctx.alphaId = toId(alpha["_id"]);
    ctx.bravoId = toId(bravo["_id"]);
    expect(ctx.alphaId, "alpha schedule should have been created").not.toBe("");
    expect(ctx.bravoId, "bravo schedule should have been created").not.toBe("");

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: timelineUrl(),
      ready: page.getByTestId("schedule-timeline-grid"),
    });

    const rows: Locator = page.getByTestId("timeline-schedule-row");
    await expect(rows).toHaveCount(2, { timeout: 60000 });
    await expect(rows.nth(0)).toHaveAttribute("data-schedule-id", ctx.alphaId);
    await expect(rows.nth(1)).toHaveAttribute("data-schedule-id", ctx.bravoId);
    await expect(rows.nth(0)).toContainText(ctx.alphaName);
    await expect(rows.nth(1)).toContainText(ctx.bravoName);

    await expect(page.getByText("No on-call schedules yet")).toHaveCount(0);
  });

  test("switches between a week and a month and moves through time", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const weekButton: Locator = page.getByTestId("timeline-mode-week");
    const monthButton: Locator = page.getByTestId("timeline-mode-month");
    const rangeLabel: Locator = page.getByTestId("timeline-range-label");
    const dayHeaders: Locator = page.getByTestId("timeline-day-header");

    // Week view: seven day columns.
    if ((await weekButton.getAttribute("aria-checked")) !== "true") {
      await weekButton.click();
    }
    await expect(weekButton).toHaveAttribute("aria-checked", "true");
    await expect(dayHeaders).toHaveCount(7);

    const thisWeek: string = (await rangeLabel.textContent()) || "";
    expect(thisWeek.trim()).not.toBe("");

    // Next and back again, via Today.
    await page.getByTestId("timeline-next-button").click();
    await expect(rangeLabel).not.toHaveText(thisWeek);
    await page.getByTestId("timeline-today-button").click();
    await expect(rangeLabel).toHaveText(thisWeek);

    // Month view: every day of the month, and the rows are still there.
    await monthButton.click();
    await expect(monthButton).toHaveAttribute("aria-checked", "true");
    await expect(weekButton).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(
        async () => {
          return await dayHeaders.count();
        },
        { timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(28);
    expect(await dayHeaders.count()).toBeLessThanOrEqual(31);
    await expect(page.getByTestId("timeline-schedule-row")).toHaveCount(2);

    await weekButton.click();
    await expect(weekButton).toHaveAttribute("aria-checked", "true");
    await expect(dayHeaders).toHaveCount(7);
  });

  test("the search box narrows the rows to matching schedules", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;
    const rows: Locator = page.getByTestId("timeline-schedule-row");
    const search: Locator = page.getByTestId("timeline-search");

    await search.fill(ctx.bravoName);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-schedule-id", ctx.bravoId);

    await search.fill(`no schedule is called this ${Date.now()}`);
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("timeline-no-matches")).toBeVisible();

    await search.fill("");
    await expect(rows).toHaveCount(2);
  });

  test("a row links to its schedule", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    await page
      .getByTestId("timeline-schedule-row")
      .filter({ hasText: ctx.alphaName })
      .getByRole("link", { name: ctx.alphaName })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/on-call-duty/schedules/${ctx.alphaId}`),
      { timeout: 60000 },
    );
  });

  test("the timeline API returns the project's schedules to a member", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const from: Date = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to: Date = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);

    const response: APIResponse = await page.request.get(
      buildUrl(timelineApiPath(from, to)),
      {
        headers: {
          tenantid: ctx.projectId,
          projectid: ctx.projectId,
        },
      },
    );

    expect(response.status(), await response.text()).toBe(200);

    const body: JSONish = (await response.json()) as JSONish;
    const ids: Array<string> = (body["schedules"] as Array<JSONish>).map(
      (schedule: JSONish) => {
        return String(schedule["scheduleId"]);
      },
    );

    expect(ids).toEqual([ctx.alphaId, ctx.bravoId]);
    expect(body["totalScheduleCount"]).toBe(2);
    expect(body["schedulesTruncated"]).toBe(false);
    expect(typeof body["from"]).toBe("string");
    expect(typeof body["to"]).toBe("string");
  });

  test("the timeline API asks a caller with no session to authenticate", async () => {
    test.setTimeout(120000);

    // A fresh context: no cookies, only the tenant header a stale tab sends.
    const anonymous: APIRequestContext = await playwrightRequest.newContext();

    try {
      const from: Date = new Date();
      const to: Date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const response: APIResponse = await anonymous.get(
        buildUrl(timelineApiPath(from, to)),
        {
          headers: {
            tenantid: ctx.projectId,
            projectid: ctx.projectId,
          },
        },
      );

      expect(response.status()).toBe(401);
      expect(await response.text()).not.toContain(ctx.alphaName);
    } finally {
      await anonymous.dispose();
    }
  });
});
