import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3553: with the Ask AI panel open, the page behind it — an incident
 * list, say — kept scrolling under the same wheel that scrolled the chat, so
 * the cards and buttons the user was asking about slid around beneath the
 * answer.
 *
 * The panel had always presented itself as a modal surface: role="dialog",
 * aria-modal, a full-bleed dimmed backdrop, click-outside and Escape to close.
 * It simply never adopted the behaviour that goes with that, while Modal,
 * SideOver and the command palette all did. Two things close the gap, and both
 * are pinned here:
 *
 *   1. the panel takes the app's one shared, counted page-scroll lock for as
 *      long as it is open, so the document cannot scroll at all; and
 *   2. every scroller inside the panel contains its own overscroll, so a wheel
 *      past the end of the thread does not chain outward even if it could.
 *
 * These are assertions about source text rather than about a rendered tree
 * because the App suite runs in a plain Node environment (App/jest.config.json
 * sets testEnvironment: "node"), and no stylesheet is loaded even under jsdom,
 * so getComputedStyle can never resolve a Tailwind class. The behaviour of the
 * lock itself — acquire, release, nesting, paint ordering — is tested for real
 * against a DOM in Common/Tests/UI/Utils/PageScrollLock.test.tsx. What is left
 * to defend here is the wiring, which is exactly what regressed.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

const AI_CHAT_DIR: string = path.join(DASHBOARD_SRC, "Components", "AIChat");

/*
 * Comments are stripped before anything is matched. The block above the lock in
 * AIChatPanel.tsx explains the bug in prose that names both `usePageScrollLock`
 * and `overscroll-contain`; an assertion about the code has to read the code
 * and not the commentary describing it.
 */
type StripCommentsFunction = (raw: string) => string;

const stripComments: StripCommentsFunction = (raw: string): string => {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
};

type ReadCodeFunction = (
  root: string,
  ...relativeParts: Array<string>
) => string;

const readCode: ReadCodeFunction = (
  root: string,
  ...relativeParts: Array<string>
): string => {
  return stripComments(
    fs.readFileSync(path.join(root, ...relativeParts), "utf8"),
  );
};

type SquashFunction = (source: string) => string;

const squash: SquashFunction = (source: string): string => {
  return source.replace(/\s+/g, " ");
};

const PANEL_SOURCE: string = readCode(
  DASHBOARD_SRC,
  "Components",
  "AIChat",
  "AIChatPanel.tsx",
);

const PANEL_SQUASHED: string = squash(PANEL_SOURCE);

describe("Ask AI panel: the page behind it", () => {
  test("takes the shared page scroll lock, keyed on whether the panel is open", () => {
    /*
     * The whole of issue #3553 in one line. `isOpen`, not a literal `true`:
     * unlike Modal and SideOver, this panel is mounted for the life of the app
     * and closes by flipping its own flag, so a lock keyed on mount would be
     * taken once at startup and never released.
     */
    expect(PANEL_SQUASHED).toContain("usePageScrollLock(isOpen)");
  });

  test("takes it from the one module every dialog surface shares", () => {
    expect(PANEL_SQUASHED).toContain(
      'import { usePageScrollLock } from "Common/UI/Utils/PageScrollLock";',
    );
  });

  test("never reaches for document.body itself, which would fight that counter", () => {
    /*
     * A hand-rolled `document.body.style.overflow = "hidden"` looks like it
     * works and then loses: it snapshots and restores a value the shared
     * counter is already managing, so a modal opened over the panel — or the
     * command palette on Cmd+K — hands scrolling back to a page that is still
     * covered, or strands it locked with nothing on screen.
     */
    expect(PANEL_SOURCE).not.toContain("document.body.style");
    expect(PANEL_SOURCE).not.toContain("document.documentElement.style");
  });

  test("takes the lock above the early return, so closing the panel releases it", () => {
    /*
     * `if (!isOpen) { return <></>; }` sits between the hooks and the markup.
     * A lock call that drifted below it would be a conditionally-called hook —
     * React throws on the render after the panel closes — and, worse, would
     * never reach its own cleanup.
     */
    const lockIndex: number = PANEL_SQUASHED.indexOf("usePageScrollLock(");
    const earlyReturnIndex: number = PANEL_SQUASHED.indexOf("if (!isOpen)");

    expect(lockIndex).toBeGreaterThan(-1);
    expect(earlyReturnIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(earlyReturnIndex);
  });

  test("is still the modal surface the lock is there for", () => {
    /*
     * The premise, pinned so it cannot quietly change underneath the lock: if
     * the panel ever stops dimming the page and stops closing on an outside
     * click, it is no longer modal and freezing the page behind it would be the
     * wrong behaviour rather than the fix.
     */
    expect(PANEL_SQUASHED).toContain('role="dialog"');
    expect(PANEL_SQUASHED).toContain('aria-modal="true"');
    expect(PANEL_SQUASHED).toContain("fixed inset-0 bg-gray-900");
  });

  test("shares one counter with every dialog that can open over the panel", () => {
    /*
     * Cmd+K over an open Ask AI panel, or any Modal a chat action opens. Each
     * of these managing its own private lock is the race PageScrollLock exists
     * to prevent, so the panel is only safe for as long as its neighbours keep
     * routing through the same hook.
     */
    const surfaces: Array<Array<string>> = [
      ["UI", "Components", "Modal", "Modal.tsx"],
      ["UI", "Components", "SideOver", "SideOver.tsx"],
      ["UI", "Components", "CommandPalette", "CommandPalette.tsx"],
    ];

    for (const parts of surfaces) {
      const source: string = squash(readCode(COMMON_ROOT, ...parts));

      expect(source).toContain("usePageScrollLock(");
      expect(source).not.toContain("document.body.style");
    }
  });
});

/*
 * Scroll containment, the second half of the fix.
 *
 * The page lock stops the document scrolling; overscroll-contain stops the
 * wheel chaining out of a panel scroller in the first place, which is what
 * suppresses the rubber-band and the browser's own pull-to-refresh and
 * swipe-back gestures on the surface behind. They are not alternatives — the
 * panel wants both, the same way SideOver and Modal do.
 */

type ClassStringsInFunction = (source: string) => Array<string>;

const classStringsIn: ClassStringsInFunction = (
  source: string,
): Array<string> => {
  const found: Array<string> = [];
  const literals: RegExp = /(["'`])((?:(?!\1)[\s\S])*)\1/g;

  let match: RegExpExecArray | null = literals.exec(source);

  while (match !== null) {
    if (match[2] !== undefined) {
      found.push(match[2]);
    }

    match = literals.exec(source);
  }

  return found;
};

type TsxFilesInFunction = (directory: string) => Array<string>;

const tsxFilesIn: TsxFilesInFunction = (directory: string): Array<string> => {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...tsxFilesIn(full));
      continue;
    }

    if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }

  return found.sort();
};

/** A class list that scrolls on the given axis and is missing containment. */
type LeaksOnAxisFunction = (classes: string, axis: "x" | "y") => boolean;

const leaksOnAxis: LeaksOnAxisFunction = (
  classes: string,
  axis: "x" | "y",
): boolean => {
  const scrolls: boolean = new RegExp(
    `(?<![\\w-])overflow(?:-${axis})?-(?:auto|scroll)(?![\\w-])`,
  ).test(classes);

  if (!scrolls) {
    return false;
  }

  return !new RegExp(
    `(?<![\\w-])overscroll-(?:${axis}-)?(?:contain|none)(?![\\w-])`,
  ).test(classes);
};

describe("Ask AI panel: scroll containment", () => {
  test("the conversation body scrolls on demand and contains its overscroll", () => {
    expect(PANEL_SQUASHED).toContain(
      'className="min-h-0 flex-1 overflow-y-auto overscroll-contain"',
    );
  });

  test("the composer contains its overscroll once it stops growing", () => {
    /*
     * The textarea auto-grows to max-h-40 and then scrolls natively, with no
     * overflow-* class of its own for the sweep below to catch.
     */
    const composer: string = squash(
      readCode(DASHBOARD_SRC, "Components", "AIChat", "ChatInput.tsx"),
    );

    expect(composer).toContain("max-h-40");
    expect(composer).toMatch(/className="[^"]*\boverscroll-contain\b[^"]*"/);
  });

  test("every scroller anywhere in the Ask AI tree contains its overscroll", () => {
    /*
     * A sweep rather than a list, because the leak comes back the moment
     * someone adds the next scrollable region — a taller provider list, a
     * wide table in a chat widget — and forgets. A horizontal scroller counts
     * too: chaining a two-finger swipe out of a chat table is what triggers
     * the browser's back gesture.
     */
    const leaks: Array<string> = [];

    for (const file of tsxFilesIn(AI_CHAT_DIR)) {
      const source: string = stripComments(fs.readFileSync(file, "utf8"));

      for (const classes of classStringsIn(source)) {
        if (leaksOnAxis(classes, "y") || leaksOnAxis(classes, "x")) {
          leaks.push(`${path.relative(AI_CHAT_DIR, file)}: ${classes}`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });

  test("the sweep can actually tell a contained scroller from a leaking one", () => {
    /*
     * The sweep passes vacuously if its matcher is wrong, and a green vacuous
     * test is worse than no test, so exercise the matcher directly.
     */
    expect(leaksOnAxis("min-h-0 flex-1 overflow-y-auto", "y")).toBe(true);
    expect(leaksOnAxis("overflow-auto p-2", "y")).toBe(true);
    expect(leaksOnAxis("max-h-72 overflow-y-scroll", "y")).toBe(true);
    expect(leaksOnAxis("overflow-x-auto", "x")).toBe(true);

    expect(leaksOnAxis("overflow-y-auto overscroll-contain", "y")).toBe(false);
    expect(leaksOnAxis("overflow-y-auto overscroll-y-contain", "y")).toBe(
      false,
    );
    expect(leaksOnAxis("overflow-auto overscroll-none", "y")).toBe(false);
    expect(leaksOnAxis("overflow-x-auto overscroll-x-contain", "x")).toBe(
      false,
    );

    // Clipping is not scrolling, and neither is a class that merely spells it.
    expect(leaksOnAxis("overflow-hidden rounded-xl", "y")).toBe(false);
    expect(leaksOnAxis("group-overflow-y-auto-ish", "y")).toBe(false);

    /*
     * Containment on the other axis must not count: an x-contained scroller
     * still chains vertically.
     */
    expect(leaksOnAxis("overflow-y-auto overscroll-x-contain", "y")).toBe(true);
  });
});
