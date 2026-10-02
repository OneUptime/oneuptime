import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The template variable pickers' own markup: the collapsed Template variables
 * list under a field and its cards, the Insert variable button and the list
 * it opens, the "{{" suggestions, and the subscriber template list's footer.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class. A class it
 * has no rule for keeps its light colour in the dark theme - a white card on
 * a slate dialog - and nothing fails. So this holds every colour class these
 * components use to what Theme.css actually remaps, reading every module of
 * the shared folder, .ts as well as .tsx, and the Markdown editor's own
 * Insert variable button.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");

const COMPONENT_DIR: string = path.join(
  PACKAGES,
  "Common",
  "UI",
  "Components",
  "TemplateVariables",
);

const EXTRA_MODULES: Array<string> = [
  path.join(
    PACKAGES,
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "StatusPage",
    "SubscriberTemplateVariables.tsx",
  ),
];

const MARKDOWN_EDITOR: string = path.join(
  PACKAGES,
  "Common",
  "UI",
  "Components",
  "Markdown.tsx",
  "MarkdownEditor.tsx",
);

const THEME_CSS_PATH: string = path.join(
  PACKAGES,
  "Common",
  "UI",
  "Styles",
  "Theme.css",
);

const MODULES: Array<string> = fs
  .readdirSync(COMPONENT_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".ts") || file.endsWith(".tsx");
  })
  .sort();

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

// The class the Markdown editor gives its Insert variable button.
function markdownEditorButtonClass(): string {
  const source: string = fs.readFileSync(MARKDOWN_EDITOR, "utf8");
  const start: number = source.indexOf("<InsertTemplateVariableButton");
  const match: RegExpMatchArray | null = source
    .slice(start)
    .match(/className="([^"]*)"/);

  return match ? match[1]! : "";
}

// Comments hold prose, not classes.
const CODE: string = [
  ...MODULES.map((file: string): string => {
    return stripComments(
      fs.readFileSync(path.join(COMPONENT_DIR, file), "utf8"),
    );
  }),
  ...EXTRA_MODULES.map((file: string): string => {
    return stripComments(fs.readFileSync(file, "utf8"));
  }),
  `"${markdownEditorButtonClass()}"`,
].join("\n");

const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

function stringTokens(code: string): Array<string> {
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
}

// The utility a token applies, after its variants.
function utilityOf(token: string): string {
  let depth: number = 0;
  let lastColon: number = -1;

  for (let i: number = 0; i < token.length; i++) {
    const character: string = token[i]!;

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;
    } else if (character === ":" && depth === 0) {
      lastColon = i;
    }
  }

  return token.slice(lastColon + 1);
}

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|placeholder)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// The prefixes Theme.css remaps a family of classes by.
const FAMILY_PREFIXES: Array<string> = Array.from(
  THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
);

function isRemapped(token: string): boolean {
  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  // A rule for a whole family: [class*="hover:border-indigo-"].
  if (
    FAMILY_PREFIXES.some((prefix: string): boolean => {
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

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

/*
 * A focus ring keeps the brand indigo in both themes, as every other focus
 * ring in the Dashboard does.
 */
const SAME_IN_BOTH_THEMES: Array<string> = [
  "focus-visible:ring-indigo-500",
  "focus:ring-indigo-500",
];

const COLOR_TOKENS: Array<string> = Array.from(
  new Set(
    stringTokens(CODE).filter((token: string): boolean => {
      return COLOR_UTILITY.test(utilityOf(token));
    }),
  ),
);

describe("the template variable pickers in the dark theme", () => {
  test("reads every module of the folder, and the editor's button", () => {
    expect(MODULES).toEqual(
      expect.arrayContaining([
        "TemplateVariablesList.tsx",
        "TemplateVariableMenu.tsx",
        "TemplateVariablePopup.tsx",
        "InsertTemplateVariableButton.tsx",
        "TextControlUtil.ts",
      ]),
    );
    expect(markdownEditorButtonClass()).toContain("text-indigo-700");
  });

  test("use no dark: variants and build no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(/(?:bg|text|border|ring|divide)-\$\{/);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found the cards, the list and the menu at all.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        "bg-white",
        "border-gray-200",
        "text-indigo-700",
        "hover:bg-indigo-50",
        "bg-indigo-50",
      ]),
    );

    expect(
      COLOR_TOKENS.filter((token: string): boolean => {
        return !SAME_IN_BOTH_THEMES.includes(token) && !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("text-gray-500")).toBe(true);
    expect(isRemapped("bg-indigo-50")).toBe(true);
    expect(isRemapped("bg-gray-150")).toBe(false);
    expect(isRemapped("text-lime-950")).toBe(false);
  });
});
