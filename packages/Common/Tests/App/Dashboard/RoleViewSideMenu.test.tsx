import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import TeamRoleViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/RoleViewSideMenu";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  getDeveloperDocsPageKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  activeLinkTitles,
  allLinks,
  currentEntries,
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
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * A CUSTOM ROLE'S OWN MENU (#10139).
 *
 * A role's page sat inside the Teams menu, with Roles marked and no menu
 * of its own, so none of a custom role's Developer pages could be reached:
 * the Delete it step #10031 wrote for its API and CLI pages, which says
 * what the workflows that run as it need, was seen by nobody. Now a role's
 * pages have their own menu, as a team's do:
 *
 *   - Custom Role > Overview: the role's page, open on arrival;
 *   - Developer, folded: Terraform, Crossplane, API, CLI and AI
 *     Assistants, each for this role, opening by itself on its own page.
 *
 * The expected menu is written out in full rather than read from the
 * component, so changing the component alone cannot make these pass.
 */

const ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000aa";
const OTHER_ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000bb";

// A page of a role: its route, filled in with the project and the role.
function rolePage(pageMapKey: string, roleId: string = ROLE_ID): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(roleId),
  }).toString();
}

function developerPage(
  page: DeveloperDocsPageDefinition,
  roleId: string = ROLE_ID,
): string {
  return rolePage(
    getDeveloperDocsPageKey(PageMap.TEAM_ROLE_VIEW, page.type),
    roleId,
  );
}

async function renderRoleMenu(roleId: string = ROLE_ID): Promise<void> {
  await renderMenu(<TeamRoleViewSideMenu modelId={new ObjectID(roleId)} />);
}

describe("a custom role's own menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    /*
     * A literal address first: the project id that fills every route is
     * read from the page's own address.
     */
    goTo(`/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`);
  });

  afterEach(() => {
    cleanup();
  });

  describe("what is where", () => {
    test("the role, then its Developer pages", async () => {
      await renderRoleMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Custom Role",
        DEVELOPER_DOCS_SECTION_TITLE,
      ]);
    });

    test("Custom Role holds the role's own page, by its address", async () => {
      await renderRoleMenu();

      expect(linksIn("Custom Role")).toEqual([
        {
          title: "Overview",
          href: `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`,
        },
      ]);
    });

    test("Developer holds the five pages, in the menu's order, each for this role", async () => {
      await renderRoleMenu();

      expect(linksIn(DEVELOPER_DOCS_SECTION_TITLE)).toEqual([
        {
          title: "Terraform",
          href: `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}/developer/terraform`,
        },
        {
          title: "Crossplane",
          href: `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}/developer/crossplane`,
        },
        {
          title: "API",
          href: `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}/developer/api`,
        },
        {
          title: "CLI",
          href: `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}/developer/cli`,
        },
        {
          title: "AI Assistants",
          href: `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}/developer/ai-assistants`,
        },
      ]);

      // As the registry draws every resource's section.
      expect(
        linksIn(DEVELOPER_DOCS_SECTION_TITLE).map((link: MenuLink): string => {
          return link.title;
        }),
      ).toEqual(
        DEVELOPER_DOCS_PAGES.map(
          (page: DeveloperDocsPageDefinition): string => {
            return page.title;
          },
        ),
      );
    });

    test("another role's menu leads to that role's pages", async () => {
      goTo(`/dashboard/${PROJECT_ID}/teams/roles/${OTHER_ROLE_ID}`);

      await renderRoleMenu(OTHER_ROLE_ID);

      for (const link of allLinks()) {
        expect(link.href).toContain(`/teams/roles/${OTHER_ROLE_ID}`);
        expect(link.href).not.toContain(ROLE_ID);
      }
    });

    test("every entry has an icon, and the Developer pages keep theirs", async () => {
      await renderRoleMenu();

      expect(iconCountIn("Custom Role")).toBe(1);
      expect(iconCountIn(DEVELOPER_DOCS_SECTION_TITLE)).toBe(
        DEVELOPER_DOCS_PAGES.length,
      );
      expect(
        DEVELOPER_DOCS_PAGES.map(
          (page: DeveloperDocsPageDefinition): IconProp => {
            return page.icon;
          },
        ),
      ).toEqual([
        IconProp.Terraform,
        IconProp.Crossplane,
        IconProp.Code,
        IconProp.Terminal,
        IconProp.Sparkles,
      ]);
    });

    test("no link is left with a placeholder in it", async () => {
      await renderRoleMenu();

      for (const link of allLinks()) {
        expect(link.href).not.toContain(":");
        expect(link.href.startsWith(`/dashboard/${PROJECT_ID}/`)).toBe(true);
      }
    });
  });

  describe("the page you are on", () => {
    test("on the role's page: Overview is marked, Developer is folded", async () => {
      await renderRoleMenu();

      expect(activeLinkTitles()).toEqual(["Overview"]);
      expect(currentEntries()).toEqual([
        { title: "Overview", current: "page" },
      ]);
      expect(isExpanded("Custom Role")).toBe(true);
      expect(isExpanded(DEVELOPER_DOCS_SECTION_TITLE)).toBe(false);
      expect(sectionBody(DEVELOPER_DOCS_SECTION_TITLE)).toHaveClass(
        "max-h-0",
        "opacity-0",
        "invisible",
      );
    });

    test.each(
      DEVELOPER_DOCS_PAGES.map(
        (
          page: DeveloperDocsPageDefinition,
        ): [string, DeveloperDocsPageDefinition] => {
          return [page.title, page];
        },
      ),
    )(
      "on its %s page: Developer opens by itself and marks it, and Overview is not marked",
      async (title: string, page: DeveloperDocsPageDefinition) => {
        goTo(developerPage(page));

        await renderRoleMenu();

        expect(isExpanded(DEVELOPER_DOCS_SECTION_TITLE)).toBe(true);
        expect(sectionBody(DEVELOPER_DOCS_SECTION_TITLE)).not.toHaveClass(
          "invisible",
        );
        expect(activeLinkTitles()).toEqual([title]);
      },
    );

    test("one click opens the folded Developer section", async () => {
      await renderRoleMenu();

      fireEvent.click(sectionToggle(DEVELOPER_DOCS_SECTION_TITLE));

      expect(isExpanded(DEVELOPER_DOCS_SECTION_TITLE)).toBe(true);
    });

    test("another role's pages mark nothing in this role's menu", async () => {
      goTo(
        developerPage(
          DEVELOPER_DOCS_PAGES[2] as DeveloperDocsPageDefinition,
          OTHER_ROLE_ID,
        ),
      );

      await renderRoleMenu();

      expect(activeLinkTitles()).toEqual([]);
    });
  });

  describe("on a phone", () => {
    test.each([
      [
        `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`,
        "Custom Role / Overview",
      ],
      [
        `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}/developer/api`,
        `${DEVELOPER_DOCS_SECTION_TITLE} / API`,
      ],
      [
        `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}/developer/cli`,
        `${DEVELOPER_DOCS_SECTION_TITLE} / CLI`,
      ],
    ])(
      "on %s the menu's button reads %s",
      async (path: string, summary: string) => {
        setViewportWidth(MOBILE_WIDTH);
        goTo(path);

        await renderRoleMenu();

        expect(mobileSummaryText()).toContain(summary);
      },
    );
  });
});
