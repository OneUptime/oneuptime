import {
  FOREIGN_HIDDEN_RULE_CSS,
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  TAILWIND_BREAKPOINTS_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
  resolveDisplay,
  splitVariants,
} from "../ResponsiveVisibility";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";

/*
 * The fix for the missing navigation bar swapped every `hidden md:flex` for
 * `max-md:hidden md:flex`. The two only paint the same if Tailwind emits the
 * max-width variant the way we think it does: `display:none` below the
 * breakpoint, nothing from the breakpoint up, in a block the `md:flex` rule
 * still comes after. Nothing else in the suite checks that. Every frontend
 * styles itself at runtime with the Play CDN (index.ejs serves the vendored
 * tailwind-3.4.5.js), so there is no build output to inspect, and jsdom has no
 * stylesheet at all: the suites that guard the navigation read class
 * attributes through ResponsiveVisibility.ts, which carries its own model of
 * Tailwind's cascade.
 *
 * This file holds that model to the real thing. It runs the vendored script in
 * jsdom the way the page does - a classic <script>, then `tailwind.config` as
 * index.ejs sets it - hands it the class strings the fix depends on, and
 * asserts on the CSS the CDN writes. If a Tailwind upgrade moves a media
 * query, reorders the blocks or rewrites an arbitrary-variant selector, this
 * file fails before ResponsiveVisibility.ts starts quietly approving markup a
 * browser would hide.
 */

const PLAY_CDN_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "Server",
  "Static",
  "Vendor",
  "tailwind",
  "tailwind-3.4.5.js",
);

const FEATURE_SET_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

const DASHBOARD_INDEX_VIEW: string = path.join(
  FEATURE_SET_ROOT,
  "Dashboard",
  "views",
  "index.ejs",
);

// The inline config in the Dashboard's index.ejs (checked below).
const INDEX_VIEW_TAILWIND_CONFIG: Record<string, unknown> = {
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: ["Inter", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
};

const BREAKPOINTS: Array<string> = Object.keys(TAILWIND_BREAKPOINTS_IN_PX);

/*
 * The order ResponsiveVisibility.ts ranks display utilities in (its
 * maxVariantPrecedence / minVariantPrecedence). If the CDN stops emitting the
 * blocks in this order, it is the helper that is wrong, not this list.
 */
const EMIT_ORDER_ASSUMED_BY_RESPONSIVE_VISIBILITY: Array<string> = [
  "unprefixed",
  "max-2xl",
  "max-xl",
  "max-lg",
  "max-md",
  "max-sm",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
];

/*
 * The two class names the facet rows and the runbook execution view moved to,
 * and the selectors Tailwind 3.4.5 is expected to write for them.
 */
const GROUP_NOT_HOVER_HIDDEN: string = "group-[:not(:hover)]:hidden";
const GROUP_NOT_HOVER_HIDDEN_SELECTOR: string =
  ".group:not(:hover) .group-\\[\\:not\\(\\:hover\\)\\]\\:hidden";
const DETAILS_CLOSED_HIDDEN: string = "[details:not([open])>summary>&]:hidden";
const DETAILS_CLOSED_HIDDEN_SELECTOR: string =
  "details:not([open])>summary>.\\[details\\:not\\(\\[open\\]\\)\\>summary\\>\\&\\]\\:hidden";

/*
 * Not every foreign rule is !important. A plain `.hidden{display:none}` in a
 * sheet appended after Tailwind's <style> ties on specificity and wins on
 * source order, which is just as fatal to `hidden md:flex`.
 */
const APPENDED_PLAIN_HIDDEN_RULE_CSS: string = ".hidden{display:none}";

interface ConvertedClassString {
  where: string;
  before: string;
  after: string;
}

// Real before/after pairs from the fix, at least one per breakpoint.
const CONVERTED_CLASS_STRINGS: Array<ConvertedClassString> = [
  {
    where: "NavBar desktop row",
    before: "bg-white flex text-center items-center lg:py-2 hidden md:flex",
    after:
      "bg-white flex text-center items-center lg:py-2 max-md:hidden md:flex",
  },
  {
    where: "Dashboard header search rail",
    before: "hidden items-center gap-2 lg:flex",
    after: "max-lg:hidden items-center gap-2 lg:flex",
  },
  {
    where: "Home side menu",
    before: "hidden md:block w-56 lg:w-64 flex-shrink-0 mb-10",
    after: "max-md:hidden md:block w-56 lg:w-64 flex-shrink-0 mb-10",
  },
  {
    where: "Pagination page button",
    before: "hidden sm:flex",
    after: "max-sm:hidden sm:flex",
  },
  {
    where: "Page header actions",
    before:
      "hidden sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-3",
    after:
      "max-sm:hidden sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-3",
  },
  {
    where: "Workflow query builder column headings",
    before:
      "hidden border-b border-gray-100 bg-gray-50/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.3fr)_auto] sm:gap-2",
    after:
      "max-sm:hidden border-b border-gray-100 bg-gray-50/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.3fr)_auto] sm:gap-2",
  },
  {
    where: "AI insight skeleton column",
    before: "hidden w-36 flex-shrink-0 xl:block",
    after: "max-xl:hidden w-36 flex-shrink-0 xl:block",
  },
  {
    where: "Session replay timestamp",
    before: "hidden text-gray-400 2xl:inline",
    after: "max-2xl:hidden text-gray-400 2xl:inline",
  },
];

/*
 * Strings whose answer turns on a precedence rule rather than on one
 * breakpoint: max-* over unprefixed, the narrower max-* over the wider, a
 * min-width variant over a max-width one, and the order display utilities
 * keep inside one block (`hidden` last, `grid` after `flex` after `block`).
 */
const PRECEDENCE_PROBES: Array<string> = [
  "flex max-lg:hidden",
  "max-xl:hidden max-md:block",
  "max-lg:hidden sm:block",
  "hidden flex",
  "block inline-flex",
  "contents grid inline-block",
  "md:grid md:flex md:block",
  "max-md:hidden md:inline-flex",
  "max-sm:hidden sm:inline-block",
  "max-sm:hidden sm:inline",
  "text-sm font-medium",
];

/*
 * Every display utility Tailwind 3.4.5 has, alphabetically: the order that
 * matters is the one the CDN emits them in, and that is read from its output.
 */
const EVERY_DISPLAY_UTILITY: string =
  "block contents flex flow-root grid hidden inline inline-block inline-flex inline-grid inline-table list-item table table-caption table-cell table-column table-column-group table-footer-group table-header-group table-row table-row-group";

// Named viewports; every breakpoint edge the CDN emits is added on top.
const ASSERTED_WIDTHS_IN_PX: Array<number> = [
  PHONE_WIDTH_IN_PX,
  640,
  767,
  TABLET_WIDTH_IN_PX,
  1024,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

interface PlayCdnGlobal {
  config: Record<string, unknown>;
  defaultTheme: { screens: Record<string, string> };
}

interface EmittedRule {
  order: number;
  // Enclosing at-rule preludes, outermost first: "@media (min-width: 640px)".
  atRules: Array<string>;
  selector: string;
  declarations: string;
}

interface DisplayDeclaration {
  value: string;
  important: boolean;
}

function playCdn(): PlayCdnGlobal | undefined {
  return (window as unknown as { tailwind?: PlayCdnGlobal }).tailwind;
}

// The <style> the CDN appends to <head>, recognised by its license banner.
function playCdnCss(): string {
  const style: HTMLStyleElement | undefined = Array.from(
    document.head.querySelectorAll("style"),
  ).find((element: HTMLStyleElement) => {
    return (element.textContent || "").includes("tailwindcss v");
  });

  return style?.textContent || "";
}

/*
 * A small parser for the stylesheet the CDN writes: comments dropped, quoted
 * strings and backslash escapes kept intact (Tailwind escapes `:`, `[`, `(`
 * and friends in class names), and every style rule recorded with the at-rules
 * around it and its position in the sheet.
 */
function parseStylesheet(css: string): Array<EmittedRule> {
  const rules: Array<EmittedRule> = [];
  const atRules: Array<string> = [];
  let selector: string | null = null;
  let buffer: string = "";
  let index: number = 0;

  while (index < css.length) {
    const character: string = css[index]!;

    if (character === "\\") {
      buffer += css.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (character === "/" && css[index + 1] === "*") {
      const commentEnd: number = css.indexOf("*/", index + 2);
      index = commentEnd === -1 ? css.length : commentEnd + 2;
      continue;
    }

    if (character === '"' || character === "'") {
      let stringEnd: number = index + 1;

      while (stringEnd < css.length && css[stringEnd] !== character) {
        stringEnd += css[stringEnd] === "\\" ? 2 : 1;
      }

      buffer += css.slice(index, stringEnd + 1);
      index = stringEnd + 1;
      continue;
    }

    if (character === "{") {
      const prelude: string = buffer.trim();

      if (prelude.startsWith("@")) {
        atRules.push(prelude);
      } else {
        selector = prelude;
      }

      buffer = "";
    } else if (character === "}") {
      if (selector !== null) {
        rules.push({
          order: rules.length,
          atRules: [...atRules],
          selector: selector,
          declarations: buffer.trim(),
        });
        selector = null;
      } else {
        atRules.pop();
      }

      buffer = "";
    } else {
      buffer += character;
    }

    index++;
  }

  return rules;
}

const HEX_DIGIT_FIRST: RegExp = /^[0-9a-fA-F]/;
const LONE_CLASS_SELECTOR: RegExp =
  /^\.((?:\\[0-9a-fA-F]{1,6}\s?|\\[\s\S]|[\w-])+)$/;
const DISPLAY_DECLARATION: RegExp =
  /(?:^|;)\s*display\s*:\s*([^;!]+?)\s*(!\s*important)?\s*(?:;|$)/;
const TAILWIND_CONFIG_ASSIGNMENT: RegExp =
  /tailwind\.config\s*=\s*([\s\S]*?)<\/script>/;

// `\:` -> `:`, `\32xl` -> `2xl`, `\2c ` -> `,` (CSS identifier escapes).
function unescapeCssIdentifier(escaped: string): string {
  return escaped.replace(
    /\\([0-9a-fA-F]{1,6}\s?|[\s\S])/g,
    (_escape: string, sequence: string): string => {
      if (HEX_DIGIT_FIRST.test(sequence)) {
        return String.fromCodePoint(parseInt(sequence.trim(), 16));
      }

      return sequence;
    },
  );
}

/*
 * The class name when the selector is one lone class (`.max-md\:hidden`,
 * `.\32xl\:flex`) and null otherwise. Lone-class rules are the ones
 * ResponsiveVisibility.ts models, and they all share one specificity, so
 * source order alone decides between them.
 */
function loneClassName(selector: string): string | null {
  const match: RegExpExecArray | null = LONE_CLASS_SELECTOR.exec(selector);

  return match ? unescapeCssIdentifier(match[1]!) : null;
}

function displayDeclaration(declarations: string): DisplayDeclaration | null {
  const match: RegExpExecArray | null = DISPLAY_DECLARATION.exec(declarations);

  if (!match) {
    return null;
  }

  return { value: match[1]!, important: Boolean(match[2]) };
}

const MIN_WIDTH_MEDIA: RegExp = /^@media \(min-width: (\d+)px\)$/;
const BELOW_WIDTH_MEDIA: RegExp = /^@media not all and \(min-width: (\d+)px\)$/;

/*
 * Whether a rule's media applies at a viewport width, read from the px in the
 * emitted query rather than from the helper's breakpoint table. Anything but
 * the two forms ResponsiveVisibility.ts models is an error, not a guess.
 */
function appliesAtWidth(rule: EmittedRule, viewportWidthInPx: number): boolean {
  if (rule.atRules.length === 0) {
    return true;
  }

  if (rule.atRules.length === 1) {
    const minWidth: RegExpExecArray | null = MIN_WIDTH_MEDIA.exec(
      rule.atRules[0]!,
    );

    if (minWidth) {
      return viewportWidthInPx >= Number(minWidth[1]);
    }

    const belowWidth: RegExpExecArray | null = BELOW_WIDTH_MEDIA.exec(
      rule.atRules[0]!,
    );

    if (belowWidth) {
      return viewportWidthInPx < Number(belowWidth[1]);
    }
  }

  throw new Error(
    `${rule.selector} is emitted inside ${JSON.stringify(
      rule.atRules,
    )}; ResponsiveVisibility.ts only models "(min-width: Npx)" and "not all and (min-width: Npx)", so it needs updating for this Tailwind output`,
  );
}

/*
 * The display a browser would compute from these rules for an element carrying
 * `classAttribute`: the last applicable declaration wins, unless an earlier
 * one is !important and it is not. Returned in utility terms (`none` reads as
 * `hidden`) so it compares directly with resolveDisplay.
 */
function cascadeDisplay(
  rules: Array<EmittedRule>,
  classAttribute: string,
  viewportWidthInPx: number,
): string | null {
  const tokens: Set<string> = new Set(
    classAttribute.split(/\s+/).filter(Boolean),
  );
  let winner: DisplayDeclaration | null = null;

  for (const rule of rules) {
    const className: string | null = loneClassName(rule.selector);

    if (className === null || !tokens.has(className)) {
      continue;
    }

    const display: DisplayDeclaration | null = displayDeclaration(
      rule.declarations,
    );

    if (!display || !appliesAtWidth(rule, viewportWidthInPx)) {
      continue;
    }

    if (!winner || display.important || !winner.important) {
      winner = display;
    }
  }

  if (!winner) {
    return null;
  }

  return winner.value === "none" ? "hidden" : winner.value;
}

// The object literal assigned to `tailwind.config` in an index.ejs, if any.
function tailwindConfigSource(indexView: string): string | null {
  const match: RegExpExecArray | null =
    TAILWIND_CONFIG_ASSIGNMENT.exec(indexView);

  return match ? match[1]! : null;
}

/*
 * Whitespace, quotes and trailing commas stripped, so an object literal in
 * index.ejs and JSON.stringify of the same object compare equal.
 */
function normalizeObjectLiteral(source: string): string {
  return source
    .replace(/[\s'"]/g, "")
    .replace(/;$/, "")
    .replace(/,([}\]])/g, "$1");
}

function rulesForClass(
  rules: Array<EmittedRule>,
  className: string,
): Array<EmittedRule> {
  return rules.filter((rule: EmittedRule) => {
    return loneClassName(rule.selector) === className;
  });
}

function rulesForSelector(
  rules: Array<EmittedRule>,
  selector: string,
): Array<EmittedRule> {
  return rules.filter((rule: EmittedRule) => {
    return rule.selector === selector;
  });
}

function everyFixtureClassString(): Array<string> {
  return [
    ...CONVERTED_CLASS_STRINGS.flatMap((pair: ConvertedClassString) => {
      return [pair.before, pair.after];
    }),
    ...PRECEDENCE_PROBES,
    EVERY_DISPLAY_UTILITY,
    ...BREAKPOINTS.map((breakpoint: string) => {
      return `max-${breakpoint}:hidden ${breakpoint}:flex`;
    }),
  ];
}

/*
 * The CDN keeps two MutationObservers on the document for the life of the page
 * and exposes neither. jsdom empties the document when the file finishes, the
 * observers fire into a window that no longer has one, and the worker dies on
 * a TypeError. Recording them as they are built lets afterAll disconnect them.
 */
const OriginalMutationObserver: typeof MutationObserver =
  window.MutationObserver;
const playCdnObservers: Array<MutationObserver> = [];

class RecordingMutationObserver extends OriginalMutationObserver {
  public constructor(callback: MutationCallback) {
    super(callback);
    playCdnObservers.push(this);
  }
}

// Carried by the fixture container only, so its rule marks the fixture build.
const FIXTURE_SENTINEL_CLASS: string = "isolate";

let emittedCss: string = "";
let emittedRules: Array<EmittedRule> = [];
let detailsFixture: HTMLDetailsElement;
let detailsFixtureLabel: HTMLSpanElement;

beforeAll(async () => {
  window.MutationObserver = RecordingMutationObserver;

  // The CDN announces itself on console.warn; that is noise here, not news.
  const warn: ReturnType<typeof jest.spyOn> = jest
    .spyOn(console, "warn")
    .mockImplementation(() => {});

  const script: HTMLScriptElement = document.createElement("script");
  script.textContent = fs.readFileSync(PLAY_CDN_PATH, "utf-8");
  document.head.appendChild(script);

  warn.mockRestore();

  const cdn: PlayCdnGlobal | undefined = playCdn();

  if (!cdn) {
    throw new Error(
      "the vendored Play CDN did not run: jest-environment-jsdom must execute <script> elements (runScripts: 'dangerously')",
    );
  }

  cdn.config = INDEX_VIEW_TAILWIND_CONFIG;

  /*
   * Setting the config starts a full build. Let it land before adding the
   * fixture, so it cannot finish late and overwrite the build that follows.
   */
  await waitFor(
    () => {
      expect(playCdnCss()).not.toBe("");
    },
    { timeout: 30000 },
  );

  const fixture: HTMLDivElement = document.createElement("div");
  fixture.className = FIXTURE_SENTINEL_CLASS;

  for (const classAttribute of everyFixtureClassString()) {
    const element: HTMLDivElement = document.createElement("div");
    element.className = classAttribute;
    fixture.appendChild(element);
  }

  // The facet row's remove button, inside its `group` row.
  const facetRow: HTMLDivElement = document.createElement("div");
  facetRow.className = "group flex";
  const removeButton: HTMLButtonElement = document.createElement("button");
  removeButton.className = `flex h-5 w-5 items-center ${GROUP_NOT_HOVER_HIDDEN}`;
  facetRow.appendChild(removeButton);
  fixture.appendChild(facetRow);

  // The runbook step label, in the details > summary > span shape it ships in.
  detailsFixture = document.createElement("details");
  const summary: HTMLElement = document.createElement("summary");
  detailsFixtureLabel = document.createElement("span");
  detailsFixtureLabel.className = `inline ${DETAILS_CLOSED_HIDDEN}`;
  summary.appendChild(detailsFixtureLabel);
  detailsFixture.appendChild(summary);
  fixture.appendChild(detailsFixture);

  document.body.appendChild(fixture);

  /*
   * The fixture goes in with one append and the CDN collects every class in
   * the document in one pass, so once the container's own class is in the
   * sheet the rest of the fixture is too. Waiting on that, not on the rules
   * under test, lets a changed rule fail its own test with its own message.
   */
  await waitFor(
    () => {
      expect(
        rulesForClass(parseStylesheet(playCdnCss()), FIXTURE_SENTINEL_CLASS),
      ).toHaveLength(1);
    },
    { timeout: 30000 },
  );

  emittedCss = playCdnCss();
  emittedRules = parseStylesheet(emittedCss);
}, 60000);

afterAll(() => {
  for (const observer of playCdnObservers) {
    observer.disconnect();
  }

  window.MutationObserver = OriginalMutationObserver;
});

describe("vendored Tailwind Play CDN output", () => {
  test("is the 3.4.5 build, and its screens are the breakpoints ResponsiveVisibility.ts assumes", () => {
    expect(emittedCss).toContain("tailwindcss v3.4.5");

    const expectedScreens: Record<string, string> = {};

    for (const breakpoint of BREAKPOINTS) {
      expectedScreens[breakpoint] =
        `${TAILWIND_BREAKPOINTS_IN_PX[breakpoint]}px`;
    }

    expect(playCdn()!.defaultTheme.screens).toEqual(expectedScreens);
  });

  test("is configured here exactly as the Dashboard's index.ejs configures it", () => {
    const source: string | null = tailwindConfigSource(
      fs.readFileSync(DASHBOARD_INDEX_VIEW, "utf8"),
    );

    expect(source).not.toBeNull();
    expect(normalizeObjectLiteral(source!)).toBe(
      normalizeObjectLiteral(JSON.stringify(INDEX_VIEW_TAILWIND_CONFIG)),
    );
  });

  test("no frontend that loads it redefines the screens", () => {
    /*
     * A `screens` entry would move the breakpoints the helper and this file
     * assume, and Tailwind 3 only generates max-* variants while every screen
     * is a plain min-width - a customised one can make them vanish, and the
     * fix with them.
     */
    const viewsLoadingTheCdn: Array<string> = [];
    const viewsRedefiningScreens: Array<string> = [];

    for (const featureSet of fs.readdirSync(FEATURE_SET_ROOT)) {
      const indexViewPath: string = path.join(
        FEATURE_SET_ROOT,
        featureSet,
        "views",
        "index.ejs",
      );

      if (!fs.existsSync(indexViewPath)) {
        continue;
      }

      const indexView: string = fs.readFileSync(indexViewPath, "utf8");

      if (!indexView.includes("tailwind-3.4.5.js")) {
        continue;
      }

      viewsLoadingTheCdn.push(featureSet);

      if ((tailwindConfigSource(indexView) || "").includes("screens")) {
        viewsRedefiningScreens.push(featureSet);
      }
    }

    expect(viewsLoadingTheCdn).toEqual(
      expect.arrayContaining([
        "Accounts",
        "AdminDashboard",
        "Dashboard",
        "PublicDashboard",
        "StatusPage",
      ]),
    );
    expect(viewsRedefiningScreens).toEqual([]);
  });

  test.each(BREAKPOINTS)(
    "max-%s:hidden is display:none below the breakpoint and nothing from it up",
    (breakpoint: string) => {
      const rules: Array<EmittedRule> = rulesForClass(
        emittedRules,
        `max-${breakpoint}:hidden`,
      );

      expect(
        rules.map((rule: EmittedRule) => {
          return { atRules: rule.atRules, declarations: rule.declarations };
        }),
      ).toEqual([
        {
          atRules: [
            `@media not all and (min-width: ${TAILWIND_BREAKPOINTS_IN_PX[breakpoint]}px)`,
          ],
          declarations: "display:none",
        },
      ]);
    },
  );

  test.each(BREAKPOINTS)(
    "%s:flex, the counterpart that shows the element again, applies from the breakpoint up",
    (breakpoint: string) => {
      const rules: Array<EmittedRule> = rulesForClass(
        emittedRules,
        `${breakpoint}:flex`,
      );

      expect(
        rules.map((rule: EmittedRule) => {
          return { atRules: rule.atRules, declarations: rule.declarations };
        }),
      ).toEqual([
        {
          atRules: [
            `@media (min-width: ${TAILWIND_BREAKPOINTS_IN_PX[breakpoint]}px)`,
          ],
          declarations: "display:flex",
        },
      ]);
    },
  );

  test("every responsive display rule sits in the media query its variant names", () => {
    const misplaced: Array<string> = [];
    let responsiveDisplayRules: number = 0;

    for (const rule of emittedRules) {
      const className: string | null = loneClassName(rule.selector);

      if (className === null || !displayDeclaration(rule.declarations)) {
        continue;
      }

      const parts: Array<string> = splitVariants(className);

      if (parts.length !== 2) {
        continue;
      }

      const variant: string = parts[0]!;
      const isMaxVariant: boolean = variant.startsWith("max-");
      const breakpoint: string = isMaxVariant ? variant.slice(4) : variant;
      const breakpointInPx: number | undefined =
        TAILWIND_BREAKPOINTS_IN_PX[breakpoint];

      if (breakpointInPx === undefined) {
        continue;
      }

      responsiveDisplayRules++;

      const expectedMedia: string = isMaxVariant
        ? `@media not all and (min-width: ${breakpointInPx}px)`
        : `@media (min-width: ${breakpointInPx}px)`;

      if (rule.atRules.length !== 1 || rule.atRules[0] !== expectedMedia) {
        misplaced.push(`${rule.selector} in ${JSON.stringify(rule.atRules)}`);
      }
    }

    expect(misplaced).toEqual([]);
    // sm..2xl in both directions at the very least, so the loop did look.
    expect(responsiveDisplayRules).toBeGreaterThanOrEqual(
      2 * BREAKPOINTS.length,
    );
  });

  test("display blocks come out in the order ResponsiveVisibility.ts ranks them", () => {
    /*
     * Every lone-class display rule, labelled with its variant, in sheet
     * order, with runs of the same label collapsed. A block that is split up
     * or out of place shows up as a repeated or misplaced label.
     */
    const emittedOrder: Array<string> = [];

    for (const rule of emittedRules) {
      const className: string | null = loneClassName(rule.selector);

      if (className === null || !displayDeclaration(rule.declarations)) {
        continue;
      }

      const parts: Array<string> = splitVariants(className);
      const group: string = parts.length === 1 ? "unprefixed" : parts[0]!;

      if (emittedOrder[emittedOrder.length - 1] !== group) {
        emittedOrder.push(group);
      }
    }

    expect(emittedOrder).toEqual(EMIT_ORDER_ASSUMED_BY_RESPONSIVE_VISIBILITY);
  });

  test("inside a block, the display utility emitted later is the one ResponsiveVisibility.ts lets win", () => {
    const everyDisplayUtility: Array<string> = EVERY_DISPLAY_UTILITY.split(" ");
    const emittedDisplayOrder: Array<string> = emittedRules
      .map((rule: EmittedRule) => {
        return loneClassName(rule.selector);
      })
      .filter((className: string | null): className is string => {
        return className !== null && everyDisplayUtility.includes(className);
      });

    expect([...emittedDisplayOrder].sort()).toEqual(
      [...everyDisplayUtility].sort(),
    );

    /*
     * Adjacent pairs are enough: the model ranks utilities on one list, so
     * agreeing on every neighbour means agreeing on the whole order.
     */
    const disagreements: Array<string> = [];

    for (let index: number = 1; index < emittedDisplayOrder.length; index++) {
      const earlier: string = emittedDisplayOrder[index - 1]!;
      const later: string = emittedDisplayOrder[index]!;
      const modelWinner: string | null = resolveDisplay(
        `${later} ${earlier}`,
        LAPTOP_WIDTH_IN_PX,
      );

      if (modelWinner !== later) {
        disagreements.push(
          `${earlier} is emitted before ${later}, but the model picks ${modelWinner}`,
        );
      }
    }

    expect(disagreements).toEqual([]);
  });

  test("group-[:not(:hover)]:hidden emits the selector the facet rows rely on", () => {
    const rules: Array<EmittedRule> = rulesForSelector(
      emittedRules,
      GROUP_NOT_HOVER_HIDDEN_SELECTOR,
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]!.atRules).toEqual([]);
    expect(rules[0]!.declarations).toBe("display:none");

    /*
     * It has to beat the unprefixed `flex` on the same button. It outranks it
     * on specificity and it also comes later, so it wins either way.
     */
    const flex: EmittedRule = rulesForClass(emittedRules, "flex")[0]!;
    expect(rules[0]!.order).toBeGreaterThan(flex.order);
  });

  test("[details:not([open])>summary>&]:hidden emits the selector the runbook view relies on, and it lets go of an open <details>", () => {
    const rules: Array<EmittedRule> = rulesForSelector(
      emittedRules,
      DETAILS_CLOSED_HIDDEN_SELECTOR,
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]!.atRules).toEqual([]);
    expect(rules[0]!.declarations).toBe("display:none");

    const inline: EmittedRule = rulesForClass(emittedRules, "inline")[0]!;
    expect(rules[0]!.order).toBeGreaterThan(inline.order);

    // `&` became the element's own class, so it selects the label itself ...
    expect(detailsFixtureLabel.matches(rules[0]!.selector)).toBe(true);

    // ... and only while the disclosure is closed.
    detailsFixture.open = true;

    try {
      expect(detailsFixtureLabel.matches(rules[0]!.selector)).toBe(false);
    } finally {
      detailsFixture.open = false;
    }
  });
});

describe("the emitted cascade agrees with resolveDisplay", () => {
  /*
   * Each breakpoint's last hidden pixel and first shown pixel, read from the
   * media queries the CDN actually wrote, on top of the named viewports.
   */
  function widthsToCheck(): Array<number> {
    const widths: Set<number> = new Set(ASSERTED_WIDTHS_IN_PX);

    for (const rule of emittedRules) {
      for (const atRule of rule.atRules) {
        const media: RegExpExecArray | null =
          MIN_WIDTH_MEDIA.exec(atRule) || BELOW_WIDTH_MEDIA.exec(atRule);

        if (media) {
          widths.add(Number(media[1]) - 1);
          widths.add(Number(media[1]));
        }
      }
    }

    return Array.from(widths).sort((left: number, right: number) => {
      return left - right;
    });
  }

  function cascadeAcrossWidths(
    rules: Array<EmittedRule>,
    classAttribute: string,
  ): Array<string> {
    return widthsToCheck().map((width: number) => {
      return `${width}px: ${cascadeDisplay(rules, classAttribute, width)}`;
    });
  }

  function modelAcrossWidths(
    classAttribute: string,
    withForeignHiddenRule: boolean,
  ): Array<string> {
    return widthsToCheck().map((width: number) => {
      return `${width}px: ${resolveDisplay(classAttribute, width, {
        withForeignHiddenRule,
      })}`;
    });
  }

  test("the widths checked include every breakpoint edge", () => {
    const widths: Array<number> = widthsToCheck();

    for (const breakpoint of BREAKPOINTS) {
      const breakpointInPx: number = TAILWIND_BREAKPOINTS_IN_PX[breakpoint]!;
      expect(widths).toEqual(
        expect.arrayContaining([breakpointInPx - 1, breakpointInPx]),
      );
    }
  });

  test.each(everyFixtureClassString())(
    '"%s" resolves the same from the real CSS as from the model, with and without a foreign .hidden rule',
    (classAttribute: string) => {
      expect(cascadeAcrossWidths(emittedRules, classAttribute)).toEqual(
        modelAcrossWidths(classAttribute, false),
      );

      // Appended after Tailwind's <style>, as an extension or user sheet is.
      for (const foreignCss of [
        FOREIGN_HIDDEN_RULE_CSS,
        APPENDED_PLAIN_HIDDEN_RULE_CSS,
      ]) {
        expect(
          cascadeAcrossWidths(
            parseStylesheet(emittedCss + foreignCss),
            classAttribute,
          ),
        ).toEqual(modelAcrossWidths(classAttribute, true));
      }
    },
  );

  test.each(CONVERTED_CLASS_STRINGS)(
    "$where: the new classes paint exactly as the old ones did, and a foreign .hidden rule no longer removes them",
    ({ before, after }: ConvertedClassString) => {
      // Display-equivalent at every width, by the real stylesheet.
      expect(cascadeAcrossWidths(emittedRules, after)).toEqual(
        cascadeAcrossWidths(emittedRules, before),
      );

      for (const foreignCss of [
        FOREIGN_HIDDEN_RULE_CSS,
        APPENDED_PLAIN_HIDDEN_RULE_CSS,
      ]) {
        const withForeignRule: Array<EmittedRule> = parseStylesheet(
          emittedCss + foreignCss,
        );

        // Immune: the foreign rule changes nothing for the new classes ...
        expect(cascadeAcrossWidths(withForeignRule, after)).toEqual(
          cascadeAcrossWidths(emittedRules, after),
        );

        /*
         * ... while the same check fails for the old ones. At the customer's
         * 1917px the old classes were on screen and the foreign rule took
         * them off it - the missing navigation bar, reproduced from the real
         * CSS.
         */
        expect(cascadeAcrossWidths(withForeignRule, before)).not.toEqual(
          cascadeAcrossWidths(emittedRules, before),
        );
        expect(
          cascadeDisplay(emittedRules, before, WIDE_DESKTOP_WIDTH_IN_PX),
        ).not.toBe("hidden");
        expect(
          cascadeDisplay(withForeignRule, before, WIDE_DESKTOP_WIDTH_IN_PX),
        ).toBe("hidden");
        expect(
          cascadeDisplay(withForeignRule, after, WIDE_DESKTOP_WIDTH_IN_PX),
        ).not.toBe("hidden");
      }
    },
  );
});
