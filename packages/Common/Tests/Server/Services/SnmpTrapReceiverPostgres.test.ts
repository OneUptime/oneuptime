import Entities from "../../../Models/DatabaseModels/Index";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import GlobalProbeSnmpTrapReportService from "../../../Server/Services/GlobalProbeSnmpTrapReportService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../Server/Services/ProbeService";
import SnmpTrapReceiverReports from "../../../Server/Utils/Monitor/SnmpTrapReceiverReports";
import SnmpTrapReceiverUsers from "../../../Server/Utils/Monitor/SnmpTrapReceiverUsers";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
  SnmpTrapRefusal,
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
 * Since #11172-#11174, the statements of who else a probe's receiver
 * concerns, each held to the same tenancy:
 *
 *   - findSitesWithSnmpV3DefaultOnProbe: the sites whose own Default Probe
 *     it is, whose default profile it is handed - and, end to end, exactly
 *     which keys reach which probe;
 *   - findDevicesAtAddressesOnProbe and findProbeUseByProject: what a global
 *     probe's refusals are split by, and whether a project may keep a trap
 *     from an address none of its devices has;
 *   - a global probe's report: what belongs to no project on the probe, and
 *     each project's refusals in a row of its own
 *     (GlobalProbeSnmpTrapReportService.recordShares, written only when it
 *     changed), with no project reading another's.
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
  "GlobalProbeSnmpTrapReport",
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
  const SECOND_GLOBAL_PROBE: ObjectID = ObjectID.generate();
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
    await database.query(`DELETE FROM "GlobalProbeSnmpTrapReport"`);
    await database.query(`DELETE FROM "NetworkSite" WHERE "name" LIKE 'test %'`);
    await database.query(
      `DELETE FROM "NetworkSnmpCredentialProfile" WHERE "name" LIKE 'test %'`,
    );
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
      ).toEqual({ isKept: true, isGlobalProbe: false });

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
      ).toEqual({ isKept: true, isGlobalProbe: false });
      expect((await stored(PROBE)).xmin).toBe(before);

      await ProbeService.recordSnmpTrapReceiverReport({
        probeId: PROBE,
        report: { ...REPORT, userCount: 3 },
      });
      expect((await stored(PROBE)).xmin).not.toBe(before);
    });

    test("a global probe keeps only what belongs to no project: never its refusals, users or last trap (#11173)", async () => {
      expect(
        await ProbeService.recordSnmpTrapReceiverReport({
          probeId: GLOBAL_PROBE,
          report: { ...REPORT, lastReceivedAt: "2026-11-24T11:05:00.000Z" },
        }),
      ).toEqual({ isKept: true, isGlobalProbe: true });

      const kept: unknown = (await stored(GLOBAL_PROBE)).report;
      expect(kept).toEqual({
        isEnabled: true,
        port: 162,
        engineId: REPORT.engineId,
        refusals: [],
      });
      expect(JSON.stringify(kept)).not.toContain("10.20.0.5");
      expect(JSON.stringify(kept)).not.toContain("san-monitor");
    });

    test("a global probe's report, the same again, writes no new row version; its refusals changing writes none either", async () => {
      await ProbeService.recordSnmpTrapReceiverReport({
        probeId: GLOBAL_PROBE,
        report: REPORT,
      });
      const before: string = (await stored(GLOBAL_PROBE)).xmin;

      await ProbeService.recordSnmpTrapReceiverReport({
        probeId: GLOBAL_PROBE,
        report: { ...REPORT, refusals: [], userCount: 9 },
      });
      expect((await stored(GLOBAL_PROBE)).xmin).toBe(before);
    });

    test("a probe that is not there keeps nothing, and nothing fails", async () => {
      expect(
        await ProbeService.recordSnmpTrapReceiverReport({
          probeId: ObjectID.generate(),
          report: REPORT,
        }),
      ).toEqual({ isKept: false, isGlobalProbe: false });
    });
  });

  async function addSite(row: Record<string, unknown>): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert("NetworkSite", {
      _id: id.toString(),
      projectId: PROJECT.toString(),
      name: `test site ${id.toString()}`,
      ...row,
    });

    return id;
  }

  async function addProfile(row: Record<string, unknown>): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert("NetworkSnmpCredentialProfile", {
      _id: id.toString(),
      projectId: PROJECT.toString(),
      name: `test profile ${id.toString()}`,
      snmpVersion: "V3",
      snmpV3SecurityLevel: "authPriv",
      snmpV3AuthProtocol: "SHA",
      snmpV3AuthKey: `${String(row["snmpV3Username"] || "x")}-auth`,
      snmpV3PrivProtocol: "AES",
      snmpV3PrivKey: `${String(row["snmpV3Username"] || "x")}-priv`,
      ...row,
    });

    return id;
  }

  async function siteIdsOn(probe: ObjectID): Promise<Array<string>> {
    return (
      await NetworkDeviceService.findSitesWithSnmpV3DefaultOnProbe({
        probeId: probe,
        limit: 100,
      })
    )
      .map((site: NetworkSite) => {
        return site.id!.toString();
      })
      .sort();
  }

  describe("which sites' default profiles a probe is handed (#11174)", () => {
    test("a site whose own Default Probe it is, with an SNMPv3 default profile, and no other", async () => {
      const named: ObjectID = await addSite({
        probeId: PROBE.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });

      await addSite({
        probeId: PROBE.toString(),
        snmpCredentialProfileId: V2C_PROFILE.toString(),
      });
      await addSite({ probeId: PROBE.toString() });
      await addSite({
        probeId: PROBE.toString(),
        snmpCredentialProfileId: DELETED_V3_PROFILE.toString(),
      });
      await addSite({
        probeId: OTHER_PROBE.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });
      await addSite({
        probeId: PROBE.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
        deletedAt: new Date(),
      });

      expect(await siteIdsOn(PROBE)).toEqual([named.toString()]);
    });

    test("a child site that only inherits the probe from its parent names none, and is not one", async () => {
      const parent: ObjectID = await addSite({ probeId: PROBE.toString() });

      await addSite({
        parentSiteId: parent.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });

      expect(await siteIdsOn(PROBE)).toEqual([]);
    });

    test("a project's probe never takes another project's site, whatever names it", async () => {
      await addSite({
        projectId: OTHER_PROJECT.toString(),
        probeId: PROBE.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });

      expect(await siteIdsOn(PROBE)).toEqual([]);
    });

    test("a global probe takes the sites of every served project that name it", async () => {
      const ours: ObjectID = await addSite({
        probeId: GLOBAL_PROBE.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });
      const theirs: ObjectID = await addSite({
        projectId: OTHER_PROJECT.toString(),
        probeId: GLOBAL_PROBE.toString(),
        snmpCredentialProfileId: (
          await addProfile({
            projectId: OTHER_PROJECT.toString(),
            snmpV3Username: "globex-traps",
          })
        ).toString(),
      });

      for (const project of [BLOCKED_PROJECT, UNPAID_PROJECT]) {
        await addSite({
          projectId: project.toString(),
          probeId: GLOBAL_PROBE.toString(),
          snmpCredentialProfileId: V3_PROFILE.toString(),
        });
      }

      expect(await siteIdsOn(GLOBAL_PROBE)).toEqual(
        [ours.toString(), theirs.toString()].sort(),
      );
    });

    test("each comes with its project and the profile it names", async () => {
      const site: ObjectID = await addSite({
        probeId: PROBE.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });

      const [found]: Array<NetworkSite> =
        await NetworkDeviceService.findSitesWithSnmpV3DefaultOnProbe({
          probeId: PROBE,
          limit: 100,
        });

      expect(found!.id!.toString()).toBe(site.toString());
      expect(found!.projectId!.toString()).toBe(PROJECT.toString());
      expect(found!.snmpCredentialProfileId!.toString()).toBe(
        V3_PROFILE.toString(),
      );
    });
  });

  describe("which keys reach which probe: exactly these, and no others", () => {
    test("each probe is handed its own devices' credentials and its sites' defaults, never another project's", async () => {
      const acmeSiteDefault: ObjectID = await addProfile({
        snmpV3Username: "acme-branch-default",
      });
      const acmeUnused: ObjectID = await addProfile({
        snmpV3Username: "acme-unused",
      });
      const globexTraps: ObjectID = await addProfile({
        projectId: OTHER_PROJECT.toString(),
        snmpV3Username: "globex-traps",
      });

      const v3Device: (row: Record<string, unknown>) => Promise<ObjectID> = (
        row: Record<string, unknown>,
      ): Promise<ObjectID> => {
        return addDevice({
          snmpVersion: "V3",
          snmpV3SecurityLevel: "authPriv",
          snmpV3AuthProtocol: "SHA",
          snmpV3AuthKey: `${String(row["snmpV3Username"])}-auth`,
          snmpV3PrivProtocol: "AES",
          snmpV3PrivKey: `${String(row["snmpV3Username"])}-priv`,
          ...row,
        });
      };

      // Devices: Acme's on each of its probes and on the global one, and Globex's on the global one.
      await v3Device({ snmpV3Username: "lab-switch" });
      await v3Device({
        snmpV3Username: "other-probe-switch",
        probeId: OTHER_PROBE.toString(),
      });
      await v3Device({
        snmpV3Username: "acme-cloud-router",
        probeId: GLOBAL_PROBE.toString(),
      });
      await v3Device({
        snmpV3Username: "globex-router",
        probeId: GLOBAL_PROBE.toString(),
        projectId: OTHER_PROJECT.toString(),
      });
      // A Globex device pointed at Acme's own probe: never handed to it.
      await v3Device({
        snmpV3Username: "globex-on-acme-probe",
        projectId: OTHER_PROJECT.toString(),
      });

      // Sites: their own Default Probe gets their default profile.
      const branch: ObjectID = await addSite({
        probeId: PROBE.toString(),
        snmpCredentialProfileId: acmeSiteDefault.toString(),
      });
      await addSite({
        probeId: OTHER_PROBE.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });
      await addSite({
        probeId: GLOBAL_PROBE.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });
      await addSite({
        projectId: OTHER_PROJECT.toString(),
        probeId: GLOBAL_PROBE.toString(),
        snmpCredentialProfileId: globexTraps.toString(),
      });
      // A Globex site naming Acme's project probe: never.
      await addSite({
        projectId: OTHER_PROJECT.toString(),
        probeId: PROBE.toString(),
        snmpCredentialProfileId: globexTraps.toString(),
      });
      // A Globex site naming Acme's profile on the global probe: the profile is dropped.
      await addSite({
        projectId: OTHER_PROJECT.toString(),
        probeId: GLOBAL_PROBE.toString(),
        snmpCredentialProfileId: V3_PROFILE.toString(),
      });
      // A site with no Default Probe, and a child that only inherits one: nowhere.
      await addSite({ snmpCredentialProfileId: acmeUnused.toString() });
      await addSite({
        parentSiteId: branch.toString(),
        snmpCredentialProfileId: acmeUnused.toString(),
      });

      const handedTo: (probe: ObjectID) => Promise<Array<string>> = async (
        probe: ObjectID,
      ): Promise<Array<string>> => {
        return (await SnmpTrapReceiverUsers.getUsersForProbe(probe))
          .map((user: SnmpTrapReceiverUser) => {
            return `${user.userName} held by ${(user.heldBy?.projectIds || [])
              .map((projectId: string) => {
                return projectId === PROJECT.toString().toLowerCase()
                  ? "acme"
                  : projectId === OTHER_PROJECT.toString().toLowerCase()
                    ? "globex"
                    : projectId;
              })
              .join("+")}`;
          })
          .sort();
      };

      expect(await handedTo(PROBE)).toEqual([
        "acme-branch-default held by acme",
        "lab-switch held by acme",
      ]);
      expect(await handedTo(OTHER_PROBE)).toEqual([
        "fabric-traps held by acme",
        "other-probe-switch held by acme",
      ]);
      expect(await handedTo(GLOBAL_PROBE)).toEqual([
        "acme-cloud-router held by acme",
        "fabric-traps held by acme",
        "globex-router held by globex",
        "globex-traps held by globex",
      ]);

      // A profile nothing on a probe uses reaches no probe.
      for (const probe of [PROBE, OTHER_PROBE, GLOBAL_PROBE]) {
        expect((await handedTo(probe)).join(" ")).not.toContain("acme-unused");
      }
    });
  });

  describe("the devices a global probe's refusals are split by", () => {
    test("those on the probe at the addresses, by hostname or Other Addresses, IPv6 hostnames to compare canonically", async () => {
      const byHostname: ObjectID = await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        hostname: "203.0.113.10",
      });
      const byOther: ObjectID = await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        hostname: "10.0.0.1",
        otherAddresses: "198.51.100.20",
        projectId: OTHER_PROJECT.toString(),
      });
      const v6: ObjectID = await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        hostname: "2001:DB8::1",
      });

      // Elsewhere: another address, another probe, a deleted device, a blocked project.
      await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        hostname: "192.0.2.50",
      });
      await addDevice({ probeId: PROBE.toString(), hostname: "203.0.113.10" });
      await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        hostname: "203.0.113.10",
        deletedAt: new Date(),
      });
      await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        hostname: "203.0.113.10",
        projectId: BLOCKED_PROJECT.toString(),
      });

      const found: Array<NetworkDevice> =
        await NetworkDeviceService.findDevicesAtAddressesOnProbe({
          probeId: GLOBAL_PROBE,
          addresses: ["203.0.113.10", "198.51.100.20", "2001:db8::1"],
        });

      expect(
        found
          .map((device: NetworkDevice) => {
            return device.id!.toString();
          })
          .sort(),
      ).toEqual(
        [byHostname, byOther, v6]
          .map((id: ObjectID) => {
            return id.toString();
          })
          .sort(),
      );

      const listing: NetworkDevice = found.find((device: NetworkDevice) => {
        return device.id!.toString() === byOther.toString();
      })!;
      expect(listing.projectId!.toString()).toBe(OTHER_PROJECT.toString());
      expect(listing.otherAddresses).toBe("198.51.100.20");
    });

    test("no addresses, no read", async () => {
      expect(
        await NetworkDeviceService.findDevicesAtAddressesOnProbe({
          probeId: GLOBAL_PROBE,
          addresses: [],
        }),
      ).toEqual([]);
    });
  });

  describe("whether a project uses a probe, for a trap from an address no device has", () => {
    test("a device on it, a site whose Default Probe it is, or neither", async () => {
      await addDevice({ probeId: GLOBAL_PROBE.toString() });
      const globexSite: ObjectID = await addSite({
        projectId: OTHER_PROJECT.toString(),
        probeId: GLOBAL_PROBE.toString(),
      });

      expect(
        await NetworkDeviceService.findProbeUseByProject({
          probeId: GLOBAL_PROBE,
          projectId: PROJECT,
          siteIds: [],
        }),
      ).toEqual({ isUsed: true, siteIds: [] });
      expect(
        await NetworkDeviceService.findProbeUseByProject({
          probeId: GLOBAL_PROBE,
          projectId: OTHER_PROJECT,
          siteIds: [globexSite.toString()],
        }),
      ).toEqual({ isUsed: true, siteIds: [globexSite.toString()] });
      expect(
        await NetworkDeviceService.findProbeUseByProject({
          probeId: GLOBAL_PROBE,
          projectId: UNPAID_PROJECT,
          siteIds: [],
        }),
      ).toEqual({ isUsed: false, siteIds: [] });
    });

    test("a site is named only when it is that project's and names that probe", async () => {
      const acmes: ObjectID = await addSite({ probeId: GLOBAL_PROBE.toString() });
      const globexs: ObjectID = await addSite({
        projectId: OTHER_PROJECT.toString(),
        probeId: GLOBAL_PROBE.toString(),
      });
      const onAnotherProbe: ObjectID = await addSite({
        probeId: PROBE.toString(),
      });

      expect(
        (
          await NetworkDeviceService.findProbeUseByProject({
            probeId: GLOBAL_PROBE,
            projectId: PROJECT,
            siteIds: [
              acmes.toString(),
              globexs.toString(),
              onAnotherProbe.toString(),
              "not-an-id",
            ],
          })
        ).siteIds,
      ).toEqual([acmes.toString()]);
    });
  });

  describe("each project's share of a global probe's refusals (#11173)", () => {
    function refusal(fields: Partial<SnmpTrapRefusal>): SnmpTrapRefusal {
      return {
        sourceAddress: "203.0.113.10",
        reason: SnmpTrapRefusalReason.UnknownUser,
        userName: "monitor",
        count: 4,
        firstSeenAt: "2026-11-27T08:00:00.000Z",
        lastSeenAt: "2026-11-27T09:00:00.000Z",
        ...fields,
      };
    }

    async function shares(): Promise<
      Array<{ projectId: string; probeId: string; refusals: unknown; xmin: string }>
    > {
      return await database.query(
        `SELECT "projectId"::text AS "projectId", "probeId"::text AS "probeId", "refusals", xmin::text AS xmin
         FROM "GlobalProbeSnmpTrapReport" ORDER BY "projectId", "probeId"`,
      );
    }

    test("a row per project, written only when its share changed, and gone once it has nothing refused", async () => {
      const acme: SnmpTrapRefusal = refusal({});
      const globex: SnmpTrapRefusal = refusal({
        sourceAddress: "198.51.100.20",
      });

      await GlobalProbeSnmpTrapReportService.recordShares({
        probeId: GLOBAL_PROBE,
        sharesByProject: new Map([
          [PROJECT.toString(), [acme]],
          [OTHER_PROJECT.toString(), [globex]],
        ]),
      });

      const first: Array<{
        projectId: string;
        refusals: unknown;
        xmin: string;
      }> = await shares();
      expect(
        first.map((row: { projectId: string; refusals: unknown }) => {
          return [row.projectId, row.refusals];
        }),
      ).toEqual(
        [
          [PROJECT.toString(), [acme]],
          [OTHER_PROJECT.toString(), [globex]],
        ].sort((a: Array<unknown>, b: Array<unknown>) => {
          return String(a[0]).localeCompare(String(b[0]));
        }),
      );

      // The same again: no new row version.
      await GlobalProbeSnmpTrapReportService.recordShares({
        probeId: GLOBAL_PROBE,
        sharesByProject: new Map([
          [PROJECT.toString(), [acme]],
          [OTHER_PROJECT.toString(), [globex]],
        ]),
      });
      expect(
        (await shares()).map((row: { xmin: string }) => {
          return row.xmin;
        }),
      ).toEqual(
        first.map((row: { xmin: string }) => {
          return row.xmin;
        }),
      );

      // Acme's changes, Globex has nothing refused any more.
      await GlobalProbeSnmpTrapReportService.recordShares({
        probeId: GLOBAL_PROBE,
        sharesByProject: new Map([
          [PROJECT.toString(), [{ ...acme, count: 9 }]],
        ]),
      });
      const after: Array<{ projectId: string; refusals: unknown }> =
        await shares();
      expect(
        after.map((row: { projectId: string }) => {
          return row.projectId;
        }),
      ).toEqual([PROJECT.toString()]);
      expect(after[0]!.refusals).toEqual([{ ...acme, count: 9 }]);

      // Nothing refused at all: no row left for this probe.
      await GlobalProbeSnmpTrapReportService.recordShares({
        probeId: GLOBAL_PROBE,
        sharesByProject: new Map(),
      });
      expect(await shares()).toEqual([]);
    });

    test("one probe's report never touches another probe's rows", async () => {
      await insert("Probe", {
        _id: SECOND_GLOBAL_PROBE.toString(),
        isGlobalProbe: true,
        name: "second global probe",
      });

      await GlobalProbeSnmpTrapReportService.recordShares({
        probeId: SECOND_GLOBAL_PROBE,
        sharesByProject: new Map([[PROJECT.toString(), [refusal({})]]]),
      });
      await GlobalProbeSnmpTrapReportService.recordShares({
        probeId: GLOBAL_PROBE,
        sharesByProject: new Map(),
      });

      expect(
        (await shares()).map((row: { probeId: string }) => {
          return row.probeId;
        }),
      ).toEqual([SECOND_GLOBAL_PROBE.toString()]);

      await database.query(`DELETE FROM "Probe" WHERE "_id" = $1`, [
        SECOND_GLOBAL_PROBE.toString(),
      ]);
    });

    test("end to end: a global probe's report, split as it arrives, with no project reading another's", async () => {
      await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        hostname: "203.0.113.10",
      });
      await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        projectId: OTHER_PROJECT.toString(),
        hostname: "10.0.0.20",
        otherAddresses: "198.51.100.20",
      });
      // An address both projects have: neither reads its refusals.
      await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        hostname: "192.0.2.77",
      });
      await addDevice({
        probeId: GLOBAL_PROBE.toString(),
        projectId: OTHER_PROJECT.toString(),
        hostname: "192.0.2.77",
      });

      const report: SnmpTrapReceiverReport = {
        isEnabled: true,
        port: 162,
        engineId: "8000B98380A1B2C3D4E5F60718293A4B",
        userCount: 3,
        refusals: [
          refusal({ userName: "acme-user" }),
          refusal({
            sourceAddress: "198.51.100.20",
            userName: "globex-user",
            reason: SnmpTrapRefusalReason.WrongDigest,
          }),
          refusal({ sourceAddress: "192.0.2.77", userName: "shared" }),
          refusal({ sourceAddress: "192.0.2.200", userName: "scanner" }),
        ],
      };

      expect(
        await SnmpTrapReceiverReports.record({
          probeId: GLOBAL_PROBE,
          report: report,
          users: [
            {
              userName: "globex-user",
              securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
              addresses: [],
              heldBy: {
                projectIds: [OTHER_PROJECT.toString().toLowerCase()],
              },
            },
          ],
        }),
      ).toBe(true);

      const rows: Array<{ projectId: string; refusals: unknown }> =
        await shares();
      const byProject: Map<string, unknown> = new Map(
        rows.map((row: { projectId: string; refusals: unknown }) => {
          return [row.projectId, row.refusals];
        }),
      );

      expect(byProject.get(PROJECT.toString())).toEqual([
        refusal({ userName: "acme-user" }),
      ]);
      expect(byProject.get(OTHER_PROJECT.toString())).toEqual([
        refusal({
          sourceAddress: "198.51.100.20",
          userName: "globex-user",
          reason: SnmpTrapRefusalReason.WrongDigest,
        }),
      ]);

      const acmeText: string = JSON.stringify(byProject.get(PROJECT.toString()));
      expect(acmeText).not.toContain("198.51.100.20");
      expect(acmeText).not.toContain("globex-user");
      expect(JSON.stringify(rows)).not.toContain("192.0.2.77");
      expect(JSON.stringify(rows)).not.toContain("scanner");

      // On the probe: what belongs to no project.
      const probeRow: Array<{ snmpTrapReceiver: unknown }> = await database.query(
        `SELECT "snmpTrapReceiver" FROM "Probe" WHERE "_id" = $1`,
        [GLOBAL_PROBE.toString()],
      );
      expect(probeRow[0]!.snmpTrapReceiver).toEqual({
        isEnabled: true,
        port: 162,
        engineId: "8000B98380A1B2C3D4E5F60718293A4B",
        refusals: [],
      });
    });
  });
});
