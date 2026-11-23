import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import SamlSignInAgainNote, {
  SAML_SIGN_IN_AGAIN_LEARN_MORE,
  SAML_SIGN_IN_AGAIN_NOTE_TEST_ID,
  SAML_SIGN_IN_AGAIN_NOTES,
  SAML_SIGN_IN_AGAIN_SELECT,
  SIGN_IN_AGAIN_DOCS_ROUTE,
  SamlProviderNameCell,
  getSamlProviderNameColumn,
} from "../../../../UI/Components/Sso/SamlSignInAgainNote";
import { drawsItsOwnLines } from "../../../../UI/Components/Table/ColumnLineText";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Column from "../../../../UI/Components/ModelTable/Column";
import GlobalSSO from "../../../../Models/DatabaseModels/GlobalSso";
import ProjectSSO from "../../../../Models/DatabaseModels/ProjectSso";
import URL from "../../../../Types/API/URL";
import { SamlSignInAgainAdvice } from "../../../../Types/SSO/SamlSignInAgainAdvice";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import {
  ADMIN_DASHBOARD_CODES,
  readAdminDashboardLocale,
} from "../../../Helpers/AdminDashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";

/*
 * BESIDE A SAML PROVIDER: WHAT SIGN IN AGAIN NEEDS OF IT (#10530).
 *
 * One short line under a Keycloak or an Okta provider - in its row on
 * Settings > SSO, in the Dashboard and the Admin Dashboard, and under a
 * server provider's issuer - with Learn more opening the docs' table of
 * what each identity provider takes. Nothing for any other provider.
 * Rendered here as both apps draw it, in their own locale files: English,
 * German, Persian and Arabic.
 */

const KEYCLOAK_SENTENCE: string =
  "Sign In Again can't be checked through Keycloak over SAML. Add this realm as an OIDC provider instead.";
const OKTA_SENTENCE: string =
  "For Sign In Again, set Honor Force Authentication to Yes in this app's SAML settings in Okta.";

const KEYCLOAK_PROVIDER: { issuerURL: string; signOnURL: string } = {
  issuerURL: "https://keycloak.example.com/realms/acme",
  signOnURL: "https://keycloak.example.com/realms/acme/protocol/saml",
};

const OKTA_PROVIDER: { issuerURL: string; signOnURL: string } = {
  issuerURL: "http://www.okta.com/exk1a2b3c4D5E6F7g8h9",
  signOnURL:
    "https://acme.okta.com/app/acme_oneuptime_1/exk1a2b3c4D5E6F7g8h9/sso/saml",
};

const ENTRA_PROVIDER: { issuerURL: string; signOnURL: string } = {
  issuerURL: "https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/",
  signOnURL:
    "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/saml2",
};

const ADMIN_LANGUAGES: Array<string> = ADMIN_DASHBOARD_CODES.filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

function adminWords(language: string): Record<string, string> {
  return readAdminDashboardLocale(language) as unknown as Record<
    string,
    string
  >;
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

function note(): HTMLElement {
  return screen.getByTestId(SAML_SIGN_IN_AGAIN_NOTE_TEST_ID);
}

function noteText(): string {
  return withoutIsolateMarks(note().textContent || "").trim();
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: readDashboardLocale("de") },
      fa: { translation: readDashboardLocale("fa") },
      ar: { translation: readDashboardLocale("ar") },
      adminde: { translation: adminWords("de") },
      adminfa: { translation: adminWords("fa") },
      adminar: { translation: adminWords("ar") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  await i18next.changeLanguage("en");
});

describe("beside a Keycloak provider over SAML", () => {
  test("says Sign In Again cannot be checked through it, and to add the realm as an OIDC provider", () => {
    render(<SamlSignInAgainNote {...KEYCLOAK_PROVIDER} />);

    expect(note()).toHaveAttribute("role", "note");
    expect(note()).toHaveAttribute(
      "data-advice",
      SamlSignInAgainAdvice.KeycloakCannotBeChecked,
    );
    expect(noteText()).toBe(`${KEYCLOAK_SENTENCE} Learn more`);
  });

  test("Learn more opens the docs' table of what each identity provider takes, in a new tab", () => {
    render(<SamlSignInAgainNote {...KEYCLOAK_PROVIDER} />);

    const link: HTMLElement = within(note()).getByRole("link", {
      name: "Learn more",
    });

    expect(link).toHaveAttribute(
      "href",
      "/docs/identity/sso#signing-in-again-to-confirm-its-you",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(SIGN_IN_AGAIN_DOCS_ROUTE.toString()).toBe(
      "/docs/identity/sso#signing-in-again-to-confirm-its-you",
    );
  });

  test("is a notice, in amber, never an error", () => {
    render(<SamlSignInAgainNote {...KEYCLOAK_PROVIDER} />);

    expect(note().className).toContain("text-amber-700");
    expect(note().className).not.toMatch(/\b(?:text|bg|border)-red-/);
    expect(note()).not.toHaveAttribute("role", "alert");
  });

  test("is said from the sign-on URL alone, and from a URL as the page holds it", () => {
    render(
      <SamlSignInAgainNote
        issuerURL="urn:acme:idp"
        signOnURL={URL.fromString(KEYCLOAK_PROVIDER.signOnURL)}
      />,
    );

    expect(noteText()).toBe(`${KEYCLOAK_SENTENCE} Learn more`);
  });
});

describe("beside an Okta provider", () => {
  test("says to set Honor Force Authentication to Yes, as Okta's console names it", () => {
    render(<SamlSignInAgainNote {...OKTA_PROVIDER} />);

    expect(note()).toHaveAttribute(
      "data-advice",
      SamlSignInAgainAdvice.TurnOnOktaHonorForceAuthentication,
    );
    expect(noteText()).toBe(`${OKTA_SENTENCE} Learn more`);
  });
});

describe("beside any other provider", () => {
  test("says nothing", () => {
    for (const provider of [
      ENTRA_PROVIDER,
      { issuerURL: "", signOnURL: "" },
      {},
    ]) {
      const { container } = render(<SamlSignInAgainNote {...provider} />);

      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
  });
});

describe("in the reader's language", () => {
  test.each([
    ["de", "de"],
    ["fa", "fa"],
    ["ar", "ar"],
    ["adminde", "de"],
    ["adminfa", "fa"],
    ["adminar", "ar"],
  ])(
    "%s reads both notes and Learn more in its own words",
    async (language: string, code: string) => {
      const words: Record<string, string> = language.startsWith("admin")
        ? adminWords(code)
        : readDashboardLocale(code);

      await inLanguage(language);

      for (const [provider, sentence] of [
        [KEYCLOAK_PROVIDER, KEYCLOAK_SENTENCE],
        [OKTA_PROVIDER, OKTA_SENTENCE],
      ] as Array<[typeof KEYCLOAK_PROVIDER, string]>) {
        render(<SamlSignInAgainNote {...provider} />);

        expect(noteText()).toBe(
          `${words[sentence]} ${words[SAML_SIGN_IN_AGAIN_LEARN_MORE]}`,
        );
        expect(noteText()).not.toContain(sentence);
        cleanup();
      }
    },
  );

  test("every Dashboard and Admin Dashboard language words both notes, keeping Okta's and Keycloak's own names", () => {
    const sentences: Array<string> = Object.values(SAML_SIGN_IN_AGAIN_NOTES);

    for (const [app, languages, read] of [
      ["Dashboard", DASHBOARD_LANGUAGES, readDashboardLocale],
      ["Admin Dashboard", ADMIN_LANGUAGES, adminWords],
    ] as Array<
      [string, ReadonlyArray<string>, (code: string) => Record<string, string>]
    >) {
      for (const language of languages) {
        const words: Record<string, string> = read(language);

        for (const sentence of sentences) {
          const worded: string = words[sentence] || "";

          expect({ app, language, sentence, worded: worded !== "" }).toEqual({
            app,
            language,
            sentence,
            worded: true,
          });
          expect({ app, language, english: worded === sentence }).toEqual({
            app,
            language,
            english: false,
          });

          for (const name of ["SAML", "OIDC", "Keycloak", "Okta"]) {
            if (sentence.includes(name)) {
              expect({
                app,
                language,
                name,
                kept: worded.includes(name),
              }).toEqual({ app, language, name, kept: true });
            }
          }
        }

        // Okta's console labels stay as Okta's console names them.
        const okta: string =
          words[
            SAML_SIGN_IN_AGAIN_NOTES[
              SamlSignInAgainAdvice.TurnOnOktaHonorForceAuthentication
            ]
          ] || "";

        expect({
          app,
          language,
          label:
            okta.includes("Honor Force Authentication") && okta.includes("Yes"),
        }).toEqual({
          app,
          language,
          label: true,
        });
      }
    }
  });

  test("both apps word each note alike", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const sentence of Object.values(SAML_SIGN_IN_AGAIN_NOTES)) {
        expect({
          language,
          sentence,
          admin: adminWords(language)[sentence],
        }).toEqual({
          language,
          sentence,
          admin: readDashboardLocale(language)[sentence],
        });
      }
    }
  });
});

describe("in a SAML providers' table", () => {
  test("the Name column draws the name as it was written, with the note under it", () => {
    render(
      <SamlProviderNameCell name="Keycloak (Acme)" {...KEYCLOAK_PROVIDER} />,
    );

    expect(
      withoutIsolateMarks(
        screen.getByTestId("saml-provider-name").textContent || "",
      ),
    ).toBe("Keycloak (Acme)");
    expect(noteText()).toBe(`${KEYCLOAK_SENTENCE} Learn more`);
  });

  test("a provider that needs nothing said shows its name alone", () => {
    render(
      <SamlProviderNameCell name="Contoso Entra ID" {...ENTRA_PROVIDER} />,
    );

    expect(
      withoutIsolateMarks(
        screen.getByTestId("saml-provider-name").textContent || "",
      ),
    ).toBe("Contoso Entra ID");
    expect(
      screen.queryByTestId(SAML_SIGN_IN_AGAIN_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("the column is the provider's name, wraps so the note is read whole, and draws its own lines", () => {
    for (const column of [
      getSamlProviderNameColumn<ProjectSSO>(),
      getSamlProviderNameColumn<GlobalSSO>(),
    ] as Array<Column<ProjectSSO> | Column<GlobalSSO>>) {
      expect(column.field).toEqual({ name: true });
      expect(column.title).toBe("Name");
      expect(column.type).toBe(FieldType.Element);
      expect(column.wrapContent).toBe(true);
      expect(column.getLineText).toBe(drawsItsOwnLines);
    }
  });

  test("the column draws a row's name and note, and exports the name", () => {
    const provider: ProjectSSO = new ProjectSSO();
    provider.name = "Keycloak (Acme)";
    provider.issuerURL = KEYCLOAK_PROVIDER.issuerURL;
    provider.signOnURL = URL.fromString(KEYCLOAK_PROVIDER.signOnURL);

    const column: Column<ProjectSSO> = getSamlProviderNameColumn<ProjectSSO>();

    expect(column.getExportValue?.(provider)).toBe("Keycloak (Acme)");

    render(column.getElement!(provider));

    expect(
      withoutIsolateMarks(
        screen.getByTestId("saml-provider-name").textContent || "",
      ),
    ).toBe("Keycloak (Acme)");
    expect(noteText()).toBe(`${KEYCLOAK_SENTENCE} Learn more`);
  });

  test("the table reads the issuer and the sign-on URL the note is read from", () => {
    expect(SAML_SIGN_IN_AGAIN_SELECT).toEqual({
      issuerURL: true,
      signOnURL: true,
    });
  });
});
