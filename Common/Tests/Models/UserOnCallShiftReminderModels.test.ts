import AllModelTypes from "../../Models/DatabaseModels/Index";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../Models/DatabaseModels/UserNotificationSetting";
import UserOnCallShiftReminder, {
  MAX_MINUTES_BEFORE_SHIFT,
  MIN_MINUTES_BEFORE_SHIFT,
} from "../../Models/DatabaseModels/UserOnCallShiftReminder";
import UserOnCallShiftReminderLog, {
  UserOnCallShiftReminderLogKind,
} from "../../Models/DatabaseModels/UserOnCallShiftReminderLog";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * Two tables for shift reminders: what the user asked for
 * (UserOnCallShiftReminder, user-owned like UserNotificationSetting) and
 * what the worker did about it (UserOnCallShiftReminderLog, root-only, whose
 * unique index IS the send-exactly-once guarantee). Both shapes are pinned
 * here because both are invisible until they are wrong: a reminder table a
 * user cannot write to, or a ledger a user CAN write to, or a unique index
 * that misses one key column and lets a moved-by-a-second shift page twice.
 */

type ModelType = { new (): BaseModel };

const reminder: UserOnCallShiftReminder = new UserOnCallShiftReminder();
const log: UserOnCallShiftReminderLog = new UserOnCallShiftReminderLog();
const notificationSetting: UserNotificationSetting =
  new UserNotificationSetting();

function typeormColumn(
  modelType: ModelType,
  propertyName: string,
): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((entry: ColumnMetadataArgs) => {
      return entry.target === modelType && entry.propertyName === propertyName;
    });

  if (!column) {
    throw new Error(`${modelType.name}.${propertyName} has no @Column`);
  }

  return column;
}

function uniqueIndexes(modelType: ModelType): Array<Array<string>> {
  return getMetadataArgsStorage()
    .indices.filter((entry: IndexMetadataArgs) => {
      return entry.target === modelType && entry.unique === true;
    })
    .map((entry: IndexMetadataArgs) => {
      return Array.isArray(entry.columns)
        ? (entry.columns as Array<string>)
        : [];
    });
}

function relation(
  modelType: ModelType,
  propertyName: string,
): RelationMetadataArgs {
  const found: RelationMetadataArgs | undefined =
    getMetadataArgsStorage().relations.find((entry: RelationMetadataArgs) => {
      return entry.target === modelType && entry.propertyName === propertyName;
    });

  if (!found) {
    throw new Error(`${modelType.name}.${propertyName} has no relation`);
  }

  return found;
}

describe("UserOnCallShiftReminder model", () => {
  test("is registered in the model index", () => {
    expect(
      (AllModelTypes as Array<ModelType>).includes(UserOnCallShiftReminder),
    ).toBe(true);
  });

  test("is served from its own CRUD route", () => {
    expect(reminder.getCrudApiPath()?.toString()).toBe(
      "/user-on-call-shift-reminder",
    );
    expect(reminder.tableName).toBe("UserOnCallShiftReminder");
  });

  test("is shaped like UserNotificationSetting: tenant scoped, owner-only, unpaid-tolerant", () => {
    expect(reminder.getTenantColumn()).toBe("projectId");
    expect(reminder.currentUserCanAccessColumnBy).toBe("userId");
    expect(reminder.allowAccessIfSubscriptionIsUnpaid).toBe(true);

    expect(reminder.createRecordPermissions).toEqual([Permission.CurrentUser]);
    expect(reminder.readRecordPermissions).toEqual([Permission.CurrentUser]);
    expect(reminder.updateRecordPermissions).toEqual([Permission.CurrentUser]);
    expect(reminder.deleteRecordPermissions).toEqual([Permission.CurrentUser]);

    expect(reminder.createRecordPermissions).toEqual(
      notificationSetting.createRecordPermissions,
    );
    expect(reminder.readRecordPermissions).toEqual(
      notificationSetting.readRecordPermissions,
    );
    expect(reminder.updateRecordPermissions).toEqual(
      notificationSetting.updateRecordPermissions,
    );
    expect(reminder.deleteRecordPermissions).toEqual(
      notificationSetting.deleteRecordPermissions,
    );
    expect(reminder.currentUserCanAccessColumnBy).toBe(
      notificationSetting.currentUserCanAccessColumnBy,
    );
  });

  test("is not plan gated (reminders follow the schedules the user is already on)", () => {
    expect(reminder.getCreateBillingPlan()).toBeFalsy();
    expect(reminder.getReadBillingPlan()).toBeFalsy();
    expect(reminder.getUpdateBillingPlan()).toBeFalsy();
    expect(reminder.getDeleteBillingPlan()).toBeFalsy();
  });

  test("is not documented", () => {
    expect(reminder.enableDocumentation).toBeFalsy();
  });

  test("carries project, user and the lead time", () => {
    const columns: Array<string> = reminder.getTableColumns().columns;

    for (const column of [
      "project",
      "projectId",
      "user",
      "userId",
      "minutesBeforeShift",
    ]) {
      expect(columns).toContain(column);
    }

    expect(reminder.getTableColumnMetadata("minutesBeforeShift").type).toBe(
      TableColumnType.Number,
    );
    expect(reminder.getTableColumnMetadata("minutesBeforeShift").required).toBe(
      true,
    );
    expect(
      typeormColumn(UserOnCallShiftReminder, "minutesBeforeShift").options
        .nullable,
    ).toBe(false);
  });

  test("the owner may set the lead time on create and change it later; the owner columns are fixed", () => {
    const lead: ColumnAccessControl | null =
      reminder.getColumnAccessControlFor("minutesBeforeShift");

    expect(lead).toEqual({
      create: [Permission.CurrentUser],
      read: [Permission.CurrentUser],
      update: [Permission.CurrentUser],
    });

    for (const column of ["projectId", "userId", "project", "user"]) {
      const accessControl: ColumnAccessControl | null =
        reminder.getColumnAccessControlFor(column);

      expect({ column, update: accessControl?.update }).toEqual({
        column,
        update: [],
      });
      expect({ column, create: accessControl?.create }).toEqual({
        column,
        create: [Permission.CurrentUser],
      });
    }
  });

  test("is unique per (project, user, lead) so a double-click is a no-op", () => {
    expect(uniqueIndexes(UserOnCallShiftReminder)).toContainEqual([
      "projectId",
      "userId",
      "minutesBeforeShift",
    ]);
  });

  test("cascades away with its project and its user", () => {
    expect(relation(UserOnCallShiftReminder, "project").options.onDelete).toBe(
      "CASCADE",
    );
    expect(relation(UserOnCallShiftReminder, "user").options.onDelete).toBe(
      "CASCADE",
    );
    expect(reminder.getTableColumnMetadata("project").modelType).toBe(Project);
    expect(reminder.getTableColumnMetadata("user").modelType).toBe(User);
    expect(
      typeormColumn(UserOnCallShiftReminder, "userId").options.nullable,
    ).toBe(false);
    expect(
      typeormColumn(UserOnCallShiftReminder, "projectId").options.nullable,
    ).toBe(false);
  });

  test("publishes the lead-time bounds the service enforces", () => {
    expect(MIN_MINUTES_BEFORE_SHIFT).toBe(15);
    expect(MAX_MINUTES_BEFORE_SHIFT).toBe(20160);
    expect(MAX_MINUTES_BEFORE_SHIFT).toBe(14 * 24 * 60);
  });
});

describe("UserOnCallShiftReminderLog model", () => {
  test("is registered in the model index", () => {
    expect(
      (AllModelTypes as Array<ModelType>).includes(UserOnCallShiftReminderLog),
    ).toBe(true);
  });

  test("is tenant scoped and addressable, but every operation is denied through the API", () => {
    expect(log.getTenantColumn()).toBe("projectId");
    expect(log.tableName).toBe("UserOnCallShiftReminderLog");
    expect(log.getCrudApiPath()?.toString()).toBe(
      "/user-on-call-shift-reminder-log",
    );

    expect(log.createRecordPermissions).toEqual([]);
    expect(log.readRecordPermissions).toEqual([]);
    expect(log.updateRecordPermissions).toEqual([]);
    expect(log.deleteRecordPermissions).toEqual([]);

    // Not user-owned either: CurrentUser must never resolve to a row here.
    expect(log.currentUserCanAccessColumnBy).toBeFalsy();
  });

  test("denies every column to every caller (root bypasses column checks)", () => {
    for (const column of log.getTableColumns().columns) {
      const accessControl: ColumnAccessControl | null =
        log.getColumnAccessControlFor(column);

      if (!accessControl) {
        continue;
      }

      expect({ column, accessControl }).toEqual({
        column,
        accessControl: { create: [], read: [], update: [] },
      });
    }
  });

  test("is not documented", () => {
    expect(log.enableDocumentation).toBeFalsy();
  });

  test("carries the full idempotency key plus claim/sent stamps", () => {
    const columns: Array<string> = log.getTableColumns().columns;

    for (const column of [
      "project",
      "projectId",
      "user",
      "userId",
      "onCallDutyPolicySchedule",
      "onCallDutyPolicyScheduleId",
      "shiftStartsAt",
      "minutesBeforeShift",
      "kind",
      "claimedAt",
      "sentAt",
    ]) {
      expect(columns).toContain(column);
    }

    expect(log.getTableColumnMetadata("shiftStartsAt").type).toBe(
      TableColumnType.Date,
    );
    expect(log.getTableColumnMetadata("claimedAt").type).toBe(
      TableColumnType.Date,
    );
    expect(log.getTableColumnMetadata("sentAt").type).toBe(
      TableColumnType.Date,
    );
    expect(log.getTableColumnMetadata("kind").type).toBe(
      TableColumnType.ShortText,
    );
    expect(log.getTableColumnMetadata("minutesBeforeShift").type).toBe(
      TableColumnType.Number,
    );
  });

  test("the key columns are NOT NULL; sentAt is the only nullable stamp", () => {
    for (const column of [
      "projectId",
      "userId",
      "onCallDutyPolicyScheduleId",
      "shiftStartsAt",
      "minutesBeforeShift",
      "kind",
      "claimedAt",
    ]) {
      expect({
        column,
        nullable: typeormColumn(UserOnCallShiftReminderLog, column).options
          .nullable,
      }).toEqual({ column, nullable: false });
    }

    expect(
      typeormColumn(UserOnCallShiftReminderLog, "sentAt").options.nullable,
    ).toBe(true);
  });

  test("minutesBeforeShift defaults to 0 for change notices", () => {
    expect(
      typeormColumn(UserOnCallShiftReminderLog, "minutesBeforeShift").options
        .default,
    ).toBe(0);
    expect(
      log.getTableColumnMetadata("minutesBeforeShift").isDefaultValueColumn,
    ).toBe(true);
    expect(log.getTableColumnMetadata("minutesBeforeShift").defaultValue).toBe(
      0,
    );
  });

  test("is unique on exactly (user, schedule, shiftStartsAt, lead, kind) - the send-once key", () => {
    expect(uniqueIndexes(UserOnCallShiftReminderLog)).toEqual([
      [
        "userId",
        "onCallDutyPolicyScheduleId",
        "shiftStartsAt",
        "minutesBeforeShift",
        "kind",
      ],
    ]);
  });

  test("cascades away with its project, user and schedule", () => {
    expect(
      relation(UserOnCallShiftReminderLog, "project").options.onDelete,
    ).toBe("CASCADE");
    expect(relation(UserOnCallShiftReminderLog, "user").options.onDelete).toBe(
      "CASCADE",
    );
    expect(
      relation(UserOnCallShiftReminderLog, "onCallDutyPolicySchedule").options
        .onDelete,
    ).toBe("CASCADE");
    expect(
      log.getTableColumnMetadata("onCallDutyPolicySchedule").modelType,
    ).toBe(OnCallDutyPolicySchedule);
  });

  test("names the three kinds of row the worker writes", () => {
    expect(Object.values(UserOnCallShiftReminderLogKind).sort()).toEqual(
      ["catch-up", "reassigned", "reminder"].sort(),
    );
    expect(UserOnCallShiftReminderLogKind.Reminder).toBe("reminder");
    expect(UserOnCallShiftReminderLogKind.CatchUp).toBe("catch-up");
    expect(UserOnCallShiftReminderLogKind.Reassigned).toBe("reassigned");
  });
});
