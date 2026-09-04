import {
  DASHBOARD_GO_TO_LEADER_KEY,
  DashboardGoToShortcut,
  DashboardKeyAction,
  DashboardKeyResolution,
  findDashboardGoToShortcut,
  getDashboardGoToShortcuts,
  resolveDashboardKeyPress,
} from "../../FeatureSet/Dashboard/src/Utils/KeyboardShortcuts";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  EMPTY_KEYBOARD_SEQUENCE_STATE,
  KEYBOARD_SEQUENCE_TIMEOUT_IN_MS,
  KeyboardEventLike,
  KeyboardSequenceState,
} from "Common/UI/Utils/GlobalKeyboardShortcut";
import { JSONObject } from "Common/Types/JSON";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type RouteClass = (typeof import("Common/Types/API/Route"))["default"];

let routeMapModule: RouteMapModule;

/*
 * Common/UI/Config reads `window` the moment it loads and RouteMap pulls it in
 * transitively (via ProjectUtil), so the stub has to exist before the module
 * does — hence the deferred import. Same approach as DeviceListFacetRoute.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/dashboard", search: "", hash: "" },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  routeMapModule = await import(
    "../../FeatureSet/Dashboard/src/Utils/RouteMap"
  );
});

/*
 * WHY THIS FILE EXISTS
 *
 * "g then <key>" navigation and the "?" dialog are decided entirely by
 * resolveDashboardKeyPress, which is React-free precisely so the interesting
 * cases can be pinned here rather than through a rendered dashboard: a
 * shortcut fired while a form dialog is open, a leader key that timed out, a
 * letter typed into a search box.
 *
 * The catalog invariants below matter for a different reason. Two entries
 * claiming the same letter is not a crash — one destination simply becomes
 * unreachable, and nothing says so.
 */

const SINGLE_LOWERCASE_LETTER: RegExp = /^[a-z]$/;

function keyEvent(overrides: Partial<KeyboardEventLike>): KeyboardEventLike {
  return {
    key: "g",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: null,
    ...overrides,
  };
}

function resolve(input: {
  key: string;
  isShortcutsModalOpen?: boolean | undefined;
  isDialogOpen?: boolean | undefined;
  sequenceState?: KeyboardSequenceState | undefined;
  now?: number | undefined;
  event?: Partial<KeyboardEventLike> | undefined;
}): DashboardKeyResolution {
  return resolveDashboardKeyPress({
    event: keyEvent({ key: input.key, ...(input.event || {}) }),
    isShortcutsModalOpen: input.isShortcutsModalOpen || false,
    isDialogOpen: input.isDialogOpen || false,
    sequenceState: input.sequenceState || EMPTY_KEYBOARD_SEQUENCE_STATE,
    now: input.now === undefined ? 1_000 : input.now,
  });
}

// Press the leader, then the given key, and return the second resolution.
function pressSequence(
  followKey: string,
  options?:
    | {
        gapInMs?: number | undefined;
        isDialogOpen?: boolean | undefined;
      }
    | undefined,
): DashboardKeyResolution {
  const armed: DashboardKeyResolution = resolve({
    key: DASHBOARD_GO_TO_LEADER_KEY,
    now: 1_000,
  });

  return resolve({
    key: followKey,
    sequenceState: armed.sequenceState,
    now: 1_000 + (options?.gapInMs === undefined ? 200 : options.gapInMs),
    isDialogOpen: options?.isDialogOpen || false,
  });
}

describe("the go-to catalog", () => {
  const shortcuts: Array<DashboardGoToShortcut> = getDashboardGoToShortcuts();

  test("is not empty", () => {
    expect(shortcuts.length).toBeGreaterThan(0);
  });

  test("binds only single lowercase letters", () => {
    /*
     * The reducer lowercases what it reads from the event, so an uppercase or
     * multi-character entry here would simply never match.
     */
    for (const shortcut of shortcuts) {
      expect(shortcut.key).toMatch(SINGLE_LOWERCASE_LETTER);
    }
  });

  test("gives every letter to exactly one destination", () => {
    const keys: Array<string> = shortcuts.map(
      (shortcut: DashboardGoToShortcut) => {
        return shortcut.key;
      },
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  test("sends every letter to a different page", () => {
    const pageMaps: Array<PageMap> = shortcuts.map(
      (shortcut: DashboardGoToShortcut) => {
        return shortcut.pageMap;
      },
    );

    expect(new Set(pageMaps).size).toBe(pageMaps.length);
  });

  test("never binds the leader key itself as a destination", () => {
    /*
     * A second leader press re-arms rather than completing, so an entry keyed
     * "g" would be dead on arrival.
     */
    const keys: Array<string> = shortcuts.map(
      (shortcut: DashboardGoToShortcut) => {
        return shortcut.key;
      },
    );

    expect(keys).not.toContain(DASHBOARD_GO_TO_LEADER_KEY);
  });

  test("points every destination at a real route", () => {
    /*
     * RouteMap is a Dictionary, not a Record keyed by PageMap, so a shortcut
     * aimed at a page with no route entry compiles perfectly and then simply
     * does nothing when pressed.
     */
    for (const shortcut of shortcuts) {
      const route: InstanceType<RouteClass> | undefined =
        routeMapModule.default[shortcut.pageMap];

      expect(route).toBeDefined();
      expect(route!.toString().startsWith("/")).toBe(true);
    }
  });

  test("labels every destination with a key the English locale actually has", () => {
    /*
     * The catalog carries English defaults because en.json is the key-for-key
     * source of truth for fifteen other locale files, and a key added to
     * English alone fails locale validation. That makes drift possible in the
     * other direction: a renamed navbar key would silently downgrade these
     * rows to their hard-coded defaults in every language. Checking the pair
     * here means the rename is caught instead.
     */
    const localePath: string = path.join(
      __dirname,
      "../../FeatureSet/Dashboard/src/Locales/en.json",
    );
    const locale: JSONObject = JSON.parse(
      fs.readFileSync(localePath, "utf8"),
    ) as JSONObject;

    const lookup: (dottedKey: string) => unknown = (
      dottedKey: string,
    ): unknown => {
      return dottedKey.split(".").reduce((value: unknown, part: string) => {
        if (value && typeof value === "object") {
          return (value as JSONObject)[part];
        }

        return undefined;
      }, locale as unknown);
    };

    for (const shortcut of shortcuts) {
      expect(lookup(shortcut.titleKey)).toBe(shortcut.defaultTitle);
    }
  });

  test("hands out a copy, so a caller sorting it cannot edit the source", () => {
    const first: Array<DashboardGoToShortcut> = getDashboardGoToShortcuts();
    first.length = 0;

    expect(getDashboardGoToShortcuts().length).toBeGreaterThan(0);
  });
});

describe("findDashboardGoToShortcut", () => {
  test("finds a bound letter", () => {
    expect(findDashboardGoToShortcut("h")?.pageMap).toBe(PageMap.HOME);
    expect(findDashboardGoToShortcut("i")?.pageMap).toBe(PageMap.INCIDENTS);
    expect(findDashboardGoToShortcut("m")?.pageMap).toBe(PageMap.MONITORS);
  });

  test("matches whatever case the keyboard reported", () => {
    // A KeyboardEvent reports "H" when caps lock happens to be on.
    expect(findDashboardGoToShortcut("H")?.pageMap).toBe(PageMap.HOME);
  });

  test("returns null for an unbound letter", () => {
    expect(findDashboardGoToShortcut("z")).toBeNull();
  });

  test("returns null for the leader key and for nothing at all", () => {
    expect(findDashboardGoToShortcut(DASHBOARD_GO_TO_LEADER_KEY)).toBeNull();
    expect(findDashboardGoToShortcut("")).toBeNull();
  });
});

describe("resolveDashboardKeyPress: the shortcuts dialog", () => {
  test("'?' opens it", () => {
    const resolution: DashboardKeyResolution = resolve({ key: "?" });

    expect(resolution.action).toBe(DashboardKeyAction.OpenShortcutsModal);
    expect(resolution.shouldPreventDefault).toBe(true);
  });

  test("'?' closes it again while it is open", () => {
    const resolution: DashboardKeyResolution = resolve({
      key: "?",
      isShortcutsModalOpen: true,
      isDialogOpen: true,
    });

    expect(resolution.action).toBe(DashboardKeyAction.CloseShortcutsModal);
    expect(resolution.shouldPreventDefault).toBe(true);
  });

  test("'?' does nothing while somebody else's dialog is in front", () => {
    /*
     * A confirm dialog or a create form owns the screen. Stacking the
     * shortcuts reference on top of it would bury the thing the user was
     * actually doing.
     */
    const resolution: DashboardKeyResolution = resolve({
      key: "?",
      isDialogOpen: true,
    });

    expect(resolution.action).toBe(DashboardKeyAction.None);
    expect(resolution.shouldPreventDefault).toBe(false);
  });

  test("'?' typed into a text field stays in the text field", () => {
    const resolution: DashboardKeyResolution = resolve({
      key: "?",
      event: { target: { tagName: "INPUT" } as unknown as EventTarget },
    });

    expect(resolution.action).toBe(DashboardKeyAction.None);
    expect(resolution.shouldPreventDefault).toBe(false);
  });

  test("'?' held with a modifier is somebody else's chord", () => {
    expect(resolve({ key: "?", event: { metaKey: true } }).action).toBe(
      DashboardKeyAction.None,
    );
    expect(resolve({ key: "?", event: { ctrlKey: true } }).action).toBe(
      DashboardKeyAction.None,
    );
  });

  test("opening the dialog drops any leader that was already armed", () => {
    const armed: DashboardKeyResolution = resolve({
      key: DASHBOARD_GO_TO_LEADER_KEY,
      now: 1_000,
    });

    const opened: DashboardKeyResolution = resolve({
      key: "?",
      sequenceState: armed.sequenceState,
      now: 1_100,
    });

    expect(opened.sequenceState.leaderPressedAt).toBeNull();
  });
});

describe("resolveDashboardKeyPress: go-to navigation", () => {
  test("the leader alone navigates nowhere, but arms the sequence", () => {
    const resolution: DashboardKeyResolution = resolve({
      key: DASHBOARD_GO_TO_LEADER_KEY,
      now: 4_000,
    });

    expect(resolution.action).toBe(DashboardKeyAction.None);
    expect(resolution.shouldPreventDefault).toBe(false);
    expect(resolution.sequenceState.leaderPressedAt).toBe(4_000);
  });

  test("leader then a bound letter navigates", () => {
    const resolution: DashboardKeyResolution = pressSequence("i");

    expect(resolution.action).toBe(DashboardKeyAction.NavigateToPage);
    expect(resolution.pageMap).toBe(PageMap.INCIDENTS);
    expect(resolution.shouldPreventDefault).toBe(true);
  });

  test("every letter in the catalog reaches its own page", () => {
    for (const shortcut of getDashboardGoToShortcuts()) {
      const resolution: DashboardKeyResolution = pressSequence(shortcut.key);

      expect(resolution.action).toBe(DashboardKeyAction.NavigateToPage);
      expect(resolution.pageMap).toBe(shortcut.pageMap);
    }
  });

  test("a bound letter pressed on its own does nothing", () => {
    /*
     * The whole reason for a leader: "i" has to stay an ordinary letter
     * everywhere except immediately after "g".
     */
    const resolution: DashboardKeyResolution = resolve({ key: "i" });

    expect(resolution.action).toBe(DashboardKeyAction.None);
    expect(resolution.shouldPreventDefault).toBe(false);
  });

  test("leader then an unbound letter navigates nowhere and claims nothing", () => {
    const resolution: DashboardKeyResolution = pressSequence("z");

    expect(resolution.action).toBe(DashboardKeyAction.None);
    expect(resolution.shouldPreventDefault).toBe(false);
  });

  test("a letter arriving after the leader timed out is ordinary typing again", () => {
    const resolution: DashboardKeyResolution = pressSequence("i", {
      gapInMs: KEYBOARD_SEQUENCE_TIMEOUT_IN_MS + 1,
    });

    expect(resolution.action).toBe(DashboardKeyAction.None);
  });

  test("the sequence still completes at the exact timeout boundary", () => {
    const resolution: DashboardKeyResolution = pressSequence("i", {
      gapInMs: KEYBOARD_SEQUENCE_TIMEOUT_IN_MS,
    });

    expect(resolution.action).toBe(DashboardKeyAction.NavigateToPage);
  });

  test("navigating disarms, so the next letter is not swallowed", () => {
    const navigated: DashboardKeyResolution = pressSequence("i");

    const next: DashboardKeyResolution = resolve({
      key: "m",
      sequenceState: navigated.sequenceState,
      now: 1_300,
    });

    expect(next.action).toBe(DashboardKeyAction.None);
  });

  test("typing 'g' into a search box never arms the sequence", () => {
    /*
     * The failure this prevents: type "gi" into a monitor search and get
     * thrown onto the incidents page instead of a filtered list.
     */
    const resolution: DashboardKeyResolution = resolve({
      key: DASHBOARD_GO_TO_LEADER_KEY,
      event: { target: { tagName: "INPUT" } as unknown as EventTarget },
    });

    expect(resolution.sequenceState.leaderPressedAt).toBeNull();
  });

  test("a letter typed into a textarea mid-sequence does not navigate", () => {
    const armed: DashboardKeyResolution = resolve({
      key: DASHBOARD_GO_TO_LEADER_KEY,
      now: 1_000,
    });

    const resolution: DashboardKeyResolution = resolve({
      key: "i",
      sequenceState: armed.sequenceState,
      now: 1_100,
      event: { target: { tagName: "TEXTAREA" } as unknown as EventTarget },
    });

    expect(resolution.action).toBe(DashboardKeyAction.None);
  });

  test("navigation stands down while a modal dialog is open", () => {
    /*
     * Someone halfway through a create form should not lose it because their
     * cursor was outside the fields when they typed.
     */
    const resolution: DashboardKeyResolution = pressSequence("i", {
      isDialogOpen: true,
    });

    expect(resolution.action).toBe(DashboardKeyAction.None);
  });

  test("an open dialog also drops the armed leader, so it cannot fire later", () => {
    const armed: DashboardKeyResolution = resolve({
      key: DASHBOARD_GO_TO_LEADER_KEY,
      now: 1_000,
    });

    const blocked: DashboardKeyResolution = resolve({
      key: "x",
      sequenceState: armed.sequenceState,
      now: 1_100,
      isDialogOpen: true,
    });

    expect(blocked.sequenceState.leaderPressedAt).toBeNull();
  });

  test("navigation stands down while the shortcuts dialog itself is open", () => {
    const armed: DashboardKeyResolution = resolve({
      key: DASHBOARD_GO_TO_LEADER_KEY,
      now: 1_000,
    });

    const resolution: DashboardKeyResolution = resolve({
      key: "i",
      sequenceState: armed.sequenceState,
      now: 1_100,
      isShortcutsModalOpen: true,
    });

    expect(resolution.action).toBe(DashboardKeyAction.None);
  });

  test("Cmd/Ctrl+G is left to the browser's own find-again", () => {
    const resolution: DashboardKeyResolution = resolve({
      key: DASHBOARD_GO_TO_LEADER_KEY,
      event: { metaKey: true },
    });

    expect(resolution.action).toBe(DashboardKeyAction.None);
    expect(resolution.sequenceState.leaderPressedAt).toBeNull();
  });

  test("an event another handler already claimed is left alone", () => {
    const resolution: DashboardKeyResolution = resolve({
      key: DASHBOARD_GO_TO_LEADER_KEY,
      event: { defaultPrevented: true },
    });

    expect(resolution.sequenceState.leaderPressedAt).toBeNull();
  });

  test("caps lock does not break the sequence", () => {
    const armed: DashboardKeyResolution = resolve({
      key: "G",
      now: 1_000,
    });

    const resolution: DashboardKeyResolution = resolve({
      key: "I",
      sequenceState: armed.sequenceState,
      now: 1_100,
    });

    expect(resolution.action).toBe(DashboardKeyAction.NavigateToPage);
    expect(resolution.pageMap).toBe(PageMap.INCIDENTS);
  });
});
