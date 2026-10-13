/**
 * UserNotificationRule.pushNotificationLevel column contract.
 *
 * The rule's half of "does this page ring through silent mode?". Every
 * property pinned below, quietly changed, either stops a responder's Sev 1
 * pages from waking them or starts waking them for pages they asked to be
 * quiet - and neither failure produces an error anywhere.
 *
 * The three "default" mechanisms are separate and easy to confuse:
 * - NEW rows get 'Critical' from the Postgres column default (@Column default)
 * - EXISTING rows got 'Critical' from the migration's NOT NULL DEFAULT
 * - @TableColumn defaultValue is what the generated API schema documents and
 *   what the dashboard's create form starts on; it defaults nothing in the
 *   database
 */

import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import DatabaseRequestType from "../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Server/Types/Database/Permissions/ColumnPermission";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import BadDataException from "../../Types/Exception/BadDataException";
import PushNotificationLevel from "../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import UserType from "../../Types/UserType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "pushNotificationLevel";

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
  "AddUserNotificationRulePushNotificationLevel1801550000000";

const MIGRATION_PATH: string = path.join(
  MIGRATIONS_DIR,
  "1801550000000-AddUserNotificationRulePushNotificationLevel.ts",
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
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return (
      column.target === UserNotificationRule && column.propertyName === COLUMN
    );
  });
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

function ruleSettingLevel(level: PushNotificationLevel): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.pushNotificationLevel = level;
  return rule;
}

describe("UserNotificationRule.pushNotificationLevel", () => {
  test("exists as a short text column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.ShortText);
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.type).toBe(ColumnType.ShortText);
    expect(typeOrmColumn()?.options.length).toBe(ColumnLength.ShortText);
  });

  test("a new rule pages as a critical alert unless somebody chooses otherwise", () => {
    /*
     * The default is what keeps this change invisible on upgrade: before the
     * column existed, every push to a device with Critical On-Call Alerts on
     * was critical, whatever the rule. A default of Standard would silently
     * stop waking every responder who had turned the option on.
     */
    expect(typeOrmColumn()?.options.default).toBe(
      PushNotificationLevel.Critical,
    );
  });

  test("is never null, so the delivery path never has to guess", () => {
    expect(typeOrmColumn()?.options.nullable).toBe(false);
  });

  test("is documented as defaulting to Critical, which the create form starts on", () => {
    expect(metadata().defaultValue).toBe(PushNotificationLevel.Critical);
    expect(metadata().example).toBe(PushNotificationLevel.Critical);
  });

  test("is a default-value column, so every existing create call keeps working", () => {
    expect(new UserNotificationRule().isDefaultValueColumn(COLUMN)).toBe(true);
    expect(metadata().required).toBeFalsy();
  });

  test("is readable through a relation query, like the other preference columns", () => {
    /*
     * notifyAfterMinutes - the column beside it on every on-call rules table -
     * is, and the level is no more sensitive than a delay: it says how loud a
     * page is, never where it goes.
     */
    expect(metadata().canReadOnRelationQuery).toBe(true);
    expect(
      new UserNotificationRule().getTableColumnMetadata("notifyAfterMinutes")
        .canReadOnRelationQuery,
    ).toBe(true);
  });

  test("says in the API docs that the device has to opt in too", () => {
    const description: string = metadata().description || "";

    expect(metadata().title).toBe("Push Notification Level");
    expect(description).toContain("Critical");
    expect(description).toContain("Standard");
    expect(description).toContain("Critical On-Call Alerts");
    expect(description).toContain("push");
  });
});

describe("the pushNotificationLevel migration", () => {
  test("adds the column with every existing rule backfilled as Critical", () => {
    expect(readMigration()).toContain(
      `ALTER TABLE "UserNotificationRule" ADD "pushNotificationLevel" character varying(100) NOT NULL DEFAULT 'Critical'`,
    );
  });

  test("touches nothing but the one column", () => {
    const statements: Array<string> =
      readMigration().match(/queryRunner\.query\(/g) || [];

    // One statement up, one down.
    expect(statements).toHaveLength(2);
  });

  test("down() removes the column", () => {
    expect(readMigration()).toContain(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "pushNotificationLevel"`,
    );
  });

  test("names its class after its file's timestamp", () => {
    const migration: string = readMigration();

    expect(migration).toContain(`export class ${MIGRATION_CLASS}`);
    expect(migration).toContain(`"${MIGRATION_CLASS}"`);
  });

  test("is registered, so the column exists at runtime", () => {
    /*
     * A migration missing from Index.ts never runs: the column would be absent
     * while the paging path selects it, which fails the very query that sends
     * the page.
     */
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    // Imported AND listed in the exported array - the import alone does nothing.
    expect(index.match(new RegExp(MIGRATION_CLASS, "g"))?.length).toBe(2);
    expect(index).toContain(
      `from "./1801550000000-AddUserNotificationRulePushNotificationLevel"`,
    );
  });

  test("does not rewrite the table, so it is safe on a large install", () => {
    /*
     * A constant default is a catalog-only change on Postgres 11+. A
     * computed default, an UPDATE backfill or a type change would rewrite
     * every rule row under an exclusive lock.
     */
    const migration: string = readMigration();

    expect(migration).not.toMatch(/UPDATE\s+"UserNotificationRule"/);
    expect(migration).not.toContain("ALTER COLUMN");
    expect(migration).not.toContain("CREATE INDEX");
  });
});

describe("UserNotificationRule.pushNotificationLevel access control", () => {
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

  test("is changeable later, exactly as the escalation delay is", () => {
    /*
     * The pill on every push rule's row writes this column on its own, so it
     * has to be open to update. It mirrors notifyAfterMinutes rather than the
     * method foreign keys: changing it moves no page anywhere.
     */
    const rule: UserNotificationRule = new UserNotificationRule();

    expect(rule.getColumnAccessControlFor(COLUMN)?.update).toEqual(
      rule.getColumnAccessControlFor("notifyAfterMinutes")?.update,
    );
    expect(rule.getColumnAccessControlFor(COLUMN)?.update).toEqual([
      Permission.CurrentUser,
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectUserNotificationRule,
    ]);
  });

  test.each([
    [PushNotificationLevel.Critical],
    [PushNotificationLevel.Standard],
  ])(
    "a member may set their own rule to %s",
    (level: PushNotificationLevel) => {
      expect(() => {
        return ColumnPermissions.checkDataColumnPermissions(
          UserNotificationRule,
          ruleSettingLevel(level),
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
    "an administrator holding %s may change a member's level",
    (grant: Permission) => {
      expect(() => {
        return ColumnPermissions.checkDataColumnPermissions(
          UserNotificationRule,
          ruleSettingLevel(PushNotificationLevel.Standard),
          tenantProps(grant),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    },
  );

  test("the level can be set on create alongside the rule's other columns", () => {
    const rule: UserNotificationRule = ruleSettingLevel(
      PushNotificationLevel.Standard,
    );
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
     * carries the level AND a new owner is refused as a whole.
     */
    const rule: UserNotificationRule = ruleSettingLevel(
      PushNotificationLevel.Standard,
    );
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
