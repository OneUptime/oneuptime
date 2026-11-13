import "@testing-library/jest-dom";
import {
  afterAll,
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
  within,
} from "@testing-library/react";
import React from "react";

/*
 * THE ADMIN DASHBOARD'S OIDC PROVIDER FORM DRAWS THE CLAIM NAMES AS THEY
 * ARE NAMED, IN THE READER'S LANGUAGE (#7625).
 *
 * Settings > Single Sign-On: an instance-wide OIDC provider's empty scopes
 * or claim name field stands for its usual value, which its placeholder
 * shows - "openid email profile", "email", "name", the names the identity
 * provider sends the claims under. The Dashboard's locales word "email"
 * and "name" (German "E-Mail" and "Name", Persian "ایمیل"), and its forms
 * drew them so. The Admin Dashboard's locales have neither word today, so
 * its forms drew them as written by chance; the words are added here as
 * the Dashboard words them, as one shared Common/UI locale would bring
 * them (#7626), and the placeholders still read as the claims are named.
 *
 * The form as both Admin pages build it (OidcProviderFormFields with the
 * instance-wide questions), through the real ModelForm and the Admin
 * Dashboard's own i18next (src/Utils/i18n.ts, its 18 locale files),
 * editing an older provider that holds none of the three. Only the network
 * is a stand-in.
 */

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
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

// The Admin Dashboard's reader: a master admin, with no project permissions.
jest.mock("../../../UI/Utils/User", () => {
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

import AdminI18n from "../../../../App/FeatureSet/AdminDashboard/src/Utils/i18n";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import GlobalOIDC from "../../../Models/DatabaseModels/GlobalOidc";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DEFAULT_OIDC_EMAIL_CLAIM_NAME,
  DEFAULT_OIDC_NAME_CLAIM_NAME,
  DEFAULT_OIDC_SCOPES,
} from "../../../Types/SSO/OidcProviderDefaults";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import { FORM_NEXT_BUTTON_TEST_ID } from "../../../UI/Components/Forms/Utils/SteppedFormFooter";
import { getOidcProviderFormFields } from "../../../UI/Components/Sso/OidcProviderFormFields";
import { getSsoProviderFormSteps } from "../../../UI/Components/Sso/SsoProviderFormFields";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const LANGUAGES: Array<string> = ["de", "fa"];

const PROVIDER_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000d7",
);

// An older instance-wide provider: its scopes and claim names were never set.
const STORED: JSONObject = {
  _id: PROVIDER_ID.toString(),
  name: "Acme Identity",
  description: "For Acme staff",
  issuerURL: "https://login.acme.example",
  clientId: "oneuptime-admin",
  clientSecret: "oidc-client-secret",
  isEnabled: true,
  discoveryURL: "https://login.acme.example/.well-known/openid-configuration",
  scopes: null,
  emailClaimName: null,
  nameClaimName: null,
  disableSignUpWithSso: false,
  restrictToAttachedProjects: false,
};

// Each field's title, and what its placeholder reads in every language.
const AS_NAMED: Array<{ title: string; placeholder: string }> = [
  { title: "Scopes", placeholder: DEFAULT_OIDC_SCOPES },
  { title: "Email Claim Name", placeholder: DEFAULT_OIDC_EMAIL_CLAIM_NAME },
  { title: "Name Claim Name", placeholder: DEFAULT_OIDC_NAME_CLAIM_NAME },
];

// A word as a shared component looks it up (UI/Utils/Translation).
function sharedWord(text: string): string {
  return AdminI18n.t(text, {
    defaultValue: text,
    keySeparator: false,
    nsSeparator: false,
  });
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// The Admin Dashboard's i18next, in a language, as its language menu sets it.
async function readIn(code: string): Promise<void> {
  await act(async () => {
    await AdminI18n.changeLanguage(code);
  });

  expect(AdminI18n.resolvedLanguage).toBe(code);
}

/*
 * The provider's edit form on its Sign-in step, with More fields open,
 * where the scopes and claim names are.
 */
async function openSignIn(): Promise<HTMLElement> {
  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<never> => {
      return { ...STORED } as never;
    });

  const view: ReturnType<typeof render> = render(
    <ModelForm<GlobalOIDC>
      modelType={GlobalOIDC}
      modelAPI={AdminModelAPI}
      id="global-oidc-form"
      name="Settings > Global OIDC"
      fields={getOidcProviderFormFields<GlobalOIDC>({
        withGlobalAccessSwitches: true,
      })}
      steps={getSsoProviderFormSteps<GlobalOIDC>()}
      formType={FormType.Update}
      modelIdToEdit={PROVIDER_ID}
      onSuccess={(): void => {
        // Not saved here.
      }}
      submitButtonText={sharedWord("Save Changes")}
      disableAutofocus={true}
    />,
  );

  await within(view.container).findByDisplayValue(
    "https://login.acme.example",
    undefined,
    { timeout: 30000 },
  );
  await settle();

  await act(async () => {
    fireEvent.click(screen.getByTestId(FORM_NEXT_BUTTON_TEST_ID));
  });
  await settle();

  const moreFields: HTMLElement = within(view.container).getByRole("button", {
    name: new RegExp(escaped(sharedWord("More fields"))),
  });

  if (moreFields.getAttribute("aria-expanded") !== "true") {
    await act(async () => {
      fireEvent.click(moreFields);
    });
    await settle();
  }

  return view.container;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await AdminI18n.changeLanguage("en");
});

describe.each(LANGUAGES)(
  "an instance-wide OIDC provider form in %s",
  (language: string) => {
    test("draws the scopes and claim names as the identity provider names them", async () => {
      await readIn(language);

      /*
       * The Dashboard's words for them, where the Admin Dashboard has none
       * of its own.
       */
      const dashboard: Record<string, string> = readDashboardLocale(language);

      for (const field of AS_NAMED) {
        const worded: string | undefined = dashboard[field.placeholder];

        if (
          worded &&
          worded !== field.placeholder &&
          sharedWord(field.placeholder) === field.placeholder
        ) {
          // A word of its own, with no "." for a key separator to split.
          AdminI18n.addResource(
            language,
            "translation",
            field.placeholder,
            worded,
          );
        }
      }

      // "email" is a word in both languages, as the Dashboard words it.
      expect(sharedWord(DEFAULT_OIDC_EMAIL_CLAIM_NAME)).not.toBe(
        DEFAULT_OIDC_EMAIL_CLAIM_NAME,
      );

      const form: HTMLElement = await openSignIn();

      for (const field of AS_NAMED) {
        // Found by its title, in the reader's language.
        const title: string = sharedWord(field.title);

        expect(title).not.toBe(field.title);

        const input: HTMLInputElement = within(form).getByRole("textbox", {
          name: new RegExp(`^${escaped(title)}`),
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
