jest.mock("../../../../Server/Utils/Logger");

/*
 * The monitor's incident path pulls the native isolated-vm addon through
 * its template renderer; nothing here runs it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { describe, expect, jest, test } from "@jest/globals";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  ALSO_PART_OF,
  PRIVATE_RECORD_TABLES,
} from "../../../../Types/PrivateRecord/PrivateRecordParts";
import {
  RECORD_ACCESS_TABLES,
  RecordAccessKind,
  RecordAccessOperation,
} from "../../../../Types/RecordAccess/RecordAccess";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import {
  getRecordAccessKindSpec,
  RecordAccessKindSpec,
  RecordAccessPart,
} from "../../../../Server/Utils/RecordAccess/RecordAccessKinds";

/*
 * THE RECORDS WHOSE PAGES ASK WHAT THE READER MAY DO, AND THEIR PARTS
 * (#10272). The builder answers for one row of each part and says it of
 * every row of that part on the record - true only of a part read through
 * the record that names no other record a grant could be limited to. And
 * the Dashboard holds back the very tables the server answers for.
 */

const KINDS: Array<RecordAccessKind> = Object.values(RecordAccessKind);

const tableOf: (part: RecordAccessPart) => string = (
  part: RecordAccessPart,
): string => {
  return new part.service.modelType().tableName || "";
};

describe.each(KINDS)("%s", (kind: RecordAccessKind) => {
  const spec: RecordAccessKindSpec = getRecordAccessKindSpec(kind);
  const recordModel: BaseModel = new spec.service.modelType();

  test("is answered for the tables the Dashboard waits for, in its order", () => {
    expect([recordModel.tableName, ...spec.parts.map(tableOf)]).toEqual([
      ...RECORD_ACCESS_TABLES[kind],
    ]);
  });

  test("its record is the kind's own table", () => {
    expect(recordModel.tableName).toBe(kind);
  });

  test.each(
    spec.parts.map((part: RecordAccessPart) => {
      return [tableOf(part), part];
    }),
  )(
    "%s is read through the record, by the key it is asked by",
    (_table: string, part: RecordAccessPart) => {
      const model: BaseModel = new part.service.modelType();
      const relation: string = model.canAccessIfCanReadOn || "";

      expect(relation).not.toBe("");

      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(relation);

      expect(metadata.manyToOneRelationColumn).toBe(part.recordKey);
      expect(new metadata.modelType!().tableName).toBe(recordModel.tableName);
      // Its rows carry no labels of their own: the record's are weighed.
      expect(model.getAccessControlColumn()).toBeFalsy();
    },
  );

  test.each(
    spec.parts.map((part: RecordAccessPart) => {
      return [tableOf(part), part];
    }),
  )("%s names no other record a grant could be limited to", (table: string) => {
    expect(ALSO_PART_OF[table]).toBeUndefined();
  });

  test("the owner tables are parts it answers for, added and removed but never changed", () => {
    for (const ownerService of [spec.ownerUserService, spec.ownerTeamService]) {
      const part: RecordAccessPart | undefined = spec.parts.find(
        (each: RecordAccessPart): boolean => {
          return each.service === ownerService;
        },
      );

      expect(part).toBeDefined();
      expect(part!.recordKey).toBe(spec.ownerKey);
      expect([...part!.operations]).toEqual([
        RecordAccessOperation.Create,
        RecordAccessOperation.Delete,
      ]);
    }
  });

  test("whether it can be private is the private record rule's", () => {
    expect(PRIVATE_RECORD_TABLES.includes(kind)).toBe(
      kind !== RecordAccessKind.ScheduledMaintenance,
    );
  });
});
