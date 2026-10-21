import {
  BackdropRule,
  BackdropRuleVerdicts,
  CssStyleRule,
  EmbeddedStyleSheet,
  TopLayerBackdropScan,
  UnscopedBackdropFinding,
  WHY_PARAGRAPH,
  analyzeSource,
  backdropOriginsOf,
  blankCssComments,
  formatFindings,
  isOwnedBackdropOrigin,
  isUnscopedBackdropSelector,
  listStyleRoots,
  listStyleSourceFiles,
  maskEjsTags,
  paintingPropertiesOf,
  parseCssStyleRules,
  scanFiles,
  styleSheetsIn,
} from "./TopLayerBackdropGuard";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Whenever I see this 1Password thing come up, the dashboard goes blank."
 *
 * 1Password's "Sign in" prompt is a <com-1password-uso popover> its browser
 * extension appends to the page and shows in the top layer. Every element in
 * the top layer gets a viewport-sized ::backdrop under it, see-through for a
 * popover unless the page paints it - and the Dashboard painted every
 * backdrop in the page colour (index.ejs, light and dark, and Theme.css, dark,
 * which the Admin Dashboard loads too). The rule was meant for fullscreen
 * dashboards; it turned the prompt's backdrop into an opaque light-grey sheet
 * over the whole app, which is exactly the screenshot that came with the
 * report. Chromium, Firefox and WebKit all paint it that way.
 *
 * jsdom has no top layer and does not know ::backdrop, so this cannot be
 * rendered here. What can be held is the cause: no stylesheet a frontend ships
 * may paint the backdrop of an element it does not own. The detector lives in
 * TopLayerBackdropGuard.ts; this file pins it on inline snippets first, then
 * runs it over the real tree, with checks that the scan really read the files
 * that matter so a broken walk cannot pass over nothing.
 */

// packages/Common/Tests/UI/Styles -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD_SHELL: string =
  "packages/App/FeatureSet/Dashboard/views/index.ejs";
const THEME_STYLESHEET: string = "packages/Common/UI/Styles/Theme.css";

// The rules as they shipped before the fix, verbatim.
const SHIPPED_DASHBOARD_RULES: string = `
    :fullscreen,
    ::backdrop {
      background-color: rgb(249, 250, 251);
    }

    html.dark :fullscreen,
    html.dark ::backdrop {
      background-color: rgb(15, 23, 42);
    }
`;

const SHIPPED_THEME_RULE: string = `
html.dark :fullscreen,
html.dark ::backdrop {
  background-color: var(--ou-background-primary);
}
`;

// And as they ship now.
const FIXED_DASHBOARD_RULES: string = `
    :fullscreen,
    :fullscreen::backdrop {
      background-color: rgb(249, 250, 251);
    }

    html.dark :fullscreen,
    html.dark :fullscreen::backdrop {
      background-color: rgb(15, 23, 42);
    }
`;

// Tailwind's preflight, as the Docs' built stylesheet carries it.
const TAILWIND_PREFLIGHT_BACKDROP: string = `
::backdrop {
  --tw-border-spacing-x: 0;
  --tw-border-spacing-y: 0;
  --tw-ring-offset-width: 0px;
  --tw-ring-color: rgb(59 130 246 / 0.5);
}
`;

function selectorsOf(rules: Array<BackdropRule>): Array<string> {
  return rules.map((rule: BackdropRule): string => {
    return rule.selector;
  });
}

function findingSelectors(verdicts: BackdropRuleVerdicts): Array<string> {
  return verdicts.findings.map((finding: UnscopedBackdropFinding): string => {
    return finding.selector;
  });
}

describe("which backdrops reach an element the app does not own", () => {
  test.each([
    ["the bare pseudo-element the Dashboard shipped", "::backdrop"],
    ["the universal selector", "*::backdrop"],
    ["a descendant of the root", "html ::backdrop"],
    ["the dark theme's descendant form that shipped", "html.dark ::backdrop"],
    ["a child of <body>", "body > ::backdrop"],
    ["a descendant of one of our classes", ".ou-card ::backdrop"],
    ["every popover", "[popover]::backdrop"],
    ["every open popover", ":popover-open::backdrop"],
    ["an open popover by attribute", "[popover]:popover-open::backdrop"],
    ["every modal", ":modal::backdrop"],
    ["every dialog", "dialog::backdrop"],
    ["every modal dialog", "dialog:modal::backdrop"],
    ["the extension's own element", "com-1password-uso::backdrop"],
    ["anything not in fullscreen", ":not(:fullscreen)::backdrop"],
    ["anything without our class", ":not(.ou-dialog)::backdrop"],
    ["the WebKit-prefixed pseudo-element", "::-webkit-backdrop"],
    ["any spelling of the pseudo-element", "::BACKDROP"],
  ])("%s: %s", (_description: string, selector: string) => {
    expect(isUnscopedBackdropSelector(selector)).toBe(true);
  });

  test.each([
    ["the fullscreen backdrop the fix ships", ":fullscreen::backdrop"],
    ["its dark-theme form", "html.dark :fullscreen::backdrop"],
    ["the WebKit-prefixed fullscreen", ":-webkit-full-screen::backdrop"],
    ["the Gecko-prefixed fullscreen", ":-moz-full-screen::backdrop"],
    ["a dialog of ours, by class", ".ou-dialog::backdrop"],
    ["a dialog element of ours, by class", "dialog.ou-dialog::backdrop"],
    ["a dialog of ours, by id", "#export-dialog::backdrop"],
    ["one of ours under the dark theme", "html.dark .ou-dialog::backdrop"],
    [
      "Tailwind's backdrop: variant, which compiles to the element's class",
      ".backdrop\\:bg-gray-500\\/75::backdrop",
    ],
    ["the root's own backdrop", "html.dark::backdrop"],
  ])("leaves alone %s: %s", (_description: string, selector: string) => {
    expect(isUnscopedBackdropSelector(selector)).toBe(false);
  });

  test("names the element each backdrop hangs off", () => {
    expect(backdropOriginsOf("html.dark :fullscreen::backdrop")).toEqual([
      ":fullscreen",
    ]);
    expect(backdropOriginsOf("html.dark ::backdrop")).toEqual([""]);
    expect(backdropOriginsOf("body>::backdrop")).toEqual([""]);
    expect(backdropOriginsOf("dialog[open]::backdrop")).toEqual([
      "dialog[open]",
    ]);
    // Spaces inside an attribute value or :not() are not combinators.
    expect(backdropOriginsOf('[data-label="a b"]::backdrop')).toEqual([
      '[data-label="a b"]',
    ]);
    expect(backdropOriginsOf(":not(.a .b)::backdrop")).toEqual([":not(.a .b)"]);
    // An escaped character is part of the class, not a combinator.
    expect(backdropOriginsOf(".hover\\:x\\ y::backdrop")).toEqual([
      ".hover\\:x\\ y",
    ]);
  });

  test("a selector with no backdrop has nothing to judge", () => {
    expect(backdropOriginsOf(".ou-card::before")).toEqual([]);
    expect(backdropOriginsOf(":fullscreen")).toEqual([]);
    expect(backdropOriginsOf(".backdrop-blur")).toEqual([]);
    expect(isUnscopedBackdropSelector(".backdrop-blur-sm")).toBe(false);
  });

  test("attribute selectors and functional pseudo-classes never make an element ours", () => {
    expect(isOwnedBackdropOrigin("[class~=ours]")).toBe(false);
    expect(isOwnedBackdropOrigin('[href="#x"]')).toBe(false);
    expect(isOwnedBackdropOrigin(":not(.ours)")).toBe(false);
    expect(isOwnedBackdropOrigin(":not(:fullscreen)")).toBe(false);
    /*
     * Conservative on purpose: :is(.a, .b) is read past too. Writing the
     * rule as `.a::backdrop, .b::backdrop` says the same and passes.
     */
    expect(isOwnedBackdropOrigin(":is(.a, .b)")).toBe(false);
    expect(isOwnedBackdropOrigin(".a")).toBe(true);
    expect(isOwnedBackdropOrigin("#a")).toBe(true);
    expect(isOwnedBackdropOrigin(":fullscreen")).toBe(true);
  });
});

describe("reading CSS", () => {
  test("splits a rule's selectors at its top-level commas only", () => {
    const rules: Array<CssStyleRule> = parseCssStyleRules(
      ":is(.a, .b) ::backdrop,\n  dialog::backdrop { color: red }",
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]!.selectors).toEqual([
      ":is(.a, .b) ::backdrop",
      "dialog::backdrop",
    ]);
  });

  test("reads declarations, lower-casing properties but keeping custom properties and values as written", () => {
    const rules: Array<CssStyleRule> = parseCssStyleRules(
      "::backdrop { Background-Color: RGB(1, 2, 3) !important; --Tw-Ring: 0 ; }",
    );

    expect(rules[0]!.declarations).toEqual([
      { property: "background-color", value: "RGB(1, 2, 3) !important" },
      { property: "--Tw-Ring", value: "0" },
    ]);
    expect(paintingPropertiesOf(rules[0]!)).toEqual(["background-color"]);
  });

  test("reports the line each rule starts on, offset to where the stylesheet sits in its file", () => {
    const css: string =
      "\n\n.a { color: red }\n\n  ::backdrop\n{ color: blue }";

    expect(
      parseCssStyleRules(css).map((rule: CssStyleRule): number => {
        return rule.line;
      }),
    ).toEqual([3, 5]);
    expect(
      parseCssStyleRules(css, 10).map((rule: CssStyleRule): number => {
        return rule.line;
      }),
    ).toEqual([12, 14]);
  });

  test("reads inside @media, @supports and @layer, and skips @keyframes, @font-face and statements", () => {
    const rules: Array<CssStyleRule> = parseCssStyleRules(`
      @import url("other.css");
      @charset "utf-8";
      @media (prefers-color-scheme: dark) {
        @supports (selector(:popover-open)) {
          ::backdrop { background: black }
        }
      }
      @layer base { ::backdrop { opacity: 1 } }
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      @font-face { font-family: X; src: url(x.woff2) }
      .after { color: red }
    `);

    expect(
      rules.map((rule: CssStyleRule): string => {
        return rule.selectors.join(", ");
      }),
    ).toEqual(["::backdrop", "::backdrop", ".after"]);
  });

  test("a commented-out rule is not a rule, and a comment inside one does not break it", () => {
    const rules: Array<CssStyleRule> = parseCssStyleRules(`
      /* ::backdrop { background: red } */
      .a /* the card */ { color: /* still */ red }
    `);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.selectors).toEqual([".a"]);
    expect(rules[0]!.declarations).toEqual([
      { property: "color", value: "red" },
    ]);
  });

  test("braces, semicolons and comment markers inside strings and url() belong to them", () => {
    const rules: Array<CssStyleRule> = parseCssStyleRules(`
      .a::after { content: "{ /* not a comment */ }"; color: red }
      .b { background-image: url(data:image/svg+xml;utf8,<svg></svg>); }
      ::backdrop { background: red }
    `);

    expect(
      rules.map((rule: CssStyleRule): string => {
        return rule.selectors[0]!;
      }),
    ).toEqual([".a::after", ".b", "::backdrop"]);
    expect(rules[0]!.declarations).toHaveLength(2);
    expect(rules[1]!.declarations).toEqual([
      {
        property: "background-image",
        value: "url(data:image/svg+xml;utf8,<svg></svg>)",
      },
    ]);
  });

  test("blanking comments keeps every offset and line where it was", () => {
    const css: string = "a {}\n/* one\ntwo */\nb {}";
    const blanked: string = blankCssComments(css);

    expect(blanked).toHaveLength(css.length);
    expect(blanked.split("\n")).toHaveLength(css.split("\n").length);
    expect(blanked).not.toContain("one");
    expect(blanked.indexOf("b {}")).toBe(css.indexOf("b {}"));
  });

  test("an unterminated comment or string does not run past the end", () => {
    expect(
      parseCssStyleRules(".a { color: red } /* never closed"),
    ).toHaveLength(1);
    expect(() => {
      return parseCssStyleRules('.a { content: "never closed }');
    }).not.toThrow();
  });
});

describe("where the CSS comes from", () => {
  test("a stylesheet is read whole", () => {
    expect(styleSheetsIn("Theme.css", "::backdrop {}")).toEqual([
      { css: "::backdrop {}", line: 1 },
    ]);
  });

  test("a view is read as its <style> blocks, at their lines, with EJS tags blanked out", () => {
    const view: string = [
      "<!DOCTYPE html>",
      "<html>",
      "<head>",
      '  <STYLE media="screen">',
      "    <% if (dark) { %>::backdrop { background: black }<% } %>",
      "  </style>",
      "  <script>var css = '<style>.x{}</style>';</script>",
      "</head>",
      "</html>",
    ].join("\n");

    const sheets: Array<EmbeddedStyleSheet> = styleSheetsIn("index.ejs", view);

    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.line).toBe(4);
    expect(sheets[0]!.css).toContain("::backdrop { background: black }");
    expect(sheets[0]!.css).not.toContain("<%");

    const verdicts: BackdropRuleVerdicts = analyzeSource("index.ejs", view);

    expect(verdicts.findings).toEqual([
      {
        file: "index.ejs",
        line: 5,
        selector: "::backdrop",
        properties: ["background"],
      },
    ]);
  });

  test("blanking EJS tags keeps the lines of everything around them", () => {
    const masked: string = maskEjsTags("a<% if (x) {\n%>b<%= y %>c");

    expect(masked.split("\n")).toHaveLength(2);
    expect(masked.replace(/\s/g, "")).toBe("abc");
  });

  test("plain HTML pages are views too", () => {
    expect(
      analyzeSource(
        "offline.html",
        "<style>\n::backdrop { background: #fff }\n</style>",
      ).findings,
    ).toHaveLength(1);
  });

  test("a module is read as the string and template literals that mention a backdrop, at their lines", () => {
    const module: string = [
      "// ::backdrop { background: red } is only a comment",
      'const unrelated: string = "flex";',
      "const sheet: string = `",
      "  .ou-dialog::backdrop { background: rgb(0 0 0 / 40%) }",
      "  ::backdrop { background: ${color} }",
      "`;",
      'const quoted: string = ":popover-open::backdrop { opacity: 1 }";',
    ].join("\n");

    const sheets: Array<EmbeddedStyleSheet> = styleSheetsIn(
      "Sheet.tsx",
      module,
    );

    expect(
      sheets.map((sheet: EmbeddedStyleSheet): number => {
        return sheet.line;
      }),
    ).toEqual([3, 7]);
    // The substitution stands in as a value, and the static text survives.
    expect(sheets[0]!.css).toContain("::backdrop { background: _ }");

    const verdicts: BackdropRuleVerdicts = analyzeSource("Sheet.tsx", module);

    expect(findingSelectors(verdicts)).toEqual([
      "::backdrop",
      ":popover-open::backdrop",
    ]);
    expect(selectorsOf(verdicts.scopedRules)).toEqual([".ou-dialog::backdrop"]);
  });

  test("a substitution standing in for a selector reads as unscoped unless a class is written around it", () => {
    expect(
      findingSelectors(
        analyzeSource(
          "A.ts",
          "const css: string = `${name}::backdrop { opacity: 1 }`;",
        ),
      ),
    ).toEqual(["_::backdrop"]);
    expect(
      analyzeSource(
        "B.ts",
        "const css: string = `.${name}::backdrop { opacity: 1 }`;",
      ).findings,
    ).toEqual([]);
  });

  test("naming the pseudo-element to read a style is not a rule (the session replay capture does this)", () => {
    const module: string =
      'const color: string = getComputedStyle(dialog, "::backdrop").getPropertyValue("background-color");';

    expect(styleSheetsIn("ReplayFrameCapture.ts", module)).toHaveLength(1);
    expect(analyzeSource("ReplayFrameCapture.ts", module)).toEqual({
      findings: [],
      scopedRules: [],
      paintFreeRules: [],
    });
  });

  test("declaration files and anything else are not read", () => {
    expect(
      styleSheetsIn("Types.d.ts", 'const a = "::backdrop{color:red}";'),
    ).toEqual([]);
    expect(styleSheetsIn("bundle.js", "::backdrop{color:red}")).toEqual([]);
    expect(styleSheetsIn("README.md", "::backdrop{color:red}")).toEqual([]);
  });

  test("a file that never mentions a backdrop is not parsed at all", () => {
    expect(analyzeSource("Big.tsx", "const a: string = `{`;")).toEqual({
      findings: [],
      scopedRules: [],
      paintFreeRules: [],
    });
  });
});

describe("verdicts", () => {
  test("the Dashboard's rules as they shipped paint every top-layer backdrop, in both themes", () => {
    const verdicts: BackdropRuleVerdicts = analyzeSource(
      "index.ejs",
      `<style>${SHIPPED_DASHBOARD_RULES}</style>`,
    );

    expect(verdicts.findings).toEqual([
      {
        file: "index.ejs",
        line: 2,
        selector: "::backdrop",
        properties: ["background-color"],
      },
      {
        file: "index.ejs",
        line: 7,
        selector: "html.dark ::backdrop",
        properties: ["background-color"],
      },
    ]);
  });

  test("so did the theme's dark rule the Admin Dashboard loads as well", () => {
    expect(
      findingSelectors(analyzeSource("Theme.css", SHIPPED_THEME_RULE)),
    ).toEqual(["html.dark ::backdrop"]);
  });

  test("the rules as they ship now only reach the fullscreen backdrop", () => {
    const verdicts: BackdropRuleVerdicts = analyzeSource(
      "index.ejs",
      `<style>${FIXED_DASHBOARD_RULES}</style>`,
    );

    expect(verdicts.findings).toEqual([]);
    expect(selectorsOf(verdicts.scopedRules)).toEqual([
      ":fullscreen::backdrop",
      "html.dark :fullscreen::backdrop",
    ]);
  });

  test("custom properties paint nothing, so Tailwind's preflight passes; one painting declaration beside them does not", () => {
    const preflight: BackdropRuleVerdicts = analyzeSource(
      "style.css",
      TAILWIND_PREFLIGHT_BACKDROP,
    );

    expect(preflight.findings).toEqual([]);
    expect(selectorsOf(preflight.paintFreeRules)).toEqual(["::backdrop"]);

    expect(
      analyzeSource("mixed.css", "::backdrop { --tw-ring: 0; background: red }")
        .findings,
    ).toEqual([
      {
        file: "mixed.css",
        line: 1,
        selector: "::backdrop",
        properties: ["background"],
      },
    ]);
  });

  test("anything that hides the page through a backdrop is caught, not only a colour", () => {
    for (const declaration of [
      "background-image: linear-gradient(#fff, #fff)",
      "backdrop-filter: blur(12px)",
      "-webkit-backdrop-filter: blur(12px)",
      "opacity: 1",
      "box-shadow: 0 0 0 100vmax #fff",
    ]) {
      expect(
        analyzeSource("a.css", `:popover-open::backdrop { ${declaration} }`)
          .findings,
      ).toHaveLength(1);
    }
  });

  test("a rule inside a media query is reported at its own line", () => {
    const css: string =
      "@media (prefers-color-scheme: dark) {\n  .a { color: red }\n  ::backdrop {\n    background: #000;\n  }\n}";

    expect(analyzeSource("a.css", css).findings).toEqual([
      {
        file: "a.css",
        line: 3,
        selector: "::backdrop",
        properties: ["background"],
      },
    ]);
  });

  test("only the unscoped selectors of a mixed list are findings", () => {
    const verdicts: BackdropRuleVerdicts = analyzeSource(
      "a.css",
      ":fullscreen, :fullscreen::backdrop, ::backdrop, .ou-dialog::backdrop { background: #fff }",
    );

    expect(findingSelectors(verdicts)).toEqual(["::backdrop"]);
    expect(selectorsOf(verdicts.scopedRules)).toEqual([
      ":fullscreen::backdrop",
      ".ou-dialog::backdrop",
    ]);
  });

  test("the failure message names each file:line, selector and what it paints, then why and what to write instead", () => {
    const message: string = formatFindings(
      analyzeSource(
        "packages/App/FeatureSet/Dashboard/views/index.ejs",
        `<style>${SHIPPED_DASHBOARD_RULES}</style>`,
      ).findings,
    );

    expect(message).toContain(
      "2 stylesheet rule(s) paint the ::backdrop of top-layer elements the app does not own:",
    );
    expect(message).toContain(
      "packages/App/FeatureSet/Dashboard/views/index.ejs:2  ::backdrop { background-color }",
    );
    expect(message).toContain(
      "packages/App/FeatureSet/Dashboard/views/index.ejs:7  html.dark ::backdrop { background-color }",
    );
    expect(message).toContain(WHY_PARAGRAPH);
    expect(WHY_PARAGRAPH).toContain("<com-1password-uso popover>");
    expect(WHY_PARAGRAPH).toContain(":fullscreen::backdrop");
  });

  test("no findings, no message", () => {
    expect(formatFindings([])).toBe("");
  });
});

describe("over the real tree", () => {
  let roots: Array<string> = [];
  let scan: TopLayerBackdropScan = {
    files: [],
    findings: [],
    scopedRules: [],
    paintFreeRules: [],
  };

  // Reading ~4,600 files takes a few seconds: keep it out of the describe body.
  beforeAll(() => {
    roots = listStyleRoots(REPOSITORY_ROOT);
    scan = scanFiles(roots.flatMap(listStyleSourceFiles), REPOSITORY_ROOT);
  }, 180000);

  function readShipped(relative: string): string {
    return fs.readFileSync(path.join(REPOSITORY_ROOT, relative), "utf8");
  }

  test("the scan read every frontend, Common/UI and the shared theme", () => {
    const relativeRoots: Array<string> = roots.map((root: string): string => {
      return path.relative(REPOSITORY_ROOT, root).split(path.sep).join("/");
    });

    for (const frontend of [
      "Dashboard",
      "AdminDashboard",
      "StatusPage",
      "PublicDashboard",
      "Accounts",
    ]) {
      expect(relativeRoots).toContain(`packages/App/FeatureSet/${frontend}`);
      expect(scan.files).toContain(
        `packages/App/FeatureSet/${frontend}/views/index.ejs`,
      );
      expect(scan.files).toContain(
        `packages/App/FeatureSet/${frontend}/src/Index.tsx`,
      );
    }

    expect(relativeRoots).toContain("packages/Common/UI");
    expect(scan.files).toContain(THEME_STYLESHEET);
    expect(scan.files).toContain(
      "packages/Common/UI/Components/ErrorBoundary.tsx",
    );
    expect(scan.files).toContain(
      "packages/App/FeatureSet/Dashboard/public/offline.html",
    );
    // Guards the guard: a broken walk must not pass over nothing.
    expect(scan.files.length).toBeGreaterThan(2000);
  });

  test("it read the fullscreen rules in the Dashboard shell and the theme, and passed them for being scoped", () => {
    const shipped: Array<string> = scan.scopedRules.map(
      (rule: BackdropRule): string => {
        return `${rule.file} ${rule.selector}`;
      },
    );

    expect(shipped).toEqual(
      expect.arrayContaining([
        `${DASHBOARD_SHELL} :fullscreen::backdrop`,
        `${DASHBOARD_SHELL} html.dark :fullscreen::backdrop`,
        `${THEME_STYLESHEET} html.dark :fullscreen::backdrop`,
      ]),
    );
  });

  test("it read Tailwind's preflight in the Docs' built stylesheet, and passed it for painting nothing", () => {
    expect(
      scan.paintFreeRules.map((rule: BackdropRule): string => {
        return `${rule.file} ${rule.selector}`;
      }),
    ).toContain("packages/App/FeatureSet/Docs/Static/css/style.css ::backdrop");
  });

  test("reverting the fix in memory fails the guard in the Dashboard shell and the theme", () => {
    const revert: (source: string) => string = (source: string): string => {
      return source.split(":fullscreen::backdrop").join("::backdrop");
    };

    const shell: BackdropRuleVerdicts = analyzeSource(
      DASHBOARD_SHELL,
      revert(readShipped(DASHBOARD_SHELL)),
    );
    const theme: BackdropRuleVerdicts = analyzeSource(
      THEME_STYLESHEET,
      revert(readShipped(THEME_STYLESHEET)),
    );

    expect(findingSelectors(shell)).toEqual([
      "::backdrop",
      "html.dark ::backdrop",
    ]);
    expect(findingSelectors(theme)).toEqual(["html.dark ::backdrop"]);
  });

  test("fullscreen views keep the page-coloured backdrop the rules were written for", () => {
    const shellRules: Array<CssStyleRule> = styleSheetsIn(
      DASHBOARD_SHELL,
      readShipped(DASHBOARD_SHELL),
    ).flatMap((sheet: EmbeddedStyleSheet): Array<CssStyleRule> => {
      return parseCssStyleRules(sheet.css, sheet.line);
    });

    const backgroundFor: (
      rules: Array<CssStyleRule>,
      selector: string,
    ) => string | undefined = (
      rules: Array<CssStyleRule>,
      selector: string,
    ): string | undefined => {
      const rule: CssStyleRule | undefined = rules.find(
        (candidate: CssStyleRule): boolean => {
          return candidate.selectors.includes(selector);
        },
      );

      return rule?.declarations.find(
        (declaration: { property: string }): boolean => {
          return declaration.property === "background-color";
        },
      )?.value;
    };

    expect(backgroundFor(shellRules, ":fullscreen::backdrop")).toBe(
      "rgb(249, 250, 251)",
    );
    expect(backgroundFor(shellRules, ":fullscreen")).toBe("rgb(249, 250, 251)");
    expect(backgroundFor(shellRules, "html.dark :fullscreen::backdrop")).toBe(
      "rgb(15, 23, 42)",
    );

    const themeRules: Array<CssStyleRule> = parseCssStyleRules(
      readShipped(THEME_STYLESHEET),
    );

    expect(backgroundFor(themeRules, "html.dark :fullscreen::backdrop")).toBe(
      "var(--ou-background-primary)",
    );
    expect(backgroundFor(themeRules, "html.dark :fullscreen")).toBe(
      "var(--ou-background-primary)",
    );
  });

  test("no stylesheet a frontend ships paints the backdrop of a top-layer element it does not own", () => {
    // The guard itself. The message names each offender and what to write instead.
    expect(formatFindings(scan.findings)).toBe("");
  });
});
