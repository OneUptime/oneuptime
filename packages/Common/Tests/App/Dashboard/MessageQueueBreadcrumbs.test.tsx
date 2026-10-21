import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { matchRoutes } from "react-router-dom";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  MessageQueueRoutePath,
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getMessageQueueBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MessageQueueBreadcrumbs";
import { getMessageQueueBreadcrumbs as getMessageQueueBreadcrumbsFromBarrel } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import Page from "../../../UI/Components/Page/Page";
import Navigation from "../../../UI/Utils/Navigation";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

/*
 * Every page of the Queues product, visited through the router's own
 * inventory (MessageQueueRoutePath plus the list): its trail exists, starts
 * at the project, ends at the page itself, links only to real routes — never
 * to a bare "/queues/settings" prefix that renders nothing — and renders as
 * a visible breadcrumb bar. A page added to the route table without a trail
 * fails here by name.
 */

const MODEL_ID: string = "7b3b1548-23cd-46ab-8359-280eb34362af";

const realRoutes: Array<{ path: string }> = Object.values(RouteMap)
  .map((route: Route): { path: string } => {
    return { path: route.toString() };
  })
  .filter((route: { path: string }): boolean => {
    return !route.path.includes("*");
  });

function visit(page: string): string {
  const pagePath: string = RouteUtil.getRouteString(page)
    .replace(":projectId", PROJECT_ID)
    .replace(":id", MODEL_ID);
  goTo(pagePath);
  return pagePath;
}

const EXPECTED_TITLES: Record<string, Array<string>> = {
  [PageMap.MESSAGE_QUEUES]: ["Project", "Queues"],
  [PageMap.MESSAGE_QUEUES_ARCHIVED]: ["Project", "Queues", "Archived"],
  [PageMap.MESSAGE_QUEUES_DOCUMENTATION]: [
    "Project",
    "Queues",
    "Documentation",
  ],
  [PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES]: [
    "Project",
    "Queues",
    "Label Rules",
  ],
  [PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW]: [
    "Project",
    "Queues",
    "Label Rules",
    "View Rule",
  ],
  [PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES]: [
    "Project",
    "Queues",
    "Owner Rules",
  ],
  [PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW]: [
    "Project",
    "Queues",
    "Owner Rules",
    "View Rule",
  ],
  [PageMap.MESSAGE_QUEUE_VIEW]: ["Project", "Queues", "View Queue"],
  [PageMap.MESSAGE_QUEUE_VIEW_TRACES]: [
    "Project",
    "Queues",
    "View Queue",
    "Traces",
  ],
  [PageMap.MESSAGE_QUEUE_VIEW_METRICS]: [
    "Project",
    "Queues",
    "View Queue",
    "Metrics",
  ],
  [PageMap.MESSAGE_QUEUE_VIEW_OWNERS]: [
    "Project",
    "Queues",
    "View Queue",
    "Owners",
  ],
  [PageMap.MESSAGE_QUEUE_VIEW_SETTINGS]: [
    "Project",
    "Queues",
    "View Queue",
    "Settings",
  ],
  [PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION]: [
    "Project",
    "Queues",
    "View Queue",
    "Documentation",
  ],
  [PageMap.MESSAGE_QUEUE_VIEW_DELETE]: [
    "Project",
    "Queues",
    "View Queue",
    "Delete Queue",
  ],
};

const PAGES: Array<string> = [
  PageMap.MESSAGE_QUEUES,
  ...Object.keys(MessageQueueRoutePath),
];

afterEach(() => {
  cleanup();
});

describe("Queues breadcrumb coverage", () => {
  test("the router's inventory is the set of pages with a pinned trail", () => {
    expect([...PAGES].sort()).toEqual(Object.keys(EXPECTED_TITLES).sort());
  });

  test.each(PAGES)(
    "%s has a complete, navigable trail through the Page header",
    (page: string) => {
      const currentPath: string = visit(page);
      const matchedPath: string = Navigation.getRoutePath(
        RouteUtil.getRoutes(),
      );
      // The page matches its own route, not a neighbour (archived ≠ :id).
      expect(matchedPath).toBe(RouteUtil.getRouteString(page));

      const links: Array<Link> | undefined =
        getMessageQueueBreadcrumbs(matchedPath);
      expect(links).toBeDefined();
      expect(
        links!.map((link: Link): string => {
          return link.title;
        }),
      ).toEqual(EXPECTED_TITLES[page]);
      expect(links![0]?.to.toString()).toBe(`/dashboard/${PROJECT_ID}`);
      expect(links![links!.length - 1]?.to.toString()).toBe(currentPath);

      links!.forEach((link: Link) => {
        expect(link.to.toString()).not.toMatch(/[:*]/);
        expect(matchRoutes(realRoutes, link.to.toString())).not.toBeNull();
      });

      render(
        <Page title="Queues" breadcrumbLinks={links}>
          <div>Page content</div>
        </Page>,
      );
      const trail: HTMLElement = screen.getByRole("navigation", {
        name: "Breadcrumb",
      });
      expect(within(trail).getAllByRole("listitem")).toHaveLength(
        links!.length,
      );
      expect(trail).not.toHaveClass("hidden");
      within(trail)
        .getAllByRole("link")
        .forEach((anchor: HTMLElement) => {
          expect(anchor.getAttribute("href")).not.toBe(currentPath);
        });
    },
  );

  test("the second crumb of every page is the Queues list", () => {
    for (const page of PAGES) {
      visit(page);
      const links: Array<Link> = getMessageQueueBreadcrumbs(
        RouteUtil.getRouteString(page),
      )!;
      if (links.length > 2) {
        expect(links[1]?.to.toString()).toBe(`/dashboard/${PROJECT_ID}/queues`);
      }
    }
  });

  test("a queue tab's third crumb is the queue's Overview", () => {
    visit(PageMap.MESSAGE_QUEUE_VIEW_SETTINGS);
    const links: Array<Link> = getMessageQueueBreadcrumbs(
      RouteUtil.getRouteString(PageMap.MESSAGE_QUEUE_VIEW_SETTINGS),
    )!;
    expect(links[2]?.to.toString()).toBe(
      `/dashboard/${PROJECT_ID}/queues/${MODEL_ID}`,
    );
  });

  test("a rule's view page links back to its rule list", () => {
    visit(PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW);
    const links: Array<Link> = getMessageQueueBreadcrumbs(
      RouteUtil.getRouteString(
        PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW,
      ),
    )!;
    expect(links[2]?.to.toString()).toBe(
      `/dashboard/${PROJECT_ID}/queues/settings/owner-rules`,
    );
  });

  test("does not invent breadcrumbs for an unknown page", () => {
    visit(PageMap.MESSAGE_QUEUES);
    expect(getMessageQueueBreadcrumbs("/not-a-page")).toBeUndefined();
    expect(
      getMessageQueueBreadcrumbs(
        RouteUtil.getRouteString(PageMap.DATABASE_SERVERS),
      ),
    ).toBeUndefined();
  });

  test("the barrel exports the same trails the layouts read", () => {
    expect(getMessageQueueBreadcrumbsFromBarrel).toBe(
      getMessageQueueBreadcrumbs,
    );
  });
});
