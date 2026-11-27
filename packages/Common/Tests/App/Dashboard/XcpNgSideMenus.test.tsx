import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import * as React from "react";

/*
 * Badge counts and the project's open states are read from the server; this
 * suite is about where each entry sits, what it is called and where it
 * points, so the reads answer with nothing.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
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
      getUnresolvedAlertStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

/*
 * The Recommendations entry counts what is left to set up, which it reads
 * from the server; drawn here as the plain menu item it renders, with its
 * icon, and the resource type it was handed kept for the test to read.
 */
const recommendationsResourceTypes: Array<unknown> = [];
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsSideMenuItem",
  () => {
    const SideMenuItem: React.FunctionComponent<Record<string, unknown>> = (
      jest.requireActual("../../../UI/Components/SideMenu/SideMenuItem") as {
        default: React.FunctionComponent<Record<string, unknown>>;
      }
    ).default;
    const IconProp: Record<string, string> = (
      jest.requireActual("../../../Types/Icon/IconProp") as {
        default: Record<string, string>;
      }
    ).default;

    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        recommendationsResourceTypes.push(props["resourceType"]);
        return (
          <SideMenuItem link={props["link"]} icon={IconProp["Sparkles"]} />
        );
      },
    };
  },
);

import XcpNgSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/SideMenu";
import XcpNgPoolSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/SideMenu";
import { getXcpNgPoolResourceCounts } from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Layout";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
  XcpNgRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionBody,
  sectionRoot,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

/*
 * The two maps of the XCP-ng product: the product menu (every pool, the
 * install guide, the rule pages and, under Advanced, the archive) and one
 * pool's menu (its pages). Rendered for real against the real RouteMap, and
 * every href compared to the route the page is registered under, so a page
 * that is dropped, duplicated or pointed at the wrong route shows up by name.
 * The Docs/ux rulebook's side-menu rules hold here: everyday sections open,
 * Settings, Advanced and Developer folded until one of their pages is open,
 * every entry with an icon, Delete last and dangerous.
 */

const POOL_ID: ObjectID = new ObjectID("7a1d4c2e-5b3f-4e60-9a7b-0000000a0c01");

function poolRoute(key: string): string {
  return RouteUtil.populateRouteParams(RouteMap[key] as Route, {
    modelId: POOL_ID,
  }).toString();
}

function renderPoolMenu(counts?: {
  hosts?: number;
  vms?: number;
  storageRepositories?: number;
}): Promise<unknown> {
  return renderMenu(
    <XcpNgPoolSideMenu
      modelId={POOL_ID}
      resourceCounts={
        counts || {
          hosts: 3,
          vms: 42,
          storageRepositories: 4,
        }
      }
    />,
  );
}

// The whole text of an entry's link, its badge included.
function linkText(section: string, title: string): string {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    sectionRoot(section).querySelectorAll("a"),
  ).find((candidate: HTMLAnchorElement): boolean => {
    return (candidate.textContent || "").trim().startsWith(title);
  });
  if (!anchor) {
    throw new Error(`No entry "${title}" in section "${section}".`);
  }
  return (anchor.textContent || "").trim();
}

describe("the XCP-ng product side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/xcp-ng`);
  });

  afterEach(() => {
    cleanup();
  });

  test("has an XCP-ng section, a Settings section, Advanced and Developer, in that order", async () => {
    await renderMenu(<XcpNgSideMenu />);

    expect(sectionTitlesInOrder()).toEqual([
      "XCP-ng",
      "Settings",
      "Advanced",
      "Developer",
    ]);
  });

  test("the XCP-ng section reaches every pool, the connections a probe reads and the install guide", async () => {
    await renderMenu(<XcpNgSideMenu />);

    expect(linksIn("XCP-ng")).toEqual([
      { title: "All Pools", href: routeFor(PageMap.XCP_NG_POOLS) },
      { title: "Connections", href: routeFor(PageMap.XCP_NG_CONNECTIONS) },
      {
        title: "Documentation",
        href: routeFor(PageMap.XCP_NG_DOCUMENTATION),
      },
    ]);
    expect(iconCountIn("XCP-ng")).toBe(3);
  });

  test("a connection's own page marks Connections", async () => {
    goTo(
      routeFor(PageMap.XCP_NG_CONNECTIONS) +
        "/9e8d7c6b-2222-4a1b-9c0d-000000000001",
    );

    await renderMenu(<XcpNgSideMenu />);

    expect(activeLinkTitles()).toEqual(["Connections"]);
  });

  test("the list's own page marks All Pools", async () => {
    await renderMenu(<XcpNgSideMenu />);

    expect(activeLinkTitles()).toEqual(["All Pools"]);
  });

  test("the Settings section holds the rule pages and their history, and starts collapsed", async () => {
    await renderMenu(<XcpNgSideMenu />);

    expect(linksIn("Settings")).toEqual([
      {
        title: "Owner Rules",
        href: routeFor(PageMap.XCP_NG_SETTINGS_OWNER_RULES),
      },
      {
        title: "Label Rules",
        href: routeFor(PageMap.XCP_NG_SETTINGS_LABEL_RULES),
      },
      {
        title: "Rule Audit Logs",
        href: routeFor(PageMap.XCP_NG_SETTINGS_RULES_AUDIT_LOGS),
      },
    ]);
    expect(iconCountIn("Settings")).toBe(3);
    expect(isExpanded("XCP-ng")).toBe(true);
    expect(isExpanded("Settings")).toBe(false);
    expect(sectionBody("Settings").className).toContain("max-h-0");

    fireEvent.click(sectionToggle("Settings"));
    expect(isExpanded("Settings")).toBe(true);
  });

  test.each([
    [PageMap.XCP_NG_SETTINGS_OWNER_RULES, "Owner Rules"],
    [PageMap.XCP_NG_SETTINGS_LABEL_RULES, "Label Rules"],
    [PageMap.XCP_NG_SETTINGS_RULES_AUDIT_LOGS, "Rule Audit Logs"],
  ])(
    "on %s the Settings section opens by itself, with %s marked",
    async (key: string, title: string) => {
      goTo(routeFor(key));

      await renderMenu(<XcpNgSideMenu />);

      expect(isExpanded("Settings")).toBe(true);
      expect(activeLinkTitles()).toEqual([title]);
    },
  );

  test("the archive waits in Advanced, which starts collapsed", async () => {
    await renderMenu(<XcpNgSideMenu />);

    expect(linksIn("Advanced")).toEqual([
      { title: "Archived", href: routeFor(PageMap.XCP_NG_POOLS_ARCHIVED) },
    ]);
    expect(iconCountIn("Advanced")).toBe(1);
    expect(isExpanded("Advanced")).toBe(false);
    expect(sectionBody("Advanced").className).toContain("max-h-0");
  });

  test("Advanced opens by itself on the Archived page", async () => {
    goTo(routeFor(PageMap.XCP_NG_POOLS_ARCHIVED));

    await renderMenu(<XcpNgSideMenu />);

    expect(isExpanded("Advanced")).toBe(true);
    expect(sectionBody("Advanced").className).not.toContain("max-h-0");
    expect(activeLinkTitles()).toEqual(["Archived"]);
  });

  test("the Developer section starts collapsed", async () => {
    await renderMenu(<XcpNgSideMenu />);

    expect(isExpanded("Developer")).toBe(false);
  });

  test("every link resolves in the current project, under /xcp-ng", async () => {
    await renderMenu(<XcpNgSideMenu />);

    for (const href of hrefsInMenu()) {
      expect(href.startsWith(`/dashboard/${PROJECT_ID}/xcp-ng`)).toBe(true);
      expect(href).not.toContain(":");
    }
  });

  test("it reaches every product-level page of the route table", async () => {
    await renderMenu(<XcpNgSideMenu />);

    const hrefs: Array<string> = hrefsInMenu();
    const productPages: Array<string> = [
      PageMap.XCP_NG_POOLS,
      ...Object.keys(XcpNgRoutePath).filter((key: string): boolean => {
        // A pool's pages, and a rule's or a connection's own page, are not menu entries.
        return !XcpNgRoutePath[key]!.includes(":id");
      }),
    ];

    expect(productPages).toHaveLength(7);
    for (const key of productPages) {
      expect(hrefs).toContain(routeFor(key));
    }
  });

  test("names the section and the page on a phone", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(routeFor(PageMap.XCP_NG_POOLS_ARCHIVED));

    await renderMenu(<XcpNgSideMenu />);

    expect(mobileSummaryText()).toContain("Advanced / Archived");
  });
});

describe("one XCP-ng pool's side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(poolRoute(PageMap.XCP_NG_POOL_VIEW));
    recommendationsResourceTypes.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  test("has the Basic, Observability, Activity, Developer and Advanced sections, in order", async () => {
    await renderPoolMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "Observability",
      "Activity",
      "Developer",
      "Advanced",
    ]);
  });

  test("Basic leads with what the pool is made of: Overview, Hosts, VMs, Storage, then Topology", async () => {
    await renderPoolMenu();

    expect(linksIn("Basic")).toEqual([
      { title: "Overview", href: poolRoute(PageMap.XCP_NG_POOL_VIEW) },
      { title: "Hosts", href: poolRoute(PageMap.XCP_NG_POOL_VIEW_HOSTS) },
      { title: "VMs", href: poolRoute(PageMap.XCP_NG_POOL_VIEW_VMS) },
      { title: "Storage", href: poolRoute(PageMap.XCP_NG_POOL_VIEW_STORAGE) },
      {
        title: "Topology",
        href: poolRoute(PageMap.XCP_NG_POOL_VIEW_TOPOLOGY),
      },
    ]);
  });

  test("Observability holds how the pool runs: Resource Usage, Recommendations, Metrics and Logs", async () => {
    await renderPoolMenu();

    expect(linksIn("Observability")).toEqual([
      {
        title: "Resource Usage",
        href: poolRoute(PageMap.XCP_NG_POOL_VIEW_INSIGHTS),
      },
      {
        title: "Recommendations",
        href: poolRoute(PageMap.XCP_NG_POOL_VIEW_RECOMMENDATIONS),
      },
      { title: "Metrics", href: poolRoute(PageMap.XCP_NG_POOL_VIEW_METRICS) },
      { title: "Logs", href: poolRoute(PageMap.XCP_NG_POOL_VIEW_LOGS) },
    ]);
  });

  test("Activity holds what happened to the pool, its Feed last", async () => {
    await renderPoolMenu();

    expect(linksIn("Activity")).toEqual([
      {
        title: "Incidents",
        href: poolRoute(PageMap.XCP_NG_POOL_VIEW_INCIDENTS),
      },
      { title: "Alerts", href: poolRoute(PageMap.XCP_NG_POOL_VIEW_ALERTS) },
      {
        title: "Scheduled Maintenance",
        href: poolRoute(PageMap.XCP_NG_POOL_VIEW_SCHEDULED_MAINTENANCE),
      },
      { title: "Feed", href: poolRoute(PageMap.XCP_NG_POOL_VIEW_FEED) },
    ]);
  });

  test("Advanced holds who owns it, its settings, its history, its install guide and Delete", async () => {
    await renderPoolMenu();

    expect(linksIn("Advanced")).toEqual([
      { title: "Owners", href: poolRoute(PageMap.XCP_NG_POOL_VIEW_OWNERS) },
      {
        title: "Settings",
        href: poolRoute(PageMap.XCP_NG_POOL_VIEW_SETTINGS),
      },
      {
        title: "Audit Logs",
        href: poolRoute(PageMap.XCP_NG_POOL_VIEW_AUDIT_LOGS),
      },
      {
        title: "Documentation",
        href: poolRoute(PageMap.XCP_NG_POOL_VIEW_DOCUMENTATION),
      },
      {
        title: "Delete Pool",
        href: poolRoute(PageMap.XCP_NG_POOL_VIEW_DELETE),
      },
    ]);
  });

  test("the everyday sections start open; Developer and Advanced start folded", async () => {
    await renderPoolMenu();

    expect(isExpanded("Basic")).toBe(true);
    expect(isExpanded("Observability")).toBe(true);
    expect(isExpanded("Activity")).toBe(true);
    expect(isExpanded("Developer")).toBe(false);
    expect(isExpanded("Advanced")).toBe(false);
    expect(sectionBody("Advanced").className).toContain("max-h-0");
  });

  test("Hosts, VMs and Storage carry the pool's counts as badges", async () => {
    await renderPoolMenu({ hosts: 3, vms: 42, storageRepositories: 4 });

    expect(linkText("Basic", "Hosts")).toBe("Hosts3");
    expect(linkText("Basic", "VMs")).toBe("VMs42");
    expect(linkText("Basic", "Storage")).toBe("Storage4");
    // No count on the pages that have none.
    expect(linkText("Basic", "Overview")).toBe("Overview");
    expect(linkText("Basic", "Topology")).toBe("Topology");
  });

  test("a count the pool has not reported draws no badge, never a 0 it never measured", async () => {
    await renderPoolMenu({});

    expect(linkText("Basic", "Hosts")).toBe("Hosts");
    expect(linkText("Basic", "VMs")).toBe("VMs");
    expect(linkText("Basic", "Storage")).toBe("Storage");
  });

  test("the layout reads the badges from the pool's row, a missing count as none", () => {
    expect(
      getXcpNgPoolResourceCounts({
        hostCount: 3,
        vmCount: 42,
        storageRepositoryCount: 4,
      }),
    ).toEqual({ hosts: 3, vms: 42, storageRepositories: 4 });
    // A pool whose counts were never written.
    expect(getXcpNgPoolResourceCounts({})).toEqual({
      hosts: undefined,
      vms: undefined,
      storageRepositories: undefined,
    });
    // A pool that reported none: zero is a count, shown as one.
    expect(
      getXcpNgPoolResourceCounts({
        hostCount: 0,
        vmCount: 0,
        storageRepositoryCount: 0,
      }),
    ).toEqual({ hosts: 0, vms: 0, storageRepositories: 0 });
    // A bigint column read as a string, and a value that is no count.
    expect(
      getXcpNgPoolResourceCounts({
        hostCount: "12" as unknown as number,
        vmCount: Number.NaN,
        storageRepositoryCount: -1,
      }),
    ).toEqual({ hosts: 12, vms: undefined, storageRepositories: undefined });
  });

  test("the Recommendations entry is the XCP-ng templates'", async () => {
    await renderPoolMenu();

    expect(recommendationsResourceTypes.length).toBeGreaterThan(0);
    expect(recommendationsResourceTypes[0]).toBe("XcpNg");
  });

  test("reaches every page of the pool's route table, each exactly once, its detail pages through their lists", async () => {
    await renderPoolMenu();

    // The Developer section's pages are generated, not in the route table.
    const developerHrefs: Array<string> = hrefsInMenu().filter(
      (href: string): boolean => {
        return href.includes("/developer/");
      },
    );
    const hrefs: Array<string> = hrefsInMenu().filter(
      (href: string): boolean => {
        return !href.includes("/developer/");
      },
    );
    const viewPages: Array<string> = Object.keys(XcpNgRoutePath).filter(
      (key: string): boolean => {
        return key.startsWith("XCP_NG_POOL_VIEW") && !key.endsWith("_DETAIL");
      },
    );

    // Terraform, Crossplane, API, CLI and AI Assistants.
    expect(developerHrefs).toHaveLength(5);
    expect(viewPages).toHaveLength(18);
    expect(hrefs).toHaveLength(18);
    expect(new Set(hrefs).size).toBe(18);
    for (const key of viewPages) {
      expect(hrefs).toContain(poolRoute(key));
    }
    for (const href of hrefs) {
      expect(href).toContain(POOL_ID.toString());
      expect(href).toContain(`/dashboard/${PROJECT_ID}/xcp-ng/`);
    }
  });

  test("Delete is last and marked dangerous", async () => {
    await renderPoolMenu();

    expect(titlesInMenu()[titlesInMenu().length - 1]).toBe("Delete Pool");
    const deleteLink: HTMLElement = screen.getByRole("link", {
      name: "Delete Pool",
    });
    expect(deleteLink.closest(".danger-on-hover")).not.toBeNull();
  });

  test("every entry carries an icon", async () => {
    await renderPoolMenu();

    expect(iconCountIn("Basic")).toBe(5);
    expect(iconCountIn("Observability")).toBe(4);
    expect(iconCountIn("Activity")).toBe(4);
    expect(iconCountIn("Advanced")).toBe(5);
  });

  test.each([
    [PageMap.XCP_NG_POOL_VIEW_HOSTS, "Hosts", "Basic"],
    [PageMap.XCP_NG_POOL_VIEW_VMS, "VMs", "Basic"],
    [PageMap.XCP_NG_POOL_VIEW_STORAGE, "Storage", "Basic"],
    [PageMap.XCP_NG_POOL_VIEW_TOPOLOGY, "Topology", "Basic"],
    [PageMap.XCP_NG_POOL_VIEW_INSIGHTS, "Resource Usage", "Observability"],
    [PageMap.XCP_NG_POOL_VIEW_METRICS, "Metrics", "Observability"],
    [PageMap.XCP_NG_POOL_VIEW_LOGS, "Logs", "Observability"],
    [PageMap.XCP_NG_POOL_VIEW_INCIDENTS, "Incidents", "Activity"],
    [PageMap.XCP_NG_POOL_VIEW_FEED, "Feed", "Activity"],
    [PageMap.XCP_NG_POOL_VIEW_OWNERS, "Owners", "Advanced"],
    [PageMap.XCP_NG_POOL_VIEW_SETTINGS, "Settings", "Advanced"],
    [PageMap.XCP_NG_POOL_VIEW_DOCUMENTATION, "Documentation", "Advanced"],
    [PageMap.XCP_NG_POOL_VIEW_DELETE, "Delete Pool", "Advanced"],
  ])(
    "on %s it marks %s, in an open %s section",
    async (key: string, title: string, section: string) => {
      goTo(poolRoute(key));

      await renderPoolMenu();

      expect(isExpanded(section)).toBe(true);
      expect(
        screen.getByRole("link", { name: new RegExp(`^${title}`) }),
      ).toHaveClass("bg-indigo-50");
    },
  );

  test("the overview marks Overview, not a list", async () => {
    await renderPoolMenu();

    expect(activeLinkTitles()).toEqual(["Overview"]);
  });

  test.each([
    ["a host", "hosts/1e5b6a3c-58a1-4d14-a0b1-3b5c7c8d9e01", "Hosts"],
    ["a VM", "vms/0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", "VMs"],
    [
      "a storage repository",
      "storage/6f5e4d3c-2b1a-4098-8776-5544332211ff",
      "Storage",
    ],
  ])(
    "the page of %s marks its list",
    async (_: string, path: string, list: string) => {
      goTo(`${poolRoute(PageMap.XCP_NG_POOL_VIEW)}/${path}`);

      await renderPoolMenu();

      expect(activeLinkTitles()).toEqual([list]);
    },
  );

  test("another pool's host page marks nothing here", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/xcp-ng/7a1d4c2e-5b3f-4e60-9a7b-0000000a0c02/hosts/1e5b6a3c-58a1-4d14-a0b1-3b5c7c8d9e01`,
    );

    await renderPoolMenu();

    expect(activeLinkTitles()).toEqual([]);
  });

  test("names the section and the page on a phone", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(poolRoute(PageMap.XCP_NG_POOL_VIEW_VMS));

    await renderPoolMenu();

    expect(mobileSummaryText()).toContain("Basic / VMs");
  });

  test("on a phone, a VM's own page names VMs in the menu button", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(
      `${poolRoute(PageMap.XCP_NG_POOL_VIEW)}/vms/0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f`,
    );

    await renderPoolMenu();

    expect(mobileSummaryText()).toContain("Basic / VMs");
  });
});
