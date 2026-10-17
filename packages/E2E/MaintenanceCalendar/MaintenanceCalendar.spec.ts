import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * Scheduled Maintenance > Events as a calendar, end to end in a browser, on
 * the real page against the fixture's in-page API (Fixture.js).
 *
 * The maintainer's ask: "We currently do not have calendar views and
 * calendar feeds for scheduling events." What only a browser shows is
 * pinned here: List | Calendar at the end of the filter bar and the choice
 * kept across a reload; the month grid with each event a link in its
 * state's colour and today marked; a busy day's "+N more"; Week; moving
 * through the months; the + that schedules maintenance on a day still to
 * come (and nowhere else); a slow or failing read; the Subscribe to
 * calendar dialog - publish, copy, regenerate, turn off, a reader held to
 * some events; a phone's width with nothing scrolling sideways; the dark
 * theme; German and Japanese.
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

async function showCalendar(page: Page): Promise<void> {
  await page.getByTestId("scheduled-maintenance-view-switch-calendar").click();
  await expect(calendar(page)).toBeVisible();
  await expect(
    page.getByTestId("scheduled-maintenance-calendar-loading"),
  ).toHaveCount(0);
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

test.describe("List | Calendar", () => {
  test("the list is what the page opens on, with the switch at the end of the filter bar", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");

    const switchGroup: Locator = page.getByTestId(
      "scheduled-maintenance-view-switch",
    );

    await expect(switchGroup).toBeVisible();
    await expect(
      page.getByTestId("scheduled-maintenance-view-switch-list"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("group", { name: "Show the events as" }),
    ).toBeVisible();

    // In the filter bar, at its right end - not in the card's header.
    await expect(
      page
        .getByTestId("filter-bar-end")
        .getByTestId("scheduled-maintenance-view-switch"),
    ).toBeVisible();

    await expect(calendar(page)).toHaveCount(0);
    await shot(page, "list-with-switch");
  });

  test("the choice of Calendar is kept: the page opens on it again after a reload", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=list");
    await showCalendar(page);

    await page.clock.setFixedTime(NOW);
    await page.goto("/");
    await expect(calendar(page)).toBeVisible();
    await expect(
      page.getByTestId("scheduled-maintenance-view-switch-calendar"),
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("scheduled-maintenance-view-switch-list").click();
    await expect(calendar(page)).toHaveCount(0);

    await page.clock.setFixedTime(NOW);
    await page.goto("/");
    await expect(
      page.getByTestId("scheduled-maintenance-view-switch-list"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("Subscribe to calendar is offered beside the list too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=list");

    await page.getByRole("button", { name: "More options" }).first().click();
    await page.getByText("Subscribe to calendar").click();

    await expect(
      page.getByTestId("maintenance-calendar-feed-dialog"),
    ).toBeVisible();
  });
});

test.describe("the month", () => {
  test("opens on this month, asking for the days the grid shows, and draws each event as a link in its state's colour", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=calendar");
    await expect(calendar(page)).toBeVisible();
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await expect(calendar(page).locator(".rbc-toolbar-label")).toHaveText(
      "October 2026",
    );

    const reads: Array<FixtureRequest> = await calendarReads(page);

    expect(reads[0]!.query!["startsAt"]).toEqual({
      lessThanOrEqual: "2026-11-08T00:00:00.000Z",
    });
    expect(reads[0]!.query!["endsAt"]).toEqual({
      greaterThanOrEqual: "2026-09-24T00:00:00.000Z",
    });
    expect(reads[0]!.limit).toBe(500);

    // An event in progress is drawn in Ongoing's amber, one coming up in Scheduled's black.
    const ongoing: Locator = eventBlock(page, "Network switch firmware");
    const scheduled: Locator = eventBlock(page, "Database upgrade");

    expect(
      channels(
        await ongoing.evaluate((element: Element) => {
          return getComputedStyle(element).backgroundColor;
        }),
      ),
    ).toEqual([255, 191, 83]);
    expect(
      channels(
        await scheduled.evaluate((element: Element) => {
          return getComputedStyle(element).backgroundColor;
        }),
      ),
    ).toEqual([0, 0, 0]);

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
    await open(page, "view=calendar");

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
    await open(page, "view=calendar");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await eventLink(page, "Database upgrade").focus();

    await expect(eventLink(page, "Database upgrade")).toBeFocused();
  });

  test("a busy day says how many more it holds", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=calendar&events=many");
    await expect(eventLink(page, "Patch window 1")).toBeVisible();

    const more: Locator = calendar(page).locator(".rbc-show-more").first();

    await expect(more).toBeVisible();
    await expect(more).toHaveText(SHOW_MORE_PATTERN);

    await shot(page, "month-busy-day");
  });

  test("Next and Back move through the months, asking for each", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=calendar");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await calendar(page).getByRole("button", { name: "Next" }).click();

    await expect(calendar(page).locator(".rbc-toolbar-label")).toHaveText(
      "November 2026",
    );
    await expect(eventLink(page, "Kernel update")).toBeVisible();

    const reads: Array<FixtureRequest> = await calendarReads(page);

    expect(reads[reads.length - 1]!.query!["endsAt"]).toEqual({
      greaterThanOrEqual: "2026-11-01T00:00:00.000Z",
    });

    await calendar(page).getByRole("button", { name: "Back" }).click();
    await expect(eventLink(page, "Database upgrade")).toBeVisible();
  });

  test("Week shows the week's days hour by hour", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=calendar");

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
    await open(page, "view=calendar&events=none");

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
    await open(page, "view=calendar&events=error");

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
    await open(page, "view=calendar&delay=1500");

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
    await open(page, "view=calendar");
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
    await open(page, "view=calendar");
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
    await open(page, "view=calendar&role=viewer");
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
    await open(page, "view=calendar");
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
    await open(page, "view=calendar");
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

  test("an editor turns the link off, and the dialog says it is off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=calendar");
    await openSubscribe(page);

    await page.getByRole("button", { name: "Manage link" }).click();
    await page.getByRole("menu").getByText("Turn off link").click();

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
    await open(page, "view=calendar&feed=empty");
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
    await open(page, "view=calendar&feed=restricted");
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
    await open(page, "view=calendar");
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
    await open(page, "view=calendar", 390);
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

  test("the Subscribe dialog fits too", async ({ page }: { page: Page }) => {
    await open(page, "view=calendar", 390);
    await openSubscribe(page);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "phone-subscribe", page.getByTestId("modal"));
  });
});

test.describe("in the dark theme", () => {
  test("today keeps its accent, and a black state's block and legend dot keep an edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=calendar&theme=dark");
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

    expect(
      await scheduledBlock.evaluate((element: Element) => {
        return getComputedStyle(element).boxShadow;
      }),
    ).not.toBe("none");

    expect(
      await page
        .locator(".oneuptime-calendar-legend-dot")
        .first()
        .evaluate((element: Element) => {
          return getComputedStyle(element).boxShadow;
        }),
    ).not.toBe("none");

    await shot(page, "dark-month");
  });

  test("the Subscribe dialog reads on the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=calendar&theme=dark");
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
});

test.describe("in other languages", () => {
  test("German: the switch, the toolbar and the link's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "view=calendar&lang=de");
    await expect(eventLink(page, "Database upgrade")).toBeVisible();

    await expect(
      page.getByTestId("scheduled-maintenance-view-switch-list"),
    ).toHaveText("Liste");
    await expect(
      page.getByTestId("scheduled-maintenance-view-switch-calendar"),
    ).toHaveText("Kalender");
    await expect(
      calendar(page).getByRole("button", { name: "Heute" }),
    ).toBeVisible();

    // The month and the day names are German too, not the grid's English.
    await expect(calendar(page).locator(".rbc-toolbar-label")).toHaveText(
      "Oktober 2026",
    );
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
    await open(page, "view=calendar&events=none&lang=ja");

    await expect(
      page.getByTestId("scheduled-maintenance-calendar-empty"),
    ).toHaveText("この期間に定期メンテナンスはありません。");
    await expect(calendar(page).locator(".rbc-toolbar-label")).toHaveText(
      "2026年10月",
    );
  });
});
