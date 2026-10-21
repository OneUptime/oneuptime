/*
 * The shared list of columns OneUptime fills in itself. Both the
 * /model-schema endpoint and the record editor read it, so it is held here to
 * what the models actually declare rather than to what it happened to say on
 * the day it was written.
 */

import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import {
  getAlwaysEmptyColumnIds,
  getSystemColumnIds,
  isAlwaysEmptyColumnId,
  isSystemColumnId,
} from "../../../Types/Workflow/SystemColumns";
import { describe, expect, test } from "@jest/globals";

describe("SystemColumns", () => {
  /*
   * Every model inherits these from DatabaseBaseModel. Read off a real model,
   * so a base column added later without a place on the list fails here.
   */
  test("names every column DatabaseBaseModel gives a model", () => {
    const baseColumnIds: Array<string> = Object.keys(
      getTableColumns(new BaseModel()),
    );

    // The scan found the base columns at all, so the loop below is not vacuous.
    expect([...baseColumnIds].sort()).toEqual([
      "_id",
      "createdAt",
      "deletedAt",
      "updatedAt",
      "version",
    ]);

    const incidentColumns: Dictionary<TableColumnMetadata> = getTableColumns(
      new Incident(),
    );
    const monitorColumns: Dictionary<TableColumnMetadata> = getTableColumns(
      new Monitor(),
    );

    for (const columnId of baseColumnIds) {
      // Inherited by real models...
      expect(incidentColumns[columnId]).toBeDefined();
      expect(monitorColumns[columnId]).toBeDefined();

      // ...and on the list.
      expect({ columnId, system: isSystemColumnId(columnId) }).toEqual({
        columnId,
        system: true,
      });
    }
  });

  test("names the who-did-it columns the write path stamps", () => {
    expect(isSystemColumnId("createdByUserId")).toBe(true);
    expect(isSystemColumnId("createdByUser")).toBe(true);
    expect(isSystemColumnId("deletedByUserId")).toBe(true);
    expect(isSystemColumnId("deletedByUser")).toBe(true);
    expect(isSystemColumnId("archivedAt")).toBe(true);
    expect(isSystemColumnId("archivedByUserId")).toBe(true);
    expect(isSystemColumnId("archivedByUser")).toBe(true);
  });

  /*
   * Archiving is something a workflow may well do: isArchived is the switch,
   * and only the audit columns beside it are the server's.
   */
  test("does not name the columns a person does set", () => {
    expect(isSystemColumnId("isArchived")).toBe(false);
    expect(isSystemColumnId("title")).toBe(false);
    expect(isSystemColumnId("name")).toBe(false);
    expect(isSystemColumnId("projectId")).toBe(false);
    expect(isSystemColumnId("id")).toBe(false);
  });

  test("every always-empty column is also a system column", () => {
    for (const columnId of getAlwaysEmptyColumnIds()) {
      expect({ columnId, system: isSystemColumnId(columnId) }).toEqual({
        columnId,
        system: true,
      });
    }
  });

  test("the timestamps a record really has are not always empty", () => {
    expect(isAlwaysEmptyColumnId("deletedAt")).toBe(true);
    expect(isAlwaysEmptyColumnId("createdAt")).toBe(false);
    expect(isAlwaysEmptyColumnId("updatedAt")).toBe(false);
    expect(isAlwaysEmptyColumnId("createdByUserId")).toBe(false);
  });

  test("hands out copies, so no caller can change the list for everyone", () => {
    const first: Array<string> = getSystemColumnIds();
    first.push("title");
    first.length = 0;

    expect(getSystemColumnIds()).toContain("createdAt");
    expect(isSystemColumnId("title")).toBe(false);

    const empty: Array<string> = getAlwaysEmptyColumnIds();
    empty.length = 0;

    expect(getAlwaysEmptyColumnIds()).toContain("deletedAt");
  });
});
