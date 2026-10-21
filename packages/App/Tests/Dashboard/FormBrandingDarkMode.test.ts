import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Build page's Branding section in the dashboard's dark theme
 * (Components/FormBuilder/Branding).
 *
 * The dark theme does not use Tailwind's dark: variants: Theme.css
 * re-colours the light utility classes under html.dark, one rule per class.
 * Two things are held here:
 *
 *   - every named colour class the section draws its own chrome with is one
 *     Theme.css remaps, so nothing stays pale on a slate card;
 *   - the two previews of the form's page - the logo where it will sit, the
 *     favicon in a browser tab - stay LIGHT in the dark theme, because the
 *     form's public page is always light and a dark logo must be judged on
 *     the page it will sit on. They are drawn with arbitrary colours, which
 *     no remap touches, equal to the light palette the page itself uses.
 */

const COMPONENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "FormBuilder",
  "Branding",
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

const MODULES: Array<string> = fs
  .readdirSync(COMPONENT_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".ts") || file.endsWith(".tsx");
  })
  .sort();

// Comments hold prose, not classes.
const CODE: string = MODULES.map((file: string): string => {
  return fs
    .readFileSync(path.join(COMPONENT_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}).join("\n");

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

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

const ARBITRARY_COLOR: RegExp = /^(?:bg|text|border)-\[#[0-9a-f]{6}\]$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

function isRemapped(token: string): boolean {
  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  const escapedClass: string = token
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\//g, "\\/")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/#/g, "\\#");
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

// The value of a string constant the section exports.
function constantOf(name: string): string {
  const match: RegExpMatchArray | null = CODE.match(
    new RegExp(`export const ${name}: string =\\s*"([^"]*)";`),
  );

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return (match as RegExpMatchArray)[1] as string;
}

const TOKENS: Array<string> = Array.from(new Set(stringTokens(CODE)));

describe("the Branding section in the dark theme", () => {
  test("reads every module of the folder", () => {
    expect(MODULES).toEqual([
      "FormBrandingSection.tsx",
      "FormBrandingValues.ts",
    ]);
  });

  test("uses no dark: variants", () => {
    expect(CODE).not.toContain("dark:");
  });

  test("every named colour class it uses is remapped for dark mode", () => {
    const named: Array<string> = TOKENS.filter((token: string): boolean => {
      return COLOR_UTILITY.test(token);
    });

    // The scan found the labels and the notes at all.
    expect(named).toEqual(
      expect.arrayContaining(["text-gray-900", "text-gray-500"]),
    );
    expect(
      named.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("the previews of the form's page stay light: the page's palette, which no remap touches", () => {
    expect(constantOf("FORM_PAGE_PREVIEW_CLASS_NAME")).toBe(
      // gray-200 border, gray-50 page.
      "border-[#e5e7eb] bg-[#f9fafb]",
    );
    expect(constantOf("FORM_TAB_PREVIEW_CLASS_NAME")).toBe(
      // A white browser tab.
      "border-[#e5e7eb] bg-[#ffffff]",
    );
    expect(constantOf("FORM_TAB_TITLE_PREVIEW_CLASS_NAME")).toBe(
      // gray-700, the tab's title.
      "text-[#374151]",
    );

    const arbitrary: Array<string> = TOKENS.filter((token: string): boolean => {
      return ARBITRARY_COLOR.test(token);
    });

    expect(arbitrary.sort()).toEqual(
      [
        "bg-[#f9fafb]",
        "bg-[#ffffff]",
        "border-[#e5e7eb]",
        "text-[#374151]",
      ].sort(),
    );

    for (const token of arbitrary) {
      expect({ token, remapped: isRemapped(token) }).toEqual({
        token,
        remapped: false,
      });
    }

    // Both previews are drawn with them.
    const section: string = fs.readFileSync(
      path.join(COMPONENT_DIR, "FormBrandingSection.tsx"),
      "utf8",
    );

    expect(section.split("${FORM_PAGE_PREVIEW_CLASS_NAME}").length - 1).toBe(2);
    expect(section).toContain("${FORM_TAB_PREVIEW_CLASS_NAME}");
    expect(section).toContain("${FORM_TAB_TITLE_PREVIEW_CLASS_NAME}");
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("text-gray-500")).toBe(true);
    expect(isRemapped("bg-gray-50")).toBe(true);
    expect(isRemapped("bg-gray-150")).toBe(false);
    expect(isRemapped("bg-[#f9fafb]")).toBe(false);
  });
});
