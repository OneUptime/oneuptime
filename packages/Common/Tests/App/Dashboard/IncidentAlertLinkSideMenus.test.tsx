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
import React from "react";
import AlertSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/SideMenu";
import IncidentSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  hrefsInMenu,
  isExpanded,
  linksIn,
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
 * The "Linked Alerts" page of an incident and the "Linked Incidents" page of
 * an alert are reached from the record's side menu. Both items go into an
 * existing section - the incident menu's sections are pinned by
 * ResourceAuditLogsSideMenus.test.tsx - and each must light up, with its
 * section expanded, when its page is open.
 */

const MODEL_ID: ObjectID = new ObjectID("0193c0de-3333-4aaa-8bbb-000000000003");

function pageRoute(page: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: MODEL_ID,
  }).toString();
}

interface ExpectedLink {
  title: string;
  page: PageMap;
}

function expectedLinks(links: Array<ExpectedLink>): Array<MenuLink> {
  return links.map((link: ExpectedLink): MenuLink => {
    return { title: link.title, href: pageRoute(link.page) };
  });
}

function activeAnchorIn(section: string, href: string): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    sectionRoot(section).querySelectorAll<HTMLAnchorElement>("a"),
  ).find((candidate: HTMLAnchorElement): boolean => {
    return candidate.getAttribute("href") === href;
  });

  if (!anchor) {
    throw new Error(`No link to ${href} in the ${section} section.`);
  }

  return anchor;
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the incident view side menu", () => {
  test("keeps its sections exactly as they were", async () => {
    goTo(pageRoute(PageMap.INCIDENT_VIEW_ALERTS));
    await renderMenu(<IncidentSideMenu modelId={MODEL_ID} />);

    expect(sectionTitlesInOrder()).toEqual([
      "Overview",
      "Investigation",
      "Team",
      "Notifications",
      "Notes",
      "Advanced",
    ]);
  });

  test("lists Linked Alerts at the end of Investigation", async () => {
    goTo(pageRoute(PageMap.INCIDENT_VIEW));
    await renderMenu(<IncidentSideMenu modelId={MODEL_ID} />);

    expect(linksIn("Investigation")).toEqual(
      expectedLinks([
        { title: "Description", page: PageMap.INCIDENT_VIEW_DESCRIPTION },
        { title: "Root Cause", page: PageMap.INCIDENT_VIEW_ROOT_CAUSE },
        { title: "Remediation", page: PageMap.INCIDENT_VIEW_REMEDIATION },
        { title: "Runbooks", page: PageMap.INCIDENT_VIEW_RUNBOOKS },
        { title: "Postmortem", page: PageMap.INCIDENT_VIEW_POSTMORTEM },
        { title: "Linked Alerts", page: PageMap.INCIDENT_VIEW_ALERTS },
      ]),
    );
  });

  test("leaves the pinned Advanced section alone", async () => {
    goTo(pageRoute(PageMap.INCIDENT_VIEW));
    await renderMenu(<IncidentSideMenu modelId={MODEL_ID} />);

    expect(linksIn("Advanced")).toEqual(
      expectedLinks([
        { title: "Custom Fields", page: PageMap.INCIDENT_VIEW_CUSTOM_FIELDS },
        { title: "Settings", page: PageMap.INCIDENT_VIEW_SETTINGS },
        { title: "Audit Logs", page: PageMap.INCIDENT_VIEW_AUDIT_LOGS },
        { title: "Delete Incident", page: PageMap.INCIDENT_VIEW_DELETE },
      ]),
    );
  });

  test("marks Linked Alerts active on its page and expands Investigation", async () => {
    const linkedAlerts: string = pageRoute(PageMap.INCIDENT_VIEW_ALERTS);

    goTo(linkedAlerts);
    await renderMenu(<IncidentSideMenu modelId={MODEL_ID} />);

    expect(linkedAlerts).toBe(
      `/dashboard/${PROJECT_ID}/incidents/${MODEL_ID.toString()}/alerts`,
    );
    expect(activeAnchorIn("Investigation", linkedAlerts)).toHaveClass(
      "bg-indigo-50",
      "text-indigo-700",
    );
    expect(isExpanded("Investigation")).toBe(true);
  });

  test("links every page once, fully populated", async () => {
    goTo(pageRoute(PageMap.INCIDENT_VIEW_ALERTS));
    await renderMenu(<IncidentSideMenu modelId={MODEL_ID} />);

    const hrefs: Array<string> = hrefsInMenu();

    expect(hrefs).toEqual(Array.from(new Set(hrefs)));
    hrefs.forEach((href: string) => {
      expect(href).not.toContain(":projectId");
      expect(href).not.toContain(":modelId");
    });
  });
});

describe("the alert view side menu", () => {
  test("keeps its sections", async () => {
    goTo(pageRoute(PageMap.ALERT_VIEW_INCIDENTS));
    await renderMenu(<AlertSideMenu modelId={MODEL_ID} />);

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "On Call",
      "Logs",
      "Alert Notes",
      "Advanced",
    ]);
  });

  test("lists Linked Incidents at the end of Basic", async () => {
    goTo(pageRoute(PageMap.ALERT_VIEW));
    await renderMenu(<AlertSideMenu modelId={MODEL_ID} />);

    expect(linksIn("Basic")).toEqual(
      expectedLinks([
        { title: "Overview", page: PageMap.ALERT_VIEW },
        { title: "Description", page: PageMap.ALERT_VIEW_DESCRIPTION },
        { title: "Root Cause", page: PageMap.ALERT_VIEW_ROOT_CAUSE },
        { title: "Remediation", page: PageMap.ALERT_VIEW_REMEDIATION },
        { title: "Runbooks", page: PageMap.ALERT_VIEW_RUNBOOKS },
        { title: "State Timeline", page: PageMap.ALERT_VIEW_STATE_TIMELINE },
        { title: "Owners", page: PageMap.ALERT_VIEW_OWNERS },
        { title: "Linked Incidents", page: PageMap.ALERT_VIEW_INCIDENTS },
      ]),
    );
  });

  test("marks Linked Incidents active on its page and expands Basic", async () => {
    const linkedIncidents: string = pageRoute(PageMap.ALERT_VIEW_INCIDENTS);

    goTo(linkedIncidents);
    await renderMenu(<AlertSideMenu modelId={MODEL_ID} />);

    expect(linkedIncidents).toBe(
      `/dashboard/${PROJECT_ID}/alerts/${MODEL_ID.toString()}/incidents`,
    );
    expect(activeAnchorIn("Basic", linkedIncidents)).toHaveClass(
      "bg-indigo-50",
      "text-indigo-700",
    );
    expect(isExpanded("Basic")).toBe(true);
  });

  test("links every page once, fully populated", async () => {
    goTo(pageRoute(PageMap.ALERT_VIEW_INCIDENTS));
    await renderMenu(<AlertSideMenu modelId={MODEL_ID} />);

    const hrefs: Array<string> = hrefsInMenu();

    expect(hrefs).toEqual(Array.from(new Set(hrefs)));
    hrefs.forEach((href: string) => {
      expect(href).not.toContain(":projectId");
      expect(href).not.toContain(":modelId");
    });
  });
});
