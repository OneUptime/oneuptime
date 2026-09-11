import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Users and Sessions are two pages now, not a toggle on one. The pieces
 * that make that true are wirings no runtime value exposes - a side menu
 * item, a card button, a nudge action, a redirect - and each one fails
 * silently: a missing menu item is a page nobody can find, a leftover
 * toggle is two ways to the same place, a dropped redirect is a dead link
 * in every ticket that pasted ?view=users. Same source-text shape as
 * App/Tests/Dashboard/SessionReplayLayout.test.ts.
 *
 * Comments are stripped first because these files explain the very things
 * being banned (the list's comment names the redirect it relies on), and
 * a naive search would match the explanation.
 */

const dashboardSource: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(relativePath: string): string {
  return stripComments(
    fs.readFileSync(path.join(dashboardSource, relativePath), "utf8"),
  );
}

const sideMenuSource: string = read("Pages/Rum/View/SideMenu.tsx");
const listPageSource: string = read("Pages/Rum/View/SessionReplay.tsx");
const usersPageSource: string = read("Pages/Rum/View/SessionReplayUsers.tsx");
const tableSource: string = read(
  "Components/SessionReplay/SessionReplayTable.tsx",
);
const searchBarSource: string = read(
  "Components/SessionReplay/SessionReplaySearchBar.tsx",
);
const filtersSource: string = read(
  "Components/SessionReplay/SessionReplayListFilters.ts",
);
const routesSource: string = read("Routes/RumApplicationRoutes.tsx");

describe("the Users page is reachable", () => {
  test("the side menu lists Replay Users right after Session Replay, pointing at the new key", () => {
    const sessionReplayIndex: number = sideMenuSource.indexOf(
      'title: "Session Replay"',
    );
    const usersIndex: number = sideMenuSource.indexOf('title: "Replay Users"');
    const policyIndex: number = sideMenuSource.indexOf(
      'title: "Replay Policy"',
    );

    expect(sessionReplayIndex).toBeGreaterThan(-1);
    expect(usersIndex).toBeGreaterThan(sessionReplayIndex);
    expect(policyIndex).toBeGreaterThan(usersIndex);

    /* The item between "Replay Users" and "Replay Policy" resolves the users key. */
    const usersItem: string = sideMenuSource.slice(usersIndex, policyIndex);

    expect(usersItem).toContain(
      "PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_USERS",
    );
    expect(usersItem).toContain("IconProp.UserGroup");
  });

  test("the page is registered once with the users key and rendered from its own module", () => {
    expect(routesSource).toContain(
      'from "../Pages/Rum/View/SessionReplayUsers"',
    );
    expect(
      (
        routesSource.match(
          /getLastPathForKey\(\s*PageMap\.RUM_APPLICATION_VIEW_SESSION_REPLAY_USERS\b/g,
        ) ?? []
      ).length,
    ).toBe(1);
    expect(routesSource).toContain("<RumApplicationSessionReplayUsers");
  });

  test("the page reads its id one segment from the end, like its siblings", () => {
    expect(usersPageSource).toContain("Navigation.getLastParamAsObjectID(1)");
    expect(usersPageSource).toContain("<SessionReplayUsersTable");
    expect(usersPageSource).toContain("<TelemetryTimeRangePicker");
    expect(usersPageSource).toContain("buildUsersPageUrl(");
    expect(usersPageSource).toContain("buildUserSessionsListSearch(");
    expect(usersPageSource).toContain("buildUserFilterLabelStorageKey(");
  });
});

describe("the toggle is gone from the list", () => {
  test("the table no longer embeds the users table or a view switch", () => {
    expect(tableSource).not.toContain("SessionReplayUsersTable");
    expect(tableSource).not.toContain("session-view-toggle");
    expect(tableSource).not.toContain("onViewChange");
    expect(tableSource).not.toContain("SessionReplayListView");
    expect(tableSource).not.toContain("usersReloadToken");
  });

  test("the search bar has no view toggle", () => {
    expect(searchBarSource).not.toContain("session-view-toggle");
    expect(searchBarSource).not.toContain("onViewChange");
    expect(searchBarSource).not.toContain("SessionReplayListView");
    expect(searchBarSource).not.toContain("isUsersView");
  });

  test("the filter model no longer knows a view", () => {
    expect(filtersSource).not.toContain("SessionReplayListView");
    expect(filtersSource).not.toContain("isSessionReplayListView");
    expect(filtersSource).not.toMatch(/view:\s*"view"/);
  });

  test("the Users card button and the nudge's See users both go to the new page", () => {
    /* One navigation helper, used by both. */
    expect(tableSource).toContain(
      "RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_USERS] as Route",
    );
    expect(tableSource).toContain('title: "Users"');
    expect(tableSource).toMatch(/onShowUsers=\{openUsersPage\}/);
    expect(tableSource).toMatch(/title: "Users"[\s\S]*?onClick: openUsersPage/);

    /* "Users" sits before "Set up recording" in the card's button row. */
    expect(tableSource.indexOf('title: "Users"')).toBeLessThan(
      tableSource.indexOf('title: "Set up recording"'),
    );
  });

  test("the list resolves the Users page's hand-off before its first fetch", () => {
    expect(tableSource).toContain("resolveHandedOffUserFilter(");
    expect(tableSource).toContain("buildUserFilterLabelStorageKey(");
    expect(tableSource).toContain("removeStorage(storageKey)");
  });
});

describe("links minted by the toggle still work", () => {
  test("the list page replace-navigates ?view=users to the Users page", () => {
    expect(listPageSource).toContain(
      'LEGACY_USERS_VIEW_QUERY_KEY: string = "view"',
    );
    expect(listPageSource).toContain(
      'LEGACY_USERS_VIEW_QUERY_VALUE: string = "users"',
    );
    expect(listPageSource).toContain(
      "RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_USERS] as Route",
    );
    expect(listPageSource).toMatch(/<Navigate\s+replace=\{true\}/);
    /* The window a stale link named is carried across. */
    expect(listPageSource).toContain("buildTimeRangeSearch(");
    expect(listPageSource).toContain("readTimeRangeFromSearch(");
  });
});
