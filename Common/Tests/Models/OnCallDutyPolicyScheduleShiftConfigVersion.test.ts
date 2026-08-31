import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * shiftConfigVersion is the SEQUENCE of every calendar VEVENT and part of
 * every feed cache key. Its contract is small and load-bearing: an integer
 * that starts at 0, that readers of the schedule can see (the feed renderer
 * reads it through the schedule relation), and that nobody can set through
 * the API - it moves only by the service's atomic bump.
 */

const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();

function dbColumn(): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((entry: ColumnMetadataArgs) => {
      return (
        entry.target === OnCallDutyPolicySchedule &&
        entry.propertyName === "shiftConfigVersion"
      );
    });

  if (!column) {
    throw new Error("OnCallDutyPolicySchedule.shiftConfigVersion is missing");
  }

  return column;
}

describe("OnCallDutyPolicySchedule.shiftConfigVersion", () => {
  test("exists as a Number column", () => {
    expect(schedule.getTableColumns().columns).toContain("shiftConfigVersion");

    const metadata: TableColumnMetadata =
      schedule.getTableColumnMetadata("shiftConfigVersion");

    expect(metadata.type).toBe(TableColumnType.Number);
  });

  test("starts at 0 - in the model metadata and at the database", () => {
    const metadata: TableColumnMetadata =
      schedule.getTableColumnMetadata("shiftConfigVersion");

    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(0);

    expect(dbColumn().options.default).toBe(0);
    expect(dbColumn().options.nullable).toBe(false);
  });

  test("is readable by everyone who may read the schedule, incl. through a relation", () => {
    const accessControl: ColumnAccessControl | null =
      schedule.getColumnAccessControlFor("shiftConfigVersion");

    expect(accessControl?.read).toEqual(schedule.readRecordPermissions);
    expect(accessControl?.read.length).toBeGreaterThan(0);

    expect(
      schedule.getTableColumnMetadata("shiftConfigVersion")
        .canReadOnRelationQuery,
    ).toBe(true);
  });

  test("cannot be set through the API on create or update", () => {
    const accessControl: ColumnAccessControl | null =
      schedule.getColumnAccessControlFor("shiftConfigVersion");

    expect(accessControl?.create).toEqual([]);
    expect(accessControl?.update).toEqual([]);
  });

  test("does not block a schedule create that omits it (required + default)", () => {
    /*
     * DatabaseService.checkRequiredFields skips a required column that is a
     * default-value column, so `required: true` here documents intent
     * without forcing every creator to send a 0.
     */
    expect(schedule.getTableColumnMetadata("shiftConfigVersion").required).toBe(
      true,
    );
    expect(schedule.isDefaultValueColumn("shiftConfigVersion")).toBe(true);
  });
});
