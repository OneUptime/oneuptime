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
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * Settings > Global SSO and Global OIDC (the provider lists and one
 * provider's page) are Enterprise Edition screens
 * (ee/AdminDashboard/GlobalSSO). Core keeps a shell at each page's original
 * path, so App.tsx and its routes never changed: the shell renders the
 * Enterprise screen on the Enterprise Edition when the bundle includes it,
 * and otherwise the upsell card the page used to show, inside the settings
 * layout.
 *
 * "@oneuptime/ee-admin-dashboard" is replaced by a plugin object the tests
 * fill in, standing in for the Enterprise bundle; left empty it is the
 * Community bundle. Billing and the edition are pinned in every test: CI's
 * config.env sets BILLING_ENABLED=true, and the admin rule must not depend
 * on it. The page chrome (Page, the settings side menu) is replaced by a
 * plain wrapper that shows the side menu and breadcrumbs.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;

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

  return mocked;
});

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: {
      title?: string;
      breadcrumbLinks?: Array<{ title: string }>;
      sideMenu?: ReactNode;
      children?: ReactNode;
    }): ReactElement => {
      return (
        <div data-testid="settings-page">
          {props.sideMenu}
          <div data-testid="settings-page-breadcrumbs">
            {(props.breadcrumbLinks || [])
              .map((link: { title: string }) => {
                return link.title;
              })
              .join(" > ")}
          </div>
          {props.children}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <nav data-testid="settings-side-menu" />;
      },
    };
  },
);

/*
 * What getAdminDashboardPlugins() returns in this suite. The shells read it
 * on every render, so each test fills it in after the shells were imported.
 */
const mockAdminEnterprisePlugins: Record<string, unknown> = {};

jest.mock("@oneuptime/ee-admin-dashboard", () => {
  return { __esModule: true, default: mockAdminEnterprisePlugins };
});

import SettingsGlobalOIDC from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalOIDC/Index";
import SettingsGlobalOIDCView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalOIDC/View";
import SettingsGlobalSSO from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalSSO/Index";
import SettingsGlobalSSOView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalSSO/View";
import { AdminDashboardEnterprisePluginKey } from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/EnterprisePlugins";

interface ShellCase {
  name: string;
  Shell: FunctionComponent;
  pluginKey: AdminDashboardEnterprisePluginKey;
  // The upsell copy (and breadcrumb) the page showed before it moved to ee/.
  provider: "Global SSO" | "Global OIDC";
  upsellDescription: string;
}

const GLOBAL_SSO_DESCRIPTION: string =
  "Instance-wide SAML 2.0 identity providers that can be connected to any project on this OneUptime server.";
const GLOBAL_OIDC_DESCRIPTION: string =
  "Instance-wide OpenID Connect identity providers that can be connected to any project on this OneUptime server.";

const SHELLS: Array<ShellCase> = [
  {
    name: "Global SSO list",
    Shell: SettingsGlobalSSO,
    pluginKey: "GlobalSSOList",
    provider: "Global SSO",
    upsellDescription: GLOBAL_SSO_DESCRIPTION,
  },
  {
    name: "Global SSO provider",
    Shell: SettingsGlobalSSOView,
    pluginKey: "GlobalSSOView",
    provider: "Global SSO",
    upsellDescription: GLOBAL_SSO_DESCRIPTION,
  },
  {
    name: "Global OIDC list",
    Shell: SettingsGlobalOIDC,
    pluginKey: "GlobalOIDCList",
    provider: "Global OIDC",
    upsellDescription: GLOBAL_OIDC_DESCRIPTION,
  },
  {
    name: "Global OIDC provider",
    Shell: SettingsGlobalOIDCView,
    pluginKey: "GlobalOIDCView",
    provider: "Global OIDC",
    upsellDescription: GLOBAL_OIDC_DESCRIPTION,
  },
];

const makeFakeScreen: (pluginKey: string) => FunctionComponent = (
  pluginKey: string,
): FunctionComponent => {
  const FakeScreen: FunctionComponent = (): ReactElement => {
    return <div data-testid="enterprise-screen">{pluginKey}</div>;
  };

  return FakeScreen;
};

const installPlugins: (
  keys: Array<AdminDashboardEnterprisePluginKey>,
) => void = (keys: Array<AdminDashboardEnterprisePluginKey>): void => {
  for (const key of keys) {
    mockAdminEnterprisePlugins[key] = makeFakeScreen(key);
  }
};

const clearPlugins: () => void = (): void => {
  for (const key of Object.keys(mockAdminEnterprisePlugins)) {
    delete mockAdminEnterprisePlugins[key];
  }
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  clearPlugins();
});

afterEach(() => {
  cleanup();
  clearPlugins();
});

describe.each(SHELLS)("$name shell", (shell: ShellCase) => {
  test.each([false, true])(
    "Community Edition (billing=%s): the upsell inside the settings layout, even when a plugin is present",
    (billing: boolean) => {
      billingEnabledForTest = billing;
      installPlugins([shell.pluginKey]);

      render(<shell.Shell />);

      expect(screen.getByTestId("settings-page")).toBeInTheDocument();
      expect(screen.getByTestId("settings-side-menu")).toBeInTheDocument();
      expect(screen.getByTestId("settings-page-breadcrumbs")).toHaveTextContent(
        shell.provider,
      );
      expect(screen.getByText(shell.upsellDescription)).toBeInTheDocument();
      expect(
        screen.getAllByText("Learn about Enterprise Edition").length,
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId("enterprise-screen")).not.toBeInTheDocument();
    },
  );

  test.each([false, true])(
    "Enterprise Edition (billing=%s): the Enterprise screen, on its own",
    (billing: boolean) => {
      billingEnabledForTest = billing;
      enterpriseEditionForTest = true;
      installPlugins([shell.pluginKey]);

      render(<shell.Shell />);

      expect(screen.getByTestId("enterprise-screen")).toHaveTextContent(
        shell.pluginKey,
      );
      // The Enterprise screen brings its own layout.
      expect(screen.queryByTestId("settings-page")).not.toBeInTheDocument();
      expect(
        screen.queryByText(shell.upsellDescription),
      ).not.toBeInTheDocument();
    },
  );

  test("Enterprise Edition on a Community bundle: the upsell", () => {
    enterpriseEditionForTest = true;

    render(<shell.Shell />);

    expect(screen.getByText(shell.upsellDescription)).toBeInTheDocument();
    expect(screen.queryByTestId("enterprise-screen")).not.toBeInTheDocument();
  });

  test("renders its own plugin key when every Global SSO screen is present", () => {
    enterpriseEditionForTest = true;
    installPlugins(
      SHELLS.map((each: ShellCase) => {
        return each.pluginKey;
      }),
    );

    render(<shell.Shell />);

    expect(screen.getByTestId("enterprise-screen")).toHaveTextContent(
      shell.pluginKey,
    );
    expect(screen.getAllByTestId("enterprise-screen")).toHaveLength(1);
  });

  test("ignores the other Global SSO screens", () => {
    enterpriseEditionForTest = true;
    installPlugins(
      SHELLS.map((each: ShellCase) => {
        return each.pluginKey;
      }).filter((key: AdminDashboardEnterprisePluginKey) => {
        return key !== shell.pluginKey;
      }),
    );

    render(<shell.Shell />);

    expect(screen.queryByTestId("enterprise-screen")).not.toBeInTheDocument();
    expect(screen.getByText(shell.upsellDescription)).toBeInTheDocument();
  });
});
