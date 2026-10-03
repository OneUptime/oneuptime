import StatusPageBrandingCopy, {
  BrandingAdvancedValues,
  isBrandingAdvancedConfigured,
  isDefaultBarColorChosen,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageBrandingCopy";
import { Green, Red } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A status page's branding is one Branding page.
 *
 * It was five screens in the side menu's Branding section - Essential
 * Branding, Header, Footer, Overview Page and Languages - beside HTML, CSS &
 * JavaScript and Custom Domains, and an empty Navbar page no menu linked to.
 * What people looked for was rarely where the names said: the logo was on
 * Header, the favicon on Essential Branding, the chart's colors on Overview
 * Page. Now the section is three entries (Branding, Custom Domains, HTML,
 * CSS & JavaScript), the Branding page holds every card the five screens
 * held about how the page looks (folding the rarely changed ones under
 * Advanced), the overall uptime % and the downtime statuses - which are
 * about what the page shows - are on Advanced Settings, and the old URLs
 * forward to the Branding page.
 *
 * This holds the menu, the pages, the routes and the copy to that, so a
 * page written later cannot quietly bring a second branding screen back.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const VIEW_DIR: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "StatusPages",
  "View",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// The screens the Branding page replaced: their URL, and their file.
const OLD_SCREENS: Array<[string, string]> = [
  ["header-style", "HeaderStyle.tsx"],
  ["footer-style", "FooterStyle.tsx"],
  ["overview-page-branding", "OverviewPageBranding.tsx"],
  ["languages", "Languages.tsx"],
  ["navbar-style", "NavBarStyle.tsx"],
];

const OLD_PAGE_KEYS: Array<string> = [
  "STATUS_PAGE_VIEW_HEADER_STYLE",
  "STATUS_PAGE_VIEW_FOOTER_STYLE",
  "STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING",
  "STATUS_PAGE_VIEW_NAVBAR_STYLE",
  "STATUS_PAGE_VIEW_LANGUAGES",
];

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

function readView(file: string): string {
  return readSource(path.join(VIEW_DIR, file));
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "Locales") {
        continue;
      }

      found.push(...listSources(full));
      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

// The source between an opening marker and the first closing one after it.
function between(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);

  expect([start, from > -1]).toEqual([start, true]);

  const to: number = source.indexOf(end, from + start.length);

  expect([end, to > -1]).toEqual([end, true]);

  return source.slice(from, to);
}

const CARD_NAME: RegExp = /name="([^"]+)"/g;

describe("the side menu's Branding section", () => {
  const menu: string = readView("SideMenu.tsx");
  const section: string = between(
    menu,
    '<SideMenuSection title="Branding">',
    "</SideMenuSection>",
  );

  test("is three entries: Branding, Custom Domains, then HTML, CSS & JavaScript", () => {
    const titles: Array<string> = Array.from(
      section.matchAll(/title: "([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(titles).toEqual([
      "Branding",
      "Custom Domains",
      "HTML, CSS & JavaScript",
    ]);
  });

  test("each entry opens its own page", () => {
    const pages: Array<string> = Array.from(
      section.matchAll(/RouteMap\[\s*PageMap\.(\w+)\s*\]/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(pages).toEqual([
      "STATUS_PAGE_VIEW_BRANDING",
      "STATUS_PAGE_VIEW_DOMAINS",
      "STATUS_PAGE_VIEW_CUSTOM_HTML_CSS",
    ]);
    expect(section.match(/<SideMenuItem\b/g) || []).toHaveLength(3);
  });

  test("folds by its title, like every rarely used section, with no flag of its own", () => {
    expect(menu).toContain('<SideMenuSection title="Branding">');
    expect(section).not.toContain("defaultCollapsed");
  });

  test("names none of the screens it replaced, anywhere in the menu", () => {
    for (const gone of [
      '"Essential Branding"',
      'title: "Header"',
      'title: "Footer"',
      'title: "Overview Page"',
      'title: "Languages"',
    ]) {
      expect([gone, menu.includes(gone)]).toEqual([gone, false]);
    }
  });
});

describe("the screens the Branding page replaced", () => {
  test.each(OLD_SCREENS)(
    "…/%s: %s is gone",
    (_oldPath: string, file: string) => {
      expect(fs.existsSync(path.join(VIEW_DIR, file))).toBe(false);
    },
  );

  test("no Dashboard file imports one of them", () => {
    const importing: Array<string> = listSources(DASHBOARD_SRC)
      .filter((file: string): boolean => {
        const source: string = readSource(file);

        return OLD_SCREENS.some(([, page]: [string, string]): boolean => {
          return source.includes(`View/${page.replace(".tsx", "")}"`);
        });
      })
      .map(relative);

    expect(importing).toEqual([]);
  });

  test("have no page key, route or breadcrumb of their own", () => {
    for (const file of [
      "Utils/PageMap.ts",
      "Utils/RouteMap.ts",
      "Utils/Breadcrumbs/StatusPagesBreadcrumbs.ts",
    ]) {
      const source: string = readSource(path.join(DASHBOARD_SRC, file));

      for (const key of OLD_PAGE_KEYS) {
        expect([file, key, source.includes(key)]).toEqual([file, key, false]);
      }

      for (const [oldPath] of OLD_SCREENS) {
        expect([file, oldPath, source.includes(`/${oldPath}\``)]).toEqual([
          file,
          oldPath,
          false,
        ]);
      }
    }
  });

  test("the Branding page's breadcrumb is Branding", () => {
    const breadcrumbs: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Utils",
        "Breadcrumbs",
        "StatusPagesBreadcrumbs.ts",
      ),
    );

    expect(breadcrumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_BRANDING, [ "Project", "Status Pages", "View Status Page", "Branding", ])',
    );
    expect(breadcrumbs).not.toContain("Essential Branding");
  });

  test("every old URL forwards to the Branding page, and only the routes name them", () => {
    const routes: string = readSource(
      path.join(DASHBOARD_SRC, "Routes", "StatusPagesRoutes.tsx"),
    );

    expect(routes).toContain(
      'export const MOVED_STATUS_PAGE_BRANDING_PATHS: ReadonlyArray<string> = [ "header-style", "footer-style", "overview-page-branding", "languages", "navbar-style", ];',
    );
    expect(routes).toContain(
      "{MOVED_STATUS_PAGE_BRANDING_PATHS.map((path: string): ReactElement => { return ( <PageRoute key={path} path={path} element={ <MovedPageRedirect pageMap={PageMap.STATUS_PAGE_VIEW_BRANDING} /> } /> ); })}",
    );

    for (const [oldPath] of OLD_SCREENS) {
      const naming: Array<string> = listSources(DASHBOARD_SRC)
        .filter((file: string): boolean => {
          return readSource(file).includes(`"${oldPath}"`);
        })
        .map(relative);

      expect([oldPath, naming]).toEqual([
        oldPath,
        ["Routes/StatusPagesRoutes.tsx"],
      ]);
    }
  });
});

describe("the Branding page", () => {
  const branding: string = readView("Branding.tsx");
  const advancedStart: number = branding.indexOf("<AdvancedPageSection");
  const main: string = branding.slice(0, advancedStart);
  const advanced: string = branding.slice(advancedStart);

  function namesIn(source: string): Array<string> {
    return Array.from(source.matchAll(CARD_NAME)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );
  }

  test("is every card the five screens held about how the page looks, with the analytics names they had", () => {
    expect(namesIn(main)).toEqual([
      "Status Page > Branding > Header Style",
      "Status Page > Branding > Title and Description",
      "Status Page > Branding > Favicon",
      "Status Page > Header Links",
      "Status Page > Branding > Overview Page",
      "Status Page > Branding > Copyright",
      "Status Page > Footer Links",
    ]);
  });

  test("folds the history chart's colors, the languages and search engine indexing under Advanced, last", () => {
    expect(advancedStart).toBeGreaterThan(-1);
    expect(namesIn(advanced)).toEqual([
      "Status Page > Branding > Default Bar Color",
      "Status Page > Branding > History Chart Bar Color Rules",
      "Status Page > Languages",
    ]);
    expect(advanced).toContain("<SearchEngineIndexingCard");
    expect(advanced.indexOf("<SearchEngineIndexingCard")).toBeGreaterThan(
      advanced.indexOf('name="Status Page > Languages"'),
    );
    expect(advanced).toContain(
      "description={StatusPageBrandingCopy.advancedDescription}",
    );
    expect(advanced).toContain(
      "isConfigured={isBrandingAdvancedConfigured(advancedValues)}",
    );
  });

  test("the languages are one card: the default and the enabled ones in one dialog", () => {
    const languages: string = between(
      branding,
      'name="Status Page > Languages"',
      "</AdvancedPageSection>",
    );

    expect(languages).toContain("defaultLanguage: true");
    expect(languages).toContain("enabledLanguages: true");
    expect(branding).not.toContain(
      "Status Page > Languages > Default Language",
    );
    expect(branding).not.toContain(
      "Status Page > Languages > Enabled Languages",
    );
  });

  test("search engine indexing is a switch, not a card with an Edit dialog holding one toggle", () => {
    expect(branding).not.toContain("FormFieldSchemaType.Toggle");
    expect(branding).not.toContain(
      "Status Page > Branding > Search Engine Indexing",
    );

    const card: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "StatusPage",
        "SearchEngineIndexingCard.tsx",
      ),
    );

    expect(card).toContain("<StatusPageSwitchRow");
    expect(card).toContain('column="enableSearchEngineIndexing"');

    const switchRow: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "StatusPage",
        "StatusPageSwitchRow.tsx",
      ),
    );

    expect(switchRow).toContain(
      "export type StatusPageSwitchColumn = | SubscriptionSwitchColumn | DisplaySwitchColumn | BrandingSwitchColumn;",
    );
  });

  test("no two of its detail cards share a DOM id", () => {
    const ids: Array<string> = Array.from(
      branding.matchAll(/modelType: StatusPage, id: "([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /*
   * Where on Advanced Settings is that page's business: as cards of their
   * own, or as rows of its "What your status page shows" card.
   */
  test("holds nothing about what the page shows: the uptime % and the downtime statuses are on Advanced Settings", () => {
    const advancedSettings: string = [
      readView("StatusPageSettings.tsx"),
      readSource(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "StatusPage",
          "StatusPageDisplaySettingsCopy.ts",
        ),
      ),
    ].join(" ");

    for (const column of [
      "showOverallUptimePercentOnStatusPage",
      "overallUptimePercentPrecision",
      "downtimeMonitorStatuses",
    ]) {
      expect([column, branding.includes(column)]).toEqual([column, false]);
      expect([column, advancedSettings.includes(column)]).toEqual([
        column,
        true,
      ]);
    }
  });
});

describe("one place for each branding setting", () => {
  /*
   * Within the status page's own pages and components, each branding column
   * is named only where it is set: on the Branding page (search engine
   * indexing in its switch card, and the folded section's "Configured" rule
   * in the copy).
   */
  const OWNERS: Record<string, Array<string>> = {
    logoFile: ["Pages/StatusPages/View/Branding.tsx"],
    logoAltText: ["Pages/StatusPages/View/Branding.tsx"],
    coverImageFile: ["Pages/StatusPages/View/Branding.tsx"],
    coverImageAltText: ["Pages/StatusPages/View/Branding.tsx"],
    pageTitle: ["Pages/StatusPages/View/Branding.tsx"],
    pageDescription: ["Pages/StatusPages/View/Branding.tsx"],
    faviconFile: ["Pages/StatusPages/View/Branding.tsx"],
    overviewPageDescription: ["Pages/StatusPages/View/Branding.tsx"],
    copyrightText: ["Pages/StatusPages/View/Branding.tsx"],
    defaultBarColor: [
      "Components/StatusPage/StatusPageBrandingCopy.ts",
      "Pages/StatusPages/View/Branding.tsx",
    ],
    defaultLanguage: [
      "Components/StatusPage/StatusPageBrandingCopy.ts",
      "Pages/StatusPages/View/Branding.tsx",
    ],
    enabledLanguages: [
      "Components/StatusPage/StatusPageBrandingCopy.ts",
      "Pages/StatusPages/View/Branding.tsx",
    ],
    enableSearchEngineIndexing: [
      "Components/StatusPage/SearchEngineIndexingCard.tsx",
      "Components/StatusPage/StatusPageBrandingCopy.ts",
      "Pages/StatusPages/View/Branding.tsx",
    ],
  };

  const statusPageSources: Array<string> = [
    ...listSources(path.join(DASHBOARD_SRC, "Pages", "StatusPages")),
    ...listSources(path.join(DASHBOARD_SRC, "Components", "StatusPage")),
  ];

  test.each(Object.keys(OWNERS))(
    "%s is named only where it is set",
    (column: string) => {
      const pattern: RegExp = new RegExp(`\\b${column}\\b`);

      const naming: Array<string> = statusPageSources
        .filter((file: string): boolean => {
          return pattern.test(readSource(file));
        })
        .map(relative)
        .sort();

      expect(naming).toEqual(OWNERS[column]);
    },
  );
});

describe("Configured, on the Branding page's folded Advanced section", () => {
  test("a new status page's values are not configured", () => {
    const fresh: BrandingAdvancedValues = {
      defaultBarColor: Green,
      barColorRuleCount: 0,
      defaultLanguage: "en",
      enabledLanguages: [],
      enableSearchEngineIndexing: true,
    };

    expect(isBrandingAdvancedConfigured(fresh)).toBe(false);
    expect(isBrandingAdvancedConfigured({})).toBe(false);
    expect(
      isBrandingAdvancedConfigured({
        defaultBarColor: null,
        defaultLanguage: null,
        enabledLanguages: null,
        enableSearchEngineIndexing: null,
      }),
    ).toBe(false);
  });

  test.each([
    ["a chosen default bar color", { defaultBarColor: Red }],
    ["a bar color typed by hand", { defaultBarColor: "#123456" }],
    ["a bar color rule", { barColorRuleCount: 1 }],
    ["many bar color rules", { barColorRuleCount: 12 }],
    ["German first", { defaultLanguage: "de" }],
    ["a shorter list of languages", { enabledLanguages: ["en", "fr"] }],
    ["one language", { enabledLanguages: ["en"] }],
    ["search engines kept away", { enableSearchEngineIndexing: false }],
  ] as Array<[string, BrandingAdvancedValues]>)(
    "%s is configured",
    (_what: string, values: BrandingAdvancedValues) => {
      expect(isBrandingAdvancedConfigured(values)).toBe(true);
      // Whatever the rest says.
      expect(
        isBrandingAdvancedConfigured({
          defaultBarColor: Green,
          barColorRuleCount: 0,
          defaultLanguage: "en",
          enabledLanguages: [],
          enableSearchEngineIndexing: true,
          ...values,
        }),
      ).toBe(true);
    },
  );

  test("green, the color every page is created with, is not a choice, however it is written", () => {
    expect(isDefaultBarColorChosen(Green)).toBe(false);
    expect(isDefaultBarColorChosen(new Color(Green.toString()))).toBe(false);
    expect(isDefaultBarColorChosen(Green.toString().toUpperCase())).toBe(false);
    expect(isDefaultBarColorChosen(` ${Green.toString()} `)).toBe(false);
    expect(isDefaultBarColorChosen(undefined)).toBe(false);
    expect(isDefaultBarColorChosen(null)).toBe(false);
    expect(isDefaultBarColorChosen("")).toBe(false);
    expect(isDefaultBarColorChosen(Red)).toBe(true);
    expect(isDefaultBarColorChosen("#000000")).toBe(true);
  });
});

describe("translations", () => {
  // Sentences and names this change wrote, or put on a page of their own.
  const strings: Array<string> = [
    StatusPageBrandingCopy.advancedDescription,
    StatusPageBrandingCopy.overviewDescriptionDescription,
    StatusPageBrandingCopy.overviewDescriptionEditButton,
    StatusPageBrandingCopy.languagesDescription,
    StatusPageBrandingCopy.languagesEditButton,
    StatusPageBrandingCopy.searchEngineIndexingTitle,
    StatusPageBrandingCopy.searchEngineIndexingDescription,
    StatusPageBrandingCopy.searchEngineIndexingSwitchTitle,
    StatusPageBrandingCopy.searchEngineIndexingSwitchDescription,
  ];

  // Names every locale already had.
  const names: Array<string> = [
    StatusPageBrandingCopy.overviewDescriptionTitle,
    StatusPageBrandingCopy.languagesTitle,
    "Branding",
    "Custom Domains",
    "HTML, CSS & JavaScript",
  ];

  test("en.json maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of [...strings, ...names]) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test("the overview description's field is no longer titled with a full stop", () => {
    expect(readLocale("en")["Overview Page Description."]).toBeUndefined();
    expect(readView("Branding.tsx")).not.toContain(
      '"Overview Page Description."',
    );
  });

  test.each(OTHER_LOCALES)(
    "%s has its own words for every string, and every name",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of strings) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);
      }

      for (const text of names) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
      }
    },
  );
});
