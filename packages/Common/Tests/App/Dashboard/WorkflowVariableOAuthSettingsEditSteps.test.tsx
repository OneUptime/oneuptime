import "@testing-library/jest-dom";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The OAuth 2.0 variable page's Edit Settings dialog. It used to be five
 * settings on one page; it now walks the create form's Provider, Credentials
 * and Advanced steps, so every setting is under the step it was entered on.
 * Like every stepped edit form, Save Changes is on every step and any step
 * can be opened from the step list.
 *
 * The production field list and steps, in the real CardModelDetail,
 * ModelFormModal, ModelForm and BasicForm; only the transport and the
 * permissions are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: (): { permissions: Array<UserPermission> } => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: OWNER_PERMISSIONS };
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
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import {
  OAUTH_SETTINGS_FORM_STEPS,
  getOAuthSettingsFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil";

const WAIT_TIMEOUT: number = 20000;

const VARIABLE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SAVED_TOKEN_URL: string =
  "https://login.microsoftonline.com/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/oauth2/v2.0/token";

const TOKEN_URL_PLACEHOLDER: string = "https://login.example.com/oauth2/token";
const CLIENT_ID_PLACEHOLDER: string = "12345678-1234-1234-1234-123456789012";
const SCOPE_PLACEHOLDER: string = "api.read api.write";

function savedVariable(): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable.id = VARIABLE_ID;
  variable.name = "GRAPH_TOKEN";
  variable.variableType = WorkflowVariableType.OAuth2;
  variable.oauthGrantType = OAuth2GrantType.ClientCredentials;
  variable.oauthTokenUrl = SAVED_TOKEN_URL;
  variable.oauthClientId = "client-id-123";
  variable.oauthScope = "https://graph.microsoft.com/.default";
  variable.oauthClientAuthenticationMethod =
    OAuth2ClientAuthenticationMethod.BasicAuthHeader;
  return variable;
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Edit Workflow Variable" });
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

function stepTitles(): Array<string> {
  return Array.from(progress().querySelectorAll("li")).map(
    (item: Element): string => {
      return item.textContent || "";
    },
  );
}

function saveButton(): HTMLElement {
  return within(dialog()).getByTestId("modal-footer-submit-button");
}

function input(placeholder: string): HTMLElement {
  return within(dialog()).getByPlaceholderText(placeholder);
}

function queryInput(placeholder: string): HTMLElement | null {
  return within(dialog()).queryByPlaceholderText(placeholder);
}

function submitted(): Record<string, unknown> {
  return (
    createOrUpdateMock.mock.calls[0] as Array<{ model: WorkflowVariable }>
  )[0]!.model as unknown as Record<string, unknown>;
}

async function openStep(user: UserEvent, title: string): Promise<void> {
  await user.click(within(progress()).getByText(title));
  await waitFor(() => {
    expect(activeStep()).toBe(title);
  });
}

async function openEditDialog(): Promise<UserEvent> {
  const user: UserEvent = userEvent.setup({ delay: null });

  await act(async (): Promise<void> => {
    render(
      <CardModelDetail<WorkflowVariable>
        name="Workflow > OAuth 2.0 Settings"
        cardProps={{
          title: "OAuth 2.0 Settings",
          description: "How OneUptime asks your identity provider for a token.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formSteps={OAUTH_SETTINGS_FORM_STEPS}
        formFields={getOAuthSettingsFormFields()}
        modelDetailProps={{
          modelType: WorkflowVariable,
          id: "workflow-variable-oauth-settings",
          modelId: VARIABLE_ID,
          fields: [{ field: { oauthTokenUrl: true }, title: "Token URL" }],
        }}
      />,
    );
  });

  await user.click(
    await screen.findByText("Edit Settings", {}, { timeout: WAIT_TIMEOUT }),
  );

  await waitFor(
    () => {
      expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue(SAVED_TOKEN_URL);
    },
    { timeout: WAIT_TIMEOUT },
  );

  return user;
}

describe("Edit Settings on an OAuth 2.0 variable's page", () => {
  beforeEach(() => {
    cleanup();
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
    getItemMock.mockResolvedValue(savedVariable());
  });

  test("walks Provider, Credentials and Advanced, opening on Provider", async () => {
    await openEditDialog();

    expect(stepTitles()).toEqual(["Provider", "Credentials", "Advanced"]);
    expect(activeStep()).toBe("Provider");
    expect(queryInput(CLIENT_ID_PLACEHOLDER)).not.toBeInTheDocument();
    expect(queryInput(SCOPE_PLACEHOLDER)).not.toBeInTheDocument();
  });

  // The provider is never saved and the grant is fixed once saved.
  test("asks for neither the identity provider nor the grant", async () => {
    await openEditDialog();

    expect(
      within(dialog()).queryByRole("combobox", {
        name: /^Identity Provider/,
      }),
    ).not.toBeInTheDocument();
    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);
  });

  test("offers Save Changes on every step, with Next beside it until the last", async () => {
    const user: UserEvent = await openEditDialog();

    expect(saveButton()).toHaveTextContent("Save Changes");
    expect(
      within(dialog()).getByTestId("modal-footer-next-button"),
    ).toHaveTextContent("Next");

    await user.click(within(dialog()).getByTestId("modal-footer-next-button"));
    await waitFor(() => {
      expect(activeStep()).toBe("Credentials");
    });
    expect(input(CLIENT_ID_PLACEHOLDER)).toHaveValue("client-id-123");
    expect(saveButton()).toHaveTextContent("Save Changes");

    await user.click(within(dialog()).getByTestId("modal-footer-next-button"));
    await waitFor(() => {
      expect(activeStep()).toBe("Advanced");
    });
    expect(input(SCOPE_PLACEHOLDER)).toHaveValue(
      "https://graph.microsoft.com/.default",
    );
    await waitFor(() => {
      expect(
        within(dialog()).queryByTestId("modal-footer-next-button"),
      ).not.toBeInTheDocument();
    });
    expect(saveButton()).toHaveTextContent("Save Changes");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("saves a new scope from the Advanced step, opened from the step list", async () => {
    const user: UserEvent = await openEditDialog();

    await openStep(user, "Advanced");
    fireEvent.change(input(SCOPE_PLACEHOLDER), {
      target: { value: "https://graph.microsoft.com/.default offline_access" },
    });
    await user.click(saveButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(submitted()["oauthScope"]).toBe(
      "https://graph.microsoft.com/.default offline_access",
    );
    // What the other steps were loaded with goes back unchanged.
    expect(submitted()["oauthTokenUrl"]).toBe(SAVED_TOKEN_URL);
    expect(submitted()["oauthClientId"]).toBe("client-id-123");
    expect(submitted()["_id"]).toBe(VARIABLE_ID.toString());
  });

  // A write-only credential or a fixed setting never travels with a settings edit.
  test("saves only the five readable settings", async () => {
    const user: UserEvent = await openEditDialog();

    await user.click(saveButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const sent: Record<string, unknown> = WorkflowVariable.toJSONObject(
      submitted() as unknown as WorkflowVariable,
      WorkflowVariable,
    );

    expect(Object.keys(sent).sort()).toEqual(
      [
        "_id",
        "oauthClientAuthenticationMethod",
        "oauthClientId",
        "oauthScope",
        "oauthTokenUrl",
      ].sort(),
    );
  });

  test("refuses a token URL that still holds a placeholder, on the Provider step", async () => {
    const user: UserEvent = await openEditDialog();

    fireEvent.change(input(TOKEN_URL_PLACEHOLDER), {
      target: { value: "https://{your-domain}/oauth/token" },
    });
    await user.click(saveButton());

    expect(
      await within(dialog()).findByText(
        "Replace {your-domain} in the token URL with your own value.",
      ),
    ).toBeVisible();
    expect(activeStep()).toBe("Provider");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("opens the step whose field fails when saved from another step", async () => {
    const user: UserEvent = await openEditDialog();

    await openStep(user, "Credentials");
    fireEvent.change(input(CLIENT_ID_PLACEHOLDER), { target: { value: "" } });
    await openStep(user, "Advanced");

    await user.click(saveButton());

    await waitFor(() => {
      expect(activeStep()).toBe("Credentials");
    });
    expect(
      await within(dialog()).findByText("Client ID is required."),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});
