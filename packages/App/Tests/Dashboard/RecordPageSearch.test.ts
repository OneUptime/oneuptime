import {
  getOpenRecord,
  getRecordKindNames,
  matchRecordPageQuery,
  OpenRecord,
  RECORD_PAGE_SEARCH_MAX_KINDS,
  RECORD_PAGE_SEARCH_MAX_PAGES,
  RecordPageQueryMatch,
  SearchToken,
  tokenizeSearchText,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/RecordPageSearch";
import {
  getRecordPageSearchKinds,
  RecordPageSearchKind,
  RecordPageSearchPage,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/RecordPageSearchIndex";
import {
  getRecordPageSearchModels,
  RECORD_KINDS_NOT_LOOKED_UP,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/RecordPageSearchModels";
import {
  getPageSearchAreas,
  PageSearchArea,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
} from "../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Search finds a record's own pages (#9204): "status page sso" offers each
 * status page's Single Sign-On, "acme subscribers" the Subscribers of the
 * records named Acme, and a page's old name finds it as its new one does.
 * These pin the list (RecordPageSearchIndex.ts) and the pure step that reads
 * a query for it (RecordPageSearch.ts). That the list matches the menus is
 * checked by drawing them, in Common's RecordPageSearchIndexCoversMenus.
 */

const KINDS: Array<RecordPageSearchKind> = getRecordPageSearchKinds();
const PAGE_MAP_VALUES: Set<string> = new Set<string>(Object.values(PageMap));
const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const ENGLISH: (text: string) => string = (text: string): string => {
  return text;
};

function match(
  query: string,
  translate: (text: string) => string = ENGLISH,
): Array<RecordPageQueryMatch> {
  return matchRecordPageQuery({ query, kinds: KINDS, translate });
}

// The one kind and page a query asks for, and what it looks records up by.
function only(
  query: string,
  translate?: (text: string) => string,
): { kind: string; pages: Array<string>; recordText: string } {
  const matches: Array<RecordPageQueryMatch> = match(query, translate);
  expect(matches).toHaveLength(1);
  return {
    kind: matches[0]!.kind.id,
    pages: matches[0]!.pages.map((page: RecordPageSearchPage): string => {
      return page.page;
    }),
    recordText: matches[0]!.recordText,
  };
}

describe("the record page index is sound", () => {
  test("it covers every product with a per-record menu, the status page's pages among them", () => {
    expect(KINDS.length).toBeGreaterThanOrEqual(45);

    const statusPage: RecordPageSearchKind | undefined = KINDS.find(
      (kind: RecordPageSearchKind): boolean => {
        return kind.id === "status-pages";
      },
    );

    expect(
      statusPage!.pages.map((page: RecordPageSearchPage): string => {
        return page.title;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Settings",
        "Single Sign-On",
        "Subscribers",
        "Branding",
      ]),
    );
  });

  test("ids are unique, each kind's pages are its own, and every page is a route", () => {
    const ids: Array<string> = KINDS.map((kind: RecordPageSearchKind) => {
      return kind.id;
    });
    expect(new Set(ids).size).toBe(ids.length);

    for (const kind of KINDS) {
      const keys: Array<string> = kind.pages.map(
        (page: RecordPageSearchPage): string => {
          return page.page;
        },
      );
      expect({
        kind: kind.id,
        duplicates: keys.length - new Set(keys).size,
      }).toEqual({
        kind: kind.id,
        duplicates: 0,
      });

      for (const page of kind.pages) {
        // A PageMap key, or a generated Developer page of one.
        const isKnown: boolean =
          PAGE_MAP_VALUES.has(page.page) ||
          (page.section === DEVELOPER_DOCS_SECTION_TITLE &&
            PAGE_MAP_VALUES.has(page.page.replace(/_DEVELOPER_[A-Z_]+$/, "")));
        expect({ kind: kind.id, page: page.page, isKnown }).toEqual({
          kind: kind.id,
          page: page.page,
          isKnown: true,
        });
      }
    }
  });

  test("each kind names a menu on disk and a product Search knows", () => {
    const areaIds: Set<string> = new Set<string>(
      getPageSearchAreas().map((area: PageSearchArea): string => {
        return area.id;
      }),
    );

    for (const kind of KINDS) {
      expect({ kind: kind.id, area: areaIds.has(kind.area) }).toEqual({
        kind: kind.id,
        area: true,
      });

      for (const menu of kind.menus) {
        expect({
          menu,
          exists: fs.existsSync(path.join(DASHBOARD_SRC, menu)),
        }).toEqual({
          menu,
          exists: true,
        });
      }
    }
  });

  test("a kind with Developer pages gets all four of them", () => {
    const statusPage: RecordPageSearchKind = KINDS.find(
      (kind: RecordPageSearchKind): boolean => {
        return kind.id === "status-pages";
      },
    )!;

    const developerPages: Array<RecordPageSearchPage> = statusPage.pages.filter(
      (page: RecordPageSearchPage): boolean => {
        return page.section === DEVELOPER_DOCS_SECTION_TITLE;
      },
    );

    expect(developerPages).toHaveLength(DEVELOPER_DOCS_PAGES.length);
    expect(developerPages[0]!.page).toBe(
      `${PageMap.STATUS_PAGE_VIEW}_DEVELOPER_TERRAFORM`,
    );
  });

  test("every kind is either looked up by its records' names or says why not", () => {
    const models: Map<string, unknown> = getRecordPageSearchModels();

    for (const kind of KINDS) {
      const isLookedUp: boolean = models.has(kind.id);
      const reason: string | undefined = RECORD_KINDS_NOT_LOOKED_UP[kind.id];

      expect({
        kind: kind.id,
        isLookedUp,
        saysWhyNot: Boolean(reason),
      }).toEqual({
        kind: kind.id,
        isLookedUp: !reason,
        saysWhyNot: !isLookedUp,
      });
    }

    // No reason is kept for a kind that is gone.
    for (const kindId of Object.keys(RECORD_KINDS_NOT_LOOKED_UP)) {
      expect(
        KINDS.some((kind: RecordPageSearchKind): boolean => {
          return kind.id === kindId;
        }),
      ).toBe(true);
    }
  });

  test("App Platforms' environments and Cloud's resources look up their own rows of one model", () => {
    const models: ReturnType<typeof getRecordPageSearchModels> =
      getRecordPageSearchModels();

    expect(models.get("app-platform-environments")!.spec.filter).toEqual({
      cloudResourceKind: "environment",
    });
    expect(models.get("cloud-resources")!.spec.filter).toEqual({
      cloudResourceKind: "resource",
    });
  });

  test("the kinds the record search looks for are looked up the same way here", () => {
    const models: ReturnType<typeof getRecordPageSearchModels> =
      getRecordPageSearchModels();

    expect(models.get("incidents")!.spec.numberFields).toBeDefined();
    expect(models.get("status-pages")!.spec.searchFields).toEqual([
      "name",
      "description",
    ]);
    expect(models.get("inventory-items")!.spec.titleField).toBe("displayName");
  });
});

describe("a query asks for a record's page", () => {
  test("the issue's example: status page SSO", () => {
    expect(only("status page SSO")).toEqual({
      kind: "status-pages",
      pages: [PageMap.STATUS_PAGE_VIEW_SSO],
      recordText: "",
    });
  });

  test("a page by its menu title, either way round", () => {
    expect(only("Single Sign-On status page").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_SSO,
    ]);
    expect(only("status pages branding").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_BRANDING,
    ]);
  });

  test("a record's name and a page: <page name> subscribers", () => {
    expect(only("acme subscribers")).toEqual({
      kind: "status-pages",
      pages: [PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS],
      recordText: "acme",
    });
  });

  test("the name is looked up as typed, punctuation and all", () => {
    expect(only("Acme-Prod.io subscribers").recordText).toBe("Acme-Prod.io");
    expect(only("status page Acme Prod subscribers").recordText).toBe(
      "Acme Prod",
    );
  });

  test("old names still find the renamed pages (#9205, #9218)", () => {
    // "Advanced Settings" is Settings, "SSO" and "OIDC" are Single Sign-On.
    expect(only("status page advanced settings").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_SETTINGS,
    ]);
    expect(only("status page oidc").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_SSO,
    ]);
    // The five subscriber pages are one, with a tab per channel (#9125).
    expect(only("status page email subscribers").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS,
    ]);
    expect(only("status page authentication settings").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS,
    ]);
    // A dashboard's Delete is Delete Dashboard, its Authentication is Sharing.
    expect(only("dashboard ops delete").pages).toEqual([
      PageMap.DASHBOARD_VIEW_DELETE,
    ]);
    expect(only("dashboard authentication").pages).toEqual([
      PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS,
    ]);
    expect(only("maintenance event delete event").pages).toEqual([
      PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE,
    ]);
  });

  test("the longer name wins: subscriber settings is not subscribers", () => {
    expect(only("status page subscriber settings").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS,
    ]);
    expect(only("status page settings").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_SETTINGS,
    ]);
  });

  test("the last word may still be being typed", () => {
    expect(only("status page subscr").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS,
    ]);
  });

  test("other products' records: a monitor's criteria, a cluster's pods, an incident's postmortem", () => {
    expect(only("monitor api criteria")).toEqual({
      kind: "monitors",
      pages: [PageMap.MONITOR_VIEW_CRITERIA],
      recordText: "api",
    });
    expect(only("kubernetes prod pods").kind).toBe("kubernetes-clusters");
    expect(only("incident postmortem").pages).toEqual([
      PageMap.INCIDENT_VIEW_POSTMORTEM,
    ]);
    expect(only("on-call policy escalation rules").kind).toBe(
      "on-call-policies",
    );
  });

  test("a page's name alone is left to the pages that open without a record", () => {
    expect(match("sso")).toEqual([]);
    expect(match("subscribers")).toEqual([]);
    expect(match("single sign-on")).toEqual([]);
    // A kind with no page named is the record search's.
    expect(match("status page")).toEqual([]);
    expect(match("acme status")).toEqual([]);
  });

  test("it stays bounded: a name with a page many kinds have looks up a few kinds", () => {
    const matches: Array<RecordPageQueryMatch> = match("acme settings");

    expect(matches.length).toBe(RECORD_PAGE_SEARCH_MAX_KINDS);
    // The most opened kinds first, in the index's order.
    expect(matches[0]!.kind.id).toBe("status-pages");

    for (const found of matches) {
      expect(found.recordText).toBe("acme");
      expect(found.namesKind).toBe(false);
      expect(found.pages.length).toBeLessThanOrEqual(
        RECORD_PAGE_SEARCH_MAX_PAGES,
      );
    }
  });

  test("a query that names a kind asks for that kind only", () => {
    const matches: Array<RecordPageQueryMatch> = match("status page settings");

    expect(
      matches.map((found: RecordPageQueryMatch): string => {
        return found.kind.id;
      }),
    ).toEqual(["status-pages"]);
  });

  test("names in the reader's language find the page too (German, Arabic, Persian)", () => {
    const words: Record<string, Record<string, string>> = {
      de: { "Status Page": "Statusseite", "Single Sign-On": "Einmalanmeldung" },
      ar: {
        "Status Page": "صفحة الحالة",
        "Single Sign-On": "تسجيل الدخول الموحد",
      },
      fa: {
        "Status Page": "صفحه وضعیت",
        Subscribers: "مشترکان",
      },
    };

    const inLanguage: (language: string) => (text: string) => string = (
      language: string,
    ): ((text: string) => string) => {
      return (text: string): string => {
        return words[language]![text] || text;
      };
    };

    expect(only("Statusseite Einmalanmeldung", inLanguage("de")).pages).toEqual(
      [PageMap.STATUS_PAGE_VIEW_SSO],
    );
    expect(
      only("صفحة الحالة تسجيل الدخول الموحد", inLanguage("ar")).pages,
    ).toEqual([PageMap.STATUS_PAGE_VIEW_SSO]);
    expect(only("صفحه وضعیت مشترکان", inLanguage("fa")).pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS,
    ]);
  });

  test("words are split in any script, and compared in lowercase", () => {
    expect(
      tokenizeSearchText("Status-Page  SSO").map(
        (token: SearchToken): string => {
          return token.text;
        },
      ),
    ).toEqual(["status", "page", "sso"]);
    expect(
      tokenizeSearchText("صفحة الحالة").map((token: SearchToken): string => {
        return token.text;
      }),
    ).toEqual(["صفحة", "الحالة"]);
  });

  test("a kind is named by what one record is called, in English and in the reader's language", () => {
    const statusPage: RecordPageSearchKind = KINDS.find(
      (kind: RecordPageSearchKind): boolean => {
        return kind.id === "status-pages";
      },
    )!;

    expect(
      getRecordKindNames(statusPage, (text: string): string => {
        return text === "Status Page" ? "Statusseite" : text;
      }),
    ).toEqual(
      expect.arrayContaining(["Status Page", "Statusseite", "status pages"]),
    );
  });
});

describe("the record whose page is open", () => {
  const ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";

  // A route table for the tests, as RouteMap writes them.
  const TEMPLATES: Record<string, string> = {
    [PageMap.STATUS_PAGE_VIEW]: "/dashboard/:projectId/status-pages/:id",
    [PageMap.STATUS_PAGE_VIEW_SSO]:
      "/dashboard/:projectId/status-pages/:id/sso",
    [PageMap.ANNOUNCEMENT_VIEW]:
      "/dashboard/:projectId/status-pages/announcements/:id",
    [PageMap.MONITOR_VIEW]: "/dashboard/:projectId/monitors/:id",
  };

  const open: (pathname: string) => OpenRecord | null = (
    pathname: string,
  ): OpenRecord | null => {
    return getOpenRecord({
      path: pathname,
      kinds: KINDS,
      getRouteTemplate: (key: string): string | undefined => {
        return TEMPLATES[key];
      },
    });
  };

  test("any page of a record's menu says which record it is", () => {
    expect(open(`/dashboard/p1/status-pages/${ID}/sso`)).toEqual({
      kind: expect.objectContaining({ id: "status-pages" }),
      modelId: ID,
    });
    expect(open(`/dashboard/p1/status-pages/${ID}/`)?.kind.id).toBe(
      "status-pages",
    );
    expect(
      open(`/dashboard/p1/status-pages/announcements/${ID}`)?.kind.id,
    ).toBe("announcements");
  });

  test("a page that is no record's is none", () => {
    expect(open("/dashboard/p1/status-pages")).toBeNull();
    expect(open("/dashboard/p1/monitors/create")).toBeNull();
    expect(open("/dashboard/p1/home")).toBeNull();
  });
});

/*
 * Home Page & Shortcuts tells people what Search finds; its examples for a
 * record's pages must find what it says they do.
 */
describe("the docs' examples for a record's pages work", () => {
  const HOME_PAGE: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Docs",
      "Content",
      "en",
      "introduction",
      "home.md",
    ),
    "utf8",
  );

  const line: string =
    HOME_PAGE.split("\n").find((candidate: string): boolean => {
      return candidate.startsWith("- **A record's own pages**");
    }) || "";

  test("the page names them, and each finds the page it says", () => {
    expect(line).toContain("*status page sso*");
    expect(line).toContain("*acme subscribers*");
    expect(line).toContain("*advanced settings*");

    expect(only("status page sso").pages).toEqual([
      PageMap.STATUS_PAGE_VIEW_SSO,
    ]);
    expect(only("acme subscribers")).toEqual({
      kind: "status-pages",
      pages: [PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS],
      recordText: "acme",
    });

    const statusPage: RecordPageSearchKind = KINDS.find(
      (kind: RecordPageSearchKind): boolean => {
        return kind.id === "status-pages";
      },
    )!;
    const formerTitles: Array<string> = statusPage.pages.flatMap(
      (page: RecordPageSearchPage): Array<string> => {
        return page.formerTitles || [];
      },
    );
    expect(formerTitles).toEqual(
      expect.arrayContaining(["Advanced Settings", "SSO"]),
    );
  });
});
