/**
 * UserPush.criticalAlertSound and UserPush.criticalAlertVolume column
 * contract.
 *
 * The alarm a critical on-call page plays on a handset, and on an iPhone how
 * loud. Both are read on the paging path and stamped straight onto the push,
 * so a property quietly changed here changes what a sleeping responder hears:
 * a default other than the system sound at full volume re-pages every device
 * that never chose with something nobody picked, a nullable column hands the
 * delivery path a value it has to guess about, and a column the generic CRUD
 * surface can write is a column something other than the phone's own app can
 * turn down.
 *
 * The three "default" mechanisms are separate and easy to confuse:
 * - NEW rows get 'default' / 100 from the Postgres column default (@Column
 *   default)
 * - EXISTING rows got them from the migration's NOT NULL DEFAULT
 * - @TableColumn defaultValue is what the generated API schema documents; it
 *   defaults nothing in the database
 */

import UserPush from "../../Models/DatabaseModels/UserPush";
import DatabaseRequestType from "../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Server/Types/Database/Permissions/ColumnPermission";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  DEFAULT_CRITICAL_ALERT_SOUND,
  isCriticalAlertSound,
} from "../../Types/PushNotification/CriticalAlertSound";
import {
  CRITICAL_ALERT_VOLUME_MAX_PERCENT,
  CRITICAL_ALERT_VOLUME_MIN_PERCENT,
  CRITICAL_ALERT_VOLUME_OPTIONS,
  DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,
  isCriticalAlertVolumePercent,
} from "../../Types/PushNotification/CriticalAlertVolume";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import UserType from "../../Types/UserType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const SOUND: string = "criticalAlertSound";
const VOLUME: string = "criticalAlertVolume";

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

function metadata(column: string): TableColumnMetadata {
  return new UserPush().getTableColumnMetadata(column);
}

function typeOrmColumn(column: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (candidate: ColumnMetadataArgs): boolean => {
      return candidate.target === UserPush && candidate.propertyName === column;
    },
  );
}

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

/*
 * The statement TypeORM generates to add a column as the model declares it:
 * the Postgres type, NOT NULL, and the default quoted the way the generator
 * quotes every string and number default. Built from the model's own
 * metadata, so a default or a type changed on the model without a migration
 * that says the same fails here - the same mismatch fails the Schema Drift
 * job in CI.
 */
function addColumnStatement(table: string, column: string): string {
  const options: ColumnMetadataArgs["options"] = typeOrmColumn(column)!.options;
  const declaredType: string = String(options.type);

  let postgresType: string;

  if (declaredType === ColumnType.ShortText) {
    postgresType = `character varying(${String(options.length)})`;
  } else if (declaredType === ColumnType.Number) {
    postgresType = "integer";
  } else {
    throw new Error(`This suite does not know how to write ${declaredType}.`);
  }

  const notNull: string = options.nullable === false ? " NOT NULL" : "";
  const columnDefault: string =
    options.default === undefined
      ? ""
      : ` DEFAULT '${String(options.default)}'`;

  return `ALTER TABLE "${table}" ADD "${column}" ${postgresType}${notNull}${columnDefault}`;
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

// A device as the register route builds it for a phone that chose both.
function registeredDevice(): UserPush {
  const device: UserPush = new UserPush();
  device.projectId = PROJECT_ID;
  device.userId = CALLER_ID;
  device.deviceToken = "ExponentPushToken[column-contract-0001]";
  device.deviceType = PushDeviceType.iOS;
  device.deviceName = "iPhone 16";
  device.criticalAlertSound = CriticalAlertSound.Klaxon;
  device.criticalAlertVolume = 75;
  return device;
}

describe("UserPush.criticalAlertSound", () => {
  test("exists as a short text column", () => {
    expect(metadata(SOUND)).toBeDefined();
    expect(metadata(SOUND).type).toBe(TableColumnType.ShortText);
    expect(typeOrmColumn(SOUND)).toBeDefined();
    expect(typeOrmColumn(SOUND)?.options.type).toBe(ColumnType.ShortText);
    expect(typeOrmColumn(SOUND)?.options.length).toBe(ColumnLength.ShortText);
  });

  test("is long enough for every sound id", () => {
    for (const definition of CRITICAL_ALERT_SOUNDS) {
      expect(definition.sound.length).toBeLessThanOrEqual(
        Number(typeOrmColumn(SOUND)?.options.length),
      );
    }
  });

  test("a new device plays the system's own critical sound unless its app chooses another", () => {
    /*
     * The default is what keeps the change invisible on upgrade: every
     * critical page played the system sound before the column existed, and
     * the system sound is the one every app version can play - its Android
     * channel is the original oncall_critical.
     */
    expect(typeOrmColumn(SOUND)?.options.default).toBe(
      CriticalAlertSound.Default,
    );
    expect(typeOrmColumn(SOUND)?.options.default).toBe("default");
    expect(typeOrmColumn(SOUND)?.options.default).toBe(
      DEFAULT_CRITICAL_ALERT_SOUND,
    );
  });

  test("the database default is itself a sound the delivery path knows", () => {
    expect(isCriticalAlertSound(typeOrmColumn(SOUND)?.options.default)).toBe(
      true,
    );
  });

  test("is never null, so the delivery path never has to guess", () => {
    expect(typeOrmColumn(SOUND)?.options.nullable).toBe(false);
  });

  test("is documented as defaulting to the system sound, with a real sound as its example", () => {
    expect(metadata(SOUND).defaultValue).toBe(CriticalAlertSound.Default);
    expect(metadata(SOUND).example).toBe(CriticalAlertSound.Klaxon);
    expect(isCriticalAlertSound(metadata(SOUND).example)).toBe(true);
  });

  test("is a default-value column, so every existing create call keeps working", () => {
    expect(new UserPush().isDefaultValueColumn(SOUND)).toBe(true);
    expect(metadata(SOUND).required).toBeFalsy();
  });

  test("says in the API docs which sounds there are, and where they are chosen", () => {
    const description: string = metadata(SOUND).description || "";

    expect(metadata(SOUND).title).toBe("Critical Alert Sound");

    /*
     * Every id the API accepts is listed, so a sound added to the type
     * without updating the docs - or the other way round - fails here.
     */
    for (const definition of CRITICAL_ALERT_SOUNDS) {
      expect(description).toContain(definition.sound);
    }

    expect(description).toContain("OneUptime On-Call app");
  });

  test("an unchosen sound on a model built in memory reads as not set, not as a sound", () => {
    /*
     * Only the database supplies the default. A model built without the
     * column reads undefined, which the delivery path turns into the default
     * sound rather than into a guess.
     */
    expect(new UserPush().criticalAlertSound).toBeUndefined();
  });
});

describe("UserPush.criticalAlertVolume", () => {
  test("exists as an integer column", () => {
    expect(metadata(VOLUME)).toBeDefined();
    expect(metadata(VOLUME).type).toBe(TableColumnType.Number);
    expect(typeOrmColumn(VOLUME)).toBeDefined();
    expect(typeOrmColumn(VOLUME)?.options.type).toBe(ColumnType.Number);
    expect(typeOrmColumn(VOLUME)?.options.type).toBe("integer");
  });

  test("a new device is paged at full volume unless its app chooses otherwise", () => {
    /*
     * Full volume is what every critical page played before the choice
     * existed. Any lower default would quietly turn down every responder's
     * phone on upgrade.
     */
    expect(typeOrmColumn(VOLUME)?.options.default).toBe(100);
    expect(typeOrmColumn(VOLUME)?.options.default).toBe(
      DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,
    );
    expect(typeOrmColumn(VOLUME)?.options.default).toBe(
      CRITICAL_ALERT_VOLUME_MAX_PERCENT,
    );
  });

  test("the database default is itself a volume the API would store", () => {
    expect(
      isCriticalAlertVolumePercent(typeOrmColumn(VOLUME)?.options.default),
    ).toBe(true);
  });

  test("is never null, so the delivery path never has to guess", () => {
    expect(typeOrmColumn(VOLUME)?.options.nullable).toBe(false);
  });

  test("is documented as defaulting to full volume, with one of the app's steps as its example", () => {
    expect(metadata(VOLUME).defaultValue).toBe(100);
    expect(metadata(VOLUME).example).toBe(75);
    expect(CRITICAL_ALERT_VOLUME_OPTIONS).toContain(metadata(VOLUME).example);
  });

  test("is a default-value column, so every existing create call keeps working", () => {
    expect(new UserPush().isDefaultValueColumn(VOLUME)).toBe(true);
    expect(metadata(VOLUME).required).toBeFalsy();
  });

  test("says in the API docs what the range is and that it is iPhone only", () => {
    const description: string = metadata(VOLUME).description || "";

    expect(metadata(VOLUME).title).toBe("Critical Alert Volume");
    expect(description).toContain(
      `from ${CRITICAL_ALERT_VOLUME_MIN_PERCENT} to ${CRITICAL_ALERT_VOLUME_MAX_PERCENT}`,
    );
    expect(description).toContain("percentage");
    expect(description).toContain("iPhone only");
    expect(description).toContain("Android");
  });

  test("an unchosen volume on a model built in memory reads as not set", () => {
    expect(new UserPush().criticalAlertVolume).toBeUndefined();
  });
});

describe("the migration that adds the sound and volume columns", () => {
  test.each([[SOUND], [VOLUME]])(
    "adds %s exactly as the model declares it, every existing device backfilled with the default",
    (column: string) => {
      expect(readMigration()).toContain(addColumnStatement("UserPush", column));
    },
  );

  test("writes the statements TypeORM generates for these columns", () => {
    /*
     * Spelled out as well as derived, so a change to the derivation above
     * cannot quietly agree with a wrong migration.
     */
    expect(readMigration()).toContain(
      `ALTER TABLE "UserPush" ADD "criticalAlertSound" character varying(100) NOT NULL DEFAULT 'default'`,
    );
    expect(readMigration()).toContain(
      `ALTER TABLE "UserPush" ADD "criticalAlertVolume" integer NOT NULL DEFAULT '100'`,
    );
  });

  test.each([[SOUND], [VOLUME]])("down() removes %s", (column: string) => {
    expect(readMigration()).toContain(
      `ALTER TABLE "UserPush" DROP COLUMN "${column}"`,
    );
  });

  test("is registered, so the columns exist at runtime", () => {
    /*
     * A migration missing from Index.ts never runs: the columns would be
     * absent while the paging path selects them, which fails the very query
     * that sends the page.
     */
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    // Imported AND listed in the exported array - the import alone does nothing.
    expect(index.match(new RegExp(MIGRATION_CLASS, "g"))?.length).toBe(2);
    expect(index).toContain(
      `from "./1801650000000-AddCriticalAlertSoundVolumeAndPushRepeat"`,
    );
  });
});

describe("UserPush.criticalAlertSound and criticalAlertVolume access control", () => {
  /*
   * UserPush is an owner-only table: its table-level `read` names
   * Permission.CurrentUser and nothing else, which is what scopes every read
   * to the caller's own rows. The new columns keep that shape, and - like
   * every other column here - nobody may write them through the generic
   * CRUD update: the critical-alert-preferences route checks the device is
   * the caller's and then writes as root.
   */
  test.each([[SOUND], [VOLUME]])(
    "%s is readable only by the responder it belongs to",
    (column: string) => {
      expect(new UserPush().getColumnAccessControlFor(column)?.read).toEqual([
        Permission.CurrentUser,
      ]);
    },
  );

  test.each([[SOUND], [VOLUME]])(
    "%s is settable at registration by the responder",
    (column: string) => {
      expect(new UserPush().getColumnAccessControlFor(column)?.create).toEqual([
        Permission.CurrentUser,
      ]);
    },
  );

  test.each([[SOUND], [VOLUME]])(
    "%s cannot be written through the generic CRUD update surface",
    (column: string) => {
      expect(new UserPush().getColumnAccessControlFor(column)?.update).toEqual(
        [],
      );
    },
  );

  test.each([[SOUND], [VOLUME]])(
    "%s has exactly the access the critical alert switch beside it has",
    (column: string) => {
      const device: UserPush = new UserPush();

      expect(device.getColumnAccessControlFor(column)).toEqual(
        device.getColumnAccessControlFor("isCriticalAlertEnabled"),
      );
    },
  );

  test("does not widen the table's owner-only read scope", () => {
    expect(new UserPush().getReadPermissions()).toEqual([
      Permission.CurrentUser,
    ]);
  });

  test.each([[SOUND], [VOLUME]])(
    "%s is not marked readable through relation queries",
    (column: string) => {
      /*
       * canReadOnRelationQuery would make the column readable from a nested
       * select on a model whose own read is admin-wide, skipping this table's
       * column check. The paging path reads both as root, so nothing needs it.
       */
      expect(metadata(column).canReadOnRelationQuery).toBeFalsy();
    },
  );

  test("a responder creating their own device may store its sound and volume with it", () => {
    expect(() => {
      return ColumnPermissions.checkDataColumnPermissions(
        UserPush,
        registeredDevice(),
        memberProps(),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test.each([
    [SOUND, CriticalAlertSound.Siren],
    [VOLUME, 25],
  ])(
    "a member's generic update of their own %s is refused",
    (column: string, value: unknown) => {
      const update: UserPush = new UserPush();
      (update as unknown as Record<string, unknown>)[column] = value;

      let refusal: unknown = undefined;

      try {
        ColumnPermissions.checkDataColumnPermissions(
          UserPush,
          update,
          memberProps(),
          DatabaseRequestType.Update,
        );
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as { columnName?: string }).columnName).toBe(column);
    },
  );

  test.each([
    [Permission.ProjectOwner],
    [Permission.ProjectAdmin],
    [Permission.EditProjectUserNotificationRule],
  ])(
    "an administrator holding %s cannot turn a member's alarm down through the CRUD surface",
    (grant: Permission) => {
      /*
       * The sound and the volume decide whether a responder is woken. Only
       * the phone's own app writes them, through the route that checks the
       * device is the caller's.
       */
      const update: UserPush = new UserPush();
      update.criticalAlertVolume = CRITICAL_ALERT_VOLUME_MIN_PERCENT;
      update.criticalAlertSound = CriticalAlertSound.Digital;

      expect(() => {
        return ColumnPermissions.checkDataColumnPermissions(
          UserPush,
          update,
          tenantProps(grant),
          DatabaseRequestType.Update,
        );
      }).toThrow(BadDataException);
    },
  );
});
