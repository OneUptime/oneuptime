import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

/*
 * Adding an OpenID Connect provider, through the real ModelForm and
 * BasicForm with only the network stubbed: the form opens on the four
 * things the identity provider gives (name, issuer, client ID, secret),
 * walks on to Sign-in, where Create OIDC is, and saves a complete provider -
 * the
 * discovery URL from the issuer, the usual scopes and claim names, the
 * description from the name, the members team it started on, and off until
 * someone turns it on. A discovery URL pasted as the issuer is split into
 * the two. The edit dialog keeps the description and discovery URL in step
 * with a rename or a new issuer, and never touches ones somebody set.
 */

const MEMBERS_TEAM_ID: string = "00000000-0000-4000-8000-0000000000a1";
const OWNERS_TEAM_ID: string = "00000000-0000-4000-8000-0000000000a2";
const PROVIDER_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000b1",
);

let capturedModels: Array<JSONObject> = [];
let recordToEdit: JSONObject = {};

jest.mock("../../../../UI/Utils/Permission", () => {
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

jest.mock("../../../../UI/Utils/User", () => {
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

jest.mock("../../../../UI/Utils/Translation", () => {
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

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  const teamModule: { default: { new (): Record<string, unknown> } } =
    jest.requireActual("../../../../Models/DatabaseModels/Team") as {
      default: { new (): Record<string, unknown> };
    };

  const makeTeam: (id: string, name: string) => Record<string, unknown> = (
    id: string,
    name: string,
  ): Record<string, unknown> => {
    const team: Record<string, unknown> = new teamModule.default();
    team["_id"] = id;
    team["name"] = name;
    return team;
  };

  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<JSONObject> => {
        return { ...recordToEdit };
      },
      getList: async (data: {
        modelType: { new (): unknown };
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        if (data.modelType === teamModule.default) {
          const teams: Array<unknown> = [
            makeTeam("00000000-0000-4000-8000-0000000000a1", "Members"),
            makeTeam("00000000-0000-4000-8000-0000000000a2", "Owners"),
          ];

          return { data: teams, count: teams.length, skip: 0, limit: 10 };
        }

        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedModels.push(data.model);
        return { data: data.model };
      },
    },
  };
});

import ProjectOIDC from "../../../../Models/DatabaseModels/ProjectOidc";
import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { getOidcProviderFormFields } from "../../../../UI/Components/Sso/OidcProviderFormFields";
import { getSsoProviderFormSteps } from "../../../../UI/Components/Sso/SsoProviderFormFields";

const ACTION: string = "Create OIDC";
const SAVE: string = "Save Changes";

async function renderProviderForm(data: {
  formType: FormType;
  initialValues?: FormValues<ProjectOIDC> | undefined;
}): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<ProjectOIDC>
        modelType={ProjectOIDC}
        id="oidc-provider-form"
        name="Settings > Project OIDC"
        fields={getOidcProviderFormFields<ProjectOIDC>({ withTeams: true })}
        steps={getSsoProviderFormSteps<ProjectOIDC>()}
        formType={data.formType}
        modelIdToEdit={
          data.formType === FormType.Update ? PROVIDER_ID : undefined
        }
        initialValues={data.initialValues}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText={data.formType === FormType.Create ? ACTION : SAVE}
        disableAutofocus={true}
      />,
    );
  });

  // The first render draws every field; the first step opens in an effect.
  await screen.findByRole("navigation", { name: "Progress" });
  await act(async (): Promise<void> => {});
}

function progress(): HTMLElement {
  return screen.getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

function input(placeholder: string): HTMLInputElement {
  return screen.getByPlaceholderText(placeholder) as HTMLInputElement;
}

async function type(placeholder: string, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(input(placeholder), { target: { value } });
  });
}

async function fillTheProvider(issuer: string): Promise<void> {
  await type("Okta", "Okta");
  await type("https://accounts.example.com", issuer);
  await type("abc123-client-id", "0oa1b2c3d4e5f6g7h8i9");
  await type("client-secret-value", "a-client-secret");
}

/*
 * Walks on to the last step with Next - the form's action is there only,
 * never on a step before it - and presses the action.
 */
async function submitWith(buttonName: string): Promise<JSONObject> {
  for (
    let step: number = 0;
    step < 5 && screen.queryByTestId("form-next-button");
    step++
  ) {
    expect(
      screen.queryByRole("button", { name: buttonName }),
    ).not.toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("form-next-button"));
    });
  }

  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
  });

  await waitFor(() => {
    expect(capturedModels).toHaveLength(1);
  });

  return capturedModels[0]!;
}

function teamIdsOf(model: JSONObject): Array<string> {
  return ((model["teams"] as Array<JSONObject>) || []).map(
    (team: JSONObject): string => {
      return String(team["_id"]);
    },
  );
}

afterEach(() => {
  cleanup();
  capturedModels = [];
  recordToEdit = {};
});

describe("adding an OIDC provider", () => {
  test("opens on Provider, with the four things the identity provider gives", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: {
        teams: [MEMBERS_TEAM_ID],
      } as unknown as FormValues<ProjectOIDC>,
    });

    expect(activeStep()).toContain("Provider");
    expect(within(progress()).getByText("Sign-in")).toBeInTheDocument();

    for (const label of ["Name", "Issuer URL", "Client ID", "Client Secret"]) {
      expect(screen.getByText(label)).toBeVisible();
    }

    // The rest waits on the Sign-in step.
    expect(screen.queryByText("Discovery URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Scopes")).not.toBeInTheDocument();
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  test("asks only the first step's four answers, then saves a complete provider from Sign-in", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: {
        teams: [MEMBERS_TEAM_ID],
      } as unknown as FormValues<ProjectOIDC>,
    });

    await fillTheProvider("https://dev-123456.okta.com/oauth2/default");

    /*
     * Everything on Sign-in has an answer already, but the action is on the
     * last step only: Provider offers Next.
     */
    expect(activeStep()).toContain("Provider");
    expect(
      screen.queryByRole("button", { name: ACTION }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("form-next-button")).toHaveTextContent("Next");

    const model: JSONObject = await submitWith(ACTION);

    expect({
      name: model["name"],
      issuerURL: model["issuerURL"],
      clientId: model["clientId"],
      clientSecret: model["clientSecret"],
      discoveryURL: String(model["discoveryURL"]),
      scopes: model["scopes"],
      emailClaimName: model["emailClaimName"],
      nameClaimName: model["nameClaimName"],
      description: model["description"],
      isEnabled: model["isEnabled"],
    }).toEqual({
      name: "Okta",
      issuerURL: "https://dev-123456.okta.com/oauth2/default",
      clientId: "0oa1b2c3d4e5f6g7h8i9",
      clientSecret: "a-client-secret",
      discoveryURL:
        "https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration",
      scopes: "openid email profile",
      emailClaimName: "email",
      nameClaimName: "name",
      description: "Sign in with Okta",
      // Off, as its column is, until the identity provider knows OneUptime.
      isEnabled: false,
    });
    expect(teamIdsOf(model)).toEqual([MEMBERS_TEAM_ID]);
  });

  test("without a team to start on, the teams have to be picked first", async () => {
    await renderProviderForm({ formType: FormType.Create });

    await fillTheProvider("https://accounts.example.com");

    expect(
      screen.queryByRole("button", { name: ACTION }),
    ).not.toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });

    expect(activeStep()).toContain("Sign-in");
    expect(screen.getByText("Teams")).toBeVisible();
    expect(capturedModels).toHaveLength(0);
  });

  test("splits a discovery URL pasted as the issuer", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: {
        teams: [MEMBERS_TEAM_ID],
      } as unknown as FormValues<ProjectOIDC>,
    });

    await fillTheProvider(
      "https://accounts.google.com/.well-known/openid-configuration",
    );

    await waitFor(() => {
      expect(input("https://accounts.example.com").value).toBe(
        "https://accounts.google.com",
      );
    });

    const model: JSONObject = await submitWith(ACTION);

    expect(model["issuerURL"]).toBe("https://accounts.google.com");
    expect(String(model["discoveryURL"])).toBe(
      "https://accounts.google.com/.well-known/openid-configuration",
    );
  });

  test("asks for an issuer that is a URL", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: {
        teams: [MEMBERS_TEAM_ID],
      } as unknown as FormValues<ProjectOIDC>,
    });

    await fillTheProvider("accounts.example.com");

    await act(async (): Promise<void> => {
      fireEvent.blur(input("https://accounts.example.com"));
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.queryByRole("button", { name: ACTION }) ||
          screen.getByRole("button", { name: "Next" }),
      );
    });

    expect(
      await screen.findByText(
        "Enter the issuer as a URL that starts with https://.",
      ),
    ).toBeInTheDocument();
    expect(capturedModels).toHaveLength(0);
  });

  test("Sign-in shows the team, Enabled off, and Advanced folded with what its defaults do", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: {
        teams: [MEMBERS_TEAM_ID],
      } as unknown as FormValues<ProjectOIDC>,
    });

    await fillTheProvider("https://accounts.example.com");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("form-next-button"));
    });

    expect(activeStep()).toContain("Sign-in");
    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    const summary: HTMLElement = screen.getByTestId(
      "collapsible-section-summary",
    );

    expect(summary).toHaveTextContent(
      "Endpoints are found from the issuer, and sign-in asks for the openid, email and profile scopes.",
    );

    // Opened, it shows what will be saved.
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    });

    expect(
      input("https://accounts.example.com/.well-known/openid-configuration")
        .value,
    ).toBe("https://accounts.example.com/.well-known/openid-configuration");
    expect(input("openid email profile").value).toBe("openid email profile");
    expect(input("email").value).toBe("email");
    expect(input("name").value).toBe("name");
    expect(input("Sign in with Okta").value).toBe("Sign in with Okta");
  });

  test("a changed default turns the summary into Configured, and is saved", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: {
        teams: [OWNERS_TEAM_ID],
      } as unknown as FormValues<ProjectOIDC>,
    });

    await fillTheProvider("https://accounts.example.com");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("form-next-button"));
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    });

    await type("email", "upn");

    // Folded again, it says something is set.
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    });

    expect(
      screen.queryByTestId("collapsible-section-summary"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Configured")).toBeInTheDocument();

    const model: JSONObject = await submitWith(ACTION);

    expect(model["emailClaimName"]).toBe("upn");
    expect(teamIdsOf(model)).toEqual([OWNERS_TEAM_ID]);
  });
});

describe("editing an OIDC provider", () => {
  const STORED: JSONObject = {
    _id: PROVIDER_ID.toString(),
    name: "Okta",
    description: "Sign in with Okta",
    issuerURL: "https://dev-123456.okta.com/oauth2/default",
    discoveryURL:
      "https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration",
    clientId: "0oa1b2c3d4e5f6g7h8i9",
    clientSecret: "a-client-secret",
    scopes: "openid email profile",
    emailClaimName: "email",
    nameClaimName: "name",
    isEnabled: true,
    teams: [{ _id: MEMBERS_TEAM_ID, name: "Members" }],
  };

  test("a rename and a new issuer move the description and discovery URL they gave", async () => {
    recordToEdit = { ...STORED };

    await renderProviderForm({ formType: FormType.Update });

    await waitFor(() => {
      expect(input("Okta").value).toBe("Okta");
    });

    await type("Okta", "Okta Workforce");
    await type(
      "https://accounts.example.com",
      "https://acme.okta.com/oauth2/default",
    );

    const model: JSONObject = await submitWith(SAVE);

    expect(model["name"]).toBe("Okta Workforce");
    expect(model["description"]).toBe("Sign in with Okta Workforce");
    expect(model["issuerURL"]).toBe("https://acme.okta.com/oauth2/default");
    expect(String(model["discoveryURL"])).toBe(
      "https://acme.okta.com/oauth2/default/.well-known/openid-configuration",
    );
    expect(model["isEnabled"]).toBe(true);
  });

  test("never touches a description or discovery URL somebody set", async () => {
    recordToEdit = {
      ...STORED,
      description: "Staff only",
      discoveryURL: "https://sso.example.com/metadata/openid-configuration",
    };

    await renderProviderForm({ formType: FormType.Update });

    await waitFor(() => {
      expect(input("Okta").value).toBe("Okta");
    });

    await type("Okta", "Okta Workforce");
    await type(
      "https://accounts.example.com",
      "https://acme.okta.com/oauth2/default",
    );

    const model: JSONObject = await submitWith(SAVE);

    expect(model["description"]).toBe("Staff only");
    expect(String(model["discoveryURL"])).toBe(
      "https://sso.example.com/metadata/openid-configuration",
    );
  });

  /*
   * A status page provider could be saved without a name claim, and sign-in
   * reads an empty claim name as "name". Editing such a provider must not
   * stop on a field nobody was asked for.
   */
  test("an older provider with no name claim saves without being asked for one", async () => {
    recordToEdit = { ...STORED, nameClaimName: null };

    await renderProviderForm({ formType: FormType.Update });

    await waitFor(() => {
      expect(input("Okta").value).toBe("Okta");
    });

    await type("Okta", "Okta Workforce");

    const model: JSONObject = await submitWith(SAVE);

    expect(model["name"]).toBe("Okta Workforce");
    expect(model["nameClaimName"] ?? null).toBeNull();
    expect(
      screen.queryByText("Name Claim Name is required."),
    ).not.toBeInTheDocument();
  });
});
