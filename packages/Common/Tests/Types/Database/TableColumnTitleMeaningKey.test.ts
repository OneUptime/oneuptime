import { describe, expect, test } from "@jest/globals";
import DataAssetOwnerTeam from "../../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "../../../Models/DatabaseModels/DataAssetOwnerUser";
import DataIssueReport from "../../../Models/DatabaseModels/DataIssueReport";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CreatePermission from "../../../Server/Types/Database/Permissions/CreatePermission";
import {
  getColumnTitleKey,
  TableColumnMetadata,
  withTitleAsItsWord,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { MEANING_KEYS } from "../../../Types/MeaningKeys";
import { translatableTerm, Translator } from "../../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A MODEL COLUMN TITLED WITH A KEY THAT NAMES ITS MEANING (#8344).
 *
 * A table's owning team and user, and a report that a table's data looks
 * wrong, titled their column of the table with the bare "Table": the key
 * of a table on the page, which French words "Tableau" and Chinese 表格,
 * wherever the Dashboard draws a model's own column titles - a form's
 * permission error, a reset dialog, Select items by.
 *
 * They are declared "Table (database object)" now. A column's title is
 * also what the API reference, the OpenAPI spec, the Terraform provider and
 * the server's messages name it, as written, so the decorator calls it by
 * its word, "Table", and keeps the key for the front ends to look it up by
 * (titleKey, getColumnTitleKey).
 */

const DATABASE_TABLE: string = "Table (database object)";

const MODELS: ReadonlyArray<{ new (): BaseModel }> = [
  DataAssetOwnerTeam,
  DataAssetOwnerUser,
  DataIssueReport,
];

describe("the three columns of a database's table", () => {
  test.each(MODELS)(
    "%p calls its table column Table, and looks it up as a database's table",
    (modelType: { new (): BaseModel }) => {
      const column: TableColumnMetadata =
        new modelType().getTableColumnMetadata("dataAsset");

      expect(column.title).toBe("Table");
      expect(column.titleKey).toBe(DATABASE_TABLE);
      expect(getColumnTitleKey(column)).toBe(DATABASE_TABLE);
      expect(column.type).toBe(TableColumnType.Entity);
    },
  );

  test.each(MODELS)(
    "%p's other columns are called as declared, with no key of their own",
    (modelType: { new (): BaseModel }) => {
      const column: TableColumnMetadata =
        new modelType().getTableColumnMetadata("dataAssetId");

      expect(column.title).toBe("Table ID");
      expect(column.titleKey).toBeUndefined();
      expect(getColumnTitleKey(column)).toBe("Table ID");
    },
  );

  test("no column of these models is called by a key that names its meaning: the API names its word", () => {
    for (const modelType of MODELS) {
      const model: BaseModel = new modelType();

      for (const name of model.getTableColumns().columns) {
        const title: string | undefined =
          model.getTableColumnMetadata(name).title;

        expect({ name, isKey: MEANING_KEYS.includes(title || "") }).toEqual({
          name,
          isKey: false,
        });
      }
    }
  });

  test("the server's create check names the parent Table, as its messages always did", () => {
    for (const modelType of [DataAssetOwnerTeam, DataAssetOwnerUser]) {
      expect(CreatePermission.getCreateParent(modelType)?.title).toBe("Table");
    }
  });

  test("a front end reads the key as the reader's word: French Table, Chinese 表, never Tableau or 表格", () => {
    const column: TableColumnMetadata =
      new DataAssetOwnerTeam().getTableColumnMetadata("dataAsset");

    const expected: Record<string, string> = {
      en: "Table",
      fr: "Table",
      "zh-CN": "表",
      "zh-TW": "資料表",
      de: "Tabelle",
      ar: "جدول",
      fa: "جدول",
    };

    for (const [language, word] of Object.entries(expected)) {
      const translator: Translator = dashboardTranslator(language);

      expect({
        language,
        drawn: translator.translateText(getColumnTitleKey(column)),
      }).toEqual({ language, drawn: word });
    }

    // What the bare title read: a table on the page.
    expect(readDashboardLocale("fr")["Table"]).toBe("Tableau");
    expect(readDashboardLocale("zh-CN")["Table"]).toBe("表格");
  });

  test("a form's permission error names it in a French sentence as a database's table", () => {
    const column: TableColumnMetadata =
      new DataIssueReport().getTableColumnMetadata("dataAsset");
    const french: Translator = dashboardTranslator("fr");
    const english: Translator = dashboardTranslator("en");
    const template: string =
      "You don't have enough permissions to create {{columnName}} on {{itemName}}. You need one of the following permissions: {{permissions}}.";

    const inFrench: string = french.translateTemplate(template, {
      columnName: translatableTerm(getColumnTitleKey(column) || ""),
      itemName: translatableTerm("Data Issue Report"),
      permissions: "ProjectOwner",
    });

    expect(inFrench).not.toContain("Tableau");
    expect(inFrench).not.toContain(DATABASE_TABLE);
    expect(
      english.translateTemplate(template, {
        columnName: translatableTerm(getColumnTitleKey(column) || ""),
        itemName: translatableTerm("Data Issue Report"),
        permissions: "ProjectOwner",
      }),
    ).toContain("create Table on");
  });
});

describe("withTitleAsItsWord", () => {
  test("calls a column declared with a listed key by its word, keeping the key", () => {
    for (const key of MEANING_KEYS) {
      const declared: TableColumnMetadata = {
        type: TableColumnType.ShortText,
        title: key,
        description: "A column.",
      };
      const read: TableColumnMetadata = withTitleAsItsWord(declared);

      expect(read.title).toBe(key.slice(0, key.indexOf(" (")));
      expect(read.titleKey).toBe(key);
      expect(read.description).toBe("A column.");
      // The declaration itself is left as it was.
      expect(declared.title).toBe(key);
      expect(declared.titleKey).toBeUndefined();
    }
  });

  test("leaves every other title as declared, a look-alike of a key too, and adds no key", () => {
    for (const title of [
      "Table",
      "Table ID",
      "Description (optional)",
      "Retention (days)",
      "table (database object)",
      "",
      undefined,
    ]) {
      const declared: TableColumnMetadata = {
        type: TableColumnType.ShortText,
        ...(title === undefined ? {} : { title: title }),
      };

      expect(withTitleAsItsWord(declared)).toBe(declared);
      expect(getColumnTitleKey(declared)).toBe(title);
    }
  });

  test("getColumnTitleKey reads nothing from no column", () => {
    expect(getColumnTitleKey(undefined)).toBeUndefined();
    expect(getColumnTitleKey(null)).toBeUndefined();
    expect(getColumnTitleKey({})).toBeUndefined();
  });
});
