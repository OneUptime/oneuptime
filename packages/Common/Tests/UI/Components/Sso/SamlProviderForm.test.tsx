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
import userEvent from "@testing-library/user-event";
import React from "react";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

/*
 * Adding a SAML provider, through the real ModelForm and BasicForm with only
 * the network stubbed: the form opens on the four things the identity
 * provider gives (name, sign-on URL, issuer, certificate), walks on to
 * Sign-in, where the action is, and saves a complete provider - RSA-SHA256 and
 * SHA256, the description from the name, the members team it started on,
 * and off until someone turns it on. The signature and digest methods wait
 * folded under More fields, whose header names them and says what they are
 * until one is changed, then shows the changed one as a chip. The edit dialog keeps the description in step with a rename,
 * never touches one somebody wrote, and keeps an older provider's methods.
 */

const MEMBERS_TEAM_ID: string = "00000000-0000-4000-8000-0000000000a1";
const OWNERS_TEAM_ID: string = "00000000-0000-4000-8000-0000000000a2";
const PROVIDER_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000b1",
);

const SIGN_ON_URL: string =
  "https://dev-123456.okta.com/app/dev-123456_oneuptime_1/exk1/sso/saml";
const ISSUER: string = "http://www.okta.com/exk1a2b3c4d5e6f7g8h9";
const CERTIFICATE: string =
  "-----BEGIN CERTIFICATE-----\nMIIDpDCCAoygAwIBAgIGAYQ\n-----END CERTIFICATE-----";

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

import ProjectSSO from "../../../../Models/DatabaseModels/ProjectSso";
import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { getSamlProviderFormFields } from "../../../../UI/Components/Sso/SamlProviderFormFields";
import { getSsoProviderFormSteps } from "../../../../UI/Components/Sso/SsoProviderFormFields";

const ACTION: string = "Create SSO";
const SAVE: string = "Save Changes";

const WITH_MEMBERS: FormValues<ProjectSSO> = {
  teams: [MEMBERS_TEAM_ID],
} as unknown as FormValues<ProjectSSO>;

async function renderProviderForm(data: {
  formType: FormType;
  initialValues?: FormValues<ProjectSSO> | undefined;
}): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<ProjectSSO>
        modelType={ProjectSSO}
        id="saml-provider-form"
        name="Settings > Project SSO"
        fields={getSamlProviderFormFields<ProjectSSO>({ withTeams: true })}
        steps={getSsoProviderFormSteps<ProjectSSO>()}
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

async function fillTheProvider(): Promise<void> {
  await type("Okta", "Okta");
  await type("https://yourapp.example.com/apps/appId", SIGN_ON_URL);
  await type("https://example.com", ISSUER);
  await type("Paste in your x509 certificate here.", CERTIFICATE);
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

async function goToSignIn(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByTestId("form-next-button"));
  });

  expect(activeStep()).toContain("Sign-in");
}

async function toggleAdvanced(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "More fields" }));
  });
}

// The chips a folded header draws for its set fields: "Digest Method: SHA512".
function setChips(): Array<string> {
  return screen
    .queryAllByTestId("folded-section-item")
    .filter((item: HTMLElement): boolean => {
      return item.getAttribute("data-item-set") === "true";
    })
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

// Every name a folded header lists.
function listedNames(): Array<string> {
  return screen
    .queryAllByTestId("folded-section-item")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
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

describe("adding a SAML provider", () => {
  test("opens on Provider, with the four things the identity provider gives", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: WITH_MEMBERS,
    });

    expect(activeStep()).toContain("Provider");
    expect(within(progress()).getByText("Sign-in")).toBeInTheDocument();
    // Two steps, not the four (Basic Info, Sign On, Certificate, More) of before.
    expect(within(progress()).queryByText("Basic Info")).toBeNull();
    expect(within(progress()).queryByText("Certificate")).toBeNull();
    expect(within(progress()).queryByText("More")).toBeNull();

    for (const label of [
      "Name",
      "Sign On URL",
      "Issuer",
      "Public Certificate",
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }

    // The rest waits on the Sign-in step.
    expect(screen.queryByText("Signature Method")).not.toBeInTheDocument();
    expect(screen.queryByText("Digest Method")).not.toBeInTheDocument();
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  test("asks only the first step's four answers, then saves a complete provider from Sign-in", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: WITH_MEMBERS,
    });

    await fillTheProvider();

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
      signOnURL: String(model["signOnURL"]),
      issuerURL: model["issuerURL"],
      publicCertificate: model["publicCertificate"],
      signatureMethod: model["signatureMethod"],
      digestMethod: model["digestMethod"],
      description: model["description"],
      isEnabled: model["isEnabled"],
    }).toEqual({
      name: "Okta",
      signOnURL: SIGN_ON_URL,
      issuerURL: ISSUER,
      publicCertificate: CERTIFICATE,
      signatureMethod: "RSA-SHA256",
      digestMethod: "SHA256",
      description: "Sign in with Okta",
      // Off, as its column is, until the identity provider knows OneUptime.
      isEnabled: false,
    });
    expect(teamIdsOf(model)).toEqual([MEMBERS_TEAM_ID]);
  });

  test("without a team to start on, the teams have to be picked first", async () => {
    await renderProviderForm({ formType: FormType.Create });

    await fillTheProvider();

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

  test("still asks for each thing the identity provider gives", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: WITH_MEMBERS,
    });

    await type("Okta", "Okta");
    await type("https://yourapp.example.com/apps/appId", SIGN_ON_URL);

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.queryByRole("button", { name: ACTION }) ||
          screen.getByRole("button", { name: "Next" }),
      );
    });

    expect(await screen.findByText("Issuer is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Public Certificate is required."),
    ).toBeInTheDocument();
    expect(capturedModels).toHaveLength(0);
  });

  test("Sign-in shows the team, Enabled off, and More fields folded with what its defaults are", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: WITH_MEMBERS,
    });

    await fillTheProvider();
    await goToSignIn();

    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Signatures use RSA-SHA256 with a SHA256 digest, as most identity providers do.",
    );
    expect(screen.queryByText("Configured")).not.toBeInTheDocument();
    // Folded, its header names what it holds, nothing of it set.
    expect(listedNames()).toEqual([
      "Signature Method",
      "Digest Method",
      "Description",
    ]);
    expect(setChips()).toEqual([]);
    // Drawn, so its values are kept and sent, but not shown.
    expect(
      screen.getByRole("combobox", { name: "Signature Method", hidden: true }),
    ).not.toBeVisible();

    // Opened, it shows what will be saved.
    await toggleAdvanced();

    expect(
      screen.getByRole("combobox", { name: "Signature Method" }),
    ).toBeVisible();
    expect(screen.getByText("RSA-SHA256")).toBeInTheDocument();
    expect(screen.getByText("SHA256")).toBeInTheDocument();
    expect(input("Sign in with Okta").value).toBe("Sign in with Okta");
  });

  test("a method changed under More fields turns the summary into a chip, and is saved", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await renderProviderForm({
      formType: FormType.Create,
      initialValues: {
        teams: [OWNERS_TEAM_ID],
      } as unknown as FormValues<ProjectSSO>,
    });

    await fillTheProvider();
    await goToSignIn();
    await toggleAdvanced();

    await user.click(screen.getByRole("combobox", { name: "Digest Method" }));
    await user.click(await screen.findByRole("option", { name: "SHA512" }));

    // Folded again, it shows what is set.
    await toggleAdvanced();

    expect(
      screen.queryByTestId("collapsible-section-summary"),
    ).not.toBeInTheDocument();
    expect(setChips()).toEqual(["Digest Method: SHA512"]);

    const model: JSONObject = await submitWith(ACTION);

    expect(model["digestMethod"]).toBe("SHA512");
    expect(model["signatureMethod"]).toBe("RSA-SHA256");
    expect(teamIdsOf(model)).toEqual([OWNERS_TEAM_ID]);
  });

  test("a description written under More fields is saved as written", async () => {
    await renderProviderForm({
      formType: FormType.Create,
      initialValues: WITH_MEMBERS,
    });

    await fillTheProvider();
    await goToSignIn();
    await toggleAdvanced();
    await type("Sign in with Okta", "Staff only");

    const model: JSONObject = await submitWith(ACTION);

    expect(model["description"]).toBe("Staff only");
  });
});

describe("editing a SAML provider", () => {
  const STORED: JSONObject = {
    _id: PROVIDER_ID.toString(),
    name: "Okta",
    description: "Sign in with Okta",
    signOnURL: SIGN_ON_URL,
    issuerURL: ISSUER,
    publicCertificate: CERTIFICATE,
    signatureMethod: "RSA-SHA256",
    digestMethod: "SHA256",
    isEnabled: true,
    teams: [{ _id: MEMBERS_TEAM_ID, name: "Members" }],
  };

  test("walks the same two steps, and a rename moves the description it gave", async () => {
    recordToEdit = { ...STORED };

    await renderProviderForm({ formType: FormType.Update });

    await waitFor(() => {
      expect(input("Okta").value).toBe("Okta");
    });

    expect(within(progress()).getByText("Provider")).toBeInTheDocument();
    expect(within(progress()).getByText("Sign-in")).toBeInTheDocument();

    await type("Okta", "Okta Workforce");

    const model: JSONObject = await submitWith(SAVE);

    expect(model["name"]).toBe("Okta Workforce");
    expect(model["description"]).toBe("Sign in with Okta Workforce");
    expect(model["isEnabled"]).toBe(true);
  });

  test("never touches a description somebody wrote", async () => {
    recordToEdit = { ...STORED, description: "Staff only" };

    await renderProviderForm({ formType: FormType.Update });

    await waitFor(() => {
      expect(input("Okta").value).toBe("Okta");
    });

    await type("Okta", "Okta Workforce");

    const model: JSONObject = await submitWith(SAVE);

    expect(model["description"]).toBe("Staff only");
  });

  test("an older provider keeps its own methods, and More fields shows them", async () => {
    recordToEdit = {
      ...STORED,
      signatureMethod: "RSA-SHA1",
      digestMethod: "SHA1",
    };

    await renderProviderForm({ formType: FormType.Update });

    await waitFor(() => {
      expect(input("Okta").value).toBe("Okta");
    });

    await goToSignIn();

    expect(setChips()).toEqual([
      "Signature Method: RSA-SHA1",
      "Digest Method: SHA1",
    ]);
    expect(
      screen.queryByTestId("collapsible-section-summary"),
    ).not.toBeInTheDocument();

    const model: JSONObject = await submitWith(SAVE);

    expect(model["signatureMethod"]).toBe("RSA-SHA1");
    expect(model["digestMethod"]).toBe("SHA1");
  });
});
