import Entities from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ReadPermission, {
  LabelledReferences,
} from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import RecordParts, {
  PARTS_NAMING_OTHER_LABELLED_RECORDS,
} from "../../../../../Types/LabelAccess/RecordParts";
import { describe, expect, test } from "@jest/globals";

/*
 * THE DASHBOARD'S READING OF A RECORD'S PARTS IS THE SERVER'S (#11435).
 *
 * A record's page locks its parts' Add and Remove by the record's labels
 * (Types/LabelAccess/RecordParts, PermissionGate.getPartLock): a part's
 * rows carry the labels of the records they name, so where they name no
 * labelled record but the one they are read through, the record's labels
 * decide its grants; where they name another one too, only the record's
 * labels' blocks. Which parts name another is written down for the
 * Dashboard. This works it out again for every part of every labelled
 * record by the server's own rule (ReadPermission.getLabelledReferences,
 * which getGrantedLabelsCondition and CreateScopePermission follow) and
 * fails, naming each part to add to or take off the list.
 */

const MODELS: Array<{ new (): BaseModel }> = Entities as Array<{
  new (): BaseModel;
}>;

// Whether the server reads a part's rows as naming its record alone, by its key.
const serverNamesOnlyItsRecord: (modelType: {
  new (): BaseModel;
}) => boolean = (modelType: { new (): BaseModel }): boolean => {
  const model: BaseModel = new modelType();
  const column: {
    type?: TableColumnType;
    modelType?: unknown;
    manyToOneRelationColumn?: string;
  } = model.getTableColumnMetadata(model.canAccessIfCanReadOn as string) || {};

  if (column.type !== TableColumnType.Entity) {
    return false;
  }

  const references: LabelledReferences =
    ReadPermission.getLabelledReferences(modelType);

  return (
    references.anyKindColumns.length === 0 &&
    references.keys.length === 1 &&
    references.keys[0]!.column === column.manyToOneRelationColumn &&
    references.keys[0]!.modelTypes.length === 1 &&
    references.keys[0]!.modelTypes[0] === column.modelType
  );
};

// Every part of a record that carries labels: what the Dashboard locks by its labels.
const PARTS: Array<{ new (): BaseModel }> = MODELS.filter(
  (modelType: { new (): BaseModel }): boolean => {
    const model: BaseModel = new modelType();
    const record: ReturnType<typeof RecordParts.getRecordOf> =
      RecordParts.getRecordOf(model);

    if (!record) {
      return false;
    }

    const column: { modelType?: unknown } =
      model.getTableColumnMetadata(model.canAccessIfCanReadOn as string) || {};

    return Boolean(
      typeof column.modelType === "function" &&
        new (column.modelType as {
          new (): BaseModel;
        })().getAccessControlColumn(),
    );
  },
);

describe("RecordParts agrees with the server's reading of every part", () => {
  test("there are parts to weigh: owners, probes, timelines, notes", () => {
    const names: Array<string> = PARTS.map(
      (modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      },
    );

    for (const part of [
      "MonitorOwnerUser",
      "MonitorOwnerTeam",
      "MonitorProbe",
      "MonitorStatusTimeline",
      "IncidentInternalNote",
    ]) {
      expect(names).toContain(part);
    }
  });

  test("a part names its record alone exactly where the server reads it so", () => {
    const disagreements: Array<string> = [];

    for (const modelType of PARTS) {
      const model: BaseModel = new modelType();
      const server: boolean = serverNamesOnlyItsRecord(modelType);

      if (RecordParts.namesOnlyItsRecord(model) !== server) {
        disagreements.push(
          `${model.tableName}: the server reads its rows as ${
            server
              ? "naming its record alone"
              : "naming other labelled records too"
          } - ${server ? "take it off" : "add it to"} PARTS_NAMING_OTHER_LABELLED_RECORDS`,
        );
      }
    }

    expect(disagreements).toEqual([]);
  });

  test("every part listed is a part of a labelled record still", () => {
    const parts: Array<string> = PARTS.map(
      (modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      },
    );

    expect(
      PARTS_NAMING_OTHER_LABELLED_RECORDS.filter(
        (tableName: string): boolean => {
          return !parts.includes(tableName);
        },
      ),
    ).toEqual([]);
  });
});
