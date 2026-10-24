import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident's and alert's Remediation card in the dark theme.
 *
 * The dashboard's dark theme does not come from Tailwind's dark: variants.
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant (`.bg-white` does not cover `hover:bg-white`).
 * A class it has no rule for keeps its light colour in the dark theme and
 * nothing fails, which is how a light wash ends up on a dark card.
 *
 * The card says what auto-remediation did with tinted tone marks, a rule
 * beside a blocked path's "why" and "what to do", hairlines between the
 * lines, links and a status pill shared with the AI Investigation card.
 * These read the card's sources (RemediationSuggestionCard and every module
 * it imports from Components/AutoRemediation and Components/AI, followed
 * transitively) and hold every colour class to what Theme.css actually
 * remaps. Rendering is covered in Common/Tests/App/Dashboard/Remediation*.
 */

const COMPONENTS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
);

// The folders the card's own styling lives in.
const CARD_DIRS: Array<string> = [
  path.join(COMPONENTS_DIR, "AutoRemediation"),
  path.join(COMPONENTS_DIR, "AI"),
];

const ENTRY_FILE: string = path.join(
  COMPONENTS_DIR,
  "AutoRemediation",
  "RemediationSuggestionCard.tsx",
);

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

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCodeAt(absolutePath: string): string {
  return stripComments(fs.readFileSync(absolutePath, "utf8")).replace(
    /\s+/g,
    " ",
  );
}

/*
 * The card and every module it imports from its own folders, keyed by
 * their path inside Components. Plain .ts modules count too: a colour kept
 * in a data file reaches the page just the same.
 */
function getCardModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();
  const pending: Array<string> = [ENTRY_FILE];

  while (pending.length > 0) {
    const absolutePath: string = pending.shift()!;
    const moduleKey: string = path
      .relative(COMPONENTS_DIR, absolutePath)
      .split(path.sep)
      .join("/");

    if (modules.has(moduleKey)) {
      continue;
    }

    const code: string = readCodeAt(absolutePath);
    modules.set(moduleKey, code);

    for (const match of code.matchAll(/from "(\.\.?\/[A-Za-z0-9_/.]+)"/g)) {
      for (const extension of [".tsx", ".ts"]) {
        const candidate: string = path.resolve(
          path.dirname(absolutePath),
          `${match[1]!}${extension}`,
        );

        if (
          CARD_DIRS.some((directory: string): boolean => {
            return candidate.startsWith(`${directory}${path.sep}`);
          }) &&
          fs.existsSync(candidate)
        ) {
          pending.push(candidate);
        }
      }
    }
  }

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:bg-gray-50` only with a rule of its own, so it must never be read
 * as the bare `bg-gray-50`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 500/600 mark (an icon, the live dot, a focus ring) reads the
 * same on a light and a dark card. Greys are not marks: their light shades
 * are exactly what must be remapped.
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

/*
 * Colour classes the card carried before its decision lines were redrawn,
 * each with why it may stay, and the modules that use it. The guard fails
 * if one of them is removed from a module it names, so the list cannot
 * outlive what it excuses.
 */
const KNOWN_EXCEPTIONS: Record<string, Array<string>> = {
  /*
   * The dot of a settled fix's pill (Dismissed, No runbook applies, a
   * command Pending or Skipped, a change through an MCP server not sent):
   * a mid-grey mark, as visible on the dark pill as on the light one.
   */
  "bg-gray-400": [
    "AutoRemediation/RemediationSuggestionCard.tsx",
    "AutoRemediation/McpToolCallList.tsx",
  ],
};

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

describe("the Remediation card in the dark theme", () => {
  test("the walk starts at the card and reaches every part of it", () => {
    const modules: Map<string, string> = getCardModules();

    expect(Array.from(modules.keys()).sort()).toEqual([
      /*
       * What the card tells the page's AI card - whether fixing did
       * anything - and whether it leaves saying so to that card's one
       * line. A rule, no colours.
       */
      "AI/AiOffSummaryData.ts",
      "AI/InvestigationStatusBadge.tsx",
      // A fix through MCP servers: its changes, in order.
      "AutoRemediation/McpToolCallList.tsx",
      "AutoRemediation/RemediationDecisionLines.ts",
      "AutoRemediation/RemediationDecisionList.tsx",
      "AutoRemediation/RemediationDecisionStatusBadge.tsx",
      "AutoRemediation/RemediationSuggestionCard.tsx",
    ]);
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getCardModules()) {
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

    for (const [moduleKey, code] of getCardModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (
          !isRemapped(token) &&
          !(KNOWN_EXCEPTIONS[token] || []).includes(moduleKey)
        ) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The walk found the card's colours at all, so this is not vacuous.
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The tone marks of the decision lines.
        "bg-emerald-50",
        "bg-amber-50",
        "bg-indigo-50",
        "bg-gray-100",
        // The lines' words, their hairlines and the gap's rule.
        "text-gray-900",
        "text-gray-600",
        "divide-gray-100",
        "border-gray-200",
        // The links.
        "text-indigo-600",
        "hover:text-indigo-800",
        // The neutral status pill.
        "bg-gray-50",
        "text-gray-700",
        "ring-gray-200",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("every known exception is still in the code it excuses", () => {
    const modules: Map<string, string> = getCardModules();

    for (const [token, moduleKeys] of Object.entries(KNOWN_EXCEPTIONS)) {
      for (const moduleKey of moduleKeys) {
        expect({
          token,
          moduleKey,
          stillUsed: tokensIn(modules.get(moduleKey) || "").includes(token),
          stillUnmapped: !isRemapped(token),
        }).toEqual({ token, moduleKey, stillUsed: true, stillUnmapped: true });
      }
    }
  });

  /*
   * The guard's own reading of Theme.css, on classes whose answer is known,
   * so a change to Theme.css's form cannot quietly make everything pass.
   */
  test("tells a remapped class from one that is not", () => {
    expect(isRemapped("bg-amber-50")).toBe(true);
    expect(isRemapped("divide-gray-100")).toBe(true);
    expect(isRemapped("hover:text-indigo-800")).toBe(true);
    expect(isRemapped("text-emerald-600")).toBe(true);
    // Not bg-gray-500: a rule for one shade is not a rule for its neighbour.
    expect(isRemapped("bg-gray-400")).toBe(false);
    expect(isRemapped("ring-emerald-100")).toBe(false);
  });
});
