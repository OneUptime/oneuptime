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
 * The six identity pages the Dashboard routes to - Settings > SSO / OIDC /
 * SCIM and Status page > SSO / OIDC / SCIM - are Enterprise Edition screens
 * (ee/Dashboard/SSO). Core keeps a shell at each page's original path, so the
 * route files and the lazy page map never changed: the shell renders the
 * Enterprise screen when the project may use the feature AND the bundle
 * includes it, and the upsell card the page used to show otherwise.
 *
 * "@oneuptime/ee-dashboard" is replaced by a plugin object the tests fill in,
 * standing in for the Enterprise bundle; left empty it is the Community
 * bundle. Billing, the edition and the plan are pinned in every test: CI's
 * config.env sets BILLING_ENABLED=true.
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

/*
 * What getDashboardPlugins() returns in this suite. The shells read it on
 * every render, so each test fills it in after the shells were imported.
 */
const mockEnterprisePlugins: Record<string, unknown> = {};

jest.mock("@oneuptime/ee-dashboard", () => {
  return { __esModule: true, default: mockEnterprisePlugins };
});

import SettingsOIDC from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/OIDC";
import SettingsSCIM from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SCIM";
import SettingsSSO from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SSO";
import StatusPageViewOIDC from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/OIDC";
import StatusPageViewSCIM from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SCIM";
import StatusPageViewSSO from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SSO";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { DashboardEnterprisePluginKey } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePlugins";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";

interface ShellCase {
  name: string;
  Shell: FunctionComponent<PageComponentProps>;
  pluginKey: DashboardEnterprisePluginKey;
  // The upsell copy the page showed before it moved to ee/.
  upsellTitle: string;
  featureName: string;
}

const SHELLS: Array<ShellCase> = [
  {
    name: "Settings > SSO",
    Shell: SettingsSSO,
    pluginKey: "SettingsSSO",
    upsellTitle: "Single Sign On (SSO)",
    featureName: "SAML Single Sign On",
  },
  {
    name: "Settings > OIDC",
    Shell: SettingsOIDC,
    pluginKey: "SettingsOIDC",
    upsellTitle: "OpenID Connect (OIDC)",
    featureName: "OIDC Single Sign On",
  },
  {
    name: "Settings > SCIM",
    Shell: SettingsSCIM,
    pluginKey: "SettingsSCIM",
    upsellTitle: "SCIM User Provisioning",
    featureName: "SCIM User Provisioning",
  },
  {
    name: "Status page > SSO",
    Shell: StatusPageViewSSO,
    pluginKey: "StatusPageSSO",
    upsellTitle: "Status Page SSO",
    featureName: "Status Page SAML SSO",
  },
  {
    name: "Status page > OIDC",
    Shell: StatusPageViewOIDC,
    pluginKey: "StatusPageOIDC",
    upsellTitle: "Status Page OIDC",
    featureName: "Status Page OIDC SSO",
  },
  {
    name: "Status page > SCIM",
    Shell: StatusPageViewSCIM,
    pluginKey: "StatusPageSCIM",
    upsellTitle: "Status Page SCIM",
    featureName: "Status Page SCIM Provisioning",
  },
];

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project-id/settings/identity"),
  currentProject: null,
  hasPaymentMethod: true,
};

/*
 * Stands in for an Enterprise screen: says which plugin key it is and echoes
 * the props the shell handed it.
 */
const makeFakeScreen: (
  pluginKey: string,
) => FunctionComponent<PageComponentProps> = (
  pluginKey: string,
): FunctionComponent<PageComponentProps> => {
  const FakeScreen: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps,
  ): ReactElement => {
    return (
      <div data-testid="enterprise-screen">
        {pluginKey}|{props.pageRoute.toString()}|
        {String(props.hasPaymentMethod)}
      </div>
    );
  };

  return FakeScreen;
};

const installPlugins: (keys: Array<DashboardEnterprisePluginKey>) => void = (
  keys: Array<DashboardEnterprisePluginKey>,
): void => {
  for (const key of keys) {
    mockEnterprisePlugins[key] = makeFakeScreen(key);
  }
};

const clearPlugins: () => void = (): void => {
  for (const key of Object.keys(mockEnterprisePlugins)) {
    delete mockEnterprisePlugins[key];
  }
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  currentPlanForTest = null;
  clearPlugins();
});

afterEach(() => {
  cleanup();
  clearPlugins();
});

describe.each(SHELLS)("$name shell", (shell: ShellCase) => {
  test("Community Edition: the upsell card, even when a plugin is present", () => {
    installPlugins([shell.pluginKey]);

    render(<shell.Shell {...PAGE_PROPS} />);

    expect(screen.getAllByText(shell.featureName).length).toBeGreaterThan(0);
    expect(screen.getAllByText(shell.upsellTitle).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Learn about Enterprise Edition").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("enterprise-screen")).not.toBeInTheDocument();
  });

  test("Enterprise Edition: the Enterprise screen, with the page props", () => {
    enterpriseEditionForTest = true;
    installPlugins([shell.pluginKey]);

    render(<shell.Shell {...PAGE_PROPS} />);

    expect(screen.getByTestId("enterprise-screen")).toHaveTextContent(
      `${shell.pluginKey}|/dashboard/project-id/settings/identity|true`,
    );
    expect(screen.queryByText(shell.featureName)).not.toBeInTheDocument();
  });

  test("Enterprise Edition on a Community bundle: the upsell, pointing at the edition", () => {
    enterpriseEditionForTest = true;

    render(<shell.Shell {...PAGE_PROPS} />);

    expect(screen.getAllByText(shell.featureName).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Learn about Enterprise Edition").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Upgrade to Scale")).not.toBeInTheDocument();
  });

  test("OneUptime Cloud below Scale: the plan upsell, never the screen", () => {
    billingEnabledForTest = true;
    enterpriseEditionForTest = true;
    currentPlanForTest = PlanType.Growth;
    installPlugins([shell.pluginKey]);

    render(<shell.Shell {...PAGE_PROPS} />);

    expect(screen.getAllByText("Upgrade to Scale").length).toBeGreaterThan(0);
    expect(screen.getAllByText(shell.featureName).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("enterprise-screen")).not.toBeInTheDocument();
  });

  test.each([PlanType.Scale, PlanType.Enterprise])(
    "OneUptime Cloud on %s: the Enterprise screen",
    (plan: PlanType) => {
      billingEnabledForTest = true;
      enterpriseEditionForTest = true;
      currentPlanForTest = plan;
      installPlugins([shell.pluginKey]);

      render(<shell.Shell {...PAGE_PROPS} />);

      expect(screen.getByTestId("enterprise-screen")).toHaveTextContent(
        shell.pluginKey,
      );
    },
  );

  test("renders its own plugin key when every identity screen is present", () => {
    enterpriseEditionForTest = true;
    installPlugins(
      SHELLS.map((each: ShellCase) => {
        return each.pluginKey;
      }),
    );

    render(<shell.Shell {...PAGE_PROPS} />);

    expect(screen.getByTestId("enterprise-screen")).toHaveTextContent(
      `${shell.pluginKey}|`,
    );
  });

  test("ignores other features' screens", () => {
    enterpriseEditionForTest = true;
    installPlugins(
      SHELLS.map((each: ShellCase) => {
        return each.pluginKey;
      }).filter((key: DashboardEnterprisePluginKey) => {
        return key !== shell.pluginKey;
      }),
    );

    render(<shell.Shell {...PAGE_PROPS} />);

    expect(screen.queryByTestId("enterprise-screen")).not.toBeInTheDocument();
    expect(screen.getAllByText(shell.featureName).length).toBeGreaterThan(0);
  });
});

describe("identity shells", () => {
  test("each reads a different plugin key", () => {
    const keys: Array<string> = SHELLS.map((shell: ShellCase) => {
      return shell.pluginKey;
    });

    expect(new Set(keys).size).toBe(SHELLS.length);
  });
});
