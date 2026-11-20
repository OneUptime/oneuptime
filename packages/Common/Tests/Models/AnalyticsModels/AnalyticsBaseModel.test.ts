import { describe, expect, test } from "@jest/globals";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import SecurityEvent, {
  SECURITY_EVENT_CREATED_AT_INDEX_NAME,
} from "../../../Models/AnalyticsModels/SecurityEvent";
import AnalyticsTableColumn, {
  SkipIndex,
  SkipIndexType,
} from "../../../Types/AnalyticsDatabase/TableColumn";
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

/*
 * A table read by when its rows arrived (SecurityEvent: scheduled detection
 * rules judge what arrived since their last run, #10337) declares a skip
 * index on the base createdAt column, which every other table leaves as it
 * was.
 */
describe("AnalyticsBaseModel createdAt skip index", () => {
  test("puts the index on the base createdAt column when a model asks for one", () => {
    const model: AnalyticsBaseModel = new AnalyticsBaseModel(
      modelOptions({
        createdAtSkipIndex: {
          name: "idx_created_at",
          type: SkipIndexType.MinMax,
          granularity: 1,
        },
      }),
    );

    expect(model.getTableColumn("createdAt")?.skipIndex).toEqual({
      name: "idx_created_at",
      type: SkipIndexType.MinMax,
      granularity: 1,
    });
    expect(model.getTableColumn("_id")?.skipIndex).toBeUndefined();
  });

  test("leaves createdAt without one by default", () => {
    const model: AnalyticsBaseModel = new AnalyticsBaseModel(modelOptions());

    expect(model.getTableColumn("createdAt")?.skipIndex).toBeUndefined();
  });

  test("refuses one on a model without the base columns: there is no createdAt to index", () => {
    expect(() => {
      return new AnalyticsBaseModel(
        modelOptions({
          includeBaseColumns: false,
          defaultSortColumn: "projectId",
          createdAtSkipIndex: {
            name: "idx_created_at",
            type: SkipIndexType.MinMax,
            granularity: 1,
          },
        }),
      );
    }).toThrow("createdAtSkipIndex needs the base columns");
  });

  test("the security events table indexes when each event arrived, and no other table does", () => {
    for (const modelType of AnalyticsModels) {
      const model: AnalyticsBaseModel = new modelType();
      const index: SkipIndex | undefined =
        model.getTableColumn("createdAt")?.skipIndex;

      if (model.tableName === new SecurityEvent().tableName) {
        expect(index).toEqual({
          name: SECURITY_EVENT_CREATED_AT_INDEX_NAME,
          type: SkipIndexType.MinMax,
          granularity: 1,
        });
        continue;
      }

      expect(index).toBeUndefined();
    }
  });
});
