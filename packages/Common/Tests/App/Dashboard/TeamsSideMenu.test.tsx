import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
} from "@testing-library/react";
import * as React from "react";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import Icon from "../../../UI/Components/Icon/Icon";
import TeamsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/SideMenu";
import { getTeamsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/TeamsBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  activeLinkTitles,
  allLinks,
  DESKTOP_WIDTH,
  goTo,
  iconCountIn,
  isExpanded,
  linksIn,
  MenuLink,
  MOBILE_WIDTH,
  mobileSummaryText,
  PROJECT_ID,
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
 * THE TEAMS MENU, AFTER ROLES MOVED INTO SETTINGS.
 *
 * The maintainer, over a screenshot of this menu (Teams: All Teams and
 * Roles; then Settings and Developer, both folded): "Move the roles page to
 * the settings side menu." So the Teams section keeps All Teams alone, and
 * Roles sits in Settings, first, above Custom Fields.
 *
 * What a move like this can get wrong, each pinned here against the real
 * component and the real RouteMap:
 *
 *  - Roles left behind beside All Teams, or listed twice;
 *  - Settings staying folded on Roles or on a role's own page, which would
 *    hide the page the reader is on inside a closed section;
 *  - Settings opening where it should not: on All Teams, on the Developer
 *    pages, or on a team's own pages whose addresses end like the Settings
 *    pages ("custom-fields");
 *  - a role's page no longer marking Roles;
 *  - the phone's one-line summary still naming the old section;
 *  - the breadcrumbs gaining a "Settings" level the address does not have:
 *    Settings is a fold in the menu, as it is for Custom Fields, not a
 *    level in the trail.
 *
 * The expected menu is written out in full rather than read from the
 * component, so changing the component alone cannot make these pass.
 */

const ROLE_ID: string = "6c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5";
const TEAM_ID: string = "7d2e3f4a-5b6c-4d7e-9f80-a1b2c3d4e5f6";

interface ExpectedEntry {
  title: string;
  pageMapKey: string;
  icon: IconProp;
}

interface ExpectedSection {
  title: string;
  foldedOnAllTeams: boolean;
  entries: Array<ExpectedEntry>;
}

const EXPECTED_SECTIONS: Array<ExpectedSection> = [
  // What people open Teams for: the teams. Open on arrival.
  {
    title: "Teams",
    foldedOnAllTeams: false,
    entries: [
      { title: "All Teams", pageMapKey: PageMap.TEAMS, icon: IconProp.Team },
    ],
  },
  /*
   * Set up once, revisited rarely: the roles teams are given, first, then
   * the fields a team's details can carry. Folded on arrival.
   */
  {
    title: "Settings",
    foldedOnAllTeams: true,
    entries: [
      {
        title: "Roles",
        pageMapKey: PageMap.TEAM_ROLES,
        icon: IconProp.Identification,
      },
      {
        title: "Custom Fields",
        pageMapKey: PageMap.TEAM_CUSTOM_FIELDS,
        icon: IconProp.TableCells,
      },
    ],
  },
  // Managing teams from code. Folded on arrival.
  {
    title: "Developer",
    foldedOnAllTeams: true,
    entries: [
      {
        title: "Terraform",
        pageMapKey: "TEAMS_DEVELOPER_TERRAFORM",
        icon: IconProp.Cube,
      },
      {
        title: "API",
        pageMapKey: "TEAMS_DEVELOPER_API",
        icon: IconProp.Code,
      },
      {
        title: "AI Assistants",
        pageMapKey: "TEAMS_DEVELOPER_AI_ASSISTANTS",
        icon: IconProp.Sparkles,
      },
    ],
  },
];

function expectedLinks(section: ExpectedSection): Array<MenuLink> {
  return section.entries.map((entry: ExpectedEntry): MenuLink => {
    return { title: entry.title, href: routeFor(entry.pageMapKey) };
  });
}

function sectionNamed(title: string): ExpectedSection {
  const found: ExpectedSection | undefined = EXPECTED_SECTIONS.find(
    (section: ExpectedSection): boolean => {
      return section.title === title;
    },
  );

  if (!found) {
    throw new Error(`No expected section "${title}"`);
  }

  return found;
}

// A page of a record: the route's template with the project and the id in.
function recordPath(pageMapKey: string, id: string): string {
  return RouteUtil.getRouteString(pageMapKey)
    .replace(":projectId", PROJECT_ID)
    .replace(":id", id);
}

function sectionsOpen(): Array<string> {
  return sectionTitlesInOrder().filter((title: string): boolean => {
    return isExpanded(title);
  });
}

function findAnchor(title: string): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    document.querySelectorAll("a"),
  ).find((candidate: Element): boolean => {
    return (
      candidate
        .querySelector('[data-testid="side-menu-item-title"]')
        ?.textContent?.trim() === title
    );
  }) as HTMLAnchorElement | undefined;

  if (!anchor) {
    throw new Error(`No side-menu link titled "${title}" was rendered.`);
  }

  return anchor;
}

// The outline an icon draws, by the paths of its <svg>.
function iconPaths(container: Element | null): Array<string> {
  return Array.from(container?.querySelectorAll("svg path") || []).map(
    (pathElement: Element): string => {
      return pathElement.getAttribute("d") || "";
    },
  );
}

function pathsOfIcon(icon: IconProp): Array<string> {
  const drawn: RenderResult = render(<Icon icon={icon} />);
  const paths: Array<string> = iconPaths(drawn.container);
  drawn.unmount();
  return paths;
}

async function renderTeamsMenu(): Promise<RenderResult> {
  return await renderMenu(<TeamsSideMenu />);
}

describe("Teams side menu: Roles in Settings", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    /*
     * A literal address first: the project id that fills every route is
     * read from the page's own address, so routeFor() needs one to read.
     */
    goTo(`/dashboard/${PROJECT_ID}/teams`);
  });

  afterEach(() => {
    cleanup();
  });

  describe("what is where", () => {
    test("renders Teams, Settings and Developer, in that order", async () => {
      await renderTeamsMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Teams",
        "Settings",
        "Developer",
      ]);
    });

    test("Teams holds All Teams alone: Roles is no longer beside it", async () => {
      await renderTeamsMenu();

      expect(linksIn("Teams")).toEqual(expectedLinks(sectionNamed("Teams")));
      expect(
        linksIn("Teams").map((link: MenuLink): string => {
          return link.title;
        }),
      ).not.toContain("Roles");
    });

    test("Settings holds Roles first, then Custom Fields", async () => {
      await renderTeamsMenu();

      expect(linksIn("Settings")).toEqual([
        { title: "Roles", href: routeFor(PageMap.TEAM_ROLES) },
        { title: "Custom Fields", href: routeFor(PageMap.TEAM_CUSTOM_FIELDS) },
      ]);
    });

    test("the whole menu is the expected one, section by section", async () => {
      await renderTeamsMenu();

      for (const section of EXPECTED_SECTIONS) {
        expect({
          section: section.title,
          links: linksIn(section.title),
        }).toEqual({ section: section.title, links: expectedLinks(section) });
      }
    });

    test("Roles is in the menu once, and every page is reached exactly once", async () => {
      await renderTeamsMenu();

      const titles: Array<string> = titlesInMenu();

      expect(
        titles.filter((title: string): boolean => {
          return title === "Roles";
        }),
      ).toHaveLength(1);
      expect(titles).toEqual(Array.from(new Set(titles)));
      expect(
        allLinks()
          .map((link: MenuLink): string => {
            return link.href;
          })
          .sort(),
      ).toEqual(
        EXPECTED_SECTIONS.flatMap((section: ExpectedSection) => {
          return expectedLinks(section);
        })
          .map((link: MenuLink): string => {
            return link.href;
          })
          .sort(),
      );
    });

    test("every link opens a page of this project, with no placeholder left in it", async () => {
      await renderTeamsMenu();

      for (const link of allLinks()) {
        expect(link.href.startsWith(`/dashboard/${PROJECT_ID}/teams`)).toBe(
          true,
        );
        expect(link.href).not.toContain(":");
      }
    });

    test("Roles keeps its ID card icon in its new section, and every row has an icon", async () => {
      await renderTeamsMenu();

      for (const section of EXPECTED_SECTIONS) {
        expect(iconCountIn(section.title)).toBe(section.entries.length);
      }

      for (const entry of sectionNamed("Settings").entries) {
        expect({
          entry: entry.title,
          paths: iconPaths(findAnchor(entry.title)),
        }).toEqual({ entry: entry.title, paths: pathsOfIcon(entry.icon) });
      }
    });
  });

  describe("folding", () => {
    test("on All Teams only Teams is open: Settings and Developer are folded away", async () => {
      await renderTeamsMenu();

      for (const section of EXPECTED_SECTIONS) {
        expect({
          section: section.title,
          open: isExpanded(section.title),
        }).toEqual({ section: section.title, open: !section.foldedOnAllTeams });
      }

      expect(sectionsOpen()).toEqual(["Teams"]);
      expect(sectionBody("Settings")).toHaveClass(
        "max-h-0",
        "opacity-0",
        "invisible",
      );
      expect(activeLinkTitles()).toEqual(["All Teams"]);
    });

    test("one row on arrival: All Teams", async () => {
      await renderTeamsMenu();

      const visibleRows: Array<string> = sectionsOpen().flatMap(
        (title: string): Array<string> => {
          return linksIn(title).map((link: MenuLink): string => {
            return link.title;
          });
        },
      );

      expect(visibleRows).toEqual(["All Teams"]);
    });

    test("folded Settings keeps Roles and Custom Fields mounted, and one click shows them", async () => {
      await renderTeamsMenu();

      expect(linksIn("Settings")).toHaveLength(2);

      fireEvent.click(sectionToggle("Settings"));

      expect(isExpanded("Settings")).toBe(true);
      expect(sectionBody("Settings")).toHaveClass("opacity-100");
      expect(sectionBody("Settings")).not.toHaveClass("invisible");

      fireEvent.click(sectionToggle("Settings"));

      expect(isExpanded("Settings")).toBe(false);
      expect(linksIn("Settings")).toEqual(
        expectedLinks(sectionNamed("Settings")),
      );
    });

    test("the Settings toggle names what it opens and the rows it controls", async () => {
      await renderTeamsMenu();

      const toggle: HTMLElement = sectionToggle("Settings");

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle.getAttribute("aria-controls")).toBe(
        sectionBody("Settings").id,
      );
      expect(sectionRoot("Settings")).toContainElement(findAnchor("Roles"));
    });
  });

  describe("the page you are on", () => {
    test("Roles opens Settings by itself and is marked", async () => {
      goTo(routeFor(PageMap.TEAM_ROLES));

      await renderTeamsMenu();

      expect(isExpanded("Settings")).toBe(true);
      expect(sectionBody("Settings")).toHaveClass("opacity-100");
      expect(sectionBody("Settings")).not.toHaveClass("invisible");
      expect(isExpanded("Developer")).toBe(false);
      expect(activeLinkTitles()).toEqual(["Roles"]);
    });

    test("a role's own page opens Settings by itself and keeps Roles marked", async () => {
      goTo(recordPath(PageMap.TEAM_ROLE_VIEW, ROLE_ID));

      await renderTeamsMenu();

      expect(isExpanded("Settings")).toBe(true);
      expect(sectionBody("Settings")).not.toHaveClass("invisible");
      expect(isExpanded("Developer")).toBe(false);
      expect(activeLinkTitles()).toEqual(["Roles"]);
      // Marked, yet still a link back to the list of roles.
      expect(findAnchor("Roles")).toHaveAttribute(
        "href",
        routeFor(PageMap.TEAM_ROLES),
      );
    });

    test("Custom Fields opens Settings by itself, as before, and is marked", async () => {
      goTo(routeFor(PageMap.TEAM_CUSTOM_FIELDS));

      await renderTeamsMenu();

      expect(isExpanded("Settings")).toBe(true);
      expect(isExpanded("Developer")).toBe(false);
      expect(activeLinkTitles()).toEqual(["Custom Fields"]);
    });

    test.each([
      ["Terraform", "TEAMS_DEVELOPER_TERRAFORM"],
      ["API", "TEAMS_DEVELOPER_API"],
      ["AI Assistants", "TEAMS_DEVELOPER_AI_ASSISTANTS"],
    ])(
      "the Developer page %s opens Developer, and leaves Settings folded",
      async (title: string, pageMapKey: string) => {
        goTo(routeFor(pageMapKey));

        await renderTeamsMenu();

        expect(isExpanded("Developer")).toBe(true);
        expect(isExpanded("Settings")).toBe(false);
        expect(activeLinkTitles()).toEqual([title]);
      },
    );

    /*
     * A team's own pages draw their own menu, but their addresses sit under
     * the Teams list's and one of them ends like a Settings page
     * (/teams/<id>/custom-fields): none of them may pass for a page of
     * Settings, nor for a role's page.
     */
    test.each([
      [PageMap.TEAM_VIEW],
      [PageMap.TEAM_VIEW_MEMBERS],
      [PageMap.TEAM_VIEW_PERMISSIONS],
      [PageMap.TEAM_VIEW_CUSTOM_FIELDS],
      [PageMap.TEAM_VIEW_DELETE],
    ])(
      "a team's page (%s) is no page of Settings: it stays folded and marks nothing in it",
      async (pageMapKey: string) => {
        goTo(recordPath(pageMapKey, TEAM_ID));

        await renderTeamsMenu();

        expect(isExpanded("Settings")).toBe(false);
        expect(activeLinkTitles()).not.toContain("Roles");
        expect(activeLinkTitles()).not.toContain("Custom Fields");
      },
    );

    test("moving from All Teams to Roles opens Settings without a reload", async () => {
      const rendered: RenderResult = await renderTeamsMenu();

      expect(isExpanded("Settings")).toBe(false);

      goTo(routeFor(PageMap.TEAM_ROLES));
      await act(async () => {
        rendered.rerender(<TeamsSideMenu />);
      });

      expect(isExpanded("Settings")).toBe(true);
      expect(activeLinkTitles()).toEqual(["Roles"]);
    });

    test("moving from Roles to a role's page keeps Settings open and Roles marked", async () => {
      goTo(routeFor(PageMap.TEAM_ROLES));
      const rendered: RenderResult = await renderTeamsMenu();

      goTo(recordPath(PageMap.TEAM_ROLE_VIEW, ROLE_ID));
      await act(async () => {
        rendered.rerender(<TeamsSideMenu />);
      });

      expect(isExpanded("Settings")).toBe(true);
      expect(activeLinkTitles()).toEqual(["Roles"]);
    });
  });

  describe("on a phone", () => {
    // The page's key, then the one line the closed menu shows on it.
    test.each([
      [PageMap.TEAMS, "Teams / All Teams"],
      [PageMap.TEAM_ROLES, "Settings / Roles"],
      [PageMap.TEAM_ROLE_VIEW, "Settings / Roles"],
      [PageMap.TEAM_CUSTOM_FIELDS, "Settings / Custom Fields"],
    ])(
      "on %s the menu's button reads %s",
      async (pageMapKey: string, summary: string) => {
        setViewportWidth(MOBILE_WIDTH);
        goTo(recordPath(pageMapKey, ROLE_ID));

        await renderTeamsMenu();

        expect(mobileSummaryText()).toContain(summary);
        expect(mobileSummaryText()).not.toContain("Teams / Roles");
      },
    );
  });

  describe("breadcrumbs", () => {
    function trailOf(pageMapKey: string, pagePath: string): Array<Link> {
      goTo(pagePath);

      const trail: Array<Link> | undefined = getTeamsBreadcrumbs(
        RouteUtil.getRouteString(pageMapKey),
      );

      if (!trail) {
        throw new Error(`No breadcrumbs for ${pageMapKey}`);
      }

      return trail;
    }

    function titlesOf(trail: Array<Link>): Array<string> {
      return trail.map((link: Link): string => {
        return link.title;
      });
    }

    test("Roles: Project > Teams > Roles, as Custom Fields: Settings is a fold, not a level", () => {
      expect(
        titlesOf(trailOf(PageMap.TEAM_ROLES, routeFor(PageMap.TEAM_ROLES))),
      ).toEqual(["Project", "Teams", "Roles"]);
      expect(
        titlesOf(
          trailOf(
            PageMap.TEAM_CUSTOM_FIELDS,
            routeFor(PageMap.TEAM_CUSTOM_FIELDS),
          ),
        ),
      ).toEqual(["Project", "Teams", "Custom Fields"]);
    });

    test("a role's page: Project > Teams > Roles > View Role, its Roles crumb leading back to the list", () => {
      const trail: Array<Link> = trailOf(
        PageMap.TEAM_ROLE_VIEW,
        recordPath(PageMap.TEAM_ROLE_VIEW, ROLE_ID),
      );

      expect(titlesOf(trail)).toEqual([
        "Project",
        "Teams",
        "Roles",
        "View Role",
      ]);
      expect(trail[1]?.to.toString()).toBe(routeFor(PageMap.TEAMS));
      expect(trail[2]?.to.toString()).toBe(routeFor(PageMap.TEAM_ROLES));
    });

    test("no Teams trail names Settings: the Teams pages' addresses have no such level", () => {
      for (const pageMapKey of [
        PageMap.TEAMS,
        PageMap.TEAM_ROLES,
        PageMap.TEAM_ROLE_VIEW,
        PageMap.TEAM_CUSTOM_FIELDS,
      ]) {
        const trail: Array<Link> = trailOf(
          pageMapKey,
          recordPath(pageMapKey, ROLE_ID),
        );

        expect({ pageMapKey, titles: titlesOf(trail) }).toEqual({
          pageMapKey,
          titles: expect.not.arrayContaining(["Settings"]),
        });
      }
    });

    test("each Settings entry's trail ends on the title the menu gives it", async () => {
      await renderTeamsMenu();

      for (const link of linksIn("Settings")) {
        const entry: ExpectedEntry | undefined = sectionNamed(
          "Settings",
        ).entries.find((candidate: ExpectedEntry): boolean => {
          return candidate.title === link.title;
        });

        expect(entry).toBeDefined();

        const titles: Array<string> = titlesOf(
          trailOf(entry!.pageMapKey, link.href),
        );

        expect(titles[titles.length - 1]).toBe(link.title);
      }
    });
  });

  test("a role's address is the Roles page's, then the role's id", () => {
    expect(recordPath(PageMap.TEAM_ROLE_VIEW, ROLE_ID)).toBe(
      `${routeFor(PageMap.TEAM_ROLES)}/${ROLE_ID}`,
    );
    expect(recordPath(PageMap.TEAM_VIEW_CUSTOM_FIELDS, TEAM_ID)).toBe(
      `${routeFor(PageMap.TEAMS)}/${TEAM_ID}/custom-fields`,
    );
  });
});
