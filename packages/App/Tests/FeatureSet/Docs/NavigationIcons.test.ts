import DocsNav, {
  LocalizedNavGroup,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import {
  getLocalizedNav,
  localizeDocsUrl,
  makeT,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  SUPPORTED_DOCS_LANGUAGES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { beforeAll, describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import path from "path";

const VIEWS_ROOT: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Views",
);

interface RenderedGroup {
  title: string;
  icon: string;
  svg: string;
  button: string;
}

/*
 * Read the actual rendered buttons, rather than inspecting the template's
 * icon map. A complete map still renders the wrong icons if its lookup uses
 * the group's position or translated title.
 */
function renderedGroups(html: string): RenderedGroup[] {
  return Array.from(
    html.matchAll(/<button\b[^>]*\bdata-nav-toggle\b[^>]*>[\s\S]*?<\/button>/g),
    (match: RegExpMatchArray): RenderedGroup => {
      const button: string = match[0];
      const svg: RegExpMatchArray | null = button.match(
        /<svg\b[^>]*class="docs-nav__icon"[^>]*>([\s\S]*?)<\/svg>/,
      );
      const title: RegExpMatchArray | null = button.match(
        /<span\b[^>]*class="flex-1 truncate"[^>]*>([\s\S]*?)<\/span>/,
      );
      expect(svg).not.toBeNull();
      expect(title).not.toBeNull();
      return {
        title: title![1]!.trim(),
        icon: svg![1]!.trim(),
        svg: svg![0],
        button: button,
      };
    },
  );
}

async function renderNav(
  nav: LocalizedNavGroup[],
  lang: string = "en",
): Promise<string> {
  return ejs.renderFile(path.join(VIEWS_ROOT, "Partials/Nav.ejs"), {
    nav: nav,
    category: null,
    link: null,
    t: makeT(lang),
    lang: lang,
  });
}

const UNKNOWN_GROUP: LocalizedNavGroup = {
  key: "Future Documentation Category",
  title: "Future Documentation Category",
  links: [],
};

let englishNav: LocalizedNavGroup[];
let englishGroups: RenderedGroup[];
let iconsByKey: Map<string, string>;
let fallbackIcon: string;

beforeAll(async () => {
  englishNav = getLocalizedNav("en");
  englishGroups = renderedGroups(await renderNav(englishNav));
  expect(englishGroups).toHaveLength(DocsNav.length);
  iconsByKey = new Map(
    englishNav.map((group: LocalizedNavGroup, index: number) => {
      return [group.key, englishGroups[index]!.icon];
    }),
  );
  fallbackIcon = renderedGroups(await renderNav([UNKNOWN_GROUP]))[0]!.icon;
});

describe("canonical navigation identity", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "preserves each category's English key while localizing %s",
    (lang: string) => {
      const localized: LocalizedNavGroup[] = getLocalizedNav(lang);
      const t: ReturnType<typeof makeT> = makeT(lang);
      expect(
        localized.map((group: LocalizedNavGroup) => {
          return group.key;
        }),
      ).toEqual(
        DocsNav.map((group: NavGroup) => {
          return group.title;
        }),
      );
      localized.forEach((group: LocalizedNavGroup, index: number) => {
        const canonical: NavGroup = DocsNav[index]!;
        expect(group.title).toBe(t(`navGroups.${canonical.title}`));
        expect(group.links).toEqual(
          canonical.links.map((link: NavLink) => {
            return {
              title: t(`navLinks.${link.title}`),
              url: localizeDocsUrl(link.url, lang),
            };
          }),
        );
      });
    },
  );

  it("falls back to English without losing category identity", () => {
    expect(getLocalizedNav("unsupported-language")).toEqual(englishNav);
  });
});

describe("category icons", () => {
  it.each(
    DocsNav.map((group: NavGroup) => {
      return group.title;
    }),
  )("renders a dedicated icon for %s", (key: string) => {
    const icon: string | undefined = iconsByKey.get(key);
    expect(icon).toBeDefined();
    expect(icon).toMatch(
      /<(?:path|circle|rect|line|polyline|polygon|ellipse)\b/,
    );
    expect(icon).not.toBe(fallbackIcon);
  });

  it("gives every current category a distinct icon", () => {
    expect(
      new Set(
        englishGroups.map((group: RenderedGroup) => {
          return group.icon;
        }),
      ).size,
    ).toBe(DocsNav.length);
  });

  it.each([
    ["CLI", "M8 9l3 3-3 3m5 0h3"],
    ["Monitor", "M9 19v-6a2 2 0 00-2-2"],
    ["On Call", "M3 5a2 2 0 012-2h3.28"],
    ["Workspace Connections", "M13.828 10.172a4 4 0 00-5.656 0"],
    ["API Reference", "M10 20l4-16m4 4l4 4-4 4"],
    ["Self Hosted", "M5 12h14M5 12a2 2 0 01-2-2"],
  ])(
    "keeps the established icon associated with %s",
    (key: string, pathData: string) => {
      expect(iconsByKey.get(key)).toContain(pathData);
    },
  );

  it("keeps icons decorative and compatible with both themes", () => {
    for (const group of englishGroups) {
      expect(group.svg).toContain('aria-hidden="true"');
      expect(group.svg).toContain('viewBox="0 0 24 24"');
      expect(group.svg).toContain('fill="none"');
      expect(group.svg).toContain('stroke="currentColor"');
    }
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "renders the same category icons with %s labels",
    async (lang: string) => {
      const nav: LocalizedNavGroup[] = getLocalizedNav(lang);
      const groups: RenderedGroup[] = renderedGroups(
        await renderNav(nav, lang),
      );
      expect(groups).toHaveLength(nav.length);
      groups.forEach((group: RenderedGroup, index: number) => {
        expect(group.title).toBe(nav[index]!.title);
        expect(group.icon).toBe(iconsByKey.get(nav[index]!.key));
      });
    },
  );
});

describe("navigation changes", () => {
  it.each(["reversed", "filtered", "inserted category"])(
    "keeps category icons stable when navigation is %s",
    async (scenario: string) => {
      let nav: LocalizedNavGroup[] = [...englishNav];
      if (scenario === "reversed") {
        nav.reverse();
      } else if (scenario === "filtered") {
        nav = nav.filter((_group: LocalizedNavGroup, index: number) => {
          return index % 2 === 1;
        });
      } else {
        nav.splice(3, 0, UNKNOWN_GROUP);
      }
      const groups: RenderedGroup[] = renderedGroups(await renderNav(nav));
      expect(groups).toHaveLength(nav.length);
      groups.forEach((group: RenderedGroup, index: number) => {
        const category: LocalizedNavGroup = nav[index]!;
        expect(group.title).toBe(category.title);
        expect(group.icon).toBe(
          category.key === UNKNOWN_GROUP.key
            ? fallbackIcon
            : iconsByKey.get(category.key),
        );
      });
    },
  );

  it("uses the stable key even if translated category labels coincide", async () => {
    const nav: LocalizedNavGroup[] = englishNav.map(
      (group: LocalizedNavGroup) => {
        return { ...group, title: "Shared translated label" };
      },
    );
    const groups: RenderedGroup[] = renderedGroups(await renderNav(nav));
    expect(
      groups.map((group: RenderedGroup) => {
        return group.icon;
      }),
    ).toEqual(
      englishGroups.map((group: RenderedGroup) => {
        return group.icon;
      }),
    );
  });

  it("uses the document fallback for an unknown key with a known title", async () => {
    const groups: RenderedGroup[] = renderedGroups(
      await renderNav([{ ...UNKNOWN_GROUP, title: "Monitor" }]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.icon).toContain("M9 12h6m-6 4h6");
    expect(groups[0]!.icon).toBe(fallbackIcon);
    expect(groups[0]!.icon).not.toBe(iconsByKey.get("Monitor"));
  });

  it("renders an empty navigation without inventing a category", async () => {
    expect(renderedGroups(await renderNav([]))).toEqual([]);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "uses the fallback for the inherited object key %s",
    async (key: string) => {
      const groups: RenderedGroup[] = renderedGroups(
        await renderNav([{ ...UNKNOWN_GROUP, key: key }]),
      );
      expect(groups).toHaveLength(1);
      expect(groups[0]!.icon).toBe(fallbackIcon);
    },
  );
});

describe.each(["en", "de", "fa"])("full docs page in %s", (lang: string) => {
  let html: string;
  let nav: LocalizedNavGroup[];
  let activeCategory: LocalizedNavGroup;
  let navigationRegions: string[];

  beforeAll(async () => {
    nav = getLocalizedNav(lang);
    activeCategory = nav.find((group: LocalizedNavGroup) => {
      return group.key === "Telemetry";
    })!;
    html = await ejs.renderFile(path.join(VIEWS_ROOT, "Index.ejs"), {
      nav: nav,
      category: activeCategory,
      link: activeCategory.links[0],
      t: makeT(lang),
      lang: lang,
      supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
      content: "<p>Documentation page content.</p>",
      githubPath: "telemetry/index",
      currentPath: activeCategory.links[0]!.url,
      enableGoogleTagManager: false,
    });
    navigationRegions = Array.from(
      html.matchAll(/<nav\b[^>]*\bdata-docs-nav\b[^>]*>[\s\S]*?<\/nav>/g),
      (match: RegExpMatchArray): string => {
        return match[0];
      },
    );
  });

  it("renders matching dedicated icons in the mobile drawer and desktop sidebar", () => {
    expect(navigationRegions).toHaveLength(2);
    for (const region of navigationRegions) {
      const groups: RenderedGroup[] = renderedGroups(region);
      expect(groups).toHaveLength(nav.length);
      for (const [index, group] of groups.entries()) {
        expect(group.title).toBe(nav[index]!.title);
        expect(group.icon).toBe(iconsByKey.get(nav[index]!.key));
        expect(group.icon).not.toBe(fallbackIcon);
      }
    }
  });

  it("retains the active category and localized current-page link in both menus", () => {
    for (const region of navigationRegions) {
      const activeGroups: RenderedGroup[] = renderedGroups(region).filter(
        (group: RenderedGroup): boolean => {
          return group.button.includes('aria-expanded="true"');
        },
      );
      expect(activeGroups).toHaveLength(1);
      expect(activeGroups[0]!.title).toBe(activeCategory.title);
      expect(activeGroups[0]!.button).toContain("is-current");

      const activeLinks: RegExpMatchArray[] = Array.from(
        region.matchAll(/<a\b[^>]*aria-current="page"[^>]*>[\s\S]*?<\/a>/g),
      );
      expect(activeLinks).toHaveLength(1);
      expect(activeLinks[0]![0]).toContain("is-active");
      expect(activeLinks[0]![0]).toContain("data-nav-active");
      expect(activeLinks[0]![0]).toContain(
        `href="${activeCategory.links[0]!.url}"`,
      );
      expect(activeLinks[0]![0]).toContain(activeCategory.links[0]!.title);
    }
  });

  it("keeps each category toggle connected to a unique list", () => {
    const controls: string[] = renderedGroups(html).map(
      (group: RenderedGroup) => {
        return group.button.match(/aria-controls="([^"]+)"/)![1]!;
      },
    );
    expect(controls).toHaveLength(nav.length * 2);
    expect(new Set(controls).size).toBe(controls.length);
    expect(
      controls.some((id: string) => {
        return id.startsWith("drawer-group-");
      }),
    ).toBe(true);
    expect(
      controls.some((id: string) => {
        return id.startsWith("sidebar-group-");
      }),
    ).toBe(true);
    for (const id of controls) {
      expect(html.split(`id="${id}"`)).toHaveLength(2);
    }
  });
});
