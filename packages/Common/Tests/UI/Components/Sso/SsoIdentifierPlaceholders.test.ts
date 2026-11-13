import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOIDC from "../../../../Models/DatabaseModels/GlobalOidc";
import GlobalSSO from "../../../../Models/DatabaseModels/GlobalSso";
import ProjectOIDC from "../../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../../Models/DatabaseModels/ProjectSso";
import StatusPageOIDC from "../../../../Models/DatabaseModels/StatusPageOidc";
import StatusPageSSO from "../../../../Models/DatabaseModels/StatusPageSso";
import GenericObject from "../../../../Types/GenericObject";
import {
  DEFAULT_OIDC_EMAIL_CLAIM_NAME,
  DEFAULT_OIDC_NAME_CLAIM_NAME,
  DEFAULT_OIDC_SCOPES,
} from "../../../../Types/SSO/OidcProviderDefaults";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { getOidcProviderFormFields } from "../../../../UI/Components/Sso/OidcProviderFormFields";
import { getSamlProviderFormFields } from "../../../../UI/Components/Sso/SamlProviderFormFields";
import {
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "../../../Helpers/TranslatedLanguages";

/*
 * AN SSO PROVIDER'S IDENTIFIERS READ AS WRITTEN, IN EVERY LANGUAGE (#7625).
 *
 * An OIDC provider's scopes and claim names start at their usual values,
 * and an empty one stands for its usual value, which its field's
 * placeholder shows: "openid email profile", "email", "name" - the claims'
 * names as the identity provider sends them (OpenID Connect's standard
 * claims), and the models' examples for the API. They are not words, but
 * "email" and "name" are words of the interface too, and a form looks a
 * placeholder up in the reader's language: German read the email claim's
 * as "E-Mail", and an admin who typed what it showed broke sign-in. A
 * field whose placeholder is an identifier says so (isPlaceholderIdentifier)
 * and it is drawn as written.
 *
 * Every placeholder the six SSO forms draw that is its model's own example
 * for the column - an identifier the API documents - is held here: either
 * drawn as written, or not a word any language of the Dashboard or the
 * Admin Dashboard words otherwise, so it reads as written anyway. A SAML
 * provider's signature and digest methods ("RSA-SHA256", "SHA256") are the
 * second kind: no language words them, and a translation one gained would
 * fail here, as a dropdown's placeholder is looked up (and is never shown
 * while the field holds its default, which it starts on).
 */

const PACKAGES: string = path.resolve(__dirname, "../../../../..");

const LOCALE_FOLDERS: ReadonlyArray<{
  app: string;
  folder: string;
  languages: ReadonlyArray<string>;
}> = [
  {
    app: "Dashboard",
    folder: path.join(PACKAGES, "App/FeatureSet/Dashboard/src/Locales"),
    languages: DASHBOARD_LANGUAGES,
  },
  {
    app: "Admin Dashboard",
    folder: path.join(PACKAGES, "App/FeatureSet/AdminDashboard/src/Locales"),
    languages: ADMIN_DASHBOARD_LANGUAGES,
  },
];

type Locale = Record<string, unknown>;

const LOCALES: Array<{ name: string; words: Locale }> = LOCALE_FOLDERS.flatMap(
  (locales: {
    app: string;
    folder: string;
    languages: ReadonlyArray<string>;
  }): Array<{ name: string; words: Locale }> => {
    return locales.languages.map((code: string) => {
      return {
        name: `${locales.app} ${code}`,
        words: JSON.parse(
          fs.readFileSync(path.join(locales.folder, `${code}.json`), "utf8"),
        ) as Locale,
      };
    });
  },
);

// The languages that word `text` otherwise than as written: "Dashboard de".
function wordedOtherwiseIn(text: string): Array<string> {
  return LOCALES.filter((locale: { name: string; words: Locale }): boolean => {
    const worded: unknown = locale.words[text];

    return (
      typeof worded === "string" && worded.trim() !== "" && worded !== text
    );
  }).map((locale: { name: string; words: Locale }): string => {
    return locale.name;
  });
}

type AnyField = Field<GenericObject>;

interface ProviderForm {
  name: string;
  model: DatabaseBaseModel;
  fields: Array<AnyField>;
  // The fields whose placeholder is the model's example for the column.
  identifiers: Array<string>;
}

const OIDC_IDENTIFIERS: Array<string> = [
  "scopes",
  "emailClaimName",
  "nameClaimName",
];

const SAML_IDENTIFIERS: Array<string> = ["signatureMethod", "digestMethod"];

// The six forms, as their pages build them.
const FORMS: Array<ProviderForm> = [
  {
    name: "a project's OIDC provider (Dashboard)",
    model: new ProjectOIDC(),
    fields: getOidcProviderFormFields<GenericObject>({ withTeams: true }),
    identifiers: OIDC_IDENTIFIERS,
  },
  {
    name: "a status page's OIDC provider (Dashboard)",
    model: new StatusPageOIDC(),
    fields: getOidcProviderFormFields<GenericObject>(),
    identifiers: OIDC_IDENTIFIERS,
  },
  {
    name: "an instance-wide OIDC provider (Admin Dashboard)",
    model: new GlobalOIDC(),
    fields: getOidcProviderFormFields<GenericObject>({
      withGlobalAccessSwitches: true,
    }),
    identifiers: OIDC_IDENTIFIERS,
  },
  {
    name: "a project's SAML provider (Dashboard)",
    model: new ProjectSSO(),
    fields: getSamlProviderFormFields<GenericObject>({ withTeams: true }),
    identifiers: SAML_IDENTIFIERS,
  },
  {
    name: "a status page's SAML provider (Dashboard)",
    model: new StatusPageSSO(),
    fields: getSamlProviderFormFields<GenericObject>(),
    identifiers: SAML_IDENTIFIERS,
  },
  {
    name: "an instance-wide SAML provider (Admin Dashboard)",
    model: new GlobalSSO(),
    fields: getSamlProviderFormFields<GenericObject>({
      withGlobalAccessSwitches: true,
    }),
    identifiers: SAML_IDENTIFIERS,
  },
];

function columnOf(field: AnyField): string {
  return Object.keys(field.field || {})[0] || "";
}

function exampleOf(model: DatabaseBaseModel, column: string): unknown {
  return model.hasColumn(column)
    ? model.getTableColumnMetadata(column)?.example
    : undefined;
}

// The fields whose placeholder is what the model gives as the column's example.
function placeholdersThatAreExamples(form: ProviderForm): Array<AnyField> {
  return form.fields.filter((field: AnyField): boolean => {
    return (
      typeof field.placeholder === "string" &&
      field.placeholder === exampleOf(form.model, columnOf(field))
    );
  });
}

describe("an OIDC provider's scopes and claim names", () => {
  test("are interface words too, which German words otherwise", () => {
    expect(wordedOtherwiseIn(DEFAULT_OIDC_EMAIL_CLAIM_NAME)).toContain(
      "Dashboard de",
    );
    expect(wordedOtherwiseIn(DEFAULT_OIDC_NAME_CLAIM_NAME)).toContain(
      "Dashboard de",
    );
  });

  test.each(
    FORMS.filter((form: ProviderForm): boolean => {
      return form.identifiers === OIDC_IDENTIFIERS;
    }),
  )("$name shows their usual values, as written", (form: ProviderForm) => {
    const usual: Record<string, string> = {
      scopes: DEFAULT_OIDC_SCOPES,
      emailClaimName: DEFAULT_OIDC_EMAIL_CLAIM_NAME,
      nameClaimName: DEFAULT_OIDC_NAME_CLAIM_NAME,
    };

    for (const column of OIDC_IDENTIFIERS) {
      const field: AnyField | undefined = form.fields.find(
        (candidate: AnyField): boolean => {
          return columnOf(candidate) === column;
        },
      );

      // A Text field: Input draws it, and Input honours the flag too.
      expect({
        column,
        placeholder: field?.placeholder,
        isPlaceholderIdentifier: field?.isPlaceholderIdentifier,
        fieldType: field?.fieldType,
        example: exampleOf(form.model, column),
      }).toEqual({
        column,
        placeholder: usual[column],
        isPlaceholderIdentifier: true,
        fieldType: FormFieldSchemaType.Text,
        example: usual[column],
      });
    }
  });
});

describe.each(FORMS)("$name", (form: ProviderForm) => {
  test("shows the model's examples as placeholders on its identifier fields", () => {
    expect(placeholdersThatAreExamples(form).map(columnOf).sort()).toEqual(
      [...form.identifiers].sort(),
    );
  });

  test("draws each of them as written in every language", () => {
    const lookedUpAndWorded: Array<{
      column: string;
      placeholder: string | undefined;
      wordedOtherwiseIn: Array<string>;
    }> = [];

    for (const field of placeholdersThatAreExamples(form)) {
      if (field.isPlaceholderIdentifier) {
        // The flag reaches Input, which draws a Text field.
        expect(field.fieldType).toBe(FormFieldSchemaType.Text);
        continue;
      }

      const languages: Array<string> = wordedOtherwiseIn(field.placeholder!);

      if (languages.length > 0) {
        lookedUpAndWorded.push({
          column: columnOf(field),
          placeholder: field.placeholder,
          wordedOtherwiseIn: languages,
        });
      }
    }

    expect(lookedUpAndWorded).toEqual([]);
  });
});
