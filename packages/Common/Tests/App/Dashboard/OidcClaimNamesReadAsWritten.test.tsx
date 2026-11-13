import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * A PROJECT'S OIDC PROVIDER FORM DRAWS THE CLAIM NAMES AS THEY ARE NAMED,
 * IN THE READER'S LANGUAGE (#7625).
 *
 * Settings > Single Sign-On > OpenID Connect: an empty scopes or claim name
 * field stands for its usual value, which its placeholder shows -
 * "openid email profile", "email", "name", the names the identity provider
 * sends the claims under. "email" and "name" are words of the Dashboard
 * too, and the form looked the placeholders up: German read "E-Mail" and
 * "Name", Persian "ایمیل", and an admin who typed what the placeholder
 * showed broke sign-in.
 *
 * The form as the page builds it (OidcProviderFormFields with the
 * project's teams), through the real ModelForm, with the Dashboard's own
 * locale files, editing an older provider that holds none of the three:
 * every field around them reads in German or Persian, and the three
 * placeholders read as written. Only the network is a stand-in.
 */

const MEMBERS_TEAM_ID: string = "00000000-0000-4000-8000-0000000000a1";
const PROVIDER_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000b7",
);

// An older provider: its scopes and claim names were never set.
const STORED: JSONObject = {
  _id: PROVIDER_ID.toString(),
  name: "Okta",
  description: "Sign in with Okta",
  issuerURL: "https://dev-123456.okta.com/oauth2/default",
  discoveryURL:
    "https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration",
  clientId: "0oa1b2c3d4e5f6g7h8i9",
  clientSecret: "a-client-secret",
  scopes: null,
  emailClaimName: null,
  nameClaimName: null,
  isEnabled: true,
  teams: [{ _id: MEMBERS_TEAM_ID, name: "Members" }],
};

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  const teamModule: { default: { new (): Record<string, unknown> } } =
    jest.requireActual("../../../Models/DatabaseModels/Team") as {
      default: { new (): Record<string, unknown> };
    };

  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<JSONObject> => {
        return { ...STORED };
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
          const team: Record<string, unknown> = new teamModule.default();
          team["_id"] = MEMBERS_TEAM_ID;
          team["name"] = "Members";

          return { data: [team], count: 1, skip: 0, limit: 10 };
        }

        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import {
  DEFAULT_OIDC_EMAIL_CLAIM_NAME,
  DEFAULT_OIDC_NAME_CLAIM_NAME,
  DEFAULT_OIDC_SCOPES,
} from "../../../Types/SSO/OidcProviderDefaults";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import { FORM_NEXT_BUTTON_TEST_ID } from "../../../UI/Components/Forms/Utils/SteppedFormFooter";
import { getOidcProviderFormFields } from "../../../UI/Components/Sso/OidcProviderFormFields";
import { getSsoProviderFormSteps } from "../../../UI/Components/Sso/SsoProviderFormFields";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import escapeRegExp from "../../../Utils/RegExpEscape";

const LANGUAGES: Array<string> = ["de", "fa"];

// Each field's title, and what its placeholder reads in every language.
const AS_NAMED: Array<{ title: string; placeholder: string }> = [
  { title: "Scopes", placeholder: DEFAULT_OIDC_SCOPES },
  { title: "Email Claim Name", placeholder: DEFAULT_OIDC_EMAIL_CLAIM_NAME },
  { title: "Name Claim Name", placeholder: DEFAULT_OIDC_NAME_CLAIM_NAME },
];

// A word as a shared component looks it up (UI/Utils/Translation).
function word(text: string): string {
  return i18next.t(text, {
    defaultValue: text,
    keySeparator: false,
    nsSeparator: false,
  });
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/*
 * The provider's edit form on its Sign-in step, with More fields open,
 * where the scopes and claim names are.
 */
async function openSignIn(): Promise<HTMLElement> {
  const view: ReturnType<typeof render> = render(
    <ModelForm<ProjectOIDC>
      modelType={ProjectOIDC}
      id="oidc-provider-form"
      name="Settings > Project OIDC"
      fields={getOidcProviderFormFields<ProjectOIDC>({ withTeams: true })}
      steps={getSsoProviderFormSteps<ProjectOIDC>()}
      formType={FormType.Update}
      modelIdToEdit={PROVIDER_ID}
      onSuccess={(): void => {
        // Not saved here.
      }}
      submitButtonText={word("Save Changes")}
      disableAutofocus={true}
    />,
  );

  await within(view.container).findByDisplayValue("Okta");
  await settle();

  await act(async () => {
    fireEvent.click(screen.getByTestId(FORM_NEXT_BUTTON_TEST_ID));
  });
  await settle();

  const moreFields: HTMLElement = within(view.container).getByRole("button", {
    name: new RegExp(escapeRegExp(word("More fields"))),
  });

  if (moreFields.getAttribute("aria-expanded") !== "true") {
    await act(async () => {
      fireEvent.click(moreFields);
    });
    await settle();
  }

  return view.container;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readDashboardLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe.each(LANGUAGES)(
  "a project's OIDC provider form in %s",
  (language: string) => {
    test("draws the scopes and claim names as the identity provider names them", async () => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      // The words the placeholders are not: "email" is the Dashboard's word for e-mail.
      expect(word(DEFAULT_OIDC_EMAIL_CLAIM_NAME)).not.toBe(
        DEFAULT_OIDC_EMAIL_CLAIM_NAME,
      );

      const form: HTMLElement = await openSignIn();

      for (const field of AS_NAMED) {
        // Found by its title, in the reader's language.
        const title: string = word(field.title);

        expect(title).not.toBe(field.title);

        const input: HTMLInputElement = within(form).getByRole("textbox", {
          name: new RegExp(`^${escapeRegExp(title)}`),
        }) as HTMLInputElement;

        expect({
          title: field.title,
          value: input.value,
          placeholder: input.placeholder,
        }).toEqual({
          title: field.title,
          value: "",
          placeholder: field.placeholder,
        });
      }
    });
  },
);
