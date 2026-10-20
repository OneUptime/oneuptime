import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import SettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  activeLinkTitles,
  DESKTOP_WIDTH,
  goTo,
  isExpanded,
  linksIn,
  MenuLink,
  PROJECT_ID,
  renderMenu,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * PROJECT SETTINGS → AI → EXTERNAL MCP SERVERS, IN THE SIDE MENU.
 *
 * The page sits in the AI section beside LLM Providers - the two are what
 * OneUptime AI uses - and OneUptime's own MCP Server, the other way round,
 * keeps its place at the end. A server's own page is one of the servers
 * listed there, so it keeps External MCP Servers marked, and its section
 * open: a reader on a server's page sees where they are.
 */

const SERVER_ID: string = "9e3f4a5b-6c7d-4e8f-a091-b2c3d4e5f607";

function serverPath(): string {
  return RouteUtil.getRouteString(PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVER_VIEW)
    .replace(":projectId", PROJECT_ID)
    .replace(":id", SERVER_ID);
}

describe("External MCP Servers in the Project Settings menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    // The project id every route is filled with is read from the address.
    goTo(`/dashboard/${PROJECT_ID}/settings`);
  });

  afterEach(() => {
    cleanup();
  });

  test("sits in AI after LLM Providers, apart from OneUptime's own MCP Server", async () => {
    goTo(routeFor(PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVERS));
    await renderMenu(<SettingsSideMenu />);

    const titles: Array<string> = linksIn("AI").map((link: MenuLink) => {
      return link.title;
    });

    expect(titles.indexOf("External MCP Servers")).toBe(
      titles.indexOf("LLM Providers") + 1,
    );
    expect(titles[titles.length - 1]).toBe("MCP Server");
    expect(
      linksIn("AI").find((link: MenuLink): boolean => {
        return link.title === "External MCP Servers";
      })?.href,
    ).toBe(routeFor(PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVERS));
  });

  test("the list marks External MCP Servers, and opens AI", async () => {
    goTo(routeFor(PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVERS));
    await renderMenu(<SettingsSideMenu />);

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual(["External MCP Servers"]);
  });

  test("a server's own page keeps External MCP Servers marked, linking back to the list", async () => {
    goTo(serverPath());
    await renderMenu(<SettingsSideMenu />);

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual(["External MCP Servers"]);
    expect(
      linksIn("AI").find((link: MenuLink): boolean => {
        return link.title === "External MCP Servers";
      })?.href,
    ).toBe(routeFor(PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVERS));
  });

  test("LLM Providers' page marks LLM Providers alone", async () => {
    goTo(routeFor(PageMap.SETTINGS_AI_LLM_PROVIDERS));
    await renderMenu(<SettingsSideMenu />);

    expect(activeLinkTitles()).toEqual(["LLM Providers"]);
  });
});
