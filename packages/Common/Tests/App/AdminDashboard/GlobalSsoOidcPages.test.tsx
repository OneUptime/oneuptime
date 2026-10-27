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
 * Settings > Single Sign-On - the instance-wide SAML and OIDC providers and
 * Require SSO for Login, on one page since they were "Global SSO" and
 * "Global OIDC" (two lists) and a switch on Settings > Authentication - and
 * one provider's page are Community Edition screens: every edition, every
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
  switches: Array<MockProps>;
}

// Every stand-in render, newest last.
const mockRenders: MockRenders = {
  tables: [],
  details: [],
  deletes: [],
  switches: [],
};

// The Require SSO card, as a stand-in: the switch card reads its record itself.
jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      mockRenders.switches.push(props);

      return (
        <div data-testid={`model-switch-card-${String(props["dataTestId"])}`}>
          {String(props["cardTitle"])}
        </div>
      );
    },
  };
});

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

import SettingsGlobalOIDCView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalOIDC/View";
import SettingsGlobalSSOView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalSSO/View";
import SettingsSso from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SSO/Index";
import {
  REQUIRE_SSO_COPY,
  REQUIRE_SSO_SWITCH_TEST_ID,
  SSO_PAGE_COPY,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SSO/SsoSettingsCopy";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import ProjectScopedTeamsPicker from "../../../../App/FeatureSet/AdminDashboard/src/Components/GlobalProvider/ProjectScopedTeamsPicker";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  SSO_GLOBAL_REACH_TITLE,
  SSO_GLOBAL_SIGN_UP_TITLE,
} from "../../../UI/Components/Sso/SsoProviderFormFields";
import FieldType from "../../../UI/Components/Types/FieldType";
import GlobalOIDC from "../../../Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSSO from "../../../Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import splitActionButtons, {
  SplitActionButtonsResult,
} from "../../../UI/Components/ActionButton/SplitActionButtons";
import IconProp from "../../../Types/Icon/IconProp";
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
    name: "Settings > Single Sign-On (its SAML providers)",
    Page: SettingsSso,
    path: "/admin/settings/sso",
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
    name: "Settings > Single Sign-On (its OIDC providers)",
    Page: SettingsSso,
    path: "/admin/settings/sso",
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
 * The provider page shows the two questions its form asks, answered in the
 * form's words, rather than two Yes/No switches named "Disable Sign Up with
 * SSO" and "Restrict to Attached Projects".
 */
const expectAnswerRows: (
  fields: Array<MockProps>,
  makeItem: (values: {
    disableSignUpWithSso: boolean;
    restrictToAttachedProjects: boolean;
  }) => unknown,
) => void = (
  fields: Array<MockProps>,
  makeItem: (values: {
    disableSignUpWithSso: boolean;
    restrictToAttachedProjects: boolean;
  }) => unknown,
): void => {
  const rowFor: (column: string) => MockProps = (column: string): MockProps => {
    return fields.find((field: MockProps): boolean => {
      return (
        Object.keys(field["field"] as Record<string, unknown>)[0] === column
      );
    }) as MockProps;
  };

  const signUp: MockProps = rowFor("disableSignUpWithSso");
  const reach: MockProps = rowFor("restrictToAttachedProjects");

  expect(signUp["title"]).toBe(SSO_GLOBAL_SIGN_UP_TITLE);
  expect(reach["title"]).toBe(SSO_GLOBAL_REACH_TITLE);
  expect(signUp["fieldType"]).toBe(FieldType.Element);
  expect(reach["fieldType"]).toBe(FieldType.Element);

  const drawn: (row: MockProps, item: unknown) => string = (
    row: MockProps,
    item: unknown,
  ): string => {
    const view: ReturnType<typeof render> = render(
      (row["getElement"] as (item: unknown) => ReactElement)(item),
    );
    const text: string = view.container.textContent || "";

    view.unmount();

    return text;
  };

  const off: unknown = makeItem({
    disableSignUpWithSso: false,
    restrictToAttachedProjects: false,
  });
  const on: unknown = makeItem({
    disableSignUpWithSso: true,
    restrictToAttachedProjects: true,
  });

  expect(drawn(signUp, off)).toBe("Get one on their first sign-in");
  expect(drawn(signUp, on)).toBe("Must be invited first");
  expect(drawn(reach, off)).toBe("Every project");
  expect(drawn(reach, on)).toBe("Attached projects only");
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

  /*
   * A project is attached to the provider, not created: the button read
   * "Create Global SSO Project", after the join table's name.
   */
  expect(table["createVerb"]).toBe("Attach");
  expect(table["singularName"]).toBe("Project");
  expect(table["pluralName"]).toBe("Projects");
  expect(table["createFormTitle"]).toBe("Attach a Project");
  expect(table["createFormSubmitButtonText"]).toBe("Attach Project");

  const fields: Array<MockProps> = table["formFields"] as Array<MockProps>;

  for (const field of fields) {
    expect(field["stepId"]).toBeUndefined();
  }

  // What each field does for the people who sign in, in a line.
  expect(fields[0]!["description"]).toBe(
    "People who sign in for the first time join this project.",
  );
  expect(fields[1]!["description"]).toBe(
    "The teams of that project they join.",
  );

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

/*
 * The instance-wide provider's two questions (People without an account, Where this
 * sign-in counts as SSO) are each a form-only choice kept by its column,
 * followed by the column itself, registered unseen so the form loads and
 * saves it: each column is listed twice.
 */
const GLOBAL_SSO_QUESTION_FIELDS: Array<string> = [
  "disableSignUpWithSso",
  "disableSignUpWithSso",
  "restrictToAttachedProjects",
  "restrictToAttachedProjects",
];

const GLOBAL_SAML_FORM_FIELDS: Array<string> = [
  "name",
  "signOnURL",
  "issuerURL",
  "publicCertificate",
  "isEnabled",
  "signatureMethod",
  "digestMethod",
  "description",
  ...GLOBAL_SSO_QUESTION_FIELDS,
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
  ...GLOBAL_SSO_QUESTION_FIELDS,
];

// The value next to a label in an "Identity Provider URLs" card, exactly.
const printedValueFor: (label: string) => string = (label: string): string => {
  const labelElement: HTMLElement = screen.getByText(label);
  const valueElement: Element | null = labelElement.nextElementSibling;

  return valueElement?.textContent || "";
};

/*
 * A test card's sentence and link are its body, not its description: a
 * card's description is hidden on a phone (max-md:hidden), which left the
 * card a title with nothing under it there. The link is drawn as one.
 */
const expectTestLinkInBody: (card: HTMLElement, testId: string) => void = (
  card: HTMLElement,
  testId: string,
): void => {
  const body: HTMLElement = within(card).getByTestId(testId);

  expect(body).toHaveTextContent(
    'Open this link to test the provider. It must be enabled, which only adds a "Sign in with SSO" option and locks no one out.',
  );
  expect(within(body).getByRole("link")).toHaveClass("text-indigo-600");
  expect(within(card).queryByTestId("card-description")).toBeNull();
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
  expect(lastTable(pageCase.table)["refreshToggle"]).toBeUndefined();

  if (pageCase.kind === "list") {
    // Providers are opened and edited on their own page, as always.
    expect(table).toHaveAttribute("data-viewable", "true");
    expect(table).toHaveAttribute("data-editable", "false");
    expect(table).toHaveAttribute("data-deleteable", "false");
    /*
     * Each row starts a sign-in with its provider (Test Sign-in), and
     * nothing else: a provider is turned on and off on its own page, since
     * turning one off ends every sign-in it gave (RowActionsAudit).
     */
    expect(lastTable(pageCase.table)["rowSwitch"]).toBeUndefined();
    expect(table).toHaveAttribute("data-action-count", "1");
  } else {
    // No row action on a provider's attachments.
    expect(table).toHaveAttribute("data-action-count", "0");
    expect(lastTable(pageCase.table)["actionButtons"]).toBeUndefined();
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
      // A provider's page goes back to the page that lists it.
      expect(screen.getByTestId("settings-page-breadcrumbs")).toHaveTextContent(
        pageCase.kind === "list"
          ? "breadcrumbs.adminDashboard > breadcrumbs.settings > breadcrumbs.singleSignOn"
          : "breadcrumbs.adminDashboard > breadcrumbs.settings > breadcrumbs.singleSignOn > View",
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
    expect(table["name"]).toBe("Settings > Single Sign-On > SAML");
    // "Add SAML Provider", "No SAML providers yet": what the card holds.
    expect(table["singularName"]).toBe("SAML Provider");
    expect(table["pluralName"]).toBe("SAML Providers");
    expect(table["createVerb"]).toBe("Add");
    expect(table["cardProps"]).toEqual({
      title: "SAML",
      description:
        "Sign in through a SAML app, such as Okta, Microsoft Entra ID or OneLogin.",
    });
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
    expect(table["name"]).toBe("Settings > Single Sign-On > OpenID Connect");
    expect(table["singularName"]).toBe("OIDC Provider");
    expect(table["pluralName"]).toBe("OIDC Providers");
    expect(table["createVerb"]).toBe("Add");
    expect(table["cardProps"]).toEqual({
      title: "OpenID Connect (OIDC)",
      description:
        "Sign in through an OpenID Connect app, such as Google Workspace, Auth0 or Keycloak.",
    });
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

  test("the page explains how its providers work, once, and links to the Global SSO docs", async () => {
    await renderPage(PAGES[0]!);

    expect(screen.getAllByText(SSO_PAGE_COPY.bannerTitle)).toHaveLength(1);
    expect(
      screen.getByText(
        /sign people in to every project on this server they belong to/,
      ),
    ).toBeInTheDocument();
    expect(
      document.querySelectorAll('a[href="/docs/identity/global-sso"]'),
    ).toHaveLength(1);
  });
});

/*
 * Settings > Single Sign-On, as it is set up: the SAML providers, the OIDC
 * providers, then Require SSO for Login - the switch that depends on them -
 * with the master admins' way in under it, and a test step before it.
 */
describe("Settings > Single Sign-On", () => {
  const testSignInAction: (tableId: string) => MockProps = (
    tableId: string,
  ): MockProps => {
    return (lastTable(tableId)["actionButtons"] as Array<MockProps>)[0]!;
  };

  const requireSsoCard: () => MockProps = (): MockProps => {
    const found: MockProps | undefined = [...mockRenders.switches]
      .reverse()
      .find((props: MockProps): boolean => {
        return props["dataTestId"] === REQUIRE_SSO_SWITCH_TEST_ID;
      });

    if (!found) {
      throw new Error("The Require SSO card was not rendered.");
    }

    return found;
  };

  test("holds the SAML providers, the OIDC providers and Require SSO, in that order", async () => {
    await renderPage(PAGES[0]!);

    const page: HTMLElement = screen.getByTestId("settings-page");
    const order: Array<string> = Array.from(
      page.querySelectorAll("[data-testid]"),
    )
      .map((element: Element): string => {
        return element.getAttribute("data-testid") || "";
      })
      .filter((testId: string): boolean => {
        return (
          testId.startsWith("model-table-") ||
          testId.startsWith("model-switch-card-")
        );
      });

    expect(order).toEqual([
      "model-table-global-sso-table",
      "model-table-global-oidc-table",
      `model-switch-card-${REQUIRE_SSO_SWITCH_TEST_ID}`,
    ]);
  });

  test.each([
    ["global-sso-table", GlobalSSO, SAML_TEST_LOGIN_URL],
    ["global-oidc-table", GlobalOIDC, OIDC_TEST_LOGIN_URL],
  ])(
    "%s: Test Sign-in starts a sign-in with the provider, in a new tab, for a provider that is on",
    async (
      tableId: string,
      modelType: typeof GlobalSSO | typeof GlobalOIDC,
      testUrl: string,
    ) => {
      const navigate: SpyInstance<typeof Navigation.navigate> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((): void => {
          return;
        });

      await renderPage(PAGES[0]!);

      const action: MockProps = testSignInAction(tableId);
      const provider: GlobalSSO | GlobalOIDC = new modelType();
      provider._id = PROVIDER_ID;

      expect(action["title"]).toBe(SSO_PAGE_COPY.testSignIn);

      // A provider that is off signs nobody in.
      provider.isEnabled = false;
      expect(
        (action["isVisible"] as (item: unknown) => boolean)(provider),
      ).toBe(false);
      provider.isEnabled = true;
      expect(
        (action["isVisible"] as (item: unknown) => boolean)(provider),
      ).toBe(true);

      const onCompleteAction: Mock<() => void> = jest.fn<() => void>();

      await (
        action["onClick"] as (
          item: unknown,
          onCompleteAction: () => void,
        ) => Promise<void>
      )(provider, onCompleteAction);

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(String(navigate.mock.calls[0]![0])).toBe(testUrl);
      expect(navigate.mock.calls[0]![1]).toEqual({ openInNewTab: true });
      expect(onCompleteAction).toHaveBeenCalledTimes(1);
    },
  );

  /*
   * The card above the switch asks for a test sign-in first, so a provider
   * that is on carries Test Sign-in as its row's one button - the row's
   * View (ModelTable marks it Primary too, after the page's own actions)
   * waits in the ⋯ menu, and a click on the row still opens the provider.
   * A provider that is off signs nobody in: its button stays View.
   */
  test.each([
    ["global-sso-table", GlobalSSO, "View SAML Provider"],
    ["global-oidc-table", GlobalOIDC, "View OIDC Provider"],
  ])(
    "%s: Test Sign-in is the row's button while the provider is on, View while it is off",
    async (
      tableId: string,
      modelType: typeof GlobalSSO | typeof GlobalOIDC,
      viewTitle: string,
    ) => {
      await renderPage(PAGES[0]!);

      const action: MockProps = testSignInAction(tableId);

      expect(action["placement"]).toBe(ActionButtonPlacement.Primary);

      // What BaseModelTable adds after the page's own actions.
      const view: ActionButtonSchema<GlobalSSO | GlobalOIDC> = {
        title: viewTitle,
        icon: IconProp.Eye,
        buttonStyleType: ButtonStyleType.NORMAL,
        placement: ActionButtonPlacement.Primary,
        onClick: async (): Promise<void> => {
          return;
        },
      };

      const rowActions: Array<ActionButtonSchema<GlobalSSO | GlobalOIDC>> = [
        action as unknown as ActionButtonSchema<GlobalSSO | GlobalOIDC>,
        view,
      ];

      const provider: GlobalSSO | GlobalOIDC = new modelType();
      provider._id = PROVIDER_ID;

      provider.isEnabled = true;

      const whileOn: SplitActionButtonsResult<GlobalSSO | GlobalOIDC> =
        splitActionButtons({ actionButtons: rowActions, item: provider });

      expect(whileOn.primary?.button.title).toBe(SSO_PAGE_COPY.testSignIn);
      expect(
        whileOn.moreMenu.map(
          (entry: { button: ActionButtonSchema<GlobalSSO | GlobalOIDC> }) => {
            return entry.button.title;
          },
        ),
      ).toEqual([viewTitle]);

      provider.isEnabled = false;

      const whileOff: SplitActionButtonsResult<GlobalSSO | GlobalOIDC> =
        splitActionButtons({ actionButtons: rowActions, item: provider });

      expect(whileOff.primary?.button.title).toBe(viewTitle);
      expect(whileOff.moreMenu).toEqual([]);
    },
  );

  test("Require SSO for Login: the server's one setting, saved through the admin API", async () => {
    await renderPage(PAGES[0]!);

    const card: MockProps = requireSsoCard();

    expect(card["modelType"]).toBe(GlobalConfig);
    expect((card["modelId"] as ObjectID).toString()).toBe(
      ObjectID.getZeroObjectID().toString(),
    );
    expect(card["column"]).toBe("requireSsoForLogin");
    expect(card["modelAPI"]).toBe(AdminModelAPI);
    expect(card["cardTitle"]).toBe(REQUIRE_SSO_COPY.cardTitle);
    expect(card["cardDescription"]).toBe(REQUIRE_SSO_COPY.cardDescription);
    expect(card["title"]).toBe("Require SSO for Login");

    const describe: (isOn: boolean) => string = card["getDescription"] as (
      isOn: boolean,
    ) => string;

    expect(describe(true)).toBe(
      "The sign-in page offers only SSO. Everyone except master admins must sign in with SSO to open any project.",
    );
    expect(describe(false)).toBe(
      "People can sign in with a password, a passkey or SSO.",
    );
  });

  test("asks before SSO is required, with a red button, and never before it is turned off", async () => {
    await renderPage(PAGES[0]!);

    const confirm: (isTurningOn: boolean) => MockProps | undefined =
      requireSsoCard()["getConfirmation"] as (
        isTurningOn: boolean,
      ) => MockProps | undefined;

    expect(confirm(true)).toEqual({
      title: "Require SSO for everyone?",
      description: REQUIRE_SSO_COPY.confirmDescription,
      submitButtonText: "Require SSO",
      submitButtonType: ButtonStyleType.DANGER,
    });
    /*
     * What it does to the sign-in page and to people signed in now; the
     * card's line above the switch says to test a provider first.
     */
    expect(REQUIRE_SSO_COPY.confirmDescription).toMatch(
      /sign-in page will offer only SSO/,
    );
    expect(REQUIRE_SSO_COPY.confirmDescription).toMatch(/signed in now/);
    expect(REQUIRE_SSO_COPY.cardDescription).toMatch(
      /Before you require SSO, sign in with a provider using Test Sign-in/,
    );
    expect(confirm(false)).toBeUndefined();
  });

  test("names the master admins' way in under the switch, whichever way it is set", async () => {
    await renderPage(PAGES[0]!);

    const getDetails: (item: GlobalConfig, isOn: boolean) => ReactElement =
      requireSsoCard()["getDetails"] as (
        item: GlobalConfig,
        isOn: boolean,
      ) => ReactElement;

    for (const isOn of [true, false]) {
      const view: ReturnType<typeof render> = render(
        getDetails(new GlobalConfig(), isOn),
      );

      expect(view.container).toHaveTextContent(
        REQUIRE_SSO_COPY.masterAdminSentence,
      );
      expect(view.container).toHaveTextContent(
        REQUIRE_SSO_COPY.masterAdminAddressLabel,
      );
      expect(
        within(view.container).getByText(
          `https://${TEST_HOST}/accounts/admin-login`,
        ),
      ).toBeInTheDocument();
      // With a button that copies it.
      expect(within(view.container).getByRole("button")).toBeInTheDocument();

      view.unmount();
    }
  });
});

describe("the Global SSO provider page", () => {
  describe.each(EDITIONS)("$name", (edition: EditionCase) => {
    test("prints the SAML URLs byte for byte", async () => {
      enterpriseEditionForTest = edition.enterprise;
      billingEnabledForTest = edition.billing;

      await renderPage(PAGES[1]!);

      // Each name heads its value without the colon its key ends with.
      expect(
        printedValueFor("ACS URL (Assertion Consumer Service / Reply URL)"),
      ).toBe(SAML_ACS_URL);
      // The Entity ID has no /identity prefix; the ACS URL does.
      expect(printedValueFor("Issuer (Entity ID)")).toBe(SAML_ISSUER_URL);

      // Each value is pasted into the identity provider: each copies.
      expect(
        screen.getByRole("button", {
          name: "Copy ACS URL (Assertion Consumer Service / Reply URL)",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Copy Issuer (Entity ID)" }),
      ).toBeInTheDocument();

      const testCard: HTMLElement = screen
        .getByText("Test this SSO provider")
        .closest('[data-testid="card"]') as HTMLElement;
      const testLink: HTMLElement = within(testCard).getByRole("link");

      expect(testLink).toHaveAttribute("href", SAML_TEST_LOGIN_URL);
      expect(testLink).toHaveAttribute("target", "_blank");
      expect(testLink).toHaveTextContent(SAML_TEST_LOGIN_URL);
      expectTestLinkInBody(testCard, "global-sso-test-link");
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
    expectAnswerRows(
      detailProps["fields"] as Array<MockProps>,
      (values: {
        disableSignUpWithSso: boolean;
        restrictToAttachedProjects: boolean;
      }): GlobalSSO => {
        const provider: GlobalSSO = new GlobalSSO();

        provider.disableSignUpWithSso = values.disableSignUpWithSso;
        provider.restrictToAttachedProjects = values.restrictToAttachedProjects;

        return provider;
      },
    );
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

    // Back to Single Sign-On, which lists it.
    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]?.[0] as Route).toString()).toBe(
      "/admin/settings/sso",
    );
  });
});

describe("the Global OIDC provider page", () => {
  describe.each(EDITIONS)("$name", (edition: EditionCase) => {
    test("prints the OIDC URLs byte for byte", async () => {
      enterpriseEditionForTest = edition.enterprise;
      billingEnabledForTest = edition.billing;

      await renderPage(PAGES[3]!);

      expect(printedValueFor("Redirect URI (Callback URL)")).toBe(
        OIDC_REDIRECT_URI,
      );

      // It is pasted into the identity provider: it copies.
      expect(
        screen.getByRole("button", {
          name: "Copy Redirect URI (Callback URL)",
        }),
      ).toBeInTheDocument();

      const testCard: HTMLElement = screen
        .getByText("Test this OIDC provider")
        .closest('[data-testid="card"]') as HTMLElement;
      const testLink: HTMLElement = within(testCard).getByRole("link");

      expect(testLink).toHaveAttribute("href", OIDC_TEST_LOGIN_URL);
      expect(testLink).toHaveAttribute("target", "_blank");
      expect(testLink).toHaveTextContent(OIDC_TEST_LOGIN_URL);
      expectTestLinkInBody(testCard, "global-oidc-test-link");
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
    expectAnswerRows(
      detailProps["fields"] as Array<MockProps>,
      (values: {
        disableSignUpWithSso: boolean;
        restrictToAttachedProjects: boolean;
      }): GlobalOIDC => {
        const provider: GlobalOIDC = new GlobalOIDC();

        provider.disableSignUpWithSso = values.disableSignUpWithSso;
        provider.restrictToAttachedProjects = values.restrictToAttachedProjects;

        return provider;
      },
    );
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

    // Back to Single Sign-On, which lists it.
    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]?.[0] as Route).toString()).toBe(
      "/admin/settings/sso",
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
