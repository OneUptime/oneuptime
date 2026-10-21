/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY.
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

import HostService, {
  HOST_COLLECTOR_STATE_COLUMNS,
} from "../../../Server/Services/HostService";
import HostCollectorAgentCache from "../../../Server/Utils/HostCollector/HostCollectorAgentCache";
import ResourceAiAccessSettings from "../../../Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import ResourceAiDeleteCleanup from "../../../Server/Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import Host from "../../../Models/DatabaseModels/Host";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Hosts and the collectors OneUptime manages on them:
 *
 *   - a host a managed collector registers is created before any of its
 *     telemetry arrives, so it is not marked connected or seen yet - its
 *     pages fill in when its metrics do;
 *   - a change to what decides the config a host runs (its labels, the
 *     config picked for it, Try again, its system) reaches the host with
 *     its next poll: the state its polls are answered from is dropped.
 */

const NOW: Date = new Date("2026-10-21T08:00:00.000Z");

describe("a host a managed collector registers", () => {
  let created: Array<Host>;

  beforeEach(() => {
    created = [];
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest.spyOn(HostService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(HostService, "create")
      .mockImplementation(async (data: { data: Host }): Promise<Host> => {
        const host: Host = data.data;
        host._id = ObjectID.generate().toString();
        created.push(host);
        return host;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is created before its telemetry: not connected, not seen", async () => {
    await HostService.findOrCreateByHostIdentifier({
      projectId: ObjectID.generate(),
      hostIdentifier: "Web-1",
      isRegisteredByCollectorManagement: true,
    });

    expect(created.length).toBe(1);
    expect(created[0]!.hostIdentifier).toBe("web-1");
    expect(created[0]!.name).toBe("web-1");
    expect(created[0]!.otelCollectorStatus).toBeUndefined();
    expect(created[0]!.lastSeenAt).toBeUndefined();
  });

  test("a host its telemetry creates is connected and seen, as before", async () => {
    await HostService.findOrCreateByHostIdentifier({
      projectId: ObjectID.generate(),
      hostIdentifier: "web-2",
    });

    expect(created[0]!.otelCollectorStatus).toBe("connected");
    expect(created[0]!.lastSeenAt).toEqual(NOW);
  });
});

describe("changes that decide a managed host's config", () => {
  let dropped: Array<string>;

  beforeEach(() => {
    dropped = [];
    jest
      .spyOn(HostCollectorAgentCache, "dropState")
      .mockImplementation(async (hostId: string): Promise<void> => {
        dropped.push(hostId);
      });
    jest
      .spyOn(ResourceAiAccessSettings, "afterUpdate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        HostService as unknown as {
          writeHostUpdatedFeed: () => Promise<void>;
        },
        "writeHostUpdatedFeed",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function update(
    data: Record<string, unknown>,
    ids: Array<ObjectID>,
  ): Promise<void> {
    await (
      HostService as unknown as {
        onUpdateSuccess: (
          onUpdate: OnUpdate<Host>,
          ids: Array<ObjectID>,
        ) => Promise<OnUpdate<Host>>;
      }
    ).onUpdateSuccess(
      {
        updateBy: { data: data, query: {}, props: { isRoot: true } },
        carryForward: undefined,
      } as unknown as OnUpdate<Host>,
      ids,
    );
  }

  test("are the labels, the picked config, Try again and the system", () => {
    expect([...HOST_COLLECTOR_STATE_COLUMNS].sort()).toEqual([
      "collectorConfigId",
      "collectorFailedConfigHash",
      "isCollectorConfigPinned",
      "labels",
      "osType",
    ]);
  });

  test.each([
    ["labels", { labels: [] }],
    [
      "a picked config",
      { collectorConfigId: ObjectID.generate(), isCollectorConfigPinned: true },
    ],
    ["Automatic", { collectorConfigId: null, isCollectorConfigPinned: false }],
    ["Try again", { collectorFailedConfigHash: null }],
    ["the system", { osType: "linux" }],
  ])(
    "%s: every host changed has its cached state dropped",
    async (_what: string, data: Record<string, unknown>) => {
      const first: ObjectID = ObjectID.generate();
      const second: ObjectID = ObjectID.generate();

      await update(data, [first, second]);

      expect(dropped).toEqual([first.toString(), second.toString()]);
    },
  );

  test.each([
    ["a new name", { name: "web-1" }],
    ["a description", { description: "Edge" }],
    ["last seen", { lastSeenAt: NOW }],
  ])(
    "%s leaves the cached state alone",
    async (_what: string, data: Record<string, unknown>) => {
      await update(data, [ObjectID.generate()]);

      expect(dropped).toEqual([]);
    },
  );

  test("deleting hosts drops their state: a collector that still runs files its host anew", async () => {
    jest
      .spyOn(ResourceAiDeleteCleanup, "afterDelete")
      .mockResolvedValue(undefined as never);
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();

    await (
      HostService as unknown as {
        onDeleteSuccess: (
          onDelete: OnDelete<Host>,
          ids: Array<ObjectID>,
        ) => Promise<OnDelete<Host>>;
      }
    ).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: { isRoot: true } },
        carryForward: undefined,
      } as unknown as OnDelete<Host>,
      [first, second],
    );

    expect(dropped).toEqual([first.toString(), second.toString()]);
  });
});
