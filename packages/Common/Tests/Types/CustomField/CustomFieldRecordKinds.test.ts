import Models from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CUSTOM_FIELD_FILE_ROUTE,
  CUSTOM_FIELD_RECORD_KINDS,
  CustomFieldRecordKind,
  getCustomFieldFileDownloadPath,
  getCustomFieldRecordKind,
  getCustomFieldRecordKindByRouteName,
} from "../../../Types/CustomField/CustomFieldRecordKinds";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The server decides which of a write's values are files, and serves a file
 * only to someone who may read its record, from this pairing of each kind
 * of record with the table its fields are defined in. A model that gains
 * custom fields without being listed would store whatever a write says in
 * a file field, unchecked, and its files could not be downloaded.
 */

type ModelType = { new (): BaseModel };

const modelsByTable: Map<string, BaseModel> = new Map<string, BaseModel>(
  (Models as Array<ModelType>).map((modelType: ModelType) => {
    const model: BaseModel = new modelType();
    return [model.tableName || "", model];
  }),
);

const recordTables: Array<string> = (Models as Array<ModelType>)
  .map((modelType: ModelType): BaseModel => {
    return new modelType();
  })
  .filter((model: BaseModel): boolean => {
    return (
      model.hasColumn("customFields") &&
      model.getTableColumnMetadata("customFields")?.type ===
        TableColumnType.JSON
    );
  })
  .map((model: BaseModel): string => {
    return model.tableName || "";
  })
  .sort();

const PROJECT_ID: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const RECORD_ID: string = "a3f2b1c0-d9e8-4f5a-8b7c-6d5e4f3a2b1c";
const FILE_ID: string = "b5c4d3e2-f1a0-4b5c-9d8e-7f6a5b4c3d2e";

describe("every kind of record with custom fields", () => {
  test("is listed, and nothing else is", () => {
    expect(
      CUSTOM_FIELD_RECORD_KINDS.map((kind: CustomFieldRecordKind): string => {
        return kind.recordTableName;
      }).sort(),
    ).toEqual(recordTables);
  });

  test("names a definition table that defines custom fields", () => {
    for (const kind of CUSTOM_FIELD_RECORD_KINDS) {
      const definition: BaseModel | undefined = modelsByTable.get(
        kind.definitionTableName,
      );

      expect(definition).toBeDefined();
      expect(definition!.hasColumn("customFieldType")).toBe(true);
      expect(definition!.hasColumn("name")).toBe(true);
    }
  });

  test("is in the project's tenant column, which the checks read", () => {
    for (const kind of CUSTOM_FIELD_RECORD_KINDS) {
      expect(modelsByTable.get(kind.recordTableName)!.getTenantColumn()).toBe(
        "projectId",
      );
    }
  });

  test("has a route name of its own, in lower case with dashes", () => {
    // Lower-case words joined by dashes: "scheduled-maintenance".
    const ROUTE_NAME: RegExp = /^[a-z]+(-[a-z]+)*$/;
    const names: Array<string> = CUSTOM_FIELD_RECORD_KINDS.map(
      (kind: CustomFieldRecordKind): string => {
        return kind.routeName;
      },
    );

    expect(new Set(names).size).toBe(names.length);

    for (const name of names) {
      expect(ROUTE_NAME.test(name)).toBe(true);
    }
  });
});

describe("finding a kind", () => {
  test("by its table and by its route name", () => {
    expect(getCustomFieldRecordKind("Incident")!.routeName).toBe("incident");
    expect(getCustomFieldRecordKind("ProjectUserProfile")!.routeName).toBe(
      "team-member",
    );
    expect(
      getCustomFieldRecordKindByRouteName("scheduled-maintenance")!
        .recordTableName,
    ).toBe("ScheduledMaintenance");
  });

  test("nothing for a table or route name that is not one", () => {
    expect(getCustomFieldRecordKind("File")).toBeUndefined();
    expect(getCustomFieldRecordKind(undefined)).toBeUndefined();
    expect(getCustomFieldRecordKindByRouteName("Incident")).toBeUndefined();
    expect(getCustomFieldRecordKindByRouteName("file")).toBeUndefined();
    expect(getCustomFieldRecordKindByRouteName(7)).toBeUndefined();
  });
});

describe("a file's download path", () => {
  test("names the project, the kind, the record and the file", () => {
    expect(
      getCustomFieldFileDownloadPath({
        recordTableName: "Incident",
        projectId: PROJECT_ID,
        recordId: new ObjectID(RECORD_ID),
        fileId: FILE_ID.toUpperCase(),
      }),
    ).toBe(
      `${CUSTOM_FIELD_FILE_ROUTE}/${PROJECT_ID}/incident/${RECORD_ID}/${FILE_ID}`,
    );
  });

  test("is under /custom-field-file", () => {
    expect(CUSTOM_FIELD_FILE_ROUTE).toBe("/custom-field-file");
  });

  test("is null when an id is missing or not one, or the kind has no custom fields", () => {
    expect(
      getCustomFieldFileDownloadPath({
        recordTableName: "Incident",
        projectId: null,
        recordId: RECORD_ID,
        fileId: FILE_ID,
      }),
    ).toBeNull();

    expect(
      getCustomFieldFileDownloadPath({
        recordTableName: "Incident",
        projectId: PROJECT_ID,
        recordId: RECORD_ID,
        fileId: "../../etc/passwd",
      }),
    ).toBeNull();

    expect(
      getCustomFieldFileDownloadPath({
        recordTableName: "Label",
        projectId: PROJECT_ID,
        recordId: RECORD_ID,
        fileId: FILE_ID,
      }),
    ).toBeNull();
  });
});
