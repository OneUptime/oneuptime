import {
  CODE_EDITOR_LINE_HEIGHT_PX,
  CODE_EDITOR_PADDING_X_PX,
  CODE_EDITOR_PADDING_Y_PX,
} from "../../../../UI/Components/CodeEditor/CodeEditor";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * CodeEditor draws its text twice: a transparent textarea over a highlighted
 * copy. The two only line up while they share every text metric, and the
 * component places the gutter's click target, the current-line band and the
 * caret-reveal scrolling with the same numbers the stylesheet uses. None of
 * that can be seen in jsdom, which lays nothing out, so these tests hold the
 * sources to it instead. The real-browser alignment check is in
 * packages/E2E/CodeEditor.
 */

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const EDITOR_DIRECTORY: string = path.join(
  COMMON_ROOT,
  "UI",
  "Components",
  "CodeEditor",
);

// Block comments only: prose inside the stylesheets must not count as rules.
type ReadCssFunction = (file: string) => string;

const readCss: ReadCssFunction = (file: string): string => {
  return fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
};

const EDITOR_CSS: string = readCss(
  path.join(EDITOR_DIRECTORY, "CodeEditor.css"),
);

const EDITOR_TSX: string = fs.readFileSync(
  path.join(EDITOR_DIRECTORY, "CodeEditor.tsx"),
  "utf8",
);

const THEME_CSS: string = readCss(
  path.join(COMMON_ROOT, "UI", "Styles", "Theme.css"),
);

/*
 * CodeBlock imports this theme globally. It colours bare .hljs-* classes for
 * a dark panel, so any of them the editor does not recolour would show up in
 * the editor, unreadable on white.
 */
const A11Y_DARK_CSS: string = readCss(
  path.join(
    COMMON_ROOT,
    "node_modules",
    "highlight.js",
    "styles",
    "a11y-dark.css",
  ),
);

interface CssRule {
  selectors: Array<string>;
  declarations: Record<string, string>;
}

type ParseRulesFunction = (css: string) => Array<CssRule>;

// Innermost blocks only, which is every rule in these (at-rule free) files.
const parseRules: ParseRulesFunction = (css: string): Array<CssRule> => {
  const rules: Array<CssRule> = [];

  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations: Record<string, string> = {};

    for (const declaration of (match[2] as string).split(";")) {
      const colon: number = declaration.indexOf(":");

      if (colon === -1) {
        continue;
      }

      declarations[declaration.slice(0, colon).trim()] = declaration
        .slice(colon + 1)
        .replace(/\s+/g, " ")
        .trim();
    }

    rules.push({
      selectors: (match[1] as string)
        .split(",")
        .map((selector: string) => {
          return selector.replace(/\s+/g, " ").trim();
        })
        .filter((selector: string) => {
          return selector.length > 0;
        }),
      declarations,
    });
  }

  return rules;
};

const EDITOR_RULES: Array<CssRule> = parseRules(EDITOR_CSS);

// A selector aimed at just one of the two layers.
const ONE_LAYER: RegExp = /ou-code-editor__(?:highlight|input)\b/;

// A token colour rule, scoped under the editor.
const TOKEN_SELECTOR: RegExp = /^\.ou-code-editor \.hljs-/;

type RuleForFunction = (selector: string) => CssRule;

const ruleFor: RuleForFunction = (selector: string): CssRule => {
  const rule: CssRule | undefined = EDITOR_RULES.find((candidate: CssRule) => {
    return candidate.selectors.includes(selector);
  });

  if (!rule) {
    throw new Error(`CodeEditor.css has no rule for ${selector}`);
  }

  return rule;
};

type VariablesOfFunction = (rule: CssRule) => Record<string, string>;

const variablesOf: VariablesOfFunction = (
  rule: CssRule,
): Record<string, string> => {
  const variables: Record<string, string> = {};

  for (const [property, value] of Object.entries(rule.declarations)) {
    if (property.startsWith("--ou-code-")) {
      variables[property] = value;
    }
  }

  return variables;
};

const LIGHT_VARIABLES: Record<string, string> = variablesOf(
  ruleFor(".ou-code-editor"),
);
const DARK_VARIABLES: Record<string, string> = variablesOf(
  ruleFor("html.dark .ou-code-editor"),
);

// The variables that decide where a glyph lands, as opposed to its colour.
const METRIC_VARIABLES: Array<string> = [
  "--ou-code-font",
  "--ou-code-font-size",
  "--ou-code-line-height",
  "--ou-code-padding-y",
  "--ou-code-padding-x",
];

type PixelsFunction = (value: string | undefined) => number;

const pixels: PixelsFunction = (value: string | undefined): number => {
  const match: RegExpMatchArray | null = (value || "").match(/^(\d+)px$/);

  if (!match) {
    throw new Error(`Expected a pixel length, got ${String(value)}`);
  }

  return Number(match[1]);
};

describe("the stylesheet and the component use the same numbers", () => {
  test("the line height", () => {
    expect(pixels(LIGHT_VARIABLES["--ou-code-line-height"])).toBe(
      CODE_EDITOR_LINE_HEIGHT_PX,
    );
  });

  test("the vertical padding", () => {
    expect(pixels(LIGHT_VARIABLES["--ou-code-padding-y"])).toBe(
      CODE_EDITOR_PADDING_Y_PX,
    );
  });

  test("the horizontal padding", () => {
    expect(pixels(LIGHT_VARIABLES["--ou-code-padding-x"])).toBe(
      CODE_EDITOR_PADDING_X_PX,
    );
  });

  test("the tab stop the caret arithmetic assumes is the one drawn", () => {
    const match: RegExpMatchArray | null = EDITOR_TSX.match(
      /const TAB_SIZE: number = (\d+);/,
    );

    expect(match).not.toBeNull();

    const tabSize: string = (match as RegExpMatchArray)[1] as string;
    const layer: CssRule = ruleFor(".ou-code-editor__layer");

    expect(layer.declarations["tab-size"]).toBe(tabSize);
    expect(layer.declarations["-moz-tab-size"]).toBe(tabSize);
  });

  test("the character width is measured in the layers' own font", () => {
    const measure: CssRule = ruleFor(".ou-code-editor__measure");

    expect(measure.declarations).toMatchObject({
      "font-family": "var(--ou-code-font)",
      "font-size": "var(--ou-code-font-size)",
      "font-variant-ligatures": "none",
      "letter-spacing": "normal",
      "white-space": "pre",
      visibility: "hidden",
      position: "absolute",
    });
  });

  test("the gutter's rows line up with the text's lines", () => {
    const gutter: CssRule = ruleFor(".ou-code-editor__gutter");
    const padding: Array<string> = (gutter.declarations["padding"] || "").split(
      " ",
    );

    expect(gutter.declarations["line-height"]).toBe(
      "var(--ou-code-line-height)",
    );
    expect(padding[0]).toBe("var(--ou-code-padding-y)");
    expect(padding[2]).toBe("var(--ou-code-padding-y)");
    expect(gutter.declarations["white-space"]).toBe("pre");
  });

  test("the current-line band is one line tall", () => {
    expect(ruleFor(".ou-code-editor__active-line").declarations["height"]).toBe(
      "var(--ou-code-line-height)",
    );
  });
});

describe("both layers take their text metrics from one rule", () => {
  test(".ou-code-editor__layer sets every metric", () => {
    expect(ruleFor(".ou-code-editor__layer").declarations).toMatchObject({
      "box-sizing": "border-box",
      margin: "0",
      border: "0",
      padding: "var(--ou-code-padding-y) var(--ou-code-padding-x)",
      "font-family": "var(--ou-code-font)",
      "font-size": "var(--ou-code-font-size)",
      "font-weight": "400",
      "font-style": "normal",
      "font-variant-ligatures": "none",
      "line-height": "var(--ou-code-line-height)",
      "letter-spacing": "normal",
      "word-spacing": "normal",
      "text-indent": "0",
      "white-space": "pre",
      "overflow-wrap": "normal",
      "word-break": "normal",
    });
  });

  test("the textarea and the highlighted copy both carry the layer class", () => {
    const layerClassNames: Array<string> = Array.from(
      EDITOR_TSX.matchAll(/className="(ou-code-editor__layer [^"]+)"/g),
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    expect(layerClassNames.sort()).toEqual([
      "ou-code-editor__layer ou-code-editor__highlight",
      "ou-code-editor__layer ou-code-editor__input",
    ]);
  });

  test("wrapping switches both layers at once", () => {
    expect(
      ruleFor(".ou-code-editor--wrap .ou-code-editor__layer").declarations,
    ).toMatchObject({
      "white-space": "pre-wrap",
      "overflow-wrap": "anywhere",
    });
  });

  const METRIC_PROPERTIES: Array<string> = [
    "font",
    "font-family",
    "font-size",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "white-space",
    "tab-size",
    "-moz-tab-size",
    "text-indent",
    "text-transform",
    "font-variant-ligatures",
    "font-feature-settings",
    "overflow-wrap",
    "word-break",
    "margin",
    "border",
    "box-sizing",
    "padding",
    "padding-left",
    "padding-top",
    "padding-bottom",
  ];

  test("no rule for just one of the layers changes a metric", () => {
    const offenders: Array<string> = [];

    for (const rule of EDITOR_RULES) {
      for (const selector of rule.selectors) {
        const targetsOneLayer: boolean =
          ONE_LAYER.test(selector) &&
          !selector.includes("ou-code-editor__layer");

        if (!targetsOneLayer) {
          continue;
        }

        for (const [property, value] of Object.entries(rule.declarations)) {
          // `inherit` hands the layer's own metric down; it cannot diverge.
          if (METRIC_PROPERTIES.includes(property) && value !== "inherit") {
            offenders.push(`${selector} { ${property}: ${value} }`);
          }

          // Token spans may colour text, never reshape it.
          if (
            (property === "font-weight" || property === "font-style") &&
            value !== "inherit"
          ) {
            offenders.push(`${selector} { ${property}: ${value} }`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * The one deliberate difference: room past the longest line for the caret,
   * on the copy only, and only when lines do not wrap - where padding would
   * move the wrap point.
   */
  test("the highlighted copy's extra right padding exists only when lines do not wrap", () => {
    const paddingRules: Array<string> = [];

    for (const rule of EDITOR_RULES) {
      for (const selector of rule.selectors) {
        if (
          selector.includes("ou-code-editor__highlight") &&
          rule.declarations["padding-right"] !== undefined
        ) {
          paddingRules.push(selector);
        }
      }
    }

    expect(paddingRules).toEqual([
      ".ou-code-editor:not(.ou-code-editor--wrap) .ou-code-editor__highlight",
    ]);
  });

  test("the textarea covers the copy exactly and shows none of its own text", () => {
    expect(ruleFor(".ou-code-editor__input").declarations).toMatchObject({
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      resize: "none",
      overflow: "hidden",
      background: "transparent",
      color: "transparent",
      "-webkit-text-fill-color": "transparent",
      "caret-color": "var(--ou-code-caret)",
    });
  });

  test("the textarea's own placeholder is invisible; the copy draws it", () => {
    expect(
      ruleFor(".ou-code-editor__input::placeholder").declarations,
    ).toMatchObject({
      color: "transparent",
      "-webkit-text-fill-color": "transparent",
    });
  });

  /*
   * Every frontend's index.ejs sets `* { font-family: Inter, ... }`. A rule
   * that matches an element beats what the element inherits, so without a
   * reset each token span in the copy - and each marked line number - would
   * be drawn in a proportional font, off the textarea's glyphs. The live
   * dashboard showed exactly that; the browser suite now runs under the real
   * rule (packages/E2E/CodeEditor/Fixture/server.js).
   */
  test.each([".ou-code-editor__highlight *", ".ou-code-editor__gutter *"])(
    "everything inside %s inherits the font, over any page-wide `*` rule",
    (selector: string) => {
      expect(ruleFor(selector).declarations).toMatchObject({
        "font-family": "inherit",
        "font-size": "inherit",
        "font-style": "inherit",
        "font-weight": "inherit",
        "font-variant-ligatures": "inherit",
        "line-height": "inherit",
        "letter-spacing": "inherit",
      });
    },
  );

  test("the frontends really do set a page-wide `*` font rule", () => {
    const frontends: Array<string> = [
      "Accounts",
      "AdminDashboard",
      "Dashboard",
      "PublicDashboard",
      "StatusPage",
    ];
    const pageWideFontRule: RegExp = /^\s*\*\s*\{[^}]*font-family/m;

    for (const frontend of frontends) {
      const index: string = fs.readFileSync(
        path.join(
          COMMON_ROOT,
          "..",
          "App",
          "FeatureSet",
          frontend,
          "views",
          "index.ejs",
        ),
        "utf8",
      );

      expect([frontend, pageWideFontRule.test(index)]).toEqual([
        frontend,
        true,
      ]);
    }
  });
});

describe("the selection never draws a second copy of the text", () => {
  test.each([
    ".ou-code-editor .ou-code-editor__input::selection",
    "html.dark .ou-code-editor .ou-code-editor__input::selection",
  ])("%s keeps the selected text transparent", (selector: string) => {
    expect(ruleFor(selector).declarations).toMatchObject({
      color: "transparent",
      "-webkit-text-fill-color": "transparent",
    });
  });

  type CountClassesFunction = (selector: string) => number;

  const countClasses: CountClassesFunction = (selector: string): number => {
    return (selector.match(/\.[a-zA-Z_-]/g) || []).length;
  };

  test("the dark rule outranks Theme.css's white-text ::selection", () => {
    const theme: CssRule | undefined = parseRules(THEME_CSS).find(
      (rule: CssRule) => {
        return rule.selectors.includes("html.dark ::selection");
      },
    );

    expect(theme).toBeDefined();
    expect(theme?.declarations["color"]).toBeDefined();
    expect(
      countClasses(
        "html.dark .ou-code-editor .ou-code-editor__input::selection",
      ),
    ).toBeGreaterThan(countClasses("html.dark ::selection"));
  });
});

describe("colours follow the theme", () => {
  const COLOUR_VARIABLES: Array<string> = Object.keys(LIGHT_VARIABLES).filter(
    (name: string) => {
      return !METRIC_VARIABLES.includes(name);
    },
  );

  test("the light theme defines the metrics and a palette", () => {
    for (const name of METRIC_VARIABLES) {
      expect(LIGHT_VARIABLES[name]).toBeDefined();
    }

    expect(COLOUR_VARIABLES.length).toBeGreaterThan(20);
  });

  test("every colour is redefined for html.dark", () => {
    const missing: Array<string> = COLOUR_VARIABLES.filter((name: string) => {
      return DARK_VARIABLES[name] === undefined;
    });

    expect(missing).toEqual([]);
  });

  test("the dark theme changes colours only, and only ones that exist", () => {
    for (const name of Object.keys(DARK_VARIABLES)) {
      expect(METRIC_VARIABLES).not.toContain(name);
      expect(LIGHT_VARIABLES[name]).toBeDefined();
    }
  });

  test("the dark palette differs from the light one", () => {
    const same: Array<string> = COLOUR_VARIABLES.filter((name: string) => {
      return DARK_VARIABLES[name] === LIGHT_VARIABLES[name];
    });

    expect(same).toEqual([]);
  });

  test("every variable the stylesheet reads is defined", () => {
    const used: Set<string> = new Set(
      Array.from(
        EDITOR_CSS.matchAll(/var\((--ou-code-[a-z-]+)\)/g),
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );

    for (const name of used) {
      expect({ name, defined: LIGHT_VARIABLES[name] !== undefined }).toEqual({
        name,
        defined: true,
      });
    }

    expect(used.size).toBeGreaterThan(20);
  });

  test("the dark theme is a class on <html>, not a media query", () => {
    expect(EDITOR_CSS).not.toContain("prefers-color-scheme");
  });
});

describe("CodeBlock's global highlight theme never leaks into the editor", () => {
  // The IE-only high-contrast block recolours to the system colour; skip it.
  const A11Y_RULES: Array<CssRule> = parseRules(
    A11Y_DARK_CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, " "),
  );

  type ClassesSettingFunction = (property: string) => Array<string>;

  const classesSetting: ClassesSettingFunction = (
    property: string,
  ): Array<string> => {
    const classes: Set<string> = new Set();

    for (const rule of A11Y_RULES) {
      if (rule.declarations[property] === undefined) {
        continue;
      }

      for (const selector of rule.selectors) {
        const match: RegExpMatchArray | null =
          selector.match(/^\.(hljs-[a-z_-]+)$/);

        if (match) {
          classes.add(match[1] as string);
        }
      }
    }

    return Array.from(classes);
  };

  const EDITOR_COLOURED: Set<string> = new Set();

  for (const rule of EDITOR_RULES) {
    if (rule.declarations["color"] === undefined) {
      continue;
    }

    for (const selector of rule.selectors) {
      const match: RegExpMatchArray | null = selector.match(
        /^\.ou-code-editor \.(hljs-[a-z_-]+)$/,
      );

      if (match) {
        EDITOR_COLOURED.add(match[1] as string);
      }
    }
  }

  test("the theme was read, so this is not vacuous", () => {
    expect(classesSetting("color")).toEqual(
      expect.arrayContaining([
        "hljs-comment",
        "hljs-string",
        "hljs-keyword",
        "hljs-number",
        "hljs-title",
      ]),
    );
  });

  test("every class the theme colours is coloured by the editor too", () => {
    const leaking: Array<string> = classesSetting("color").filter(
      (name: string) => {
        return !EDITOR_COLOURED.has(name);
      },
    );

    expect(leaking).toEqual([]);
  });

  test("the classes the theme makes bold or italic are neutralised", () => {
    const reshaped: Array<string> = [
      ...classesSetting("font-weight"),
      ...classesSetting("font-style"),
    ];

    expect(reshaped.length).toBeGreaterThan(0);
    expect(ruleFor(".ou-code-editor__highlight *").declarations).toMatchObject({
      "font-weight": "inherit",
      "font-style": "inherit",
    });
  });

  test("token colours come from the palette variables", () => {
    for (const rule of EDITOR_RULES) {
      const isTokenRule: boolean = rule.selectors.some((selector: string) => {
        return TOKEN_SELECTOR.test(selector);
      });
      const colour: string | undefined = rule.declarations["color"];

      if (isTokenRule && colour !== undefined) {
        expect(colour).toMatch(/^var\(--ou-code-token-[a-z]+\)$/);
      }
    }
  });

  test("the editor never gives its copy the theme's own .hljs panel class", () => {
    expect(EDITOR_TSX).not.toMatch(/className="[^"]*\bhljs\b/);
  });
});

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant), and a class it has no rule for keeps its light colour in the
 * dark theme. The helpers below are the ones
 * App/Tests/Dashboard/AffectedResourcesDisplayDarkMode.test.ts uses.
 */
describe("CodeEditor in the dark theme", () => {
  const SOURCES: Array<string> = ["CodeEditor.tsx", "YamlEditor.tsx"].map(
    (file: string) => {
      return fs
        .readFileSync(path.join(EDITOR_DIRECTORY, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/.*$/gm, " ");
    },
  );

  const CODE: string = SOURCES.join("\n");

  type StringTokensFunction = (code: string) => Array<string>;

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

  const utilityOf: UtilityOfFunction = (token: string): string => {
    let depth: number = 0;
    let lastColon: number = -1;

    for (let i: number = 0; i < token.length; i++) {
      const character: string = token[i] as string;

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

  const SOLID: RegExp =
    /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

  const IDENTIFIER_CHAR: RegExp = /[\w-]/;

  const SUBSTRING_VARIANTS: Array<string> = Array.from(
    THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
    (match: RegExpMatchArray): string => {
      return match[1] as string;
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
  };

  const COLOR_TOKENS: Array<string> = Array.from(
    new Set(
      stringTokens(CODE).filter((token: string) => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );

  test("the editor uses no dark: variants and builds no colour class from a template", () => {
    expect(CODE).not.toContain("dark:");
    expect(CODE).not.toMatch(/(?:bg|text|border|ring|divide|from|via|to)-\$\{/);
  });

  test("every colour class the editor uses is remapped for dark mode", () => {
    const unmapped: Array<string> = COLOR_TOKENS.filter((token: string) => {
      return !isRemapped(token);
    });

    // The scan found the editor's colours at all, so this is not vacuous.
    expect(COLOR_TOKENS).toEqual(
      expect.arrayContaining([
        // The frame, the toolbar and the status bar.
        "bg-white",
        "bg-gray-50",
        "border-gray-200",
        "border-gray-300",
        // The language chip.
        "bg-indigo-50",
        "text-indigo-700",
        // The status bar's tones.
        "text-red-700",
        "text-amber-700",
        "text-green-700",
        "text-gray-500",
        // The toolbar buttons.
        "text-gray-600",
        "hover:bg-gray-200",
        "hover:text-gray-900",
        // An error.
        "border-red-300",
      ]),
    );
    expect(unmapped).toEqual([]);
  });
});
