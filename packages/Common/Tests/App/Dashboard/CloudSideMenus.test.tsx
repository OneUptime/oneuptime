import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
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
 * The Cloud menus: the product's (Connect, then Accounts, then the lists),
 * a cloud row's - its incidents, alerts and, for a resource a connection
 * lists, its changes, under Activity - and a cloud account's.
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
  test("Connect first, then the accounts, then the lists", async () => {
    goTo(`${CLOUD}/accounts`);
    await renderMenu(<CloudSideMenu />);

    expect(linksIn("Cloud")).toEqual([
      { title: "Connect", href: `${CLOUD}/connect` },
      { title: "Accounts", href: `${CLOUD}/accounts` },
      { title: "All Environments", href: CLOUD },
      { title: "All Resources", href: `${CLOUD}/resources` },
    ]);
  });
});

describe("a cloud resource's menu", () => {
  test("a resource a connection lists: its incidents, alerts and changes under Activity", async () => {
    goTo(RESOURCE_PATH);
    await renderMenu(
      <CloudResourceViewSideMenu
        modelId={new ObjectID(RESOURCE_ID)}
        cloudResourceKind={CloudResourceKind.Resource}
      />,
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
    expect(linksIn("Advanced")).toContainEqual({
      title: "Delete Resource",
      href: `${RESOURCE_PATH}/delete`,
    });
  });

  test("an environment: its incidents and alerts, and its own telemetry - no cloud changes", async () => {
    goTo(RESOURCE_PATH);
    await renderMenu(
      <CloudResourceViewSideMenu
        modelId={new ObjectID(RESOURCE_ID)}
        cloudResourceKind={CloudResourceKind.Environment}
      />,
    );

    expect(linksIn("Observability")).toEqual([
      { title: "Metrics", href: `${RESOURCE_PATH}/metrics` },
      { title: "Logs", href: `${RESOURCE_PATH}/logs` },
      { title: "Traces", href: `${RESOURCE_PATH}/traces` },
      { title: "Instances", href: `${RESOURCE_PATH}/instances` },
      { title: "Feed", href: `${RESOURCE_PATH}/feed` },
    ]);
    expect(linksIn("Activity")).toEqual([
      { title: "Incidents", href: `${RESOURCE_PATH}/incidents` },
      { title: "Alerts", href: `${RESOURCE_PATH}/alerts` },
    ]);
  });
});

describe("a cloud account's menu", () => {
  test("its overview, resources and map; its AI agent; its changes; its settings, Developer pages and delete", async () => {
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
    ]);
    expect(linksIn("AI")).toEqual([
      { title: "AI agent", href: `${ACCOUNT_PATH}/ai/agent` },
      { title: "Logs", href: `${ACCOUNT_PATH}/ai/logs` },
    ]);
    expect(linksIn("Activity")).toEqual([
      { title: "Changes", href: `${ACCOUNT_PATH}/changes` },
    ]);
    expect(linksIn("Developer")).toEqual([
      { title: "Terraform", href: `${ACCOUNT_PATH}/developer/terraform` },
      { title: "API", href: `${ACCOUNT_PATH}/developer/api` },
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
