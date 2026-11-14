import NetworkEndpointService, {
  EndpointControllerClient,
  EndpointWriteCounts,
} from "../../../Server/Services/NetworkEndpointService";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import {
  expectPlaceholdersMatchParameters,
  normalizeSql,
} from "../TestingUtils/PastDueMonitoringClaimSql";
import { FindOperator, QueryFailedError } from "typeorm";

/*
 * Wiring tests for upsertDiscoveredEndpoints: the precedence DECISIONS live
 * in EndpointAttachmentUtil.decideUpsert (tested exhaustively in
 * Tests/Utils/Monitor/EndpointAttachmentUtil.test.ts); here we pin how the
 * service applies them.
 *
 * This path runs INLINE on probe ingest for L2 domains with thousands of
 * MACs, so the shape of the write is the contract: one batched findBy, then
 * at most one INSERT per 500 new MACs and one UPDATE per 500 changed MACs —
 * never one round trip per MAC. Endpoints that have not moved since the
 * last poll must produce no write at all. The service builds raw
 * parameterized SQL against the TypeORM manager, so these tests mock the
 * query runner (no Postgres) and assert on the statements and parameters.
 *
 * Neither statement waits for, or overwrites, a row another writer has
 * (OneUptime issue #7388): the update writes only the rows it could lock
 * SKIP LOCKED, the insert is DO NOTHING, and each answers the MACs it
 * wrote. The mock answers as Postgres does with no other writer about;
 * the tests of other writers answer less. NetworkEndpointWriteLocksPostgres
 * runs it all against Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SWITCH_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_SWITCH_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SITE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const ROW_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const NOW: Date = new Date("2026-07-22T12:00:00Z");
const EARLIER: Date = new Date("2026-07-01T00:00:00Z");
// Inside the lastSeenAt refresh threshold (9 minutes at the default interval).
const ONE_MINUTE_AGO: Date = new Date("2026-07-22T11:59:00Z");
// Past it.
const TEN_MINUTES_AGO: Date = new Date("2026-07-22T11:50:00Z");

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

// A MAC whose OUI is in the bundled registry slice (Cisco 00:00:0c).
const CISCO_MAC: string = "00:00:0c:aa:bb:01";

const INSERT_PARAMS_PER_ROW: number = 14;
const UPDATE_PARAMS_PER_ROW: number = 11;

type QueryCall = [string, Array<unknown>];

type MacRow = { macAddress: string };

// The MAC of each row of a statement's parameters, in order.
function macsOfRows(
  params: Array<unknown>,
  firstMacAt: number,
  paramsPerRow: number,
): Array<string> {
  const macs: Array<string> = [];

  for (
    let index: number = firstMacAt;
    index < params.length;
    index += paramsPerRow
  ) {
    macs.push(params[index] as string);
  }

  return macs;
}

// The MACs an INSERT was handed, and an UPDATE (after its shared $1).
function insertedMacs(call: QueryCall): Array<string> {
  return macsOfRows(call[1], 1, INSERT_PARAMS_PER_ROW);
}

function updatedMacs(call: QueryCall): Array<string> {
  return macsOfRows(call[1], 1, UPDATE_PARAMS_PER_ROW);
}

/*
 * What Postgres answers with no other writer about: every row an INSERT
 * was handed is made, every row an UPDATE was handed is written - each
 * answered by its MAC, as the statements' RETURNING says.
 */
async function answerAsPostgres(
  sql: string,
  params: Array<unknown>,
): Promise<Array<MacRow>> {
  const call: QueryCall = [sql, params];
  const macs: Array<string> = sql.includes('INSERT INTO "NetworkEndpoint"')
    ? insertedMacs(call)
    : sql.includes('UPDATE "NetworkEndpoint"')
      ? updatedMacs(call)
      : [];

  return macs.map((mac: string): MacRow => {
    return { macAddress: mac };
  });
}

// A MAC per index, all under one OUI the registry does not know.
function macAt(index: number): string {
  const hex: string = index.toString(16).padStart(4, "0");
  return `aa:bb:cc:dd:${hex.substring(0, 2)}:${hex.substring(2, 4)}`;
}

// What the driver throws for a statement another writer's row lock stopped.
function lockContention(code: "55P03" | "40P01"): QueryFailedError {
  return new QueryFailedError(
    "INSERT ...",
    [],
    Object.assign(
      new Error(
        code === "55P03"
          ? "canceling statement due to lock timeout"
          : "deadlock detected",
      ),
      { code },
    ),
  );
}

describe("NetworkEndpointService.upsertDiscoveredEndpoints", () => {
  let findBySpy: jest.SpyInstance;
  let querySpy: jest.Mock;

  beforeEach(() => {
    findBySpy = jest
      .spyOn(NetworkEndpointService, "findBy")
      .mockResolvedValue([]);
    querySpy = jest.fn().mockImplementation(answerAsPostgres);
    jest
      .spyOn(NetworkEndpointService, "getRepository")
      .mockReturnValue({ manager: { query: querySpy } } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const callsMatching: (fragment: string) => Array<QueryCall> = (
    fragment: string,
  ): Array<QueryCall> => {
    return (querySpy.mock.calls as Array<QueryCall>).filter(
      (call: QueryCall) => {
        return call[0].includes(fragment);
      },
    );
  };

  const insertCalls: () => Array<QueryCall> = (): Array<QueryCall> => {
    return callsMatching('INSERT INTO "NetworkEndpoint"');
  };

  const updateCalls: () => Array<QueryCall> = (): Array<QueryCall> => {
    return callsMatching('UPDATE "NetworkEndpoint"');
  };

  const makeExistingRow: (data: {
    macAddress: string;
    attachedNetworkDeviceId?: ObjectID | undefined;
    attachedInterfaceIndex?: number | undefined;
    attachedPortName?: string | undefined;
    vlanId?: number | undefined;
    ipAddress?: string | undefined;
    siteId?: ObjectID | undefined;
    firstSeenAt?: Date | undefined;
    lastSeenAt?: Date | undefined;
  }) => NetworkEndpoint = (data: {
    macAddress: string;
    attachedNetworkDeviceId?: ObjectID | undefined;
    attachedInterfaceIndex?: number | undefined;
    attachedPortName?: string | undefined;
    vlanId?: number | undefined;
    ipAddress?: string | undefined;
    siteId?: ObjectID | undefined;
    firstSeenAt?: Date | undefined;
    lastSeenAt?: Date | undefined;
  }): NetworkEndpoint => {
    const row: NetworkEndpoint = new NetworkEndpoint();
    row.id = ROW_ID;
    row.macAddress = data.macAddress;
    if (data.attachedNetworkDeviceId) {
      row.attachedNetworkDeviceId = data.attachedNetworkDeviceId;
    }
    if (data.attachedInterfaceIndex !== undefined) {
      row.attachedInterfaceIndex = data.attachedInterfaceIndex;
    }
    if (data.attachedPortName) {
      row.attachedPortName = data.attachedPortName;
    }
    if (data.vlanId !== undefined) {
      row.vlanId = data.vlanId;
    }
    if (data.ipAddress) {
      row.ipAddress = data.ipAddress;
    }
    if (data.siteId) {
      row.siteId = data.siteId;
    }
    if (data.firstSeenAt) {
      row.firstSeenAt = data.firstSeenAt;
    }
    if (data.lastSeenAt) {
      row.lastSeenAt = data.lastSeenAt;
    }
    return row;
  };

  it("does not touch the database when there is nothing to upsert", async () => {
    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      deviceSiteId: SITE_ID,
      attachments: [],
      ipBindings: [],
      now: NOW,
    });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("creates a new row from an FDB attachment with vendor, site, and timestamps", async () => {
    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      deviceSiteId: SITE_ID,
      attachments: [
        {
          macAddress: CISCO_MAC,
          attachedInterfaceIndex: 7,
          attachedPortName: "Gi0/7",
          vlanId: 12,
        },
      ],
      ipBindings: [],
      now: NOW,
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(updateCalls()).toHaveLength(0);
    expect(insertCalls()).toHaveLength(1);

    const params: Array<unknown> = insertCalls()[0]![1];
    expect(params).toEqual([
      PROJECT_ID.toString(),
      CISCO_MAC,
      null, // ipAddress — the FDB knows none
      "Cisco Systems, Inc",
      SWITCH_ID.toString(),
      7,
      "Gi0/7",
      12,
      SITE_ID.toString(),
      NOW, // firstSeenAt
      NOW, // lastSeenAt
      0, // version
      null, // hostname: a walk knows no name
      null, // attachmentSource: a walk found it
    ]);
  });

  it("creates an ARP-only row attached to the router interface", async () => {
    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      attachments: [],
      ipBindings: [
        {
          macAddress: "aa:bb:cc:dd:ee:01",
          ipAddress: "10.0.0.31",
          routerInterfaceIndex: 3,
        },
      ],
      now: NOW,
    });

    expect(insertCalls()).toHaveLength(1);
    const params: Array<unknown> = insertCalls()[0]![1];
    expect(params).toEqual([
      PROJECT_ID.toString(),
      "aa:bb:cc:dd:ee:01",
      "10.0.0.31",
      null, // aa:bb:cc is not in the filtered registry
      SWITCH_ID.toString(),
      3, // the router's own interface
      null, // no port name
      null, // no vlan
      null, // no deviceSiteId passed — none stamped
      NOW,
      NOW,
      0,
      null,
      null,
    ]);
  });

  it("merges an FDB attachment and an ARP binding for the same MAC into one create", async () => {
    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      deviceSiteId: SITE_ID,
      attachments: [
        {
          macAddress: CISCO_MAC,
          attachedInterfaceIndex: 7,
          attachedPortName: "Gi0/7",
        },
      ],
      ipBindings: [
        {
          macAddress: CISCO_MAC,
          ipAddress: "10.0.0.31",
          routerInterfaceIndex: 99,
        },
      ],
      now: NOW,
    });

    expect(insertCalls()).toHaveLength(1);
    const params: Array<unknown> = insertCalls()[0]![1];
    expect(params).toHaveLength(INSERT_PARAMS_PER_ROW);
    // The FDB attachment wins the port; the ARP binding contributes the IP.
    expect(params[5]).toBe(7);
    expect(params[2]).toBe("10.0.0.31");
  });

  it("infers the partial unique index so soft-deleted rows never collide, and overwrites nothing another writer made", async () => {
    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      attachments: [
        { macAddress: "aa:bb:cc:dd:ee:01", attachedInterfaceIndex: 1 },
      ],
      ipBindings: [],
      now: NOW,
    });

    const call: QueryCall = insertCalls()[0]!;
    const sql: string = normalizeSql(call[0]);

    /*
     * DO NOTHING, answering the MACs it made: a MAC another writer made
     * first is decided again against that row, never written over (#7388).
     */
    expect(
      sql.endsWith(
        'ON CONFLICT ("projectId", "macAddress") WHERE "deletedAt" IS NULL DO NOTHING RETURNING "macAddress"',
      ),
    ).toBe(true);
    expect(sql).not.toContain("DO UPDATE");
    expectPlaceholdersMatchParameters({ sql: call[0], parameters: call[1] });
  });

  it("stamps the vendor on create only: a person may correct it, and no update writes it", async () => {
    findBySpy.mockResolvedValue([
      makeExistingRow({
        macAddress: CISCO_MAC,
        attachedNetworkDeviceId: OTHER_SWITCH_ID,
        attachedInterfaceIndex: 2,
        firstSeenAt: EARLIER,
        lastSeenAt: ONE_MINUTE_AGO,
      }),
    ]);

    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      attachments: [
        { macAddress: CISCO_MAC, attachedInterfaceIndex: 7 },
        { macAddress: "aa:bb:cc:dd:ee:01", attachedInterfaceIndex: 1 },
      ],
      ipBindings: [],
      now: NOW,
    });

    expect(insertCalls()[0]![0]).toContain('"vendor"');
    expect(updateCalls()[0]![0]).not.toContain('"vendor"');
  });

  it("updates an existing row when the FDB moves it to another port, keeping firstSeenAt", async () => {
    findBySpy.mockResolvedValue([
      makeExistingRow({
        macAddress: CISCO_MAC,
        attachedNetworkDeviceId: OTHER_SWITCH_ID,
        attachedInterfaceIndex: 2,
        firstSeenAt: EARLIER,
        lastSeenAt: ONE_MINUTE_AGO,
      }),
    ]);

    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      deviceSiteId: SITE_ID,
      attachments: [
        {
          macAddress: CISCO_MAC,
          attachedInterfaceIndex: 7,
          attachedPortName: "Gi0/7",
          vlanId: 12,
        },
      ],
      ipBindings: [],
      now: NOW,
    });

    expect(insertCalls()).toHaveLength(0);
    expect(updateCalls()).toHaveLength(1);

    const params: Array<unknown> = updateCalls()[0]![1];
    expect(params).toEqual([
      PROJECT_ID.toString(), // $1, shared
      CISCO_MAC,
      true, // setAttachment
      SWITCH_ID.toString(),
      7,
      "Gi0/7",
      12,
      SITE_ID.toString(),
      null, // no IP observed
      NOW, // lastSeenAt
      null, // no name: the stored one stays
      null, // a walk's row, so no controller's
    ]);

    const sql: string = updateCalls()[0]![0];
    // firstSeenAt is never rewritten when the row already has one.
    expect(sql).toContain(
      '"firstSeenAt" = COALESCE(e."firstSeenAt", v."lastSeenAt")',
    );
    // Soft-deleted rows are never resurrected by the bulk update.
    expect(sql).toContain('e."deletedAt" IS NULL');
  });

  /*
   * OneUptime issue #7389: a walk's sighting is timed when OneUptime received
   * the poll. An older poll processed after a newer one still writes what it
   * says that is new - the rules of who owns the port are not about time -
   * but it never takes the endpoint's last sighting back to its own. On the
   * row as Postgres reads it, so a walk written at the same moment counts.
   */
  it("never moves an endpoint's lastSeenAt backwards, on the row as it stands", async () => {
    findBySpy.mockResolvedValue([
      makeExistingRow({
        macAddress: CISCO_MAC,
        attachedNetworkDeviceId: SWITCH_ID,
        attachedInterfaceIndex: 2,
        firstSeenAt: EARLIER,
        lastSeenAt: NOW,
      }),
    ]);

    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      attachments: [{ macAddress: CISCO_MAC, attachedInterfaceIndex: 7 }],
      ipBindings: [],
      now: TEN_MINUTES_AGO,
    });

    // The port it saw is new, so it is written...
    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]![1][4]).toBe(7);

    // ...with its own sighting, which the row keeps only if it is later.
    expect(updateCalls()[0]![1][9]).toEqual(TEN_MINUTES_AGO);
    const sql: string = updateCalls()[0]![0];
    expect(sql).toContain(
      '"lastSeenAt" = GREATEST(e."lastSeenAt", v."lastSeenAt")',
    );
    expect(sql).not.toMatch(/"lastSeenAt" = v\."lastSeenAt"/);
  });

  it("lets ARP refresh the IP but not steal an attachment owned elsewhere", async () => {
    findBySpy.mockResolvedValue([
      makeExistingRow({
        macAddress: "aa:bb:cc:dd:ee:01",
        attachedNetworkDeviceId: OTHER_SWITCH_ID,
        attachedInterfaceIndex: 2,
        ipAddress: "10.0.0.5",
        firstSeenAt: EARLIER,
        lastSeenAt: ONE_MINUTE_AGO,
      }),
    ]);

    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      deviceSiteId: SITE_ID,
      attachments: [],
      ipBindings: [
        {
          macAddress: "aa:bb:cc:dd:ee:01",
          ipAddress: "10.0.0.99",
          routerInterfaceIndex: 3,
        },
      ],
      now: NOW,
    });

    expect(updateCalls()).toHaveLength(1);
    const params: Array<unknown> = updateCalls()[0]![1];
    expect(params).toEqual([
      PROJECT_ID.toString(),
      "aa:bb:cc:dd:ee:01",
      false, // setAttachment — the FDB owner keeps the port
      null, // deviceId not written
      null,
      null,
      null,
      null, // siteId not written either
      "10.0.0.99", // but the IP still refreshes
      NOW,
      null,
      null,
    ]);
  });

  it("backfills firstSeenAt on rows that predate first-seen tracking", async () => {
    findBySpy.mockResolvedValue([
      makeExistingRow({
        macAddress: "aa:bb:cc:dd:ee:01",
        attachedNetworkDeviceId: SWITCH_ID,
        attachedInterfaceIndex: 2,
        lastSeenAt: ONE_MINUTE_AGO,
        // No firstSeenAt.
      }),
    ]);

    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      attachments: [
        { macAddress: "aa:bb:cc:dd:ee:01", attachedInterfaceIndex: 2 },
      ],
      ipBindings: [],
      now: NOW,
    });

    /*
     * Nothing else changed and lastSeenAt is fresh, but the missing
     * firstSeenAt still forces the write.
     */
    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]![1][9]).toBe(NOW);
  });

  describe("unchanged-since-last-poll short circuit", () => {
    const stableRow: () => NetworkEndpoint = (): NetworkEndpoint => {
      return makeExistingRow({
        macAddress: CISCO_MAC,
        attachedNetworkDeviceId: SWITCH_ID,
        attachedInterfaceIndex: 7,
        attachedPortName: "Gi0/7",
        vlanId: 12,
        siteId: SITE_ID,
        firstSeenAt: EARLIER,
        lastSeenAt: ONE_MINUTE_AGO,
      });
    };

    const stableWalk: (
      now: Date,
      devicePollingIntervalInMinutes?: number | undefined,
    ) => Promise<void> = async (
      now: Date,
      devicePollingIntervalInMinutes?: number | undefined,
    ): Promise<void> => {
      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: SWITCH_ID,
        deviceSiteId: SITE_ID,
        devicePollingIntervalInMinutes: devicePollingIntervalInMinutes,
        attachments: [
          {
            macAddress: CISCO_MAC,
            attachedInterfaceIndex: 7,
            attachedPortName: "Gi0/7",
            vlanId: 12,
          },
        ],
        ipBindings: [],
        now: now,
      });
    };

    it("writes nothing for an endpoint that has not moved since the last poll", async () => {
      findBySpy.mockResolvedValue([stableRow()]);

      await stableWalk(NOW);

      // One SELECT, zero writes.
      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it("still refreshes lastSeenAt once it ages past the threshold", async () => {
      const row: NetworkEndpoint = stableRow();
      row.lastSeenAt = TEN_MINUTES_AGO;
      findBySpy.mockResolvedValue([row]);

      await stableWalk(NOW);

      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1][9]).toBe(NOW);
    });

    /*
     * The refresh used to be five minutes - the default poll interval - so
     * the very next poll found every endpoint due and rewrote it. It is
     * just under two polls now: the poll after a write writes nothing.
     */
    it("writes nothing on the poll after a write: five minutes on", async () => {
      const row: NetworkEndpoint = stableRow();
      row.lastSeenAt = minutesBefore(5);
      findBySpy.mockResolvedValue([row]);

      await stableWalk(NOW);

      expect(querySpy).not.toHaveBeenCalled();
    });

    it("refreshes on the poll after that: nine minutes on", async () => {
      const row: NetworkEndpoint = stableRow();
      row.lastSeenAt = minutesBefore(9);
      findBySpy.mockResolvedValue([row]);

      await stableWalk(NOW);

      expect(updateCalls()).toHaveLength(1);
    });

    it("waits two of the walked device's own polls: 18 minutes at a 10-minute interval", async () => {
      const row: NetworkEndpoint = stableRow();
      row.lastSeenAt = minutesBefore(15);
      findBySpy.mockResolvedValue([row]);

      await stableWalk(NOW, 10);
      expect(querySpy).not.toHaveBeenCalled();

      row.lastSeenAt = minutesBefore(18);
      await stableWalk(NOW, 10);
      expect(updateCalls()).toHaveLength(1);
    });

    it("a device polled every hour writes every poll, as before", async () => {
      const row: NetworkEndpoint = stableRow();
      row.lastSeenAt = minutesBefore(60);
      findBySpy.mockResolvedValue([row]);

      await stableWalk(NOW, 60);

      expect(updateCalls()).toHaveLength(1);
    });

    it("writes when the endpoint moves to a different port", async () => {
      findBySpy.mockResolvedValue([stableRow()]);

      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: SWITCH_ID,
        deviceSiteId: SITE_ID,
        attachments: [
          {
            macAddress: CISCO_MAC,
            attachedInterfaceIndex: 8,
            attachedPortName: "Gi0/8",
            vlanId: 12,
          },
        ],
        ipBindings: [],
        now: NOW,
      });

      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1][4]).toBe(8);
      expect(updateCalls()[0]![1][5]).toBe("Gi0/8");
    });

    it("writes when the endpoint moves to a different switch", async () => {
      findBySpy.mockResolvedValue([stableRow()]);

      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: OTHER_SWITCH_ID,
        deviceSiteId: SITE_ID,
        attachments: [
          {
            macAddress: CISCO_MAC,
            attachedInterfaceIndex: 7,
            attachedPortName: "Gi0/7",
            vlanId: 12,
          },
        ],
        ipBindings: [],
        now: NOW,
      });

      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1][3]).toBe(OTHER_SWITCH_ID.toString());
    });

    it("writes when the endpoint's IP changes", async () => {
      const row: NetworkEndpoint = stableRow();
      row.ipAddress = "10.0.0.5";
      findBySpy.mockResolvedValue([row]);

      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: SWITCH_ID,
        deviceSiteId: SITE_ID,
        attachments: [
          {
            macAddress: CISCO_MAC,
            attachedInterfaceIndex: 7,
            attachedPortName: "Gi0/7",
            vlanId: 12,
          },
        ],
        ipBindings: [
          {
            macAddress: CISCO_MAC,
            ipAddress: "10.0.0.6",
            routerInterfaceIndex: 3,
          },
        ],
        now: NOW,
      });

      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1][8]).toBe("10.0.0.6");
    });

    it("writes when the device moved to a different site", async () => {
      findBySpy.mockResolvedValue([stableRow()]);

      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: SWITCH_ID,
        deviceSiteId: OTHER_SWITCH_ID, // any different site id
        attachments: [
          {
            macAddress: CISCO_MAC,
            attachedInterfaceIndex: 7,
            attachedPortName: "Gi0/7",
            vlanId: 12,
          },
        ],
        ipBindings: [],
        now: NOW,
      });

      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1][7]).toBe(OTHER_SWITCH_ID.toString());
    });
  });

  describe("what a network controller's client list writes", () => {
    const KDS_MAC: string = "aa:bb:cc:00:00:51";

    const row: (data: Partial<NetworkEndpoint>) => NetworkEndpoint = (
      data: Partial<NetworkEndpoint>,
    ): NetworkEndpoint => {
      const existing: NetworkEndpoint = new NetworkEndpoint();
      existing._id = ROW_ID.toString();
      existing.macAddress = KDS_MAC;
      existing.attachedNetworkDeviceId = OTHER_SWITCH_ID;
      existing.firstSeenAt = EARLIER;
      existing.lastSeenAt = EARLIER;
      Object.assign(existing, data);
      return existing;
    };

    const upsertOne: (
      client?: Partial<EndpointControllerClient>,
    ) => Promise<number> = (
      client: Partial<EndpointControllerClient> = {},
    ): Promise<number> => {
      return NetworkEndpointService.upsertControllerClients({
        projectId: PROJECT_ID,
        source: "meraki",
        now: NOW,
        clients: [
          {
            macAddress: KDS_MAC,
            ipAddress: "10.18.166.51",
            hostname: "wb-0660-kds01",
            vendor: "Elo Touch",
            portName: "Port 7",
            vlanId: 18,
            seenAt: ONE_MINUTE_AGO,
            deviceId: SWITCH_ID,
            deviceSiteId: SITE_ID,
            ...client,
          },
        ],
      });
    };

    it("creates the row on the device the client is on, with what the controller knows", async () => {
      expect(await upsertOne()).toBe(1);

      expect(insertCalls()).toHaveLength(1);
      expect(insertCalls()[0]![1]).toEqual([
        PROJECT_ID.toString(),
        KDS_MAC,
        "10.18.166.51",
        "Elo Touch", // the registry has no such OUI
        SWITCH_ID.toString(),
        null, // a controller names a port and knows no ifIndex
        "Port 7",
        18,
        SITE_ID.toString(),
        ONE_MINUTE_AGO, // firstSeenAt
        ONE_MINUTE_AGO, // lastSeenAt: when it saw the client, not the read
        0,
        "wb-0660-kds01",
        "meraki",
      ]);
    });

    it("prefers the registry's vendor to what the controller says", async () => {
      await upsertOne({ macAddress: CISCO_MAC });

      expect(insertCalls()[0]![1][3]).toBe("Cisco Systems, Inc");
    });

    it("takes a row a walk attached to another switch, and clears the ifIndex that was the old port's", async () => {
      findBySpy.mockResolvedValue([
        row({ attachedInterfaceIndex: 3, attachedPortName: "port3" }),
      ]);

      await upsertOne();

      expect(insertCalls()).toHaveLength(0);
      const params: Array<unknown> = updateCalls()[0]![1];
      expect(params.slice(1)).toEqual([
        KDS_MAC,
        true,
        SWITCH_ID.toString(),
        null,
        "Port 7",
        18,
        SITE_ID.toString(),
        "10.18.166.51",
        ONE_MINUTE_AGO,
        "wb-0660-kds01",
        "meraki",
      ]);
      expect(updateCalls()[0]![0]).toContain(
        'WHEN v."setAttachment" AND v."attachmentSource" IS NOT NULL THEN v."attachedInterfaceIndex"',
      );
    });

    it("keeps the ifIndex when it is the same port on the same switch, so the link keeps its counters", async () => {
      findBySpy.mockResolvedValue([
        row({
          attachedNetworkDeviceId: SWITCH_ID,
          attachedInterfaceIndex: 7,
          attachedPortName: "Port 7",
        }),
      ]);

      await upsertOne();

      expect(updateCalls()[0]![1][4]).toBe(7);
    });

    it("never moves lastSeenAt backwards: a walk may have seen the client since", async () => {
      findBySpy.mockResolvedValue([row({ lastSeenAt: NOW })]);

      await upsertOne({ seenAt: EARLIER });

      expect(updateCalls()[0]![1][9]).toEqual(NOW);
    });

    it("writes a client it has nothing new about, unlike a walk: a list is read every two hours", async () => {
      findBySpy.mockResolvedValue([
        row({
          attachedNetworkDeviceId: SWITCH_ID,
          attachedPortName: "Port 7",
          vlanId: 18,
          ipAddress: "10.18.166.51",
          siteId: SITE_ID,
          hostname: "wb-0660-kds01",
          attachmentSource: "meraki",
          lastSeenAt: TEN_MINUTES_AGO,
        }),
      ]);

      await upsertOne();

      expect(updateCalls()).toHaveLength(1);
      expect(insertCalls()).toHaveLength(0);
    });

    it("looks every MAC up once, even across chunks, and counts what it wrote", async () => {
      const clients: Array<EndpointControllerClient> = [];

      for (let index: number = 0; index < 5100; index++) {
        const low: string = (index % 256).toString(16).padStart(2, "0");
        const high: string = (index >> 8).toString(16).padStart(2, "0");

        clients.push({
          macAddress: `aa:bb:cc:dd:${high}:${low}`,
          seenAt: NOW,
          deviceId: SWITCH_ID,
        });
      }

      const written: number =
        await NetworkEndpointService.upsertControllerClients({
          projectId: PROJECT_ID,
          source: "meraki",
          now: NOW,
          // The same list twice: a client is written once.
          clients: [...clients, ...clients],
        });

      expect(written).toBe(5100);
      expect(findBySpy).toHaveBeenCalledTimes(2);
      expect(insertCalls()).toHaveLength(11);
    });
  });

  describe("a walk that meets a row a controller placed", () => {
    const placed: (lastSeenAt: Date) => NetworkEndpoint = (
      lastSeenAt: Date,
    ): NetworkEndpoint => {
      const existing: NetworkEndpoint = new NetworkEndpoint();
      existing._id = ROW_ID.toString();
      existing.macAddress = CISCO_MAC;
      existing.attachedNetworkDeviceId = OTHER_SWITCH_ID;
      existing.attachedPortName = "Port 7";
      existing.attachmentSource = "meraki";
      existing.firstSeenAt = EARLIER;
      existing.lastSeenAt = lastSeenAt;
      return existing;
    };

    const walk: () => Promise<EndpointWriteCounts> =
      (): Promise<EndpointWriteCounts> => {
        return NetworkEndpointService.upsertDiscoveredEndpoints({
          projectId: PROJECT_ID,
          deviceId: SWITCH_ID,
          attachments: [
            {
              macAddress: CISCO_MAC,
              attachedInterfaceIndex: 49,
              attachedPortName: "port49",
            },
          ],
          ipBindings: [],
          now: NOW,
        });
      };

    it("writes nothing while the placement is current: an uplink is no access port", async () => {
      findBySpy.mockResolvedValue([placed(new Date("2026-07-22T09:00:00Z"))]);

      await walk();

      expect(insertCalls()).toHaveLength(0);
      expect(updateCalls()).toHaveLength(0);
    });

    it("takes the row over once the controller has stopped reporting it, and says so", async () => {
      findBySpy.mockResolvedValue([placed(new Date("2026-07-22T01:00:00Z"))]);

      await walk();

      const params: Array<unknown> = updateCalls()[0]![1];
      expect(params.slice(1, 6)).toEqual([
        CISCO_MAC,
        true,
        SWITCH_ID.toString(),
        49,
        "port49",
      ]);
      expect(params[UPDATE_PARAMS_PER_ROW]).toBeNull();
    });
  });

  describe("write volume", () => {
    const macFor: (index: number) => string = (index: number): string => {
      const hex: string = index.toString(16).padStart(4, "0");
      return `aa:bb:cc:dd:${hex.substring(0, 2)}:${hex.substring(2, 4)}`;
    };

    it("batches one findBy for all observed MACs, scoped to the project", async () => {
      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: SWITCH_ID,
        attachments: [
          { macAddress: "aa:bb:cc:dd:ee:01", attachedInterfaceIndex: 1 },
          { macAddress: "aa:bb:cc:dd:ee:02", attachedInterfaceIndex: 2 },
        ],
        ipBindings: [
          {
            macAddress: "aa:bb:cc:dd:ee:03",
            ipAddress: "10.0.0.3",
            routerInterfaceIndex: 9,
          },
        ],
        now: NOW,
      });

      expect(findBySpy).toHaveBeenCalledTimes(1);
      const findByArg: { query: Record<string, unknown> } = findBySpy.mock
        .calls[0]![0]! as unknown as { query: Record<string, unknown> };
      expect(findByArg.query["projectId"]).toBe(PROJECT_ID);

      // All three MACs ride in ONE insert, not three.
      expect(insertCalls()).toHaveLength(1);
      expect(insertCalls()[0]![1]).toHaveLength(3 * INSERT_PARAMS_PER_ROW);
    });

    it("writes 600 brand new MACs in 2 statements, not 600", async () => {
      const attachments: Array<{
        macAddress: string;
        attachedInterfaceIndex: number;
      }> = [];
      for (let i: number = 0; i < 600; i++) {
        attachments.push({
          macAddress: macFor(i),
          attachedInterfaceIndex: i % 48,
        });
      }

      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: SWITCH_ID,
        attachments: attachments,
        ipBindings: [],
        now: NOW,
      });

      // ceil(600 / 500) === 2, and nothing else.
      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(insertCalls()).toHaveLength(2);
      expect(insertCalls()[0]![1]).toHaveLength(500 * INSERT_PARAMS_PER_ROW);
      expect(insertCalls()[1]![1]).toHaveLength(100 * INSERT_PARAMS_PER_ROW);
    });

    it("issues one SELECT and zero writes for a stable 600-MAC switch", async () => {
      const attachments: Array<{
        macAddress: string;
        attachedInterfaceIndex: number;
      }> = [];
      const rows: Array<NetworkEndpoint> = [];
      for (let i: number = 0; i < 600; i++) {
        attachments.push({
          macAddress: macFor(i),
          attachedInterfaceIndex: i % 48,
        });
        rows.push(
          makeExistingRow({
            macAddress: macFor(i),
            attachedNetworkDeviceId: SWITCH_ID,
            attachedInterfaceIndex: i % 48,
            firstSeenAt: EARLIER,
            lastSeenAt: ONE_MINUTE_AGO,
          }),
        );
      }
      findBySpy.mockResolvedValue(rows);

      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: SWITCH_ID,
        attachments: attachments,
        ipBindings: [],
        now: NOW,
      });

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it("splits mixed creates and updates into exactly one statement each", async () => {
      const attachments: Array<{
        macAddress: string;
        attachedInterfaceIndex: number;
      }> = [];
      const rows: Array<NetworkEndpoint> = [];
      for (let i: number = 0; i < 10; i++) {
        // Every MAC is observed on port 99 this poll.
        attachments.push({ macAddress: macFor(i), attachedInterfaceIndex: 99 });
        if (i < 4) {
          // The first four already exist, on a different port -> updates.
          rows.push(
            makeExistingRow({
              macAddress: macFor(i),
              attachedNetworkDeviceId: SWITCH_ID,
              attachedInterfaceIndex: 1,
              firstSeenAt: EARLIER,
              lastSeenAt: ONE_MINUTE_AGO,
            }),
          );
        }
      }
      findBySpy.mockResolvedValue(rows);

      await NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: SWITCH_ID,
        attachments: attachments,
        ipBindings: [],
        now: NOW,
      });

      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(insertCalls()).toHaveLength(1);
      expect(updateCalls()).toHaveLength(1);
      expect(insertCalls()[0]![1]).toHaveLength(6 * INSERT_PARAMS_PER_ROW);
      // +1 for the shared projectId parameter.
      expect(updateCalls()[0]![1]).toHaveLength(4 * UPDATE_PARAMS_PER_ROW + 1);
    });
  });

  /*
   * One MAC is seen by many devices at the same moment, so the walks of a
   * project write the same endpoints at once (OneUptime issue #7388). They
   * used to wait for each other's row locks - deadlocks, lock timeouts, and
   * the rest of the walk's inventory lost with the error.
   */
  describe("a walk that meets other writers", () => {
    const MAC_A: string = "aa:bb:cc:dd:ee:01";
    const MAC_B: string = "aa:bb:cc:dd:ee:02";

    // A row of `mac` on port 1 of SWITCH_ID; a walk on another port moves it.
    const known: (mac: string) => NetworkEndpoint = (
      mac: string,
    ): NetworkEndpoint => {
      return makeExistingRow({
        macAddress: mac,
        attachedNetworkDeviceId: SWITCH_ID,
        attachedInterfaceIndex: 1,
        firstSeenAt: EARLIER,
        lastSeenAt: ONE_MINUTE_AGO,
      });
    };

    const walkOnPort9: (macs: Array<string>) => Promise<EndpointWriteCounts> = (
      macs: Array<string>,
    ): Promise<EndpointWriteCounts> => {
      return NetworkEndpointService.upsertDiscoveredEndpoints({
        projectId: PROJECT_ID,
        deviceId: SWITCH_ID,
        deviceSiteId: SITE_ID,
        attachments: macs.map((mac: string) => {
          return { macAddress: mac, attachedInterfaceIndex: 9 };
        }),
        ipBindings: [],
        now: NOW,
      });
    };

    // The MACs the n-th read of the walk asked for.
    const macsReadBy: (call: number) => Array<string> = (
      call: number,
    ): Array<string> => {
      const query: { macAddress: FindOperator<unknown> } = (
        findBySpy.mock.calls[call]![0] as {
          query: { macAddress: FindOperator<unknown> };
        }
      ).query;

      return Object.values(
        query.macAddress.objectLiteralParameters || {},
      )[0] as Array<string>;
    };

    // What the service said it left, in its own words.
    const serviceLines: (spy: jest.SpyInstance) => Array<string> = (
      spy: jest.SpyInstance,
    ): Array<string> => {
      return spy.mock.calls
        .map((call: Array<unknown>): string => {
          return String(call[0]);
        })
        .filter((line: string): boolean => {
          return line.startsWith("NetworkEndpointService:");
        });
    };

    const answerNothingOnce: () => void = (): void => {
      querySpy.mockImplementationOnce(async (): Promise<Array<MacRow>> => {
        return [];
      });
    };

    it("writes only the rows nobody else holds: locked FOR NO KEY UPDATE SKIP LOCKED, never waited for", async () => {
      findBySpy.mockResolvedValue([known(MAC_A), known(MAC_B)]);

      expect(await walkOnPort9([MAC_A, MAC_B])).toEqual({
        written: 2,
        skipped: 0,
      });

      expect(updateCalls()).toHaveLength(1);
      const call: QueryCall = updateCalls()[0]!;
      const sql: string = normalizeSql(call[0]);

      // The chunk's rows, typed, once - for the lock and for the write.
      expect(
        sql.startsWith(
          'WITH "observed" ("macAddress", "setAttachment", "deviceId", "attachedInterfaceIndex", "attachedPortName", "vlanId", "siteId", "ipAddress", "lastSeenAt", "hostname", "attachmentSource") AS ( VALUES ($2::character varying, $3::boolean, $4::uuid,',
        ),
      ).toBe(true);
      expect(sql).toContain(
        '"locked" AS ( SELECT e."_id" FROM "NetworkEndpoint" AS e INNER JOIN "observed" AS o ON o."macAddress" = e."macAddress" WHERE e."projectId" = $1 AND e."deletedAt" IS NULL FOR NO KEY UPDATE OF e SKIP LOCKED )',
      );
      // FOR UPDATE would also stop every foreign key check of the row.
      expect(sql).not.toMatch(/FOR UPDATE/);
      expect(sql).toContain(
        '"written" AS ( UPDATE "NetworkEndpoint" AS e SET ',
      );
      expect(sql).toContain(
        'FROM "observed" AS v WHERE e."projectId" = $1 AND e."macAddress" = v."macAddress" AND e."deletedAt" IS NULL AND e."_id" IN (SELECT "_id" FROM "locked") RETURNING e."macAddress" )',
      );
      expect(sql.endsWith('SELECT "macAddress" FROM "written"')).toBe(true);
      expectPlaceholdersMatchParameters({ sql: call[0], parameters: call[1] });
    });

    it("counts a row another writer held as skipped, and says in the debug log what it left for the next walk", async () => {
      const debug: jest.SpyInstance = jest
        .spyOn(logger, "debug")
        .mockImplementation((() => {
          return undefined;
        }) as never);
      findBySpy.mockResolvedValue([known(MAC_A), known(MAC_B)]);
      // It locked and wrote MAC_A; another writer held MAC_B.
      querySpy.mockImplementationOnce(async (): Promise<Array<MacRow>> => {
        return [{ macAddress: MAC_A }];
      });

      expect(await walkOnPort9([MAC_A, MAC_B])).toEqual({
        written: 1,
        skipped: 1,
      });

      expect(serviceLines(debug)).toHaveLength(1);
      expect(serviceLines(debug)[0]).toContain(SWITCH_ID.toString());
      expect(serviceLines(debug)[0]).toContain(
        "wrote 1 endpoints and left 1 for its next walk",
      );
    });

    it("logs nothing about a walk that wrote everything it had to", async () => {
      const debug: jest.SpyInstance = jest
        .spyOn(logger, "debug")
        .mockImplementation((() => {
          return undefined;
        }) as never);
      findBySpy.mockResolvedValue([known(MAC_A)]);

      expect(await walkOnPort9([MAC_A, MAC_B])).toEqual({
        written: 2,
        skipped: 0,
      });
      expect(serviceLines(debug)).toEqual([]);
    });

    it("inserts new MACs in MAC order, whatever order the switch listed them in: two walks never wait for each other in a circle", async () => {
      const macs: Array<string> = [];
      for (let index: number = 599; index >= 0; index--) {
        macs.push(macAt(index));
      }

      await walkOnPort9(macs);

      expect(insertCalls()).toHaveLength(2);
      expect(insertCalls().flatMap(insertedMacs)).toEqual([...macs].sort());
    });

    it("inserts a controller's new clients in MAC order too", async () => {
      const clients: Array<EndpointControllerClient> = [];
      for (let index: number = 599; index >= 0; index--) {
        clients.push({
          macAddress: macAt(index),
          seenAt: NOW,
          deviceId: SWITCH_ID,
        });
      }

      expect(
        await NetworkEndpointService.upsertControllerClients({
          projectId: PROJECT_ID,
          source: "meraki",
          now: NOW,
          clients,
        }),
      ).toBe(600);

      expect(insertCalls().flatMap(insertedMacs)).toEqual(
        clients
          .map((client: EndpointControllerClient): string => {
            return client.macAddress;
          })
          .sort(),
      );
    });

    it("decides a MAC another writer made first again, against the row it made: a router's ARP table does not take a switch's port", async () => {
      // The read found no row; by the insert, a switch's walk had made one.
      findBySpy.mockResolvedValueOnce([]).mockResolvedValueOnce([
        makeExistingRow({
          macAddress: MAC_A,
          attachedNetworkDeviceId: OTHER_SWITCH_ID,
          attachedInterfaceIndex: 7,
          firstSeenAt: ONE_MINUTE_AGO,
          lastSeenAt: ONE_MINUTE_AGO,
        }),
      ]);
      answerNothingOnce();

      const counts: EndpointWriteCounts =
        await NetworkEndpointService.upsertDiscoveredEndpoints({
          projectId: PROJECT_ID,
          deviceId: SWITCH_ID,
          attachments: [],
          ipBindings: [
            {
              macAddress: MAC_A,
              ipAddress: "10.0.0.31",
              routerInterfaceIndex: 3,
            },
          ],
          now: NOW,
        });

      expect(counts).toEqual({ written: 1, skipped: 0 });
      // Read again: only the MAC it did not make.
      expect(findBySpy).toHaveBeenCalledTimes(2);
      expect(macsReadBy(1)).toEqual([MAC_A]);
      expect(insertCalls()).toHaveLength(1);
      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1]).toEqual([
        PROJECT_ID.toString(),
        MAC_A,
        false, // the switch keeps its port
        null,
        null,
        null,
        null,
        null,
        "10.0.0.31", // and the router adds the address
        NOW,
        null,
        null,
      ]);
    });

    it("writes nothing to a MAC a controller placed first, while the placement stands", async () => {
      const placed: NetworkEndpoint = makeExistingRow({
        macAddress: CISCO_MAC,
        attachedNetworkDeviceId: OTHER_SWITCH_ID,
        attachedPortName: "Port 7",
        firstSeenAt: ONE_MINUTE_AGO,
        lastSeenAt: ONE_MINUTE_AGO,
      });
      placed.attachmentSource = "meraki";
      findBySpy.mockResolvedValueOnce([]).mockResolvedValueOnce([placed]);
      answerNothingOnce();

      expect(await walkOnPort9([CISCO_MAC])).toEqual({
        written: 0,
        skipped: 0,
      });
      expect(insertCalls()).toHaveLength(1);
      expect(updateCalls()).toHaveLength(0);
    });

    it("leaves a MAC made and deleted again before its second read for the next walk, and never inserts it twice", async () => {
      answerNothingOnce();

      expect(await walkOnPort9([MAC_A])).toEqual({ written: 0, skipped: 1 });
      expect(findBySpy).toHaveBeenCalledTimes(2);
      expect(insertCalls()).toHaveLength(1);
      expect(updateCalls()).toHaveLength(0);
    });

    it("leaves the rows of a statement that waited out the lock timeout for the next walk, says so, and writes the rest", async () => {
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation((() => {
          return undefined;
        }) as never);
      const macs: Array<string> = [];
      for (let index: number = 0; index < 600; index++) {
        macs.push(macAt(index));
      }
      findBySpy.mockResolvedValue([known(macs[599]!)]);
      // The first of the two inserts.
      querySpy.mockImplementationOnce(async (): Promise<never> => {
        throw lockContention("55P03");
      });

      expect(await walkOnPort9(macs)).toEqual({ written: 100, skipped: 500 });

      // The next insert, and the update, still ran.
      expect(insertCalls()).toHaveLength(2);
      expect(updateCalls()).toHaveLength(1);
      expect(serviceLines(warn)).toHaveLength(1);
      expect(serviceLines(warn)[0]).toContain(
        "500 endpoints were left for the next walk",
      );
      expect(serviceLines(warn)[0]).toContain("lock timeout");
    });

    it("leaves the rows of an update cancelled out of a deadlock the same way", async () => {
      jest.spyOn(logger, "warn").mockImplementation((() => {
        return undefined;
      }) as never);
      findBySpy.mockResolvedValue([known(MAC_A), known(MAC_B)]);
      querySpy.mockImplementationOnce(async (): Promise<never> => {
        throw lockContention("40P01");
      });

      expect(await walkOnPort9([MAC_A, MAC_B])).toEqual({
        written: 0,
        skipped: 2,
      });
    });

    it("still fails on an error that is not another writer's lock", async () => {
      querySpy.mockImplementationOnce(async (): Promise<never> => {
        throw new Error("value too long for type character varying(100)");
      });

      await expect(walkOnPort9([MAC_A])).rejects.toThrow("value too long");
    });

    it("counts a controller's clients it wrote, not the ones another writer held", async () => {
      findBySpy.mockResolvedValue([known(MAC_A), known(MAC_B)]);
      querySpy.mockImplementationOnce(async (): Promise<Array<MacRow>> => {
        return [{ macAddress: MAC_B }];
      });

      expect(
        await NetworkEndpointService.upsertControllerClients({
          projectId: PROJECT_ID,
          source: "meraki",
          now: NOW,
          clients: [MAC_A, MAC_B].map(
            (mac: string): EndpointControllerClient => {
              return {
                macAddress: mac,
                portName: "Port 3",
                seenAt: NOW,
                deviceId: OTHER_SWITCH_ID,
              };
            },
          ),
        }),
      ).toBe(1);
    });
  });
});
