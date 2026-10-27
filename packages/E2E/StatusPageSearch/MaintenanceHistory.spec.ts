import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
// The page's fixture state, as window.__statusPageSearchFixture.
import "./FixtureState";

/*
 * A public status page's 90-day history shows the page's scheduled
 * maintenance (issue #5236), in the real Overview with the overview payload
 * of Fixture.js (?maintenance=1): the days an event touched wear a blue
 * band, their tooltip and day dialog name the event - its window and state
 * - beside the incidents and open the event's page, and a resource under
 * an event in progress says so beside its name. Both projects run it: a
 * laptop and a phone (Pixel 5).
 */

// The maintenance blue (MAINTENANCE_MARK_COLOR) as the browser computes it.
const MAINTENANCE_BLUE: string = "rgb(59, 130, 246)";

// How a bar's accessible name ends on a day with one event.
const ONE_EVENT_LABEL_END: RegExp = /% uptime, 1 scheduled maintenance event$/;

// An event's window, on the reader's clock and naming it: "..., 01:00 – 03:00 UTC".
const WINDOW_ON_THE_READERS_CLOCK: RegExp = /– .*(UTC|GMT)/;

// The completed upgrade's item in the day's dialog: its name starts with the title.
const DATABASE_UPGRADE_BUTTON: RegExp = /Database 0660 upgrade/;

async function openWithMaintenance(page: Page): Promise<void> {
  await page.goto("/?maintenance=1");
  await expect(page.getByTestId("status-page-overview")).toBeVisible();
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(40);
}

// Narrows the page to one resource, so its bars are the only ones drawn.
async function only(page: Page, query: string): Promise<Locator> {
  await page.getByRole("searchbox", { name: "Search resources" }).fill(query);
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(1);
  return page.getByTestId("uptime-bar");
}

// The colour and height of a bar's maintenance band, or null for none.
async function bandOf(
  bar: Locator,
): Promise<{ color: string; height: string } | null> {
  return bar.evaluate(
    (element: Element): { color: string; height: string } | null => {
      const style: CSSStyleDeclaration = window.getComputedStyle(
        element,
        "::before",
      );

      if (!style.content || style.content === "none") {
        return null;
      }

      return { color: style.backgroundColor, height: style.height };
    },
  );
}

test("bands the days a resource's maintenance touched, and names them", async ({
  page,
}: {
  page: Page;
}) => {
  await openWithMaintenance(page);
  const bars: Locator = await only(page, "0660");

  await expect(bars).toHaveCount(91);

  // Two days ago, over the outage: the event's only day.
  const day: Locator = bars.nth(88);
  await expect(day).toHaveAttribute("data-has-maintenance", "true");
  await expect(day).toHaveAttribute("aria-label", ONE_EVENT_LABEL_END);
  expect(await bandOf(day)).toEqual({ color: MAINTENANCE_BLUE, height: "4px" });

  // Every other day of its history is bare.
  await expect(
    page.locator("[data-testid='uptime-bar'][data-has-maintenance='true']"),
  ).toHaveCount(1);
  expect(await bandOf(bars.nth(87))).toBeNull();

  // The day keeps its own colour: the outage's red stays red under the band.
  expect(
    await day.evaluate((element: Element): string => {
      return window.getComputedStyle(element).backgroundColor;
    }),
  ).toBe("rgb(220, 38, 38)");
});

test("a day's tooltip names its maintenance after its incidents, with window and state", async ({
  page,
}: {
  page: Page;
}) => {
  await openWithMaintenance(page);
  const bars: Locator = await only(page, "0660");

  const day: Locator = bars.nth(88);
  await day.scrollIntoViewIfNeeded();
  await day.hover();

  const tooltip: Locator = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Uptime");
  await expect(tooltip).toContainText("Offline");
  await expect(tooltip).toContainText("Scheduled maintenance");
  await expect(tooltip).toContainText("Database 0660 upgrade");
  await expect(tooltip).toContainText("Completed");
  await expect(tooltip).toContainText(WINDOW_ON_THE_READERS_CLOCK);

  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();
});

test("the day dialog lists the maintenance and opens the event's page, from the keyboard too", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openWithMaintenance(page);
  const bars: Locator = await only(page, "0660");

  const day: Locator = bars.nth(88);
  await day.focus();
  await expect(day).toBeFocused();
  await day.press("Enter");

  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Scheduled maintenance" }),
  ).toBeVisible();

  const event: Locator = dialog.getByRole("button", {
    name: DATABASE_UPGRADE_BUTTON,
  });
  await expect(event).toBeVisible();
  await expect(dialog.getByTestId("uptime-day-maintenance-state")).toHaveText(
    "Completed",
  );

  // Nothing in the dialog runs off a phone's screen.
  expect(
    await page.evaluate((): boolean => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
  ).toBe(true);

  await page.screenshot({
    path: testInfo.outputPath("maintenance-day-dialog.png"),
  });

  const ids: Array<string> = await page.evaluate((): Array<string> => {
    return window.__statusPageSearchFixture.maintenanceIds;
  });

  await event.focus();
  await event.press("Enter");

  await expect(page).toHaveURL(
    new RegExp(`/scheduled-events/${escapeRegExp(ids[0]!)}$`),
  );
});

test("a resource under maintenance in progress says so beside its name, and only that one", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openWithMaintenance(page);

  const chip: Locator = page.getByTestId("resource-under-maintenance");
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveText("Under maintenance");
  await expect(chip.locator("xpath=..")).toContainText("Service 0039");

  // Today's bar of that resource wears the band of the work under way.
  const bars: Locator = await only(page, "0039");
  await expect(bars.nth(90)).toHaveAttribute("data-has-maintenance", "true");
  await expect(page.getByTestId("resource-under-maintenance")).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("maintenance-under-way.png"),
  });
});

test("a page without maintenance draws no band and no chip", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/");
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(40);

  await expect(
    page.locator("[data-testid='uptime-bar'][data-has-maintenance='true']"),
  ).toHaveCount(0);
  await expect(page.getByTestId("resource-under-maintenance")).toHaveCount(0);
});
