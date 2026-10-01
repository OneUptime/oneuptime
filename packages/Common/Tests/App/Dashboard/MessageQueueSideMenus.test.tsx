import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import * as React from "react";
import MessageQueueSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/SideMenu";
import MessageQueueViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  MessageQueueRoutePath,
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

/*
 * The two maps of the Queues product: the product menu (the list, the
 * archive, the install guide and the two rule pages) and one queue's menu
 * (its tabs). Rendered for real against the real RouteMap, and every href
 * compared to the route the page is registered under, so a tab that is
 * dropped, duplicated or pointed at the wrong page shows up by name.
 */

const QUEUE_ID: ObjectID = new ObjectID("5d9e2c11-7a3b-4c1d-9e8f-00000000a0b1");

function queueRoute(key: string): string {
  return RouteUtil.populateRouteParams(RouteMap[key] as Route, {
    modelId: QUEUE_ID,
  }).toString();
}

describe("the Queues product side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/queues`);
  });

  afterEach(() => {
    cleanup();
  });

  test("has a Queues section and a Settings section, in that order", async () => {
    await renderMenu(<MessageQueueSideMenu />);

    expect(sectionTitlesInOrder()).toEqual(["Queues", "Settings"]);
  });

  test("the Queues section reaches the list, the archive and the install guide", async () => {
    await renderMenu(<MessageQueueSideMenu />);

    expect(linksIn("Queues")).toEqual([
      { title: "All Queues", href: routeFor(PageMap.MESSAGE_QUEUES) },
      { title: "Archived", href: routeFor(PageMap.MESSAGE_QUEUES_ARCHIVED) },
      {
        title: "Documentation",
        href: routeFor(PageMap.MESSAGE_QUEUES_DOCUMENTATION),
      },
    ]);
    expect(iconCountIn("Queues")).toBe(3);
  });

  test("the Settings section holds both rule pages and starts collapsed", async () => {
    await renderMenu(<MessageQueueSideMenu />);

    expect(linksIn("Settings")).toEqual([
      {
        title: "Owner Rules",
        href: routeFor(PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES),
      },
      {
        title: "Label Rules",
        href: routeFor(PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES),
      },
    ]);
    expect(isExpanded("Queues")).toBe(true);
    expect(isExpanded("Settings")).toBe(false);
    expect(sectionBody("Settings").className).toContain("max-h-0");

    fireEvent.click(sectionToggle("Settings"));
    expect(isExpanded("Settings")).toBe(true);
  });

  test("the rule pages open their section when they are the current page", async () => {
    goTo(routeFor(PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES));

    await renderMenu(<MessageQueueSideMenu />);

    expect(isExpanded("Settings")).toBe(true);
    expect(screen.getByRole("link", { name: "Label Rules" })).toHaveClass(
      "bg-indigo-50",
    );
  });

  test("every link resolves in the current project", async () => {
    await renderMenu(<MessageQueueSideMenu />);

    for (const href of hrefsInMenu()) {
      expect(href.startsWith(`/dashboard/${PROJECT_ID}/queues`)).toBe(true);
      expect(href).not.toContain(":");
    }
  });

  test("it reaches every product-level page of the route table", async () => {
    await renderMenu(<MessageQueueSideMenu />);

    const hrefs: Array<string> = hrefsInMenu();
    const productPages: Array<string> = [
      PageMap.MESSAGE_QUEUES,
      ...Object.keys(MessageQueueRoutePath).filter((key: string): boolean => {
        // Tabs of one queue, and a rule's own view page, are not menu entries.
        return (
          !MessageQueueRoutePath[key]!.includes(":modelId") &&
          !MessageQueueRoutePath[key]!.includes(":id")
        );
      }),
    ];

    expect(productPages).toHaveLength(5);
    for (const key of productPages) {
      expect(hrefs).toContain(routeFor(key));
    }
  });

  test("names the section and the page on a phone", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(routeFor(PageMap.MESSAGE_QUEUES_ARCHIVED));

    await renderMenu(<MessageQueueSideMenu />);

    expect(mobileSummaryText()).toContain("Queues / Archived");
  });
});

describe("one queue's side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(queueRoute(PageMap.MESSAGE_QUEUE_VIEW));
  });

  afterEach(() => {
    cleanup();
  });

  test("has the Basic, Observability, Settings and Advanced sections, in order", async () => {
    await renderMenu(<MessageQueueViewSideMenu modelId={QUEUE_ID} />);

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "Observability",
      "Settings",
      "Advanced",
    ]);
  });

  test("links every tab to this queue's own page", async () => {
    await renderMenu(<MessageQueueViewSideMenu modelId={QUEUE_ID} />);

    expect(linksIn("Basic")).toEqual([
      { title: "Overview", href: queueRoute(PageMap.MESSAGE_QUEUE_VIEW) },
    ]);
    expect(linksIn("Observability")).toEqual([
      { title: "Traces", href: queueRoute(PageMap.MESSAGE_QUEUE_VIEW_TRACES) },
      {
        title: "Metrics",
        href: queueRoute(PageMap.MESSAGE_QUEUE_VIEW_METRICS),
      },
    ]);
    expect(linksIn("Settings")).toEqual([
      { title: "Owners", href: queueRoute(PageMap.MESSAGE_QUEUE_VIEW_OWNERS) },
      {
        title: "Settings",
        href: queueRoute(PageMap.MESSAGE_QUEUE_VIEW_SETTINGS),
      },
      {
        title: "Documentation",
        href: queueRoute(PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION),
      },
    ]);
    expect(linksIn("Advanced")).toEqual([
      {
        title: "Delete Queue",
        href: queueRoute(PageMap.MESSAGE_QUEUE_VIEW_DELETE),
      },
    ]);
  });

  test("reaches every page of the queue's route table, each exactly once", async () => {
    await renderMenu(<MessageQueueViewSideMenu modelId={QUEUE_ID} />);

    const hrefs: Array<string> = hrefsInMenu();
    const viewPages: Array<string> = Object.keys(MessageQueueRoutePath).filter(
      (key: string): boolean => {
        return key.startsWith("MESSAGE_QUEUE_VIEW");
      },
    );

    expect(viewPages).toHaveLength(7);
    expect(hrefs).toHaveLength(7);
    expect(new Set(hrefs).size).toBe(7);
    for (const key of viewPages) {
      expect(hrefs).toContain(queueRoute(key));
    }
    for (const href of hrefs) {
      expect(href).toContain(QUEUE_ID.toString());
      expect(href).toContain(`/dashboard/${PROJECT_ID}/queues/`);
    }
  });

  test("Delete is last and marked dangerous", async () => {
    await renderMenu(<MessageQueueViewSideMenu modelId={QUEUE_ID} />);

    expect(titlesInMenu()[titlesInMenu().length - 1]).toBe("Delete Queue");
    const deleteLink: HTMLElement = screen.getByRole("link", {
      name: "Delete Queue",
    });
    expect(deleteLink.closest(".danger-on-hover")).not.toBeNull();
  });

  test("every entry carries an icon", async () => {
    await renderMenu(<MessageQueueViewSideMenu modelId={QUEUE_ID} />);

    expect(iconCountIn("Basic")).toBe(1);
    expect(iconCountIn("Observability")).toBe(2);
    expect(iconCountIn("Settings")).toBe(3);
    expect(iconCountIn("Advanced")).toBe(1);
  });

  test.each([
    [PageMap.MESSAGE_QUEUE_VIEW_TRACES, "Traces", "Observability"],
    [PageMap.MESSAGE_QUEUE_VIEW_METRICS, "Metrics", "Observability"],
    [PageMap.MESSAGE_QUEUE_VIEW_OWNERS, "Owners", "Settings"],
    [PageMap.MESSAGE_QUEUE_VIEW_SETTINGS, "Settings", "Settings"],
    [PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION, "Documentation", "Settings"],
  ])(
    "on %s it marks %s active in %s",
    async (key: string, title: string, section: string) => {
      goTo(queueRoute(key));

      await renderMenu(<MessageQueueViewSideMenu modelId={QUEUE_ID} />);

      expect(isExpanded(section)).toBe(true);
      expect(screen.getByRole("link", { name: title })).toHaveClass(
        "bg-indigo-50",
      );
    },
  );

  test("names the section and the tab on a phone", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(queueRoute(PageMap.MESSAGE_QUEUE_VIEW_TRACES));

    await renderMenu(<MessageQueueViewSideMenu modelId={QUEUE_ID} />);

    expect(mobileSummaryText()).toContain("Observability / Traces");
  });
});
