import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import MetricsNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsNavTabs";
import { getActiveMetricsTab } from "../../../../App/FeatureSet/Dashboard/src/Pages/Metrics/Layout";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * Metrics' tabs: the AI tab sits after Insights - both lenses on the same
 * metrics - and before the Setup Guide and Settings, and opens the AI
 * section on its Insights. Every page of the AI section lights it, the
 * finding's own page too; no other tab's page does.
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

describe("Metrics' tabs", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/metrics`);
  });

  afterEach(() => {
    cleanup();
  });

  test("Viewer, Insights, AI, Setup Guide, Settings - AI opening its Insights", () => {
    render(
      <MemoryRouter>
        <MetricsNavTabs active="viewer" />
      </MemoryRouter>,
    );

    const links: Array<{ label: string; href: string }> = tabLinks();

    expect(
      links.map((link: { label: string; href: string }) => {
        return link.label;
      }),
    ).toEqual(["Viewer", "Insights", "AI", "Setup Guide", "Settings"]);
    expect(links[2]!.href).toBe(routeFor(PageMap.METRICS_AI_INSIGHTS));
  });

  test("the AI tab is the one lit on its pages", () => {
    render(
      <MemoryRouter>
        <MetricsNavTabs active="ai" />
      </MemoryRouter>,
    );

    expect(screen.getByText("AI").closest("a")).toHaveClass("bg-indigo-50");
    expect(screen.getByText("Insights").closest("a")).not.toHaveClass(
      "bg-indigo-50",
    );
  });

  test.each([
    [PageMap.METRICS_AI_INSIGHTS, "ai"],
    [PageMap.METRICS_AI_INSIGHT_VIEW, "ai"],
    [PageMap.METRICS_AI_LOGS, "ai"],
    [PageMap.METRICS_AI_SETTINGS, "ai"],
    [PageMap.METRICS_INSIGHTS, "insights"],
    [PageMap.METRICS_SETTINGS_PIPELINE_RULES, "settings"],
    [PageMap.METRICS_SETTINGS_RECORDING_RULES, "settings"],
    [PageMap.METRICS_DOCUMENTATION, "setup"],
    [PageMap.METRIC_VIEW, "viewer"],
    [PageMap.METRICS, "viewer"],
  ])("%s is under the %s tab", (page: PageMap, tab: string) => {
    expect(getActiveMetricsTab(RouteMap[page]!.toString())).toBe(tab);
  });
});
