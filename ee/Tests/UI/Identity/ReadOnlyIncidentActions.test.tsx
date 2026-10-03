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
 * The incident-response action on the Enterprise SCIM screens while the
 * license makes their configuration read-only (expired, missing or invalid,
 * after the grace period).
 *
 * The server still accepts one update then, because it can only tighten
 * security (TIGHTEN_ONLY_UPDATES in Common's EditionPermission): exactly
 * { bearerToken: <32+ characters> } on a SCIM configuration. Both SCIM
 * screens offer it as "Reset Bearer Token" (and show the new token once).
 *
 * For each screen this checks that the action is there in read-only mode,
 * that it sends exactly one update - to the right model and row, with exactly
 * the allowed column and a new token from Web Crypto - that the screen shows
 * the result, that a refusal is shown, and that it works the same while
 * configuration is editable.
 *
 * Single sign-on has no incident-response mode at all: its configuration is
 * core and never read-only, so the four single sign-on pages offer no
 * "Disable" row action and no notice, stay fully editable and never ask for
 * the license - checked here with an expired license, in the Enterprise
 * bundle. Settings > SSO's "Require SSO for Login" is the real switch, which
 * reads the project and saves the moment it is flipped: it stays unlocked
 * and saves without the license being asked for.
 *
 * The model tables are stand-ins that behave like the real ones where it
 * matters: they load rows from a fake server, show the page's row actions
 * (honouring isVisible) and reload when the page asks them to. The fake
 * server applies accepted updates, so a reload shows what the server now
 * holds. Billing is pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true.
 *
 * The pages' own requests go through API.fetch, and only one to the license
 * route counts as asking for the license (mockLicenseFetch). The others -
 * the switch reading its project, Settings > OIDC looking up the members
 * team its new providers start on - get canned answers (mockServerFetch).
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

// The fake server: rows per table.
type MockRecord = { [column: string]: unknown };

const mockTableRows: { [tableId: string]: Array<MockRecord> } = {};
const mockTableLoads: { [tableId: string]: number } = {};

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
  isCreateable?: boolean | undefined;
  isEditable?: boolean | undefined;
  isDeleteable?: boolean | undefined;
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
      <div
        data-testid={`model-table-${props.id}`}
        data-createable={String(Boolean(props.isCreateable))}
        data-editable={String(Boolean(props.isEditable))}
        data-deleteable={String(Boolean(props.isDeleteable))}
      >
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

import SettingsSCIMPage from "../../../Dashboard/Identity/Pages/Settings/SCIM";
import StatusPageSCIMPage from "../../../Dashboard/Identity/Pages/StatusPages/SCIM";
import {
  READ_ONLY_ACTIONS_NOTICE_TEST_ID,
  SCIM_ACTIONS_TITLE,
} from "../../../Dashboard/Identity/TightenOnly/ReadOnlyActionsNotice";
import { MIN_SCIM_BEARER_TOKEN_LENGTH } from "../../../Dashboard/Identity/TightenOnly/TightenOnlyUpdates";
import SettingsSSOPage from "@oneuptime/dashboard/Pages/Settings/SSO";
import SettingsOIDCPage from "@oneuptime/dashboard/Pages/Settings/OIDC";
import StatusPageSSOPage from "@oneuptime/dashboard/Pages/StatusPages/View/SSO";
import StatusPageOIDCPage from "@oneuptime/dashboard/Pages/StatusPages/View/OIDC";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import RequireSsoForLoginSwitchCopy, {
  REQUIRE_SSO_FOR_LOGIN_SWITCH_TEST_ID,
} from "@oneuptime/dashboard/Components/Project/RequireSsoForLoginSwitchCopy";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const ENABLED_ROW_ID: string = "44444444-4444-4444-8444-444444444444";
const DISABLED_ROW_ID: string = "55555555-5555-4555-8555-555555555555";

const LICENSE_REQUIRED_MESSAGE: string =
  "An Enterprise license is required to change this configuration.";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/settings/scim`),
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

type ModelType = { new (): unknown };

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

interface SsoCase {
  name: string;
  render: () => ReactElement;
  path: string;
  table: string;
  viewAction: string;
  // The status page's "SSO Settings" card ("Force SSO for Login").
  hasForceSsoCard: boolean;
  // The project's "Require SSO for Login" switch, which saves on flip.
  hasRequireSsoSwitch: boolean;
}

const SSO_CASES: Array<SsoCase> = [
  {
    name: "Settings > SSO",
    render: renderDashboardPage(SettingsSSOPage),
    path: `/dashboard/${PROJECT_ID}/settings/sso`,
    table: "sso-table",
    viewAction: "View SSO Config",
    hasForceSsoCard: false,
    hasRequireSsoSwitch: true,
  },
  {
    name: "Settings > OIDC",
    render: renderDashboardPage(SettingsOIDCPage),
    path: `/dashboard/${PROJECT_ID}/settings/oidc`,
    table: "oidc-table",
    viewAction: "View OIDC Config",
    hasForceSsoCard: false,
    hasRequireSsoSwitch: false,
  },
  {
    name: "Status page > SSO",
    render: renderDashboardPage(StatusPageSSOPage),
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/sso`,
    table: "sso-table",
    viewAction: "View SSO Config",
    hasForceSsoCard: true,
    hasRequireSsoSwitch: false,
  },
  {
    name: "Status page > OIDC",
    render: renderDashboardPage(StatusPageOIDCPage),
    path: `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/oidc`,
    table: "oidc-table",
    viewAction: "View OIDC Config",
    hasForceSsoCard: false,
    hasRequireSsoSwitch: false,
  },
];

// Every table the screens render, emptied before each test.
const ALL_TABLES: Array<string> = [
  "sso-table",
  "oidc-table",
  "scim-table",
  "status-page-scim-table",
  "project-scim-logs-table",
  "status-page-scim-logs-table",
];

// The update requests, and what the fake server answers.
interface UpdateCall {
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
};

const fakeUpdateById: (request: {
  modelType: ModelType;
  id: ObjectID;
  data: JSONObject;
}) => Promise<HTTPResponse<JSONObject>> = async (request: {
  modelType: ModelType;
  id: ObjectID;
  data: JSONObject;
}): Promise<HTTPResponse<JSONObject>> => {
  const call: UpdateCall = {
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

const goTo: (path: string) => void = (path: string): void => {
  window.history.pushState({}, "", path);
  Navigation.setLocation(window.location as unknown as never);
};

const renderScreen: (screenCase: {
  path: string;
  render: () => ReactElement;
}) => Promise<void> = async (screenCase: {
  path: string;
  render: () => ReactElement;
}): Promise<void> => {
  goTo(screenCase.path);

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
  mockServerFetch.mockReset();
  mockServerFetch.mockImplementation(answerServer as never);
  updateCalls = [];
  serverFailure = null;

  for (const table of ALL_TABLES) {
    mockTableRows[table] = [];
    mockTableLoads[table] = 0;
  }

  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(fakeUpdateById as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const rowOf: (table: string, id: string) => HTMLElement = (
  table: string,
  id: string,
): HTMLElement => {
  return screen.getByTestId(`row-${table}-${id}`);
};

const submit: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
  await settle();
};

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

  test("read-only: no other row action is offered - there is nothing to Disable", async () => {
    answerLicense(READ_ONLY_LICENSE);
    seedScim(scimCase);

    await renderScreen(scimCase);

    expect(
      within(rowOf(scimCase.table, ENABLED_ROW_ID)).queryByRole("button", {
        name: "Disable",
      }),
    ).not.toBeInTheDocument();
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

/*
 * Single sign-on
 */

describe.each(SSO_CASES)(
  "$name while the Enterprise license is expired",
  (ssoCase: SsoCase) => {
    test("no Disable action and no notice: the configuration stays fully editable, and the license is never asked for", async () => {
      answerLicense(READ_ONLY_LICENSE);
      // A project owner, whom the Require SSO switch is unlocked for.
      jest
        .spyOn(PermissionUtil, "getAllPermissions")
        .mockReturnValue([Permission.ProjectOwner]);
      mockTableRows[ssoCase.table] = [
        { _id: ENABLED_ROW_ID, name: "Okta", isEnabled: true },
        { _id: DISABLED_ROW_ID, name: "Old IdP", isEnabled: false },
      ];

      goTo(ssoCase.path);
      render(ssoCase.render());
      await settle();

      const table: HTMLElement = screen.getByTestId(
        `model-table-${ssoCase.table}`,
      );

      expect(table).toHaveAttribute("data-createable", "true");
      expect(table).toHaveAttribute("data-editable", "true");
      expect(table).toHaveAttribute("data-deleteable", "true");

      for (const rowId of [ENABLED_ROW_ID, DISABLED_ROW_ID]) {
        const row: HTMLElement = rowOf(ssoCase.table, rowId);

        expect(
          within(row).queryByRole("button", { name: "Disable" }),
        ).not.toBeInTheDocument();
        expect(within(row).getAllByRole("button")).toHaveLength(1);
        expect(
          within(row).getByRole("button", { name: ssoCase.viewAction }),
        ).toBeInTheDocument();
      }

      if (ssoCase.hasForceSsoCard) {
        expect(
          screen.getByTestId("card-model-detail-SSO Settings"),
        ).toHaveAttribute("data-editable", "true");
      }

      /*
       * The real "Require SSO for Login" switch: once it has read the
       * project, it is unlocked - an expired license has no say in it.
       */
      const requireSso: HTMLElement | null = ssoCase.hasRequireSsoSwitch
        ? await screen.findByTestId(REQUIRE_SSO_FOR_LOGIN_SWITCH_TEST_ID)
        : null;

      if (requireSso) {
        expect(requireSso).toHaveAttribute("aria-checked", "false");
        expect(requireSso).not.toHaveAttribute("aria-disabled");
      }

      expect(
        screen.queryByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("enterprise-license-read-only-banner"),
      ).not.toBeInTheDocument();
      expect(mockLicenseFetch).not.toHaveBeenCalled();
      expect(updateCalls).toEqual([]);

      if (requireSso) {
        // And it saves: requiring SSO asks first, then sends that column.
        fireEvent.click(requireSso);

        expect(screen.getByTestId("modal-title")).toHaveTextContent(
          RequireSsoForLoginSwitchCopy.requireConfirmTitle,
        );

        await submit();

        expect(updateCalls).toEqual([
          {
            modelType: Project,
            id: PROJECT_ID,
            data: { requireSsoForLogin: true },
          },
        ]);
        expect(requireSso).toHaveAttribute("aria-checked", "true");
        expect(mockLicenseFetch).not.toHaveBeenCalled();
      }
    });
  },
);
