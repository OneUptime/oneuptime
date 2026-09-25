import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ClassCandidate,
  collectClassCandidates,
  describeCandidate,
} from "../ClassStrings";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";
import { splitVariants } from "../ResponsiveVisibility";
import { StyleRule, THEME_RULES } from "./Styles/ThemeStylesheet";

/*
 * The dark theme brightens the gray text of a hover reveal while its group is
 * hovered: the facet rows' exclude button and the Profiles hint are
 * text-gray-400 at rest, and Theme.css lifts them to the primary text colour
 * on hover, keyed on attribute substrings -
 *
 *   html.dark .group:hover [class*="group-hover"][class*="text-gray-"]
 *
 * The foreign `.hidden{display:none !important}` fix rewrote those reveals
 * from `hidden group-hover:flex` to `flex group-[:not(:hover)]:hidden`, which
 * no longer contains "group-hover". Nothing failed: the elements still showed
 * on hover, only in the wrong colour, and only in dark mode. Review caught it
 * and Theme.css gained a twin selector keyed on "group-[:not(:hover)".
 *
 * These pin that twin from both ends. The sheet has to brighten both shapes
 * with one declaration, and every hover reveal in the source that carries a
 * gray text class has to match one of the rule's substring pairs - so a later
 * rewrite of either the markup or the rule cannot quietly change the colour
 * again. The reveals are found by walking the same trees the foreign-rule
 * guard reads (ForeignHiddenRuleGuard.ts), not by listing them, and the three
 * known ones are checked to be among what the walk found. The class strings
 * come out of each module through ClassStrings.ts, which fills every
 * template's branches in, so a reveal assembled in a template is read whole.
 *
 * jsdom then gives a second opinion: every selector in the sheet it can
 * evaluate is matched against the converted element and against the class it
 * replaced, and the two must be painted by the same declarations. jsdom
 * cannot model :hover - nwsapi drops the pseudo-class entirely while the
 * document has never had focus, and never matches it once something has been
 * focused, because jsdom has no hovered element - so the `.group:hover` gate
 * is taken off before matching and asserted textually instead, and selectors
 * that need some other state (:focus, a pseudo-element, a rule nwsapi cannot
 * parse) are left out. It is the attribute part, which is what the
 * conversion changed, that jsdom answers.
 */

// packages/Common/Tests/UI -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// Exactly as Theme.css spells them.
const GROUP_HOVER_BRIGHTEN_SELECTOR: string =
  'html.dark .group:hover [class*="group-hover"][class*="text-gray-"]';
const NEGATED_HOVER_BRIGHTEN_SELECTOR: string =
  'html.dark .group:hover [class*="group-[:not(:hover)"][class*="text-gray-"]';

const GROUP_HOVER_GATE: string = "html.dark .group:hover ";

// The substring the review found missing.
const NEGATED_HOVER_SUBSTRING: string = "group-[:not(:hover)";

// The converted reveals, relative to the repository root.
const FACET_VALUE_ROW_FILE: string =
  "packages/Common/UI/Components/LogsViewer/components/FacetValueRow.tsx";
const TELEMETRY_FACET_VALUE_ROW_FILE: string =
  "packages/Common/UI/Components/TelemetryViewer/components/TelemetryFacetValueRow.tsx";
const PROFILES_DASHBOARD_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Profiles/ProfilesDashboard.tsx";

const KNOWN_REVEAL_FILES: Array<string> = [
  FACET_VALUE_ROW_FILE,
  TELEMETRY_FACET_VALUE_ROW_FILE,
  PROFILES_DASHBOARD_FILE,
];

// The facet rows' exclude button after the fix, and before it (git 17084e6b23).
const CONVERTED_FACET_EXCLUDE_CLASS: string =
  "flex h-5 w-5 items-center justify-center rounded text-[10px] text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 group-[:not(:hover)]:hidden";
const PRE_FIX_FACET_EXCLUDE_CLASS: string =
  "hidden h-5 w-5 items-center justify-center rounded text-[10px] text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:flex";

// The Profiles hint with the template's non-highlighted branch filled in.
const CONVERTED_PROFILES_HINT_CLASS: string =
  "flex-shrink-0 text-[10px] text-gray-400 inline group-[:not(:hover)]:hidden";
const PRE_FIX_PROFILES_HINT_CLASS: string =
  "flex-shrink-0 text-[10px] text-gray-400 hidden group-hover:inline";

// Kept in step with the list in ResponsiveVisibility.ts.
const DISPLAY_UTILITIES: ReadonlySet<string> = new Set<string>([
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "table",
  "inline-table",
  "table-caption",
  "table-cell",
  "table-column",
  "table-column-group",
  "table-footer-group",
  "table-header-group",
  "table-row-group",
  "table-row",
  "flow-root",
  "grid",
  "inline-grid",
  "contents",
  "list-item",
]);

// A selector tail made only of `[class*="..."]` tests.
const ATTRIBUTE_SUBSTRINGS_ONLY: RegExp = /^(?:\[class\*="[^"]*"\])+$/;

// `group-[:not(:hover)]`, `group-[:not(:hover):not(:focus-within)]` ...
const NEGATED_GROUP_HOVER_VARIANT: RegExp = /^group-\[.*:not\(:hover\).*\]$/;

const GRAY_TEXT_UTILITY: RegExp = /^text-gray-\d+/;

/* ------------------------------------------------------------------------ */
/* Theme.css                                                                */
/* ------------------------------------------------------------------------ */

/*
 * ThemeStylesheet splits a prelude on every comma, including the ones inside
 * :is(...), so a rule's selector list is rebuilt here and split only on the
 * commas at the top level.
 */
function splitSelectorList(selectorText: string): Array<string> {
  const selectors: Array<string> = [];
  let depth: number = 0;
  let quote: string | null = null;
  let current: string = "";

  for (const character of selectorText) {
    if (quote) {
      if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(" || character === "[") {
      depth++;
    } else if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      selectors.push(current.replace(/\s+/g, " ").trim());
      current = "";
      continue;
    }

    current += character;
  }

  selectors.push(current.replace(/\s+/g, " ").trim());

  return selectors.filter(Boolean);
}

function selectorsOf(rule: StyleRule): Array<string> {
  return splitSelectorList(rule.selectors.join(","));
}

function rulesWithSelector(
  rules: Array<StyleRule>,
  selector: string,
): Array<StyleRule> {
  return rules.filter((rule: StyleRule): boolean => {
    return selectorsOf(rule).includes(selector);
  });
}

// Every declaration the sheet gives the selector, in source order.
function declarationsFor(
  rules: Array<StyleRule>,
  selector: string,
): Record<string, string> {
  const declarations: Record<string, string> = {};

  for (const rule of rulesWithSelector(rules, selector)) {
    Object.assign(declarations, rule.declarations);
  }

  return declarations;
}

/*
 * The substrings a `GATE [class*="a"][class*="b"]...` selector requires of
 * the class attribute, or null for a selector of any other shape.
 */
function requiredSubstrings(selector: string): Array<string> | null {
  if (!selector.startsWith(GROUP_HOVER_GATE)) {
    return null;
  }

  const attributePart: string = selector.slice(GROUP_HOVER_GATE.length);

  if (!ATTRIBUTE_SUBSTRINGS_ONLY.test(attributePart)) {
    return null;
  }

  return Array.from(
    attributePart.matchAll(/\[class\*="([^"]*)"\]/g),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

/*
 * The substring pairs of the rule that brightens a group-hover reveal: every
 * gated attribute-substring selector in the rule(s) that carry the original
 * group-hover selector.
 */
function brightenSubstringSets(rules: Array<StyleRule>): Array<Array<string>> {
  const sets: Array<Array<string>> = [];

  for (const rule of rulesWithSelector(rules, GROUP_HOVER_BRIGHTEN_SELECTOR)) {
    for (const selector of selectorsOf(rule)) {
      const substrings: Array<string> | null = requiredSubstrings(selector);

      if (substrings) {
        sets.push(substrings);
      }
    }
  }

  return sets;
}

// `[class*="x"]` is a plain substring test on the whole attribute value.
function isBrightened(
  classAttribute: string,
  substringSets: Array<Array<string>>,
): boolean {
  return substringSets.some((substrings: Array<string>): boolean => {
    return substrings.every((substring: string): boolean => {
      return classAttribute.includes(substring);
    });
  });
}

/*
 * The sheet as it stood when review found the regression: the same rules,
 * minus every selector keyed on the negated-hover substring.
 */
function withoutNegatedHoverSelectors(
  rules: Array<StyleRule>,
): Array<StyleRule> {
  return rules.map((rule: StyleRule): StyleRule => {
    return {
      ...rule,
      selectors: selectorsOf(rule).filter((selector: string): boolean => {
        return !selector.includes(NEGATED_HOVER_SUBSTRING);
      }),
    };
  });
}

/* ------------------------------------------------------------------------ */
/* Source                                                                   */
/* ------------------------------------------------------------------------ */

function tokensOf(classText: string): Array<string> {
  return classText.split(/\s+/).filter(Boolean);
}

/*
 * `group-[:not(:hover)]:hidden` and the like: a group-hover reveal written so
 * the foreign rule cannot pin it shut. Only the unnamed group counts - the
 * Theme.css rule is gated on `.group:hover`, which a named group
 * (`group/nav-row`, revealed by `group-[...]/nav-row:hidden`) never matches.
 */
function isGroupHoverReveal(token: string): boolean {
  const parts: Array<string> = splitVariants(token);

  return (
    parts.length === 2 &&
    parts[1] === "hidden" &&
    NEGATED_GROUP_HOVER_VARIANT.test(parts[0]!)
  );
}

interface RevealScan {
  reveals: Array<ClassCandidate>;
  filesRead: number;
}

/*
 * Every class string in the browser source that reveals an element on group
 * hover, found by walking the same trees the foreign-rule guard reads.
 */
function findGroupHoverReveals(): RevealScan {
  const reveals: Array<ClassCandidate> = [];
  let filesRead: number = 0;

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const filePath of listSourceFiles(root)) {
      filesRead++;
      const sourceText: string = fs.readFileSync(filePath, "utf8");

      if (!sourceText.includes(":not(:hover)")) {
        continue;
      }

      const relativePath: string = toRelativePath(REPOSITORY_ROOT, filePath);

      for (const candidate of collectClassCandidates(
        relativePath,
        sourceText,
      )) {
        if (tokensOf(candidate.classText).some(isGroupHoverReveal)) {
          reveals.push(candidate);
        }
      }
    }
  }

  return { reveals: reveals, filesRead: filesRead };
}

/*
 * Put the pre-fix idiom back: the element's own display utility becomes the
 * bare `hidden` it replaced, and the negated-hover hide becomes the
 * `group-hover:<display>` that used to show it. Every converted reveal was
 * written that way before the fix, so this rebuilds the old class exactly.
 */
function restorePreFixHoverReveal(classText: string): string {
  const tokens: Array<string> = tokensOf(classText);
  const revealIndex: number = tokens.findIndex(isGroupHoverReveal);
  const displayIndex: number = tokens.findIndex((token: string): boolean => {
    return DISPLAY_UTILITIES.has(token);
  });

  if (revealIndex === -1 || displayIndex === -1) {
    return classText;
  }

  const display: string = tokens[displayIndex]!;
  tokens[displayIndex] = "hidden";
  tokens[revealIndex] = `group-hover:${display}`;

  return tokens.join(" ");
}

function hasGrayText(classText: string): boolean {
  return tokensOf(classText).some((token: string): boolean => {
    return GRAY_TEXT_UTILITY.test(splitVariants(token).pop()!);
  });
}

/* ------------------------------------------------------------------------ */
/* jsdom                                                                    */
/* ------------------------------------------------------------------------ */

const USER_ACTION_PSEUDO_CLASS: RegExp =
  /:(?:hover|active|focus|focus-within|focus-visible|visited)\b/;

/*
 * The selector with its `.group:hover` gate reduced to `.group`, or null when
 * something jsdom cannot answer is left in it (another user-action
 * pseudo-class, or a pseudo-element). Quoted attribute values are left alone:
 * `[class*="group-[:not(:hover)"]` is a substring, not a pseudo-class.
 */
function withoutHoverGate(selector: string): string | null {
  const pieces: Array<string> = selector.split(/("[^"]*"|'[^']*')/);
  let rewritten: string = "";

  for (let index: number = 0; index < pieces.length; index++) {
    const piece: string = pieces[index]!;

    if (index % 2 === 1) {
      rewritten += piece;
      continue;
    }

    const ungated: string = piece.replace(/\.group:hover(?![\w-])/g, ".group");

    if (USER_ACTION_PSEUDO_CLASS.test(ungated) || ungated.includes("::")) {
      return null;
    }

    rewritten += ungated;
  }

  return rewritten;
}

interface EvaluableRule {
  selector: string;
  declarations: Record<string, string>;
}

interface EvaluableSheet {
  rules: Array<EvaluableRule>;
  /*
   * Selectors jsdom cannot answer: another user-action state, a
   * pseudo-element, or syntax nwsapi rejects (:fullscreen, some :is(...)).
   */
  skipped: number;
}

/*
 * Every selector in the sheet that jsdom can evaluate once the `.group:hover`
 * gate is lifted - the whole sheet, not just the brighten rule, so a rule
 * that painted the old element and not the new one cannot hide anywhere
 * jsdom can see.
 */
function jsdomEvaluableSheet(rules: Array<StyleRule>): EvaluableSheet {
  const evaluable: Array<EvaluableRule> = [];
  let skipped: number = 0;

  for (const rule of rules) {
    for (const selector of selectorsOf(rule)) {
      const ungated: string | null = withoutHoverGate(selector);

      if (!ungated) {
        skipped++;
        continue;
      }

      try {
        document.documentElement.matches(ungated);
      } catch {
        skipped++;
        continue;
      }

      evaluable.push({ selector: ungated, declarations: rule.declarations });
    }
  }

  return { rules: evaluable, skipped: skipped };
}

// An element carrying the class, inside a `.group` under the dark <html>.
function mountRevealIn(classAttribute: string): HTMLElement {
  const group: HTMLDivElement = document.createElement("div");
  group.className = "group";

  const revealed: HTMLButtonElement = document.createElement("button");
  revealed.setAttribute("class", classAttribute);

  group.appendChild(revealed);
  document.body.appendChild(group);

  return revealed;
}

/*
 * What the sheet paints on the element, as jsdom matches it: one
 * "property: value" per declaration, sorted, so two elements painted by the
 * same declarations compare equal whichever selector reached them.
 */
function declarationsOn(
  element: Element,
  sheet: EvaluableSheet,
): Array<string> {
  const applied: Array<string> = [];

  for (const rule of sheet.rules) {
    if (!element.matches(rule.selector)) {
      continue;
    }

    for (const [property, value] of Object.entries(rule.declarations)) {
      applied.push(`${property}: ${value}`);
    }
  }

  return applied.sort();
}

// What `before` has that `after` lacks, counting duplicates.
function missingFrom(
  before: Array<string>,
  after: Array<string>,
): Array<string> {
  const remaining: Array<string> = [...after];

  return before.filter((entry: string): boolean => {
    const index: number = remaining.indexOf(entry);

    if (index === -1) {
      return true;
    }

    remaining.splice(index, 1);
    return false;
  });
}

function brightenEntry(): string {
  return `color: ${declarationsFor(THEME_RULES, GROUP_HOVER_BRIGHTEN_SELECTOR)["color"]!}`;
}

/* ------------------------------------------------------------------------ */

let revealScan: RevealScan = { reveals: [], filesRead: 0 };

/*
 * Parsing ~3,300 files takes seconds. Doing it in beforeAll rather than at
 * module scope keeps it under a timeout and reports a failure as a failed
 * test instead of a suite that could not even be collected.
 */
beforeAll(() => {
  revealScan = findGroupHoverReveals();
}, 180000);

function revealsIn(file: string): Array<ClassCandidate> {
  return revealScan.reveals.filter((candidate: ClassCandidate): boolean => {
    return candidate.file === file;
  });
}

/*
 * The one reveal a known file holds. A rewrite that drops the negated-hover
 * shape (back to `hidden group-hover:flex`, or to something else entirely)
 * fails here by name, so its dark-mode colour gets looked at again.
 */
function onlyRevealIn(file: string): ClassCandidate {
  const reveals: Array<ClassCandidate> = revealsIn(file);

  expect({ file: file, reveals: reveals.length }).toEqual({
    file: file,
    reveals: 1,
  });

  return reveals[0]!;
}

describe("Theme.css brightens a group-hover reveal in either shape", () => {
  test("both selector shapes are in the sheet, gated on the hovered group", () => {
    expect(
      rulesWithSelector(THEME_RULES, GROUP_HOVER_BRIGHTEN_SELECTOR).length,
    ).toBeGreaterThan(0);
    expect(
      rulesWithSelector(THEME_RULES, NEGATED_HOVER_BRIGHTEN_SELECTOR).length,
    ).toBeGreaterThan(0);

    /*
     * Same gate, same specificity: the twin differs from the original in the
     * substring it looks for and nothing else, so it wins exactly where the
     * original did.
     */
    expect(
      NEGATED_HOVER_BRIGHTEN_SELECTOR.replace(
        `[class*="${NEGATED_HOVER_SUBSTRING}"]`,
        '[class*="group-hover"]',
      ),
    ).toBe(GROUP_HOVER_BRIGHTEN_SELECTOR);
  });

  test("both shapes get the same declaration", () => {
    const original: Record<string, string> = declarationsFor(
      THEME_RULES,
      GROUP_HOVER_BRIGHTEN_SELECTOR,
    );
    const twin: Record<string, string> = declarationsFor(
      THEME_RULES,
      NEGATED_HOVER_BRIGHTEN_SELECTOR,
    );

    expect(original["color"]).toBeDefined();
    expect(twin).toEqual(original);

    /*
     * The reveals are text-gray-400, which the dark theme remaps to #94a3b8
     * with !important. A brighten without !important would lose to that
     * however specific its selector.
     */
    expect(original["color"]).toContain("!important");
  });

  test("the rule's substring pairs are the two shapes", () => {
    expect(brightenSubstringSets(THEME_RULES)).toEqual(
      expect.arrayContaining([
        ["group-hover", "text-gray-"],
        [NEGATED_HOVER_SUBSTRING, "text-gray-"],
      ]),
    );
  });
});

describe("helpers", () => {
  test("splitSelectorList keeps :is(...) and quoted commas together", () => {
    expect(
      splitSelectorList(
        'html.dark :is([class~="a"], [class~="b"]):hover, .x [data-y="1,2"],.z',
      ),
    ).toEqual([
      'html.dark :is([class~="a"], [class~="b"]):hover',
      '.x [data-y="1,2"]',
      ".z",
    ]);
  });

  test("requiredSubstrings reads only gated attribute-substring selectors", () => {
    expect(requiredSubstrings(NEGATED_HOVER_BRIGHTEN_SELECTOR)).toEqual([
      NEGATED_HOVER_SUBSTRING,
      "text-gray-",
    ]);
    expect(
      requiredSubstrings('html.dark .group:hover [class~="group-hover:x"]'),
    ).toBeNull();
    expect(requiredSubstrings('html.dark [class*="group-hover"]')).toBeNull();
  });

  test("isGroupHoverReveal takes the unnamed negated-hover hide only", () => {
    expect(isGroupHoverReveal("group-[:not(:hover)]:hidden")).toBe(true);
    expect(
      isGroupHoverReveal("group-[:not(:hover):not(:focus-within)]:hidden"),
    ).toBe(true);
    expect(
      isGroupHoverReveal(
        "group-[:not(:hover):not(:focus-within)]/nav-row:hidden",
      ),
    ).toBe(false);
    expect(isGroupHoverReveal("group-hover:flex")).toBe(false);
    expect(isGroupHoverReveal("group-[:not(:hover)]:flex")).toBe(false);
    expect(isGroupHoverReveal("hidden")).toBe(false);
  });

  test("collectClassCandidates expands a template's branches, never its condition", () => {
    const candidates: Array<string> = collectClassCandidates(
      "Fixture.tsx",
      'const e = <span className={`a b ${isOn ? "" : "c group-[:not(:hover)]:hidden"}`} data-x={mode === "q" ? 1 : 2} />;',
    ).map((candidate: ClassCandidate): string => {
      return candidate.classText;
    });

    expect(candidates).toContain("a b");
    expect(candidates).toContain("a b c group-[:not(:hover)]:hidden");
    // The substitution is read as part of the template, not on its own.
    expect(candidates).not.toContain("c group-[:not(:hover)]:hidden");
    // Every string literal is still a candidate, the condition included.
    expect(candidates).toContain("q");
  });

  test("restorePreFixHoverReveal rebuilds the class strings git history has", () => {
    expect(restorePreFixHoverReveal(CONVERTED_FACET_EXCLUDE_CLASS)).toBe(
      PRE_FIX_FACET_EXCLUDE_CLASS,
    );
    expect(restorePreFixHoverReveal(CONVERTED_PROFILES_HINT_CLASS)).toBe(
      PRE_FIX_PROFILES_HINT_CLASS,
    );
    // Nothing to restore.
    expect(restorePreFixHoverReveal("flex text-gray-400")).toBe(
      "flex text-gray-400",
    );
  });

  test("withoutHoverGate lifts the gate and refuses what jsdom cannot answer", () => {
    expect(withoutHoverGate(NEGATED_HOVER_BRIGHTEN_SELECTOR)).toBe(
      'html.dark .group [class*="group-[:not(:hover)"][class*="text-gray-"]',
    );
    expect(
      withoutHoverGate('html.dark .group:hover [class~="x"]:hover'),
    ).toBeNull();
    expect(withoutHoverGate("html.dark .group:hover .x::placeholder")).toBe(
      null,
    );
    // `.group:hover` is the gate; `.group-row:hover` is not.
    expect(withoutHoverGate("html.dark .group-row:hover .x")).toBeNull();
  });
});

describe("every group-hover reveal with gray text is brightened in dark mode", () => {
  test("the walk read the tree and found the three converted reveals", () => {
    // A broken walk must not let the main assertion pass over nothing.
    expect(revealScan.filesRead).toBeGreaterThan(1000);

    for (const file of KNOWN_REVEAL_FILES) {
      onlyRevealIn(file);
    }
  });

  test.each(KNOWN_REVEAL_FILES)(
    "%s: the revealed element matches one of the rule's substring pairs",
    (file: string) => {
      const reveal: ClassCandidate = onlyRevealIn(file);

      /*
       * Pinned on purpose: swapping the gray for a class the rule does not
       * key on (text-slate-400, say) would change the colour as surely as
       * dropping the selector did.
       */
      expect(hasGrayText(reveal.classText)).toBe(true);
      expect({
        reveal: describeCandidate(reveal),
        brightened: isBrightened(
          reveal.classText,
          brightenSubstringSets(THEME_RULES),
        ),
      }).toEqual({ reveal: describeCandidate(reveal), brightened: true });
    },
  );

  test("no reveal anywhere in the source carries gray text the rule misses", () => {
    const substringSets: Array<Array<string>> =
      brightenSubstringSets(THEME_RULES);

    const missed: Array<string> = revealScan.reveals
      .filter((candidate: ClassCandidate): boolean => {
        return (
          hasGrayText(candidate.classText) &&
          !isBrightened(candidate.classText, substringSets)
        );
      })
      .map(describeCandidate);

    expect(missed).toEqual([]);
  });

  test("before the fix the same elements were brightened by the group-hover pair", () => {
    const groupHoverOnly: Array<Array<string>> = [
      ["group-hover", "text-gray-"],
    ];

    for (const file of KNOWN_REVEAL_FILES) {
      const preFix: string = restorePreFixHoverReveal(
        onlyRevealIn(file).classText,
      );

      expect({
        preFix: preFix,
        brightened: isBrightened(preFix, groupHoverOnly),
      }).toEqual({ preFix: preFix, brightened: true });
    }
  });

  /*
   * The regression review found: the rule as it was, without the twin, and
   * the converted markup. Every converted reveal falls out of it - still
   * revealed on hover, but left at the dimmed gray.
   */
  test("control: without the twin selector the converted reveals are not brightened", () => {
    const withoutTwin: Array<Array<string>> = brightenSubstringSets(
      withoutNegatedHoverSelectors(THEME_RULES),
    );

    expect(withoutTwin.length).toBeGreaterThan(0);

    for (const file of KNOWN_REVEAL_FILES) {
      const converted: string = onlyRevealIn(file).classText;

      expect({
        converted: converted,
        brightened: isBrightened(converted, withoutTwin),
      }).toEqual({ converted: converted, brightened: false });
    }
  });
});

describe("jsdom agrees on the attribute part", () => {
  beforeEach(() => {
    document.documentElement.classList.add("dark");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("dark");
  });

  test("the brighten selectors are gated on .group:hover, and jsdom can evaluate the rest of the sheet", () => {
    /*
     * jsdom is handed the selectors without the gate (see the header), so
     * the gate itself is checked here, on the text.
     */
    for (const selector of [
      GROUP_HOVER_BRIGHTEN_SELECTOR,
      NEGATED_HOVER_BRIGHTEN_SELECTOR,
    ]) {
      expect(selector.startsWith(GROUP_HOVER_GATE)).toBe(true);
    }

    const sheet: EvaluableSheet = jsdomEvaluableSheet(THEME_RULES);
    const evaluated: Array<string> = sheet.rules.map(
      (rule: EvaluableRule): string => {
        return rule.selector;
      },
    );

    expect(evaluated).toEqual(
      expect.arrayContaining([
        withoutHoverGate(GROUP_HOVER_BRIGHTEN_SELECTOR),
        withoutHoverGate(NEGATED_HOVER_BRIGHTEN_SELECTOR),
      ]),
    );
    // Most of the sheet, so the comparison below is not made over a sliver.
    expect(sheet.rules.length).toBeGreaterThan(sheet.skipped);
  });

  test.each(KNOWN_REVEAL_FILES)(
    "%s: the sheet paints the converted element exactly as it painted the pre-fix one",
    (file: string) => {
      const converted: string = onlyRevealIn(file).classText;
      const sheet: EvaluableSheet = jsdomEvaluableSheet(THEME_RULES);

      const before: Array<string> = declarationsOn(
        mountRevealIn(restorePreFixHoverReveal(converted)),
        sheet,
      );
      const after: Array<string> = declarationsOn(
        mountRevealIn(converted),
        sheet,
      );

      expect(before).toContain(brightenEntry());
      expect(after).toEqual(before);
    },
  );

  test.each(KNOWN_REVEAL_FILES)(
    "control, %s: without the twin selector the converted element loses exactly the brighten",
    (file: string) => {
      const converted: string = onlyRevealIn(file).classText;
      const sheet: EvaluableSheet = jsdomEvaluableSheet(
        withoutNegatedHoverSelectors(THEME_RULES),
      );

      const before: Array<string> = declarationsOn(
        mountRevealIn(restorePreFixHoverReveal(converted)),
        sheet,
      );
      const after: Array<string> = declarationsOn(
        mountRevealIn(converted),
        sheet,
      );

      expect(missingFrom(before, after)).toEqual([brightenEntry()]);
      expect(missingFrom(after, before)).toEqual([]);
    },
  );
});
