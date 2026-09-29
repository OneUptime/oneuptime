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
import React, { ReactElement, ReactNode } from "react";

/*
 * The Enterprise half of Settings > Enterprise Licenses: the ee plugin
 * registers both license screens (lazily), the assembled Admin Dashboard
 * plugin carries them, and the core shells - resolved here against the REAL
 * ee plugin, as in the Enterprise image - render them on OneUptime Cloud only.
 *
 * The screens themselves are replaced with markers that count how often their
 * chunk is loaded, so a self-hosted install is shown never to download them.
 */

let billingEnabledForTest: boolean = false;
const mockLoadedScreens: Array<string> = [];

jest.mock("Common/UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("Common/UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children: ReactNode }): ReactElement => {
      return <div data-testid="page">{props.children}</div>;
    },
  };
});

jest.mock("../../../AdminDashboard/EnterpriseLicenses/Pages/Index", () => {
  mockLoadedScreens.push("list");

  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="ee-enterprise-licenses-list" />;
    },
  };
});

jest.mock("../../../AdminDashboard/EnterpriseLicenses/Pages/View/Index", () => {
  mockLoadedScreens.push("view");

  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="ee-enterprise-license-view" />;
    },
  };
});

import EnterpriseLicensesPlugins from "../../../AdminDashboard/EnterpriseLicenses/Plugins";
import AdminDashboardPlugin from "../../../AdminDashboard/Index";
import EnterpriseLicenses from "@oneuptime/admin-dashboard/Pages/EnterpriseLicenses/Index";
import EnterpriseLicenseView from "@oneuptime/admin-dashboard/Pages/EnterpriseLicenses/View/Index";
import { getAdminDashboardPlugins } from "@oneuptime/admin-dashboard/Enterprise/Plugins";

const REACT_LAZY_TYPE: symbol = Symbol.for("react.lazy");

beforeEach(() => {
  billingEnabledForTest = false;
});

afterEach(() => {
  cleanup();
});

describe("the Enterprise Licenses plugin", () => {
  test("provides both license screens, each as its own lazy chunk", () => {
    expect(Object.keys(EnterpriseLicensesPlugins).sort()).toEqual([
      "EnterpriseLicenseView",
      "EnterpriseLicensesList",
    ]);

    for (const screenComponent of Object.values(EnterpriseLicensesPlugins)) {
      expect(
        (screenComponent as unknown as { $$typeof: symbol }).$$typeof,
      ).toBe(REACT_LAZY_TYPE);
    }
  });

  test("is part of the assembled Admin Dashboard plugin", () => {
    expect(AdminDashboardPlugin.EnterpriseLicensesList).toBe(
      EnterpriseLicensesPlugins.EnterpriseLicensesList,
    );
    expect(AdminDashboardPlugin.EnterpriseLicenseView).toBe(
      EnterpriseLicensesPlugins.EnterpriseLicenseView,
    );
  });

  test("is what the Admin Dashboard's plugin door hands the shells in the Enterprise build", () => {
    expect(getAdminDashboardPlugins().EnterpriseLicensesList).toBe(
      EnterpriseLicensesPlugins.EnterpriseLicensesList,
    );
    expect(getAdminDashboardPlugins().EnterpriseLicenseView).toBe(
      EnterpriseLicensesPlugins.EnterpriseLicenseView,
    );
  });
});

describe("the core shells with the Enterprise plugin", () => {
  test("self-hosted Enterprise Edition: the Cloud-only empty state, and neither screen is downloaded", () => {
    render(<EnterpriseLicenses />);
    expect(
      screen.getByText("Only available on OneUptime Cloud"),
    ).toBeInTheDocument();
    cleanup();

    render(<EnterpriseLicenseView />);
    expect(
      screen.getByText("Only available on OneUptime Cloud"),
    ).toBeInTheDocument();

    expect(mockLoadedScreens).toEqual([]);
  });

  test("OneUptime Cloud: the license list from the ee plugin", async () => {
    billingEnabledForTest = true;

    render(<EnterpriseLicenses />);

    expect(
      await screen.findByTestId("ee-enterprise-licenses-list"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Only available on OneUptime Cloud"),
    ).not.toBeInTheDocument();
    expect(mockLoadedScreens).toContain("list");
  });

  test("OneUptime Cloud: one license from the ee plugin", async () => {
    billingEnabledForTest = true;

    render(<EnterpriseLicenseView />);

    expect(
      await screen.findByTestId("ee-enterprise-license-view"),
    ).toBeInTheDocument();
    expect(mockLoadedScreens).toContain("view");
  });
});
