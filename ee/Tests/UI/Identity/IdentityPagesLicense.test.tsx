import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The two Enterprise SCIM screens (project and status page) against the
 * license state.
 *
 * Without a valid license, after the trial or the grace period, the server
 * refuses to create or change SCIM configuration (402, master admins
 * included), and SCIM provisioning stops until a license is activated; reads
 * and deletes keep working. The screens say so and stop offering what would
 * fail: the read-only banner (which says that SCIM is off -
 * EnterpriseLicenseBanner.test.tsx pins its copy), no "create" or "edit" on
 * the configuration table - but "delete" stays, and so does "Reset Bearer
 * Token", which the server accepts without a license (it only tightens
 * security; ReadOnlyIncidentActions.test.tsx covers it in depth). In the
 * grace period they warn and stay editable; with a valid license, on
 * OneUptime Cloud, or when the license cannot be read, they are exactly what
 * they were before.
 *
 * A valid license whose `features` leave SCIM out stops it too: the screen
 * is read-only with a banner that names SCIM (NotIncluded), while a license
 * that includes SCIM leaves the screen unchanged.
 *
 * Single sign-on is not among these screens: its pages are core, and no
 * license state changes them (Common/Tests/App/Dashboard/SsoPages.test.tsx).
 *
 * The model tables are replaced by stand-ins that print the props that
 * matter, and the license request is answered per test. Billing is pinned in
 * every test: CI's config.env sets BILLING_ENABLED=true.
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

import SettingsSCIMPage from "../../../Dashboard/Identity/Pages/Settings/SCIM";
import StatusPageSCIMPage from "../../../Dashboard/Identity/Pages/StatusPages/SCIM";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import Navigation from "Common/UI/Utils/Navigation";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/settings/scim`),
  currentProject: null,
  hasPaymentMethod: true,
};

interface ScreenCase {
  name: string;
  render: () => ReactElement;
  path: string;
  // The configuration table: create and edit follow the license, delete never does.
  providerTable: string;
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

const SCREENS: Array<ScreenCase> = [
  {
    name: "Settings > SCIM",
    render: renderDashboardPage(SettingsSCIMPage),
    path: `/dashboard/${PROJECT_ID}/settings/scim`,
    providerTable: "scim-table",
  },
  {
    name: "Status page > SCIM",
    render: renderDashboardPage(StatusPageSCIMPage),
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/scim`,
    providerTable: "status-page-scim-table",
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

// Everything a SCIM screen shows while its configuration can be changed.
const expectEditable: (screenCase: ScreenCase) => void = (
  screenCase: ScreenCase,
): void => {
  expect(
    screen.queryByTestId("enterprise-license-read-only-banner"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("enterprise-read-only-actions-notice"),
  ).not.toBeInTheDocument();
  expect(providerTable(screenCase)).toHaveAttribute("data-createable", "true");
  expect(providerTable(screenCase)).toHaveAttribute("data-editable", "true");
  expect(providerTable(screenCase)).toHaveAttribute("data-deleteable", "true");
  expect(providerTable(screenCase).getAttribute("data-actions")).toContain(
    "Reset Bearer Token",
  );
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
     * The screen says that SCIM is off, not only that nothing can change -
     * SCIM provisioning stops with the license.
     */
    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-read-only-banner",
    );

    expect(banner).toHaveTextContent("SCIM is off");
    // Single sign-on never stops with the license, so it is not mentioned.
    expect(banner).not.toHaveTextContent(/single sign-on|\bSSO\b/i);
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-createable",
      "false",
    );
    expect(providerTable(screenCase)).toHaveAttribute("data-editable", "false");
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-deleteable",
      "true",
    );

    /*
     * Replacing a leaked SCIM bearer token is a tighten-only update the
     * server accepts without a license, so the reset stays on offer.
     */
    expect(providerTable(screenCase).getAttribute("data-actions")).toContain(
      "Reset Bearer Token",
    );

    // And the screen says which change is still possible, and why.
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
    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-grace-banner",
    );

    expect(banner).toHaveTextContent(
      "SCIM stops when the trial or grace period ends",
    );
    expect(banner).not.toHaveTextContent(/single sign-on|\bSSO\b/i);
    expectEditable(screenCase);
  });

  test("valid license: no banner, unchanged screen", async () => {
    answerLicense({ status: "valid", licenseValid: true });

    await renderScreen(screenCase);

    expect(
      screen.queryByTestId("enterprise-license-grace-banner"),
    ).not.toBeInTheDocument();
    expectEditable(screenCase);
  });

  test("the license cannot be read: nothing is locked", async () => {
    mockLicenseFetch.mockRejectedValue(new Error("network down"));

    await renderScreen(screenCase);

    expectEditable(screenCase);
  });

  test("OneUptime Cloud (billing on): no license request, nothing is locked", async () => {
    billingEnabledForTest = true;
    answerLicense({ status: "missing", licenseValid: false });

    await renderScreen(screenCase);

    expect(mockLicenseFetch).not.toHaveBeenCalled();
    expectEditable(screenCase);
  });

  test("a valid license that leaves SCIM out: SCIM is off and read-only, named in the banner", async () => {
    answerLicense({
      status: "valid",
      licenseValid: true,
      features: ["audit-logs"],
    });

    await renderScreen(screenCase);

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-not-included-banner",
    );

    expect(banner).toHaveTextContent(
      "Your Enterprise license does not include SCIM",
    );
    expect(
      screen.queryByTestId("enterprise-license-read-only-banner"),
    ).not.toBeInTheDocument();
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-createable",
      "false",
    );
    expect(providerTable(screenCase)).toHaveAttribute("data-editable", "false");
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-deleteable",
      "true",
    );
    expect(providerTable(screenCase).getAttribute("data-actions")).toContain(
      "Reset Bearer Token",
    );
    expect(
      screen.getByTestId("enterprise-read-only-actions-notice"),
    ).toBeInTheDocument();
  });

  /*
   * A license from before single sign-on joined every edition may still list
   * "sso": that name grants nothing, and it does not stand in for SCIM.
   */
  test('a valid license that lists only the retired "sso" name and audit logs: SCIM is still left out', async () => {
    answerLicense({
      status: "valid",
      licenseValid: true,
      features: ["sso", "audit-logs"],
    });

    await renderScreen(screenCase);

    expect(
      screen.getByTestId("enterprise-license-not-included-banner"),
    ).toHaveTextContent("Your Enterprise license does not include SCIM");
    expect(providerTable(screenCase)).toHaveAttribute(
      "data-createable",
      "false",
    );
  });

  test.each([
    ["only SCIM", ["scim"] as unknown],
    ["every feature", "all" as unknown],
    ["the wildcard", ["*"] as unknown],
  ])(
    "a valid license with %s: unchanged screen",
    async (_name: string, features: unknown) => {
      answerLicense({
        status: "valid",
        licenseValid: true,
        features: features as JSONObject["features"],
      });

      await renderScreen(screenCase);

      expect(
        screen.queryByTestId("enterprise-license-not-included-banner"),
      ).not.toBeInTheDocument();
      expectEditable(screenCase);
    },
  );

  test("renders its screen straight away: the upsell and eligibility check live in the core shell", async () => {
    answerLicense({ status: "valid" });

    await renderScreen(screenCase);

    expect(providerTable(screenCase)).toBeInTheDocument();
    expect(
      screen.queryByText("Learn about Enterprise Edition"),
    ).not.toBeInTheDocument();
  });
});
