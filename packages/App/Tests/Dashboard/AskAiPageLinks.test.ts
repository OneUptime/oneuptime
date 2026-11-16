import {
  getAnswerPageLinks,
  getDashboardPageTemplate,
  getDocsPageAddress,
  isDashboardRouteTemplate,
  readTitleValues,
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
    expect(getAnswerPageLinks("Go [C3].", [untitled])[0]?.titleKey).toBe(
      "Page: Create Monitor",
    );
  });

  /*
   * An explorer's Insights tab (#8817): the model reads its English title,
   * "Insights", and the button draws the tab's own key, "Insights
   * (explorer analytics)", so it reads the tab's word in each language.
   */
  test("draws a page by the key its citation carries beside its English title", () => {
    const tab: AIChatCitation = citation(
      "C6",
      AIChatCitationTargetType.DashboardPage,
      {
        path: "/dashboard/:projectId/logs/insights",
        title: "Insights",
        titleKey: "Insights (explorer analytics)",
      },
    );

    expect(getAnswerPageLinks("Open it [C6].", [tab])).toEqual([
      {
        citationId: "C6",
        title: "Insights",
        titleKey: "Insights (explorer analytics)",
        target: tab.target,
      },
    ]);
  });

  test("draws a page with no key beside its title by its title, as every page before #8817", () => {
    expect(getAnswerPageLinks("Go [C3].", [createMonitor])).toEqual([
      {
        citationId: "C3",
        title: "Create Monitor",
        titleKey: "Create Monitor",
        target: createMonitor.target,
      },
    ]);

    // Saved with the key as its title (14.3.0): still the tab's key.
    const saved: AIChatCitation = citation(
      "C7",
      AIChatCitationTargetType.DashboardPage,
      {
        path: "/dashboard/:projectId/traces/insights",
        title: "Insights (explorer analytics)",
      },
    );

    expect(getAnswerPageLinks("Go [C7].", [saved])[0]?.titleKey).toBe(
      "Insights (explorer analytics)",
    );
  });

  test("an empty key is no key: the title is drawn", () => {
    const blank: AIChatCitation = citation(
      "C8",
      AIChatCitationTargetType.DashboardPage,
      {
        path: "/dashboard/:projectId/logs/insights",
        title: "Insights",
        titleKey: "",
      },
    );

    expect(getAnswerPageLinks("Go [C8].", [blank])[0]?.titleKey).toBe(
      "Insights",
    );
  });

  /*
   * An importer's action (#8834): its key is a template, filled with the
   * tool's name once it is translated, so the button reads "Import aus
   * PagerDuty" in German.
   */
  test("draws a templated title by its key and the values its citation carries", () => {
    const pagerDuty: AIChatCitation = citation(
      "C9",
      AIChatCitationTargetType.DashboardPage,
      {
        path: "/dashboard/:projectId/settings/import?from=search&tool=PagerDuty",
        title: "Import from PagerDuty",
        titleKey: "Import from {{tool}}",
        titleValues: JSON.stringify({ tool: "PagerDuty" }),
      },
    );

    expect(getAnswerPageLinks("Go [C9].", [pagerDuty])).toEqual([
      {
        citationId: "C9",
        title: "Import from PagerDuty",
        titleKey: "Import from {{tool}}",
        titleValues: { tool: "PagerDuty" },
        target: pagerDuty.target,
      },
    ]);
  });

  test("values without a key are none: the title is drawn as it is", () => {
    const keyless: AIChatCitation = citation(
      "C9",
      AIChatCitationTargetType.DashboardPage,
      {
        path: "/dashboard/:projectId/settings/import?from=search&tool=PagerDuty",
        title: "Import from PagerDuty",
        titleValues: JSON.stringify({ tool: "PagerDuty" }),
      },
    );
    const link: AskAiAnswerPageLink = getAnswerPageLinks("Go [C9].", [
      keyless,
    ])[0]!;

    expect(link.titleKey).toBe("Import from PagerDuty");
    expect(link.titleValues).toBeUndefined();
  });
});

describe("readTitleValues", () => {
  test("reads an object of a few short texts", () => {
    expect(readTitleValues(JSON.stringify({ tool: "PagerDuty" }))).toEqual({
      tool: "PagerDuty",
    });
    expect(
      readTitleValues(JSON.stringify({ tool: "Splunk On-Call", count: "2" })),
    ).toEqual({ tool: "Splunk On-Call", count: "2" });
  });

  test.each<[string, string | undefined]>([
    ["nothing", undefined],
    ["an empty text", ""],
    ["text that is no JSON", "{tool: PagerDuty"],
    ["a list", JSON.stringify(["PagerDuty"])],
    ["a text", JSON.stringify("PagerDuty")],
    ["null", "null"],
    ["an empty object", "{}"],
    ["a value that is no text", JSON.stringify({ tool: 4 })],
    ["an empty value", JSON.stringify({ tool: "  " })],
    ["a value too long", JSON.stringify({ tool: "x".repeat(101) })],
    [
      "too many values",
      JSON.stringify({ a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" }),
    ],
    ["a name that is no word", JSON.stringify({ "to ol": "PagerDuty" })],
    ["a text too long to read", JSON.stringify({ tool: "x".repeat(2000) })],
  ])("reads none from %s", (_case: string, json: string | undefined) => {
    expect(readTitleValues(json)).toBeUndefined();
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
