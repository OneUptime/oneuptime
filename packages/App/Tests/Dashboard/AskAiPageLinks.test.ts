import {
  getAnswerPageLinks,
  getDashboardPageTemplate,
  getDocsPageAddress,
  isDashboardRouteTemplate,
  AskAiAnswerPageLink,
} from "../../FeatureSet/Dashboard/src/Components/AIChat/AskAiPageLinks";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "Common/Types/AI/AIChatTypes";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHERE AN ASK AI ANSWER TAKES YOU (issue #6828). The Dashboard opens a
 * page an answer cites only when it checked the address itself: a route of
 * its own RouteMap that waits for nothing but the project, or a docs page
 * by its docs address - whatever the citation says.
 */

// RouteMap fills in the project from the browser's address; these read its templates only.
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

const citation: (
  id: string,
  type: AIChatCitationTargetType,
  params: { [key: string]: string },
) => AIChatCitation = (
  id: string,
  type: AIChatCitationTargetType,
  params: { [key: string]: string },
): AIChatCitation => {
  return {
    id,
    toolName: "find_dashboard_page",
    label: `Page: ${params["title"] || id}`,
    queryArguments: {},
    rowCount: 1,
    target: { type, params },
  };
};

describe("isDashboardRouteTemplate", () => {
  test("is true for a route of RouteMap in the project, with a plain query or anchor", () => {
    expect(
      isDashboardRouteTemplate("/dashboard/:projectId/monitors/create"),
    ).toBe(true);
    expect(
      isDashboardRouteTemplate(
        "/dashboard/:projectId/settings/api-keys?from=search#more-settings",
      ),
    ).toBe(true);
  });

  test("is false for anything else", () => {
    for (const path of [
      "/dashboard/:projectId/made-up-page",
      "/dashboard/:projectId/monitors/:id",
      "javascript:alert(1)",
      "https://attacker.example/dashboard/:projectId/monitors/create",
      "//attacker.example/dashboard",
      '/dashboard/:projectId/monitors/create?x="><script>',
      "/dashboard/:projectId/monitors/create#a b",
      "",
      "/".repeat(600),
    ]) {
      expect(isDashboardRouteTemplate(path)).toBe(false);
    }
    expect(isDashboardRouteTemplate(undefined)).toBe(false);
    expect(isDashboardRouteTemplate(42)).toBe(false);
  });
});

describe("getDashboardPageTemplate", () => {
  test("opens a DashboardPage citation's route, and nothing of another kind", () => {
    expect(
      getDashboardPageTemplate({
        type: AIChatCitationTargetType.DashboardPage,
        params: { path: "/dashboard/:projectId/monitors/create" },
      }),
    ).toBe("/dashboard/:projectId/monitors/create");
    expect(
      getDashboardPageTemplate({
        type: AIChatCitationTargetType.DashboardPage,
        params: { path: "/dashboard/:projectId/nope" },
      }),
    ).toBeUndefined();
    expect(
      getDashboardPageTemplate({
        type: AIChatCitationTargetType.Monitors,
        params: { path: "/dashboard/:projectId/monitors/create" },
      }),
    ).toBeUndefined();
    expect(getDashboardPageTemplate(undefined)).toBeUndefined();
  });
});

describe("getDocsPageAddress", () => {
  test("opens a docs page in its language, at its section", () => {
    expect(
      getDocsPageAddress({
        type: AIChatCitationTargetType.DocsPage,
        params: {
          page: "notifications/notification-methods",
          language: "de",
          anchor: "sms",
        },
      }),
    ).toBe("/docs/de/notifications/notification-methods#sms");
    expect(
      getDocsPageAddress({
        type: AIChatCitationTargetType.DocsPage,
        params: {
          page: "status-pages/index",
          language: "fa",
          anchor: "افزودن-صفحه",
        },
      }),
    ).toBe("/docs/fa/status-pages/index#افزودن-صفحه");
  });

  test("reads a language the docs do not have as English, and leaves out an anchor that is not one", () => {
    expect(
      getDocsPageAddress({
        type: AIChatCitationTargetType.DocsPage,
        params: { page: "status-pages/index", language: "xx", anchor: 'a"b' },
      }),
    ).toBe("/docs/en/status-pages/index");
  });

  test("opens nothing that is not a docs page's address", () => {
    for (const page of [
      "../admin",
      "https://attacker.example",
      "status-pages/Index",
      "status pages",
      "",
    ]) {
      expect(
        getDocsPageAddress({
          type: AIChatCitationTargetType.DocsPage,
          params: { page, language: "en" },
        }),
      ).toBeUndefined();
    }
    expect(
      getDocsPageAddress({
        type: AIChatCitationTargetType.DashboardPage,
        params: { page: "status-pages/index" },
      }),
    ).toBeUndefined();
  });
});

describe("getAnswerPageLinks", () => {
  const createMonitor: AIChatCitation = citation(
    "C3",
    AIChatCitationTargetType.DashboardPage,
    { path: "/dashboard/:projectId/monitors/create", title: "Create Monitor" },
  );
  const methods: AIChatCitation = citation(
    "C4",
    AIChatCitationTargetType.DashboardPage,
    {
      path: "/dashboard/:projectId/user-settings/notification-methods",
      title: "Notification Methods",
    },
  );
  const docs: AIChatCitation = citation(
    "C1",
    AIChatCitationTargetType.DocsPage,
    {
      page: "monitor/website-monitor",
      language: "en",
    },
  );
  const forged: AIChatCitation = citation(
    "C5",
    AIChatCitationTargetType.DashboardPage,
    { path: "https://attacker.example", title: "Pay here" },
  );

  test("a button for each Dashboard page the answer cites, once, in the order it names them", () => {
    const links: Array<AskAiAnswerPageLink> = getAnswerPageLinks(
      "1. Open it [C1].\n\nOpen Notification Methods [C4], then Create Monitor [C3]. Again: [C4]",
      [docs, createMonitor, methods],
    );

    expect(
      links.map((link: AskAiAnswerPageLink) => {
        return [link.citationId, link.title];
      }),
    ).toEqual([
      ["C4", "Notification Methods"],
      ["C3", "Create Monitor"],
    ]);
  });

  test("none for a page looked up but not cited, a docs citation, or an address that is not a route", () => {
    expect(
      getAnswerPageLinks("Read the docs [C1].", [docs, createMonitor]),
    ).toEqual([]);
    expect(getAnswerPageLinks("Go [C5].", [forged])).toEqual([]);
    expect(getAnswerPageLinks("Go [C9].", [createMonitor])).toEqual([]);
  });

  test("names a page by its citation's label when its target has no title", () => {
    const untitled: AIChatCitation = {
      ...createMonitor,
      target: {
        type: AIChatCitationTargetType.DashboardPage,
        params: { path: "/dashboard/:projectId/monitors/create" },
      },
    };
    expect(getAnswerPageLinks("Go [C3].", [untitled])[0]?.title).toBe(
      "Page: Create Monitor",
    );
  });
});

describe("the answer and its citations, wired", () => {
  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(
      path.resolve(
        __dirname,
        "../../FeatureSet/Dashboard/src/Components/AIChat",
        file,
      ),
      "utf8",
    );
  };

  test("an answer draws its page buttons under its text", () => {
    expect(read("ChatMessageList.tsx")).toContain("<AskAiPageButtons");
  });

  test("a citation opens a Dashboard page or a docs page only through the checks here", () => {
    const nav: string = read("CitationTargetNav.ts");
    expect(nav).toContain("getDashboardPageTemplate(target)");
    expect(nav).toContain("getDocsPageAddress(target)");
    // The docs open beside the Dashboard, so the answer stays.
    expect(nav).toContain(
      "Navigation.navigate(docsUrl, { openInNewTab: true })",
    );
  });
});
