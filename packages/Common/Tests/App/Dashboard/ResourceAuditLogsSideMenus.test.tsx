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
import React, { ReactElement } from "react";
import IncidentSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/SideMenu";
import MonitorSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/SideMenu";
import SloSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/SideMenu";
import StatusPageSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  sectionRoot,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * The SLO menu badges its Alerts and Incidents items with open counts, which
 * first look up the project's unresolved states. No unresolved states means
 * nothing can be open, so the menu issues no count request and this suite
 * never reaches for the network. The badges themselves are covered by
 * SloViewSideMenuCounts.test.tsx.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: () => {
        return Promise.resolve([]);
      },
    },
  };
});

const MODEL_ID: ObjectID = new ObjectID("0193c0de-3333-4aaa-8bbb-000000000003");

interface ExpectedLink {
  title: string;
  page: PageMap;
}

interface ResourceAuditMenuCase {
  name: string;
  menu: () => ReactElement;
  auditPage: PageMap;
  auditSection: string;
  sections: Array<string>;
  auditSectionLinks: Array<ExpectedLink>;
}

const RESOURCE_CASES: Array<ResourceAuditMenuCase> = [
  {
    name: "Incident",
    menu: (): ReactElement => {
      return <IncidentSideMenu modelId={MODEL_ID} />;
    },
    auditPage: PageMap.INCIDENT_VIEW_AUDIT_LOGS,
    auditSection: "Advanced",
    sections: [
      "Overview",
      "Investigation",
      "Team",
      "Notifications",
      "Notes",
      "Advanced",
    ],
    auditSectionLinks: [
      {
        title: "Custom Fields",
        page: PageMap.INCIDENT_VIEW_CUSTOM_FIELDS,
      },
      { title: "Settings", page: PageMap.INCIDENT_VIEW_SETTINGS },
      { title: "Audit Logs", page: PageMap.INCIDENT_VIEW_AUDIT_LOGS },
      { title: "Delete Incident", page: PageMap.INCIDENT_VIEW_DELETE },
    ],
  },
  {
    name: "Monitor",
    menu: (): ReactElement => {
      return (
        <MonitorSideMenu modelId={MODEL_ID} monitorType={MonitorType.Website} />
      );
    },
    auditPage: PageMap.MONITOR_VIEW_AUDIT_LOGS,
    auditSection: "Advanced",
    sections: ["Overview", "Activity", "Configuration", "Advanced"],
    auditSectionLinks: [
      { title: "Owners", page: PageMap.MONITOR_VIEW_OWNERS },
      { title: "Custom Fields", page: PageMap.MONITOR_VIEW_CUSTOM_FIELDS },
      { title: "Settings", page: PageMap.MONITOR_VIEW_SETTINGS },
      { title: "Audit Logs", page: PageMap.MONITOR_VIEW_AUDIT_LOGS },
      { title: "Delete Monitor", page: PageMap.MONITOR_VIEW_DELETE },
    ],
  },
  {
    name: "SLO",
    menu: (): ReactElement => {
      return <SloSideMenu modelId={MODEL_ID} />;
    },
    auditPage: PageMap.SLO_VIEW_AUDIT_LOGS,
    auditSection: "Management",
    sections: ["Overview", "Activity", "Configuration", "Management"],
    auditSectionLinks: [
      { title: "Owners", page: PageMap.SLO_VIEW_OWNERS },
      { title: "Settings", page: PageMap.SLO_VIEW_SETTINGS },
      { title: "Audit Logs", page: PageMap.SLO_VIEW_AUDIT_LOGS },
      { title: "Delete SLO", page: PageMap.SLO_VIEW_DELETE },
    ],
  },
  {
    name: "Status Page",
    menu: (): ReactElement => {
      return <StatusPageSideMenu modelId={MODEL_ID} />;
    },
    auditPage: PageMap.STATUS_PAGE_VIEW_AUDIT_LOGS,
    auditSection: "Advanced",
    sections: [
      "Basic",
      "Resources",
      "Subscribers",
      "Notification Logs",
      "Branding",
      "Security",
      "AI",
      "Advanced",
    ],
    auditSectionLinks: [
      { title: "Embedded Status", page: PageMap.STATUS_PAGE_VIEW_EMBEDDED },
      { title: "Reports", page: PageMap.STATUS_PAGE_VIEW_REPORTS },
      {
        title: "Custom Fields",
        page: PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS,
      },
      {
        title: "Advanced Settings",
        page: PageMap.STATUS_PAGE_VIEW_SETTINGS,
      },
      {
        title: "Audit Logs",
        page: PageMap.STATUS_PAGE_VIEW_AUDIT_LOGS,
      },
      {
        title: "Delete Status Page",
        page: PageMap.STATUS_PAGE_VIEW_DELETE,
      },
    ],
  },
];

function resourceRoute(page: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: MODEL_ID,
  }).toString();
}

async function renderAuditPage(
  resource: ResourceAuditMenuCase,
): Promise<string> {
  const auditPath: string = resourceRoute(resource.auditPage);
  goTo(auditPath);
  await renderMenu(resource.menu());

  return auditPath;
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe.each(RESOURCE_CASES)(
  "$name resource Audit Logs menu",
  (resource: ResourceAuditMenuCase) => {
    test("uses the expected sections and has no legacy Audit, Manage, or Settings section", async () => {
      await renderAuditPage(resource);

      expect(sectionTitlesInOrder()).toEqual(resource.sections);
      expect(sectionTitlesInOrder()).not.toContain("Audit");
      expect(sectionTitlesInOrder()).not.toContain("Manage");
      expect(sectionTitlesInOrder()).not.toContain("Settings");
    });

    test("keeps every destination in the audit section in the expected order", async () => {
      await renderAuditPage(resource);

      expect(linksIn(resource.auditSection)).toEqual(
        resource.auditSectionLinks.map((link: ExpectedLink): MenuLink => {
          return {
            title: link.title,
            href: resourceRoute(link.page),
          };
        }),
      );
    });

    test("has one fully populated Audit Logs destination and no duplicate hrefs", async () => {
      const auditPath: string = await renderAuditPage(resource);
      const hrefs: Array<string> = hrefsInMenu();

      expect(hrefs).toEqual(Array.from(new Set(hrefs)));
      expect(
        hrefs.filter((href: string): boolean => {
          return href === auditPath;
        }),
      ).toHaveLength(1);

      hrefs.forEach((href: string) => {
        expect(href).toContain(`/dashboard/${PROJECT_ID}/`);
        expect(href).not.toContain(":projectId");
        expect(href).not.toContain(":modelId");
      });
    });

    test("marks Audit Logs active and expands its section", async () => {
      const auditPath: string = await renderAuditPage(resource);
      const auditLogAnchor: HTMLAnchorElement | undefined = Array.from(
        sectionRoot(resource.auditSection).querySelectorAll<HTMLAnchorElement>(
          "a",
        ),
      ).find((anchor: HTMLAnchorElement): boolean => {
        return anchor.getAttribute("href") === auditPath;
      });

      expect(auditLogAnchor).toBeDefined();
      expect(auditLogAnchor).toHaveClass("bg-indigo-50", "text-indigo-700");
      expect(isExpanded(resource.auditSection)).toBe(true);
    });

    test("names the Audit Logs section in the mobile summary", async () => {
      setViewportWidth(MOBILE_WIDTH);

      await renderAuditPage(resource);

      expect(mobileSummaryText()).toContain(
        `${resource.auditSection} / Audit Logs`,
      );
    });

    test("retains a visible label and icon for every destination", async () => {
      await renderAuditPage(resource);

      sectionTitlesInOrder().forEach((sectionTitle: string) => {
        const links: Array<MenuLink> = linksIn(sectionTitle);

        expect(iconCountIn(sectionTitle)).toBe(links.length);
        links.forEach((link: MenuLink) => {
          expect(link.title).not.toBe("");
        });
      });
    });
  },
);

/*
 * SLO performance and activity precede configuration. Charts remains absent:
 * its history lives in Metrics, and its route only survives for bookmarks.
 */
const SLO_SECTION_LINKS: Array<ExpectedLink> = [
  { title: "Overview", page: PageMap.SLO_VIEW },
  { title: "Metrics", page: PageMap.SLO_VIEW_METRICS },
  { title: "Incidents", page: PageMap.SLO_VIEW_INCIDENTS },
  { title: "Alerts", page: PageMap.SLO_VIEW_ALERTS },
  { title: "Feed", page: PageMap.SLO_VIEW_FEED },
  { title: "Monitors", page: PageMap.SLO_VIEW_MONITORS },
  { title: "Monitor Rules", page: PageMap.SLO_VIEW_MONITOR_RULES },
  { title: "Burn Rate Rules", page: PageMap.SLO_VIEW_BURN_RATE_RULES },
];

describe("SLO resource menu", () => {
  test("keeps every SLO destination in the expected order", async () => {
    const slo: ResourceAuditMenuCase | undefined = RESOURCE_CASES.find(
      (resource: ResourceAuditMenuCase): boolean => {
        return resource.name === "SLO";
      },
    );

    expect(slo).toBeDefined();

    await renderAuditPage(slo!);

    expect([
      ...linksIn("Overview"),
      ...linksIn("Activity"),
      ...linksIn("Configuration"),
    ]).toEqual(
      SLO_SECTION_LINKS.map((link: ExpectedLink): MenuLink => {
        return {
          title: link.title,
          href: resourceRoute(link.page),
        };
      }),
    );
    expect(hrefsInMenu()).not.toContain(resourceRoute(PageMap.SLO_VIEW_CHARTS));
  });
});
