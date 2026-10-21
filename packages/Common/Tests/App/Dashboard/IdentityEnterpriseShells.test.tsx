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
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The two SCIM pages the Dashboard routes to - Settings > SCIM and Status
 * page > SCIM - are Enterprise Edition screens (ee/Dashboard/Identity). Core
 * keeps a shell at each page's original path, so the route files and the
 * lazy page map never changed: the shell renders the Enterprise screen when
 * the project may use the feature AND the bundle includes it, and the upsell
 * card the page used to show otherwise.
 *
 * (Single sign-on is not among them: its pages are core in every edition -
 * SsoPages.test.tsx covers them.)
 *
 * "@oneuptime/ee-dashboard" is replaced by a plugin object the tests fill in,
 * standing in for the Enterprise bundle; left empty it is the Community
 * bundle. Billing, the edition and the plan are pinned in every test: CI's
 * config.env sets BILLING_ENABLED=true.
 *
 * On OneUptime Cloud below Scale, the SCIM connections a project or status
 * page still has keep provisioning people, so they are listed under the
 * upsell to delete (IdentityPlanLeftovers, PlanLeftoverTable). The table is
 * a stand-in here, and the count it asks for answers what each test says.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;
let currentPlanForTest: string | null = null;
let currentPlanThrows: boolean = false;

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
      getCurrentProjectId: (): string => {
        return "33333333-3333-4333-8333-333333333333";
      },
      getCurrentPlan: (): string | null => {
        if (currentPlanThrows) {
          throw new Error("Plan ID is invalid");
        }

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

// How many SCIM connections a page still has, and what was counted.
const mockLeftovers: {
  count: number;
  countedModels: Array<string>;
} = { count: 0, countedModels: [] };

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (request: {
        modelType: { new (): { tableName?: string | undefined } };
      }): Promise<number> => {
        mockLeftovers.countedModels.push(
          new request.modelType().tableName || "",
        );
        return mockLeftovers.count;
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: {
      id: string;
      isCreateable: boolean;
      isEditable?: boolean;
      isDeleteable: boolean;
    }): ReactElement => {
      return react.createElement("div", {
        "data-testid": `model-table-${props.id}`,
        "data-createable": String(props.isCreateable),
        "data-editable": String(Boolean(props.isEditable)),
        "data-deleteable": String(props.isDeleteable),
      });
    },
  };
});

import SettingsSCIM from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SCIM";
import StatusPageViewSCIM from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SCIM";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  DASHBOARD_ENTERPRISE_PLUGIN_KEYS,
  DashboardEnterprisePluginKey,
} from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePlugins";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";

interface ShellCase {
  name: string;
  Shell: FunctionComponent<PageComponentProps>;
  pluginKey: DashboardEnterprisePluginKey;
  // The upsell copy the page showed before it moved to ee/.
  upsellTitle: string;
  featureName: string;
  // Below Scale: the connections the page still has, and their table.
  leftoverModel: string;
  leftoverTable: string;
}

const SHELLS: Array<ShellCase> = [
  {
    name: "Settings > SCIM",
    Shell: SettingsSCIM,
    pluginKey: "SettingsSCIM",
    upsellTitle: "SCIM User Provisioning",
    featureName: "SCIM User Provisioning",
    leftoverModel: "ProjectSCIM",
    leftoverTable: "plan-leftover-project-scim-connections",
  },
  {
    name: "Status page > SCIM",
    Shell: StatusPageViewSCIM,
    pluginKey: "StatusPageSCIM",
    upsellTitle: "Status Page SCIM",
    featureName: "Status Page SCIM Provisioning",
    leftoverModel: "StatusPageSCIM",
    leftoverTable: "plan-leftover-status-page-scim-connections",
  },
];

/*
 * The keys that served the single sign-on screens from ee/ before they
 * became core. Nothing reads them any more; an old Enterprise bundle that
 * still carried them must not open a SCIM screen either.
 */
const RETIRED_SSO_PLUGIN_KEYS: Array<string> = [
  "SettingsSSO",
  "SettingsOIDC",
  "StatusPageSSO",
  "StatusPageOIDC",
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

const installPlugins: (keys: Array<string>) => void = (
  keys: Array<string>,
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
  currentPlanThrows = false;
  mockLeftovers.count = 0;
  mockLeftovers.countedModels = [];
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

  test("OneUptime Cloud below Scale: the connections it still has are listed under the upsell, to delete", async () => {
    billingEnabledForTest = true;
    enterpriseEditionForTest = true;
    currentPlanForTest = PlanType.Free;
    mockLeftovers.count = 1;
    installPlugins([shell.pluginKey]);

    await act(async () => {
      render(<shell.Shell {...PAGE_PROPS} />);
    });

    expect(mockLeftovers.countedModels).toEqual([shell.leftoverModel]);

    const table: HTMLElement = await screen.findByTestId(
      `model-table-${shell.leftoverTable}`,
    );

    expect(table).toHaveAttribute("data-createable", "false");
    expect(table).toHaveAttribute("data-editable", "false");
    expect(table).toHaveAttribute("data-deleteable", "true");
    expect(screen.getAllByText("Upgrade to Scale").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("enterprise-screen")).not.toBeInTheDocument();
  });

  test("on the plan, self-hosted, or with no plan known, nothing is counted for the connections", async () => {
    installPlugins([shell.pluginKey]);
    mockLeftovers.count = 1;

    for (const state of [
      { billing: false, edition: true, plan: null },
      { billing: false, edition: false, plan: null },
      { billing: true, edition: true, plan: PlanType.Scale },
      { billing: true, edition: true, plan: null },
    ]) {
      billingEnabledForTest = state.billing;
      enterpriseEditionForTest = state.edition;
      currentPlanForTest = state.plan;

      await act(async () => {
        render(<shell.Shell {...PAGE_PROPS} />);
      });

      cleanup();
    }

    expect(mockLeftovers.countedModels).toEqual([]);
  });

  test("OneUptime Cloud with no plan, or one the Dashboard cannot read: the plan upsell (fails closed)", () => {
    billingEnabledForTest = true;
    enterpriseEditionForTest = true;
    installPlugins([shell.pluginKey]);

    const { unmount } = render(<shell.Shell {...PAGE_PROPS} />);

    expect(screen.getAllByText("Upgrade to Scale").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("enterprise-screen")).not.toBeInTheDocument();
    unmount();

    currentPlanThrows = true;

    render(<shell.Shell {...PAGE_PROPS} />);

    expect(screen.getAllByText("Upgrade to Scale").length).toBeGreaterThan(0);
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

  test("ignores other features' screens, the retired single sign-on keys included", () => {
    enterpriseEditionForTest = true;
    installPlugins([
      ...SHELLS.map((each: ShellCase) => {
        return each.pluginKey;
      }).filter((key: DashboardEnterprisePluginKey) => {
        return key !== shell.pluginKey;
      }),
      ...RETIRED_SSO_PLUGIN_KEYS,
    ]);

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

  test("the plugin contract has keys for the SCIM screens, and none for single sign-on", () => {
    for (const shell of SHELLS) {
      expect(DASHBOARD_ENTERPRISE_PLUGIN_KEYS).toContain(shell.pluginKey);
    }

    for (const retiredKey of RETIRED_SSO_PLUGIN_KEYS) {
      expect(
        DASHBOARD_ENTERPRISE_PLUGIN_KEYS as ReadonlyArray<string>,
      ).not.toContain(retiredKey);
    }
  });
});
