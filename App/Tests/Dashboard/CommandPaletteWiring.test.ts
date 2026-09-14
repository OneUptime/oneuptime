import EventName from "../../FeatureSet/Dashboard/src/Utils/EventName";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The command palette's behavior is spread across three files that must
 * agree: the Common NavBar must SURRENDER Cmd/Ctrl+K when asked, the
 * Dashboard NavBar must ask, and the palette host must claim the chord (and
 * clean up after itself). None of that is expressible as a type, and the App
 * suite runs in plain node (no renderer), so — like
 * NetworkTopologyPanelLayering — the relationships are pinned against the
 * sources with tolerant, intent-level patterns rather than exact byte
 * strings.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

// Comments describe history, not behavior — match code only.
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readAppCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

function readCommonCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(COMMON_ROOT, ...relativeParts), "utf8"),
  );
}

const COMMON_NAVBAR: string = readCommonCode(
  "UI",
  "Components",
  "Navbar",
  "NavBar.tsx",
);

const COMMON_NAVBAR_MENU_MODAL: string = readCommonCode(
  "UI",
  "Components",
  "Navbar",
  "NavBarMenuModal.tsx",
);

const DASHBOARD_NAVBAR: string = readAppCode(
  "Components",
  "NavBar",
  "NavBar.tsx",
);

const PALETTE_HOST: string = readAppCode(
  "Components",
  "CommandPalette",
  "DashboardCommandPalette.tsx",
);

/*
 * Effects contain nested handlers, so matching one by a meaningful state
 * update is less fragile than pinning the handler's local variable name.
 */
function findEffectContaining(
  source: string,
  marker: RegExp,
): string | undefined {
  const effects: Array<string> =
    source.match(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?\n\s*\},\s*\[[^\]]*\]\s*\);/g,
    ) || [];

  return effects.find((effect: string): boolean => {
    return marker.test(effect);
  });
}

function expectExactCommandKRecognition(source: string): void {
  expect(source).toMatch(/event\.metaKey\s*\|\|\s*event\.ctrlKey/);
  // Accept either an affirmative allow-list or an early-return reject guard.
  expect(source).toMatch(/(?:!event\.shiftKey|event\.shiftKey\s*\|\|)/);
  expect(source).toMatch(/(?:!event\.altKey|event\.altKey\s*\|\|)/);
  expect(source).toMatch(
    /event\.key\.toLowerCase\(\)\s*(?:===|!==)\s*["']k["']/,
  );
}

describe("command palette wiring", () => {
  test("the toggle event exists in the shared EventName enum", () => {
    /*
     * The enum is the contract for opening the palette programmatically:
     * any dispatcher and the palette host (listener) must agree on it, and a
     * typo'd ad-hoc string on either side would silently break the toggle.
     */
    expect(EventName.COMMAND_PALETTE_TOGGLE).toBe("COMMAND_PALETTE_TOGGLE");
  });

  test("the Common NavBar only owns the exact Cmd/Ctrl+K chord when the products shortcut is enabled", () => {
    // The prop exists on the component's props contract...
    expect(COMMON_NAVBAR).toMatch(/disableCommandKShortcut\??:\s*boolean/);
    expectExactCommandKRecognition(COMMON_NAVBAR);

    /*
     * The ordinary toggle effect is absent when another surface owns the
     * shortcut (and when no products menu exists). When active, it respects a
     * previously claimed chord before claiming and toggling it itself.
     */
    const toggleEffect: string | undefined = findEffectContaining(
      COMMON_NAVBAR,
      /setIsMoreMenuVisible\s*\(\s*\([^)]*\)\s*=>/,
    );

    expect(toggleEffect).toBeDefined();
    expect(toggleEffect).toMatch(
      /props\.disableCommandKShortcut\s*\|\|\s*!hasMoreMenu/,
    );
    expect(toggleEffect).toMatch(/event\.defaultPrevented/);
    expect(toggleEffect).toMatch(/event\.preventDefault\s*\(\s*\)/);
    expect(toggleEffect).toMatch(/return\s+!visible/);
  });

  test("an open products menu closes on surrendered Cmd/Ctrl+K without consuming the palette's event", () => {
    const closeOnlyEffect: string | undefined = findEffectContaining(
      COMMON_NAVBAR,
      /setIsMoreMenuVisible\s*\(\s*false\s*\)/,
    );

    expect(closeOnlyEffect).toBeDefined();
    expect(closeOnlyEffect).toMatch(/!props\.disableCommandKShortcut/);
    expect(closeOnlyEffect).toMatch(/!hasMoreMenu/);
    expect(closeOnlyEffect).toMatch(/!isMoreMenuVisible/);
    expect(closeOnlyEffect).toMatch(/isCommandKShortcut\s*\(\s*event\s*\)/);
    expect(closeOnlyEffect).toMatch(
      /document\.addEventListener\(\s*["']keydown["']/,
    );
    expect(closeOnlyEffect).toMatch(
      /document\.removeEventListener\(\s*["']keydown["']/,
    );

    /*
     * Closing is housekeeping, not shortcut ownership. In particular this
     * listener must still run if listener order means the palette claimed the
     * event first, and it must never hide the chord from that owner.
     */
    expect(closeOnlyEffect).not.toMatch(/defaultPrevented/);
    expect(closeOnlyEffect).not.toMatch(/preventDefault\s*\(/);
    expect(closeOnlyEffect).not.toMatch(/stopPropagation\s*\(/);
  });

  test("the Dashboard NavBar surrenders the shortcut and its products-menu Mod+K hint", () => {
    /*
     * Passing the prop (and not `={false}`) is what actually frees the chord
     * on the dashboard. Tolerant of `disableCommandKShortcut` shorthand and
     * of `={true}`.
     */
    expect(DASHBOARD_NAVBAR).toMatch(
      /<NavBar[\s\S]*?disableCommandKShortcut(?!\s*=\s*\{\s*false)/,
    );

    /*
     * The generic products modal still advertises Mod+K to legacy consumers,
     * but the NavBar suppresses that one keycap when it has surrendered the
     * chord. Its arrows/Enter/Escape footer hint remains independent.
     */
    expect(COMMON_NAVBAR).toMatch(
      /showCommandKShortcutHint\s*=\s*\{\s*!props\.disableCommandKShortcut\s*\}/,
    );
    expect(DASHBOARD_NAVBAR).toMatch(/moreMenuKeyboardHint\s*=/);
    expect(COMMON_NAVBAR_MENU_MODAL).toMatch(
      /props\.showCommandKShortcutHint\s*!==\s*false\s*\?[\s\S]{0,180}?<KeyboardShortcut[\s\S]{0,180}?KeyboardKey\.Mod/,
    );
  });

  test("both the NavBar and the palette read the SAME page catalog hook", () => {
    // Single source of truth: an item added to the hook reaches both surfaces.
    expect(DASHBOARD_NAVBAR).toMatch(/useDashboardNavigationItems\s*\(/);
    expect(PALETTE_HOST).toMatch(/useDashboardNavigationItems\s*\(/);

    /*
     * And the NavBar no longer builds its own inline catalog — a resurrected
     * local moreMenuItems array would drift from what the palette shows.
     */
    expect(DASHBOARD_NAVBAR).not.toMatch(
      /moreMenuItems\s*:\s*MoreMenuItem\[\]\s*=/,
    );
  });

  test("the palette host claims Cmd/Ctrl+K on document and removes the listener on unmount", () => {
    expect(PALETTE_HOST).toMatch(
      /document\.addEventListener\(\s*["']keydown["']/,
    );
    expect(PALETTE_HOST).toMatch(
      /document\.removeEventListener\(\s*["']keydown["']/,
    );
  });

  test("the palette remains the exact Cmd/Ctrl+K owner: it respects claimed events, then claims and toggles its own", () => {
    const shortcutEffect: string | undefined = findEffectContaining(
      PALETTE_HOST,
      /document\.addEventListener\(\s*["']keydown["']/,
    );

    expect(shortcutEffect).toBeDefined();
    expectExactCommandKRecognition(shortcutEffect || "");
    // Bails when another handler already took the chord...
    expect(shortcutEffect).toMatch(/defaultPrevented/);
    // ...and prevents the browser default once it decides to act.
    expect(shortcutEffect).toMatch(/preventDefault\s*\(\s*\)/);
    expect(shortcutEffect).toMatch(/setIsOpen\s*\(\s*\([^)]*\)\s*=>/);
    expect(shortcutEffect).toMatch(/return\s+!open/);
  });

  test("the palette host subscribes to the global toggle event and unsubscribes symmetrically", () => {
    expect(PALETTE_HOST).toMatch(
      /GlobalEvents\.addEventListener\(\s*EventName\.COMMAND_PALETTE_TOGGLE/,
    );
    expect(PALETTE_HOST).toMatch(
      /GlobalEvents\.removeEventListener\(\s*EventName\.COMMAND_PALETTE_TOGGLE/,
    );
  });

  test("the palette host guards project-scoped navigation with the ':' check", () => {
    /*
     * The palette is mounted on every page, including no-project ones where
     * populateRouteParams leaves ":projectId" in the path. The shared helper
     * is the one place that decides navigability.
     */
    expect(PALETTE_HOST).toMatch(/isRoutePathNavigable\s*\(/);
  });

  test("entity search only exists with a project, through per-model providers", () => {
    expect(PALETTE_HOST).toMatch(/getCurrentProjectId\s*\(\s*\)/);
    // Every provider goes through the isolated, try/caught factory.
    expect(PALETTE_HOST).toMatch(/createEntitySearchProvider</);
    expect(PALETTE_HOST).toMatch(/catch/);
  });
});
