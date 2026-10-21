import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * A team's side menu, rendered: Members & Access is Members and
 * Permissions. Block Permissions had an entry of its own there, as
 * prominent as what the team can do; it is folded under Advanced on the
 * Permissions page now, so the menu has no entry for it - and on the
 * Permissions page, the Permissions entry is the one marked as the page
 * you are on.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import TeamViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ObjectID from "../../../Types/ObjectID";
import {
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  allLinks,
  goTo,
  linksIn,
  renderMenu,
} from "./SideMenuHarness";

const TEAM_ID: ObjectID = new ObjectID("5c0e1d2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f");

const TEAM_URL: string = `/dashboard/${PROJECT_ID}/teams/${TEAM_ID.toString()}`;

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

function teamPage(pageMapKey: PageMap): string {
  return RouteMap[pageMapKey]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", TEAM_ID.toString());
}

afterEach(() => {
  cleanup();
});

describe("a team's side menu", () => {
  test("Members & Access is Members and Permissions", async () => {
    goTo(`${TEAM_URL}/members`);
    await renderMenu(<TeamViewSideMenu modelId={TEAM_ID} />);

    expect(linksIn("Members & Access")).toEqual([
      { title: "Members", href: teamPage(PageMap.TEAM_VIEW_MEMBERS) },
      { title: "Permissions", href: teamPage(PageMap.TEAM_VIEW_PERMISSIONS) },
    ]);
  });

  test("has no Block Permissions entry, anywhere", async () => {
    goTo(`${TEAM_URL}/permissions`);
    await renderMenu(<TeamViewSideMenu modelId={TEAM_ID} />);

    const links: Array<MenuLink> = allLinks();

    expect(links.length).toBeGreaterThan(0);
    expect(
      links.filter((link: MenuLink): boolean => {
        return (
          link.title === "Block Permissions" ||
          link.href.endsWith("/block-permissions")
        );
      }),
    ).toEqual([]);
  });

  test("on the Permissions page, Permissions is the page you are on", async () => {
    goTo(`${TEAM_URL}/permissions`);
    await renderMenu(<TeamViewSideMenu modelId={TEAM_ID} />);

    expect(activeLinkTitles()).toEqual(["Permissions"]);
  });

  test("the source has no Block Permissions item left to come back", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "Teams", "View", "SideMenu.tsx"),
      "utf8",
    );

    expect(source).not.toContain('title: "Block Permissions"');
    expect(source).not.toContain("BLOCK_PERMISSIONS");
  });
});
