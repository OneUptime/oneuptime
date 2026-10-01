import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dashboard's dark theme does not come from Tailwind's dark: variants.
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant (`.bg-white` does not cover `hover:bg-white`). A
 * class it has no rule for keeps its light colour in the dark theme and
 * nothing fails, which is how a light wash ends up on a dark card.
 *
 * The AI Investigation card was rebuilt as one flat card: plain sections, a
 * neutral status pill, hairlines, and a row wash painted on ::before. These
 * read the sources of the card (InvestigationPanel and every component it
 * imports from Components/AI, followed transitively) and hold every colour
 * class to what Theme.css actually remaps. Rendering is covered in
 * Common/Tests/App/Dashboard/Investigation*.test.tsx and the browser suite in
 * packages/E2E/EventOverview.
 */

const AI_COMPONENTS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "AI",
);

const ENTRY_FILE: string = path.join(
  AI_COMPONENTS_DIR,
  "InvestigationPanel.tsx",
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

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

/*
 * The panel plus every .tsx component it imports from Components/AI, keyed
 * by their path inside that folder. The chat feed and widgets it borrows
 * live in Components/AIChat and are not part of the card's own styling.
 */
function getCardModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();
  const pending: Array<string> = [ENTRY_FILE];

  while (pending.length > 0) {
    const absolutePath: string = pending.shift()!;
    const moduleKey: string = path
      .relative(AI_COMPONENTS_DIR, absolutePath)
      .split(path.sep)
      .join("/");

    if (modules.has(moduleKey)) {
      continue;
    }

    const code: string = readCodeAt(absolutePath);
    modules.set(moduleKey, code);

    for (const match of code.matchAll(/from "(\.\.?\/[A-Za-z0-9_/.]+)"/g)) {
      const candidate: string = path.resolve(
        path.dirname(absolutePath),
        `${match[1]!}.tsx`,
      );

      if (
        candidate.startsWith(`${AI_COMPONENTS_DIR}${path.sep}`) &&
        fs.existsSync(candidate)
      ) {
        pending.push(candidate);
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
 * `before:bg-indigo-50/70` only with a rule of its own, so it must never be
 * read as the bare `bg-indigo-50/70`.
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
 * `.group:hover [class*="group-hover"][class*="text-gray-"]` brightens any
 * grey group-hover text to the primary text colour.
 */
const GROUP_HOVER_GREY_TEXT_RULE: string =
  '.group:hover [class*="group-hover"][class*="text-gray-"]';

/*
 * Colour classes the card already carried before it was rebuilt, each with
 * why it may stay. The guard fails if one of them is removed from the code,
 * so the list cannot outlive what it excuses.
 */
const KNOWN_EXCEPTIONS: Record<string, string> = {
  // The verdict's answers while a save is in flight: disabled and hovered.
  "disabled:hover:text-gray-600": "InvestigationPanel.tsx",
  // A citation chip's hover ring.
  "hover:ring-indigo-200": "InvestigationReport/InvestigationCitationChip.tsx",
  // Rows returned as text, in a code block that is dark in both themes.
  "text-gray-100": "InvestigationReport/InvestigationEvidenceList.tsx",
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

describe("the AI Investigation card in the dark theme", () => {
  test("the walk starts at the panel and reaches every part of the card", () => {
    const modules: Map<string, string> = getCardModules();

    expect(Array.from(modules.keys()).sort()).toEqual(
      expect.arrayContaining([
        "ClusterAccessNotice.tsx",
        "InvestigationNotStartedCard.tsx",
        "InvestigationPanel.tsx",
        "InvestigationReport/InvestigationCitationChip.tsx",
        "InvestigationReport/InvestigationEvidenceList.tsx",
        "InvestigationReport/InvestigationReferenceLink.tsx",
        "InvestigationReport/InvestigationReportView.tsx",
        "InvestigationReport/InvestigationRunDetails.tsx",
        "InvestigationStatusBadge.tsx",
      ]),
    );
    // Borrowed chat components are not the card's own styling.
    for (const moduleKey of modules.keys()) {
      expect(moduleKey.startsWith("..")).toBe(false);
    }
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

        if (!isRemapped(token) && KNOWN_EXCEPTIONS[token] !== moduleKey) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The walk found the card's colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(30);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The neutral status pill.
        "bg-gray-50",
        "text-gray-700",
        "ring-gray-200",
        // The sections' headings and bodies, and the hairlines between them.
        "text-gray-900",
        "border-gray-200",
        "divide-gray-200",
        "divide-gray-100",
        // The evidence rows' hover and a chip's highlight on ::before.
        "hover:bg-gray-50",
        "before:bg-indigo-50/70",
        "before:ring-indigo-500",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("every known exception is still in the code it excuses", () => {
    const modules: Map<string, string> = getCardModules();

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

  test("the row wash painted on ::before has a dark rule of its own", () => {
    expect(THEME_CSS).toContain(
      'html.dark [class~="before:bg-indigo-50/70"]::before',
    );
    expect(
      getCardModules().get("InvestigationReport/InvestigationEvidenceList.tsx"),
    ).toContain("before:bg-indigo-50/70");
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("bg-white")).toBe(true);
    expect(isRemapped("bg-gray-50")).toBe(true);
    expect(isRemapped("text-gray-500")).toBe(true);
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    expect(isRemapped("hover:text-indigo-800")).toBe(true);
    expect(isRemapped("before:bg-indigo-50/70")).toBe(true);
    expect(isRemapped("group-hover:text-gray-600")).toBe(true);
    expect(isRemapped("ring-indigo-500")).toBe(true);
    expect(isRemapped("text-emerald-600")).toBe(true);
    expect(isRemapped("border-transparent")).toBe(true);

    // The traps: no rule of their own, so they keep their light colour.
    expect(isRemapped("before:bg-indigo-50/60")).toBe(false);
    expect(isRemapped("bg-indigo-400")).toBe(false);
    expect(isRemapped("ring-indigo-400")).toBe(false);
    expect(isRemapped("text-gray-600/50")).toBe(false);
    expect(isRemapped("bg-slate-900")).toBe(false);
    expect(isRemapped("lg:bg-white")).toBe(false);
    // Greys are never waved through as "solid marks".
    expect(isRemapped("bg-gray-600")).toBe(false);
  });

  test("the token walk keeps a class's whole variant chain", () => {
    expect(
      tokensIn(
        'className="bg-white before:bg-indigo-50/70 focus-visible:before:ring-indigo-500 group-hover:text-gray-600"',
      ),
    ).toEqual([
      "bg-white",
      "before:bg-indigo-50/70",
      "focus-visible:before:ring-indigo-500",
      "group-hover:text-gray-600",
    ]);
  });
});
