import { describe, expect, test } from "@jest/globals";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  RECORD_PAGE_FIELDS,
  RecordPageField,
  getRecordPageFieldsOfKind,
  readRecordPageFields,
} from "../../../Types/Database/RecordPageFields";
import { getUniqueNameWhenRequiredColumn } from "../../../Types/Database/UniqueNameWhenRequired";
import TableColumnType from "../../../Types/Database/TableColumnType";

/*
 * WHAT A RECORD'S PAGE NEEDS BESIDE ITS ID (#11020, Types/Database/
 * RecordPageFields): an OpenStack budget's cloud, a workspace summary's
 * workspace and type. The server reads these columns of the records it
 * names; the Dashboard builds the page's address from them. This holds the
 * declaration to the models - every column is a real column of its kind,
 * a parent's column holds an id of a real kind - and pins how an answer's
 * fields are read back.
 */

const modelOfTable: (tableName: string) => BaseModel | null = (
  tableName: string,
): BaseModel | null => {
  const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
    (type: { new (): BaseModel }): boolean => {
      return new type().tableName === tableName;
    },
  );

  return modelType ? new modelType() : null;
};

describe("the declaration", () => {
  test("names the two kinds opened under another record or page, with what their pages need", () => {
    expect(RECORD_PAGE_FIELDS).toEqual({
      OpenStackBudget: [
        { column: "openStackCloudId", parentTableName: "OpenStackCloud" },
      ],
      WorkspaceNotificationSummary: [
        { column: "workspaceType" },
        { column: "summaryType" },
      ],
    });
  });

  test("every kind is a model Require Unique Names holds, and every column is one of its columns", () => {
    for (const [tableName, fields] of Object.entries(RECORD_PAGE_FIELDS)) {
      const model: BaseModel | null = modelOfTable(tableName);

      expect({ tableName, isModel: Boolean(model) }).toEqual({
        tableName,
        isModel: true,
      });
      expect({
        tableName,
        isHeld: Boolean(getUniqueNameWhenRequiredColumn(model!)),
      }).toEqual({ tableName, isHeld: true });

      for (const field of fields) {
        expect({
          tableName,
          column: field.column,
          hasColumn: model!.hasColumn(field.column),
        }).toEqual({ tableName, column: field.column, hasColumn: true });
      }
    }
  });

  test("a parent's column holds the id of a record of a real kind", () => {
    for (const [tableName, fields] of Object.entries(RECORD_PAGE_FIELDS)) {
      const model: BaseModel = modelOfTable(tableName)!;

      for (const field of fields.filter((each: RecordPageField): boolean => {
        return Boolean(each.parentTableName);
      })) {
        expect({
          tableName,
          column: field.column,
          type: model.getTableColumnMetadata(field.column)?.type,
        }).toEqual({
          tableName,
          column: field.column,
          type: TableColumnType.ObjectID,
        });
        expect({
          parent: field.parentTableName,
          isModel: Boolean(modelOfTable(field.parentTableName!)),
        }).toEqual({ parent: field.parentTableName, isModel: true });
      }
    }
  });

  test("a kind whose page needs only its id has nothing to read", () => {
    for (const tableName of [
      "Monitor",
      "AIAgent",
      "ApiKey",
      "",
      "constructor",
      "__proto__",
      "toString",
    ]) {
      expect({
        tableName,
        fields: getRecordPageFieldsOfKind(tableName),
      }).toEqual({ tableName, fields: [] });
    }
    expect(getRecordPageFieldsOfKind(null)).toEqual([]);
    expect(getRecordPageFieldsOfKind(undefined)).toEqual([]);
    expect(getRecordPageFieldsOfKind("OpenStackBudget")).toBe(
      RECORD_PAGE_FIELDS["OpenStackBudget"],
    );
  });
});

describe("reading an answer's fields back", () => {
  test("text values by column", () => {
    expect(
      readRecordPageFields({
        workspaceType: "Slack",
        summaryType: "Incident Episode",
      }),
    ).toEqual({ workspaceType: "Slack", summaryType: "Incident Episode" });
  });

  test("anything that is not text is left out, and nothing left is none", () => {
    expect(
      readRecordPageFields({
        openStackCloudId: "7f0b1d7e-0000-4000-8000-000000011020",
        count: 3,
        nested: { a: "b" },
        list: ["x"],
        empty: "",
        missing: null,
      }),
    ).toEqual({ openStackCloudId: "7f0b1d7e-0000-4000-8000-000000011020" });

    for (const value of [
      undefined,
      null,
      "Slack",
      7,
      [],
      ["Slack"],
      {},
      { workspaceType: 1 },
    ]) {
      expect(readRecordPageFields(value)).toBeUndefined();
    }
  });
});
