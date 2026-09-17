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

import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import VMwareVCenterFeedService from "../../../Server/Services/VMwareVCenterFeedService";
import VMwareVCenterLabelRuleEngineService from "../../../Server/Services/VMwareVCenterLabelRuleEngineService";
import VMwareVCenterOwnerRuleEngineService from "../../../Server/Services/VMwareVCenterOwnerRuleEngineService";
import UserService from "../../../Server/Services/UserService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import { VMwareVCenterFeedEventType } from "../../../Models/DatabaseModels/VMwareVCenterFeed";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";

/*
 * VMwareVCenterService — the row one VMware Agent reports into.
 *
 * Pinned here:
 *   - findOrCreateByName: auto-registration from the `vmware.vcenter.name`
 *     resource attribute is case-insensitive on lookup, preserves the
 *     user's casing on create, and re-resolves instead of throwing when
 *     the unique guard (or a racing ingest worker) rejects the insert.
 *   - updateLastSeen: extras are gated on `!== undefined` so a partial
 *     batch never zeroes a count while a genuine 0 is still written; the
 *     heartbeat is throttled per row through ResourceHeartbeat.
 *   - markDisconnectedVCenters: 15-minute threshold (3x the ingest fence).
 *   - Feed events on create / archive / restore / meaningful update, and
 *     silence on heartbeats.
 *   - The label-rule engine runs before the owner-rule engine on create,
 *     and neither can fail the create.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

const VCENTER_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const ACTING_USER_ID: ObjectID = ObjectID.generate();

interface FeedCall {
  vmwareVCenterId: ObjectID;
  projectId: ObjectID;
  vmwareVCenterFeedEventType: VMwareVCenterFeedEventType;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
  userId?: ObjectID | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service: any = VMwareVCenterService as any;

function vcenter(overrides: Partial<VMwareVCenter>): VMwareVCenter {
  const model: VMwareVCenter = new VMwareVCenter(VCENTER_ID);
  model.projectId = PROJECT_ID;
  model.name = "vcsa-prod";
  Object.assign(model, overrides);
  return model;
}

/** Let the fire-and-forget rule/feed chain drain before asserting on it. */
function flushPromises(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VMwareVCenterService.findOrCreateByName", () => {
  test("returns the existing row from a case-insensitive lookup without creating", async () => {
    const existing: VMwareVCenter = vcenter({ name: "VCSA-Prod" });
    const findOneBy: jest.SpyInstance = jest
      .spyOn(VMwareVCenterService, "findOneBy")
      .mockResolvedValue(existing);
    const create: jest.SpyInstance = jest
      .spyOn(VMwareVCenterService, "create")
      .mockResolvedValue(existing);
    const sameText: jest.SpyInstance = jest.spyOn(
      QueryHelper,
      "findWithSameText",
    );

    const result: VMwareVCenter = await VMwareVCenterService.findOrCreateByName(
      { projectId: PROJECT_ID, name: "  vcsa-prod " },
    );

    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();
    expect(findOneBy).toHaveBeenCalledTimes(1);
    // The lookup goes through the case-insensitive helper with the trimmed name.
    expect(sameText).toHaveBeenCalledWith("vcsa-prod");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = findOneBy.mock.calls[0]![0].query;
    expect(query.projectId).toBe(PROJECT_ID);
    expect(findOneBy.mock.calls[0]![0].props.isRoot).toBe(true);
  });

  test("creates with the user's casing preserved, marked connected and seen now", async () => {
    jest.spyOn(VMwareVCenterService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(VMwareVCenterService, "create")
      .mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (input: any): Promise<VMwareVCenter> => {
          return input.data as VMwareVCenter;
        },
      );

    const before: number = Date.now();
    const result: VMwareVCenter = await VMwareVCenterService.findOrCreateByName(
      { projectId: PROJECT_ID, name: " VCSA-Prod " },
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].props.isRoot).toBe(true);
    expect(result.name).toBe("VCSA-Prod");
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.otelCollectorStatus).toBe("connected");
    expect(result.lastSeenAt).toBeInstanceOf(Date);
    expect(result.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("re-resolves instead of throwing when the unique guard rejects a racing create", async () => {
    const winner: VMwareVCenter = vcenter({ name: "vcsa-prod" });
    const findOneBy: jest.SpyInstance = jest
      .spyOn(VMwareVCenterService, "findOneBy")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    jest
      .spyOn(VMwareVCenterService, "create")
      .mockRejectedValue(new Error("vCenter with this name already exists"));

    const result: VMwareVCenter = await VMwareVCenterService.findOrCreateByName(
      { projectId: PROJECT_ID, name: "VCSA-PROD" },
    );

    expect(result).toBe(winner);
    expect(findOneBy).toHaveBeenCalledTimes(2);
  });

  test("throws only when the row is still missing after the race re-fetch", async () => {
    jest.spyOn(VMwareVCenterService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(VMwareVCenterService, "create")
      .mockRejectedValue(new Error("database is on fire"));

    await expect(
      VMwareVCenterService.findOrCreateByName({
        projectId: PROJECT_ID,
        name: "vcsa-prod",
      }),
    ).rejects.toThrow("Failed to create or find vCenter: vcsa-prod");
  });
});

describe("VMwareVCenterService.updateLastSeen", () => {
  type WriteCall = { id: ObjectID; data: Record<string, unknown> };

  let writes: Array<WriteCall>;
  let cache: Map<string, string>;

  /** A faithful in-memory Redis for the two atomic gate primitives. */
  function mockCache(): void {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, value);
        return true;
      });
    jest
      .spyOn(GlobalCache, "setStringIfChanged")
      .mockImplementation(async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        return true;
      });
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (ns: string, key: string) => {
        cache.delete(`${ns}:${key}`);
      });
  }

  function lastWrite(): Record<string, unknown> {
    return writes[writes.length - 1]!.data;
  }

  beforeEach(() => {
    writes = [];
    cache = new Map<string, string>();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    mockCache();
    jest
      .spyOn(VMwareVCenterService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
        writes.push({
          id: input.id,
          data: { ...(input.data as Record<string, unknown>) },
        });
        return true;
      });
  });

  afterEach(() => {
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
  });

  test("writes liveness alone when no extras are supplied", async () => {
    await VMwareVCenterService.updateLastSeen(VCENTER_ID);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.id.toString()).toBe(VCENTER_ID.toString());
    expect(Object.keys(lastWrite()).sort()).toEqual([
      "lastSeenAt",
      "otelCollectorStatus",
    ]);
    expect(lastWrite()["otelCollectorStatus"]).toBe("connected");
    expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
  });

  test("writes every snapshot column the spec names, and 0 is a value", async () => {
    await VMwareVCenterService.updateLastSeen(VCENTER_ID, {
      agentVersion: "0.118.0",
      datacenterCount: 1,
      clusterCount: 2,
      hostCount: 8,
      vmCount: 120,
      poweredOnVmCount: 0,
      datastoreCount: 6,
      resourcePoolCount: 0,
      datastoreCapacityBytes: 80_000_000_000_000,
      datastoreUsedBytes: 0,
    });

    expect(writes).toHaveLength(1);
    expect(lastWrite()).toMatchObject({
      otelCollectorStatus: "connected",
      agentVersion: "0.118.0",
      datacenterCount: 1,
      clusterCount: 2,
      hostCount: 8,
      vmCount: 120,
      poweredOnVmCount: 0,
      datastoreCount: 6,
      resourcePoolCount: 0,
      datastoreCapacityBytes: 80_000_000_000_000,
      datastoreUsedBytes: 0,
    });
  });

  test("a missing count is not written, so a partial batch never zeroes a column", async () => {
    await VMwareVCenterService.updateLastSeen(VCENTER_ID, {
      hostCount: 8,
      // No datastore in this batch: the keys are absent, not 0.
    });

    const data: Record<string, unknown> = lastWrite();
    expect(data["hostCount"]).toBe(8);
    for (const column of [
      "datacenterCount",
      "clusterCount",
      "vmCount",
      "poweredOnVmCount",
      "datastoreCount",
      "resourcePoolCount",
      "datastoreCapacityBytes",
      "datastoreUsedBytes",
      "agentVersion",
    ]) {
      expect(column in data).toBe(false);
    }
  });

  test("an empty agentVersion is not written (truthiness gate for strings)", async () => {
    await VMwareVCenterService.updateLastSeen(VCENTER_ID, {
      agentVersion: "",
      vmCount: 3,
    });

    expect("agentVersion" in lastWrite()).toBe(false);
    expect(lastWrite()["vmCount"]).toBe(3);
  });

  test("an identical snapshot inside the window costs no second write", async () => {
    const extras: { hostCount: number; vmCount: number } = {
      hostCount: 8,
      vmCount: 120,
    };
    await VMwareVCenterService.updateLastSeen(VCENTER_ID, extras);
    SingleFlight.clear();
    await VMwareVCenterService.updateLastSeen(VCENTER_ID, extras);

    expect(writes).toHaveLength(1);
  });

  test("gauges that move every collection cannot force a write per batch", async () => {
    for (let scrape: number = 0; scrape < 20; scrape++) {
      SingleFlight.clear();
      await VMwareVCenterService.updateLastSeen(VCENTER_ID, {
        poweredOnVmCount: 100 + scrape,
        datastoreUsedBytes: 5_000_000_000_000 + scrape * 1_000_000,
      });
    }

    expect(writes.length).toBeLessThanOrEqual(2);
  });

  test("uses its own liveness namespace, distinct from the Proxmox one", async () => {
    await VMwareVCenterService.updateLastSeen(VCENTER_ID);

    expect(cache.has(`vmware-vcenter-last-seen:${VCENTER_ID.toString()}`)).toBe(
      true,
    );
    expect(
      cache.has(`proxmox-cluster-last-seen:${VCENTER_ID.toString()}`),
    ).toBe(false);
  });
});

describe("VMwareVCenterService.markDisconnectedVCenters", () => {
  test("flips connected vCenters unseen for 15 minutes to disconnected", async () => {
    const staleA: ObjectID = ObjectID.generate();
    const staleB: ObjectID = ObjectID.generate();
    const findBy: jest.SpyInstance = jest
      .spyOn(VMwareVCenterService, "findBy")
      .mockResolvedValue([
        vcenter({ _id: staleA.toString() }),
        vcenter({ _id: staleB.toString() }),
      ]);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(VMwareVCenterService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const lessThan: jest.SpyInstance = jest.spyOn(QueryHelper, "lessThan");

    const before: number = Date.now();
    await VMwareVCenterService.markDisconnectedVCenters();
    const after: number = Date.now();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = findBy.mock.calls[0]![0].query;
    expect(query.otelCollectorStatus).toBe("connected");
    expect(findBy.mock.calls[0]![0].props.isRoot).toBe(true);

    /*
     * The threshold must stay well above the 5-minute ingest maintenance
     * fence — a threshold equal to the fence flaps healthy vCenters.
     */
    expect(lessThan).toHaveBeenCalledTimes(1);
    const threshold: Date = lessThan.mock.calls[0]![0] as Date;
    const fifteenMinutes: number = 15 * 60 * 1000;
    expect(before - threshold.getTime()).toBeGreaterThanOrEqual(
      fifteenMinutes - 1000,
    );
    expect(after - threshold.getTime()).toBeLessThanOrEqual(
      fifteenMinutes + 1000,
    );

    expect(updateOneById).toHaveBeenCalledTimes(2);
    expect(
      updateOneById.mock.calls.map((call: Array<unknown>) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (call[0] as any).id.toString();
      }),
    ).toEqual([staleA.toString(), staleB.toString()]);
    for (const call of updateOneById.mock.calls) {
      expect(call[0].data).toEqual({ otelCollectorStatus: "disconnected" });
      expect(call[0].props.isRoot).toBe(true);
    }
  });

  test("does nothing when every connected vCenter has been seen recently", async () => {
    jest.spyOn(VMwareVCenterService, "findBy").mockResolvedValue([]);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(VMwareVCenterService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await VMwareVCenterService.markDisconnectedVCenters();

    expect(updateOneById).not.toHaveBeenCalled();
  });
});

describe("VMwareVCenterService markdown link", () => {
  test("renders [vCenter <name>](<dashboard>/<projectId>/vmware/<id>)", async () => {
    jest
      .spyOn(VMwareVCenterService, "findOneById")
      .mockResolvedValue(vcenter({ name: "vcsa-prod" }));
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example.com/dashboard"),
      );

    const link: string =
      await VMwareVCenterService.getVMwareVCenterMarkdownLink(
        PROJECT_ID,
        VCENTER_ID,
      );

    expect(link.startsWith("[vCenter vcsa-prod](")).toBe(true);
    expect(link).toContain(
      `/dashboard/${PROJECT_ID.toString()}/vmware/${VCENTER_ID.toString()}`,
    );
    expect(link.endsWith(")")).toBe(true);
  });

  test("names a deleted vCenter with an empty string instead of throwing", async () => {
    jest.spyOn(VMwareVCenterService, "findOneById").mockResolvedValue(null);

    await expect(
      VMwareVCenterService.getVMwareVCenterName({
        vmwareVCenterId: VCENTER_ID,
      }),
    ).resolves.toBe("");
  });
});

describe("VMwareVCenter feed events", () => {
  let feedCalls: Array<FeedCall>;

  beforeEach(() => {
    feedCalls = [];

    jest
      .spyOn(VMwareVCenterFeedService, "createVMwareVCenterFeedItem")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((data: any): Promise<void> => {
        feedCalls.push(data as FeedCall);
        return Promise.resolve();
      });

    jest
      .spyOn(VMwareVCenterService, "getVMwareVCenterMarkdownLink")
      .mockImplementation((): Promise<string> => {
        return Promise.resolve(
          "[vCenter vcsa-prod](https://example.com/vcenter)",
        );
      });

    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation((): Promise<string> => {
        return Promise.resolve("Jane Doe (jane@example.com)");
      });

    jest
      .spyOn(VMwareVCenterService, "findOneById")
      .mockImplementation((): Promise<VMwareVCenter | null> => {
        return Promise.resolve(vcenter({}));
      });
  });

  test("a dashboard create is attributed to the acting user", async () => {
    await service.writeVMwareVCenterCreatedFeed(vcenter({}), {
      createBy: { props: { userId: ACTING_USER_ID } },
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.vmwareVCenterFeedEventType).toBe(
      VMwareVCenterFeedEventType.VMwareVCenterCreated,
    );
    expect(feedCalls[0]!.vmwareVCenterId.toString()).toBe(
      VCENTER_ID.toString(),
    );
    expect(feedCalls[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("Jane Doe");
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain(
      "**Automatically created from telemetry**: No.",
    );
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("an ingest create says telemetry registered it", async () => {
    await service.writeVMwareVCenterCreatedFeed(vcenter({}), {
      createBy: { props: { isRoot: true } },
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain(
      "**Automatically created from telemetry**: Yes.",
    );
    expect(feedCalls[0]!.userId).toBeUndefined();
  });

  test("writes nothing for a row with no project", async () => {
    await service.writeVMwareVCenterCreatedFeed(new VMwareVCenter(VCENTER_ID), {
      createBy: { props: {} },
    });

    expect(feedCalls).toHaveLength(0);
  });

  test("stays silent for a heartbeat", async () => {
    await service.writeVMwareVCenterUpdatedFeed(
      {
        updateBy: {
          data: {
            lastSeenAt: new Date(),
            otelCollectorStatus: "connected",
            agentVersion: "0.118.0",
            hostCount: 8,
            vmCount: 120,
            poweredOnVmCount: 97,
            datastoreUsedBytes: 5_000_000_000_000,
          },
          props: {},
        },
      },
      [VCENTER_ID],
    );

    expect(feedCalls).toHaveLength(0);
  });

  test("records a rename and names the field", async () => {
    await service.writeVMwareVCenterUpdatedFeed(
      {
        updateBy: {
          data: { name: "vcsa-prod-2", lastSeenAt: new Date() },
          props: { userId: ACTING_USER_ID },
        },
      },
      [VCENTER_ID],
    );

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.vmwareVCenterFeedEventType).toBe(
      VMwareVCenterFeedEventType.VMwareVCenterUpdated,
    );
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain("`name`");
    expect(feedCalls[0]!.moreInformationInMarkdown).not.toContain(
      "`lastSeenAt`",
    );
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("archiving and restoring get their own events", async () => {
    await service.writeVMwareVCenterUpdatedFeed(
      { updateBy: { data: { isArchived: true }, props: {} } },
      [VCENTER_ID],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.vmwareVCenterFeedEventType;
      }),
    ).toEqual([VMwareVCenterFeedEventType.VMwareVCenterArchived]);
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("was archived");

    feedCalls = [];

    await service.writeVMwareVCenterUpdatedFeed(
      { updateBy: { data: { isArchived: false }, props: {} } },
      [VCENTER_ID],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.vmwareVCenterFeedEventType;
      }),
    ).toEqual([VMwareVCenterFeedEventType.VMwareVCenterRestored]);
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("restored");
  });

  test("an archive that also renames records both, and not as one muddled entry", async () => {
    await service.writeVMwareVCenterUpdatedFeed(
      {
        updateBy: {
          data: { isArchived: true, name: "retired-vcsa" },
          props: {},
        },
      },
      [VCENTER_ID],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.vmwareVCenterFeedEventType;
      }),
    ).toEqual([
      VMwareVCenterFeedEventType.VMwareVCenterArchived,
      VMwareVCenterFeedEventType.VMwareVCenterUpdated,
    ]);
    expect(feedCalls[1]!.moreInformationInMarkdown).toContain("`name`");
    expect(feedCalls[1]!.moreInformationInMarkdown).not.toContain(
      "`isArchived`",
    );
  });

  test("skips a row it can no longer resolve a project for", async () => {
    jest
      .spyOn(VMwareVCenterService, "findOneById")
      .mockImplementation((): Promise<VMwareVCenter | null> => {
        return Promise.resolve(null);
      });

    await service.writeVMwareVCenterUpdatedFeed(
      { updateBy: { data: { name: "gone" }, props: {} } },
      [VCENTER_ID],
    );

    expect(feedCalls).toHaveLength(0);
  });

  test("onUpdateSuccess never lets a failing feed write fail the update", async () => {
    jest
      .spyOn(service, "writeVMwareVCenterUpdatedFeed")
      .mockImplementation((): Promise<void> => {
        return Promise.reject(new Error("feed write blew up"));
      });

    const onUpdate: {
      updateBy: { data: { name: string }; props: Record<string, unknown> };
    } = {
      updateBy: { data: { name: "x" }, props: {} },
    };

    await expect(service.onUpdateSuccess(onUpdate, [VCENTER_ID])).resolves.toBe(
      onUpdate,
    );
  });
});

describe("VMwareVCenterService.onCreateSuccess", () => {
  let order: Array<string>;

  beforeEach(() => {
    order = [];
    jest
      .spyOn(VMwareVCenterLabelRuleEngineService, "applyRulesToVMwareVCenter")
      .mockImplementation(async (): Promise<void> => {
        order.push("label");
      });
    jest
      .spyOn(VMwareVCenterOwnerRuleEngineService, "applyRulesToVMwareVCenter")
      .mockImplementation(async (): Promise<void> => {
        order.push("owner");
      });
    jest
      .spyOn(service, "writeVMwareVCenterCreatedFeed")
      .mockImplementation(async (): Promise<void> => {
        order.push("feed");
      });
  });

  test("runs the label-rule engine before the owner-rule engine so owner rules can match rule-added labels", async () => {
    const created: VMwareVCenter = vcenter({});

    await expect(
      service.onCreateSuccess({ createBy: { props: {} } }, created),
    ).resolves.toBe(created);
    await flushPromises();

    expect(order.indexOf("label")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("owner")).toBeGreaterThan(order.indexOf("label"));
    expect(order).toContain("feed");
    expect(
      VMwareVCenterLabelRuleEngineService.applyRulesToVMwareVCenter,
    ).toHaveBeenCalledWith(created);
    expect(
      VMwareVCenterOwnerRuleEngineService.applyRulesToVMwareVCenter,
    ).toHaveBeenCalledWith(created);
  });

  test("skips the rule engines for a row without a project, but still writes the feed", async () => {
    const created: VMwareVCenter = new VMwareVCenter(VCENTER_ID);

    await service.onCreateSuccess({ createBy: { props: {} } }, created);
    await flushPromises();

    expect(order).toEqual(["feed"]);
  });

  test("a failing rule engine or feed write cannot fail the create", async () => {
    jest
      .spyOn(VMwareVCenterLabelRuleEngineService, "applyRulesToVMwareVCenter")
      .mockRejectedValue(new Error("label engine down"));
    jest
      .spyOn(service, "writeVMwareVCenterCreatedFeed")
      .mockRejectedValue(new Error("feed write blew up"));

    const created: VMwareVCenter = vcenter({});

    await expect(
      service.onCreateSuccess({ createBy: { props: {} } }, created),
    ).resolves.toBe(created);
    await flushPromises();

    // The chain stops at the first failure; the owner engine never runs.
    expect(order).not.toContain("owner");
  });
});
