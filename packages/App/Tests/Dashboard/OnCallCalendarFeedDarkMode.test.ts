import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The calendar feed cards in the dark theme.
 *
 * The dashboard's dark theme does not come from Tailwind's dark: variants.
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant (`.bg-white` does not cover `hover:bg-white`). A
 * class it has no rule for keeps its light colour in the dark theme and
 * nothing fails - a pale tile on a dark card.
 *
 * The redesigned cards paint more colour than the old grey lines did: the
 * subscribe options' tinted marks and hover, the link field's segments and
 * its "Copied!" green, the status panel and its five pills, the footer's
 * grey strip, the warnings above both columns. These read every source of
 * the cards and hold every colour class to what Theme.css remaps.
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
const FOLDERS: Array<string> = ["Components/OnCallPolicy/CalendarFeed"];

// The shared subscribe block, and the pages that draw the cards.
const FILES: Array<string> = [
  "Components/OnCallPolicy/CalendarFeedLinks.tsx",
  "Pages/UserSettings/OnCallCalendarFeed.tsx",
  "Pages/OnCallDuty/CalendarFeeds.tsx",
];

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

  for (const folder of FOLDERS) {
    for (const name of fs.readdirSync(path.join(DASHBOARD_SRC, folder))) {
      if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        const relativePath: string = `${folder}/${name}`;
        modules.set(relativePath, readCode(relativePath));
      }
    }
  }

  for (const file of FILES) {
    modules.set(file, readCode(file));
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
 * A saturated 400-600 mark (an icon, a pill's dot, a primary button) reads
 * the same on a light and a dark card. Greys are not marks: their light
 * shades are exactly what must be remapped.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:400|500|600)$/;

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

const GROUP_HOVER_GREY_TEXT_RULE: string =
  '.group:hover [class*="group-hover"][class*="text-gray-"]';

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
    token.startsWith("group-hover:text-gray-") &&
    THEME_CSS.includes(GROUP_HOVER_GREY_TEXT_RULE)
  ) {
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

describe("the calendar feed cards in the dark theme", () => {
  test("every component of the cards is read", () => {
    expect(Array.from(getModules().keys())).toEqual(
      expect.arrayContaining([
        "Components/OnCallPolicy/CalendarFeed/PersonalCalendarFeedCard.tsx",
        "Components/OnCallPolicy/CalendarFeed/SharedCalendarFeedCard.tsx",
        "Components/OnCallPolicy/CalendarFeed/FeedStatusPanel.tsx",
        "Components/OnCallPolicy/CalendarFeed/FeedLinkField.tsx",
        "Components/OnCallPolicy/CalendarFeed/FeedCardFooter.tsx",
        "Components/OnCallPolicy/CalendarFeed/FeedManageMenu.tsx",
        "Components/OnCallPolicy/CalendarFeed/FeedEmptyState.tsx",
        "Components/OnCallPolicy/CalendarFeed/CalendarFeedLayout.ts",
        "Components/OnCallPolicy/CalendarFeed/UpcomingShiftsCard.tsx",
        "Components/OnCallPolicy/CalendarFeed/UpcomingShiftRow.tsx",
        "Components/OnCallPolicy/CalendarFeedLinks.tsx",
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

  test("every colour class the cards use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The scan found the cards' colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(40);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        /*
         * The subscribe options: a white tile and a grey hover. Their marks
         * are Google Calendar's logo and a calendar on the neutral tile
         * Common's ProviderLogoImage draws (official logos audit), which
         * Theme.css re-colours there, not here.
         */
        "bg-white",
        "border-gray-200",
        "hover:border-gray-300",
        "hover:bg-gray-50",
        "text-indigo-600",
        "group-hover:text-gray-600",
        // The link field and "Copied!".
        "border-gray-300",
        "bg-gray-50",
        "hover:bg-gray-100",
        "bg-emerald-50",
        "text-emerald-700",
        // The status panel's pills.
        "bg-green-50",
        "text-green-700",
        "ring-green-200",
        "bg-blue-50",
        "text-blue-700",
        "ring-blue-200",
        "bg-amber-50",
        "text-amber-800",
        "ring-amber-200",
        "bg-red-50",
        "text-red-700",
        "ring-red-200",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  /*
   * The footer's rule and edges are the card's ruled body (CardSurface), a
   * class this folder does not spell: its colours are held here too.
   */
  test("the footer's strip and the card's ruled body it sits on are remapped", () => {
    const footer: string = readCode(
      "Components/OnCallPolicy/CalendarFeed/FeedCardFooter.tsx",
    );
    const surface: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "UI",
          "Components",
          "Card",
          "CardSurface.ts",
        ),
        "utf8",
      )
      .replace(BLOCK_COMMENT, " ");
    const ruledBody: string | undefined = surface.match(
      /CARD_RULED_BODY_CLASS_NAME: string =\s*"([^"]+)"/,
    )?.[1];

    expect(footer).toContain("CARD_RULED_BODY_CLASS_NAME");
    expect(ruledBody).toBeDefined();

    const tokens: Array<string> = [
      ...tokensIn(footer),
      ...tokensIn(ruledBody as string),
    ];

    expect(tokens).toEqual(
      expect.arrayContaining([
        "border-gray-200",
        "bg-gray-50",
        "text-gray-500",
      ]),
    );

    for (const token of tokens) {
      expect({ token, remapped: isRemapped(token) }).toEqual({
        token,
        remapped: true,
      });
    }
  });

  test("every pill tone is a tinted ground, a dark text and a ring - each remapped", () => {
    const panel: string = readCode(
      "Components/OnCallPolicy/CalendarFeed/FeedStatusPanel.tsx",
    );

    const pills: Array<string> = Array.from(
      panel.matchAll(/pill: "([^"]+)"/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    // Active, waiting, not fetched, disabled, needs regeneration.
    expect(pills).toHaveLength(5);

    for (const pill of pills) {
      const [ground, text, ring] = pill.split(" ");

      expect(ground).toMatch(/^bg-[a-z]+-50$/);
      expect(text).toMatch(/^text-[a-z]+-(?:700|800)$/);
      expect(ring).toMatch(/^ring-[a-z]+-200$/);

      for (const token of [ground, text, ring] as Array<string>) {
        expect({ token, remapped: isRemapped(token) }).toEqual({
          token,
          remapped: true,
        });
      }
    }
  });
});
