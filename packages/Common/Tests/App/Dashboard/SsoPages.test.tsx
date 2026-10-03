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
 * provider table offers create, edit and delete, there is no "Disable" row
 * action and no license banner or notice, requiring SSO (on the two SAML
 * pages) can always be changed - the project's "Require SSO for Login" is a
 * switch that saves on flip and asks first, the status page's "Force SSO
 * for Login" a card with its usual description - and the page never asks
 * the server for the license. On OneUptime Cloud (billing on) only the
 * plan decides: a project below Scale, or one whose plan cannot be read,
 * sees the Scale plan upsell - never the Enterprise Edition one.
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
 * The team a project's new OIDC provider starts on (Utils/DefaultInviteTeam,
 * looked up when Settings > OIDC opens). Stubbed so the pages make no
 * request at all here; its own suite tests the lookup.
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
      title: string;
      getConfirmation?:
        | ((isTurningOn: boolean) => MockSwitchConfirmation | undefined)
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
          data-title={props.title}
          data-asks-turning-on={String(Boolean(turningOn))}
          data-asks-turning-off={String(Boolean(turningOff))}
          data-danger-turning-on={String(
            turningOn?.submitButtonType ===
              buttonModule.ButtonStyleType["DANGER"],
          )}
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

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID: string = mockProviderRow._id;

// The project's "Require SSO for Login" switch card, as the stand-in draws it.
const REQUIRE_SSO_SWITCH_CARD: string =
  "model-switch-card-project-require-sso-switch";

const FORCE_SSO_FORM_DESCRIPTION: string =
  "Please test SSO before you you enable this feature. If SSO is not tested properly then you will be locked out of the project.";

interface ForceSsoCard {
  model: string;
  modelId: string;
  detailDescription: string;
}

// The project's "Require SSO for Login" switch (RequireSsoForLoginCard).
interface RequireSsoSwitch {
  modelId: string;
}

interface PageCase {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  path: string;
  table: string;
  viewAction: string;
  modalTitle: string;
  // What the configuration dialog prints for the identity provider, exactly.
  printed: Array<string>;
  // The "test it before you force it" link, exactly.
  testLink: string;
  forceSsoCard: ForceSsoCard | null;
  requireSsoSwitch: RequireSsoSwitch | null;
  // Columns the create / edit form writes.
  formFields: Array<string>;
  // Status pages attach new providers to the page and its project.
  attachesToStatusPage: boolean;
  upsellTitle: string;
  featureName: string;
  // The plugin key that used to serve the screen from ee/.
  retiredPluginKey: string;
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
    testLink: `https://oneuptime.example.com/dashboard/${PROJECT_ID}/sso`,
    forceSsoCard: null,
    requireSsoSwitch: { modelId: PROJECT_ID },
    formFields: [
      "name",
      "description",
      "signOnURL",
      "issuerURL",
      "publicCertificate",
      "signatureMethod",
      "digestMethod",
      "isEnabled",
      "teams",
    ],
    attachesToStatusPage: false,
    upsellTitle: "Single Sign On (SSO)",
    featureName: "SAML Single Sign On",
    retiredPluginKey: "SettingsSSO",
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
    testLink: `https://oneuptime.example.com/dashboard/${PROJECT_ID}/sso`,
    forceSsoCard: null,
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
    testLink: `https://oneuptime.example.com/status-page/${STATUS_PAGE_ID}/sso`,
    forceSsoCard: {
      model: "StatusPage",
      modelId: STATUS_PAGE_ID,
      detailDescription:
        "Please test SSO before you enable this feature. If SSO is not tested properly then you will be locked out of the status page.",
    },
    requireSsoSwitch: null,
    formFields: [
      "name",
      "description",
      "signOnURL",
      "issuerURL",
      "publicCertificate",
      "signatureMethod",
      "digestMethod",
      "isEnabled",
    ],
    attachesToStatusPage: true,
    upsellTitle: "Status Page SSO",
    featureName: "Status Page SAML SSO",
    retiredPluginKey: "StatusPageSSO",
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
    testLink: `https://oneuptime.example.com/status-page/${STATUS_PAGE_ID}/sso`,
    forceSsoCard: null,
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

  if (pageCase.forceSsoCard) {
    const card: HTMLElement = screen.getByTestId(
      "card-model-detail-SSO Settings",
    );

    expect(card).toHaveAttribute("data-editable", "true");
    expect(card).toHaveAttribute("data-edit-button-text", "Edit Settings");
    expect(card).toHaveAttribute("data-model", pageCase.forceSsoCard.model);
    expect(card).toHaveAttribute(
      "data-model-id",
      pageCase.forceSsoCard.modelId,
    );
    expect(card).toHaveAttribute(
      "data-form-descriptions",
      `Force SSO for Login: ${FORCE_SSO_FORM_DESCRIPTION}`,
    );
    expect(card).toHaveAttribute(
      "data-detail-descriptions",
      `Force SSO for Login: ${pageCase.forceSsoCard.detailDescription}`,
    );
  } else {
    expect(
      screen.queryByTestId("card-model-detail-SSO Settings"),
    ).not.toBeInTheDocument();
  }

  if (pageCase.requireSsoSwitch) {
    /*
     * The project's switch: it saves when flipped, asks with a red button
     * before it locks people out, and never asks to turn it off.
     */
    const requireSso: HTMLElement = screen.getByTestId(REQUIRE_SSO_SWITCH_CARD);

    expect(requireSso).toHaveAttribute("data-model", "Project");
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
  } else {
    expect(
      screen.queryByTestId(REQUIRE_SSO_SWITCH_CARD),
    ).not.toBeInTheDocument();
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
  expect(apiFetch).not.toHaveBeenCalled();
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
  expect(screen.queryByTestId(REQUIRE_SSO_SWITCH_CARD)).not.toBeInTheDocument();
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
    async (): Promise<unknown> => {
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
    (plan: PlanType) => {
      pinCloud(plan);

      renderPage(pageCase);

      expectPlanUpsell(pageCase);
      expect(apiFetch).not.toHaveBeenCalled();
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
 * Adding an OIDC provider asks for what the identity provider gives - name,
 * issuer, client ID and secret - on a Provider step, and keeps the rest on a
 * Sign-in step, filled in (Common/UI/Components/Sso/OidcProviderFormFields;
 * its own tests pin the fields). Once a provider is saved, the dialog with
 * the redirect URI to give the identity provider opens straight away, and
 * says the provider is off until it is turned on. A project's provider
 * starts on the team the project's members join.
 */
const OIDC_PAGE_CASES: Array<PageCase> = PAGE_CASES.filter(
  (pageCase: PageCase): boolean => {
    return pageCase.viewAction === "View OIDC Config";
  },
);

const TURN_ON_NOTE: string =
  "This provider is off. Once your identity provider has the redirect URI above, edit the provider and turn Enabled on.";

const MEMBERS_TEAM_ID: string = "44444444-4444-4444-8444-444444444444";

test("the stand-in table saves dialogs the way the real one names them", () => {
  expect(mockModalTypes).toEqual({
    create: ModalType.Create,
    edit: ModalType.Edit,
  });
});

describe.each(OIDC_PAGE_CASES)(
  "$name: adding a provider",
  (pageCase: PageCase) => {
    test("walks Provider, then Sign-in", () => {
      renderPage(pageCase);

      expect(providerTable(pageCase)).toHaveAttribute(
        "data-form-steps",
        "provider: Provider|sign-in: Sign-in",
      );
    });

    test("opens the redirect URI to give the identity provider as soon as one is saved, and says it is off", async () => {
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
        within(modal).getByTestId("oidc-config-turn-on-note"),
      ).toHaveTextContent(TURN_ON_NOTE);

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
        within(modal).queryByTestId("oidc-config-turn-on-note"),
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

      fireEvent.click(
        screen.getByRole("button", { name: pageCase.viewAction }),
      );

      expect(
        within(screen.getByTestId("modal")).getByTestId(
          "oidc-config-turn-on-note",
        ),
      ).toHaveTextContent(TURN_ON_NOTE);
    });
  },
);

describe("a project's new OIDC provider starts on the members team", () => {
  const SETTINGS_OIDC: PageCase = OIDC_PAGE_CASES.find(
    (pageCase: PageCase): boolean => {
      return pageCase.name === "Settings > OIDC";
    },
  )!;
  const STATUS_PAGE_OIDC: PageCase = OIDC_PAGE_CASES.find(
    (pageCase: PageCase): boolean => {
      return pageCase.name === "Status page > OIDC";
    },
  )!;

  test("looked up once as the page opens, and handed to the Create form", async () => {
    mockDefaultInviteTeam.team = { id: MEMBERS_TEAM_ID, name: "Members" };

    renderPage(SETTINGS_OIDC);

    await waitFor(() => {
      expect(providerTable(SETTINGS_OIDC)).toHaveAttribute(
        "data-create-initial-values",
        JSON.stringify({ teams: [MEMBERS_TEAM_ID] }),
      );
    });

    expect(mockDefaultInviteTeam.lookups).toBe(1);
  });

  test("with nothing picked when the project has no team to start on", async () => {
    renderPage(SETTINGS_OIDC);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockDefaultInviteTeam.lookups).toBe(1);
    expect(providerTable(SETTINGS_OIDC)).toHaveAttribute(
      "data-create-initial-values",
      "null",
    );
  });

  test("a status page's provider has no teams, so nothing is looked up", async () => {
    mockDefaultInviteTeam.team = { id: MEMBERS_TEAM_ID, name: "Members" };

    renderPage(STATUS_PAGE_OIDC);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockDefaultInviteTeam.lookups).toBe(0);
    expect(providerTable(STATUS_PAGE_OIDC)).toHaveAttribute(
      "data-create-initial-values",
      "null",
    );
  });

  test("behind the plan upsell, nothing is looked up", async () => {
    pinCloud(PlanType.Growth);

    renderPage(SETTINGS_OIDC);

    await act(async () => {
      await Promise.resolve();
    });

    expectPlanUpsell(SETTINGS_OIDC);
    expect(mockDefaultInviteTeam.lookups).toBe(0);
  });
});
