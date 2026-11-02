import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, screen } from "@testing-library/react";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import AppPlatformsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/SideMenu";
import AppPlatformEnvironmentViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/SideMenu";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  hrefsInMenu,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The App Platforms menus. App Platforms holds the apps managed app and
 * container platforms run (ECS and Fargate, Cloud Run, App Service, ...),
 * which were Cloud's environments: the product's menu (its Overview, every
 * app, then the environments), and one environment's - its apps and their
 * instances, the telemetry they send, its incidents and alerts, its
 * settings. Nothing in them leads back into Cloud, whose menus are
 * CloudSideMenus.test.tsx's.
 */

const ENVIRONMENT_ID: string = "0193c0de-3333-4aaa-8bbb-000000000003";
const APP_ID: string = "0193c0de-3333-4aaa-8bbb-000000000004";
const APP_PLATFORMS: string = `/dashboard/${PROJECT_ID}/app-platforms`;
const ENVIRONMENT_PATH: string = `${APP_PLATFORMS}/${ENVIRONMENT_ID}`;

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe("the App Platforms product menu", () => {
  test("its Overview first, then every app and every environment; Settings folded, Archived under Advanced, its Developer pages last", async () => {
    goTo(APP_PLATFORMS);
    await renderMenu(<AppPlatformsSideMenu />);

    expect(sectionTitlesInOrder()).toEqual([
      "App Platforms",
      "Settings",
      "Advanced",
      "Developer",
    ]);
    expect(linksIn("App Platforms")).toEqual([
      { title: "Overview", href: APP_PLATFORMS },
      { title: "All Apps", href: `${APP_PLATFORMS}/apps` },
      { title: "All Environments", href: `${APP_PLATFORMS}/environments` },
    ]);
    expect(linksIn("Settings")).toEqual([
      { title: "Owner Rules", href: `${APP_PLATFORMS}/settings/owner-rules` },
      { title: "Label Rules", href: `${APP_PLATFORMS}/settings/label-rules` },
    ]);
    expect(linksIn("Advanced")).toEqual([
      { title: "Archived", href: `${APP_PLATFORMS}/archived` },
    ]);
    // The Developer pages of the environments list, under it.
    expect(linksIn("Developer")).toEqual([
      {
        title: "Terraform",
        href: `${APP_PLATFORMS}/environments/developer/terraform`,
      },
      { title: "API", href: `${APP_PLATFORMS}/environments/developer/api` },
      { title: "CLI", href: `${APP_PLATFORMS}/environments/developer/cli` },
      {
        title: "AI Assistants",
        href: `${APP_PLATFORMS}/environments/developer/ai-assistants`,
      },
    ]);

    // On the Overview, the Overview is lit; Settings stays folded.
    expect(activeLinkTitles()).toEqual(["Overview"]);
    expect(isExpanded("Settings")).toBe(false);

    for (const href of hrefsInMenu()) {
      expect(href.startsWith(APP_PLATFORMS)).toBe(true);
      expect(href).not.toContain(":projectId");
    }
  });

  test.each([
    [`${APP_PLATFORMS}/apps`, "All Apps"],
    [`${APP_PLATFORMS}/environments`, "All Environments"],
    [`${APP_PLATFORMS}/archived`, "Archived"],
    [`${APP_PLATFORMS}/settings/owner-rules`, "Owner Rules"],
    [`${APP_PLATFORMS}/settings/label-rules`, "Label Rules"],
  ])("on %s, %s is the page lit", async (path: string, title: string) => {
    goTo(path);
    await renderMenu(<AppPlatformsSideMenu />);

    expect(activeLinkTitles()).toEqual([title]);
  });

  test("a rule's own page keeps Settings open", async () => {
    goTo(`${APP_PLATFORMS}/settings/owner-rules/${ENVIRONMENT_ID}`);
    await renderMenu(<AppPlatformsSideMenu />);

    expect(isExpanded("Settings")).toBe(true);
  });

  test("on a phone, the folded menu names the page it is on", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(`${APP_PLATFORMS}/environments`);
    await renderMenu(<AppPlatformsSideMenu />);

    expect(mobileSummaryText()).toContain("All Environments");
  });
});

describe("an environment's menu", () => {
  test("its apps and instances, its telemetry, its incidents and alerts, its settings - no cloud changes", async () => {
    goTo(ENVIRONMENT_PATH);
    await renderMenu(
      <AppPlatformEnvironmentViewSideMenu
        modelId={new ObjectID(ENVIRONMENT_ID)}
      />,
    );

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "Workloads",
      "Observability",
      "Activity",
      "Settings",
      "Developer",
      "Advanced",
    ]);
    expect(linksIn("Basic")).toEqual([
      { title: "Overview", href: ENVIRONMENT_PATH },
      { title: "Documentation", href: `${ENVIRONMENT_PATH}/documentation` },
    ]);
    // What runs on the platform: its apps, and the tasks that run them.
    expect(linksIn("Workloads")).toEqual([
      { title: "Apps", href: `${ENVIRONMENT_PATH}/apps` },
      { title: "Instances", href: `${ENVIRONMENT_PATH}/instances` },
    ]);
    // What the apps on the platform send: their own OpenTelemetry.
    expect(linksIn("Observability")).toEqual([
      { title: "Metrics", href: `${ENVIRONMENT_PATH}/metrics` },
      { title: "Logs", href: `${ENVIRONMENT_PATH}/logs` },
      { title: "Traces", href: `${ENVIRONMENT_PATH}/traces` },
      { title: "Feed", href: `${ENVIRONMENT_PATH}/feed` },
    ]);
    // A cloud account's activity log is Cloud's: no Changes here.
    expect(linksIn("Activity")).toEqual([
      { title: "Incidents", href: `${ENVIRONMENT_PATH}/incidents` },
      { title: "Alerts", href: `${ENVIRONMENT_PATH}/alerts` },
    ]);
    expect(linksIn("Settings")).toEqual([
      { title: "Settings", href: `${ENVIRONMENT_PATH}/settings` },
    ]);
    expect(linksIn("Developer")).toEqual([
      { title: "Terraform", href: `${ENVIRONMENT_PATH}/developer/terraform` },
      { title: "API", href: `${ENVIRONMENT_PATH}/developer/api` },
      { title: "CLI", href: `${ENVIRONMENT_PATH}/developer/cli` },
      {
        title: "AI Assistants",
        href: `${ENVIRONMENT_PATH}/developer/ai-assistants`,
      },
    ]);
    expect(linksIn("Advanced")).toEqual([
      { title: "Owners", href: `${ENVIRONMENT_PATH}/owners` },
      { title: "Delete Environment", href: `${ENVIRONMENT_PATH}/delete` },
    ]);

    // Every link is this environment's, in App Platforms.
    for (const href of hrefsInMenu()) {
      expect(href.startsWith(ENVIRONMENT_PATH)).toBe(true);
      expect(href).not.toContain(":modelId");
    }
    expect(screen.queryByRole("link", { name: /Changes/ })).toBeNull();
  });

  test.each([
    ["/apps", "Apps"],
    // An app's own page keeps Apps lit, as a record page keeps its list's.
    [`/apps/${APP_ID}`, "Apps"],
    ["/logs", "Logs"],
    ["/traces", "Traces"],
    ["/instances", "Instances"],
    ["/settings", "Settings"],
    ["/delete", "Delete Environment"],
  ])("on %s, %s is the page lit", async (suffix: string, title: string) => {
    goTo(`${ENVIRONMENT_PATH}${suffix}`);
    await renderMenu(
      <AppPlatformEnvironmentViewSideMenu
        modelId={new ObjectID(ENVIRONMENT_ID)}
      />,
    );

    expect(activeLinkTitles()).toEqual([title]);
  });
});
