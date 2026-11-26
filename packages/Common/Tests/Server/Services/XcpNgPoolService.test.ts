import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import XcpNgPoolService, {
  XCP_NG_POOL_NAMING,
  getXcpNgPoolNameToFollow,
} from "../../../Server/Services/XcpNgPoolService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ReceivingCoverage from "../../../Server/Utils/Telemetry/ReceivingCoverage";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import XcpNgPool from "../../../Models/DatabaseModels/XcpNgPool";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";

/*
 * XcpNgPoolService - the row one pool Xen Orchestra reports becomes.
 *
 * Pinned here:
 *   - getXcpNgPoolNameToFollow: a pool follows the name Xen Orchestra gives
 *     it while nobody renamed it here - every case;
 *   - XCP_NG_POOL_NAMING: what a person's create and its refusals say;
 *   - findOrCreateByIdentifier: matched on the pool's UUID (trimmed and
 *     lower-cased, case aside), named after Xen Orchestra's name or the
 *     start of its UUID, made unique by that start on a clash, and found
 *     again when a racing worker's insert wins;
 *   - recordReportedNames: written only when what Xen Orchestra reports
 *     changed, remembered in Redis, never failing ingest;
 *   - updateLastSeen / updateAgentLastSeen: what the heartbeat is handed;
 *   - markDisconnectedPools, the dashboard link, and the create hook's
 *     normalization.
 *
 * Everything external is mocked - no Postgres, no Redis.
 */

const UUID: string = "1e8b7c4a-3f2d-4b6e-9a1c-0d5e7f9b2a3c";
const SHORT: string = "1e8b7c4a";
const PLACEHOLDER: string = `Pool ${SHORT}`;
const POOL_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service: any = XcpNgPoolService as any;

function pool(overrides: Partial<XcpNgPool>): XcpNgPool {
  const model: XcpNgPool = new XcpNgPool(POOL_ID);
  model.projectId = PROJECT_ID;
  model.poolIdentifier = UUID;
  model.name = "Production";
  Object.assign(model, overrides);
  return model;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getXcpNgPoolNameToFollow", () => {
  const follow: (data: {
    currentName?: string | null | undefined;
    previousReportedName?: string | null | undefined;
    reportedName?: string | null | undefined;
    poolIdentifier?: string | undefined;
  }) => string | null = (data: {
    currentName?: string | null | undefined;
    previousReportedName?: string | null | undefined;
    reportedName?: string | null | undefined;
    poolIdentifier?: string | undefined;
  }): string | null => {
    return getXcpNgPoolNameToFollow({
      currentName: data.currentName,
      previousReportedName: data.previousReportedName,
      reportedName: data.reportedName,
      poolIdentifier: data.poolIdentifier ?? UUID,
    });
  };

  test.each([undefined, null, "", "   ", "\t\n"])(
    "a pool losing its name in Xen Orchestra (%p) keeps the one it has",
    (reportedName: string | null | undefined) => {
      expect(
        follow({
          currentName: "Production",
          previousReportedName: "Production",
          reportedName,
        }),
      ).toBeNull();
      expect(follow({ currentName: PLACEHOLDER, reportedName })).toBeNull();
    },
  );

  test("a name that is already Xen Orchestra's is left alone", () => {
    expect(
      follow({
        currentName: "Production",
        previousReportedName: "Production",
        reportedName: "Production",
      }),
    ).toBeNull();
  });

  test("spaces around either name do not make it a change", () => {
    expect(
      follow({
        currentName: " Production ",
        previousReportedName: "Production",
        reportedName: "Production  ",
      }),
    ).toBeNull();
  });

  test("the placeholder of a pool that had no name follows Xen Orchestra's first name", () => {
    expect(
      follow({
        currentName: PLACEHOLDER,
        previousReportedName: undefined,
        reportedName: "Production",
      }),
    ).toBe("Production");
  });

  test("so does the placeholder made unique by the start of the UUID", () => {
    expect(
      follow({
        currentName: `${PLACEHOLDER} (${SHORT})`,
        previousReportedName: null,
        reportedName: "Production",
      }),
    ).toBe("Production");
  });

  test("a name that is still Xen Orchestra's last one follows a rename there", () => {
    expect(
      follow({
        currentName: "Production",
        previousReportedName: "Production",
        reportedName: "Production EU",
      }),
    ).toBe("Production EU");
  });

  test("so does that name made unique by the start of the UUID", () => {
    expect(
      follow({
        currentName: `Production (${SHORT})`,
        previousReportedName: "Production",
        reportedName: "Production EU",
      }),
    ).toBe("Production EU");
  });

  test("the previous name is compared trimmed", () => {
    expect(
      follow({
        currentName: "Production",
        previousReportedName: "  Production  ",
        reportedName: "Staging",
      }),
    ).toBe("Staging");
  });

  test("a person's rename sticks: a name that is neither Xen Orchestra's last nor the placeholder", () => {
    expect(
      follow({
        currentName: "Lab pool (ours)",
        previousReportedName: "Production",
        reportedName: "Production EU",
      }),
    ).toBeNull();
  });

  test("a pool never told Xen Orchestra's name, renamed by a person, keeps it", () => {
    expect(
      follow({
        currentName: "Named by hand",
        previousReportedName: undefined,
        reportedName: "Production",
      }),
    ).toBeNull();
    expect(
      follow({
        currentName: "Named by hand",
        previousReportedName: "",
        reportedName: "Production",
      }),
    ).toBeNull();
  });

  test("an empty previous name never matches an empty current one", () => {
    expect(
      follow({
        currentName: "",
        previousReportedName: "",
        reportedName: "Production",
      }),
    ).toBeNull();
    expect(
      follow({
        currentName: null,
        previousReportedName: null,
        reportedName: "Production",
      }),
    ).toBeNull();
  });

  test("a suffix of another pool's UUID is a person's choice, not the placeholder", () => {
    expect(
      follow({
        currentName: "Production (deadbeef)",
        previousReportedName: "Production",
        reportedName: "Production EU",
      }),
    ).toBeNull();
    expect(
      follow({
        currentName: "Pool deadbeef",
        previousReportedName: undefined,
        reportedName: "Production",
      }),
    ).toBeNull();
  });

  test("the UUID is read the way telemetry reports it: case and spaces aside", () => {
    expect(
      follow({
        currentName: PLACEHOLDER,
        reportedName: "Production",
        poolIdentifier: `  ${UUID.toUpperCase()} `,
      }),
    ).toBe("Production");
  });

  test("returns Xen Orchestra's name trimmed", () => {
    expect(
      follow({
        currentName: PLACEHOLDER,
        reportedName: "  Production  ",
      }),
    ).toBe("Production");
  });
});

describe("XCP_NG_POOL_NAMING", () => {
  test("matches on the pool's UUID", () => {
    expect(XCP_NG_POOL_NAMING.identityColumn).toBe("poolIdentifier");
  });

  test("names a pool after the start of its UUID", () => {
    const model: XcpNgPool = new XcpNgPool();
    model.poolIdentifier = UUID.toUpperCase();

    expect(XCP_NG_POOL_NAMING.getDefaultName(model)).toBe(PLACEHOLDER);
  });

  test("refuses a second pool with the same UUID in its own words", () => {
    expect(XCP_NG_POOL_NAMING.getIdentityTakenMessage(UUID)).toBe(
      `An XCP-ng pool with the pool UUID "${UUID}" already exists.`,
    );
  });

  test("refuses a name another pool has, saying whether that pool is archived", () => {
    expect(XCP_NG_POOL_NAMING.getNameTakenMessage("Production")).toBe(
      'Another XCP-ng pool is already named "Production". Give this one a different display name.',
    );
    expect(
      XCP_NG_POOL_NAMING.getNameTakenMessage("Production", {
        isArchived: true,
      } as never),
    ).toBe(
      'An archived XCP-ng pool is already named "Production". Unarchive it, or give this one a different display name.',
    );
  });
});

describe("XcpNgPoolService.findOrCreateByIdentifier", () => {
  interface FindCall {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    props: { isRoot?: boolean };
  }

  let findCalls: Array<FindCall>;

  /*
   * findOneBy answers the identity lookup (by poolIdentifier) with
   * `byIdentifier`, one call after another, and the name lookup (by name)
   * with `nameHolder`.
   */
  function mockFindOneBy(data: {
    byIdentifier: Array<XcpNgPool | null>;
    nameHolder?: XcpNgPool | null;
  }): void {
    const identityAnswers: Array<XcpNgPool | null> = [...data.byIdentifier];

    jest
      .spyOn(XcpNgPoolService, "findOneBy")
      .mockImplementation(async (input: unknown): Promise<XcpNgPool | null> => {
        const call: FindCall = input as FindCall;
        findCalls.push(call);

        if ("poolIdentifier" in call.query) {
          return identityAnswers.length > 0 ? identityAnswers.shift()! : null;
        }

        if ("name" in call.query) {
          return data.nameHolder || null;
        }

        return null;
      });
  }

  beforeEach(() => {
    findCalls = [];
  });

  test.each(["", "   ", "\n"])(
    "refuses a pool with no UUID (%p)",
    async (poolIdentifier: string) => {
      await expect(
        XcpNgPoolService.findOrCreateByIdentifier({
          projectId: PROJECT_ID,
          poolIdentifier,
        }),
      ).rejects.toThrow("An XCP-ng pool needs a UUID to be found or created.");
    },
  );

  test("returns the pool it finds by its UUID, read trimmed and lower-cased, case aside", async () => {
    const existing: XcpNgPool = pool({});
    mockFindOneBy({ byIdentifier: [existing] });
    const create: jest.SpyInstance = jest.spyOn(XcpNgPoolService, "create");
    const sameText: jest.SpyInstance = jest.spyOn(
      QueryHelper,
      "findWithSameText",
    );

    const result: XcpNgPool = await XcpNgPoolService.findOrCreateByIdentifier({
      projectId: PROJECT_ID,
      poolIdentifier: `  ${UUID.toUpperCase()}  `,
      reportedName: "Production",
    });

    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();
    expect(sameText).toHaveBeenCalledWith(UUID);
    expect(findCalls).toHaveLength(1);
    expect(findCalls[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(findCalls[0]!.props.isRoot).toBe(true);
    expect(findCalls[0]!.select).toEqual({
      _id: true,
      projectId: true,
      poolIdentifier: true,
      name: true,
    });
  });

  test("creates a new pool as root, named and described as Xen Orchestra reports it", async () => {
    mockFindOneBy({ byIdentifier: [null] });
    const create: jest.SpyInstance = jest
      .spyOn(XcpNgPoolService, "create")
      .mockImplementation(async (input: unknown): Promise<XcpNgPool> => {
        return (input as { data: XcpNgPool }).data;
      });

    const result: XcpNgPool = await XcpNgPoolService.findOrCreateByIdentifier({
      projectId: PROJECT_ID,
      poolIdentifier: UUID.toUpperCase(),
      reportedName: "  Production  ",
      xenOrchestraName: "  xo.example.com ",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(
      (create.mock.calls[0]![0] as { props: { isRoot: boolean } }).props.isRoot,
    ).toBe(true);
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.poolIdentifier).toBe(UUID);
    expect(result.name).toBe("Production");
    expect(result.reportedName).toBe("Production");
    expect(result.xenOrchestraName).toBe("xo.example.com");
    // Not connected until a batch carrying it reaches the snapshot flush.
    expect(result.otelCollectorStatus).toBeUndefined();
    expect(result.lastSeenAt).toBeUndefined();
  });

  test("a pool Xen Orchestra reports with no name is named after the start of its UUID", async () => {
    mockFindOneBy({ byIdentifier: [null] });
    jest
      .spyOn(XcpNgPoolService, "create")
      .mockImplementation(async (input: unknown): Promise<XcpNgPool> => {
        return (input as { data: XcpNgPool }).data;
      });

    const result: XcpNgPool = await XcpNgPoolService.findOrCreateByIdentifier({
      projectId: PROJECT_ID,
      poolIdentifier: UUID,
      reportedName: "   ",
      xenOrchestraName: "",
    });

    expect(result.name).toBe(PLACEHOLDER);
    expect(result.reportedName).toBeUndefined();
    expect(result.xenOrchestraName).toBeUndefined();
  });

  test("a name another pool of the project already has is made unique by the start of the UUID", async () => {
    mockFindOneBy({
      byIdentifier: [null],
      nameHolder: pool({
        poolIdentifier: "ffffffff-0000-0000-0000-000000000000",
      }),
    });
    jest
      .spyOn(XcpNgPoolService, "create")
      .mockImplementation(async (input: unknown): Promise<XcpNgPool> => {
        return (input as { data: XcpNgPool }).data;
      });

    const result: XcpNgPool = await XcpNgPoolService.findOrCreateByIdentifier({
      projectId: PROJECT_ID,
      poolIdentifier: UUID,
      reportedName: "Production",
    });

    expect(result.name).toBe(`Production (${SHORT})`);
    // What Xen Orchestra calls it is kept as it said it.
    expect(result.reportedName).toBe("Production");

    const nameLookup: FindCall | undefined = findCalls.find(
      (call: FindCall) => {
        return "name" in call.query;
      },
    );
    expect(nameLookup?.query["projectId"]).toBe(PROJECT_ID);
    expect(nameLookup?.props.isRoot).toBe(true);
  });

  test("finds the winner's row when a racing worker's insert wins", async () => {
    const winner: XcpNgPool = pool({});
    mockFindOneBy({ byIdentifier: [null, winner] });
    jest
      .spyOn(XcpNgPoolService, "create")
      .mockRejectedValue(new Error("duplicate key value"));

    const result: XcpNgPool = await XcpNgPoolService.findOrCreateByIdentifier({
      projectId: PROJECT_ID,
      poolIdentifier: UUID,
      reportedName: "Production",
    });

    expect(result).toBe(winner);
    expect(
      findCalls.filter((call: FindCall) => {
        return "poolIdentifier" in call.query;
      }),
    ).toHaveLength(2);
  });

  test("throws only when the row is still missing after the race's re-read", async () => {
    mockFindOneBy({ byIdentifier: [null, null] });
    jest
      .spyOn(XcpNgPoolService, "create")
      .mockRejectedValue(new Error("database is on fire"));

    await expect(
      XcpNgPoolService.findOrCreateByIdentifier({
        projectId: PROJECT_ID,
        poolIdentifier: UUID,
      }),
    ).rejects.toThrow(`Failed to create or find XCP-ng pool: ${UUID}`);
  });
});

describe("XcpNgPoolService.recordReportedNames", () => {
  const NAMESPACE: string = "xcp-ng-pool-reported-names";

  let cache: Map<string, string>;
  let updates: Array<{ id: ObjectID; data: Record<string, unknown> }>;

  function mockCache(options?: { failRead?: boolean }): void {
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(
        async (namespace: string, key: string): Promise<string | null> => {
          if (options?.failRead) {
            throw new Error("redis is down");
          }
          return cache.get(`${namespace}:${key}`) ?? null;
        },
      );
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          cache.set(`${namespace}:${key}`, value);
        },
      );
  }

  function mockRow(row: XcpNgPool | null): jest.SpyInstance {
    return jest
      .spyOn(XcpNgPoolService, "findOneById")
      .mockResolvedValue(row as never);
  }

  function mockNameHolder(holder: XcpNgPool | null): void {
    jest.spyOn(XcpNgPoolService, "findOneBy").mockResolvedValue(holder);
  }

  beforeEach(() => {
    cache = new Map<string, string>();
    updates = [];
    jest
      .spyOn(XcpNgPoolService, "updateOneById")
      .mockImplementation(async (input: unknown): Promise<number> => {
        const call: { id: ObjectID; data: Record<string, unknown> } = input as {
          id: ObjectID;
          data: Record<string, unknown>;
        };
        updates.push({ id: call.id, data: { ...call.data } });
        return 1;
      });
  });

  test("does nothing at all when Xen Orchestra reports neither name", async () => {
    mockCache();
    const read: jest.SpyInstance = mockRow(pool({}));

    await XcpNgPoolService.recordReportedNames({
      xcpNgPoolId: POOL_ID,
      reportedName: "  ",
      xenOrchestraName: undefined,
    });

    expect(GlobalCache.getString).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  test("records what changed, and remembers it so the next batch reads nothing", async () => {
    mockCache();
    const read: jest.SpyInstance = mockRow(
      pool({
        name: "Production",
        reportedName: "Production",
        xenOrchestraName: "xo-old",
      }),
    );
    mockNameHolder(null);

    await XcpNgPoolService.recordReportedNames({
      xcpNgPoolId: POOL_ID,
      reportedName: " Production EU ",
      xenOrchestraName: " xo.example.com ",
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe(POOL_ID);
    expect(updates[0]!.data).toEqual({
      name: "Production EU",
      reportedName: "Production EU",
      xenOrchestraName: "xo.example.com",
    });
    expect(cache.get(`${NAMESPACE}:${POOL_ID.toString()}`)).toBe(
      JSON.stringify(["Production EU", "xo.example.com"]),
    );

    await XcpNgPoolService.recordReportedNames({
      xcpNgPoolId: POOL_ID,
      reportedName: "Production EU",
      xenOrchestraName: "xo.example.com",
    });

    // The second batch was answered from Redis.
    expect(read).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
  });

  test("a pool a person renamed keeps its name, and still records Xen Orchestra's", async () => {
    mockCache();
    mockRow(
      pool({
        name: "Our lab",
        reportedName: "Production",
        xenOrchestraName: "xo.example.com",
      }),
    );
    mockNameHolder(null);

    await XcpNgPoolService.recordReportedNames({
      xcpNgPoolId: POOL_ID,
      reportedName: "Production EU",
      xenOrchestraName: "xo.example.com",
    });

    expect(updates).toEqual([
      { id: POOL_ID, data: { reportedName: "Production EU" } },
    ]);
  });

  test("a followed name another pool already has is made unique by the start of the UUID", async () => {
    mockCache();
    // A pool Xen Orchestra never named: its placeholder, no reported name.
    mockRow(
      pool({
        name: PLACEHOLDER,
      }),
    );
    // Another pool of the project, not this one, holds the name.
    mockNameHolder(new XcpNgPool(ObjectID.generate()));

    await XcpNgPoolService.recordReportedNames({
      xcpNgPoolId: POOL_ID,
      reportedName: "Production",
    });

    expect(updates[0]!.data).toEqual({
      name: `Production (${SHORT})`,
      reportedName: "Production",
    });
  });

  test("the pool's own row holding the name is not a clash", async () => {
    mockCache();
    mockRow(
      pool({
        name: `Production (${SHORT})`,
        reportedName: "Production",
      }),
    );
    // The one row named "Production EU" case aside is this pool itself.
    mockNameHolder(new XcpNgPool(POOL_ID));

    await XcpNgPoolService.recordReportedNames({
      xcpNgPoolId: POOL_ID,
      reportedName: "Production EU",
    });

    expect(updates[0]!.data).toEqual({
      name: "Production EU",
      reportedName: "Production EU",
    });
  });

  test("writes nothing when nothing changed, but remembers it", async () => {
    mockCache();
    mockRow(
      pool({
        name: "Production",
        reportedName: "Production",
        xenOrchestraName: "xo.example.com",
      }),
    );
    mockNameHolder(null);

    await XcpNgPoolService.recordReportedNames({
      xcpNgPoolId: POOL_ID,
      reportedName: "Production",
      xenOrchestraName: "xo.example.com",
    });

    expect(updates).toEqual([]);
    expect(cache.has(`${NAMESPACE}:${POOL_ID.toString()}`)).toBe(true);
  });

  test("a cache that cannot be read is a cache miss", async () => {
    mockCache({ failRead: true });
    const read: jest.SpyInstance = mockRow(
      pool({ name: "Production", reportedName: "Production" }),
    );
    mockNameHolder(null);

    await XcpNgPoolService.recordReportedNames({
      xcpNgPoolId: POOL_ID,
      reportedName: "Production",
    });

    expect(read).toHaveBeenCalledTimes(1);
  });

  test("a pool that is gone, or has no UUID, is left alone and not remembered", async () => {
    mockCache();
    mockRow(null);

    await XcpNgPoolService.recordReportedNames({
      xcpNgPoolId: POOL_ID,
      reportedName: "Production",
    });

    expect(updates).toEqual([]);
    expect(cache.size).toBe(0);
  });

  test("a failed read or write never fails ingest: it is logged", async () => {
    mockCache();
    jest
      .spyOn(XcpNgPoolService, "findOneById")
      .mockRejectedValue(new Error("postgres is down"));
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });

    await expect(
      XcpNgPoolService.recordReportedNames({
        xcpNgPoolId: POOL_ID,
        reportedName: "Production",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("postgres is down");
  });
});

describe("XcpNgPoolService heartbeats", () => {
  interface HeartbeatCall {
    id: ObjectID;
    cacheNamespace: string;
    throttleInSeconds: number;
    liveness: Record<string, unknown>;
    metadata: Record<string, unknown>;
    fingerprint: string;
  }

  let calls: Array<HeartbeatCall>;

  beforeEach(() => {
    calls = [];
    jest
      .spyOn(ResourceHeartbeat, "write")
      .mockImplementation(async (input: unknown) => {
        calls.push(input as HeartbeatCall);
        return { wrote: true } as never;
      });
  });

  test("a read pool is connected and seen now, on its own throttled key", async () => {
    await XcpNgPoolService.updateLastSeen(POOL_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe(POOL_ID);
    expect(calls[0]!.cacheNamespace).toBe("xcp-ng-pool-last-seen");
    expect(calls[0]!.throttleInSeconds).toBe(60);
    expect(calls[0]!.liveness["otelCollectorStatus"]).toBe("connected");
    expect(calls[0]!.liveness["lastSeenAt"]).toBeInstanceOf(Date);
    expect(calls[0]!.metadata).toEqual({});
  });

  test("writes every count it is given, 0 included, and leaves out the ones it is not", async () => {
    await XcpNgPoolService.updateLastSeen(POOL_ID, {
      hostCount: 3,
      runningHostCount: 0,
      vmCount: 12,
      runningVmCount: undefined,
      storageCapacityBytes: 1099511627776,
      storageUsedBytes: Number.NaN,
    });

    expect(calls[0]!.metadata).toEqual({
      hostCount: 3,
      runningHostCount: 0,
      vmCount: 12,
      storageCapacityBytes: 1099511627776,
    });
  });

  test("two different snapshots have two different fingerprints, one snapshot one", async () => {
    await XcpNgPoolService.updateLastSeen(POOL_ID, { hostCount: 3 });
    await XcpNgPoolService.updateLastSeen(POOL_ID, { hostCount: 3 });
    await XcpNgPoolService.updateLastSeen(POOL_ID, { hostCount: 4 });

    expect(calls[0]!.fingerprint).toBe(calls[1]!.fingerprint);
    expect(calls[0]!.fingerprint).not.toBe(calls[2]!.fingerprint);
  });

  test("the agent's heartbeat is its own: agentLastSeenAt and its version, never the pool's liveness", async () => {
    await XcpNgPoolService.updateAgentLastSeen(POOL_ID, {
      agentVersion: "0.165.0",
    });

    expect(calls[0]!.cacheNamespace).toBe("xcp-ng-pool-agent-last-seen");
    expect(Object.keys(calls[0]!.liveness)).toEqual(["agentLastSeenAt"]);
    expect(calls[0]!.liveness["agentLastSeenAt"]).toBeInstanceOf(Date);
    expect(calls[0]!.metadata).toEqual({ agentVersion: "0.165.0" });
  });

  test("an agent that names no version writes none", async () => {
    await XcpNgPoolService.updateAgentLastSeen(POOL_ID);

    expect(calls[0]!.metadata).toEqual({});
  });
});

describe("XcpNgPoolService.markDisconnectedPools", () => {
  test("marks the connected pools not read since the silence cutoff disconnected", async () => {
    const cutoff: Date = new Date("2026-11-24T10:00:00.000Z");
    jest.spyOn(ReceivingCoverage, "getSilenceCutoff").mockResolvedValue(cutoff);
    const lessThan: jest.SpyInstance = jest.spyOn(QueryHelper, "lessThan");
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();
    const findBy: jest.SpyInstance = jest
      .spyOn(XcpNgPoolService, "findBy")
      .mockResolvedValue([new XcpNgPool(first), new XcpNgPool(second)]);
    const updates: Array<{ id: ObjectID; data: unknown }> = [];
    jest
      .spyOn(XcpNgPoolService, "updateOneById")
      .mockImplementation(async (input: unknown): Promise<number> => {
        updates.push(input as { id: ObjectID; data: unknown });
        return 1;
      });

    await XcpNgPoolService.markDisconnectedPools();

    expect(ReceivingCoverage.getSilenceCutoff).toHaveBeenCalledWith({
      silenceInMinutes: 15,
    });
    expect(lessThan).toHaveBeenCalledWith(cutoff);
    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["otelCollectorStatus"]).toBe("connected");
    expect(
      updates.map((update: { id: ObjectID; data: unknown }) => {
        return [update.id.toString(), update.data];
      }),
    ).toEqual([
      [first.toString(), { otelCollectorStatus: "disconnected" }],
      [second.toString(), { otelCollectorStatus: "disconnected" }],
    ]);
  });
});

describe("XcpNgPoolService links and names", () => {
  test("links to the pool's page in the dashboard", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example.com/dashboard"),
      );

    const link: URL = await XcpNgPoolService.getXcpNgPoolLinkInDashboard(
      PROJECT_ID,
      POOL_ID,
    );

    expect(link.toString()).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/xcp-ng/${POOL_ID.toString()}`,
    );
  });

  test("names the pool for feed items, and a pool that is gone as nothing", async () => {
    jest
      .spyOn(XcpNgPoolService, "findOneById")
      .mockResolvedValueOnce(pool({ name: "Production" }) as never)
      .mockResolvedValueOnce(null as never);

    await expect(
      XcpNgPoolService.getXcpNgPoolName({ xcpNgPoolId: POOL_ID }),
    ).resolves.toBe("Production");
    await expect(
      XcpNgPoolService.getXcpNgPoolName({ xcpNgPoolId: POOL_ID }),
    ).resolves.toBe("");
  });
});

describe("XcpNgPoolService.onBeforeCreate", () => {
  beforeEach(() => {
    jest
      .spyOn(
        ProjectReferencesService.prototype as unknown as {
          onBeforeCreate: (createBy: CreateBy<XcpNgPool>) => Promise<unknown>;
        },
        "onBeforeCreate",
      )
      .mockImplementation(async (createBy: CreateBy<XcpNgPool>) => {
        return { createBy, carryForward: null };
      });
  });

  test("stores a person's UUID the way telemetry reports it, and names the pool after it", async () => {
    const data: XcpNgPool = new XcpNgPool();
    data.projectId = PROJECT_ID;
    data.poolIdentifier = `  ${UUID.toUpperCase()} `;

    const createBy: CreateBy<XcpNgPool> = {
      data,
      props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
    } as CreateBy<XcpNgPool>;

    await service.onBeforeCreate(createBy);

    expect(createBy.data.poolIdentifier).toBe(UUID);
    expect(createBy.data.name).toBe(PLACEHOLDER);
  });

  test("keeps a name a person gave it", async () => {
    const data: XcpNgPool = new XcpNgPool();
    data.projectId = PROJECT_ID;
    data.poolIdentifier = UUID;
    data.name = "  Production  ";

    const createBy: CreateBy<XcpNgPool> = {
      data,
      props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
    } as CreateBy<XcpNgPool>;

    await service.onBeforeCreate(createBy);

    expect(createBy.data.name).toBe("Production");
  });
});
