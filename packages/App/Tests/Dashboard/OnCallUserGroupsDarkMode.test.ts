import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { UserGroupStatusKind } from "../../FeatureSet/Dashboard/src/Components/OnCallPolicy/UserGroups/UserGroupsCopy";

/*
 * The schedule page's Slack user groups / Microsoft Teams tags card in the
 * dark theme.
 *
 * The dashboard's dark theme does not come from Tailwind's dark: variants.
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant. A class it has no rule for keeps its light
 * colour in the dark theme and nothing fails - a pale pill on a dark card.
 *
 * The card paints a mention chip, five status pills with their dots, the
 * members' chips, the quiet grey note and the amber lines of people left
 * out; its problem and load-error alerts are the shared Alert, its empty
 * state the calendar cards' panel (both guarded where they live). This
 * reads every source of the card and holds every colour class to what
 * Theme.css remaps.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// The whole folder: a file added to it is checked without a list.
const FOLDER: string = "Components/OnCallPolicy/UserGroups";

const THEME_CSS_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Styles",
  "Theme.css",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

function getModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();

  for (const name of fs.readdirSync(path.join(DASHBOARD_SRC, FOLDER))) {
    if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      const relativePath: string = `${FOLDER}/${name}`;
      modules.set(relativePath, readCode(relativePath));
    }
  }

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:bg-gray-50` only with a rule of its own, so it must never be read
 * as the bare `bg-gray-50`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to|placeholder)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 400-600 mark (an icon, a pill's dot) reads the same on a
 * light and a dark card. Greys are not marks: their light shades are
 * exactly what must be remapped.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:400|500|600)$/;

/*
 * A status pill's dot is a mark too, a grey one included: the "Nobody on
 * call" dot is a mid grey (400) that reads on a light pill and a dark one
 * alike, and the pill's words carry the meaning. Only a dot - a light grey
 * ground or text still has to be remapped.
 */
const DOT_MARK: RegExp = /^bg-[a-z]+-(?:400|500)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

const SUBSTRING_SELECTOR: RegExp = /\[class\*="([^"]+)"\]/g;

// Interaction variants Theme.css remaps by prefix, matched with startsWith.
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_SELECTOR),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (
    utility === "text-white" ||
    utility.endsWith("-transparent") ||
    SOLID_MARK.test(utility)
  ) {
    return true;
  }

  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  if (
    SUBSTRING_VARIANTS.some((prefix: string): boolean => {
      return token.startsWith(prefix);
    })
  ) {
    return true;
  }

  // CSS escaping, as Theme.css writes the class.
  const escapedClass: string = token
    .replace(BACKSLASH, "\\\\")
    .replace(COLON, "\\:")
    .replace(SLASH, "\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

function tokensIn(code: string): Array<string> {
  return Array.from(code.matchAll(COLOR_TOKEN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the schedule page's user group card in the dark theme", () => {
  test("every component of the card is read", () => {
    expect(Array.from(getModules().keys())).toEqual(
      expect.arrayContaining([
        `${FOLDER}/ScheduleUserGroupsCard.tsx`,
        `${FOLDER}/UserGroupRow.tsx`,
        `${FOLDER}/ConnectUserGroupModal.tsx`,
        `${FOLDER}/UserGroupsCopy.ts`,
      ]),
    );
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getModules()) {
      expect({ moduleKey, dark: code.includes("dark:") }).toEqual({
        moduleKey,
        dark: false,
      });
      expect({
        moduleKey,
        template: TEMPLATE_COLOR_TOKEN.test(code),
      }).toEqual({ moduleKey, template: false });
    }
  });

  test("every colour class the card uses is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    const dots: Set<string> = new Set(
      Array.from(
        readCode(`${FOLDER}/UserGroupRow.tsx`).matchAll(/dot: "([^"]+)"/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    );

    expect(dots.size).toBeGreaterThan(2);

    for (const [moduleKey, code] of getModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        const isDot: boolean = dots.has(token) && DOT_MARK.test(token);

        if (!isDot && !isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The scan found the card's colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(20);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // A row, its mention chip and its members' chips.
        "bg-white",
        "border-gray-200",
        "bg-indigo-50",
        "text-indigo-700",
        "bg-gray-50",
        "ring-gray-200",
        "text-gray-900",
        // The labels, the grey note and the time.
        "text-gray-500",
        "text-gray-700",
        // Somebody left out.
        "text-amber-900",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("every status pill is a tinted ground, a dark text and a ring - each remapped - with a dot", () => {
    const row: string = readCode(`${FOLDER}/UserGroupRow.tsx`);
    const tones: Array<{ pill: string; dot: string }> = Array.from(
      row.matchAll(/pill: "([^"]+)", dot: "([^"]+)"/g),
      (match: RegExpMatchArray): { pill: string; dot: string } => {
        return { pill: match[1]!, dot: match[2]! };
      },
    );

    // One tone for each status a row can be in.
    expect(tones).toHaveLength(Object.values(UserGroupStatusKind).length);

    for (const tone of tones) {
      const pill: Array<string> = tone.pill.split(" ");
      const has: (prefix: string) => boolean = (prefix: string): boolean => {
        return pill.some((name: string): boolean => {
          return name.startsWith(prefix);
        });
      };

      expect({
        pill: tone.pill,
        ground: has("bg-"),
        text: has("text-"),
        ring: has("ring-"),
      }).toEqual({
        pill: tone.pill,
        ground: true,
        text: true,
        ring: true,
      });

      for (const token of pill) {
        expect({ token, remapped: isRemapped(token) }).toEqual({
          token,
          remapped: true,
        });
      }

      /*
       * The dot: a mark that reads on both grounds - a 400 or 500 shade.
       * A light one (gray-100) is remapped too, but to the pill's own dark
       * ground, and vanishes on both.
       */
      expect({ dot: tone.dot, mark: DOT_MARK.test(tone.dot) }).toEqual({
        dot: tone.dot,
        mark: true,
      });
    }
  });
});
