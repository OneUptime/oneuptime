import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ExceptionsNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsNavTabs";
import { getActiveExceptionsTab } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionsNavigation";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * Exceptions' tabs: the AI tab sits after Insights - both lenses on the
 * same exceptions - and before the Setup Guide, and opens the AI section on
 * its Insights. Every page of the AI section lights it, the finding's own
 * page too; no other tab's page does.
 */

function tabLinks(): Array<{ label: string; href: string }> {
  return Array.from(document.querySelectorAll("nav a")).map(
    (link: Element): { label: string; href: string } => {
      return {
        label: link.textContent?.trim() || "",
        href: link.getAttribute("href") || "",
      };
    },
  );
}

describe("Exceptions' tabs", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/exceptions`);
    // No unresolved exception: the Exceptions tab carries no count.
    jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("Exceptions, Insights, AI, Setup Guide - AI opening its Insights", async () => {
    render(
      <MemoryRouter>
        <ExceptionsNavTabs active="exceptions" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(ModelAPI.count).toHaveBeenCalled();
    });

    const links: Array<{ label: string; href: string }> = tabLinks();

    expect(
      links.map((link: { label: string; href: string }) => {
        return link.label;
      }),
    ).toEqual(["Exceptions", "Insights", "AI", "Setup Guide"]);
    expect(links[2]!.href).toBe(routeFor(PageMap.EXCEPTIONS_AI_INSIGHTS));
  });

  test("the AI tab is the one lit on its pages", async () => {
    render(
      <MemoryRouter>
        <ExceptionsNavTabs active="ai" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(ModelAPI.count).toHaveBeenCalled();
    });

    expect(screen.getByText("AI").closest("a")).toHaveClass("bg-indigo-50");
    expect(screen.getByText("Insights").closest("a")).not.toHaveClass(
      "bg-indigo-50",
    );
  });

  test.each([
    [PageMap.EXCEPTIONS_AI_INSIGHTS, "ai"],
    [PageMap.EXCEPTIONS_AI_INSIGHT_VIEW, "ai"],
    [PageMap.EXCEPTIONS_AI_LOGS, "ai"],
    [PageMap.EXCEPTIONS_AI_SETTINGS, "ai"],
    [PageMap.EXCEPTIONS_OVERVIEW, "overview"],
    [PageMap.EXCEPTIONS_DOCUMENTATION, "setup"],
    [PageMap.EXCEPTIONS_UNRESOLVED, "exceptions"],
    [PageMap.EXCEPTIONS, "exceptions"],
  ])("%s is under the %s tab", (page: PageMap, tab: string) => {
    expect(getActiveExceptionsTab(RouteMap[page]!.toString())).toBe(tab);
  });
});
