import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { MAINTENANCE_CALENDAR } from "./ScheduledMaintenanceDocsPages";
import { readPage } from "./DocsContentSupport";
import {
  PACKAGES_DIR,
  readCommonSource,
  readDashboardSource,
} from "./DocsDashboardMenus";
import { escapeRegExp } from "./DocsTranslationChecks";
import {
  MAINTENANCE_CALENDAR_VIEW_LIMIT,
  getScheduleStartForDay,
} from "../../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarView";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCalendarFeed from "Common/Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import Permission from "Common/Types/Permission";
import { PREVIOUS_TOKEN_GRACE_DAYS } from "Common/Types/OnCallDutyPolicy/CalendarFeedWindow";
import MaintenanceCalendar, {
  MAINTENANCE_CALENDAR_FILE_NAME,
  MAINTENANCE_CALENDAR_MAX_EVENTS,
  MaintenanceCalendarAudience,
} from "Common/Types/ScheduledMaintenance/MaintenanceCalendar";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Maintenance Calendar page names a great deal of the product: the
 * List | Calendar switch and what the calendar view does, the team's
 * calendar link and its dialog, who may hold the link, how long a
 * regenerated link stays an empty calendar, the window and the cap of the
 * team's calendar, a status page's calendar and its Add to calendar, what
 * every calendar event holds, and how long OneUptime keeps a calendar.
 * Markdown is not compiled, so nothing else notices when the product moves
 * on.
 *
 * These hold the English page to the source: Common's models and types and
 * the Dashboard's React-free calendar module imported, the Dashboard's
 * components, the status page's and the server's code read as text (an App
 * test must not import React components, nor any package but App and
 * Common). ScheduledMaintenanceDocsTranslations then holds every language
 * to the English page.
 */

const PAGE: string = readPage("en", MAINTENANCE_CALENDAR);

function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

// A number a constant is declared with: `NAME: number = 90;`.
function declaredNumber(source: string, name: string): number {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`${escapeRegExp(name)}: number =\\s*(\\d+)\\s*;`),
  );

  expect({ name: name, declared: Boolean(match) }).toEqual({
    name: name,
    declared: true,
  });

  return parseInt(match![1]!, 10);
}

// A string a constant is declared with: `NAME: string =\n  "value";`.
function declaredString(source: string, name: string): string {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`${escapeRegExp(name)}: string =\\s*"([^"]*)"`),
  );

  expect({ name: name, declared: Boolean(match) }).toEqual({
    name: name,
    declared: true,
  });

  return match![1]!;
}

const DASHBOARD_DIR: string = "Components/ScheduledMaintenance";
const FEED_DIR: string = "Components/OnCallPolicy/CalendarFeed";

const SUBSCRIBE_MODAL: string = readDashboardSource(
  `${DASHBOARD_DIR}/MaintenanceCalendarSubscribeModal.tsx`,
);
const CALENDAR_CARD: string = readDashboardSource(
  `${DASHBOARD_DIR}/ScheduledMaintenanceCalendar.tsx`,
);
const EVENTS_TABLE: string = readDashboardSource(
  `${DASHBOARD_DIR}/ScheduledMaintenanceTable.tsx`,
);
const VIEW_CHOICE: string = readDashboardSource(
  `${DASHBOARD_DIR}/ScheduledMaintenanceViewChoice.ts`,
);
const CALENDAR_API: string = readCommonSource(
  "Server/API/ScheduledMaintenanceCalendarAPI.ts",
);
const TEAM_CALENDAR: string = readCommonSource(
  "Server/Utils/ScheduledMaintenance/TeamMaintenanceCalendar.ts",
);
const RESPONSE: string = readCommonSource("Server/Utils/Response.ts");
const FEED_CACHE: string = readCommonSource(
  "Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedCache.ts",
);
const STATUS_PAGE_FEED: string = readCommonSource(
  "Server/Utils/StatusPage/StatusPageMaintenanceCalendarFeed.ts",
);
const STATUS_PAGE_BUTTONS: string = readPackageFile(
  "App/FeatureSet/StatusPage/src/Components/MaintenanceCalendar/MaintenanceCalendarButtons.tsx",
);
const STATUS_PAGE_EVENT: string = readPackageFile(
  "App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/Detail.tsx",
);
const STATUS_PAGE_EVENTS: string = readPackageFile(
  "App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/List.tsx",
);
const FRONTEND: string = readPackageFile("App/FeatureSet/Frontend/Index.ts");
const STATUS_PAGE_ENGLISH: {
  scheduledEvents: { calendar: Record<string, string> };
} = JSON.parse(
  readPackageFile("App/FeatureSet/StatusPage/src/Locales/en.json"),
) as { scheduledEvents: { calendar: Record<string, string> } };

describe("the Maintenance Calendar page in the nav", () => {
  it("is the last page of the Scheduled Maintenance group, where the Subscribe dialog's docs link opens", () => {
    const group: NavGroup | undefined = DocsNav.find(
      (candidate: NavGroup): boolean => {
        return candidate.title === "Scheduled Maintenance";
      },
    );

    expect(group).toBeDefined();

    const urls: Array<string> = group!.links.map((link: NavLink): string => {
      return link.url;
    });

    expect(urls[urls.length - 1]).toBe(`/docs/${MAINTENANCE_CALENDAR}`);

    // The dialog's "Learn more" goes to this page, by its address.
    expect(
      declaredString(SUBSCRIBE_MODAL, "MAINTENANCE_CALENDAR_DOCS_PATH"),
    ).toBe(`/${MAINTENANCE_CALENDAR}`);
  });
});

describe("the calendar view", () => {
  it("is switched on with List and Calendar, the list first, the choice remembered", () => {
    expect(PAGE).toContain("**List** and **Calendar** switch between");
    expect(PAGE).toContain("Your browser remembers the choice");

    const labels: Array<string> = Array.from(
      VIEW_CHOICE.matchAll(/label: translationKey\("([^"]+)"\)/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(labels).toEqual(["List", "Calendar"]);
    expect(VIEW_CHOICE).toContain(
      "defaultValue: ScheduledMaintenanceView.List",
    );
    expect(VIEW_CHOICE).toContain(
      "new RememberedView<ScheduledMaintenanceView>",
    );
    // At the right end of the filter bar, where the page says.
    expect(PAGE).toContain("At the right end of the filter bar");
    expect(EVENTS_TABLE).toContain("filterBarEnd: viewSwitch");
  });

  it("offers a month, a week and a day, opening on the month", () => {
    expect(PAGE).toContain("**Month**, **Week** and **Day**");

    /*
     * The toolbar is Today and two arrows (Common's CalendarToolbar), as
     * the on-call schedule timeline's - the page says it the same way.
     */
    expect(PAGE).toContain("move with the arrows and return with **Today**.");
    expect(PAGE).not.toContain("**Back**");

    const toolbar: string = readCommonSource(
      "UI/Components/Calendar/CalendarToolbar.tsx",
    );

    expect(toolbar).toContain("IconProp.ChevronLeft");
    expect(toolbar).toContain("IconProp.ChevronRight");
    expect(toolbar).toContain('navigate("TODAY")');
    expect(toolbar).toContain('translationKey("Next month")');
    expect(readCommonSource("UI/Components/Calendar/Calendar.tsx")).toContain(
      'today: translator.translateText("Today")',
    );
    expect(CALENDAR_CARD).toContain(
      "defaultCalendarView={DefaultCalendarView.Month}",
    );

    const views: RegExpMatchArray | null = CALENDAR_CARD.match(
      /views=\{\[\s*DefaultCalendarView\.Month,\s*DefaultCalendarView\.Week,\s*DefaultCalendarView\.Day,\s*\]\}/,
    );

    expect(views).not.toBeNull();
  });

  it("names the colour of each state under the calendar, and opens an event on a click", () => {
    expect(PAGE).toContain(
      "the states' colours are named under the calendar. Click an event to open it.",
    );
    expect(CALENDAR_CARD).toContain(
      'data-testid="scheduled-maintenance-calendar-legend"',
    );
    // Each block is a link to its event, and a click on the block opens it too.
    expect(CALENDAR_CARD).toContain("<Link");
    expect(CALENDAR_CARD).toContain(
      'data-testid="scheduled-maintenance-calendar-event"',
    );
    expect(CALENDAR_CARD).toContain("onEventClick={onEventClick}");
  });

  it("shows up to as many events in one view as the page says", () => {
    expect(PAGE).toContain(
      `One view shows up to ${MAINTENANCE_CALENDAR_VIEW_LIMIT} events.`,
    );
    expect(CALENDAR_CARD).toContain("limit: MAINTENANCE_CALENDAR_VIEW_LIMIT");
  });

  it("opens the create form from a day to come, with Starts At on that day at the hour the form picks today", () => {
    expect(PAGE).toContain(
      "It opens **Create Scheduled Maintenance Event** with **Starts At** on that day, at the hour the form would pick today.",
    );

    const now: Date = new Date(Date.UTC(2026, 9, 17, 10, 20, 0));

    // Tomorrow, at the next full hour of today.
    const tomorrow: Date | null = getScheduleStartForDay({
      day: new Date(2026, 9, 18),
      timezone: "UTC",
      now: now,
    });

    // 10:20 today: the form would pick 11:00, so tomorrow at 11:00.
    expect(tomorrow?.toISOString()).toBe("2026-10-18T11:00:00.000Z");

    // A day already gone has no +.
    expect(
      getScheduleStartForDay({
        day: new Date(2026, 9, 10),
        timezone: "UTC",
        now: now,
      }),
    ).toBeNull();

    // Only for a reader who may create events.
    expect(PAGE).toContain("You see it only if you can create events.");
    expect(CALENDAR_CARD).toContain("if (!props.canCreate)");

    // The create page reads the day it was given.
    expect(EVENTS_TABLE).toContain("startsAt: startsAt.toISOString()");
    expect(
      readDashboardSource("Pages/ScheduledMaintenanceEvents/Create.tsx"),
    ).toContain("startsAt");
  });
});

describe("the team's calendar link", () => {
  it("is opened by Subscribe to calendar, under the calendar and in the list's ⋯", () => {
    expect(PAGE).toContain(
      "**Subscribe to calendar**, under the calendar or in the list's **⋯** menu",
    );
    expect(CALENDAR_CARD).toContain('title="Subscribe to calendar"');
    expect(EVENTS_TABLE).toContain('title: "Subscribe to calendar"');
    // The list's secondary header buttons fold into its ⋯.
    expect(EVENTS_TABLE).toContain("[...cardbuttons, subscribeButton]");
  });

  it("is published, copied, regenerated and disabled with the buttons the page names", () => {
    for (const label of [
      "Publish link",
      "Regenerate link",
      "Disable link",
      "Enable link",
    ]) {
      expect(PAGE).toContain(`**${label}**`);
      expect(SUBSCRIBE_MODAL).toContain(`"${label}"`);
    }

    // The on-call links' words, which the Status panel answers with too.
    expect(PAGE).not.toContain("Turn off link");
    expect(PAGE).not.toContain("Turn on link");
    expect(readDashboardSource(`${FEED_DIR}/FeedStatusPanel.tsx`)).toContain(
      'title="Enable link"',
    );

    // Regenerate and Disable sit in the dialog's ⋯ (the manage menu).
    expect(PAGE).toContain(
      "**Regenerate link** and **Disable link** are in the **⋯** menu at the top of the dialog.",
    );
    expect(SUBSCRIBE_MODAL).toContain("getFeedManageMenuButtons");
    expect(SUBSCRIBE_MODAL).toContain("rightElement=");

    // The subscribe options and the copy button are the on-call links' own.
    expect(SUBSCRIBE_MODAL).toContain("<CalendarFeedLinks");

    const links: string = readDashboardSource(
      "Components/OnCallPolicy/CalendarFeedLinks.tsx",
    );

    expect(links).toContain('translateString("Google Calendar")');
    expect(links).toContain('translateString("Apple Calendar / Outlook")');
    expect(readDashboardSource(`${FEED_DIR}/FeedLinkField.tsx`)).toContain(
      "Copy link",
    );

    // The Status panel and its first state.
    expect(PAGE).toContain("**Waiting for first sync**");
    expect(SUBSCRIBE_MODAL).toContain("<FeedStatusPanel");
    expect(readDashboardSource(`${FEED_DIR}/CalendarFeedUtil.ts`)).toContain(
      'translationKey("Waiting for first sync")',
    );
    expect(readDashboardSource(`${FEED_DIR}/FeedStatusPanel.tsx`)).toContain(
      'translator.translateText("Status")',
    );
  });

  it("gives the address the route serves", () => {
    expect(declaredString(CALENDAR_API, "TEAM_FEED_ROUTE")).toBe(
      "/scheduled-maintenance-calendar/project/:token/maintenance.ics",
    );
    expect(PAGE).toContain(
      "https://<your host>/api/scheduled-maintenance-calendar/project/<token>/maintenance.ics",
    );
    expect(MAINTENANCE_CALENDAR_FILE_NAME).toBe("maintenance.ics");
  });

  it("shows the link only to whoever reads every event, publishes it for creators and regenerates it for editors", () => {
    expect(PAGE).toContain(
      "the dialog shows it only to people who can read every event",
    );
    expect(CALENDAR_API).toContain(
      "ScheduledMaintenanceService.readsEveryRecordInProject(props)",
    );

    const feed: ScheduledMaintenanceCalendarFeed =
      new ScheduledMaintenanceCalendarFeed();
    const event: ScheduledMaintenance = new ScheduledMaintenance();

    const sorted: (permissions: Array<Permission>) => Array<Permission> = (
      permissions: Array<Permission>,
    ): Array<Permission> => {
      return [...permissions].sort();
    };

    // Who may publish is who may create an event; regenerate and disable, edit one.
    expect(PAGE).toContain(
      "| **Publish link** | Anyone who can also create scheduled maintenance events |",
    );
    expect(sorted(feed.createRecordPermissions)).toEqual(
      sorted(event.createRecordPermissions),
    );
    expect(PAGE).toContain(
      "| **Regenerate link**, **Disable link** | Anyone who can also edit scheduled maintenance events |",
    );
    expect(sorted(feed.updateRecordPermissions)).toEqual(
      sorted(event.updateRecordPermissions),
    );
    expect(sorted(feed.readRecordPermissions)).toEqual(
      sorted(event.readRecordPermissions),
    );
    expect(SUBSCRIBE_MODAL).toContain("ModelAction.Create");
    expect(SUBSCRIBE_MODAL).toContain("ModelAction.Update");
  });

  it("keeps a regenerated link an empty calendar for as long as the page says", () => {
    expect(PAGE).toContain(
      `For ${PREVIOUS_TOKEN_GRACE_DAYS} days the old one serves an empty calendar`,
    );
    expect(CALENDAR_API).toContain("isPreviousTokenInGrace");
    expect(CALENDAR_API).toContain("TEAM_CALENDAR_REPLACED_REASON");
    expect(CALENDAR_API).toContain("TEAM_CALENDAR_TURNED_OFF_REASON");
  });

  it("holds the window and the number of events the page says", () => {
    const pastDays: number = declaredNumber(
      TEAM_CALENDAR,
      "TEAM_CALENDAR_PAST_DAYS",
    );
    const futureDays: number = declaredNumber(
      TEAM_CALENDAR,
      "TEAM_CALENDAR_FUTURE_DAYS",
    );

    expect(futureDays).toBe(365);
    expect(PAGE).toContain(
      `The calendar holds every event from ${pastDays} days back to a year ahead, up to ${MAINTENANCE_CALENDAR_MAX_EVENTS.toLocaleString("en-US")} events.`,
    );
  });
});

describe("a status page's calendar", () => {
  it("is served at the page's address followed by /maintenance.ics", () => {
    expect(PAGE).toContain(
      "The link is the page's address followed by `/maintenance.ics`",
    );
    expect(FRONTEND).toContain(
      '["/maintenance.ics", "/status-page/:statusPageId/maintenance.ics"]',
    );
  });

  it("offers Subscribe to calendar on the scheduled events page, and none on a private page", () => {
    expect(STATUS_PAGE_ENGLISH.scheduledEvents.calendar["subscribe"]).toBe(
      "Subscribe to calendar",
    );
    expect(STATUS_PAGE_EVENTS).toContain(
      "headerRight={<SubscribeToCalendarButton />}",
    );
    expect(PAGE).toContain(
      "a private page offers no **Subscribe to calendar**, and its link serves an empty calendar that says the page is private.",
    );
    expect(STATUS_PAGE_BUTTONS).toContain(
      "if (StatusPageUtil.isPrivateStatusPage())",
    );
    expect(STATUS_PAGE_FEED).toContain("STATUS_PAGE_CALENDAR_PRIVATE_REASON");
  });

  it("adds one event with Add to calendar, until the event is over", () => {
    expect(STATUS_PAGE_ENGLISH.scheduledEvents.calendar["addToCalendar"]).toBe(
      "Add to calendar",
    );
    expect(PAGE).toContain(
      "**Add to calendar** on an event's page adds that event alone",
    );
    expect(PAGE).toContain("is not offered once the event is over.");
    expect(STATUS_PAGE_EVENT).toContain("<AddEventToCalendarButton");
    expect(STATUS_PAGE_EVENT).toContain(
      "!== ScheduledMaintenancePhaseOfState.Over",
    );
  });

  it("holds what the page shows, read the way the page reads its events", () => {
    expect(PAGE).toContain("Exactly what the page shows");
    expect(STATUS_PAGE_FEED).toContain("readShownScheduledMaintenanceEvents");
  });
});

describe("what a calendar event holds", () => {
  const event: {
    id: string;
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    stateName: string;
    labels: Array<string>;
    url: string;
  } = {
    id: "0b0e1d1e-3f4a-4c2b-9a8d-5e6f7a8b9c0d",
    title: "Database upgrade",
    description: "We upgrade the primary database.",
    startsAt: new Date(Date.UTC(2026, 9, 20, 9, 0, 0)),
    endsAt: new Date(Date.UTC(2026, 9, 20, 10, 0, 0)),
    stateName: "Scheduled",
    labels: ["Database"],
    url: "https://status.example.com/scheduled-events/0b0e1d1e-3f4a-4c2b-9a8d-5e6f7a8b9c0d",
  };

  const render: (isCalledOff: boolean) => string = (
    isCalledOff: boolean,
  ): string => {
    return MaintenanceCalendar.render({
      audience: MaintenanceCalendarAudience.StatusPage,
      name: "Acme",
      productId: MaintenanceCalendar.getProductId("OneUptime"),
      events: [{ ...event, isCalledOff: isCalledOff }],
    });
  };

  it("writes the planned window in UTC, free, with the labels as categories", () => {
    const body: string = render(false);

    expect(PAGE).toContain(
      "| Start and end | Its planned window, in UTC; the calendar app shows it in your own time zone |",
    );
    expect(body).toContain("DTSTART:20261020T090000Z");
    expect(body).toContain("DTEND:20261020T100000Z");

    expect(PAGE).toContain(
      "| Free or busy | Free, so a maintenance window never blocks your availability |",
    );
    expect(body).toContain("TRANSP:TRANSPARENT");

    expect(PAGE).toContain("| Categories | Its labels;");
    expect(body).toContain("CATEGORIES:Database");
  });

  it("says Cancelled for an event that was called off, and confirmed otherwise", () => {
    expect(PAGE).toContain(
      "| Status | Cancelled when the event was called off: completed without ever being in progress |",
    );
    expect(render(true)).toContain("STATUS:CANCELLED");
    expect(render(false)).toContain("STATUS:CONFIRMED");
  });

  it("writes its description as plain text with its state and a link to the event", () => {
    const unfolded: string = render(false).split("\r\n ").join("");

    expect(unfolded).toContain("Status: Scheduled");
    expect(unfolded).toContain(`Details: ${event.url}`);
  });
});

describe("how often calendars refresh", () => {
  it("keeps a calendar for at most the five minutes the page says", () => {
    expect(declaredNumber(RESPONSE, "CALENDAR_RESPONSE_MAX_AGE_SECONDS")).toBe(
      5 * 60,
    );
    expect(FEED_CACHE).toContain(
      "MAINTENANCE_CALENDAR_CACHE_TTL_SECONDS: number =\n  CALENDAR_RESPONSE_MAX_AGE_SECONDS;",
    );
    expect(PAGE).toContain(
      "OneUptime keeps a calendar for at most five minutes",
    );
  });
});
