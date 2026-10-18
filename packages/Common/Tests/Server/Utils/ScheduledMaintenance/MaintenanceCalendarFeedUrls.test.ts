import MaintenanceCalendarFeedUrls, {
  MAINTENANCE_CALENDAR_PROTOCOL_WARNING,
  SCHEDULED_MAINTENANCE_CALENDAR_ROUTE_PREFIX,
} from "../../../../Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedUrls";
import { HOST_WARNING } from "../../../../Server/Utils/OnCall/OnCallCalendarFeedUrls";
import Protocol from "../../../../Types/API/Protocol";
import { CalendarSubscriptionLinkSet } from "../../../../Types/Calendar/CalendarSubscriptionLinks";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../../Server/Utils/Logger");

/*
 * The addresses of the team's maintenance calendar link: built from the
 * instance's HOST and HTTP_PROTOCOL only, in the three shapes calendar apps
 * subscribe with, on the path the API route serves and the Nginx location
 * keeps out of its access log.
 */

const TOKEN: string = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP_";

describe("MaintenanceCalendarFeedUrls", () => {
  test("the route path is the one the API serves the link on", () => {
    expect(MaintenanceCalendarFeedUrls.getFeedRoutePath(TOKEN)).toBe(
      `/scheduled-maintenance-calendar/project/${TOKEN}/maintenance.ics`,
    );
    expect(SCHEDULED_MAINTENANCE_CALENDAR_ROUTE_PREFIX).toBe(
      "/scheduled-maintenance-calendar",
    );
  });

  test("the public path carries the /api prefix the router is mounted under", () => {
    expect(MaintenanceCalendarFeedUrls.getFeedPath(TOKEN)).toBe(
      `/api/scheduled-maintenance-calendar/project/${TOKEN}/maintenance.ics`,
    );
  });

  test("the three links are built from HOST and HTTP_PROTOCOL", () => {
    const links: CalendarSubscriptionLinkSet =
      MaintenanceCalendarFeedUrls.buildFeedUrls({
        token: TOKEN,
        host: "oneuptime.example.com",
        protocol: Protocol.HTTPS,
      });

    const https: string = `https://oneuptime.example.com/api/scheduled-maintenance-calendar/project/${TOKEN}/maintenance.ics`;

    expect(links.https).toBe(https);
    expect(links.webcal).toBe(
      `webcal://oneuptime.example.com/api/scheduled-maintenance-calendar/project/${TOKEN}/maintenance.ics`,
    );

    const google: URL = new URL(links.googleAdd);

    expect(google.origin).toBe("https://calendar.google.com");
    expect(google.searchParams.get("cid")).toBe(links.webcal);
  });

  test("a HOST written with a scheme or a trailing slash makes the same link", () => {
    expect(
      MaintenanceCalendarFeedUrls.buildFeedUrls({
        token: TOKEN,
        host: "https://oneuptime.example.com/",
        protocol: Protocol.HTTPS,
      }).https,
    ).toBe(
      `https://oneuptime.example.com/api/scheduled-maintenance-calendar/project/${TOKEN}/maintenance.ics`,
    );
  });

  test("a plain-http instance is warned that the link and its events travel unencrypted", () => {
    expect(MaintenanceCalendarFeedUrls.getProtocolWarning(Protocol.HTTP)).toBe(
      MAINTENANCE_CALENDAR_PROTOCOL_WARNING,
    );
    expect(MAINTENANCE_CALENDAR_PROTOCOL_WARNING).toContain(
      "maintenance events",
    );
    expect(
      MaintenanceCalendarFeedUrls.getProtocolWarning(Protocol.HTTPS),
    ).toBeNull();
  });

  test("a HOST no calendar app can reach is warned, as for the on-call links", () => {
    expect(MaintenanceCalendarFeedUrls.getHostWarning("localhost")).toBe(
      HOST_WARNING,
    );
    expect(MaintenanceCalendarFeedUrls.getHostWarning("")).toBe(HOST_WARNING);
    expect(
      MaintenanceCalendarFeedUrls.getHostWarning("oneuptime.example.com"),
    ).toBeNull();
    expect(MaintenanceCalendarFeedUrls.getPrivateHost("10.0.0.12")).toBe(
      "10.0.0.12",
    );
    expect(
      MaintenanceCalendarFeedUrls.getPrivateHost("oneuptime.example.com"),
    ).toBeNull();
  });

  test("the Nginx template keeps the link's path out of every access log", () => {
    const template: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../../Nginx/default.conf.template"),
      "utf8",
    );

    const exempt: Array<string> = template
      .split("\n")
      .filter((line: string) => {
        return (
          line.trim().startsWith("location") &&
          line.includes("scheduled-maintenance-calendar/project")
        );
      });

    // The app's server block, and the two that front a status page domain.
    expect(exempt.length).toBe(3);

    for (const line of exempt) {
      expect(line).toContain(
        "^/api/(on-call-calendar/(user|schedule|project)|scheduled-maintenance-calendar/project)/",
      );
    }
  });
});
