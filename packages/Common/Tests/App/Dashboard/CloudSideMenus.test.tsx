import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import CloudSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/SideMenu";
import CloudResourceViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/SideMenu";
import CloudAccountSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/SideMenu";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  hrefsInMenu,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The Cloud menus: the product's (its Overview, the accounts, every
 * resource in them, then Connect; what they cost, the ways to spend less
 * and the budgets under Spend), a cloud resource's - its incidents, alerts
 * and changes, under Activity - and a cloud account's. The environments
 * that managed platforms run are App Platforms' (AppPlatformsSideMenus.test.tsx).
 */

const RESOURCE_ID: string = "0193c0de-3333-4aaa-8bbb-000000000003";
const ACCOUNT_ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";
const CLOUD: string = `/dashboard/${PROJECT_ID}/cloud`;
const RESOURCE_PATH: string = `${CLOUD}/${RESOURCE_ID}`;
const ACCOUNT_PATH: string = `${CLOUD}/accounts/${ACCOUNT_ID}`;

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe("the Cloud product menu", () => {
  test("the Overview first, the accounts, every resource in them, then Connect; what they cost under Spend - no environments", async () => {
    goTo(`${CLOUD}/accounts`);
    await renderMenu(<CloudSideMenu />);

    expect(sectionTitlesInOrder()).toEqual([
      "Cloud",
      "Spend",
      "Settings",
      "Advanced",
      "Developer",
    ]);
    expect(linksIn("Cloud")).toEqual([
      { title: "Overview", href: CLOUD },
      { title: "Accounts", href: `${CLOUD}/accounts` },
      { title: "All Resources", href: `${CLOUD}/resources` },
      { title: "Connect", href: `${CLOUD}/connect` },
    ]);
    expect(linksIn("Spend")).toEqual([
      { title: "Costs", href: `${CLOUD}/costs` },
      { title: "Savings", href: `${CLOUD}/savings` },
      { title: "Budgets", href: `${CLOUD}/budgets` },
    ]);
    expect(linksIn("Settings")).toEqual([
      { title: "Owner Rules", href: `${CLOUD}/settings/owner-rules` },
      { title: "Label Rules", href: `${CLOUD}/settings/label-rules` },
    ]);
    expect(linksIn("Advanced")).toEqual([
      { title: "Archived", href: `${CLOUD}/archived` },
    ]);
    // The Developer pages of the resources list, under it.
    expect(linksIn("Developer")).toEqual([
      { title: "Terraform", href: `${CLOUD}/resources/developer/terraform` },
      { title: "API", href: `${CLOUD}/resources/developer/api` },
      { title: "CLI", href: `${CLOUD}/resources/developer/cli` },
      {
        title: "AI Assistants",
        href: `${CLOUD}/resources/developer/ai-assistants`,
      },
    ]);
    for (const href of hrefsInMenu()) {
      expect(href).not.toContain("app-platforms");
    }
  });
});

describe("a cloud resource's menu", () => {
  test("a resource a connection lists: its incidents, alerts and changes under Activity", async () => {
    goTo(RESOURCE_PATH);
    await renderMenu(
      <CloudResourceViewSideMenu modelId={new ObjectID(RESOURCE_ID)} />,
    );

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "Observability",
      "Activity",
      "Settings",
      "Developer",
      "Advanced",
    ]);
    // A resource has the provider's metrics only.
    expect(linksIn("Observability")).toEqual([
      { title: "Metrics", href: `${RESOURCE_PATH}/metrics` },
      { title: "Feed", href: `${RESOURCE_PATH}/feed` },
    ]);
    expect(linksIn("Activity")).toEqual([
      { title: "Incidents", href: `${RESOURCE_PATH}/incidents` },
      { title: "Alerts", href: `${RESOURCE_PATH}/alerts` },
      { title: "Changes", href: `${RESOURCE_PATH}/changes` },
    ]);
    expect(linksIn("Basic")).toEqual([
      { title: "Overview", href: RESOURCE_PATH },
      { title: "Documentation", href: `${RESOURCE_PATH}/documentation` },
    ]);
    expect(linksIn("Settings")).toEqual([
      { title: "Settings", href: `${RESOURCE_PATH}/settings` },
    ]);
    expect(linksIn("Developer")).toEqual([
      { title: "Terraform", href: `${RESOURCE_PATH}/developer/terraform` },
      { title: "API", href: `${RESOURCE_PATH}/developer/api` },
      { title: "CLI", href: `${RESOURCE_PATH}/developer/cli` },
      {
        title: "AI Assistants",
        href: `${RESOURCE_PATH}/developer/ai-assistants`,
      },
    ]);
    expect(linksIn("Advanced")).toEqual([
      { title: "Owners", href: `${RESOURCE_PATH}/owners` },
      { title: "Delete Resource", href: `${RESOURCE_PATH}/delete` },
    ]);
    // Every link stays in Cloud, on this resource.
    for (const href of hrefsInMenu()) {
      expect(href.startsWith(RESOURCE_PATH)).toBe(true);
    }
  });
});

describe("a cloud account's menu", () => {
  test("its overview, resources, map and costs; its AI agent; its changes and its feed; its settings, Developer pages and delete", async () => {
    goTo(ACCOUNT_PATH);
    await renderMenu(
      <CloudAccountSideMenu modelId={new ObjectID(ACCOUNT_ID)} />,
    );

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "AI",
      "Activity",
      "Settings",
      "Developer",
      "Advanced",
    ]);
    expect(linksIn("Basic")).toEqual([
      { title: "Overview", href: ACCOUNT_PATH },
      { title: "Resources", href: `${ACCOUNT_PATH}/resources` },
      { title: "Topology", href: `${ACCOUNT_PATH}/topology` },
      { title: "Costs", href: `${ACCOUNT_PATH}/costs` },
    ]);
    // What AI did first, its agent last, as every resource's AI section.
    expect(linksIn("AI")).toEqual([
      { title: "Logs", href: `${ACCOUNT_PATH}/ai/logs` },
      { title: "AI agent", href: `${ACCOUNT_PATH}/ai/agent` },
    ]);
    /*
     * What changed in the cloud (Changes), then what happened to the
     * account in OneUptime: its Cloud AI agent, and who changed what AI may
     * do there (Feed).
     */
    expect(linksIn("Activity")).toEqual([
      { title: "Changes", href: `${ACCOUNT_PATH}/changes` },
      { title: "Feed", href: `${ACCOUNT_PATH}/feed` },
    ]);
    expect(linksIn("Developer")).toEqual([
      { title: "Terraform", href: `${ACCOUNT_PATH}/developer/terraform` },
      { title: "API", href: `${ACCOUNT_PATH}/developer/api` },
      { title: "CLI", href: `${ACCOUNT_PATH}/developer/cli` },
      {
        title: "AI Assistants",
        href: `${ACCOUNT_PATH}/developer/ai-assistants`,
      },
    ]);
    expect(linksIn("Advanced")).toEqual([
      { title: "Delete Account", href: `${ACCOUNT_PATH}/delete` },
    ]);

    for (const href of hrefsInMenu()) {
      expect(href).not.toContain(":projectId");
      expect(href).not.toContain(":modelId");
      expect(href).not.toContain(":id");
    }
  });
});
