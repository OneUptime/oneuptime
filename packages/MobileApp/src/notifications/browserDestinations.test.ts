import { describe, expect, test } from "@jest/globals";
import {
  BROWSER_ENTITY_TYPES,
  getDashboardPageOnServer,
  opensInBrowser,
} from "./browserDestinations";

/*
 * A push about something the app has no screen for - a scheduled hunt that
 * found security events, a scheduled maintenance event - opens its page in
 * the browser. Only a page of the dashboard of the OneUptime the app is
 * signed in to: the push's address is compared with the app's server as
 * parsed URLs, never as text, so a push that did not come from that server
 * cannot send the reader anywhere else.
 */

const SERVER: string = "https://oneuptime.example.com";
const PROJECT_ID: string = "6f8a1c2e-1111-4a6e-9c55-0d2b3c4e5f60";
const HUNT_PAGE: string = `${SERVER}/dashboard/${PROJECT_ID}/security-events/hunts/0b6f1e9c-2222-4d1a-8e33-9a0b1c2d3e4f?startTime=2026-11-03T01%3A00%3A00.000Z`;

describe("which pushes open in the browser", () => {
  test("a hunt that found security events, and scheduled maintenance", () => {
    expect([...BROWSER_ENTITY_TYPES]).toEqual([
      "security-hunt",
      "scheduled-maintenance",
    ]);
    expect(opensInBrowser("security-hunt")).toBe(true);
    expect(opensInBrowser("scheduled-maintenance")).toBe(true);
  });

  test("never one the app has a screen for, nor one it does not know", () => {
    for (const entityType of [
      "incident",
      "alert",
      "incident-episode",
      "alert-episode",
      "security-case",
      "monitor",
      "status-page-subscriber",
      "",
      undefined,
    ]) {
      expect(opensInBrowser(entityType)).toBe(false);
    }
  });
});

describe("the page a push may open", () => {
  test("a dashboard page of the app's own OneUptime opens as it is, its query included", () => {
    expect(getDashboardPageOnServer(HUNT_PAGE, SERVER)).toBe(HUNT_PAGE);
  });

  test("the server's address is matched whatever its case, with or without a trailing slash", () => {
    expect(
      getDashboardPageOnServer(HUNT_PAGE, "https://OneUptime.Example.com/"),
    ).toBe(HUNT_PAGE);
  });

  test("a OneUptime served under a path of its own: the dashboard under that path", () => {
    const server: string = "https://example.com/oneuptime";
    const page: string = `https://example.com/oneuptime/dashboard/${PROJECT_ID}/scheduled-maintenance-events/1`;

    expect(getDashboardPageOnServer(page, server)).toBe(page);
    // The same dashboard outside the server's path is not this server's.
    expect(
      getDashboardPageOnServer(
        `https://example.com/dashboard/${PROJECT_ID}/scheduled-maintenance-events/1`,
        server,
      ),
    ).toBeNull();
  });

  test("another site - or the same name on another scheme or port - opens nothing", () => {
    for (const page of [
      `https://phishing.example.net/dashboard/${PROJECT_ID}/security-events/hunts/1`,
      `https://oneuptime.example.com.evil.test/dashboard/${PROJECT_ID}/x`,
      `http://oneuptime.example.com/dashboard/${PROJECT_ID}/x`,
      `https://oneuptime.example.com:8443/dashboard/${PROJECT_ID}/x`,
      `https://evil.test/?next=https://oneuptime.example.com/dashboard/${PROJECT_ID}/x`,
    ]) {
      expect(getDashboardPageOnServer(page, SERVER)).toBeNull();
    }
  });

  test("only a page inside the dashboard, of a project", () => {
    for (const page of [
      `${SERVER}/`,
      `${SERVER}/accounts/login`,
      `${SERVER}/status-page/${PROJECT_ID}`,
      `${SERVER}/dashboard`,
      `${SERVER}/dashboard/`,
      `${SERVER}/api/dashboard/${PROJECT_ID}`,
    ]) {
      expect(getDashboardPageOnServer(page, SERVER)).toBeNull();
    }
  });

  test("anything that is not a web address opens nothing", () => {
    for (const page of [
      "javascript:alert(1)",
      `data:text/html,${SERVER}/dashboard/${PROJECT_ID}`,
      "oneuptime://incident/1",
      "dashboard/x/y",
      "",
      "not a url",
      42,
      null,
      undefined,
      { href: HUNT_PAGE },
    ]) {
      expect(getDashboardPageOnServer(page, SERVER)).toBeNull();
    }
  });

  test("without a server to compare with, nothing opens", () => {
    expect(getDashboardPageOnServer(HUNT_PAGE, "")).toBeNull();
    expect(getDashboardPageOnServer(HUNT_PAGE, null)).toBeNull();
    expect(getDashboardPageOnServer(HUNT_PAGE, undefined)).toBeNull();
    expect(getDashboardPageOnServer(HUNT_PAGE, "not a url")).toBeNull();
  });
});

describe("on React Native's own URL, which a handset runs", () => {
  /*
   * React Native ships its own URL (Libraries/Blob/URL): it parses with
   * patterns, keeps a host as it was written, and accepts any text without
   * throwing. The pages are read on it the same way.
   */
  const realUrl: typeof URL = global.URL;

  beforeAll(() => {
    const { URL: ReactNativeUrl } = jest.requireActual<{
      URL: typeof URL;
    }>("react-native/Libraries/Blob/URL");
    global.URL = ReactNativeUrl;
  });

  afterAll(() => {
    global.URL = realUrl;
  });

  test("a dashboard page of this OneUptime opens", () => {
    expect(getDashboardPageOnServer(HUNT_PAGE, SERVER)).toBe(HUNT_PAGE);
    expect(
      getDashboardPageOnServer(HUNT_PAGE, "https://OneUptime.Example.com/"),
    ).toBe(HUNT_PAGE);
  });

  test("lookalikes, other servers and text open nothing", () => {
    for (const page of [
      `https://oneuptime.example.com.evil.test/dashboard/${PROJECT_ID}/x`,
      `https://oneuptime.example.com@evil.test/dashboard/${PROJECT_ID}/x`,
      `https://oneuptime.example.com:8443/dashboard/${PROJECT_ID}/x`,
      `https://evil.test?next=https://oneuptime.example.com/dashboard/${PROJECT_ID}/x`,
      `http://oneuptime.example.com/dashboard/${PROJECT_ID}/x`,
      "see the hunt",
      "javascript:alert(1)#x",
    ]) {
      expect({ page, opened: getDashboardPageOnServer(page, SERVER) }).toEqual(
        { page, opened: null },
      );
    }
  });
});
