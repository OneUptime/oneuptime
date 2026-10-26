import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import StatusPageSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Icon from "../../../UI/Components/Icon/Icon";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  allLinks,
  goTo,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  sectionBody,
  sectionRoot,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

/*
 * "Create a new section for rules and have monitor rules there. The section
 * should be collapsed by default" (the maintainer, of a status page's menu).
 *
 * Monitor Rules sat in Resources, beside the Resources page, where it took a
 * row on every visit to every status page: open, because Resources is what
 * the page shows. A rule is written once and then runs by itself, putting
 * every monitor that matches into its group as monitors are created or
 * relabelled (and the Add Monitors dialog writes one when a group is filled
 * from a label, #3418). So it now has a section of its own, Rules, folded
 * down to its title like every Rules section (SideMenuSectionState.ts), and
 * right below Resources: one section from the resources it writes, never
 * again three sections down under Advanced, where the person who filed #3418
 * never found it. An SLO's menu does the same with its Monitor Rules and
 * Burn Rate Rules (SloViewSideMenu.test.tsx).
 */

const MODEL_ID: string = "0193c0de-5555-4aaa-8bbb-0000000000d1";
// One monitor rule of the status page: its own page sits below Monitor Rules.
const MONITOR_RULE_ID: string = "0193c0de-5555-4aaa-8bbb-0000000000d2";

// A status page's address, with its id (and a rule's, for a rule's page) filled in.
function viewRoute(pageMapKey: string, subModelId?: string): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(MODEL_ID),
    subModelId: subModelId ? new ObjectID(subModelId) : undefined,
  }).toString();
}

async function renderMenuAt(address: string): Promise<void> {
  goTo(address);
  await renderMenu(<StatusPageSideMenu modelId={new ObjectID(MODEL_ID)} />);
}

/*
 * The d attributes an icon is drawn with, as the Icon component draws it on
 * its own: what tells the funnel the maintainer's screenshot shows from any
 * other icon.
 */
function drawnIconPaths(icon: IconProp): Array<string> {
  const { container, unmount } = render(<Icon icon={icon} />);
  const paths: Array<string> = Array.from(
    container.querySelectorAll("svg path"),
  ).map((path: Element): string => {
    return path.getAttribute("d") ?? "";
  });

  unmount();

  return paths;
}

// The d attributes of the icon a menu row draws beside its title.
function rowIconPaths(title: string): Array<string> {
  const row: HTMLElement = screen.getByRole("link", { name: title });

  return Array.from(row.querySelectorAll("svg path")).map(
    (path: Element): string => {
      return path.getAttribute("d") ?? "";
    },
  );
}

// The section a link sits in, by its address.
function sectionHolding(href: string): string {
  const holding: Array<string> = sectionTitlesInOrder().filter(
    (title: string): boolean => {
      return linksIn(title).some((link: MenuLink): boolean => {
        return link.href === href;
      });
    },
  );

  expect({ href, sections: holding.length }).toEqual({ href, sections: 1 });

  return holding[0] as string;
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a status page's Rules section: where it is and what it holds", () => {
  test("sits right after Resources, before the audience and setup sections", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW));

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "Resources",
      "Rules",
      "Subscribers",
      "Notification Logs",
      "Branding",
      "Security",
      "AI",
      "Developer",
      "Advanced",
    ]);
  });

  test("holds Monitor Rules, and nothing else", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW));

    expect(linksIn("Rules")).toEqual([
      {
        title: "Monitor Rules",
        href: viewRoute(PageMap.STATUS_PAGE_VIEW_MONITOR_RULES),
      },
    ]);
  });

  test("draws Monitor Rules with its funnel icon, as before the move", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW));

    expect(iconCountIn("Rules")).toBe(1);
    expect(rowIconPaths("Monitor Rules")).toEqual(
      drawnIconPaths(IconProp.Filter),
    );
    expect(rowIconPaths("Monitor Rules")).not.toEqual(
      drawnIconPaths(IconProp.AltGlobe),
    );
  });

  test("leaves Resources the resources page alone, named Monitors while the project has no monitor groups", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW));

    expect(linksIn("Resources")).toEqual([
      {
        title: "Monitors",
        href: viewRoute(PageMap.STATUS_PAGE_VIEW_RESOURCES),
      },
    ]);
  });

  test("with monitor groups on, Resources is the Resources page, and Rules still holds Monitor Rules", async () => {
    const project: Project = new Project();
    project.id = new ObjectID(PROJECT_ID);
    project.isFeatureFlagMonitorGroupsEnabled = true;
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);

    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW));

    expect(linksIn("Resources")).toEqual([
      {
        title: "Resources",
        href: viewRoute(PageMap.STATUS_PAGE_VIEW_RESOURCES),
      },
    ]);
    expect(linksIn("Rules")).toEqual([
      {
        title: "Monitor Rules",
        href: viewRoute(PageMap.STATUS_PAGE_VIEW_MONITOR_RULES),
      },
    ]);
  });

  /*
   * The two places it has been: Resources, beside the resources it writes,
   * and Advanced, three sections below them (#3418).
   */
  test("is the one place Monitor Rules is listed: not in Resources, not in Advanced", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW));

    const monitorRules: string = viewRoute(
      PageMap.STATUS_PAGE_VIEW_MONITOR_RULES,
    );

    expect(
      titlesInMenu().filter((title: string): boolean => {
        return title === "Monitor Rules";
      }),
    ).toHaveLength(1);
    expect(sectionHolding(monitorRules)).toBe("Rules");

    for (const section of ["Resources", "Advanced"]) {
      const hrefs: Array<string> = linksIn(section).map(
        (link: MenuLink): string => {
          return link.href;
        },
      );

      expect({
        section,
        listsMonitorRules: hrefs.includes(monitorRules),
      }).toEqual({ section, listsMonitorRules: false });
    }
  });
});

describe("a status page's Rules section: folded by default", () => {
  test("is folded on the status page's overview, its row out of sight and out of the keyboard's way", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW));

    expect(isExpanded("Rules")).toBe(false);
    expect(sectionBody("Rules")).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
    // The toggle names the rows it shows and hides.
    expect(sectionToggle("Rules")).toHaveAttribute(
      "aria-controls",
      sectionBody("Rules").id,
    );
    // What the page shows stays open beside it.
    expect(isExpanded("Basic")).toBe(true);
    expect(isExpanded("Resources")).toBe(true);
  });

  test("opens from its title, and folds again, with Resources open throughout", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW));

    fireEvent.click(sectionToggle("Rules"));

    expect(isExpanded("Rules")).toBe(true);
    expect(sectionBody("Rules")).not.toHaveClass("invisible");
    expect(sectionBody("Rules")).toHaveClass("opacity-100");
    expect(sectionBody("Rules").className).not.toContain("max-h-");
    expect(isExpanded("Resources")).toBe(true);
    expect(isExpanded("Subscribers")).toBe(false);

    fireEvent.click(sectionToggle("Rules"));

    expect(isExpanded("Rules")).toBe(false);
    expect(sectionBody("Rules")).toHaveClass("invisible");
    expect(isExpanded("Resources")).toBe(true);
  });

  test("stays folded on the Resources page, which marks the resources entry", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW_RESOURCES));

    expect(activeLinkTitles()).toEqual(["Monitors"]);
    expect(isExpanded("Resources")).toBe(true);
    expect(isExpanded("Rules")).toBe(false);
  });

  test.each([
    {
      entry: "Email Subscribers",
      section: "Subscribers",
      page: PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS,
    },
    {
      entry: "Branding",
      section: "Branding",
      page: PageMap.STATUS_PAGE_VIEW_BRANDING,
    },
    {
      entry: "Advanced Settings",
      section: "Advanced",
      page: PageMap.STATUS_PAGE_VIEW_SETTINGS,
    },
  ])(
    "stays folded on $entry, which opens $section",
    async (visit: { entry: string; section: string; page: string }) => {
      await renderMenuAt(viewRoute(visit.page));

      expect(activeLinkTitles()).toEqual([visit.entry]);
      expect(isExpanded(visit.section)).toBe(true);
      expect(isExpanded("Rules")).toBe(false);
    },
  );
});

describe("a status page's Rules section: never hides the page you are on", () => {
  test("the Monitor Rules page opens it, with Monitor Rules the one entry marked", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW_MONITOR_RULES));

    expect(isExpanded("Rules")).toBe(true);
    expect(sectionBody("Rules")).not.toHaveClass("invisible");
    expect(activeLinkTitles()).toEqual(["Monitor Rules"]);
    expect(sectionBody("Rules")).toContainElement(
      screen.getByRole("link", { name: "Monitor Rules" }),
    );
    // Nothing else folded opens with it.
    expect(isExpanded("Subscribers")).toBe(false);
    expect(isExpanded("Advanced")).toBe(false);
  });

  /*
   * One rule's page is not in the menu; the list it belongs to is. The
   * section holding the list opens, so the way back to the other rules is in
   * sight.
   */
  test("one monitor rule's own page opens it too", async () => {
    await renderMenuAt(
      viewRoute(PageMap.STATUS_PAGE_VIEW_MONITOR_RULE_VIEW, MONITOR_RULE_ID),
    );

    expect(isExpanded("Rules")).toBe(true);
    expect(sectionBody("Rules")).not.toHaveClass("invisible");
    expect(isExpanded("Subscribers")).toBe(false);
    expect(isExpanded("Advanced")).toBe(false);
  });

  test("on every page the menu links to, the section holding that page's entry is open", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW));

    const links: Array<MenuLink> = allLinks();

    expect(links.length).toBeGreaterThan(20);
    cleanup();

    for (const link of links) {
      await renderMenuAt(link.href);

      const section: string = sectionHolding(link.href);

      expect({ page: link.title, section, open: isExpanded(section) }).toEqual({
        page: link.title,
        section,
        open: true,
      });
      cleanup();
    }
  });

  test("on a phone, the menu names Rules and Monitor Rules", async () => {
    setViewportWidth(MOBILE_WIDTH);
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW_MONITOR_RULES));

    expect(mobileSummaryText()).toContain("Rules / Monitor Rules");
    expect(mobileSummaryText()).not.toContain("Resources / Monitor Rules");
  });

  test("the Rules section is one element of the menu, holding its own entry", async () => {
    await renderMenuAt(viewRoute(PageMap.STATUS_PAGE_VIEW_MONITOR_RULES));

    expect(sectionRoot("Rules")).toContainElement(sectionToggle("Rules"));
    expect(sectionRoot("Rules")).not.toContainElement(
      sectionToggle("Resources"),
    );
  });
});
