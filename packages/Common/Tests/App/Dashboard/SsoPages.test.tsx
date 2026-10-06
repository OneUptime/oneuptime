import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > SSO / OIDC and Status page > SSO / OIDC: single sign-on
 * configuration, which every edition includes.
 *
 * On a self-hosted install (billing off) each page is the configuration
 * screen whatever the edition and whatever the Enterprise license says: the
 * provider table offers create, edit and delete, there is no "Disable"
 * row action and no license banner or notice, requiring SSO (on the two SAML
 * pages) can always be changed - the project's and the status page's
 * "Require SSO for Login" are switches that save on flip and ask first,
 * with a red button - and the page never asks the server for the license. On OneUptime Cloud (billing on) only the
 * plan decides: a project below Scale, or one whose plan cannot be read,
 * sees the Scale plan upsell - never the Enterprise Edition one. A paid
 * feature can always be switched off, on any plan: a project a Scale trial
 * left requiring SSO keeps its "Require SSO for Login" switch under the
 * upsell, where it can be turned off (RequireSsoForLoginLeftover), and so
 * does a status page (StatusPageRequireSsoLeftover). Configuration a lower
 * plan cannot use can still be seen, switched off and removed: the
 * providers a page still has are listed under the upsell, to turn off or
 * delete (PlanLeftoverTable). Below Scale those are the only requests a
 * page makes - whether SSO is required, and how many providers are left.
 *
 * The URLs the pages print (SAML ACS and Entity ID, OIDC redirect URI and
 * audience, the test links) are what customers configured in their identity
 * provider, so they are pinned byte for byte. The URL settings are pinned
 * too, so the expected values can be literal.
 *
 * ModelTable, CardModelDetail and ModelSwitchCard are stand-ins that print
 * the props that matter; everything else is real. Billing, the edition, the plan and the
 * license answer are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true.
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
  const urlModule: {
    default: { fromString: (url: string) => unknown };
  } = jest.requireActual("../../../Types/API/URL") as {
    default: { fromString: (url: string) => unknown };
  };
  const protocolModule: { default: Record<string, unknown> } =
    jest.requireActual("../../../Types/API/Protocol") as {
      default: Record<string, unknown>;
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

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  mocked["HOST"] = "oneuptime.example.com";
  mocked["HTTP_PROTOCOL"] = protocolModule.default["HTTPS"];
  mocked["IDENTITY_URL"] = urlModule.default.fromString(
    "https://oneuptime.example.com/identity",
  );
  mocked["DASHBOARD_URL"] = urlModule.default.fromString(
    "https://oneuptime.example.com/dashboard",
  );
  mocked["STATUS_PAGE_URL"] = urlModule.default.fromString(
    "https://oneuptime.example.com/status-page",
  );

  return mocked;
});

/*
 * What getDashboardPlugins() returns in this suite: a fillable Enterprise
 * plugin, to prove that none of these pages goes through it any more.
 */
const mockEnterprisePlugins: Record<string, unknown> = {};

jest.mock("@oneuptime/ee-dashboard", () => {
  return { __esModule: true, default: mockEnterprisePlugins };
});

// The row the stand-in table hands its row actions.
const mockProviderRow: { _id: string } = {
  _id: "33333333-3333-4333-8333-333333333333",
};

/*
 * The team a project's new SAML or OIDC provider starts on
 * (Utils/DefaultInviteTeam, looked up when Settings > SSO or Settings > OIDC
 * opens). Stubbed so the pages make no request at all here; its own suite
 * tests the lookup.
 */
const mockDefaultInviteTeam: {
  team: { id: string; name: string } | null;
  lookups: number;
} = { team: null, lookups: 0 };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DefaultInviteTeam",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Utils/DefaultInviteTeam",
    ) as Record<string, unknown>;

    return {
      ...actual,
      findDefaultInviteTeam: async (): Promise<{
        id: string;
        name: string;
      } | null> => {
        mockDefaultInviteTeam.lookups++;
        return mockDefaultInviteTeam.team;
      },
    };
  },
);

interface MockActionButton {
  title: string;
  isVisible?: ((item: unknown) => boolean | undefined) | undefined;
  onClick: (
    item: unknown,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
}

interface MockFormField {
  field?: Record<string, unknown> | undefined;
}

interface MockCreatedItem {
  statusPageId?: { toString: () => string } | undefined;
  projectId?: { toString: () => string } | undefined;
}

type MockOnCreateSuccess = (
  item: Record<string, unknown>,
  modalType?: number,
) => Promise<unknown>;

/*
 * What the real table hands onCreateSuccess as the dialog that was saved:
 * ModalType.Create and ModalType.Edit (pinned against the enum below).
 */
const mockModalTypes: { create: number; edit: number } = {
  create: 0,
  edit: 1,
};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const MockModelTable: (props: {
    id: string;
    modelType: { new (): unknown };
    isCreateable?: boolean;
    isEditable?: boolean;
    isDeleteable?: boolean;
    refreshToggle?: string | undefined;
    actionButtons?: Array<MockActionButton>;
    formFields?: Array<MockFormField>;
    formSteps?: Array<{ id: string; title: string }>;
    onBeforeCreate?: ((item: unknown) => Promise<unknown>) | undefined;
    createInitialValues?: Record<string, unknown> | undefined;
    onCreateSuccess?: MockOnCreateSuccess | undefined;
  }) => ReactElement = (props: {
    id: string;
    modelType: { new (): unknown };
    isCreateable?: boolean;
    isEditable?: boolean;
    isDeleteable?: boolean;
    refreshToggle?: string | undefined;
    actionButtons?: Array<MockActionButton>;
    formFields?: Array<MockFormField>;
    formSteps?: Array<{ id: string; title: string }>;
    onBeforeCreate?: ((item: unknown) => Promise<unknown>) | undefined;
    createInitialValues?: Record<string, unknown> | undefined;
    onCreateSuccess?: MockOnCreateSuccess | undefined;
  }): ReactElement => {
    const [created, setCreated] = react.useState<string>("");

    const visibleActions: Array<MockActionButton> = (
      props.actionButtons || []
    ).filter((button: MockActionButton) => {
      return !button.isVisible || button.isVisible(mockProviderRow) !== false;
    });

    return (
      <div
        data-testid={`model-table-${props.id}`}
        data-createable={String(Boolean(props.isCreateable))}
        data-editable={String(Boolean(props.isEditable))}
        data-deleteable={String(Boolean(props.isDeleteable))}
        data-refresh-toggle={String(props.refreshToggle !== undefined)}
        data-actions={visibleActions
          .map((button: MockActionButton) => {
            return button.title;
          })
          .join("|")}
        data-form-fields={(props.formFields || [])
          .map((formField: MockFormField) => {
            return Object.keys(formField.field || {}).join(",");
          })
          .join("|")}
        data-form-steps={(props.formSteps || [])
          .map((step: { id: string; title: string }) => {
            return `${step.id}: ${step.title}`;
          })
          .join("|")}
        data-create-initial-values={JSON.stringify(
          props.createInitialValues || null,
        )}
      >
        {visibleActions.map((button: MockActionButton) => {
          return (
            <button
              key={button.title}
              type="button"
              onClick={() => {
                button.onClick(
                  mockProviderRow,
                  () => {},
                  () => {},
                );
              }}
            >
              {button.title}
            </button>
          );
        })}
        {props.onBeforeCreate ? (
          <button
            type="button"
            data-testid={`create-${props.id}`}
            onClick={async () => {
              const item: MockCreatedItem = (await props.onBeforeCreate!(
                new props.modelType(),
              )) as MockCreatedItem;

              setCreated(
                `${item.statusPageId?.toString()}|${item.projectId?.toString()}`,
              );
            }}
          />
        ) : (
          <></>
        )}
        <div data-testid={`created-${props.id}`}>{created}</div>
        {props.onCreateSuccess ? (
          <>
            {[true, false].map((isEnabled: boolean) => {
              return (
                <button
                  key={String(isEnabled)}
                  type="button"
                  data-testid={`saved-${props.id}-${isEnabled ? "on" : "off"}`}
                  onClick={async () => {
                    await props.onCreateSuccess!(
                      { _id: mockProviderRow._id, isEnabled },
                      mockModalTypes.create,
                    );
                  }}
                />
              );
            })}
            <button
              type="button"
              data-testid={`edited-${props.id}`}
              onClick={async () => {
                await props.onCreateSuccess!(
                  { _id: mockProviderRow._id, isEnabled: false },
                  mockModalTypes.edit,
                );
              }}
            />
          </>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return { __esModule: true, default: MockModelTable };
});

interface MockDescribedField {
  title?: string | undefined;
  description?: string | undefined;
}

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  const describeFields: (
    fields: Array<MockDescribedField> | undefined,
  ) => string = (fields: Array<MockDescribedField> | undefined): string => {
    return (fields || [])
      .map((field: MockDescribedField) => {
        return `${field.title || ""}: ${field.description || ""}`;
      })
      .join(" | ");
  };

  return {
    __esModule: true,
    default: (props: {
      name: string;
      isEditable?: boolean;
      editButtonText?: string;
      formFields?: Array<MockDescribedField>;
      modelDetailProps: {
        modelType: { new (): { tableName?: string | undefined } };
        modelId?: { toString: () => string } | undefined;
        fields?: Array<MockDescribedField>;
      };
    }): ReactElement => {
      return (
        <div
          data-testid={`card-model-detail-${props.name}`}
          data-editable={String(Boolean(props.isEditable))}
          data-edit-button-text={props.editButtonText || ""}
          data-model={new props.modelDetailProps.modelType().tableName || ""}
          data-model-id={props.modelDetailProps.modelId?.toString() || ""}
          data-form-descriptions={describeFields(props.formFields)}
          data-detail-descriptions={describeFields(
            props.modelDetailProps.fields,
          )}
        />
      );
    },
  };
});

interface MockSwitchConfirmation {
  submitButtonType?: unknown;
}

jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  const buttonModule: { ButtonStyleType: Record<string, unknown> } =
    jest.requireActual("../../../UI/Components/Button/Button") as {
      ButtonStyleType: Record<string, unknown>;
    };

  return {
    __esModule: true,
    default: (props: {
      modelType: { new (): { tableName?: string | undefined } };
      modelId: { toString: () => string };
      column: string;
      cardTitle: string;
      cardDescription?: unknown;
      title: string;
      getConfirmation?:
        | ((isTurningOn: boolean) => MockSwitchConfirmation | undefined)
        | undefined;
      locksWhenPlanNeeded?: boolean | undefined;
      initialItem?:
        | ({ id?: { toString: () => string } | null } & Record<string, unknown>)
        | undefined;
      dataTestId: string;
    }): ReactElement => {
      const turningOn: MockSwitchConfirmation | undefined =
        props.getConfirmation?.(true);
      const turningOff: MockSwitchConfirmation | undefined =
        props.getConfirmation?.(false);

      return (
        <div
          data-testid={`model-switch-card-${props.dataTestId}`}
          data-model={new props.modelType().tableName || ""}
          data-model-id={props.modelId.toString()}
          data-column={props.column}
          data-card-title={props.cardTitle}
          data-card-description={
            typeof props.cardDescription === "string"
              ? props.cardDescription
              : ""
          }
          data-title={props.title}
          data-asks-turning-on={String(Boolean(turningOn))}
          data-asks-turning-off={String(Boolean(turningOff))}
          data-danger-turning-on={String(
            turningOn?.submitButtonType ===
              buttonModule.ButtonStyleType["DANGER"],
          )}
          data-locks-when-plan-needed={String(
            Boolean(props.locksWhenPlanNeeded),
          )}
          data-initial-item-id={props.initialItem?.id?.toString() || ""}
          data-initial-value={
            props.initialItem ? String(props.initialItem[props.column]) : ""
          }
        />
      );
    },
  };
});

import SettingsSSOPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SSO";
import SettingsOIDCPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/OIDC";
import StatusPageSSOPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SSO";
import StatusPageOIDCPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/OIDC";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getDashboardPlugins } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import URL from "../../../Types/API/URL";
import { APP_API_URL } from "../../../UI/Config";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID: string = mockProviderRow._id;

/*
 * The one request the project's SSO page makes below Scale: whether the
 * project requires SSO. Built from APP_API_URL as the page builds it, so
 * the suite passes whatever HOST the environment sets (CI sets localhost).
 */
const PROJECT_READ_URL: string = URL.fromString(APP_API_URL.toString())
  .addRoute(`/project/${PROJECT_ID}/get-item`)
  .toString();

// Whether the status page requires SSO, read by its SSO page below Scale.
const STATUS_PAGE_READ_URL: string = URL.fromString(APP_API_URL.toString())
  .addRoute(`/status-page/${STATUS_PAGE_ID}/get-item`)
  .toString();

// How many providers a page still has, counted below Scale.
const countUrl: (crudPath: string) => string = (crudPath: string): string => {
  return URL.fromString(APP_API_URL.toString())
    .addRoute(`${crudPath}/count`)
    .toString();
};

/*
 * The "Require SSO for Login" switch cards, as the stand-in draws them: the
 * project's (RequireSsoForLoginCard) and the status page's
 * (StatusPageRequireSsoCard, which replaced its "Force SSO for Login" card).
 */
const REQUIRE_SSO_SWITCH_CARD: string =
  "model-switch-card-project-require-sso-switch";
const STATUS_PAGE_REQUIRE_SSO_SWITCH_CARD: string =
  "model-switch-card-status-page-require-sso-switch";

const REQUIRE_SSO_SWITCH_CARDS: Array<string> = [
  REQUIRE_SSO_SWITCH_CARD,
  STATUS_PAGE_REQUIRE_SSO_SWITCH_CARD,
];

// A page's "Require SSO for Login" switch: the record it saves on.
interface RequireSsoSwitch {
  testId: string;
  model: string;
  modelId: string;
}

// What the configuration dialog says while the provider is off.
interface TurnOnNote {
  testId: string;
  text: string;
}

const SAML_TURN_ON_NOTE: TurnOnNote = {
  testId: "sso-config-turn-on-note",
  text: "This provider is off. Once your identity provider has the Entity ID and Reply URL above, edit the provider and turn Enabled on.",
};

const OIDC_TURN_ON_NOTE: TurnOnNote = {
  testId: "oidc-config-turn-on-note",
  text: "This provider is off. Once your identity provider has the redirect URI above, edit the provider and turn Enabled on.",
};

interface PageCase {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  path: string;
  table: string;
  viewAction: string;
  modalTitle: string;
  // What the configuration dialog prints for the identity provider, exactly.
  printed: Array<string>;
  turnOnNote: TurnOnNote;
  // A project's provider: the teams newcomers join start on the members team.
  startsOnMembersTeam: boolean;
  // The "test it before you force it" link, exactly.
  testLink: string;
  requireSsoSwitch: RequireSsoSwitch | null;
  // Columns the create / edit form writes.
  formFields: Array<string>;
  // Status pages attach new providers to the page and its project.
  attachesToStatusPage: boolean;
  upsellTitle: string;
  featureName: string;
  // The plugin key that used to serve the screen from ee/.
  retiredPluginKey: string;
  // Below Scale: the table of the providers the page still has.
  leftover: {
    table: string;
    countPath: string;
  };
}

const PAGE_CASES: Array<PageCase> = [
  {
    name: "Settings > SSO",
    Page: SettingsSSOPage,
    path: `/dashboard/${PROJECT_ID}/settings/sso`,
    table: "sso-table",
    viewAction: "View SSO Config",
    modalTitle: "SSO Configuration",
    printed: [
      `https://oneuptime.example.com/${PROJECT_ID}/${PROVIDER_ID}`,
      `https://oneuptime.example.com/identity/idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
    ],
    turnOnNote: SAML_TURN_ON_NOTE,
    startsOnMembersTeam: true,
    testLink: `https://oneuptime.example.com/dashboard/${PROJECT_ID}/sso`,
    requireSsoSwitch: {
      testId: REQUIRE_SSO_SWITCH_CARD,
      model: "Project",
      modelId: PROJECT_ID,
    },
    // What the identity provider gives, then how people sign in.
    formFields: [
      "name",
      "signOnURL",
      "issuerURL",
      "publicCertificate",
      "teams",
      "isEnabled",
      "signatureMethod",
      "digestMethod",
      "description",
    ],
    attachesToStatusPage: false,
    upsellTitle: "Single Sign On (SSO)",
    featureName: "SAML Single Sign On",
    retiredPluginKey: "SettingsSSO",
    leftover: {
      table: "plan-leftover-project-saml-providers",
      countPath: "/project-sso",
    },
  },
  {
    name: "Settings > OIDC",
    Page: SettingsOIDCPage,
    path: `/dashboard/${PROJECT_ID}/settings/oidc`,
    table: "oidc-table",
    viewAction: "View OIDC Config",
    modalTitle: "OIDC Configuration",
    printed: [
      `https://oneuptime.example.com/identity/oidc-callback/${PROJECT_ID}/${PROVIDER_ID}`,
      `https://oneuptime.example.com/${PROJECT_ID}/${PROVIDER_ID}`,
    ],
    turnOnNote: OIDC_TURN_ON_NOTE,
    startsOnMembersTeam: true,
    testLink: `https://oneuptime.example.com/dashboard/${PROJECT_ID}/sso`,
    requireSsoSwitch: null,
    // What the identity provider gives, then how people sign in.
    formFields: [
      "name",
      "issuerURL",
      "clientId",
      "clientSecret",
      "teams",
      "isEnabled",
      "discoveryURL",
      "scopes",
      "emailClaimName",
      "nameClaimName",
      "description",
    ],
    attachesToStatusPage: false,
    upsellTitle: "OpenID Connect (OIDC)",
    featureName: "OIDC Single Sign On",
    retiredPluginKey: "SettingsOIDC",
    leftover: {
      table: "plan-leftover-project-oidc-providers",
      countPath: "/project-oidc",
    },
  },
  {
    name: "Status page > SSO",
    Page: StatusPageSSOPage,
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/sso`,
    table: "sso-table",
    viewAction: "View SSO Config",
    modalTitle: "SSO Configuration",
    printed: [
      `https://oneuptime.example.com/${STATUS_PAGE_ID}/${PROVIDER_ID}`,
      `https://oneuptime.example.com/identity/status-page-idp-login/${STATUS_PAGE_ID}/${PROVIDER_ID}`,
    ],
    turnOnNote: SAML_TURN_ON_NOTE,
    startsOnMembersTeam: false,
    testLink: `https://oneuptime.example.com/status-page/${STATUS_PAGE_ID}/sso`,
    requireSsoSwitch: {
      testId: STATUS_PAGE_REQUIRE_SSO_SWITCH_CARD,
      model: "StatusPage",
      modelId: STATUS_PAGE_ID,
    },
    formFields: [
      "name",
      "signOnURL",
      "issuerURL",
      "publicCertificate",
      "isEnabled",
      "signatureMethod",
      "digestMethod",
      "description",
    ],
    attachesToStatusPage: true,
    upsellTitle: "Status Page SSO",
    featureName: "Status Page SAML SSO",
    retiredPluginKey: "StatusPageSSO",
    leftover: {
      table: "plan-leftover-status-page-saml-providers",
      countPath: "/status-page-sso",
    },
  },
  {
    name: "Status page > OIDC",
    Page: StatusPageOIDCPage,
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/oidc`,
    table: "oidc-table",
    viewAction: "View OIDC Config",
    modalTitle: "OIDC Configuration",
    printed: [
      `https://oneuptime.example.com/identity/status-page-oidc-callback/${STATUS_PAGE_ID}/${PROVIDER_ID}`,
      `https://oneuptime.example.com/${STATUS_PAGE_ID}/${PROVIDER_ID}`,
    ],
    turnOnNote: OIDC_TURN_ON_NOTE,
    startsOnMembersTeam: false,
    testLink: `https://oneuptime.example.com/status-page/${STATUS_PAGE_ID}/sso`,
    requireSsoSwitch: null,
    formFields: [
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
    ],
    attachesToStatusPage: true,
    upsellTitle: "Status Page OIDC",
    featureName: "Status Page OIDC SSO",
    retiredPluginKey: "StatusPageOIDC",
    leftover: {
      table: "plan-leftover-status-page-oidc-providers",
      countPath: "/status-page-oidc",
    },
  },
];

// What GET /api/global-config/license could answer. None of it may matter.
const LICENSE_ANSWERS: Array<[string, JSONObject | null]> = [
  ["valid", { status: "valid", licenseValid: true }],
  ["in its trial or grace period", { status: "grace", licenseValid: true }],
  ["expired", { status: "expired", licenseValid: false }],
  ["missing", { status: "missing", licenseValid: false }],
  ["invalid", { status: "invalid", licenseValid: false }],
  [
    "licenseValid=false from a server without a status",
    { licenseValid: false },
  ],
  [
    "valid but naming only SCIM and audit logs",
    { status: "valid", licenseValid: true, features: ["scim", "audit-logs"] },
  ],
  ["unreadable", null],
];

const LICENSE_TEST_IDS: Array<string> = [
  "enterprise-license-read-only-banner",
  "enterprise-license-grace-banner",
  "enterprise-license-not-included-banner",
  "enterprise-read-only-actions-notice",
];

let apiFetch: ReturnType<typeof getJestSpyOn>;
let licenseAnswer: JSONObject | null = null;
/*
 * Whether the project requires SSO, as GET /project/:id/get-item answers
 * (null: the request fails).
 */
let projectRequiresSsoForTest: boolean | null = null;
// Whether the status page requires SSO (null: the request fails).
let statusPageRequiresSsoForTest: boolean | null = null;
// How many providers a page still has (null: the count fails).
let providerCountForTest: number | null = 0;

// The URL of a request the page made through API.fetch.
const requestUrl: (call: Array<unknown>) => string = (
  call: Array<unknown>,
): string => {
  const request: { url?: { toString: () => string } } = call[0] as {
    url?: { toString: () => string };
  };

  return request.url?.toString() || "";
};

// The license requests the page made: there must never be one.
const licenseRequests: () => Array<string> = (): Array<string> => {
  return apiFetch.mock.calls
    .map((call: Array<unknown>): string => {
      return requestUrl(call);
    })
    .filter((url: string): boolean => {
      return url.includes("license");
    });
};

// Every request the page made, as URLs.
const allRequests: () => Array<string> = (): Array<string> => {
  return apiFetch.mock.calls.map((call: Array<unknown>): string => {
    return requestUrl(call);
  });
};

const makeProject: () => Project = (): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID;
  return project;
};

const renderPage: (pageCase: PageCase) => ReturnType<typeof render> = (
  pageCase: PageCase,
): ReturnType<typeof render> => {
  window.history.pushState({}, "", pageCase.path);
  Navigation.setLocation(window.location as unknown as never);

  return render(
    <pageCase.Page
      pageRoute={new Route(pageCase.path)}
      currentProject={makeProject()}
      hasPaymentMethod={true}
    />,
  );
};

const providerTable: (pageCase: PageCase) => HTMLElement = (
  pageCase: PageCase,
): HTMLElement => {
  return screen.getByTestId(`model-table-${pageCase.table}`);
};

// Everything a self-hosted install must see on the page, in any edition.
const expectConfigurationScreen: (pageCase: PageCase) => void = (
  pageCase: PageCase,
): void => {
  const table: HTMLElement = providerTable(pageCase);

  expect(table).toHaveAttribute("data-createable", "true");
  expect(table).toHaveAttribute("data-editable", "true");
  expect(table).toHaveAttribute("data-deleteable", "true");
  // The one row action: the configuration dialog. No "Disable".
  expect(table).toHaveAttribute("data-actions", pageCase.viewAction);
  expect(table).toHaveAttribute("data-refresh-toggle", "false");

  // No page keeps an Edit dialog for requiring SSO ("Force SSO for Login").
  expect(
    screen.queryByTestId("card-model-detail-SSO Settings"),
  ).not.toBeInTheDocument();

  if (pageCase.requireSsoSwitch) {
    /*
     * The page's switch - the project's, or the status page's for its
     * private users: it saves when flipped, asks with a red button before
     * it locks people out, and never asks to turn it off.
     */
    const requireSso: HTMLElement = screen.getByTestId(
      pageCase.requireSsoSwitch.testId,
    );

    expect(requireSso).toHaveAttribute(
      "data-model",
      pageCase.requireSsoSwitch.model,
    );
    expect(requireSso).toHaveAttribute(
      "data-model-id",
      pageCase.requireSsoSwitch.modelId,
    );
    expect(requireSso).toHaveAttribute("data-column", "requireSsoForLogin");
    expect(requireSso).toHaveAttribute("data-card-title", "SSO Settings");
    expect(requireSso).toHaveAttribute("data-title", "Require SSO for Login");
    expect(requireSso).toHaveAttribute("data-asks-turning-on", "true");
    expect(requireSso).toHaveAttribute("data-danger-turning-on", "true");
    expect(requireSso).toHaveAttribute("data-asks-turning-off", "false");
  }

  // The other page's switch is not here.
  for (const testId of REQUIRE_SSO_SWITCH_CARDS) {
    if (testId !== pageCase.requireSsoSwitch?.testId) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  }

  for (const testId of LICENSE_TEST_IDS) {
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
  }

  expect(
    screen.queryByText("Learn about Enterprise Edition"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Upgrade to Scale")).not.toBeInTheDocument();
  expect(screen.queryByText(pageCase.featureName)).not.toBeInTheDocument();
  expect(screen.queryByText(/Enterprise/)).not.toBeInTheDocument();

  // The page never asks for the license.
  expect(licenseRequests()).toEqual([]);
};

const expectPlanUpsell: (pageCase: PageCase) => void = (
  pageCase: PageCase,
): void => {
  expect(screen.getAllByText("Upgrade to Scale")).toHaveLength(2);
  expect(screen.getByText(pageCase.featureName)).toBeInTheDocument();
  expect(screen.getByText(pageCase.upsellTitle)).toBeInTheDocument();
  expect(
    screen.getByText(
      `${pageCase.featureName} is available on the Scale plan and above. Upgrade to enable it for this project.`,
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Learn about Enterprise Edition"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Enterprise Edition/)).not.toBeInTheDocument();
  expect(
    screen.queryByTestId(`model-table-${pageCase.table}`),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("card-model-detail-SSO Settings"),
  ).not.toBeInTheDocument();

  for (const testId of REQUIRE_SSO_SWITCH_CARDS) {
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
  }
};

const pinCloud: (plan: string | null) => void = (plan: string | null): void => {
  billingEnabledForTest = true;
  // The Cloud runs the Enterprise image: its effective edition is true.
  enterpriseEditionForTest = true;
  currentPlanForTest = plan;
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
  licenseAnswer = null;
  projectRequiresSsoForTest = null;
  statusPageRequiresSsoForTest = null;
  providerCountForTest = 0;
  mockDefaultInviteTeam.team = null;
  mockDefaultInviteTeam.lookups = 0;
  clearPlugins();

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): string | null => {
      if (currentPlanThrows) {
        throw new Error("Plan ID is invalid");
      }

      return currentPlanForTest;
    },
  );

  apiFetch = getJestSpyOn(API, "fetch").mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      if (requestUrl(args).endsWith("/count")) {
        if (providerCountForTest === null) {
          throw new Error("network down");
        }

        return {
          isSuccess: (): boolean => {
            return true;
          },
          data: { count: providerCountForTest },
        };
      }

      if (
        requestUrl(args).includes(`/status-page/${STATUS_PAGE_ID}/get-item`)
      ) {
        if (statusPageRequiresSsoForTest === null) {
          throw new Error("network down");
        }

        return {
          isSuccess: (): boolean => {
            return true;
          },
          data: {
            _id: STATUS_PAGE_ID,
            requireSsoForLogin: statusPageRequiresSsoForTest,
          },
        };
      }

      if (requestUrl(args).includes(`/project/${PROJECT_ID}/get-item`)) {
        if (projectRequiresSsoForTest === null) {
          throw new Error("network down");
        }

        return {
          isSuccess: (): boolean => {
            return true;
          },
          data: {
            _id: PROJECT_ID,
            requireSsoForLogin: projectRequiresSsoForTest,
          },
        };
      }

      if (!licenseAnswer) {
        throw new Error("network down");
      }

      return {
        isSuccess: (): boolean => {
          return true;
        },
        data: licenseAnswer,
      };
    },
  );
});

afterEach(() => {
  cleanup();
  clearPlugins();
  jest.restoreAllMocks();
});

describe.each(PAGE_CASES)("$name", (pageCase: PageCase) => {
  test.each([
    ["the Community Edition", false],
    ["the Enterprise Edition", true],
  ])(
    "on %s (billing off): the configuration screen, with create, edit and delete",
    (_edition: string, isEnterprise: boolean) => {
      enterpriseEditionForTest = isEnterprise;

      renderPage(pageCase);

      expectConfigurationScreen(pageCase);
    },
  );

  test.each(LICENSE_ANSWERS)(
    "on the Enterprise Edition with a license that is %s: the same screen, and the license is never asked for",
    async (_state: string, answer: JSONObject | null) => {
      enterpriseEditionForTest = true;
      licenseAnswer = answer;

      renderPage(pageCase);

      // Give a license request, had one been made, the time to land.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expectConfigurationScreen(pageCase);
    },
  );

  test("the create form offers every provider setting", () => {
    renderPage(pageCase);

    expect(providerTable(pageCase)).toHaveAttribute(
      "data-form-fields",
      pageCase.formFields.join("|"),
    );
  });

  test("prints the identity provider URLs byte for byte", () => {
    renderPage(pageCase);

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: pageCase.viewAction }));

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      pageCase.modalTitle,
    );

    for (const printed of pageCase.printed) {
      // The exact text of one element: no prefix, no suffix, no other path.
      expect(
        within(modal).getByText(printed, { exact: true }),
      ).toBeInTheDocument();
    }

    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("links to the page that tests single sign-on, byte for byte", () => {
    renderPage(pageCase);

    const link: HTMLElement = screen.getByText(pageCase.testLink, {
      exact: true,
    });

    expect(link.closest("a")).toHaveAttribute("href", pageCase.testLink);
  });

  if (pageCase.attachesToStatusPage) {
    test("a new provider is created on this status page, in its project", async () => {
      renderPage(pageCase);

      await act(async () => {
        fireEvent.click(screen.getByTestId(`create-${pageCase.table}`));
      });

      expect(screen.getByTestId(`created-${pageCase.table}`)).toHaveTextContent(
        `${STATUS_PAGE_ID}|${PROJECT_ID}`,
      );
    });
  }

  test.each([PlanType.Free, PlanType.Growth])(
    "on OneUptime Cloud with the %s plan: the Scale plan upsell, never the screen",
    async (plan: PlanType) => {
      pinCloud(plan);

      renderPage(pageCase);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expectPlanUpsell(pageCase);
      expect(licenseRequests()).toEqual([]);

      /*
       * Every page counts the providers it still has (none here). The two
       * SAML pages also ask whether SSO is still required - the project's,
       * or the status page's - so it can be turned off (it is not here).
       */
      expect(allRequests().sort()).toEqual(
        [
          ...(pageCase.name === "Settings > SSO" ? [PROJECT_READ_URL] : []),
          ...(pageCase.name === "Status page > SSO"
            ? [STATUS_PAGE_READ_URL]
            : []),
          countUrl(pageCase.leftover.countPath),
        ].sort(),
      );
      expect(
        screen.queryByTestId(`model-table-${pageCase.leftover.table}`),
      ).not.toBeInTheDocument();
    },
  );

  test.each([PlanType.Scale, PlanType.Enterprise])(
    "on OneUptime Cloud with the %s plan: the configuration screen",
    (plan: PlanType) => {
      pinCloud(plan);

      renderPage(pageCase);

      expectConfigurationScreen(pageCase);
    },
  );

  test("on OneUptime Cloud with no plan, or one the Dashboard cannot read: the upsell (fails closed)", () => {
    pinCloud(null);

    const { unmount } = renderPage(pageCase);

    expectPlanUpsell(pageCase);
    unmount();

    currentPlanThrows = true;

    renderPage(pageCase);

    expectPlanUpsell(pageCase);
  });

  test("on OneUptime Cloud the plan is read on every render: the screen appears once the plan allows it, and back", () => {
    pinCloud(null);

    const { rerender } = renderPage(pageCase);

    expectPlanUpsell(pageCase);

    const renderAgain: () => void = (): void => {
      rerender(
        <pageCase.Page
          pageRoute={new Route(pageCase.path)}
          currentProject={makeProject()}
          hasPaymentMethod={true}
        />,
      );
    };

    // The project's plan loads (or is upgraded) after the page mounted.
    currentPlanForTest = PlanType.Scale;
    renderAgain();

    expectConfigurationScreen(pageCase);

    // And a downgrade takes the screen away again, without breaking hooks.
    currentPlanForTest = PlanType.Growth;
    renderAgain();

    expectPlanUpsell(pageCase);

    currentPlanForTest = PlanType.Enterprise;
    renderAgain();

    expectConfigurationScreen(pageCase);
  });

  test.each([
    ["the Community Edition", false],
    ["the Enterprise Edition", true],
  ])(
    "on %s an Enterprise plugin for the screen changes nothing: the page is core",
    (_edition: string, isEnterprise: boolean) => {
      enterpriseEditionForTest = isEnterprise;

      const FakeEnterpriseScreen: FunctionComponent = (): ReactElement => {
        return <div data-testid="enterprise-screen" />;
      };

      mockEnterprisePlugins[pageCase.retiredPluginKey] = FakeEnterpriseScreen;

      // The plugin really is on offer to anything that reads the door.
      expect(
        (getDashboardPlugins() as Record<string, unknown>)[
          pageCase.retiredPluginKey
        ],
      ).toBe(FakeEnterpriseScreen);

      renderPage(pageCase);

      expect(screen.queryByTestId("enterprise-screen")).not.toBeInTheDocument();
      expectConfigurationScreen(pageCase);
    },
  );
});

/*
 * Adding a provider - SAML or OIDC - asks for what the identity provider
 * gives on a Provider step (SAML: name, sign-on URL, issuer, certificate;
 * OIDC: name, issuer, client ID and secret), and keeps the rest on a Sign-in
 * step, filled in (Common/UI/Components/Sso/SamlProviderFormFields and
 * OidcProviderFormFields; their own tests pin the fields). Once a provider
 * is saved, the dialog with what to give the identity provider opens
 * straight away - the Entity ID and Reply URL, or the redirect URI - and
 * says the provider is off until it is turned on. A project's provider
 * starts on the team the project's members join.
 */
const MEMBERS_TEAM_ID: string = "44444444-4444-4444-8444-444444444444";

test("the stand-in table saves dialogs the way the real one names them", () => {
  expect(mockModalTypes).toEqual({
    create: ModalType.Create,
    edit: ModalType.Edit,
  });
});

describe.each(PAGE_CASES)("$name: adding a provider", (pageCase: PageCase) => {
  test("walks Provider, then Sign-in", () => {
    renderPage(pageCase);

    expect(providerTable(pageCase)).toHaveAttribute(
      "data-form-steps",
      "provider: Provider|sign-in: Sign-in",
    );
  });

  test("opens what to give the identity provider as soon as one is saved, and says it is off", async () => {
    renderPage(pageCase);

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`saved-${pageCase.table}-off`));
    });

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      pageCase.modalTitle,
    );

    for (const printed of pageCase.printed) {
      expect(
        within(modal).getByText(printed, { exact: true }),
      ).toBeInTheDocument();
    }

    expect(
      within(modal).getByTestId(pageCase.turnOnNote.testId),
    ).toHaveTextContent(pageCase.turnOnNote.text);

    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("a provider saved switched on has nothing left to turn on", async () => {
    renderPage(pageCase);

    await act(async () => {
      fireEvent.click(screen.getByTestId(`saved-${pageCase.table}-on`));
    });

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(within(modal).getByText(pageCase.printed[0]!)).toBeInTheDocument();
    expect(
      within(modal).queryByTestId(pageCase.turnOnNote.testId),
    ).not.toBeInTheDocument();
  });

  test("saving an edit opens nothing", async () => {
    renderPage(pageCase);

    await act(async () => {
      fireEvent.click(screen.getByTestId(`edited-${pageCase.table}`));
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("the dialog opened from a row that is off says so too", () => {
    renderPage(pageCase);

    fireEvent.click(screen.getByRole("button", { name: pageCase.viewAction }));

    expect(
      within(screen.getByTestId("modal")).getByTestId(
        pageCase.turnOnNote.testId,
      ),
    ).toHaveTextContent(pageCase.turnOnNote.text);
  });
});

/*
 * The two dialogs say the same thing about a provider that is off, each
 * naming what its identity provider is given.
 */
test("the SAML and OIDC dialogs word the provider that is off alike", () => {
  expect(
    SAML_TURN_ON_NOTE.text.replace("the Entity ID and Reply URL", "X"),
  ).toBe(OIDC_TURN_ON_NOTE.text.replace("the redirect URI", "X"));
});

describe.each(
  PAGE_CASES.filter((pageCase: PageCase): boolean => {
    return pageCase.startsOnMembersTeam;
  }),
)(
  "$name: a project's new provider starts on the members team",
  (pageCase: PageCase) => {
    test("looked up once as the page opens, and handed to the Create form", async () => {
      mockDefaultInviteTeam.team = { id: MEMBERS_TEAM_ID, name: "Members" };

      renderPage(pageCase);

      await waitFor(() => {
        expect(providerTable(pageCase)).toHaveAttribute(
          "data-create-initial-values",
          JSON.stringify({ teams: [MEMBERS_TEAM_ID] }),
        );
      });

      expect(mockDefaultInviteTeam.lookups).toBe(1);
    });

    test("with nothing picked when the project has no team to start on", async () => {
      renderPage(pageCase);

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockDefaultInviteTeam.lookups).toBe(1);
      expect(providerTable(pageCase)).toHaveAttribute(
        "data-create-initial-values",
        "null",
      );
    });

    test("behind the plan upsell, nothing is looked up", async () => {
      pinCloud(PlanType.Growth);

      renderPage(pageCase);

      await act(async () => {
        await Promise.resolve();
      });

      expectPlanUpsell(pageCase);
      expect(mockDefaultInviteTeam.lookups).toBe(0);
    });
  },
);

describe.each(
  PAGE_CASES.filter((pageCase: PageCase): boolean => {
    return !pageCase.startsOnMembersTeam;
  }),
)("$name: a status page's provider has no teams", (pageCase: PageCase) => {
  test("so nothing is looked up", async () => {
    mockDefaultInviteTeam.team = { id: MEMBERS_TEAM_ID, name: "Members" };

    renderPage(pageCase);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockDefaultInviteTeam.lookups).toBe(0);
    expect(providerTable(pageCase)).toHaveAttribute(
      "data-create-initial-values",
      "null",
    );
    expect(
      providerTable(pageCase).getAttribute("data-form-fields"),
    ).not.toMatch(/teams/);
  });
});

/*
 * Settings > SSO below Scale: a project a Scale trial (or a move down from
 * Scale) left requiring SSO still requires it, and its providers still sign
 * people in. A paid feature can always be switched off, on any plan, so the
 * switch is drawn under the upsell while the project requires SSO - with no
 * line about the test link, which is not on that page - and turning it off
 * asks nothing, as on the full page.
 */
describe("Settings > SSO below Scale: Require SSO for Login stays reachable while the project requires it", () => {
  const settingsSso: PageCase = PAGE_CASES.find(
    (pageCase: PageCase): boolean => {
      return pageCase.name === "Settings > SSO";
    },
  ) as PageCase;

  const settle: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      for (let i: number = 0; i < 6; i++) {
        await Promise.resolve();
      }
    });
  };

  test.each([PlanType.Free, PlanType.Growth])(
    "on %s, a project that requires SSO gets the switch under the upsell",
    async (plan: PlanType) => {
      pinCloud(plan);
      projectRequiresSsoForTest = true;

      renderPage(settingsSso);

      await settle();

      // Still the upsell: no providers, no test link.
      expect(screen.getAllByText("Upgrade to Scale")).toHaveLength(2);
      expect(
        screen.queryByTestId(`model-table-${settingsSso.table}`),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(settingsSso.testLink, { exact: true }),
      ).not.toBeInTheDocument();

      const requireSso: HTMLElement = screen.getByTestId(
        REQUIRE_SSO_SWITCH_CARD,
      );

      expect(requireSso).toHaveAttribute("data-model", "Project");
      expect(requireSso).toHaveAttribute("data-model-id", PROJECT_ID);
      expect(requireSso).toHaveAttribute("data-column", "requireSsoForLogin");
      expect(requireSso).toHaveAttribute("data-card-title", "SSO Settings");
      // No "test with the link above": the link is not on this page.
      expect(requireSso).toHaveAttribute("data-card-description", "");
      expect(requireSso).toHaveAttribute("data-title", "Require SSO for Login");
      // Turning it off asks nothing; turning it on still asks, in red.
      expect(requireSso).toHaveAttribute("data-asks-turning-off", "false");
      expect(requireSso).toHaveAttribute("data-asks-turning-on", "true");
      expect(requireSso).toHaveAttribute("data-danger-turning-on", "true");
      /*
       * Drawn only to be switched off: once off it locks, naming the plan
       * turning it on again needs, so the switch cannot be pressed into a
       * refusal. And it starts from the project already read for it: the
       * card reads nothing more.
       */
      expect(requireSso).toHaveAttribute("data-locks-when-plan-needed", "true");
      expect(requireSso).toHaveAttribute("data-initial-item-id", PROJECT_ID);
      expect(requireSso).toHaveAttribute("data-initial-value", "true");

      // Under the upsell, not in place of it.
      expect(
        Boolean(
          screen
            .getByText(settingsSso.featureName)
            .compareDocumentPosition(requireSso) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).toBe(true);

      /*
       * It asked only whether the project requires SSO, and how many
       * providers are left - never for the license.
       */
      expect(allRequests().sort()).toEqual(
        [PROJECT_READ_URL, countUrl("/project-sso")].sort(),
      );
      expect(
        apiFetch.mock.calls.find((call: Array<unknown>): boolean => {
          return requestUrl(call) === PROJECT_READ_URL;
        })![0],
      ).toEqual(
        expect.objectContaining({
          data: { select: { requireSsoForLogin: true } },
        }),
      );
    },
  );

  test("a project that does not require SSO gets the upsell alone", async () => {
    pinCloud(PlanType.Free);
    projectRequiresSsoForTest = false;

    renderPage(settingsSso);

    await settle();

    expectPlanUpsell(settingsSso);
  });

  test("a read that fails draws nothing more: the upsell is the page", async () => {
    pinCloud(PlanType.Growth);
    projectRequiresSsoForTest = null;

    renderPage(settingsSso);

    await settle();

    expectPlanUpsell(settingsSso);
  });

  test("on a plan that has SSO the full page's switch is the one shown, with its test link line", async () => {
    pinCloud(PlanType.Scale);
    projectRequiresSsoForTest = true;

    renderPage(settingsSso);

    await settle();

    expect(screen.getAllByTestId(REQUIRE_SSO_SWITCH_CARD)).toHaveLength(1);
    expect(screen.getByTestId(REQUIRE_SSO_SWITCH_CARD)).toHaveAttribute(
      "data-card-description",
      "Test SSO with the link above before you require it.",
    );
    // The full page's switch is not a leftover: it never locks, and reads its own.
    expect(screen.getByTestId(REQUIRE_SSO_SWITCH_CARD)).toHaveAttribute(
      "data-locks-when-plan-needed",
      "false",
    );
    expect(screen.getByTestId(REQUIRE_SSO_SWITCH_CARD)).toHaveAttribute(
      "data-initial-item-id",
      "",
    );
    // The page itself knows: nothing is read for the switch under an upsell.
    expect(allRequests()).toEqual([]);
  });

  test("the status page SSO page never draws the project's switch", async () => {
    const statusPageSso: PageCase = PAGE_CASES.find(
      (pageCase: PageCase): boolean => {
        return pageCase.name === "Status page > SSO";
      },
    ) as PageCase;

    pinCloud(PlanType.Free);
    projectRequiresSsoForTest = true;

    renderPage(statusPageSso);

    await settle();

    expectPlanUpsell(statusPageSso);
    // Its own: whether the status page requires SSO, and its providers.
    expect(allRequests().sort()).toEqual(
      [STATUS_PAGE_READ_URL, countUrl("/status-page-sso")].sort(),
    );
  });
});

/*
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed. A provider a Scale trial left keeps signing people in, so below
 * Scale each page lists the providers it still has under the upsell
 * (PlanLeftoverTable): nothing to add or edit, Turn off for the ones that
 * are on, Delete for all. Its behaviour is PlanLeftoverTable.test.tsx's;
 * here, that every page draws it, for its own providers, in the right
 * place.
 */
describe.each(PAGE_CASES)(
  "$name below Scale: the providers it still has",
  (pageCase: PageCase) => {
    const settle: () => Promise<void> = async (): Promise<void> => {
      await act(async () => {
        for (let i: number = 0; i < 8; i++) {
          await Promise.resolve();
        }
      });
    };

    test.each([PlanType.Free, PlanType.Growth])(
      "on %s they are listed under the upsell, to turn off or delete, and nothing can be added or edited",
      async (plan: PlanType) => {
        pinCloud(plan);
        providerCountForTest = 2;

        renderPage(pageCase);

        await settle();

        // Still the upsell: the configuration screen is not there.
        expect(screen.getAllByText("Upgrade to Scale")).toHaveLength(2);
        expect(
          screen.queryByTestId(`model-table-${pageCase.table}`),
        ).not.toBeInTheDocument();

        const leftover: HTMLElement = screen.getByTestId(
          `model-table-${pageCase.leftover.table}`,
        );

        expect(leftover).toHaveAttribute("data-createable", "false");
        expect(leftover).toHaveAttribute("data-editable", "false");
        expect(leftover).toHaveAttribute("data-deleteable", "true");
        expect(leftover).toHaveAttribute("data-form-fields", "");

        // Under the upsell, not in place of it.
        expect(
          Boolean(
            screen
              .getByText(pageCase.featureName)
              .compareDocumentPosition(leftover) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        ).toBe(true);

        expect(licenseRequests()).toEqual([]);
      },
    );

    test("a count that fails draws nothing more: the upsell is the page", async () => {
      pinCloud(PlanType.Free);
      providerCountForTest = null;

      renderPage(pageCase);

      await settle();

      expectPlanUpsell(pageCase);
      expect(
        screen.queryByTestId(`model-table-${pageCase.leftover.table}`),
      ).not.toBeInTheDocument();
    });

    test("on Scale the configuration screen is the page, and nothing is counted for it", async () => {
      pinCloud(PlanType.Scale);
      providerCountForTest = 2;

      renderPage(pageCase);

      await settle();

      expectConfigurationScreen(pageCase);
      expect(
        screen.queryByTestId(`model-table-${pageCase.leftover.table}`),
      ).not.toBeInTheDocument();
      expect(
        allRequests().filter((url: string): boolean => {
          return url.endsWith("/count");
        }),
      ).toEqual([]);
    });

    test("with billing off (self-hosted) the configuration screen is the page, and nothing is counted", async () => {
      providerCountForTest = 2;

      renderPage(pageCase);

      await settle();

      expectConfigurationScreen(pageCase);
      expect(
        allRequests().filter((url: string): boolean => {
          return url.endsWith("/count");
        }),
      ).toEqual([]);
    });
  },
);

describe("Status page > SSO below Scale: Require SSO for Login stays reachable while the status page requires it", () => {
  const statusPageSso: PageCase = PAGE_CASES.find(
    (pageCase: PageCase): boolean => {
      return pageCase.name === "Status page > SSO";
    },
  ) as PageCase;

  const settle: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      for (let i: number = 0; i < 8; i++) {
        await Promise.resolve();
      }
    });
  };

  test.each([PlanType.Free, PlanType.Growth])(
    "on %s, a status page that requires SSO gets its switch under the upsell, so turning its providers off cannot shut its viewers out",
    async (plan: PlanType) => {
      pinCloud(plan);
      statusPageRequiresSsoForTest = true;

      renderPage(statusPageSso);

      await settle();

      expect(screen.getAllByText("Upgrade to Scale")).toHaveLength(2);

      const requireSso: HTMLElement = screen.getByTestId(
        STATUS_PAGE_REQUIRE_SSO_SWITCH_CARD,
      );

      expect(requireSso).toHaveAttribute("data-model", "StatusPage");
      expect(requireSso).toHaveAttribute("data-model-id", STATUS_PAGE_ID);
      expect(requireSso).toHaveAttribute("data-column", "requireSsoForLogin");
      expect(requireSso).toHaveAttribute("data-title", "Require SSO for Login");
      // No "test with the link above": the link is not on this page.
      expect(requireSso).toHaveAttribute("data-card-description", "");
      // It starts from the status page already read for it.
      expect(requireSso).toHaveAttribute(
        "data-initial-item-id",
        STATUS_PAGE_ID,
      );
      expect(requireSso).toHaveAttribute("data-initial-value", "true");

      // The project's switch is not on a status page's page.
      expect(
        screen.queryByTestId(REQUIRE_SSO_SWITCH_CARD),
      ).not.toBeInTheDocument();
    },
  );

  test("a status page that does not require SSO gets no switch", async () => {
    pinCloud(PlanType.Free);
    statusPageRequiresSsoForTest = false;

    renderPage(statusPageSso);

    await settle();

    expectPlanUpsell(statusPageSso);
  });

  test("the OIDC page never draws it", async () => {
    const statusPageOidc: PageCase = PAGE_CASES.find(
      (pageCase: PageCase): boolean => {
        return pageCase.name === "Status page > OIDC";
      },
    ) as PageCase;

    pinCloud(PlanType.Free);
    statusPageRequiresSsoForTest = true;

    renderPage(statusPageOidc);

    await settle();

    expectPlanUpsell(statusPageOidc);
    expect(allRequests()).toEqual([countUrl("/status-page-oidc")]);
  });
});

test("every provider page is one of those two kinds", () => {
  expect(
    PAGE_CASES.map((pageCase: PageCase): string => {
      return `${pageCase.name}: ${pageCase.startsOnMembersTeam}`;
    }),
  ).toEqual([
    "Settings > SSO: true",
    "Settings > OIDC: true",
    "Status page > SSO: false",
    "Status page > OIDC: false",
  ]);
});
