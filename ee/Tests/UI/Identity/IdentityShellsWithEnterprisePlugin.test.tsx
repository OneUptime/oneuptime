import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The identity pages as the Enterprise image builds the Dashboard: "@oneuptime/
 * ee-dashboard" is the REAL ee/Dashboard/Index here, as in the Enterprise
 * bundle (and on OneUptime Cloud, which runs that image).
 *
 *   - Settings > SSO / OIDC and Status page > SSO / OIDC are core pages. In
 *     the Enterprise bundle they are the same configuration screen on both
 *     editions, never an upsell, and they never ask for the license. On the
 *     Cloud only the plan decides (Scale).
 *   - Settings > SCIM and Status page > SCIM stay Enterprise screens behind
 *     their core shells: the Enterprise Edition gets the lazy ee screen, the
 *     Community Edition the edition upsell even in this bundle, and the Cloud
 *     the plan rule.
 *
 * The model tables are stand-ins; billing, the edition, the plan and the
 * license request are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 *
 * Every request goes through API.fetch, and only one to the license route
 * counts as asking for the license (mockLicenseFetch). The others - Settings
 * > SSO's "Require SSO for Login" switch reading the project, Settings >
 * OIDC looking up the members team its new providers start on - get canned
 * answers (mockServerFetch).
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

const mockLicenseFetch: jest.Mock = jest.fn();
const mockServerFetch: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (...args: Array<unknown>): unknown => {
        const request: { url?: unknown } | undefined = args[0] as
          | { url?: unknown }
          | undefined;

        // GET /api/global-config/license, whoever asks for it.
        if (String(request?.url).includes("/global-config/license")) {
          return mockLicenseFetch(...args);
        }

        return mockServerFetch(...args);
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
    default: (props: { name: string }): ReactElement => {
      return <div data-testid={`card-model-detail-${props.name}`} />;
    },
  };
});

import SettingsSSOPage from "@oneuptime/dashboard/Pages/Settings/SSO";
import SettingsOIDCPage from "@oneuptime/dashboard/Pages/Settings/OIDC";
import SettingsSCIMShell from "@oneuptime/dashboard/Pages/Settings/SCIM";
import StatusPageSSOPage from "@oneuptime/dashboard/Pages/StatusPages/View/SSO";
import StatusPageOIDCPage from "@oneuptime/dashboard/Pages/StatusPages/View/OIDC";
import StatusPageSCIMShell from "@oneuptime/dashboard/Pages/StatusPages/View/SCIM";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import { getDashboardPlugins } from "@oneuptime/dashboard/Enterprise/Plugins";
import DashboardPlugin from "../../../Dashboard/Index";
import { fetchEnterpriseLicenseMode } from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

/*
 * The canned answer to every request that is not the license request: the
 * project, for the "Require SSO for Login" switch's read of
 * requireSsoForLogin, and an empty list for a list read (Settings > OIDC
 * looks up the members team its new providers start on).
 */
const answerServer: (request: {
  method: unknown;
  url: { toString: () => string };
}) => Promise<HTTPResponse<JSONObject | JSONArray>> = async (request: {
  method: unknown;
  url: { toString: () => string };
}): Promise<HTTPResponse<JSONObject | JSONArray>> => {
  const url: string = request.url.toString();

  if (url.endsWith(`/project/${PROJECT_ID}/get-item`)) {
    return new HTTPResponse<JSONObject>(
      200,
      { _id: PROJECT_ID, requireSsoForLogin: false },
      {},
    );
  }

  if (url.endsWith("/get-list")) {
    return new HTTPResponse<JSONArray>(
      200,
      { data: [], count: 0, skip: 0, limit: 0 },
      {},
    );
  }

  throw new Error(
    `The fake server has no answer for ${String(request.method)} ${url}`,
  );
};

interface IdentityPageCase {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  path: string;
  table: string;
  featureName: string;
}

const SSO_PAGES: Array<IdentityPageCase> = [
  {
    name: "Settings > SSO",
    Page: SettingsSSOPage,
    path: `/dashboard/${PROJECT_ID}/settings/sso`,
    table: "sso-table",
    featureName: "SAML Single Sign On",
  },
  {
    name: "Settings > OIDC",
    Page: SettingsOIDCPage,
    path: `/dashboard/${PROJECT_ID}/settings/oidc`,
    table: "oidc-table",
    featureName: "OIDC Single Sign On",
  },
  {
    name: "Status page > SSO",
    Page: StatusPageSSOPage,
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/sso`,
    table: "sso-table",
    featureName: "Status Page SAML SSO",
  },
  {
    name: "Status page > OIDC",
    Page: StatusPageOIDCPage,
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/oidc`,
    table: "oidc-table",
    featureName: "Status Page OIDC SSO",
  },
];

const SCIM_SHELLS: Array<IdentityPageCase> = [
  {
    name: "Settings > SCIM",
    Page: SettingsSCIMShell,
    path: `/dashboard/${PROJECT_ID}/settings/scim`,
    table: "scim-table",
    featureName: "SCIM User Provisioning",
  },
  {
    name: "Status page > SCIM",
    Page: StatusPageSCIMShell,
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/scim`,
    table: "status-page-scim-table",
    featureName: "Status Page SCIM Provisioning",
  },
];

const renderPage: (pageCase: IdentityPageCase) => Promise<void> = async (
  pageCase: IdentityPageCase,
): Promise<void> => {
  window.history.pushState({}, "", pageCase.path);
  Navigation.setLocation(window.location as unknown as never);

  render(
    <pageCase.Page
      pageRoute={new Route(pageCase.path)}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  // Let a lazy screen, or a license request, settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const pinCloud: (plan: PlanType) => void = (plan: PlanType): void => {
  billingEnabledForTest = true;
  // The Cloud runs the Enterprise image: its effective edition is true.
  enterpriseEditionForTest = true;
  currentPlanForTest = plan;
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  currentPlanForTest = null;
  mockLicenseFetch.mockReset();
  mockLicenseFetch.mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
    data: { status: "valid", licenseValid: true },
  });
  mockServerFetch.mockReset();
  mockServerFetch.mockImplementation(answerServer as never);
  jest
    .spyOn(ProjectUtil, "getCurrentPlan")
    .mockImplementation((): PlanType | null => {
      return currentPlanForTest as PlanType | null;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test("this suite really runs with the Enterprise plugin", () => {
  expect(getDashboardPlugins()).toBe(DashboardPlugin);
  expect(getDashboardPlugins().buildMarker).toBe(
    "ONEUPTIME_EE_DASHBOARD_PLUGIN_v1",
  );
});

test("only a request to the license route counts as asking for the license", async () => {
  await fetchEnterpriseLicenseMode();
  await ModelAPI.getItem<Project>({
    modelType: Project,
    id: new ObjectID(PROJECT_ID),
    select: { requireSsoForLogin: true },
  });

  expect(mockLicenseFetch).toHaveBeenCalledTimes(1);
  expect(mockServerFetch).toHaveBeenCalledTimes(1);
});

describe.each(SSO_PAGES)(
  "$name in the Enterprise bundle",
  (pageCase: IdentityPageCase) => {
    test.each([
      ["the Community Edition", false],
      ["the Enterprise Edition", true],
    ])(
      "on %s: the core configuration screen, and no license request",
      async (_edition: string, isEnterprise: boolean) => {
        enterpriseEditionForTest = isEnterprise;

        await renderPage(pageCase);

        expect(
          screen.getByTestId(`model-table-${pageCase.table}`),
        ).toBeInTheDocument();
        expect(
          screen.queryByText("Learn about Enterprise Edition"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText(pageCase.featureName),
        ).not.toBeInTheDocument();
        expect(mockLicenseFetch).not.toHaveBeenCalled();
      },
    );

    test("on OneUptime Cloud below Scale: the Scale plan upsell", async () => {
      pinCloud(PlanType.Growth);

      await renderPage(pageCase);

      expect(screen.getAllByText("Upgrade to Scale")).toHaveLength(2);
      expect(screen.getByText(pageCase.featureName)).toBeInTheDocument();
      expect(
        screen.queryByText("Learn about Enterprise Edition"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(`model-table-${pageCase.table}`),
      ).not.toBeInTheDocument();
    });

    test("on OneUptime Cloud on Scale: the configuration screen", async () => {
      pinCloud(PlanType.Scale);

      await renderPage(pageCase);

      expect(
        screen.getByTestId(`model-table-${pageCase.table}`),
      ).toBeInTheDocument();
      expect(mockLicenseFetch).not.toHaveBeenCalled();
    });
  },
);

describe.each(SCIM_SHELLS)(
  "$name in the Enterprise bundle",
  (shellCase: IdentityPageCase) => {
    test("on the Enterprise Edition: the Enterprise screen", async () => {
      enterpriseEditionForTest = true;

      await renderPage(shellCase);

      expect(
        await screen.findByTestId(`model-table-${shellCase.table}`),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Learn about Enterprise Edition"),
      ).not.toBeInTheDocument();
    });

    test("on the Community Edition: the edition upsell, even though the bundle has the screen", async () => {
      await renderPage(shellCase);

      expect(
        screen.getAllByText("Learn about Enterprise Edition"),
      ).toHaveLength(2);
      expect(screen.getAllByText(shellCase.featureName).length).toBeGreaterThan(
        0,
      );
      expect(
        screen.queryByTestId(`model-table-${shellCase.table}`),
      ).not.toBeInTheDocument();
    });

    test("on OneUptime Cloud below Scale: the plan upsell", async () => {
      pinCloud(PlanType.Growth);

      await renderPage(shellCase);

      expect(screen.getAllByText("Upgrade to Scale")).toHaveLength(2);
      expect(
        screen.queryByTestId(`model-table-${shellCase.table}`),
      ).not.toBeInTheDocument();
    });

    test("on OneUptime Cloud on Scale: the Enterprise screen", async () => {
      pinCloud(PlanType.Scale);

      await renderPage(shellCase);

      expect(
        await screen.findByTestId(`model-table-${shellCase.table}`),
      ).toBeInTheDocument();
    });
  },
);
