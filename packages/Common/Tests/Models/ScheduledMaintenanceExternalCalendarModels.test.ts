import AllModelTypes from "../../Models/DatabaseModels/Index";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceExternalCalendar from "../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import ScheduledMaintenanceExternalCalendarEvent from "../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendarEvent";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { isColorFieldColumn } from "../../Types/Database/ColorField";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  EXTERNAL_CALENDAR_DEFAULT_REFRESH_INTERVAL_IN_MINUTES,
  EXTERNAL_CALENDAR_MAX_EVENTS,
  EXTERNAL_CALENDAR_PAST_DAYS,
} from "../../Types/ScheduledMaintenance/ExternalCalendar";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The calendars from outside a project drawn on its maintenance calendar,
 * and their events, as tables (issue #5084):
 *
 *   - a calendar's link is encrypted and write-only - set on create and
 *     with Change link, never read back by anyone - with its host readable
 *     beside it;
 *   - what a read found is written by OneUptime alone (computed, never
 *     written by a request), readable by whoever reads the calendar;
 *   - the events are written by OneUptime alone, read like the project's
 *     own events, and go with their calendar;
 *   - both carry the scheduled maintenance event's own access lists;
 *   - the calendar is in the API reference and Terraform, its events are
 *     not (nobody writes them).
 */

type ModelType = { new (): BaseModel };

const calendar: ScheduledMaintenanceExternalCalendar =
  new ScheduledMaintenanceExternalCalendar();
const event: ScheduledMaintenanceExternalCalendarEvent =
  new ScheduledMaintenanceExternalCalendarEvent();
const maintenance: ScheduledMaintenance = new ScheduledMaintenance();

// What a read found: OneUptime's to write.
const STATUS_COLUMNS: Array<string> = [
  "calendarHost",
  "lastReadAt",
  "lastReadAttemptAt",
  "lastReadError",
  "lastReadHttpStatus",
  "eventCount",
  "hasMoreEvents",
  "nextReadAt",
];

// What the people who may change a calendar change.
const SETTING_COLUMNS: Array<string> = [
  "name",
  "calendarUrl",
  "color",
  "isEnabled",
  "refreshIntervalInMinutes",
];

function typeormColumn(target: ModelType, propertyName: string): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((entry: ColumnMetadataArgs) => {
      return entry.target === target && entry.propertyName === propertyName;
    });

  if (!column) {
    throw new Error(`${target.name}.${propertyName} has no @Column`);
  }

  return column;
}

function indexColumnLists(target: ModelType): Array<Array<string>> {
  return getMetadataArgsStorage()
    .indices.filter((entry: IndexMetadataArgs) => {
      return entry.target === target;
    })
    .map((entry: IndexMetadataArgs): Array<string> => {
      return Array.isArray(entry.columns)
        ? (entry.columns as Array<string>)
        : entry.propertyName
          ? [entry.propertyName]
          : [];
    });
}

function crudOwners(path: string): Array<string> {
  return (AllModelTypes as Array<ModelType>)
    .filter((modelType: ModelType) => {
      return new modelType().getCrudApiPath()?.toString() === path;
    })
    .map((modelType: ModelType) => {
      return modelType.name;
    });
}

describe("ScheduledMaintenanceExternalCalendar: the table", () => {
  test("is registered under its own table name and CRUD route", () => {
    expect(
      (AllModelTypes as Array<ModelType>).includes(
        ScheduledMaintenanceExternalCalendar,
      ),
    ).toBe(true);
    expect(calendar.tableName).toBe("ScheduledMaintenanceExternalCalendar");
    expect(crudOwners("/scheduled-maintenance-external-calendar")).toEqual([
      "ScheduledMaintenanceExternalCalendar",
    ]);
  });

  test("is tenant scoped, on every plan, and in the API reference and Terraform", () => {
    expect(calendar.getTenantColumn()).toBe("projectId");
    expect(calendar.getCreateBillingPlan()).toBeFalsy();
    expect(calendar.getReadBillingPlan()).toBeFalsy();
    expect(calendar.enableDocumentation).toBe(true);
    expect(calendar.singularName).toBe("Scheduled Maintenance External Calendar");
    expect(calendar.tableDescription).toContain(".ics");
  });

  test("whoever may create, read, edit or delete the events may do as much with the calendars beside them", () => {
    expect(calendar.createRecordPermissions).toEqual(
      maintenance.createRecordPermissions,
    );
    expect(calendar.readRecordPermissions).toEqual(
      maintenance.readRecordPermissions,
    );
    expect(calendar.updateRecordPermissions).toEqual(
      maintenance.updateRecordPermissions,
    );
    expect(calendar.deleteRecordPermissions).toEqual(
      maintenance.deleteRecordPermissions,
    );
  });

  test("the calendars due to be read are found by an index", () => {
    expect(indexColumnLists(ScheduledMaintenanceExternalCalendar)).toEqual(
      expect.arrayContaining([["nextReadAt"], ["isEnabled"], ["projectId"]]),
    );
  });
});

describe("ScheduledMaintenanceExternalCalendar: the link", () => {
  test("is written on create and with Change link, and read by nobody", () => {
    expect(calendar.getColumnAccessControlFor("calendarUrl")).toEqual({
      create: calendar.createRecordPermissions,
      read: [],
      update: calendar.updateRecordPermissions,
    });
  });

  test("is encrypted at rest, required, never read through a relation, and the only column encrypted", () => {
    const metadata: TableColumnMetadata =
      calendar.getTableColumnMetadata("calendarUrl");

    expect(metadata.encrypted).toBe(true);
    expect(metadata.required).toBe(true);
    expect(metadata.canReadOnRelationQuery).toBe(false);
    expect(metadata.type).toBe(TableColumnType.VeryLongText);
    expect(typeormColumn(ScheduledMaintenanceExternalCalendar, "calendarUrl").options.nullable).toBe(false);

    expect(
      calendar.getTableColumns().columns.filter((column: string) => {
        return calendar.getTableColumnMetadata(column)?.encrypted === true;
      }),
    ).toEqual(["calendarUrl"]);
  });

  test("its host is readable instead, written by OneUptime", () => {
    expect(calendar.getColumnAccessControlFor("calendarHost")).toEqual({
      create: [],
      read: calendar.readRecordPermissions,
      update: [],
    });
    expect(calendar.getTableColumnMetadata("calendarHost").computed).toBe(true);
  });
});

describe("ScheduledMaintenanceExternalCalendar: settings and status", () => {
  test("the settings are the columns its editors change", () => {
    const base: Array<string> = new BaseModel().getTableColumns().columns;

    const updatable: Array<string> = calendar
      .getTableColumns()
      .columns.filter((column: string) => {
        return (
          !base.includes(column) &&
          (calendar.getColumnAccessControlFor(column)?.update || []).length > 0
        );
      });

    expect(updatable.sort()).toEqual([...SETTING_COLUMNS].sort());
  });

  test("what a read found is readable by the calendar's readers and written only by OneUptime", () => {
    for (const column of STATUS_COLUMNS) {
      expect({
        column,
        accessControl: calendar.getColumnAccessControlFor(column),
        computed: calendar.getTableColumnMetadata(column).computed,
      }).toEqual({
        column,
        accessControl: {
          create: [],
          read: calendar.readRecordPermissions,
          update: [],
        } as ColumnAccessControl,
        computed: true,
      });
    }
  });

  test("the digest of the last read is read by nobody", () => {
    expect(calendar.getColumnAccessControlFor("contentDigest")).toEqual({
      create: [],
      read: [],
      update: [],
    });
    expect(
      calendar.getTableColumnMetadata("contentDigest").hideColumnInDocumentation,
    ).toBe(true);
  });

  test("a calendar is on and read every hour unless it says otherwise, and a client may leave both out", () => {
    for (const [column, value] of [
      ["isEnabled", true],
      [
        "refreshIntervalInMinutes",
        EXTERNAL_CALENDAR_DEFAULT_REFRESH_INTERVAL_IN_MINUTES,
      ],
    ] as Array<[string, unknown]>) {
      const metadata: TableColumnMetadata =
        calendar.getTableColumnMetadata(column);

      expect({ column, default: metadata.defaultValue }).toEqual({
        column,
        default: value,
      });
      expect({ column, isDefault: metadata.isDefaultValueColumn }).toEqual({
        column,
        isDefault: true,
      });
      expect(
        typeormColumn(ScheduledMaintenanceExternalCalendar, column).options
          .default,
      ).toBe(value);
    }
  });

  test("the colour is optional - OneUptime picks one - and is the calendar's colour field", () => {
    expect(calendar.getTableColumnMetadata("color").required).toBe(false);
    expect(calendar.getTableColumnMetadata("color").type).toBe(
      TableColumnType.Color,
    );
    expect(isColorFieldColumn(calendar, "color")).toBe(true);
    expect(
      typeormColumn(ScheduledMaintenanceExternalCalendar, "color").options
        .nullable,
    ).toBe(false);
  });

  test("the event count's description names the window and the cap the reads keep", () => {
    const description: string =
      calendar.getTableColumnMetadata("eventCount").description || "";

    expect(description).toContain(`${EXTERNAL_CALENDAR_PAST_DAYS} days back`);
    expect(description).toContain(
      EXTERNAL_CALENDAR_MAX_EVENTS.toLocaleString("en-US"),
    );
  });
});

describe("ScheduledMaintenanceExternalCalendarEvent", () => {
  test("is registered under its own table name and CRUD route", () => {
    expect(
      (AllModelTypes as Array<ModelType>).includes(
        ScheduledMaintenanceExternalCalendarEvent,
      ),
    ).toBe(true);
    expect(event.tableName).toBe("ScheduledMaintenanceExternalCalendarEvent");
    expect(
      crudOwners("/scheduled-maintenance-external-calendar-event"),
    ).toEqual(["ScheduledMaintenanceExternalCalendarEvent"]);
  });

  test("is written by OneUptime alone and read like the project's own events", () => {
    expect(event.createRecordPermissions).toEqual([]);
    expect(event.updateRecordPermissions).toEqual([]);
    expect(event.deleteRecordPermissions).toEqual([]);
    expect(event.readRecordPermissions).toEqual(
      maintenance.readRecordPermissions,
    );

    for (const column of event.getTableColumns().columns) {
      const accessControl: ColumnAccessControl | null =
        event.getColumnAccessControlFor(column);

      if (!accessControl) {
        continue;
      }

      expect({ column, create: accessControl.create, update: accessControl.update }).toEqual({
        column,
        create: [],
        update: [],
      });
    }
  });

  test("is not in the API reference or Terraform: nobody writes one", () => {
    expect(event.enableDocumentation).toBeFalsy();
  });

  test("goes with its calendar, and with its project", () => {
    const relations: Array<RelationMetadataArgs> =
      getMetadataArgsStorage().relations.filter(
        (relation: RelationMetadataArgs) => {
          return relation.target === ScheduledMaintenanceExternalCalendarEvent;
        },
      );

    const onDelete: Record<string, unknown> = {};

    for (const relation of relations) {
      onDelete[relation.propertyName] = relation.options.onDelete;
    }

    expect(onDelete).toEqual({
      project: "CASCADE",
      scheduledMaintenanceExternalCalendar: "CASCADE",
    });
  });

  test("a period's events are found by calendar and start", () => {
    expect(indexColumnLists(ScheduledMaintenanceExternalCalendarEvent)).toEqual(
      expect.arrayContaining([
        ["scheduledMaintenanceExternalCalendarId", "startsAt"],
      ]),
    );
  });

  test("holds a title, a start, an end and whether it is all day", () => {
    const base: Array<string> = new BaseModel().getTableColumns().columns;

    expect(
      event
        .getTableColumns()
        .columns.filter((column: string) => {
          return !base.includes(column);
        })
        .sort(),
    ).toEqual(
      [
        "project",
        "projectId",
        "scheduledMaintenanceExternalCalendar",
        "scheduledMaintenanceExternalCalendarId",
        "title",
        "startsAt",
        "endsAt",
        "isAllDay",
      ].sort(),
    );
    expect(event.getTableColumnMetadata("title").type).toBe(
      TableColumnType.LongText,
    );
  });
});
