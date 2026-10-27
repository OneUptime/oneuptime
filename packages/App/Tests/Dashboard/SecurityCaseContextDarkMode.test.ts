import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant). A class it has no rule for keeps its light colour in the dark
 * theme - a white tile on a slate page - and nothing fails.
 *
 * So this reads the sources of a case's Story and Impact, and of every
 * component they import from their own folder, and holds every colour class
 * to what Theme.css actually remaps, as SecurityEventsEmptyStatesDarkMode
 * does for the Security Events empty states. The module set is walked from
 * the two entry points, so a part split out later is covered too.
 */

const CONTEXT_COMPONENTS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "SecurityCase",
  "Context",
);

const ENTRY_FILES: Array<string> = [
  "SecurityCaseStory.tsx",
  "SecurityCaseImpactCard.tsx",
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

function getContextModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();
  const pending: Array<string> = [...ENTRY_FILES];

  while (pending.length > 0) {
    const fileName: string = pending.shift()!;

    if (modules.has(fileName)) {
      continue;
    }

    const code: string = squash(
      stripComments(
        fs.readFileSync(path.join(CONTEXT_COMPONENTS_DIR, fileName), "utf8"),
      ),
    );
    modules.set(fileName, code);

    for (const match of code.matchAll(/from "\.\/([A-Za-z0-9_/]+)"/g)) {
      const candidate: string = `${match[1]!}.tsx`;

      if (fs.existsSync(path.join(CONTEXT_COMPONENTS_DIR, candidate))) {
        pending.push(candidate);
      }
    }
  }

  return modules;
}

const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

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

  const escapedClass: string = token
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\//g, "\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

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

describe("a case's Story and Impact in the dark theme", () => {
  test("the walk starts at both and takes in every component they import from their folder", () => {
    const modules: Map<string, string> = getContextModules();

    for (const entry of ENTRY_FILES) {
      expect(modules.has(entry)).toBe(true);
    }

    // Helpers without markup are not walked.
    expect(modules.has("SecurityCaseContextModel.tsx")).toBe(false);
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getContextModules()) {
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

  test("every colour class they use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getContextModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The walk found their colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(10);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        "text-gray-900",
        "text-gray-500",
        "bg-gray-50",
        "ring-gray-200",
        "border-gray-200",
        "bg-indigo-50",
        "text-indigo-700",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("no element pairs a grey text colour with an indigo group-hover text colour", () => {
    for (const [moduleKey, code] of getContextModules()) {
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
});
