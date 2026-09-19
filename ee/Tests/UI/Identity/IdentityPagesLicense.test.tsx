import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The ten Enterprise identity screens (six in the Dashboard, four in the
 * Admin Dashboard) against the license state.
 *
 * Without a valid license, after the trial or the grace period, the server
 * refuses to create or change SSO / OIDC / SCIM configuration (402, master
 * admins included), and SSO sign-in and SCIM provisioning stop until a
 * license is activated; reads and deletes keep working. The screens say so
 * and stop offering what would fail: the read-only banner (which says that
 * sign-in and SCIM are off - EnterpriseLicenseBanner.test.tsx pins its copy),
 * no "create" or "edit" on the provider table - but "delete" stays, and so
 * does "Reset Bearer Token", which the server accepts without a license (it
 * only tightens security; ReadOnlyIncidentActions.test.tsx covers it and
 * "Disable" in depth). In the grace period they warn and stay editable; with
 * a valid license, on OneUptime Cloud, or when the license cannot be read,
 * they are exactly what they were before.
 *
 * The model tables and detail cards are replaced by stand-ins that print the
 * props that matter, and the license request is answered per test. Billing
 * is pinned in every test: CI's config.env sets BILLING_ENABLED=true.
 */

let billingEnabledForTest: boolean = false;

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

const mockLicenseFetch: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (...args: Array<unknown>): unknown => {
        return mockLicenseFetch(...args);
      },
      getFriendlyMessage: (): string => {
        return "";
      },
    },
  };
});

interface MockActionButton {
  title: string;
  isVisible?: ((item: unknown) => boolean | undefined) | undefined;
}

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      id: string;
      isCreateable?: boolean;
      isEditable?: boolean;
      isDeleteable?: boolean;
      actionButtons?: Array<MockActionButton>;
    }): ReactElement => {
      const visibleActions: Array<string> = (props.actionButtons || [])
        .filter((button: MockActionButton) => {
          return !button.isVisible || button.isVisible({}) !== false;
        })
        .map((button: MockActionButton) => {
          return button.title;
        });

      return (
        <div
          data-testid={`model-table-${props.id}`}
          data-createable={String(Boolean(props.isCreateable))}
          data-editable={String(Boolean(props.isEditable))}
          data-deleteable={String(Boolean(props.isDeleteable))}
          data-actions={visibleActions.join("|")}
        />
      );
    },
  };
});

jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { name: string; isEditable?: boolean }): ReactElement => {
      return (
        <div
          data-testid={`card-model-detail-${props.name}`}
          data-editable={String(Boolean(props.isEditable))}
        />
      );
    },
  };
});

jest.mock("Common/UI/Components/Tabs/Tabs", () => {
  return {
    __esModule: true,
    default: (props: {
      tabs: Array<{ name: string; children: ReactNode }>;
    }): ReactElement => {
      return (
        <div>
          {props.tabs.map((tab: { name: string; children: ReactNode }) => {
            return <section key={tab.name}>{tab.children}</section>;
          })}
        </div>
      );
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

jest.mock("Common/UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
      return <div data-testid="model-page">{props.children}</div>;
    },
  };
});

jest.mock("Common/UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="model-delete" />;
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

import SettingsSSOPage from "../../../Dashboard/SSO/Pages/Settings/SSO";
import SettingsOIDCPage from "../../../Dashboard/SSO/Pages/Settings/OIDC";
import SettingsSCIMPage from "../../../Dashboard/SSO/Pages/Settings/SCIM";
import StatusPageSSOPage from "../../../Dashboard/SSO/Pages/StatusPages/SSO";
import StatusPageOIDCPage from "../../../Dashboard/SSO/Pages/StatusPages/OIDC";
import StatusPageSCIMPage from "../../../Dashboard/SSO/Pages/StatusPages/SCIM";
import GlobalSSOListPage from "../../../AdminDashboard/GlobalSSO/Pages/GlobalSSO/Index";
import GlobalSSOViewPage from "../../../AdminDashboard/GlobalSSO/Pages/GlobalSSO/View";
import GlobalOIDCListPage from "../../../AdminDashboard/GlobalSSO/Pages/GlobalOIDC/Index";
import GlobalOIDCViewPage from "../../../AdminDashboard/GlobalSSO/Pages/GlobalOIDC/View";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import Navigation from "Common/UI/Utils/Navigation";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/settings/sso`),
  currentProject: null,
  hasPaymentMethod: true,
};

interface ScreenCase {
  name: string;
  render: () => ReactElement;
  path: string;
  // The provider table: create and edit follow the license, delete never does.
  providerTable: string;
  providerTableEditable: boolean;
  // Delete is never license-gated; this is what the table offered before.
  providerTableDeleteable: boolean;
  // A detail card on the SAME provider model, edited in place.
  providerCard?: string | undefined;
  // Card on a core model (Project / StatusPage): always editable.
  coreCard?: string | undefined;
  hasTokenReset: boolean;
}

const renderDashboardPage: (
  Page: FunctionComponent<PageComponentProps>,
) => () => ReactElement = (
  Page: FunctionComponent<PageComponentProps>,
): (() => ReactElement) => {
  // eslint-disable-next-line react/display-name
  return (): ReactElement => {
    return <Page {...PAGE_PROPS} />;
  };
};

const renderAdminPage: (Page: FunctionComponent) => () => ReactElement = (
  Page: FunctionComponent,
): (() => ReactElement) => {
  // eslint-disable-next-line react/display-name
  return (): ReactElement => {
    return <Page />;
  };
};

const SCREENS: Array<ScreenCase> = [
  {
    name: "Settings > SSO",
    render: renderDashboardPage(SettingsSSOPage),
    path: `/dashboard/${PROJECT_ID}/settings/sso`,
    providerTable: "sso-table",
    providerTableEditable: true,
    providerTableDeleteable: true,
    coreCard: "SSO Settings",
    hasTokenReset: false,
  },
  {
    name: "Settings > OIDC",
    render: renderDashboardPage(SettingsOIDCPage),
    path: `/dashboard/${PROJECT_ID}/settings/oidc`,
    providerTable: "oidc-table",
    providerTableEditable: true,
    providerTableDeleteable: true,
    hasTokenReset: false,
  },
  {
    name: "Settings > SCIM",
    render: renderDashboardPage(SettingsSCIMPage),
    path: `/dashboard/${PROJECT_ID}/settings/scim`,
    providerTable: "scim-table",
    providerTableEditable: true,
    providerTableDeleteable: true,
    hasTokenReset: true,
  },
  {
    name: "Status page > SSO",
    render: renderDashboardPage(StatusPageSSOPage),
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/sso`,
    providerTable: "sso-table",
    providerTableEditable: true,
    providerTableDeleteable: true,
    coreCard: "SSO Settings",
    hasTokenReset: false,
  },
  {
    name: "Status page > OIDC",
    render: renderDashboardPage(StatusPageOIDCPage),
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/oidc`,
    providerTable: "oidc-table",
    providerTableEditable: true,
    providerTableDeleteable: true,
    hasTokenReset: false,
  },
  {
    name: "Status page > SCIM",
    render: renderDashboardPage(StatusPageSCIMPage),
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/scim`,
    providerTable: "status-page-scim-table",
    providerTableEditable: true,
    providerTableDeleteable: true,
    hasTokenReset: true,
  },
  {
    name: "Admin > Global SSO",
    render: renderAdminPage(GlobalSSOListPage),
    path: "/admin/settings/global-sso",
    providerTable: "global-sso-table",
    // The list was never editable in place: providers are edited on their page.
    providerTableEditable: false,
    providerTableDeleteable: false,
    hasTokenReset: false,
  },
  {
    name: "Admin > Global SSO > provider",
    render: renderAdminPage(GlobalSSOViewPage),
    path: `/admin/settings/global-sso/${PROVIDER_ID}`,
    providerTable: "global-sso-project-table",
    providerTableEditable: false,
    providerTableDeleteable: true,
    providerCard: "Global SSO Configuration",
    hasTokenReset: false,
  },
  {
    name: "Admin > Global OIDC",
    render: renderAdminPage(GlobalOIDCListPage),
    path: "/admin/settings/global-oidc",
    providerTable: "global-oidc-table",
    providerTableEditable: false,
    providerTableDeleteable: false,
    hasTokenReset: false,
  },
  {
    name: "Admin > Global OIDC > provider",
    render: renderAdminPage(GlobalOIDCViewPage),
    path: `/admin/settings/global-oidc/${PROVIDER_ID}`,
    providerTable: "global-oidc-project-table",
    providerTableEditable: false,
    providerTableDeleteable: true,
    providerCard: "Global OIDC Configuration",
    hasTokenReset: false,
  },
];

const answerLicense: (payload: JSONObject) => void = (
  payload: JSONObject,
): void => {
  mockLicenseFetch.mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
    data: payload,
  });
};

const renderScreen: (screenCase: ScreenCase) => Promise<void> = async (
  screenCase: ScreenCase,
): Promise<void> => {
  window.history.pushState({}, "", screenCase.path);
  Navigation.setLocation(window.location as unknown as never);

  render(screenCase.render());

  // Let the license request settle before asserting on what it decided.
  if (!billingEnabledForTest) {
    await waitFor(() => {
      expect(mockLicenseFetch).toHaveBeenCalled();
    });
  }

  await act(async () => {
    await Promise.resolve();
  });
};

const providerTable: (screenCase: ScreenCase) => HTMLElement = (
  screenCase: ScreenCase,
): HTMLElement => {
  return screen.getByTestId(`model-table-${screenCase.providerTable}`);
};

beforeEach(() => {
  billingEnabledForTest = false;
  mockLicenseFetch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe.each(SCREENS)("$name", (screenCase: ScreenCase) => {
  test("license required (expired, after the grace period): read-only banner, no create or edit, delete stays", async () => {
    answerLicense({ status: "expired", licenseValid: false });

    await renderScreen(screenCase);

    /*
     * Every identity screen says that sign-in and SCIM are off, not only that
     * nothing can change - SSO, SCIM and audit logging stop with the license.
     */
    expect(
      screen.getByTestId("enterprise-license-read-only-banner"),
    ).toHaveTextContent("single sign-on and SCIM are off");
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-createable",
      "false",
    );
    expect(providerTable(screenCase)).toHaveAttribute("data-editable", "false");
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-deleteable",
      String(screenCase.providerTableDeleteable),
    );

    if (screenCase.providerCard) {
      expect(
        screen.getByTestId(`card-model-detail-${screenCase.providerCard}`),
      ).toHaveAttribute("data-editable", "false");
    }

    if (screenCase.coreCard) {
      // "Force SSO for login" lives on the core Project / StatusPage model.
      expect(
        screen.getByTestId(`card-model-detail-${screenCase.coreCard}`),
      ).toHaveAttribute("data-editable", "true");
    }

    /*
     * Replacing a leaked SCIM bearer token is a tighten-only update the
     * server accepts without a license, so the reset stays on offer.
     */
    if (screenCase.hasTokenReset) {
      expect(providerTable(screenCase).getAttribute("data-actions")).toContain(
        "Reset Bearer Token",
      );
    }

    // And the screen says which changes are still possible, and why.
    expect(
      screen.getByTestId("enterprise-read-only-actions-notice"),
    ).toBeInTheDocument();
  });

  test.each([
    ["missing", { status: "missing" }],
    ["invalid", { status: "invalid" }],
    [
      "licenseValid=false from a server without a status",
      { licenseValid: false },
    ],
  ])("license %s: read-only", async (_name: string, payload: JSONObject) => {
    answerLicense(payload);

    await renderScreen(screenCase);

    expect(
      screen.getByTestId("enterprise-license-read-only-banner"),
    ).toBeInTheDocument();
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-createable",
      "false",
    );
  });

  test("grace period: a warning, and everything stays editable", async () => {
    answerLicense({ status: "grace", licenseValid: true });

    await renderScreen(screenCase);

    // The warning says what stops when the trial or grace period ends.
    expect(
      screen.getByTestId("enterprise-license-grace-banner"),
    ).toHaveTextContent(
      "single sign-on and SCIM stop when the trial or grace period ends",
    );
    expect(
      screen.queryByTestId("enterprise-license-read-only-banner"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-read-only-actions-notice"),
    ).not.toBeInTheDocument();
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-createable",
      "true",
    );
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-editable",
      String(screenCase.providerTableEditable),
    );

    if (screenCase.hasTokenReset) {
      expect(providerTable(screenCase).getAttribute("data-actions")).toContain(
        "Reset Bearer Token",
      );
    }
  });

  test("valid license: no banner, unchanged screen", async () => {
    answerLicense({ status: "valid", licenseValid: true });

    await renderScreen(screenCase);

    expect(
      screen.queryByTestId("enterprise-license-read-only-banner"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-license-grace-banner"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-read-only-actions-notice"),
    ).not.toBeInTheDocument();
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-createable",
      "true",
    );
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-editable",
      String(screenCase.providerTableEditable),
    );
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-deleteable",
      String(screenCase.providerTableDeleteable),
    );

    if (screenCase.providerCard) {
      expect(
        screen.getByTestId(`card-model-detail-${screenCase.providerCard}`),
      ).toHaveAttribute("data-editable", "true");
    }

    if (screenCase.hasTokenReset) {
      expect(providerTable(screenCase).getAttribute("data-actions")).toContain(
        "Reset Bearer Token",
      );
    }
  });

  test("the license cannot be read: nothing is locked", async () => {
    mockLicenseFetch.mockRejectedValue(new Error("network down"));

    await renderScreen(screenCase);

    expect(
      screen.queryByTestId("enterprise-license-read-only-banner"),
    ).not.toBeInTheDocument();
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-createable",
      "true",
    );
  });

  test("OneUptime Cloud (billing on): no license request, nothing is locked", async () => {
    billingEnabledForTest = true;
    answerLicense({ status: "missing", licenseValid: false });

    await renderScreen(screenCase);

    expect(mockLicenseFetch).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("enterprise-license-read-only-banner"),
    ).not.toBeInTheDocument();
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-createable",
      "true",
    );
  });

  test("renders its screen straight away: the upsell and eligibility check live in the core shell", async () => {
    answerLicense({ status: "valid" });

    await renderScreen(screenCase);

    expect(providerTable(screenCase)).toBeInTheDocument();
    expect(
      screen.queryByText("Learn about Enterprise Edition"),
    ).not.toBeInTheDocument();
  });
});
