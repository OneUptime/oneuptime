import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, RenderResult } from "@testing-library/react";
import * as React from "react";
import { FunctionComponent } from "react";
import NetworkSideMenu from "../../../../App/FeatureSet/Dashboard/src/Components/Network/NetworkSideMenu";
import NetworkDeviceSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/SideMenu";
import { getNetworkDeviceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Utils/Breadcrumbs";
import NetworkSiteSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/SideMenu";
import { getNetworkSiteBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/Utils/Breadcrumbs";
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
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

/*
 * Network Devices and Network Sites are two route families, but one product.
 * The shared menu is the map of that product, so an organisational change has
 * three independent failure modes worth pinning together:
 *
 *  - a page can move to the wrong section, disappear, or be duplicated;
 *  - the two route-family wrappers can quietly stop rendering the same menu;
 *  - breadcrumbs and the responsive summary can retain the old section name.
 *
 * These tests render the real menu against the real RouteMap. The complete
 * expected taxonomy is written here rather than inferred from the component,
 * so changing the production array alone cannot make the regression pass.
 */

type BreadcrumbGetter = (path: string) => Array<Link> | undefined;

interface ExpectedMenuEntry {
  title: string;
  pageMapKey: string;
  getBreadcrumbs: BreadcrumbGetter;
  breadcrumbTitles: Array<string>;
  resetsMapDrill?: boolean;
}

interface ExpectedMenuSection {
  title: string;
  defaultCollapsed: boolean;
  entries: Array<ExpectedMenuEntry>;
}

interface SideMenuWrapper {
  name: string;
  Component: FunctionComponent;
}

const EXPECTED_SECTIONS: Array<ExpectedMenuSection> = [
  {
    title: "Network",
    defaultCollapsed: false,
    entries: [
      {
        title: "Overview",
        pageMapKey: PageMap.NETWORK_OVERVIEW,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Overview"],
      },
      {
        title: "Devices",
        pageMapKey: PageMap.NETWORK_DEVICES,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Devices"],
      },
      {
        title: "Sites",
        pageMapKey: PageMap.NETWORK_SITES,
        getBreadcrumbs: getNetworkSiteBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Sites"],
      },
      {
        title: "Endpoints",
        pageMapKey: PageMap.NETWORK_DEVICE_ENDPOINTS,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Endpoints"],
      },
      {
        title: "Discovery Scans",
        pageMapKey: PageMap.NETWORK_DEVICE_DISCOVERY,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Discovery Scans"],
      },
      {
        title: "Archived Devices",
        pageMapKey: PageMap.NETWORK_DEVICE_ARCHIVED,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Archived Devices"],
      },
    ],
  },
  {
    title: "Topology",
    defaultCollapsed: false,
    entries: [
      {
        title: "Network Map",
        pageMapKey: PageMap.NETWORK_SITE_MAP,
        getBreadcrumbs: getNetworkSiteBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Topology", "Network Map"],
        resetsMapDrill: true,
      },
      {
        title: "Device Topology",
        pageMapKey: PageMap.NETWORK_DEVICE_TOPOLOGY,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Topology", "Device Topology"],
      },
      {
        title: "Latency Matrix",
        pageMapKey: PageMap.NETWORK_DEVICE_LATENCY_MATRIX,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Topology", "Latency Matrix"],
      },
      {
        title: "Site Links",
        pageMapKey: PageMap.NETWORK_SITE_LINKS,
        getBreadcrumbs: getNetworkSiteBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Topology", "Site Links"],
      },
      {
        title: "Device Links",
        pageMapKey: PageMap.NETWORK_DEVICE_LINKS,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Topology", "Device Links"],
      },
    ],
  },
  {
    title: "Rules",
    defaultCollapsed: true,
    entries: [
      {
        title: "Auto Import Rules",
        pageMapKey: PageMap.NETWORK_DEVICE_SETTINGS_AUTO_IMPORT_RULES,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Rules", "Auto Import Rules"],
      },
      {
        title: "Site Assignment Rules",
        pageMapKey: PageMap.NETWORK_SITE_ASSIGNMENT_RULES,
        getBreadcrumbs: getNetworkSiteBreadcrumbs,
        breadcrumbTitles: [
          "Project",
          "Network",
          "Rules",
          "Site Assignment Rules",
        ],
      },
      {
        title: "Owner Rules",
        pageMapKey: PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULES,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Rules", "Owner Rules"],
      },
      {
        title: "Label Rules",
        pageMapKey: PageMap.NETWORK_DEVICE_SETTINGS_LABEL_RULES,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Rules", "Label Rules"],
      },
      {
        title: "Link Rules",
        pageMapKey: PageMap.NETWORK_DEVICE_SETTINGS_LINK_RULES,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Rules", "Link Rules"],
      },
    ],
  },
  {
    title: "Settings",
    defaultCollapsed: true,
    entries: [
      {
        title: "Device Roles",
        pageMapKey: PageMap.NETWORK_DEVICE_SETTINGS_DEVICE_ROLES,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Settings", "Device Roles"],
      },
      {
        title: "OID Collection Templates",
        pageMapKey: PageMap.NETWORK_DEVICE_SETTINGS_OID_TEMPLATES,
        getBreadcrumbs: getNetworkDeviceBreadcrumbs,
        breadcrumbTitles: [
          "Project",
          "Network",
          "Settings",
          "OID Collection Templates",
        ],
      },
      {
        title: "Site Types",
        pageMapKey: PageMap.NETWORK_SITE_SETTINGS_SITE_TYPES,
        getBreadcrumbs: getNetworkSiteBreadcrumbs,
        breadcrumbTitles: ["Project", "Network", "Settings", "Site Types"],
      },
    ],
  },
];

const EXPECTED_ENTRIES: Array<ExpectedMenuEntry> = EXPECTED_SECTIONS.flatMap(
  (section: ExpectedMenuSection): Array<ExpectedMenuEntry> => {
    return section.entries;
  },
);

function expectedHref(entry: ExpectedMenuEntry): string {
  const href: string = routeFor(entry.pageMapKey);
  return entry.resetsMapDrill ? `${href}?site=` : href;
}

function expectedLinks(section: ExpectedMenuSection): Array<MenuLink> {
  return section.entries.map((entry: ExpectedMenuEntry): MenuLink => {
    return {
      title: entry.title,
      href: expectedHref(entry),
    };
  });
}

function findAnchor(title: string): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    document.querySelectorAll("a"),
  ).find((candidate: Element): boolean => {
    return (
      candidate.querySelector("span.truncate")?.textContent?.trim() === title
    );
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
  expect(anchor.querySelector(".h-5.bg-indigo-600")).not.toBeNull();
}

function expectCompleteMenu(): void {
  expect(sectionTitlesInOrder()).toEqual(
    EXPECTED_SECTIONS.map((section: ExpectedMenuSection): string => {
      return section.title;
    }),
  );

  EXPECTED_SECTIONS.forEach((section: ExpectedMenuSection): void => {
    expect(linksIn(section.title)).toEqual(expectedLinks(section));
  });
}

function renderNetworkMenu(): Promise<RenderResult> {
  return renderMenu(<NetworkSideMenu />);
}

describe("Network side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/network-devices/overview`);
  });

  afterEach(() => {
    cleanup();
  });

  describe("taxonomy", () => {
    test("renders Network, Topology, Rules and Settings in order", async () => {
      await renderNetworkMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Network",
        "Topology",
        "Rules",
        "Settings",
      ]);
    });

    test("puts every page in its intended section and order", async () => {
      await renderNetworkMenu();

      expectCompleteMenu();
    });

    test("keeps day-to-day navigation open and configuration collapsed", async () => {
      await renderNetworkMenu();

      EXPECTED_SECTIONS.forEach((section: ExpectedMenuSection): void => {
        expect(isExpanded(section.title)).toBe(!section.defaultCollapsed);
      });
    });
  });

  describe("collapsed sections", () => {
    test("Rules expands and collapses without unmounting its links", async () => {
      await renderNetworkMenu();

      expect(isExpanded("Rules")).toBe(false);
      expect(sectionBody("Rules")).toHaveClass("max-h-0", "opacity-0");
      expect(linksIn("Rules")).toHaveLength(5);

      fireEvent.click(sectionToggle("Rules"));

      expect(isExpanded("Rules")).toBe(true);
      expect(sectionBody("Rules")).not.toHaveClass("max-h-0", "opacity-0");
      expect(sectionBody("Rules")).toHaveClass("opacity-100");

      fireEvent.click(sectionToggle("Rules"));

      expect(isExpanded("Rules")).toBe(false);
      expect(sectionBody("Rules")).toHaveClass("max-h-0", "opacity-0");
      expect(linksIn("Rules")).toEqual(expectedLinks(EXPECTED_SECTIONS[2]!));
    });

    test("Settings expands and collapses without unmounting its links", async () => {
      await renderNetworkMenu();

      expect(isExpanded("Settings")).toBe(false);
      expect(linksIn("Settings")).toHaveLength(3);

      fireEvent.click(sectionToggle("Settings"));
      expect(isExpanded("Settings")).toBe(true);

      fireEvent.click(sectionToggle("Settings"));
      expect(isExpanded("Settings")).toBe(false);
      expect(linksIn("Settings")).toEqual(expectedLinks(EXPECTED_SECTIONS[3]!));
    });
  });

  describe("coverage", () => {
    test("keeps all nineteen destinations reachable exactly once", async () => {
      await renderNetworkMenu();

      expect(EXPECTED_ENTRIES).toHaveLength(19);
      expect(allLinks()).toHaveLength(19);
      expect(hrefsInMenu().sort()).toEqual(
        EXPECTED_ENTRIES.map(expectedHref).sort(),
      );
    });

    test("does not duplicate a route, page key or title", async () => {
      await renderNetworkMenu();

      const hrefs: Array<string> = hrefsInMenu();
      const titles: Array<string> = titlesInMenu();
      const pageMapKeys: Array<string> = EXPECTED_ENTRIES.map(
        (entry: ExpectedMenuEntry): string => {
          return entry.pageMapKey;
        },
      );

      expect(hrefs).toEqual(Array.from(new Set(hrefs)));
      expect(titles).toEqual(Array.from(new Set(titles)));
      expect(pageMapKeys).toEqual(Array.from(new Set(pageMapKeys)));
    });

    test("fully populates every project route", async () => {
      await renderNetworkMenu();

      allLinks().forEach((link: MenuLink): void => {
        expect(link.href.startsWith(`/dashboard/${PROJECT_ID}/`)).toBe(true);
        expect(link.href).not.toContain(":projectId");
        expect(link.href).not.toContain(":modelId");
        expect(link.title).not.toBe("");
      });
    });

    test("gives every destination an icon", async () => {
      await renderNetworkMenu();

      EXPECTED_SECTIONS.forEach((section: ExpectedMenuSection): void => {
        expect(iconCountIn(section.title)).toBe(section.entries.length);
      });
    });
  });

  describe("shared route-family wrappers", () => {
    const WRAPPERS: Array<SideMenuWrapper> = [
      { name: "Network Devices", Component: NetworkDeviceSideMenu },
      { name: "Network Sites", Component: NetworkSiteSideMenu },
    ];

    test.each(WRAPPERS)(
      "$name renders the complete shared product menu",
      async ({ Component }: SideMenuWrapper): Promise<void> => {
        await renderMenu(<Component />);

        expectCompleteMenu();
      },
    );
  });

  describe("active routes", () => {
    test("an active Rules deep link expands Rules and highlights its item", async () => {
      goTo(routeFor(PageMap.NETWORK_DEVICE_SETTINGS_LINK_RULES));

      await renderNetworkMenu();

      expect(isExpanded("Rules")).toBe(true);
      expect(sectionBody("Rules")).toHaveClass("opacity-100");
      expect(isExpanded("Settings")).toBe(false);
      expectActiveLink("Link Rules");
    });

    test("an active Settings deep link expands Settings and highlights its item", async () => {
      goTo(routeFor(PageMap.NETWORK_SITE_SETTINGS_SITE_TYPES));

      await renderNetworkMenu();

      expect(isExpanded("Settings")).toBe(true);
      expect(sectionBody("Settings")).toHaveClass("opacity-100");
      expect(isExpanded("Rules")).toBe(false);
      expectActiveLink("Site Types");
    });

    test("opens Rules when navigation moves to a Rules route", async () => {
      const rendered: RenderResult = await renderNetworkMenu();

      expect(isExpanded("Rules")).toBe(false);

      goTo(routeFor(PageMap.NETWORK_DEVICE_SETTINGS_LINK_RULES));
      await act(async () => {
        rendered.rerender(<NetworkSideMenu />);
      });

      expect(isExpanded("Rules")).toBe(true);
      expect(sectionBody("Rules")).toHaveClass("opacity-100");
      expectActiveLink("Link Rules");
    });

    test("opens Settings after navigation moves from Rules to Settings", async () => {
      goTo(routeFor(PageMap.NETWORK_DEVICE_SETTINGS_LINK_RULES));
      const rendered: RenderResult = await renderNetworkMenu();

      expect(isExpanded("Rules")).toBe(true);
      expect(isExpanded("Settings")).toBe(false);

      goTo(routeFor(PageMap.NETWORK_SITE_SETTINGS_SITE_TYPES));
      await act(async () => {
        rendered.rerender(<NetworkSideMenu />);
      });

      expect(isExpanded("Rules")).toBe(true);
      expect(isExpanded("Settings")).toBe(true);
      expect(sectionBody("Settings")).toHaveClass("opacity-100");
      expectActiveLink("Site Types");
    });
  });

  describe("Network Map", () => {
    test("links to an explicit root reset instead of the bare map route", async () => {
      await renderNetworkMenu();

      const mapLink: MenuLink = linksIn("Topology")[0]!;
      const bareMapRoute: string = routeFor(PageMap.NETWORK_SITE_MAP);

      expect(mapLink).toEqual({
        title: "Network Map",
        href: `${bareMapRoute}?site=`,
      });
      expect(mapLink.href).not.toBe(bareMapRoute);
    });

    test("is active on the map page even though its navigation target carries the reset query", async () => {
      goTo(routeFor(PageMap.NETWORK_SITE_MAP));

      await renderNetworkMenu();

      expect(isExpanded("Topology")).toBe(true);
      expectActiveLink("Network Map");
      expect(findAnchor("Network Map")).toHaveAttribute(
        "href",
        `${routeFor(PageMap.NETWORK_SITE_MAP)}?site=`,
      );
    });

    test("names the active map page in the mobile summary", async () => {
      setViewportWidth(MOBILE_WIDTH);
      goTo(routeFor(PageMap.NETWORK_SITE_MAP));

      await renderNetworkMenu();

      expect(mobileSummaryText()).toContain("Topology / Network Map");
    });
  });

  describe("mobile summaries", () => {
    test.each([
      [PageMap.NETWORK_DEVICE_ENDPOINTS, "Network / Endpoints"],
      [PageMap.NETWORK_DEVICE_TOPOLOGY, "Topology / Device Topology"],
      [PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULES, "Rules / Owner Rules"],
      [PageMap.NETWORK_SITE_SETTINGS_SITE_TYPES, "Settings / Site Types"],
    ])(
      "%s reports its section and page",
      async (pageMapKey: string, expectedSummary: string): Promise<void> => {
        setViewportWidth(MOBILE_WIDTH);
        goTo(routeFor(pageMapKey));

        await renderNetworkMenu();

        expect(mobileSummaryText()).toContain(expectedSummary);
      },
    );
  });

  describe("breadcrumbs", () => {
    test("every rendered entry has a matching breadcrumb leaf and section", async () => {
      await renderNetworkMenu();

      const renderedLinks: Array<MenuLink> = allLinks();

      for (const section of EXPECTED_SECTIONS) {
        for (const entry of section.entries) {
          const renderedLink: MenuLink | undefined = renderedLinks.find(
            (link: MenuLink): boolean => {
              return link.href === expectedHref(entry);
            },
          );

          expect(renderedLink).toBeDefined();
          expect(renderedLink?.title).toBe(entry.title);

          goTo(routeFor(entry.pageMapKey));

          const trail: Array<Link> | undefined = entry.getBreadcrumbs(
            RouteUtil.getRouteString(entry.pageMapKey),
          );
          const trailTitles: Array<string> | undefined = trail?.map(
            (link: Link): string => {
              return link.title;
            },
          );

          expect(trailTitles).toEqual(entry.breadcrumbTitles);
          expect(trailTitles?.[trailTitles.length - 1]).toBe(
            renderedLink?.title,
          );

          if (section.title === "Network") {
            expect(trailTitles?.[1]).toBe(section.title);
          } else {
            expect(trailTitles?.[trailTitles.length - 2]).toBe(section.title);
          }
        }
      }
    });

    test("every breadcrumb destination is a concrete dashboard route", () => {
      for (const entry of EXPECTED_ENTRIES) {
        goTo(routeFor(entry.pageMapKey));

        const trail: Array<Link> | undefined = entry.getBreadcrumbs(
          RouteUtil.getRouteString(entry.pageMapKey),
        );

        expect(trail).toBeDefined();
        trail?.forEach((link: Link): void => {
          expect(link.to.toString().startsWith("/dashboard/")).toBe(true);
          expect(link.to.toString()).not.toContain(":projectId");
          expect(link.to.toString()).not.toContain(":modelId");
        });
      }
    });
  });
});
