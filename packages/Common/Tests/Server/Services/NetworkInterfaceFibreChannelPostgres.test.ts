import Entities from "../../../Models/DatabaseModels/Index";
import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import NetworkInterfaceService from "../../../Server/Services/NetworkInterfaceService";
import logger from "../../../Server/Utils/Logger";
import {
  FibreChannelCounter,
  FibreChannelPortType,
  SnmpFibreChannelPort,
} from "../../../Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import ObjectID from "../../../Types/ObjectID";
import { dropSchemaOneTableAtATime } from "../../Helpers/DropSchemaOneTableAtATime";
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
 * A SAN switch's ports, written by the poll's batched SQL to a real,
 * migrated Postgres (#11014, #11015). NetworkInterfaceService writes a walk
 * with one INSERT ... ON CONFLICT and one UPDATE ... FROM (VALUES ...) per
 * chunk, each value cast; the two Fibre Channel columns - the port's type
 * and why it is down - ride both. Only Postgres can say the statements are
 * well-typed: a VALUES list is typed from its first row, so a chunk whose
 * first port is no Fibre Channel port (an Ethernet management port, nulls
 * in both columns) must still take a later port's text.
 *
 * Opt in with RUN_POSTGRES_NETWORK_INTERFACE_TESTS=true against a Postgres
 * migrated to the current head (the Postgres Schema Drift workflow's
 * database, after its drift check). Every table's structure is cloned into
 * a unique schema, first on the search_path, dropped afterwards. Credentials
 * from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * NETWORK_INTERFACE_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * NETWORK_INTERFACE_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_INTERFACE_TESTS"] === "true"
    ? describe
    : describe.skip;

const SCHEMA_NAME_DASHES: RegExp = /-/g;

function port(
  interfaceIndex: number,
  isUp: boolean,
  fibreChannel?: SnmpFibreChannelPort | undefined,
): SnmpInterface {
  return {
    interfaceIndex: interfaceIndex,
    name: interfaceIndex === 1 ? "eth0" : `0/${interfaceIndex - 0x40000000}`,
    interfaceType: interfaceIndex === 1 ? 6 : 56,
    isOperationallyUp: isUp,
    isAdministrativelyUp: true,
    speedInBitsPerSecond: interfaceIndex === 1 ? 1000000000 : 32000000000,
    ...(fibreChannel ? { fibreChannel: fibreChannel } : {}),
  };
}

describePostgres("a SAN switch's ports, on a migrated Postgres", () => {
  const schema: string = `network_interface_fc_${ObjectID.generate()
    .toString()
    .replace(SCHEMA_NAME_DASHES, "")}`;

  let database: DataSource;
  const projectId: ObjectID = ObjectID.generate();
  const deviceId: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["NETWORK_INTERFACE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["NETWORK_INTERFACE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["NETWORK_INTERFACE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema},public`,
        max: 4,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    /*
     * Every table, so whatever the write touches lands here and never in the
     * database's own tables. Defaults, NOT NULL and CHECK constraints and
     * every index come with them - the ON CONFLICT target among them.
     */
    const tables: Array<string> = (
      await database.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations'`,
      )
    ).map((row: { table_name: string }): string => {
      return row.table_name;
    });

    expect(tables).toEqual(
      expect.arrayContaining(["NetworkDevice", "NetworkInterface"]),
    );

    for (const table of tables) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
  }, 300000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await dropSchemaOneTableAtATime(database, schema);
      await database.destroy();
    }
  });

  beforeEach(() => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest
      .spyOn(DatabaseService.prototype, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function stored(): Promise<
    Array<{
      interfaceIndex: number;
      fibreChannelPortType: string | null;
      downReason: string | null;
      isOperationallyUp: boolean;
    }>
  > {
    return database.query(
      `SELECT "interfaceIndex", "fibreChannelPortType", "downReason", "isOperationallyUp" FROM "${schema}"."NetworkInterface" WHERE "networkDeviceId" = $1 ORDER BY "interfaceIndex"`,
      [deviceId.toString()],
    );
  }

  test("a first walk inserts each port's type and reason, an Ethernet port first in the chunk", async () => {
    await NetworkInterfaceService.upsertWalkedInterfaces({
      projectId: projectId,
      deviceId: deviceId,
      now: new Date("2026-11-26T10:00:00.000Z"),
      walkedInterfaces: [
        port(1, true),
        port(0x40000004, true, {
          portType: FibreChannelPortType.E,
          counters: { [FibreChannelCounter.CrcErrors]: 0 },
        }),
        port(0x40000006, false, { downReason: "No light" }),
      ],
    });

    expect(await stored()).toEqual([
      {
        interfaceIndex: 1,
        fibreChannelPortType: null,
        downReason: null,
        isOperationallyUp: true,
      },
      {
        interfaceIndex: 0x40000004,
        fibreChannelPortType: "E",
        downReason: null,
        isOperationallyUp: true,
      },
      {
        interfaceIndex: 0x40000006,
        fibreChannelPortType: null,
        downReason: "No light",
        isOperationallyUp: false,
      },
    ]);
  });

  test("the next walk updates them: the E-Port goes down and keeps its type; the dark port comes up as an F-Port", async () => {
    await NetworkInterfaceService.upsertWalkedInterfaces({
      projectId: projectId,
      deviceId: deviceId,
      now: new Date("2026-11-26T10:01:00.000Z"),
      walkedInterfaces: [
        port(1, true),
        port(0x40000004, false, { downReason: "No sync" }),
        port(0x40000006, true, { portType: FibreChannelPortType.F }),
      ],
    });

    expect(await stored()).toEqual([
      {
        interfaceIndex: 1,
        fibreChannelPortType: null,
        downReason: null,
        isOperationallyUp: true,
      },
      {
        interfaceIndex: 0x40000004,
        fibreChannelPortType: "E",
        downReason: "No sync",
        isOperationallyUp: false,
      },
      {
        interfaceIndex: 0x40000006,
        fibreChannelPortType: "F",
        downReason: null,
        isOperationallyUp: true,
      },
    ]);

    const rows: Array<NetworkInterface> = await NetworkInterfaceService.findBy({
      query: { networkDeviceId: deviceId },
      select: {
        interfaceIndex: true,
        fibreChannelPortType: true,
        downReason: true,
      },
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    // And the model reads them back as the Interfaces page does.
    expect(
      rows
        .map((row: NetworkInterface) => {
          return [row.interfaceIndex, row.fibreChannelPortType || null];
        })
        .sort(),
    ).toEqual(
      [
        [1, null],
        [0x40000004, "E"],
        [0x40000006, "F"],
      ].sort(),
    );
  });
});
