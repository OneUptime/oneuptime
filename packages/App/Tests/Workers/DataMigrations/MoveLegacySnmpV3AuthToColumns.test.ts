import MoveLegacySnmpV3AuthToColumns, {
  LEGACY_SNMP_V3_AUTH_FIELDS,
} from "../../../FeatureSet/Workers/DataMigrations/MoveLegacySnmpV3AuthToColumns";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import { JSONObject } from "Common/Types/JSON";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A NETWORK DEVICE'S LEGACY SNMP V3 OBJECT MOVES INTO ITS COLUMNS (#9268).
 *
 * A device whose v3 credentials were only in its deprecated snmpV3Auth
 * object was pinged and never walked: the poll decided on the snmpV3*
 * columns alone. MoveLegacySnmpV3AuthToColumns writes each such object's
 * six fields into the columns, as stored, and clears every object, so the
 * device's Settings show its credentials, its poll walks it with them and
 * Ping only clears them. Pinned here with the table answered in memory as
 * Postgres answers the two statements it sends:
 *
 *   1. it is registered once, after EncryptSnmpCredentials and before the
 *      last slot;
 *   2. a device with only the object gets all six columns from it, the
 *      object cleared, each value exactly as stored - a key the upgrade
 *      left as written stays as written for the job to encrypt a day later,
 *      a ciphertext moves as the same ciphertext;
 *   3. a device whose columns hold a username, and an object with none,
 *      only have the object cleared;
 *   4. each write is held to the object and the username read, so a device
 *      saved meanwhile is left as its save left it;
 *   5. a second run reads nothing and writes nothing, every page is read,
 *      and a device that cannot be written costs the others nothing, with
 *      no value in the log;
 *   6. a moved device is walked with the very credentials it was walked
 *      with before.
 */

const MIGRATION_NAME: string = "MoveLegacySnmpV3AuthToColumns";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

const SELECT_PAGE: RegExp =
  /^SELECT "_id", "snmpV3Auth", "snmpV3Username" FROM "NetworkDevice" WHERE "snmpV3Auth" IS NOT NULL( AND "_id" > \$1)? ORDER BY "_id" ASC LIMIT (\d+)$/;
const UPDATE_ROW: RegExp =
  /^UPDATE "NetworkDevice" SET (.+) WHERE "_id" = \$(\d+) AND "snmpV3Auth" = \$(\d+)::jsonb AND "snmpV3Username" IS NOT DISTINCT FROM \$(\d+)$/;
const ASSIGNMENT: RegExp = /^"(\w+)" = \$(\d+)$/;

const LEGACY_AUTH_KEY: string = "a legacy auth passphrase";
const LEGACY_PRIV_KEY: string = "a legacy privacy passphrase";

const LEGACY: JSONObject = {
  securityLevel: "authPriv",
  username: "legacy-monitoring",
  authProtocol: "SHA",
  authKey: LEGACY_AUTH_KEY,
  privProtocol: "AES",
  privKey: LEGACY_PRIV_KEY,
};

type Row = Record<string, unknown>;

interface Table {
  rows: Array<Row>;
  statements: Array<{ sql: string; params: Array<unknown> }>;
  // Run before an UPDATE applies: a save made in between, or a failure.
  beforeUpdate: ((id: string) => void) | null;
  failRead: boolean;
}

function idOf(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  // jsonb compares by content, whatever the order of an object's keys.
  const normalize: (value: unknown) => string = (value: unknown): string => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return JSON.stringify(
        Object.keys(value as Row)
          .sort()
          .map((key: string): [string, unknown] => {
            return [key, (value as Row)[key]];
          }),
      );
    }

    return JSON.stringify(value);
  };

  return normalize(left) === normalize(right);
}

function stubTable(rows: Array<Row>): Table {
  const table: Table = {
    rows: rows.map((row: Row): Row => {
      return JSON.parse(JSON.stringify(row));
    }),
    statements: [],
    beforeUpdate: null,
    failRead: false,
  };

  const query: (
    sql: string,
    params?: Array<unknown>,
  ) => Promise<unknown> = async (
    sql: string,
    params: Array<unknown> = [],
  ): Promise<unknown> => {
    table.statements.push({ sql: sql, params: [...params] });

    const page: RegExpMatchArray | null = sql.match(SELECT_PAGE);

    if (page) {
      if (table.failRead) {
        throw new Error("read failed");
      }

      const afterId: string | null = page[1] ? String(params[0]) : null;

      return table.rows
        .filter((row: Row): boolean => {
          return (
            row["snmpV3Auth"] !== null &&
            row["snmpV3Auth"] !== undefined &&
            (afterId === null || String(row["_id"]) > afterId)
          );
        })
        .sort((left: Row, right: Row): number => {
          return String(left["_id"]) < String(right["_id"]) ? -1 : 1;
        })
        .slice(0, Number(page[2]))
        .map((row: Row): Row => {
          return {
            _id: row["_id"],
            snmpV3Auth: JSON.parse(JSON.stringify(row["snmpV3Auth"])),
            snmpV3Username:
              row["snmpV3Username"] === undefined
                ? null
                : row["snmpV3Username"],
          };
        });
    }

    const update: RegExpMatchArray | null = sql.match(UPDATE_ROW);

    if (update) {
      const id: string = String(params[Number(update[2]) - 1]);
      const objectRead: unknown = JSON.parse(
        String(params[Number(update[3]) - 1]),
      );
      const usernameRead: unknown = params[Number(update[4]) - 1];

      if (table.beforeUpdate) {
        table.beforeUpdate(id);
      }

      for (const row of table.rows) {
        const username: unknown =
          row["snmpV3Username"] === undefined ? null : row["snmpV3Username"];

        if (
          row["_id"] === id &&
          sameJson(row["snmpV3Auth"], objectRead) &&
          username === usernameRead
        ) {
          for (const assignment of update[1]!.split(", ")) {
            const match: RegExpMatchArray | null = assignment.match(ASSIGNMENT);

            if (!match) {
              throw new Error(`an unexpected assignment: ${assignment}`);
            }

            row[match[1]!] = params[Number(match[2]) - 1];
          }
        }
      }

      return [[], 1];
    }

    throw new Error(`an unexpected statement: ${sql}`);
  };

  jest.spyOn(NetworkDeviceService, "getRepository").mockReturnValue({
    metadata: { tableName: "NetworkDevice" },
    manager: { query: query },
  } as never);

  return table;
}

function updates(table: Table): Array<{ sql: string; params: Array<unknown> }> {
  return table.statements.filter((statement: { sql: string }): boolean => {
    return statement.sql.startsWith("UPDATE");
  });
}

function rowOf(table: Table, id: string): Row {
  return table.rows.find((row: Row): boolean => {
    return row["_id"] === id;
  })!;
}

async function migrate(): Promise<void> {
  await new MoveLegacySnmpV3AuthToColumns().migrate();
}

function loggedText(): string {
  return JSON.stringify(
    [logger.error, logger.info, logger.warn, logger.debug].map(
      (spy: unknown): unknown => {
        return (spy as jest.Mock).mock.calls;
      },
    ),
  );
}

// The walk a device's own credentials give it, as the poll builds it.
function walkOf(row: Row): MonitorStepSnmpMonitor {
  const device: NetworkDevice = new NetworkDevice();

  Object.assign(device, {
    _id: row["_id"],
    hostname: "10.0.0.1",
    snmpVersion: "V3",
    ...row,
  });

  return NetworkDeviceHydrationUtil.buildSnmpMonitorConfig({
    hostname: "10.0.0.1",
    credentials: device,
    oids: [],
    monitorInterfaces: true,
  });
}

describe("MoveLegacySnmpV3AuthToColumns", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, after EncryptSnmpCredentials and before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(NEW_MIGRATION_CALL),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("EncryptSnmpCredentials"),
    );
    expect(registered.indexOf("EncryptSnmpCredentials")).toBeGreaterThan(-1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(new MoveLegacySnmpV3AuthToColumns().name).toBe(MIGRATION_NAME);
  });

  test("moves into the six snmpV3* columns every field the walk read from the object", () => {
    const device: NetworkDevice = new NetworkDevice();

    for (const { column } of LEGACY_SNMP_V3_AUTH_FIELDS) {
      // Every column it writes is the device's.
      expect(device.getTableColumnMetadata(column)).toBeTruthy();
    }

    expect(
      LEGACY_SNMP_V3_AUTH_FIELDS.map((entry: { field: string }): string => {
        return entry.field;
      }),
    ).toEqual([
      "username",
      "securityLevel",
      "authProtocol",
      "authKey",
      "privProtocol",
      "privKey",
    ]);
  });

  test("a device with only the object: its credentials move into the columns, as stored, and the object is cleared", async () => {
    const table: Table = stubTable([
      { _id: idOf(1), snmpV3Auth: LEGACY, snmpV3Username: null },
    ]);

    await migrate();

    expect(rowOf(table, idOf(1))).toEqual({
      _id: idOf(1),
      snmpV3Auth: null,
      snmpV3Username: "legacy-monitoring",
      snmpV3SecurityLevel: "authPriv",
      snmpV3AuthProtocol: "SHA",
      // As written: a server of the release before walks with it too.
      snmpV3AuthKey: LEGACY_AUTH_KEY,
      snmpV3PrivProtocol: "AES",
      snmpV3PrivKey: LEGACY_PRIV_KEY,
    });
  });

  test("a key encrypted already moves as the same ciphertext: never encrypted twice", async () => {
    const authKey: string = await Encryption.encrypt(LEGACY_AUTH_KEY);
    const privKey: string = await Encryption.encrypt(LEGACY_PRIV_KEY);
    const table: Table = stubTable([
      {
        _id: idOf(1),
        snmpV3Auth: { ...LEGACY, authKey: authKey, privKey: privKey },
        snmpV3Username: "",
      },
    ]);

    await migrate();

    expect(rowOf(table, idOf(1))["snmpV3AuthKey"]).toBe(authKey);
    expect(rowOf(table, idOf(1))["snmpV3PrivKey"]).toBe(privKey);
    expect(
      await Encryption.decrypt(
        rowOf(table, idOf(1))["snmpV3AuthKey"] as string,
      ),
    ).toBe(LEGACY_AUTH_KEY);
  });

  test("a field the object lacks is written as none, as the walk had none", async () => {
    const table: Table = stubTable([
      {
        _id: idOf(1),
        snmpV3Auth: { securityLevel: "noAuthNoPriv", username: "watcher" },
        snmpV3Username: null,
        // A protocol left in a column is not the device's: the walk read the object.
        snmpV3AuthProtocol: "MD5",
      },
    ]);

    await migrate();

    expect(rowOf(table, idOf(1))).toEqual({
      _id: idOf(1),
      snmpV3Auth: null,
      snmpV3Username: "watcher",
      snmpV3SecurityLevel: "noAuthNoPriv",
      snmpV3AuthProtocol: null,
      snmpV3AuthKey: null,
      snmpV3PrivProtocol: null,
      snmpV3PrivKey: null,
    });
  });

  test("a device whose columns hold a username, and an object with none, only lose the object", async () => {
    const table: Table = stubTable([
      {
        _id: idOf(1),
        snmpV3Auth: { ...LEGACY, username: "stale" },
        snmpV3Username: "monitoring",
        snmpV3AuthKey: "the columns' key",
      },
      {
        _id: idOf(2),
        snmpV3Auth: { securityLevel: "authPriv", authKey: "orphan" },
        snmpV3Username: null,
      },
      { _id: idOf(3), snmpV3Auth: "text where an object belongs" },
    ]);

    await migrate();

    expect(rowOf(table, idOf(1))).toEqual({
      _id: idOf(1),
      snmpV3Auth: null,
      snmpV3Username: "monitoring",
      snmpV3AuthKey: "the columns' key",
    });
    expect(rowOf(table, idOf(2))).toEqual({
      _id: idOf(2),
      snmpV3Auth: null,
      snmpV3Username: null,
    });
    expect(rowOf(table, idOf(3))["snmpV3Auth"]).toBeNull();

    for (const update of updates(table).slice(0, 2)) {
      expect(update.sql).toMatch(
        /^UPDATE "NetworkDevice" SET "snmpV3Auth" = \$1 WHERE/,
      );
    }
  });

  test("each write is held to the object and the username read: a device saved meanwhile is left as its save left it", async () => {
    const table: Table = stubTable([
      { _id: idOf(1), snmpV3Auth: LEGACY, snmpV3Username: null },
      { _id: idOf(2), snmpV3Auth: LEGACY, snmpV3Username: null },
    ]);

    table.beforeUpdate = (id: string): void => {
      if (id === idOf(1)) {
        // Its Settings saved, with credentials of its own, in between.
        rowOf(table, idOf(1))["snmpV3Username"] = "saved-meanwhile";
      }
    };

    await migrate();

    expect(rowOf(table, idOf(1))).toEqual({
      _id: idOf(1),
      snmpV3Auth: LEGACY,
      snmpV3Username: "saved-meanwhile",
    });
    expect(rowOf(table, idOf(2))["snmpV3Username"]).toBe("legacy-monitoring");

    const first: { sql: string; params: Array<unknown> } = updates(table)[0]!;

    // The object and the username read, compared: never written blind.
    expect(first.params.slice(-3)).toEqual([
      idOf(1),
      JSON.stringify(LEGACY),
      null,
    ]);
  });

  test("a second run reads nothing and writes nothing", async () => {
    const table: Table = stubTable([
      { _id: idOf(1), snmpV3Auth: LEGACY, snmpV3Username: null },
    ]);

    await migrate();

    const afterFirst: string = JSON.stringify(table.rows);
    table.statements = [];

    await migrate();

    expect(updates(table)).toHaveLength(0);
    expect(JSON.stringify(table.rows)).toBe(afterFirst);
  });

  test("reads every page, and moves every device on it", async () => {
    const count: number = MoveLegacySnmpV3AuthToColumns.PAGE_SIZE * 2 + 3;
    const rows: Array<Row> = [];

    for (let index: number = 1; index <= count; index++) {
      rows.push({
        _id: idOf(index),
        snmpV3Auth: { ...LEGACY, username: `user-${index}` },
        snmpV3Username: null,
      });
    }

    const table: Table = stubTable(rows);

    await migrate();

    expect(updates(table)).toHaveLength(count);

    for (let index: number = 1; index <= count; index++) {
      expect(rowOf(table, idOf(index))["snmpV3Username"]).toBe(`user-${index}`);
    }
  });

  test("a device that cannot be written costs the others nothing, and no value reaches the log", async () => {
    const table: Table = stubTable([
      { _id: idOf(1), snmpV3Auth: LEGACY, snmpV3Username: null },
      { _id: idOf(2), snmpV3Auth: LEGACY, snmpV3Username: null },
    ]);

    table.beforeUpdate = (id: string): void => {
      if (id === idOf(1)) {
        throw new Error(
          `value too long: ${LEGACY_AUTH_KEY} / ${LEGACY_PRIV_KEY}`,
        );
      }
    };

    await expect(migrate()).resolves.toBeUndefined();

    // Its poll still reads its object.
    expect(rowOf(table, idOf(1))["snmpV3Auth"]).toEqual(LEGACY);
    expect(rowOf(table, idOf(2))["snmpV3Username"]).toBe("legacy-monitoring");

    const logged: string = loggedText();

    expect(logged).toContain(idOf(1));
    expect(logged).not.toContain(LEGACY_AUTH_KEY);
    expect(logged).not.toContain(LEGACY_PRIV_KEY);
  });

  test("a read that fails writes nothing, and does not throw", async () => {
    const table: Table = stubTable([
      { _id: idOf(1), snmpV3Auth: LEGACY, snmpV3Username: null },
    ]);

    table.failRead = true;

    await expect(migrate()).resolves.toBeUndefined();

    expect(updates(table)).toHaveLength(0);
    expect(loggedText()).toContain("failed to read");
  });

  test("a moved device is walked with the very credentials it was walked with before", async () => {
    const before: Row = {
      _id: idOf(1),
      snmpV3Auth: LEGACY,
      snmpV3Username: null,
    };
    const table: Table = stubTable([before]);

    await migrate();

    const after: Row = rowOf(table, idOf(1));

    expect(walkOf(after).snmpV3Auth).toEqual(walkOf(before).snmpV3Auth);
    expect(
      NetworkDeviceHydrationUtil.resolvePollMode({
        snmpVersion: "V3",
        snmpV3Username: after["snmpV3Username"] as string,
      }),
    ).toBe("snmp");
  });

  test("rollback changes nothing", async () => {
    const table: Table = stubTable([
      { _id: idOf(1), snmpV3Auth: LEGACY, snmpV3Username: null },
    ]);

    await new MoveLegacySnmpV3AuthToColumns().rollback();

    expect(table.statements).toHaveLength(0);
  });
});
