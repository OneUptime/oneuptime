import Route from "../../../Types/API/Route";
import WorkspaceConnectPendingLink from "../../../UI/Utils/WorkspaceConnectPendingLink";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The cookie that carries a Connect link from Slack or Microsoft Teams
 * across a sign-in.
 *
 * The Connect button OneUptime answers an unconnected press with opens
 * /dashboard/<project>/user-settings/slack-integration?connect=<token>. A
 * browser not signed in to OneUptime is sent to sign in by the dashboard's
 * first request, and every sign-in ends on the dashboard's home page - so
 * the link waits in this cookie, and the dashboard opens it again once
 * there is a session. These pin that only such a link is kept, that it is
 * kept where the dashboard alone reads it and where a sign-out cannot clear
 * it, that it is read once, and that whatever is read is checked again
 * before it becomes a navigation: the cookie is browser storage.
 *
 * universal-cookie writes straight through to `document.cookie` in jsdom,
 * which applies a cookie's path as a browser does.
 */

const COOKIE_NAME: string = "oneuptime-workspace-connect-pending";
const PROJECT_ID: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const TOKEN: string = `${"aZ09_-".repeat(7)}q`;
const SLACK_PAGE: string = `/dashboard/${PROJECT_ID}/user-settings/slack-integration`;
const TEAMS_PAGE: string = `/dashboard/${PROJECT_ID}/user-settings/microsoft-teams-integration`;

function goTo(pagePath: string): void {
  window.history.replaceState({}, "", pagePath);
}

// The cookies a document at the current path can see.
function readJar(): Record<string, string> {
  const jar: Record<string, string> = {};

  for (const part of (document.cookie || "").split(";")) {
    const index: number = part.indexOf("=");

    if (index > 0) {
      jar[part.slice(0, index).trim()] = decodeURIComponent(
        part.slice(index + 1).trim(),
      );
    }
  }

  return jar;
}

function seenFrom(pagePath: string): string | undefined {
  const before: string = `${window.location.pathname}${window.location.search}`;

  goTo(pagePath);

  const value: string | undefined = readJar()[COOKIE_NAME];

  goTo(before);

  return value;
}

function plant(value: string): void {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; path=/dashboard`;
}

function expireEverything(): void {
  for (const pagePath of ["/", SLACK_PAGE]) {
    goTo(pagePath);

    for (const name of Object.keys(readJar())) {
      for (const cookiePath of ["/", "/dashboard"]) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${cookiePath}`;
      }
    }
  }

  goTo("/");
}

beforeEach(() => {
  expireEverything();
});

afterEach(() => {
  expireEverything();
});

describe("WorkspaceConnectPendingLink.getConnectRoute", () => {
  test.each([
    ["the Slack page", SLACK_PAGE],
    ["the Microsoft Teams page", TEAMS_PAGE],
    ["either, with a trailing slash", `${SLACK_PAGE}/`],
  ])("takes %s with a token", (_name: string, pathname: string) => {
    expect(
      WorkspaceConnectPendingLink.getConnectRoute({
        pathname: pathname,
        search: `?connect=${TOKEN}`,
      })?.toString(),
    ).toBe(`${pathname}?connect=${TOKEN}`);
  });

  test("keeps the token alone, whatever else the address carries", () => {
    expect(
      WorkspaceConnectPendingLink.getConnectRoute({
        pathname: SLACK_PAGE,
        search: `?from=slack&connect=${TOKEN}&next=https://evil.test`,
      })?.toString(),
    ).toBe(`${SLACK_PAGE}?connect=${TOKEN}`);
  });

  test.each([
    ["another page of the dashboard", `/dashboard/${PROJECT_ID}/home`],
    [
      "a project's own Slack settings",
      `/dashboard/${PROJECT_ID}/settings/slack-integration`,
    ],
    [
      "a project id that is not one",
      "/dashboard/x/user-settings/slack-integration",
    ],
    ["another site's path", "//evil.test/user-settings/slack-integration"],
    ["a page below the settings page", `${SLACK_PAGE}/x`],
  ])("refuses %s", (_name: string, pathname: string) => {
    expect(
      WorkspaceConnectPendingLink.getConnectRoute({
        pathname: pathname,
        search: `?connect=${TOKEN}`,
      }),
    ).toBeNull();
  });

  test.each([
    ["no token", ""],
    ["a token of the wrong length", "?connect=abc"],
    ["a token that would add a parameter", `?connect=${TOKEN.slice(1)}%26`],
  ])("refuses the page with %s", (_name: string, search: string) => {
    expect(
      WorkspaceConnectPendingLink.getConnectRoute({
        pathname: SLACK_PAGE,
        search: search,
      }),
    ).toBeNull();
  });
});

describe("remembering a Connect link across a sign-in", () => {
  test("a Connect link is remembered, for the dashboard alone", () => {
    goTo(`${SLACK_PAGE}?connect=${TOKEN}`);

    expect(WorkspaceConnectPendingLink.rememberCurrentPage()).toBe(true);

    // Seen by the dashboard, where it is read ...
    expect(seenFrom(`/dashboard/${PROJECT_ID}/home`)).toBe(
      `${SLACK_PAGE}?connect=${TOKEN}`,
    );
    // ... never sent to the sign-in pages, whose logout clears what it is sent.
    expect(seenFrom("/accounts/login")).toBeUndefined();
    expect(seenFrom("/api/user/logout")).toBeUndefined();
  });

  test("any other page is not remembered, and nothing is written", () => {
    goTo(`/dashboard/${PROJECT_ID}/home?connect=${TOKEN}`);

    expect(WorkspaceConnectPendingLink.rememberCurrentPage()).toBe(false);
    expect(seenFrom(`/dashboard/${PROJECT_ID}/home`)).toBeUndefined();
  });

  test("the link is picked up once: reading it forgets it", () => {
    goTo(`${TEAMS_PAGE}?connect=${TOKEN}`);
    WorkspaceConnectPendingLink.rememberCurrentPage();
    goTo(`/dashboard/${PROJECT_ID}/home`);

    const route: Route | null = WorkspaceConnectPendingLink.consumeRoute();

    expect(route?.toString()).toBe(`${TEAMS_PAGE}?connect=${TOKEN}`);
    expect(WorkspaceConnectPendingLink.consumeRoute()).toBeNull();
    expect(readJar()[COOKIE_NAME]).toBeUndefined();
  });

  test.each([
    ["another site", `https://evil.test/?connect=${TOKEN}`],
    [
      "a dashboard page that is not a Connect page",
      `/dashboard/${PROJECT_ID}/home?connect=${TOKEN}`,
    ],
    ["a Connect page with no query", SLACK_PAGE],
    [
      "a Connect page with a token that is not one",
      `${SLACK_PAGE}?connect=<script>`,
    ],
  ])(
    "what is read is checked again: %s planted in the cookie goes nowhere, and is forgotten",
    (_name: string, planted: string) => {
      goTo(`/dashboard/${PROJECT_ID}/home`);
      plant(planted);

      expect(WorkspaceConnectPendingLink.consumeRoute()).toBeNull();
      expect(readJar()[COOKIE_NAME]).toBeUndefined();
    },
  );

  test("nothing remembered reads as nothing", () => {
    goTo(`/dashboard/${PROJECT_ID}/home`);

    expect(WorkspaceConnectPendingLink.consumeRoute()).toBeNull();
  });
});
