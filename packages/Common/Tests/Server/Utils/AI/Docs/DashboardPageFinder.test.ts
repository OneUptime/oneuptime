import { describe, expect, test } from "@jest/globals";
import DashboardPageFinder, {
  AI_DASHBOARD_PAGES,
  AIDashboardPage,
  AIDashboardPageKind,
  tokenizePageName,
} from "../../../../../Server/Utils/AI/Docs/DashboardPageFinder";

/*
 * find_dashboard_page's search (issue #6828): the model names a page as
 * the docs or the menus do, and the finder answers with the catalog's page
 * of that name - the one a common name ("Custom Fields") means where it is
 * said, a page before a setting on it, and never a billing page where
 * billing is off.
 */

const PAGES: Array<AIDashboardPage> = [
  {
    title: "Custom Fields",
    where: ["Incidents", "Settings"],
    path: "/dashboard/:projectId/incidents/settings/custom-fields",
    kind: AIDashboardPageKind.Page,
  },
  {
    title: "Custom Fields",
    where: ["Status Pages", "Settings"],
    path: "/dashboard/:projectId/status-pages/settings/custom-fields",
    kind: AIDashboardPageKind.Page,
  },
  {
    title: "Notification Methods",
    where: ["User Settings", "Alerts & Notifications"],
    keywords: ["add phone number", "sms"],
    path: "/dashboard/:projectId/user-settings/notification-methods",
    kind: AIDashboardPageKind.Page,
  },
  {
    title: "Phone Numbers for SMS Notifications",
    where: ["User Settings", "Alerts & Notifications", "Notification Methods"],
    path: "/dashboard/:projectId/user-settings/notification-methods",
    kind: AIDashboardPageKind.Setting,
  },
  {
    title: "Billing",
    where: ["Project Settings"],
    path: "/dashboard/:projectId/settings/billing",
    kind: AIDashboardPageKind.Page,
    billing: true,
  },
];

const find: (query: string, isBillingEnabled?: boolean) => Array<string> = (
  query: string,
  isBillingEnabled?: boolean,
): Array<string> => {
  return DashboardPageFinder.find({
    query,
    limit: 5,
    isBillingEnabled: isBillingEnabled ?? true,
    pages: PAGES,
  }).map((page: AIDashboardPage): string => {
    return `${page.where.join(" > ")} > ${page.title}`;
  });
};

describe("tokenizePageName", () => {
  test("lowercases, drops filler words and endings, and keeps other scripts whole", () => {
    expect(tokenizePageName("The Notification Methods page")).toEqual([
      "notification",
      "method",
    ]);
    expect(tokenizePageName("On-Call Policies")).toEqual([
      "on",
      "call",
      "polici",
    ]);
    expect(tokenizePageName("روش‌های اعلان")).toEqual(["روش", "های", "اعلان"]);
  });
});

describe("DashboardPageFinder.find", () => {
  test("a page named exactly so comes first", () => {
    expect(find("Notification Methods")[0]).toBe(
      "User Settings > Alerts & Notifications > Notification Methods",
    );
  });

  test("a common name means the one where it is said", () => {
    expect(find("Status Pages Custom Fields")[0]).toBe(
      "Status Pages > Settings > Custom Fields",
    );
    expect(find("Incidents Custom Fields")[0]).toBe(
      "Incidents > Settings > Custom Fields",
    );
  });

  test("a page named by its place and name comes before one whose own name merely holds the words", () => {
    const found: Array<AIDashboardPage> = DashboardPageFinder.find({
      query: "Incidents Custom Fields",
      limit: 2,
      isBillingEnabled: true,
      pages: [
        {
          title: "Incidents Custom Fields Report",
          where: ["Reports"],
          path: "/dashboard/:projectId/reports",
          kind: AIDashboardPageKind.Page,
        },
        PAGES[0]!,
      ],
    });

    expect(found[0]?.path).toBe(
      "/dashboard/:projectId/incidents/settings/custom-fields",
    );
  });

  test("finds a setting by its own name, and by words of it", () => {
    expect(find("Phone Numbers for SMS Notifications")[0]).toBe(
      "User Settings > Alerts & Notifications > Notification Methods > Phone Numbers for SMS Notifications",
    );
    expect(find("sms phone number")).toContain(
      "User Settings > Alerts & Notifications > Notification Methods > Phone Numbers for SMS Notifications",
    );
  });

  test("a page's other names find it", () => {
    expect(find("add phone number")[0]).toBe(
      "User Settings > Alerts & Notifications > Notification Methods",
    );
  });

  test("offers a billing page only where billing is on", () => {
    expect(find("Billing", true)).toEqual(["Project Settings > Billing"]);
    expect(find("Billing", false)).toEqual([]);
  });

  test("finds nothing for words no page has, or for no words", () => {
    expect(find("zzqx")).toEqual([]);
    expect(find("the page")).toEqual([]);
  });

  test("keeps to the limit", () => {
    expect(
      DashboardPageFinder.find({
        query: "custom fields",
        limit: 1,
        isBillingEnabled: true,
        pages: PAGES,
      }),
    ).toHaveLength(1);
  });

  test("reads the generated catalog by default", () => {
    expect(AI_DASHBOARD_PAGES.length).toBeGreaterThan(300);
    expect(
      DashboardPageFinder.find({
        query: "API Keys",
        limit: 1,
        isBillingEnabled: false,
      })[0]?.path,
    ).toBe("/dashboard/:projectId/settings/api-keys");
  });
});

/*
 * A name and its place (#8829): two pages may share a name in one area -
 * the Traces explorer's Insights tab and OneUptime AI's Traces > AI >
 * Insights - and their name with the area finds both, OneUptime AI's
 * first. With the place a result gave, only the pages there are found.
 */
describe("DashboardPageFinder.find with a place", () => {
  const INSIGHTS: Array<AIDashboardPage> = [
    {
      title: "Insights",
      where: ["Traces", "AI"],
      path: "/dashboard/:projectId/traces/ai/insights",
      kind: AIDashboardPageKind.Page,
    },
    {
      title: "Insights",
      titleKey: "Insights (explorer analytics)",
      where: ["Traces"],
      path: "/dashboard/:projectId/traces/insights",
      kind: AIDashboardPageKind.Page,
    },
    {
      title: "Insights",
      where: ["Logs"],
      path: "/dashboard/:projectId/logs/insights",
      kind: AIDashboardPageKind.Page,
    },
  ];

  const pathsFor: (query: string, place?: string) => Array<string> = (
    query: string,
    place?: string,
  ): Array<string> => {
    return DashboardPageFinder.find({
      query,
      place,
      limit: 5,
      isBillingEnabled: true,
      pages: INSIGHTS,
    }).map((page: AIDashboardPage): string => {
      return page.path;
    });
  };

  test("without one, a name with its area finds both pages of that name there, the first listed first", () => {
    expect(pathsFor("Traces Insights").slice(0, 2)).toEqual([
      "/dashboard/:projectId/traces/ai/insights",
      "/dashboard/:projectId/traces/insights",
    ]);
  });

  test("finds only the pages in that place, by its words in their order", () => {
    expect(pathsFor("Insights", "Traces")).toEqual([
      "/dashboard/:projectId/traces/insights",
    ]);
    expect(pathsFor("Traces Insights", "Traces")).toEqual([
      "/dashboard/:projectId/traces/insights",
    ]);
    expect(pathsFor("Insights", "Traces > AI")).toEqual([
      "/dashboard/:projectId/traces/ai/insights",
    ]);
    expect(pathsFor("Insights", "traces ai")).toEqual([
      "/dashboard/:projectId/traces/ai/insights",
    ]);
  });

  test("a place is the whole of where a page is: not a part of it, nor its words in another order", () => {
    expect(pathsFor("Insights", "AI")).toEqual([]);
    expect(pathsFor("Insights", "AI > Traces")).toEqual([]);
    expect(pathsFor("Insights", "Traces > AI > More")).toEqual([]);
  });

  test("a place keeps to the name asked for, and to billing", () => {
    expect(pathsFor("zzqx", "Traces")).toEqual([]);
    expect(
      DashboardPageFinder.find({
        query: "Billing",
        place: "Project Settings",
        limit: 5,
        isBillingEnabled: false,
        pages: PAGES,
      }),
    ).toEqual([]);
    expect(
      DashboardPageFinder.find({
        query: "Billing",
        place: "Project Settings",
        limit: 5,
        isBillingEnabled: true,
        pages: PAGES,
      }).map((page: AIDashboardPage): string => {
        return page.path;
      }),
    ).toEqual(["/dashboard/:projectId/settings/billing"]);
  });

  test("a common name in a place: the one said there", () => {
    expect(
      DashboardPageFinder.find({
        query: "Custom Fields",
        place: "Status Pages > Settings",
        limit: 5,
        isBillingEnabled: true,
        pages: PAGES,
      }).map((page: AIDashboardPage): string => {
        return page.path;
      }),
    ).toEqual(["/dashboard/:projectId/status-pages/settings/custom-fields"]);
  });

  test("never reads a page's titleKey: the key's note finds nothing", () => {
    expect(pathsFor("explorer analytics")).toEqual([]);
    expect(pathsFor("explorer analytics", "Traces")).toEqual([]);
  });
});
