// UX rule: Docs/ux/README.md#names
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import * as RouteMapModule from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import { ASK_AI_BUTTON_LABEL } from "../../../../App/FeatureSet/Dashboard/src/Components/Header/AskAI";
import { SERVER_SETUP_PAGE_TITLE } from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Setup/Index";
import { getAIInsightsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AIInsightsBreadcrumbs";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import { getAppPlatformsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AppPlatformsBreadcrumbs";
import { getCephBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CephBreadcrumbs";
import { getCloudBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CloudBreadcrumbs";
import { getCodeBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CodeBreadcrumbs";
import { getDashboardBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DashboardBreadCrumbs";
import { getDataObservabilityBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DataObservabilityBreadcrumbs";
import { getDataSecurityBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DataSecurityBreadcrumbs";
import { getDatabaseBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DatabaseBreadcrumbs";
import { getDockerBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DockerBreadcrumbs";
import { getDockerSwarmBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DockerSwarmBreadcrumbs";
import { getExceptionsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ExceptionsBreadcrumbs";
import { getFormsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/FormsBreadcrumbs";
import { getHomeBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/HomeBreadcrumbs";
import { getHostBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/HostBreadcrumbs";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import { getInventoryBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/InventoryBreadcrumbs";
import { getIoTBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IoTBreadcrumbs";
import { getKubernetesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/KubernetesBreadcrumbs";
import { getLlmBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/LlmBreadcrumbs";
import { getLogsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/LogsBreadcrumbs";
import { getMessageQueueBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MessageQueueBreadcrumbs";
import { getMetricsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MetricsBreadcrumbs";
import { getMonitorBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs";
import { getMonitorGroupBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorGroupBreadcrumbs";
import {
  getIncomingCallPolicyBreadcrumbs,
  getOnCallDutyBreadcrumbs,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/OnCallDutyBreadcrumbs";
import { getOpenStackBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/OpenStackBreadcrumbs";
import { getPodmanBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/PodmanBreadcrumbs";
import { getProfilesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ProfilesBreadcrumbs";
import { getProxmoxBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ProxmoxBreadcrumbs";
import { getRumBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/RumBreadcrumbs";
import { getRunbooksBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/RunbooksBreadcrumbs";
import { getScheduleMaintenanceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs";
import { getSecurityEventsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SecurityEventsBreadcrumbs";
import { getServerlessBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ServerlessBreadcrumbs";
import { getServiceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ServiceBreadcrumbs";
import { getSettingsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SettingsBreadcrumbs";
import { getStatusPagesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/StatusPagesBreadcrumbs";
import { getStorageArrayBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/StorageArrayBreadcrumbs";
import { getTeamsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/TeamsBreadcrumbs";
import { getTracesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/TracesBreadcrumbs";
import { getUserSettingsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/UserSettingsBreadcrumbs";
import { getUsersBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/UsersBreadcrumbs";
import { getVMwareBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/VMwareBreadcrumbs";
import { getWorkflowsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/WorkflowsBreadcrumbs";
import { getNetworkDeviceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Utils/Breadcrumbs";
import { getNetworkSiteBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/Utils/Breadcrumbs";
import { getSloBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/Breadcrumbs";
import ProductKey from "../../../Types/Product/ProductKey";
import Dictionary from "../../../Types/Dictionary";
import Link from "../../../Types/Link";
import { MoreMenuItem, NavItem } from "../../../UI/Components/Navbar/NavBar";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

// The Dashboard's English, as the menus draw it: nested keys resolve to their words.
jest.mock("react-i18next", () => {
  const nodeFs: typeof import("fs") = jest.requireActual(
    "fs",
  ) as typeof import("fs");
  const nodePath: typeof import("path") = jest.requireActual(
    "path",
  ) as typeof import("path");
  const english: Record<string, unknown> = JSON.parse(
    nodeFs.readFileSync(
      nodePath.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const translate: (key: string, defaultValue?: unknown) => string = (
    key: string,
    defaultValue?: unknown,
  ): string => {
    if (typeof english[key] === "string") {
      return english[key] as string;
    }

    let value: unknown = english;

    for (const part of key.split(".")) {
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined;
    }

    if (typeof value === "string") {
      return value;
    }

    return typeof defaultValue === "string" ? defaultValue : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

/*
 * A MENU ENTRY SAYS THE NAME OF THE PAGE IT OPENS (#7474).
 *
 * A person learns a thing's name from the menu that opens it, and looks for
 * that name on the page. The newcomer walkthroughs met:
 *
 *   - the products menu's Chat, which opened the Ask AI panel over Home -
 *     "is Chat something other than Ask AI?";
 *   - its Insights, over a page titled AI Insights; its AI / LLM, over a
 *     page titled AI / LLM Observability;
 *   - the profile menu's Admin Settings, which opened the Admin Dashboard,
 *     and its Profile, which opened User Profile;
 *   - the Admin Dashboard's own Settings, whose pages were titled Admin
 *     Settings, its Send Email, a page titled Send Announcement Email, and
 *     its Server Setup, titled "Server setup";
 *   - Inventory's Topology Map, which opened the page the products menu
 *     calls Topology, titled Topology.
 *
 * This holds every entry of those menus to the page it opens:
 *
 *   - a product's entry is the product's step in the trail of the page it
 *     opens (the trail getters its layout draws), or that trail's last step
 *     where the page is drawn inside another product (Topology, inside
 *     Inventory); and the title its layout gives the page, unless the
 *     layout titles each page by the page within it (listed with why);
 *   - Ask AI, which opens a panel rather than a page, is the panel's name
 *     and the header's button's;
 *   - the profile menu says User Profile and the Admin Dashboard as those
 *     pages call themselves, in every language;
 *   - the Admin Dashboard's own menu says its pages' titles and trails, in
 *     every language.
 */

type BreadcrumbGetter = (path: string) => Array<Link> | undefined;

// The trail of every route table, as its layouts draw it (EveryPageHasATrail).
const TRAIL_GETTERS: Dictionary<BreadcrumbGetter> = {
  MonitorsRoutePath: getMonitorBreadcrumbs,
  ServiceRoutePath: getServiceBreadcrumbs,
  CodeRoutePath: getCodeBreadcrumbs,
  KubernetesRoutePath: getKubernetesBreadcrumbs,
  NetworkDeviceRoutePath: getNetworkDeviceBreadcrumbs,
  SloRoutePath: getSloBreadcrumbs,
  NetworkSiteRoutePath: getNetworkSiteBreadcrumbs,
  DockerRoutePath: getDockerBreadcrumbs,
  PodmanRoutePath: getPodmanBreadcrumbs,
  ProxmoxRoutePath: getProxmoxBreadcrumbs,
  OpenStackRoutePath: getOpenStackBreadcrumbs,
  VMwareRoutePath: getVMwareBreadcrumbs,
  IoTRoutePath: getIoTBreadcrumbs,
  DockerSwarmRoutePath: getDockerSwarmBreadcrumbs,
  CephRoutePath: getCephBreadcrumbs,
  StorageArrayRoutePath: getStorageArrayBreadcrumbs,
  HostRoutePath: getHostBreadcrumbs,
  ServerlessRoutePath: getServerlessBreadcrumbs,
  CloudRoutePath: getCloudBreadcrumbs,
  AppPlatformsRoutePath: getAppPlatformsBreadcrumbs,
  DatabaseRoutePath: getDatabaseBreadcrumbs,
  MessageQueueRoutePath: getMessageQueueBreadcrumbs,
  RumRoutePath: getRumBreadcrumbs,
  WorkflowRoutePath: getWorkflowsBreadcrumbs,
  RunbookRoutePath: getRunbooksBreadcrumbs,
  FormsRoutePath: getFormsBreadcrumbs,
  AIInsightsRoutePath: getAIInsightsBreadcrumbs,
  LogsRoutePath: getLogsBreadcrumbs,
  SecurityEventsRoutePath: getSecurityEventsBreadcrumbs,
  DataSecurityRoutePath: getDataSecurityBreadcrumbs,
  DataObservabilityRoutePath: getDataObservabilityBreadcrumbs,
  MetricsRoutePath: getMetricsBreadcrumbs,
  TracesRoutePath: getTracesBreadcrumbs,
  ProfilesRoutePath: getProfilesBreadcrumbs,
  InventoryRoutePath: getInventoryBreadcrumbs,
  TopologyRoutePath: getInventoryBreadcrumbs,
  ExceptionsRoutePath: getExceptionsBreadcrumbs,
  LlmRoutePath: getLlmBreadcrumbs,
  DashboardsRoutePath: getDashboardBreadcrumbs,
  StatusPagesRoutePath: getStatusPagesBreadcrumbs,
  IncidentsRoutePath: getIncidentsBreadcrumbs,
  AlertsRoutePath: getAlertsBreadcrumbs,
  ScheduledMaintenanceEventsRoutePath: getScheduleMaintenanceBreadcrumbs,
  SettingsRoutePath: getSettingsBreadcrumbs,
  UsersRoutePath: getUsersBreadcrumbs,
  TeamsRoutePath: getTeamsBreadcrumbs,
  OnCallDutyRoutePath: (path: string): Array<Link> | undefined => {
    return (
      getOnCallDutyBreadcrumbs(path) || getIncomingCallPolicyBreadcrumbs(path)
    );
  },
  MonitorGroupRoutePath: getMonitorGroupBreadcrumbs,
  UserSettingsRoutePath: getUserSettingsBreadcrumbs,
  HomeRoutePath: getHomeBreadcrumbs,
};

/*
 * The products whose layout titles each page by the page within it, so
 * the menu's name is in the page's trail but not its title. Each with why;
 * one that gains a title of the product's name leaves the list.
 */
const TITLED_BY_THE_PAGE_WITHIN: Readonly<Partial<Record<ProductKey, string>>> =
  {
    [ProductKey.OnCall]:
      "Its pages are titled by what they hold - On-Call Policies, On-Call Schedules, User Overrides - under the trail's On-Call (Pages/OnCallDuty/Layout's PageTitleMap).",
    [ProductKey.Profiles]:
      "Its pages are titled Profiles - and the page within it: Profiles — Overview, Profiles — All profiles (Pages/Profiles/Layout's getPageTitle).",
    [ProductKey.Code]:
      "Its first page opens on its question, What should AI do?, with no title over it, as coding agents open; the others are titled Code or Repositories (Pages/Code/Layout's getCodeLayoutTitle).",
  };

// Ask AI opens a panel over the page the person is on, never a page of its own.
const OPENS_A_PANEL: ReadonlyArray<ProductKey> = [ProductKey.AIChat];

const DASHBOARD_PAGES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages",
);
const ADMIN_DASHBOARD: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src",
);
const ADMIN_LOCALES: string = path.join(ADMIN_DASHBOARD, "Locales");
const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];

const modelId: string = "7b3b1548-23cd-46ab-8359-280eb34362af";

let catalog: DashboardNavigationItems | null = null;

const ReadCatalog: FunctionComponent = (): ReactElement => {
  catalog = useDashboardNavigationItems();
  return <></>;
};

function readCatalog(): DashboardNavigationItems {
  render(<ReadCatalog />);
  const items: DashboardNavigationItems = catalog!;
  cleanup();
  return items;
}

/*
 * The page key of RouteMap a menu entry opens: its route, with the project
 * put back as RouteMap writes it. Never its activeRoute, which is often its
 * section's wildcard root (/on-call-duty/*), lit on every page of it.
 */
function pageKeyOf(item: NavItem | MoreMenuItem): string {
  const parts: Array<string> = item.route.toString().split("/");

  if (parts[1] === "dashboard" && parts.length > 2) {
    parts[2] = ":projectId";
  }

  const pattern: string = parts.join("/");

  return Object.keys(RouteMapModule.default).find((key: string): boolean => {
    const route: string = RouteMapModule.default[key]?.toString() || "";

    return (
      !route.includes("*") &&
      route.replace(/\/$/, "") === pattern.replace(/\/$/, "")
    );
  }) as string;
}

/*
 * The trail of the page a menu entry opens, as its layout draws it: the one
 * trail getter that knows the page. A product's first page is often outside
 * its route table (MONITORS is RouteMap's own), so every getter is asked;
 * each knows its own pages only.
 */
function trailOf(item: NavItem | MoreMenuItem): Array<string> | undefined {
  const page: string = pageKeyOf(item);

  goTo(
    RouteUtil.getRouteString(page)
      .replace(":projectId", PROJECT_ID)
      .replace(":id", modelId),
  );

  /*
   * The route the router matched, and the page's own pattern: a first page
   * whose address ends in its section's root (/llm/, /on-call-duty/) is
   * matched as the section's wildcard, while its layout draws the page's
   * own trail.
   */
  const candidates: Array<string> = [
    Navigation.getRoutePath(RouteUtil.getRoutes()),
    RouteUtil.getRouteString(page),
  ];

  for (const candidate of candidates) {
    for (const getter of new Set(Object.values(TRAIL_GETTERS))) {
      const trail: Array<Link> | undefined = getter(candidate);

      if (trail && trail.length > 0) {
        return trail.map((link: Link): string => {
          return link.title;
        });
      }
    }
  }

  return undefined;
}

// Every file under a folder whose name ends in .tsx.
function tsxFilesUnder(folder: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      found.push(...tsxFilesUnder(full));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }

  return found;
}

interface LayoutTitle {
  file: string;
  // The titles its <Page> can have, for this product; null when computed.
  titles: Array<string> | null;
}

/*
 * The title each product's layout gives its pages: the <Page> beside the
 * product's "How it works" button (ProductAboutButton). A literal, a
 * constant of the file, or a choice between two literals as the button's
 * product is chosen (Inventory and Topology share one layout); anything
 * else is computed, and null.
 */
function layoutTitlesOf(product: ProductKey): Array<LayoutTitle> {
  const found: Array<LayoutTitle> = [];
  const productName: string = (
    Object.keys(ProductKey) as Array<keyof typeof ProductKey>
  ).find((name: keyof typeof ProductKey): boolean => {
    return ProductKey[name] === product;
  }) as string;

  for (const file of tsxFilesUnder(DASHBOARD_PAGES)) {
    const source: string = fs.readFileSync(file, "utf8");

    for (const page of source.matchAll(/<Page\b([\s\S]*?)>\s*\n/g)) {
      const attributes: string = page[1] as string;
      const button: RegExpMatchArray | null = attributes.match(
        /<ProductAboutButton\s+product=\{([^}]+)\}/,
      );

      if (
        !button ||
        !new RegExp(`ProductKey\\.${productName}\\b`).test(button[1] as string)
      ) {
        continue;
      }

      const title: RegExpMatchArray | null = attributes.match(
        /\btitle=(?:"([^"]+)"|\{([\s\S]*?)\}\s*\n)/,
      );
      let titles: Array<string> | null = null;

      if (title?.[1]) {
        titles = [title[1]];
      } else if (title?.[2]) {
        const expression: string = title[2].trim();
        const literal: RegExpMatchArray | null =
          expression.match(/^"([^"]+)"$/);
        const constant: RegExpMatchArray | null = expression.match(/^(\w+)$/);
        const choice: RegExpMatchArray | null = expression.match(
          /^\w+\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"$/,
        );

        if (literal) {
          titles = [literal[1] as string];
        } else if (constant) {
          const value: RegExpMatchArray | null = source.match(
            new RegExp(`const ${constant[1]}: string = "([^"]+)"`),
          );
          titles = value ? [value[1] as string] : null;
        } else if (choice) {
          titles = [choice[1] as string, choice[2] as string];
        }
      }

      found.push({ file: path.relative(DASHBOARD_PAGES, file), titles });
    }
  }

  return found;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function look(words: Record<string, unknown>, key: string): string | undefined {
  if (typeof words[key] === "string") {
    return words[key] as string;
  }

  let value: unknown = words;

  for (const part of key.split(".")) {
    value =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[part]
        : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

afterEach(() => {
  cleanup();
});

describe("the products menu", () => {
  const items: DashboardNavigationItems = readCatalog();

  test("is read: every product, and Home and User Settings beside it", () => {
    expect(items.moreMenuItems.length).toBeGreaterThanOrEqual(45);
    expect(
      items.navItems.map((item: NavItem) => {
        return item.title;
      }),
    ).toContain("Home");
    expect(items.rightElement.title).toBe("User Settings");
  });

  test.each(
    items.moreMenuItems
      .filter((item: MoreMenuItem): boolean => {
        return !OPENS_A_PANEL.includes(item.key as ProductKey);
      })
      .map((item: MoreMenuItem): [string, MoreMenuItem] => {
        return [item.title, item];
      }),
  )(
    "%s is named so in the trail of the page it opens",
    (title: string, item: MoreMenuItem) => {
      const trail: Array<string> | undefined = trailOf(item);

      expect({ title, hasTrail: Boolean(trail) }).toEqual({
        title,
        hasTrail: true,
      });

      // The product's step, or the page's own where another product draws it.
      const named: Array<string> = [
        trail![1] as string,
        trail![trail!.length - 1] as string,
      ];

      expect({
        title,
        trail: trail!.join(" > "),
        named: named.includes(title),
      }).toEqual({
        title,
        trail: trail!.join(" > "),
        named: true,
      });
    },
  );

  test.each(
    items.moreMenuItems
      .filter((item: MoreMenuItem): boolean => {
        return !OPENS_A_PANEL.includes(item.key as ProductKey);
      })
      .map((item: MoreMenuItem): [string, MoreMenuItem] => {
        return [item.title, item];
      }),
  )(
    "%s is the title its layout gives the page, or the layout says why not",
    (title: string, item: MoreMenuItem) => {
      const product: ProductKey = item.key as ProductKey;
      const layouts: Array<LayoutTitle> = layoutTitlesOf(product);
      const reason: string | undefined = TITLED_BY_THE_PAGE_WITHIN[product];

      if (reason) {
        // Still computed: a layout that gains the product's title leaves the list.
        expect(
          layouts.some((layout: LayoutTitle): boolean => {
            return layout.titles === null;
          }),
        ).toBe(true);
        expect(reason.length).toBeGreaterThan(40);
        return;
      }

      for (const layout of layouts) {
        expect({
          title,
          file: layout.file,
          titled: layout.titles?.includes(title) ?? false,
        }).toEqual({
          title,
          file: layout.file,
          titled: true,
        });
      }
    },
  );

  test("Home is its page's title, and User Settings is named so in its pages' trail", () => {
    const home: NavItem = items.navItems[0]!;

    expect(home.title).toBe("Home");
    expect(
      fs.readFileSync(path.join(DASHBOARD_PAGES, "Home/Layout.tsx"), "utf8"),
    ).toContain('title="Home"');
    expect(trailOf(items.rightElement)?.[1]).toBe(items.rightElement.title);
  });

  test("Ask AI, which opens its panel over the page, is the panel's name and the header's button's", () => {
    const askAi: MoreMenuItem = items.moreMenuItems.find(
      (item: MoreMenuItem): boolean => {
        return item.key === ProductKey.AIChat;
      },
    )!;
    const panel: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPanel.tsx",
      ),
      "utf8",
    );
    const forwarder: string = fs.readFileSync(
      path.join(DASHBOARD_PAGES, "AICopilot/AICopilot.tsx"),
      "utf8",
    );

    expect(askAi.title).toBe("Ask AI");
    expect(askAi.title).toBe(ASK_AI_BUTTON_LABEL);
    expect(panel).toContain('translator.translateText("Ask AI")');
    // Its address opens the panel, and draws no page of its own.
    expect(forwarder).toContain("openAskAi(");
    expect(forwarder).not.toMatch(/<Page[\s>]/);
    // The word it used to say still finds it.
    expect(askAi.keywords).toContain("chat");
  });

  test("a product listed as titled by its pages is a product of the menu", () => {
    const products: Array<string> = items.moreMenuItems.map(
      (item: MoreMenuItem): string => {
        return item.key as string;
      },
    );

    for (const product of Object.keys(TITLED_BY_THE_PAGE_WITHIN)) {
      expect(products).toContain(product);
    }
  });
});

describe("the products menu in every language", () => {
  test.each(LANGUAGES)(
    "%s: Ask AI and AI Insights read as their panel's and page's words",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const nested: Record<string, unknown> = readJson(
        path.join(
          __dirname,
          `../../../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
        ),
      );

      expect(look(nested, "navbar.items.aiChatTitle")).toBe(words["Ask AI"]);
      expect(look(nested, "navbar.items.sentinelInsightsTitle")).toBe(
        words["AI Insights"],
      );
    },
  );
});

describe("the profile menu", () => {
  const userProfile: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Components/Header/UserProfile.tsx",
    ),
    "utf8",
  );
  const profileLayout: string = fs.readFileSync(
    path.join(DASHBOARD_PAGES, "Global/UserProfile/Layout.tsx"),
    "utf8",
  );

  test("its entries are User Profile, the Admin Dashboard and Sign Out, never Profile or Admin Settings", () => {
    const keys: Array<string> = Array.from(
      userProfile.matchAll(/t\("userProfile\.(\w+)"\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(keys).toEqual(["label", "profile", "adminDashboard", "signOut"]);
    expect(userProfile).not.toContain("adminSettings");
  });

  test.each(LANGUAGES)(
    "%s: User Profile is the title of the page it opens",
    (language: string) => {
      const nested: Record<string, unknown> = readJson(
        path.join(
          __dirname,
          `../../../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
        ),
      );
      const words: Record<string, string> = readDashboardLocale(language);

      expect(profileLayout).toContain('title="User Profile"');
      expect(look(nested, "userProfile.profile")).toBe(
        language === "en" ? "User Profile" : words["User Profile"],
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: the Admin Dashboard is named as the Admin Dashboard's own trail names it",
    (language: string) => {
      const dashboard: Record<string, unknown> = readJson(
        path.join(
          __dirname,
          `../../../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
        ),
      );
      const admin: Record<string, unknown> = readJson(
        path.join(ADMIN_LOCALES, `${language}.json`),
      );

      expect(look(dashboard, "userProfile.adminDashboard")).toBe(
        look(admin, "breadcrumbs.adminDashboard"),
      );
      expect(look(dashboard, "userProfile.adminSettings")).toBeUndefined();
    },
  );

  test("Sign Out is the title of the page it opens", () => {
    const signOut: string = fs.readFileSync(
      path.join(DASHBOARD_PAGES, "Logout/Logout.tsx"),
      "utf8",
    );
    const english: Record<string, unknown> = readJson(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
    );

    expect(look(english, "userProfile.signOut")).toBe("Sign Out");
    expect(signOut).toContain('title={"Sign Out"}');
  });
});

/*
 * The Admin Dashboard's menu: each entry's English is a key of its locale,
 * looked up as the bar draws it, and its page's title and trail are keys of
 * their own. They say one name in every language.
 */
interface AdminEntry {
  // The bar's English, a flat key of the Admin Dashboard's locale.
  menu: string;
  // The page's title and its trail's step: keys, or the English a page looks up.
  title: string;
  trail: string | null;
  // The page that draws them, and how its source names its title.
  file: string;
  titleSource: string;
}

const ADMIN_ENTRIES: ReadonlyArray<AdminEntry> = [
  {
    menu: "Users",
    title: "pages.users.title",
    trail: "breadcrumbs.users",
    file: "Pages/Users/Index.tsx",
    titleSource: 'title={t("pages.users.title")}',
  },
  {
    menu: "Projects",
    title: "pages.projects.title",
    trail: "breadcrumbs.projects",
    file: "Pages/Projects/Index.tsx",
    titleSource: 'title={t("pages.projects.title")}',
  },
  {
    menu: "Settings",
    title: "pages.settings.title",
    trail: "breadcrumbs.settings",
    file: "Pages/Settings/Authentication/Index.tsx",
    titleSource: 'title={t("pages.settings.title")}',
  },
  {
    menu: "Telemetry Usage",
    title: "pages.telemetryUsage.title",
    trail: "breadcrumbs.telemetryUsage",
    file: "Pages/TelemetryUsage/Index.tsx",
    titleSource: 'title={t("pages.telemetryUsage.title")}',
  },
  {
    menu: "Send Email",
    title: "pages.moreEmail.title",
    trail: "breadcrumbs.sendEmail",
    file: "Pages/More/Email.tsx",
    titleSource: 'title={t("pages.moreEmail.title")}',
  },
  {
    menu: "Enterprise Licenses",
    title: "pages.enterpriseLicenses.title",
    trail: "breadcrumbs.enterpriseLicenses",
    file: "Pages/EnterpriseLicenses/EnterpriseLicensesUnavailable.tsx",
    titleSource: 'title={t("pages.enterpriseLicenses.title")}',
  },
  {
    menu: "Feedback",
    title: "Feedback",
    trail: null,
    file: "Pages/Feedback/Index.tsx",
    titleSource: 'export const FEEDBACK_PAGE_TITLE: string = "Feedback";',
  },
];

describe("the Admin Dashboard's menu", () => {
  const navBar: string = fs.readFileSync(
    path.join(ADMIN_DASHBOARD, "Components/NavBar/NavBar.tsx"),
    "utf8",
  );

  test.each(
    ADMIN_ENTRIES.map((entry: AdminEntry): [string, AdminEntry] => {
      return [entry.menu, entry];
    }),
  )(
    "%s is an entry of the bar, and its page is titled by its own key",
    (_menu: string, entry: AdminEntry) => {
      expect(navBar).toContain(`title: "${entry.menu}",`);
      expect(
        fs.readFileSync(path.join(ADMIN_DASHBOARD, entry.file), "utf8"),
      ).toContain(entry.titleSource);
    },
  );

  test.each(
    LANGUAGES.flatMap((language: string) => {
      return ADMIN_ENTRIES.map(
        (entry: AdminEntry): [string, string, AdminEntry] => {
          return [language, entry.menu, entry];
        },
      );
    }),
  )(
    "%s: %s says what its page's title and trail say",
    (language: string, _menu: string, entry: AdminEntry) => {
      const words: Record<string, unknown> = readJson(
        path.join(ADMIN_LOCALES, `${language}.json`),
      );
      const menu: string | undefined = look(words, entry.menu);

      expect(menu).toBeDefined();
      expect(look(words, entry.title)).toBe(menu);

      if (entry.trail) {
        expect(look(words, entry.trail)).toBe(menu);
      }
    },
  );

  test("Server Setup is its page's title and its trail's last step, in the bar's words", () => {
    const setup: string = fs.readFileSync(
      path.join(ADMIN_DASHBOARD, "Pages/Setup/Index.tsx"),
      "utf8",
    );

    expect(navBar).toContain('title: "Server Setup",');
    expect(SERVER_SETUP_PAGE_TITLE).toBe("Server Setup");
    expect(setup).toContain("title={SERVER_SETUP_PAGE_TITLE}");
    expect(setup).toContain("title: SERVER_SETUP_PAGE_TITLE,");

    for (const language of LANGUAGES) {
      expect(
        look(
          readJson(path.join(ADMIN_LOCALES, `${language}.json`)),
          "Server Setup",
        ),
      ).toBeDefined();
    }
  });

  test("OneUptime Health, titled by the page within it, is named so in its trail", () => {
    const health: string = fs.readFileSync(
      path.join(ADMIN_DASHBOARD, "Pages/Health/HealthPage.tsx"),
      "utf8",
    );

    expect(navBar).toContain('title: "OneUptime Health",');
    expect(health).toContain('title: "OneUptime Health",');
  });

  test("no page of it is titled Admin Settings, in any language", () => {
    for (const language of LANGUAGES) {
      const words: Record<string, unknown> = readJson(
        path.join(ADMIN_LOCALES, `${language}.json`),
      );

      expect({
        language,
        title: look(words, "pages.settings.title"),
      }).toEqual({ language, title: look(words, "navbar.settings") });
    }
  });
});
