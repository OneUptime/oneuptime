import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The core shell of Settings > Audit Logs > Export.
 *
 * Exporting the audit log is Enterprise code: the page, the exporter and
 * its destinations live in ee/ (ee/Dashboard/AuditLogExport,
 * ee/Server/AuditLogExport). Core keeps the route, the menu entry and this
 * shell, which renders the Enterprise plugin when the project may use audit
 * logs AND the bundle includes it, and the upsell card otherwise - so the
 * Community Edition shows what the feature is and where to get it, and has
 * none of it.
 *
 * Pinned here: the tier it asks for (Enterprise), on the Cloud and
 * self-hosted, CE and EE; the plugin gets the page's props untouched and
 * downloads only when drawn; a project below the plan keeps its exports
 * under the upsell (turn off, delete) while a Community install is pointed
 * at the edition; and the menu entry and its route.
 *
 * The plugins come from a stand-in for src/Enterprise/Plugins; `null` means
 * "the real module", which in this jest config is the empty Community stub.
 * Nothing here imports ee/.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;
let currentPlanForTest: string | null = null;
let pluginsForTest: Record<string, unknown> | null = null;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
};

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

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return enterpriseEditionForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins", () => {
  const actual: { getDashboardPlugins: () => Record<string, unknown> } =
    jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins",
    ) as { getDashboardPlugins: () => Record<string, unknown> };

  return {
    __esModule: true,
    getDashboardPlugins: (): Record<string, unknown> => {
      return pluginsForTest === null
        ? actual.getDashboardPlugins()
        : pluginsForTest;
    },
  };
});

// What the page draws under the upsell below the plan, as a marker.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Billing/AuditLogExportPlanLeftovers",
  () => {
    return {
      __esModule: true,
      ProjectAuditLogExportsLeftover: (): ReactElement => {
        return <div data-testid="audit-log-export-leftovers" />;
      },
    };
  },
);

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

import AuditLogExportPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AuditLogExport";
import SettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import { DASHBOARD_ENTERPRISE_PLUGIN_KEYS } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  SettingsRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getPlanLeftoverDescription } from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverCopy";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  routeFor,
} from "./SideMenuHarness";

type Deployment = "cloud" | "self-hosted-enterprise" | "self-hosted-community";

const pinDeployment: (deployment: Deployment, plan?: PlanType) => void = (
  deployment: Deployment,
  plan?: PlanType,
): void => {
  billingEnabledForTest = deployment === "cloud";
  // The Cloud runs the Enterprise image: its effective edition is true.
  enterpriseEditionForTest = deployment !== "self-hosted-community";
  currentPlanForTest = plan || null;
};

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project-id/settings/audit-logs/export"),
  currentProject: null,
  hasPaymentMethod: true,
};

let receivedProps: Record<string, unknown> | null = null;
let lazyLoads: number = 0;

const recordingPlugin: FunctionComponent<Record<string, unknown>> = (
  props: Record<string, unknown>,
): ReactElement => {
  receivedProps = props;
  return <div data-testid="plugin-SettingsAuditLogExport" />;
};

const lazyPlugin: () => React.ExoticComponent<
  Record<string, unknown>
> = (): React.ExoticComponent<Record<string, unknown>> => {
  return React.lazy(
    async (): Promise<{
      default: FunctionComponent<Record<string, unknown>>;
    }> => {
      lazyLoads += 1;
      return { default: recordingPlugin };
    },
  );
};

const PLAN_PITCH: string =
  "Audit log export is available on the Enterprise plan. Upgrade to send this project's audit log where you keep your records.";
const EDITION_PITCH: string =
  "Audit log export is a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to send the audit log where you keep your records.";

beforeEach(() => {
  pinDeployment("self-hosted-community");
  pluginsForTest = {};
  receivedProps = null;
  lazyLoads = 0;

  jest.spyOn(ProjectUtil, "getCurrentPlan").mockImplementation((() => {
    return currentPlanForTest;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the contract", () => {
  test("Settings > Audit Logs > Export is a plugin key", () => {
    expect(DASHBOARD_ENTERPRISE_PLUGIN_KEYS).toContain(
      "SettingsAuditLogExport",
    );
  });

  test("this jest config (a Community build) has no export plugin", () => {
    pluginsForTest = null;

    expect(
      (getDashboardPlugins() as Record<string, unknown>)[
        "SettingsAuditLogExport"
      ],
    ).toBeUndefined();
  });

  test("the page is at settings/audit-logs/export", () => {
    expect(SettingsRoutePath[PageMap.SETTINGS_AUDIT_LOGS_EXPORT]).toBe(
      "audit-logs/export",
    );
    expect(RouteMap[PageMap.SETTINGS_AUDIT_LOGS_EXPORT]?.toString()).toBe(
      "/dashboard/:projectId/settings/audit-logs/export",
    );
  });
});

describe("Settings > Audit Logs > Export", () => {
  test("self-hosted Enterprise Edition renders the plugin with the page's props, untouched", () => {
    pinDeployment("self-hosted-enterprise");
    pluginsForTest = { SettingsAuditLogExport: recordingPlugin };

    render(<AuditLogExportPage {...PAGE_PROPS} />);

    expect(
      screen.getByTestId("plugin-SettingsAuditLogExport"),
    ).toBeInTheDocument();
    expect(receivedProps).toEqual(PAGE_PROPS);
  });

  test("the Cloud on the Enterprise plan renders the plugin, downloaded once", async () => {
    pinDeployment("cloud", PlanType.Enterprise);
    pluginsForTest = { SettingsAuditLogExport: lazyPlugin() };

    render(<AuditLogExportPage {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("plugin-SettingsAuditLogExport"),
    ).toBeInTheDocument();
    expect(lazyLoads).toBe(1);
  });

  test.each([PlanType.Free, PlanType.Growth, PlanType.Scale])(
    "the Cloud on the %s plan gets the plan upsell with the project's exports under it, and the plugin never loads",
    (plan: PlanType) => {
      pinDeployment("cloud", plan);
      pluginsForTest = { SettingsAuditLogExport: lazyPlugin() };

      render(<AuditLogExportPage {...PAGE_PROPS} />);

      expect(screen.getByText("Export Audit Logs")).toBeInTheDocument();
      expect(screen.getByText(PLAN_PITCH)).toBeInTheDocument();
      expect(
        screen.getByTestId("audit-log-export-leftovers"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("plugin-SettingsAuditLogExport"),
      ).not.toBeInTheDocument();
      expect(lazyLoads).toBe(0);
    },
  );

  test("the Community Edition gets the edition upsell, and nothing of the feature", () => {
    pinDeployment("self-hosted-community");
    pluginsForTest = null;

    render(<AuditLogExportPage {...PAGE_PROPS} />);

    expect(screen.getByText("Export Audit Logs")).toBeInTheDocument();
    expect(screen.getByText(EDITION_PITCH)).toBeInTheDocument();
    expect(screen.queryByText(PLAN_PITCH)).not.toBeInTheDocument();
    // No plan to leave below: nothing is drawn under the edition upsell.
    expect(screen.queryByTestId("audit-log-export-leftovers")).toBeNull();
  });

  test("the Community Edition never renders a plugin, even if one were present", () => {
    pinDeployment("self-hosted-community");
    pluginsForTest = { SettingsAuditLogExport: recordingPlugin };

    render(<AuditLogExportPage {...PAGE_PROPS} />);

    expect(screen.getByText(EDITION_PITCH)).toBeInTheDocument();
    expect(
      screen.queryByTestId("plugin-SettingsAuditLogExport"),
    ).not.toBeInTheDocument();
  });

  test.each<[Deployment, PlanType | undefined]>([
    ["cloud", PlanType.Enterprise],
    ["self-hosted-enterprise", undefined],
  ])(
    "an eligible %s project on a Community bundle is pointed at the edition, not a plan",
    (deployment: Deployment, plan: PlanType | undefined) => {
      pinDeployment(deployment, plan);
      pluginsForTest = null;

      render(<AuditLogExportPage {...PAGE_PROPS} />);

      expect(screen.getByText(EDITION_PITCH)).toBeInTheDocument();
      expect(screen.queryByText(PLAN_PITCH)).not.toBeInTheDocument();
    },
  );

  test("the upsell says what arrives where, and that no secret leaves", () => {
    pinDeployment("self-hosted-community");
    pluginsForTest = null;

    render(<AuditLogExportPage {...PAGE_PROPS} />);

    for (const title of [
      "Your own storage",
      "Your SIEM or pipeline",
      "Nothing missed",
      "No secrets in the logs",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });
});

describe("the exports a project below the plan still has", () => {
  test("are said to have stopped, and to start again where they stopped", () => {
    expect(
      getPlanLeftoverDescription({
        tableName: "AuditLogExport",
        hasSwitch: true,
      }),
    ).toBe(
      "These stopped exporting: your plan does not include audit log export. Upgrading to the {{planName}} plan starts them again from where they stopped. You can still turn them off or delete them.",
    );
  });
});

describe("the Settings side menu", () => {
  test("lists Export under Audit Logs, after its Settings", async () => {
    pinDeployment("self-hosted-enterprise");
    goTo(`/dashboard/${PROJECT_ID}/settings/audit-logs/export`);

    await renderMenu(<SettingsSideMenu />);

    const links: Array<{ title: string; href: string }> = linksIn("Audit Logs");

    expect(
      links.map((link: { title: string }) => {
        return link.title;
      }),
    ).toEqual(["Audit Logs", "Settings", "Export"]);
    expect(links[2]!.href).toBe(routeFor(PageMap.SETTINGS_AUDIT_LOGS_EXPORT));
  });
});
