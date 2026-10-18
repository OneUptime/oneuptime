import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";

// Badge counts: nothing open, nothing to count, no network.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

import StatusPageViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SideMenu";
import StatusPagesSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/SideMenu";
import { getStatusPagesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/StatusPagesBreadcrumbs";
import { DEVELOPER_DOCS_SECTION_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * Every Status Pages page has a breadcrumb trail, and the trail calls the
 * page what the side menu calls it.
 *
 * Embedded Status, Reports, SCIM, Audit Logs, the Slack and Microsoft Teams
 * subscribers and the status page Owner and Label Rules opened with no trail
 * at all, and four pages had two names: "Domains" under the menu's Custom
 * Domains, "Settings" under Advanced Settings, "Custom HTML, CSS &
 * JavaScript" under HTML, CSS & JavaScript, and "Subscriber Notification
 * Templates" under Subscriber Templates (with "All Announcements" over the
 * menu's Announcements).
 *
 * The menus are rendered for real, and each link is followed to the page key
 * its address belongs to and that page's trail.
 */

const MODEL_ID: string = "0193c0de-5555-4aaa-8bbb-0000000000c8";

/*
 * The two entries named for something other than their page: Overview is
 * the status page itself, and the Resources page is "Monitors" in the menu
 * while a project has no monitor groups (its card says Resources either
 * way). All Status Pages is the list, named for the product.
 */
const TRAIL_NAMES: Record<string, string> = {
  Overview: "View Status Page",
  Monitors: "Resources",
  "All Status Pages": "Status Pages",
};

// The Status Pages page keys, with the address each one has for this page.
function statusPageKeys(): Array<string> {
  return Object.values(PageMap).filter((key: string): boolean => {
    return (
      (key.startsWith("STATUS_PAGE") || key.startsWith("ANNOUNCEMENT")) &&
      Boolean(RouteMap[key])
    );
  });
}

function addressOf(key: string): string {
  return RouteUtil.populateRouteParams(RouteMap[key] as Route, {
    modelId: new ObjectID(MODEL_ID),
  }).toString();
}

function pageKeyFor(href: string): string | undefined {
  return statusPageKeys().find((key: string): boolean => {
    return addressOf(key) === href;
  });
}

function trailOf(key: string): Array<string> | undefined {
  const links: Array<Link> | undefined = getStatusPagesBreadcrumbs(
    (RouteMap[key] as Route).toString(),
  );

  return links?.map((link: Link): string => {
    return link.title;
  });
}

// Every link the menu draws, but the Developer pages, which are shared.
function menuLinks(): Array<MenuLink> {
  return sectionTitlesInOrder()
    .filter((title: string): boolean => {
      return title.toLowerCase() !== DEVELOPER_DOCS_SECTION_TITLE.toLowerCase();
    })
    .flatMap((title: string): Array<MenuLink> => {
      return linksIn(title);
    });
}

interface Mismatch {
  menu: string;
  trail: Array<string> | undefined;
}

function mismatches(links: Array<MenuLink>): Array<Mismatch> {
  const found: Array<Mismatch> = [];

  for (const link of links) {
    const key: string | undefined = pageKeyFor(link.href);
    const trail: Array<string> | undefined = key ? trailOf(key) : undefined;
    const expected: string = TRAIL_NAMES[link.title] || link.title;

    if (!trail || trail[trail.length - 1] !== expected) {
      found.push({ menu: link.title, trail: trail });
    }
  }

  return found;
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("a status page's menu and its breadcrumbs", () => {
  test("every entry opens a page whose trail ends with the entry's name", async () => {
    goTo(addressOf(PageMap.STATUS_PAGE_VIEW));
    await renderMenu(
      <StatusPageViewSideMenu modelId={new ObjectID(MODEL_ID)} />,
    );

    const links: Array<MenuLink> = menuLinks();

    // The menu is really read: its sections, past Subscribers and Branding.
    expect(links.length).toBeGreaterThan(25);
    expect(mismatches(links)).toEqual([]);
  });

  test.each([
    [PageMap.STATUS_PAGE_VIEW_DOMAINS, "Custom Domains"],
    [PageMap.STATUS_PAGE_VIEW_SETTINGS, "Advanced Settings"],
    [PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS, "HTML, CSS & JavaScript"],
    [PageMap.STATUS_PAGE_VIEW_EMBEDDED, "Embedded Status"],
    [PageMap.STATUS_PAGE_VIEW_REPORTS, "Reports"],
    [PageMap.STATUS_PAGE_VIEW_SCIM, "SCIM"],
    [PageMap.STATUS_PAGE_VIEW_AUDIT_LOGS, "Audit Logs"],
    [PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS, "Slack Subscribers"],
    [
      PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS,
      "Microsoft Teams Subscribers",
    ],
  ])(
    "%s is Project > Status Pages > View Status Page > %s",
    (key: string, name: string) => {
      expect(trailOf(key)).toEqual([
        "Project",
        "Status Pages",
        "View Status Page",
        name,
      ]);
    },
  );
});

describe("the Status Pages menu and its breadcrumbs", () => {
  test("every entry opens a page whose trail ends with the entry's name", async () => {
    goTo(addressOf(PageMap.STATUS_PAGES));
    await renderMenu(<StatusPagesSideMenu />);

    const links: Array<MenuLink> = menuLinks();

    // All Status Pages, Announcements, five settings pages and Archived.
    expect(links.length).toBeGreaterThanOrEqual(8);
    expect(mismatches(links)).toEqual([]);
  });

  test("an announcement and the settings pages sit under the names the menu gives them", () => {
    expect(trailOf(PageMap.STATUS_PAGE_ANNOUNCEMENTS)).toEqual([
      "Project",
      "Status Pages",
      "Announcements",
    ]);
    expect(trailOf(PageMap.ANNOUNCEMENT_VIEW)).toEqual([
      "Project",
      "Status Pages",
      "Announcements",
      "View Announcement",
    ]);
    expect(
      trailOf(PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES),
    ).toEqual(["Project", "Status Pages", "Settings", "Subscriber Templates"]);
    expect(trailOf(PageMap.STATUS_PAGES_SETTINGS_OWNER_RULE_VIEW)).toEqual([
      "Project",
      "Status Pages",
      "Settings",
      "Owner Rules",
      "View Rule",
    ]);
    expect(trailOf(PageMap.STATUS_PAGES_SETTINGS_LABEL_RULE_VIEW)).toEqual([
      "Project",
      "Status Pages",
      "Settings",
      "Label Rules",
      "View Rule",
    ]);
  });
});
