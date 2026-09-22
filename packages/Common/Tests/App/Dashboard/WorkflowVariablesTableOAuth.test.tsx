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
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The dashboard side of OAuth 2.0 workflow variables.
 *
 * The table gains a type picker, the OAuth settings, a Token column with a
 * "Refresh now" button (fetch a new token now, and show what the identity
 * provider said), and an "Update Credentials" row action (replace the
 * write-only client secret / refresh token, then fetch a token with them).
 * Static variables keep exactly what they had.
 *
 * ModelTable, BasicFormModal and ConfirmModal are replaced by prop recorders:
 * what is under test is the configuration the page hands them and what the
 * page does when their callbacks fire. The real table fetches on mount.
 */

let permissionsForTest: Array<unknown> = [];

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
        return false;
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

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        return WORKFLOW_ID;
      },
    },
  };
});

const updateById: ReturnType<
  typeof jest.fn<(data: unknown) => Promise<unknown>>
> = jest.fn<(data: unknown) => Promise<unknown>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
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

type FormFieldEntry = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  stepId?: string | undefined;
  fieldType?: string | undefined;
  doNotShowWhenEditing?: boolean | undefined;
  required?:
    | boolean
    | ((values: Record<string, unknown>) => boolean)
    | undefined;
  defaultValue?: unknown;
  description?: string | undefined;
  cardSelectOptions?: Array<{ value: string; title: string }> | undefined;
  showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
  customValidation?:
    | ((values: Record<string, unknown>) => string | null)
    | undefined;
};

type ActionButtonEntry = {
  title: string;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  isVisible?: ((item: unknown) => boolean | undefined) | undefined;
  onClick: (
    item: unknown,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void | Promise<void>;
};

type ColumnEntry = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  getElement?: ((item: unknown) => ReactElement) | undefined;
};

type CapturedTableProps = {
  formFields?: Array<FormFieldEntry> | undefined;
  formSteps?:
    | Array<{
        id: string;
        title: string;
        showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
      }>
    | undefined;
  actionButtons?: Array<ActionButtonEntry> | undefined;
  columns?: Array<ColumnEntry> | undefined;
  filters?: Array<{ field?: Record<string, unknown> | undefined }> | undefined;
  selectMoreFields?: Record<string, unknown> | undefined;
  refreshToggle?: string | undefined;
  onBeforeEdit?: ((item: unknown) => Promise<unknown>) | undefined;
  onCreateSuccess?:
    | ((item: unknown, modalType?: unknown) => Promise<unknown>)
    | undefined;
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

type CapturedModalProps = {
  title: string;
  error?: string | undefined;
  isLoading?: boolean | undefined;
  description?: string | undefined;
  submitButtonText?: string | undefined;
  onClose?: (() => void) | undefined;
  onSubmit?: ((data: Record<string, unknown>) => Promise<void>) | undefined;
  formProps: {
    fields: Array<FormFieldEntry>;
  };
};

let capturedModalProps: CapturedModalProps | null = null;

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps): ReactElement => {
      capturedModalProps = props;
      return <div data-testid="form-modal" />;
    },
  };
});

type CapturedConfirmProps = {
  title: string;
  description: string;
  onSubmit: () => void;
};

let capturedConfirmProps: CapturedConfirmProps | null = null;

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedConfirmProps): ReactElement => {
      capturedConfirmProps = props;
      return <div data-testid="confirm-modal" />;
    },
  };
});

import GlobalVariablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Variable";
import WorkflowVariableTokenStatus from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableTokenStatus";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  OAuth2GrantType,
  OAuth2TokenStatus,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
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

const OAUTH_ONLY_FIELDS: Array<string> = [
  "oauthGrantType",
  "oauthTokenUrl",
  "oauthClientId",
  "oauthClientSecret",
  "oauthScope",
  "oauthAdditionalParameters",
  "oauthClientAuthenticationMethod",
];

function renderPage(): void {
  render(
    <GlobalVariablesPage
      {...({} as unknown as React.ComponentProps<typeof GlobalVariablesPage>)}
    />,
  );
}

function table(): CapturedTableProps {
  if (!capturedTableProps) {
    throw new Error("The page rendered no ModelTable");
  }

  return capturedTableProps;
}

function formField(name: string): FormFieldEntry {
  const entry: FormFieldEntry | undefined = (table().formFields || []).find(
    (field: FormFieldEntry) => {
      return Object.keys(field.field || {})[0] === name;
    },
  );

  if (!entry) {
    throw new Error(`No form field for the "${name}" column`);
  }

  return entry;
}

function actionButton(title: string): ActionButtonEntry {
  const button: ActionButtonEntry | undefined = (
    table().actionButtons || []
  ).find((entry: ActionButtonEntry) => {
    return entry.title === title;
  });

  if (!button) {
    throw new Error(`The table offers no ${title} action`);
  }

  return button;
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

function oauthVariable(
  overrides?: Partial<Record<string, unknown>>,
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

function staticVariable(): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable._id = VARIABLE_ID.toString();
  variable.name = "PLAIN";
  variable.variableType = WorkflowVariableType.Static;
  return variable;
}

function modal(): CapturedModalProps {
  if (!capturedModalProps) {
    throw new Error("No form modal is open");
  }

  return capturedModalProps;
}

function confirm(): CapturedConfirmProps {
  if (!capturedConfirmProps) {
    throw new Error("No confirm modal is open");
  }

  return capturedConfirmProps;
}

async function click(title: string, item: unknown): Promise<void> {
  await act(async () => {
    await actionButton(title).onClick(
      item,
      (): void => {
        // onCompleteAction
      },
      (): void => {
        // onError
      },
    );
  });
}

/*
 * Renders the Token cell the table would render for this row and presses its
 * "Refresh now" button, then waits for the outcome modal.
 */
async function clickRefresh(item: WorkflowVariable): Promise<void> {
  const cell: ReturnType<typeof render> = render(
    column("Token").getElement!(item),
  );

  await act(async () => {
    fireEvent.click(
      within(cell.container).getByTestId("workflow-variable-refresh-token"),
    );
  });

  await waitFor(() => {
    expect(capturedConfirmProps).not.toBeNull();
  });
}

function refreshButtonIn(item: WorkflowVariable): HTMLElement | null {
  const cell: ReturnType<typeof render> = render(
    column("Token").getElement!(item),
  );

  return within(cell.container).queryByTestId(
    "workflow-variable-refresh-token",
  );
}

function refreshCallUrl(callIndex: number = 0): string {
  return String((apiPost.mock.calls[callIndex]![0] as { url: unknown }).url);
}

beforeEach(() => {
  capturedTableProps = null;
  capturedModalProps = null;
  capturedConfirmProps = null;
  updateById.mockReset();
  updateById.mockResolvedValue(undefined);
  apiPost.mockReset();
  apiPost.mockResolvedValue({
    data: { oauthAccessTokenExpiresAt: "2030-01-01T10:00:00.000Z" },
  });
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
});

describe("the create form", () => {
  test("asks for the variable type, Static by default", () => {
    renderPage();

    const field: FormFieldEntry = formField("variableType");

    expect(field.fieldType).toBe("CardSelect");
    expect(field.defaultValue).toBe(WorkflowVariableType.Static);
    expect(field.required).toBe(true);
    expect(
      (field.cardSelectOptions || []).map((option: { value: string }) => {
        return option.value;
      }),
    ).toEqual([WorkflowVariableType.Static, WorkflowVariableType.OAuth2]);
  });

  /*
   * The type is fixed once saved (update: [] on the column), and ModelForm
   * would drop a field the user may not update anyway - so the picker is
   * create-only, and its description says how to change it.
   */
  test("does not offer the type on the edit form, and says how to change it", () => {
    renderPage();

    expect(formField("variableType").doNotShowWhenEditing).toBe(true);
    expect(formField("variableType").description).toContain(
      "delete it and create it again under the same name",
    );
  });

  test("shows the OAuth settings only for an OAuth 2.0 variable", () => {
    renderPage();

    for (const name of OAUTH_ONLY_FIELDS) {
      const field: FormFieldEntry = formField(name);

      expect(
        field.showIf?.({ variableType: WorkflowVariableType.OAuth2 }),
      ).toBe(true);
      expect(
        field.showIf?.({ variableType: WorkflowVariableType.Static }),
      ).toBe(false);
    }
  });

  test("shows content and the secret toggle only for a Static variable", () => {
    renderPage();

    for (const name of ["content", "isSecret"]) {
      expect(
        formField(name).showIf?.({ variableType: WorkflowVariableType.Static }),
      ).toBe(true);
      expect(
        formField(name).showIf?.({ variableType: WorkflowVariableType.OAuth2 }),
      ).toBe(false);
    }
  });

  test("asks for a refresh token only for the Refresh Token grant", () => {
    renderPage();

    const field: FormFieldEntry = formField("oauthRefreshToken");

    expect(
      field.showIf?.({
        variableType: WorkflowVariableType.OAuth2,
        oauthGrantType: OAuth2GrantType.RefreshToken,
      }),
    ).toBe(true);
    expect(
      field.showIf?.({
        variableType: WorkflowVariableType.OAuth2,
        oauthGrantType: OAuth2GrantType.ClientCredentials,
      }),
    ).toBe(false);
  });

  // A public client has no secret; client credentials cannot work without one.
  test("requires a client secret for client credentials but not for a refresh token", () => {
    renderPage();

    const required: FormFieldEntry["required"] =
      formField("oauthClientSecret").required;

    expect(typeof required).toBe("function");
    expect(
      (required as (values: Record<string, unknown>) => boolean)({
        oauthGrantType: OAuth2GrantType.ClientCredentials,
      }),
    ).toBe(true);
    expect(
      (required as (values: Record<string, unknown>) => boolean)({
        oauthGrantType: OAuth2GrantType.RefreshToken,
      }),
    ).toBe(false);
  });

  test("puts the value and the OAuth settings on steps of their own", () => {
    renderPage();

    const steps: CapturedTableProps["formSteps"] = table().formSteps || [];
    const valueStep: {
      showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
    } = steps.find((step: { id: string }) => {
      return step.id === "value";
    })!;
    const oauthStep: {
      showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
    } = steps.find((step: { id: string }) => {
      return step.id === "oauth";
    })!;

    expect(
      valueStep.showIf?.({ variableType: WorkflowVariableType.Static }),
    ).toBe(true);
    expect(
      valueStep.showIf?.({ variableType: WorkflowVariableType.OAuth2 }),
    ).toBe(false);
    expect(
      oauthStep.showIf?.({ variableType: WorkflowVariableType.OAuth2 }),
    ).toBe(true);
    expect(
      oauthStep.showIf?.({ variableType: WorkflowVariableType.Static }),
    ).toBe(false);

    for (const name of OAUTH_ONLY_FIELDS.concat(["oauthRefreshToken"])) {
      expect(formField(name).stepId).toBe("oauth");
    }
  });

  test("refuses a reserved additional parameter before submitting", () => {
    renderPage();

    const validate: FormFieldEntry["customValidation"] = formField(
      "oauthAdditionalParameters",
    ).customValidation;

    expect(
      validate?.({ oauthAdditionalParameters: { client_secret: "x" } }),
    ).toContain("cannot be set as an additional parameter");
    expect(
      validate?.({ oauthAdditionalParameters: { audience: "x" } }),
    ).toBeNull();
  });
});

describe("the edit form", () => {
  /*
   * The client secret and refresh token are write-only, like content: an edit
   * form that carried them would ask the API to select columns nobody may
   * read, and the whole GET would fail. They have their own door.
   */
  test("keeps the write-only credentials off it", () => {
    renderPage();

    for (const name of ["oauthClientSecret", "oauthRefreshToken", "content"]) {
      expect(formField(name).doNotShowWhenEditing).toBe(true);
    }

    // The grant type is fixed at creation.
    expect(formField("oauthGrantType").doNotShowWhenEditing).toBe(true);
  });

  test("keeps the readable OAuth settings on it", () => {
    renderPage();

    for (const name of [
      "oauthTokenUrl",
      "oauthClientId",
      "oauthScope",
      "oauthAdditionalParameters",
      "oauthClientAuthenticationMethod",
    ]) {
      expect(formField(name).doNotShowWhenEditing).toBeFalsy();
    }
  });

  /*
   * The edit form cannot carry variableType, yet it must know which fields to
   * show. It learns the type from the row the edit was opened on.
   */
  test("shows the OAuth settings when the row being edited is an OAuth variable", async () => {
    renderPage();

    await act(async () => {
      await table().onBeforeEdit?.(oauthVariable());
    });

    expect(formField("oauthTokenUrl").showIf?.({})).toBe(true);
    expect(formField("isSecret").showIf?.({})).toBe(false);
  });

  test("shows the Static fields when the row being edited is a Static variable", async () => {
    renderPage();

    await act(async () => {
      await table().onBeforeEdit?.(oauthVariable());
    });

    await act(async () => {
      await table().onBeforeEdit?.(staticVariable());
    });

    expect(formField("oauthTokenUrl").showIf?.({})).toBe(false);
    expect(formField("isSecret").showIf?.({})).toBe(true);
  });
});

describe("what the table reads", () => {
  test("selects the token bookkeeping, and never a token or a credential", () => {
    renderPage();

    const select: Array<string> = Object.keys(table().selectMoreFields || {});

    expect(select).toEqual(
      expect.arrayContaining([
        "variableType",
        "oauthGrantType",
        "oauthAccessTokenExpiresAt",
        "oauthLastRefreshedAt",
        "oauthLastRefreshError",
        "oauthLastRefreshErrorAt",
      ]),
    );

    const forbidden: Array<string> = [
      "content",
      "oauthAccessToken",
      "oauthClientSecret",
      "oauthRefreshToken",
    ];

    for (const name of forbidden) {
      expect(select).not.toContain(name);

      for (const entry of table().columns || []) {
        expect(Object.keys(entry.field || {})).not.toContain(name);
      }

      for (const filter of table().filters || []) {
        expect(Object.keys(filter.field || {})).not.toContain(name);
      }
    }
  });

  test("the Token column is empty for a Static variable", () => {
    renderPage();

    render(column("Token").getElement!(staticVariable()));

    expect(
      screen.queryByTestId("workflow-variable-token-status"),
    ).not.toBeInTheDocument();
  });

  test("the Token column shows an OAuth variable's token status", () => {
    renderPage();

    render(
      column("Token").getElement!(
        oauthVariable({
          oauthLastRefreshedAt: new Date(Date.now() - 60_000),
          oauthAccessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        }),
      ),
    );

    expect(
      screen.getByTestId("workflow-variable-token-status"),
    ).toHaveAttribute("data-status", OAuth2TokenStatus.Valid);
  });

  test("the Type column names the grant of an OAuth variable", () => {
    renderPage();

    render(column("Type").getElement!(oauthVariable()));

    expect(screen.getByText("OAuth 2.0")).toBeInTheDocument();
    expect(screen.getByText("Client Credentials")).toBeInTheDocument();
  });
});

describe("the row actions", () => {
  test("an OAuth variable gets Update Credentials, not Update Content", () => {
    renderPage();

    const item: WorkflowVariable = oauthVariable();

    expect(actionButton("Update Credentials").isVisible?.(item)).toBe(true);
    expect(actionButton("Update Content").isVisible?.(item)).toBe(false);
  });

  test("a Static variable keeps Update Content and does not get Update Credentials", () => {
    renderPage();

    const item: WorkflowVariable = staticVariable();

    expect(actionButton("Update Content").isVisible?.(item)).toBe(true);
    expect(actionButton("Update Credentials").isVisible?.(item)).toBe(false);
  });

  /*
   * A fifth row action pushed the actions column off screen on an ordinary
   * laptop; the refresh acts on what the Token cell shows, so it lives there.
   */
  test("keeps the refresh out of the row actions and in the Token cell", () => {
    renderPage();

    expect(
      (table().actionButtons || []).map((entry: ActionButtonEntry) => {
        return entry.title;
      }),
    ).toEqual(["Update Content", "Update Credentials"]);
    expect(refreshButtonIn(oauthVariable())).toBeInTheDocument();
  });

  /*
   * Both write to the variable through requests ModelTable's own gating never
   * sees, so they carry the same gate as Update Content.
   */
  test("are locked, with the reason, for a viewer", () => {
    permissionsForTest = [Permission.Viewer];

    renderPage();

    expect(actionButton("Update Credentials").disabled).toBe(true);
    expect(actionButton("Update Credentials").tooltip).toContain(
      "You do not have permission to update",
    );
    expect(
      actionButton("Update Credentials").isVisible?.(oauthVariable()),
    ).toBe(true);

    const refresh: HTMLElement | null = refreshButtonIn(oauthVariable());

    expect(refresh).toBeInTheDocument();
    expect(refresh).toBeDisabled();
  });

  test("are hidden while the permission snapshot is still empty", () => {
    permissionsForTest = [];

    renderPage();

    expect(
      actionButton("Update Credentials").isVisible?.(oauthVariable()),
    ).toBe(false);
    expect(refreshButtonIn(oauthVariable())).not.toBeInTheDocument();
  });
});

describe("Refresh now", () => {
  test("posts to the variable's refresh route with the project header", async () => {
    renderPage();

    await clickRefresh(oauthVariable());

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(refreshCallUrl()).toContain(
      `/workflow-variable/${VARIABLE_ID.toString()}/refresh-oauth-token`,
    );
    expect(
      (apiPost.mock.calls[0]![0] as { headers: Record<string, string> })
        .headers,
    ).toEqual({ tenantid: "project-header" });
  });

  test("says the token was fetched and when it expires", async () => {
    renderPage();

    await clickRefresh(oauthVariable());

    expect(confirm().title).toBe("Access Token Fetched");
    expect(confirm().description).toContain(
      'OneUptime fetched a new access token for "API_TOKEN"',
    );
    expect(confirm().description).toContain("It is valid until");
  });

  test("says so when the provider reported no expiry", async () => {
    apiPost.mockResolvedValue({ data: { oauthAccessTokenExpiresAt: null } });

    renderPage();

    await clickRefresh(oauthVariable());

    expect(confirm().description).toContain(
      "The provider did not say when it expires",
    );
  });

  test("shows the identity provider's refusal", async () => {
    apiPost.mockRejectedValue(
      new Error(
        "The token endpoint refused the request (HTTP 401): invalid_client.",
      ),
    );

    renderPage();

    await clickRefresh(oauthVariable());

    expect(confirm().title).toBe("Could Not Fetch an Access Token");
    expect(confirm().description).toContain(
      "The token endpoint refused the request (HTTP 401): invalid_client.",
    );
  });

  // The refresh wrote the expiry, or the failure, to the row.
  test("reloads the table afterwards", async () => {
    renderPage();

    const before: string | undefined = table().refreshToggle;

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });

    await clickRefresh(oauthVariable());

    expect(table().refreshToggle).not.toBe(before);
  });

  test("the result modal closes", async () => {
    renderPage();

    await clickRefresh(oauthVariable());

    act(() => {
      confirm().onSubmit();
    });

    expect(screen.queryByTestId("confirm-modal")).not.toBeInTheDocument();
  });
});

describe("Update Credentials", () => {
  test("asks only for a new client secret on a client credentials variable", async () => {
    renderPage();

    await click("Update Credentials", oauthVariable());

    expect(
      modal().formProps.fields.map((field: FormFieldEntry) => {
        return Object.keys(field.field || {})[0];
      }),
    ).toEqual(["oauthClientSecret"]);
    expect(modal().submitButtonText).toBe("Save and Refresh Token");
  });

  test("also asks for a new refresh token on a refresh token variable", async () => {
    renderPage();

    await click(
      "Update Credentials",
      oauthVariable({ oauthGrantType: OAuth2GrantType.RefreshToken }),
    );

    expect(
      modal().formProps.fields.map((field: FormFieldEntry) => {
        return Object.keys(field.field || {})[0];
      }),
    ).toEqual(["oauthClientSecret", "oauthRefreshToken"]);

    for (const field of modal().formProps.fields) {
      // Empty means "keep what is saved".
      expect(field.required).toBe(false);
    }
  });

  test("refuses to save nothing", async () => {
    renderPage();

    await click("Update Credentials", oauthVariable());

    await act(async () => {
      await modal().onSubmit?.({ oauthClientSecret: "   " });
    });

    expect(updateById).not.toHaveBeenCalled();
    expect(modal().error).toContain(
      "Enter a new client secret or refresh token",
    );
  });

  /*
   * Only what was typed is sent. An empty field must not reach the API as an
   * empty string - that would be a request to remove the credential.
   */
  test("writes only the credentials that were typed, then fetches a token with them", async () => {
    renderPage();

    await click(
      "Update Credentials",
      oauthVariable({ oauthGrantType: OAuth2GrantType.RefreshToken }),
    );

    await act(async () => {
      await modal().onSubmit?.({
        oauthClientSecret: "",
        oauthRefreshToken: " new-refresh-token ",
      });
    });

    expect(updateById).toHaveBeenCalledTimes(1);

    const call: { id: ObjectID; data: Record<string, unknown> } = updateById
      .mock.calls[0]![0] as { id: ObjectID; data: Record<string, unknown> };

    expect(call.id.toString()).toBe(VARIABLE_ID.toString());
    expect(call.data).toEqual({ oauthRefreshToken: "new-refresh-token" });

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(refreshCallUrl()).toContain("/refresh-oauth-token");
    expect(confirm().description).toContain("Refresh token saved.");
    expect(screen.queryByTestId("form-modal")).not.toBeInTheDocument();
  });

  test("names both when both were replaced", async () => {
    renderPage();

    await click(
      "Update Credentials",
      oauthVariable({ oauthGrantType: OAuth2GrantType.RefreshToken }),
    );

    await act(async () => {
      await modal().onSubmit?.({
        oauthClientSecret: "new-secret",
        oauthRefreshToken: "new-refresh-token",
      });
    });

    expect(confirm().description).toContain(
      "Client secret and refresh token saved.",
    );
  });

  test("stays open with the reason when the save fails, and does not refresh", async () => {
    updateById.mockRejectedValue(new Error("You do not have permission."));

    renderPage();

    await click("Update Credentials", oauthVariable());

    await act(async () => {
      await modal().onSubmit?.({ oauthClientSecret: "new-secret" });
    });

    expect(modal().error).toBe("You do not have permission.");
    expect(modal().isLoading).toBe(false);
    expect(apiPost).not.toHaveBeenCalled();
  });

  test("reports a saved secret the provider then refused", async () => {
    apiPost.mockRejectedValue(new Error("invalid_client"));

    renderPage();

    await click("Update Credentials", oauthVariable());

    await act(async () => {
      await modal().onSubmit?.({ oauthClientSecret: "wrong-secret" });
    });

    expect(confirm().title).toBe("Could Not Fetch an Access Token");
    expect(confirm().description).toContain("Client secret saved.");
    expect(confirm().description).toContain("invalid_client");
  });
});

describe("after a variable is created", () => {
  /*
   * A mistyped secret or token URL should show up while the person who typed
   * it is still looking, not as a failed workflow run hours later.
   */
  test("fetches the first token of a new OAuth variable straight away", async () => {
    renderPage();

    await act(async () => {
      await table().onCreateSuccess?.(oauthVariable(), ModalType.Create);
    });

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(confirm().title).toBe("Access Token Fetched");
  });

  test("does not fetch after an edit", async () => {
    renderPage();

    await act(async () => {
      await table().onCreateSuccess?.(oauthVariable(), ModalType.Edit);
    });

    expect(apiPost).not.toHaveBeenCalled();
  });

  test("does not fetch for a new Static variable", async () => {
    renderPage();

    await act(async () => {
      await table().onCreateSuccess?.(staticVariable(), ModalType.Create);
    });

    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe("WorkflowVariableTokenStatus", () => {
  const NOW: Date = new Date("2026-09-22T12:00:00.000Z");

  function statusOf(values: Record<string, unknown>): {
    status: string | null;
    detail: string;
  } {
    render(
      <WorkflowVariableTokenStatus
        variable={oauthVariable(values)}
        now={NOW}
      />,
    );

    const element: HTMLElement = screen.getByTestId(
      "workflow-variable-token-status",
    );
    const detail: HTMLElement | null = screen.queryByTestId(
      "workflow-variable-token-status-detail",
    );

    return {
      status: element.getAttribute("data-status"),
      detail: detail?.textContent || "",
    };
  }

  test("a token nobody has fetched yet", () => {
    const result: { status: string | null; detail: string } = statusOf({});

    expect(result.status).toBe(OAuth2TokenStatus.NotFetched);
    expect(result.detail).toBe("Fetched the first time a workflow uses it");
    expect(screen.getByText("Not fetched yet")).toBeInTheDocument();
  });

  test("a valid token says until when", () => {
    const result: { status: string | null; detail: string } = statusOf({
      oauthLastRefreshedAt: new Date("2026-09-22T11:30:00.000Z"),
      oauthAccessTokenExpiresAt: new Date("2026-09-22T12:30:00.000Z"),
    });

    expect(result.status).toBe(OAuth2TokenStatus.Valid);
    expect(result.detail).toMatch(/^Valid until /);
  });

  // The normal resting state of an idle variable - not a failure.
  test("an expired token says it refreshes on its own", () => {
    const result: { status: string | null; detail: string } = statusOf({
      oauthLastRefreshedAt: new Date("2026-09-22T10:00:00.000Z"),
      oauthAccessTokenExpiresAt: new Date("2026-09-22T11:00:00.000Z"),
    });

    expect(result.status).toBe(OAuth2TokenStatus.Expired);
    expect(result.detail).toBe(
      "Refreshes automatically the next time a workflow uses it",
    );
  });

  test("a token with no reported expiry explains the per-run fetch", () => {
    const result: { status: string | null; detail: string } = statusOf({
      oauthLastRefreshedAt: new Date("2026-09-22T11:59:00.000Z"),
    });

    expect(result.status).toBe(OAuth2TokenStatus.NoExpiry);
    expect(result.detail).toContain("every run fetches a new one");
  });

  test("a failed refresh shows the reason, shortened, with the full text on hover", () => {
    const reason: string = `The token endpoint refused the request (HTTP 400): invalid_grant - ${"x".repeat(
      300,
    )}`;

    const result: { status: string | null; detail: string } = statusOf({
      oauthLastRefreshError: reason,
      oauthLastRefreshErrorAt: new Date("2026-09-22T11:55:00.000Z"),
      oauthAccessTokenExpiresAt: new Date("2026-09-22T12:30:00.000Z"),
      oauthLastRefreshedAt: new Date("2026-09-22T11:30:00.000Z"),
    });

    expect(result.status).toBe(OAuth2TokenStatus.RefreshFailed);
    expect(result.detail).toContain(
      "The token endpoint refused the request (HTTP 400): invalid_grant",
    );
    expect(result.detail.endsWith("…")).toBe(true);
    expect(result.detail.length).toBeLessThan(reason.length);
  });
});
