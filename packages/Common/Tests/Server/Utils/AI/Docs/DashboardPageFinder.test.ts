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
