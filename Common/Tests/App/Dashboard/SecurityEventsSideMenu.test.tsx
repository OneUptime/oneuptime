import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import SecurityEventsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/SideMenu";
import { getSecurityEventsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SecurityEventsBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Link from "../../../Types/Link";
import {
  allLinks,
  DESKTOP_WIDTH,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  MenuLink,
  MOBILE_WIDTH,
  mobileSummaryText,
  PROJECT_ID,
  goTo,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

interface ExpectedMenuEntry {
  title: string;
  pageMapKey: string;
}

interface ExpectedMenuSection {
  title: string;
  entries: Array<ExpectedMenuEntry>;
}

interface MobileMenuCase extends ExpectedMenuEntry {
  expectedSummary: string;
}

const EXPECTED_SECTIONS: Array<ExpectedMenuSection> = [
  {
    title: "Security Events",
    entries: [
      { title: "Events", pageMapKey: PageMap.SECURITY_EVENTS },
      {
        title: "Correlate",
        pageMapKey: PageMap.SECURITY_EVENTS_CORRELATE,
      },
    ],
  },
  {
    title: "Detection & Alerting",
    entries: [
      {
        title: "Detection Rules",
        pageMapKey: PageMap.SECURITY_EVENTS_DETECTION_RULES,
      },
      {
        title: "Threat Intel",
        pageMapKey: PageMap.SECURITY_EVENTS_THREAT_INTEL,
      },
      {
        title: "Monitors",
        pageMapKey: PageMap.SECURITY_EVENTS_MONITORS,
      },
    ],
  },
  {
    title: "Integrations",
    entries: [
      {
        title: "Connections",
        pageMapKey: PageMap.SECURITY_EVENTS_CONNECTIONS,
      },
    ],
  },
  {
    title: "Help",
    entries: [
      {
        title: "Setup Guide",
        pageMapKey: PageMap.SECURITY_EVENTS_DOCUMENTATION,
      },
    ],
  },
];

const EXPECTED_ENTRIES: Array<ExpectedMenuEntry> = EXPECTED_SECTIONS.flatMap(
  (section: ExpectedMenuSection): Array<ExpectedMenuEntry> => {
    return section.entries;
  },
);

const MOBILE_MENU_CASES: Array<MobileMenuCase> = EXPECTED_SECTIONS.flatMap(
  (section: ExpectedMenuSection): Array<MobileMenuCase> => {
    return section.entries.map((entry: ExpectedMenuEntry): MobileMenuCase => {
      return {
        ...entry,
        expectedSummary: `${section.title} / ${entry.title}`,
      };
    });
  },
);

function expectedLinks(section: ExpectedMenuSection): Array<MenuLink> {
  return section.entries.map((entry: ExpectedMenuEntry): MenuLink => {
    return {
      title: entry.title,
      href: routeFor(entry.pageMapKey),
    };
  });
}

function findAnchor(title: string): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    document.querySelectorAll("a"),
  ).find((candidate: Element): boolean => {
    return candidate.querySelector("span.truncate")?.textContent === title;
  }) as HTMLAnchorElement | undefined;

  if (!anchor) {
    throw new Error(`No side-menu link titled "${title}" was rendered.`);
  }

  return anchor;
}

function expectActiveLink(title: string): void {
  const anchor: HTMLAnchorElement = findAnchor(title);

  expect(anchor).toHaveClass("text-indigo-700");
  expect(anchor).not.toHaveClass("text-gray-600");
  expect(anchor.querySelector(".bg-indigo-600")).not.toBeNull();
}

describe("Security Events side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/security-events`);
  });

  afterEach(() => {
    cleanup();
  });

  test("groups every destination into the intended section and order", async () => {
    await renderMenu(<SecurityEventsSideMenu />);

    expect(sectionTitlesInOrder()).toEqual(
      EXPECTED_SECTIONS.map((section: ExpectedMenuSection): string => {
        return section.title;
      }),
    );

    for (const section of EXPECTED_SECTIONS) {
      expect(linksIn(section.title)).toEqual(expectedLinks(section));
      expect(isExpanded(section.title)).toBe(true);
    }
  });

  test("keeps all seven concrete routes reachable exactly once with icons", async () => {
    await renderMenu(<SecurityEventsSideMenu />);

    const expectedHrefs: Array<string> = EXPECTED_ENTRIES.map(
      (entry: ExpectedMenuEntry): string => {
        return routeFor(entry.pageMapKey);
      },
    );

    expect(allLinks()).toHaveLength(7);
    expect(hrefsInMenu().sort()).toEqual(expectedHrefs.sort());
    expect(hrefsInMenu()).toEqual(Array.from(new Set(hrefsInMenu())));
    expect(titlesInMenu()).toEqual(Array.from(new Set(titlesInMenu())));

    for (const section of EXPECTED_SECTIONS) {
      expect(iconCountIn(section.title)).toBe(section.entries.length);
    }

    for (const href of hrefsInMenu()) {
      expect(href.startsWith(`/dashboard/${PROJECT_ID}/`)).toBe(true);
      expect(href).not.toContain(":projectId");
    }
  });

  test.each(EXPECTED_ENTRIES)(
    "$title is highlighted on its route",
    async (entry: ExpectedMenuEntry): Promise<void> => {
      goTo(routeFor(entry.pageMapKey));

      await renderMenu(<SecurityEventsSideMenu />);

      expectActiveLink(entry.title);
      expect(
        Array.from(document.querySelectorAll("a.text-indigo-700")),
      ).toHaveLength(1);
    },
  );

  test("keeps Events selected when the product route has a trailing slash", async () => {
    goTo(`${routeFor(PageMap.SECURITY_EVENTS)}/`);

    await renderMenu(<SecurityEventsSideMenu />);

    expectActiveLink("Events");
  });

  test.each(MOBILE_MENU_CASES)(
    "$title is named with its section in the mobile menu",
    async (entry: MobileMenuCase): Promise<void> => {
      setViewportWidth(MOBILE_WIDTH);
      goTo(routeFor(entry.pageMapKey));

      await renderMenu(<SecurityEventsSideMenu />);

      expect(mobileSummaryText()).toContain(entry.expectedSummary);
    },
  );

  test("keeps the Events mobile label when the product route has a trailing slash", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(`${routeFor(PageMap.SECURITY_EVENTS)}/`);

    await renderMenu(<SecurityEventsSideMenu />);

    expect(mobileSummaryText()).toContain("Security Events / Events");
  });

  test("keeps every menu label aligned with its breadcrumb leaf", async () => {
    await renderMenu(<SecurityEventsSideMenu />);

    for (const entry of EXPECTED_ENTRIES) {
      const trail: Array<Link> | undefined = getSecurityEventsBreadcrumbs(
        RouteUtil.getRouteString(entry.pageMapKey),
      );

      expect(trail).toBeDefined();
      expect(trail?.[trail.length - 1]?.title).toBe(
        entry.pageMapKey === PageMap.SECURITY_EVENTS
          ? "Security Events"
          : entry.title,
      );
    }
  });
});
