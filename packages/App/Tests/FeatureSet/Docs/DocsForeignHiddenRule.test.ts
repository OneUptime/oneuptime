import { LocalizedNavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  getLocalizedNav,
  makeT,
  SUPPORTED_DOCS_LANGUAGES,
  TranslateFn,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ElementScriptWrites,
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
  maxWidthHiddenTokensInViews,
  mediaClassRules,
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
import {
  TAILWIND_BREAKPOINTS_IN_PX,
  resolveDisplay,
} from "Common/Tests/ResponsiveVisibility";
import { beforeAll, describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * The Docs pages under a foreign `.hidden { display: none !important }`.
 *
 * A customer's dashboard lost its navigation bar to that rule: Bootstrap 3
 * and HTML5 Boilerplate define it, and browser extensions and user
 * stylesheets inject it into every page they touch. It matches the bare
 * `hidden` class and outranks every responsive utility, so markup written
 * `hidden lg:block` stays hidden at every width. The Docs pages load the same
 * Tailwind Play CDN and were written the same way: the desktop sidebar (the
 * only navigation on a desktop, since the drawer and its menu bar are
 * lg:hidden), the search pill, the language switcher and the on-this-page
 * panel all disappeared from a desktop screen.
 *
 * They are now written `max-<bp>:hidden <bp>:<display>`: the same paint on a
 * clean page, without the class the rule targets. These tests render the real
 * views and resolve each element's class attribute - and every ancestor's,
 * since an element is only on screen if nothing around it is hidden either -
 * the way the cascade would, through the page reader in
 * Common/Tests/RenderedMarkup.ts that the API Reference and website suites
 * share. Each group ends with a control that puts the old class strings back
 * and shows the same assertion failing.
 *
 * style.css is the Docs' hand-maintained precompiled stylesheet, the only
 * utility CSS on the page until the Play CDN has generated its own, so it
 * carries the max-width hides too; the last group keeps it in step with the
 * views.
 */

const DOCS_ROOT: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const VIEWS_ROOT: string = path.join(DOCS_ROOT, "Views");
const STYLESHEET_PATH: string = path.join(
  DOCS_ROOT,
  "Static",
  "css",
  "style.css",
);
const STYLESHEET_URL: string = "/docs/static/css/style.css";

const lang: string = "en";
const t: TranslateFn = makeT(lang);

type RenderFunction = (
  template: string,
  locals: Record<string, unknown>,
) => Promise<RenderedPage>;

const renderView: RenderFunction = async (
  template: string,
  locals: Record<string, unknown>,
): Promise<RenderedPage> => {
  const html: string = await ejs.renderFile(path.join(VIEWS_ROOT, template), {
    t: t,
    lang: lang,
    supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
    enableGoogleTagManager: false,
    ...locals,
  });
  return parsePage(html);
};

interface DocsTarget {
  // How a failure names it.
  name: string;
  // The screen it is meant to appear from.
  breakpoint: string;
  find: (page: RenderedPage) => RenderedElement;
}

const DESKTOP_SIDEBAR: DocsTarget = {
  name: "the desktop sidebar",
  breakpoint: "lg",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return classOf(element).split(/\s+/).includes("docs-layout-sidebar");
    });
  },
};

// A link inside it: what the reader actually loses when the sidebar goes.
const SIDEBAR_LINK: DocsTarget = {
  name: "a link in the desktop sidebar",
  breakpoint: "lg",
  find: (page: RenderedPage): RenderedElement => {
    const links: Array<RenderedElement> = page.elements.filter(
      (element: RenderedElement): boolean => {
        return (
          element.tagName === "a" &&
          hasAncestor(element, (ancestor: RenderedElement): boolean => {
            return attributeOf(ancestor, "id") === "docs-sidebar-scroll";
          })
        );
      },
    );
    expect(links.length).toBeGreaterThan(0);
    return links[0]!;
  },
};

const SEARCH_PILL: DocsTarget = {
  name: "the header search pill",
  breakpoint: "sm",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return (
        attributeOf(element, "data-search-open") !== null &&
        textOf(page, element).includes(t("ui.searchDocs")) &&
        hasAncestor(element, (ancestor: RenderedElement): boolean => {
          return attributeOf(ancestor, "id") === "docs-header";
        })
      );
    });
  },
};

// The drawer carries a copy, but the drawer is lg:hidden.
const LANGUAGE_SWITCHER: DocsTarget = {
  name: "the header language switcher",
  breakpoint: "sm",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "id") === "docs-language-switcher-header";
    });
  },
};

const ON_THIS_PAGE_PANEL: DocsTarget = {
  name: "the on-this-page panel",
  breakpoint: "xl",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "id") === "toc-list";
    });
  },
};

// The button that opens the drawer: the phone and tablet navigation.
const MOBILE_MENU_BUTTON: DocsTarget = {
  name: "the mobile menu bar",
  breakpoint: "lg",
  find: (page: RenderedPage): RenderedElement => {
    return only(page, (element: RenderedElement): boolean => {
      return attributeOf(element, "data-mobile-menu-open") !== null;
    });
  },
};

interface DocsPageFixture {
  name: string;
  render: () => Promise<RenderedPage>;
  desktopTargets: Array<DocsTarget>;
}

const nav: Array<LocalizedNavGroup> = getLocalizedNav(lang);

const PAGES: Array<DocsPageFixture> = [
  {
    name: "Index.ejs",
    render: async (): Promise<RenderedPage> => {
      const category: LocalizedNavGroup = nav.find(
        (group: LocalizedNavGroup): boolean => {
          return group.key === "Telemetry";
        },
      )!;

      return renderView("Index.ejs", {
        nav: nav,
        category: category,
        link: category.links[0],
        content: "<h2 id='one'>One</h2><h2 id='two'>Two</h2>",
        githubPath: "telemetry/index",
        currentPath: category.links[0]!.url,
        prevLink: null,
        nextLink: null,
      });
    },
    desktopTargets: [
      DESKTOP_SIDEBAR,
      SIDEBAR_LINK,
      SEARCH_PILL,
      LANGUAGE_SWITCHER,
      ON_THIS_PAGE_PANEL,
    ],
  },
  {
    name: "NotFound.ejs",
    render: async (): Promise<RenderedPage> => {
      return renderView("NotFound.ejs", {
        nav: nav,
        link: null,
        currentPath: "/docs/en/no/such-page",
      });
    },
    desktopTargets: [
      DESKTOP_SIDEBAR,
      SIDEBAR_LINK,
      SEARCH_PILL,
      LANGUAGE_SWITCHER,
    ],
  },
  {
    name: "ServerError.ejs",
    render: async (): Promise<RenderedPage> => {
      return renderView("ServerError.ejs", {
        nav: nav,
        link: null,
        currentPath: "/docs/en/telemetry/index",
      });
    },
    desktopTargets: [
      DESKTOP_SIDEBAR,
      SIDEBAR_LINK,
      SEARCH_PILL,
      LANGUAGE_SWITCHER,
    ],
  },
];

describe.each(PAGES)("$name", (fixture: DocsPageFixture) => {
  let page: RenderedPage;

  beforeAll(async () => {
    page = await fixture.render();
  });

  describe("under a foreign .hidden rule", () => {
    it.each(fixture.desktopTargets)(
      "keeps $name on screen from $breakpoint up",
      (target: DocsTarget) => {
        const element: RenderedElement = target.find(page);

        for (const width of widthsFrom(target.breakpoint)) {
          expect(
            describePainting(element, width, WITH_FOREIGN_HIDDEN_RULE),
          ).toBe(visibleWithRule(width));
        }
      },
    );

    it.each(fixture.desktopTargets)(
      "still hides $name below $breakpoint",
      (target: DocsTarget) => {
        const element: RenderedElement = target.find(page);

        for (const width of widthsBelow(target.breakpoint)) {
          expect(describePainting(element, width)).toMatch(/^hidden at /);
          expect(
            describePainting(element, width, WITH_FOREIGN_HIDDEN_RULE),
          ).toMatch(/^hidden at /);
        }
      },
    );

    it("keeps the mobile menu bar on phones and tablets only", () => {
      /*
       * The other half of the layout: below lg the drawer's menu bar is the
       * navigation. It never carried the bare class, so the rule leaves it
       * alone - and it must not start showing on a desktop either.
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
  });

  describe("control: the pre-fix class strings", () => {
    it.each(fixture.desktopTargets)(
      "lost $name on a desktop under the rule, though a clean page showed it",
      (target: DocsTarget) => {
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

    it("leaned on a bare hidden, which the page sweep would have caught", () => {
      const offenders: Array<string> = page.elements
        .map((element: RenderedElement): string => {
          return toPreFixClassAttribute(classOf(element));
        })
        .filter(leansOnBareHidden);

      expect(offenders.length).toBeGreaterThan(0);
    });
  });
});

describe("the on-this-page panel on Index.ejs", () => {
  const PANEL_ID: string = "toc-panel";

  let page: RenderedPage;

  beforeAll(async () => {
    page = await PAGES[0]!.render();
  });

  it("is put on screen by nothing but its class", () => {
    /*
     * Scripts.ejs fills the list from the article's headings and, when there
     * are fewer than two, hides the panel with an inline style. It never
     * shows it, so from xl up the class attribute alone keeps the panel on
     * screen - which is why that class must not carry the bare `hidden`, and
     * why no script may toggle one on it: `max-xl:hidden` does the hiding
     * now, so removing `hidden` would do nothing and adding it would hand
     * the panel back to the foreign rule.
     */
    const panel: RenderedElement = only(
      page,
      (element: RenderedElement): boolean => {
        return attributeOf(element, "id") === PANEL_ID;
      },
    );
    const writes: ElementScriptWrites = scriptWritesToElement(
      page.html,
      PANEL_ID,
    );

    expect(attributeOf(panel, "hidden")).toBeNull();
    expect(attributeOf(panel, "style")).toBeNull();
    // The script does look the panel up, so the check below reads real code.
    expect(writes.variables).not.toEqual([]);
    expect(writes.bareHiddenWrites).toEqual([]);
  });

  it("control: a script that toggles `hidden` on the panel is caught, and nothing else is", () => {
    const withScript: (code: string) => string = (code: string): string => {
      return `${page.html}<script>${code}</script>`;
    };

    // Unrelated reads and classes on the panel, and `hidden` on something else.
    expect(
      scriptWritesToElement(
        withScript(
          "tocPanel.querySelector('a'); tocPanel.classList.add('foo'); tocList.classList.add('hidden');",
        ),
        PANEL_ID,
      ).bareHiddenWrites,
    ).toEqual([]);

    expect(
      scriptWritesToElement(
        withScript("tocPanel.classList.remove('hidden');"),
        PANEL_ID,
      ).bareHiddenWrites,
    ).toEqual(["tocPanel.classList.remove('hidden')"]);
    expect(
      scriptWritesToElement(
        withScript("tocPanel.className = 'hidden xl:block';"),
        PANEL_ID,
      ).bareHiddenWrites,
    ).toEqual(["tocPanel.className = 'hidden xl:block'"]);
    expect(
      scriptWritesToElement(
        withScript(
          "document.getElementById('toc-panel').classList.toggle('hidden', true);",
        ),
        PANEL_ID,
      ).bareHiddenWrites,
    ).toEqual([
      "document.getElementById('toc-panel').classList.toggle('hidden', true)",
    ]);
  });
});

describe("style.css: the max-width hides before Tailwind has generated", () => {
  let rules: Map<string, MediaClassRule>;

  beforeAll(() => {
    rules = mediaClassRules(fs.readFileSync(STYLESHEET_PATH, "utf8"));
  });

  it.each(PAGES)(
    "is loaded in the head of $name",
    async (fixture: DocsPageFixture) => {
      const page: RenderedPage = await fixture.render();
      const stylesheet: RenderedElement = only(
        page,
        (element: RenderedElement): boolean => {
          return (
            element.tagName === "link" &&
            attributeOf(element, "href") === STYLESHEET_URL
          );
        },
      );

      expect(attributeOf(stylesheet, "rel")).toBe("stylesheet");
      expect(
        hasAncestor(stylesheet, (ancestor: RenderedElement): boolean => {
          return ancestor.tagName === "head";
        }),
      ).toBe(true);
    },
  );

  it.each(Object.entries(TAILWIND_BREAKPOINTS_IN_PX))(
    "hides max-%s:hidden below %ipx, exactly as Tailwind does",
    (breakpoint: string, breakpointInPx: number) => {
      /*
       * Without it a phone paints the desktop sidebar and search pill until
       * the Play CDN catches up: style.css has `lg:block`, and before the
       * fix it also had the `hidden` those elements no longer carry.
       */
      expect(rules.get(`max-${breakpoint}:hidden`)).toEqual({
        media: `not all and (min-width: ${breakpointInPx}px)`,
        declarations: "display: none;",
      });
    },
  );

  it("covers every max-width hide the views use", () => {
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
