import {
  PAGE_FIXTURES,
  PageFixture,
  renderPage,
  VIEWS_ROOT,
} from "./ReferenceFixtures";
import { makeT } from "../../../FeatureSet/APIReference/Utils/I18n";
import {
  RenderedElement,
  RenderedPage,
  attributeOf,
  classOf,
  listTemplates,
  only,
  parsePage,
  textOf,
} from "Common/Tests/RenderedMarkup";
import { beforeAll, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The API Reference views and stylesheet on a right-to-left page.
 *
 * Persian pages are served with dir="rtl" on <html>. The layout has to set
 * it, and everything it draws has to turn round with it - the sidebar and its
 * rail to the right, the drawer sliding in from the right, the top bar's
 * search pill, the pager and the breadcrumb chevrons pointing the other way -
 * while code keeps reading left to right, or a path, a JSON key or a shortcut
 * in a Persian sentence is reordered by the prose around it.
 *
 * So the layout is written without a direction - logical properties in the
 * stylesheet, logical utilities in the views - and these tests keep it that
 * way: a margin-left or a pl-4 added later would pin something to the wrong
 * side of every Persian page. Each sweep has a control that feeds it what the
 * views and stylesheet said before, and shows it catching that.
 */

const VIEWS: Array<[string, string]> = listTemplates(VIEWS_ROOT).map(
  (template: string): [string, string] => {
    return [
      path.relative(VIEWS_ROOT, template),
      fs.readFileSync(template, "utf8"),
    ];
  },
);

const SCRIPTS: string = fs.readFileSync(
  path.join(VIEWS_ROOT, "partials", "scripts.ejs"),
  "utf8",
);

// Every hand-written rule: the stylesheet partial and the theme toggle's.
const STYLESHEET: string = VIEWS.flatMap(
  ([, source]: [string, string]): Array<string> => {
    return Array.from(source.matchAll(/<style>([\s\S]*?)<\/style>/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );
  },
).join("\n");

interface CssRule {
  selectors: Array<string>;
  declarations: Array<[string, string]>;
}

// Every rule with a declaration block, those inside @media too.
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

// A text-align, float or clear that names a side.
const SIDE_KEYWORD: RegExp = /^(?:left|right)$/;

/*
 * A rule that only applies on a page of one direction may name a side: that
 * is the override for what logical properties cannot say.
 */
const DIRECTION_SCOPED: RegExp = /^\[dir="(?:rtl|ltr)"\]/;

// A value's space-separated parts, with functions such as rgb(...) whole.
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

// Every declaration that pins something to the left or the right.
const physicalDeclarations: (css: string) => Array<string> = (
  css: string,
): Array<string> => {
  return readRules(css)
    .filter((rule: CssRule): boolean => {
      return !rule.selectors.every((selector: string): boolean => {
        return DIRECTION_SCOPED.test(selector);
      });
    })
    .flatMap((rule: CssRule): Array<string> => {
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
        });
    });
};

const PHYSICAL_UTILITY: RegExp =
  /^(?:[\w-]+:)*-?(?:m[lr]|p[lr]|left|right|inset-x|text-(?:left|right)|rounded-(?:[lr]|[tb][lr])|border-[lr]|space-x|divide-x|translate-x|scroll-[mp][lr]|float|clear)(?:-|$)/;

// Every class token in some markup: class attributes, and what scripts set.
const classTokens: (markup: string) => Array<string> = (
  markup: string,
): Array<string> => {
  const fromAttributes: Array<string> = Array.from(
    markup.matchAll(/class="([^"]*)"/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });

  // `link.className = 'toc-link ...' + (isSubHeading ? 'ps-7' : 'ps-4');`
  const fromScripts: Array<string> = Array.from(
    markup.matchAll(
      /\.className\s*=\s*([^;]+);|\.classList\.(?:add|remove|toggle|contains)\(([^)]*)\)/g,
    ),
  ).flatMap((match: RegExpMatchArray): Array<string> => {
    return Array.from((match[1] || match[2]!).matchAll(/'([^']*)'/g)).map(
      (literal: RegExpMatchArray): string => {
        return literal[1]!;
      },
    );
  });

  return [...fromAttributes, ...fromScripts].flatMap(
    (classes: string): Array<string> => {
      return classes.split(/\s+/).filter((token: string): boolean => {
        return token.length > 0;
      });
    },
  );
};

const physicalUtilities: (markup: string) => Array<string> = (
  markup: string,
): Array<string> => {
  return classTokens(markup).filter((token: string): boolean => {
    return PHYSICAL_UTILITY.test(token);
  });
};

// Every inline style attribute in some markup, as one rule each.
const inlineStyles: (markup: string) => string = (markup: string): string => {
  return Array.from(markup.matchAll(/\sstyle="([^"]*)"/g))
    .map((match: RegExpMatchArray): string => {
      return `[style] { ${match[1]} }`;
    })
    .join("\n");
};

// Mirrored on a right-to-left page.
const TURNS_ROUND: RegExp = /\brtl-mirror\b/;

// The shapes that point along the line: chevrons either way, the arrows.
const HORIZONTAL_SHAPES: Array<string> = [
  "m8 5 4 5-4 5",
  "m12 5-4 5 4 5",
  "M9 5l7 7-7 7",
  "m11.5 6.5 3 3.5m0 0-3 3.5m3-3.5h-9",
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

const htmlOf: (page: RenderedPage) => RenderedElement = (
  page: RenderedPage,
): RenderedElement => {
  return only(page, (element: RenderedElement): boolean => {
    return element.tagName === "html";
  });
};

// The elements directly inside another.
const childrenOf: (
  page: RenderedPage,
  parent: RenderedElement,
) => Array<RenderedElement> = (
  page: RenderedPage,
  parent: RenderedElement,
): Array<RenderedElement> => {
  return page.elements.filter((element: RenderedElement): boolean => {
    return element.ancestors[0] === parent;
  });
};

// The name inside every sidebar and drawer link to a page.
const navNamesFor: (
  page: RenderedPage,
  slug: string,
) => Array<RenderedElement> = (
  page: RenderedPage,
  slug: string,
): Array<RenderedElement> => {
  return page.elements
    .filter((element: RenderedElement): boolean => {
      return (
        element.tagName === "a" &&
        attributeOf(element, "data-nav-slug") === slug
      );
    })
    .map((link: RenderedElement): RenderedElement => {
      return only(
        { html: page.html, elements: childrenOf(page, link) },
        (element: RenderedElement): boolean => {
          return element.tagName === "span";
        },
      );
    });
};

// A data type page: not one of the shared fixtures, since nothing else needs it.
const DATA_TYPE_PAGE: PageFixture = {
  page: "data-type",
  slug: "monitor-steps",
  pageData: {
    title: "MonitorSteps",
    description: "The checks a monitor runs (one step per target).",
    isEnum: false,
    properties: [
      {
        name: "monitorStepsInstanceArray",
        required: true,
        type: "Array<MonitorStep>",
        typeLinks: [
          { label: "Array<", path: "" },
          { label: "MonitorStep", path: "monitor-step" },
          { label: ">", path: "" },
        ],
        description: "An ordered array of steps (usually one).",
      },
    ],
    values: [],
    jsonExample: '{ "_type": "MonitorSteps", "value": {} }',
    relatedTypes: [],
    typeHierarchy: [],
    propertyCount: 1,
    valueCount: 0,
    jsonWrapperType: "MonitorSteps",
  },
};

const ALL_PAGES: Array<[string, PageFixture]> = [
  ...Object.entries(PAGE_FIXTURES),
  ["dataType", DATA_TYPE_PAGE],
];

describe.each(ALL_PAGES)(
  "the %s page",
  (_name: string, fixture: PageFixture) => {
    it("is laid out right to left in Persian", async () => {
      const page: RenderedPage = parsePage(
        await renderPage(fixture, { lang: "fa" }),
      );

      expect(attributeOf(htmlOf(page), "lang")).toBe("fa");
      expect(attributeOf(htmlOf(page), "dir")).toBe("rtl");
    });

    it("is laid out left to right in English", async () => {
      const page: RenderedPage = parsePage(
        await renderPage(fixture, { lang: "en" }),
      );

      expect(attributeOf(htmlOf(page), "lang")).toBe("en");
      expect(attributeOf(htmlOf(page), "dir")).toBe("ltr");
    });

    it("falls back to left to right when it is not given a direction", async () => {
      const page: RenderedPage = parsePage(
        await renderPage(fixture, { lang: "en", dir: undefined }),
      );

      expect(attributeOf(htmlOf(page), "dir")).toBe("ltr");
    });
  },
);

describe("the stylesheet on a right-to-left page", () => {
  it.each(["pre", "code", "kbd"])(
    "keeps %s left to right, isolated from the prose around it",
    (selector: string) => {
      /*
       * Translated strings carry <code> too, so this is said of the elements
       * rather than of the classes the templates give them.
       */
      expect(declared(selector, "direction")).toBe("ltr");
      expect(declared(selector, "unicode-bidi")).toBe("isolate");
    },
  );

  it("writes no physical left or right", () => {
    expect(RULES.length).toBeGreaterThan(40);
    expect(physicalDeclarations(STYLESHEET)).toEqual([]);
  });

  it("control: the sweep catches what the stylesheet used to say", () => {
    expect(
      physicalDeclarations(
        [
          ".heading-anchor { margin-left: 0.5rem; }",
          ".nav-link { border-left: 2px solid transparent; }",
          ".nav-link:hover { border-left-color: red; }",
          '.code-tab[aria-selected="true"]::after { left: 0.75rem; right: 0.75rem; }',
          ".copy-btn-floating { top: 0.75rem; right: 0.75rem; }",
          ".status { padding: 0 23px 0 0; text-align: left; }",
          // Said only of a right-to-left page, or the same either way round.
          '[dir="rtl"] .endpoint-path { text-align: right; }',
          ".symmetric { inset: 0; padding: 0 1rem; margin: 0 auto; }",
        ].join("\n"),
      ),
    ).toEqual([
      ".heading-anchor { margin-left: 0.5rem }",
      ".nav-link { border-left: 2px solid transparent }",
      ".nav-link:hover { border-left-color: red }",
      '.code-tab[aria-selected="true"]::after { left: 0.75rem }',
      '.code-tab[aria-selected="true"]::after { right: 0.75rem }',
      ".copy-btn-floating { right: 0.75rem }",
      ".status { padding: 0 23px 0 0 }",
      ".status { text-align: left }",
    ]);
  });

  it("turns arrows round, slides the drawer out to the right, and lines the endpoint path up with its methods", () => {
    expect(declared('[dir="rtl"] .rtl-mirror', "transform")).toBe("scaleX(-1)");
    /*
     * The drawer's script toggles -translate-x-full, which slides it off to
     * the left; pinned to the right, it has to go that way instead.
     */
    expect(
      declared('[dir="rtl"] #mobile-menu-panel.-translate-x-full', "transform"),
    ).toBe("translateX(100%)");
    /*
     * The path fills the row beside its methods and reads left to right, so
     * it would otherwise line up at the far end of the row from them.
     */
    expect(declared('[dir="rtl"] .endpoint-path', "text-align")).toBe("right");
  });
});

describe("the views on a right-to-left page", () => {
  it("use no physical left or right utility", () => {
    const offenders: Array<string> = Array.from(
      new Set<string>(
        VIEWS.flatMap(([template, source]: [string, string]): Array<string> => {
          return physicalUtilities(source).map((token: string): string => {
            return `${template}: ${token}`;
          });
        }),
      ),
    ).sort();

    /*
     * The one exception is the drawer's closed position, which its script
     * toggles: the stylesheet slides it out to the right instead on a
     * right-to-left page, where the drawer is pinned.
     */
    expect(offenders).toEqual([
      "partials/nav.ejs: -translate-x-full",
      "partials/scripts.ejs: -translate-x-full",
    ]);
  });

  it("write no physical left or right in an inline style", () => {
    const styled: Array<[string, string]> = VIEWS.filter(
      ([, source]: [string, string]): boolean => {
        return inlineStyles(source) !== "";
      },
    );
    const offenders: Array<string> = styled.flatMap(
      ([template, source]: [string, string]): Array<string> => {
        return physicalDeclarations(inlineStyles(source)).map(
          (declaration: string): string => {
            return `${template}: ${declaration}`;
          },
        );
      },
    );

    // The status page lays itself out with inline styles.
    expect(
      styled.map(([template]: [string, string]): string => {
        return template;
      }),
    ).toContain("main/status.ejs");
    expect(offenders).toEqual([]);
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

    // Breadcrumbs, pager, the type hierarchy, and the two arrow links.
    expect(found).toBeGreaterThanOrEqual(8);
    expect(unturned).toEqual([]);
  });

  it("control: the sweeps catch what the views used to say", () => {
    const before: string = [
      '<div class="fixed inset-y-0 left-0 z-40 w-72 border-r border-line"></div>',
      '<div class="lg:pl-72"><a class="nav-link rounded-r-md py-1.5 pl-5 pr-3"></a></div>',
      '<a class="group flex flex-col items-end p-4 text-right">',
      '<svg class="h-3.5 w-3.5" viewBox="0 0 20 20"><path d="m8 5 4 5-4 5"></path></svg></a>',
      "<script>link.className = 'toc-link -ml-px block border-l '",
      "   + (isSubHeading ? 'pl-7' : 'pl-4');</script>",
      '<h1 style="margin:0;margin-right:20px;padding:0 23px 0 0">200</h1>',
    ].join("\n");

    expect(physicalUtilities(before)).toEqual([
      "left-0",
      "border-r",
      "lg:pl-72",
      "rounded-r-md",
      "pl-5",
      "pr-3",
      "text-right",
      "-ml-px",
      "border-l",
      "pl-7",
      "pl-4",
    ]);
    expect(physicalDeclarations(inlineStyles(before))).toEqual([
      "[style] { margin-right: 20px }",
      "[style] { padding: 0 23px 0 0 }",
    ]);
    expect(unturnedIcons(before)).toEqual({
      found: 1,
      unturned: ['<svg class="h-3.5 w-3.5" viewBox="0 0 20 20">'],
    });
  });
});

describe("text that is not translated, on a Persian page", () => {
  let modelPage: RenderedPage;
  let introductionPage: RenderedPage;
  let paginationPage: RenderedPage;
  let dataTypePage: RenderedPage;

  beforeAll(async () => {
    modelPage = parsePage(
      await renderPage(PAGE_FIXTURES["model"]!, { lang: "fa" }),
    );
    introductionPage = parsePage(
      await renderPage(PAGE_FIXTURES["introduction"]!, { lang: "fa" }),
    );
    paginationPage = parsePage(
      await renderPage(PAGE_FIXTURES["pagination"]!, { lang: "fa" }),
    );
    dataTypePage = parsePage(await renderPage(DATA_TYPE_PAGE, { lang: "fa" }));
  });

  it("keeps every language's code panel left to right, and the request preview with the page", () => {
    const panels: Array<RenderedElement> = modelPage.elements.filter(
      (element: RenderedElement): boolean => {
        return attributeOf(element, "role") === "tabpanel";
      },
    );

    // Six operations, each with the request preview and eleven languages.
    expect(panels).toHaveLength(6 * 12);

    for (const panel of panels) {
      const isPreview: boolean =
        attributeOf(panel, "data-panel-id") === "preview";

      expect([
        attributeOf(panel, "data-panel-id"),
        attributeOf(panel, "dir"),
      ]).toEqual([
        attributeOf(panel, "data-panel-id"),
        isPreview ? null : "ltr",
      ]);
    }
  });

  it("keeps a language's tab name left to right, so C# is not drawn #C", () => {
    const labels: Array<[string, string | null]> = modelPage.elements
      .filter((element: RenderedElement): boolean => {
        return attributeOf(element, "role") === "tab";
      })
      .slice(0, 12)
      .map((tab: RenderedElement): [string, string | null] => {
        const label: RenderedElement = childrenOf(modelPage, tab).find(
          (element: RenderedElement): boolean => {
            return attributeOf(element, "aria-hidden") === null;
          },
        )!;

        return [textOf(modelPage, label), attributeOf(label, "dir")];
      });

    // The request tab's name is translated and follows the page.
    expect(labels[0]![1]).toBeNull();
    expect(labels).toContainEqual(["C#", "ltr"]);
    expect(
      labels.slice(1).every(([, dir]: [string, string | null]): boolean => {
        return dir === "ltr";
      }),
    ).toBe(true);
  });

  it("lays a model's name out left to right in the sidebar, and leaves a guide's to the page", () => {
    /*
     * Model names are English in every language: laid out right to left, a
     * long one would be cut short at its start. A translated guide name that
     * opens with a Latin acronym - Persian's "APIهای مدیر ارشد" - would read
     * in the wrong order if it were laid out left to right.
     */
    for (const name of navNamesFor(introductionPage, "monitor")) {
      expect(attributeOf(name, "dir")).toBe("ltr");
    }

    for (const slug of ["introduction", "master-admin-apis"]) {
      const names: Array<RenderedElement> = navNamesFor(introductionPage, slug);

      // Once in the desktop rail, once in the drawer.
      expect(names).toHaveLength(2);

      for (const name of names) {
        expect([slug, attributeOf(name, "dir")]).toEqual([slug, null]);
      }
    }
  });

  it("does the same in the pager", () => {
    const pagerNames: (page: RenderedPage) => Array<string | null> = (
      page: RenderedPage,
    ): Array<string | null> => {
      const pager: RenderedElement = only(
        page,
        (element: RenderedElement): boolean => {
          return (
            element.tagName === "nav" &&
            attributeOf(element, "aria-label") === makeT("fa")("ui.pagerAria")
          );
        },
      );

      return page.elements
        .filter((element: RenderedElement): boolean => {
          return (
            element.ancestors.includes(pager) &&
            classOf(element).includes("truncate")
          );
        })
        .map((name: RenderedElement): string | null => {
          return attributeOf(name, "dir");
        });
    };

    // Monitor sits between two other models; pagination between two guides.
    expect(pagerNames(modelPage)).toEqual(["ltr", "ltr"]);
    expect(pagerNames(paginationPage)).toEqual([null, null]);
  });

  it("isolates a model's English description, so its full stop stays at its end", () => {
    const isolated: Array<string> = modelPage.elements
      .filter((element: RenderedElement): boolean => {
        return element.tagName === "bdi";
      })
      .map((element: RenderedElement): string => {
        return textOf(modelPage, element);
      });

    expect(isolated).toContain(
      "Monitor is anything that monitors your API or website.",
    );
    // The properties, and who may read, create, edit and delete.
    expect(isolated).toContain("Name of the monitor.");
    expect(isolated).toContain("Read a monitor.");
    expect(isolated).toContain("Delete a monitor.");
  });

  it("keeps a data type's type left to right, so Array<MonitorStep> is not drawn >Array<MonitorStep", () => {
    const type: RenderedElement = only(
      dataTypePage,
      (element: RenderedElement): boolean => {
        return (
          element.tagName === "span" &&
          textOf(dataTypePage, element).replace(/\s+/g, "") ===
            "Array&lt;MonitorStep&gt;"
        );
      },
    );

    expect(attributeOf(type, "dir")).toBe("ltr");
    expect(
      dataTypePage.elements.some((element: RenderedElement): boolean => {
        return (
          element.tagName === "bdi" &&
          textOf(dataTypePage, element) ===
            "The checks a monitor runs (one step per target)."
        );
      }),
    ).toBe(true);
  });
});

interface StubElement {
  dataset: { tabId: string };
  closest: (selector: string) => StubElement | null;
  focus: () => void;
  querySelectorAll: (selector: string) => Array<StubElement>;
  getAttribute: (name: string) => string | null;
}

interface KeydownEvent {
  key: string;
  target: StubElement;
  preventDefault: () => void;
}

type KeydownHandler = (event: KeydownEvent) => void;

/*
 * The real page script, run against a stub document holding one strip of
 * tabs. The keydown handler is all that matters here; the rest of the
 * script finds none of its elements and returns early.
 */
const codeTabKeyboard: (direction: string) => (key: string) => string = (
  direction: string,
): ((key: string) => string) => {
  const ids: Array<string> = ["preview", "curl", "javascript"];
  let focused: string = "preview";
  const handlers: Array<KeydownHandler> = [];

  const strip: StubElement = {
    dataset: { tabId: "" },
    closest: (): StubElement | null => {
      return null;
    },
    focus: (): void => {},
    querySelectorAll: (): Array<StubElement> => {
      return tabs;
    },
    getAttribute: (): string | null => {
      return null;
    },
  };

  const tabs: Array<StubElement> = ids.map((id: string): StubElement => {
    const tab: StubElement = {
      dataset: { tabId: id },
      closest: (selector: string): StubElement | null => {
        return selector === ".code-tab" ? tab : strip;
      },
      focus: (): void => {
        focused = id;
      },
      querySelectorAll: (): Array<StubElement> => {
        return [];
      },
      getAttribute: (): string | null => {
        return null;
      },
    };
    return tab;
  });

  const fakeDocument: Record<string, unknown> = {
    readyState: "complete",
    addEventListener: (name: string, handler: KeydownHandler): void => {
      if (name === "keydown") {
        handlers.push(handler);
      }
    },
    getElementById: (): null => {
      return null;
    },
    querySelector: (): null => {
      return null;
    },
    querySelectorAll: (): Array<StubElement> => {
      return [];
    },
  };

  const fakeWindow: Record<string, unknown> = {
    localStorage: {
      getItem: (): null => {
        return null;
      },
      setItem: (): void => {},
      removeItem: (): void => {},
    },
    getComputedStyle: (element: StubElement): { direction: string } => {
      // The strip takes the page's direction; anything else does not matter.
      return { direction: element === strip ? direction : "ltr" };
    },
  };

  const pageScript: string = Array.from(
    SCRIPTS.matchAll(/<script>([\s\S]*?)<\/script>/g),
  )
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .find((source: string): boolean => {
      return source.includes("function selectCodeTab");
    })!;

  // eslint-disable-next-line no-new-func
  new Function("window", "document", pageScript)(fakeWindow, fakeDocument);

  return (key: string): string => {
    const target: StubElement = tabs.find((tab: StubElement): boolean => {
      return tab.dataset.tabId === focused;
    })!;

    for (const handler of handlers) {
      handler({ key: key, target: target, preventDefault: (): void => {} });
    }

    return focused;
  };
};

describe("the code tabs on a right-to-left page", () => {
  it("move to the next tab with the left arrow, the way the strip is drawn", () => {
    const press: (key: string) => string = codeTabKeyboard("rtl");

    expect(press("ArrowLeft")).toBe("curl");
    expect(press("ArrowLeft")).toBe("javascript");
    expect(press("ArrowRight")).toBe("curl");
  });

  it("still move to the next tab with the right arrow on a left-to-right page", () => {
    const press: (key: string) => string = codeTabKeyboard("ltr");

    expect(press("ArrowRight")).toBe("curl");
    expect(press("ArrowLeft")).toBe("preview");
    // From the first tab, back wraps round to the last.
    expect(press("ArrowLeft")).toBe("javascript");
  });
});
