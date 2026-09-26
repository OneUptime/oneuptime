import {
  makeT,
  TranslateFn,
} from "../../../FeatureSet/APIReference/Utils/I18n";
import { PAGE_FIXTURES, PageFixture, renderPage } from "./ReferenceFixtures";
import {
  ElementScriptWrites,
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
  only,
  parsePage,
  scriptWritesToElement,
  textOf,
  toPreFixClassAttribute,
  visibleOnCleanPage,
  visibleWithRule,
  widthsBelow,
  widthsFrom,
} from "Common/Tests/RenderedMarkup";
import { resolveDisplay } from "Common/Tests/ResponsiveVisibility";
import { beforeAll, describe, expect, it } from "@jest/globals";

/*
 * The API Reference under a foreign `.hidden { display: none !important }`.
 *
 * A customer's dashboard lost its navigation bar to that rule: Bootstrap 3
 * and HTML5 Boilerplate define it, and browser extensions and user
 * stylesheets inject it into every page they touch. It matches the bare
 * `hidden` class and outranks every responsive utility, so markup written
 * `hidden lg:flex` stays hidden at every width. The reference loads the same
 * Tailwind Play CDN and was written the same way: on a desktop the rail -
 * every resource and endpoint link - the search pill, the site links, Sign
 * in, the language switcher, the table of contents and the pager's spacer
 * all went, while the drawer and its toggle that replace them on a phone are
 * lg:hidden by design. A reader was left with one page and no way off it.
 *
 * They are now written `max-<bp>:hidden <bp>:<display>`: the same paint on a
 * clean page, without the class the rule targets. These tests render the
 * real templates through ReferenceFixtures and resolve each element's class
 * attribute - and every ancestor's, since an element is only on screen if
 * nothing around it is hidden either - the way the cascade would, through the
 * page reader in Common/Tests/RenderedMarkup.ts that the Docs and website
 * suites share. Each group ends with a control that puts the old class
 * strings back and shows the same assertion failing.
 */

const t: TranslateFn = makeT("en");

interface ReferenceTarget {
  // How a failure names it.
  name: string;
  // The screen it is meant to appear from.
  breakpoint: string;
  find: (page: RenderedPage) => RenderedElement;
}

type AncestorPredicate = (ancestor: RenderedElement) => boolean;

const IN_TOP_BAR: AncestorPredicate = (ancestor: RenderedElement): boolean => {
  return ancestor.tagName === "header";
};

const DESKTOP_RAIL: ReferenceTarget = {
  name: "the desktop rail",
  breakpoint: "lg",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "id") === "reference-sidebar";
    });
  },
};

// What the reader actually loses with the rail: the way to every endpoint.
const RAIL_ENDPOINT_LINK: ReferenceTarget = {
  name: "an endpoint link in the rail",
  breakpoint: "lg",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        attributeOf(element, "data-nav-slug") === "incident" &&
        hasAncestor(element, (ancestor: RenderedElement): boolean => {
          return attributeOf(ancestor, "id") === "reference-sidebar";
        })
      );
    });
  },
};

const SEARCH_PILL: ReferenceTarget = {
  name: "the search pill",
  breakpoint: "md",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        attributeOf(element, "data-search-open") !== null &&
        textOf(page, element).includes(t("ui.searchPlaceholder")) &&
        hasAncestor(element, IN_TOP_BAR)
      );
    });
  },
};

const SITE_LINKS: ReferenceTarget = {
  name: "the site links",
  breakpoint: "xl",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        element.tagName === "a" &&
        attributeOf(element, "href") === "/support" &&
        hasAncestor(element, (ancestor: RenderedElement): boolean => {
          return attributeOf(ancestor, "aria-label") === t("ui.siteLinksAria");
        })
      );
    });
  },
};

// The drawer carries its own Sign in, but the drawer is lg:hidden.
const SIGN_IN: ReferenceTarget = {
  name: "Sign in",
  breakpoint: "sm",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        element.tagName === "a" &&
        attributeOf(element, "href") === "/dashboard" &&
        hasAncestor(element, IN_TOP_BAR)
      );
    });
  },
};

const LANGUAGE_SWITCHER: ReferenceTarget = {
  name: "the language switcher",
  breakpoint: "lg",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "id") === "reference-language-switcher";
    });
  },
};

/*
 * The `hidden` attribute it is rendered with is the script's to clear (see
 * the group below); this resolves the class that decides once it has.
 */
const TABLE_OF_CONTENTS: ReferenceTarget = {
  name: "the table of contents",
  breakpoint: "xl",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "id") === "reference-toc-list";
    });
  },
};

// Stands in for a missing previous page, holding the pager's left-hand cell.
const PAGER_SPACER: ReferenceTarget = {
  name: "the pager's spacer",
  breakpoint: "sm",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        element.tagName === "span" &&
        element.ancestors[0] !== undefined &&
        attributeOf(element.ancestors[0], "aria-label") === t("ui.pagerAria")
      );
    });
  },
};

const MOBILE_MENU_TOGGLE: ReferenceTarget = {
  name: "the mobile menu toggle",
  breakpoint: "lg",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "id") === "mobile-menu-toggle";
    });
  },
};

const SEARCH_ICON_BUTTON: ReferenceTarget = {
  name: "the icon-only search button",
  breakpoint: "md",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        attributeOf(element, "data-search-open") !== null &&
        attributeOf(element, "aria-label") === t("ui.searchAria")
      );
    });
  },
};

interface ReferencePageCase {
  name: string;
  fixture: PageFixture;
  desktopTargets: Array<ReferenceTarget>;
}

const PAGES: Array<ReferencePageCase> = [
  {
    name: "a resource page",
    fixture: PAGE_FIXTURES["model"]!,
    desktopTargets: [
      DESKTOP_RAIL,
      RAIL_ENDPOINT_LINK,
      SEARCH_PILL,
      SITE_LINKS,
      SIGN_IN,
      LANGUAGE_SWITCHER,
      TABLE_OF_CONTENTS,
    ],
  },
  {
    // The first page in reading order: no previous page, so the spacer.
    name: "the introduction",
    fixture: PAGE_FIXTURES["introduction"]!,
    desktopTargets: [DESKTOP_RAIL, SEARCH_PILL, SIGN_IN, PAGER_SPACER],
  },
];

const PHONE_ONLY_TARGETS: Array<ReferenceTarget> = [
  MOBILE_MENU_TOGGLE,
  SEARCH_ICON_BUTTON,
];

describe.each(PAGES)("$name", (pageCase: ReferencePageCase) => {
  let page: RenderedPage;

  beforeAll(async () => {
    page = parsePage(await renderPage(pageCase.fixture));
  });

  describe("under a foreign .hidden rule", () => {
    it.each(pageCase.desktopTargets)(
      "keeps $name on screen from $breakpoint up",
      (target: ReferenceTarget) => {
        const element: RenderedElement = target.find(page);

        for (const width of widthsFrom(target.breakpoint)) {
          expect(
            describePainting(element, width, WITH_FOREIGN_HIDDEN_RULE),
          ).toBe(visibleWithRule(width));
        }
      },
    );

    it.each(pageCase.desktopTargets)(
      "still hides $name below $breakpoint",
      (target: ReferenceTarget) => {
        const element: RenderedElement = target.find(page);

        for (const width of widthsBelow(target.breakpoint)) {
          expect(describePainting(element, width)).toMatch(/^hidden at /);
          expect(
            describePainting(element, width, WITH_FOREIGN_HIDDEN_RULE),
          ).toMatch(/^hidden at /);
        }
      },
    );

    it.each(PHONE_ONLY_TARGETS)(
      "keeps $name below $breakpoint only",
      (target: ReferenceTarget) => {
        /*
         * The other half of the layout. It never carried the bare class, so
         * the rule leaves it alone - and it must not start showing on a
         * desktop either.
         */
        const element: RenderedElement = target.find(page);

        for (const width of widthsBelow(target.breakpoint)) {
          expect(
            describePainting(element, width, WITH_FOREIGN_HIDDEN_RULE),
          ).toBe(visibleWithRule(width));
        }

        for (const width of widthsFrom(target.breakpoint)) {
          expect(describePainting(element, width)).toMatch(/^hidden at /);
        }
      },
    );
  });

  describe("control: the pre-fix class strings", () => {
    it.each(pageCase.desktopTargets)(
      "lost $name on a desktop under the rule, though a clean page showed it",
      (target: ReferenceTarget) => {
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

describe("the table of contents' hidden attribute", () => {
  const TABLE_OF_CONTENTS_ID: string = "reference-toc";

  let page: RenderedPage;
  let tableOfContents: RenderedElement;

  beforeAll(async () => {
    page = parsePage(await renderPage(PAGE_FIXTURES["model"]!));
    tableOfContents = only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "id") === TABLE_OF_CONTENTS_ID;
    });
  });

  it("is rendered, so the list stays off screen until the script has counted the headings", () => {
    expect(attributeOf(tableOfContents, "hidden")).toBe("");
  });

  it("is cleared by the script, which leaves the class to decide", () => {
    /*
     * The script flips the attribute and never toggles `hidden` in the class
     * list, so once it has run the class attribute alone keeps the list on
     * screen from xl up - which is why that class must not carry the bare
     * `hidden`. `max-xl:hidden` does the small-screen hiding now: a script
     * that removed `hidden` would do nothing, and one that added it would
     * hand the list back to the foreign rule.
     */
    const writes: ElementScriptWrites = scriptWritesToElement(
      page.html,
      TABLE_OF_CONTENTS_ID,
    );

    expect(page.html).toMatch(/container\.hidden\s*=\s*false/);
    // The script does look the element up, so the check below reads real code.
    expect(writes.variables).not.toEqual([]);
    expect(writes.bareHiddenWrites).toEqual([]);
  });

  it("control: a script that toggles `hidden` on it is caught, and nothing else is", () => {
    const withScript: (code: string) => string = (code: string): string => {
      return `${page.html}<script>${code}</script>`;
    };

    // Other classes on it, and `hidden` on the list inside it.
    expect(
      scriptWritesToElement(
        withScript(
          "container.classList.add('foo'); container.classList.toggle('is-open'); list.classList.add('hidden');",
        ),
        TABLE_OF_CONTENTS_ID,
      ).bareHiddenWrites,
    ).toEqual([]);

    expect(
      scriptWritesToElement(
        withScript("container.classList.remove('hidden');"),
        TABLE_OF_CONTENTS_ID,
      ).bareHiddenWrites,
    ).toEqual(["container.classList.remove('hidden')"]);
    expect(
      scriptWritesToElement(
        withScript("container.setAttribute('class', 'hidden xl:block');"),
        TABLE_OF_CONTENTS_ID,
      ).bareHiddenWrites,
    ).toEqual(["container.setAttribute('class', 'hidden xl:block')"]);
  });
});

describe.each(Object.entries(PAGE_FIXTURES))(
  "%s",
  (_name: string, fixture: PageFixture) => {
    let page: RenderedPage;

    beforeAll(async () => {
      page = parsePage(await renderPage(fixture));
    });

    it("leans on a bare hidden nowhere on the page", () => {
      const offenders: Array<string> = page.elements
        .filter((element: RenderedElement): boolean => {
          return leansOnBareHidden(classOf(element));
        })
        .map(describeTag);

      expect(offenders).toEqual([]);
    });

    it("paints every converted element exactly as before on a clean page", () => {
      /*
       * The rewrite is only safe if a reader without the foreign rule sees
       * no difference at all: every `max-<bp>:hidden` string has to resolve
       * like the `hidden` string it replaced, at every width.
       */
      const converted: Array<string> = page.elements
        .map(classOf)
        .filter(hasMaxWidthHide);

      expect(converted.length).toBeGreaterThan(0);

      for (const classAttribute of converted) {
        for (const width of WIDTHS_IN_PX) {
          expect({
            classAttribute: classAttribute,
            width: width,
            display: resolveDisplay(classAttribute, width),
          }).toEqual({
            classAttribute: classAttribute,
            width: width,
            display: resolveDisplay(
              toPreFixClassAttribute(classAttribute),
              width,
            ),
          });
        }
      }
    });

    it("control: leaned on a bare hidden before the fix, which that sweep catches", () => {
      const offenders: Array<string> = page.elements
        .map((element: RenderedElement): string => {
          return toPreFixClassAttribute(classOf(element));
        })
        .filter(leansOnBareHidden);

      expect(offenders.length).toBeGreaterThan(0);
    });
  },
);
