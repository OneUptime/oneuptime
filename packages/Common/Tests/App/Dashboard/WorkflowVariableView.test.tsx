import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A workflow variable's own page (Workflows > Global Variables > View, and
 * Workflow > Workflow Variables > View).
 *
 * The variables list used to do everything in its row actions - Show ID,
 * Update Content, Update Credentials, Edit Details, Delete - and a Token
 * column with its own Refresh now button. The list now only lists and
 * creates; its single View action opens this page, and everything done to one
 * variable happens here. So what is asserted here is that every one of those
 * doors exists on the page, for the right kind of variable, on both the global
 * and the local page, gated the way the list gated them.
 *
 * The cards, the modals, the token status and the delete card are replaced by
 * prop recorders: what is under test is what the page hands them and what it
 * does when their callbacks fire. The real CardModelDetail and ModelDelete
 * fetch on mount.
 */

let permissionsForTest: Array<unknown> = [];
let isMasterAdminForTest: boolean = false;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return PROJECT_ID;
      },
    },
  };
});

const navigate: ReturnType<typeof jest.fn<(to: unknown) => void>> =
  jest.fn<(to: unknown) => void>();
const getLastParamAsObjectID: ReturnType<
  typeof jest.fn<(index?: number) => unknown>
> = jest.fn<(index?: number) => unknown>();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (to: unknown): void => {
        navigate(to);
      },
      getLastParamAsObjectID: (index?: number): unknown => {
        return getLastParamAsObjectID(index);
      },
    },
  };
});

const getItem: ReturnType<typeof jest.fn<(data: unknown) => Promise<unknown>>> =
  jest.fn<(data: unknown) => Promise<unknown>>();
const updateById: ReturnType<
  typeof jest.fn<(data: unknown) => Promise<unknown>>
> = jest.fn<(data: unknown) => Promise<unknown>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (data: unknown): Promise<unknown> => {
        return getItem(data);
      },
      updateById: (data: unknown): Promise<unknown> => {
        return updateById(data);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-header" };
      },
    },
  };
});

const apiPost: ReturnType<typeof jest.fn<(data: unknown) => Promise<unknown>>> =
  jest.fn<(data: unknown) => Promise<unknown>>();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (data: unknown): Promise<unknown> => {
        return apiPost(data);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : "Request failed.";
      },
    },
  };
});

/*
 * Every render of a visible loader, so a test can prove the loader never
 * appeared at all - a background reload that flashed it for one render and
 * took it down again would still blank the page for that moment.
 */
let pageLoaderRenderCount: number = 0;

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: (props: { isVisible: boolean }): ReactElement | null => {
      if (props.isVisible) {
        pageLoaderRenderCount++;
      }

      return props.isVisible ? <div data-testid="page-loader" /> : null;
    },
  };
});

type CardButtonEntry = {
  title: string;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  onClick: () => void;
};

type CapturedCardProps = {
  title?: string | undefined;
  description?: string | undefined;
  buttons?: Array<CardButtonEntry> | undefined;
  children?: ReactNode;
};

let capturedCards: Record<string, CapturedCardProps> = {};

/*
 * The card header the mocked Card and CardModelDetail both render: a heading
 * and the card's buttons as real buttons, so a click goes through the same
 * disabled attribute a person would meet.
 */
function renderMockCard(
  testId: string,
  cardProps: CapturedCardProps,
): ReactElement {
  return (
    <section data-testid={testId}>
      <h2>{cardProps.title}</h2>
      {(cardProps.buttons || []).map((button: CardButtonEntry) => {
        return (
          <button
            key={button.title}
            type="button"
            data-testid={`card-button:${button.title}`}
            disabled={Boolean(button.disabled)}
            title={button.tooltip}
            onClick={button.onClick}
          >
            {button.title}
          </button>
        );
      })}
      {cardProps.children}
    </section>
  );
}

jest.mock("../../../UI/Components/Card/Card", () => {
  return {
    __esModule: true,
    default: (props: CapturedCardProps): ReactElement => {
      capturedCards[props.title || ""] = props;
      return renderMockCard(`card:${props.title}`, props);
    },
  };
});

type DetailField = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  description?: string | undefined;
  getElement?: ((item: unknown) => ReactElement) | undefined;
};

type FormFieldEntry = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  description?: string | undefined;
  fieldType?: string | undefined;
  required?: unknown;
};

type CapturedDetailProps = {
  name: string;
  cardProps: CapturedCardProps;
  isEditable?: boolean | undefined;
  editButtonText?: string | undefined;
  onSaveSuccess?: ((item: unknown) => void) | undefined;
  formFields?: Array<FormFieldEntry> | undefined;
  modelDetailProps: {
    modelType: unknown;
    modelId: { toString: () => string };
    fields: Array<DetailField>;
  };
};

let capturedDetails: Record<string, CapturedDetailProps> = {};

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: CapturedDetailProps): ReactElement => {
      capturedDetails[props.name] = props;
      return renderMockCard(`detail:${props.name}`, props.cardProps);
    },
  };
});

type CapturedDeleteProps = {
  modelType: unknown;
  modelId: { toString: () => string };
  onDeleteSuccess: () => void;
};

let capturedDeleteProps: CapturedDeleteProps | null = null;

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (props: CapturedDeleteProps): ReactElement => {
      capturedDeleteProps = props;
      return <div data-testid="model-delete" />;
    },
  };
});

type CapturedContentModalProps = {
  variable: { name?: string | undefined; id?: unknown };
  onClose: () => void;
  onSuccess: () => void;
};

let capturedContentModalProps: CapturedContentModalProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/UpdateWorkflowVariableContentModal",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedContentModalProps): ReactElement => {
        capturedContentModalProps = props;
        return <div data-testid="update-content-modal" />;
      },
    };
  },
);

type CapturedCredentialsModalProps = {
  variable: { name?: string | undefined; id?: unknown };
  onClose: () => void;
  onSaved: (savedWhat: string) => void;
};

let capturedCredentialsModalProps: CapturedCredentialsModalProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/UpdateWorkflowVariableCredentialsModal",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedCredentialsModalProps): ReactElement => {
        capturedCredentialsModalProps = props;
        return <div data-testid="update-credentials-modal" />;
      },
    };
  },
);

type CapturedTokenRefreshModalProps = {
  variableName: string;
  outcome: {
    variableName: string;
    savedWhat?: string | undefined;
    expiresAt?: Date | null | undefined;
    error?: string | undefined;
  } | null;
  onClose: () => void;
};

let capturedTokenRefreshModalProps: CapturedTokenRefreshModalProps | null =
  null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableTokenRefreshModal",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedTokenRefreshModalProps): ReactElement => {
        capturedTokenRefreshModalProps = props;
        return (
          <div
            data-testid="token-refresh-modal"
            data-pending={props.outcome ? "false" : "true"}
          />
        );
      },
    };
  },
);

type RefreshActionEntry = {
  onClick: () => void;
  isLoading?: boolean | undefined;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
};

type CapturedTokenStatusProps = {
  variable: {
    name?: string | undefined;
    id?: unknown;
    oauthLastRefreshError?: string | undefined;
  };
  refreshAction?: RefreshActionEntry | undefined;
};

let capturedTokenStatusProps: CapturedTokenStatusProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableTokenStatus",
  () => {
    return {
      __esModule: true,
      // Disabled exactly as the real one is: while loading, or when asked to.
      default: (props: CapturedTokenStatusProps): ReactElement => {
        capturedTokenStatusProps = props;
        return (
          <div data-testid="token-status">
            {props.refreshAction ? (
              <button
                type="button"
                data-testid="refresh-now"
                disabled={Boolean(
                  props.refreshAction.disabled || props.refreshAction.isLoading,
                )}
                title={props.refreshAction.tooltip}
                onClick={props.refreshAction.onClick}
              >
                Refresh now
              </button>
            ) : null}
          </div>
        );
      },
    };
  },
);

import WorkflowVariableView, {
  WORKFLOW_VARIABLE_VIEW_SELECT,
  getVariableScopeError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableView";
import GlobalWorkflowVariableViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/VariableView";
import LocalWorkflowVariableViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/VariableView";
import {
  TokenRefreshOutcome,
  getTokenRefreshDescription,
  getTokenRefreshTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const VARIABLE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_WORKFLOW_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_VARIABLE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
// What Navigation hands back for a route segment a page should not be reading.
const UNEXPECTED_PARAM_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const DETAILS_CARD: string = "Workflow > Variable Details";
const OAUTH_SETTINGS_CARD: string = "Workflow > OAuth 2.0 Settings";

// Columns nobody may read back: they must never be selected, shown or edited.
const WRITE_ONLY_COLUMNS: Array<string> = [
  "content",
  "oauthClientSecret",
  "oauthRefreshToken",
  "oauthAccessToken",
];

const TOKEN_EXPIRES_AT: string = "2030-01-01T10:00:00.000Z";

let lastParams: Record<number, ObjectID> = {};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (error: unknown) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise, resolve, reject };
}

function applyOverrides(
  variable: WorkflowVariable,
  overrides?: Partial<Record<string, unknown>>,
): WorkflowVariable {
  for (const [key, value] of Object.entries(overrides || {})) {
    (variable as unknown as Record<string, unknown>)[key] = value;
  }

  return variable;
}

function staticVariable(
  overrides?: Partial<Record<string, unknown>>,
): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable._id = VARIABLE_ID.toString();
  variable.name = "API_KEY";
  variable.variableType = WorkflowVariableType.Static;

  // The model types isSecret as a string, but the column is a boolean.
  return applyOverrides(variable, { isSecret: false, ...(overrides || {}) });
}

function oauthVariable(
  overrides?: Partial<Record<string, unknown>>,
): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable._id = VARIABLE_ID.toString();
  variable.name = "API_TOKEN";
  variable.variableType = WorkflowVariableType.OAuth2;
  variable.oauthGrantType = OAuth2GrantType.ClientCredentials;

  return applyOverrides(variable, { isSecret: true, ...(overrides || {}) });
}

// A variable local to WORKFLOW_ID.
function localStaticVariable(
  overrides?: Partial<Record<string, unknown>>,
): WorkflowVariable {
  return staticVariable({ workflowId: WORKFLOW_ID, ...(overrides || {}) });
}

function localOAuthVariable(
  overrides?: Partial<Record<string, unknown>>,
): WorkflowVariable {
  return oauthVariable({ workflowId: WORKFLOW_ID, ...(overrides || {}) });
}

function renderView(data?: {
  workflowId?: ObjectID | undefined;
  variableId?: ObjectID | undefined;
}): ReturnType<typeof render> {
  return render(
    <WorkflowVariableView
      variableId={data?.variableId || VARIABLE_ID}
      workflowId={data?.workflowId}
    />,
  );
}

async function waitForPage(): Promise<void> {
  await screen.findByTestId("model-delete");
}

// Loads `variable` and renders the global page (or a workflow's, with workflowId).
async function renderLoaded(
  variable: WorkflowVariable,
  workflowId?: ObjectID | undefined,
): Promise<ReturnType<typeof render>> {
  getItem.mockResolvedValue(variable);

  const result: ReturnType<typeof render> = renderView({ workflowId });

  await waitForPage();

  // From here on, any loader render is one a reload caused.
  pageLoaderRenderCount = 0;

  return result;
}

function expectNoLoaderSinceLoad(): void {
  expect(pageLoaderRenderCount).toBe(0);
}

function detail(name: string): CapturedDetailProps {
  const props: CapturedDetailProps | undefined = capturedDetails[name];

  if (!props) {
    throw new Error(`The page rendered no "${name}" card`);
  }

  return props;
}

function card(title: string): CapturedCardProps {
  const props: CapturedCardProps | undefined = capturedCards[title];

  if (!props) {
    throw new Error(`The page rendered no "${title}" card`);
  }

  return props;
}

function cardButton(
  props: CapturedCardProps,
  title: string,
): CardButtonEntry | undefined {
  return (props.buttons || []).find((button: CardButtonEntry) => {
    return button.title === title;
  });
}

type NamedField = { field?: Record<string, unknown> | undefined };

function fieldNames(fields: Array<NamedField>): Array<string> {
  return fields.map((entry: NamedField) => {
    return Object.keys(entry.field || {})[0] || "";
  });
}

function detailFormFieldNames(name: string): Array<string> {
  return fieldNames(detail(name).formFields || []);
}

function detailViewField(name: string, title: string): DetailField {
  const field: DetailField | undefined = detail(
    name,
  ).modelDetailProps.fields.find((entry: DetailField) => {
    return entry.title === title;
  });

  if (!field) {
    throw new Error(`The "${name}" card shows no "${title}" field`);
  }

  return field;
}

function renderDetailElement(
  name: string,
  title: string,
  item: WorkflowVariable,
): HTMLElement {
  const element: ReactElement = detailViewField(name, title).getElement!(item);

  return render(element).container;
}

function getItemCall(index: number = 0): {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
} {
  return getItem.mock.calls[index]![0] as {
    modelType: unknown;
    id: ObjectID;
    select: Record<string, unknown>;
  };
}

function refreshCall(index: number = 0): {
  url: unknown;
  headers: Record<string, string>;
  data: unknown;
} {
  return apiPost.mock.calls[index]![0] as {
    url: unknown;
    headers: Record<string, string>;
    data: unknown;
  };
}

function tokenModal(): CapturedTokenRefreshModalProps {
  if (!capturedTokenRefreshModalProps) {
    throw new Error("No token refresh modal is open");
  }

  return capturedTokenRefreshModalProps;
}

function tokenStatus(): CapturedTokenStatusProps {
  if (!capturedTokenStatusProps) {
    throw new Error("The page rendered no token status");
  }

  return capturedTokenStatusProps;
}

function missingUpdatePermissionMessage(): string {
  return PermissionGate.getMissingPermissionMessage(
    new WorkflowVariable(),
    ModelAction.Update,
  );
}

async function clickRefreshNow(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("refresh-now"));
  });
}

async function waitForOutcome(): Promise<void> {
  await waitFor(() => {
    expect(capturedTokenRefreshModalProps?.outcome).toBeTruthy();
  });
}

const NOT_FOUND_MESSAGE: RegExp = /This variable could not be found/;

/*
 * What the API really answers for a missing, deleted or out-of-tenant id: an
 * empty object, which ModelAPI turns into a WorkflowVariable with nothing set.
 */
function missingVariable(): WorkflowVariable {
  return new WorkflowVariable();
}

/*
 * Makes the next read (a background reload after a save or a token refresh)
 * wait until the test settles it.
 */
function holdNextRead(): Deferred<unknown> {
  const pending: Deferred<unknown> = deferred<unknown>();
  getItem.mockReturnValueOnce(pending.promise);
  return pending;
}

async function waitForReads(count: number): Promise<void> {
  await waitFor(() => {
    expect(getItem).toHaveBeenCalledTimes(count);
  });
}

// The variable's page, whole: its cards and its delete card, and no error.
function expectOAuthPageShown(): void {
  expect(screen.getByTestId(`detail:${DETAILS_CARD}`)).toBeInTheDocument();
  expect(screen.getByTestId("card:Access Token")).toBeInTheDocument();
  expect(
    screen.getByTestId(`detail:${OAUTH_SETTINGS_CARD}`),
  ).toBeInTheDocument();
  expect(screen.getByTestId("model-delete")).toBeInTheDocument();
  expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
  expect(screen.queryByTestId("refresh-button")).not.toBeInTheDocument();
}

beforeEach(() => {
  capturedCards = {};
  capturedDetails = {};
  capturedDeleteProps = null;
  capturedContentModalProps = null;
  capturedCredentialsModalProps = null;
  capturedTokenRefreshModalProps = null;
  capturedTokenStatusProps = null;
  pageLoaderRenderCount = 0;

  getItem.mockReset();
  getItem.mockResolvedValue(staticVariable());
  updateById.mockReset();
  updateById.mockResolvedValue(undefined);
  apiPost.mockReset();
  apiPost.mockResolvedValue({
    data: { oauthAccessTokenExpiresAt: TOKEN_EXPIRES_AT },
  });
  navigate.mockReset();

  lastParams = {};
  getLastParamAsObjectID.mockReset();
  getLastParamAsObjectID.mockImplementation((index?: number): unknown => {
    return lastParams[index ?? 0] || UNEXPECTED_PARAM_ID;
  });

  permissionsForTest = [Permission.ProjectAdmin];
  isMasterAdminForTest = false;
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
});

describe("getVariableScopeError", () => {
  test("a global variable on the global page is fine", () => {
    expect(getVariableScopeError({ variable: staticVariable() })).toBeNull();
  });

  test("a local variable on the global page is refused, pointing at its workflow", () => {
    const error: string | null = getVariableScopeError({
      variable: localStaticVariable(),
    });

    expect(error).toContain("belongs to a workflow");
    expect(error).toContain("Workflow Variables page");
  });

  test("a variable of this workflow on this workflow's page is fine", () => {
    expect(
      getVariableScopeError({
        variable: localStaticVariable(),
        workflowId: WORKFLOW_ID,
      }),
    ).toBeNull();
  });

  test("compares workflow ids by value, not by object", () => {
    expect(
      getVariableScopeError({
        variable: localStaticVariable(),
        workflowId: new ObjectID(WORKFLOW_ID.toString()),
      }),
    ).toBeNull();
  });

  test("another workflow's variable on this workflow's page is refused", () => {
    expect(
      getVariableScopeError({
        variable: staticVariable({ workflowId: OTHER_WORKFLOW_ID }),
        workflowId: WORKFLOW_ID,
      }),
    ).toBe("This variable does not belong to this workflow.");
  });

  test("a global variable on a workflow's page is refused", () => {
    expect(
      getVariableScopeError({
        variable: staticVariable(),
        workflowId: WORKFLOW_ID,
      }),
    ).toBe("This variable does not belong to this workflow.");
  });
});

describe("loading the variable", () => {
  test("reads the variable by its id", async () => {
    await renderLoaded(staticVariable());

    expect(getItem).toHaveBeenCalledTimes(1);
    expect(getItemCall().modelType).toBe(WorkflowVariable);
    expect(getItemCall().id.toString()).toBe(VARIABLE_ID.toString());
    expect(getItemCall().select).toBe(WORKFLOW_VARIABLE_VIEW_SELECT);
  });

  test("selects what the layout and the token status need", async () => {
    await renderLoaded(oauthVariable());

    expect(Object.keys(getItemCall().select)).toEqual(
      expect.arrayContaining([
        "_id",
        "name",
        "variableType",
        "workflowId",
        "isSecret",
        "oauthGrantType",
        "oauthAccessTokenExpiresAt",
        "oauthLastRefreshedAt",
        "oauthLastRefreshError",
        "oauthLastRefreshErrorAt",
      ]),
    );
  });

  /*
   * These columns have an empty read list. Selecting any one of them makes the
   * server refuse the whole request, so the page would never load at all - and
   * it would be the wrong place to show a secret if it did.
   */
  test("never selects content, a credential or a token", async () => {
    await renderLoaded(oauthVariable());

    for (const column of WRITE_ONLY_COLUMNS) {
      expect(getItemCall().select).not.toHaveProperty(column);
      expect(WORKFLOW_VARIABLE_VIEW_SELECT).not.toHaveProperty(column);
    }
  });

  test("shows a loader until the variable arrives, and nothing else", async () => {
    const pending: Deferred<unknown> = deferred<unknown>();
    getItem.mockReturnValue(pending.promise);

    renderView();

    expect(screen.getByTestId("page-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
    expect(capturedDetails[DETAILS_CARD]).toBeUndefined();

    await act(async () => {
      pending.resolve(staticVariable());
    });

    await waitForPage();

    expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
    expect(screen.getByTestId(`detail:${DETAILS_CARD}`)).toBeInTheDocument();
  });

  /*
   * The API answers a missing id with an empty object, not null. Read as a
   * variable, that has no type - so without the id check it would be drawn
   * as an empty static variable with an Update Content button.
   */
  test("says so when the variable is not found", async () => {
    getItem.mockResolvedValue(missingVariable());

    renderView();

    expect(await screen.findByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
    // Nothing to edit or delete.
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
    expect(capturedDetails[DETAILS_CARD]).toBeUndefined();
    expect(screen.queryByTestId("card:Content")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("card-button:Update Content"),
    ).not.toBeInTheDocument();
  });

  test("says so when the read answers with nothing at all", async () => {
    getItem.mockResolvedValue(null);

    renderView();

    expect(await screen.findByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
    expect(capturedDetails[DETAILS_CARD]).toBeUndefined();
  });

  /*
   * An empty variable has no workflowId either, so a scope check run first
   * would call a missing variable "another workflow's".
   */
  test("a workflow's page says a missing variable is missing, not another workflow's", async () => {
    getItem.mockResolvedValue(missingVariable());

    renderView({ workflowId: WORKFLOW_ID });

    expect(await screen.findByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/does not belong/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
    expect(capturedDetails[DETAILS_CARD]).toBeUndefined();
  });

  test("a workflow's page says so for a null read too", async () => {
    getItem.mockResolvedValue(null);

    renderView({ workflowId: WORKFLOW_ID });

    expect(await screen.findByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/does not belong/)).not.toBeInTheDocument();
  });

  // A variable with values but no id is still not one the page can act on.
  test("a read with fields but no id is not found either", async () => {
    const variable: WorkflowVariable = new WorkflowVariable();
    variable.name = "API_KEY";
    variable.variableType = WorkflowVariableType.Static;

    getItem.mockResolvedValue(variable);

    renderView();

    expect(await screen.findByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
  });

  test("shows the friendly message when the request fails", async () => {
    getItem.mockRejectedValue(new Error("The API is unreachable."));

    renderView();

    expect(
      await screen.findByText("The API is unreachable."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
  });

  test("Refresh? on the error reads the variable again", async () => {
    getItem.mockRejectedValueOnce(new Error("The API is unreachable."));
    getItem.mockResolvedValueOnce(staticVariable());

    renderView();

    await screen.findByText("The API is unreachable.");

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    await waitForPage();

    expect(getItem).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText("The API is unreachable."),
    ).not.toBeInTheDocument();
  });

  // The error owns the page, so its retry is a foreground load: loader, then page.
  test("Refresh? on the error retries in the foreground and shows the variable", async () => {
    const retry: Deferred<unknown> = deferred<unknown>();
    getItem.mockRejectedValueOnce(new Error("The API is unreachable."));
    getItem.mockReturnValueOnce(retry.promise);

    renderView();

    await screen.findByText("The API is unreachable.");

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    expect(screen.getByTestId("page-loader")).toBeInTheDocument();
    expect(
      screen.queryByText("The API is unreachable."),
    ).not.toBeInTheDocument();

    await act(async () => {
      retry.resolve(oauthVariable());
    });

    await waitForPage();

    expectOAuthPageShown();
    expect(tokenStatus().variable.name).toBe("API_TOKEN");
    expect(getItemCall(1).id.toString()).toBe(VARIABLE_ID.toString());
  });

  test("Refresh? after a not-found shows the variable once it is there", async () => {
    getItem.mockResolvedValueOnce(missingVariable());
    getItem.mockResolvedValueOnce(staticVariable());

    renderView();

    await screen.findByText(NOT_FOUND_MESSAGE);

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    await waitForPage();

    expect(screen.queryByText(NOT_FOUND_MESSAGE)).not.toBeInTheDocument();
    expect(screen.getByTestId("card:Content")).toBeInTheDocument();
  });

  test("Refresh? that fails again shows the new error", async () => {
    getItem.mockRejectedValueOnce(new Error("The API is unreachable."));
    getItem.mockRejectedValueOnce(new Error("Still unreachable."));

    renderView();

    await screen.findByText("The API is unreachable.");

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    expect(await screen.findByText("Still unreachable.")).toBeInTheDocument();
    expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
  });

  test("reads the new variable when the page moves to another one", async () => {
    const result: ReturnType<typeof render> =
      await renderLoaded(staticVariable());

    getItem.mockResolvedValue(
      staticVariable({ _id: OTHER_VARIABLE_ID.toString(), name: "OTHER" }),
    );

    result.rerender(<WorkflowVariableView variableId={OTHER_VARIABLE_ID} />);

    await waitFor(() => {
      expect(getItem).toHaveBeenCalledTimes(2);
    });

    expect(getItemCall(1).id.toString()).toBe(OTHER_VARIABLE_ID.toString());

    await waitFor(() => {
      expect(detail(DETAILS_CARD).modelDetailProps.modelId.toString()).toBe(
        OTHER_VARIABLE_ID.toString(),
      );
    });
    expect(capturedDeleteProps?.modelId.toString()).toBe(
      OTHER_VARIABLE_ID.toString(),
    );
  });
});

/*
 * Moving from one variable's page to another's reuses the component, so the
 * first variable's read can still be in flight when the second one starts.
 * Whichever answers last, the page must show the variable it is now on.
 *
 * The two variables differ in type, so the layout alone says which one
 * landed: the cards' modelId comes from the prop, not from the read.
 */
describe("a slow read never overwrites a newer one", () => {
  function otherStaticVariable(): WorkflowVariable {
    return staticVariable({ _id: OTHER_VARIABLE_ID.toString(), name: "OTHER" });
  }

  function expectOtherVariableShown(): void {
    expect(screen.getByTestId("card:Content")).toBeInTheDocument();
    expect(screen.queryByTestId("card:Access Token")).not.toBeInTheDocument();
    expect(capturedDetails[OAUTH_SETTINGS_CARD]).toBeUndefined();
    expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();

    // The variable the page acts on is the one it read for OTHER.
    fireEvent.click(screen.getByTestId("card-button:Update Content"));
    expect(capturedContentModalProps?.variable.name).toBe("OTHER");
  }

  test("the previous variable's read answering last is ignored", async () => {
    const first: Deferred<unknown> = deferred<unknown>();
    const second: Deferred<unknown> = deferred<unknown>();
    getItem.mockReturnValueOnce(first.promise);
    getItem.mockReturnValueOnce(second.promise);

    const result: ReturnType<typeof render> = renderView();

    result.rerender(<WorkflowVariableView variableId={OTHER_VARIABLE_ID} />);

    await waitForReads(2);
    expect(getItemCall(0).id.toString()).toBe(VARIABLE_ID.toString());
    expect(getItemCall(1).id.toString()).toBe(OTHER_VARIABLE_ID.toString());

    await act(async () => {
      second.resolve(otherStaticVariable());
    });

    await waitForPage();

    await act(async () => {
      first.resolve(oauthVariable());
    });

    expectOtherVariableShown();
  });

  test("the previous variable's read answering first does not land either", async () => {
    const first: Deferred<unknown> = deferred<unknown>();
    const second: Deferred<unknown> = deferred<unknown>();
    getItem.mockReturnValueOnce(first.promise);
    getItem.mockReturnValueOnce(second.promise);

    const result: ReturnType<typeof render> = renderView();

    result.rerender(<WorkflowVariableView variableId={OTHER_VARIABLE_ID} />);

    await waitForReads(2);

    await act(async () => {
      first.resolve(oauthVariable());
    });

    // Still waiting for the variable the page is on.
    expect(screen.getByTestId("page-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();

    await act(async () => {
      second.resolve(otherStaticVariable());
    });

    await waitForPage();

    expectOtherVariableShown();
  });

  test("the previous variable's late failure does not replace the page with an error", async () => {
    const first: Deferred<unknown> = deferred<unknown>();
    const second: Deferred<unknown> = deferred<unknown>();
    getItem.mockReturnValueOnce(first.promise);
    getItem.mockReturnValueOnce(second.promise);

    const result: ReturnType<typeof render> = renderView();

    result.rerender(<WorkflowVariableView variableId={OTHER_VARIABLE_ID} />);

    await waitForReads(2);

    await act(async () => {
      second.resolve(otherStaticVariable());
    });

    await waitForPage();

    await act(async () => {
      first.reject(new Error("The API is unreachable."));
    });

    expect(
      screen.queryByText("The API is unreachable."),
    ).not.toBeInTheDocument();
    expectOtherVariableShown();
  });

  // Two saves in a row: the first save's reload must not undo the second's.
  test("an older background reload answering last is ignored", async () => {
    await renderLoaded(staticVariable({ isSecret: false }));

    const olderReload: Deferred<unknown> = holdNextRead();
    const newerReload: Deferred<unknown> = holdNextRead();

    await act(async () => {
      detail(DETAILS_CARD).onSaveSuccess?.(staticVariable());
    });
    await act(async () => {
      detail(DETAILS_CARD).onSaveSuccess?.(staticVariable({ isSecret: true }));
    });

    await waitForReads(3);

    await act(async () => {
      newerReload.resolve(staticVariable({ isSecret: true }));
    });

    await waitFor(() => {
      expect(detailFormFieldNames(DETAILS_CARD)).toEqual([
        "name",
        "description",
      ]);
    });

    await act(async () => {
      olderReload.resolve(staticVariable({ isSecret: false }));
    });

    // The secret toggle would come back if the stale read landed.
    expect(detailFormFieldNames(DETAILS_CARD)).toEqual(["name", "description"]);
  });

  test("a read that answers after the page is gone does nothing", async () => {
    const pending: Deferred<unknown> = deferred<unknown>();
    getItem.mockReturnValueOnce(pending.promise);

    const errorSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {});

    try {
      const result: ReturnType<typeof render> = renderView();

      result.unmount();

      await act(async () => {
        pending.resolve(oauthVariable());
      });

      expect(errorSpy).not.toHaveBeenCalled();
      expect(capturedDetails[DETAILS_CARD]).toBeUndefined();
      expect(capturedTokenStatusProps).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a read that fails after the page is gone does nothing", async () => {
    const pending: Deferred<unknown> = deferred<unknown>();
    getItem.mockReturnValueOnce(pending.promise);

    const errorSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {});

    try {
      const result: ReturnType<typeof render> = renderView();

      result.unmount();

      await act(async () => {
        pending.reject(new Error("The API is unreachable."));
      });

      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

/*
 * After a save or a token refresh the page reads the variable again to pick
 * up what was written. The page already shows a variable that exists, and the
 * token refresh result on top of it is the one thing somebody needs to read
 * right then - so a reload never shows the loader, and a failed one leaves
 * everything where it was.
 */
describe("reloads after a save or a token refresh", () => {
  test("a failed reload after Refresh now leaves the page and the outcome on screen", async () => {
    await renderLoaded(oauthVariable());

    const reload: Deferred<unknown> = holdNextRead();

    await clickRefreshNow();
    await waitForOutcome();
    await waitForReads(2);

    await act(async () => {
      reload.reject(new Error("The API is unreachable."));
    });

    expectOAuthPageShown();
    expect(
      screen.queryByText("The API is unreachable."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("token-refresh-modal")).toHaveAttribute(
      "data-pending",
      "false",
    );
    expect(tokenModal().outcome?.expiresAt?.toISOString()).toBe(
      TOKEN_EXPIRES_AT,
    );
    // The token status still shows the variable it had.
    expect(tokenStatus().variable.name).toBe("API_TOKEN");
    expectNoLoaderSinceLoad();
  });

  test("a failed reload after a refused Refresh now keeps the refusal on screen", async () => {
    apiPost.mockRejectedValue(new Error("invalid_client"));

    await renderLoaded(oauthVariable());

    const reload: Deferred<unknown> = holdNextRead();

    await clickRefreshNow();
    await waitForOutcome();
    await waitForReads(2);

    await act(async () => {
      reload.reject(new Error("The API is unreachable."));
    });

    expectOAuthPageShown();
    expect(screen.getByTestId("token-refresh-modal")).toBeInTheDocument();
    expect(tokenModal().outcome?.error).toBe("invalid_client");
  });

  test("a failed reload after a credentials save leaves the page and the outcome on screen", async () => {
    await renderLoaded(oauthVariable());

    const reload: Deferred<unknown> = holdNextRead();

    fireEvent.click(screen.getByTestId("card-button:Update Credentials"));

    await act(async () => {
      capturedCredentialsModalProps?.onSaved("Client secret");
    });

    await waitForOutcome();
    await waitForReads(2);

    await act(async () => {
      reload.reject(new Error("The API is unreachable."));
    });

    expectOAuthPageShown();
    expect(
      screen.queryByText("The API is unreachable."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("token-refresh-modal")).toHaveAttribute(
      "data-pending",
      "false",
    );
    expect(tokenModal().outcome?.savedWhat).toBe("Client secret");
    expect(tokenModal().variableName).toBe("API_TOKEN");
    expectNoLoaderSinceLoad();
  });

  test("a failed reload after saving the details leaves the page", async () => {
    await renderLoaded(oauthVariable());

    const reload: Deferred<unknown> = holdNextRead();

    await act(async () => {
      detail(DETAILS_CARD).onSaveSuccess?.(oauthVariable());
    });

    await waitForReads(2);

    await act(async () => {
      reload.reject(new Error("The API is unreachable."));
    });

    expectOAuthPageShown();
    expect(
      screen.queryByText("The API is unreachable."),
    ).not.toBeInTheDocument();
    expect(tokenStatus().variable.name).toBe("API_TOKEN");
    expectNoLoaderSinceLoad();
  });

  test("a failed reload after saving the OAuth 2.0 settings leaves the page", async () => {
    await renderLoaded(oauthVariable());

    const reload: Deferred<unknown> = holdNextRead();

    await act(async () => {
      detail(OAUTH_SETTINGS_CARD).onSaveSuccess?.(oauthVariable());
    });

    await waitForReads(2);

    await act(async () => {
      reload.reject(new Error("The API is unreachable."));
    });

    expectOAuthPageShown();
    expect(
      screen.queryByText("The API is unreachable."),
    ).not.toBeInTheDocument();
    expectNoLoaderSinceLoad();
  });

  test("a failed reload after saving a static variable's details leaves the page", async () => {
    await renderLoaded(staticVariable());

    const reload: Deferred<unknown> = holdNextRead();

    await act(async () => {
      detail(DETAILS_CARD).onSaveSuccess?.(staticVariable());
    });

    await waitForReads(2);

    await act(async () => {
      reload.reject(new Error("The API is unreachable."));
    });

    expect(screen.getByTestId(`detail:${DETAILS_CARD}`)).toBeInTheDocument();
    expect(screen.getByTestId("card:Content")).toBeInTheDocument();
    expect(screen.getByTestId("model-delete")).toBeInTheDocument();
    expect(
      screen.queryByText("The API is unreachable."),
    ).not.toBeInTheDocument();
  });

  // A reload that reads back nothing is a failed reload too, not a not-found page.
  test("a reload that finds no variable leaves the page and the outcome on screen", async () => {
    await renderLoaded(oauthVariable());

    const reload: Deferred<unknown> = holdNextRead();

    await clickRefreshNow();
    await waitForOutcome();
    await waitForReads(2);

    await act(async () => {
      reload.resolve(missingVariable());
    });

    expectOAuthPageShown();
    expect(screen.queryByText(NOT_FOUND_MESSAGE)).not.toBeInTheDocument();
    expect(screen.getByTestId("token-refresh-modal")).toBeInTheDocument();
  });

  test("a successful reload after Refresh now updates the token status without the loader", async () => {
    await renderLoaded(oauthVariable());

    const reload: Deferred<unknown> = holdNextRead();

    await clickRefreshNow();
    await waitForOutcome();
    await waitForReads(2);

    // The reload is out, and the page is still the page.
    expectOAuthPageShown();
    expect(tokenStatus().variable.oauthLastRefreshError).toBeUndefined();

    await act(async () => {
      reload.resolve(
        oauthVariable({ oauthLastRefreshError: "invalid_client" }),
      );
    });

    await waitFor(() => {
      expect(tokenStatus().variable.oauthLastRefreshError).toBe(
        "invalid_client",
      );
    });

    expectOAuthPageShown();
    expect(screen.getByTestId("token-refresh-modal")).toBeInTheDocument();
    // Only the first load, before the page was up, ever showed it.
    expectNoLoaderSinceLoad();
  });

  test("a successful reload after a settings save updates the page without the loader", async () => {
    await renderLoaded(oauthVariable());

    const reload: Deferred<unknown> = holdNextRead();

    await act(async () => {
      detail(OAUTH_SETTINGS_CARD).onSaveSuccess?.(oauthVariable());
    });

    await waitForReads(2);

    expectOAuthPageShown();

    await act(async () => {
      reload.resolve(oauthVariable({ oauthLastRefreshError: "invalid_scope" }));
    });

    await waitFor(() => {
      expect(tokenStatus().variable.oauthLastRefreshError).toBe(
        "invalid_scope",
      );
    });

    expectOAuthPageShown();
    expectNoLoaderSinceLoad();
  });

  test("a failed reload does not stop the next one from landing", async () => {
    await renderLoaded(oauthVariable());

    getItem.mockRejectedValueOnce(new Error("The API is unreachable."));

    await act(async () => {
      detail(DETAILS_CARD).onSaveSuccess?.(oauthVariable());
    });

    await waitForReads(2);

    getItem.mockResolvedValueOnce(
      oauthVariable({ oauthLastRefreshError: "invalid_client" }),
    );

    await clickRefreshNow();
    await waitForOutcome();

    await waitFor(() => {
      expect(tokenStatus().variable.oauthLastRefreshError).toBe(
        "invalid_client",
      );
    });

    expectOAuthPageShown();
    expectNoLoaderSinceLoad();
  });
});

describe("the variable's scope", () => {
  test("the global page refuses a variable that belongs to a workflow", async () => {
    getItem.mockResolvedValue(localStaticVariable());

    renderView();

    expect(
      await screen.findByText(/This variable belongs to a workflow/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
    expect(capturedDetails[DETAILS_CARD]).toBeUndefined();
  });

  test("a workflow's page refuses another workflow's variable", async () => {
    getItem.mockResolvedValue(
      staticVariable({ workflowId: OTHER_WORKFLOW_ID }),
    );

    renderView({ workflowId: WORKFLOW_ID });

    expect(
      await screen.findByText(
        "This variable does not belong to this workflow.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
    expect(capturedDetails[DETAILS_CARD]).toBeUndefined();
  });

  test("a workflow's page refuses a global variable", async () => {
    getItem.mockResolvedValue(staticVariable());

    renderView({ workflowId: WORKFLOW_ID });

    expect(
      await screen.findByText(
        "This variable does not belong to this workflow.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
  });

  test("the global page shows a global variable", async () => {
    await renderLoaded(staticVariable());

    expect(screen.queryByText(/does not belong/)).not.toBeInTheDocument();
    expect(screen.queryByText(/belongs to a workflow/)).not.toBeInTheDocument();
    expect(screen.getByTestId(`detail:${DETAILS_CARD}`)).toBeInTheDocument();
  });

  test("a workflow's page shows that workflow's variable", async () => {
    await renderLoaded(localStaticVariable(), WORKFLOW_ID);

    expect(screen.queryByText(/does not belong/)).not.toBeInTheDocument();
    expect(screen.getByTestId(`detail:${DETAILS_CARD}`)).toBeInTheDocument();
  });
});

describe("a static variable", () => {
  test("has an editable Variable Details card for this variable", async () => {
    await renderLoaded(staticVariable());

    const details: CapturedDetailProps = detail(DETAILS_CARD);

    expect(details.cardProps.title).toBe("Variable Details");
    expect(details.isEditable).toBe(true);
    expect(details.editButtonText).toBe("Edit Variable");
    expect(details.modelDetailProps.modelType).toBe(WorkflowVariable);
    expect(details.modelDetailProps.modelId.toString()).toBe(
      VARIABLE_ID.toString(),
    );
  });

  test("its edit form offers the name, the description and the secret toggle", async () => {
    await renderLoaded(staticVariable({ isSecret: false }));

    expect(detailFormFieldNames(DETAILS_CARD)).toEqual([
      "name",
      "description",
      "isSecret",
    ]);
  });

  /*
   * The server refuses to turn the flag off again, so a toggle that can only
   * fail is not offered once the variable is secret.
   */
  test("its edit form has no secret toggle once the variable is secret", async () => {
    await renderLoaded(staticVariable({ isSecret: true }));

    expect(detailFormFieldNames(DETAILS_CARD)).toEqual(["name", "description"]);
  });

  test("never shows or edits the content on the details card", async () => {
    await renderLoaded(staticVariable());

    const details: CapturedDetailProps = detail(DETAILS_CARD);

    for (const column of WRITE_ONLY_COLUMNS) {
      expect(detailFormFieldNames(DETAILS_CARD)).not.toContain(column);
      expect(fieldNames(details.modelDetailProps.fields)).not.toContain(column);
    }

    // The type is fixed once saved.
    expect(detailFormFieldNames(DETAILS_CARD)).not.toContain("variableType");
  });

  test("saving the details reads the variable again, and drops the toggle once it is secret", async () => {
    await renderLoaded(staticVariable({ isSecret: false }));

    getItem.mockResolvedValue(staticVariable({ isSecret: true }));

    await act(async () => {
      detail(DETAILS_CARD).onSaveSuccess?.(staticVariable({ isSecret: true }));
    });

    await waitFor(() => {
      expect(detailFormFieldNames(DETAILS_CARD)).toEqual([
        "name",
        "description",
      ]);
    });
    expect(getItem).toHaveBeenCalledTimes(2);
  });

  test("a reload after a save keeps the page on screen instead of the loader", async () => {
    await renderLoaded(staticVariable());

    const pending: Deferred<unknown> = deferred<unknown>();
    getItem.mockReturnValue(pending.promise);

    await act(async () => {
      detail(DETAILS_CARD).onSaveSuccess?.(staticVariable());
    });

    expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
    expect(screen.getByTestId(`detail:${DETAILS_CARD}`)).toBeInTheDocument();

    await act(async () => {
      pending.resolve(staticVariable());
    });

    expectNoLoaderSinceLoad();
  });

  test("shows its type as Static", async () => {
    await renderLoaded(staticVariable());

    const element: HTMLElement = renderDetailElement(
      DETAILS_CARD,
      "Type",
      staticVariable(),
    );

    expect(
      within(element).getByTestId("workflow-variable-type"),
    ).toHaveTextContent("Static");
  });

  test("shows whether it is secret", async () => {
    await renderLoaded(staticVariable());

    expect(
      renderDetailElement(
        DETAILS_CARD,
        "Secret",
        staticVariable({ isSecret: true }),
      ),
    ).toHaveTextContent("Secret");
    expect(
      renderDetailElement(
        DETAILS_CARD,
        "Secret",
        staticVariable({ isSecret: false }),
      ),
    ).toHaveTextContent("Not secret");
    expect(detailViewField(DETAILS_CARD, "Secret").description).toContain(
      "[REDACTED]",
    );
  });

  test("has a Content card with an Update Content button", async () => {
    await renderLoaded(staticVariable());

    expect(screen.getByTestId("card:Content")).toBeInTheDocument();
    expect(
      screen.getByTestId("card-button:Update Content"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-variable-content-note"),
    ).toHaveTextContent("Hidden. The content cannot be viewed once saved.");
  });

  test("never renders the content, even if the API were to return it", async () => {
    await renderLoaded(staticVariable({ content: "super-secret-value" }));

    expect(screen.queryByText(/super-secret-value/)).not.toBeInTheDocument();
  });

  test("Update Content opens the content modal for this variable", async () => {
    await renderLoaded(staticVariable());

    expect(
      screen.queryByTestId("update-content-modal"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("card-button:Update Content"));

    expect(screen.getByTestId("update-content-modal")).toBeInTheDocument();
    expect(capturedContentModalProps?.variable.name).toBe("API_KEY");
    expect(String(capturedContentModalProps?.variable.id)).toBe(
      VARIABLE_ID.toString(),
    );
  });

  test("a saved content closes the modal and says the content was updated", async () => {
    await renderLoaded(staticVariable());

    fireEvent.click(screen.getByTestId("card-button:Update Content"));

    act(() => {
      capturedContentModalProps?.onSuccess();
    });

    expect(
      screen.queryByTestId("update-content-modal"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-variable-content-note"),
    ).toHaveTextContent("Content updated.");
  });

  test("a closed content modal changes nothing", async () => {
    await renderLoaded(staticVariable());

    fireEvent.click(screen.getByTestId("card-button:Update Content"));

    act(() => {
      capturedContentModalProps?.onClose();
    });

    expect(
      screen.queryByTestId("update-content-modal"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-variable-content-note"),
    ).toHaveTextContent("Hidden.");
  });

  test("opening the content modal again clears the updated note", async () => {
    await renderLoaded(staticVariable());

    fireEvent.click(screen.getByTestId("card-button:Update Content"));

    act(() => {
      capturedContentModalProps?.onSuccess();
    });

    fireEvent.click(screen.getByTestId("card-button:Update Content"));

    expect(
      screen.getByTestId("workflow-variable-content-note"),
    ).toHaveTextContent("Hidden.");
  });

  test("has no Access Token card, no OAuth 2.0 Settings and no Update Credentials", async () => {
    await renderLoaded(staticVariable());

    expect(screen.queryByTestId("card:Access Token")).not.toBeInTheDocument();
    expect(screen.queryByTestId("token-status")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`detail:${OAUTH_SETTINGS_CARD}`),
    ).not.toBeInTheDocument();
    expect(capturedDetails[OAUTH_SETTINGS_CARD]).toBeUndefined();
    expect(
      screen.queryByTestId("card-button:Update Credentials"),
    ).not.toBeInTheDocument();
  });
});

describe("an OAuth 2.0 variable", () => {
  test("has an Access Token card showing the token's status with Refresh now", async () => {
    await renderLoaded(oauthVariable());

    expect(screen.getByTestId("card:Access Token")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("card:Access Token")).getByTestId(
        "token-status",
      ),
    ).toBeInTheDocument();
    expect(tokenStatus().variable.name).toBe("API_TOKEN");
    expect(String(tokenStatus().variable.id)).toBe(VARIABLE_ID.toString());
    expect(tokenStatus().refreshAction).toBeDefined();
    expect(screen.getByTestId("refresh-now")).toBeEnabled();
  });

  test("has an editable OAuth 2.0 Settings card for this variable", async () => {
    await renderLoaded(oauthVariable());

    const settings: CapturedDetailProps = detail(OAUTH_SETTINGS_CARD);

    expect(settings.cardProps.title).toBe("OAuth 2.0 Settings");
    expect(settings.isEditable).toBe(true);
    expect(settings.editButtonText).toBe("Edit Settings");
    expect(settings.modelDetailProps.modelType).toBe(WorkflowVariable);
    expect(settings.modelDetailProps.modelId.toString()).toBe(
      VARIABLE_ID.toString(),
    );
  });

  test("its settings form is exactly the readable settings", async () => {
    await renderLoaded(oauthVariable());

    expect(detailFormFieldNames(OAUTH_SETTINGS_CARD)).toEqual([
      "oauthTokenUrl",
      "oauthClientId",
      "oauthScope",
      "oauthAdditionalParameters",
      "oauthClientAuthenticationMethod",
    ]);
  });

  /*
   * The secret and refresh token are write-only (their own modal replaces
   * them), and the grant and the type are fixed once saved.
   */
  test("its settings form never carries a credential, the grant or the type", async () => {
    await renderLoaded(oauthVariable());

    for (const column of [
      "oauthClientSecret",
      "oauthRefreshToken",
      "oauthAccessToken",
      "oauthGrantType",
      "variableType",
      "content",
    ]) {
      expect(detailFormFieldNames(OAUTH_SETTINGS_CARD)).not.toContain(column);
    }
  });

  test("its settings card shows the grant but never a credential or a token", async () => {
    await renderLoaded(oauthVariable());

    const shown: Array<string> = fieldNames(
      detail(OAUTH_SETTINGS_CARD).modelDetailProps.fields,
    );

    expect(shown).toEqual(
      expect.arrayContaining([
        "oauthGrantType",
        "oauthTokenUrl",
        "oauthClientId",
        "oauthScope",
        "oauthClientAuthenticationMethod",
        "oauthAdditionalParameters",
      ]),
    );

    for (const column of WRITE_ONLY_COLUMNS) {
      expect(shown).not.toContain(column);
    }
  });

  test("shows the client authentication method in words", async () => {
    await renderLoaded(oauthVariable());

    expect(
      renderDetailElement(
        OAUTH_SETTINGS_CARD,
        "Client Authentication",
        oauthVariable({
          oauthClientAuthenticationMethod:
            OAuth2ClientAuthenticationMethod.RequestBody,
        }),
      ),
    ).toHaveTextContent("Request body (client_secret_post)");

    // Nothing saved means the default, HTTP Basic.
    expect(
      renderDetailElement(
        OAUTH_SETTINGS_CARD,
        "Client Authentication",
        oauthVariable(),
      ),
    ).toHaveTextContent("HTTP Basic header (client_secret_basic)");
  });

  test("its details form has no secret toggle", async () => {
    await renderLoaded(oauthVariable({ isSecret: true }));

    expect(detailFormFieldNames(DETAILS_CARD)).toEqual(["name", "description"]);
  });

  test("its details form has no secret toggle even if the flag reads false", async () => {
    await renderLoaded(oauthVariable({ isSecret: false }));

    expect(detailFormFieldNames(DETAILS_CARD)).toEqual(["name", "description"]);
  });

  test("shows its type as OAuth 2.0, and that it is always secret", async () => {
    await renderLoaded(oauthVariable());

    expect(
      renderDetailElement(DETAILS_CARD, "Type", oauthVariable()),
    ).toHaveTextContent("OAuth 2.0");
    expect(detailViewField(DETAILS_CARD, "Secret").description).toBe(
      "OAuth 2.0 variables are always secret.",
    );
  });

  test("has an Update Credentials button that opens the credentials modal for this variable", async () => {
    await renderLoaded(oauthVariable());

    expect(
      cardButton(detail(OAUTH_SETTINGS_CARD).cardProps, "Update Credentials"),
    ).toBeDefined();
    expect(
      screen.queryByTestId("update-credentials-modal"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("card-button:Update Credentials"));

    expect(screen.getByTestId("update-credentials-modal")).toBeInTheDocument();
    expect(capturedCredentialsModalProps?.variable.name).toBe("API_TOKEN");
    expect(String(capturedCredentialsModalProps?.variable.id)).toBe(
      VARIABLE_ID.toString(),
    );
  });

  test("has no Content card and no Update Content", async () => {
    await renderLoaded(oauthVariable());

    expect(screen.queryByTestId("card:Content")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("card-button:Update Content"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-variable-content-note"),
    ).not.toBeInTheDocument();
  });

  // A settings change discards the cached token, so the status is stale.
  test("saving the settings reads the variable again", async () => {
    await renderLoaded(oauthVariable());

    getItem.mockResolvedValue(
      oauthVariable({ oauthLastRefreshError: "invalid_scope" }),
    );

    await act(async () => {
      detail(OAUTH_SETTINGS_CARD).onSaveSuccess?.(oauthVariable());
    });

    await waitFor(() => {
      expect(tokenStatus().variable.oauthLastRefreshError).toBe(
        "invalid_scope",
      );
    });
    expect(getItem).toHaveBeenCalledTimes(2);
  });
});

describe("how workflows refer to the variable", () => {
  test("the global page shows {{global.variables.NAME}}", async () => {
    await renderLoaded(staticVariable());

    const element: HTMLElement = renderDetailElement(
      DETAILS_CARD,
      "Use in Workflows",
      staticVariable(),
    );

    expect(
      within(element).getByTestId("workflow-variable-reference"),
    ).toHaveTextContent("{{global.variables.API_KEY}}");
  });

  test("a workflow's page shows {{local.variables.NAME}}", async () => {
    await renderLoaded(localStaticVariable(), WORKFLOW_ID);

    const element: HTMLElement = renderDetailElement(
      DETAILS_CARD,
      "Use in Workflows",
      localStaticVariable(),
    );

    expect(
      within(element).getByTestId("workflow-variable-reference"),
    ).toHaveTextContent("{{local.variables.API_KEY}}");
  });

  test("the reference follows the name the card renders", async () => {
    await renderLoaded(oauthVariable());

    const element: HTMLElement = renderDetailElement(
      DETAILS_CARD,
      "Use in Workflows",
      oauthVariable({ name: "RENAMED_TOKEN" }),
    );

    expect(
      within(element).getByTestId("workflow-variable-reference"),
    ).toHaveTextContent("{{global.variables.RENAMED_TOKEN}}");
  });

  test("the rename warning on the name field quotes the right scope", async () => {
    await renderLoaded(staticVariable());

    const globalName: FormFieldEntry | undefined = (detail(DETAILS_CARD)
      .formFields || [])[0];

    expect(globalName?.description).toContain("{{global.variables.THIS_NAME}}");
    expect(globalName?.description).toContain("Renaming it does not update");

    cleanup();
    capturedDetails = {};

    await renderLoaded(localStaticVariable(), WORKFLOW_ID);

    const localName: FormFieldEntry | undefined = (detail(DETAILS_CARD)
      .formFields || [])[0];

    expect(localName?.description).toContain("{{local.variables.THIS_NAME}}");
  });
});

describe("Refresh now", () => {
  test("posts to the variable's refresh route with the project header", async () => {
    await renderLoaded(oauthVariable());

    await clickRefreshNow();

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledTimes(1);
    });
    expect(String(refreshCall().url)).toContain(
      `/workflow-variable/${VARIABLE_ID.toString()}/refresh-oauth-token`,
    );
    expect(refreshCall().headers).toEqual({ tenantid: "project-header" });
    expect(refreshCall().data).toEqual({});
  });

  test("shows the token that was fetched and when it expires", async () => {
    await renderLoaded(oauthVariable());

    await clickRefreshNow();
    await waitForOutcome();

    expect(screen.getByTestId("token-refresh-modal")).toHaveAttribute(
      "data-pending",
      "false",
    );
    expect(tokenModal().variableName).toBe("API_TOKEN");

    const outcome: TokenRefreshOutcome = tokenModal()
      .outcome as TokenRefreshOutcome;

    expect(outcome.variableName).toBe("API_TOKEN");
    expect(outcome.error).toBeUndefined();
    expect(outcome.savedWhat).toBeUndefined();
    expect(outcome.expiresAt?.toISOString()).toBe(TOKEN_EXPIRES_AT);
    expect(getTokenRefreshTitle(outcome)).toBe("Access Token Fetched");
  });

  test("shows the identity provider's refusal", async () => {
    apiPost.mockRejectedValue(
      new Error(
        "The token endpoint refused the request (HTTP 401): invalid_client.",
      ),
    );

    await renderLoaded(oauthVariable());

    await clickRefreshNow();
    await waitForOutcome();

    const outcome: TokenRefreshOutcome = tokenModal()
      .outcome as TokenRefreshOutcome;

    expect(outcome.error).toBe(
      "The token endpoint refused the request (HTTP 401): invalid_client.",
    );
    expect(getTokenRefreshTitle(outcome)).toBe(
      "Could Not Fetch an Access Token",
    );
    expect(getTokenRefreshDescription(outcome)).toContain("invalid_client");
  });

  // Refresh now has its own spinner, so no pending modal opens over it.
  test("spins the button while the request is out, without a pending modal", async () => {
    const pending: Deferred<unknown> = deferred<unknown>();
    apiPost.mockReturnValue(pending.promise);

    await renderLoaded(oauthVariable());

    await clickRefreshNow();

    expect(tokenStatus().refreshAction?.isLoading).toBe(true);
    expect(screen.getByTestId("refresh-now")).toBeDisabled();
    expect(screen.queryByTestId("token-refresh-modal")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve({
        data: { oauthAccessTokenExpiresAt: TOKEN_EXPIRES_AT },
      });
    });

    await waitForOutcome();

    expect(tokenStatus().refreshAction?.isLoading).toBe(false);
    expect(screen.getByTestId("refresh-now")).toBeEnabled();
  });

  // The refresh wrote the expiry, or the failure, to the variable.
  test("reads the variable again afterwards", async () => {
    await renderLoaded(oauthVariable());

    getItem.mockResolvedValue(
      oauthVariable({ oauthLastRefreshError: "invalid_client" }),
    );

    await clickRefreshNow();
    await waitForOutcome();

    await waitFor(() => {
      expect(getItem).toHaveBeenCalledTimes(2);
    });
    expect(getItemCall(1).id.toString()).toBe(VARIABLE_ID.toString());
    await waitFor(() => {
      expect(tokenStatus().variable.oauthLastRefreshError).toBe(
        "invalid_client",
      );
    });
    expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
  });

  test("reads the variable again after a failure too", async () => {
    apiPost.mockRejectedValue(new Error("invalid_client"));

    await renderLoaded(oauthVariable());

    await clickRefreshNow();
    await waitForOutcome();

    await waitFor(() => {
      expect(getItem).toHaveBeenCalledTimes(2);
    });
  });

  test("the outcome modal closes", async () => {
    await renderLoaded(oauthVariable());

    await clickRefreshNow();
    await waitForOutcome();

    act(() => {
      tokenModal().onClose();
    });

    expect(screen.queryByTestId("token-refresh-modal")).not.toBeInTheDocument();
  });
});

describe("Update Credentials", () => {
  test("closing the modal saves nothing and fetches nothing", async () => {
    await renderLoaded(oauthVariable());

    fireEvent.click(screen.getByTestId("card-button:Update Credentials"));

    act(() => {
      capturedCredentialsModalProps?.onClose();
    });

    expect(
      screen.queryByTestId("update-credentials-modal"),
    ).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.queryByTestId("token-refresh-modal")).not.toBeInTheDocument();
  });

  /*
   * A token request can take a while. The credentials modal has just closed,
   * so a pending modal says at once that a token is on its way.
   */
  test("a save closes the modal and shows a pending token modal at once", async () => {
    const pending: Deferred<unknown> = deferred<unknown>();
    apiPost.mockReturnValue(pending.promise);

    await renderLoaded(oauthVariable());

    fireEvent.click(screen.getByTestId("card-button:Update Credentials"));

    await act(async () => {
      capturedCredentialsModalProps?.onSaved("Client secret");
    });

    expect(
      screen.queryByTestId("update-credentials-modal"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("token-refresh-modal")).toHaveAttribute(
      "data-pending",
      "true",
    );
    expect(tokenModal().outcome).toBeNull();
    expect(tokenModal().variableName).toBe("API_TOKEN");
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(String(refreshCall().url)).toContain(
      `/workflow-variable/${VARIABLE_ID.toString()}/refresh-oauth-token`,
    );

    await act(async () => {
      pending.resolve({
        data: { oauthAccessTokenExpiresAt: TOKEN_EXPIRES_AT },
      });
    });

    await waitForOutcome();

    expect(screen.getByTestId("token-refresh-modal")).toHaveAttribute(
      "data-pending",
      "false",
    );
  });

  test("the outcome says what was saved and that a token was fetched", async () => {
    await renderLoaded(oauthVariable());

    fireEvent.click(screen.getByTestId("card-button:Update Credentials"));

    await act(async () => {
      capturedCredentialsModalProps?.onSaved("Client secret");
    });

    await waitForOutcome();

    const outcome: TokenRefreshOutcome = tokenModal()
      .outcome as TokenRefreshOutcome;

    expect(outcome.savedWhat).toBe("Client secret");
    expect(outcome.variableName).toBe("API_TOKEN");
    expect(outcome.error).toBeUndefined();
    expect(outcome.expiresAt?.toISOString()).toBe(TOKEN_EXPIRES_AT);
    expect(getTokenRefreshDescription(outcome)).toMatch(
      /^Client secret saved\. OneUptime fetched a new access token/,
    );
  });

  test("a saved secret the provider then refused says both", async () => {
    apiPost.mockRejectedValue(new Error("invalid_client"));

    await renderLoaded(oauthVariable());

    fireEvent.click(screen.getByTestId("card-button:Update Credentials"));

    await act(async () => {
      capturedCredentialsModalProps?.onSaved("Client secret");
    });

    await waitForOutcome();

    const outcome: TokenRefreshOutcome = tokenModal()
      .outcome as TokenRefreshOutcome;

    expect(outcome.savedWhat).toBe("Client secret");
    expect(outcome.error).toBe("invalid_client");
    expect(getTokenRefreshTitle(outcome)).toBe(
      "Could Not Fetch an Access Token",
    );
    expect(getTokenRefreshDescription(outcome)).toMatch(
      /^Client secret saved\. /,
    );
  });

  test("reads the variable again after the token request", async () => {
    await renderLoaded(oauthVariable());

    fireEvent.click(screen.getByTestId("card-button:Update Credentials"));

    await act(async () => {
      capturedCredentialsModalProps?.onSaved("Client secret and refresh token");
    });

    await waitForOutcome();

    await waitFor(() => {
      expect(getItem).toHaveBeenCalledTimes(2);
    });
    expect(tokenModal().outcome?.savedWhat).toBe(
      "Client secret and refresh token",
    );
  });
});

describe("permissions", () => {
  describe("with permission to update variables", () => {
    test("Update Content is enabled and says what it does", async () => {
      await renderLoaded(staticVariable());

      const button: HTMLElement = screen.getByTestId(
        "card-button:Update Content",
      );

      expect(button).toBeEnabled();
      expect(button.getAttribute("title")).toContain(
        "Replace this variable's content",
      );
    });

    test("Update Credentials and Refresh now are enabled", async () => {
      await renderLoaded(oauthVariable());

      expect(
        screen.getByTestId("card-button:Update Credentials"),
      ).toBeEnabled();
      expect(screen.getByTestId("refresh-now")).toBeEnabled();
      expect(tokenStatus().refreshAction?.disabled).toBe(false);
      expect(tokenStatus().refreshAction?.tooltip).toContain(
        "Fetch a new access token",
      );
    });

    test("the details and settings cards are editable", async () => {
      await renderLoaded(oauthVariable());

      expect(detail(DETAILS_CARD).isEditable).toBe(true);
      expect(detail(OAUTH_SETTINGS_CARD).isEditable).toBe(true);
    });
  });

  describe("without permission to update variables", () => {
    beforeEach(() => {
      permissionsForTest = [Permission.Viewer];
    });

    test("Update Content is shown disabled, naming the permission it needs", async () => {
      await renderLoaded(staticVariable());

      const button: HTMLElement = screen.getByTestId(
        "card-button:Update Content",
      );

      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", missingUpdatePermissionMessage());
      expect(button.getAttribute("title")).toContain(
        "You do not have permission to update",
      );
      expect(button.getAttribute("title")).toContain("Project Admin");
    });

    test("Update Content opens nothing even if its click fires", async () => {
      await renderLoaded(staticVariable());

      act(() => {
        cardButton(card("Content"), "Update Content")!.onClick();
      });

      expect(
        screen.queryByTestId("update-content-modal"),
      ).not.toBeInTheDocument();
    });

    test("Update Credentials is shown disabled, naming the permission it needs", async () => {
      await renderLoaded(oauthVariable());

      const button: HTMLElement = screen.getByTestId(
        "card-button:Update Credentials",
      );

      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", missingUpdatePermissionMessage());
    });

    test("Update Credentials opens nothing even if its click fires", async () => {
      await renderLoaded(oauthVariable());

      act(() => {
        cardButton(
          detail(OAUTH_SETTINGS_CARD).cardProps,
          "Update Credentials",
        )!.onClick();
      });

      expect(
        screen.queryByTestId("update-credentials-modal"),
      ).not.toBeInTheDocument();
    });

    test("Refresh now is shown disabled, naming the permission it needs", async () => {
      await renderLoaded(oauthVariable());

      expect(screen.getByTestId("refresh-now")).toBeDisabled();
      expect(tokenStatus().refreshAction?.disabled).toBe(true);
      expect(tokenStatus().refreshAction?.tooltip).toBe(
        missingUpdatePermissionMessage(),
      );
    });
  });

  /*
   * The snapshot arrives on a response header, so it is empty for a moment
   * after login. A disabled button then would blame somebody who may well
   * hold the permission, so the affordances stay hidden instead.
   */
  describe("while the permission snapshot is still empty", () => {
    beforeEach(() => {
      permissionsForTest = [];
    });

    test("Update Content is hidden, but the Content card stays", async () => {
      await renderLoaded(staticVariable());

      expect(screen.getByTestId("card:Content")).toBeInTheDocument();
      expect(
        screen.queryByTestId("card-button:Update Content"),
      ).not.toBeInTheDocument();
      expect(card("Content").buttons).toEqual([]);
    });

    test("Update Credentials and Refresh now are hidden, but the cards stay", async () => {
      await renderLoaded(oauthVariable());

      expect(screen.getByTestId("card:Access Token")).toBeInTheDocument();
      expect(
        screen.getByTestId(`detail:${OAUTH_SETTINGS_CARD}`),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("card-button:Update Credentials"),
      ).not.toBeInTheDocument();
      expect(detail(OAUTH_SETTINGS_CARD).cardProps.buttons).toEqual([]);
      expect(screen.queryByTestId("refresh-now")).not.toBeInTheDocument();
      expect(tokenStatus().refreshAction).toBeUndefined();
    });
  });

  test("a master admin may update without any project permission", async () => {
    permissionsForTest = [];
    isMasterAdminForTest = true;

    await renderLoaded(oauthVariable());

    expect(screen.getByTestId("card-button:Update Credentials")).toBeEnabled();
    expect(screen.getByTestId("refresh-now")).toBeEnabled();
  });
});

describe("deleting the variable", () => {
  test("the delete card deletes this workflow variable", async () => {
    await renderLoaded(staticVariable());

    expect(capturedDeleteProps?.modelType).toBe(WorkflowVariable);
    expect(capturedDeleteProps?.modelId.toString()).toBe(
      VARIABLE_ID.toString(),
    );
  });

  test("an OAuth 2.0 variable can be deleted too", async () => {
    await renderLoaded(oauthVariable());

    expect(screen.getByTestId("model-delete")).toBeInTheDocument();
    expect(capturedDeleteProps?.modelId.toString()).toBe(
      VARIABLE_ID.toString(),
    );
  });

  test("after a delete the global page goes back to the global variables", async () => {
    await renderLoaded(staticVariable());

    act(() => {
      capturedDeleteProps?.onDeleteSuccess();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID.toString()}/workflows/variables`,
    );
  });

  test("after a delete a workflow's page goes back to that workflow's variables", async () => {
    await renderLoaded(localStaticVariable(), WORKFLOW_ID);

    act(() => {
      capturedDeleteProps?.onDeleteSuccess();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID.toString()}/workflows/${WORKFLOW_ID.toString()}/variables`,
    );
  });
});

/*
 * The list's row actions (Show ID, Update Content, Update Credentials, Edit
 * Details, Delete) and its Token column's Refresh now all moved here. If one
 * goes missing from the page, it is gone from the product.
 */
describe("everything the list's row actions used to do", () => {
  test("a static variable's page can show its id, edit it, replace its content and delete it", async () => {
    await renderLoaded(staticVariable());

    expect(fieldNames(detail(DETAILS_CARD).modelDetailProps.fields)).toContain(
      "_id",
    );
    expect(detail(DETAILS_CARD).isEditable).toBe(true);
    expect(
      screen.getByTestId("card-button:Update Content"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("model-delete")).toBeInTheDocument();
  });

  test("an OAuth 2.0 variable's page can show its id, edit it, replace its credentials, refresh its token and delete it", async () => {
    await renderLoaded(oauthVariable());

    expect(fieldNames(detail(DETAILS_CARD).modelDetailProps.fields)).toContain(
      "_id",
    );
    expect(detail(DETAILS_CARD).isEditable).toBe(true);
    expect(detail(OAUTH_SETTINGS_CARD).isEditable).toBe(true);
    expect(
      screen.getByTestId("card-button:Update Credentials"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("refresh-now")).toBeInTheDocument();
    expect(screen.getByTestId("model-delete")).toBeInTheDocument();
  });

  test("the same doors are there on a workflow's page", async () => {
    await renderLoaded(localOAuthVariable(), WORKFLOW_ID);

    expect(detail(DETAILS_CARD).isEditable).toBe(true);
    expect(detail(OAUTH_SETTINGS_CARD).isEditable).toBe(true);
    expect(
      screen.getByTestId("card-button:Update Credentials"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("refresh-now")).toBeInTheDocument();
    expect(screen.getByTestId("model-delete")).toBeInTheDocument();
  });
});

describe("the page wrappers", () => {
  describe("Workflows > Global Variables > View Variable", () => {
    function renderGlobalPage(): void {
      render(
        <GlobalWorkflowVariableViewPage
          {...({} as unknown as React.ComponentProps<
            typeof GlobalWorkflowVariableViewPage
          >)}
        />,
      );
    }

    beforeEach(() => {
      // /dashboard/:projectId/workflows/variables/:id
      lastParams = { 0: VARIABLE_ID };
    });

    test("reads the variable named by the last route segment", async () => {
      getItem.mockResolvedValue(staticVariable());

      renderGlobalPage();

      await waitForPage();

      expect(getLastParamAsObjectID).toHaveBeenCalledWith(0);
      expect(getItemCall().id.toString()).toBe(VARIABLE_ID.toString());
      expect(capturedDeleteProps?.modelId.toString()).toBe(
        VARIABLE_ID.toString(),
      );
    });

    test("is the global page: a global reference, and back to the global list after a delete", async () => {
      getItem.mockResolvedValue(staticVariable());

      renderGlobalPage();

      await waitForPage();

      expect(
        within(
          renderDetailElement(
            DETAILS_CARD,
            "Use in Workflows",
            staticVariable(),
          ),
        ).getByTestId("workflow-variable-reference"),
      ).toHaveTextContent("{{global.variables.API_KEY}}");

      act(() => {
        capturedDeleteProps?.onDeleteSuccess();
      });

      expect(String(navigate.mock.calls[0]![0])).toBe(
        `/dashboard/${PROJECT_ID.toString()}/workflows/variables`,
      );
    });

    test("refuses a variable that belongs to a workflow", async () => {
      getItem.mockResolvedValue(localStaticVariable());

      renderGlobalPage();

      expect(
        await screen.findByText(/This variable belongs to a workflow/),
      ).toBeInTheDocument();
    });
  });

  describe("Workflow > Workflow Variables > View Variable", () => {
    function renderLocalPage(): void {
      render(
        <LocalWorkflowVariableViewPage
          {...({} as unknown as React.ComponentProps<
            typeof LocalWorkflowVariableViewPage
          >)}
        />,
      );
    }

    beforeEach(() => {
      // /dashboard/:projectId/workflows/:id/variables/:subModelId
      lastParams = { 0: VARIABLE_ID, 2: WORKFLOW_ID };
    });

    test("reads the variable from the last segment and the workflow from two before it", async () => {
      getItem.mockResolvedValue(localStaticVariable());

      renderLocalPage();

      await waitForPage();

      expect(getLastParamAsObjectID).toHaveBeenCalledWith(0);
      expect(getLastParamAsObjectID).toHaveBeenCalledWith(2);
      expect(getItemCall().id.toString()).toBe(VARIABLE_ID.toString());
      expect(capturedDeleteProps?.modelId.toString()).toBe(
        VARIABLE_ID.toString(),
      );
    });

    test("is the workflow's page: a local reference, and back to its variables after a delete", async () => {
      getItem.mockResolvedValue(localStaticVariable());

      renderLocalPage();

      await waitForPage();

      expect(
        within(
          renderDetailElement(
            DETAILS_CARD,
            "Use in Workflows",
            localStaticVariable(),
          ),
        ).getByTestId("workflow-variable-reference"),
      ).toHaveTextContent("{{local.variables.API_KEY}}");

      act(() => {
        capturedDeleteProps?.onDeleteSuccess();
      });

      expect(String(navigate.mock.calls[0]![0])).toBe(
        `/dashboard/${PROJECT_ID.toString()}/workflows/${WORKFLOW_ID.toString()}/variables`,
      );
    });

    test("refuses another workflow's variable", async () => {
      getItem.mockResolvedValue(
        staticVariable({ workflowId: OTHER_WORKFLOW_ID }),
      );

      renderLocalPage();

      expect(
        await screen.findByText(
          "This variable does not belong to this workflow.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
    });

    test("refuses a global variable", async () => {
      getItem.mockResolvedValue(staticVariable());

      renderLocalPage();

      expect(
        await screen.findByText(
          "This variable does not belong to this workflow.",
        ),
      ).toBeInTheDocument();
    });

    // A deleted variable's link: it is gone, not someone else's.
    test("says a missing variable could not be found, not that it belongs elsewhere", async () => {
      getItem.mockResolvedValue(missingVariable());

      renderLocalPage();

      expect(await screen.findByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
      expect(
        screen.queryByText("This variable does not belong to this workflow."),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("model-delete")).not.toBeInTheDocument();
    });
  });
});
