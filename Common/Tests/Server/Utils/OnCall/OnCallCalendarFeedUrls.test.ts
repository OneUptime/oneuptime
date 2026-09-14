import OnCallCalendarFeedUrls, {
  FeedUrls,
  GOOGLE_CALENDAR_ADD_BY_URL,
  HOST_WARNING,
  ON_CALL_CALENDAR_ROUTE_PREFIX,
  PERSONAL_FEED_FILE_NAME,
  PROJECT_FEED_FILE_NAME,
  PROTOCOL_WARNING,
  SCHEDULE_FEED_FILE_NAME,
} from "../../../../Server/Utils/OnCall/OnCallCalendarFeedUrls";
import CalendarFeedToken from "../../../../Server/Utils/OnCall/CalendarFeedToken";
import Protocol from "../../../../Types/API/Protocol";
import { OnCallCalendarFeedKind } from "../../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * The subscription URLs the settings page hands out. What matters: the path
 * segments match the Nginx access-log exemption and the API routes exactly,
 * webcal follows the instance scheme, the Google link carries the https URL
 * encoded, and the two warnings fire on the deployments where the link
 * would not work or would leak.
 */

const TOKEN: string = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP_";

describe("OnCallCalendarFeedUrls", () => {
  describe("route paths", () => {
    test("the token is 43 characters (the shape the routes accept)", () => {
      expect(CalendarFeedToken.isValidShape(TOKEN)).toBe(true);
    });

    test("personal feed path", () => {
      expect(
        OnCallCalendarFeedUrls.getFeedRoutePath(
          OnCallCalendarFeedKind.Personal,
          TOKEN,
        ),
      ).toBe(`${ON_CALL_CALENDAR_ROUTE_PREFIX}/user/${TOKEN}/shifts.ics`);
    });

    test("schedule feed path", () => {
      expect(
        OnCallCalendarFeedUrls.getFeedRoutePath(
          OnCallCalendarFeedKind.Schedule,
          TOKEN,
        ),
      ).toBe(`${ON_CALL_CALENDAR_ROUTE_PREFIX}/schedule/${TOKEN}/schedule.ics`);
    });

    test("project feed path", () => {
      expect(
        OnCallCalendarFeedUrls.getFeedRoutePath(
          OnCallCalendarFeedKind.Project,
          TOKEN,
        ),
      ).toBe(`${ON_CALL_CALENDAR_ROUTE_PREFIX}/project/${TOKEN}/project.ics`);
    });

    test("the public path carries the /api prefix", () => {
      expect(
        OnCallCalendarFeedUrls.getFeedPath(
          OnCallCalendarFeedKind.Personal,
          TOKEN,
        ),
      ).toBe(`/api/on-call-calendar/user/${TOKEN}/shifts.ics`);
    });

    test("the three kind segments are exactly what the Nginx location matches", () => {
      const nginxLocation: RegExp =
        /^\/api\/on-call-calendar\/(user|schedule|project)\//;

      for (const kind of [
        OnCallCalendarFeedKind.Personal,
        OnCallCalendarFeedKind.Schedule,
        OnCallCalendarFeedKind.Project,
      ]) {
        expect(OnCallCalendarFeedUrls.getFeedPath(kind, TOKEN)).toMatch(
          nginxLocation,
        );
      }
    });

    test("file names", () => {
      expect(
        OnCallCalendarFeedUrls.getFileName(OnCallCalendarFeedKind.Personal),
      ).toBe(PERSONAL_FEED_FILE_NAME);
      expect(
        OnCallCalendarFeedUrls.getFileName(OnCallCalendarFeedKind.Schedule),
      ).toBe(SCHEDULE_FEED_FILE_NAME);
      expect(
        OnCallCalendarFeedUrls.getFileName(OnCallCalendarFeedKind.Project),
      ).toBe(PROJECT_FEED_FILE_NAME);
      expect(PERSONAL_FEED_FILE_NAME.endsWith(".ics")).toBe(true);
    });

    test("kind segments", () => {
      expect(
        OnCallCalendarFeedUrls.getKindSegment(OnCallCalendarFeedKind.Personal),
      ).toBe("user");
      expect(
        OnCallCalendarFeedUrls.getKindSegment(OnCallCalendarFeedKind.Schedule),
      ).toBe("schedule");
      expect(
        OnCallCalendarFeedUrls.getKindSegment(OnCallCalendarFeedKind.Project),
      ).toBe("project");
    });

    test("a token with URL-unsafe characters is percent-encoded rather than trusted", () => {
      const path: string = OnCallCalendarFeedUrls.getFeedRoutePath(
        OnCallCalendarFeedKind.Personal,
        "a/b?c",
      );

      expect(path).toBe(
        `${ON_CALL_CALENDAR_ROUTE_PREFIX}/user/a%2Fb%3Fc/shifts.ics`,
      );
    });
  });

  describe("buildFeedUrls", () => {
    test("https instance: https URL, webcals:// link and an encoded Google link", () => {
      const urls: FeedUrls = OnCallCalendarFeedUrls.buildFeedUrls({
        kind: OnCallCalendarFeedKind.Personal,
        token: TOKEN,
        host: "oneuptime.example.com",
        protocol: Protocol.HTTPS,
      });

      expect(urls.https).toBe(
        `https://oneuptime.example.com/api/on-call-calendar/user/${TOKEN}/shifts.ics`,
      );
      expect(urls.webcal).toBe(
        `webcals://oneuptime.example.com/api/on-call-calendar/user/${TOKEN}/shifts.ics`,
      );
      expect(urls.googleAdd).toBe(
        `${GOOGLE_CALENDAR_ADD_BY_URL}${encodeURIComponent(urls.https)}`,
      );
    });

    test("http instance: the `https` key still carries the instance URL, and webcal is webcal://", () => {
      const urls: FeedUrls = OnCallCalendarFeedUrls.buildFeedUrls({
        kind: OnCallCalendarFeedKind.Schedule,
        token: TOKEN,
        host: "oneuptime.internal:3002",
        protocol: Protocol.HTTP,
      });

      expect(urls.https).toBe(
        `http://oneuptime.internal:3002/api/on-call-calendar/schedule/${TOKEN}/schedule.ics`,
      );
      expect(urls.webcal.startsWith("webcal://oneuptime.internal:3002/")).toBe(
        true,
      );
      expect(urls.webcal.startsWith("webcals://")).toBe(false);
    });

    test("the Google link decodes back to the https URL", () => {
      const urls: FeedUrls = OnCallCalendarFeedUrls.buildFeedUrls({
        kind: OnCallCalendarFeedKind.Project,
        token: TOKEN,
        host: "oneuptime.example.com",
        protocol: Protocol.HTTPS,
      });

      const cid: string = urls.googleAdd.slice(
        GOOGLE_CALENDAR_ADD_BY_URL.length,
      );

      expect(decodeURIComponent(cid)).toBe(urls.https);
      expect(cid).not.toContain("/");
    });

    test("a HOST that carries a scheme or a trailing slash is normalised", () => {
      const urls: FeedUrls = OnCallCalendarFeedUrls.buildFeedUrls({
        kind: OnCallCalendarFeedKind.Personal,
        token: TOKEN,
        host: "https://oneuptime.example.com/",
        protocol: Protocol.HTTPS,
      });

      expect(urls.https).toBe(
        `https://oneuptime.example.com/api/on-call-calendar/user/${TOKEN}/shifts.ics`,
      );
      expect(urls.https).not.toContain("//api");
      expect(urls.https).not.toContain("https://https://");
    });

    test("the webcal and https links differ only in scheme", () => {
      const urls: FeedUrls = OnCallCalendarFeedUrls.buildFeedUrls({
        kind: OnCallCalendarFeedKind.Personal,
        token: TOKEN,
        host: "oneuptime.example.com",
        protocol: Protocol.HTTPS,
      });

      expect(urls.webcal.replace(/^webcals:\/\//, "https://")).toBe(urls.https);
    });

    test("the defaults come from the environment (a string either way)", () => {
      const urls: FeedUrls = OnCallCalendarFeedUrls.buildFeedUrls({
        kind: OnCallCalendarFeedKind.Personal,
        token: TOKEN,
      });

      expect(typeof urls.https).toBe("string");
      expect(urls.https).toContain(
        `/api/on-call-calendar/user/${TOKEN}/shifts.ics`,
      );
      expect(urls.https.startsWith("http")).toBe(true);
    });
  });

  describe("getHostWarning", () => {
    test.each([
      "",
      "   ",
      "localhost",
      "localhost:3002",
      "127.0.0.1",
      "127.0.0.1:80",
      "0.0.0.0",
      "[::1]:3002",
      "http://localhost/",
    ])("warns for %j", (host: string) => {
      expect(OnCallCalendarFeedUrls.getHostWarning(host)).toBe(HOST_WARNING);
    });

    test.each([
      "oneuptime.example.com",
      "oneuptime.example.com:8443",
      "10.0.0.12",
      "10.0.0.12:3002",
      "oneuptime.internal",
    ])("is silent for %j", (host: string) => {
      expect(OnCallCalendarFeedUrls.getHostWarning(host)).toBeNull();
    });

    test("a hostname that merely CONTAINS localhost is fine", () => {
      expect(
        OnCallCalendarFeedUrls.getHostWarning("localhost.example.com"),
      ).toBeNull();
    });
  });

  describe("getProtocolWarning", () => {
    test("http warns", () => {
      expect(OnCallCalendarFeedUrls.getProtocolWarning(Protocol.HTTP)).toBe(
        PROTOCOL_WARNING,
      );
    });

    test("https is silent", () => {
      expect(
        OnCallCalendarFeedUrls.getProtocolWarning(Protocol.HTTPS),
      ).toBeNull();
    });

    test("the default reads the environment and is a string or null", () => {
      const warning: string | null =
        OnCallCalendarFeedUrls.getProtocolWarning();

      expect(warning === null || warning === PROTOCOL_WARNING).toBe(true);
    });
  });

  describe("normalizeHost", () => {
    test.each([
      ["example.com", "example.com"],
      ["https://example.com", "example.com"],
      ["http://example.com/", "example.com"],
      ["example.com///", "example.com"],
      ["  example.com:3002  ", "example.com:3002"],
      ["", ""],
    ])("%j -> %j", (input: string, expected: string) => {
      expect(OnCallCalendarFeedUrls.normalizeHost(input)).toBe(expected);
    });
  });
});
