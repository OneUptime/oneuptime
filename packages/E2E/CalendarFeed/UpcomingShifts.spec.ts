import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * The Upcoming shifts card on User Settings > Calendar Feed, end to end in a
 * browser, against the fixture's in-page API (CalendarFeed/Fixture.js and
 * the shift scenarios in UpcomingShiftsFixture.js).
 *
 * The maintainer's ask was "Please improve the UI of this card" with a
 * screenshot of a wide screen: one person on a 24-hour daily rotation,
 * thirty identical rows under thirty day headings - "17:20 – Oct 15 2026,
 * 17:20 BST · Team AWeekly · OneUptime Telemetry", a dim "Layer 1" under
 * each, and "Get cover" at the far right edge of the card.
 *
 * What is pinned here is what only a browser can show: the month of turns
 * as one row; the times in the reader's zone (London, across the end of
 * summer time); the tiles in one column and Get cover beside its row on a
 * wide screen; the phone width with nothing scrolling sideways and no time
 * broken in two; the fold; every state; the dark theme; German, Russian and
 * Japanese. The browser's clock is fixed, so every row is the same on every
 * run.
 *
 * The screenshots under output/playwright/calendar-feed-ui are for the
 * people who review the card.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/calendar-feed-ui",
);

// 15:00 UTC on 14 October 2026: 16:00 in London, summer time.
const NOW: Date = new Date("2026-10-14T15:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

interface FixtureRequest {
  method: string;
  path?: string;
  query?: Record<string, string>;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function open(
  page: Page,
  query: string,
  width: number = 1280,
  clock: Date = NOW,
): Promise<void> {
  await page.clock.setFixedTime(clock);
  await page.setViewportSize({ width: width, height: 900 });
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

function card(page: Page): Locator {
  return page.getByTestId("card").filter({
    has: page.getByTestId("upcoming-shifts"),
  });
}

function rows(page: Page): Locator {
  return page.getByTestId("upcoming-shift-row");
}

async function requests(page: Page): Promise<Array<FixtureRequest>> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __calendarFeedFixture: { state: { requests: unknown } };
          }
        ).__calendarFeedFixture.state.requests,
      ),
    );
  });
}

async function shiftReads(page: Page): Promise<Array<FixtureRequest>> {
  return (await requests(page)).filter((request: FixtureRequest): boolean => {
    return Boolean(request.path && request.path.endsWith("/my-shifts"));
  });
}

async function box(locator: Locator): Promise<Box> {
  const found: Box | null = await locator.boundingBox();

  expect(found).not.toBeNull();

  return found as Box;
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

// Relative luminance of a computed colour, 0 (black) to 1 (white).
function luminance(color: string): number {
  const [r, g, b] = (color.match(/\d+(\.\d+)?/g) || [])
    .slice(0, 3)
    .map(Number)
    .map((value: number): number => {
      const unit: number = value / 255;

      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });

  return 0.2126 * (r || 0) + 0.7152 * (g || 0) + 0.0722 * (b || 0);
}

async function backgroundOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element) => {
    return getComputedStyle(element).backgroundColor;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await card(page).screenshot({
    path: path.join(SCREENSHOTS, `upcoming-shifts-${name}.png`),
  });
}

function coverQuery(href: string | null): Record<string, string> {
  const query: string = (href || "").split("?")[1] || "";

  return Object.fromEntries(new URLSearchParams(query).entries());
}

test.describe("the maintainer's month on a wide screen", () => {
  test.use({ timezoneId: "Europe/London" });

  test("thirty daily turns are one row: on call now, until at least the window's edge, Get cover beside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=daily", 1600);

    await expect(rows(page)).toHaveCount(1);

    const row: Locator = rows(page).first();

    await expect(row).toHaveAttribute("data-on-call-now", "true");
    await expect(row.getByTestId("upcoming-shift-day-label")).toHaveText(
      "On call now",
    );
    await expect(row.getByTestId("upcoming-shift-times")).toHaveText(
      "until at least Fri, Nov 13, 16:20",
    );
    await expect(row.getByTestId("upcoming-shift-length")).toHaveText(
      "At least 30 days left",
    );
    await expect(row.getByTestId("upcoming-shift-where")).toHaveText(
      "Team AWeekly",
    );
    // Today on a green tile.
    await expect(row.getByTestId("upcoming-shift-tile")).toHaveText("Oct14");

    // Nothing the old row repeated: no year, no zone, no layer, no project.
    await expect(row).not.toContainText("2026");
    await expect(row).not.toContainText("BST");
    await expect(row).not.toContainText("Layer 1");
    await expect(row).not.toContainText("OneUptime Telemetry");

    // The card asked for exactly the next 30 days.
    const reads: Array<FixtureRequest> = await shiftReads(page);

    expect(reads).toHaveLength(1);
    expect(reads[0]!.query).toEqual({
      from: NOW.toISOString(),
      to: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    });

    // Get cover covers the stretch from now to its end.
    const cover: Locator = row.getByRole("link", { name: "Get cover" });

    expect(coverQuery(await cover.getAttribute("href"))).toEqual({
      coverStartsAt: NOW.toISOString(),
      coverEndsAt: "2026-11-13T16:20:00.000Z",
    });

    /*
     * On a 1,600px screen the card is some 1,300px wide; the list is no
     * wider than a reading measure, so Get cover is never a screen away
     * from the row it belongs to.
     */
    const cardBox: Box = await box(card(page));
    const listBox: Box = await box(page.getByTestId("upcoming-shifts-list"));
    const coverBox: Box = await box(cover);
    const whenBox: Box = await box(row.getByTestId("upcoming-shift-when"));

    expect(cardBox.width).toBeGreaterThan(1200);
    expect(listBox.width).toBeLessThanOrEqual(896);
    expect(coverBox.x + coverBox.width).toBeLessThanOrEqual(
      listBox.x + listBox.width,
    );
    expect(coverBox.x - (whenBox.x + whenBox.width)).toBeLessThan(560);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await screenshot(page, "daily-1600");
  });
});

test.describe("a mixed month on a laptop", () => {
  test.use({ timezoneId: "Europe/London" });

  test("each row: a date tile, the day in words, the times and how long; the facts that say something, and nothing else", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=mixed");

    await expect(rows(page)).toHaveCount(8);

    const texts: Array<string> = await rows(page)
      .getByTestId("upcoming-shift-when")
      .allTextContents();

    expect(texts).toEqual([
      "On call now·until 22:00",
      "Tomorrow·10:00 – 18:00",
      "Saturday·23:00 – Sun, Oct 18, 07:00",
      "Tuesday·10:00 – Tue, Oct 27, 09:00",
      "Friday·09:00 – 17:00",
      "Tuesday·09:00 – 17:00",
      "Saturday·10:00 – 18:00",
      "Thursday·18:00 – at least Sat, Nov 14, 18:00",
    ]);

    expect(
      await rows(page).getByTestId("upcoming-shift-length").allTextContents(),
    ).toEqual([
      "6 hours left",
      "8 hours",
      "8 hours",
      "6 days, 23 hours",
      "8 hours",
      "8 hours",
      "8 hours",
      "At least 2 days",
    ]);

    expect(
      await rows(page).getByTestId("upcoming-shift-tile").allTextContents(),
    ).toEqual([
      "Oct14",
      "Oct15",
      "Oct17",
      "Oct20",
      "Oct30",
      "Nov3",
      "Nov7",
      "Nov12",
    ]);

    // Cover for someone else says for whom, and offers no Get cover.
    const covering: Locator = rows(page).nth(2);

    await expect(covering.getByTestId("upcoming-shift-covering")).toHaveText(
      "Covering for Bob Smith",
    );
    await expect(covering.getByRole("link", { name: "Get cover" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "Get cover" })).toHaveCount(7);

    // A week of daily turns on Database is one row.
    await expect(rows(page).nth(3)).toContainText("Database");

    await expect(rows(page).nth(4).getByTestId("upcoming-shift-policy")).toHaveText(
      "Only on policy Checkout",
    );

    // Layers with names of their own are named; "Layer 1" is never shown.
    expect(
      await page.getByTestId("upcoming-shift-layer").allTextContents(),
    ).toEqual(["Weekdays", "Weekend"]);
    await expect(card(page)).not.toContainText("Layer 1");
    await expect(page.getByTestId("upcoming-shifts-list")).not.toContainText(
      "SYSNETIX DEMO",
    );

    await expect(card(page).getByTestId("card-description")).toHaveText(
      "Your shifts over the next 30 days. Times are in Europe/London.",
    );
    await expect(page.getByTestId("upcoming-shifts-footer")).toHaveText(
      "Only schedule shifts are listed. If an escalation policy names you or your team directly, it can page you at any time.",
    );

    await screenshot(page, "mixed-1280");
  });

  test("the tiles run down one column, and each row's length and Get cover line up at its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=mixed");

    await expect(rows(page)).toHaveCount(8);

    const tileXs: Array<number> = [];
    const lengthRights: Array<number> = [];

    for (let index: number = 0; index < 8; index++) {
      const row: Locator = rows(page).nth(index);
      const rowBox: Box = await box(row);
      const tile: Box = await box(row.getByTestId("upcoming-shift-tile"));
      const length: Box = await box(row.getByTestId("upcoming-shift-length"));

      tileXs.push(Math.round(tile.x));
      lengthRights.push(Math.round(length.x + length.width));

      // The tile and the length sit inside their own row.
      expect(tile.y).toBeGreaterThanOrEqual(rowBox.y);
      expect(length.y + length.height).toBeLessThanOrEqual(
        rowBox.y + rowBox.height,
      );
    }

    expect(new Set(tileXs).size).toBe(1);
    expect(Math.max(...lengthRights) - Math.min(...lengthRights)).toBeLessThanOrEqual(1);
  });

  test("Refresh reads again with the rows on screen: no loader, nothing jumps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=mixed");

    await expect(rows(page)).toHaveCount(8);

    const before: Box = await box(card(page));

    await page.evaluate(() => {
      (
        window as unknown as {
          __calendarFeedFixture: { setShiftsDelay: (ms: number) => void };
        }
      ).__calendarFeedFixture.setShiftsDelay(1500);
    });

    const refresh: Locator = card(page).getByRole("button", {
      name: "Refresh",
    });

    await refresh.click();

    await expect(refresh).toBeDisabled();
    await expect(rows(page)).toHaveCount(8);
    await expect(page.getByTestId("upcoming-shifts-loading")).toHaveCount(0);
    expect((await box(card(page))).height).toBe(before.height);

    await expect(refresh).toBeEnabled({ timeout: 10000 });
    expect(await shiftReads(page)).toHaveLength(2);
    await expect(rows(page)).toHaveCount(8);
  });
});

test.describe("a phone", () => {
  test.use({ timezoneId: "Europe/London" });

  test("nothing scrolls sideways, and no time is broken in two", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [390, 320]) {
      await open(page, "shifts=mixed", width);

      await expect(rows(page)).toHaveCount(8);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      // Every whole part of a row's times sits on one line.
      const parts: Locator = page.locator(
        "[data-testid='upcoming-shift-times'] .whitespace-nowrap",
      );
      const count: number = await parts.count();

      expect(count).toBeGreaterThanOrEqual(15);

      for (let index: number = 0; index < count; index++) {
        const part: Box = await box(parts.nth(index));

        expect(part.height).toBeLessThan(30);
      }

      // The length and Get cover come under the text, not squeezed beside it.
      const row: Locator = rows(page).nth(1);
      const when: Box = await box(row.getByTestId("upcoming-shift-when"));
      const length: Box = await box(row.getByTestId("upcoming-shift-length"));

      expect(length.y).toBeGreaterThan(when.y + when.height);

      await screenshot(page, `mixed-${width}`);
    }
  });

  /*
   * Off the hour, the time left and Get cover are at their widest:
   * "Noch 5 Stunden, 4 Minuten" beside "Vertretung finden" once ran 73px
   * past a 360px screen. Now the time left is said in whole hours and the
   * two wrap under each other when they must.
   */
  test("German on a 360px phone, off the hour: the time left and Get cover stay on the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      "shifts=mixed&lang=de",
      360,
      new Date("2026-10-14T15:56:00.000Z"),
    );

    await expect(rows(page)).toHaveCount(8);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expect(
      rows(page).first().getByTestId("upcoming-shift-length"),
    ).toHaveText("Noch 5 Stunden");

    const viewport: number = 360;

    for (const link of await page
      .getByRole("link", { name: "Vertretung finden" })
      .all()) {
      const linkBox: Box = await box(link);

      expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(viewport);
    }

    await screenshot(page, "mixed-de-360");
  });

  test("long schedule, cover and policy names wrap inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=long", 390);

    await expect(rows(page)).toHaveCount(2);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const cardBox: Box = await box(card(page));

    for (const testId of [
      "upcoming-shift-where",
      "upcoming-shift-covering",
      "upcoming-shift-policy",
    ]) {
      const element: Box = await box(page.getByTestId(testId).first());

      expect(element.x + element.width).toBeLessThanOrEqual(
        cardBox.x + cardBox.width,
      );
    }

    await screenshot(page, "long-390");
  });
});

test.describe("the fold", () => {
  test.use({ timezoneId: "Europe/London" });

  test("a month of weekdays shows six rows, opens to all of them, and folds again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=weekdays");

    await expect(rows(page)).toHaveCount(6);

    const fold: Locator = page.getByTestId("upcoming-shifts-fold");

    await expect(fold).toHaveText("Show 17 more shifts");
    await expect(fold).toHaveAttribute("aria-expanded", "false");

    await screenshot(page, "weekdays-folded");

    await fold.click();

    await expect(rows(page)).toHaveCount(23);
    await expect(fold).toHaveText("Show fewer shifts");
    await expect(fold).toHaveAttribute("aria-expanded", "true");

    await fold.click();

    await expect(rows(page)).toHaveCount(6);
  });
});

test.describe("every state says what it is", () => {
  test.use({ timezoneId: "Europe/London" });

  test("loading, then the rows", async ({ page }: { page: Page }) => {
    await open(page, "shifts=mixed&shiftsDelay=1500");

    await expect(page.getByTestId("upcoming-shifts-loading")).toBeVisible();
    await expect(rows(page)).toHaveCount(8, { timeout: 10000 });
    await expect(page.getByTestId("upcoming-shifts-loading")).toHaveCount(0);
  });

  test("no shifts: a calm panel, and the footer still says why a policy may page you", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=empty");

    const empty: Locator = page.getByTestId("upcoming-shifts-empty");

    await expect(empty).toContainText("No shifts in the next 30 days");
    await expect(empty).toContainText(
      "When a schedule puts you on call, your shifts show up here.",
    );
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId("upcoming-shifts-footer")).toBeVisible();

    await screenshot(page, "empty");
  });

  test("an incomplete answer says so above the list, and never claims there are no shifts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=truncated");

    const warning: Locator = page.getByTestId("upcoming-shifts-truncated");

    await expect(warning).toContainText("some shifts may be missing");
    expect((await box(warning)).y).toBeLessThan(
      (await box(page.getByTestId("upcoming-shifts-list"))).y,
    );

    await open(page, "shifts=truncated-empty");

    await expect(page.getByTestId("upcoming-shifts-truncated")).toBeVisible();
    await expect(page.getByTestId("upcoming-shifts-empty")).toHaveText(
      "No shifts could be listed for the next 30 days.",
    );

    await screenshot(page, "truncated-empty");
  });

  test("a failed read says what failed, and Try again recovers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=error");

    const error: Locator = page.getByTestId("upcoming-shifts-load-error");

    await expect(error).toContainText("Could not load your shifts.");
    await expect(error).toContainText("The shift service is not responding.");

    await screenshot(page, "error");

    await error.getByText("Try again").click();

    await expect(rows(page)).toHaveCount(8);
    await expect(error).toHaveCount(0);
  });
});

test.describe("across the end of summer time in London", () => {
  test.use({ timezoneId: "Europe/London" });

  test("a 17:20 rotation reads 17:20 on both sides of the change, and the night of the change counts nine hours", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=dst", 1280, new Date("2026-10-22T12:00:00.000Z"));

    await expect(rows(page)).toHaveCount(2);

    const turns: Locator = rows(page).first();
    const night: Locator = rows(page).nth(1);

    await expect(turns.getByTestId("upcoming-shift-when")).toHaveText(
      "Today·17:20 – Mon, Oct 26, 17:20",
    );
    await expect(turns.getByTestId("upcoming-shift-length")).toHaveText(
      "4 days",
    );
    await expect(turns.getByTestId("upcoming-shift-when")).toHaveAttribute(
      "title",
      "Thursday, October 22, 2026 at 17:20 BST – Monday, October 26, 2026 at 17:20 GMT",
    );

    await expect(night.getByTestId("upcoming-shift-when")).toHaveText(
      "Sunday·00:00 – 08:00",
    );
    await expect(night.getByTestId("upcoming-shift-length")).toHaveText(
      "9 hours",
    );

    await screenshot(page, "dst");
  });
});

test.describe("the dark theme", () => {
  test.use({ timezoneId: "Europe/London" });

  test("the list and its tiles are dark; today's tile keeps its green", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "shifts=mixed&theme=dark");

    await expect(rows(page)).toHaveCount(8);

    expect(
      luminance(await backgroundOf(page.getByTestId("upcoming-shifts-list"))),
    ).toBeLessThan(0.1);

    const tiles: Locator = page.getByTestId("upcoming-shift-tile");

    expect(luminance(await backgroundOf(tiles.nth(1)))).toBeLessThan(0.1);

    const today: string = await backgroundOf(tiles.first());
    const [red, green, blue] = (today.match(/\d+(\.\d+)?/g) || [])
      .slice(0, 3)
      .map(Number);

    expect(luminance(today)).toBeLessThan(0.2);
    expect(green || 0).toBeGreaterThan(Math.max(red || 0, blue || 0));

    await screenshot(page, "mixed-dark");
  });
});

test.describe("in other languages", () => {
  test.describe("German, in Berlin", () => {
    test.use({ timezoneId: "Europe/Berlin" });

    test("German words, German dates and lengths", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, "shifts=mixed&lang=de");

      await expect(rows(page)).toHaveCount(8);
      await expect(card(page)).toContainText("Bevorstehende Schichten");

      const now: Locator = rows(page).first();

      await expect(now.getByTestId("upcoming-shift-when")).toHaveText(
        "Jetzt in Bereitschaft·bis 23:00",
      );
      await expect(now.getByTestId("upcoming-shift-length")).toHaveText(
        "Noch 6 Stunden",
      );
      await expect(now.getByRole("link", { name: "Vertretung finden" })).toBeVisible();

      await expect(rows(page).nth(1).getByTestId("upcoming-shift-when")).toHaveText(
        "Morgen·11:00 – 19:00",
      );
      await expect(rows(page).nth(1).getByTestId("upcoming-shift-tile")).toHaveText(
        "Okt15",
      );

      await screenshot(page, "mixed-de");
    });
  });

  test.describe("Russian, in Moscow", () => {
    test.use({ timezoneId: "Europe/Moscow" });

    test("the fold in Russian's general form, and lengths in its plurals", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, "shifts=weekdays&lang=ru", 390);

      await expect(rows(page)).toHaveCount(6);
      await expect(page.getByTestId("upcoming-shifts-fold")).toHaveText(
        "Показать ещё смены (17)",
      );
      await expect(rows(page).nth(1).getByTestId("upcoming-shift-length")).toHaveText(
        "8 часов",
      );
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await screenshot(page, "weekdays-ru-390");
    });
  });

  test.describe("Japanese, in Tokyo", () => {
    test.use({ timezoneId: "Asia/Tokyo" });

    test("Japanese words, and Tokyo's day: past midnight there, tomorrow's shift is today's", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, "shifts=mixed&lang=ja");

      await expect(rows(page)).toHaveCount(8);
      await expect(card(page)).toContainText("今後のシフト");
      await expect(rows(page).first().getByTestId("upcoming-shift-when")).toHaveText(
        "現在のオンコール·6:00 まで",
      );
      await expect(rows(page).nth(1).getByTestId("upcoming-shift-when")).toHaveText(
        "今日·18:00 – 10月16日(金) 2:00",
      );

      await screenshot(page, "mixed-ja");
    });
  });
});
