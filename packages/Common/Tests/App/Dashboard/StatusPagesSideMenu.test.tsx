import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";

/*
 * THE STATUS PAGES MENU (#9126).
 *
 *   - Announcements, written most weeks, sat alone in a section called
 *     "More", which said nothing of what it held. It now sits beside All
 *     Status Pages, the status pages it goes out on.
 *   - Owner Rules and Label Rules sat under Settings, where no other product
 *     files them. They have a Rules section of their own, folded, as
 *     Incidents, Alerts and Maintenance do, at the same addresses.
 *
 * The real menu is rendered against the real RouteMap.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

import StatusPagesSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/SideMenu";
import { getStatusPagesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/StatusPagesBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Link from "../../../Types/Link";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

async function renderStatusPagesMenu(): Promise<void> {
  await renderMenu(<StatusPagesSideMenu />);
}

function trailOf(pageMapKey: string): Array<string> {
  const pattern: string = RouteUtil.getRouteString(pageMapKey);

  return (getStatusPagesBreadcrumbs(pattern) || []).map(
    (link: Link): string => {
      return link.title;
    },
  );
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/status-pages`);
});

afterEach(() => {
  cleanup();
});

describe("Status Pages side menu", () => {
  test("lists its daily pages first, then Rules, Settings, Advanced and Developer, with no More", async () => {
    await renderStatusPagesMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Status Pages",
      "Rules",
      "Settings",
      "Advanced",
      "Developer",
    ]);
  });

  test("Announcements sit beside All Status Pages, at the same address", async () => {
    await renderStatusPagesMenu();

    expect(linksIn("Status Pages")).toEqual([
      { title: "All Status Pages", href: routeFor(PageMap.STATUS_PAGES) },
      {
        title: "Announcements",
        href: routeFor(PageMap.STATUS_PAGE_ANNOUNCEMENTS),
      },
    ]);
    expect(iconCountIn("Status Pages")).toBe(2);
    expect(isExpanded("Status Pages")).toBe(true);
  });

  test("Rules holds Owner Rules and Label Rules, at their old addresses, then their history", async () => {
    await renderStatusPagesMenu();

    expect(linksIn("Rules")).toEqual([
      {
        title: "Owner Rules",
        href: routeFor(PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES),
      },
      {
        title: "Label Rules",
        href: routeFor(PageMap.STATUS_PAGES_SETTINGS_LABEL_RULES),
      },
      // Who changed the rules above, what and when (#10462).
      {
        title: "Audit Logs",
        href: routeFor(PageMap.STATUS_PAGES_SETTINGS_RULES_AUDIT_LOGS),
      },
    ]);
    expect(routeFor(PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES)).toBe(
      `/dashboard/${PROJECT_ID}/status-pages/settings/owner-rules`,
    );
    expect(routeFor(PageMap.STATUS_PAGES_SETTINGS_RULES_AUDIT_LOGS)).toBe(
      `/dashboard/${PROJECT_ID}/status-pages/settings/rules-audit-logs`,
    );
    expect(iconCountIn("Rules")).toBe(3);
  });

  test("Rules opens itself on the rules' Audit Logs page, and marks it", async () => {
    goTo(routeFor(PageMap.STATUS_PAGES_SETTINGS_RULES_AUDIT_LOGS));
    await renderStatusPagesMenu();

    expect(isExpanded("Rules")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Audit Logs"]);
    expect(isExpanded("Settings")).toBe(false);
  });

  test("Settings keeps what is not a rule", async () => {
    await renderStatusPagesMenu();

    expect(
      linksIn("Settings").map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual([
      "Announcement Templates",
      "Subscriber Templates",
      "Custom Fields",
    ]);
  });

  test("Rules starts folded, opens with a click, and opens itself on a rule's page", async () => {
    await renderStatusPagesMenu();

    expect(isExpanded("Rules")).toBe(false);
    fireEvent.click(sectionToggle("Rules"));
    expect(isExpanded("Rules")).toBe(true);

    cleanup();
    goTo(routeFor(PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES));
    await renderStatusPagesMenu();

    expect(isExpanded("Rules")).toBe(true);
    expect(isExpanded("Settings")).toBe(false);
    expect(activeLinkTitles()).toEqual(["Owner Rules"]);
  });

  test("a rule's trail runs through Rules", () => {
    expect(trailOf(PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES)).toEqual([
      "Project",
      "Status Pages",
      "Rules",
      "Owner Rules",
    ]);
    expect(trailOf(PageMap.STATUS_PAGES_SETTINGS_LABEL_RULE_VIEW)).toEqual([
      "Project",
      "Status Pages",
      "Rules",
      "Label Rules",
      "View Rule",
    ]);
  });

  test("on a phone, Announcements is summed up under Status Pages", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(routeFor(PageMap.STATUS_PAGE_ANNOUNCEMENTS));
    await renderStatusPagesMenu();

    expect(mobileSummaryText()).toContain("Status Pages");
    expect(mobileSummaryText()).toContain("Announcements");
    expect(mobileSummaryText()).not.toContain("More");
  });
});
