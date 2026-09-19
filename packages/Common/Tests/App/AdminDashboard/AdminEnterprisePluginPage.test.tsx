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
 * The Admin Dashboard's Enterprise plugin door and the component every
 * enterprise admin shell renders.
 *
 * The admin dashboard has no project and no plan: a screen is shown when this
 * is the Enterprise Edition (the effective edition the server writes into
 * env.js) AND this bundle includes the plugin, and the upsell card otherwise.
 * A shell with its own rule - the license server pages exist on OneUptime
 * Cloud only - passes isEligible.
 *
 * Billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true, and the admin rule must not depend on it.
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

import EnterprisePluginPage from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/Plugins";
import {
  ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS,
  AdminDashboardEnterprisePlugins,
  EnterprisePluginComponent,
} from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/EnterprisePlugins";
import IconProp from "../../../Types/Icon/IconProp";

const UPSELL: {
  title: string;
  description: string;
  featureName: string;
  benefits: Array<{ icon: IconProp; title: string; subtitle: string }>;
} = {
  title: "Global SSO",
  description: "Instance-wide SAML providers.",
  featureName: "Global SAML Single Sign On",
  benefits: [
    {
      icon: IconProp.Lock,
      title: "One sign-in for every project",
      subtitle: "Point every project at your IdP once.",
    },
  ],
};

const FakeGlobalSSOList: FunctionComponent = (): ReactElement => {
  return <div data-testid="fake-global-sso" />;
};

let lazyLoads: number = 0;
let releaseLazyPlugin: (() => void) | null = null;

const makeLazyPlugin: (
  holdUntilReleased: boolean,
) => EnterprisePluginComponent = (
  holdUntilReleased: boolean,
): EnterprisePluginComponent => {
  return React.lazy(async (): Promise<{ default: FunctionComponent }> => {
    lazyLoads += 1;

    if (holdUntilReleased) {
      await new Promise<void>((resolve: () => void) => {
        releaseLazyPlugin = resolve;
      });
    }

    return { default: FakeGlobalSSOList };
  });
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  lazyLoads = 0;
  releaseLazyPlugin = null;
});

afterEach(() => {
  cleanup();
});

describe("EnterprisePluginPage (Admin Dashboard)", () => {
  test.each([
    ["self-hosted", false],
    ["OneUptime Cloud", true],
  ])(
    "renders the plugin on the Enterprise Edition (%s)",
    (_label: string, billingEnabled: boolean) => {
      billingEnabledForTest = billingEnabled;
      enterpriseEditionForTest = true;

      render(
        <EnterprisePluginPage plugin={FakeGlobalSSOList} upsell={UPSELL} />,
      );

      expect(screen.getByTestId("fake-global-sso")).toBeInTheDocument();
      expect(
        screen.queryByText("Global SAML Single Sign On"),
      ).not.toBeInTheDocument();
    },
  );

  test.each([
    ["self-hosted", false],
    ["OneUptime Cloud", true],
  ])(
    "shows the edition upsell on the Community Edition, and never downloads the plugin (%s)",
    (_label: string, billingEnabled: boolean) => {
      billingEnabledForTest = billingEnabled;
      enterpriseEditionForTest = false;

      render(
        <EnterprisePluginPage plugin={makeLazyPlugin(false)} upsell={UPSELL} />,
      );

      expect(
        screen.getByText("Global SAML Single Sign On"),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText("Learn about Enterprise Edition"),
      ).toHaveLength(2);
      expect(screen.queryByTestId("fake-global-sso")).not.toBeInTheDocument();
      expect(lazyLoads).toBe(0);
    },
  );

  test("shows the upsell on the Enterprise Edition when the bundle has no plugin", () => {
    enterpriseEditionForTest = true;

    render(<EnterprisePluginPage plugin={undefined} upsell={UPSELL} />);

    expect(screen.getByText("Global SAML Single Sign On")).toBeInTheDocument();
  });

  test("a lazy plugin shows the in-card loader, then the plugin", async () => {
    enterpriseEditionForTest = true;

    render(
      <EnterprisePluginPage plugin={makeLazyPlugin(true)} upsell={UPSELL} />,
    );

    expect(await screen.findByTestId("component-loader")).toBeInTheDocument();

    await act(async () => {
      releaseLazyPlugin?.();
    });

    expect(await screen.findByTestId("fake-global-sso")).toBeInTheDocument();
    expect(lazyLoads).toBe(1);
  });

  test("uses a caller's loading element while the plugin downloads", async () => {
    enterpriseEditionForTest = true;

    render(
      <EnterprisePluginPage
        plugin={makeLazyPlugin(true)}
        upsell={UPSELL}
        loadingElement={<div data-testid="custom-loading" />}
      />,
    );

    expect(await screen.findByTestId("custom-loading")).toBeInTheDocument();

    await act(async () => {
      releaseLazyPlugin?.();
    });

    expect(await screen.findByTestId("fake-global-sso")).toBeInTheDocument();
  });

  test("isEligible overrides the edition, both ways", () => {
    // A Cloud-only screen on a self-hosted Enterprise install stays hidden.
    enterpriseEditionForTest = true;
    const { unmount } = render(
      <EnterprisePluginPage
        plugin={FakeGlobalSSOList}
        upsell={UPSELL}
        isEligible={false}
      />,
    );
    expect(screen.queryByTestId("fake-global-sso")).not.toBeInTheDocument();
    unmount();

    enterpriseEditionForTest = false;
    render(
      <EnterprisePluginPage
        plugin={FakeGlobalSSOList}
        upsell={UPSELL}
        isEligible={true}
      />,
    );
    expect(screen.getByTestId("fake-global-sso")).toBeInTheDocument();
  });

  test("renderUpsell replaces the shared card", () => {
    enterpriseEditionForTest = false;

    render(
      <EnterprisePluginPage
        plugin={FakeGlobalSSOList}
        renderUpsell={(): ReactElement => {
          return <div data-testid="health-upsell">Health upsell</div>;
        }}
      />,
    );

    expect(screen.getByTestId("health-upsell")).toBeInTheDocument();
    expect(
      screen.queryByText("Learn about Enterprise Edition"),
    ).not.toBeInTheDocument();
  });
});

describe("the Community admin plugin door (what this jest config resolves)", () => {
  test("getAdminDashboardPlugins() is the empty Community stub", () => {
    const plugins: AdminDashboardEnterprisePlugins = getAdminDashboardPlugins();

    expect(plugins).toEqual({});
    expect(plugins.buildMarker).toBeUndefined();

    for (const key of ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS) {
      expect([key, plugins[key]]).toEqual([key, undefined]);
    }
  });

  test("names every screen a plugin can provide, once", () => {
    expect([...ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS].sort()).toEqual(
      [
        "EnterpriseLicenseView",
        "EnterpriseLicensesList",
        "GlobalOIDCList",
        "GlobalOIDCView",
        "GlobalSSOList",
        "GlobalSSOView",
        "HealthClickhouseCluster",
        "HealthInstanceLogs",
        "HealthLogs",
        "HealthOverview",
        "HealthPostgres",
        "HealthQueryConsole",
        "HealthQueues",
        "HealthRedis",
        "HealthTelemetry",
      ].sort(),
    );
    expect(new Set(ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS).size).toBe(
      ADMIN_DASHBOARD_ENTERPRISE_PLUGIN_KEYS.length,
    );
  });

  test("a shell reading the real door on a Community build shows the upsell even on the Enterprise Edition", () => {
    enterpriseEditionForTest = true;

    render(
      <EnterprisePluginPage
        plugin={getAdminDashboardPlugins().GlobalSSOList}
        upsell={UPSELL}
      />,
    );

    expect(screen.getByText("Global SAML Single Sign On")).toBeInTheDocument();
  });
});

describe("the admin plugin door with other plugin modules", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock("@oneuptime/ee-admin-dashboard");
    jest.resetModules();
  });

  test("hands back the Enterprise plugin object as is", async () => {
    const enterprisePlugins: AdminDashboardEnterprisePlugins = {
      buildMarker: "ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1",
      GlobalSSOList: FakeGlobalSSOList,
    };

    jest.doMock("@oneuptime/ee-admin-dashboard", () => {
      return { __esModule: true, default: enterprisePlugins };
    });

    const door: {
      getAdminDashboardPlugins: () => AdminDashboardEnterprisePlugins;
    } = await import(
      "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/Plugins"
    );

    expect(door.getAdminDashboardPlugins()).toBe(enterprisePlugins);
  });

  test("fails loudly, naming the rule, when read before the plugin module finished loading", async () => {
    jest.doMock("@oneuptime/ee-admin-dashboard", () => {
      return { __esModule: true, default: undefined };
    });

    const door: {
      getAdminDashboardPlugins: () => AdminDashboardEnterprisePlugins;
    } = await import(
      "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/Plugins"
    );

    expect(() => {
      return door.getAdminDashboardPlugins();
    }).toThrow(
      "getAdminDashboardPlugins() ran before the Enterprise plugin module finished loading. Call it inside a render or function body, never at module top level.",
    );
  });
});
