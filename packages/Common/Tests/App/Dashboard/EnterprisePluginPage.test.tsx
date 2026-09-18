import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, {
  FunctionComponent,
  ReactElement,
  forwardRef,
  useImperativeHandle,
} from "react";

/*
 * The Dashboard's Enterprise plugin door and the component every enterprise
 * shell renders.
 *
 * A shell (Settings > SSO, the audit log table, ...) stays at its original
 * path in core and renders <EnterprisePluginPage>: the ee plugin when the
 * project may use the feature AND this bundle includes it, the upsell card
 * otherwise. The plugins come from getDashboardPlugins(), which in every
 * Community build - and in this jest config, through its moduleNameMapper -
 * is the empty Community stub.
 *
 * Billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;
let currentPlanForTest: string | null = null;

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

jest.mock("../../../UI/Utils/Project", () => {
  const actual: Record<string, any> = jest.requireActual(
    "../../../UI/Utils/Project",
  ) as Record<string, any>;

  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual["default"],
      getCurrentPlan: (): string | null => {
        return currentPlanForTest;
      },
    },
  };
});

import EnterprisePluginPage, {
  getUpgradeReason,
} from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePluginPage";
import { getDashboardPlugins } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins";
import {
  DASHBOARD_ENTERPRISE_PLUGIN_KEYS,
  DashboardEnterprisePlugins,
  EnterprisePluginComponent,
  TeamComplianceStatusTableProps,
  TeamComplianceStatusTableRef,
} from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePlugins";
import {
  AUDIT_LOGS_REQUIRED_PLAN,
  IDENTITY_REQUIRED_PLAN,
} from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterpriseEligibility";
import { EnterpriseUpgradeReason } from "../../../../App/FeatureSet/Dashboard/src/Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import AuditLogsEnterpriseUpgrade from "../../../../App/FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsEnterpriseUpgrade";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";

type Deployment = "cloud" | "self-hosted-enterprise" | "self-hosted-community";

const pinDeployment: (deployment: Deployment) => void = (
  deployment: Deployment,
): void => {
  billingEnabledForTest = deployment === "cloud";
  // The Cloud runs the Enterprise image: its effective edition is true.
  enterpriseEditionForTest = deployment !== "self-hosted-community";
};

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project-id/settings/sso"),
  currentProject: null,
  hasPaymentMethod: true,
};

const UPSELL: {
  title: string;
  description: string;
  featureName: string;
  benefits: Array<{ icon: IconProp; title: string; subtitle: string }>;
} = {
  title: "Single Sign On (SSO)",
  description: "Configure SAML SSO for your project.",
  featureName: "SAML Single Sign On",
  benefits: [
    {
      icon: IconProp.Lock,
      title: "Centralized auth",
      subtitle: "Revoke access from one place.",
    },
  ],
};

const FakeSSOPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <div data-testid="fake-sso-plugin">
      {props.pageRoute.toString()}|{String(props.hasPaymentMethod)}
    </div>
  );
};

let lazyLoads: number = 0;
let releaseLazyPlugin: (() => void) | null = null;

/*
 * A React.lazy plugin, the shape ee areas hand over. It counts its loads (an
 * ineligible project must never download the ee chunk) and can be held
 * pending to observe the loading state.
 */
const makeLazyPlugin: (
  holdUntilReleased: boolean,
) => EnterprisePluginComponent<PageComponentProps> = (
  holdUntilReleased: boolean,
): EnterprisePluginComponent<PageComponentProps> => {
  return React.lazy(
    async (): Promise<{ default: FunctionComponent<PageComponentProps> }> => {
      lazyLoads += 1;

      if (holdUntilReleased) {
        await new Promise<void>((resolve: () => void) => {
          releaseLazyPlugin = resolve;
        });
      }

      return { default: FakeSSOPage };
    },
  );
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  currentPlanForTest = null;
  lazyLoads = 0;
  releaseLazyPlugin = null;
});

afterEach(() => {
  cleanup();
});

describe("getUpgradeReason", () => {
  test("an eligible project that still sees the card lacks the Enterprise build, not a plan", () => {
    pinDeployment("cloud");
    expect(getUpgradeReason(true)).toBe(EnterpriseUpgradeReason.Edition);
  });

  test("an ineligible Cloud project needs a plan", () => {
    pinDeployment("cloud");
    expect(getUpgradeReason(false)).toBe(EnterpriseUpgradeReason.Plan);
  });

  test("an ineligible self-hosted install needs the Enterprise Edition", () => {
    pinDeployment("self-hosted-community");
    expect(getUpgradeReason(false)).toBe(EnterpriseUpgradeReason.Edition);
  });
});

describe("EnterprisePluginPage", () => {
  test("renders the plugin, with the shell's props, for an eligible Cloud project", () => {
    pinDeployment("cloud");
    currentPlanForTest = PlanType.Scale;

    render(
      <EnterprisePluginPage
        plugin={FakeSSOPage}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
      />,
    );

    expect(screen.getByTestId("fake-sso-plugin")).toHaveTextContent(
      "/dashboard/project-id/settings/sso|true",
    );
    expect(screen.queryByText("SAML Single Sign On")).not.toBeInTheDocument();
  });

  test("shows the plan upsell, and never downloads the plugin, below the tier", () => {
    pinDeployment("cloud");
    currentPlanForTest = PlanType.Growth;

    render(
      <EnterprisePluginPage
        plugin={makeLazyPlugin(false)}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
      />,
    );

    expect(screen.getAllByText("Upgrade to Scale")).toHaveLength(2);
    expect(screen.getByText("SAML Single Sign On")).toBeInTheDocument();
    expect(screen.queryByTestId("fake-sso-plugin")).not.toBeInTheDocument();
    expect(lazyLoads).toBe(0);
  });

  test("uses the page's own tier: Scale is not enough for an Enterprise-tier feature", () => {
    pinDeployment("cloud");
    currentPlanForTest = PlanType.Scale;

    render(
      <EnterprisePluginPage
        plugin={FakeSSOPage}
        pluginProps={PAGE_PROPS}
        requiredPlan={AUDIT_LOGS_REQUIRED_PLAN}
        upsell={UPSELL}
      />,
    );

    expect(screen.getAllByText("Upgrade to Enterprise")).toHaveLength(2);
    expect(screen.queryByTestId("fake-sso-plugin")).not.toBeInTheDocument();
  });

  test("an eligible Cloud project on a Community bundle is pointed at the edition, never told to upgrade", () => {
    pinDeployment("cloud");
    currentPlanForTest = PlanType.Enterprise;

    render(
      <EnterprisePluginPage
        plugin={undefined}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
      />,
    );

    expect(screen.getAllByText("Learn about Enterprise Edition")).toHaveLength(
      2,
    );
    expect(screen.queryByText("Upgrade to Scale")).not.toBeInTheDocument();
  });

  test("self-hosted Enterprise Edition renders the plugin", () => {
    pinDeployment("self-hosted-enterprise");

    render(
      <EnterprisePluginPage
        plugin={FakeSSOPage}
        pluginProps={PAGE_PROPS}
        requiredPlan={AUDIT_LOGS_REQUIRED_PLAN}
        upsell={UPSELL}
      />,
    );

    expect(screen.getByTestId("fake-sso-plugin")).toBeInTheDocument();
  });

  test("self-hosted Community Edition shows the edition upsell, plugin or not", () => {
    pinDeployment("self-hosted-community");

    render(
      <EnterprisePluginPage
        plugin={FakeSSOPage}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
      />,
    );

    expect(screen.getAllByText("Learn about Enterprise Edition")).toHaveLength(
      2,
    );
    expect(screen.queryByTestId("fake-sso-plugin")).not.toBeInTheDocument();
  });

  test("self-hosted Enterprise Edition on a Community bundle shows the edition upsell", () => {
    pinDeployment("self-hosted-enterprise");

    render(
      <EnterprisePluginPage
        plugin={undefined}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
      />,
    );

    expect(screen.getAllByText("Learn about Enterprise Edition")).toHaveLength(
      2,
    );
  });

  test("a lazy plugin shows the in-card loader, then the plugin", async () => {
    pinDeployment("self-hosted-enterprise");

    render(
      <EnterprisePluginPage
        plugin={makeLazyPlugin(true)}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
      />,
    );

    expect(await screen.findByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("fake-sso-plugin")).not.toBeInTheDocument();

    await act(async () => {
      releaseLazyPlugin?.();
    });

    expect(await screen.findByTestId("fake-sso-plugin")).toBeInTheDocument();
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
    expect(lazyLoads).toBe(1);
  });

  test("uses a caller's loading element while the plugin downloads", async () => {
    pinDeployment("self-hosted-enterprise");

    render(
      <EnterprisePluginPage
        plugin={makeLazyPlugin(true)}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
        loadingElement={<div data-testid="custom-loading" />}
      />,
    );

    expect(await screen.findByTestId("custom-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();

    await act(async () => {
      releaseLazyPlugin?.();
    });

    expect(await screen.findByTestId("fake-sso-plugin")).toBeInTheDocument();
  });

  test("isEligible overrides the plan and edition check, both ways", () => {
    pinDeployment("cloud");
    currentPlanForTest = PlanType.Free;

    const { unmount } = render(
      <EnterprisePluginPage
        plugin={FakeSSOPage}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
        isEligible={true}
      />,
    );
    expect(screen.getByTestId("fake-sso-plugin")).toBeInTheDocument();
    unmount();

    pinDeployment("self-hosted-enterprise");
    render(
      <EnterprisePluginPage
        plugin={FakeSSOPage}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
        isEligible={false}
      />,
    );
    expect(screen.queryByTestId("fake-sso-plugin")).not.toBeInTheDocument();
    expect(screen.getByText("SAML Single Sign On")).toBeInTheDocument();
  });

  test("renderUpsell replaces the card and is told why it is showing", () => {
    pinDeployment("cloud");
    const reasons: Array<EnterpriseUpgradeReason> = [];

    const renderAuditUpsell: (
      reason: EnterpriseUpgradeReason,
    ) => ReactElement = (reason: EnterpriseUpgradeReason): ReactElement => {
      reasons.push(reason);
      return (
        <AuditLogsEnterpriseUpgrade
          title="Audit Logs"
          description="Every change made in this project."
          reason={reason}
        />
      );
    };

    // Below the tier: sell the plan.
    currentPlanForTest = PlanType.Scale;
    const { unmount } = render(
      <EnterprisePluginPage
        plugin={FakeSSOPage}
        pluginProps={PAGE_PROPS}
        requiredPlan={AUDIT_LOGS_REQUIRED_PLAN}
        renderUpsell={renderAuditUpsell}
      />,
    );
    expect(
      screen.getByText(
        "Audit Logs are available on the Enterprise plan. Upgrade to turn on audit logging for this project.",
      ),
    ).toBeInTheDocument();
    unmount();

    // On the tier, but the bundle has no plugin: the edition, not a plan.
    currentPlanForTest = PlanType.Enterprise;
    render(
      <EnterprisePluginPage
        plugin={undefined}
        pluginProps={PAGE_PROPS}
        requiredPlan={AUDIT_LOGS_REQUIRED_PLAN}
        renderUpsell={renderAuditUpsell}
      />,
    );
    expect(
      screen.getByText(
        "Audit Logs are a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable audit logging.",
      ),
    ).toBeInTheDocument();

    expect(reasons).toEqual([
      EnterpriseUpgradeReason.Plan,
      EnterpriseUpgradeReason.Edition,
    ]);
  });

  test("forwards a ref through to the plugin, lazy or not", async () => {
    pinDeployment("self-hosted-enterprise");

    const refreshes: Array<string> = [];

    const FakeComplianceTable: React.ForwardRefExoticComponent<
      TeamComplianceStatusTableProps &
        React.RefAttributes<TeamComplianceStatusTableRef>
    > = forwardRef<
      TeamComplianceStatusTableRef,
      TeamComplianceStatusTableProps
    >(
      (
        props: TeamComplianceStatusTableProps,
        ref: React.Ref<TeamComplianceStatusTableRef>,
      ): ReactElement => {
        useImperativeHandle(ref, () => {
          return {
            refresh: (): void => {
              refreshes.push(props.teamId.toString());
            },
          };
        });

        return <div data-testid="fake-compliance-table" />;
      },
    );
    FakeComplianceTable.displayName = "FakeComplianceTable";

    const teamId: ObjectID = new ObjectID(
      "11111111-1111-4111-8111-111111111111",
    );

    /*
     * Typed as the contract's slot: a forwardRef table declared the way the
     * real one is fits it both eagerly and behind React.lazy (a
     * RefAttributes-typed slot would reject the lazy one under
     * @types/react 18.3, which this package installs).
     */
    const plugins: Array<
      NonNullable<DashboardEnterprisePlugins["TeamComplianceStatusTable"]>
    > = [
      FakeComplianceTable,
      React.lazy(async (): Promise<{ default: typeof FakeComplianceTable }> => {
        return { default: FakeComplianceTable };
      }),
    ];

    for (const plugin of plugins) {
      const tableRef: React.RefObject<TeamComplianceStatusTableRef> =
        React.createRef<TeamComplianceStatusTableRef>();

      const { unmount } = render(
        <EnterprisePluginPage
          plugin={plugin}
          pluginProps={{ teamId, ref: tableRef }}
          requiredPlan={IDENTITY_REQUIRED_PLAN}
          upsell={UPSELL}
        />,
      );

      expect(
        await screen.findByTestId("fake-compliance-table"),
      ).toBeInTheDocument();

      tableRef.current?.refresh();
      unmount();
    }

    expect(refreshes).toEqual([teamId.toString(), teamId.toString()]);
  });
});

describe("the Community plugin door (what this jest config resolves)", () => {
  test("getDashboardPlugins() is the empty Community stub", () => {
    const plugins: DashboardEnterprisePlugins = getDashboardPlugins();

    expect(plugins).toEqual({});
    expect(plugins.buildMarker).toBeUndefined();

    for (const key of DASHBOARD_ENTERPRISE_PLUGIN_KEYS) {
      expect([key, plugins[key]]).toEqual([key, undefined]);
    }
  });

  test("returns the same object on every call", () => {
    expect(getDashboardPlugins()).toBe(getDashboardPlugins());
  });

  test("names every screen a plugin can provide, once", () => {
    expect([...DASHBOARD_ENTERPRISE_PLUGIN_KEYS].sort()).toEqual(
      [
        "AuditLogsTable",
        "SettingsAuditLogsSettings",
        "SettingsOIDC",
        "SettingsSCIM",
        "SettingsSSO",
        "StatusPageOIDC",
        "StatusPageSCIM",
        "StatusPageSSO",
        "TeamCompliance",
        "TeamComplianceStatusTable",
      ].sort(),
    );
    expect(new Set(DASHBOARD_ENTERPRISE_PLUGIN_KEYS).size).toBe(
      DASHBOARD_ENTERPRISE_PLUGIN_KEYS.length,
    );
  });

  test("a shell reading the real door on a Community build shows the upsell even when eligible", () => {
    pinDeployment("cloud");
    currentPlanForTest = PlanType.Enterprise;

    render(
      <EnterprisePluginPage
        plugin={getDashboardPlugins().SettingsSSO}
        pluginProps={PAGE_PROPS}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        upsell={UPSELL}
      />,
    );

    expect(screen.getAllByText("Learn about Enterprise Edition")).toHaveLength(
      2,
    );
  });
});

describe("the plugin door with other plugin modules", () => {
  /*
   * These swap what "@oneuptime/ee-dashboard" resolves to, so they run on a
   * fresh module registry and render nothing afterwards.
   */
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock("@oneuptime/ee-dashboard");
    jest.resetModules();
  });

  test("hands back the Enterprise plugin object as is", async () => {
    const enterprisePlugins: DashboardEnterprisePlugins = {
      buildMarker: "ONEUPTIME_EE_DASHBOARD_PLUGIN_v1",
      SettingsSSO: FakeSSOPage,
    };

    jest.doMock("@oneuptime/ee-dashboard", () => {
      return { __esModule: true, default: enterprisePlugins };
    });

    const door: { getDashboardPlugins: () => DashboardEnterprisePlugins } =
      await import(
        "../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins"
      );

    expect(door.getDashboardPlugins()).toBe(enterprisePlugins);
    expect(door.getDashboardPlugins().SettingsSSO).toBe(FakeSSOPage);
  });

  test("fails loudly, naming the rule, when read before the plugin module finished loading", async () => {
    /*
     * What a top-level read sees in the Enterprise bundle's import cycle: the
     * plugin binding is still undefined. A silent {} would quietly turn an
     * Enterprise install into the Community UI.
     */
    jest.doMock("@oneuptime/ee-dashboard", () => {
      return { __esModule: true, default: undefined };
    });

    const door: { getDashboardPlugins: () => DashboardEnterprisePlugins } =
      await import(
        "../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins"
      );

    expect(() => {
      return door.getDashboardPlugins();
    }).toThrow(
      "getDashboardPlugins() ran before the Enterprise plugin module finished loading. Call it inside a render or function body, never at module top level.",
    );
  });
});
