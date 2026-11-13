import Entities from "../../../Models/DatabaseModels/Index";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkEndpointService, {
  EndpointControllerClient,
  EndpointWriteCounts,
} from "../../../Server/Services/NetworkEndpointService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import { holdRow } from "../TestingUtils/Postgres/ClaimRowLocks";
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
import type { SpyInstance } from "jest-mock";
import { DataSource } from "typeorm";

/*
 * WALKS AND CONTROLLER READS WRITING THE SAME ENDPOINTS AT ONCE, EXECUTED on
 * Postgres (OneUptime issue #7388, a follow-up of #7194).
 *
 * One MAC is seen by many devices at the same moment: the forwarding table
 * of its access switch and of every uplink on the way, its router's ARP
 * table, a controller's client list. Their writes to NetworkEndpoint used to
 * wait for each other: the UPDATE took its rows' locks in whatever order its
 * plan met them and waited for each row another writer held, and the insert
 * of a MAC another writer had just made waited for that row too. Two of them
 * deadlocked, or one waited out lock_timeout - and the error took the rest of
 * the walk's endpoints, and the ARP table's MAC learning, with it.
 *
 * Now:
 *
 *   - the update writes only the rows nobody else holds (FOR NO KEY UPDATE
 *     SKIP LOCKED) and never waits; a row another writer holds is being
 *     written by it, and the next walk sees the MAC again;
 *   - the insert never overwrites: a MAC another writer made first is decided
 *     again against the row it made, by the same rules as a row the walk's
 *     read had found (a switch's port is not a router's to take, a
 *     controller's placement is not a walk's), and written by that update;
 *   - inserts go in MAC order, so two writers inserting the same new MACs
 *     never wait for each other in a circle;
 *   - a statement that still waits out lock_timeout is counted as skipped and
 *     logged, and the rest of the walk is written.
 *
 * Opt in with RUN_POSTGRES_NETWORK_ENDPOINT_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database. The NetworkEndpoint STRUCTURE is cloned into a unique schema
 * (search_path holds only that schema) that is dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * NETWORK_ENDPOINT_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * NETWORK_ENDPOINT_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_ENDPOINT_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SWITCH_ID: ObjectID = ObjectID.generate();
const OTHER_SWITCH_ID: ObjectID = ObjectID.generate();
const ROUTER_ID: ObjectID = ObjectID.generate();
const SITE_ID: ObjectID = ObjectID.generate();

const NOW: Date = new Date("2026-11-12T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const TEN_MINUTES_AGO: Date = new Date(NOW.getTime() - 10 * MINUTE);

/*
 * Short, so a statement that waits for a held row fails fast - and long
 * enough that a writer waiting for another's insert of the same new MAC, a
 * few milliseconds, never comes near it.
 */
const LOCK_TIMEOUT_MS: number = 2000;

// Writers at once in each race, and how many times it is run.
const RACE_ROUNDS: number = 10;
const RACE_KNOWN_MACS: number = 300;
const RACE_NEW_MACS: number = 300;

interface Row {
  _id: string;
  macAddress: string;
  attachedNetworkDeviceId: string | null;
  attachedInterfaceIndex: number | null;
  attachedPortName: string | null;
  ipAddress: string | null;
  hostname: string | null;
  attachmentSource: string | null;
  lastSeenAt: Date;
  deletedAt: Date | null;
}

type FindBy = typeof NetworkEndpointService.findBy;

// The service's own read, for a test that changes what one read answers.
const realFindBy: FindBy = NetworkEndpointService.findBy.bind(
  NetworkEndpointService,
);

function macOf(index: number): string {
  const octet: (value: number) => string = (value: number): string => {
    return (value & 255).toString(16).padStart(2, "0");
  };

  return `aa:bb:cc:${octet(index >> 16)}:${octet(index >> 8)}:${octet(index)}`;
}

function macsFrom(start: number, count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return macOf(start + index);
  });
}

describePostgres("endpoint writes at once, on Postgres (issue #7388)", () => {
  const schema: string = `network_endpoint_locks_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  // A walk of `deviceId` that finds `macs` on one port, in the order given.
  const walk: (data: {
    deviceId: ObjectID;
    macs: Array<string>;
    interfaceIndex: number;
    now: Date;
  }) => Promise<EndpointWriteCounts> = (data: {
    deviceId: ObjectID;
    macs: Array<string>;
    interfaceIndex: number;
    now: Date;
  }): Promise<EndpointWriteCounts> => {
    return NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: data.deviceId,
      deviceSiteId: SITE_ID,
      attachments: data.macs.map((mac: string) => {
        return {
          macAddress: mac,
          attachedInterfaceIndex: data.interfaceIndex,
          attachedPortName: `port${data.interfaceIndex}`,
        };
      }),
      ipBindings: [],
      now: data.now,
    });
  };

  // A controller's read that places `macs` on a port of OTHER_SWITCH_ID.
  const controllerRead: (macs: Array<string>) => Promise<number> = (
    macs: Array<string>,
  ): Promise<number> => {
    return NetworkEndpointService.upsertControllerClients({
      projectId: PROJECT_ID,
      source: "meraki",
      clients: macs.map((mac: string): EndpointControllerClient => {
        return {
          macAddress: mac,
          hostname: `client-${mac.slice(-5)}`,
          portName: "Port 3",
          seenAt: new Date(NOW.getTime() - MINUTE),
          deviceId: OTHER_SWITCH_ID,
          deviceSiteId: SITE_ID,
        };
      }),
      now: NOW,
    });
  };

  const liveRows: () => Promise<Map<string, Row>> = async (): Promise<
    Map<string, Row>
  > => {
    const rows: Array<Row> = await database.query(
      `SELECT * FROM "${schema}"."NetworkEndpoint"
       WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
      [PROJECT_ID.toString()],
    );

    return new Map(
      rows.map((row: Row): [string, Row] => {
        return [row.macAddress, row];
      }),
    );
  };

  // The next read of the endpoints answers as if `macs` had no row yet.
  const missOnNextRead: (macs: Array<string>) => void = (
    macs: Array<string>,
  ): void => {
    jest.spyOn(NetworkEndpointService, "findBy").mockImplementationOnce((async (
      ...args: Parameters<FindBy>
    ): Promise<Array<NetworkEndpoint>> => {
      return (await realFindBy(...args)).filter(
        (row: NetworkEndpoint): boolean => {
          return !macs.includes(row.macAddress || "");
        },
      );
    }) as FindBy);
  };

  let warn: SpyInstance<typeof logger.warn>;

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
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."NetworkEndpoint" (LIKE public."NetworkEndpoint" INCLUDING ALL)`,
    );
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
    warn = jest.spyOn(logger, "warn").mockImplementation((() => {
      return undefined;
    }) as never);
    await database.query(`DELETE FROM "${schema}"."NetworkEndpoint"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the clone has the partial unique index the writes name: one live row per MAC", async () => {
    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = $1 AND tablename = 'NetworkEndpoint'`,
      [schema],
    );

    expect(
      indexes.some((index: { indexdef: string }): boolean => {
        return (
          index.indexdef.startsWith("CREATE UNIQUE INDEX") &&
          index.indexdef.includes('("projectId", "macAddress")') &&
          index.indexdef.includes('WHERE ("deletedAt" IS NULL)')
        );
      }),
    ).toBe(true);
  });

  test("an endpoint another writer holds is skipped at once and left as it was, and the walk writes the rest", async () => {
    const macs: Array<string> = macsFrom(1, 3);
    await walk({
      deviceId: SWITCH_ID,
      macs,
      interfaceIndex: 1,
      now: TEN_MINUTES_AGO,
    });

    const before: Map<string, Row> = await liveRows();
    const held: Row = before.get(macs[1]!)!;
    const holder: { release: () => Promise<void> } = await holdRow({
      database,
      schema,
      table: "NetworkEndpoint",
      id: new ObjectID(held._id),
    });

    try {
      const startedAt: number = Date.now();
      const counts: EndpointWriteCounts = await walk({
        deviceId: SWITCH_ID,
        macs,
        interfaceIndex: 2,
        now: NOW,
      });

      // Never waited for it: lock_timeout would have failed the statement.
      expect(Date.now() - startedAt).toBeLessThan(LOCK_TIMEOUT_MS);
      expect(counts).toEqual({ written: 2, skipped: 1 });

      const during: Map<string, Row> = await liveRows();
      for (const mac of [macs[0]!, macs[2]!]) {
        expect(during.get(mac)).toMatchObject({
          attachedInterfaceIndex: 2,
          attachedPortName: "port2",
        });
        expect(new Date(during.get(mac)!.lastSeenAt).toISOString()).toBe(
          NOW.toISOString(),
        );
      }
      expect(during.get(macs[1]!)).toEqual(held);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      await holder.release();
    }

    // The next walk sees it again, and writes it.
    expect(
      await walk({
        deviceId: SWITCH_ID,
        macs,
        interfaceIndex: 2,
        now: new Date(NOW.getTime() + MINUTE),
      }),
    ).toEqual({ written: 1, skipped: 0 });
    expect((await liveRows()).get(macs[1]!)).toMatchObject({
      attachedInterfaceIndex: 2,
      attachedPortName: "port2",
    });
  });

  test("an insert that waits out the lock timeout behind another writer is left for the next walk, and the walk writes the rest", async () => {
    const [changing, fresh, known] = macsFrom(10, 3) as [
      string,
      string,
      string,
    ];
    await walk({
      deviceId: SWITCH_ID,
      macs: [changing, known],
      interfaceIndex: 1,
      now: TEN_MINUTES_AGO,
    });

    const before: Map<string, Row> = await liveRows();
    /*
     * Another writer is changing `changing`'s row, uncommitted, and this
     * walk's read missed it: so the walk inserts it, with the new `fresh`.
     * An insert has to wait for that writer - only its end says whether
     * its row stands - and here it does not end.
     */
    const holder: { release: () => Promise<void> } = await holdRow({
      database,
      schema,
      table: "NetworkEndpoint",
      id: new ObjectID(before.get(changing)!._id),
    });
    missOnNextRead([changing]);

    try {
      const counts: EndpointWriteCounts = await walk({
        deviceId: SWITCH_ID,
        macs: [changing, fresh, known],
        interfaceIndex: 2,
        now: NOW,
      });

      // The insert of both is left; the known endpoint's update lands.
      expect(counts).toEqual({ written: 1, skipped: 2 });

      const during: Map<string, Row> = await liveRows();
      expect(during.get(known)).toMatchObject({ attachedInterfaceIndex: 2 });
      expect(during.has(fresh)).toBe(false);
      expect(during.get(changing)).toEqual(before.get(changing));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain("lock");
    } finally {
      await holder.release();
    }

    expect(
      await walk({
        deviceId: SWITCH_ID,
        macs: [changing, fresh, known],
        interfaceIndex: 2,
        now: new Date(NOW.getTime() + MINUTE),
      }),
    ).toEqual({ written: 2, skipped: 0 });

    const after: Map<string, Row> = await liveRows();
    expect(after.get(fresh)).toMatchObject({ attachedInterfaceIndex: 2 });
    expect(after.get(changing)).toMatchObject({ attachedInterfaceIndex: 2 });
  });

  test("a router that loses a new endpoint's insert to a switch leaves the switch's port to it, and adds the address its ARP table knows", async () => {
    const mac: string = macOf(20);
    await walk({
      deviceId: SWITCH_ID,
      macs: [mac],
      interfaceIndex: 7,
      now: new Date(NOW.getTime() - MINUTE),
    });

    // The router's read ran before the switch's row was made.
    missOnNextRead([mac]);

    const counts: EndpointWriteCounts =
      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: ROUTER_ID,
        attachments: [],
        ipBindings: [
          { macAddress: mac, ipAddress: "10.0.0.31", routerInterfaceIndex: 3 },
        ],
        now: NOW,
      });

    expect(counts).toEqual({ written: 1, skipped: 0 });
    expect((await liveRows()).get(mac)).toMatchObject({
      attachedNetworkDeviceId: SWITCH_ID.toString(),
      attachedInterfaceIndex: 7,
      attachedPortName: "port7",
      ipAddress: "10.0.0.31",
    });
  });

  test("a walk that loses a new endpoint's insert to a controller's read writes nothing while the controller's placement stands", async () => {
    const mac: string = macOf(30);
    expect(await controllerRead([mac])).toBe(1);
    const placed: Row = (await liveRows()).get(mac)!;

    missOnNextRead([mac]);

    expect(
      await walk({
        deviceId: SWITCH_ID,
        macs: [mac],
        interfaceIndex: 49,
        now: NOW,
      }),
    ).toEqual({ written: 0, skipped: 0 });
    expect((await liveRows()).get(mac)).toEqual(placed);
  });

  test("a soft-deleted endpoint stays deleted: a walk that finds its MAC again makes a new row", async () => {
    const mac: string = macOf(40);
    await walk({
      deviceId: SWITCH_ID,
      macs: [mac],
      interfaceIndex: 1,
      now: TEN_MINUTES_AGO,
    });
    await database.query(
      `UPDATE "${schema}"."NetworkEndpoint" SET "deletedAt" = now()`,
    );

    expect(
      await walk({
        deviceId: SWITCH_ID,
        macs: [mac],
        interfaceIndex: 2,
        now: NOW,
      }),
    ).toEqual({ written: 1, skipped: 0 });

    const all: Array<{
      deletedAt: Date | null;
      attachedInterfaceIndex: number;
    }> = await database.query(
      `SELECT "deletedAt", "attachedInterfaceIndex" FROM "${schema}"."NetworkEndpoint"
         ORDER BY "deletedAt" NULLS LAST`,
    );
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ attachedInterfaceIndex: 1 });
    expect(all[0]!.deletedAt).not.toBeNull();
    expect(all[1]).toMatchObject({
      deletedAt: null,
      attachedInterfaceIndex: 2,
    });
  });

  test("an endpoint deleted after the walk read it is not written, and not brought back", async () => {
    const mac: string = macOf(50);
    await walk({
      deviceId: SWITCH_ID,
      macs: [mac],
      interfaceIndex: 1,
      now: TEN_MINUTES_AGO,
    });

    // A person deletes it between the walk's read and its write.
    jest.spyOn(NetworkEndpointService, "findBy").mockImplementationOnce((async (
      ...args: Parameters<FindBy>
    ): Promise<Array<NetworkEndpoint>> => {
      const rows: Array<NetworkEndpoint> = await realFindBy(...args);
      await database.query(
        `UPDATE "${schema}"."NetworkEndpoint" SET "deletedAt" = now()`,
      );
      return rows;
    }) as FindBy);

    expect(
      await walk({
        deviceId: SWITCH_ID,
        macs: [mac],
        interfaceIndex: 2,
        now: NOW,
      }),
    ).toEqual({ written: 0, skipped: 1 });

    const all: Array<{
      deletedAt: Date | null;
      attachedInterfaceIndex: number;
    }> = await database.query(
      `SELECT "deletedAt", "attachedInterfaceIndex" FROM "${schema}"."NetworkEndpoint"`,
    );
    expect(all).toHaveLength(1);
    expect(all[0]!.deletedAt).not.toBeNull();
    expect(all[0]!.attachedInterfaceIndex).toBe(1);
  });

  interface Race {
    name: string;
    // The second writer: it finds the MACs in the opposite order.
    other: (macs: Array<string>) => Promise<unknown>;
    // Every new MAC's row, whichever writer made it.
    expectNewRow: (row: Row) => void;
  }

  const RACES: Array<Race> = [
    {
      name: "two walks",
      other: (macs: Array<string>): Promise<unknown> => {
        return walk({
          deviceId: OTHER_SWITCH_ID,
          macs,
          interfaceIndex: 3,
          now: NOW,
        });
      },
      expectNewRow: (row: Row): void => {
        expect([SWITCH_ID.toString(), OTHER_SWITCH_ID.toString()]).toContain(
          row.attachedNetworkDeviceId,
        );
      },
    },
    {
      name: "a walk and a controller's read",
      other: controllerRead,
      /*
       * The controller's placement outranks a walk's: if the walk made the
       * row first, the read takes it; if the read did, the walk leaves it.
       */
      expectNewRow: (row: Row): void => {
        expect(row).toMatchObject({
          attachedNetworkDeviceId: OTHER_SWITCH_ID.toString(),
          attachedPortName: "Port 3",
          attachmentSource: "meraki",
        });
      },
    },
  ];

  test.each(RACES)(
    "$name of the same endpoints in opposite orders, at once, ten times: no deadlock, no statement waits out the lock timeout, and every endpoint lands",
    async (race: Race) => {
      for (let round: number = 0; round < RACE_ROUNDS; round++) {
        await database.query(`DELETE FROM "${schema}"."NetworkEndpoint"`);

        const known: Array<string> = macsFrom(round * 1000, RACE_KNOWN_MACS);
        const added: Array<string> = macsFrom(
          round * 1000 + RACE_KNOWN_MACS,
          RACE_NEW_MACS,
        );
        const macs: Array<string> = [...known, ...added];

        await walk({
          deviceId: SWITCH_ID,
          macs: known,
          interfaceIndex: 1,
          now: TEN_MINUTES_AGO,
        });

        await Promise.all([
          walk({ deviceId: SWITCH_ID, macs, interfaceIndex: 2, now: NOW }),
          race.other([...macs].reverse()),
        ]);

        // Nothing was lost to a deadlock or a lock timeout.
        expect(warn).not.toHaveBeenCalled();

        const rows: Map<string, Row> = await liveRows();
        expect([...rows.keys()].sort()).toEqual([...macs].sort());

        for (const mac of macs) {
          const row: Row = rows.get(mac)!;

          // Written by one writer or the other, never left as it was.
          expect(new Date(row.lastSeenAt).getTime()).toBeGreaterThanOrEqual(
            NOW.getTime() - MINUTE,
          );
          expect(row.attachedInterfaceIndex).not.toBe(1);
        }

        for (const mac of added) {
          race.expectNewRow(rows.get(mac)!);
        }
      }
    },
  );
});
