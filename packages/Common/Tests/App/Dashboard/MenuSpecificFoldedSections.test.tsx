import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";

/*
 * Whether this install has billing on, pinned by the suite rather than read
 * from the environment: the project Settings menu grows a Billing section
 * with it, and CI and a bare `npx jest` disagree about the default. Both are
 * exercised below.
 */
let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

// Badge counts: nothing open, nothing to count, no network.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

import AlertViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/SideMenu";
import CephClusterSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/SideMenu";
import DockerSwarmClusterSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/SideMenu";
import UserProfileSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/SideMenu";
import KubernetesClusterSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/SideMenu";
import ProjectSettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import StatusPageSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SideMenu";
import UserSettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * "Collapsing things in the side menu that are not used frequently ... for
 * every side menu across the project" (the maintainer).
 *
 * Most sections fold by their title, the same in every menu (Settings,
 * Rules, Workspace, AI, Logs and the rest: SideMenuSectionState.ts), and the
 * sweep in RarelyUsedMenuSectionsCollapsed.test.tsx holds every menu to
 * that. These are the menus that also fold a section titled for its own
 * subject, and so say it themselves: each is pinned here with its menu as
 * the person sees it on the page it opens to, and with the folded section
 * opening by itself on one of its pages.
 */

const MODEL_ID: string = "0193c0de-5555-4aaa-8bbb-000000000005";

interface SectionState {
  title: string;
  expanded: boolean;
}

function sectionStates(): Array<SectionState> {
  return sectionTitlesInOrder().map((title: string): SectionState => {
    return { title, expanded: isExpanded(title) };
  });
}

// A resource page's address, with the resource's id filled in.
function viewRoute(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(MODEL_ID),
  }).toString();
}

function hrefsIn(title: string): Array<string> {
  return linksIn(title).map((link: MenuLink): string => {
    return link.href;
  });
}

beforeEach(() => {
  billingEnabledForTest = false;
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("project Settings: only Basic starts open", () => {
  async function renderSettingsMenuAt(page: string): Promise<void> {
    goTo(routeFor(page));
    await renderMenu(<ProjectSettingsSideMenu />);
  }

  test("on the Project page, every section after Basic is folded down to its title", async () => {
    await renderSettingsMenuAt(PageMap.SETTINGS);

    expect(sectionStates()).toEqual([
      { title: "Basic", expanded: true },
      { title: "Workspace", expanded: false },
      { title: "Telemetry & APM", expanded: false },
      { title: "Notifications", expanded: false },
      { title: "AI", expanded: false },
      { title: "Advanced", expanded: false },
      { title: "Security", expanded: false },
      { title: "Audit Logs", expanded: false },
      { title: "Danger Zone", expanded: false },
    ]);
    expect(sectionBody("Telemetry & APM")).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
  });

  test("with billing on, Billing and Invoices is folded too", async () => {
    billingEnabledForTest = true;
    await renderSettingsMenuAt(PageMap.SETTINGS);

    expect(sectionStates()).toEqual([
      { title: "Basic", expanded: true },
      { title: "Workspace", expanded: false },
      { title: "Telemetry & APM", expanded: false },
      { title: "Notifications", expanded: false },
      { title: "AI", expanded: false },
      { title: "Advanced", expanded: false },
      { title: "Security", expanded: false },
      { title: "Billing and Invoices", expanded: false },
      { title: "Audit Logs", expanded: false },
      { title: "Danger Zone", expanded: false },
    ]);
  });

  test("with billing on, the Billing page opens Billing and Invoices", async () => {
    billingEnabledForTest = true;
    await renderSettingsMenuAt(PageMap.SETTINGS_BILLING);

    expect(isExpanded("Billing and Invoices")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Billing"]);
    expect(isExpanded("Security")).toBe(false);
  });

  test.each([
    [
      PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS,
      "Telemetry & APM",
      "Ingestion Keys",
    ],
    [PageMap.SETTINGS_TELEMETRY_SETTINGS, "Telemetry & APM", "Data Retention"],
    [PageMap.SETTINGS_SLACK_INTEGRATION, "Workspace", "Slack"],
    [
      PageMap.SETTINGS_NOTIFICATION_SETTINGS,
      "Notifications",
      "Notification Settings",
    ],
    [PageMap.SETTINGS_AI_FEATURES, "AI", "AI Features"],
    [PageMap.SETTINGS_APIKEYS, "Advanced", "API Keys"],
    [PageMap.SETTINGS_SSO, "Security", "SSO"],
    [PageMap.SETTINGS_AUDIT_LOGS, "Audit Logs", "Audit Logs"],
    [PageMap.SETTINGS_DANGERZONE, "Danger Zone", "Danger Zone"],
  ])(
    "the %s page opens %s and marks %s",
    async (page: string, section: string, entry: string) => {
      await renderSettingsMenuAt(page);

      expect(isExpanded(section)).toBe(true);
      expect(sectionBody(section)).not.toHaveClass("invisible");
      expect(activeLinkTitles()).toEqual([entry]);
      // Basic stays open on every page: the project itself is always a click away.
      expect(isExpanded("Basic")).toBe(true);
    },
  );

  test("a folded section opens with a click", async () => {
    await renderSettingsMenuAt(PageMap.SETTINGS);

    fireEvent.click(sectionToggle("Telemetry & APM"));

    expect(isExpanded("Telemetry & APM")).toBe(true);
    expect(
      linksIn("Telemetry & APM").map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual(["Ingestion Keys", "Data Retention"]);
  });

  test("on a phone, the menu names the section and page", async () => {
    setViewportWidth(MOBILE_WIDTH);
    await renderSettingsMenuAt(PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS);

    expect(mobileSummaryText()).toContain("Telemetry & APM / Ingestion Keys");
  });
});

describe("User Settings: the checklist and how you are reached start open", () => {
  /*
   * The Workspace section lists the chat workspaces the project has
   * connected, and is left out when it has none. Here both are connected;
   * WorkspaceMenusConnected.test.tsx has the rest.
   */
  beforeEach(() => {
    window.localStorage.clear();
    ConnectedWorkspaces.reset();
    ConnectedWorkspaces.setConnected(PROJECT_ID, [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]);
  });

  afterEach(() => {
    ConnectedWorkspaces.reset();
  });

  async function renderUserSettingsMenuAt(page: string): Promise<void> {
    goTo(routeFor(page));
    await renderMenu(<UserSettingsSideMenu />);
  }

  test("on the Setup Checklist, the sections after Alerts & Notifications are folded", async () => {
    await renderUserSettingsMenuAt(PageMap.USER_SETTINGS_SETUP);

    expect(sectionStates()).toEqual([
      { title: "Get Started", expanded: true },
      { title: "Alerts & Notifications", expanded: true },
      { title: "On-Call Logs", expanded: false },
      { title: "Incoming Call Policy", expanded: false },
      { title: "Calendar", expanded: false },
      { title: "Profile", expanded: false },
      { title: "Workspace", expanded: false },
    ]);
  });

  test("in a project with no workspace connected, there is no Workspace section", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, []);
    await renderUserSettingsMenuAt(PageMap.USER_SETTINGS_SETUP);

    expect(sectionTitlesInOrder()).not.toContain("Workspace");
    expect(sectionTitlesInOrder()[sectionTitlesInOrder().length - 1]).toBe(
      "Profile",
    );
  });

  /*
   * Your on-call rules are one page, with a tab per kind, among the pages
   * people come here for: it opens nothing folded, and no section of its
   * own is left behind for it.
   */
  test("On-Call Rules sits in Alerts & Notifications, right after the methods it uses", async () => {
    await renderUserSettingsMenuAt(PageMap.USER_SETTINGS_SETUP);

    expect(linksIn("Alerts & Notifications")).toEqual([
      {
        title: "Notification Methods",
        href: routeFor(PageMap.USER_SETTINGS_NOTIFICATION_METHODS),
      },
      {
        title: "On-Call Rules",
        href: routeFor(PageMap.USER_SETTINGS_ON_CALL_RULES),
      },
      {
        title: "Notification Settings",
        href: routeFor(PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS),
      },
      {
        title: "Email Preferences",
        href: routeFor(PageMap.USER_SETTINGS_EMAIL_PREFERENCES),
      },
    ]);
    expect(sectionTitlesInOrder()).not.toContain("Incident On-Call");
    expect(sectionTitlesInOrder()).not.toContain("Alert On-Call");
  });

  test("the On-Call Rules page marks its entry and opens nothing folded", async () => {
    await renderUserSettingsMenuAt(PageMap.USER_SETTINGS_ON_CALL_RULES);

    expect(activeLinkTitles()).toEqual(["On-Call Rules"]);
    expect(isExpanded("Alerts & Notifications")).toBe(true);
    expect(isExpanded("On-Call Logs")).toBe(false);
  });

  test.each([
    [PageMap.USER_SETTINGS_ON_CALL_LOGS, "On-Call Logs", "On-Call Logs"],
    [
      PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS,
      "Incoming Call Policy",
      "Incoming Phone Numbers",
    ],
    [PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED, "Calendar", "Calendar Feed"],
    [PageMap.USER_SETTINGS_SLACK_INTEGRATION, "Workspace", "Slack"],
    [PageMap.USER_SETTINGS_CUSTOM_FIELDS, "Profile", "Custom Fields"],
  ])(
    "the %s page opens %s and marks %s",
    async (page: string, section: string, entry: string) => {
      await renderUserSettingsMenuAt(page);

      expect(isExpanded(section)).toBe(true);
      expect(activeLinkTitles()).toEqual([entry]);
      expect(isExpanded("Alerts & Notifications")).toBe(true);
    },
  );

  // A single on-call log's timeline is not in the menu; its log list is.
  test("a timeline under On-Call Logs opens On-Call Logs", async () => {
    goTo(viewRoute(PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE));
    await renderMenu(<UserSettingsSideMenu />);

    expect(isExpanded("On-Call Logs")).toBe(true);
    expect(isExpanded("Calendar")).toBe(false);
  });
});

describe("your profile: Security and the Danger Zone are folded", () => {
  test("on the profile overview, only Basic is open", async () => {
    goTo(routeFor(PageMap.USER_PROFILE_OVERVIEW));
    await renderMenu(<UserProfileSideMenu />);

    expect(sectionStates()).toEqual([
      { title: "Basic", expanded: true },
      { title: "Security", expanded: false },
      { title: "Danger Zone", expanded: false },
    ]);
  });

  test("the password page opens Security", async () => {
    goTo(routeFor(PageMap.USER_PROFILE_PASSWORD));
    await renderMenu(<UserProfileSideMenu />);

    expect(isExpanded("Security")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Password Management"]);
    expect(isExpanded("Danger Zone")).toBe(false);
  });
});

describe("a Kubernetes cluster: what a visit starts with stays open", () => {
  async function renderClusterMenuAt(page: string): Promise<void> {
    goTo(viewRoute(page));
    await renderMenu(
      <KubernetesClusterSideMenu modelId={new ObjectID(MODEL_ID)} />,
    );
  }

  test("on the cluster's overview, AI, Scaling and Observability are folded", async () => {
    await renderClusterMenuAt(PageMap.KUBERNETES_CLUSTER_VIEW);

    expect(sectionStates()).toEqual([
      { title: "Basic", expanded: true },
      { title: "AI", expanded: false },
      { title: "Telemetry", expanded: true },
      { title: "Workloads", expanded: true },
      { title: "Infrastructure", expanded: true },
      { title: "Scaling", expanded: false },
      { title: "Observability", expanded: false },
      { title: "Activity", expanded: true },
      { title: "Developer", expanded: false },
      { title: "Advanced", expanded: false },
    ]);
  });

  test.each([
    [PageMap.KUBERNETES_CLUSTER_VIEW_HPAS, "Scaling", "HPAs"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS, "Observability", "Events"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS, "AI", "Insights"],
    // Only AI's Logs is marked, never Telemetry's Logs as well.
    [PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS, "AI", "Logs"],
  ])(
    "the %s page opens %s and marks %s",
    async (page: string, section: string, entry: string) => {
      await renderClusterMenuAt(page);

      expect(isExpanded(section)).toBe(true);
      expect(activeLinkTitles()).toEqual([entry]);
    },
  );

  test("the folded sections still hold every page they held", async () => {
    await renderClusterMenuAt(PageMap.KUBERNETES_CLUSTER_VIEW);

    expect(hrefsIn("Scaling")).toEqual([
      viewRoute(PageMap.KUBERNETES_CLUSTER_VIEW_HPAS),
      viewRoute(PageMap.KUBERNETES_CLUSTER_VIEW_VPAS),
    ]);
    expect(hrefsIn("Observability")).toEqual([
      viewRoute(PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS),
      viewRoute(PageMap.KUBERNETES_CLUSTER_VIEW_CONTROL_PLANE),
      viewRoute(PageMap.KUBERNETES_CLUSTER_VIEW_SERVICE_MESH),
    ]);
  });
});

describe("other resource pages that fold a section of their own", () => {
  test("a status page: what it shows stays open; its audience and setup fold", async () => {
    goTo(viewRoute(PageMap.STATUS_PAGE_VIEW));
    await renderMenu(<StatusPageSideMenu modelId={new ObjectID(MODEL_ID)} />);

    expect(sectionStates()).toEqual([
      { title: "Basic", expanded: true },
      { title: "Resources", expanded: true },
      { title: "Subscribers", expanded: false },
      { title: "Notification Logs", expanded: false },
      { title: "Branding", expanded: false },
      { title: "Security", expanded: false },
      { title: "AI", expanded: false },
      { title: "Developer", expanded: false },
      { title: "Advanced", expanded: false },
    ]);
  });

  test("a status page's subscriber list opens Subscribers", async () => {
    goTo(viewRoute(PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS));
    await renderMenu(<StatusPageSideMenu modelId={new ObjectID(MODEL_ID)} />);

    expect(isExpanded("Subscribers")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Email Subscribers"]);
    expect(isExpanded("Branding")).toBe(false);
  });

  test("an alert: who it paged folds with its logs", async () => {
    goTo(viewRoute(PageMap.ALERT_VIEW));
    await renderMenu(<AlertViewSideMenu modelId={new ObjectID(MODEL_ID)} />);

    expect(sectionStates()).toEqual([
      { title: "Basic", expanded: true },
      { title: "On Call", expanded: false },
      { title: "Logs", expanded: false },
      { title: "Alert Notes", expanded: true },
      { title: "Developer", expanded: false },
      { title: "Advanced", expanded: false },
    ]);
  });

  test("an alert's On Call Executions page opens On Call", async () => {
    goTo(viewRoute(PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS));
    await renderMenu(<AlertViewSideMenu modelId={new ObjectID(MODEL_ID)} />);

    expect(isExpanded("On Call")).toBe(true);
    expect(activeLinkTitles()).toEqual(["On Call Executions"]);
  });

  test("a Ceph cluster: its cluster log folds, its storage stays open", async () => {
    goTo(viewRoute(PageMap.CEPH_CLUSTER_VIEW));
    await renderMenu(<CephClusterSideMenu modelId={new ObjectID(MODEL_ID)} />);

    expect(isExpanded("Storage")).toBe(true);
    expect(isExpanded("Observability")).toBe(false);

    cleanup();
    goTo(viewRoute(PageMap.CEPH_CLUSTER_VIEW_CLUSTER_LOG));
    await renderMenu(<CephClusterSideMenu modelId={new ObjectID(MODEL_ID)} />);

    expect(isExpanded("Observability")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Cluster Log"]);
  });

  test("a Docker Swarm cluster: its secrets and configs fold, its workloads stay open", async () => {
    goTo(viewRoute(PageMap.DOCKER_SWARM_CLUSTER_VIEW));
    await renderMenu(
      <DockerSwarmClusterSideMenu modelId={new ObjectID(MODEL_ID)} />,
    );

    expect(isExpanded("Workloads")).toBe(true);
    expect(isExpanded("Infrastructure")).toBe(true);
    expect(isExpanded("Config")).toBe(false);

    cleanup();
    goTo(viewRoute(PageMap.DOCKER_SWARM_CLUSTER_VIEW_SECRETS));
    await renderMenu(
      <DockerSwarmClusterSideMenu modelId={new ObjectID(MODEL_ID)} />,
    );

    expect(isExpanded("Config")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Secrets"]);
  });
});
