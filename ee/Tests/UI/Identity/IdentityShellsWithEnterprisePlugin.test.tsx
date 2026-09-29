import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The whole chain as the Enterprise image builds it: a core shell at the old
 * page path -> src/Enterprise/Plugins.ts -> "@oneuptime/ee-dashboard" (here
 * the REAL ee/Dashboard/Index, as in the Enterprise bundle) -> the lazy SSO
 * plugin -> the moved Enterprise screen. And the same for the Admin
 * Dashboard. On the Enterprise Edition the shell shows the Enterprise screen;
 * on the Community Edition it shows its upsell and never loads the screen.
 *
 * The model tables are stand-ins; billing, the edition and the license
 * request are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */

let enterpriseEditionForTest: boolean = false;

jest.mock("Common/UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return enterpriseEditionForTest;
    },
  });

  return mocked;
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: async (): Promise<unknown> => {
        return {
          isSuccess: (): boolean => {
            return true;
          },
          data: { status: "valid", licenseValid: true },
        };
      },
      getFriendlyMessage: (): string => {
        return "";
      },
    },
  };
});

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { id: string }): ReactElement => {
      return <div data-testid={`model-table-${props.id}`} />;
    },
  };
});

jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div />;
    },
  };
});

jest.mock("Common/UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
      return <div data-testid="page">{props.children}</div>;
    },
  };
});

jest.mock("@oneuptime/admin-dashboard/Pages/Settings/SideMenu", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <nav />;
    },
  };
});

import SettingsSSOShell from "@oneuptime/dashboard/Pages/Settings/SSO";
import StatusPageSCIMShell from "@oneuptime/dashboard/Pages/StatusPages/View/SCIM";
import GlobalSSOListShell from "@oneuptime/admin-dashboard/Pages/Settings/GlobalSSO/Index";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(
    "/dashboard/11111111-1111-4111-8111-111111111111/settings/sso",
  ),
  currentProject: null,
  hasPaymentMethod: true,
};

const setPath: (path: string) => void = (path: string): void => {
  window.history.pushState({}, "", path);
  Navigation.setLocation(window.location as unknown as never);
};

beforeEach(() => {
  enterpriseEditionForTest = false;
});

afterEach(() => {
  cleanup();
});

describe("core identity shells with the real Enterprise plugin", () => {
  test("Settings > SSO opens the Enterprise screen on the Enterprise Edition", async () => {
    enterpriseEditionForTest = true;
    setPath(PAGE_PROPS.pageRoute.toString());

    render(<SettingsSSOShell {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("model-table-sso-table"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Learn about Enterprise Edition"),
    ).not.toBeInTheDocument();
  });

  test("Status page > SCIM opens the Enterprise screen on the Enterprise Edition", async () => {
    enterpriseEditionForTest = true;
    setPath(
      "/dashboard/11111111-1111-4111-8111-111111111111/status-pages/22222222-2222-4222-8222-222222222222/scim",
    );

    render(<StatusPageSCIMShell {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("model-table-status-page-scim-table"),
    ).toBeInTheDocument();
  });

  test("Settings > SSO shows the upsell on the Community Edition, even in the Enterprise bundle", () => {
    render(<SettingsSSOShell {...PAGE_PROPS} />);

    expect(screen.getAllByText("SAML Single Sign On").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByTestId("model-table-sso-table"),
    ).not.toBeInTheDocument();
  });

  test("Admin > Global SSO opens the Enterprise screen on the Enterprise Edition", async () => {
    enterpriseEditionForTest = true;
    setPath("/admin/settings/global-sso");

    const Shell: FunctionComponent = GlobalSSOListShell;

    render(<Shell />);

    expect(
      await screen.findByTestId("model-table-global-sso-table"),
    ).toBeInTheDocument();
  });

  test("Admin > Global SSO shows the upsell on the Community Edition", () => {
    setPath("/admin/settings/global-sso");

    render(<GlobalSSOListShell />);

    expect(
      screen.getByText(
        "Instance-wide SAML 2.0 identity providers that can be connected to any project on this OneUptime server.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("model-table-global-sso-table"),
    ).not.toBeInTheDocument();
  });
});
