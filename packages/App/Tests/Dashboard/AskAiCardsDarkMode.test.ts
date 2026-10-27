import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ASK AI'S ACTION CARDS IN THE DARK THEME (#5301's UI review).
 *
 * The approval card a create_alert waits on and the card it leaves under
 * the answer ("ALT-12 · High memory usage on test01", with its Open) are
 * drawn by ToolApprovalCard and ResourceCardWidget, in the Ask AI panel,
 * the full-page chat and an incident's or alert's AI card alike.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.bg-white` does not cover `hover:bg-white`). A class
 * it has no rule for keeps its light colour in the dark theme - an emerald
 * link on a dark green card, a white button on slate - and nothing fails.
 * So these read the two cards' sources and hold every colour class to what
 * Theme.css actually remaps. They are drawn dark in real Chromium too:
 * packages/E2E/EventOverview (the approval card, ?thread=linking&theme=dark).
 */

const AI_CHAT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "AIChat",
);

const COMMON_DIR: string = path.join(__dirname, "..", "..", "..", "Common");

const SOURCES: Array<[string, string]> = [
  ["ToolApprovalCard.tsx", path.join(AI_CHAT_DIR, "ToolApprovalCard.tsx")],
  [
    "Widgets/ResourceCardWidget.tsx",
    path.join(AI_CHAT_DIR, "Widgets", "ResourceCardWidget.tsx"),
  ],
];

const THEME_CSS_PATH: string = path.join(
  COMMON_DIR,
  "UI",
  "Styles",
  "Theme.css",
);

const WHITESPACE: RegExp = /\s+/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;

function readCodeAt(absolutePath: string): string {
  return fs
    .readFileSync(absolutePath, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

function getModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();

  for (const [key, file] of SOURCES) {
    modules.set(key, readCodeAt(file));
  }

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:bg-emerald-100` only with a rule of its own, so it must never be
 * read as the bare `bg-emerald-100`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 500/600 mark (an icon's tile, a focus ring) reads the same
 * on a light and a dark card. Greys are not marks: their light shades are
 * exactly what must be remapped.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

const SUBSTRING_RULE: RegExp = /\[class\*="([^"]+)"\]/g;
const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-emerald-"]:hover. Matched with startsWith.
 */
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_RULE),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

/*
 * Colour classes the approval card carried before this review, each with
 * why it may stay. The guard fails if one of them leaves the code, so the
 * list cannot outlive what it excuses.
 */
const KNOWN_EXCEPTIONS: Record<string, string> = {
  /*
   * A chosen Skip: white words on a mid grey, which reads the same on a
   * light and a dark card.
   */
  "bg-gray-500": "ToolApprovalCard.tsx",
  // The Run button's spinner while the decision is sent: on the dark button.
  "border-white/40": "ToolApprovalCard.tsx",
};

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (utility === "text-white" || SOLID_MARK.test(utility)) {
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

describe("Ask AI's action cards in the dark theme", () => {
  test("neither card uses dark: variants or builds a colour class from a template", () => {
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

  test("every colour class the cards draw with is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token) && KNOWN_EXCEPTIONS[token] !== moduleKey) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The read found the cards' colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(20);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The approval card: its wash, an action's box and its words.
        "bg-amber-50/70",
        "border-amber-200/70",
        "text-gray-900",
        "text-gray-700",
        // Allow and Skip, chosen and not.
        "bg-gray-900",
        "hover:bg-gray-50",
        // The card under the answer, and its Open.
        "bg-emerald-50/70",
        "border-emerald-200",
        "text-emerald-700",
        "hover:bg-emerald-100",
        "hover:text-emerald-800",
        // The keyboard's focus ring on Open.
        "focus-visible:ring-indigo-500",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("every known exception is still in the code it excuses", () => {
    const modules: Map<string, string> = getModules();

    for (const [token, moduleKey] of Object.entries(KNOWN_EXCEPTIONS)) {
      expect({
        token,
        present: tokensIn(modules.get(moduleKey) || "").includes(token),
      }).toEqual({
        token,
        present: true,
      });
      // And it really has no rule of its own, or it would not need excusing.
      expect({ token, remapped: isRemapped(token) }).toEqual({
        token,
        remapped: false,
      });
    }
  });
});
