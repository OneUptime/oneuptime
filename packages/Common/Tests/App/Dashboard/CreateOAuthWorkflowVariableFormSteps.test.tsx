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
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "This Oauth 2.0 form has a lot of form steps. Can we please split this into
 * multiple form steps so we make it easier for users to understand whats
 * happening?" - the maintainer, on Create OAuth 2.0 Variable, whose second
 * step asked for the grant type, the token URL (under a paragraph of four
 * providers' URL templates), the client ID, the client secret, the scope, the
 * additional parameters and the client authentication on one scrolling page.
 *
 * The real dialog, walked in a browser-like DOM: the production modal, its
 * ModelFormModal, ModelForm and BasicForm, their validation and their step
 * navigation. Only the transport, the permissions and the project are
 * stubbed, so a field on the wrong step, a step that cannot be left, a value
 * lost between steps or a request that changed shape all show up here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
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
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
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

import CreateOAuthWorkflowVariableModal from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/CreateOAuthWorkflowVariableModal";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";

type Scope = "global" | "local";

const SCOPES: Array<Scope> = ["global", "local"];

const NAME_PLACEHOLDER: string = "API_KEY";
const DESCRIPTION_PLACEHOLDER: string = "What this variable is for";
const TOKEN_URL_PLACEHOLDER: string = "https://login.example.com/oauth2/token";
const CLIENT_ID_PLACEHOLDER: string = "12345678-1234-1234-1234-123456789012";
const CLIENT_SECRET_PLACEHOLDER: string = "Client secret";
const REFRESH_TOKEN_PLACEHOLDER: string = "Refresh token";
const SCOPE_PLACEHOLDER: string = "api.read api.write";

const CLIENT_CREDENTIALS_LABEL: string =
  "Client Credentials (machine-to-machine)";
const REFRESH_TOKEN_LABEL: string =
  "Refresh Token (delegated access for a user)";

const ENTRA_TOKEN_URL: string =
  "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token";
const OKTA_TOKEN_URL: string = "https://{your-domain}/oauth2/default/v1/token";
const GOOGLE_TOKEN_URL: string = "https://oauth2.googleapis.com/token";

const SUBMIT_LABEL: string = "Create OAuth 2.0 Variable";

let onSuccess: MockFunction = getJestMockFunction();

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Create OAuth 2.0 Variable" });
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

function input(placeholder: string): HTMLInputElement {
  return within(dialog()).getByPlaceholderText(placeholder) as HTMLInputElement;
}

function queryInput(placeholder: string): HTMLElement | null {
  return within(dialog()).queryByPlaceholderText(placeholder);
}

function type(placeholder: string, value: string): void {
  fireEvent.change(input(placeholder), { target: { value } });
}

function providerPicker(): HTMLElement {
  return within(dialog()).getByRole("combobox", {
    name: /^Identity Provider/,
  });
}

/*
 * react-select renders its menu on ArrowDown, in a portal on the page's body
 * rather than inside the dialog; the option text is unique on the page at
 * that moment.
 */
function pickProvider(label: string): void {
  fireEvent.keyDown(providerPicker(), { key: "ArrowDown" });
  const option: HTMLElement = screen.getByRole("option", {
    name: label,
  });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

function providerOptions(): Array<string> {
  fireEvent.keyDown(providerPicker(), { key: "ArrowDown" });

  const options: Array<string> = screen
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });

  fireEvent.keyDown(providerPicker(), { key: "Escape" });

  return options;
}

function grantRadio(label: string): HTMLInputElement {
  return within(dialog()).getByRole("radio", {
    name: label,
  }) as HTMLInputElement;
}

function hint(field: string): HTMLElement | null {
  return within(dialog()).queryByTestId(`oauth-provider-hint-${field}`);
}

async function renderForm(scope: Scope): Promise<UserEvent> {
  onSuccess = getJestMockFunction();

  await act(async (): Promise<void> => {
    render(
      <CreateOAuthWorkflowVariableModal
        workflowId={scope === "local" ? WORKFLOW_ID : undefined}
        onClose={() => {}}
        onSuccess={(variable: WorkflowVariable) => {
          onSuccess(variable);
        }}
      />,
    );
  });

  await screen.findByPlaceholderText(NAME_PLACEHOLDER);

  return userEvent.setup({ delay: null });
}

async function next(user: UserEvent): Promise<void> {
  await user.click(
    await within(dialog()).findByRole("button", { name: "Next" }),
  );
}

async function submit(user: UserEvent): Promise<void> {
  await user.click(
    await within(dialog()).findByRole("button", { name: SUBMIT_LABEL }),
  );
}

async function waitForStep(title: string): Promise<void> {
  await waitFor(() => {
    expect(activeStep()).toBe(title);
  });
}

async function fillVariableStep(user: UserEvent, name: string): Promise<void> {
  type(NAME_PLACEHOLDER, name);
  type(DESCRIPTION_PLACEHOLDER, "Microsoft Graph for the on-call sync");
  await next(user);
  await waitForStep("Provider");
}

async function fillProviderStep(
  user: UserEvent,
  data: { provider: string; tokenUrl?: string | undefined },
): Promise<void> {
  pickProvider(data.provider);

  if (data.tokenUrl !== undefined) {
    type(TOKEN_URL_PLACEHOLDER, data.tokenUrl);
  }

  await next(user);
  await waitForStep("Credentials");
}

async function fillCredentialsStep(user: UserEvent): Promise<void> {
  type(CLIENT_ID_PLACEHOLDER, "client-id-123");
  type(CLIENT_SECRET_PLACEHOLDER, "client-secret-456");
  await next(user);
  await waitForStep("Advanced");
}

type CreateCall = {
  model: WorkflowVariable;
  miscDataProps?: JSONObject | undefined;
};

function createCall(): CreateCall {
  return createOrUpdateMock.mock.calls[0]?.[0] as CreateCall;
}

describe.each(SCOPES)(
  "Create OAuth 2.0 Variable, for a %s variable",
  (scope: Scope) => {
    beforeEach(() => {
      createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
    });

    afterEach(() => {
      cleanup();
    });

    test("walks four steps - Variable, Provider, Credentials, Advanced - with no Back button", async () => {
      await renderForm(scope);

      expect(stepTitles()).toEqual([
        "Variable",
        "Provider",
        "Credentials",
        "Advanced",
      ]);
      expect(activeStep()).toBe("Variable");
      expect(
        within(dialog()).queryByRole("button", { name: "Back" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog()).getByRole("button", { name: "Next" }),
      ).toBeVisible();
      expect(
        within(dialog()).queryByRole("button", { name: SUBMIT_LABEL }),
      ).not.toBeInTheDocument();
    });

    test("asks only for the name and description on the Variable step", async () => {
      await renderForm(scope);

      expect(input(NAME_PLACEHOLDER)).toBeVisible();
      expect(input(DESCRIPTION_PLACEHOLDER)).toBeVisible();

      for (const placeholder of [
        TOKEN_URL_PLACEHOLDER,
        CLIENT_ID_PLACEHOLDER,
        CLIENT_SECRET_PLACEHOLDER,
        SCOPE_PLACEHOLDER,
      ]) {
        expect(queryInput(placeholder)).not.toBeInTheDocument();
      }

      expect(
        within(dialog()).queryByRole("combobox", {
          name: /^Identity Provider/,
        }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog()).queryByRole("radio", {
          name: CLIENT_CREDENTIALS_LABEL,
        }),
      ).not.toBeInTheDocument();
    });

    test("does not leave the Variable step without a name", async () => {
      const user: UserEvent = await renderForm(scope);

      await next(user);

      expect(await screen.findByText("Name is required.")).toBeVisible();
      expect(activeStep()).toBe("Variable");
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("asks for the provider, its token URL and the grant on the Provider step - and nothing else", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");

      expect(providerPicker()).toBeVisible();
      expect(input(TOKEN_URL_PLACEHOLDER)).toBeVisible();
      expect(grantRadio(CLIENT_CREDENTIALS_LABEL)).toBeVisible();
      expect(grantRadio(REFRESH_TOKEN_LABEL)).toBeVisible();

      // Client Credentials until somebody picks otherwise.
      expect(grantRadio(CLIENT_CREDENTIALS_LABEL)).toBeChecked();
      expect(grantRadio(REFRESH_TOKEN_LABEL)).not.toBeChecked();

      for (const placeholder of [
        NAME_PLACEHOLDER,
        CLIENT_ID_PLACEHOLDER,
        CLIENT_SECRET_PLACEHOLDER,
        REFRESH_TOKEN_PLACEHOLDER,
        SCOPE_PLACEHOLDER,
      ]) {
        expect(queryInput(placeholder)).not.toBeInTheDocument();
      }

      // The old wall of URL templates is gone from the Token URL's help.
      expect(dialog()).not.toHaveTextContent("login.microsoftonline.com");
    });

    test("offers Microsoft Entra ID, Google, Okta, Auth0 and Other provider", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");

      expect(providerOptions()).toEqual([
        "Microsoft Entra ID",
        "Google",
        "Okta",
        "Auth0",
        "Other provider",
      ]);
    });

    test("does not leave the Provider step without a provider and a token URL", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      await next(user);

      expect(
        await within(dialog()).findByText("Identity Provider is required."),
      ).toBeVisible();
      expect(
        within(dialog()).getByText("Token URL is required."),
      ).toBeVisible();
      expect(activeStep()).toBe("Provider");
      expect(queryInput(CLIENT_ID_PLACEHOLDER)).not.toBeInTheDocument();
    });

    test("fills in Microsoft Entra ID's token URL and says which part to replace", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      pickProvider("Microsoft Entra ID");

      await waitFor(() => {
        expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue(ENTRA_TOKEN_URL);
      });
      expect(hint("oauthTokenUrl")).toHaveTextContent(
        "Replace {tenant-id} with your Directory (tenant) ID",
      );
      // Entra works with either grant, so the default stays.
      expect(grantRadio(CLIENT_CREDENTIALS_LABEL)).toBeChecked();
    });

    test("refuses to move on while the token URL still holds {tenant-id}", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      pickProvider("Microsoft Entra ID");
      await waitFor(() => {
        expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue(ENTRA_TOKEN_URL);
      });

      await next(user);

      expect(
        await within(dialog()).findByText(
          "Replace {tenant-id} in the token URL with your own value.",
        ),
      ).toBeVisible();
      expect(activeStep()).toBe("Provider");

      type(
        TOKEN_URL_PLACEHOLDER,
        "https://login.microsoftonline.com/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/oauth2/v2.0/token",
      );
      await next(user);

      await waitForStep("Credentials");
    });

    test("Google fills in its token URL and switches the grant to Refresh Token", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GMAIL_TOKEN");
      pickProvider("Google");

      await waitFor(() => {
        expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue(GOOGLE_TOKEN_URL);
      });
      await waitFor(() => {
        expect(grantRadio(REFRESH_TOKEN_LABEL)).toBeChecked();
      });
      expect(hint("oauthGrantType")).toHaveTextContent(
        "Google's OAuth clients cannot use Client Credentials",
      );
      // Nothing in Google's URL is the person's own.
      expect(hint("oauthTokenUrl")).not.toBeInTheDocument();
    });

    test("moving from Google to Okta puts the grant back and swaps the untouched URL", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "OKTA_TOKEN");
      pickProvider("Google");
      await waitFor(() => {
        expect(grantRadio(REFRESH_TOKEN_LABEL)).toBeChecked();
      });

      pickProvider("Okta");

      await waitFor(() => {
        expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue(OKTA_TOKEN_URL);
      });
      await waitFor(() => {
        expect(grantRadio(CLIENT_CREDENTIALS_LABEL)).toBeChecked();
      });
      expect(hint("oauthTokenUrl")).toHaveTextContent(
        "Replace {your-domain} with your Okta domain",
      );
    });

    test("never replaces a token URL the person typed", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "KEYCLOAK_TOKEN");
      type(
        TOKEN_URL_PLACEHOLDER,
        "https://sso.example.com/realms/ops/protocol/openid-connect/token",
      );
      pickProvider("Auth0");

      await waitFor(() => {
        expect(hint("oauthTokenUrl")).toHaveTextContent(
          "Replace {your-domain} with your Auth0 domain",
        );
      });
      expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue(
        "https://sso.example.com/realms/ops/protocol/openid-connect/token",
      );
    });

    test("Other provider leaves the token URL to the person", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "KEYCLOAK_TOKEN");
      pickProvider("Other provider");

      await waitFor(() => {
        expect(hint("oauthTokenUrl")).toBeInTheDocument();
      });
      expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue("");

      await next(user);

      expect(
        await within(dialog()).findByText("Token URL is required."),
      ).toBeVisible();
      expect(activeStep()).toBe("Provider");
    });

    test("asks for the client ID and secret on the Credentials step, and no refresh token for Client Credentials", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      await fillProviderStep(user, {
        provider: "Other provider",
        tokenUrl: "https://login.example.com/oauth2/token",
      });

      expect(input(CLIENT_ID_PLACEHOLDER)).toBeVisible();
      expect(input(CLIENT_SECRET_PLACEHOLDER)).toBeVisible();
      expect(queryInput(REFRESH_TOKEN_PLACEHOLDER)).not.toBeInTheDocument();
      expect(queryInput(TOKEN_URL_PLACEHOLDER)).not.toBeInTheDocument();
      expect(queryInput(SCOPE_PLACEHOLDER)).not.toBeInTheDocument();
    });

    test("does not leave the Credentials step without the client ID and secret", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      await fillProviderStep(user, {
        provider: "Other provider",
        tokenUrl: "https://login.example.com/oauth2/token",
      });
      await next(user);

      expect(
        await within(dialog()).findByText("Client ID is required."),
      ).toBeVisible();
      expect(
        within(dialog()).getByText("Client Secret is required."),
      ).toBeVisible();
      expect(activeStep()).toBe("Credentials");
    });

    test("asks for a refresh token, and lets a public client leave the secret empty, for the Refresh Token grant", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GMAIL_TOKEN");
      pickProvider("Google");
      await waitFor(() => {
        expect(grantRadio(REFRESH_TOKEN_LABEL)).toBeChecked();
      });
      await next(user);
      await waitForStep("Credentials");

      expect(input(REFRESH_TOKEN_PLACEHOLDER)).toBeVisible();

      type(CLIENT_ID_PLACEHOLDER, "google-client-id");
      await next(user);

      expect(
        await within(dialog()).findByText("Refresh Token is required."),
      ).toBeVisible();
      expect(
        within(dialog()).queryByText("Client Secret is required."),
      ).not.toBeInTheDocument();
      expect(activeStep()).toBe("Credentials");

      type(REFRESH_TOKEN_PLACEHOLDER, "1//refresh-token");
      await next(user);

      await waitForStep("Advanced");
    });

    test("shows the provider's help under the credentials it is about", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      await fillProviderStep(user, {
        provider: "Microsoft Entra ID",
        tokenUrl:
          "https://login.microsoftonline.com/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/oauth2/v2.0/token",
      });

      expect(hint("oauthClientId")).toHaveTextContent(
        "Application (client) ID",
      );
      expect(hint("oauthClientSecret")).toHaveTextContent(
        "Paste the secret's Value from Certificates & secrets - not its Secret ID.",
      );
    });

    test("puts the optional settings on the Advanced step, where the Create button is", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      await fillProviderStep(user, {
        provider: "Other provider",
        tokenUrl: "https://login.example.com/oauth2/token",
      });
      await fillCredentialsStep(user);

      expect(input(SCOPE_PLACEHOLDER)).toBeVisible();
      expect(
        within(dialog()).getByRole("button", {
          name: "Add Additional Parameters",
        }),
      ).toBeVisible();
      expect(
        within(dialog()).getByRole("combobox", {
          name: /^Client Authentication/,
        }),
      ).toBeVisible();
      expect(queryInput(CLIENT_ID_PLACEHOLDER)).not.toBeInTheDocument();

      // The last step: its main button creates the variable.
      expect(
        await within(dialog()).findByRole("button", { name: SUBMIT_LABEL }),
      ).toBeVisible();
      expect(
        within(dialog()).queryByRole("button", { name: "Next" }),
      ).not.toBeInTheDocument();
    });

    test("reminds Microsoft Entra ID users of the /.default scope", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      await fillProviderStep(user, {
        provider: "Microsoft Entra ID",
        tokenUrl:
          "https://login.microsoftonline.com/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/oauth2/v2.0/token",
      });
      await fillCredentialsStep(user);

      expect(hint("oauthScope")).toHaveTextContent(
        "https://graph.microsoft.com/.default",
      );
      expect(hint("oauthAdditionalParameters")).not.toBeInTheDocument();
    });

    test("reminds Auth0 users of the audience parameter", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "AUTH0_TOKEN");
      await fillProviderStep(user, {
        provider: "Auth0",
        tokenUrl: "https://your-tenant.us.auth0.com/oauth/token",
      });
      await fillCredentialsStep(user);

      expect(hint("oauthAdditionalParameters")).toHaveTextContent(
        "add a parameter named audience",
      );
      expect(hint("oauthScope")).not.toBeInTheDocument();
    });

    test("does not create a variable with a reserved additional parameter", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      await fillProviderStep(user, {
        provider: "Other provider",
        tokenUrl: "https://login.example.com/oauth2/token",
      });
      await fillCredentialsStep(user);

      await user.click(
        within(dialog()).getByRole("button", {
          name: "Add Additional Parameters",
        }),
      );
      type("Key", "client_secret");
      type("Value", "sneaky");

      await submit(user);

      expect(
        await within(dialog()).findByText(
          '"client_secret" cannot be set as an additional parameter - OneUptime sets it from the variable\'s other settings.',
        ),
      ).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("keeps what was typed when going back to an earlier step and on again", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      await fillProviderStep(user, {
        provider: "Other provider",
        tokenUrl: "https://login.example.com/oauth2/token",
      });
      type(CLIENT_ID_PLACEHOLDER, "client-id-123");

      await user.click(within(progress()).getByText("Provider"));
      await waitForStep("Provider");

      expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue(
        "https://login.example.com/oauth2/token",
      );

      await next(user);
      await waitForStep("Credentials");

      expect(input(CLIENT_ID_PLACEHOLDER)).toHaveValue("client-id-123");
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    /*
     * Steps and presets change how the form asks, not what it sends: the same
     * request as the one-step form made, and never the provider, which is no
     * column of the variable.
     */
    test("creates the variable with exactly the settings the steps asked for", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GRAPH_TOKEN");
      pickProvider("Microsoft Entra ID");
      await waitFor(() => {
        expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue(ENTRA_TOKEN_URL);
      });
      type(
        TOKEN_URL_PLACEHOLDER,
        "https://login.microsoftonline.com/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/oauth2/v2.0/token",
      );
      await next(user);
      await waitForStep("Credentials");
      await fillCredentialsStep(user);
      type(SCOPE_PLACEHOLDER, "https://graph.microsoft.com/.default");

      await submit(user);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
        expect(onSuccess).toHaveBeenCalledTimes(1);
      });

      const call: CreateCall = createCall();
      const model: WorkflowVariable = call.model;

      expect(model.name).toBe("GRAPH_TOKEN");
      expect(model.description).toBe("Microsoft Graph for the on-call sync");
      expect(model.variableType).toBe(WorkflowVariableType.OAuth2);
      expect(model.oauthGrantType).toBe(OAuth2GrantType.ClientCredentials);
      expect(model.oauthTokenUrl).toBe(
        "https://login.microsoftonline.com/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/oauth2/v2.0/token",
      );
      expect(model.oauthClientId).toBe("client-id-123");
      expect(model.oauthClientSecret).toBe("client-secret-456");
      expect(model.oauthScope).toBe("https://graph.microsoft.com/.default");
      expect(model.oauthClientAuthenticationMethod).toBe(
        OAuth2ClientAuthenticationMethod.BasicAuthHeader,
      );
      expect(model.oauthRefreshToken).toBeUndefined();

      if (scope === "local") {
        expect(model.workflowId?.toString()).toBe(WORKFLOW_ID.toString());
      } else {
        expect(model.workflowId).toBeUndefined();
      }

      // Exactly the columns the one-step form sent, and nothing else.
      const sentColumns: JSONObject = WorkflowVariable.toJSONObject(
        model,
        WorkflowVariable,
      );

      expect(Object.keys(sentColumns).sort()).toEqual(
        [
          "description",
          "name",
          "oauthClientAuthenticationMethod",
          "oauthClientId",
          "oauthClientSecret",
          "oauthGrantType",
          "oauthScope",
          "oauthTokenUrl",
          "variableType",
          ...(scope === "local" ? ["workflowId"] : []),
        ].sort(),
      );

      // The provider only filled in the form; it travels nowhere.
      expect(call.miscDataProps).toEqual({});
      expect(JSON.stringify(sentColumns)).not.toContain("Microsoft Entra ID");
    });

    test("creates a refresh-token variable for a public client, with no client secret", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "GMAIL_TOKEN");
      pickProvider("Google");
      await waitFor(() => {
        expect(grantRadio(REFRESH_TOKEN_LABEL)).toBeChecked();
      });
      await next(user);
      await waitForStep("Credentials");
      type(CLIENT_ID_PLACEHOLDER, "google-client-id");
      type(REFRESH_TOKEN_PLACEHOLDER, "1//refresh-token");
      await next(user);
      await waitForStep("Advanced");

      await submit(user);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const model: WorkflowVariable = createCall().model;

      expect(model.oauthGrantType).toBe(OAuth2GrantType.RefreshToken);
      expect(model.oauthTokenUrl).toBe(GOOGLE_TOKEN_URL);
      expect(model.oauthClientId).toBe("google-client-id");
      expect(model.oauthRefreshToken).toBe("1//refresh-token");
      expect(model.oauthClientSecret).toBeUndefined();
      expect(createCall().miscDataProps).toEqual({});
    });

    test("can be created with a grant picked by hand", async () => {
      const user: UserEvent = await renderForm(scope);

      await fillVariableStep(user, "OKTA_TOKEN");
      pickProvider("Okta");
      await waitFor(() => {
        expect(input(TOKEN_URL_PLACEHOLDER)).toHaveValue(OKTA_TOKEN_URL);
      });
      type(
        TOKEN_URL_PLACEHOLDER,
        "https://dev-123456.okta.com/oauth2/default/v1/token",
      );
      await user.click(grantRadio(REFRESH_TOKEN_LABEL));
      await waitFor(() => {
        expect(grantRadio(REFRESH_TOKEN_LABEL)).toBeChecked();
      });
      await next(user);
      await waitForStep("Credentials");
      type(CLIENT_ID_PLACEHOLDER, "okta-client-id");
      type(CLIENT_SECRET_PLACEHOLDER, "okta-client-secret");
      type(REFRESH_TOKEN_PLACEHOLDER, "okta-refresh-token");
      await next(user);
      await waitForStep("Advanced");

      await submit(user);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const model: WorkflowVariable = createCall().model;

      expect(model.oauthGrantType).toBe(OAuth2GrantType.RefreshToken);
      expect(model.oauthTokenUrl).toBe(
        "https://dev-123456.okta.com/oauth2/default/v1/token",
      );
      expect(model.oauthClientSecret).toBe("okta-client-secret");
      expect(model.oauthRefreshToken).toBe("okta-refresh-token");
    });
  },
);
