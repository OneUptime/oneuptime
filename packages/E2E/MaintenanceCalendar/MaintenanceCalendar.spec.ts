import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * Scheduled Maintenance > Calendar > Maintenance Calendar, end to end in a
 * browser, on the real pages against the fixture's in-page API (Fixture.js).
 *
 * The maintainer's asks: "We currently do not have calendar views and
 * calendar feeds for scheduling events", then "calendar view as separate
 * page in side menu with its own side menu section called Calendar", with
 * calendars from outside the project overlaid on it (issue #5084) and set up
 * on a Calendar Settings page. What only a browser shows is pinned here: the
 * calendar's own page in the side menu's Calendar section, All Events the
 * list alone, a reader whose browser had left the old List | Calendar switch
 * on Calendar taken there once; the external calendars drawn beside the
 * events - lighter, dashed, opening nothing - with a toggle each, a hidden one
 * not asked for, one not read lately marked, a crowded period said; Calendar
 * Settings: each calendar's status and last read, adding one (its link
 * refused when it is not one), Change link, Turn off, a refused Read now; the
 * month grid with each event a link drawn soft in
 * its state's colour (a pale wash and a stripe, as the list's state pills)
 * and today marked; a busy day's "+N more" and the list it opens; Week;
 * the toolbar's Today and arrows moving through the months, by mouse and by
 * keyboard; the + that schedules maintenance on a day still to come (and
 * nowhere else); a slow or failing read; the Subscribe to calendar dialog -
 * publish, copy, regenerate, disable, a reader held to some events; a
 * phone's width with nothing scrolling sideways; the dark theme; German and
 * Japanese.
 *
 * The screenshots under output/playwright/maintenance-calendar-ui are for
 * the people who review the page.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/maintenance-calendar-ui",
);

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

// The fixture's tokens: the published link's, and the next one minted.
const FIRST_TOKEN: string = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd0";
const NEXT_TOKEN: string = "Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp-_OoNnMmLlK";

const SHOW_MORE_PATTERN: RegExp = /^\+\d+ more$/;

// A block drawn soft (Common's CalendarEventTone).
const SOFT_BLOCK_PATTERN: RegExp = /oneuptime-calendar-event--soft/;

// An event's own page.
const EVENT_PAGE_PATTERN: RegExp = /\/scheduled-maintenance-events\//;

// The + of 20 October, named for what it does.
const SCHEDULE_ON_THE_20TH_PATTERN: RegExp = /^Schedule maintenance on .*20/;

interface FixtureRequest {
  kind: string;
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  limit?: number;
  tableName?: string;
  id?: string;
  data?: Record<string, unknown>;
}

interface FixtureState {
  requests: Array<FixtureRequest>;
  copied: Array<string>;
}

async function open(
  page: Page,
  query: string,
  width: number = 1280,
): Promise<void> {
  await page.setViewportSize({ width: width, height: 900 });
  await page.clock.setFixedTime(NOW);
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __maintenanceCalendarFixture: { state: unknown };
          }
        ).__maintenanceCalendarFixture.state,
      ),
    );
  });
}

async function calendarReads(page: Page): Promise<Array<FixtureRequest>> {
  return (await fixtureState(page)).requests.filter(
    (request: FixtureRequest) => {
      return request.kind === "calendar";
    },
  );
}

function calendar(page: Page): Locator {
  return page.getByTestId("scheduled-maintenance-calendar");
}

// The period the toolbar names, beside its arrows (Common's CalendarToolbar).
function periodLabel(page: Page): Locator {
  return calendar(page).getByTestId("calendar-toolbar-label");
}

// A computed box-shadow's first shadow: "rgb(r, g, b) 3px 0px 0px 0px inset".
function stripeOf(shadow: string): string {
  return shadow.split(" inset,")[0]!.trim();
}

function eventLink(page: Page, title: string): Locator {
  return page
    .getByTestId("scheduled-maintenance-calendar-event")
    .filter({ hasText: title })
    .first();
}

// The block react-big-calendar draws an event's link in.
function eventBlock(page: Page, title: string): Locator {
  return calendar(page)
    .locator(".rbc-event", {
      has: page
        .getByTestId("scheduled-maintenance-calendar-event")
        .filter({ hasText: title }),
    })
    .first();
}

// The fixture's external calendars (Fixture.js).
const HOLIDAYS_ID: string = "50000000-0000-4000-8000-000000000001";
const FREEZES_ID: string = "50000000-0000-4000-8000-000000000002";
const PAYMENTS_ID: string = "50000000-0000-4000-8000-000000000003";

// Where the old List | Calendar switch kept the reader's choice.
const PREVIOUS_VIEW_KEY: string = "oneuptime.scheduled-maintenance-view";

/*
 * A page's path, ending with the page it is. The fixture keeps the query it
 * was opened with (?page=list&...) until the reader goes elsewhere, so the
 * path is read alone (addressOf).
 */
const CALENDAR_ADDRESS_PATTERN: RegExp =
  /\/scheduled-maintenance-events\/calendar$/;
const LIST_ADDRESS_PATTERN: RegExp = /\/scheduled-maintenance-events$/;
const SETTINGS_ADDRESS_PATTERN: RegExp =
  /\/scheduled-maintenance-events\/settings\/calendar$/;

// An overlay block's stripes (Common's CalendarEventTone).
const STRIPES_PATTERN: RegExp = /repeating-linear-gradient/;

// A colour as the form sends it, somewhere in its JSON: #0d9488.
const HEX_COLOR_PATTERN: RegExp = /#[0-9a-fA-F]{6}/;

// The side menu's item drawn as the page the reader is on.
const ACTIVE_ITEM_PATTERN: RegExp = /bg-indigo-50/;

// The page's path, without the fixture's query.
function addressOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/*
 * The ⋯ in the card's header, beside Create: the menu of the page's card
 * (the calendar's or the list's), outside the calendar's own grid.
 */
function cardMenuButton(page: Page): Locator {
  return page
    .getByTestId("fixture-page")
    .getByRole("button", { name: "More options" })
    .first();
}

function sideMenu(page: Page): Locator {
  return page.getByTestId("fixture-side-menu");
}

function toggles(page: Page): Locator {
  return page.getByTestId("scheduled-maintenance-calendar-external");
}

/*
 * An external calendar's toggle: named by its calendar alone, shown or
 * hidden by aria-pressed (ExternalCalendarToggles).
 */
function toggleNamed(page: Page, name: string, isShown: boolean): Locator {
  return toggles(page).getByRole("button", {
    name: name,
    exact: true,
    pressed: isShown,
  });
}

// Why a calendar is marked, as its toggle describes it.
const READ_WARNING: string =
  "OneUptime could not read this calendar lately. It shows the events of its last good read.";

function overlayEvent(page: Page, title: string): Locator {
  return page
    .getByTestId("scheduled-maintenance-calendar-overlay-event")
    .filter({ hasText: title })
    .first();
}

// The block react-big-calendar draws an overlay event's text in.
function overlayBlock(page: Page, title: string): Locator {
  return calendar(page)
    .locator(".rbc-event", {
      has: page
        .getByTestId("scheduled-maintenance-calendar-overlay-event")
        .filter({ hasText: title }),
    })
    .first();
}

async function externalEventReads(
  page: Page,
): Promise<Array<{ calendarIds: Array<string> } & FixtureRequest>> {
  return (await fixtureState(page)).requests.filter(
    (request: FixtureRequest) => {
      return request.kind === "external-events";
    },
  ) as Array<{ calendarIds: Array<string> } & FixtureRequest>;
}

async function calendarSettled(page: Page): Promise<void> {
  await expect(calendar(page)).toBeVisible();
  await expect(
    page.getByTestId("scheduled-maintenance-calendar-loading"),
  ).toHaveCount(0);
}

// A row of the Calendar Settings table, by the calendar's name.
function settingsRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: name }).first();
}

// A row's ⋯, named for the calendar it acts on (ModelTable's row menu).
function rowMenuButton(page: Page, name: string): Locator {
  return settingsRow(page, name).getByRole("button", {
    name: `More actions for External Calendar: ${name}`,
  });
}

async function rowAction(
  page: Page,
  name: string,
  action: string,
): Promise<void> {
  await rowMenuButton(page, name).click();
  await page.getByRole("menuitem", { name: action }).click();
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

async function openSubscribe(page: Page): Promise<Locator> {
  await page.getByTestId("scheduled-maintenance-calendar-subscribe").click();

  const dialog: Locator = page.getByTestId("maintenance-calendar-feed-dialog");

  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("modal").locator(".animate-spin")).toHaveCount(
    0,
  );

  return dialog;
}

// The colour a computed style resolves to, as [r, g, b].
const NUMBER_PATTERN: RegExp = /\d+(\.\d+)?/g;

function channels(color: string): Array<number> {
  return (color.match(NUMBER_PATTERN) || []).slice(0, 3).map(Number);
}

test.describe("the calendar's own page", () => {
  test("the side menu's Calendar section holds it, open, and marks it as the page the reader is on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await calendarSettled(page);

    expect(addressOf(page)).toMatch(CALENDAR_ADDRESS_PATTERN);
    await expect(
      page.getByRole("heading", { name: "Maintenance Calendar" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Every scheduled maintenance event by month, week or day, in your own time zone.",
      ),
    ).toBeVisible();

    const item: Locator = sideMenu(page).getByRole("link", {
      name: "Maintenance Calendar",
    });

    await expect(item).toBeVisible();
    await expect(item).toHaveClass(ACTIVE_ITEM_PATTERN);
    await expect(
      sideMenu(page).getByText("Calendar", { exact: true }),
    ).toBeVisible();

    // Calendar Settings waits in the folded Settings.
    await expect(
      sideMenu(page).getByRole("link", { name: "Calendar Settings" }),
    ).toBeHidden();

    await shot(page, "calendar-page");
  });

  test("All Events is the list alone: no switch, and no Subscribe to calendar in its menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list");

    expect(addressOf(page)).toMatch(LIST_ADDRESS_PATTERN);
    await expect(page.getByText("Database upgrade").first()).toBeVisible();
    await expect(calendar(page)).toHaveCount(0);
    await expect(
      page.getByTestId("scheduled-maintenance-view-switch"),
    ).toHaveCount(0);

    await cardMenuButton(page).click();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Subscribe to calendar" }),
    ).toHaveCount(0);
  });

  /*
   * An event kept to the team until its publish time (#5249) names the
   * pages it will show on, and under them from when: it is on none of them
   * yet. Every other event's cell is as it was.
   */
  test("All Events says, under an event's status pages, from when it shows on them (?publish=later)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&publish=later");

    const row: Locator = page
      .locator("tr")
      .filter({ hasText: "Database upgrade" });
    await expect(row).toContainText("Acme Status");
    await expect(
      row.getByTestId("scheduled-maintenance-shows-from"),
    ).toHaveText("Shows from Oct 18 2026, 09:00 GMT");
    await expect(
      page.getByTestId("scheduled-maintenance-shows-from"),
    ).toHaveCount(1);
  });

  test("the side menu goes between the list and the calendar", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list");

    await sideMenu(page)
      .getByRole("link", { name: "Maintenance Calendar" })
      .click();
    await calendarSettled(page);
    expect(addressOf(page)).toMatch(CALENDAR_ADDRESS_PATTERN);

    await sideMenu(page).getByRole("link", { name: "All Events" }).click();
    await expect(calendar(page)).toHaveCount(0);
    expect(addressOf(page)).toMatch(LIST_ADDRESS_PATTERN);
  });

  test("a reader whose browser left the old switch on Calendar is taken to the calendar once, the old choice forgotten", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&previousView=calendar");

    await calendarSettled(page);
    expect(addressOf(page)).toMatch(CALENDAR_ADDRESS_PATTERN);
    expect(
      await page.evaluate((key: string) => {
        return window.localStorage.getItem(key);
      }, PREVIOUS_VIEW_KEY),
    ).toBeNull();

    // Once: All Events is the list from then on.
    await sideMenu(page).getByRole("link", { name: "All Events" }).click();
    await expect(page.getByText("Database upgrade").first()).toBeVisible();
    await expect(calendar(page)).toHaveCount(0);
    expect(addressOf(page)).toMatch(LIST_ADDRESS_PATTERN);
  });

  test("one who left it on List stays on the list, the old choice forgotten too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&previousView=list");

    await expect(page.getByText("Database upgrade").first()).toBeVisible();
    await expect(calendar(page)).toHaveCount(0);
    expect(addressOf(page)).toMatch(LIST_ADDRESS_PATTERN);
    expect(
      await page.evaluate((key: string) => {
        return window.localStorage.getItem(key);
      }, PREVIOUS_VIEW_KEY),
    ).toBeNull();
  });

  test("its header reads as All Events' does: the title whole beside the buttons, the description under both", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Beside "Create Scheduled Maintenance Event" the card's default header
     * broke the title into a column a word wide at tablet widths, and the
     * description over two lines on a laptop.
     */
    for (const width of [1280, 1024, 768]) {
      await open(page, "", width);
      await calendarSettled(page);

      await expect(page.getByTestId("card-header").first()).toHaveAttribute(
        "data-header-layout",
        "toolbar",
      );

      const title: { x: number; height: number } | null = await page
        .getByRole("heading", { name: "Maintenance Calendar" })
        .boundingBox();
      const description: { x: number; height: number } | null = await page
        .getByTestId("card-description")
        .first()
        .boundingBox();

      // The title on one line (leading-6), in every width.
      expect({ width, titleHeight: title!.height }).toEqual({
        width,
        titleHeight: 24,
      });

      // The description starts under the title, at the card's edge.
      expect({ width, x: description!.x }).toEqual({ width, x: title!.x });

      if (width === 1280) {
        // One line on a laptop: text-sm, leading-relaxed.
        expect(description!.height).toBeLessThan(30);
      }
    }

    await shot(page, "calendar-header-768");
  });
});

test.describe("external calendars on the calendar", () => {
  test("a project with none shows no toggles, and asks for no events of theirs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await calendarSettled(page);
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await expect(toggles(page)).toHaveCount(0);

    const reads: Array<FixtureRequest> = (await fixtureState(page)).requests;

    // The calendars turned on are asked for once; with none, nothing else.
    expect(
      reads.filter((request: FixtureRequest) => {
        return request.kind === "external-calendars";
      }),
    ).toHaveLength(1);
    expect(await externalEventReads(page)).toHaveLength(0);
  });

  test("the calendars turned on are toggles under the calendar, their events drawn beside the project's: lighter, dashed and opening nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "external=some");
    await calendarSettled(page);
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    const group: Locator = page.getByRole("group", {
      name: "External calendars",
    });

    await expect(group).toBeVisible();

    /*
     * Each toggle is named by its calendar and says it is shown with
     * aria-pressed; what a click does is the hint a pointer gets.
     */
    await expect(toggleNamed(page, "Change freezes", true)).toHaveAttribute(
      "title",
      "Hide Change freezes on the calendar",
    );
    await expect(toggleNamed(page, "Public holidays", true)).toHaveAttribute(
      "title",
      "Hide Public holidays on the calendar",
    );
    // A calendar turned off is not offered, nor asked for.
    await expect(group.getByText("Payments project")).toHaveCount(0);

    // An all-day holiday and a timed freeze, each in its calendar's name.
    await expect(overlayEvent(page, "Founders' Day")).toBeVisible();
    await expect(overlayEvent(page, "Payments release window")).toBeVisible();
    await expect(overlayEvent(page, "Founders' Day")).toHaveAttribute(
      "data-calendar-id",
      HOLIDAYS_ID,
    );
    await expect(overlayEvent(page, "Founders' Day")).toContainText(
      "(Public holidays)",
    );
    await expect(overlayEvent(page, "Payments: database failover")).toHaveCount(
      0,
    );

    const reads: Array<{ calendarIds: Array<string> } & FixtureRequest> =
      await externalEventReads(page);

    expect(reads.length).toBeGreaterThan(0);
    expect([...reads[reads.length - 1]!.calendarIds].sort()).toEqual(
      [FREEZES_ID, HOLIDAYS_ID].sort(),
    );
    for (const read of reads) {
      expect(read.calendarIds).not.toContain(PAYMENTS_ID);
    }

    // Lighter than the project's own blocks: stripes and a dashed edge.
    const style: { border: string; image: string; cursor: string } =
      await overlayBlock(page, "Founders' Day").evaluate((element: Element) => {
        return {
          border: getComputedStyle(element).borderTopStyle,
          image: getComputedStyle(element).backgroundImage,
          cursor: getComputedStyle(element).cursor,
        };
      });

    expect(style.border).toBe("dashed");
    expect(style.image).toMatch(STRIPES_PATTERN);
    expect(style.cursor).toBe("default");

    // Not a link, and a click opens nothing.
    await expect(
      overlayBlock(page, "Founders' Day").getByRole("link"),
    ).toHaveCount(0);
    await overlayBlock(page, "Founders' Day").click();
    await expect(page.getByTestId("fixture-navigated")).toHaveCount(0);
    expect(addressOf(page)).toMatch(CALENDAR_ADDRESS_PATTERN);

    await shot(page, "calendar-external");
  });

  test("hiding one hides its events for this reader, asks for it no more, and the browser keeps the choice for the project", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "external=some");
    await calendarSettled(page);
    await expect(overlayEvent(page, "Founders' Day")).toBeVisible();

    await toggleNamed(page, "Public holidays", true).click();

    await expect(overlayEvent(page, "Founders' Day")).toHaveCount(0);
    await expect(overlayEvent(page, "Payments release window")).toBeVisible();

    // The same toggle, by the same name: its state and its hint changed.
    await expect(toggleNamed(page, "Public holidays", false)).toHaveAttribute(
      "title",
      "Show Public holidays on the calendar",
    );

    const reads: Array<{ calendarIds: Array<string> } & FixtureRequest> =
      await externalEventReads(page);

    expect(reads[reads.length - 1]!.calendarIds).toEqual([FREEZES_ID]);

    const kept: string | null = await page.evaluate(() => {
      return window.localStorage.getItem(
        "oneuptime.maintenance-calendar.hidden-calendars.10000000-0000-4000-8000-000000000001",
      );
    });

    expect(JSON.parse(kept || "[]")).toEqual([HOLIDAYS_ID]);

    // Shown again, it is asked for again.
    await toggleNamed(page, "Public holidays", false).click();
    await expect(overlayEvent(page, "Founders' Day")).toBeVisible();
  });

  test("a calendar hidden before the page opened is not asked for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `external=some&hidden=${HOLIDAYS_ID}`);
    await calendarSettled(page);
    await expect(overlayEvent(page, "Payments release window")).toBeVisible();

    await expect(overlayEvent(page, "Founders' Day")).toHaveCount(0);
    await expect(toggleNamed(page, "Public holidays", false)).toBeVisible();

    for (const read of await externalEventReads(page)) {
      expect(read.calendarIds).toEqual([FREEZES_ID]);
    }
  });

  test("a calendar not read lately is marked inside its own toggle, which says why, and its last good events are still drawn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "external=failing");
    await calendarSettled(page);

    const freezes: Locator = toggleNamed(page, "Change freezes", true);
    const mark: Locator = freezes.getByTestId(
      "scheduled-maintenance-calendar-external-warning",
    );

    await expect(mark).toBeVisible();
    await expect(freezes).toHaveAccessibleDescription(READ_WARNING);
    await expect(
      toggleNamed(page, "Public holidays", true).getByTestId(
        "scheduled-maintenance-calendar-external-warning",
      ),
    ).toHaveCount(0);

    // The mark sits inside its toggle's pill, never out between two toggles.
    const pill: { x: number; width: number } | null =
      await freezes.boundingBox();
    const markBox: { x: number; width: number } | null =
      await mark.boundingBox();

    expect(markBox!.x).toBeGreaterThan(pill!.x);
    expect(markBox!.x + markBox!.width).toBeLessThan(pill!.x + pill!.width);

    await expect(overlayEvent(page, "Payments release window")).toBeVisible();
  });

  test("a period holding more of their events than one view asks for says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "external=many");
    await calendarSettled(page);

    await expect(
      page.getByTestId("scheduled-maintenance-calendar-overlay-truncated"),
    ).toHaveText(
      "Showing the first 500 events of the external calendars in this period. Hide some of them, or look at a week.",
    );
  });

  test("a busy calendar from outside the project never folds the project's own events into +N more", async ({
    page,
  }: {
    page: Page;
  }) => {
    // 520 shifts of the holidays calendar, a dozen and more on every day.
    await open(page, "external=many");
    await calendarSettled(page);
    await expect(overlayEvent(page, "Shift 1")).toBeAttached();

    // Today's own event takes the day's first row, before any shift...
    await expect(eventLink(page, "Network switch firmware")).toBeVisible();
    await expect(eventLink(page, "Database upgrade")).toBeVisible();
    await expect(eventLink(page, "Patch window 1")).toBeVisible();
    // ...and a long one, before the long holiday that started a day earlier.
    await expect(eventLink(page, "Storage migration")).toBeVisible();

    /*
     * ...and every shift of its day is drawn under it, or folded into the
     * day's +N more: none takes its row.
     */
    const today: { x: number; y: number; width: number } | null =
      await eventBlock(page, "Network switch firmware").boundingBox();
    const shifts: Array<{ x: number; y: number; width: number } | null> =
      await Promise.all(
        (
          await calendar(page)
            .locator(".rbc-month-row", {
              has: eventLink(page, "Network switch firmware"),
            })
            .locator(".oneuptime-calendar-event--overlay")
            .all()
        ).map((shift: Locator) => {
          return shift.boundingBox();
        }),
      );
    const shiftsOfToday: Array<{ x: number; y: number; width: number }> =
      shifts.filter(
        (
          box: { x: number; y: number; width: number } | null,
        ): box is { x: number; y: number; width: number } => {
          return (
            box !== null &&
            box.x < today!.x + today!.width &&
            box.x + box.width > today!.x
          );
        },
      );

    for (const shift of shiftsOfToday) {
      expect(shift.y).toBeGreaterThan(today!.y);
    }

    // The shifts the cell has no room for are in its +N more.
    await expect(
      calendar(page).getByText(SHOW_MORE_PATTERN).first(),
    ).toBeVisible();

    await shot(page, "calendar-external-busy");
  });

  test("in the week, a keyboard stops on the project's events but never on another calendar's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "external=some");
    await calendarSettled(page);
    await calendar(page).getByTestId("calendar-view-switch-week").click();
    await calendarSettled(page);
    await expect(overlayEvent(page, "Payments release window")).toBeVisible();

    const blocks: Array<{ overlay: boolean; tabIndex: number; role: string }> =
      await calendar(page)
        .locator(".rbc-time-content .rbc-event")
        .evaluateAll((elements: Array<Element>) => {
          return elements.map((element: Element) => {
            return {
              overlay: element.classList.contains(
                "oneuptime-calendar-event--overlay",
              ),
              tabIndex: (element as HTMLElement).tabIndex,
              role: element.getAttribute("role") || "",
            };
          });
        });

    expect(
      blocks.filter((block: { overlay: boolean }) => {
        return block.overlay;
      }),
    ).toEqual([{ overlay: true, tabIndex: -1, role: "" }]);
    expect(
      blocks.filter((block: { overlay: boolean }) => {
        return !block.overlay;
      }),
    ).toEqual([{ overlay: false, tabIndex: 0, role: "button" }]);
  });

  test("Calendar settings under the toggles leads to Calendar Settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "external=some");
    await calendarSettled(page);

    await toggles(page)
      .getByRole("link", { name: "Calendar settings" })
      .click();
    await expect(page.getByText("External Calendars").first()).toBeVisible();
    expect(addressOf(page)).toMatch(SETTINGS_ADDRESS_PATTERN);

    // To look at them, not to add one: no dialog opens.
    await expect(page.getByTestId("modal")).toHaveCount(0);
  });

  test("Add External Calendar in the calendar's menu opens Calendar Settings with its Add dialog open, once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await calendarSettled(page);

    await cardMenuButton(page).click();
    await page.getByRole("menuitem", { name: "Add External Calendar" }).click();

    const dialog: Locator = page.getByTestId("modal");

    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Add New External Calendar", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText("Calendar Link").first()).toBeVisible();
    expect(addressOf(page)).toMatch(SETTINGS_ADDRESS_PATTERN);

    // The ask has left the address: a refresh opens the page alone.
    expect(new URL(page.url()).search).toBe("");

    await shot(page, "settings-add-from-calendar");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("External Calendars").first()).toBeVisible();
    await expect(page.getByTestId("modal")).toHaveCount(0);
  });

  test("a reader who may not add a calendar or an event sees the external calendars, and finds Add External Calendar locked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=viewer&external=some");
    await calendarSettled(page);

    // They see the calendars and may hide one for themselves.
    await expect(overlayEvent(page, "Founders' Day")).toBeVisible();
    await expect(toggleNamed(page, "Public holidays", true)).toBeEnabled();

    /*
     * Locked as every action they may not take is (PermissionGate): in the
     * menu, saying why on hover, and doing nothing.
     */
    await cardMenuButton(page).click();

    const add: Locator = page.getByRole("menuitem", {
      name: "Add External Calendar",
    });

    await expect(add).toHaveAttribute("aria-disabled", "true");
    // Forced: Playwright waits for an aria-disabled item to be enabled.
    await add.click({ force: true });
    await expect(page.getByTestId("fixture-navigated")).toHaveCount(0);
    expect(addressOf(page)).toMatch(CALENDAR_ADDRESS_PATTERN);
  });
});

test.describe("Calendar Settings", () => {
  test("lists each calendar: its colour, name and host, how it is doing and its last read; the link is never asked for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=settings&external=some");

    await expect(settingsRow(page, "Public holidays")).toBeVisible();
    await expect(settingsRow(page, "Public holidays")).toContainText(
      "calendar.google.com",
    );
    await expect(settingsRow(page, "Public holidays")).toContainText("Working");
    await expect(settingsRow(page, "Public holidays")).toContainText(
      "3 events",
    );
    await expect(settingsRow(page, "Change freezes")).toContainText("Working");
    await expect(settingsRow(page, "Payments project")).toContainText("Off");

    // The side menu opens its folded Settings on this page, and marks it.
    const item: Locator = sideMenu(page).getByRole("link", {
      name: "Calendar Settings",
    });

    await expect(item).toBeVisible();
    await expect(item).toHaveClass(ACTIVE_ITEM_PATTERN);

    for (const request of (await fixtureState(page)).requests) {
      expect(
        (request as { select?: Array<string> }).select || [],
      ).not.toContain("calendarUrl");
    }

    await shot(page, "settings");
  });

  test("a calendar that could not be read says why, under Not working", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=settings&external=failing");

    const row: Locator = settingsRow(page, "Change freezes");

    await expect(row).toContainText("Not working");
    await expect(row).toContainText(
      "There is no calendar at this link. Check it, or copy a new one from the calendar.",
    );
  });

  test("a calendar never read yet is waiting for its first read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=settings&external=waiting");

    const row: Locator = settingsRow(page, "Team offsite");

    await expect(row).toContainText("Waiting for the first read");
    await expect(row).toContainText("Not yet");
  });

  test("adding one: a Name and its link, Color and Refresh folded under More fields, and it is read at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=settings");

    /*
     * A project with none is offered its first in the empty table, beside
     * the same button in the card's header.
     */
    const firstAdd: Locator = page.getByTestId("empty-table-create-button");

    await expect(firstAdd).toContainText("Add External Calendar");
    await expect(
      page
        .getByTestId("card-button")
        .filter({ hasText: "Add External Calendar" }),
    ).toBeVisible();
    await shot(page, "settings-empty");

    await firstAdd.click();

    const dialog: Locator = page.getByTestId("modal");

    await expect(dialog).toContainText("Add New External Calendar");

    // Color and Refresh wait folded under More fields, which names them.
    const folded: Locator = dialog.getByTestId("folded-section-body");

    await expect(folded).toBeHidden();
    await expect(dialog.getByTestId("folded-section-header")).toContainText(
      "Color",
    );
    await expect(dialog.getByTestId("folded-section-header")).toContainText(
      "Refresh",
    );

    await dialog.getByText("More fields").click();
    await expect(folded.getByText("Color", { exact: true })).toBeVisible();
    await expect(folded.getByText("Refresh", { exact: true })).toBeVisible();

    await dialog.getByPlaceholder("Public holidays").fill("Bank holidays");
    await dialog
      .getByPlaceholder(
        "https://calendar.google.com/calendar/ical/.../basic.ics",
      )
      .fill("webcal://calendar.example.com/bank-holidays.ics");

    await shot(page, "settings-create", dialog);

    await dialog.getByRole("button", { name: "Add External Calendar" }).click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    const requests: Array<FixtureRequest> = (await fixtureState(page)).requests;
    const save: FixtureRequest | undefined = requests.find(
      (request: FixtureRequest) => {
        return (
          request.kind === "save" &&
          request.tableName === "ScheduledMaintenanceExternalCalendar"
        );
      },
    );

    expect(save).toBeDefined();
    expect(save!.data!["name"]).toBe("Bank holidays");
    expect(save!.data!["calendarUrl"]).toBe(
      "webcal://calendar.example.com/bank-holidays.ics",
    );
    // Left folded, they are what the form picked: a colour, and every hour.
    expect(save!.data!["refreshIntervalInMinutes"]).toBe(60);
    expect(JSON.stringify(save!.data!["color"])).toMatch(HEX_COLOR_PATTERN);

    // Read at once: the new row says so as the table reloads.
    await expect
      .poll(async () => {
        return (await fixtureState(page)).requests.filter(
          (request: FixtureRequest) => {
            return (
              request.kind === "api" &&
              request.method === "POST" &&
              (request.path || "").endsWith("/read-now")
            );
          },
        ).length;
      })
      .toBe(1);
    await expect(settingsRow(page, "Bank holidays")).toContainText(
      "calendar.example.com",
    );
    await expect(settingsRow(page, "Bank holidays")).toContainText("Working");
  });

  test("a link that is not one is refused before anything is saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=settings");

    await page
      .getByTestId("card-button")
      .filter({ hasText: "Add External Calendar" })
      .click();

    const dialog: Locator = page.getByTestId("modal");

    await dialog.getByPlaceholder("Public holidays").fill("Files");
    await dialog
      .getByPlaceholder(
        "https://calendar.google.com/calendar/ical/.../basic.ics",
      )
      .fill("ftp://files.example.com/calendar.ics");
    await dialog.getByRole("button", { name: "Add External Calendar" }).click();

    await expect(dialog).toContainText(
      "The link must start with https://, http:// or webcal://.",
    );

    for (const request of (await fixtureState(page)).requests) {
      expect(request.kind).not.toBe("save");
    }
  });

  test("Change link replaces the link, and the new one is read at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=settings&external=some");
    await expect(settingsRow(page, "Public holidays")).toBeVisible();

    await rowAction(page, "Public holidays", "Change link");

    const dialog: Locator = page.getByTestId("modal");

    await expect(dialog).toContainText("Change the link of Public holidays");
    await dialog
      .getByPlaceholder("https://")
      .fill("https://calendar.example.com/holidays-2027.ics");
    await dialog.getByRole("button", { name: "Change link" }).click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    const requests: Array<FixtureRequest> = (await fixtureState(page)).requests;

    expect(
      requests.find((request: FixtureRequest) => {
        return request.kind === "update" && request.id === HOLIDAYS_ID;
      })?.data,
    ).toEqual({
      calendarUrl: "https://calendar.example.com/holidays-2027.ics",
    });
    expect(
      requests.some((request: FixtureRequest) => {
        return (
          request.kind === "api" &&
          request.method === "POST" &&
          (request.path || "").endsWith(`/${HOLIDAYS_ID}/read-now`)
        );
      }),
    ).toBe(true);

    await expect(settingsRow(page, "Public holidays")).toContainText(
      "calendar.example.com",
    );
  });

  test("Turn off stops a calendar, and Turn on brings it back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=settings&external=some");
    await expect(settingsRow(page, "Change freezes")).toContainText("Working");

    await rowAction(page, "Change freezes", "Turn off");
    await expect(settingsRow(page, "Change freezes")).toContainText("Off");

    expect(
      (await fixtureState(page)).requests.find((request: FixtureRequest) => {
        return request.kind === "update" && request.id === FREEZES_ID;
      })?.data,
    ).toEqual({ isEnabled: false });

    // Turned off, it offers Turn on and no Read now.
    await rowMenuButton(page, "Change freezes").click();
    await expect(page.getByRole("menuitem", { name: "Turn on" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Read now" })).toHaveCount(
      0,
    );
    await page.getByRole("menuitem", { name: "Turn on" }).click();
    await expect(settingsRow(page, "Change freezes")).toContainText("Working");
  });

  test("a Read now the server refuses says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=settings&external=some&readNow=fail");
    await expect(settingsRow(page, "Public holidays")).toBeVisible();

    await rowAction(page, "Public holidays", "Read now");

    await expect(
      page.getByText(
        "This calendar was read a moment ago. Try again in a few seconds.",
      ),
    ).toBeVisible();
  });
});

test.describe("the month", () => {
  test("opens on this month, asking for the days the grid shows, and draws each event as a link in its state's colour", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await expect(calendar(page)).toBeVisible();
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await expect(periodLabel(page)).toHaveText("October 2026");

    const reads: Array<FixtureRequest> = await calendarReads(page);

    expect(reads[0]!.query!["startsAt"]).toEqual({
      lessThanOrEqual: "2026-11-08T00:00:00.000Z",
    });
    expect(reads[0]!.query!["endsAt"]).toEqual({
      greaterThanOrEqual: "2026-09-24T00:00:00.000Z",
    });
    expect(reads[0]!.limit).toBe(500);

    /*
     * An event in progress is drawn in Ongoing's amber, one coming up in
     * Scheduled's black - soft, as the list's state pills are: a pale wash
     * of the colour, and a stripe of the colour itself down the left edge.
     */
    const ongoing: Locator = eventBlock(page, "Network switch firmware");
    const scheduled: Locator = eventBlock(page, "Database upgrade");

    for (const [block, stripe] of [
      [ongoing, "rgb(255, 191, 83) 3px 0px 0px 0px"],
      [scheduled, "rgb(0, 0, 0) 3px 0px 0px 0px"],
    ] as Array<[Locator, string]>) {
      await expect(block).toHaveClass(SOFT_BLOCK_PATTERN);

      const style: { background: string; shadow: string } =
        await block.evaluate((element: Element) => {
          return {
            background: getComputedStyle(element).backgroundColor,
            shadow: getComputedStyle(element).boxShadow,
          };
        });

      expect(stripeOf(style.shadow)).toBe(stripe);

      // A pale block, whatever its colour: never a solid black or amber one.
      for (const channel of channels(style.background)) {
        expect(channel).toBeGreaterThan(200);
      }
    }

    // The event that started in September and ended in October is there too.
    await expect(eventLink(page, "Certificate rotation")).toBeVisible();

    // The colours are named under the grid.
    await expect(
      page.getByTestId("scheduled-maintenance-calendar-legend"),
    ).toContainText("Scheduled");
    await expect(
      page.getByTestId("scheduled-maintenance-calendar-legend"),
    ).toContainText("Ongoing");

    // Today is marked.
    await expect(
      calendar(page).locator(".rbc-month-view .rbc-date-cell.rbc-now"),
    ).toHaveText("15");

    await shot(page, "month");
  });

  test("an event's link opens its page, and is named with its state", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");

    const link: Locator = eventLink(page, "Database upgrade");

    await expect(link).toHaveAttribute(
      "aria-label",
      "Database upgrade, Scheduled",
    );

    await link.click();

    await expect(page.getByTestId("fixture-navigated")).toContainText(
      `/dashboard/${PROJECT_ID}/scheduled-maintenance-events/30000000-0000-4000-8000-000000000002`,
    );
  });

  test("a keyboard reaches an event's link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await eventLink(page, "Database upgrade").focus();

    await expect(eventLink(page, "Database upgrade")).toBeFocused();
  });

  test("a busy day says how many more it holds", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "events=many");
    await expect(eventLink(page, "Patch window 1")).toBeVisible();

    const more: Locator = calendar(page).locator(".rbc-show-more").first();

    await expect(more).toBeVisible();
    await expect(more).toHaveText(SHOW_MORE_PATTERN);

    await shot(page, "month-busy-day");

    /*
     * The list it opens - drawn by react-big-calendar at the end of the
     * page's body, outside the calendar - is a small card of the day's
     * events as the grid draws them, and a day of sixty scrolls inside it
     * rather than running off the top of the page.
     */
    await more.click();

    const list: Locator = page.locator(".rbc-overlay");

    await expect(list).toBeVisible();
    await expect(list.locator(".rbc-overlay-header")).toHaveText(
      "Thursday Oct 22",
    );

    const box: { y: number; height: number } | null = await list.boundingBox();

    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.height).toBeLessThanOrEqual(321);
    expect(
      await list.evaluate((element: Element) => {
        return {
          overflowY: getComputedStyle(element).overflowY,
          scrolls: element.scrollHeight > element.clientHeight,
        };
      }),
    ).toEqual({ overflowY: "auto", scrolls: true });

    // Its events are the grid's soft blocks, and links to their events.
    const first: Locator = list.locator(".rbc-event").first();

    await expect(first).toHaveClass(SOFT_BLOCK_PATTERN);
    expect(
      await first.evaluate((element: Element) => {
        return getComputedStyle(element).fontSize;
      }),
    ).toBe("12px");
    await expect(
      first.getByTestId("scheduled-maintenance-calendar-event"),
    ).toHaveAttribute("href", EVENT_PAGE_PATTERN);

    await shot(page, "month-busy-day-list");
  });

  test("the arrows move through the months, asking for each, and Today comes back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    const next: Locator = calendar(page).getByRole("button", {
      name: "Next month",
    });

    // Named on hover too.
    await expect(next).toHaveAttribute("title", "Next month");

    await next.click();

    await expect(periodLabel(page)).toHaveText("November 2026");
    await expect(eventLink(page, "Kernel update")).toBeVisible();

    const reads: Array<FixtureRequest> = await calendarReads(page);

    expect(reads[reads.length - 1]!.query!["endsAt"]).toEqual({
      greaterThanOrEqual: "2026-11-01T00:00:00.000Z",
    });

    await calendar(page)
      .getByRole("button", { name: "Previous month" })
      .click();
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await next.click();
    await next.click();
    await expect(periodLabel(page)).toHaveText("December 2026");

    await calendar(page).getByRole("button", { name: "Today" }).click();
    await expect(periodLabel(page)).toHaveText("October 2026");
  });

  test("a keyboard moves through the months with the arrow it is on, which keeps the focus while each month loads", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "delay=400");
    await expect(eventLink(page, "Database upgrade")).toBeVisible({
      timeout: 10000,
    });

    const next: Locator = calendar(page).getByRole("button", {
      name: "Next month",
    });

    await next.focus();
    await page.keyboard.press("Enter");

    // Loading the month is said beside it, and the arrow still has the focus.
    await expect(
      calendar(page).getByTestId("scheduled-maintenance-calendar-loading"),
    ).toBeVisible();
    await expect(next).toBeFocused();

    await page.keyboard.press("Enter");

    await expect(periodLabel(page)).toHaveText("December 2026");
    await expect(next).toBeFocused();
    await expect(
      page.getByTestId("scheduled-maintenance-calendar-loading"),
    ).toHaveCount(0, { timeout: 10000 });
    await expect(next).toBeFocused();
  });

  test("the toolbar is the product's own: Today and the arrows on the left, Month | Week | Day as the page's view switch", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    const toolbar: Locator = calendar(page).getByTestId("calendar-toolbar");
    const views: Locator = toolbar.getByRole("group", {
      name: "Calendar range",
    });

    await expect(views.getByRole("button")).toHaveText([
      "Month",
      "Week",
      "Day",
    ]);
    await expect(views.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // react-big-calendar's own "Today | Back | Next" box is gone.
    await expect(calendar(page).locator(".rbc-toolbar")).toHaveCount(0);

    // Today, the arrows and the month read left to right on one line.
    const today: { x: number; y: number } | null = await toolbar
      .getByRole("button", { name: "Today" })
      .boundingBox();
    const label: { x: number; y: number } | null =
      await periodLabel(page).boundingBox();
    const switchBox: { x: number; y: number; width: number } | null =
      await views.boundingBox();
    const toolbarBox: { x: number; width: number } | null =
      await toolbar.boundingBox();

    expect(today!.x).toBeLessThan(label!.x);
    expect(Math.abs(today!.y - label!.y)).toBeLessThan(12);

    // The switch at the right end.
    expect(
      Math.abs(
        switchBox!.x + switchBox!.width - (toolbarBox!.x + toolbarBox!.width),
      ),
    ).toBeLessThan(2);
  });

  test("Week shows the week's days hour by hour", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");

    await calendar(page).getByRole("button", { name: "Week" }).click();

    await expect(calendar(page).locator(".rbc-time-view")).toBeVisible();
    await expect(eventLink(page, "Network switch firmware")).toBeVisible();
    await expect(eventLink(page, "Database upgrade")).toHaveCount(0);

    await shot(page, "week");
  });

  test("with nothing in the period it says so, and still offers the calendar link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "events=none");

    await expect(
      page.getByTestId("scheduled-maintenance-calendar-empty"),
    ).toHaveText("No scheduled maintenance in this period.");
    await expect(
      page.getByTestId("scheduled-maintenance-calendar-subscribe"),
    ).toBeVisible();
  });

  test("a read that fails says so, and Try again reads the month", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "events=error");

    const alert: Locator = page.getByTestId(
      "scheduled-maintenance-calendar-error",
    );

    await expect(alert).toContainText("Could not load the events.");
    await expect(alert).toContainText(
      "The maintenance service is not responding.",
    );

    await alert.getByText("Try again").click();

    await expect(alert).toHaveCount(0);
    await expect(eventLink(page, "Database upgrade")).toBeVisible();
  });

  test("a slow read says it is loading, and the grid stays where it is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "delay=1500");

    await expect(
      page.getByTestId("scheduled-maintenance-calendar-loading"),
    ).toBeVisible();
    await expect(calendar(page).locator(".rbc-month-view")).toBeVisible();
    await expect(eventLink(page, "Database upgrade")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByTestId("scheduled-maintenance-calendar-loading"),
    ).toHaveCount(0);
  });
});

test.describe("schedule maintenance on a day", () => {
  test("a day still to come has a + that opens the create form on that day, at the hour the form would pick", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    // The days to come start at today, the 15th: the sixth is the 20th.
    const add: Locator = calendar(page)
      .getByTestId("scheduled-maintenance-calendar-add")
      .nth(5);

    await expect(add).toHaveAttribute(
      "aria-label",
      SCHEDULE_ON_THE_20TH_PATTERN,
    );

    await add
      .locator("xpath=ancestor::*[contains(@class,'rbc-month-row')][1]")
      .hover();
    await expect(add).toHaveCSS("opacity", "1");

    await shot(page, "month-day-action");

    await add.click();

    await expect(page.getByTestId("fixture-navigated")).toContainText(
      `/dashboard/${PROJECT_ID}/scheduled-maintenance-events/create`,
    );
    expect(new URL(page.url()).searchParams.get("startsAt")).toBe(
      "2026-10-20T11:00:00.000Z",
    );
  });

  test("today has one; a day that is over has none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    const buttons: Locator = calendar(page).getByTestId(
      "scheduled-maintenance-calendar-add",
    );

    // 15 October (today) to 31 October.
    await expect(buttons).toHaveCount(17);
  });

  test("a reader who may not create events gets none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=viewer");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await expect(
      calendar(page).getByTestId("scheduled-maintenance-calendar-add"),
    ).toHaveCount(0);
  });
});

test.describe("Subscribe to calendar", () => {
  test("a published link: Google Calendar, Apple Calendar / Outlook, or the link to copy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    const dialog: Locator = await openSubscribe(page);

    const webcal: string = `webcal://oneuptime.example.com/api/scheduled-maintenance-calendar/project/${FIRST_TOKEN}/maintenance.ics`;

    await expect(
      dialog.getByTestId("maintenance-calendar-feed-webcal"),
    ).toHaveAttribute("href", webcal);

    const google: URL = new URL(
      (await dialog
        .getByTestId("maintenance-calendar-feed-google")
        .getAttribute("href")) || "",
    );

    expect(google.hostname).toBe("calendar.google.com");
    expect(google.searchParams.get("cid")).toBe(webcal);

    await dialog.getByTestId("maintenance-calendar-feed-copy-button").click();

    await expect
      .poll(async () => {
        return (await fixtureState(page)).copied;
      })
      .toEqual([
        `https://oneuptime.example.com/api/scheduled-maintenance-calendar/project/${FIRST_TOKEN}/maintenance.ics`,
      ]);

    await expect(
      dialog.getByTestId("maintenance-calendar-feed-ownership"),
    ).toContainText("treat it like a password");

    await shot(page, "subscribe-active", page.getByTestId("modal"));
  });

  test("an editor regenerates the link from the dialog's menu, after confirming", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await openSubscribe(page);

    await page.getByRole("button", { name: "Manage link" }).click();
    await page.getByRole("menu").getByText("Regenerate link").click();

    const confirm: Locator = page.getByRole("dialog", {
      name: "Regenerate calendar link?",
    });

    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Regenerate link" }).click();

    await expect
      .poll(async () => {
        return (await fixtureState(page)).requests.filter(
          (request: FixtureRequest) => {
            return (
              request.method === "POST" &&
              (request.path || "").endsWith("/project-feed/rotate")
            );
          },
        ).length;
      })
      .toBe(1);

    await expect(confirm).toHaveCount(0);

    // The dialog now holds the new link, and the old one is gone.
    expect(
      await page
        .getByTestId("maintenance-calendar-feed-webcal")
        .getAttribute("href"),
    ).toContain(`/project/${NEXT_TOKEN}/maintenance.ics`);
  });

  test("an editor disables the link, and the dialog says it is disabled", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");
    await openSubscribe(page);

    await page.getByRole("button", { name: "Manage link" }).click();
    await page.getByRole("menu").getByText("Disable link").click();

    await expect
      .poll(async () => {
        return (await fixtureState(page)).requests.filter(
          (request: FixtureRequest) => {
            return (
              request.kind === "update" &&
              request.tableName === "ScheduledMaintenanceCalendarFeed"
            );
          },
        );
      })
      .toEqual([
        {
          kind: "update",
          tableName: "ScheduledMaintenanceCalendarFeed",
          id: "40000000-0000-4000-8000-000000000009",
          data: { isEnabled: false },
        },
      ]);

    await expect(
      page.getByTestId("maintenance-calendar-feed-status-pill"),
    ).toHaveAttribute("data-health", "disabled");
    await shot(page, "subscribe-turned-off", page.getByTestId("modal"));
  });

  test("a project with no link yet: an editor publishes one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "feed=empty");
    const dialog: Locator = await openSubscribe(page);

    await expect(
      dialog.getByTestId("maintenance-calendar-feed-empty"),
    ).toBeVisible();
    await shot(page, "subscribe-empty", page.getByTestId("modal"));

    await dialog.getByTestId("maintenance-calendar-feed-publish").click();

    await expect(
      dialog.getByTestId("maintenance-calendar-feed-links"),
    ).toBeVisible();
    expect(
      await dialog
        .getByTestId("maintenance-calendar-feed-webcal")
        .getAttribute("href"),
    ).toContain(`/project/${FIRST_TOKEN}/maintenance.ics`);
  });

  test("a reader held to some events is told why the link is not theirs, with nothing to retry", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "feed=restricted");
    const dialog: Locator = await openSubscribe(page);

    await expect(
      dialog.getByTestId("maintenance-calendar-feed-restricted"),
    ).toContainText("You can see only some of this project's scheduled");
    await expect(dialog.getByText("Try again")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage link" })).toHaveCount(
      0,
    );

    // Still on the page: no detour to a Forbidden page.
    await expect(calendar(page)).toBeVisible();
    await shot(page, "subscribe-restricted", page.getByTestId("modal"));
  });

  test("Done closes the dialog", async ({ page }: { page: Page }) => {
    await open(page, "");
    await openSubscribe(page);

    await page.getByRole("button", { name: "Done" }).click();

    await expect(
      page.getByTestId("maintenance-calendar-feed-dialog"),
    ).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test("the month fits the screen, without the day's +, and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "", 390);
    await expect(eventLink(page, "Database upgrade")).toBeAttached();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const grid: Locator = calendar(page).locator(".rbc-month-view");
    const gridBox: { x: number; width: number } | null =
      await grid.boundingBox();

    expect(gridBox).not.toBeNull();
    expect(gridBox!.x + gridBox!.width).toBeLessThanOrEqual(390);

    await expect(
      calendar(page).getByTestId("scheduled-maintenance-calendar-add").first(),
    ).toBeHidden();

    await shot(page, "phone-month");
  });

  test("the header keeps Create and the ⋯ on one line, as All Events does", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const query of ["", "page=list"]) {
      await open(page, query, 390);
      await expect(page.getByTestId("card-button").first()).toBeVisible();

      const create: { y: number; height: number } | null = await page
        .getByTestId("card-button")
        .first()
        .boundingBox();
      const more: { y: number; height: number } | null =
        await cardMenuButton(page).boundingBox();

      // The ⋯ sits beside Create, its middle within Create's height.
      const middle: number = more!.y + more!.height / 2;

      expect({ query, beside: middle > create!.y }).toEqual({
        query,
        beside: true,
      });
      expect({
        query,
        beside: middle < create!.y + create!.height,
      }).toEqual({ query, beside: true });
    }

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("the Subscribe dialog fits too", async ({ page }: { page: Page }) => {
    await open(page, "", 390);
    await openSubscribe(page);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "phone-subscribe", page.getByTestId("modal"));
  });

  test("the external calendars' toggles wrap, and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "external=failing", 390);
    await calendarSettled(page);
    await expect(toggles(page)).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const box: { x: number; width: number } | null =
      await toggles(page).boundingBox();

    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    await shot(page, "phone-external");
  });

  test("Calendar Settings fits too", async ({ page }: { page: Page }) => {
    await open(page, "page=settings&external=failing", 390);
    // Exact: the card's description names change freezes too.
    await expect(
      page.getByText("Change freezes", { exact: true }).first(),
    ).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "phone-settings");
  });
});

test.describe("in the dark theme", () => {
  test("today keeps its accent, and a black state's block and legend dot keep an edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "theme=dark");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    const today: Locator = calendar(page)
      .locator(".rbc-month-view .rbc-day-bg.rbc-today")
      .first();
    const otherDay: Locator = calendar(page)
      .locator(
        ".rbc-month-view .rbc-day-bg:not(.rbc-today):not(.rbc-off-range-bg)",
      )
      .first();

    const todayColor: string = await today.evaluate((element: Element) => {
      return getComputedStyle(element).backgroundColor;
    });
    const otherColor: string = await otherDay.evaluate((element: Element) => {
      return getComputedStyle(element).backgroundColor;
    });

    expect(todayColor).not.toBe(otherColor);

    const scheduledBlock: Locator = eventBlock(page, "Database upgrade");

    const block: { background: string; text: string; shadow: string } =
      await scheduledBlock.evaluate((element: Element) => {
        return {
          background: getComputedStyle(element).backgroundColor,
          text: getComputedStyle(element).color,
          shadow: getComputedStyle(element).boxShadow,
        };
      });

    expect(block.shadow).not.toBe("none");

    /*
     * The dark theme's tone, swapped in by Theme.css: a dark block, not the
     * light theme's pale one, with light text, and a stripe that is no
     * longer black - black would not show on the dark card.
     */
    expect(Math.max(...channels(block.background))).toBeLessThan(80);
    expect(Math.min(...channels(block.text))).toBeGreaterThan(150);
    expect(Math.max(...channels(stripeOf(block.shadow)))).toBeGreaterThan(90);

    const legendDot: { background: string; shadow: string } = await page
      .locator(".oneuptime-calendar-legend-dot")
      .first()
      .evaluate((element: Element) => {
        return {
          background: getComputedStyle(element).backgroundColor,
          shadow: getComputedStyle(element).boxShadow,
        };
      });

    expect(legendDot.shadow).not.toBe("none");
    // Scheduled's dot is the stripe's shade: lighter than black here too.
    expect(Math.max(...channels(legendDot.background))).toBeGreaterThan(90);

    await shot(page, "dark-month");
  });

  test("the week's grid is quiet on the dark theme: dark day names, and only the hours' lines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "theme=dark");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await calendar(page).getByRole("button", { name: "Week" }).click();
    await expect(calendar(page).locator(".rbc-time-view")).toBeVisible();

    // The day names are on a dark band, not the light theme's grey one.
    const header: string = await calendar(page)
      .locator(".rbc-time-header-content .rbc-header")
      .first()
      .evaluate((element: Element) => {
        return getComputedStyle(element).backgroundColor;
      });

    expect(Math.max(...channels(header))).toBeLessThan(80);

    // The half hours draw no line of their own.
    const halfHour: string = await calendar(page)
      .locator(".rbc-day-slot .rbc-time-slot")
      .nth(1)
      .evaluate((element: Element) => {
        return getComputedStyle(element).borderTopColor;
      });

    expect(halfHour).toBe("rgba(0, 0, 0, 0)");

    await shot(page, "dark-week");
  });

  test("the Subscribe dialog reads on the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "theme=dark");
    await openSubscribe(page);

    const modalBackground: Array<number> = channels(
      await page.getByTestId("modal").evaluate((element: Element) => {
        let node: Element | null = element;

        while (node) {
          const color: string = getComputedStyle(node).backgroundColor;

          if (color && color !== "rgba(0, 0, 0, 0)") {
            return color;
          }

          node = node.parentElement;
        }

        return "";
      }),
    );

    // A dark surface, not the light theme's white.
    expect(Math.max(...modalBackground)).toBeLessThan(100);
    await shot(page, "dark-subscribe", page.getByTestId("modal"));
  });

  test("an external calendar's blocks are dark too, their stripes and dashed edge kept", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "theme=dark&external=some");
    await calendarSettled(page);
    await expect(overlayEvent(page, "Founders' Day")).toBeVisible();

    const block: {
      background: string;
      text: string;
      border: string;
      image: string;
    } = await overlayBlock(page, "Founders' Day").evaluate(
      (element: Element) => {
        return {
          background: getComputedStyle(element).backgroundColor,
          text: getComputedStyle(element).color,
          border: getComputedStyle(element).borderTopStyle,
          image: getComputedStyle(element).backgroundImage,
        };
      },
    );

    expect(Math.max(...channels(block.background))).toBeLessThan(80);
    expect(Math.max(...channels(block.text))).toBeGreaterThan(150);
    expect(block.border).toBe("dashed");
    expect(block.image).toMatch(STRIPES_PATTERN);

    await shot(page, "dark-external");
  });

  test("Calendar Settings reads on the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=settings&theme=dark&external=failing");
    await expect(settingsRow(page, "Change freezes")).toContainText(
      "Not working",
    );

    const name: Array<number> = channels(
      await settingsRow(page, "Change freezes")
        .getByText("Change freezes")
        .first()
        .evaluate((element: Element) => {
          return getComputedStyle(element).color;
        }),
    );

    // Light text on the dark card, not the light theme's near-black.
    expect(Math.min(...name)).toBeGreaterThan(150);
    await shot(page, "dark-settings");
  });
});

test.describe("in other languages", () => {
  test("German: the side menu, the toolbar, the external calendars and the link's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=de&external=some");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await expect(
      sideMenu(page).getByRole("link", { name: "Wartungskalender" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Wartungskalender" }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Externe Kalender" }),
    ).toBeVisible();
    // A toggle is named by its calendar; its hint is German.
    await expect(toggleNamed(page, "Public holidays", true)).toHaveAttribute(
      "title",
      "Public holidays im Kalender ausblenden",
    );
    await expect(
      toggles(page).getByRole("link", { name: "Kalendereinstellungen" }),
    ).toBeVisible();
    await expect(
      calendar(page).getByRole("button", { name: "Heute" }),
    ).toBeVisible();

    // The arrows are named in German, for a screen reader and on hover.
    await expect(
      calendar(page).getByRole("button", { name: "Nächster Monat" }),
    ).toHaveAttribute("title", "Nächster Monat");
    await expect(
      calendar(page).getByRole("group", { name: "Kalenderzeitraum" }),
    ).toBeVisible();

    // The month and the day names are German too, not the grid's English.
    await expect(periodLabel(page)).toHaveText("Oktober 2026");
    await expect(
      calendar(page).locator(".rbc-month-view .rbc-header").first(),
    ).toHaveText("So");
    await expect(
      page.getByTestId("scheduled-maintenance-calendar-subscribe"),
    ).toHaveText("Kalender abonnieren");

    await shot(page, "german-month");
  });

  test("Japanese: the toolbar and the empty line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "events=none&lang=ja");

    await expect(
      page.getByTestId("scheduled-maintenance-calendar-empty"),
    ).toHaveText("この期間に定期メンテナンスはありません。");
    await expect(periodLabel(page)).toHaveText("2026年10月");
  });
});
