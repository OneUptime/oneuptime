import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { matchRoutes } from "react-router-dom";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
  SecurityEventsRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  getSecurityEventsBreadcrumbPages,
  getSecurityEventsBreadcrumbs,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SecurityEventsBreadcrumbs";
import {
  SECURITY_EVENTS_DETAIL_PAGES,
  SECURITY_EVENTS_REDIRECTED_PAGES,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import Page from "../../../UI/Components/Page/Page";
import Navigation from "../../../UI/Utils/Navigation";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

/*
 * Every Security Events page names where it is the way the side menu does
 * - Project > Security Events > Security Cases > Assigned to Me - and every
 * crumb opens what its name says: Security Events the product's Overview,
 * a section its first page, the page itself nothing. Checked the way
 * BreadcrumbCoverage checks the other products: through the router's own
 * inventory, with each trail drawn in the real Page header.
 */

const CASE_ID: string = "7b3b1548-23cd-46ab-8359-280eb34362af";
const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;

const realRoutes: Array<{ path: string }> = Object.values(RouteMap)
  .map((route: Route): { path: string } => {
    return { path: route.toString() };
  })
  .filter((route: { path: string }): boolean => {
    return !route.path.includes("*");
  });

function visit(page: string): string {
  const path: string = RouteUtil.getRouteString(page)
    .replace(":projectId", PROJECT_ID)
    .replace(":id", CASE_ID);
  goTo(path);
  return path;
}

function trailOf(page: string): Array<[string, string]> {
  visit(page);
  const links: Array<Link> | undefined = getSecurityEventsBreadcrumbs(
    Navigation.getRoutePath(RouteUtil.getRoutes()),
  );

  return (links || []).map((link: Link): [string, string] => {
    return [link.title, link.to.toString()];
  });
}

afterEach(() => {
  cleanup();
});

describe("every Security Events page has a trail", () => {
  test("for every routed page but the old Monitors address", () => {
    expect([...getSecurityEventsBreadcrumbPages()].sort()).toEqual(
      Object.keys(SecurityEventsRoutePath)
        .filter((page: string): boolean => {
          return !SECURITY_EVENTS_REDIRECTED_PAGES.includes(page as PageMap);
        })
        .sort(),
    );
    for (const page of SECURITY_EVENTS_DETAIL_PAGES) {
      expect(getSecurityEventsBreadcrumbPages()).toContain(page);
    }
  });

  test.each(getSecurityEventsBreadcrumbPages())(
    "%s: complete and navigable, through the Page header",
    (page: string) => {
      const currentPath: string = visit(page);
      const matchedPath: string = Navigation.getRoutePath(
        RouteUtil.getRoutes(),
      );

      // Its own route, never a case's for a page's word, nor the reverse.
      expect(matchedPath).toBe(RouteUtil.getRouteString(page));

      const links: Array<Link> | undefined =
        getSecurityEventsBreadcrumbs(matchedPath);

      expect(links).toBeDefined();
      expect(links![0]?.title).toBe("Project");
      expect(links![0]?.to.toString()).toBe(`/dashboard/${PROJECT_ID}`);
      expect(links![links!.length - 1]?.to.toString()).toBe(currentPath);

      for (const link of links!) {
        expect(link.title.trim().length).toBeGreaterThan(0);
        expect(link.to.toString()).not.toMatch(/[:*]/);
        expect(matchRoutes(realRoutes, link.to.toString())).not.toBeNull();
      }

      render(
        <Page title="Security Events" breadcrumbLinks={links}>
          <div>Page content</div>
        </Page>,
      );

      const trail: HTMLElement = screen.getByRole("navigation", {
        name: "Breadcrumb",
      });

      expect(within(trail).getAllByRole("listitem")).toHaveLength(
        links!.length,
      );
      // No crumb links to the page it is on.
      for (const anchor of within(trail).queryAllByRole("link")) {
        expect(anchor.getAttribute("href")).not.toBe(currentPath);
      }
    },
  );

  test("invents nothing for a page that is not Security Events'", () => {
    visit(PageMap.SECURITY_EVENTS_OVERVIEW);
    expect(getSecurityEventsBreadcrumbs("/not-a-page")).toBeUndefined();
    expect(
      getSecurityEventsBreadcrumbs(
        RouteUtil.getRouteString(PageMap.SECURITY_EVENTS_MONITORS),
      ),
    ).toBeUndefined();
  });
});

describe("each trail names the page as the menu does", () => {
  test.each([
    [PageMap.SECURITY_EVENTS_OVERVIEW, ["Security Events", "Overview"]],
    [
      PageMap.SECURITY_CASES,
      ["Security Events", "Security Cases", "Open Cases"],
    ],
    [
      PageMap.SECURITY_CASES_ASSIGNED_TO_ME,
      ["Security Events", "Security Cases", "Assigned to Me"],
    ],
    [
      PageMap.SECURITY_CASES_UNASSIGNED,
      ["Security Events", "Security Cases", "Unassigned"],
    ],
    [
      PageMap.SECURITY_CASES_CLOSED,
      ["Security Events", "Security Cases", "Closed Cases"],
    ],
    [
      PageMap.SECURITY_CASES_ALL,
      ["Security Events", "Security Cases", "All Cases"],
    ],
    [
      PageMap.SECURITY_CASE_VIEW,
      ["Security Events", "Security Cases", "View Case"],
    ],
    [PageMap.SECURITY_EVENTS, ["Security Events", "Events"]],
    [
      PageMap.SECURITY_EVENTS_ENTITIES,
      ["Security Events", "Events", "Entities"],
    ],
    [
      PageMap.SECURITY_EVENTS_CORRELATE,
      ["Security Events", "Events", "Correlate"],
    ],
    [
      PageMap.SECURITY_EVENTS_DETECTION_RULES,
      ["Security Events", "Detections", "Detection Rules"],
    ],
    [
      PageMap.SECURITY_EVENTS_RULE_LIBRARY,
      ["Security Events", "Detections", "Rule Library"],
    ],
    [
      PageMap.SECURITY_EVENTS_THREAT_INTEL,
      ["Security Events", "Detections", "Threat Intel"],
    ],
    [
      PageMap.SECURITY_EVENTS_ATTACK_COVERAGE,
      ["Security Events", "Detections", "ATT&CK Coverage"],
    ],
    [PageMap.SECURITY_PLAYBOOKS, ["Security Events", "Playbooks"]],
    [
      PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL,
      ["Security Events", "Playbooks", "Waiting for Approval"],
    ],
    [
      PageMap.SECURITY_PLAYBOOK_RUNS,
      ["Security Events", "Playbooks", "Playbook Runs"],
    ],
    [
      PageMap.SECURITY_PLAYBOOK_VIEW,
      ["Security Events", "Playbooks", "View Playbook"],
    ],
    [PageMap.SECURITY_EVENTS_CONNECTIONS, ["Security Events", "Connections"]],
    [
      PageMap.SECURITY_EVENTS_DOCUMENTATION,
      ["Security Events", "Connections", "Setup Guide"],
    ],
  ])("%s: Project > %s", (page: string, titles: Array<string>) => {
    expect(
      trailOf(page).map(([title]: [string, string]): string => {
        return title;
      }),
    ).toEqual(["Project", ...titles]);
  });
});

describe("each crumb opens what its name says", () => {
  test("Security Events opens the Overview, where the Products menu opens the product", () => {
    for (const page of [
      PageMap.SECURITY_CASES_CLOSED,
      PageMap.SECURITY_EVENTS,
      PageMap.SECURITY_PLAYBOOK_RUNS,
      PageMap.SECURITY_CASE_VIEW,
    ]) {
      expect([page, trailOf(page)[1]]).toEqual([
        page,
        ["Security Events", routeFor(PageMap.SECURITY_EVENTS_OVERVIEW)],
      ]);
    }
  });

  test("a section opens its first page: Security Cases its open cases, Playbooks its playbooks", () => {
    expect(trailOf(PageMap.SECURITY_CASES_ALL)[2]).toEqual([
      "Security Cases",
      routeFor(PageMap.SECURITY_CASES),
    ]);
    expect(trailOf(PageMap.SECURITY_CASE_VIEW)[2]).toEqual([
      "Security Cases",
      routeFor(PageMap.SECURITY_CASES),
    ]);
    // Not the runs waiting for approval, which share the runs' address.
    expect(trailOf(PageMap.SECURITY_PLAYBOOK_RUNS)[2]).toEqual([
      "Playbooks",
      routeFor(PageMap.SECURITY_PLAYBOOKS),
    ]);
    expect(trailOf(PageMap.SECURITY_PLAYBOOK_VIEW)[2]).toEqual([
      "Playbooks",
      routeFor(PageMap.SECURITY_PLAYBOOKS),
    ]);
    expect(trailOf(PageMap.SECURITY_EVENTS_THREAT_INTEL)[2]).toEqual([
      "Detections",
      routeFor(PageMap.SECURITY_EVENTS_DETECTION_RULES),
    ]);
    expect(trailOf(PageMap.SECURITY_EVENTS_CORRELATE)[2]).toEqual([
      "Events",
      routeFor(PageMap.SECURITY_EVENTS),
    ]);
    expect(trailOf(PageMap.SECURITY_EVENTS_DOCUMENTATION)[2]).toEqual([
      "Connections",
      routeFor(PageMap.SECURITY_EVENTS_CONNECTIONS),
    ]);
  });

  test("on a section's first page, its section names the page it is on, not a link", () => {
    const currentPath: string = visit(PageMap.SECURITY_CASES);
    const links: Array<Link> = getSecurityEventsBreadcrumbs(
      Navigation.getRoutePath(RouteUtil.getRoutes()),
    )!;

    expect(links[2]?.to.toString()).toBe(currentPath);

    render(
      <Page title="Security Events" breadcrumbLinks={links}>
        <div>Page content</div>
      </Page>,
    );

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });

    expect(
      within(trail)
        .queryAllByRole("link")
        .map((anchor: HTMLElement): string => {
          return (anchor.textContent || "").trim();
        }),
    ).toEqual(["Project", "Security Events"]);
  });

  test("a case's own page sits under its list, by its id", () => {
    expect(trailOf(PageMap.SECURITY_CASE_VIEW)[3]).toEqual([
      "View Case",
      `${PRODUCT}/cases/${CASE_ID}`,
    ]);
  });
});
