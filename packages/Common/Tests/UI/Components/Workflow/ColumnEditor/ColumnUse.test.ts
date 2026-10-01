/*
 * Which columns each list may offer: the values a create writes, the values an
 * update writes, and the conditions a query matches on.
 *
 * The maintainer's report was a screenshot of Create One Incident's "Add a
 * field..." list with Created At and Created by User ID in it - "system fields
 * that should never be in the list". These pin the rule that keeps them out of
 * the two write lists while leaving them in the one list where they are useful.
 */

import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { getSystemColumnIds } from "../../../../../Types/Workflow/SystemColumns";
import {
  ColumnUse,
  canUseColumnFor,
  isAlwaysEmptyColumn,
  isSystemColumn,
  requiredWritableColumns,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnUse";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import { describe, expect, test } from "@jest/globals";

type MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string },
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string },
): ModelSchemaColumn => {
  return {
    title: overrides.id,
    type: TableColumnType.ShortText,
    isRelation: false,
    ...overrides,
  };
};

describe("isSystemColumn", () => {
  test("believes the endpoint when it says a column is a system column", () => {
    // A computed column no list could name: Incident's notification status.
    expect(
      isSystemColumn(
        makeColumn({
          id: "subscriberNotificationStatusOnIncidentCreated",
          isSystemColumn: true,
        }),
      ),
    ).toBe(true);
  });

  test("believes the endpoint when it says a column is not one", () => {
    expect(
      isSystemColumn(makeColumn({ id: "title", isSystemColumn: false })),
    ).toBe(false);
  });

  /*
   * A response from before the flag existed - or a page that loaded before a
   * deploy - must still keep the timestamps out of a create.
   */
  test("falls back to the shared list when the endpoint says nothing", () => {
    for (const columnId of getSystemColumnIds()) {
      expect({
        columnId,
        system: isSystemColumn(makeColumn({ id: columnId })),
      }).toEqual({ columnId, system: true });
    }

    expect(isSystemColumn(makeColumn({ id: "title" }))).toBe(false);
    expect(isSystemColumn(makeColumn({ id: "incidentSeverityId" }))).toBe(
      false,
    );
  });

  test("an explicit false beats the list, because the endpoint knows the model", () => {
    expect(
      isSystemColumn(makeColumn({ id: "createdAt", isSystemColumn: false })),
    ).toBe(false);
  });
});

describe("isAlwaysEmptyColumn", () => {
  test("the deleted-record columns are empty on every record a workflow can see", () => {
    expect(isAlwaysEmptyColumn(makeColumn({ id: "deletedAt" }))).toBe(true);
    expect(isAlwaysEmptyColumn(makeColumn({ id: "deletedByUserId" }))).toBe(
      true,
    );
    expect(isAlwaysEmptyColumn(makeColumn({ id: "deletedByUser" }))).toBe(true);
    expect(isAlwaysEmptyColumn(makeColumn({ id: "version" }))).toBe(true);
  });

  test("the other system columns are not - they hold real values", () => {
    expect(isAlwaysEmptyColumn(makeColumn({ id: "createdAt" }))).toBe(false);
    expect(isAlwaysEmptyColumn(makeColumn({ id: "updatedAt" }))).toBe(false);
    expect(isAlwaysEmptyColumn(makeColumn({ id: "_id" }))).toBe(false);
    expect(isAlwaysEmptyColumn(makeColumn({ id: "createdByUserId" }))).toBe(
      false,
    );
  });
});

describe("canUseColumnFor", () => {
  const title: ModelSchemaColumn = makeColumn({
    id: "title",
    isSystemColumn: false,
    canCreate: true,
    canUpdate: true,
  });
  const createdAt: ModelSchemaColumn = makeColumn({
    id: "createdAt",
    type: TableColumnType.Date,
    isSystemColumn: true,
    canCreate: true,
    canUpdate: true,
  });
  const createdByUserId: ModelSchemaColumn = makeColumn({
    id: "createdByUserId",
    type: TableColumnType.ObjectID,
    isSystemColumn: true,
    canCreate: true,
    canUpdate: false,
  });
  const deletedAt: ModelSchemaColumn = makeColumn({
    id: "deletedAt",
    type: TableColumnType.Date,
    isSystemColumn: true,
  });

  test("an ordinary field is usable everywhere", () => {
    expect(canUseColumnFor(title, ColumnUse.Create)).toBe(true);
    expect(canUseColumnFor(title, ColumnUse.Update)).toBe(true);
    expect(canUseColumnFor(title, ColumnUse.Filter)).toBe(true);
  });

  /*
   * createdAt carries full create and update lists - it borrows the model's
   * record-level permissions - and createdByUserId a create list, so the
   * permission gate alone let both through. Being a system column is what
   * keeps them out.
   */
  test("a system column is never written, whatever its permissions say", () => {
    expect(canUseColumnFor(createdAt, ColumnUse.Create)).toBe(false);
    expect(canUseColumnFor(createdAt, ColumnUse.Update)).toBe(false);
    expect(canUseColumnFor(createdByUserId, ColumnUse.Create)).toBe(false);
    expect(canUseColumnFor(createdByUserId, ColumnUse.Update)).toBe(false);
  });

  test("a system column is still a filter", () => {
    expect(canUseColumnFor(createdAt, ColumnUse.Filter)).toBe(true);
    expect(canUseColumnFor(createdByUserId, ColumnUse.Filter)).toBe(true);
    expect(
      canUseColumnFor(
        makeColumn({ id: "_id", type: TableColumnType.ObjectID }),
        ColumnUse.Filter,
      ),
    ).toBe(true);
  });

  test("a column empty on every record is not a filter either", () => {
    expect(canUseColumnFor(deletedAt, ColumnUse.Filter)).toBe(false);
  });

  test("a create-only column is written by a create, not by an update", () => {
    const incidentId: ModelSchemaColumn = makeColumn({
      id: "incidentId",
      canCreate: true,
      canUpdate: false,
    });

    expect(canUseColumnFor(incidentId, ColumnUse.Create)).toBe(true);
    expect(canUseColumnFor(incidentId, ColumnUse.Update)).toBe(false);
  });

  test("an update-only column is written by an update, not by a create", () => {
    const column: ModelSchemaColumn = makeColumn({
      id: "statusPagesNotifiedOnCreation",
      canCreate: false,
      canUpdate: true,
    });

    expect(canUseColumnFor(column, ColumnUse.Create)).toBe(false);
    expect(canUseColumnFor(column, ColumnUse.Update)).toBe(true);
  });

  /*
   * The write gate only admits a column some role can create or update, so a
   * response without the per-operation flags is read as "either".
   */
  test("a column from a response without the flags keeps being offered", () => {
    const column: ModelSchemaColumn = makeColumn({ id: "name" });

    expect(canUseColumnFor(column, ColumnUse.Create)).toBe(true);
    expect(canUseColumnFor(column, ColumnUse.Update)).toBe(true);
    expect(canUseColumnFor(column, ColumnUse.Filter)).toBe(true);
  });
});

describe("requiredWritableColumns", () => {
  /*
   * DatabaseService.generateSlug writes the slug from the name on every
   * create, but ScheduledMaintenance.slug is required, has no default and
   * carries a create list - so Create One Scheduled Maintenance opened on a
   * required "Slug" row and counted it as "1 required field still empty".
   */
  test("a required slug is not asked for, because the server writes it", () => {
    expect(
      requiredWritableColumns([
        makeColumn({ id: "title", required: true, isSystemColumn: false }),
        makeColumn({
          id: "slug",
          type: TableColumnType.Slug,
          required: true,
          isSystemColumn: true,
          canCreate: true,
          canUpdate: false,
        }),
      ]).map((column: ModelSchemaColumn) => {
        return column.id;
      }),
    ).toEqual(["title"]);
  });

  test("a required column a create may not set is not asked for", () => {
    expect(
      requiredWritableColumns([
        makeColumn({ id: "name", required: true, canCreate: false }),
      ]),
    ).toEqual([]);
  });

  test("a system column named only by the shared list is not asked for", () => {
    expect(
      requiredWritableColumns([
        makeColumn({ id: "createdByUserId", required: true }),
      ]),
    ).toEqual([]);
  });

  test("an ordinary required column still is", () => {
    expect(
      requiredWritableColumns([
        makeColumn({ id: "name", required: true, canCreate: true }),
      ]).map((column: ModelSchemaColumn) => {
        return column.id;
      }),
    ).toEqual(["name"]);
  });
});
