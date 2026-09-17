import NetworkEndpointService from "../../../Server/Services/NetworkEndpointService";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import ObjectID from "../../../Types/ObjectID";

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
// Inside the 5 minute lastSeenAt refresh threshold.
const ONE_MINUTE_AGO: Date = new Date("2026-07-22T11:59:00Z");
// Past the 5 minute refresh threshold.
const TEN_MINUTES_AGO: Date = new Date("2026-07-22T11:50:00Z");

// A MAC whose OUI is in the bundled registry slice (Cisco 00:00:0c).
const CISCO_MAC: string = "00:00:0c:aa:bb:01";

const INSERT_PARAMS_PER_ROW: number = 12;
const UPDATE_PARAMS_PER_ROW: number = 9;

type QueryCall = [string, Array<unknown>];

describe("NetworkEndpointService.upsertDiscoveredEndpoints", () => {
  let findBySpy: jest.SpyInstance;
  let querySpy: jest.Mock;

  beforeEach(() => {
    findBySpy = jest
      .spyOn(NetworkEndpointService, "findBy")
      .mockResolvedValue([]);
    querySpy = jest.fn().mockResolvedValue([]);
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

  it("infers the partial unique index so soft-deleted rows never collide", async () => {
    await NetworkEndpointService.upsertDiscoveredEndpoints({
      projectId: PROJECT_ID,
      deviceId: SWITCH_ID,
      attachments: [
        { macAddress: "aa:bb:cc:dd:ee:01", attachedInterfaceIndex: 1 },
      ],
      ipBindings: [],
      now: NOW,
    });

    const sql: string = insertCalls()[0]![0];
    expect(sql).toContain(
      'ON CONFLICT ("projectId", "macAddress") WHERE "deletedAt" IS NULL',
    );
    // vendor is create-only (user-correctable) — never in the conflict branch.
    expect(sql.split("DO UPDATE SET")[1]).not.toContain('"vendor"');
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
    ]);

    const sql: string = updateCalls()[0]![0];
    // firstSeenAt is never rewritten when the row already has one.
    expect(sql).toContain(
      '"firstSeenAt" = COALESCE(e."firstSeenAt", v."lastSeenAt")',
    );
    // Soft-deleted rows are never resurrected by the bulk update.
    expect(sql).toContain('e."deletedAt" IS NULL');
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

    const stableWalk: (now: Date) => Promise<void> = async (
      now: Date,
    ): Promise<void> => {
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
});
