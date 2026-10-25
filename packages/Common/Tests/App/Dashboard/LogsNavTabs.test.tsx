import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import LogsNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsNavTabs";
import { getActiveLogsTab } from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Layout";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * Logs' tabs: the AI tab sits after Insights - both lenses on the same
 * logs - and before the Setup Guide and Settings, as on Traces, and opens
 * the AI section on its Insights. Every page of the AI section lights it,
 * the finding's own page too; no other tab's page does, and a log
 * Insights page is never mistaken for the AI section's Insights.
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

describe("Logs' tabs", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/logs`);
  });

  afterEach(() => {
    cleanup();
  });

  test("Viewer, Insights, AI, Setup Guide, Settings - AI opening its Insights", () => {
    render(
      <MemoryRouter>
        <LogsNavTabs active="viewer" />
      </MemoryRouter>,
    );

    const links: Array<{ label: string; href: string }> = tabLinks();

    expect(
      links.map((link: { label: string; href: string }) => {
        return link.label;
      }),
    ).toEqual(["Viewer", "Insights", "AI", "Setup Guide", "Settings"]);
    expect(links[2]!.href).toBe(routeFor(PageMap.LOGS_AI_INSIGHTS));
  });

  test("the AI tab is the one lit on its pages", () => {
    render(
      <MemoryRouter>
        <LogsNavTabs active="ai" />
      </MemoryRouter>,
    );

    expect(screen.getByText("AI").closest("a")).toHaveClass("bg-indigo-50");
    expect(screen.getByText("Insights").closest("a")).not.toHaveClass(
      "bg-indigo-50",
    );
  });

  test.each([
    [PageMap.LOGS_AI_INSIGHTS, "ai"],
    [PageMap.LOGS_AI_INSIGHT_VIEW, "ai"],
    [PageMap.LOGS_AI_ACTIVITY, "ai"],
    [PageMap.LOGS_AI_SETTINGS, "ai"],
    [PageMap.LOGS_INSIGHTS, "insights"],
    [PageMap.LOGS_SETTINGS_PIPELINES, "settings"],
    [PageMap.LOGS_SETTINGS_RECORDING_RULES, "settings"],
    [PageMap.LOGS_DOCUMENTATION, "setup"],
    [PageMap.LOGS, "viewer"],
  ])("%s is under the %s tab", (page: PageMap, tab: string) => {
    expect(getActiveLogsTab(RouteMap[page]!.toString())).toBe(tab);
  });
});
