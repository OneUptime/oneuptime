import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

/*
 * The Admin Dashboard's instance-wide SAML provider (Settings > Global SSO),
 * through the real ModelForm and BasicForm with only the network stubbed:
 * its two questions - People without an account, Where this sign-in counts
 * as SSO - wait folded under More fields with their first answers picked,
 * and the answer picked is saved into the columns the switches wrote
 * (disableSignUpWithSso, restrictToAttachedProjects), never under the
 * questions' own keys. Their builders are pinned in
 * SsoGlobalQuestions.test.ts.
 */

const PROVIDER_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000c1",
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
        return [Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [Permission.User, Permission.Public] };
      },
    },
  };
});

// The Admin Dashboard is used by master admins.
jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
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
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<JSONObject> => {
        return { ...recordToEdit };
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
      createOrUpdate: async (data: {
        model: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedModels.push(data.model);
        return { data: data.model };
      },
    },
  };
});

import GlobalSSO from "../../../../Models/DatabaseModels/GlobalSso";
import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import { getSamlProviderFormFields } from "../../../../UI/Components/Sso/SamlProviderFormFields";
import {
  SSO_GLOBAL_REACH_FIELD_KEY,
  SSO_GLOBAL_SIGN_UP_FIELD_KEY,
  getSsoProviderFormSteps,
} from "../../../../UI/Components/Sso/SsoProviderFormFields";

const CREATE: string = "Create Global SSO";
const SAVE: string = "Save Changes";

async function renderProviderForm(formType: FormType): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<GlobalSSO>
        modelType={GlobalSSO}
        id="global-sso-form"
        name="Settings > Global SSO"
        fields={getSamlProviderFormFields<GlobalSSO>({
          withGlobalAccessSwitches: true,
        })}
        steps={getSsoProviderFormSteps<GlobalSSO>()}
        formType={formType}
        modelIdToEdit={formType === FormType.Update ? PROVIDER_ID : undefined}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText={formType === FormType.Create ? CREATE : SAVE}
        disableAutofocus={true}
      />,
    );
  });

  await screen.findByRole("navigation", { name: "Progress" });
  await act(async (): Promise<void> => {});
}

async function type(placeholder: string, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(screen.getByPlaceholderText(placeholder), {
      target: { value },
    });
  });
}

async function fillTheProvider(): Promise<void> {
  await type("Okta", "Okta");
  await type("https://yourapp.example.com/apps/appId", SIGN_ON_URL);
  await type("https://example.com", ISSUER);
  await type("Paste in your x509 certificate here.", CERTIFICATE);
}

async function goToSignIn(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByTestId("form-next-button"));
  });
}

async function openMoreFields(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "More fields" }));
  });
}

async function pick(answer: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("radio", { name: answer }));
  });
}

async function save(buttonName: string): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
  });

  await waitFor(() => {
    expect(capturedModels).toHaveLength(1);
  });

  return capturedModels[0]!;
}

function expectNoQuestionKeys(model: JSONObject): void {
  expect(Object.keys(model)).not.toContain(SSO_GLOBAL_SIGN_UP_FIELD_KEY);
  expect(Object.keys(model)).not.toContain(SSO_GLOBAL_REACH_FIELD_KEY);
}

afterEach(() => {
  cleanup();
  capturedModels = [];
  recordToEdit = {};
});

describe("adding an instance-wide SAML provider", () => {
  test("its two questions wait under More fields, on their first answers", async () => {
    await renderProviderForm(FormType.Create);
    await fillTheProvider();
    await goToSignIn();

    // Folded: rendered, but not on screen until More fields is opened.
    expect(
      screen.getByRole("radio", {
        name: "Get one on their first sign-in",
        hidden: true,
      }),
    ).not.toBeVisible();

    await openMoreFields();

    expect(screen.getByText("People without an account")).toBeVisible();
    expect(screen.getByText("Where this sign-in counts as SSO")).toBeVisible();
    expect(
      screen.getByRole("radio", { name: "Get one on their first sign-in" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Must be invited first" }),
    ).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Every project" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Attached projects only" }),
    ).not.toBeChecked();

    // One line under each answer.
    expect(
      screen.getByText(
        "They join the projects attached to this provider. With none attached, they must be invited first.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Other projects that require SSO turn it away, even for people already signed in.",
      ),
    ).toBeVisible();

    // The switches' names are gone from the form.
    expect(screen.queryByText("Disable Sign Up with SSO")).toBeNull();
    expect(screen.queryByText("Restrict to Attached Projects")).toBeNull();
  });

  test("saved on the first answers, both columns stay off", async () => {
    await renderProviderForm(FormType.Create);
    await fillTheProvider();
    await goToSignIn();

    const model: JSONObject = await save(CREATE);

    expect(Boolean(model["disableSignUpWithSso"])).toBe(false);
    expect(Boolean(model["restrictToAttachedProjects"])).toBe(false);
    expectNoQuestionKeys(model);
  });

  test("the second answers are saved into the columns the switches wrote", async () => {
    await renderProviderForm(FormType.Create);
    await fillTheProvider();
    await goToSignIn();
    await openMoreFields();

    await pick("Must be invited first");
    await pick("Attached projects only");

    expect(
      screen.getByRole("radio", { name: "Must be invited first" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Attached projects only" }),
    ).toBeChecked();

    const model: JSONObject = await save(CREATE);

    expect(model["disableSignUpWithSso"]).toBe(true);
    expect(model["restrictToAttachedProjects"]).toBe(true);
    expectNoQuestionKeys(model);
  });
});

describe("editing an instance-wide SAML provider", () => {
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
    disableSignUpWithSso: true,
    restrictToAttachedProjects: true,
  };

  test("opens on the answers its columns hold, and saves the one changed", async () => {
    recordToEdit = { ...STORED };

    await renderProviderForm(FormType.Update);

    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText("Okta") as HTMLInputElement).value,
      ).toBe("Okta");
    });

    await goToSignIn();

    // Something under More fields differs from its default: it says so.
    await openMoreFields();

    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: "Must be invited first" }),
      ).toBeChecked();
    });
    expect(
      screen.getByRole("radio", { name: "Attached projects only" }),
    ).toBeChecked();

    await pick("Get one on their first sign-in");

    const model: JSONObject = await save(SAVE);

    expect(model["disableSignUpWithSso"]).toBe(false);
    expect(model["restrictToAttachedProjects"]).toBe(true);
    expectNoQuestionKeys(model);
  });
});
