import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkEndpointService, {
  EndpointControllerClient,
  EndpointWriteCounts,
} from "../../../Server/Services/NetworkEndpointService";
import ObjectID from "../../../Types/ObjectID";
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
 * What a network controller's client list writes to NetworkEndpoint, EXECUTED
 * on Postgres (OneUptime issue #5379).
 *
 * The write is the raw INSERT ... ON CONFLICT and UPDATE ... FROM (VALUES ...)
 * a walk uses, with per-row conditions the unit suite can only read as text.
 * Only a database shows what they do:
 *
 *   - a client it has not seen is created, attached to its switch with what
 *     the controller knows, under the partial unique index;
 *   - a client a walk found is taken over, and the ifIndex of the port it
 *     moved off is cleared - not kept by COALESCE, as a walk's update would;
 *   - the same port on the same switch keeps its ifIndex;
 *   - a walk writes nothing to a row a controller placed while the placement
 *     is current, and takes it back when it is not, clearing the source;
 *   - a name is never cleared by a read that has none;
 *   - a soft-deleted endpoint is not resurrected: a new row is made;
 *   - another project's row of the same MAC is not touched.
 *
 * Opt in with RUN_POSTGRES_NETWORK_ENDPOINT_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's database
 * right after its drift check. The NetworkEndpoint STRUCTURE is cloned into a
 * unique schema (search_path holds only that schema) that is dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database
 * from NETWORK_ENDPOINT_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * NETWORK_ENDPOINT_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_ENDPOINT_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const SWITCH_ID: ObjectID = ObjectID.generate();
const OTHER_SWITCH_ID: ObjectID = ObjectID.generate();
const SITE_ID: ObjectID = ObjectID.generate();
const MAC: string = "aa:bb:cc:00:00:51";

const NOW: Date = new Date("2026-11-01T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

interface Row {
  attachedNetworkDeviceId: string;
  attachedInterfaceIndex: number | null;
  attachedPortName: string | null;
  vlanId: number | null;
  siteId: string | null;
  ipAddress: string | null;
  vendor: string | null;
  hostname: string | null;
  attachmentSource: string | null;
  lastSeenAt: Date;
  firstSeenAt: Date;
}

describePostgres("a controller's clients written to Postgres", () => {
  const schema: string = `network_endpoint_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  const clientOf: (
    extra?: Partial<EndpointControllerClient>,
  ) => EndpointControllerClient = (
    extra: Partial<EndpointControllerClient> = {},
  ): EndpointControllerClient => {
    return {
      macAddress: MAC,
      ipAddress: "10.18.166.51",
      hostname: "wb-0660-kds01",
      vendor: "Elo Touch",
      portName: "Port 7",
      vlanId: 18,
      seenAt: new Date(NOW.getTime() - HOUR),
      deviceId: SWITCH_ID,
      deviceSiteId: SITE_ID,
      ...extra,
    };
  };

  const report: (
    extra?: Partial<EndpointControllerClient>,
    now?: Date,
  ) => Promise<number> = (
    extra: Partial<EndpointControllerClient> = {},
    now: Date = NOW,
  ): Promise<number> => {
    return NetworkEndpointService.upsertControllerClients({
      projectId: PROJECT_ID,
      source: "meraki",
      clients: [clientOf(extra)],
      now: now,
    });
  };

  const walk: (now: Date) => Promise<EndpointWriteCounts> = (
    now: Date,
  ): Promise<EndpointWriteCounts> => {
    return NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: OTHER_SWITCH_ID,
      attachments: [
        {
          macAddress: MAC,
          attachedInterfaceIndex: 49,
          attachedPortName: "port49",
          vlanId: 1,
        },
      ],
      ipBindings: [],
      now: now,
    });
  };

  const rowsOf: (projectId?: ObjectID) => Promise<Array<Row>> = async (
    projectId: ObjectID = PROJECT_ID,
  ): Promise<Array<Row>> => {
    return await database.query(
      `SELECT * FROM "${schema}"."NetworkEndpoint"
       WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
      [projectId.toString()],
    );
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["NETWORK_ENDPOINT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["NETWORK_ENDPOINT_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["NETWORK_ENDPOINT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."NetworkEndpoint" (LIKE public."NetworkEndpoint" INCLUDING ALL)`,
    );

    const columns: Array<{ column_name: string; data_type: string }> =
      await database.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'NetworkEndpoint'
           AND column_name IN ('hostname', 'attachmentSource')
         ORDER BY column_name`,
        [schema],
      );

    // The columns the migration added, as the migration added them.
    expect(columns).toEqual([
      { column_name: "attachmentSource", data_type: "character varying" },
      { column_name: "hostname", data_type: "character varying" },
    ]);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest
      .spyOn(NetworkEndpointService, "findBy")
      .mockImplementation((async (data: { query: { projectId: ObjectID } }) => {
        const rows: Array<Row & { macAddress: string }> = await database.query(
          `SELECT * FROM "${schema}"."NetworkEndpoint"
           WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
          [data.query.projectId.toString()],
        );

        return rows.map((row: Row & { macAddress: string }) => {
          return {
            ...row,
            attachedNetworkDeviceId: row.attachedNetworkDeviceId
              ? new ObjectID(row.attachedNetworkDeviceId)
              : undefined,
            attachedInterfaceIndex: row.attachedInterfaceIndex ?? undefined,
            attachedPortName: row.attachedPortName ?? undefined,
            vlanId: row.vlanId ?? undefined,
            siteId: row.siteId ? new ObjectID(row.siteId) : undefined,
            ipAddress: row.ipAddress ?? undefined,
            hostname: row.hostname ?? undefined,
            attachmentSource: row.attachmentSource ?? undefined,
          };
        });
      }) as never);
    await database.query(`DELETE FROM "${schema}"."NetworkEndpoint"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a client nobody has seen is created on its switch, with what the controller knows", async () => {
    expect(await report()).toBe(1);

    const rows: Array<Row> = await rowsOf();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attachedNetworkDeviceId: SWITCH_ID.toString(),
      attachedInterfaceIndex: null,
      attachedPortName: "Port 7",
      vlanId: 18,
      siteId: SITE_ID.toString(),
      ipAddress: "10.18.166.51",
      vendor: "Elo Touch",
      hostname: "wb-0660-kds01",
      attachmentSource: "meraki",
    });
    expect(new Date(rows[0]!.lastSeenAt).toISOString()).toBe(
      new Date(NOW.getTime() - HOUR).toISOString(),
    );
  });

  test("a client a walk found moves, and the ifIndex of the port it left goes with it", async () => {
    await walk(new Date(NOW.getTime() - 3 * HOUR));
    expect((await rowsOf())[0]).toMatchObject({
      attachedInterfaceIndex: 49,
      attachedPortName: "port49",
      attachmentSource: null,
    });

    await report();

    expect((await rowsOf())[0]).toMatchObject({
      attachedNetworkDeviceId: SWITCH_ID.toString(),
      attachedInterfaceIndex: null,
      attachedPortName: "Port 7",
      attachmentSource: "meraki",
    });
  });

  test("the same port on the same switch keeps its ifIndex, so its counters stay found", async () => {
    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      attachments: [
        {
          macAddress: MAC,
          attachedInterfaceIndex: 7,
          attachedPortName: "Port 7",
        },
      ],
      ipBindings: [],
      now: new Date(NOW.getTime() - 3 * HOUR),
    });

    await report();

    expect((await rowsOf())[0]).toMatchObject({
      attachedInterfaceIndex: 7,
      attachmentSource: "meraki",
    });
  });

  test("a walk writes nothing to a row a controller placed while that stands", async () => {
    await report();
    const before: Array<Row> = await rowsOf();

    await walk(new Date(NOW.getTime() + HOUR));

    expect(await rowsOf()).toEqual(before);
  });

  test("a walk takes the row back once the controller has stopped reporting it", async () => {
    await report();

    await walk(new Date(NOW.getTime() + 8 * HOUR));

    expect((await rowsOf())[0]).toMatchObject({
      attachedNetworkDeviceId: OTHER_SWITCH_ID.toString(),
      attachedInterfaceIndex: 49,
      attachedPortName: "port49",
      attachmentSource: null,
      // What it was called does not age out with where it was.
      hostname: "wb-0660-kds01",
    });
  });

  test("a later read with no name for it keeps the one it had", async () => {
    await report();
    await report({ hostname: undefined }, new Date(NOW.getTime() + 2 * HOUR));

    expect((await rowsOf())[0]?.hostname).toBe("wb-0660-kds01");
  });

  test("a later read with another name replaces it", async () => {
    await report();
    await report({ hostname: "kitchen-1" }, new Date(NOW.getTime() + 2 * HOUR));

    expect((await rowsOf())[0]?.hostname).toBe("kitchen-1");
  });

  test("a vendor is stamped when the row is made and left to people after that", async () => {
    await report();
    await report({ vendor: "Somebody Else" });

    expect((await rowsOf())[0]?.vendor).toBe("Elo Touch");
  });

  test("a soft-deleted endpoint stays deleted: rediscovering its MAC makes a new row", async () => {
    await report();
    await database.query(
      `UPDATE "${schema}"."NetworkEndpoint" SET "deletedAt" = now()`,
    );

    expect(await report()).toBe(1);

    const all: Array<{ deletedAt: Date | null }> = await database.query(
      `SELECT "deletedAt" FROM "${schema}"."NetworkEndpoint"
       ORDER BY "deletedAt" NULLS LAST`,
    );

    expect(all).toHaveLength(2);
    expect(all[0]?.deletedAt).not.toBeNull();
    expect(all[1]?.deletedAt).toBeNull();
  });

  test("another project's row of the same MAC is not touched", async () => {
    await NetworkEndpointService.upsertControllerClients({
      projectId: OTHER_PROJECT_ID,
      source: "meraki",
      clients: [clientOf({ hostname: "theirs" })],
      now: NOW,
    });

    await report({ hostname: "ours" });

    expect((await rowsOf(OTHER_PROJECT_ID))[0]?.hostname).toBe("theirs");
    expect((await rowsOf())[0]?.hostname).toBe("ours");
  });

  test("a whole read's clients land, each on its own switch", async () => {
    const clients: Array<EndpointControllerClient> = Array.from(
      { length: 1200 },
      (_value: unknown, index: number): EndpointControllerClient => {
        const low: string = (index % 256).toString(16).padStart(2, "0");
        const high: string = (index >> 8).toString(16).padStart(2, "0");

        return clientOf({
          macAddress: `aa:bb:cc:dd:${high}:${low}`,
          deviceId: index % 2 === 0 ? SWITCH_ID : OTHER_SWITCH_ID,
          portName: `Port ${index % 48}`,
        });
      },
    );

    expect(
      await NetworkEndpointService.upsertControllerClients({
        projectId: PROJECT_ID,
        source: "meraki",
        clients,
        now: NOW,
      }),
    ).toBe(1200);

    const rows: Array<Row> = await rowsOf();

    expect(rows).toHaveLength(1200);
    expect(
      rows.filter((row: Row): boolean => {
        return row.attachedNetworkDeviceId === SWITCH_ID.toString();
      }),
    ).toHaveLength(600);
  });
});
