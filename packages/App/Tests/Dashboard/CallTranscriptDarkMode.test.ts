import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An incident call's transcript on the Video Call card, and its dialogs
 * (issue #4875): the transcript block - its reading line, the provider's
 * answer and the menu's mark - the transcript dialog with its highlighted
 * lines, the Add transcript dialog, and the card they sit in.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * and per variant. A class it has no rule for keeps its light colour in the
 * dark theme - a pale wash on a slate card - and nothing fails. What OneUptime
 * AI read in the call is part of the AI Investigation card, and
 * AIInvestigationCardDarkMode holds it; this holds the Video Call card's
 * side to the same rules.
 */

const VIDEO_CALL_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "VideoCall",
);

const MODULES: Array<string> = [
  "EventVideoCallsCard.tsx",
  "CallTranscriptBlock.tsx",
  "CallTranscriptModal.tsx",
  "AddCallTranscriptModal.tsx",
  "CallTranscriptState.ts",
  "CallTranscriptApi.ts",
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

// Comments hold prose, not classes.
function readCode(file: string): string {
  return fs
    .readFileSync(path.join(VIDEO_CALL_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * The whole variant chain is part of the token: `hover:bg-gray-100` needs a
 * rule of its own, apart from `bg-gray-100`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 500/600 mark (an icon, a spinner's arc, a focus ring) reads
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

describe("an incident call's transcript on the Video Call card, in the dark theme", () => {
  test("reads every module of the transcript's block, its dialogs and the card", () => {
    for (const file of MODULES) {
      expect({
        file,
        exists: fs.existsSync(path.join(VIDEO_CALL_DIR, file)),
      }).toEqual({ file, exists: true });
    }
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const file of MODULES) {
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

  test("every colour class they use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const file of MODULES) {
      for (const token of tokensIn(readCode(file))) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${file}: ${token}`);
        }
      }
    }

    // The scan found the block's colours at all, so this is not vacuous.
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The heading, the facts under it and the hairline over the block.
        "text-gray-900",
        "text-gray-500",
        "border-gray-100",
        // The transcript dialog's highlighted lines and their legend.
        "bg-amber-50",
        "ring-amber-200",
        // The menu's mark when it is pointed at.
        "hover:bg-gray-100",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("text-gray-500")).toBe(true);
    expect(isRemapped("bg-amber-50")).toBe(true);
    expect(isRemapped("text-indigo-600")).toBe(true);
    expect(isRemapped("bg-gray-150")).toBe(false);
    expect(isRemapped("text-lime-950")).toBe(false);
  });
});
