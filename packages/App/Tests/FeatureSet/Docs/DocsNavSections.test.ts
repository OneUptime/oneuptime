import DocsNav, {
  DocsNavSections,
  LocalizedNavGroup,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import DocsNavIcons, {
  DOCS_DEFAULT_ICON,
  getDocsNavIcon,
} from "../../../FeatureSet/Docs/Utils/NavIcons";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * The sidebar lists the docs in sections - Get Started, Monitoring, Incident
 * Response, Observability, Automation & AI, Integrations, Developers,
 * Administration, Self-Hosting - each a run of groups. These hold the tree to
 * that shape, hold every label in it to a translation in every language, and
 * check the sidebar draws it.
 */

const DOCS_DIR: string = path.resolve(__dirname, "../../../FeatureSet/Docs");

type Locale = {
  navSections: Record<string, string>;
  navGroups: Record<string, string>;
  navLinks: Record<string, string>;
};

const localeOf: (lang: string) => Locale = (lang: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(DOCS_DIR, "Locales", `${lang}.json`), "utf8"),
  ) as Locale;
};

const ALL_LINKS: Array<NavLink> = DocsNav.flatMap(
  (group: NavGroup): Array<NavLink> => {
    return group.links;
  },
);

const renderNav: (lang: string) => Promise<string> = (
  lang: string,
): Promise<string> => {
  return ejs.renderFile(path.join(DOCS_DIR, "Views/Partials/Nav.ejs"), {
    nav: getLocalizedNav(lang),
    category: null,
    link: null,
    t: makeT(lang),
    lang: lang,
  });
};

describe("the docs tree", () => {
  it("puts every group in one of the sections, and every section has groups", () => {
    for (const group of DocsNav) {
      expect({
        group: group.title,
        known: DocsNavSections.includes(group.section),
      }).toEqual({ group: group.title, known: true });
    }

    for (const section of DocsNavSections) {
      expect({
        section,
        groups: DocsNav.some((group: NavGroup): boolean => {
          return group.section === section;
        }),
      }).toEqual({ section, groups: true });
    }
  });

  it("keeps each section's groups together, sections in their listed order", () => {
    const runs: Array<string> = [];

    for (const group of DocsNav) {
      if (runs[runs.length - 1] !== group.section) {
        runs.push(group.section);
      }
    }

    expect(runs).toEqual(DocsNavSections);
  });

  it("gives every group a title of its own and an icon of its own", () => {
    const titles: Array<string> = DocsNav.map((group: NavGroup): string => {
      return group.title;
    });

    expect(new Set(titles).size).toBe(titles.length);

    for (const title of titles) {
      expect({ title, icon: getDocsNavIcon(title) }).not.toEqual({
        title,
        icon: DOCS_DEFAULT_ICON,
      });
    }

    const icons: Array<string> = titles.map((title: string): string => {
      return getDocsNavIcon(title);
    });
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("has no icon left over for a group that no longer exists", () => {
    const titles: Set<string> = new Set(
      DocsNav.map((group: NavGroup): string => {
        return group.title;
      }),
    );

    /*
     * Icons for groups that pages are still being written for may be
     * waiting; anything else is a leftover.
     */
    const waiting: Array<string> = ["Alerts", "Scheduled Maintenance"];

    for (const key of Object.keys(DocsNavIcons)) {
      expect({ key, used: titles.has(key) || waiting.includes(key) }).toEqual({
        key,
        used: true,
      });
    }
  });

  it("lists every page once", () => {
    const urls: Array<string> = ALL_LINKS.map((link: NavLink): string => {
      return link.url.toLowerCase();
    });

    expect(new Set(urls).size).toBe(urls.length);
  });

  it("links pages as /docs/<category>/<page>, in lower case, with no language", () => {
    for (const link of ALL_LINKS) {
      if (link.url.startsWith("http")) {
        expect(link.url).toMatch(/^https:\/\//);
        continue;
      }

      expect(link.url).toMatch(/^\/docs\/[a-z0-9-]+\/[a-z0-9-]+$/);
      expect(SUPPORTED_DOCS_LANGUAGE_CODES).not.toContain(
        link.url.split("/")[2],
      );
    }
  });
});

describe("every label in the tree", () => {
  const english: Locale = localeOf("en");

  it("has its English text in en.json, so no language shows a bare key", () => {
    for (const section of DocsNavSections) {
      expect({ section, text: english.navSections[section] }).toEqual({
        section,
        text: section,
      });
    }

    for (const group of DocsNav) {
      expect({
        group: group.title,
        text: english.navGroups[group.title],
      }).toEqual({ group: group.title, text: group.title });
    }

    for (const link of ALL_LINKS) {
      expect({ link: link.title, text: english.navLinks[link.title] }).toEqual({
        link: link.title,
        text: link.title,
      });
    }
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "is translated in %s",
    (lang: string) => {
      const locale: Locale = localeOf(lang);
      const missing: Array<string> = [
        ...DocsNavSections.filter((section: string): boolean => {
          return !locale.navSections?.[section]?.trim();
        }).map((section: string): string => {
          return `section: ${section}`;
        }),
        ...DocsNav.filter((group: NavGroup): boolean => {
          return !locale.navGroups?.[group.title]?.trim();
        }).map((group: NavGroup): string => {
          return `group: ${group.title}`;
        }),
        ...ALL_LINKS.filter((link: NavLink): boolean => {
          return !locale.navLinks?.[link.title]?.trim();
        }).map((link: NavLink): string => {
          return `link: ${link.title}`;
        }),
      ];

      expect(missing).toEqual([]);
    },
  );
});

describe("the sidebar", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "draws the sections in order in %s, each labelling its groups",
    async (lang: string) => {
      const html: string = await renderNav(lang);
      const t: ReturnType<typeof makeT> = makeT(lang);
      const headings: Array<{ id: string; title: string }> = Array.from(
        html.matchAll(
          /<p class="docs-nav__section-title" id="([^"]+)">([^<]*)<\/p>/g,
        ),
        (match: RegExpMatchArray): { id: string; title: string } => {
          return { id: match[1]!, title: match[2]!.trim() };
        },
      );

      expect(
        headings.map((heading: { title: string }): string => {
          return heading.title;
        }),
      ).toEqual(
        DocsNavSections.map((section: string): string => {
          return t(`navSections.${section}`);
        }),
      );

      for (const heading of headings) {
        expect(html).toContain(`aria-labelledby="${heading.id}"`);
      }

      expect(html.match(/data-nav-toggle/g)).toHaveLength(DocsNav.length);
    },
  );

  it("lists a group with no section without a heading", async () => {
    const group: LocalizedNavGroup = {
      key: "Loose",
      title: "Loose",
      links: [],
    };
    const html: string = await ejs.renderFile(
      path.join(DOCS_DIR, "Views/Partials/Nav.ejs"),
      {
        nav: [group],
        category: null,
        link: null,
        t: makeT("en"),
        lang: "en",
      },
    );

    expect(html).not.toContain("docs-nav__section-title");
    expect(html).toContain("data-nav-toggle");
  });

  it("gives desktop and drawer copies ids of their own", async () => {
    const template: string = path.join(DOCS_DIR, "Views/Partials/Nav.ejs");
    const options: Record<string, unknown> = {
      nav: getLocalizedNav("en"),
      category: null,
      link: null,
      t: makeT("en"),
      lang: "en",
    };
    const sidebar: string = await ejs.renderFile(template, {
      ...options,
      navIdPrefix: "sidebar",
    });
    const drawer: string = await ejs.renderFile(template, {
      ...options,
      navIdPrefix: "drawer",
    });
    const idsOf: (html: string) => Array<string> = (
      html: string,
    ): Array<string> => {
      return Array.from(
        html.matchAll(/\bid="([^"]+)"/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );
    };

    const sidebarIds: Array<string> = idsOf(sidebar);
    const drawerIds: Array<string> = idsOf(drawer);

    expect(new Set(sidebarIds).size).toBe(sidebarIds.length);
    expect(
      sidebarIds.filter((id: string): boolean => {
        return drawerIds.includes(id);
      }),
    ).toEqual([]);
  });
});
