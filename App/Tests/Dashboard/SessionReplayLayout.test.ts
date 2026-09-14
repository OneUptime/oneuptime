import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SESSION_REPLAY_PLAYER_WIDE_CLASS_NAME,
  isSessionReplayPlayerPath,
  resolveSessionReplayPlayerLayout,
} from "../../FeatureSet/Dashboard/src/Utils/SessionReplayLayout";

/*
 * The player page goes wide (no side menu) through a pure path matcher
 * that Pages/Rum/View/Layout.tsx consults. The matcher must accept exactly
 * the player route and nothing else under the RUM application: the list,
 * the audit page and the settings page live next to it and keep their
 * menu. Design risk 10 asks for this to be pinned so a future route change
 * cannot silently restore the menu on the player or drop it elsewhere.
 */

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

const PLAYER_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_ID}`;

describe("isSessionReplayPlayerPath", () => {
  test("accepts /rum/<id>/session-replay/<32 lowercase hex>", () => {
    expect(isSessionReplayPlayerPath(PLAYER_PATH)).toBe(true);
    expect(isSessionReplayPlayerPath(`${PLAYER_PATH}/`)).toBe(true);
  });

  test("ignores a query string and a hash on the player path", () => {
    expect(isSessionReplayPlayerPath(`${PLAYER_PATH}?t=41&rail=errors`)).toBe(
      true,
    );
    expect(isSessionReplayPlayerPath(`${PLAYER_PATH}#top`)).toBe(true);
  });

  test("rejects the list, audit and settings pages", () => {
    const base: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}`;

    expect(isSessionReplayPlayerPath(`${base}/session-replay`)).toBe(false);
    expect(isSessionReplayPlayerPath(`${base}/session-replay/`)).toBe(false);
    expect(isSessionReplayPlayerPath(`${base}/session-replay-audit`)).toBe(
      false,
    );
    expect(isSessionReplayPlayerPath(`${base}/session-replay-settings`)).toBe(
      false,
    );
    expect(
      isSessionReplayPlayerPath(
        `/dashboard/${PROJECT_ID}/rum/settings/session-replay`,
      ),
    ).toBe(false);
  });

  test("rejects a last segment that is not a session id", () => {
    const base: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay`;

    expect(isSessionReplayPlayerPath(`${base}/audit`)).toBe(false);
    expect(
      isSessionReplayPlayerPath(`${base}/${SESSION_ID.slice(0, 31)}`),
    ).toBe(false);
    expect(isSessionReplayPlayerPath(`${base}/${SESSION_ID}0`)).toBe(false);
    expect(
      isSessionReplayPlayerPath(`${base}/${SESSION_ID.toUpperCase()}`),
    ).toBe(false);
    expect(isSessionReplayPlayerPath(`${base}/${APP_ID}`)).toBe(false);
  });

  test("rejects blanks and non-strings", () => {
    expect(isSessionReplayPlayerPath("")).toBe(false);
    expect(isSessionReplayPlayerPath(null)).toBe(false);
    expect(isSessionReplayPlayerPath(undefined)).toBe(false);
    expect(isSessionReplayPlayerPath("/")).toBe(false);
    expect(isSessionReplayPlayerPath(SESSION_ID)).toBe(false);
  });
});

describe("resolveSessionReplayPlayerLayout", () => {
  test("hides the side menu and applies the full-bleed class only on the player when wide", () => {
    expect(
      resolveSessionReplayPlayerLayout({ path: PLAYER_PATH, isWide: true }),
    ).toEqual({
      isPlayerPath: true,
      shouldHideSideMenu: true,
      className: SESSION_REPLAY_PLAYER_WIDE_CLASS_NAME,
    });
  });

  test("keeps the ordinary layout on the player when wide is off", () => {
    expect(
      resolveSessionReplayPlayerLayout({ path: PLAYER_PATH, isWide: false }),
    ).toEqual({
      isPlayerPath: true,
      shouldHideSideMenu: false,
      className: undefined,
    });
  });

  test("never goes wide on another page, whatever the preference says", () => {
    const listPath: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay`;

    expect(
      resolveSessionReplayPlayerLayout({ path: listPath, isWide: true }),
    ).toEqual({
      isPlayerPath: false,
      shouldHideSideMenu: false,
      className: undefined,
    });
  });

  test("the wide class keeps max-w-full so the page never scrolls sideways", () => {
    expect(SESSION_REPLAY_PLAYER_WIDE_CLASS_NAME).toContain("max-w-full");
    expect(SESSION_REPLAY_PLAYER_WIDE_CLASS_NAME).toBe(
      "mb-auto max-w-full px-3 sm:px-4 mt-3 h-max",
    );
  });
});

describe("Pages/Rum/View/Layout.tsx wiring", () => {
  /*
   * The layout cannot be rendered here (ModelPage fetches the model), so
   * the two things that make wide mode work are pinned in the source: the
   * decision comes from the matcher over the live pathname, and both of
   * ModelPage's props it controls are wired to that decision.
   */
  const source: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../FeatureSet/Dashboard/src/Pages/Rum/View/Layout.tsx",
    ),
    "utf8",
  );

  test("decides from the matcher over the router's live pathname and the wide pref", () => {
    expect(source).toContain("resolveSessionReplayPlayerLayout({");
    expect(source).toContain("path: location.pathname");
    expect(source).toContain("isWide: prefs.wide");
    expect(source).toContain("useLocation()");
  });

  test("re-renders through the prefs store so the player's Wide toggle reaches it", () => {
    expect(source).toContain("useSyncExternalStore(");
    expect(source).toContain("subscribeToReplayViewPrefs");
    expect(source).toContain("getReplayViewPrefsSnapshot");
  });

  test("omits the side menu and overrides the container class from the same decision", () => {
    expect(source).toMatch(
      /sideMenu=\{\s*layout\.shouldHideSideMenu \? undefined : <SideMenu modelId=\{modelId\} \/>\s*\}/,
    );
    expect(source).toContain("className={layout.className}");
  });
});
