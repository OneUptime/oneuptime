import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import {
  MediaClassRule,
  RenderedElement,
  RenderedPage,
  WIDTHS_IN_PX,
  WITH_FOREIGN_HIDDEN_RULE,
  attributeOf,
  classOf,
  convertedElementAround,
  describePainting,
  describeTag,
  hasAncestor,
  hasMaxWidthHide,
  leansOnBareHidden,
  listTemplates,
  maxWidthHiddenTokensInViews,
  mediaClassRules,
  only,
  parsePage,
  textOf,
  toPreFixClassAttribute,
  visibleOnCleanPage,
  visibleWithRule,
  widthsBelow,
  widthsFrom,
} from "../../Common/Tests/RenderedMarkup";
import {
  TAILWIND_BREAKPOINTS_IN_PX,
  resolveDisplay,
} from "../../Common/Tests/ResponsiveVisibility";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * The website under a foreign `.hidden { display: none !important }`.
 *
 * A customer's dashboard lost its navigation bar to that rule: Bootstrap 3
 * and HTML5 Boilerplate define it, and browser extensions and user
 * stylesheets inject it into every page they touch. It matches the bare
 * `hidden` class and outranks every responsive utility, so markup written
 * `hidden md:flex` stays hidden at every width. The website loads the same
 * Tailwind Play CDN and was written the same way: on a desktop the primary
 * nav (Products, Pricing, Resources ...) and the Sign in / Sign up block
 * disappeared, while the menu button that replaces them on a phone is
 * md:hidden by design. A visitor could not reach a product page or sign up.
 *
 * They are now written `max-<bp>:hidden <bp>:<display>`: the same paint on a
 * clean page, without the class the rule targets. These tests render the
 * real views and resolve each element's class attribute - and every
 * ancestor's, since an element is only on screen if nothing around it is
 * hidden either - the way the cascade would, through the page reader in
 * Common/Tests/RenderedMarkup.ts that the Docs and API Reference suites
 * share (imported by relative path, like the rest of Common here). Each group
 * ends with a control that puts the old class strings back and shows the same
 * assertion failing.
 *
 * Two checks stand on their own rather than on the shared guard in Common,
 * because Home's CI job runs only Home's tests: a sweep over every template's
 * class attributes, and the critical CSS in head-basic.ejs, the only utility
 * CSS a page has until the Play CDN has generated its own.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

type RenderFunction = (
  template: string,
  locals: Record<string, unknown>,
) => Promise<RenderedPage>;

const renderView: RenderFunction = async (
  template: string,
  locals: Record<string, unknown>,
): Promise<RenderedPage> => {
  const html: string = (await ejs.renderFile(
    path.join(VIEWS_ROOT, template),
    locals,
    { views: [VIEWS_ROOT] },
  )) as string;
  return parsePage(html);
};

function seoFor(pagePath: string): PageSEOData & { fullCanonicalUrl: string } {
  const seo: PageSEOData = getPageSEO(pagePath);
  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

interface HomeTarget {
  // How a failure names it.
  name: string;
  // The screen it is meant to appear from.
  breakpoint: string;
  find: (page: RenderedPage) => RenderedElement;
}

// The mobile menu carries its own copies; it is md:hidden and script-toggled.
function inMobileMenu(element: RenderedElement): boolean {
  return hasAncestor(element, (ancestor: RenderedElement): boolean => {
    return attributeOf(ancestor, "id") === "mobile-menu";
  });
}

function isPrimaryNav(element: RenderedElement): boolean {
  return (
    element.tagName === "nav" &&
    !inMobileMenu(element) &&
    hasAncestor(element, (ancestor: RenderedElement): boolean => {
      return (
        ancestor.tagName === "header" &&
        attributeOf(ancestor, "role") === "banner"
      );
    })
  );
}

function inPrimaryNav(element: RenderedElement): boolean {
  return hasAncestor(element, isPrimaryNav);
}

const PRIMARY_NAV: HomeTarget = {
  name: "the primary nav",
  breakpoint: "md",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, isPrimaryNav);
  },
};

// The way to every product page.
const PRODUCTS_BUTTON: HomeTarget = {
  name: "the Products button",
  breakpoint: "md",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        attributeOf(element, "onclick") === "openProductModal()" &&
        inPrimaryNav(element)
      );
    });
  },
};

const PRICING_LINK: HomeTarget = {
  name: "the Pricing link",
  breakpoint: "md",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        attributeOf(element, "href") === "/pricing" &&
        element.ancestors[0] !== undefined &&
        isPrimaryNav(element.ancestors[0])
      );
    });
  },
};

const SIGN_IN: HomeTarget = {
  name: "Sign in",
  breakpoint: "md",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        attributeOf(element, "href") === "/accounts" &&
        textOf(page, element) === "Sign in" &&
        !inMobileMenu(element)
      );
    });
  },
};

const SIGN_UP: HomeTarget = {
  name: "Sign up",
  breakpoint: "md",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "data-testid") === "Sign-up";
    });
  },
};

const DESKTOP_TARGETS: Array<HomeTarget> = [
  PRIMARY_NAV,
  PRODUCTS_BUTTON,
  PRICING_LINK,
  SIGN_IN,
  SIGN_UP,
];

const MOBILE_MENU_BUTTON: HomeTarget = {
  name: "the mobile menu button",
  breakpoint: "md",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "onclick") === "openMobileMenu()";
    });
  },
};

interface HomePageCase {
  name: string;
  render: () => Promise<RenderedPage>;
}

const PAGES: Array<HomePageCase> = [
  {
    name: "nav.ejs",
    render: (): Promise<RenderedPage> => {
      return renderView("nav.ejs", { homeUrl: HOME_URL });
    },
  },
  {
    // A whole page, so nothing the layout wraps around the nav hides it.
    name: "a product page (vmware.ejs)",
    render: (): Promise<RenderedPage> => {
      // Exactly the locals Routes.ts hands the template, plus homeUrl.
      return renderView("vmware.ejs", {
        enableGoogleTagManager: false,
        seo: seoFor("/product/vmware"),
        homeUrl: HOME_URL,
      });
    },
  },
];

describe.each(PAGES)("$name", (pageCase: HomePageCase) => {
  let page: RenderedPage;

  beforeAll(async () => {
    page = await pageCase.render();
  });

  describe("under a foreign .hidden rule", () => {
    test.each(DESKTOP_TARGETS)(
      "keeps $name on screen from $breakpoint up",
      (target: HomeTarget) => {
        const element: RenderedElement = target.find(page);

        for (const width of widthsFrom(target.breakpoint)) {
          expect(
            describePainting(element, width, WITH_FOREIGN_HIDDEN_RULE),
          ).toBe(visibleWithRule(width));
        }
      },
    );

    test.each(DESKTOP_TARGETS)(
      "still hides $name below $breakpoint",
      (target: HomeTarget) => {
        const element: RenderedElement = target.find(page);

        for (const width of widthsBelow(target.breakpoint)) {
          expect(describePainting(element, width)).toMatch(/^hidden at /);
          expect(
            describePainting(element, width, WITH_FOREIGN_HIDDEN_RULE),
          ).toMatch(/^hidden at /);
        }
      },
    );

    test("keeps the mobile menu button on phones only", () => {
      /*
       * The other half of the layout. It never carried the bare class, so
       * the rule leaves it alone - and it must not start showing on a
       * desktop either.
       */
      const button: RenderedElement = MOBILE_MENU_BUTTON.find(page);

      for (const width of widthsBelow(MOBILE_MENU_BUTTON.breakpoint)) {
        expect(describePainting(button, width, WITH_FOREIGN_HIDDEN_RULE)).toBe(
          visibleWithRule(width),
        );
      }

      for (const width of widthsFrom(MOBILE_MENU_BUTTON.breakpoint)) {
        expect(describePainting(button, width)).toMatch(/^hidden at /);
      }
    });

    test("leans on a bare hidden nowhere on the page", () => {
      const offenders: Array<string> = page.elements
        .filter((element: RenderedElement): boolean => {
          return leansOnBareHidden(classOf(element));
        })
        .map(describeTag);

      expect(offenders).toEqual([]);
    });
  });

  describe("control: the pre-fix class strings", () => {
    test.each(DESKTOP_TARGETS)(
      "lost $name on a desktop under the rule, though a clean page showed it",
      (target: HomeTarget) => {
        const element: RenderedElement = target.find(page);
        const converted: RenderedElement = convertedElementAround(element);

        for (const width of widthsFrom(target.breakpoint)) {
          expect(
            describePainting(element, width, {
              ...WITH_FOREIGN_HIDDEN_RULE,
              preFix: true,
            }),
          ).toBe(
            `hidden at ${width}px with a foreign .hidden rule on the page by <${converted.tagName} class="${toPreFixClassAttribute(classOf(converted))}">`,
          );
          expect(describePainting(element, width, { preFix: true })).toBe(
            visibleOnCleanPage(width),
          );
        }
      },
    );
  });
});

interface TemplateClassText {
  // Relative to Views/, with the line it starts on.
  location: string;
  text: string;
}

const EJS_TAG: RegExp = /<%[\s\S]*?%>/g;
const CLASS_ATTRIBUTE_START: RegExp = /(?<![\w:.-])class\s*=\s*(["'])/g;
const STRING_LITERAL: RegExp = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
// Class text handed on from EJS: include('icon', { iconClass: 'h-4 w-4' }).
const CLASS_NAMED_VALUE: RegExp =
  /\b\w*class\w*\s*[:=]\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gi;
// Stands in for an EJS tag, so a token glued to one is not read as a class.
const EJS_PLACEHOLDER: string = "\u0000";

/*
 * Every piece of class text a template can put in a class attribute, read
 * from the source so it covers every branch, not only the one a render
 * takes. An attribute's static text is one class string; each string literal
 * in an EJS tag inside the attribute can end up next to it, so each is read
 * together with that static text.
 */
function classTextInTemplate(
  file: string,
  source: string,
): Array<TemplateClassText> {
  const lineStarts: Array<number> = [0];

  for (let index: number = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  const locationOf: (index: number) => string = (index: number): string => {
    const line: number = lineStarts.filter((start: number): boolean => {
      return start <= index;
    }).length;
    return `${file}:${line}`;
  };

  const found: Array<TemplateClassText> = [];
  const attributeStart: RegExp = new RegExp(CLASS_ATTRIBUTE_START.source, "g");
  let match: RegExpExecArray | null = attributeStart.exec(source);

  for (; match !== null; match = attributeStart.exec(source)) {
    const quote: string = match[1]!;
    let index: number = attributeStart.lastIndex;
    let value: string = "";

    while (index < source.length && source[index] !== quote) {
      if (source.startsWith("<%", index)) {
        const tagEnd: number = source.indexOf("%>", index + 2);
        const stop: number = tagEnd === -1 ? source.length : tagEnd + 2;
        value += source.slice(index, stop);
        index = stop;
        continue;
      }

      value += source[index];
      index++;
    }

    attributeStart.lastIndex = index + 1;

    const staticText: string = value
      .replace(EJS_TAG, EJS_PLACEHOLDER)
      .split(/\s+/)
      .filter((token: string): boolean => {
        return Boolean(token) && !token.includes(EJS_PLACEHOLDER);
      })
      .join(" ");
    const location: string = locationOf(match.index);

    found.push({ location: location, text: staticText });

    for (const tag of value.match(EJS_TAG) || []) {
      for (const literal of tag.matchAll(STRING_LITERAL)) {
        found.push({ location: location, text: `${staticText} ${literal[2]}` });
      }
    }
  }

  for (const tag of source.matchAll(EJS_TAG)) {
    for (const value of tag[0].matchAll(CLASS_NAMED_VALUE)) {
      found.push({
        location: locationOf(tag.index! + value.index!),
        text: value[2]!,
      });
    }
  }

  return found;
}

describe("every template in Views/", () => {
  let classText: Array<TemplateClassText>;

  beforeAll(() => {
    classText = listTemplates(VIEWS_ROOT).flatMap(
      (template: string): Array<TemplateClassText> => {
        return classTextInTemplate(
          path.relative(VIEWS_ROOT, template).split(path.sep).join("/"),
          fs.readFileSync(template, "utf8"),
        );
      },
    );
  });

  test("leans on a bare hidden in no class attribute", () => {
    /*
     * Pages render only one branch of their conditionals and many templates
     * are never rendered by a test at all, so this reads every class
     * attribute in the source. A `hidden` that a breakpoint (or any variant)
     * display utility undoes vanishes at every width under the foreign rule:
     * write `max-md:hidden md:flex`, not `hidden md:flex`.
     */
    const offenders: Array<string> = classText
      .filter((piece: TemplateClassText): boolean => {
        return leansOnBareHidden(piece.text);
      })
      .map((piece: TemplateClassText): string => {
        return `${piece.location}: ${piece.text}`;
      });

    expect(offenders).toEqual([]);
  });

  test("control: flags the pre-fix spelling of the converted attributes", () => {
    const converted: Array<TemplateClassText> = classText.filter(
      (piece: TemplateClassText): boolean => {
        return hasMaxWidthHide(piece.text);
      },
    );
    const flagged: Array<string> = converted
      .filter((piece: TemplateClassText): boolean => {
        return leansOnBareHidden(toPreFixClassAttribute(piece.text));
      })
      .map((piece: TemplateClassText): string => {
        return piece.location;
      });

    // The website carried the old idiom in hundreds of places.
    expect(flagged.length).toBeGreaterThan(200);
    expect(flagged).toEqual(
      expect.arrayContaining([expect.stringMatching(/^nav\.ejs:\d+$/)]),
    );
  });

  test("paints every converted attribute exactly as before on a clean page", () => {
    /*
     * The rewrite is only safe if a visitor without the foreign rule sees
     * no difference at all: every `max-<bp>:hidden` string has to resolve
     * like the `hidden` string it replaced, at every width.
     */
    const converted: Array<TemplateClassText> = classText.filter(
      (piece: TemplateClassText): boolean => {
        return hasMaxWidthHide(piece.text);
      },
    );

    expect(converted.length).toBeGreaterThan(0);

    for (const piece of converted) {
      for (const width of WIDTHS_IN_PX) {
        expect({
          location: piece.location,
          width: width,
          display: resolveDisplay(piece.text, width),
        }).toEqual({
          location: piece.location,
          width: width,
          display: resolveDisplay(toPreFixClassAttribute(piece.text), width),
        });
      }
    }
  });
});

describe("head-basic.ejs: the max-width hides before Tailwind has generated", () => {
  let rules: Map<string, MediaClassRule>;

  beforeAll(() => {
    const template: string = fs.readFileSync(
      path.join(VIEWS_ROOT, "head-basic.ejs"),
      "utf8",
    );
    const tailwindAt: number = template.search(
      /<script\s+src="[^"]*\/tailwind[^"]*"/,
    );

    expect(tailwindAt).toBeGreaterThan(-1);

    // Only what is on the page before the Play CDN script counts.
    rules = mediaClassRules(
      Array.from(
        template
          .slice(0, tailwindAt)
          .matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g),
        (style: RegExpMatchArray): string => {
          return style[1]!;
        },
      ).join("\n"),
    );
  });

  test.each(Object.entries(TAILWIND_BREAKPOINTS_IN_PX))(
    "hides max-%s:hidden below %ipx, exactly as Tailwind does",
    (breakpoint: string, breakpointInPx: number) => {
      /*
       * The critical CSS has `md:flex` for the nav, and before the fix it
       * also had the `hidden` the nav no longer carries. Without this a
       * phone paints the desktop nav until the Play CDN catches up.
       */
      expect(rules.get(`max-${breakpoint}:hidden`)).toEqual({
        media: `not all and (min-width: ${breakpointInPx}px)`,
        declarations: "display: none;",
      });
    },
  );

  test("covers every max-width hide the views use", () => {
    /*
     * A later conversion that reaches for a new form - another breakpoint,
     * an arbitrary `max-[900px]:hidden`, a stacked variant - would flash its
     * desktop-only markup on phones at first paint until it gets a rule here.
     */
    const used: Array<string> = Array.from(
      maxWidthHiddenTokensInViews(VIEWS_ROOT),
    );

    expect(used.length).toBeGreaterThan(0);

    const uncovered: Array<string> = used.filter((token: string): boolean => {
      return !rules.has(token);
    });

    expect(uncovered).toEqual([]);
  });
});
