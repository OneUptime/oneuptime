import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../Server/Services/ProbeService";
import SnmpTrapReceiverUsers from "../../../Server/Utils/Monitor/SnmpTrapReceiverUsers";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
  SnmpTrapRefusalReason,
} from "../../../Types/Probe/SnmpTrapReceiver";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * THE TWO STATEMENTS A PROBE'S SNMP TRAP RECEIVER RUNS ON, ON A REAL
 * POSTGRES (OneUptime issue #11005).
 *
 *   - NetworkDeviceService.findDeviceIdsWithSnmpV3OnProbe: the devices whose
 *     SNMPv3 users a probe is handed - its own devices only, held to the
 *     poll claim's tenancy check and to served projects, with an SNMPv3
 *     credential on any layer (the device, its profile, its site's).
 *   - ProbeService.recordSnmpTrapReceiverReport: the report kept on a
 *     project's own probe, written only when it changed, never on a global
 *     probe.
 *
 * And SnmpTrapReceiverUsers.getUsersForProbe end to end over those rows:
 * what a probe is actually handed.
 *
 * Opt in with RUN_POSTGRES_SNMP_TRAP_RECEIVER_TESTS=true against a Postgres
 * migrated to the current head. The tables' STRUCTURE is cloned into a
 * unique schema (search_path holds only that schema), dropped afterwards;
 * every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from SNMP_TRAP_RECEIVER_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from SNMP_TRAP_RECEIVER_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SNMP_TRAP_RECEIVER_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "NetworkSnmpCredentialProfile",
  "NetworkSite",
  "NetworkDevice",
];

const LOCK_TIMEOUT_MS: number = 5000;

describePostgres("a probe's SNMP trap receiver, on Postgres", () => {
  const schema: string = `snmp_trap_receiver_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  const PROJECT: ObjectID = ObjectID.generate();
  const OTHER_PROJECT: ObjectID = ObjectID.generate();
  const BLOCKED_PROJECT: ObjectID = ObjectID.generate();
  const UNPAID_PROJECT: ObjectID = ObjectID.generate();
  const PROBE: ObjectID = ObjectID.generate();
  const OTHER_PROBE: ObjectID = ObjectID.generate();
  const GLOBAL_PROBE: ObjectID = ObjectID.generate();
  const V3_PROFILE: ObjectID = ObjectID.generate();
  const V2C_PROFILE: ObjectID = ObjectID.generate();
  const DELETED_V3_PROFILE: ObjectID = ObjectID.generate();
  const SITE_WITH_V3: ObjectID = ObjectID.generate();
  const DELETED_SITE: ObjectID = ObjectID.generate();

  async function insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${table}" (${columns
        .map((column: string) => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number) => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string) => {
        return row[column];
      }),
    );
  }

  async function addDevice(row: Record<string, unknown>): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert("NetworkDevice", {
      _id: id.toString(),
      projectId: PROJECT.toString(),
      probeId: PROBE.toString(),
      hostname: "10.20.0.1",
      ...row,
    });

    return id;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["SNMP_TRAP_RECEIVER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["SNMP_TRAP_RECEIVER_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SNMP_TRAP_RECEIVER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        max: 4,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      // A fixture names only what the statements touch.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'
           AND column_name NOT IN ('_id', 'isGlobalProbe', 'isBlocked')`,
        [schema, table],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);

    for (const [id, fields] of [
      [PROJECT, {}],
      [OTHER_PROJECT, {}],
      [BLOCKED_PROJECT, { isBlocked: true }],
      [UNPAID_PROJECT, { paymentProviderSubscriptionStatus: "canceled" }],
    ] as Array<[ObjectID, Record<string, unknown>]>) {
      await insert("Project", {
        _id: id.toString(),
        name: `project ${id.toString()}`,
        isBlocked: false,
        ...fields,
      });
    }

    await insert("Probe", {
      _id: PROBE.toString(),
      projectId: PROJECT.toString(),
      isGlobalProbe: false,
      name: "lab probe",
    });
    await insert("Probe", {
      _id: OTHER_PROBE.toString(),
      projectId: PROJECT.toString(),
      isGlobalProbe: false,
      name: "other probe",
    });
    await insert("Probe", {
      _id: GLOBAL_PROBE.toString(),
      isGlobalProbe: true,
      name: "global probe",
    });

    await insert("NetworkSnmpCredentialProfile", {
      _id: V3_PROFILE.toString(),
      projectId: PROJECT.toString(),
      name: "fabric traps",
      snmpVersion: "V3",
      snmpV3SecurityLevel: "authPriv",
      snmpV3Username: "fabric-traps",
      snmpV3AuthProtocol: "SHA256",
      snmpV3AuthKey: "fabric-auth-passphrase",
      snmpV3PrivProtocol: "AES256",
      snmpV3PrivKey: "fabric-priv-passphrase",
    });
    await insert("NetworkSnmpCredentialProfile", {
      _id: V2C_PROFILE.toString(),
      projectId: PROJECT.toString(),
      name: "read only",
      snmpVersion: "V2c",
      snmpCommunityString: "public",
    });
    await insert("NetworkSnmpCredentialProfile", {
      _id: DELETED_V3_PROFILE.toString(),
      projectId: PROJECT.toString(),
      name: "deleted",
      snmpVersion: "V3",
      snmpV3Username: "deleted-profile-user",
      deletedAt: new Date(),
    });

    await insert("NetworkSite", {
      _id: SITE_WITH_V3.toString(),
      projectId: PROJECT.toString(),
      name: "datacenter",
      snmpCredentialProfileId: V3_PROFILE.toString(),
    });
    await insert("NetworkSite", {
      _id: DELETED_SITE.toString(),
      projectId: PROJECT.toString(),
      name: "closed",
      snmpCredentialProfileId: V3_PROFILE.toString(),
      deletedAt: new Date(),
    });
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    await database.query(`DELETE FROM "NetworkDevice"`);
    await database.query(`UPDATE "Probe" SET "snmpTrapReceiver" = NULL`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function idsOn(
    probe: ObjectID,
    limit: number = 100,
  ): Promise<Array<string>> {
    return (
      await NetworkDeviceService.findDeviceIdsWithSnmpV3OnProbe({
        probeId: probe,
        limit: limit,
      })
    )
      .map((id: ObjectID) => {
        return id.toString();
      })
      .sort();
  }

  describe("which devices' users a probe is handed", () => {
    test("an SNMPv3 credential on any layer: the device's, its profile's, its site's", async () => {
      const own: ObjectID = await addDevice({
        snmpVersion: "V3",
        snmpV3Username: "own",
      });
      const viaProfile: ObjectID = await addDevice({
        snmpVersion: "V2c",
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });
      const viaSite: ObjectID = await addDevice({
        snmpVersion: "V2c",
        siteId: SITE_WITH_V3.toString(),
      });

      await addDevice({ snmpVersion: "V2c", snmpCommunityString: "public" });
      await addDevice({
        snmpVersion: "V2c",
        snmpCredentialProfileId: V2C_PROFILE.toString(),
      });
      await addDevice({ snmpVersion: null });

      expect(await idsOn(PROBE)).toEqual(
        [own, viaProfile, viaSite]
          .map((id: ObjectID) => {
            return id.toString();
          })
          .sort(),
      );
    });

    test("the version as people and the API write it: V3, v3, 3, with spaces", async () => {
      const spellings: Array<ObjectID> = [];

      for (const spelling of ["V3", "v3", "3", " V3 "]) {
        spellings.push(await addDevice({ snmpVersion: spelling }));
      }

      await addDevice({ snmpVersion: "V2c" });
      await addDevice({ snmpVersion: "1" });

      expect(await idsOn(PROBE)).toHaveLength(spellings.length);
    });

    test("only this probe's devices", async () => {
      const mine: ObjectID = await addDevice({ snmpVersion: "V3" });
      await addDevice({ snmpVersion: "V3", probeId: OTHER_PROBE.toString() });
      await addDevice({ snmpVersion: "V3", probeId: null });

      expect(await idsOn(PROBE)).toEqual([mine.toString()]);
    });

    test("a project probe never takes another project's device, whatever points it there", async () => {
      await addDevice({
        snmpVersion: "V3",
        projectId: OTHER_PROJECT.toString(),
      });

      expect(await idsOn(PROBE)).toEqual([]);
    });

    test("a global probe takes the devices assigned to it, of any project", async () => {
      const ours: ObjectID = await addDevice({
        snmpVersion: "V3",
        probeId: GLOBAL_PROBE.toString(),
      });
      const theirs: ObjectID = await addDevice({
        snmpVersion: "V3",
        probeId: GLOBAL_PROBE.toString(),
        projectId: OTHER_PROJECT.toString(),
      });

      expect(await idsOn(GLOBAL_PROBE)).toEqual(
        [ours.toString(), theirs.toString()].sort(),
      );
    });

    test("not a deleted device, nor one of a blocked or unpaid project", async () => {
      await addDevice({ snmpVersion: "V3", deletedAt: new Date() });
      await addDevice({
        snmpVersion: "V3",
        projectId: BLOCKED_PROJECT.toString(),
        probeId: GLOBAL_PROBE.toString(),
      });
      await addDevice({
        snmpVersion: "V3",
        projectId: UNPAID_PROJECT.toString(),
        probeId: GLOBAL_PROBE.toString(),
      });

      expect(await idsOn(PROBE)).toEqual([]);
      expect(await idsOn(GLOBAL_PROBE)).toEqual([]);
    });

    test("a deleted profile or site counts for nothing", async () => {
      await addDevice({
        snmpVersion: "V2c",
        snmpCredentialProfileId: DELETED_V3_PROFILE.toString(),
      });
      await addDevice({ snmpVersion: "V2c", siteId: DELETED_SITE.toString() });

      expect(await idsOn(PROBE)).toEqual([]);
    });

    test("polling switched off still counts: a paused device's traps are still its own", async () => {
      const paused: ObjectID = await addDevice({
        snmpVersion: "V3",
        isPollingEnabled: false,
      });

      expect(await idsOn(PROBE)).toEqual([paused.toString()]);
    });

    test("at most the limit asked for", async () => {
      for (let index: number = 0; index < 5; index++) {
        await addDevice({ snmpVersion: "V3" });
      }

      expect(await idsOn(PROBE, 3)).toHaveLength(3);
    });
  });

  test("what the probe is handed, end to end: each credential once, with every address", async () => {
    await addDevice({
      hostname: "10.20.0.5",
      snmpVersion: "V3",
      snmpV3SecurityLevel: "authNoPriv",
      snmpV3Username: "san-monitor",
      snmpV3AuthProtocol: "SHA-256",
      snmpV3AuthKey: "own-auth-passphrase",
      siteId: SITE_WITH_V3.toString(),
    });
    await addDevice({
      hostname: "10.20.0.6",
      otherAddresses: "10.99.0.6",
      snmpVersion: "V2c",
      snmpCommunityString: "public",
      snmpCredentialProfileId: V3_PROFILE.toString(),
    });
    await addDevice({
      hostname: "10.20.0.7",
      snmpVersion: "V3",
      projectId: OTHER_PROJECT.toString(),
      snmpV3Username: "leak",
    });

    const users: Array<SnmpTrapReceiverUser> =
      await SnmpTrapReceiverUsers.getUsersForProbe(PROBE);

    expect(
      users
        .map((user: SnmpTrapReceiverUser) => {
          // Devices are read in ID order: the addresses, as a set.
          return `${user.userName} ${user.securityLevel} ${user.authProtocol || ""} ${user.addresses.slice().sort().join(",")}`;
        })
        .sort(),
    ).toEqual([
      "fabric-traps authPriv SHA256 10.20.0.5,10.20.0.6,10.99.0.6",
      "san-monitor authNoPriv SHA256 10.20.0.5",
    ]);

    const fabric: SnmpTrapReceiverUser = users.find(
      (user: SnmpTrapReceiverUser) => {
        return user.userName === "fabric-traps";
      },
    )!;
    expect(fabric.securityLevel).toBe(SnmpSecurityLevel.AuthPriv);
    expect(fabric.authKey).toBe("fabric-auth-passphrase");
    expect(fabric.privKey).toBe("fabric-priv-passphrase");
  });

  describe("the report kept on the probe", () => {
    const REPORT: SnmpTrapReceiverReport = {
      isEnabled: true,
      port: 162,
      engineId: "8000B98380A1B2C3D4E5F60718293A4B",
      userCount: 2,
      refusals: [
        {
          sourceAddress: "10.20.0.5",
          reason: SnmpTrapRefusalReason.UnknownUser,
          userName: "san-monitor",
          count: 12,
          firstSeenAt: "2026-11-24T10:00:00.000Z",
          lastSeenAt: "2026-11-24T11:00:00.000Z",
        },
      ],
    };

    async function stored(probe: ObjectID): Promise<{
      report: unknown;
      xmin: string;
    }> {
      const rows: Array<{ snmpTrapReceiver: unknown; xmin: string }> =
        await database.query(
          `SELECT "snmpTrapReceiver", xmin::text AS xmin FROM "Probe" WHERE "_id" = $1`,
          [probe.toString()],
        );

      return { report: rows[0]!.snmpTrapReceiver, xmin: rows[0]!.xmin };
    }

    test("a project probe's is kept, as sent", async () => {
      expect(
        await ProbeService.recordSnmpTrapReceiverReport({
          probeId: PROBE,
          report: REPORT,
        }),
      ).toBe(true);

      expect((await stored(PROBE)).report).toEqual(REPORT);
    });

    test("the same report again writes no new row version", async () => {
      await ProbeService.recordSnmpTrapReceiverReport({
        probeId: PROBE,
        report: REPORT,
      });
      const before: string = (await stored(PROBE)).xmin;

      expect(
        await ProbeService.recordSnmpTrapReceiverReport({
          probeId: PROBE,
          report: { ...REPORT },
        }),
      ).toBe(true);
      expect((await stored(PROBE)).xmin).toBe(before);

      await ProbeService.recordSnmpTrapReceiverReport({
        probeId: PROBE,
        report: { ...REPORT, userCount: 3 },
      });
      expect((await stored(PROBE)).xmin).not.toBe(before);
    });

    test("a global probe keeps none: its refusals would name other projects' addresses", async () => {
      expect(
        await ProbeService.recordSnmpTrapReceiverReport({
          probeId: GLOBAL_PROBE,
          report: REPORT,
        }),
      ).toBe(false);

      expect((await stored(GLOBAL_PROBE)).report).toBeNull();
    });

    test("a probe that is not there keeps nothing, and nothing fails", async () => {
      expect(
        await ProbeService.recordSnmpTrapReceiverReport({
          probeId: ObjectID.generate(),
          report: REPORT,
        }),
      ).toBe(false);
    });
  });
});
