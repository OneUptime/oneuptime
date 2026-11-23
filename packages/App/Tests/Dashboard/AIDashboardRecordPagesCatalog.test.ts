import {
  getRecordPageSearchKinds,
  RecordPageSearchKind,
  RecordPageSearchPage,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/RecordPageSearchIndex";
import RouteMap from "../../FeatureSet/Dashboard/src/Utils/RouteMap";
import { getProductsOfPath } from "../../FeatureSet/Dashboard/src/Utils/ProjectProducts/ProductOfRoute";
import { isDashboardRouteTemplate } from "../../FeatureSet/Dashboard/src/Components/AIChat/AskAiPageLinks";
import Route from "Common/Types/API/Route";
import {
  ASK_AI_RECORD_KINDS,
  ASK_AI_RECORD_ROUTE_PARAM,
  AskAiRecordKind,
  AskAiRecordKindPages,
  AskAiRecordPage,
} from "Common/Types/AI/AskAiRecordPages";
import ProductKey from "Common/Types/Product/ProductKey";
import DashboardRecordPageFinder, {
  AI_DASHBOARD_RECORD_KINDS,
} from "Common/Server/Utils/AI/Docs/DashboardRecordPageFinder";
import { readDashboardLocale } from "Common/Tests/Helpers/DashboardLocales";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ASK AI'S LIST OF A RECORD'S OWN PAGES IS SEARCH'S OWN (#7065).
 *
 * find_dashboard_page finds one record's pages - a status page's Custom
 * Domains, a monitor's Criteria - in Common's DashboardRecordPages.json,
 * which the server can read without the Dashboard's code. It is generated
 * here from Search's record page index (RecordPageSearchIndex.ts, held to
 * the records' menus by RecordPageSearchIndexCoversMenus), for the kinds
 * Types/AI/AskAiRecordPages names, with each page's route from RouteMap
 * and the products it needs on from the Dashboard's own rule
 * (getProductsOfPath). So a page Search opens for a record is a page Ask
 * AI can send someone to, under the same name, and nothing else. Run this
 * suite with UPDATE_AI_DASHBOARD_PAGES=1 to write the file again after the
 * index changes.
 */

// RouteMap fills in the current project from the browser's address; these read its templates only.
jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): null => {
        return null;
      },
    },
  };
});

const CATALOG_PATH: string = path.resolve(
  __dirname,
  "../../../Common/Server/Utils/AI/Docs/DashboardRecordPages.json",
);

const RECORD_ID: string = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const getTemplate: (key: string) => string | undefined = (
  key: string,
): string | undefined => {
  const route: Route | undefined = RouteMap[key];
  return route ? route.toString() : undefined;
};

// The params a route waits for: ":projectId", ":id".
const paramsOf: (template: string) => Array<string> = (
  template: string,
): Array<string> => {
  return template.split("/").filter((segment: string): boolean => {
    return segment.startsWith(":");
  });
};

/*
 * A page of the index Ask AI can open: a route of RouteMap that waits for
 * the project and the record's id, and nothing else.
 */
const isOpenableRecordRoute: (template: string | undefined) => boolean = (
  template: string | undefined,
): boolean => {
  if (!template || template.endsWith("/*")) {
    return false;
  }

  const params: Array<string> = paramsOf(template);

  return (
    params.length === 2 &&
    params[0] === ":projectId" &&
    params[1] === ASK_AI_RECORD_ROUTE_PARAM
  );
};

const searchKindOf: (kind: AskAiRecordKind) => RecordPageSearchKind = (
  kind: AskAiRecordKind,
): RecordPageSearchKind => {
  const found: RecordPageSearchKind | undefined =
    getRecordPageSearchKinds().find(
      (candidate: RecordPageSearchKind): boolean => {
        return candidate.id === kind;
      },
    );

  if (!found) {
    throw new Error(
      `${kind} is not a kind of RecordPageSearchIndex.ts: name a kind Search's record page index has.`,
    );
  }

  return found;
};

// Each word once, in the order it first came.
const distinct: (words: Array<string>) => Array<string> = (
  words: Array<string>,
): Array<string> => {
  return Array.from(new Set<string>(words));
};

const derivePage: (page: RecordPageSearchPage) => AskAiRecordPage | null = (
  page: RecordPageSearchPage,
): AskAiRecordPage | null => {
  const template: string | undefined = getTemplate(page.page);

  if (!isOpenableRecordRoute(template)) {
    return null;
  }

  const keywords: Array<string> = distinct([
    ...(page.formerTitles || []),
    ...(page.keywords || []),
  ]);
  const products: Array<ProductKey> = getProductsOfPath(template!);

  return {
    title: page.title,
    section: page.section,
    ...(keywords.length > 0 ? { keywords } : {}),
    path: `${template!}${page.queryString || ""}`,
    ...(products.length > 0 ? { products } : {}),
  };
};

// What the catalog should hold: each kind Ask AI opens, with every page of its menu that is a route.
const deriveCatalog: () => Array<AskAiRecordKindPages> =
  (): Array<AskAiRecordKindPages> => {
    return ASK_AI_RECORD_KINDS.map(
      (kind: AskAiRecordKind): AskAiRecordKindPages => {
        const searchKind: RecordPageSearchKind = searchKindOf(kind);

        return {
          kind,
          recordName: searchKind.recordName,
          pages: searchKind.pages
            .map(derivePage)
            .filter((page: AskAiRecordPage | null): page is AskAiRecordPage => {
              return page !== null;
            }),
        };
      },
    );
  };

const DERIVED: Array<AskAiRecordKindPages> = deriveCatalog();

if (process.env["UPDATE_AI_DASHBOARD_PAGES"] === "1") {
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(DERIVED, null, 2)}\n`);
}

const routeOf: (page: AskAiRecordPage) => string = (
  page: AskAiRecordPage,
): string => {
  return page.path.split(/[?#]/)[0]!;
};

const ENGLISH_WORDS: Record<string, string> = readDashboardLocale("en");

describe("Ask AI's catalog of a record's own pages", () => {
  test("is the record page index Search reads, as generated from it (run with UPDATE_AI_DASHBOARD_PAGES=1 to write it again)", () => {
    expect(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"))).toEqual(DERIVED);
  });

  test("holds every kind Ask AI opens, in their order, and no other", () => {
    expect(
      AI_DASHBOARD_RECORD_KINDS.map((kind: AskAiRecordKindPages): string => {
        return kind.kind;
      }),
    ).toEqual([...ASK_AI_RECORD_KINDS]);

    for (const kind of AI_DASHBOARD_RECORD_KINDS) {
      expect(kind.pages.length).toBeGreaterThan(1);
    }
  });

  test("every page in it opens one of the Dashboard's own routes, waiting for nothing but the project and the record", () => {
    const templates: Set<string> = new Set<string>(
      Object.values(RouteMap).map((route: Route): string => {
        return route.toString();
      }),
    );

    for (const kind of AI_DASHBOARD_RECORD_KINDS) {
      for (const page of kind.pages) {
        expect({
          page: page.path,
          isRoute: templates.has(routeOf(page)),
        }).toEqual({ page: page.path, isRoute: true });
        expect(paramsOf(routeOf(page))).toEqual([":projectId", ":id"]);
        expect(
          isDashboardRouteTemplate(page.path, { recordId: RECORD_ID }),
        ).toBe(true);
        // Without a record to fill it with, the Dashboard opens none of them.
        expect(isDashboardRouteTemplate(page.path)).toBe(false);
      }
    }
  });

  test("every page of a kind's menu is in it, but those the index names by a route that waits for more than the record", () => {
    const leftOut: Array<string> = [];

    for (const kind of ASK_AI_RECORD_KINDS) {
      for (const page of searchKindOf(kind).pages) {
        if (!isOpenableRecordRoute(getTemplate(page.page))) {
          leftOut.push(`${kind} > ${page.title}`);
        }
      }
    }

    expect(leftOut).toEqual([]);
  });

  test("each page carries the products the Dashboard says it needs on, and a kind's pages are its product's", () => {
    const expectedProduct: Partial<Record<AskAiRecordKind, ProductKey>> = {
      [AskAiRecordKind.StatusPage]: ProductKey.StatusPages,
      [AskAiRecordKind.Monitor]: ProductKey.Monitors,
      [AskAiRecordKind.Incident]: ProductKey.Incidents,
      [AskAiRecordKind.Alert]: ProductKey.Alerts,
      [AskAiRecordKind.OnCallPolicy]: ProductKey.OnCall,
      [AskAiRecordKind.OnCallSchedule]: ProductKey.OnCall,
      [AskAiRecordKind.IncomingCallPolicy]: ProductKey.OnCall,
      [AskAiRecordKind.MaintenanceEvent]: ProductKey.ScheduledMaintenance,
      [AskAiRecordKind.Service]: ProductKey.Services,
      [AskAiRecordKind.Workflow]: ProductKey.Workflows,
      [AskAiRecordKind.Dashboard]: ProductKey.Dashboards,
      [AskAiRecordKind.Runbook]: ProductKey.Runbooks,
      [AskAiRecordKind.Slo]: ProductKey.Slos,
      [AskAiRecordKind.Form]: ProductKey.Forms,
    };

    for (const kind of AI_DASHBOARD_RECORD_KINDS) {
      const product: ProductKey | undefined = expectedProduct[kind.kind];

      for (const page of kind.pages) {
        expect(page.products || []).toEqual(getProductsOfPath(routeOf(page)));

        if (product) {
          expect({ page: page.path, products: page.products }).toEqual({
            page: page.path,
            products: expect.arrayContaining([product]),
          });
        }
      }
    }

    // A team is the project's own: no product switches its pages off.
    expect(
      DashboardRecordPageFinder.getKind(AskAiRecordKind.Team)!.pages.every(
        (page: AskAiRecordPage): boolean => {
          return !page.products;
        },
      ),
    ).toBe(true);
  });

  test("every name a page's button and chip draw is a key the Dashboard's locales hold", () => {
    const unknown: Set<string> = new Set<string>();

    for (const kind of AI_DASHBOARD_RECORD_KINDS) {
      for (const name of [
        kind.recordName,
        ...kind.pages.flatMap((page: AskAiRecordPage): Array<string> => {
          return [page.title, page.section];
        }),
      ]) {
        if (!Object.prototype.hasOwnProperty.call(ENGLISH_WORDS, name)) {
          unknown.add(name);
        }
      }
    }

    expect([...unknown]).toEqual([]);
  });

  test("no two pages of a kind share a title in one section, so a title and a section name one page", () => {
    for (const kind of AI_DASHBOARD_RECORD_KINDS) {
      const named: Set<string> = new Set<string>();

      for (const page of kind.pages) {
        const name: string = `${page.section} > ${page.title}`;
        expect({ kind: kind.kind, name, isRepeated: named.has(name) }).toEqual({
          kind: kind.kind,
          name,
          isRepeated: false,
        });
        named.add(name);
      }
    }
  });

  test("each page is the first one found by its title and its section, as a result gives them", () => {
    const missed: Array<string> = [];

    for (const kind of AI_DASHBOARD_RECORD_KINDS) {
      for (const page of kind.pages) {
        const found: AskAiRecordPage | undefined =
          DashboardRecordPageFinder.find({
            kind: kind.kind,
            query: page.title,
            place: page.section,
            limit: 1,
          })[0];

        if (found !== page) {
          missed.push(`${kind.kind}: ${page.section} > ${page.title}`);
        }
      }
    }

    expect(missed).toEqual([]);
  });
});

describe("finding a record's page by the name people give it", () => {
  test.each<[AskAiRecordKind, string, string]>([
    [
      AskAiRecordKind.StatusPage,
      "Custom Domains",
      "/dashboard/:projectId/status-pages/:id/domains",
    ],
    [
      AskAiRecordKind.StatusPage,
      "custom domain",
      "/dashboard/:projectId/status-pages/:id/domains",
    ],
    [
      AskAiRecordKind.StatusPage,
      "SSO",
      "/dashboard/:projectId/status-pages/:id/sso",
    ],
    [
      AskAiRecordKind.StatusPage,
      "status page subscribers",
      "/dashboard/:projectId/status-pages/:id/subscribers",
    ],
    [
      AskAiRecordKind.Monitor,
      "Criteria",
      "/dashboard/:projectId/monitors/:id/criteria",
    ],
    [
      AskAiRecordKind.OnCallPolicy,
      "Escalation Rules",
      "/dashboard/:projectId/on-call-duty/policies/:id/escalation",
    ],
    [
      AskAiRecordKind.Form,
      "Custom Domains",
      "/dashboard/:projectId/forms/:id/custom-domains",
    ],
  ])(
    '%s: "%s" is %s',
    (kind: AskAiRecordKind, query: string, route: string) => {
      expect(
        routeOf(
          DashboardRecordPageFinder.find({ kind, query, limit: 1 })[0] || {
            title: "",
            section: "",
            path: "",
          },
        ),
      ).toBe(route);
    },
  );

  test("no query is the record's first page, its overview", () => {
    expect(
      DashboardRecordPageFinder.find({
        kind: AskAiRecordKind.StatusPage,
        query: "",
        limit: 3,
      }).map(routeOf),
    ).toEqual(["/dashboard/:projectId/status-pages/:id"]);
  });

  test("a name no page of the kind has finds nothing, and a section no page is in finds nothing", () => {
    expect(
      DashboardRecordPageFinder.find({
        kind: AskAiRecordKind.Monitor,
        query: "zzqx flux capacitor",
        limit: 3,
      }),
    ).toEqual([]);
    expect(
      DashboardRecordPageFinder.find({
        kind: AskAiRecordKind.StatusPage,
        query: "Custom Domains",
        place: "Security",
        limit: 3,
      }),
    ).toEqual([]);
  });

  test("a route of the catalog names its page and its kind; any other names nothing", () => {
    expect(
      DashboardRecordPageFinder.getPageByPath(
        "/dashboard/:projectId/status-pages/:id/domains",
      ),
    ).toEqual({
      kind: expect.objectContaining({ kind: AskAiRecordKind.StatusPage }),
      page: expect.objectContaining({ title: "Custom Domains" }),
    });
    expect(
      DashboardRecordPageFinder.getPageByPath(
        "/dashboard/:projectId/made-up/:id",
      ),
    ).toBeUndefined();
  });
});
