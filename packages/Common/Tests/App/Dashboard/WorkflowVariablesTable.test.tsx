import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The workflow variables list - Workflows > Global Variables and Workflow >
 * View > Workflow Variables - after it was simplified.
 *
 * What was asked for, and what every describe block below pins down:
 *
 *   1. The list shows Name, Type and Description. The Secret, Token and
 *      Created At columns are gone.
 *   2. A row has one action, View, which opens the variable's own page. Show
 *      ID, Update Content, Edit Details and Delete are no longer row actions.
 *   3. Create makes a static variable and never asks which kind. An OAuth 2.0
 *      variable is created from the More (⋯) menu beside it.
 *   4. Both of the above on the global page and on a workflow's own page.
 *
 * ModelTable, the OAuth create form and the token refresh modal are replaced
 * by prop recorders: what is under test is the configuration the page hands
 * them and what the page does when their callbacks fire. The real table
 * fetches on mount.
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

const getLastParamAsObjectID: ReturnType<
  typeof jest.fn<(position: number) => unknown>
> = jest.fn<(position: number) => unknown>();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (position: number): unknown => {
        return getLastParamAsObjectID(position);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
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
      // The same precedence as the real one, for the two shapes used here.
      getFriendlyMessage: (error: unknown): string => {
        if (error instanceof HTTPErrorResponse) {
          return error.message || "Server Error. Please try again";
        }

        return error instanceof Error ? error.message : "Request failed.";
      },
    },
  };
});

type FormFieldEntry = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  stepId?: string | undefined;
  fieldType?: string | undefined;
  required?:
    | boolean
    | ((values: Record<string, unknown>) => boolean)
    | undefined;
  description?: string | undefined;
  placeholder?: string | undefined;
  validation?: Record<string, unknown> | undefined;
  showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
  doNotShowWhenCreating?: boolean | undefined;
  cardSelectOptions?: Array<unknown> | undefined;
  dropdownOptions?: Array<unknown> | undefined;
};

type ColumnEntry = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  type?: string | undefined;
  getElement?: ((item: unknown) => ReactElement) | undefined;
};

type CardButtonEntry = {
  title: string;
  icon?: IconProp | undefined;
  buttonStyle?: ButtonStyleType | undefined;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  onClick: () => void;
};

type CapturedTableProps = {
  id?: string | undefined;
  name?: string | undefined;
  userPreferencesKey?: string | undefined;
  saveFilterProps?: { tableId?: string | undefined } | undefined;
  isEditable?: boolean | undefined;
  isDeleteable?: boolean | undefined;
  isCreateable?: boolean | undefined;
  isViewable?: boolean | undefined;
  viewButtonText?: string | undefined;
  showViewIdButton?: boolean | undefined;
  editButtonText?: string | undefined;
  onViewPage?: ((item: unknown) => Promise<unknown>) | undefined;
  actionButtons?: Array<{ title: string }> | undefined;
  cardProps?:
    | {
        title?: string | undefined;
        description?: string | undefined;
        buttons?: Array<CardButtonEntry> | undefined;
      }
    | undefined;
  query?: Record<string, unknown> | undefined;
  selectMoreFields?: Record<string, unknown> | undefined;
  formFields?: Array<FormFieldEntry> | undefined;
  formSteps?: Array<unknown> | undefined;
  onBeforeCreate?: ((item: unknown) => Promise<unknown>) | undefined;
  onFetchSuccess?:
    | ((data: Array<unknown>, totalCount: number) => void)
    | undefined;
  refreshToggle?: string | undefined;
  noItemsMessage?: string | undefined;
  showRefreshButton?: boolean | undefined;
  searchableFields?: Array<string> | undefined;
  filters?:
    | Array<{
        field?: Record<string, unknown> | undefined;
        title?: string | undefined;
      }>
    | undefined;
  columns?: Array<ColumnEntry> | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): null => {
      capturedTableProps = props;
      return null;
    },
  };
});

type CapturedOAuthModalProps = {
  workflowId?: ObjectID | undefined;
  onClose: () => void;
  onSuccess: (variable: WorkflowVariable) => void;
};

let capturedOAuthModalProps: CapturedOAuthModalProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/CreateOAuthWorkflowVariableModal",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedOAuthModalProps): ReactElement => {
        capturedOAuthModalProps = props;
        return <div data-testid="create-oauth-variable-modal" />;
      },
    };
  },
);

type CapturedRefreshModalProps = {
  variableName: string;
  outcome: TokenRefreshOutcome | null;
  onClose: () => void;
};

let capturedRefreshModalProps: CapturedRefreshModalProps | null = null;

// Every outcome the modal was rendered with, in order - null is "pending".
let refreshModalOutcomes: Array<TokenRefreshOutcome | null> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableTokenRefreshModal",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedRefreshModalProps): ReactElement => {
        capturedRefreshModalProps = props;
        refreshModalOutcomes.push(props.outcome);
        return <div data-testid="token-refresh-modal" />;
      },
    };
  },
);

import GlobalVariablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Variable";
import WorkflowVariablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Variable";
import { TokenRefreshOutcome } from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const VARIABLE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_VARIABLE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const EXPIRES_AT_ISO: string = "2030-01-01T10:00:00.000Z";

const OAUTH_MENU_TITLE: string = "Create OAuth 2.0 Variable";

// The columns, and their fields, the list no longer shows.
const REMOVED_COLUMN_TITLES: Array<string> = ["Secret", "Token", "Created At"];
const REMOVED_COLUMN_FIELDS: Array<string> = [
  "isSecret",
  "oauthAccessTokenExpiresAt",
  "oauthLastRefreshedAt",
  "oauthLastRefreshError",
  "oauthLastRefreshErrorAt",
  "createdAt",
];

// The row actions the list used to offer, and no longer does.
const REMOVED_ROW_ACTIONS: Array<string> = [
  "Show ID",
  "Update Content",
  "Update Credentials",
  "Edit Details",
  "Edit",
  "Delete",
];

// Write-only or secret columns: no list request may ever select them.
const NEVER_SELECTED_FIELDS: Array<string> = [
  "content",
  "oauthClientSecret",
  "oauthRefreshToken",
  "oauthAccessToken",
];

type Page = "global" | "local";

type PageCase = {
  page: Page;
  workflowId: ObjectID | undefined;
  cardTitle: string;
  noItemsMessage: string;
  reference: string;
  otherReference: string;
  viewRoute: string;
  otherViewRoute: string;
};

const PAGE_CASES: Array<PageCase> = [
  {
    page: "global",
    workflowId: undefined,
    cardTitle: "Global Variables",
    noItemsMessage: "No global variables found.",
    reference: "{{global.variables.THIS_NAME}}",
    otherReference: "{{local.variables.THIS_NAME}}",
    viewRoute: `/dashboard/${PROJECT_ID.toString()}/workflows/variables/${VARIABLE_ID.toString()}`,
    otherViewRoute: `/dashboard/${PROJECT_ID.toString()}/workflows/variables/${OTHER_VARIABLE_ID.toString()}`,
  },
  {
    page: "local",
    workflowId: WORKFLOW_ID,
    cardTitle: "Workflow Variables",
    noItemsMessage: "No workflow variables found.",
    reference: "{{local.variables.THIS_NAME}}",
    otherReference: "{{global.variables.THIS_NAME}}",
    viewRoute: `/dashboard/${PROJECT_ID.toString()}/workflows/${WORKFLOW_ID.toString()}/variables/${VARIABLE_ID.toString()}`,
    otherViewRoute: `/dashboard/${PROJECT_ID.toString()}/workflows/${WORKFLOW_ID.toString()}/variables/${OTHER_VARIABLE_ID.toString()}`,
  },
];

function renderPage(page: Page): void {
  const props: Record<string, unknown> = {};

  if (page === "global") {
    render(
      <GlobalVariablesPage
        {...(props as unknown as React.ComponentProps<
          typeof GlobalVariablesPage
        >)}
      />,
    );
    return;
  }

  render(
    <WorkflowVariablesPage
      {...(props as unknown as React.ComponentProps<
        typeof WorkflowVariablesPage
      >)}
    />,
  );
}

function table(): CapturedTableProps {
  if (!capturedTableProps) {
    throw new Error("The page rendered no ModelTable");
  }

  return capturedTableProps;
}

function fieldName(entry: {
  field?: Record<string, unknown> | undefined;
}): string {
  return Object.keys(entry.field || {})[0] || "";
}

function formFieldNames(): Array<string> {
  return (table().formFields || []).map((entry: FormFieldEntry) => {
    return fieldName(entry);
  });
}

function formField(name: string): FormFieldEntry {
  const entry: FormFieldEntry | undefined = (table().formFields || []).find(
    (field: FormFieldEntry) => {
      return fieldName(field) === name;
    },
  );

  if (!entry) {
    throw new Error(`No form field for the "${name}" column`);
  }

  return entry;
}

function column(title: string): ColumnEntry {
  const entry: ColumnEntry | undefined = (table().columns || []).find(
    (candidate: ColumnEntry) => {
      return candidate.title === title;
    },
  );

  if (!entry) {
    throw new Error(`The table has no ${title} column`);
  }

  return entry;
}

function moreMenuButtons(): Array<CardButtonEntry> {
  return table().cardProps?.buttons || [];
}

function oauthMenuButton(): CardButtonEntry {
  const button: CardButtonEntry | undefined = moreMenuButtons().find(
    (entry: CardButtonEntry) => {
      return entry.title === OAUTH_MENU_TITLE;
    },
  );

  if (!button) {
    throw new Error(`The More menu offers no "${OAUTH_MENU_TITLE}"`);
  }

  return button;
}

function isOAuthFormOpen(): boolean {
  return screen.queryByTestId("create-oauth-variable-modal") !== null;
}

function oauthForm(): CapturedOAuthModalProps {
  if (!isOAuthFormOpen() || !capturedOAuthModalProps) {
    throw new Error("The OAuth 2.0 create form is not open");
  }

  return capturedOAuthModalProps;
}

function isRefreshModalOpen(): boolean {
  return screen.queryByTestId("token-refresh-modal") !== null;
}

function refreshModal(): CapturedRefreshModalProps {
  if (!isRefreshModalOpen() || !capturedRefreshModalProps) {
    throw new Error("The token refresh modal is not open");
  }

  return capturedRefreshModalProps;
}

function openOAuthForm(): void {
  act(() => {
    oauthMenuButton().onClick();
  });
}

function staticVariable(): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable._id = VARIABLE_ID.toString();
  variable.name = "PLAIN";
  variable.variableType = WorkflowVariableType.Static;
  return variable;
}

function oauthVariable(
  overrides?: Partial<Record<string, unknown>> | undefined,
): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable._id = VARIABLE_ID.toString();
  variable.name = "API_TOKEN";
  variable.variableType = WorkflowVariableType.OAuth2;
  variable.oauthGrantType = OAuth2GrantType.ClientCredentials;

  for (const [key, value] of Object.entries(overrides || {})) {
    (variable as unknown as Record<string, unknown>)[key] = value;
  }

  return variable;
}

function refreshCall(callIndex: number = 0): {
  url: string;
  headers: unknown;
  data: unknown;
} {
  const call: { url: unknown; headers: unknown; data: unknown } = apiPost.mock
    .calls[callIndex]![0] as { url: unknown; headers: unknown; data: unknown };

  return { url: String(call.url), headers: call.headers, data: call.data };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {
    // Replaced below, synchronously, by the promise executor.
  };
  let reject: (error: unknown) => void = (): void => {
    // Replaced below, synchronously, by the promise executor.
  };

  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
}

/*
 * Fires the open OAuth form's onSuccess with the saved variable and lets
 * whatever it starts settle. Waits for nothing in particular, so it also
 * serves the cases where no token is asked for at all.
 */
async function saveOAuthVariable(variable: WorkflowVariable): Promise<void> {
  await act(async () => {
    oauthForm().onSuccess(variable);
  });

  // A few more turns, so a request sent late would still be seen.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/*
 * Opens the OAuth form from the More menu and fires its onSuccess with the
 * saved variable, then waits for the token outcome to land in the modal.
 */
async function createOAuthVariable(variable: WorkflowVariable): Promise<void> {
  openOAuthForm();

  await saveOAuthVariable(variable);

  await waitFor(() => {
    expect(capturedRefreshModalProps?.outcome).toBeTruthy();
  });
}

type RoleCase = {
  label: string;
  permissions: Array<Permission>;
};

/*
 * Roles on WorkflowVariable's create list but not its update list. The
 * refresh route writes the token to the variable, so it checks for update and
 * would refuse every one of these.
 */
const CREATE_ONLY_ROLES: Array<RoleCase> = [
  {
    label: "Create and Read Workflow Variables",
    permissions: [
      Permission.CreateWorkflowVariable,
      Permission.ReadWorkflowVariable,
    ],
  },
  { label: "Project Member", permissions: [Permission.ProjectMember] },
  { label: "Workflow Admin", permissions: [Permission.WorkflowAdmin] },
  { label: "Workflow Member", permissions: [Permission.WorkflowMember] },
  /*
   * A workflow variable is not an operational resource, so the Edit All
   * wildcard does not widen its update list - here or on the server.
   */
  {
    label: "Create Workflow Variables with Edit All Operational Resources",
    permissions: [
      Permission.CreateWorkflowVariable,
      Permission.EditAllOperationalResources,
    ],
  },
];

// Roles on both lists: these may create the variable and fetch its token.
const CREATE_AND_UPDATE_ROLES: Array<RoleCase> = [
  { label: "Project Admin", permissions: [Permission.ProjectAdmin] },
  { label: "Project Owner", permissions: [Permission.ProjectOwner] },
  {
    label: "Create and Edit Workflow Variables",
    permissions: [
      Permission.CreateWorkflowVariable,
      Permission.EditWorkflowVariable,
    ],
  },
];

let clockTick: number = 0;
let currentDateSpy: SpyInstance<() => Date> | null = null;

beforeEach(() => {
  capturedTableProps = null;
  capturedOAuthModalProps = null;
  capturedRefreshModalProps = null;
  refreshModalOutcomes = [];
  apiPost.mockReset();
  apiPost.mockResolvedValue({
    data: { oauthAccessTokenExpiresAt: EXPIRES_AT_ISO },
  });
  getLastParamAsObjectID.mockReset();
  getLastParamAsObjectID.mockReturnValue(WORKFLOW_ID);
  permissionsForTest = [Permission.ProjectAdmin];
  isMasterAdminForTest = false;
  PermissionGate.clearPermissionPropsCache();

  /*
   * refreshToggle is an ISO timestamp. Two bumps inside the same millisecond
   * would be the same string and read as "not refreshed", so every read of
   * the clock moves it on by a second.
   */
  clockTick = 0;
  currentDateSpy = jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockImplementation((): Date => {
      clockTick++;
      return new Date(Date.UTC(2026, 8, 23, 12, 0, 0) + clockTick * 1000);
    });
});

afterEach(() => {
  cleanup();
  currentDateSpy?.mockRestore();
  currentDateSpy = null;
});

describe("the pages", () => {
  test("the global page lists the project's variables, with no workflow", () => {
    renderPage("global");

    expect(table().query?.["workflowId"]).toBeInstanceOf(IsNull);
    expect(getLastParamAsObjectID).not.toHaveBeenCalled();
  });

  // /dashboard/:projectId/workflows/:id/variables - the id is one from the end.
  test("the workflow page reads the workflow id from the URL", () => {
    renderPage("local");

    expect(getLastParamAsObjectID).toHaveBeenCalledWith(1);
    expect(table().query?.["workflowId"]).toBe(WORKFLOW_ID);
  });
});

describe.each(PAGE_CASES)("the $page variables list", (pageCase: PageCase) => {
  describe("columns", () => {
    test("are exactly Name, Type and Description", () => {
      renderPage(pageCase.page);

      expect(
        (table().columns || []).map((entry: ColumnEntry) => {
          return entry.title;
        }),
      ).toEqual(["Name", "Type", "Description"]);

      expect(
        (table().columns || []).map((entry: ColumnEntry) => {
          return fieldName(entry);
        }),
      ).toEqual(["name", "variableType", "description"]);
    });

    // Ask 1, stated as a test.
    test("no longer include Secret, Token or Created At", () => {
      renderPage(pageCase.page);

      for (const entry of table().columns || []) {
        expect(REMOVED_COLUMN_TITLES).not.toContain(entry.title);
        expect(REMOVED_COLUMN_FIELDS).not.toContain(fieldName(entry));
      }
    });

    test("a static variable's Type reads Static", () => {
      renderPage(pageCase.page);

      render(column("Type").getElement!(staticVariable()));

      expect(screen.getByText("Static")).toBeInTheDocument();
      expect(screen.queryByText("OAuth 2.0")).not.toBeInTheDocument();
    });

    // Rows saved before OAuth 2.0 variables existed have no type at all.
    test("a variable with no type reads Static", () => {
      renderPage(pageCase.page);

      const variable: WorkflowVariable = new WorkflowVariable();
      variable._id = VARIABLE_ID.toString();
      variable.name = "LEGACY";

      render(column("Type").getElement!(variable));

      expect(screen.getByText("Static")).toBeInTheDocument();
    });

    test("an OAuth 2.0 variable's Type reads OAuth 2.0, with its grant type underneath", () => {
      renderPage(pageCase.page);

      render(column("Type").getElement!(oauthVariable()));

      expect(screen.getByText("OAuth 2.0")).toBeInTheDocument();
      expect(screen.getByText("Client Credentials")).toBeInTheDocument();
      expect(screen.queryByText("Static")).not.toBeInTheDocument();
    });

    test("names the Refresh Token grant too", () => {
      renderPage(pageCase.page);

      render(
        column("Type").getElement!(
          oauthVariable({ oauthGrantType: OAuth2GrantType.RefreshToken }),
        ),
      );

      expect(screen.getByText("OAuth 2.0")).toBeInTheDocument();
      expect(screen.getByText("Refresh Token")).toBeInTheDocument();
    });

    test("an OAuth 2.0 variable with no grant type reads OAuth 2.0 alone", () => {
      renderPage(pageCase.page);

      const cell: ReturnType<typeof render> = render(
        column("Type").getElement!(
          oauthVariable({ oauthGrantType: undefined }),
        ),
      );

      expect(cell.container.textContent).toBe("OAuth 2.0");
    });

    test("filters and searches only on what the list shows", () => {
      renderPage(pageCase.page);

      expect(
        (table().filters || []).map(
          (entry: { field?: Record<string, unknown> | undefined }) => {
            return fieldName(entry);
          },
        ),
      ).toEqual(["name", "description"]);
      expect(table().searchableFields).toEqual(["name", "description"]);
    });
  });

  describe("row actions", () => {
    // Ask 2, stated as a test.
    test("are a single View button", () => {
      renderPage(pageCase.page);

      expect(table().isViewable).toBe(true);
      expect(table().viewButtonText).toBe("View");
      expect(table().showViewIdButton).toBeFalsy();
      expect(table().isEditable).toBe(false);
      expect(table().isDeleteable).toBe(false);
      expect(table().actionButtons || []).toEqual([]);
    });

    test("no longer offer Show ID, Update Content, Update Credentials, Edit Details or Delete", () => {
      renderPage(pageCase.page);

      const titles: Array<string> = (table().actionButtons || []).map(
        (entry: { title: string }) => {
          return entry.title;
        },
      );

      for (const removed of REMOVED_ROW_ACTIONS) {
        expect(titles).not.toContain(removed);
      }

      // No Edit button left over under a new name, either.
      expect(table().editButtonText).toBeUndefined();
    });

    test("View opens the variable's own page", async () => {
      renderPage(pageCase.page);

      const route: unknown = await table().onViewPage!(staticVariable());

      expect(String(route)).toBe(pageCase.viewRoute);
    });

    test("View opens an OAuth 2.0 variable's page the same way", async () => {
      renderPage(pageCase.page);

      const route: unknown = await table().onViewPage!(oauthVariable());

      expect(String(route)).toBe(pageCase.viewRoute);
    });

    test("View opens the page of the row it was pressed on", async () => {
      renderPage(pageCase.page);

      const variable: WorkflowVariable = staticVariable();
      variable._id = OTHER_VARIABLE_ID.toString();

      const route: unknown = await table().onViewPage!(variable);

      expect(String(route)).toBe(pageCase.otherViewRoute);
    });

    // A route with ":id" still in it would open a page that cannot load.
    test("View refuses a row without an id rather than opening a broken page", async () => {
      renderPage(pageCase.page);

      const variable: WorkflowVariable = new WorkflowVariable();
      variable.name = "NO_ID";

      await expect(table().onViewPage!(variable)).rejects.toThrow(
        "This variable has no id",
      );
    });
  });

  describe("the Create form", () => {
    test("is still offered, on a card named for the page", () => {
      renderPage(pageCase.page);

      expect(table().isCreateable).toBe(true);
      expect(table().cardProps?.title).toBe(pageCase.cardTitle);
      expect(table().noItemsMessage).toBe(pageCase.noItemsMessage);
      expect(table().name).toBe("Workflows");
      expect(table().showRefreshButton).toBe(true);
    });

    test("asks only for a static variable's name, description, content and secret toggle", () => {
      renderPage(pageCase.page);

      expect(formFieldNames()).toEqual([
        "name",
        "description",
        "content",
        "isSecret",
      ]);
    });

    // Ask 3, stated as a test.
    test("never asks which kind of variable to create", () => {
      renderPage(pageCase.page);

      expect(formFieldNames()).not.toContain("variableType");
      expect(table().formSteps || []).toEqual([]);

      for (const entry of table().formFields || []) {
        expect(entry.fieldType).not.toBe("CardSelect");
        expect(entry.cardSelectOptions).toBeUndefined();
        // Nothing on the form hides or shows by a type the form never sets.
        expect(entry.showIf).toBeUndefined();
        expect(entry.stepId).toBeUndefined();
      }
    });

    test("carries none of the OAuth 2.0 settings", () => {
      renderPage(pageCase.page);

      for (const name of formFieldNames()) {
        expect(name.startsWith("oauth")).toBe(false);
      }
    });

    test("requires the content, and says it cannot be viewed again", () => {
      renderPage(pageCase.page);

      expect(formField("content").required).toBe(true);
      expect(formField("content").fieldType).toBe("LongText");
      expect(formField("content").doNotShowWhenCreating).toBeFalsy();
      expect(formField("content").description).toContain(
        "cannot be viewed once saved",
      );
    });

    test("offers the Secret toggle, optional, and describes redaction rather than encryption", () => {
      renderPage(pageCase.page);

      const secret: FormFieldEntry = formField("isSecret");

      expect(secret.fieldType).toBe("Boolean");
      expect(secret.required).toBe(false);
      expect(secret.description).toContain("[REDACTED]");
      expect(secret.description).toContain("cannot be turned off again");
      expect(secret.description).not.toMatch(/encrypt/i);
    });

    test("leaves the description optional", () => {
      renderPage(pageCase.page);

      expect(formField("description").required).toBe(false);
      expect(formField("description").fieldType).toBe("LongText");
    });

    test("validates the name", () => {
      renderPage(pageCase.page);

      const name: FormFieldEntry = formField("name");

      expect(name.required).toBe(true);
      expect(name.fieldType).toBe("Text");
      expect(name.validation).toEqual({
        minLength: 2,
        noSpaces: true,
        noSpecialCharacters: true,
      });
    });

    /*
     * Nothing links a workflow to the variable row it names, so renaming a
     * variable silently breaks every workflow using the old name. The form is
     * the one place that can say so, in the page's own reference syntax.
     */
    test("shows the page's reference syntax, and warns that renaming breaks it", () => {
      renderPage(pageCase.page);

      const description: string = formField("name").description || "";

      expect(description).toContain(pageCase.reference);
      expect(description).not.toContain(pageCase.otherReference);
      expect(description).toContain(
        "Renaming it does not update workflows that already refer to the old name",
      );
    });

    test("stamps Static on what it creates", async () => {
      renderPage(pageCase.page);

      const created: WorkflowVariable = (await table().onBeforeCreate!(
        new WorkflowVariable(),
      )) as WorkflowVariable;

      expect(created.variableType).toBe(WorkflowVariableType.Static);
    });

    // The form cannot make anything else, whatever arrives in its values.
    test("stamps Static even over a type the values claim to be OAuth 2.0", async () => {
      renderPage(pageCase.page);

      const item: WorkflowVariable = new WorkflowVariable();
      item.variableType = WorkflowVariableType.OAuth2;

      const created: WorkflowVariable = (await table().onBeforeCreate!(
        item,
      )) as WorkflowVariable;

      expect(created.variableType).toBe(WorkflowVariableType.Static);
    });

    test(
      pageCase.page === "global"
        ? "leaves the workflow unset, so the variable is global"
        : "stamps the workflow, so the variable is local to it",
      async () => {
        renderPage(pageCase.page);

        const created: WorkflowVariable = (await table().onBeforeCreate!(
          new WorkflowVariable(),
        )) as WorkflowVariable;

        if (pageCase.workflowId) {
          expect(created.workflowId?.toString()).toBe(
            pageCase.workflowId.toString(),
          );
        } else {
          expect(created.workflowId).toBeUndefined();
        }
      },
    );
  });

  describe("what the list reads", () => {
    test("is scoped to the page's variables in the current project", () => {
      renderPage(pageCase.page);

      if (pageCase.workflowId) {
        expect(table().query?.["workflowId"]).toBe(pageCase.workflowId);
      } else {
        expect(table().query?.["workflowId"]).toBeInstanceOf(IsNull);
      }

      expect(table().query?.["projectId"]).toBe(PROJECT_ID);
    });

    // The Type column needs the type and grant type; nothing else rides along.
    test("selects the type and the grant type, and nothing more", () => {
      renderPage(pageCase.page);

      expect(table().selectMoreFields).toEqual({
        variableType: true,
        oauthGrantType: true,
      });
    });

    test("never selects content, a credential or a token", () => {
      renderPage(pageCase.page);

      const select: Array<string> = Object.keys(table().selectMoreFields || {});

      for (const name of NEVER_SELECTED_FIELDS) {
        expect(select).not.toContain(name);

        for (const entry of table().columns || []) {
          expect(fieldName(entry)).not.toBe(name);
        }

        for (const filter of table().filters || []) {
          expect(fieldName(filter)).not.toBe(name);
        }

        expect(table().searchableFields || []).not.toContain(name);
      }
    });

    /*
     * The two lists keep their own saved filters and column preferences, so
     * the ids must differ.
     */
    test("keeps its table and filter ids apart from the other page's", () => {
      renderPage(pageCase.page);

      if (pageCase.workflowId) {
        expect(table().id).toBe("workflow-variables-table");
        expect(table().saveFilterProps?.tableId).toBe(
          "workflow-view-variables-table",
        );
      } else {
        expect(table().id).toBe("global-workflow-variables-table");
        expect(table().saveFilterProps?.tableId).toBe(
          "workflow-variables-table",
        );
      }
    });
  });

  describe("the More menu", () => {
    test("holds exactly one entry: Create OAuth 2.0 Variable", () => {
      renderPage(pageCase.page);

      expect(
        moreMenuButtons().map((entry: CardButtonEntry) => {
          return entry.title;
        }),
      ).toEqual([OAUTH_MENU_TITLE]);
    });

    /*
     * BaseModelTable puts one button beside the search - the NORMAL button
     * with the Add icon, or failing that the first NORMAL or PRIMARY one - and
     * everything else in the More (⋯) menu. An OUTLINE button with its own
     * icon can never be picked, so this entry stays in the menu even for
     * somebody the Create button is hidden from.
     */
    test("is an outline button, so the table never promotes it beside the search", () => {
      renderPage(pageCase.page);

      const button: CardButtonEntry = oauthMenuButton();

      expect(button.buttonStyle).toBe(ButtonStyleType.OUTLINE);
      expect(button.buttonStyle).not.toBe(ButtonStyleType.NORMAL);
      expect(button.buttonStyle).not.toBe(ButtonStyleType.PRIMARY);
      expect(button.icon).toBe(IconProp.Key);
      expect(button.icon).not.toBe(IconProp.Add);
    });

    test("the card tells people where to find it", () => {
      renderPage(pageCase.page);

      expect(table().cardProps?.description).toContain("More menu");
      expect(table().cardProps?.description).toContain("OAuth 2.0");
    });

    test("is enabled for a project admin, and says what an OAuth variable is", () => {
      permissionsForTest = [Permission.ProjectAdmin];

      renderPage(pageCase.page);

      expect(oauthMenuButton().disabled).toBe(false);
      expect(oauthMenuButton().tooltip).toContain("access token");
    });

    // The gate follows the model's create list, not just the admin roles.
    test("is enabled for somebody who may only create workflow variables", () => {
      permissionsForTest = [Permission.CreateWorkflowVariable];

      renderPage(pageCase.page);

      expect(oauthMenuButton().disabled).toBe(false);
    });

    test("is enabled for a master admin, even before the permission snapshot arrives", () => {
      permissionsForTest = [];
      isMasterAdminForTest = true;

      renderPage(pageCase.page);

      expect(oauthMenuButton().disabled).toBe(false);
    });

    /*
     * Locked, with the reason, rather than a form that 403s after somebody
     * has pasted a client secret into it.
     */
    test("is locked for a viewer, with a tooltip naming the missing permission", () => {
      permissionsForTest = [Permission.Viewer];

      renderPage(pageCase.page);

      const button: CardButtonEntry = oauthMenuButton();

      expect(button.disabled).toBe(true);
      expect(button.tooltip).toContain(
        "You do not have permission to create this Workflow Variable",
      );
      expect(button.tooltip).toContain("Create Workflow Variables");
    });

    test("does nothing when pressed while locked", () => {
      permissionsForTest = [Permission.Viewer];

      renderPage(pageCase.page);

      act(() => {
        oauthMenuButton().onClick();
      });

      expect(isOAuthFormOpen()).toBe(false);
      expect(capturedOAuthModalProps).toBeNull();
    });

    /*
     * An empty snapshot is "not loaded yet", not "not allowed": a disabled
     * button there would blame somebody who may well hold the permission.
     */
    test("is hidden, not locked, while the permission snapshot is still empty", () => {
      permissionsForTest = [];

      renderPage(pageCase.page);

      expect(moreMenuButtons()).toEqual([]);
    });

    /*
     * The snapshot rides in on an API response header. Without a re-render
     * after the first fetch, the entry would stay hidden for the life of the
     * page after a fresh sign-in.
     */
    test("appears once the list's first fetch brings the permission snapshot in", () => {
      permissionsForTest = [];

      renderPage(pageCase.page);

      expect(moreMenuButtons()).toEqual([]);

      permissionsForTest = [Permission.ProjectAdmin];

      act(() => {
        table().onFetchSuccess!([], 0);
      });

      expect(oauthMenuButton().disabled).toBe(false);
    });

    test("opens the OAuth 2.0 create form for this page's variables", () => {
      renderPage(pageCase.page);

      expect(isOAuthFormOpen()).toBe(false);

      openOAuthForm();

      expect(isOAuthFormOpen()).toBe(true);

      if (pageCase.workflowId) {
        expect(oauthForm().workflowId).toBe(pageCase.workflowId);
      } else {
        expect(oauthForm().workflowId).toBeUndefined();
      }
    });

    test("closing the form without creating hides it and fetches no token", () => {
      renderPage(pageCase.page);

      openOAuthForm();

      act(() => {
        oauthForm().onClose();
      });

      expect(isOAuthFormOpen()).toBe(false);
      expect(isRefreshModalOpen()).toBe(false);
      expect(apiPost).not.toHaveBeenCalled();
    });

    test("can be opened again after it was closed", () => {
      renderPage(pageCase.page);

      openOAuthForm();

      act(() => {
        oauthForm().onClose();
      });

      openOAuthForm();

      expect(isOAuthFormOpen()).toBe(true);
    });
  });

  describe("after an OAuth 2.0 variable is created", () => {
    /*
     * A token request can take up to 20 seconds. The modal opens as soon as
     * it goes out, so something on screen says it is happening.
     */
    test("closes the form and shows a pending token modal while the provider is asked", async () => {
      const response: Deferred<unknown> = createDeferred<unknown>();
      apiPost.mockReturnValue(response.promise);

      renderPage(pageCase.page);
      openOAuthForm();

      act(() => {
        oauthForm().onSuccess(oauthVariable());
      });

      expect(isOAuthFormOpen()).toBe(false);
      expect(refreshModal().outcome).toBeNull();
      expect(refreshModal().variableName).toBe("API_TOKEN");
      expect(apiPost).toHaveBeenCalledTimes(1);

      await act(async () => {
        response.resolve({
          data: { oauthAccessTokenExpiresAt: EXPIRES_AT_ISO },
        });
        await response.promise;
      });

      await waitFor(() => {
        expect(refreshModal().outcome).not.toBeNull();
      });
    });

    test("asks for the new variable's first token through the refresh route, with the tenant header", async () => {
      renderPage(pageCase.page);

      await createOAuthVariable(oauthVariable());

      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(refreshCall().url).toContain(
        `/workflow-variable/${VARIABLE_ID.toString()}/refresh-oauth-token`,
      );
      expect(refreshCall().headers).toEqual({ tenantid: "project-header" });
      expect(refreshCall().data).toEqual({});
    });

    test("shows when the new token expires once the provider answers", async () => {
      renderPage(pageCase.page);

      await createOAuthVariable(oauthVariable());

      const outcome: TokenRefreshOutcome = refreshModal().outcome!;

      expect(outcome.variableName).toBe("API_TOKEN");
      expect(outcome.error).toBeUndefined();
      expect(outcome.savedWhat).toBeUndefined();
      expect(outcome.expiresAt).toEqual(new Date(EXPIRES_AT_ISO));

      // Pending first, then the answer - never the answer out of nowhere.
      expect(refreshModalOutcomes[0]).toBeNull();
      expect(refreshModalOutcomes[refreshModalOutcomes.length - 1]).toBe(
        outcome,
      );
    });

    test("says so when the provider does not say when the token expires", async () => {
      apiPost.mockResolvedValue({ data: {} });

      renderPage(pageCase.page);

      await createOAuthVariable(oauthVariable());

      expect(refreshModal().outcome!.error).toBeUndefined();
      expect(refreshModal().outcome!.expiresAt).toBeNull();
    });

    /*
     * A mistyped secret or token URL shows up while the person who typed it
     * is still looking, in the provider's own words.
     */
    test("shows the provider's refusal", async () => {
      apiPost.mockResolvedValue(
        new HTTPErrorResponse(
          400,
          {
            message:
              "invalid_client: AADSTS7000215: Invalid client secret provided.",
          },
          {},
        ),
      );

      renderPage(pageCase.page);

      await createOAuthVariable(oauthVariable());

      const outcome: TokenRefreshOutcome = refreshModal().outcome!;

      expect(outcome.variableName).toBe("API_TOKEN");
      expect(outcome.error).toBe(
        "invalid_client: AADSTS7000215: Invalid client secret provided.",
      );
      expect(outcome.expiresAt).toBeUndefined();
    });

    test("shows a request that never reached the provider", async () => {
      apiPost.mockRejectedValue(new Error("Network Error"));

      renderPage(pageCase.page);

      await createOAuthVariable(oauthVariable());

      expect(refreshModal().outcome!.error).toBe("Network Error");
    });

    test("does not call the refresh route for a variable that came back without an id", async () => {
      renderPage(pageCase.page);

      const variable: WorkflowVariable = oauthVariable({ _id: undefined });

      await createOAuthVariable(variable);

      expect(apiPost).not.toHaveBeenCalled();
      expect(refreshModal().outcome!.error).toContain(
        "This variable has no id",
      );
    });

    test("calls a variable without a name 'this variable'", async () => {
      renderPage(pageCase.page);

      const variable: WorkflowVariable = oauthVariable({ name: undefined });

      await createOAuthVariable(variable);

      expect(refreshModal().variableName).toBe("this variable");
      expect(refreshModal().outcome!.variableName).toBe("this variable");
    });

    /*
     * Once when the row is added, so it shows at once, and again once the
     * refresh has written the expiry or the failure to it.
     */
    test("refreshes the list when the variable is created, and again once the outcome is in", async () => {
      const response: Deferred<unknown> = createDeferred<unknown>();
      apiPost.mockReturnValue(response.promise);

      renderPage(pageCase.page);

      const initialToggle: string | undefined = table().refreshToggle;
      expect(initialToggle).toBeTruthy();

      openOAuthForm();

      act(() => {
        oauthForm().onSuccess(oauthVariable());
      });

      const afterCreateToggle: string | undefined = table().refreshToggle;
      expect(afterCreateToggle).not.toBe(initialToggle);

      await act(async () => {
        response.resolve({
          data: { oauthAccessTokenExpiresAt: EXPIRES_AT_ISO },
        });
        await response.promise;
      });

      await waitFor(() => {
        expect(table().refreshToggle).not.toBe(afterCreateToggle);
      });

      expect(table().refreshToggle).not.toBe(initialToggle);
    });

    test("closing the outcome modal removes it", async () => {
      renderPage(pageCase.page);

      await createOAuthVariable(oauthVariable());

      expect(isRefreshModalOpen()).toBe(true);

      act(() => {
        refreshModal().onClose();
      });

      expect(isRefreshModalOpen()).toBe(false);
      expect(isOAuthFormOpen()).toBe(false);
    });

    test("closing the outcome modal after a failure removes it too", async () => {
      apiPost.mockRejectedValue(new Error("Network Error"));

      renderPage(pageCase.page);

      await createOAuthVariable(oauthVariable());

      act(() => {
        refreshModal().onClose();
      });

      expect(isRefreshModalOpen()).toBe(false);
    });

    // Only the OAuth form's success fetches a token; the Create form never does.
    test("a static variable created from the Create form fetches no token", async () => {
      renderPage(pageCase.page);

      await act(async () => {
        await table().onBeforeCreate!(new WorkflowVariable());
      });

      expect(apiPost).not.toHaveBeenCalled();
      expect(isRefreshModalOpen()).toBe(false);
    });
  });

  /*
   * Creating a variable and refreshing its token are different permissions.
   * Somebody who may create but not update would only get OneUptime's own
   * refusal back from the refresh route - shown as if their provider had said
   * no - so the page does not ask for them.
   */
  describe("whose new OAuth 2.0 variable gets its first token fetched", () => {
    test.each(CREATE_ONLY_ROLES)(
      "not somebody who may only create variables ($label): the form closes and the list refreshes, with no token request and no token modal",
      async (role: RoleCase) => {
        permissionsForTest = role.permissions;

        renderPage(pageCase.page);

        const initialToggle: string | undefined = table().refreshToggle;

        // They may create, so the menu entry does open the form.
        expect(oauthMenuButton().disabled).toBe(false);

        openOAuthForm();

        expect(isOAuthFormOpen()).toBe(true);

        await saveOAuthVariable(oauthVariable());

        expect(isOAuthFormOpen()).toBe(false);

        // The new row still shows up at once.
        expect(table().refreshToggle).not.toBe(initialToggle);

        expect(apiPost).not.toHaveBeenCalled();
        expect(isRefreshModalOpen()).toBe(false);
        expect(capturedRefreshModalProps).toBeNull();
        expect(refreshModalOutcomes).toEqual([]);
      },
    );

    // With no token request there is nothing to wait for, so no second bump.
    test("refreshes the list once, and only once, for somebody who may only create", async () => {
      permissionsForTest = [
        Permission.CreateWorkflowVariable,
        Permission.ReadWorkflowVariable,
      ];

      renderPage(pageCase.page);

      const initialToggle: string | undefined = table().refreshToggle;

      openOAuthForm();

      await saveOAuthVariable(oauthVariable());

      const afterCreateToggle: string | undefined = table().refreshToggle;

      expect(afterCreateToggle).not.toBe(initialToggle);

      await act(async () => {
        await Promise.resolve();
      });

      expect(table().refreshToggle).toBe(afterCreateToggle);
    });

    test("can open the form again afterwards, still without a token modal in the way", async () => {
      permissionsForTest = [
        Permission.CreateWorkflowVariable,
        Permission.ReadWorkflowVariable,
      ];

      renderPage(pageCase.page);

      openOAuthForm();

      await saveOAuthVariable(oauthVariable());

      openOAuthForm();

      expect(isOAuthFormOpen()).toBe(true);
      expect(isRefreshModalOpen()).toBe(false);
    });

    test.each(CREATE_AND_UPDATE_ROLES)(
      "somebody who may also update variables ($label): asks for the token and shows the outcome",
      async (role: RoleCase) => {
        permissionsForTest = role.permissions;

        renderPage(pageCase.page);

        await createOAuthVariable(oauthVariable());

        expect(isOAuthFormOpen()).toBe(false);
        expect(apiPost).toHaveBeenCalledTimes(1);
        expect(refreshCall().url).toContain(
          `/workflow-variable/${VARIABLE_ID.toString()}/refresh-oauth-token`,
        );

        expect(refreshModal().variableName).toBe("API_TOKEN");
        expect(refreshModal().outcome!.error).toBeUndefined();
        expect(refreshModal().outcome!.expiresAt).toEqual(
          new Date(EXPIRES_AT_ISO),
        );
        expect(refreshModalOutcomes[0]).toBeNull();
      },
    );

    /*
     * PermissionGate lets a master admin do everything before it even looks
     * at the snapshot, so an empty one does not stop the fetch.
     */
    test("a master admin, even before the permission snapshot arrives", async () => {
      permissionsForTest = [];
      isMasterAdminForTest = true;

      renderPage(pageCase.page);

      await createOAuthVariable(oauthVariable());

      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(refreshCall().url).toContain(
        `/workflow-variable/${VARIABLE_ID.toString()}/refresh-oauth-token`,
      );
      expect(refreshModal().outcome!.expiresAt).toEqual(
        new Date(EXPIRES_AT_ISO),
      );
    });

    test("a master admin whose project role may only create", async () => {
      permissionsForTest = [Permission.CreateWorkflowVariable];
      isMasterAdminForTest = true;

      renderPage(pageCase.page);

      await createOAuthVariable(oauthVariable());

      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(isRefreshModalOpen()).toBe(true);
    });

    // The gate is read when the variable is saved, not when the form opened.
    test("not somebody whose role lost update while the form was open", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      renderPage(pageCase.page);

      openOAuthForm();

      permissionsForTest = [
        Permission.CreateWorkflowVariable,
        Permission.ReadWorkflowVariable,
      ];

      await saveOAuthVariable(oauthVariable());

      expect(isOAuthFormOpen()).toBe(false);
      expect(apiPost).not.toHaveBeenCalled();
      expect(isRefreshModalOpen()).toBe(false);
    });

    test("somebody whose role gained update while the form was open", async () => {
      permissionsForTest = [
        Permission.CreateWorkflowVariable,
        Permission.ReadWorkflowVariable,
      ];

      renderPage(pageCase.page);

      openOAuthForm();

      permissionsForTest = [
        Permission.CreateWorkflowVariable,
        Permission.EditWorkflowVariable,
      ];

      await saveOAuthVariable(oauthVariable());

      await waitFor(() => {
        expect(refreshModal().outcome).toBeTruthy();
      });

      expect(apiPost).toHaveBeenCalledTimes(1);
    });

    /*
     * An empty snapshot (not a master admin) is PermissionGate's "not loaded
     * yet": it does not allow, so the page does not ask. The variable still
     * gets its first token the first time a workflow uses it.
     */
    test("not while the permission snapshot is empty at the moment of saving", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      renderPage(pageCase.page);

      openOAuthForm();

      permissionsForTest = [];

      await saveOAuthVariable(oauthVariable());

      expect(isOAuthFormOpen()).toBe(false);
      expect(apiPost).not.toHaveBeenCalled();
      expect(isRefreshModalOpen()).toBe(false);
    });
  });
});
