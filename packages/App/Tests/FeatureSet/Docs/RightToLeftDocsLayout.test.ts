import { LocalizedNavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  SUPPORTED_DOCS_LANGUAGES,
  getDocsLanguageDirection,
  getLocalizedNav,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  MediaClassRule,
  RenderedElement,
  RenderedPage,
  attributeOf,
  listTemplates,
  mediaClassRules,
  only,
  parsePage,
} from "Common/Tests/RenderedMarkup";
import { TAILWIND_BREAKPOINTS_IN_PX } from "Common/Tests/ResponsiveVisibility";
import { describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * The Docs views and stylesheet on a right-to-left page.
 *
 * Persian pages are served with dir="rtl" on <html>. The views have to set
 * it, and everything they draw has to turn round with it - the sidebar to the
 * right, the menu's rail and indent on the right, arrows pointing the other
 * way, the drawer sliding in from the right - while code keeps reading left
 * to right, or a command or an env var name in a Persian sentence is
 * reordered by the prose around it.
 *
 * So the layout is written without a direction - logical properties in the
 * stylesheet, logical utilities in the views - and these tests keep it that
 * way: a margin-left or a pl-4 added later would pin something to the wrong
 * side of every Persian page. Each sweep has a control that feeds it what the
 * views and stylesheet said before, and shows it catching that.
 */

const DOCS_ROOT: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const VIEWS_ROOT: string = path.join(DOCS_ROOT, "Views");
const STYLESHEET: string = fs.readFileSync(
  path.join(DOCS_ROOT, "Static", "css", "style.css"),
  "utf8",
);

// Where the hand-written layer starts; above it is the compiled Tailwind build.
const DESIGN_LAYER_START: number = STYLESHEET.indexOf(
  "OneUptime docs — design layer",
);

const TEMPLATES: Array<string> = [
  "Index.ejs",
  "NotFound.ejs",
  "ServerError.ejs",
];

type RenderFunction = (
  template: string,
  lang: string,
  locals?: Record<string, unknown>,
) => Promise<RenderedPage>;

// A view, with the locals its route passes it.
const render: RenderFunction = async (
  template: string,
  lang: string,
  locals: Record<string, unknown> = {},
): Promise<RenderedPage> => {
  const nav: Array<LocalizedNavGroup> = getLocalizedNav(lang);
  const category: LocalizedNavGroup = nav.find(
    (group: LocalizedNavGroup): boolean => {
      return group.key === "Self Hosted";
    },
  )!;
  const html: string = await ejs.renderFile(path.join(VIEWS_ROOT, template), {
    t: makeT(lang),
    lang: lang,
    dir: getDocsLanguageDirection(lang),
    supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
    enableGoogleTagManager: false,
    nav: nav,
    category: category,
    link: template === "Index.ejs" ? category.links[0] : null,
    content: "<h2 id='one'>One</h2><h2 id='two'>Two</h2>",
    githubPath: "self-hosted/index",
    currentPath: category.links[0]!.url,
    prevLink: null,
    nextLink: null,
    ...locals,
  });
  return parsePage(html);
};

const htmlOf: (page: RenderedPage) => RenderedElement = (
  page: RenderedPage,
): RenderedElement => {
  return only(page, (element: RenderedElement): boolean => {
    return element.tagName === "html";
  });
};

interface CssRule {
  selectors: Array<string>;
  declarations: Array<[string, string]>;
}

// Every rule with a declaration block, those inside @media and @supports too.
const readRules: (css: string) => Array<CssRule> = (
  css: string,
): Array<CssRule> => {
  return Array.from(
    css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ).map((match: RegExpMatchArray): CssRule => {
    return {
      selectors: match[1]!.split(",").map((selector: string): string => {
        return selector.trim().replace(/\s+/g, " ");
      }),
      declarations: match[2]!
        .split(";")
        .map((declaration: string): string => {
          return declaration.trim();
        })
        .filter((declaration: string): boolean => {
          return declaration.length > 0;
        })
        .map((declaration: string): [string, string] => {
          const colon: number = declaration.indexOf(":");
          return [
            declaration.slice(0, colon).trim(),
            declaration
              .slice(colon + 1)
              .trim()
              .replace(/\s+/g, " "),
          ];
        }),
    };
  });
};

const RULES: Array<CssRule> = readRules(STYLESHEET);

// What the last rule for a selector sets a property to.
const declared: (selector: string, property: string) => string | undefined = (
  selector: string,
  property: string,
): string | undefined => {
  let value: string | undefined = undefined;

  for (const rule of RULES) {
    if (!rule.selectors.includes(selector)) {
      continue;
    }

    for (const [name, declaredValue] of rule.declarations) {
      if (name === property) {
        value = declaredValue;
      }
    }
  }

  return value;
};

const PHYSICAL_PROPERTY: RegExp =
  /^(?:(?:margin|padding|border|scroll-margin|scroll-padding)-(?:left|right)(?:-.+)?|left|right|border-(?:top|bottom)-(?:left|right)-radius)$/;

// Shorthands that list the four sides top, right, bottom, left.
const BOX_SHORTHAND: RegExp =
  /^(?:margin|padding|inset|scroll-margin|scroll-padding|border-(?:width|style|color))$/;

// Physical, but the same either way round.
const SYMMETRIC_EXCEPTIONS: Array<string> = [
  // Centred with translateX(-50%).
  ".docs-search { left: 50% }",
];

// A value's space-separated parts, with functions such as rgba(...) whole.
const valueParts: (value: string) => Array<string> = (
  value: string,
): Array<string> => {
  const parts: Array<string> = [];
  let depth: number = 0;
  let current: string = "";

  for (const character of value) {
    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;
    }

    if (character === " " && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  parts.push(current);

  return parts.filter((part: string): boolean => {
    return part.length > 0;
  });
};

// A shorthand whose left and right halves differ.
const isMirrorAsymmetric: (property: string, value: string) => boolean = (
  property: string,
  value: string,
): boolean => {
  const parts: Array<string> = valueParts(value);

  if (BOX_SHORTHAND.test(property)) {
    return parts.length === 4 && parts[1] !== parts[3];
  }

  if (property !== "border-radius" || parts.length < 2 || value.includes("/")) {
    return false;
  }

  // Top left, top right, bottom right, bottom left.
  const corners: Array<string | undefined> =
    parts.length === 2
      ? [parts[0], parts[1], parts[0], parts[1]]
      : parts.length === 3
        ? [parts[0], parts[1], parts[2], parts[1]]
        : parts;

  return corners[0] !== corners[1] || corners[2] !== corners[3];
};

// A text-align, float or clear that names a side.
const SIDE_KEYWORD: RegExp = /^(?:left|right)$/;

// Every declaration that pins something to the left or the right.
const physicalDeclarations: (css: string) => Array<string> = (
  css: string,
): Array<string> => {
  return readRules(css).flatMap((rule: CssRule): Array<string> => {
    return rule.declarations
      .filter(([property, value]: [string, string]): boolean => {
        return (
          PHYSICAL_PROPERTY.test(property) ||
          (["text-align", "float", "clear"].includes(property) &&
            SIDE_KEYWORD.test(value)) ||
          isMirrorAsymmetric(property, value)
        );
      })
      .map(([property, value]: [string, string]): string => {
        return `${rule.selectors.join(", ")} { ${property}: ${value} }`;
      })
      .filter((description: string): boolean => {
        return !SYMMETRIC_EXCEPTIONS.includes(description);
      });
  });
};

const PHYSICAL_UTILITY: RegExp =
  /^(?:[\w-]+:)*-?(?:m[lr]|p[lr]|left|right|inset-x|text-(?:left|right)|rounded-(?:[lr]|[tb][lr])|border-[lr]|space-x|divide-x|translate-x|scroll-[mp][lr]|float|clear)(?:-|$)/;

// Every class name in some markup, scripts' markup strings included.
const classTokens: (markup: string) => Array<string> = (
  markup: string,
): Array<string> => {
  return Array.from(markup.matchAll(/class="([^"]*)"/g)).flatMap(
    (match: RegExpMatchArray): Array<string> => {
      return match[1]!.split(/\s+/).filter((token: string): boolean => {
        return token.length > 0;
      });
    },
  );
};

const VIEWS: Array<[string, string]> = listTemplates(VIEWS_ROOT).map(
  (template: string): [string, string] => {
    return [
      path.relative(VIEWS_ROOT, template),
      fs.readFileSync(template, "utf8"),
    ];
  },
);

// Mirrored on a right-to-left page, or - the menu's chevron - turned.
const TURNS_ROUND: RegExp = /docs-rtl-mirror|docs-nav__chevron/;

// The shapes that point along the line: a chevron either way, the back arrow.
const HORIZONTAL_SHAPES: Array<string> = [
  "M9 5l7 7-7 7",
  "M15 19l-7-7 7-7",
  "M10 19l-7-7m0 0l7-7m-7 7h18",
];

// Icons in some markup that point along the line and do not turn round.
const unturnedIcons: (markup: string) => {
  found: number;
  unturned: Array<string>;
} = (markup: string): { found: number; unturned: Array<string> } => {
  let found: number = 0;
  const unturned: Array<string> = [];

  for (const match of markup.matchAll(
    /<svg\b([^>]*)>((?:(?!<\/svg>)[\s\S])*?)<\/svg>/g,
  )) {
    const pointsAlong: boolean = HORIZONTAL_SHAPES.some(
      (shape: string): boolean => {
        return match[2]!.includes(`d="${shape}"`);
      },
    );

    if (!pointsAlong) {
      continue;
    }

    found++;

    if (!TURNS_ROUND.test(match[1]!)) {
      unturned.push(`<svg${match[1]}>`);
    }
  }

  return { found: found, unturned: unturned };
};

describe.each(TEMPLATES)("%s", (template: string) => {
  it("is laid out right to left in Persian", async () => {
    const page: RenderedPage = await render(template, "fa");

    expect(attributeOf(htmlOf(page), "lang")).toBe("fa");
    expect(attributeOf(htmlOf(page), "dir")).toBe("rtl");
  });

  it("is laid out left to right in English", async () => {
    const page: RenderedPage = await render(template, "en");

    expect(attributeOf(htmlOf(page), "lang")).toBe("en");
    expect(attributeOf(htmlOf(page), "dir")).toBe("ltr");
  });

  it("falls back to left to right when it is not given a direction", async () => {
    const page: RenderedPage = await render(template, "en", {
      dir: undefined,
    });

    expect(attributeOf(htmlOf(page), "dir")).toBe("ltr");
  });
});

describe("the article on a Persian page", () => {
  const articleOf: (page: RenderedPage) => RenderedElement = (
    page: RenderedPage,
  ): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "id") === "docs-content";
    });
  };

  it("takes the page's direction when it is the Persian copy", async () => {
    const page: RenderedPage = await render("Index.ejs", "fa", {
      contentLang: "fa",
      contentDir: "rtl",
    });

    expect(attributeOf(articleOf(page), "lang")).toBeNull();
    expect(attributeOf(articleOf(page), "dir")).toBeNull();
  });

  it("is marked English, left to right, when it is the English copy of an untranslated page", async () => {
    const page: RenderedPage = await render("Index.ejs", "fa", {
      contentLang: "en",
      contentDir: "ltr",
    });

    expect(attributeOf(htmlOf(page), "dir")).toBe("rtl");
    expect(attributeOf(articleOf(page), "lang")).toBe("en");
    expect(attributeOf(articleOf(page), "dir")).toBe("ltr");
  });
});

describe("style.css on a right-to-left page", () => {
  it.each([".docs-code pre", ".docs-code-inline"])(
    "keeps %s left to right, isolated from the prose around it",
    (selector: string) => {
      expect(declared(selector, "direction")).toBe("ltr");
      expect(declared(selector, "unicode-bidi")).toBe("isolate");
    },
  );

  it("keeps diagrams and keyboard shortcuts left to right", () => {
    // Mermaid lays diagrams out left to right, and their labels are English.
    expect(declared(".docs-diagram", "direction")).toBe("ltr");
    // ⌘K, never K⌘.
    expect(declared(".docs-kbd", "direction")).toBe("ltr");
  });

  it("aligns table headers to the start, where browsers would centre them", () => {
    /*
     * The browser centres a th whose row has the initial text-align, and
     * `start` is the initial value: said only on the table, the way
     * `text-align: left` used to be, it centred every header.
     */
    expect(declared(".docs-table", "text-align")).toBe("start");
    expect(declared(".docs-table th", "text-align")).toBe("start");
  });

  it("wraps a long token in prose rather than widening the page", () => {
    // A phone opens a too-wide right-to-left page at its far end.
    expect(declared(".docs-content", "overflow-wrap")).toBe("break-word");
  });

  it("writes no physical left or right in the hand-written layer", () => {
    expect(DESIGN_LAYER_START).toBeGreaterThan(0);
    expect(physicalDeclarations(STYLESHEET.slice(DESIGN_LAYER_START))).toEqual(
      [],
    );
  });

  it("control: the sweep catches what the layer used to say", () => {
    expect(
      physicalDeclarations(
        [
          ".docs-skip-link { left: 0.75rem; }",
          ".docs-nav__links { margin-left: 1.0625rem; border-left: 1px solid; }",
          ".docs-nav__link { border-radius: 0 0.375rem 0.375rem 0; }",
          ".docs-quote { padding: 0.25rem 0 0.25rem 1.125rem; }",
          ".docs-table { text-align: left; }",
          // Physical in name only: centred, and a colour with spaces in it.
          ".docs-search { left: 50%; }",
          ".docs-code__copy:hover { border-color: rgba(255, 255, 255, 0.12); }",
        ].join("\n"),
      ),
    ).toEqual([
      ".docs-skip-link { left: 0.75rem }",
      ".docs-nav__links { margin-left: 1.0625rem }",
      ".docs-nav__links { border-left: 1px solid }",
      ".docs-nav__link { border-radius: 0 0.375rem 0.375rem 0 }",
      ".docs-quote { padding: 0.25rem 0 0.25rem 1.125rem }",
      ".docs-table { text-align: left }",
    ]);
  });
});

describe("the views on a right-to-left page", () => {
  it("use no physical left or right utility", () => {
    const offenders: Array<string> = VIEWS.flatMap(
      ([template, source]: [string, string]): Array<string> => {
        return classTokens(source)
          .filter((token: string): boolean => {
            return PHYSICAL_UTILITY.test(token);
          })
          .map((token: string): string => {
            return `${template}: ${token}`;
          });
      },
    );

    /*
     * The one exception is the drawer's closed position, which its script
     * toggles: the stylesheet slides it out to the right instead on a
     * right-to-left page, where the drawer is pinned.
     */
    expect(offenders).toEqual(["Partials/MobileNav.ejs: -translate-x-full"]);
    expect(
      declared('[dir="rtl"] .docs-drawer.-translate-x-full', "transform"),
    ).toBe("translateX(100%)");
  });

  it("turn every arrow and chevron round", () => {
    const unturned: Array<string> = [];
    let found: number = 0;

    for (const [template, source] of VIEWS) {
      const icons: { found: number; unturned: Array<string> } =
        unturnedIcons(source);
      found += icons.found;
      unturned.push(
        ...icons.unturned.map((icon: string): string => {
          return `${template}: ${icon}`;
        }),
      );
    }

    // Breadcrumbs, pager, menu, search results and the error pages' back link.
    expect(found).toBeGreaterThanOrEqual(8);
    expect(unturned).toEqual([]);
    expect(declared('[dir="rtl"] .docs-rtl-mirror', "transform")).toBe(
      "scaleX(-1)",
    );
    // Closed, the menu's chevron points into the page: leftwards.
    expect(declared('[dir="rtl"] .docs-nav__chevron', "transform")).toBe(
      "rotate(180deg)",
    );
  });

  it("control: the sweeps catch what the views used to say", () => {
    const before: string = [
      '<div class="docs-sidebar-tint absolute inset-y-0 right-0 w-[50vw]"></div>',
      '<div class="sticky top-14 -ml-0.5 py-8 pl-0.5 pr-6"></div>',
      '<a class="docs-pager__link sm:items-end sm:text-right">',
      '<svg class="docs-pager__icon" fill="none"><path d="M9 5l7 7-7 7"/></svg></a>',
    ].join("\n");

    expect(
      classTokens(before).filter((token: string): boolean => {
        return PHYSICAL_UTILITY.test(token);
      }),
    ).toEqual(["right-0", "-ml-0.5", "pl-0.5", "pr-6", "sm:text-right"]);
    expect(unturnedIcons(before)).toEqual({
      found: 1,
      unturned: ['<svg class="docs-pager__icon" fill="none">'],
    });
  });

  it("find every logical utility they use precompiled, as Tailwind writes it", () => {
    /*
     * style.css lays the page out until the Play CDN has generated its own
     * sheet. A logical utility missing from it would, say, leave the
     * sidebar's tint over the article at first paint.
     */
    const properties: Record<string, string> = {
      ps: "padding-inline-start",
      pe: "padding-inline-end",
      ms: "margin-inline-start",
      me: "margin-inline-end",
      start: "inset-inline-start",
      end: "inset-inline-end",
    };
    const logicalUtility: RegExp =
      /^(?:([\w-]+):)?(?:(-?)(ps|pe|ms|me|start|end)-([\d.]+)|text-(start|end))$/;
    const mediaRules: Map<string, MediaClassRule> = mediaClassRules(STYLESHEET);

    const tokens: Array<string> = Array.from(
      new Set<string>(
        VIEWS.flatMap(([, source]: [string, string]): Array<string> => {
          return classTokens(source);
        }),
      ),
    ).filter((token: string): boolean => {
      return logicalUtility.test(token);
    });

    expect(tokens.length).toBeGreaterThan(0);

    const missing: Array<string> = [];

    for (const token of tokens) {
      const [, variant, sign, prefix, size, alignment]: Array<
        string | undefined
      > = token.match(logicalUtility)!;
      const rem: number = Number(size) * 0.25;
      const [property, value]: [string, string] = alignment
        ? ["text-align", alignment]
        : [properties[prefix!]!, rem === 0 ? "0" : `${sign}${rem}rem`];

      if (variant) {
        const media: string = `(min-width: ${TAILWIND_BREAKPOINTS_IN_PX[variant]}px)`;
        const rule: MediaClassRule | undefined = mediaRules.get(token);

        if (
          rule?.media !== media ||
          rule.declarations !== `${property}: ${value};`
        ) {
          missing.push(
            `@media ${media} { .${token} { ${property}: ${value} } }`,
          );
        }

        continue;
      }

      const selector: string = `.${token.replace(/([.:/[\]])/g, "\\$1")}`;

      if (declared(selector, property) !== value) {
        missing.push(`${selector} { ${property}: ${value} }`);
      }
    }

    expect(missing).toEqual([]);
  });
});
