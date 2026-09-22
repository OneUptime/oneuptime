import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-white` does not cover `group-hover:bg-white`). A class it has
 * no rule for keeps its light colour in the dark theme - a white tile on a
 * slate page, or gray-900 text on a gray-900 card - and nothing fails.
 *
 * So these read the sources of the two Security Events empty states, and of
 * every component they import from their own folder, and hold every colour
 * class to what Theme.css actually remaps. The module set is walked from the
 * two entry points rather than listed, so a tile or section split out later
 * is covered automatically. Rendering is covered in
 * Common/Tests/App/Dashboard/SecurityEvent*EmptyState.test.tsx and the
 * browser suite in packages/E2E/SecurityEventsEmptyStates.
 */

const SECURITY_EVENTS_COMPONENTS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "SecurityEvents",
);

const ENTRY_FILES: Array<string> = [
  "SecurityEventConnectionsEmptyState.tsx",
  "SecurityEventsEmptyState.tsx",
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
 * The entry points plus every .tsx component they import from this folder,
 * followed transitively. Plain .ts helpers hold no markup and are skipped.
 */
function getEmptyStateModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();
  const pending: Array<string> = [...ENTRY_FILES];

  while (pending.length > 0) {
    const fileName: string = pending.shift()!;

    if (modules.has(fileName)) {
      continue;
    }

    const code: string = readCodeAt(
      path.join(SECURITY_EVENTS_COMPONENTS_DIR, fileName),
    );
    modules.set(fileName, code);

    for (const match of code.matchAll(/from "\.\/([A-Za-z0-9_/]+)"/g)) {
      const candidate: string = `${match[1]!}.tsx`;

      if (fs.existsSync(path.join(SECURITY_EVENTS_COMPONENTS_DIR, candidate))) {
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
 * `lg:bg-white` only with a rule of its own, so it must never be read as the
 * bare `bg-white`. Gradient stops are colours too.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:border-indigo-"]:hover. Matched with startsWith, never
 * includes: `group-hover:bg-indigo-50` is not covered by the `:hover` rule
 * for `hover:bg-indigo-50`, which only fires on the element itself.
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

  if (utility === "text-white" || SOLID_FILL.test(utility)) {
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

describe("Security Events empty states in the dark theme", () => {
  test("the walk starts at both empty states and follows them into the provider tile", () => {
    const modules: Map<string, string> = getEmptyStateModules();

    for (const entry of ENTRY_FILES) {
      expect(modules.has(entry)).toBe(true);
    }
    expect(modules.has("SecurityEventProviderTile.tsx")).toBe(true);
    // Helpers without markup are not walked.
    expect(modules.has("SecurityEventConnectionDiagnosticsUtil.tsx")).toBe(
      false,
    );
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getEmptyStateModules()) {
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

  test("every colour class the empty states use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getEmptyStateModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The walk found the empty states' colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(10);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The tinted badges and the tiles' resting and hover colours.
        "bg-indigo-50",
        "ring-indigo-200",
        "bg-gray-50",
        "ring-gray-200",
        "border-gray-200",
        "hover:border-indigo-300",
        "group-hover:bg-indigo-50",
        "group-hover:text-indigo-600",
        "text-gray-900",
        "text-gray-500",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  /*
   * Theme.css paints near-white over any hovered group child carrying a
   * text-gray-* class (it outranks the indigo hover rule), so the two on
   * one element turn white on hover in the dark theme, not indigo.
   */
  test("no element pairs a grey text colour with an indigo group-hover text colour", () => {
    for (const [moduleKey, code] of getEmptyStateModules()) {
      for (const match of code.matchAll(/className="([^"]*)"/g)) {
        const classes: Array<string> = match[1]!.split(" ");
        const clash: boolean =
          classes.some((name: string): boolean => {
            return name.startsWith("text-gray-");
          }) &&
          classes.some((name: string): boolean => {
            return name.startsWith("group-hover:text-indigo-");
          });

        expect({ moduleKey, classes: match[1], clash }).toEqual({
          moduleKey,
          classes: match[1],
          clash: false,
        });
      }
    }
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("bg-white")).toBe(true);
    expect(isRemapped("bg-gray-50")).toBe(true);
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    expect(isRemapped("hover:bg-indigo-50")).toBe(true);
    expect(isRemapped("hover:border-indigo-300")).toBe(true);
    expect(isRemapped("group-hover:text-indigo-700")).toBe(true);
    expect(isRemapped("from-indigo-50")).toBe(true);
    expect(isRemapped("to-white")).toBe(true);
    expect(isRemapped("bg-indigo-600")).toBe(true);
    expect(isRemapped("text-white")).toBe(true);

    // The traps: no rule of their own, so they keep their light colour.
    expect(isRemapped("group-hover:bg-white")).toBe(false);
    expect(isRemapped("group-hover:border-indigo-200")).toBe(false);
    expect(isRemapped("ring-emerald-100")).toBe(false);
    expect(isRemapped("bg-slate-900")).toBe(false);
    expect(isRemapped("text-slate-100")).toBe(false);
    expect(isRemapped("lg:bg-white")).toBe(false);
    expect(isRemapped("md:bg-gray-50")).toBe(false);
    // A made-up shade no stylesheet will ever remap.
    expect(isRemapped("bg-gray-55")).toBe(false);
    expect(isRemapped("text-purple-950")).toBe(false);
  });

  test("the token walk keeps a class's whole variant chain", () => {
    expect(
      tokensIn(
        'className="bg-white lg:bg-white sm:hover:text-gray-900 group-hover:bg-indigo-50 hover:bg-gray-50/50 from-indigo-50"',
      ),
    ).toEqual([
      "bg-white",
      "lg:bg-white",
      "sm:hover:text-gray-900",
      "group-hover:bg-indigo-50",
      "hover:bg-gray-50/50",
      "from-indigo-50",
    ]);
  });
});
