import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import {
  getPostgresHealthSnapshot,
  gigabytesToBytes,
  PostgresHealthSnapshot,
  POSTGRES_WRAPAROUND_CEILING,
} from "../../../../Server/Utils/InstanceHealth/PostgresHealth";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Each probe is a separate query, so the fake data source dispatches on a
 * recognisable fragment of each statement. That lets a single test fail one
 * probe while the rest keep answering, which is exactly the partial-failure
 * behaviour the snapshot is built to survive.
 */
function makeDataSource(overrides: Record<string, unknown> = {}): {
  query: jest.Mock;
} {
  const responses: Record<string, unknown> = {
    recovery: [{ in_recovery: false }],
    size: [{ size: "53687091200" }],
    wal: [{ size: "1073741824" }],
    connections: [
      { max_connections: "100", reserved_connections: "3", backends: "40" },
    ],
    wraparound: [{ max_xid_age: "1073741824", max_mxid_age: "1000" }],
    slots: [],
    ...overrides,
  };

  return {
    query: jest.fn(async (sql: string): Promise<unknown> => {
      if (sql.includes("pg_is_in_recovery() AS in_recovery")) {
        return unwrap(responses["recovery"]);
      }
      if (sql.includes("pg_ls_waldir")) {
        return unwrap(responses["wal"]);
      }
      if (sql.includes("pg_database_size")) {
        return unwrap(responses["size"]);
      }
      if (sql.includes("max_connections")) {
        return unwrap(responses["connections"]);
      }
      if (sql.includes("datfrozenxid")) {
        return unwrap(responses["wraparound"]);
      }
      if (sql.includes("pg_replication_slots")) {
        // wal_status did not exist before PG 13; the probe retries without it.
        if (sql.includes("COALESCE(wal_status")) {
          return unwrap(responses["slots"]);
        }
        return unwrap(responses["slotsWithoutWalStatus"] ?? responses["slots"]);
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
}

function unwrap(response: unknown): unknown {
  if (response instanceof Error) {
    throw response;
  }
  return response;
}

function connect(dataSource: { query: jest.Mock }): void {
  jest
    .spyOn(PostgresAppInstance, "getDataSource")
    .mockReturnValue(dataSource as never);
}

describe("PostgresHealth", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("gigabytesToBytes converts using binary gigabytes", () => {
    expect(gigabytesToBytes(1)).toBe(1073741824);
    expect(gigabytesToBytes(10)).toBe(10737418240);
    expect(gigabytesToBytes(0)).toBe(0);
  });

  test("the wraparound ceiling is 2^31", () => {
    expect(POSTGRES_WRAPAROUND_CEILING).toBe(2 ** 31);
  });

  test("returns null when Postgres is not connected", async () => {
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);

    expect(await getPostgresHealthSnapshot()).toBeNull();
  });

  test("reads every probe into one snapshot", async () => {
    connect(
      makeDataSource({
        slots: [
          {
            slot_name: "replica_1",
            slot_type: "physical",
            active: true,
            wal_status: "reserved",
            retained_bytes: "1073741824",
          },
        ],
      }),
    );

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.isInRecovery).toBe(false);
    expect(snapshot?.databaseSizeInBytes).toBe(53687091200);
    expect(snapshot?.walSizeInBytes).toBe(1073741824);
    expect(snapshot?.maxConnections).toBe(100);
    // max_connections minus the reserved slots ordinary clients cannot use.
    expect(snapshot?.usableConnections).toBe(97);
    expect(snapshot?.clientBackends).toBe(40);
    expect(snapshot?.connectionUtilizationPercent).toBeCloseTo(
      (40 / 97) * 100,
      5,
    );
    expect(snapshot?.maxTransactionIdAge).toBe(1073741824);
    expect(snapshot?.wraparoundUtilizationPercent).toBeCloseTo(50, 5);
    expect(snapshot?.replicationSlots).toEqual([
      {
        slotName: "replica_1",
        slotType: "physical",
        isActive: true,
        walStatus: "reserved",
        retainedWalInBytes: 1073741824,
      },
    ]);
  });

  test("recognises a standby", async () => {
    connect(makeDataSource({ recovery: [{ in_recovery: true }] }));

    expect((await getPostgresHealthSnapshot())?.isInRecovery).toBe(true);
  });

  test("maps a null retained_bytes to unknown rather than zero", async () => {
    connect(
      makeDataSource({
        recovery: [{ in_recovery: true }],
        slots: [
          {
            slot_name: "replica_1",
            slot_type: "physical",
            active: false,
            wal_status: "reserved",
            retained_bytes: null,
          },
        ],
      }),
    );

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.replicationSlots?.[0]?.retainedWalInBytes).toBeNull();
  });

  test("defaults a missing wal_status to unknown", async () => {
    connect(
      makeDataSource({
        slots: [
          {
            slot_name: "replica_1",
            slot_type: null,
            active: false,
            wal_status: null,
            retained_bytes: "0",
          },
        ],
      }),
    );

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.replicationSlots?.[0]?.walStatus).toBe("unknown");
    expect(snapshot?.replicationSlots?.[0]?.slotType).toBe("unknown");
  });

  /*
   * A failed slot probe must be distinguishable from an instance that genuinely
   * has no slots: the first is unknown, the second is healthy, and the caller
   * resolves an open notification on one but not the other. Both the initial
   * query and the no-wal_status retry fail here.
   */
  test("keeps the other probes when the replication-slot probe fails", async () => {
    connect(
      makeDataSource({
        slots: new Error("column wal_status does not exist"),
      }),
    );

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.replicationSlots).toBeNull();
    expect(snapshot?.databaseSizeInBytes).toBe(53687091200);
    expect(snapshot?.connectionUtilizationPercent).toBeCloseTo(
      (40 / 97) * 100,
      5,
    );
  });

  test("reports an empty list when the instance has no replication slots", async () => {
    connect(makeDataSource({ slots: [] }));

    expect((await getPostgresHealthSnapshot())?.replicationSlots).toEqual([]);
  });

  test("keeps the other probes when the size probe fails", async () => {
    connect(makeDataSource({ size: new Error("permission denied") }));

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.databaseSizeInBytes).toBeNull();
    expect(snapshot?.maxConnections).toBe(100);
  });

  test("keeps the other probes when the connection probe fails", async () => {
    connect(makeDataSource({ connections: new Error("permission denied") }));

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.maxConnections).toBeNull();
    expect(snapshot?.clientBackends).toBeNull();
    expect(snapshot?.connectionUtilizationPercent).toBeNull();
    expect(snapshot?.databaseSizeInBytes).toBe(53687091200);
  });

  test("keeps the other probes when the wraparound probe fails", async () => {
    connect(makeDataSource({ wraparound: new Error("permission denied") }));

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.maxTransactionIdAge).toBeNull();
    expect(snapshot?.wraparoundUtilizationPercent).toBeNull();
    expect(snapshot?.databaseSizeInBytes).toBe(53687091200);
  });

  test("reports no connection ratio when max_connections is unreadable", async () => {
    connect(
      makeDataSource({
        connections: [
          { max_connections: null, reserved_connections: "3", backends: "40" },
        ],
      }),
    );

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.maxConnections).toBeNull();
    expect(snapshot?.usableConnections).toBeNull();
    expect(snapshot?.connectionUtilizationPercent).toBeNull();
  });

  /*
   * Multixact age is an independent counter with the same ceiling and the same
   * shutdown. An FK-heavy workload can exhaust it while ordinary XID age still
   * looks fine, so the check has to report whichever is worse.
   */
  test("reports the worse of transaction-ID and multixact age", async () => {
    connect(
      makeDataSource({
        wraparound: [{ max_xid_age: "1000", max_mxid_age: "1610612736" }],
      }),
    );

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.transactionIdAge).toBe(1000);
    expect(snapshot?.multiXactIdAge).toBe(1610612736);
    expect(snapshot?.maxTransactionIdAge).toBe(1610612736);
    expect(snapshot?.wraparoundUtilizationPercent).toBeCloseTo(75, 5);
  });

  test("leaves WAL size unmeasured when pg_ls_waldir is not permitted", async () => {
    connect(makeDataSource({ wal: new Error("permission denied") }));

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.walSizeInBytes).toBeNull();
    expect(snapshot?.databaseSizeInBytes).toBe(53687091200);
  });

  /*
   * wal_status arrived in PG 13. On an older external database the column does
   * not exist and the statement errors, which would silence the slot check
   * entirely even though retained-WAL detection works fine there.
   */
  test("retries without wal_status when the column does not exist", async () => {
    connect(
      makeDataSource({
        slots: new Error('column "wal_status" does not exist'),
        slotsWithoutWalStatus: [
          {
            slot_name: "replica_1",
            slot_type: "physical",
            active: false,
            wal_status: "unknown",
            retained_bytes: "2147483648",
          },
        ],
      }),
    );

    const snapshot: PostgresHealthSnapshot | null =
      await getPostgresHealthSnapshot();

    expect(snapshot?.replicationSlots).toEqual([
      {
        slotName: "replica_1",
        slotType: "physical",
        isActive: false,
        walStatus: "unknown",
        retainedWalInBytes: 2147483648,
      },
    ]);
  });

  test("handles an empty result row from a probe", async () => {
    connect(makeDataSource({ size: [] }));

    expect((await getPostgresHealthSnapshot())?.databaseSizeInBytes).toBeNull();
  });
});
