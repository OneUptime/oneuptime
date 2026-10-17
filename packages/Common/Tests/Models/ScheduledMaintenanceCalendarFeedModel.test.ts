import AllModelTypes from "../../Models/DatabaseModels/Index";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCalendarFeed from "../../Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The team's calendar link for scheduled maintenance, as a table: one per
 * project, the token never readable or writable through the API (minted by
 * the service, its hash UNIQUE at the database, the plaintext encrypted),
 * and the access lists the scheduled maintenance event's own - whoever may
 * read or edit the events may read or edit the link, and nothing else
 * about it can be changed through CRUD but whether it is on.
 */

type ModelType = { new (): BaseModel };

const SECRET_COLUMNS: Array<string> = [
  "tokenHash",
  "token",
  "previousTokenHash",
];

const BOOKKEEPING_COLUMNS: Array<string> = [
  "previousTokenExpiresAt",
  "tokenHint",
  "rotatedAt",
  "lastFetchedAt",
  "lastFetchedClient",
  "fetchCount",
];

const OWN_COLUMNS: Array<string> = [
  "project",
  "projectId",
  ...SECRET_COLUMNS,
  ...BOOKKEEPING_COLUMNS,
  "isEnabled",
  "createdByUser",
  "createdByUserId",
  "deletedByUser",
  "deletedByUserId",
];

function typeormColumn(propertyName: string): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((entry: ColumnMetadataArgs) => {
      return (
        entry.target === ScheduledMaintenanceCalendarFeed &&
        entry.propertyName === propertyName
      );
    });

  if (!column) {
    throw new Error(
      `ScheduledMaintenanceCalendarFeed.${propertyName} has no @Column`,
    );
  }

  return column;
}

function typeormIndices(): Array<IndexMetadataArgs> {
  return getMetadataArgsStorage().indices.filter((entry: IndexMetadataArgs) => {
    return entry.target === ScheduledMaintenanceCalendarFeed;
  });
}

function indexColumns(index: IndexMetadataArgs): Array<string> {
  return Array.isArray(index.columns) ? (index.columns as Array<string>) : [];
}

const model: ScheduledMaintenanceCalendarFeed =
  new ScheduledMaintenanceCalendarFeed();

describe("ScheduledMaintenanceCalendarFeed: the table", () => {
  test("is registered in the model index, under its own table name", () => {
    expect(
      (AllModelTypes as Array<ModelType>).includes(
        ScheduledMaintenanceCalendarFeed,
      ),
    ).toBe(true);
    expect(model.tableName).toBe("ScheduledMaintenanceCalendarFeed");
  });

  test("is served from a CRUD route nothing else uses", () => {
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/scheduled-maintenance-calendar-feed",
    );

    const owners: Array<string> = (AllModelTypes as Array<ModelType>)
      .filter((modelType: ModelType) => {
        return (
          new modelType().getCrudApiPath()?.toString() ===
          "/scheduled-maintenance-calendar-feed"
        );
      })
      .map((modelType: ModelType) => {
        return modelType.name;
      });

    expect(owners).toEqual(["ScheduledMaintenanceCalendarFeed"]);
  });

  test("is tenant scoped, on every plan, and survives an unpaid subscription", () => {
    expect(model.getTenantColumn()).toBe("projectId");
    // No billing gate: scheduled maintenance is on every plan.
    expect(model.getCreateBillingPlan()).toBeFalsy();
    expect(model.getReadBillingPlan()).toBeFalsy();
    expect(model.getUpdateBillingPlan()).toBeFalsy();
    expect(model.getDeleteBillingPlan()).toBeFalsy();
    expect(model.allowAccessIfSubscriptionIsUnpaid).toBe(true);
    expect(model.enableDocumentation).toBeFalsy();
  });

  test("whoever may create, read, edit or delete the events may do as much with the link", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();

    expect(model.createRecordPermissions).toEqual(
      event.createRecordPermissions,
    );
    expect(model.readRecordPermissions).toEqual(event.readRecordPermissions);
    expect(model.updateRecordPermissions).toEqual(
      event.updateRecordPermissions,
    );
    expect(model.deleteRecordPermissions).toEqual(
      event.deleteRecordPermissions,
    );
  });

  test("one link per project: projectId is UNIQUE at the database", () => {
    const unique: boolean = typeormIndices().some(
      (index: IndexMetadataArgs) => {
        return (
          index.unique === true &&
          indexColumns(index).length === 1 &&
          indexColumns(index)[0] === "projectId"
        );
      },
    );

    expect(unique).toBe(true);
  });

  test("carries exactly its own columns besides the base ones", () => {
    const columns: Array<string> = model.getTableColumns().columns;
    const base: Array<string> = new BaseModel().getTableColumns().columns;

    for (const column of OWN_COLUMNS) {
      expect(columns).toContain(column);
    }

    expect(
      columns.filter((column: string) => {
        return !base.includes(column) && !OWN_COLUMNS.includes(column);
      }),
    ).toEqual([]);
  });
});

describe("ScheduledMaintenanceCalendarFeed: the token", () => {
  test("no secret column can be created, read or updated through the API", () => {
    for (const column of SECRET_COLUMNS) {
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      expect({ column, accessControl }).toEqual({
        column,
        accessControl: { create: [], read: [], update: [] },
      });
    }
  });

  test("every secret column is minted by the server, hidden from the docs and from relation reads", () => {
    for (const column of SECRET_COLUMNS) {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect({ column, computed: metadata.computed }).toEqual({
        column,
        computed: true,
      });
      expect({ column, hidden: metadata.hideColumnInDocumentation }).toEqual({
        column,
        hidden: true,
      });
      expect({ column, relation: metadata.canReadOnRelationQuery }).toEqual({
        column,
        relation: false,
      });
    }
  });

  test("the plaintext token is encrypted at rest, and nothing else is", () => {
    const encrypted: Array<string> = model
      .getTableColumns()
      .columns.filter((column: string) => {
        return model.getTableColumnMetadata(column)?.encrypted === true;
      });

    expect(encrypted).toEqual(["token"]);
    expect(model.getTableColumnMetadata("token").type).toBe(
      TableColumnType.VeryLongText,
    );
  });

  test("the hash is NOT NULL and UNIQUE at the database, never through TableColumn.unique (whose check would echo it)", () => {
    expect(typeormColumn("tokenHash").options.nullable).toBe(false);
    expect(typeormColumn("tokenHash").options.unique).toBe(true);
    expect(model.getTableColumnMetadata("tokenHash").unique).toBeFalsy();
    expect(
      model.getTableColumnMetadata("previousTokenHash").unique,
    ).toBeFalsy();
  });

  test("the rotated-out hash is indexed, as the public route falls back to it", () => {
    expect(
      typeormIndices().some((index: IndexMetadataArgs) => {
        return (
          indexColumns(index).length === 1 &&
          indexColumns(index)[0] === "previousTokenHash"
        );
      }),
    ).toBe(true);
  });
});

describe("ScheduledMaintenanceCalendarFeed: settings and bookkeeping", () => {
  test("whether the link is on is the one column an editor may change, on by default", () => {
    const base: Array<string> = new BaseModel().getTableColumns().columns;

    const updatable: Array<string> = model
      .getTableColumns()
      .columns.filter((column: string) => {
        return (
          !base.includes(column) &&
          (model.getColumnAccessControlFor(column)?.update || []).length > 0
        );
      });

    expect(updatable).toEqual(["isEnabled"]);
    expect(model.getColumnAccessControlFor("isEnabled")?.update).toEqual(
      model.updateRecordPermissions,
    );
    expect(typeormColumn("isEnabled").options.default).toBe(true);
  });

  test("the bookkeeping is readable by the link's readers and written only by the server", () => {
    for (const column of BOOKKEEPING_COLUMNS) {
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      expect({ column, accessControl }).toEqual({
        column,
        accessControl: {
          create: [],
          read: model.readRecordPermissions,
          update: [],
        },
      });
      expect({
        column,
        computed: model.getTableColumnMetadata(column).computed,
      }).toEqual({ column, computed: true });
    }

    expect(typeormColumn("fetchCount").options.default).toBe(0);
  });
});
