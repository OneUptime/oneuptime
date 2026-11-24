import { getAnswerPageLinks } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPageLinks";
import { getRouteForCitationTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  AI_DASHBOARD_PAGES,
  AIDashboardPage,
} from "../../../Server/Utils/AI/Docs/DashboardPageFinder";
import { AI_DASHBOARD_RECORD_KINDS } from "../../../Server/Utils/AI/Docs/DashboardRecordPageFinder";
import {
  getDashboardPageCitationTarget,
  getRecordPageCitationTarget,
} from "../../../Server/Utils/AI/Docs/DashboardPageCitations";
import Route from "../../../Types/API/Route";
import {
  AIChatCitation,
  AIChatCitationTarget,
} from "../../../Types/AI/AIChatTypes";
import {
  AskAiRecordKindPages,
  AskAiRecordPage,
} from "../../../Types/AI/AskAiRecordPages";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { matchRoutes, RouteMatch } from "react-router-dom";

/*
 * EVERY LINK ASK AI CAN DRAW OPENS A REAL PAGE (#7065).
 *
 * A "Go to <page>" button under an answer is a citation of
 * find_dashboard_page: a page of the project from DashboardPages.json, or
 * a page of one record from DashboardRecordPages.json. Each is built here
 * exactly as the tool builds it (DashboardPageCitations), drawn as the
 * answer draws it (getAnswerPageLinks) and opened as the button opens it
 * (getRouteForCitationTarget). It must open an address with nothing left
 * to fill, of a route of the Dashboard's own route map, which the
 * Dashboard's routes take for that very page - not a sibling that happens
 * to match it. So a page renamed, moved or taken out of the route map can
 * never leave Ask AI a button to nowhere.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const RECORD_ID: string = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const ROUTE_TEMPLATES: Set<string> = new Set<string>(
  Object.values(RouteMap).map((route: Route): string => {
    return route.toString();
  }),
);

const routeOfPath: (pagePath: string) => string = (
  pagePath: string,
): string => {
  return pagePath.split(/[?#]/)[0]!;
};

// What a button opens, from the citation alone, as the Dashboard opens it.
const opened: (target: AIChatCitationTarget) => string | undefined = (
  target: AIChatCitationTarget,
): string | undefined => {
  const citation: AIChatCitation = {
    id: "C1",
    toolName: "find_dashboard_page",
    label: "Page",
    queryArguments: {},
    rowCount: 1,
    target,
  };

  // Drawn as a button under the answer that cites it.
  if (getAnswerPageLinks("Open it [C1]", [citation]).length !== 1) {
    return undefined;
  }

  return getRouteForCitationTarget(target)?.toString();
};

// The route template the Dashboard's routes take an address for.
const matchedTemplate: (address: string) => string | undefined = (
  address: string,
): string | undefined => {
  const matches: Array<RouteMatch> | null = matchRoutes(
    RouteUtil.getRoutes(),
    address,
  );

  return matches?.[0]?.route.path;
};

beforeAll(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("every page of the project Ask AI can send someone to opens it", () => {
  test.each(
    AI_DASHBOARD_PAGES.map(
      (page: AIDashboardPage): [string, AIDashboardPage] => {
        return [page.path, page];
      },
    ),
  )("%s", (_pagePath: string, page: AIDashboardPage) => {
    const route: string = routeOfPath(page.path);
    const address: string | undefined = opened(
      getDashboardPageCitationTarget(page),
    );

    expect(ROUTE_TEMPLATES.has(route)).toBe(true);
    expect(address).toBeDefined();
    // The project filled in, and nothing left to fill.
    expect(routeOfPath(address!)).toBe(route.replace(":projectId", PROJECT_ID));
    expect(routeOfPath(address!)).not.toContain(":");
    // The Dashboard's routes take the address for this very page.
    expect(matchedTemplate(routeOfPath(address!))).toBe(route);
  });
});

describe("every page of a record Ask AI can send someone to opens it, for that record", () => {
  const rows: Array<[string, AskAiRecordKindPages, AskAiRecordPage]> =
    AI_DASHBOARD_RECORD_KINDS.flatMap(
      (
        kind: AskAiRecordKindPages,
      ): Array<[string, AskAiRecordKindPages, AskAiRecordPage]> => {
        return kind.pages.map(
          (
            page: AskAiRecordPage,
          ): [string, AskAiRecordKindPages, AskAiRecordPage] => {
            return [`${kind.kind}: ${page.path}`, kind, page];
          },
        );
      },
    );

  test("there are pages of every kind to open", () => {
    expect(rows.length).toBeGreaterThan(AI_DASHBOARD_RECORD_KINDS.length);
  });

  test.each(rows)(
    "%s",
    (_name: string, _kind: AskAiRecordKindPages, page: AskAiRecordPage) => {
      const route: string = routeOfPath(page.path);
      const address: string | undefined = opened(
        getRecordPageCitationTarget({
          page,
          recordId: RECORD_ID,
          recordTitle: "Acme",
        }),
      );

      expect(ROUTE_TEMPLATES.has(route)).toBe(true);
      expect(address).toBeDefined();
      // The project and the record filled in, and nothing left to fill.
      expect(routeOfPath(address!)).toBe(
        route.replace(":projectId", PROJECT_ID).replace(":id", RECORD_ID),
      );
      expect(routeOfPath(address!)).not.toContain(":");
      expect(matchedTemplate(routeOfPath(address!))).toBe(route);

      // Without the record's id, the same page opens nothing.
      expect(
        opened(getRecordPageCitationTarget({ page, recordId: "not-an-id" })),
      ).toBeUndefined();
    },
  );
});

describe("the check itself", () => {
  test("tells the page an address is for from a sibling it would match", () => {
    expect(matchedTemplate(`/dashboard/${PROJECT_ID}/monitors/create`)).toBe(
      "/dashboard/:projectId/monitors/create",
    );
    expect(
      matchedTemplate(`/dashboard/${PROJECT_ID}/monitors/${RECORD_ID}`),
    ).toBe("/dashboard/:projectId/monitors/:id");
    expect(ROUTE_TEMPLATES.has("/dashboard/:projectId/made-up-page")).toBe(
      false,
    );
  });

  test("a citation the Dashboard does not open opens nothing here either", () => {
    expect(
      opened({
        type: getDashboardPageCitationTarget(AI_DASHBOARD_PAGES[0]!).type,
        params: { path: "/dashboard/:projectId/made-up-page", title: "Made" },
      }),
    ).toBeUndefined();
  });
});
