/**
 * UserNotificationRule.repeatEveryMinutes column contract.
 *
 * How often a push rule sends its push again until somebody acknowledges.
 * The column decides how many times a phone rings for one page, so the
 * properties pinned below fail in both directions without an error anywhere:
 * a default other than 0 would start re-paging every existing rule on
 * upgrade, a nullable column hands the on-call worker a value it has to
 * guess about, and a column an administrator could not change is a responder
 * who sleeps through pages with nobody able to fix it for them.
 *
 * (What the worker and the service do with the value is tested beside them;
 * this file holds the column itself.)
 *
 * The three "default" mechanisms are separate and easy to confuse:
 * - NEW rules get 0 from the Postgres column default (@Column default)
 * - EXISTING rules got 0 from the migration's NOT NULL DEFAULT
 * - @TableColumn defaultValue is what the generated API schema documents and
 *   what the dashboard's create form starts on; it defaults nothing in the
 *   database
 */

import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import DatabaseRequestType from "../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Server/Types/Database/Permissions/ColumnPermission";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnType from "../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  isRepeatEveryMinutes,
  MAX_NOTIFICATION_REPEATS,
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
} from "../../Types/NotificationRule/NotificationRepeat";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import UserType from "../../Types/UserType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "repeatEveryMinutes";

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_CLASS: string =
  "AddCriticalAlertSoundVolumeAndPushRepeat1801650000000";

const MIGRATION_PATH: string = path.join(
  MIGRATIONS_DIR,
  "1801650000000-AddCriticalAlertSoundVolumeAndPushRepeat.ts",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const CALLER_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

function metadata(): TableColumnMetadata {
  return new UserNotificationRule().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === UserNotificationRule && column.propertyName === COLUMN
      );
    },
  );
}

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

// A member: only the auto-granted CurrentUser, as a real session has.
function memberProps(): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
  };
}

// A caller holding these permissions in the project, CurrentUser on top.
function tenantProps(
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function ruleRepeatingEvery(minutes: number): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.repeatEveryMinutes = minutes;
  return rule;
}

describe("UserNotificationRule.repeatEveryMinutes", () => {
  test("exists as an integer column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Number);
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.type).toBe(ColumnType.Number);
    expect(typeOrmColumn()?.options.type).toBe("integer");
  });

  test("a new rule sends its push once unless somebody chooses to repeat it", () => {
    /*
     * Repeating is opted into. A default of anything but 0 would make every
     * rule in every project start paging its responder again and again the
     * moment this shipped.
     */
    expect(typeOrmColumn()?.options.default).toBe(0);
    expect(typeOrmColumn()?.options.default).toBe(NO_NOTIFICATION_REPEAT);
  });

  test("the database default is a value the service accepts", () => {
    expect(isRepeatEveryMinutes(typeOrmColumn()?.options.default)).toBe(true);
  });

  test("is never null, so the on-call worker never has to guess", () => {
    expect(typeOrmColumn()?.options.nullable).toBe(false);
  });

  test("is documented as not repeating, with an interval the page offers as its example", () => {
    expect(metadata().defaultValue).toBe(NO_NOTIFICATION_REPEAT);
    expect(metadata().example).toBe(5);
    expect(REPEAT_EVERY_MINUTES_OPTIONS).toContain(metadata().example);
  });

  test("is a default-value column, so every existing create call keeps working", () => {
    expect(new UserNotificationRule().isDefaultValueColumn(COLUMN)).toBe(true);
    expect(metadata().required).toBeFalsy();
  });

  test("is readable through a relation query, like the rule's other preference columns", () => {
    /*
     * The on-call rules table reads it beside notifyAfterMinutes and
     * pushNotificationLevel, and it is no more sensitive than either: it
     * says how often a page sounds, never where it goes.
     */
    expect(metadata().canReadOnRelationQuery).toBe(true);
    expect(
      new UserNotificationRule().getTableColumnMetadata("notifyAfterMinutes")
        .canReadOnRelationQuery,
    ).toBe(true);
    expect(
      new UserNotificationRule().getTableColumnMetadata("pushNotificationLevel")
        .canReadOnRelationQuery,
    ).toBe(true);
  });

  test("says in the API docs exactly which intervals are accepted, and how many repeats there are at most", () => {
    const description: string = metadata().description || "";
    const options: Array<string> = REPEAT_EVERY_MINUTES_OPTIONS.map(
      (option: number): string => {
        return String(option);
      },
    );

    expect(metadata().title).toBe("Repeat Every Minutes");

    /*
     * Built from the values the service accepts, so an interval added to
     * NotificationRepeat without updating the docs - or the other way
     * round - fails here.
     */
    expect(description).toContain(
      `${NO_NOTIFICATION_REPEAT} (do not repeat), ${options
        .slice(0, -1)
        .join(", ")} or ${options[options.length - 1]}`,
    );
    expect(description).toContain(`up to ${MAX_NOTIFICATION_REPEATS} more`);
    expect(description).toContain("acknowledged");
    expect(description).toContain("Push notification rules only");
  });

  test("an unchosen interval on a rule built in memory reads as not set", () => {
    expect(new UserNotificationRule().repeatEveryMinutes).toBeUndefined();
  });
});

describe("the repeatEveryMinutes migration", () => {
  test("adds the column exactly as the model declares it, every existing rule backfilled as not repeating", () => {
    const options: ColumnMetadataArgs["options"] = typeOrmColumn()!.options;
    const notNull: string = options.nullable === false ? " NOT NULL" : "";

    // Derived from the model, so a default changed there alone fails here.
    expect(String(options.type)).toBe("integer");
    expect(readMigration()).toContain(
      `ALTER TABLE "UserNotificationRule" ADD "${COLUMN}" integer${notNull} DEFAULT '${String(options.default)}'`,
    );

    // And spelled out, as TypeORM generates it.
    expect(readMigration()).toContain(
      `ALTER TABLE "UserNotificationRule" ADD "repeatEveryMinutes" integer NOT NULL DEFAULT '0'`,
    );
  });

  test("down() removes the column", () => {
    expect(readMigration()).toContain(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "repeatEveryMinutes"`,
    );
  });

  test("does not rewrite the rule table, so it is safe on a large install", () => {
    /*
     * A constant default is a catalog-only change on Postgres 11+. An UPDATE
     * backfill, a computed default or a type change would rewrite every rule
     * row under an exclusive lock.
     */
    const migration: string = readMigration();

    expect(migration).not.toMatch(/UPDATE\s+"UserNotificationRule"/);
    expect(migration).not.toContain("ALTER COLUMN");
    expect(migration).not.toContain("CREATE INDEX");
  });

  test("is registered, so the column exists at runtime", () => {
    /*
     * A migration missing from Index.ts never runs: the column would be
     * absent while the on-call worker selects it, which fails the query that
     * decides what to page.
     */
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    // Imported AND listed in the exported array - the import alone does nothing.
    expect(index.match(new RegExp(MIGRATION_CLASS, "g"))?.length).toBe(2);
  });
});

describe("UserNotificationRule.repeatEveryMinutes access control", () => {
  test("is readable by the owner and by whoever may read a member's rules", () => {
    expect(
      new UserNotificationRule().getColumnAccessControlFor(COLUMN)?.read,
    ).toEqual([
      Permission.CurrentUser,
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectUserNotificationRule,
    ]);
  });

  test("is settable when a rule is made, by the owner or an administrator", () => {
    expect(
      new UserNotificationRule().getColumnAccessControlFor(COLUMN)?.create,
    ).toEqual([
      Permission.CurrentUser,
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectUserNotificationRule,
    ]);
  });

  test("is changeable later, exactly as the escalation delay and the push level are", () => {
    /*
     * The control on every push rule's row writes this column on its own,
     * so it has to be open to update - and changing it moves no page
     * anywhere, so it mirrors notifyAfterMinutes rather than the frozen
     * method foreign keys.
     */
    const rule: UserNotificationRule = new UserNotificationRule();

    expect(rule.getColumnAccessControlFor(COLUMN)?.update).toEqual(
      rule.getColumnAccessControlFor("notifyAfterMinutes")?.update,
    );
    expect(rule.getColumnAccessControlFor(COLUMN)?.update).toEqual(
      rule.getColumnAccessControlFor("pushNotificationLevel")?.update,
    );
    expect(rule.getColumnAccessControlFor(COLUMN)?.update).toEqual([
      Permission.CurrentUser,
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectUserNotificationRule,
    ]);
  });

  test.each(
    [NO_NOTIFICATION_REPEAT, ...REPEAT_EVERY_MINUTES_OPTIONS].map(
      (minutes: number): [number] => {
        return [minutes];
      },
    ),
  )(
    "a member may set their own rule to repeat every %s minutes",
    (minutes: number) => {
      expect(() => {
        return ColumnPermissions.checkDataColumnPermissions(
          UserNotificationRule,
          ruleRepeatingEvery(minutes),
          memberProps(),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    },
  );

  test.each([
    [Permission.EditProjectUserNotificationRule],
    [Permission.ProjectAdmin],
    [Permission.ProjectOwner],
  ])(
    "an administrator holding %s may change how often a member's rule repeats",
    (grant: Permission) => {
      expect(() => {
        return ColumnPermissions.checkDataColumnPermissions(
          UserNotificationRule,
          ruleRepeatingEvery(5),
          tenantProps(grant),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    },
  );

  test("the interval can be set on create alongside the rule's other preference columns", () => {
    const rule: UserNotificationRule = ruleRepeatingEvery(10);
    rule.notifyAfterMinutes = 5;

    expect(() => {
      return ColumnPermissions.checkDataColumnPermissions(
        UserNotificationRule,
        rule,
        memberProps(),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test("a frozen column next to it is still refused in the same update", () => {
    /*
     * Opening this column must not have opened its neighbours: an update that
     * carries the interval AND a new owner is refused as a whole.
     */
    const rule: UserNotificationRule = ruleRepeatingEvery(5);
    rule.userId = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    expect(() => {
      return ColumnPermissions.checkDataColumnPermissions(
        UserNotificationRule,
        rule,
        tenantProps(Permission.EditProjectUserNotificationRule),
        DatabaseRequestType.Update,
      );
    }).toThrow(BadDataException);
  });
});
