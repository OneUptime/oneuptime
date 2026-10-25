import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectSCIMUser from "../../../Models/DatabaseModels/ProjectSCIMUser";
import UserProjectSsoConsent from "../../../Models/DatabaseModels/UserProjectSsoConsent";
import UserProjectSsoIdentity from "../../../Models/DatabaseModels/UserProjectSsoIdentity";
import VercelMarketplaceConnection from "../../../Models/DatabaseModels/VercelMarketplaceConnection";
import VercelMarketplaceInstallation from "../../../Models/DatabaseModels/VercelMarketplaceInstallation";

/*
 * The names, descriptions and column titles of the models SCIM provisioning,
 * project single sign-on and Vercel Marketplace added - the SCIM users a
 * project's connection provisioned, the identities and consents project SSO
 * records, and the Vercel installations and connections - in every language
 * the Dashboard ships.
 *
 * npm run i18n:extract added them to the locale files after the models
 * merged, and every locale held them in English: a German table of SCIM
 * users read "SCIM Users" over "User Name" and "External ID". They are
 * translated now, and this keeps every new title of these models from
 * staying English.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const MODELS: Array<{ name: string; model: BaseModel }> = [
  { name: "ProjectSCIMUser", model: new ProjectSCIMUser() },
  { name: "UserProjectSsoIdentity", model: new UserProjectSsoIdentity() },
  { name: "UserProjectSsoConsent", model: new UserProjectSsoConsent() },
  {
    name: "VercelMarketplaceConnection",
    model: new VercelMarketplaceConnection(),
  },
  {
    name: "VercelMarketplaceInstallation",
    model: new VercelMarketplaceInstallation(),
  },
];

/*
 * Words a language writes as English does, and the one term kept as the
 * identity provider names it: "Object ID" is what Microsoft Entra calls a
 * user's immutable ID, and the docs quote it as Entra writes it.
 */
const SAME_AS_ENGLISH: Record<string, Array<string>> = {
  "Object ID": LANGUAGES,
  Project: ["nl"],
  Status: ["de", "pt", "nl", "da", "no", "sv"],
};

// Every model's own columns (BaseModel): not these models' words.
const BASE_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

type LocaleFile = Record<string, unknown>;

function readLocale(language: string): LocaleFile {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as LocaleFile;
}

// Everything a reader sees of a model: its names, description and titles.
function modelTexts(model: BaseModel): Array<string> {
  const texts: Array<string> = [];

  for (const text of [
    model.singularName,
    model.pluralName,
    model.tableDescription,
  ]) {
    if (text) {
      texts.push(text);
    }
  }

  for (const column of model.getTableColumns().columns) {
    if (BASE_COLUMNS.includes(column)) {
      continue;
    }

    const title: string | undefined =
      model.getTableColumnMetadata(column)?.title;

    if (title) {
      texts.push(title);
    }
  }

  return Array.from(new Set(texts));
}

describe("the SCIM, project SSO and Vercel Marketplace models", () => {
  const english: LocaleFile = readLocale("en");

  test.each(MODELS)("$name's words are keys of en.json", ({ model }) => {
    const texts: Array<string> = modelTexts(model);

    // Names, a description and at least a few column titles.
    expect(texts.length).toBeGreaterThanOrEqual(5);

    for (const text of texts) {
      expect({ text, key: english[text] }).toEqual({ text, key: text });
    }
  });

  test.each(
    MODELS.flatMap(
      (entry: { name: string; model: BaseModel }): Array<[string, string]> => {
        return LANGUAGES.map((language: string): [string, string] => {
          return [entry.name, language];
        });
      },
    ),
  )("%s reads in %s", (name: string, language: string) => {
    const model: BaseModel = MODELS.find(
      (entry: { name: string; model: BaseModel }): boolean => {
        return entry.name === name;
      },
    )!.model;
    const locale: LocaleFile = readLocale(language);
    const englishLeft: Array<string> = [];

    for (const text of modelTexts(model)) {
      const value: unknown = locale[text];

      expect(typeof value).toBe("string");

      if (value === text && !(SAME_AS_ENGLISH[text] || []).includes(language)) {
        englishLeft.push(text);
      }
    }

    expect(englishLeft).toEqual([]);
  });

  test("the words kept as English are still these models' words", () => {
    const all: Array<string> = MODELS.flatMap(
      (entry: { name: string; model: BaseModel }): Array<string> => {
        return modelTexts(entry.model);
      },
    );

    for (const word of Object.keys(SAME_AS_ENGLISH)) {
      expect({ word, shown: all.includes(word) }).toEqual({
        word,
        shown: true,
      });
    }
  });

  test("German reads the SCIM users table in German", () => {
    const german: LocaleFile = readLocale("de");

    expect(german["SCIM Users"]).toBe("SCIM-Benutzer");
    expect(german["User Name"]).toBe("Benutzername");
    expect(german["External ID"]).toBe("Externe ID");
    expect(german["Vercel Marketplace Installations"]).toBe(
      "Vercel-Marketplace-Installationen",
    );
  });
});
