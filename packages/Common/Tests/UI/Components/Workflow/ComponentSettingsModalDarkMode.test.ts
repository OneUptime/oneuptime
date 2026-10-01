import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A workflow step's settings dialog in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant (`.bg-gray-50` does not cover `hover:bg-gray-50`). A class without a
 * rule keeps its light colour - a near-white box on a slate dialog - and
 * nothing fails. So this holds every colour class the dialog's parts use to
 * what Theme.css actually remaps.
 *
 * The walk lists every file the dialog draws with, including the copy button
 * it now puts beside the webhook URL, the example request and each reference,
 * and the "How to use" help with its callouts and examples.
 */

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "..", "UI");

const FILES: Array<string> = [
  "Components/Workflow/ComponentSettingsModal.tsx",
  "Components/Workflow/ComponentSettingsSection.tsx",
  "Components/Workflow/ComponentPrimaryPanel.tsx",
  "Components/Workflow/WebhookTriggerPanel.tsx",
  "Components/Workflow/IncomingEmailTriggerPanel.tsx",
  "Components/Workflow/ManualTriggerPanel.tsx",
  "Components/Workflow/ComponentReturnValueViewer.tsx",
  "Components/Workflow/ComponentPortViewer.tsx",
  "Components/Workflow/BreakableCode.tsx",
  "Components/Workflow/DocumentationViewer.tsx",
  "Components/CopyTextButton/CopyTextButton.tsx",
];

/*
 * Colours that are right in both themes on purpose, all in the copy button:
 * white text on its solid indigo variant (which no dialog part uses, but the
 * button offers), and the green tick it shows once copied, which reads on the
 * pale emerald tint and on the dark one Theme.css swaps in for it.
 */
const SAME_IN_BOTH_THEMES: Array<string> = ["text-white", "text-emerald-400"];

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(path.join(UI_DIR, "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

type ReadCodeFunction = (file: string) => string;

// Comments hold prose ("a near-white box"), not classes.
const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(UI_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

type StringTokensFunction = (code: string) => Array<string>;

/*
 * Every whitespace-separated token of every string literal: class lists are
 * string literals here (className="...", the tone table), and prose tokens
 * never look like a utility.
 */
const stringTokens: StringTokensFunction = (code: string): Array<string> => {
  const tokens: Array<string> = [];

  for (const match of code.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
    const text: string = (match[1] ?? match[2] ?? "").replace(
      /\$\{[^}]*\}/g,
      " ",
    );

    tokens.push(
      ...text.split(/\s+/).filter((token: string): boolean => {
        return token.length > 0;
      }),
    );
  }

  return tokens;
};

type UtilityOfFunction = (token: string) => string;

/*
 * The utility a token applies, after its variants. An arbitrary variant's
 * brackets may hold a colon of their own ("[&>section]:"), so the split skips
 * anything inside brackets.
 */
const utilityOf: UtilityOfFunction = (token: string): string => {
  let depth: number = 0;
  let lastColon: number = -1;

  for (let i: number = 0; i < token.length; i++) {
    const character: string = token.charAt(i);

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;
    } else if (character === ":" && depth === 0) {
      lastColon = i;
    }
  }

  return token.slice(lastColon + 1);
};

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

/*
 * A mid-tone hue (a 500 or 600 icon or fill) reads the same in both themes.
 * Neutral greys do not: gray-500 text is what Theme.css re-colours for a dark
 * card, so a grey is only fine where a rule of its own says so.
 */
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A colour class built from a template, which no scan could check.
const TEMPLATED_COLOUR: RegExp =
  /(?:bg|text|border|ring|divide|from|via|to)-\$\{/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith: a
 * `group-hover:` token is not covered by a rule for `hover:`.
 */
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

type IsRemappedFunction = (token: string) => boolean;

const isRemapped: IsRemappedFunction = (token: string): boolean => {
  const utility: string = utilityOf(token);

  if (SOLID.test(utility)) {
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
    const next: string =
      THEME_CSS.charAt(from + escapedClass.length + 1) || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
};

const CODE_BY_FILE: Record<string, string> = {};

for (const file of FILES) {
  CODE_BY_FILE[file] = readCode(file);
}

const COLOR_TOKENS: Array<string> = Array.from(
  new Set(
    Object.values(CODE_BY_FILE)
      .flatMap(stringTokens)
      .filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
  ),
);

describe("the step settings dialog in the dark theme", () => {
  test("no part uses a dark: variant or builds a colour class from a template", () => {
    for (const [file, code] of Object.entries(CODE_BY_FILE)) {
      expect({ file, usesDarkVariant: code.includes("dark:") }).toEqual({
        file,
        usesDarkVariant: false,
      });
      expect({
        file,
        templatedColour: TEMPLATED_COLOUR.test(code),
      }).toEqual({ file, templatedColour: false });
    }
  });

  test("every colour class the dialog uses is remapped for dark mode", () => {
    const unmapped: Array<string> = COLOR_TOKENS.filter(
      (token: string): boolean => {
        return !isRemapped(token) && !SAME_IN_BOTH_THEMES.includes(token);
      },
    );

    // The scan found the dialog's colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // Section cards, the primary tint and the documentation tint.
        "bg-white",
        "border-gray-200",
        "border-indigo-200",
        "bg-indigo-50/40",
        "text-indigo-700",
        "border-blue-100",
        "bg-blue-50/40",
        "text-blue-700",
        // The URL, the example request and the references.
        "text-gray-900",
        "text-gray-800",
        "text-gray-700",
        // Returns rows and their type pill.
        "bg-gray-50",
        "bg-indigo-50",
        "border-indigo-100",
        // Ports' bullets.
        "bg-gray-300",
        // The copy button and its "Copied!" state.
        "bg-gray-100",
        "hover:bg-gray-200",
        "bg-emerald-50",
        "border-emerald-200",
        /*
         * The webhook URL's masked key, the warning for a URL built from the
         * workflow's ID, and the line confirming a reset.
         */
        "text-gray-500",
        "bg-amber-50",
        "border-amber-200",
        "text-amber-800",
        "text-emerald-700",
        /*
         * The help: its step numbers, the tip callout on the blue tint, the
         * warning callout, and its links.
         */
        "bg-blue-100",
        "border-blue-100",
        "text-blue-600",
        "hover:text-blue-700",
      ]),
    );
    expect(unmapped).toEqual([]);
  });
});
