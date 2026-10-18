import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * A status page's calendar buttons, end to end in a browser, on the real
 * Scheduled Events pages against the fixture's in-page API
 * (StatusPageFixture.js).
 *
 * Subscribe to calendar on the list puts the page's maintenance in a
 * calendar app for good: Google Calendar's add-by-URL page, the device's
 * calendar app by webcal://, or the link to copy - each to the page's own
 * maintenance.ics, on its own domain or at its address under OneUptime,
 * and never offered on a private page. Add to calendar on an event's page
 * puts that one event in a calendar app: Google's add-event page filled in,
 * or the event as a file - and is not offered for an event that is over.
 * Then the phone's width, the dark theme, German and Persian.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/maintenance-calendar-ui",
);

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");

const PAGE_ID: string = "00000000-0000-4000-8000-000000000001";
const UPCOMING_ID: string = "00000000-0000-4000-8000-000000000100";
const ONGOING_ID: string = "00000000-0000-4000-8000-000000000101";
const OVER_ID: string = "00000000-0000-4000-8000-000000000102";

const PREVIEW: string = `/status-page/${PAGE_ID}`;

interface FixtureState {
  requests: Array<string>;
  copied: Array<string>;
}

async function open(
  page: Page,
  pathAndQuery: string,
  width: number = 1280,
): Promise<void> {
  await page.setViewportSize({ width: width, height: 900 });
  await page.clock.setFixedTime(NOW);
  await page.goto(pathAndQuery);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __statusPageCalendarFixture: unknown })
          .__statusPageCalendarFixture,
      ),
    );
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

async function shot(page: Page, name: string, target?: Locator): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  const file: string = path.join(SCREENSHOTS, `${name}.png`);

  if (target) {
    await target.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: true });
  }
}

async function href(locator: Locator): Promise<string> {
  return (await locator.getAttribute("href")) || "";
}

function origin(page: Page): string {
  return new URL(page.url()).origin;
}

test.describe("Subscribe to calendar, on the Scheduled Events page", () => {
  test("at the page's address under OneUptime: Google, the device's app and the link, all to the page's maintenance.ics", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events`);

    const subscribe: Locator = page.getByTestId(
      "maintenance-calendar-subscribe",
    );

    await expect(subscribe).toBeVisible();
    await shot(page, "status-page-list");

    await subscribe.click();

    const dialog: Locator = page.getByTestId(
      "maintenance-calendar-subscribe-dialog",
    );

    await expect(dialog).toBeVisible();

    const https: string = `${origin(page)}/status-page/${PAGE_ID}/maintenance.ics`;
    const webcal: string = https.replace("http://", "webcal://");

    await expect(page.getByTestId("maintenance-calendar-url")).toHaveValue(
      https,
    );
    expect(await href(page.getByTestId("maintenance-calendar-device"))).toBe(
      webcal,
    );

    const google: URL = new URL(
      await href(page.getByTestId("maintenance-calendar-google")),
    );

    expect(google.hostname).toBe("calendar.google.com");
    expect(google.searchParams.get("cid")).toBe(webcal);

    await page.getByTestId("maintenance-calendar-copy").click();

    await expect(page.getByTestId("maintenance-calendar-copy")).toHaveText(
      "Copied!",
    );
    expect((await fixtureState(page)).copied).toEqual([https]);

    await shot(page, "status-page-subscribe", page.getByTestId("modal"));
  });

  test("on the page's own domain: /maintenance.ics", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/scheduled-events");

    await page.getByTestId("maintenance-calendar-subscribe").click();

    await expect(page.getByTestId("maintenance-calendar-url")).toHaveValue(
      `${origin(page)}/maintenance.ics`,
    );
  });

  test("is not offered on a private page, whose calendar no app could read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events?private=1`);

    await expect(page.getByText("Database upgrade").first()).toBeVisible();
    await expect(
      page.getByTestId("maintenance-calendar-subscribe"),
    ).toHaveCount(0);
  });

  test("Done closes it", async ({ page }: { page: Page }) => {
    await open(page, `${PREVIEW}/scheduled-events`);

    await page.getByTestId("maintenance-calendar-subscribe").click();
    await page.getByRole("button", { name: "Done" }).click();

    await expect(
      page.getByTestId("maintenance-calendar-subscribe-dialog"),
    ).toHaveCount(0);
  });
});

test.describe("Add to calendar, on an event's page", () => {
  test("Google Calendar with the event filled in, or the event alone as a file", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events/${UPCOMING_ID}`);

    const add: Locator = page.getByTestId("maintenance-calendar-add-event");

    await expect(add).toBeVisible();
    await shot(page, "status-page-event");

    await add.click();

    await expect(
      page.getByTestId("maintenance-calendar-event-dialog"),
    ).toBeVisible();

    const google: URL = new URL(
      await href(page.getByTestId("maintenance-calendar-google")),
    );

    expect(google.searchParams.get("action")).toBe("TEMPLATE");
    expect(google.searchParams.get("text")).toBe("Database upgrade");
    expect(google.searchParams.get("dates")).toBe(
      "20261020T220000Z/20261021T010000Z",
    );

    const device: Locator = page.getByTestId("maintenance-calendar-device");

    expect(await href(device)).toBe(
      `${origin(page)}/status-page/${PAGE_ID}/maintenance.ics?event=${UPCOMING_ID}`,
    );
    await expect(device).toHaveAttribute("download", "maintenance.ics");

    // One event: nothing to copy, no subscription's refresh note.
    await expect(page.getByTestId("maintenance-calendar-url")).toHaveCount(0);

    await shot(page, "status-page-add-event", page.getByTestId("modal"));
  });

  test("an event under way can be added too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events/${ONGOING_ID}`);

    await expect(
      page.getByTestId("maintenance-calendar-add-event"),
    ).toBeVisible();
  });

  test("an event that is over is history: no Add to calendar", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events/${OVER_ID}`);

    await expect(
      page.getByText("Old cluster retirement").first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("maintenance-calendar-add-event"),
    ).toHaveCount(0);
  });

  test("on the page's own domain the file is /maintenance.ics?event=", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `/scheduled-events/${UPCOMING_ID}`);

    await page.getByTestId("maintenance-calendar-add-event").click();

    expect(await href(page.getByTestId("maintenance-calendar-device"))).toBe(
      `${origin(page)}/maintenance.ics?event=${UPCOMING_ID}`,
    );
  });
});

test.describe("the status page's calendar dialogs", () => {
  test("fit a phone, the two options stacked, with nothing scrolling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events`, 390);

    await page.getByTestId("maintenance-calendar-subscribe").click();
    await expect(
      page.getByTestId("maintenance-calendar-subscribe-dialog"),
    ).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const google: { y: number; x: number } | null = await page
      .getByTestId("maintenance-calendar-google")
      .boundingBox();
    const device: { y: number; x: number } | null = await page
      .getByTestId("maintenance-calendar-device")
      .boundingBox();

    expect(device!.y).toBeGreaterThan(google!.y);
    expect(Math.abs(device!.x - google!.x)).toBeLessThan(2);

    await shot(page, "status-page-phone-subscribe", page.getByTestId("modal"));
  });

  test("read in German", async ({ page }: { page: Page }) => {
    await open(page, `${PREVIEW}/scheduled-events?lang=de`);

    await expect(page.getByTestId("maintenance-calendar-subscribe")).toHaveText(
      "Kalender abonnieren",
    );
  });

  test("read in Persian, right to left, without spilling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events/${UPCOMING_ID}?lang=fa`);

    await page.getByTestId("maintenance-calendar-add-event").click();
    await expect(
      page.getByTestId("maintenance-calendar-event-dialog"),
    ).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(
      page,
      "status-page-persian-add-event",
      page.getByTestId("modal"),
    );
  });

  test("in the dark theme", async ({ page }: { page: Page }) => {
    await open(page, `${PREVIEW}/scheduled-events?theme=dark`);

    await page.getByTestId("maintenance-calendar-subscribe").click();
    await expect(
      page.getByTestId("maintenance-calendar-subscribe-dialog"),
    ).toBeVisible();

    await shot(page, "status-page-dark-subscribe", page.getByTestId("modal"));
  });
});
