import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The color field in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A class
 * it has no rule for keeps its light colour - a white popover over a slate
 * dialog - and nothing fails. So every colour class the field, its swatches,
 * its pills, its popover and its Custom color panel use is held here to
 * what Theme.css actually remaps, or to a mid-tone hue that reads the same
 * on both themes.
 *
 * The other way round matters too: the swatches are the same colours in both
 * themes, so the tick drawn on one must not be recoloured by the theme - it
 * is an inline colour, never a text class.
 */

const COMMON: string = path.join(__dirname, "..", "..", "..", "..");

const PICKER_PARTS: string = path.join(
  COMMON,
  "UI",
  "Components",
  "ColorPicker",
);

const SOURCE_FILES: Array<string> = [
  path.join(COMMON, "UI", "Components", "Forms", "Fields", "ColorPicker.tsx"),
  ...fs
    .readdirSync(PICKER_PARTS)
    .filter((name: string): boolean => {
      return name.endsWith(".tsx");
    })
    .sort()
    .map((name: string): string => {
      return path.join(PICKER_PARTS, name);
    }),
];

const THEME_CSS: string = fs
  .readFileSync(path.join(COMMON, "UI", "Styles", "Theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

// Every string written in a file: literals and a template's own text.
function stringsIn(file: string): Array<string> {
  const source: string = fs.readFileSync(file, "utf8");
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const strings: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      strings.push(node.text);
    }

    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      strings.push(node.initializer.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return strings;
}

const TOKENS: Array<string> = Array.from(
  new Set(
    SOURCE_FILES.flatMap(stringsIn).flatMap((text: string): Array<string> => {
      return text.split(/\s+/).filter((token: string): boolean => {
        return token.length > 0;
      });
    }),
  ),
);

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

/*
 * A mid-tone hue (a 500 or 600 border, outline or ring) reads the same in
 * both themes. Neutral greys do not: they are what Theme.css re-colours.
 */
const SAME_IN_BOTH_THEMES: RegExp =
  /^(?:border|ring|outline)-(?:red|indigo)-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A tick drawn in its swatch's own mark colour, inline.
const INLINE_MARK_COLOR: RegExp = /style=\{\{ color: getMarkColor\(/;

// A ring offset utility, under any variants.
const RING_OFFSET: RegExp = /^(?:[\w-]+:)*ring-offset-/;

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

    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

const colorTokens: Array<string> = TOKENS.filter((token: string): boolean => {
  return COLOR_UTILITY.test(utilityOf(token));
});

describe("the color field in the dark theme", () => {
  test("reads the classes of the field, its swatches, pills, popover and panel", () => {
    expect(
      SOURCE_FILES.map((file: string): string => {
        return path.basename(file);
      }),
    ).toEqual([
      "ColorPicker.tsx",
      "ColorSwatchGroup.tsx",
      "CustomColorPanel.tsx",
    ]);
    expect(colorTokens).toEqual(
      expect.arrayContaining([
        // The pills, unpicked and picked.
        "border-gray-300",
        "bg-white",
        "text-gray-700",
        "hover:bg-gray-50",
        "bg-indigo-50",
        "text-indigo-700",
        // The popover and the panel.
        "border-gray-200",
        "border-gray-100",
        "text-gray-500",
        // The code box and its message.
        "placeholder-gray-400",
        "border-red-300",
        "text-red-600",
      ]),
    );
  });

  test("every colour class is one Theme.css re-colours, or a mid-tone that reads on both", () => {
    const unthemed: Array<string> = colorTokens.filter(
      (token: string): boolean => {
        return (
          !isRemapped(token) && !SAME_IN_BOTH_THEMES.test(utilityOf(token))
        );
      },
    );

    expect(unthemed).toEqual([
      // FormField's own error colour, shared with every other field.
      "text-red-400",
    ]);
  });

  test("uses no dark: variants, which this theme never turns on", () => {
    expect(
      TOKENS.filter((token: string): boolean => {
        return token.startsWith("dark:");
      }),
    ).toEqual([]);
  });

  test("draws the tick on a swatch in an inline colour, not a class the theme would recolour", () => {
    const ticks: Array<string> = SOURCE_FILES.flatMap(
      (file: string): Array<string> => {
        return Array.from(
          fs
            .readFileSync(file, "utf8")
            .matchAll(/<Icon\s+icon=\{IconProp\.Check\}[\s\S]*?\/>/g),
          (match: RegExpMatchArray): string => {
            return match[0];
          },
        );
      },
    );

    // The swatch's tick, the custom color's tick, and "No color"'s.
    expect(ticks.length).toBeGreaterThanOrEqual(3);

    for (const tick of ticks) {
      // Never a text colour class: the theme would recolour it.
      expect(tick).not.toMatch(/className=[^>]*text-/);
    }

    // The ticks drawn on a color take their colour from that color.
    expect(
      ticks.filter((tick: string): boolean => {
        return INLINE_MARK_COLOR.test(tick);
      }),
    ).toHaveLength(2);
  });

  test("keeps the focus outline's gap the surface, not a white ring offset", () => {
    expect(
      TOKENS.filter((token: string): boolean => {
        return RING_OFFSET.test(token);
      }),
    ).toEqual([]);
  });
});
