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
  nameEntityInTrail,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SecurityEventsBreadcrumbs";
import {
  SECURITY_EVENTS_DETAIL_PAGES,
  SECURITY_EVENTS_REDIRECTED_PAGES,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import Page from "../../../UI/Components/Page/Page";
import { nameRecordInTrail } from "../../../UI/Components/Page/RecordNameInTrail";
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
  test("for every routed page but the old Monitors and Entities addresses", () => {
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
    // Entities opens Entity Risk, whose trail it then shows.
    expect(
      getSecurityEventsBreadcrumbs(
        RouteUtil.getRouteString(PageMap.SECURITY_EVENTS_ENTITIES),
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
    // A case's pages: the case, then the page as its side menu names it.
    [
      PageMap.SECURITY_CASE_VIEW_TIMELINE,
      ["Security Events", "Security Cases", "View Case", "Timeline"],
    ],
    [
      PageMap.SECURITY_CASE_VIEW_DETECTIONS,
      ["Security Events", "Security Cases", "View Case", "Detections"],
    ],
    [
      PageMap.SECURITY_CASE_VIEW_ENTITIES,
      ["Security Events", "Security Cases", "View Case", "Entities"],
    ],
    [
      PageMap.SECURITY_CASE_VIEW_CONNECTED_SIGNALS,
      ["Security Events", "Security Cases", "View Case", "Connected Signals"],
    ],
    [
      PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS,
      ["Security Events", "Security Cases", "View Case", "Playbooks"],
    ],
    [
      PageMap.SECURITY_CASE_VIEW_NOTES,
      ["Security Events", "Security Cases", "View Case", "Private Notes"],
    ],
    [
      PageMap.SECURITY_CASE_VIEW_AUDIT_LOGS,
      ["Security Events", "Security Cases", "View Case", "Audit Logs"],
    ],
    [
      PageMap.SECURITY_CASE_VIEW_DELETE,
      ["Security Events", "Security Cases", "View Case", "Delete Case"],
    ],
    [PageMap.SECURITY_EVENTS, ["Security Events", "Events"]],
    [
      PageMap.SECURITY_EVENTS_ENTITY_RISK,
      ["Security Events", "Events", "Entity Risk"],
    ],
    // An entity's page, under the list it opens from.
    [
      PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW,
      ["Security Events", "Events", "Entity Risk", "Entity"],
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
      ["Security Events", "Playbooks", "Approvals"],
    ],
    [
      PageMap.SECURITY_PLAYBOOK_RUNS,
      ["Security Events", "Playbooks", "Playbook Runs"],
    ],
    [
      PageMap.SECURITY_PROTECTED_ENTITIES,
      ["Security Events", "Playbooks", "Protected Entities"],
    ],
    [
      PageMap.SECURITY_PLAYBOOK_VIEW,
      ["Security Events", "Playbooks", "View Playbook"],
    ],
    [
      PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK,
      ["Security Events", "Workspace", "Slack"],
    ],
    [
      PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ["Security Events", "Workspace", "Microsoft Teams"],
    ],
    // The page that shows both: the section's own page, named once.
    [
      PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTIONS,
      ["Security Events", "Workspace"],
    ],
    [PageMap.SECURITY_EVENTS_CONNECTIONS, ["Security Events", "Connections"]],
    [
      PageMap.SECURITY_EVENTS_DOCUMENTATION,
      ["Security Events", "Connections", "Setup Guide"],
    ],
    [
      PageMap.SECURITY_EVENTS_SETTINGS_RISK_SCORING,
      ["Security Events", "Settings", "Risk Scoring"],
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

  /*
   * An entity's page sits under Entity Risk, which is not a part of its
   * address the trail can find by walking up it (Events, the section, is no
   * part of the address): the crumb opens the list all the same.
   */
  test("on an entity's page, Entity Risk opens the list, and Events the section's first page", () => {
    const trail: Array<[string, string]> = trailOf(
      PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW,
    );

    expect(trail.slice(1, 4)).toEqual([
      ["Security Events", routeFor(PageMap.SECURITY_EVENTS_OVERVIEW)],
      ["Events", routeFor(PageMap.SECURITY_EVENTS)],
      ["Entity Risk", routeFor(PageMap.SECURITY_EVENTS_ENTITY_RISK)],
    ]);
    expect(trail[4]).toEqual([
      "Entity",
      routeFor(PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW),
    ]);
    // On the list itself, its crumb is the page it is on.
    expect(trailOf(PageMap.SECURITY_EVENTS_ENTITY_RISK)[3]).toEqual([
      "Entity Risk",
      routeFor(PageMap.SECURITY_EVENTS_ENTITY_RISK),
    ]);
  });

  /*
   * Workspace's entries depend on what the project has connected, so its
   * crumb opens the page every project can open: Slack and Microsoft Teams
   * side by side, each with its next step.
   */
  test("Workspace opens the page that shows Slack and Microsoft Teams side by side", () => {
    for (const page of [
      PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK,
      PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    ]) {
      expect([page, trailOf(page)[1], trailOf(page)[2]]).toEqual([
        page,
        ["Security Events", routeFor(PageMap.SECURITY_EVENTS_OVERVIEW)],
        ["Workspace", routeFor(PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTIONS)],
      ]);
    }

    // On that page, Workspace is the page itself.
    expect(trailOf(PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTIONS)[2]).toEqual([
      "Workspace",
      `${PRODUCT}/workspace-connections`,
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

  test.each([
    [PageMap.SECURITY_CASE_VIEW_TIMELINE, "timeline"],
    [PageMap.SECURITY_CASE_VIEW_DETECTIONS, "detections"],
    [PageMap.SECURITY_CASE_VIEW_ENTITIES, "entities"],
    [PageMap.SECURITY_CASE_VIEW_CONNECTED_SIGNALS, "connected-signals"],
    [PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS, "playbook-runs"],
    [PageMap.SECURITY_CASE_VIEW_NOTES, "notes"],
    [PageMap.SECURITY_CASE_VIEW_AUDIT_LOGS, "audit-logs"],
    [PageMap.SECURITY_CASE_VIEW_DELETE, "delete"],
  ])(
    "on %s, the case's crumb opens its Overview and Security Cases the open cases",
    (page: string, segment: string) => {
      const trail: Array<[string, string]> = trailOf(page);

      expect(trail[1]).toEqual([
        "Security Events",
        routeFor(PageMap.SECURITY_EVENTS_OVERVIEW),
      ]);
      expect(trail[2]).toEqual([
        "Security Cases",
        routeFor(PageMap.SECURITY_CASES),
      ]);
      expect(trail[3]).toEqual(["View Case", `${PRODUCT}/cases/${CASE_ID}`]);
      // The page itself, which is not a link.
      expect(trail[4]![1]).toBe(`${PRODUCT}/cases/${CASE_ID}/${segment}`);
    },
  );

  /*
   * An entity's page is about one entity, as a case's is about one case:
   * the trail and the browser's tab name it - "Entity Risk >
   * k.morgan@acme-commerce.example" - not "Entity Risk > Entity" for every
   * one of them. The value is in the page's query, written out as it is.
   */
  test("an entity's page names its entity in the trail and the tab; nothing else is renamed", () => {
    const path: string = visit(PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW);
    const routePath: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    const value: string = "k.morgan@acme-commerce.example";

    const links: Array<Link> = nameEntityInTrail({
      links: getSecurityEventsBreadcrumbs(routePath),
      path: routePath,
      entityValue: `  ${value}  `,
    })!;

    expect(
      links.map((link: Link): string | undefined => {
        return link.recordName;
      }),
    ).toEqual([undefined, undefined, undefined, undefined, value]);
    // Its crumb still stands for its page, and Entity Risk still opens the list.
    expect(links[4]!.to.toString()).toBe(path);
    expect(links[3]!.to.toString()).toBe(
      routeFor(PageMap.SECURITY_EVENTS_ENTITY_RISK),
    );

    render(
      <Page breadcrumbLinks={links}>
        <div>Page content</div>
      </Page>,
    );

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });

    expect(within(trail).getByText(value)).toBeInTheDocument();
    expect(within(trail).queryByText("Entity")).toBeNull();
    expect(document.title).toContain(value);

    // A link that names no entity keeps "Entity"; so does a value of spaces.
    for (const entityValue of [null, undefined, "", "   "]) {
      expect(
        nameEntityInTrail({
          links: getSecurityEventsBreadcrumbs(routePath),
          path: routePath,
          entityValue,
        })!.map((link: Link): string | undefined => {
          return link.recordName;
        }),
      ).toEqual([undefined, undefined, undefined, undefined, undefined]);
    }

    // Any other page's trail is left as it is, whatever its query holds.
    visit(PageMap.SECURITY_EVENTS_ENTITY_RISK);
    const listPath: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    const listLinks: Array<Link> | undefined =
      getSecurityEventsBreadcrumbs(listPath);

    expect(
      nameEntityInTrail({
        links: listLinks,
        path: listPath,
        entityValue: value,
      }),
    ).toBe(listLinks);
    expect(
      nameEntityInTrail({
        links: undefined,
        path: routePath,
        entityValue: value,
      }),
    ).toBeUndefined();
  });

  test("the case's crumb takes the case's number once the case is read, in the trail and the tab", () => {
    visit(PageMap.SECURITY_CASE_VIEW_DETECTIONS);

    const links: Array<Link> = nameRecordInTrail({
      links: getSecurityEventsBreadcrumbs(
        Navigation.getRoutePath(RouteUtil.getRoutes()),
      ),
      recordId: CASE_ID,
      recordName: "CASE-142",
    })!;

    expect(
      links.map((link: Link): string | undefined => {
        return link.recordName;
      }),
    ).toEqual([undefined, undefined, undefined, "CASE-142", undefined]);

    render(
      <Page breadcrumbLinks={links}>
        <div>Page content</div>
      </Page>,
    );

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });

    expect(
      within(trail).getByRole("link", { name: "CASE-142" }),
    ).toHaveAttribute("href", `${PRODUCT}/cases/${CASE_ID}`);
    expect(document.title).toContain("CASE-142");
    expect(document.title).toContain("Detections");
  });
});
