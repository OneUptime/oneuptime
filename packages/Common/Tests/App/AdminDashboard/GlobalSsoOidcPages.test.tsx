import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { Mock, SpyInstance } from "jest-mock";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * Settings > Global SSO and Settings > Global OIDC - the provider lists and
 * one provider's page - are Community Edition screens: every edition, every
 * license state and OneUptime Cloud get the same configuration screens, with
 * providers that can be created, edited, attached to projects and deleted.
 * No upsell, no license banner, no read-only state, no "Disable" stand-in
 * for editing, and no license request.
 *
 * The URLs the provider pages print are configured in customers' identity
 * providers, so they are compared byte for byte against a fixed host: the
 * SAML ACS URL and the OIDC redirect URI live under /identity, the SAML
 * Issuer (Entity ID) deliberately does not, and the "test this provider"
 * links start the sign-in through IDENTITY_URL.
 *
 * The model tables, detail cards and page chrome are replaced by stand-ins
 * that record their props. The Enterprise plugin door is filled with fake
 * screens under the Global SSO / OIDC names the plugin contract used to
 * have: the pages must not read it. The API answers whatever license state a
 * test picks, so a page that asked for the license would show it. Billing
 * and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;

const TEST_HOST: string = "oneuptime.example.com";

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const protocol: { default: { HTTPS: string } } = jest.requireActual(
    "../../../Types/API/Protocol",
  ) as { default: { HTTPS: string } };
  const url: { default: { fromString: (value: string) => unknown } } =
    jest.requireActual("../../../Types/API/URL") as {
      default: { fromString: (value: string) => unknown };
    };

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

  // A fixed origin, so the printed URLs can be compared byte for byte.
  Object.defineProperty(mocked, "HTTP_PROTOCOL", {
    get: (): string => {
      return protocol.default.HTTPS;
    },
  });

  Object.defineProperty(mocked, "HOST", {
    get: (): string => {
      return "oneuptime.example.com";
    },
  });

  Object.defineProperty(mocked, "IDENTITY_URL", {
    get: (): unknown => {
      return url.default.fromString("https://oneuptime.example.com/identity");
    },
  });

  return mocked;
});

type MockProps = Record<string, unknown>;

interface MockRenders {
  tables: Array<MockProps>;
  details: Array<MockProps>;
  deletes: Array<MockProps>;
}

// Every stand-in render, newest last.
const mockRenders: MockRenders = {
  tables: [],
  details: [],
  deletes: [],
};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      mockRenders.tables.push(props);

      const actionButtons: Array<unknown> =
        (props["actionButtons"] as Array<unknown> | undefined) || [];

      return (
        <div
          data-testid={`model-table-${String(props["id"])}`}
          data-createable={String(props["isCreateable"])}
          data-editable={String(props["isEditable"])}
          data-deleteable={String(props["isDeleteable"])}
          data-viewable={String(props["isViewable"])}
          data-action-count={String(actionButtons.length)}
        />
      );
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      mockRenders.details.push(props);

      return (
        <div
          data-testid={`card-model-detail-${String(props["name"])}`}
          data-editable={String(props["isEditable"])}
        />
      );
    },
  };
});

interface MockPageProps {
  breadcrumbLinks?: Array<{ title: string }> | undefined;
  sideMenu?: ReactNode | undefined;
  children?: ReactNode | undefined;
}

const mockPageChrome: (testId: string, props: MockPageProps) => ReactElement = (
  testId: string,
  props: MockPageProps,
): ReactElement => {
  return (
    <div data-testid={testId}>
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
};

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return mockPageChrome("settings-page", props);
    },
  };
});

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return mockPageChrome("settings-model-page", props);
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      mockRenders.deletes.push(props);

      return <div data-testid="model-delete" />;
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

/*
 * What a license request would get back. Null: the request fails (the
 * license cannot be read).
 */
let mockLicenseAnswer: Record<string, unknown> | null = null;
const mockApiRequests: Array<string> = [];

jest.mock("../../../UI/Utils/API/API", () => {
  const request: (
    method: string,
  ) => (...args: Array<unknown>) => Promise<unknown> = (
    method: string,
  ): ((...args: Array<unknown>) => Promise<unknown>) => {
    return (...args: Array<unknown>): Promise<unknown> => {
      mockApiRequests.push(`${method} ${JSON.stringify(args[0] || {})}`);

      if (!mockLicenseAnswer) {
        return Promise.reject(new Error("The license cannot be read."));
      }

      return Promise.resolve({
        isSuccess: (): boolean => {
          return true;
        },
        data: mockLicenseAnswer,
      });
    };
  };

  return {
    __esModule: true,
    default: {
      fetch: request("fetch"),
      get: request("get"),
      post: request("post"),
      put: request("put"),
      delete: request("delete"),
      getFriendlyMessage: (): string => {
        return "";
      },
      getFriendlyErrorMessage: (): string => {
        return "";
      },
    },
  };
});

/*
 * The Enterprise plugin door, filled with fake screens under the names the
 * Global SSO / OIDC plugin keys had. Nothing here may be rendered or read.
 */
const mockFakeEnterpriseScreen: (name: string) => FunctionComponent = (
  name: string,
): FunctionComponent => {
  const FakeScreen: FunctionComponent = (): ReactElement => {
    return <div data-testid="fake-enterprise-screen">{name}</div>;
  };

  return FakeScreen;
};

const mockFakeEnterprisePlugins: Record<string, unknown> = {
  buildMarker: "ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1",
  GlobalSSOList: mockFakeEnterpriseScreen("GlobalSSOList"),
  GlobalSSOView: mockFakeEnterpriseScreen("GlobalSSOView"),
  GlobalOIDCList: mockFakeEnterpriseScreen("GlobalOIDCList"),
  GlobalOIDCView: mockFakeEnterpriseScreen("GlobalOIDCView"),
};

const mockGetAdminDashboardPlugins: Mock<() => Record<string, unknown>> =
  jest.fn<() => Record<string, unknown>>(() => {
    return mockFakeEnterprisePlugins;
  });

jest.mock("@oneuptime/ee-admin-dashboard", () => {
  return { __esModule: true, default: mockFakeEnterprisePlugins };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/Plugins",
  () => {
    return {
      getAdminDashboardPlugins: (): Record<string, unknown> => {
        return mockGetAdminDashboardPlugins();
      },
    };
  },
);

import SettingsGlobalOIDC from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalOIDC/Index";
import SettingsGlobalOIDCView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalOIDC/View";
import SettingsGlobalSSO from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalSSO/Index";
import SettingsGlobalSSOView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalSSO/View";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import ProjectScopedTeamsPicker from "../../../../App/FeatureSet/AdminDashboard/src/Components/GlobalProvider/ProjectScopedTeamsPicker";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import GlobalOIDC from "../../../Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSSO from "../../../Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import Navigation from "../../../UI/Utils/Navigation";

const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";

// The printed URLs, as customers paste them into their identity providers.
const SAML_ACS_URL: string = `https://${TEST_HOST}/identity/global-idp-login/${PROVIDER_ID}`;
const SAML_ISSUER_URL: string = `https://${TEST_HOST}/global-sso/${PROVIDER_ID}`;
const SAML_TEST_LOGIN_URL: string = `https://${TEST_HOST}/identity/global-sso/${PROVIDER_ID}`;
const OIDC_REDIRECT_URI: string = `https://${TEST_HOST}/identity/global-oidc-callback/${PROVIDER_ID}`;
const OIDC_TEST_LOGIN_URL: string = `https://${TEST_HOST}/identity/global-oidc/${PROVIDER_ID}`;

interface EditionCase {
  name: string;
  enterprise: boolean;
  billing: boolean;
}

const EDITIONS: Array<EditionCase> = [
  { name: "Community Edition", enterprise: false, billing: false },
  {
    name: "Community Edition image with billing on",
    enterprise: false,
    billing: true,
  },
  { name: "Enterprise Edition", enterprise: true, billing: false },
  {
    name: "OneUptime Cloud (Enterprise Edition, billing on)",
    enterprise: true,
    billing: true,
  },
];

interface LicenseCase {
  name: string;
  answer: Record<string, unknown> | null;
}

// Every license state a self-hosted Enterprise Edition can be in.
const LICENSE_STATES: Array<LicenseCase> = [
  {
    name: "licensed",
    answer: { status: "valid", licenseValid: true, features: ["*"] },
  },
  {
    name: "in the trial",
    answer: { status: "grace", graceReason: "unlicensed", licenseValid: true },
  },
  {
    name: "in the grace period",
    answer: { status: "grace", graceReason: "expired", licenseValid: true },
  },
  {
    name: "lapsed (expired)",
    answer: { status: "expired", licenseValid: false },
  },
  {
    name: "lapsed (missing)",
    answer: { status: "missing", licenseValid: false },
  },
  {
    name: "lapsed (invalid)",
    answer: { status: "invalid", licenseValid: false },
  },
  {
    name: "valid, without single sign-on among its features",
    answer: {
      status: "valid",
      licenseValid: true,
      features: ["scim", "audit-logs"],
    },
  },
  { name: "unreadable", answer: null },
];

interface PageCase {
  name: string;
  Page: FunctionComponent;
  path: string;
  kind: "list" | "provider";
  provider: "Global SSO" | "Global OIDC";
  // The provider table (list) or the attached-projects table (provider page).
  table: string;
  // The provider's configuration card (provider pages only).
  detailCard?: string | undefined;
}

const PAGES: Array<PageCase> = [
  {
    name: "Settings > Global SSO",
    Page: SettingsGlobalSSO,
    path: "/admin/settings/global-sso",
    kind: "list",
    provider: "Global SSO",
    table: "global-sso-table",
  },
  {
    name: "Settings > Global SSO > provider",
    Page: SettingsGlobalSSOView,
    path: `/admin/settings/global-sso/${PROVIDER_ID}`,
    kind: "provider",
    provider: "Global SSO",
    table: "global-sso-project-table",
    detailCard: "Global SSO Configuration",
  },
  {
    name: "Settings > Global OIDC",
    Page: SettingsGlobalOIDC,
    path: "/admin/settings/global-oidc",
    kind: "list",
    provider: "Global OIDC",
    table: "global-oidc-table",
  },
  {
    name: "Settings > Global OIDC > provider",
    Page: SettingsGlobalOIDCView,
    path: `/admin/settings/global-oidc/${PROVIDER_ID}`,
    kind: "provider",
    provider: "Global OIDC",
    table: "global-oidc-project-table",
    detailCard: "Global OIDC Configuration",
  },
];

// What the pages must never show: the upsell, the license UI, the Disable stand-in.
const RETIRED_TEST_IDS: Array<string> = [
  "enterprise-license-read-only-banner",
  "enterprise-license-grace-banner",
  "enterprise-license-not-included-banner",
  "enterprise-read-only-actions-notice",
  "disable-provider-card",
  "fake-enterprise-screen",
];

const RETIRED_TEXT: Array<RegExp> = [
  /Learn about Enterprise Edition/,
  /is a OneUptime Enterprise Edition feature/,
  // The upsell's benefits.
  /Instance-wide auth/,
  /Enforce SSO/,
  /Auto provisioning/,
  /Audit trail/,
  // The license banners and the tighten-only notice.
  /Enterprise license/i,
  /read-only/i,
  /Disable Provider|Disable this provider/,
  /You can still disable a provider/,
];

const renderPage: (pageCase: PageCase) => Promise<void> = async (
  pageCase: PageCase,
): Promise<void> => {
  window.history.pushState({}, "", pageCase.path);
  Navigation.setLocation(window.location as unknown as never);

  render(<pageCase.Page />);

  // Give any request a page might make the chance to settle and re-render.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const lastTable: (id: string) => MockProps = (id: string): MockProps => {
  const found: MockProps | undefined = [...mockRenders.tables]
    .reverse()
    .find((props: MockProps) => {
      return props["id"] === id;
    });

  if (!found) {
    throw new Error(`No model table ${id} was rendered.`);
  }

  return found;
};

const lastDetail: (name: string) => MockProps = (name: string): MockProps => {
  const found: MockProps | undefined = [...mockRenders.details]
    .reverse()
    .find((props: MockProps) => {
      return props["name"] === name;
    });

  if (!found) {
    throw new Error(`No detail card ${name} was rendered.`);
  }

  return found;
};

// The column each form field / table column / filter edits or shows, in order.
const columnsOf: (fields: unknown) => Array<string> = (
  fields: unknown,
): Array<string> => {
  return ((fields as Array<{ field: Record<string, unknown> }>) || []).map(
    (entry: { field: Record<string, unknown> }) => {
      return Object.keys(entry.field)[0] || "";
    },
  );
};

// A form's steps, as id and title.
const stepsOf: (steps: unknown) => Array<string> = (
  steps: unknown,
): Array<string> => {
  return ((steps as Array<{ id: string; title: string }>) || []).map(
    (step: { id: string; title: string }) => {
      return `${step.id}: ${step.title}`;
    },
  );
};

/*
 * A provider's Attached Projects form is one page: the project, then its teams
 * under it. The teams are the project picker's own (ProjectScopedTeamsPicker,
 * several at once), and the picker starts on the project's members team as
 * soon as a project is picked (its own suite and AdminAddToProjectMembersTeam
 * drive that).
 */
const expectOnePageAttachForm: (table: MockProps) => void = (
  table: MockProps,
): void => {
  expect(table["formSteps"]).toBeUndefined();

  const fields: Array<MockProps> = table["formFields"] as Array<MockProps>;

  for (const field of fields) {
    expect(field["stepId"]).toBeUndefined();
  }

  const teamsField: MockProps = fields[1]!;

  expect(teamsField["fieldType"]).toBe(FormFieldSchemaType.CustomComponent);
  expect(teamsField["required"]).toBe(false);

  const onChange: Mock<(value: unknown) => void> =
    jest.fn<(value: unknown) => void>();
  const projectId: string = "44444444-4444-4444-8444-444444444444";

  const element: ReactElement = (
    teamsField["getCustomElement"] as (
      values: Record<string, unknown>,
      props: { onChange: (value: unknown) => void },
    ) => ReactElement
  )({ project: projectId, teams: [] }, { onChange });

  expect(element.type).toBe(ProjectScopedTeamsPicker);

  const pickerProps: {
    projectId?: ObjectID | undefined;
    selectedTeamIds: Array<string>;
    isMultiSelect?: boolean | undefined;
    onChange: (teamIds: Array<string>) => void;
  } = element.props as {
    projectId?: ObjectID | undefined;
    selectedTeamIds: Array<string>;
    isMultiSelect?: boolean | undefined;
    onChange: (teamIds: Array<string>) => void;
  };

  // The teams of the project picked above it, several at once.
  expect(pickerProps.projectId?.toString()).toBe(projectId);
  expect(pickerProps.selectedTeamIds).toEqual([]);
  expect(pickerProps.isMultiSelect).not.toBe(false);

  // What the picker reports is what the form holds: the list of team ids.
  pickerProps.onChange(["55555555-5555-4555-8555-555555555555"]);

  expect(onChange).toHaveBeenCalledWith([
    "55555555-5555-4555-8555-555555555555",
  ]);
};

/*
 * Every OIDC provider form, the Global one included, comes from one builder
 * (Common/UI/Components/Sso/OidcProviderFormFields), and every SAML provider
 * form from another (SamlProviderFormFields): what the identity provider
 * gives on Provider; Enabled, then everything with an answer folded under
 * Advanced, on Sign-in. Both walk the same two steps.
 */
const OIDC_FORM_STEPS: Array<string> = [
  "provider: Provider",
  "sign-in: Sign-in",
];

const SAML_FORM_STEPS: Array<string> = OIDC_FORM_STEPS;

const GLOBAL_SAML_FORM_FIELDS: Array<string> = [
  "name",
  "signOnURL",
  "issuerURL",
  "publicCertificate",
  "isEnabled",
  "signatureMethod",
  "digestMethod",
  "description",
  "disableSignUpWithSso",
  "restrictToAttachedProjects",
];

const GLOBAL_OIDC_FORM_FIELDS: Array<string> = [
  "name",
  "issuerURL",
  "clientId",
  "clientSecret",
  "isEnabled",
  "discoveryURL",
  "scopes",
  "emailClaimName",
  "nameClaimName",
  "description",
  "disableSignUpWithSso",
  "restrictToAttachedProjects",
];

// The value next to a label in an "Identity Provider URLs" card, exactly.
const printedValueFor: (label: string) => string = (label: string): string => {
  const labelElement: HTMLElement = screen.getByText(label);
  const valueElement: Element | null = labelElement.nextElementSibling;

  return valueElement?.textContent || "";
};

const expectNothingRetired: () => void = (): void => {
  for (const testId of RETIRED_TEST_IDS) {
    expect({ testId, present: screen.queryByTestId(testId) !== null }).toEqual({
      testId,
      present: false,
    });
  }

  const text: string = document.body.textContent || "";

  for (const retired of RETIRED_TEXT) {
    expect({ retired: retired.source, found: retired.test(text) }).toEqual({
      retired: retired.source,
      found: false,
    });
  }
};

const expectEditable: (pageCase: PageCase) => void = (
  pageCase: PageCase,
): void => {
  const table: HTMLElement = screen.getByTestId(
    `model-table-${pageCase.table}`,
  );

  expect(table).toHaveAttribute("data-createable", "true");
  // No row action: providers are switched off by editing them.
  expect(table).toHaveAttribute("data-action-count", "0");
  expect(lastTable(pageCase.table)["actionButtons"]).toBeUndefined();
  expect(lastTable(pageCase.table)["refreshToggle"]).toBeUndefined();

  if (pageCase.kind === "list") {
    // Providers are opened and edited on their own page, as always.
    expect(table).toHaveAttribute("data-viewable", "true");
    expect(table).toHaveAttribute("data-editable", "false");
    expect(table).toHaveAttribute("data-deleteable", "false");
  } else {
    // An attachment is changed by deleting it and adding it again.
    expect(table).toHaveAttribute("data-editable", "false");
    expect(table).toHaveAttribute("data-deleteable", "true");
  }

  if (pageCase.detailCard) {
    expect(
      screen.getByTestId(`card-model-detail-${pageCase.detailCard}`),
    ).toHaveAttribute("data-editable", "true");

    const detail: MockProps = lastDetail(pageCase.detailCard);

    expect(detail["refresher"]).toBeUndefined();
    expect(
      (detail["modelDetailProps"] as MockProps)["onItemLoaded"],
    ).toBeUndefined();
    expect(screen.getByTestId("model-delete")).toBeInTheDocument();
  }
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  mockLicenseAnswer = { status: "expired", licenseValid: false };
  mockApiRequests.length = 0;
  mockRenders.tables.length = 0;
  mockRenders.details.length = 0;
  mockRenders.deletes.length = 0;
  mockGetAdminDashboardPlugins.mockClear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(PAGES)("$name", (pageCase: PageCase) => {
  describe.each(EDITIONS)("$name", (edition: EditionCase) => {
    beforeEach(() => {
      enterpriseEditionForTest = edition.enterprise;
      billingEnabledForTest = edition.billing;
    });

    test("is the configuration screen: no upsell, no license banner, no Disable action", async () => {
      await renderPage(pageCase);

      expect(
        screen.getByTestId(`model-table-${pageCase.table}`),
      ).toBeInTheDocument();
      expectNothingRetired();
    });

    test("creates and edits providers", async () => {
      await renderPage(pageCase);

      expectEditable(pageCase);
    });

    test("sits in the settings layout", async () => {
      await renderPage(pageCase);

      expect(screen.getByTestId("settings-side-menu")).toBeInTheDocument();
      expect(screen.getByTestId("settings-page-breadcrumbs")).toHaveTextContent(
        pageCase.kind === "list"
          ? `breadcrumbs.adminDashboard > breadcrumbs.settings > ${pageCase.provider}`
          : `breadcrumbs.adminDashboard > breadcrumbs.settings > ${pageCase.provider} > View`,
      );
    });

    test("never asks for the license and never reads the Enterprise plugin", async () => {
      await renderPage(pageCase);

      expect(mockApiRequests).toEqual([]);
      expect(mockGetAdminDashboardPlugins).not.toHaveBeenCalled();
    });
  });

  test.each(LICENSE_STATES)(
    "Enterprise Edition, license $name: the same editable screen",
    async (license: LicenseCase) => {
      enterpriseEditionForTest = true;
      mockLicenseAnswer = license.answer;

      await renderPage(pageCase);

      expectEditable(pageCase);
      expectNothingRetired();
      expect(mockApiRequests).toEqual([]);
    },
  );
});

describe("the provider lists", () => {
  test("Global SSO: the SAML provider table, and the two-step form every SAML provider shares", async () => {
    await renderPage(PAGES[0]!);

    const table: MockProps = lastTable("global-sso-table");

    expect(table["userPreferencesKey"]).toBe("admin-global-sso-table");
    expect(table["name"]).toBe("Settings > Global SSO");
    expect(table["modelType"]).toBe(GlobalSSO);
    expect(table["modelAPI"]).toBe(AdminModelAPI);
    expect(table["showRefreshButton"]).toBe(true);
    expect((table["viewPageRoute"] as Route).toString()).toBe(
      "/admin/settings/global-sso",
    );
    expect(stepsOf(table["formSteps"])).toEqual(SAML_FORM_STEPS);
    expect(columnsOf(table["formFields"])).toEqual(GLOBAL_SAML_FORM_FIELDS);
    expect(columnsOf(table["filters"])).toEqual([
      "name",
      "description",
      "isEnabled",
    ]);
    expect(columnsOf(table["columns"])).toEqual(["name", "isEnabled"]);
  });

  test("Global OIDC: the OIDC provider table, and the two-step form every OIDC provider shares", async () => {
    await renderPage(PAGES[2]!);

    const table: MockProps = lastTable("global-oidc-table");

    expect(table["userPreferencesKey"]).toBe("admin-global-oidc-table");
    expect(table["name"]).toBe("Settings > Global OIDC");
    expect(table["modelType"]).toBe(GlobalOIDC);
    expect(table["modelAPI"]).toBe(AdminModelAPI);
    expect((table["viewPageRoute"] as Route).toString()).toBe(
      "/admin/settings/global-oidc",
    );
    expect(stepsOf(table["formSteps"])).toEqual(OIDC_FORM_STEPS);
    expect(columnsOf(table["formFields"])).toEqual(GLOBAL_OIDC_FORM_FIELDS);
    expect(columnsOf(table["filters"])).toEqual([
      "name",
      "description",
      "isEnabled",
    ]);
    expect(columnsOf(table["columns"])).toEqual(["name", "isEnabled"]);
  });

  test("Global OIDC: a provider just added opens on its own page, where its redirect URI, attached projects and test link are", async () => {
    await renderPage(PAGES[2]!);

    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return;
      });

    const onCreateSuccess: (
      item: GlobalOIDC,
      modalType?: ModalType,
    ) => Promise<GlobalOIDC> = lastTable("global-oidc-table")[
      "onCreateSuccess"
    ] as (item: GlobalOIDC, modalType?: ModalType) => Promise<GlobalOIDC>;

    const created: GlobalOIDC = new GlobalOIDC();
    created._id = PROVIDER_ID;

    await expect(onCreateSuccess(created, ModalType.Create)).resolves.toBe(
      created,
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/admin/settings/global-oidc/${PROVIDER_ID}`,
    );

    // Saving an edit from the list never moves anyone.
    await onCreateSuccess(created, ModalType.Edit);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  test("Global SSO: a provider just added opens on its own page, where its ACS URL, Entity ID, attached projects and test link are", async () => {
    await renderPage(PAGES[0]!);

    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return;
      });

    const onCreateSuccess: (
      item: GlobalSSO,
      modalType?: ModalType,
    ) => Promise<GlobalSSO> = lastTable("global-sso-table")[
      "onCreateSuccess"
    ] as (item: GlobalSSO, modalType?: ModalType) => Promise<GlobalSSO>;

    const created: GlobalSSO = new GlobalSSO();
    created._id = PROVIDER_ID;

    await expect(onCreateSuccess(created, ModalType.Create)).resolves.toBe(
      created,
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/admin/settings/global-sso/${PROVIDER_ID}`,
    );

    // Saving an edit from the list never moves anyone.
    await onCreateSuccess(created, ModalType.Edit);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  test.each([
    [0, "Instance-wide SAML SSO"],
    [2, "Instance-wide OpenID Connect (OIDC) SSO"],
  ])(
    "page %p explains how global providers work and links to the Global SSO docs",
    async (pageIndex: number, bannerTitle: string) => {
      await renderPage(PAGES[pageIndex]!);

      expect(screen.getByText(bannerTitle)).toBeInTheDocument();
      expect(
        screen.getByText(
          /it works for ALL projects a user is already a member of/,
        ),
      ).toBeInTheDocument();
      expect(
        document.querySelector('a[href="/docs/identity/global-sso"]'),
      ).not.toBeNull();
    },
  );
});

describe("the Global SSO provider page", () => {
  describe.each(EDITIONS)("$name", (edition: EditionCase) => {
    test("prints the SAML URLs byte for byte", async () => {
      enterpriseEditionForTest = edition.enterprise;
      billingEnabledForTest = edition.billing;

      await renderPage(PAGES[1]!);

      expect(
        printedValueFor("ACS URL (Assertion Consumer Service / Reply URL):"),
      ).toBe(SAML_ACS_URL);
      // The Entity ID has no /identity prefix; the ACS URL does.
      expect(printedValueFor("Issuer (Entity ID):")).toBe(SAML_ISSUER_URL);

      const testCard: HTMLElement = screen
        .getByText("Test this SSO provider")
        .closest('[data-testid="card"]') as HTMLElement;
      const testLink: HTMLElement = within(testCard).getByRole("link");

      expect(testLink).toHaveAttribute("href", SAML_TEST_LOGIN_URL);
      expect(testLink).toHaveAttribute("target", "_blank");
      expect(testLink).toHaveTextContent(SAML_TEST_LOGIN_URL);
    });
  });

  test("edits the provider's configuration and never shows the certificate back", async () => {
    await renderPage(PAGES[1]!);

    const detail: MockProps = lastDetail("Global SSO Configuration");
    const detailProps: MockProps = detail["modelDetailProps"] as MockProps;

    expect(detail["modelAPI"]).toBe(AdminModelAPI);
    expect(detailProps["modelType"]).toBe(GlobalSSO);
    expect(detailProps["id"]).toBe("global-sso-detail");
    expect((detailProps["modelId"] as ObjectID).toString()).toBe(PROVIDER_ID);
    // The edit dialog has the create form's layout.
    expect(stepsOf(detail["formSteps"])).toEqual(SAML_FORM_STEPS);
    expect(columnsOf(detail["formFields"])).toEqual(GLOBAL_SAML_FORM_FIELDS);
    expect(columnsOf(detailProps["fields"])).toEqual([
      "name",
      "description",
      "signOnURL",
      "issuerURL",
      "signatureMethod",
      "digestMethod",
      "disableSignUpWithSso",
      "restrictToAttachedProjects",
      "isEnabled",
    ]);
  });

  test("attaches projects to this provider", async () => {
    await renderPage(PAGES[1]!);

    const table: MockProps = lastTable("global-sso-project-table");

    expect(table["modelType"]).toBe(GlobalSSOProject);
    expect(table["modelAPI"]).toBe(AdminModelAPI);
    expect(
      ((table["query"] as MockProps)["globalSsoId"] as ObjectID).toString(),
    ).toBe(PROVIDER_ID);
    expect(columnsOf(table["formFields"])).toEqual(["project", "teams"]);
    expectOnePageAttachForm(table);
    expect(columnsOf(table["columns"])).toEqual([
      "project",
      "teams",
      "isEnabled",
    ]);

    const onBeforeCreate: (
      item: GlobalSSOProject,
    ) => Promise<GlobalSSOProject> = table["onBeforeCreate"] as (
      item: GlobalSSOProject,
    ) => Promise<GlobalSSOProject>;
    const attachment: GlobalSSOProject = await onBeforeCreate(
      new GlobalSSOProject(),
    );

    expect(attachment.globalSsoId?.toString()).toBe(PROVIDER_ID);
  });

  test("deletes the provider and goes back to the list", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return;
      });

    await renderPage(PAGES[1]!);

    const deleteProps: MockProps | undefined =
      mockRenders.deletes[mockRenders.deletes.length - 1];

    expect(deleteProps?.["modelType"]).toBe(GlobalSSO);
    expect((deleteProps?.["modelId"] as ObjectID).toString()).toBe(PROVIDER_ID);

    (deleteProps?.["onDeleteSuccess"] as () => void)();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]?.[0] as Route).toString()).toBe(
      "/admin/settings/global-sso",
    );
  });
});

describe("the Global OIDC provider page", () => {
  describe.each(EDITIONS)("$name", (edition: EditionCase) => {
    test("prints the OIDC URLs byte for byte", async () => {
      enterpriseEditionForTest = edition.enterprise;
      billingEnabledForTest = edition.billing;

      await renderPage(PAGES[3]!);

      expect(printedValueFor("Redirect URI (Callback URL):")).toBe(
        OIDC_REDIRECT_URI,
      );

      const testCard: HTMLElement = screen
        .getByText("Test this OIDC provider")
        .closest('[data-testid="card"]') as HTMLElement;
      const testLink: HTMLElement = within(testCard).getByRole("link");

      expect(testLink).toHaveAttribute("href", OIDC_TEST_LOGIN_URL);
      expect(testLink).toHaveAttribute("target", "_blank");
      expect(testLink).toHaveTextContent(OIDC_TEST_LOGIN_URL);
    });
  });

  test("edits the provider's configuration and never shows the client secret back", async () => {
    await renderPage(PAGES[3]!);

    const detail: MockProps = lastDetail("Global OIDC Configuration");
    const detailProps: MockProps = detail["modelDetailProps"] as MockProps;

    expect(detail["modelAPI"]).toBe(AdminModelAPI);
    expect(detailProps["modelType"]).toBe(GlobalOIDC);
    expect(detailProps["id"]).toBe("global-oidc-detail");
    expect((detailProps["modelId"] as ObjectID).toString()).toBe(PROVIDER_ID);
    // The edit dialog has the create form's layout.
    expect(stepsOf(detail["formSteps"])).toEqual(OIDC_FORM_STEPS);
    expect(columnsOf(detail["formFields"])).toEqual(GLOBAL_OIDC_FORM_FIELDS);
    expect(columnsOf(detailProps["fields"])).toEqual([
      "name",
      "description",
      "discoveryURL",
      "issuerURL",
      "clientId",
      "scopes",
      "emailClaimName",
      "nameClaimName",
      "disableSignUpWithSso",
      "restrictToAttachedProjects",
      "isEnabled",
    ]);
  });

  test("attaches projects to this provider", async () => {
    await renderPage(PAGES[3]!);

    const table: MockProps = lastTable("global-oidc-project-table");

    expect(table["modelType"]).toBe(GlobalOIDCProject);
    expect(table["modelAPI"]).toBe(AdminModelAPI);
    expect(
      ((table["query"] as MockProps)["globalOidcId"] as ObjectID).toString(),
    ).toBe(PROVIDER_ID);
    expect(columnsOf(table["formFields"])).toEqual(["project", "teams"]);
    expectOnePageAttachForm(table);
    expect(columnsOf(table["columns"])).toEqual([
      "project",
      "teams",
      "isEnabled",
    ]);

    const onBeforeCreate: (
      item: GlobalOIDCProject,
    ) => Promise<GlobalOIDCProject> = table["onBeforeCreate"] as (
      item: GlobalOIDCProject,
    ) => Promise<GlobalOIDCProject>;
    const attachment: GlobalOIDCProject = await onBeforeCreate(
      new GlobalOIDCProject(),
    );

    expect(attachment.globalOidcId?.toString()).toBe(PROVIDER_ID);
  });

  test("deletes the provider and goes back to the list", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return;
      });

    await renderPage(PAGES[3]!);

    const deleteProps: MockProps | undefined =
      mockRenders.deletes[mockRenders.deletes.length - 1];

    expect(deleteProps?.["modelType"]).toBe(GlobalOIDC);
    expect((deleteProps?.["modelId"] as ObjectID).toString()).toBe(PROVIDER_ID);

    (deleteProps?.["onDeleteSuccess"] as () => void)();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]?.[0] as Route).toString()).toBe(
      "/admin/settings/global-oidc",
    );
  });
});

/*
 * The checks above are only worth something if they would fail on the
 * screens this change replaced.
 */
describe("the checks catch the retired screens (negative controls)", () => {
  test("the upsell card's copy is caught", () => {
    const upsell: string =
      "Global SSO is a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable it. Learn about Enterprise Edition Enforce SSO Require SSO across the whole instance — no shared passwords.";

    expect(
      RETIRED_TEXT.some((retired: RegExp) => {
        return retired.test(upsell);
      }),
    ).toBe(true);
  });

  test("the read-only license banner and the Disable card are caught", () => {
    for (const retired of [
      "Enterprise license required: single sign-on and SCIM are off, and this configuration is read-only.",
      "You can still disable a provider.",
      "Disable this provider",
    ]) {
      expect({
        retired,
        caught: RETIRED_TEXT.some((pattern: RegExp) => {
          return pattern.test(retired);
        }),
      }).toEqual({ retired, caught: true });
    }
  });

  test("a URL printed with the wrong prefix is caught", () => {
    // The Issuer is the one URL without /identity: adding it would be a change.
    expect(`https://${TEST_HOST}/identity/global-sso/${PROVIDER_ID}`).not.toBe(
      SAML_ISSUER_URL,
    );
    expect(
      URL.fromString(`https://${TEST_HOST}/identity`)
        .addRoute(new Route(`/global-sso/${PROVIDER_ID}`))
        .toString(),
    ).toBe(SAML_TEST_LOGIN_URL);
  });
});
