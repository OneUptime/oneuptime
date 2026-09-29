import { describe, expect, test } from "@jest/globals";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";

type ModelOptions = ConstructorParameters<typeof AnalyticsBaseModel>[0];

function projectIdColumn(): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key: "projectId",
    title: "Project ID",
    description: "Tenant",
    required: true,
    type: TableColumnType.Text,
  });
}

function modelOptions(overrides: Partial<ModelOptions> = {}): ModelOptions {
  return {
    tableName: "TestAnalyticsTable",
    singularName: "Test row",
    pluralName: "Test rows",
    tableColumns: [projectIdColumn()],
    primaryKeys: ["projectId"],
    sortKeys: ["projectId"],
    partitionKey: "projectId",
    tableEngine: AnalyticsTableEngine.MergeTree,
    ...overrides,
  };
}

describe("AnalyticsBaseModel base-column policy", () => {
  test("adds _id and createdAt by default for regular analytics models", () => {
    const suppliedColumns: Array<AnalyticsTableColumn> = [projectIdColumn()];
    const model: AnalyticsBaseModel = new AnalyticsBaseModel(
      modelOptions({ tableColumns: suppliedColumns }),
    );

    expect(
      model.tableColumns.map((column: AnalyticsTableColumn) => {
        return column.key;
      }),
    ).toEqual(["projectId", "_id", "createdAt"]);
    expect(model.getTableColumn("_id")?.type).toBe(TableColumnType.ObjectID);
    expect(model.getTableColumn("_id")?.codec).toEqual({
      codec: "ZSTD",
      level: 1,
    });
    expect(model.getTableColumn("createdAt")?.type).toBe(TableColumnType.Date);

    // Construction copies the caller's array instead of mutating it.
    expect(
      suppliedColumns.map((column: AnalyticsTableColumn) => {
        return column.key;
      }),
    ).toEqual(["projectId"]);
  });

  test("omits synthetic columns when includeBaseColumns is false", () => {
    const model: AnalyticsBaseModel = new AnalyticsBaseModel(
      modelOptions({
        includeBaseColumns: false,
        defaultSortColumn: "projectId",
      }),
    );

    expect(
      model.tableColumns.map((column: AnalyticsTableColumn) => {
        return column.key;
      }),
    ).toEqual(["projectId"]);
    expect(model.getTableColumn("_id")).toBeNull();
    expect(model.getTableColumn("createdAt")).toBeNull();
    expect(model.defaultSortColumn).toBe("projectId");
  });

  test("requires a real default sort column when base columns are omitted", () => {
    expect(() => {
      return new AnalyticsBaseModel(
        modelOptions({
          includeBaseColumns: false,
        }),
      );
    }).toThrow(
      "defaultSortColumn is required when includeBaseColumns is false",
    );
  });

  test("rejects createdAt as a strict model's default sort because it is absent", () => {
    expect(() => {
      return new AnalyticsBaseModel(
        modelOptions({
          includeBaseColumns: false,
          defaultSortColumn: "createdAt",
        }),
      );
    }).toThrow("defaultSortColumn createdAt is not part of tableColumns");
  });

  test("still validates primary and sort keys against the strict column set", () => {
    expect(() => {
      return new AnalyticsBaseModel(
        modelOptions({
          includeBaseColumns: false,
          defaultSortColumn: "projectId",
          sortKeys: ["projectId", "createdAt"],
        }),
      );
    }).toThrow("Sort key createdAt is not part of tableColumns");

    expect(() => {
      return new AnalyticsBaseModel(
        modelOptions({
          includeBaseColumns: false,
          defaultSortColumn: "projectId",
          primaryKeys: ["_id"],
        }),
      );
    }).toThrow("Primary key _id is not part of tableColumns");
  });
});
