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
import fs from "fs";
import path from "path";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The core shells of the audit-log and team-compliance screens.
 *
 * Since the Community / Enterprise split those screens are Enterprise code
 * (ee/Dashboard/AuditLogs, ee/Dashboard/TeamCompliance). Each module stays at
 * its old path as a small shell - same default export, same props - so the 27
 * pages that render <AuditLogsTable>, the route files and the lazy page map
 * never change. A shell renders the Enterprise plugin when the project may use
 * the feature AND the bundle includes it, and the upsell card otherwise.
 *
 * The member compliance status table has no shell and no plugin key: only the
 * Compliance page shows it, and ee's page imports it from ee/ directly. The
 * old shell (Components/Team/TeamComplianceStatusTable) and its key were
 * unreachable, and are pinned here as gone.
 *
 * Pinned here, for each shell:
 *   - which tier it asks for (audit logs: Enterprise; compliance: Scale), on
 *     the Cloud and self-hosted, CE and EE;
 *   - that the plugin gets the caller's props untouched;
 *   - that an ineligible project never renders (or downloads) the plugin;
 *   - that an eligible project on a Community bundle is pointed at the
 *     edition, never told to upgrade its plan;
 *   - the Teams side menu shows Compliance exactly when the page would.
 *
 * The plugins come from a stand-in for src/Enterprise/Plugins; `null` means
 * "the real module", which in this jest config is the empty Community stub.
 * Billing, edition and plan are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true). Nothing here imports ee/.
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

import AuditLogsTable, {
  ComponentProps as AuditLogsTableShellProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTable";
import SettingsAuditLogsSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AuditLogsSettings";
import TeamViewCompliance, {
  TEAM_COMPLIANCE_UPSELL,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Compliance";
import TeamViewSideMenu, {
  isTeamComplianceMenuItemVisible,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/SideMenu";
import {
  AuditLogsTableProps,
  DASHBOARD_ENTERPRISE_PLUGIN_KEYS,
} from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePlugins";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getDashboardPlugins } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
} from "./SideMenuHarness";

/*
 * Compile-time: the shell's props ARE the contract's props, both ways, so the
 * shell and the Enterprise body cannot drift apart without this file failing
 * to type-check.
 */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const AUDIT_LOGS_TABLE_PROPS_MATCH: Exactly<
  AuditLogsTableShellProps,
  AuditLogsTableProps
> = true;

// Where the removed status-table shell used to live.
const REMOVED_STATUS_TABLE_SHELL: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Team",
  "TeamComplianceStatusTable.tsx",
);

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

const SLO_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project-id/settings/audit-logs"),
  currentProject: null,
  hasPaymentMethod: true,
};

// What a plugin was rendered with, per plugin key.
let receivedProps: Record<string, unknown> = {};

const recordingPlugin: (
  key: string,
) => FunctionComponent<Record<string, unknown>> = (
  key: string,
): FunctionComponent<Record<string, unknown>> => {
  const Plugin: FunctionComponent<Record<string, unknown>> = (
    props: Record<string, unknown>,
  ): ReactElement => {
    receivedProps[key] = props;
    return <div data-testid={`plugin-${key}`} />;
  };

  return Plugin;
};

let lazyLoads: number = 0;

const lazyPlugin: (
  key: string,
) => React.ExoticComponent<Record<string, unknown>> = (
  key: string,
): React.ExoticComponent<Record<string, unknown>> => {
  return React.lazy(
    async (): Promise<{
      default: FunctionComponent<Record<string, unknown>>;
    }> => {
      lazyLoads += 1;
      return { default: recordingPlugin(key) };
    },
  );
};

const installPlugins: () => void = (): void => {
  pluginsForTest = {
    AuditLogsTable: recordingPlugin("AuditLogsTable"),
    SettingsAuditLogsSettings: recordingPlugin("SettingsAuditLogsSettings"),
    TeamCompliance: recordingPlugin("TeamCompliance"),
  };
};

// The two upsell wordings the audit-log card uses.
const AUDIT_PLAN_PITCH: string =
  "Audit Logs are available on the Enterprise plan. Upgrade to turn on audit logging for this project.";
const AUDIT_EDITION_PITCH: string =
  "Audit Logs are a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable audit logging.";

beforeEach(() => {
  pinDeployment("self-hosted-community");
  pluginsForTest = {};
  receivedProps = {};
  lazyLoads = 0;

  /*
   * A spy rather than a module mock: ProjectUtil is a class of statics, which
   * an object spread would drop, and the side menu needs the real
   * getCurrentProjectId to build its links.
   */
  jest.spyOn(ProjectUtil, "getCurrentPlan").mockImplementation((() => {
    return currentPlanForTest;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the shell contract", () => {
  test("the shell's props are exactly the contract's props", () => {
    expect(AUDIT_LOGS_TABLE_PROPS_MATCH).toBe(true);
  });

  test("this jest config (a Community build) has no audit-log or compliance plugin", () => {
    pluginsForTest = null;

    const plugins: Record<string, unknown> = getDashboardPlugins() as Record<
      string,
      unknown
    >;

    expect(plugins["AuditLogsTable"]).toBeUndefined();
    expect(plugins["SettingsAuditLogsSettings"]).toBeUndefined();
    expect(plugins["TeamCompliance"]).toBeUndefined();
  });

  test("the member status table is not a plugin key, and core has no shell for it", () => {
    expect(DASHBOARD_ENTERPRISE_PLUGIN_KEYS).toContain("TeamCompliance");
    expect(DASHBOARD_ENTERPRISE_PLUGIN_KEYS).not.toContain(
      "TeamComplianceStatusTable",
    );
    expect(fs.existsSync(REMOVED_STATUS_TABLE_SHELL)).toBe(false);
    // Negative control: the path points where the shell really lived.
    expect(fs.existsSync(path.dirname(REMOVED_STATUS_TABLE_SHELL))).toBe(true);
  });
});

describe("AuditLogsTable (the table on every resource page)", () => {
  const renderTable: () => void = (): void => {
    render(
      <AuditLogsTable
        title="SLO Audit Logs"
        description="Changes people made to this SLO."
        rootResourceId={SLO_ID}
      />,
    );
  };

  test("self-hosted Enterprise Edition renders the plugin with the caller's props, untouched", () => {
    pinDeployment("self-hosted-enterprise");
    installPlugins();

    render(
      <AuditLogsTable
        title="Monitor Audit Logs"
        description="Changes to this monitor."
        resourceType="Monitor"
        resourceId={SLO_ID}
      />,
    );

    expect(screen.getByTestId("plugin-AuditLogsTable")).toBeInTheDocument();
    expect(receivedProps["AuditLogsTable"]).toEqual({
      title: "Monitor Audit Logs",
      description: "Changes to this monitor.",
      resourceType: "Monitor",
      resourceId: SLO_ID,
    });
  });

  test("the root pointer reaches the plugin as the very same ObjectID", () => {
    pinDeployment("self-hosted-enterprise");
    installPlugins();

    renderTable();

    const props: Record<string, unknown> = receivedProps[
      "AuditLogsTable"
    ] as Record<string, unknown>;

    expect(props["rootResourceId"]).toBe(SLO_ID);
  });

  test("the Cloud on the Enterprise plan renders the plugin", () => {
    pinDeployment("cloud", PlanType.Enterprise);
    installPlugins();

    renderTable();

    expect(screen.getByTestId("plugin-AuditLogsTable")).toBeInTheDocument();
  });

  test.each([PlanType.Free, PlanType.Growth, PlanType.Scale])(
    "the Cloud on the %s plan gets the plan upsell, and the plugin never loads",
    (plan: PlanType) => {
      pinDeployment("cloud", plan);
      pluginsForTest = { AuditLogsTable: lazyPlugin("AuditLogsTable") };

      renderTable();

      expect(screen.getByText(AUDIT_PLAN_PITCH)).toBeInTheDocument();
      expect(screen.getByText("SLO Audit Logs")).toBeInTheDocument();
      expect(
        screen.queryByTestId("plugin-AuditLogsTable"),
      ).not.toBeInTheDocument();
      expect(lazyLoads).toBe(0);
    },
  );

  test("the self-hosted Community Edition gets the edition upsell, even if a plugin were present", () => {
    pinDeployment("self-hosted-community");
    installPlugins();

    renderTable();

    expect(screen.getByText(AUDIT_EDITION_PITCH)).toBeInTheDocument();
    expect(
      screen.queryByTestId("plugin-AuditLogsTable"),
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

      renderTable();

      expect(screen.getByText(AUDIT_EDITION_PITCH)).toBeInTheDocument();
      expect(screen.queryByText(AUDIT_PLAN_PITCH)).not.toBeInTheDocument();
    },
  );

  test("reads the plugins when it renders, not when it was imported", () => {
    pinDeployment("self-hosted-enterprise");
    pluginsForTest = {};

    const { unmount } = render(
      <AuditLogsTable title="Audit Logs" description="Everything." />,
    );
    expect(
      screen.queryByTestId("plugin-AuditLogsTable"),
    ).not.toBeInTheDocument();
    unmount();

    installPlugins();
    render(<AuditLogsTable title="Audit Logs" description="Everything." />);
    expect(screen.getByTestId("plugin-AuditLogsTable")).toBeInTheDocument();
  });

  test("a lazy plugin downloads once, on first render", async () => {
    pinDeployment("self-hosted-enterprise");
    pluginsForTest = { AuditLogsTable: lazyPlugin("AuditLogsTable") };

    renderTable();

    expect(
      await screen.findByTestId("plugin-AuditLogsTable"),
    ).toBeInTheDocument();
    expect(lazyLoads).toBe(1);
  });
});

describe("Settings > Audit Logs", () => {
  test("renders the plugin with the page's own props for an eligible project", () => {
    pinDeployment("cloud", PlanType.Enterprise);
    installPlugins();

    render(<SettingsAuditLogsSettings {...PAGE_PROPS} />);

    expect(
      screen.getByTestId("plugin-SettingsAuditLogsSettings"),
    ).toBeInTheDocument();
    expect(receivedProps["SettingsAuditLogsSettings"]).toEqual(PAGE_PROPS);
  });

  test("the Cloud below the Enterprise plan gets the settings upsell", () => {
    pinDeployment("cloud", PlanType.Scale);
    installPlugins();

    render(<SettingsAuditLogsSettings {...PAGE_PROPS} />);

    expect(screen.getByText("Audit Logs Settings")).toBeInTheDocument();
    expect(screen.getByText(AUDIT_PLAN_PITCH)).toBeInTheDocument();
    expect(
      screen.queryByTestId("plugin-SettingsAuditLogsSettings"),
    ).not.toBeInTheDocument();
  });

  test("the Community Edition gets the edition upsell", () => {
    pinDeployment("self-hosted-community");
    pluginsForTest = null;

    render(<SettingsAuditLogsSettings {...PAGE_PROPS} />);

    expect(screen.getByText("Audit Logs Settings")).toBeInTheDocument();
    expect(screen.getByText(AUDIT_EDITION_PITCH)).toBeInTheDocument();
  });
});

describe("Teams > View > Compliance", () => {
  test.each([PlanType.Scale, PlanType.Enterprise])(
    "the Cloud on the %s plan renders the plugin with the page's props",
    (plan: PlanType) => {
      pinDeployment("cloud", plan);
      installPlugins();

      render(<TeamViewCompliance {...PAGE_PROPS} />);

      expect(screen.getByTestId("plugin-TeamCompliance")).toBeInTheDocument();
      expect(receivedProps["TeamCompliance"]).toEqual(PAGE_PROPS);
    },
  );

  test.each([PlanType.Free, PlanType.Growth])(
    "the Cloud on the %s plan gets the Scale upsell",
    (plan: PlanType) => {
      pinDeployment("cloud", plan);
      installPlugins();

      render(<TeamViewCompliance {...PAGE_PROPS} />);

      expect(screen.getAllByText("Upgrade to Scale").length).toBeGreaterThan(0);
      expect(
        screen.getByText(TEAM_COMPLIANCE_UPSELL.featureName),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("plugin-TeamCompliance"),
      ).not.toBeInTheDocument();
    },
  );

  test("self-hosted Enterprise Edition renders the plugin", () => {
    pinDeployment("self-hosted-enterprise");
    installPlugins();

    render(<TeamViewCompliance {...PAGE_PROPS} />);

    expect(screen.getByTestId("plugin-TeamCompliance")).toBeInTheDocument();
  });

  test("the Community Edition gets the edition upsell with the page's wording", () => {
    pinDeployment("self-hosted-community");
    pluginsForTest = null;

    render(<TeamViewCompliance {...PAGE_PROPS} />);

    expect(screen.getByText("Team Compliance Rules")).toBeInTheDocument();
    expect(
      screen.getAllByText("Learn about Enterprise Edition").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Upgrade to Scale")).not.toBeInTheDocument();
  });

  test("the upsell keeps the page's wording and its four benefits", () => {
    expect(TEAM_COMPLIANCE_UPSELL.title).toBe("Compliance Settings");
    expect(TEAM_COMPLIANCE_UPSELL.description).toBe(
      "Enforce compliance rules on this team.",
    );
    expect(TEAM_COMPLIANCE_UPSELL.benefits).toHaveLength(4);
  });
});

describe("Teams > View side menu: the Compliance item", () => {
  const TEAM_ID: ObjectID = new ObjectID(
    "00000000-0000-4000-8000-000000000009",
  );

  test.each<[Deployment, PlanType | undefined, boolean]>([
    ["cloud", PlanType.Free, false],
    ["cloud", PlanType.Growth, false],
    ["cloud", PlanType.Scale, true],
    ["cloud", PlanType.Enterprise, true],
    ["cloud", undefined, false],
    ["self-hosted-enterprise", undefined, true],
    ["self-hosted-community", undefined, false],
  ])(
    "%s on plan %s: shown=%s",
    async (
      deployment: Deployment,
      plan: PlanType | undefined,
      shown: boolean,
    ) => {
      pinDeployment(deployment, plan);

      expect(isTeamComplianceMenuItemVisible()).toBe(shown);

      goTo(`/dashboard/${PROJECT_ID}/settings/teams/${TEAM_ID.toString()}`);
      await renderMenu(<TeamViewSideMenu modelId={TEAM_ID} />);

      expect(sectionTitlesInOrder().includes("Compliance")).toBe(shown);

      if (shown) {
        expect(linksIn("Compliance")[0]?.href).toContain(
          `${TEAM_ID.toString()}/compliance`,
        );
      }
    },
  );

  test("the menu and the page agree: shown exactly when the page renders the feature", () => {
    installPlugins();

    for (const [deployment, plan] of [
      ["cloud", PlanType.Growth],
      ["cloud", PlanType.Scale],
      ["self-hosted-enterprise", undefined],
      ["self-hosted-community", undefined],
    ] as Array<[Deployment, PlanType | undefined]>) {
      pinDeployment(deployment, plan);

      const { unmount } = render(<TeamViewCompliance {...PAGE_PROPS} />);
      const pageShowsFeature: boolean =
        screen.queryByTestId("plugin-TeamCompliance") !== null;
      unmount();

      expect(isTeamComplianceMenuItemVisible()).toBe(pageShowsFeature);
    }
  });
});
