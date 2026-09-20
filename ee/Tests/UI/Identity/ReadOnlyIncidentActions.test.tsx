import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The incident-response actions on the Enterprise identity screens while the
 * license makes their configuration read-only (expired, missing or invalid,
 * after the grace period).
 *
 * The server still accepts two updates then, because they can only tighten
 * security (TIGHTEN_ONLY_UPDATES in Common's EditionPermission): exactly
 * { isEnabled: false } on an SSO / OIDC provider or a global provider's
 * project attachment, and exactly { bearerToken: <32+ characters> } on a SCIM
 * configuration. Every screen that manages one of those models offers it:
 *
 *   "Disable"             on each enabled provider row, and on each enabled
 *                         project attachment of a global provider;
 *   "Disable Provider"    on a global provider's own page;
 *   "Reset Bearer Token"  on each SCIM configuration (shows the new token once).
 *
 * For every screen this checks that the action is there in read-only mode,
 * that it sends exactly one update - to the right model, the right row, on the
 * right API client, with exactly the allowed column - that the screen shows
 * the result, that a refusal (402 or anything else) is shown, that nothing is
 * sent on cancel, that an already-disabled provider has no Disable, and that
 * none of it appears while configuration is editable (valid license, grace
 * period, unreadable license, OneUptime Cloud).
 *
 * The model tables and the configuration card are replaced by stand-ins that
 * behave like the real ones where it matters: they load rows from a fake
 * server, show the page's row actions (honouring isVisible) and reload when
 * the page asks them to. The fake server applies accepted updates, so a
 * reload shows what the server now holds. Billing is pinned in every test:
 * CI's config.env sets BILLING_ENABLED=true.
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
      // The real message extraction: what an admin sees for a 402.
      getFriendlyMessage: (err: unknown): string => {
        const actual: {
          default: { getFriendlyMessage: (error: unknown) => string };
        } = jest.requireActual("Common/UI/Utils/API/API");

        return actual.default.getFriendlyMessage(err);
      },
    },
  };
});

// The fake server: rows per table, and the item behind each detail card.
type MockRecord = { [column: string]: unknown };

const mockTableRows: { [tableId: string]: Array<MockRecord> } = {};
const mockTableLoads: { [tableId: string]: number } = {};
const mockDetailItems: { [cardName: string]: MockRecord } = {};
const mockDetailLoads: { [cardName: string]: number } = {};

interface MockActionButton {
  title: string;
  isVisible?: ((item: unknown) => boolean | undefined) | undefined;
  onClick: (
    item: unknown,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
}

interface MockModelTableProps {
  id: string;
  modelType: { new (): unknown };
  refreshToggle?: string | undefined;
  actionButtons?: Array<MockActionButton> | undefined;
}

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  const MockModelTable: (props: MockModelTableProps) => ReactElement = (
    props: MockModelTableProps,
  ): ReactElement => {
    const [rows, setRows] = React.useState<Array<unknown>>([]);
    const [rowError, setRowError] = React.useState<string>("");

    // Like the real table: load on mount and whenever refreshToggle changes.
    React.useEffect(() => {
      mockTableLoads[props.id] = (mockTableLoads[props.id] || 0) + 1;

      setRows(
        (mockTableRows[props.id] || []).map((row: MockRecord): unknown => {
          // The real table hands its actions model instances.
          return Object.assign(
            new props.modelType() as Record<string, unknown>,
            row,
          );
        }),
      );
    }, [props.refreshToggle]);

    return (
      <div data-testid={`model-table-${props.id}`}>
        {rows.map((row: unknown) => {
          const record: MockRecord = row as MockRecord;

          return (
            <div
              key={String(record["_id"])}
              data-testid={`row-${props.id}-${String(record["_id"])}`}
              data-enabled={String(record["isEnabled"])}
              data-bearer-token={String(record["bearerToken"])}
            >
              {(props.actionButtons || [])
                .filter((button: MockActionButton) => {
                  return !button.isVisible || Boolean(button.isVisible(row));
                })
                .map((button: MockActionButton) => {
                  return (
                    <button
                      key={button.title}
                      type="button"
                      onClick={() => {
                        button.onClick(
                          row,
                          () => {},
                          (error: Error) => {
                            setRowError(error.message);
                          },
                        );
                      }}
                    >
                      {button.title}
                    </button>
                  );
                })}
            </div>
          );
        })}
        {rowError ? (
          <div data-testid={`row-error-${props.id}`}>{rowError}</div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return { __esModule: true, default: MockModelTable };
});

interface MockCardModelDetailProps {
  name: string;
  refresher?: boolean | undefined;
  modelDetailProps: {
    modelType: { new (): unknown };
    onItemLoaded?: ((item: unknown) => void) | undefined;
  };
}

jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  const MockCardModelDetail: (
    props: MockCardModelDetailProps,
  ) => ReactElement = (props: MockCardModelDetailProps): ReactElement => {
    const [item, setItem] = React.useState<MockRecord | null>(null);

    // Like the real card: load on mount and whenever refresher changes.
    React.useEffect(() => {
      mockDetailLoads[props.name] = (mockDetailLoads[props.name] || 0) + 1;

      const stored: MockRecord | undefined = mockDetailItems[props.name];

      if (!stored) {
        return;
      }

      const loaded: unknown = Object.assign(
        new props.modelDetailProps.modelType() as Record<string, unknown>,
        stored,
      );

      setItem({ ...stored });
      props.modelDetailProps.onItemLoaded?.(loaded);
    }, [props.refresher]);

    return (
      <div
        data-testid={`card-model-detail-${props.name}`}
        data-enabled={String(item ? item["isEnabled"] : undefined)}
      />
    );
  };

  return { __esModule: true, default: MockCardModelDetail };
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
import {
  DISABLE_PROJECT_ATTACHMENT_CONFIRMATION,
  DISABLE_PROVIDER_CONFIRMATION,
} from "../../../Dashboard/SSO/TightenOnly/UseDisableProviderAction";
import {
  DISABLE_PROVIDER_BUTTON_TITLE,
  DISABLE_PROVIDER_CARD_TEST_ID,
} from "../../../Dashboard/SSO/TightenOnly/DisableProviderCard";
import {
  PROVIDER_ACTIONS_TITLE,
  READ_ONLY_ACTIONS_NOTICE_TEST_ID,
  SCIM_ACTIONS_TITLE,
} from "../../../Dashboard/SSO/TightenOnly/ReadOnlyActionsNotice";
import { MIN_SCIM_BEARER_TOKEN_LENGTH } from "../../../Dashboard/SSO/TightenOnly/TightenOnlyUpdates";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "Common/Models/DatabaseModels/GlobalOidcProject";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "Common/Models/DatabaseModels/GlobalSsoProject";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";
const ENABLED_ROW_ID: string = "44444444-4444-4444-8444-444444444444";
const DISABLED_ROW_ID: string = "55555555-5555-4555-8555-555555555555";

const LICENSE_REQUIRED_MESSAGE: string =
  "An Enterprise license is required to change this configuration.";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/settings/sso`),
  currentProject: null,
  hasPaymentMethod: true,
};

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

type ApiClient = "ModelAPI" | "AdminModelAPI";

type ModelType = { new (): unknown };

interface DisableCase {
  name: string;
  render: () => ReactElement;
  path: string;
  modelType: ModelType;
  api: ApiClient;
  // A row action on this table...
  table?: string | undefined;
  // ...or the "Disable this provider" card, backed by this configuration card.
  detailCard?: string | undefined;
  confirmationTitle: string;
}

const DISABLE_CASES: Array<DisableCase> = [
  {
    name: "Settings > SSO",
    render: renderDashboardPage(SettingsSSOPage),
    path: `/dashboard/${PROJECT_ID}/settings/sso`,
    modelType: ProjectSSO,
    api: "ModelAPI",
    table: "sso-table",
    confirmationTitle: DISABLE_PROVIDER_CONFIRMATION.title,
  },
  {
    name: "Settings > OIDC",
    render: renderDashboardPage(SettingsOIDCPage),
    path: `/dashboard/${PROJECT_ID}/settings/oidc`,
    modelType: ProjectOIDC,
    api: "ModelAPI",
    table: "oidc-table",
    confirmationTitle: DISABLE_PROVIDER_CONFIRMATION.title,
  },
  {
    name: "Status page > SSO",
    render: renderDashboardPage(StatusPageSSOPage),
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/sso`,
    modelType: StatusPageSSO,
    api: "ModelAPI",
    table: "sso-table",
    confirmationTitle: DISABLE_PROVIDER_CONFIRMATION.title,
  },
  {
    name: "Status page > OIDC",
    render: renderDashboardPage(StatusPageOIDCPage),
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/oidc`,
    modelType: StatusPageOIDC,
    api: "ModelAPI",
    table: "oidc-table",
    confirmationTitle: DISABLE_PROVIDER_CONFIRMATION.title,
  },
  {
    name: "Admin > Global SSO (list)",
    render: renderAdminPage(GlobalSSOListPage),
    path: "/admin/settings/global-sso",
    modelType: GlobalSSO,
    api: "AdminModelAPI",
    table: "global-sso-table",
    confirmationTitle: DISABLE_PROVIDER_CONFIRMATION.title,
  },
  {
    name: "Admin > Global OIDC (list)",
    render: renderAdminPage(GlobalOIDCListPage),
    path: "/admin/settings/global-oidc",
    modelType: GlobalOIDC,
    api: "AdminModelAPI",
    table: "global-oidc-table",
    confirmationTitle: DISABLE_PROVIDER_CONFIRMATION.title,
  },
  {
    name: "Admin > Global SSO > provider",
    render: renderAdminPage(GlobalSSOViewPage),
    path: `/admin/settings/global-sso/${PROVIDER_ID}`,
    modelType: GlobalSSO,
    api: "AdminModelAPI",
    detailCard: "Global SSO Configuration",
    confirmationTitle: DISABLE_PROVIDER_CONFIRMATION.title,
  },
  {
    name: "Admin > Global SSO > provider > attached project",
    render: renderAdminPage(GlobalSSOViewPage),
    path: `/admin/settings/global-sso/${PROVIDER_ID}`,
    modelType: GlobalSSOProject,
    api: "AdminModelAPI",
    table: "global-sso-project-table",
    confirmationTitle: DISABLE_PROJECT_ATTACHMENT_CONFIRMATION.title,
  },
  {
    name: "Admin > Global OIDC > provider",
    render: renderAdminPage(GlobalOIDCViewPage),
    path: `/admin/settings/global-oidc/${PROVIDER_ID}`,
    modelType: GlobalOIDC,
    api: "AdminModelAPI",
    detailCard: "Global OIDC Configuration",
    confirmationTitle: DISABLE_PROVIDER_CONFIRMATION.title,
  },
  {
    name: "Admin > Global OIDC > provider > attached project",
    render: renderAdminPage(GlobalOIDCViewPage),
    path: `/admin/settings/global-oidc/${PROVIDER_ID}`,
    modelType: GlobalOIDCProject,
    api: "AdminModelAPI",
    table: "global-oidc-project-table",
    confirmationTitle: DISABLE_PROJECT_ATTACHMENT_CONFIRMATION.title,
  },
];

interface ScimCase {
  name: string;
  render: () => ReactElement;
  path: string;
  modelType: ModelType;
  table: string;
  successTitle: string;
  errorTitle: string;
}

const SCIM_CASES: Array<ScimCase> = [
  {
    name: "Settings > SCIM",
    render: renderDashboardPage(SettingsSCIMPage),
    path: `/dashboard/${PROJECT_ID}/settings/scim`,
    modelType: ProjectSCIM,
    table: "scim-table",
    successTitle: "New Bearer Token",
    errorTitle: "Reset Error",
  },
  {
    name: "Status page > SCIM",
    render: renderDashboardPage(StatusPageSCIMPage),
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/scim`,
    modelType: StatusPageSCIM,
    table: "status-page-scim-table",
    successTitle: "Bearer Token Reset",
    errorTitle: "Error",
  },
];

// Every table and card the ten screens render, emptied before each test.
const ALL_TABLES: Array<string> = [
  "sso-table",
  "oidc-table",
  "scim-table",
  "status-page-scim-table",
  "global-sso-table",
  "global-oidc-table",
  "global-sso-project-table",
  "global-oidc-project-table",
  "project-scim-logs-table",
  "status-page-scim-logs-table",
];

const ALL_DETAIL_CARDS: Array<string> = [
  "Global SSO Configuration",
  "Global OIDC Configuration",
];

// The update requests, per API client, and what the fake server answers.
interface UpdateCall {
  api: ApiClient;
  modelType: ModelType;
  id: string;
  data: JSONObject;
}

let updateCalls: Array<UpdateCall> = [];
let serverFailure: unknown = null;

const applyUpdate: (call: UpdateCall) => void = (call: UpdateCall): void => {
  for (const rows of Object.values(mockTableRows)) {
    for (const row of rows) {
      if (row["_id"] === call.id) {
        Object.assign(row, call.data);
      }
    }
  }

  for (const item of Object.values(mockDetailItems)) {
    if (item["_id"] === call.id) {
      Object.assign(item, call.data);
    }
  }
};

const fakeUpdateById: (
  api: ApiClient,
) => (request: {
  modelType: ModelType;
  id: ObjectID;
  data: JSONObject;
}) => Promise<HTTPResponse<JSONObject>> = (
  api: ApiClient,
): ((request: {
  modelType: ModelType;
  id: ObjectID;
  data: JSONObject;
}) => Promise<HTTPResponse<JSONObject>>) => {
  return async (request: {
    modelType: ModelType;
    id: ObjectID;
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject>> => {
    const call: UpdateCall = {
      api,
      modelType: request.modelType,
      id: request.id.toString(),
      // A copy: what was sent, not what the page might change later.
      data: { ...request.data },
    };

    updateCalls.push(call);

    if (serverFailure) {
      throw serverFailure;
    }

    applyUpdate(call);

    return new HTTPResponse<JSONObject>(200, {}, {});
  };
};

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

const READ_ONLY_LICENSE: JSONObject = {
  status: "expired",
  licenseValid: false,
};

const renderScreen: (screenCase: {
  path: string;
  render: () => ReactElement;
}) => Promise<void> = async (screenCase: {
  path: string;
  render: () => ReactElement;
}): Promise<void> => {
  window.history.pushState({}, "", screenCase.path);
  Navigation.setLocation(window.location as unknown as never);

  render(screenCase.render());

  if (!billingEnabledForTest) {
    await waitFor(() => {
      expect(mockLicenseFetch).toHaveBeenCalled();
    });
  }

  await act(async () => {
    await Promise.resolve();
  });
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  billingEnabledForTest = false;
  mockLicenseFetch.mockReset();
  updateCalls = [];
  serverFailure = null;

  for (const table of ALL_TABLES) {
    mockTableRows[table] = [];
    mockTableLoads[table] = 0;
  }

  for (const card of ALL_DETAIL_CARDS) {
    delete mockDetailItems[card];
    mockDetailLoads[card] = 0;
  }

  /*
   * AdminModelAPI first: it inherits updateById from ModelAPI, and each
   * client gets its own fake so a screen that used the wrong one is caught.
   */
  jest
    .spyOn(AdminModelAPI, "updateById")
    .mockImplementation(fakeUpdateById("AdminModelAPI") as never);
  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(fakeUpdateById("ModelAPI") as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * Disable
 */

const seedProviders: (disableCase: DisableCase, enabled: boolean) => void = (
  disableCase: DisableCase,
  enabled: boolean,
): void => {
  if (disableCase.table) {
    mockTableRows[disableCase.table] = [
      { _id: ENABLED_ROW_ID, name: "Okta", isEnabled: enabled },
      { _id: DISABLED_ROW_ID, name: "Old IdP", isEnabled: false },
    ];
  }

  // The view pages always load their provider; the attachment cases need one too.
  for (const card of ALL_DETAIL_CARDS) {
    mockDetailItems[card] = {
      _id: PROVIDER_ID,
      name: "Okta (company-wide)",
      isEnabled: disableCase.detailCard ? enabled : true,
    };
  }
};

const targetId: (disableCase: DisableCase) => string = (
  disableCase: DisableCase,
): string => {
  return disableCase.table ? ENABLED_ROW_ID : PROVIDER_ID;
};

const rowOf: (table: string, id: string) => HTMLElement = (
  table: string,
  id: string,
): HTMLElement => {
  return screen.getByTestId(`row-${table}-${id}`);
};

// The Disable control for the provider under test, or null.
const findDisableControl: (
  disableCase: DisableCase,
  id?: string,
) => HTMLElement | null = (
  disableCase: DisableCase,
  id?: string,
): HTMLElement | null => {
  if (disableCase.table) {
    return within(rowOf(disableCase.table, id || ENABLED_ROW_ID)).queryByRole(
      "button",
      { name: "Disable" },
    );
  }

  const card: HTMLElement | null = screen.queryByTestId(
    DISABLE_PROVIDER_CARD_TEST_ID,
  );

  return card
    ? within(card).queryByRole("button", {
        name: DISABLE_PROVIDER_BUTTON_TITLE,
      })
    : null;
};

// What the screen shows for the provider under test: "true" / "false".
const shownEnabled: (disableCase: DisableCase) => string | null = (
  disableCase: DisableCase,
): string | null => {
  if (disableCase.table) {
    return rowOf(disableCase.table, ENABLED_ROW_ID).getAttribute(
      "data-enabled",
    );
  }

  return screen
    .getByTestId(`card-model-detail-${disableCase.detailCard}`)
    .getAttribute("data-enabled");
};

const loadsOf: (disableCase: DisableCase) => number = (
  disableCase: DisableCase,
): number => {
  return disableCase.table
    ? mockTableLoads[disableCase.table] || 0
    : mockDetailLoads[disableCase.detailCard || ""] || 0;
};

const openConfirmation: (disableCase: DisableCase) => HTMLElement = (
  disableCase: DisableCase,
): HTMLElement => {
  const control: HTMLElement | null = findDisableControl(disableCase);

  expect(control).not.toBeNull();

  fireEvent.click(control!);

  const modal: HTMLElement = screen.getByTestId("modal");

  expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
    disableCase.confirmationTitle,
  );

  return modal;
};

const submit: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
  await settle();
};

describe.each(DISABLE_CASES)("Disable: $name", (disableCase: DisableCase) => {
  test("read-only: an enabled provider has Disable, and the screen says why it is still allowed", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedProviders(disableCase, true);

    await renderScreen(disableCase);

    expect(findDisableControl(disableCase)).not.toBeNull();

    const notice: HTMLElement = screen.getByTestId(
      READ_ONLY_ACTIONS_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent(PROVIDER_ACTIONS_TITLE);
    expect(
      screen.getByTestId("enterprise-license-read-only-banner"),
    ).toBeInTheDocument();
    // Nothing is sent before the admin confirms.
    expect(updateCalls).toEqual([]);
  });

  test("read-only: Disable sends exactly one update, { isEnabled: false } and nothing else, to the right model and row, and the screen shows it off", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedProviders(disableCase, true);

    await renderScreen(disableCase);

    expect(shownEnabled(disableCase)).toBe("true");

    const loadsBefore: number = loadsOf(disableCase);

    openConfirmation(disableCase);
    await submit();

    expect(updateCalls).toHaveLength(1);

    const call: UpdateCall = updateCalls[0]!;

    expect(call.api).toBe(disableCase.api);
    expect(call.modelType).toBe(disableCase.modelType);
    expect(call.id).toBe(targetId(disableCase));
    expect(call.data).toEqual({ isEnabled: false });
    expect(Object.keys(call.data)).toEqual(["isEnabled"]);

    // The confirmation closes and the screen reloads what the server holds.
    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(shownEnabled(disableCase)).toBe("false");
    });
    expect(loadsOf(disableCase)).toBeGreaterThan(loadsBefore);
    expect(findDisableControl(disableCase)).toBeNull();

    // Nothing else was touched.
    expect(updateCalls).toHaveLength(1);

    if (disableCase.table) {
      expect(
        rowOf(disableCase.table, DISABLED_ROW_ID).getAttribute("data-enabled"),
      ).toBe("false");
    }
  });

  test.each([
    [
      "402 (license required)",
      (): unknown => {
        return new HTTPErrorResponse(
          402,
          { message: LICENSE_REQUIRED_MESSAGE },
          {},
        );
      },
      LICENSE_REQUIRED_MESSAGE,
    ],
    [
      "500",
      (): unknown => {
        return new HTTPErrorResponse(
          500,
          { message: "The database is not reachable." },
          {},
        );
      },
      "The database is not reachable.",
    ],
    [
      "a network failure",
      (): unknown => {
        return new Error("Network Error");
      },
      "Network Error",
    ],
  ])(
    "read-only: a refusal (%s) is shown, and the provider stays on",
    async (_name: string, failure: () => unknown, message: string) => {
      answerLicense(READ_ONLY_LICENSE);
      seedProviders(disableCase, true);
      serverFailure = failure();

      await renderScreen(disableCase);

      openConfirmation(disableCase);
      await submit();

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]!.data).toEqual({ isEnabled: false });

      const modal: HTMLElement = screen.getByTestId("modal");

      await waitFor(() => {
        expect(within(modal).getByText(message)).toBeInTheDocument();
      });

      expect(shownEnabled(disableCase)).toBe("true");
      expect(findDisableControl(disableCase)).not.toBeNull();
    },
  );

  test("read-only: Cancel sends nothing", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedProviders(disableCase, true);

    await renderScreen(disableCase);

    openConfirmation(disableCase);

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
    expect(updateCalls).toEqual([]);
    expect(shownEnabled(disableCase)).toBe("true");
  });

  test("read-only: a provider that is already disabled has no Disable", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedProviders(disableCase, false);

    await renderScreen(disableCase);

    expect(findDisableControl(disableCase)).toBeNull();

    if (disableCase.table) {
      expect(findDisableControl(disableCase, DISABLED_ROW_ID)).toBeNull();
    } else {
      expect(
        screen.queryByTestId(DISABLE_PROVIDER_CARD_TEST_ID),
      ).not.toBeInTheDocument();
    }
  });

  test.each([
    ["a valid license", { status: "valid", licenseValid: true }],
    ["the grace period", { status: "grace", licenseValid: true }],
  ])(
    "editable (%s): no Disable action and no notice - the edit form covers it",
    async (_name: string, payload: JSONObject) => {
      answerLicense(payload);
      seedProviders(disableCase, true);

      await renderScreen(disableCase);

      expect(findDisableControl(disableCase)).toBeNull();
      expect(
        screen.queryByTestId(DISABLE_PROVIDER_CARD_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("the license cannot be read: nothing is locked, so no Disable action either", async () => {
    mockLicenseFetch.mockRejectedValue(new Error("network down"));
    seedProviders(disableCase, true);

    await renderScreen(disableCase);

    expect(findDisableControl(disableCase)).toBeNull();
    expect(
      screen.queryByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("OneUptime Cloud (billing on): no Disable action", async () => {
    billingEnabledForTest = true;
    answerLicense(READ_ONLY_LICENSE);
    seedProviders(disableCase, true);

    await renderScreen(disableCase);

    expect(mockLicenseFetch).not.toHaveBeenCalled();
    expect(findDisableControl(disableCase)).toBeNull();
    expect(
      screen.queryByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

/*
 * On a global provider's page the provider and its attachments are separate
 * actions: disabling one never touches the other.
 */
describe.each([
  {
    name: "Admin > Global SSO > provider",
    render: renderAdminPage(GlobalSSOViewPage),
    path: `/admin/settings/global-sso/${PROVIDER_ID}`,
    table: "global-sso-project-table",
    card: "Global SSO Configuration",
  },
  {
    name: "Admin > Global OIDC > provider",
    render: renderAdminPage(GlobalOIDCViewPage),
    path: `/admin/settings/global-oidc/${PROVIDER_ID}`,
    table: "global-oidc-project-table",
    card: "Global OIDC Configuration",
  },
])(
  "$name: provider and attachments",
  (viewCase: {
    name: string;
    render: () => ReactElement;
    path: string;
    table: string;
    card: string;
  }) => {
    test("disabling an attachment leaves the provider on, and the other way round", async () => {
      answerLicense(READ_ONLY_LICENSE);
      mockTableRows[viewCase.table] = [
        { _id: ENABLED_ROW_ID, isEnabled: true },
      ];
      mockDetailItems[viewCase.card] = { _id: PROVIDER_ID, isEnabled: true };

      await renderScreen(viewCase);

      fireEvent.click(
        within(rowOf(viewCase.table, ENABLED_ROW_ID)).getByRole("button", {
          name: "Disable",
        }),
      );
      await submit();

      expect(
        updateCalls.map((call: UpdateCall) => {
          return call.id;
        }),
      ).toEqual([ENABLED_ROW_ID]);
      expect(
        screen.getByTestId(DISABLE_PROVIDER_CARD_TEST_ID),
      ).toBeInTheDocument();
      expect(mockDetailItems[viewCase.card]!["isEnabled"]).toBe(true);

      fireEvent.click(
        screen.getByRole("button", { name: DISABLE_PROVIDER_BUTTON_TITLE }),
      );
      await submit();

      expect(
        updateCalls.map((call: UpdateCall) => {
          return call.id;
        }),
      ).toEqual([ENABLED_ROW_ID, PROVIDER_ID]);
      expect(updateCalls[1]!.data).toEqual({ isEnabled: false });
      await waitFor(() => {
        expect(
          screen.queryByTestId(DISABLE_PROVIDER_CARD_TEST_ID),
        ).not.toBeInTheDocument();
      });
    });
  },
);

/*
 * Reset Bearer Token
 */

const OLD_BEARER_TOKEN: string = "0123456789abcdef-old-leaked-token";

const seedScim: (scimCase: ScimCase) => void = (scimCase: ScimCase): void => {
  mockTableRows[scimCase.table] = [
    { _id: ENABLED_ROW_ID, name: "Okta SCIM", bearerToken: OLD_BEARER_TOKEN },
  ];
};

const resetButtons: (scimCase: ScimCase) => Array<HTMLElement> = (
  scimCase: ScimCase,
): Array<HTMLElement> => {
  return within(rowOf(scimCase.table, ENABLED_ROW_ID)).queryAllByRole(
    "button",
    { name: "Reset Bearer Token" },
  );
};

const resetToken: (scimCase: ScimCase) => Promise<void> = async (
  scimCase: ScimCase,
): Promise<void> => {
  const buttons: Array<HTMLElement> = resetButtons(scimCase);

  expect(buttons).toHaveLength(1);

  fireEvent.click(buttons[0]!);

  expect(screen.getByTestId("modal-title")).toHaveTextContent(
    "Reset Bearer Token",
  );

  await submit();
};

const HEX_TOKEN: RegExp = /^[0-9a-f]{64}$/;

const expectTokenRotation: (call: UpdateCall | undefined) => string = (
  call: UpdateCall | undefined,
): string => {
  expect(call).toBeDefined();
  expect(Object.keys(call!.data)).toEqual(["bearerToken"]);

  const token: unknown = call!.data["bearerToken"];

  expect(typeof token).toBe("string");
  expect((token as string).length).toBeGreaterThanOrEqual(
    MIN_SCIM_BEARER_TOKEN_LENGTH,
  );
  expect(token).toMatch(HEX_TOKEN);
  expect(token).not.toBe(OLD_BEARER_TOKEN);

  return token as string;
};

describe.each(SCIM_CASES)("Reset Bearer Token: $name", (scimCase: ScimCase) => {
  test("read-only: the reset stays on offer, and the screen says why", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedScim(scimCase);

    await renderScreen(scimCase);

    expect(resetButtons(scimCase)).toHaveLength(1);
    expect(
      screen.getByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID),
    ).toHaveTextContent(SCIM_ACTIONS_TITLE);
    expect(updateCalls).toEqual([]);
  });

  test("read-only: the reset sends exactly one update, { bearerToken } alone with a new 64-character token from Web Crypto, and shows that token once", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedScim(scimCase);

    const getRandomValues: jest.SpyInstance = jest.spyOn(
      globalThis.crypto,
      "getRandomValues",
    );

    await renderScreen(scimCase);

    const loadsBefore: number = mockTableLoads[scimCase.table] || 0;

    await resetToken(scimCase);

    expect(updateCalls).toHaveLength(1);

    const call: UpdateCall = updateCalls[0]!;

    expect(call.api).toBe("ModelAPI");
    expect(call.modelType).toBe(scimCase.modelType);
    expect(call.id).toBe(ENABLED_ROW_ID);

    const token: string = expectTokenRotation(call);

    expect(getRandomValues).toHaveBeenCalled();

    // The new token is shown once, in the success dialog.
    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      scimCase.successTitle,
    );

    fireEvent.click(within(modal).getByRole("hidden-text"));

    expect(within(modal).getByRole("revealed-text")).toHaveTextContent(token);

    // And the table reloads what the server now holds.
    expect(mockTableLoads[scimCase.table] || 0).toBeGreaterThan(loadsBefore);
    await waitFor(() => {
      expect(
        rowOf(scimCase.table, ENABLED_ROW_ID).getAttribute("data-bearer-token"),
      ).toBe(token);
    });

    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
  });

  test("read-only: every reset makes a different token", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedScim(scimCase);

    await renderScreen(scimCase);

    await resetToken(scimCase);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await settle();
    await resetToken(scimCase);

    expect(updateCalls).toHaveLength(2);

    const first: string = expectTokenRotation(updateCalls[0]);
    const second: string = expectTokenRotation(updateCalls[1]);

    expect(second).not.toBe(first);
  });

  test("read-only: a 402 is shown, and no token is", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedScim(scimCase);
    serverFailure = new HTTPErrorResponse(
      402,
      { message: LICENSE_REQUIRED_MESSAGE },
      {},
    );

    await renderScreen(scimCase);

    await resetToken(scimCase);

    expect(updateCalls).toHaveLength(1);
    expectTokenRotation(updateCalls[0]);

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      scimCase.errorTitle,
    );
    expect(modal).toHaveTextContent(LICENSE_REQUIRED_MESSAGE);
    expect(within(modal).queryByRole("hidden-text")).not.toBeInTheDocument();
    expect(
      rowOf(scimCase.table, ENABLED_ROW_ID).getAttribute("data-bearer-token"),
    ).toBe(OLD_BEARER_TOKEN);
  });

  test("read-only: without Web Crypto nothing is sent, and the admin is told why", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedScim(scimCase);

    await renderScreen(scimCase);

    const originalCrypto: Crypto = globalThis.crypto;

    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });

    try {
      await resetToken(scimCase);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }

    expect(updateCalls).toEqual([]);

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(modal).toHaveTextContent("cannot generate a secure bearer token");
  });

  test.each([
    ["a valid license", { status: "valid", licenseValid: true }],
    ["the grace period", { status: "grace", licenseValid: true }],
  ])(
    "editable (%s): no notice and one reset action - the same one, sending the same single-column update",
    async (_name: string, payload: JSONObject) => {
      answerLicense(payload);
      seedScim(scimCase);

      await renderScreen(scimCase);

      expect(
        screen.queryByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(resetButtons(scimCase)).toHaveLength(1);

      await resetToken(scimCase);

      expect(updateCalls).toHaveLength(1);
      expectTokenRotation(updateCalls[0]);
    },
  );
});
