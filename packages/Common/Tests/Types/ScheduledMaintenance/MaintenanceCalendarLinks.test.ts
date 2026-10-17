import MaintenanceCalendarLinks, {
  GOOGLE_CALENDAR_ADD_EVENT_URL,
  GOOGLE_CALENDAR_MAX_DETAILS_LENGTH,
  MAINTENANCE_CALENDAR_EVENT_QUERY_PARAM,
} from "../../../Types/ScheduledMaintenance/MaintenanceCalendarLinks";
import CalendarSubscriptionLinks, {
  CalendarSubscriptionLinkSet,
} from "../../../Types/Calendar/CalendarSubscriptionLinks";
import { MAINTENANCE_CALENDAR_FILE_NAME } from "../../../Types/ScheduledMaintenance/MaintenanceCalendar";
import { describe, expect, test } from "@jest/globals";

/*
 * The addresses a status page hands out for its scheduled maintenance: its
 * calendar on its own domain and on its address under OneUptime, the
 * subscribe links built from it, one event as a file, and one event in
 * Google Calendar. Every address is parsed back rather than matched as a
 * substring, the way the app that opens it reads it.
 */

const PAGE_ID: string = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const EVENT_ID: string = "6c1f8e2a-4b3d-4e5f-8a9b-0c1d2e3f4a5b";

describe("MaintenanceCalendarLinks: the page's calendar", () => {
  test("on the page's own domain it is /maintenance.ics", () => {
    expect(
      MaintenanceCalendarLinks.getStatusPageCalendarPath({ isPreview: false }),
    ).toBe(`/${MAINTENANCE_CALENDAR_FILE_NAME}`);

    // The page's id is not part of the path on its own domain.
    expect(
      MaintenanceCalendarLinks.getStatusPageCalendarPath({
        isPreview: false,
        statusPageId: PAGE_ID,
      }),
    ).toBe("/maintenance.ics");
  });

  test("on its address under OneUptime it is /status-page/<id>/maintenance.ics", () => {
    expect(
      MaintenanceCalendarLinks.getStatusPageCalendarPath({
        isPreview: true,
        statusPageId: PAGE_ID,
      }),
    ).toBe(`/status-page/${PAGE_ID}/maintenance.ics`);
  });

  test("a preview without an id falls back to the root path", () => {
    expect(
      MaintenanceCalendarLinks.getStatusPageCalendarPath({
        isPreview: true,
        statusPageId: " ",
      }),
    ).toBe("/maintenance.ics");
  });

  test("the address is the page's origin and the path, whatever the origin ends with", () => {
    for (const origin of [
      "https://status.example.com",
      "https://status.example.com/",
      " https://status.example.com// ",
    ]) {
      const url: URL = new URL(
        MaintenanceCalendarLinks.getStatusPageCalendarUrl({
          origin: origin,
          isPreview: false,
        }),
      );

      expect(url.origin).toBe("https://status.example.com");
      expect(url.pathname).toBe("/maintenance.ics");
    }

    const preview: URL = new URL(
      MaintenanceCalendarLinks.getStatusPageCalendarUrl({
        origin: "https://oneuptime.example.com",
        isPreview: true,
        statusPageId: PAGE_ID,
      }),
    );

    expect(preview.origin).toBe("https://oneuptime.example.com");
    expect(preview.pathname).toBe(`/status-page/${PAGE_ID}/maintenance.ics`);
  });

  test("the subscribe links are webcal:// for the device's calendar app and Google's add-by-URL link with the webcal:// address", () => {
    const links: CalendarSubscriptionLinkSet =
      MaintenanceCalendarLinks.getStatusPageSubscriptionLinks({
        origin: "https://status.example.com",
        isPreview: false,
      });

    expect(links.https).toBe("https://status.example.com/maintenance.ics");
    expect(links.webcal).toBe("webcal://status.example.com/maintenance.ics");
    expect(
      CalendarSubscriptionLinks.readGoogleCalendarAddress(links.googleAdd),
    ).toBe("webcal://status.example.com/maintenance.ics");
  });
});

describe("MaintenanceCalendarLinks: one event as a file", () => {
  test("is the calendar's address with ?event=<id>", () => {
    const url: URL = new URL(
      MaintenanceCalendarLinks.getStatusPageEventFileUrl({
        origin: "https://oneuptime.example.com",
        isPreview: true,
        statusPageId: PAGE_ID,
        eventId: EVENT_ID,
      }),
    );

    expect(url.pathname).toBe(`/status-page/${PAGE_ID}/maintenance.ics`);
    expect(url.searchParams.get(MAINTENANCE_CALENDAR_EVENT_QUERY_PARAM)).toBe(
      EVENT_ID,
    );
    expect(Array.from(url.searchParams.keys())).toEqual(["event"]);
  });

  test("an id is encoded, never read as more of the address", () => {
    const url: URL = new URL(
      MaintenanceCalendarLinks.getStatusPageEventFileUrl({
        origin: "https://status.example.com",
        isPreview: false,
        eventId: "a&b=c#d",
      }),
    );

    expect(url.searchParams.get("event")).toBe("a&b=c#d");
    expect(url.hash).toBe("");
  });
});

describe("MaintenanceCalendarLinks: one event in Google Calendar", () => {
  test("opens Google's add-event page with the title, the window in UTC and the details", () => {
    const url: URL = new URL(
      MaintenanceCalendarLinks.getGoogleCalendarEventUrl({
        title: "Database upgrade; part 1",
        startsAt: new Date("2026-10-20T22:00:00Z"),
        endsAt: new Date("2026-10-21T01:00:00Z"),
        details:
          "Planned work.\n\nhttps://status.example.com/scheduled-events/1",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_CALENDAR_ADD_EVENT_URL);
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Database upgrade; part 1");
    expect(url.searchParams.get("dates")).toBe(
      "20261020T220000Z/20261021T010000Z",
    );
    expect(url.searchParams.get("details")).toBe(
      "Planned work.\n\nhttps://status.example.com/scheduled-events/1",
    );
  });

  test("an event without a later end lasts the default hour, and without a title is named", () => {
    const url: URL = new URL(
      MaintenanceCalendarLinks.getGoogleCalendarEventUrl({
        title: "",
        startsAt: new Date("2026-10-20T22:00:00Z"),
        endsAt: null,
      }),
    );

    expect(url.searchParams.get("dates")).toBe(
      "20261020T220000Z/20261020T230000Z",
    );
    expect(url.searchParams.get("text")).toBe("Scheduled maintenance");
    expect(url.searchParams.has("details")).toBe(false);
  });

  test("long details are cut, so the address stays one Google reads whole", () => {
    const url: URL = new URL(
      MaintenanceCalendarLinks.getGoogleCalendarEventUrl({
        title: "Upgrade",
        startsAt: new Date("2026-10-20T22:00:00Z"),
        endsAt: new Date("2026-10-21T01:00:00Z"),
        details: "x".repeat(10000),
      }),
    );

    expect(Array.from(url.searchParams.get("details") || "")).toHaveLength(
      GOOGLE_CALENDAR_MAX_DETAILS_LENGTH,
    );
    expect(url.toString().length).toBeLessThan(4000);
  });
});
