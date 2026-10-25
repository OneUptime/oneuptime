import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The header of an incident, an alert, an episode and a scheduled
 * maintenance event in the dark theme.
 *
 * The dashboard's dark theme does not come from Tailwind's dark: variants.
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant (`.bg-white` does not cover `hover:bg-white`). A
 * class it has no rule for keeps its light colour in the dark theme - a pale
 * wash on a slate card, a white ring round a dot - and nothing fails.
 *
 * So these read every file the header draws with - the card and its layout,
 * the state track, the facts and their people and links, the AI band, the
 * maintenance band, the episode's notice and the placeholders - and hold
 * every colour class to what Theme.css actually remaps. The browser suite
 * (packages/E2E/EventOverview, "the header, by its own width") looks at the
 * four headers in both themes.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const HEADER_FILES: Array<string> = [
  "Components/EventView/EventStatusPanel.tsx",
  "Components/EventView/EventHeaderLayout.ts",
  "Components/EventView/EventStateTrack.tsx",
  "Components/EventView/EventHeaderSkeleton.tsx",
  "Components/EventView/EventFactLinks.tsx",
  "Components/EventView/EventPeopleFacts.tsx",
  "Components/AI/AIInvestigationHeaderStatus.tsx",
  "Components/ScheduledMaintenance/ChangeState.tsx",
  "Components/EpisodeView/EpisodeHeader.tsx",
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

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:bg-indigo-100` only with a rule of its own, so it must never be read
 * as the bare `bg-indigo-100`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 500/600 mark (an icon, the primary button, the live dot) reads
 * the same on a light and a dark card. Greys are not marks: their light
 * shades are exactly what must be remapped.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith.
 */
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

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

  /*
   * CSS escaping, as Theme.css writes the class: backslashes first, so the
   * ones added for ":" and "/" are not escaped a second time.
   */
  const escapedClass: string = token
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\//g, "\\/");
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

describe("the event header in the dark theme", () => {
  test("every file the header draws with exists", () => {
    for (const file of HEADER_FILES) {
      expect({
        file,
        exists: fs.existsSync(path.join(DASHBOARD_SRC, file)),
      }).toEqual({ file, exists: true });
    }
  });

  test("no file uses dark: variants or builds a colour class from a template", () => {
    for (const file of HEADER_FILES) {
      const code: string = readCode(file);

      expect({ file, dark: code.includes("dark:") }).toEqual({
        file,
        dark: false,
      });
      expect({ file, template: TEMPLATE_COLOR_TOKEN.test(code) }).toEqual({
        file,
        template: false,
      });
    }
  });

  test("every colour class the header uses is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const file of HEADER_FILES) {
      for (const token of tokensIn(readCode(file))) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${file}: ${token}`);
        }
      }
    }

    // The walk found the header's colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(40);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The card, its hairlines and the number chip.
        "bg-white",
        "border-gray-200",
        "border-gray-100",
        "bg-gray-100",
        // The track's upcoming segments, and its names.
        "bg-gray-200",
        "text-gray-900",
        "text-gray-600",
        "text-gray-500",
        // The bands: OneUptime AI's, a missed start's, a failed refresh's.
        "bg-indigo-50/60",
        "border-indigo-100",
        "bg-amber-50/70",
        "border-amber-200",
        "bg-red-50/60",
        "border-red-100",
        // The AI band's heading and its links.
        "text-indigo-900",
        "text-indigo-700",
        "hover:bg-indigo-100",
        // Assign and Add, and the place to add more.
        "border-gray-300",
        "hover:bg-indigo-50",
        "hover:text-indigo-700",
        // A fact's links.
        "text-indigo-600",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("the live dot's ring is one the dark theme re-colours", () => {
    const code: string = readCode(
      "Components/AI/AIInvestigationHeaderStatus.tsx",
    );

    expect(code).toContain("bg-indigo-500 ring-2 ring-white");
    expect(code).not.toContain("border-white");
    expect(THEME_CSS).toContain("html.dark .ring-white");
  });
});
