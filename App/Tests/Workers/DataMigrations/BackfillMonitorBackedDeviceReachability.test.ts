import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import BackfillMonitorBackedDeviceReachability from "../../../FeatureSet/Workers/DataMigrations/BackfillMonitorBackedDeviceReachability";
import fs from "fs";
import path from "path";

/*
 * The upgrade half of keeping `isReachable` honest on monitor-backed
 * network devices.
 *
 * The device list's summary tiles and Status facet count and filter in SQL
 * over `isReachable` alone, so a monitor-backed device — which nothing
 * polls, and whose health is its bound monitor's stamped status — read as
 * "Pending" there forever, whatever its pill said. The service fix stamps
 * `isReachable` from the monitor on every binding and status change from
 * now on, and clears the poll residue a device carries over from SNMP at
 * the moment it switches. Neither reaches a device that was bound, or
 * switched, before the fix shipped; this walks those once.
 *
 * What is pinned here is the shape of that walk: which rows it asks for
 * (every monitor-backed device, bound or not — an unbound one must land on
 * NULL too), that it reads them in PAGES rather than truncating a large
 * fleet at one LIMIT_MAX read, which rows it touches and which it
 * deliberately does not, that residue is only written when there is some,
 * and that one bad device cannot take the rest of the fleet — or the
 * migrations queued behind it — down with it.
 */
jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      refreshStampedMonitorStatus: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "BackfillMonitorBackedDeviceReachability";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const deviceService: {
  findBy: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
  refreshStampedMonitorStatus: jest.Mock;
} = NetworkDeviceService as unknown as {
  findBy: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
  refreshStampedMonitorStatus: jest.Mock;
};

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

function makeDevice(data: {
  deviceId: ObjectID;
  monitoringMethod?: string | undefined;
  lastSeenAt?: Date | undefined;
  lastPolledAt?: Date | undefined;
  isReachable?: boolean | undefined;
  interfacesUp?: number | undefined;
  interfacesDown?: number | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(data.deviceId);
  if (data.monitoringMethod !== undefined) {
    device.monitoringMethod = data.monitoringMethod;
  }
  if (data.lastSeenAt !== undefined) {
    device.lastSeenAt = data.lastSeenAt;
  }
  if (data.lastPolledAt !== undefined) {
    device.lastPolledAt = data.lastPolledAt;
  }
  if (data.isReachable !== undefined) {
    device.isReachable = data.isReachable;
  }
  if (data.interfacesUp !== undefined) {
    device.interfacesUp = data.interfacesUp;
  }
  if (data.interfacesDown !== undefined) {
    device.interfacesDown = data.interfacesDown;
  }
  return device;
}

// A clean monitor-backed device: created that way, never polled.
function cleanMonitorBackedDevice(deviceId: ObjectID): NetworkDevice {
  return makeDevice({
    deviceId,
    monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
  });
}

function refreshedDeviceIds(): Array<string> {
  return deviceService.refreshStampedMonitorStatus.mock.calls.map(
    (callArgs: Array<unknown>) => {
      return ((callArgs[0] as JSONObject)["deviceId"] as ObjectID).toString();
    },
  );
}

function residueWrites(): Array<{ id: string; data: JSONObject }> {
  return deviceService.updateColumnsByIdWithoutHooks.mock.calls.map(
    (callArgs: Array<unknown>) => {
      const input: JSONObject = callArgs[0] as JSONObject;
      return {
        id: (input["id"] as ObjectID).toString(),
        data: input["data"] as JSONObject,
      };
    },
  );
}

/*
 * A findBy that serves `rows` in pages, the way Postgres would: honours
 * skip and limit, so a migration that forgets to page sees only the first
 * LIMIT_MAX of them.
 */
function serveInPages(rows: Array<NetworkDevice>): void {
  deviceService.findBy.mockImplementation((...callArgs: Array<unknown>) => {
    const input: JSONObject = callArgs[0] as JSONObject;
    const skip: number = input["skip"] as number;
    const limit: number = input["limit"] as number;
    return Promise.resolve(rows.slice(skip, skip + limit));
  });
}

describe("BackfillMonitorBackedDeviceReachability", () => {
  const migration: BackfillMonitorBackedDeviceReachability =
    new BackfillMonitorBackedDeviceReachability();

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.findBy.mockResolvedValue([] as never);
    deviceService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );
    deviceService.refreshStampedMonitorStatus.mockResolvedValue(
      undefined as never,
    );
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    /*
     * The runner records each migration by name once it has run, and
     * decides what to run from its position in this list. Inserting a
     * migration ahead of one that has already shipped renumbers everything
     * after it, so an installation part-way through the list re-runs
     * migrations it has already applied, or skips ones it has not.
     *
     * So what is pinned is this migration's INDEX — the end of the list as
     * of this change — not that it sits last forever. Appending the next
     * migration, which is what everyone should do, leaves this index alone;
     * inserting one above it does not, and fails here.
     */
    const REGISTERED_POSITION: number = 106;

    test("was appended at the end of the list, and keeps that position", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(REGISTERED_POSITION);
      expect(instantiations.length).toBeGreaterThan(REGISTERED_POSITION);
    });

    test("is registered exactly once", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(
        instantiations.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }).length,
      ).toBe(1);
    });

    /*
     * It re-derives the stamp too, so it has to run after the migration
     * that first stamped these devices — and after everything that shipped
     * before it, which BackfillNetworkSiteTypeParents was the last of.
     */
    test("runs after the migrations it follows", () => {
      const position: number = indexSource.indexOf(`new ${MIGRATION_NAME}()`);

      expect(position).toBeGreaterThan(
        indexSource.indexOf("new BackfillMonitorBackedDeviceStatus()"),
      );
      expect(position).toBeGreaterThan(
        indexSource.indexOf("new BackfillNetworkSiteTypeParents()"),
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("the query", () => {
    /*
     * The whole fleet, filtered in memory. Every monitor-backed device,
     * bound or not: an unbound device must land on isReachable NULL (its
     * true Pending) and lose its residue just the same, so — unlike
     * BackfillMonitorBackedDeviceStatus — there is no monitorId constraint.
     * And no monitoringMethod constraint either: the column is free text, a
     * SQL equality on the enum value would skip a row stored as "monitor"
     * that every runtime reader treats as monitor-backed, and the parse in
     * the loop is the contract.
     */
    test("pages the whole fleet and filters the method in memory", async () => {
      await migration.migrate();

      expect(deviceService.findBy).toHaveBeenCalledTimes(1);
      const findArgs: JSONObject = deviceService.findBy.mock
        .calls[0]![0] as JSONObject;
      const query: JSONObject = findArgs["query"] as JSONObject;

      expect("monitoringMethod" in query).toBe(false);
      expect("monitorId" in query).toBe(false);
      expect((findArgs["props"] as JSONObject)["isRoot"]).toBe(true);
    });

    test("a page mixing SNMP and monitor-backed rows refreshes only the monitor-backed ones", async () => {
      const snmp: ObjectID = ObjectID.generate();
      const spelledLowerCase: ObjectID = ObjectID.generate();
      const canonical: ObjectID = ObjectID.generate();

      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: snmp,
          monitoringMethod: NetworkDeviceMonitoringMethod.Snmp,
        }),
        makeDevice({ deviceId: spelledLowerCase, monitoringMethod: "monitor" }),
        makeDevice({
          deviceId: canonical,
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        }),
      ] as never);

      await migration.migrate();

      expect(refreshedDeviceIds()).toEqual([
        spelledLowerCase.toString(),
        canonical.toString(),
      ]);
    });

    test("pages on a stable id order", async () => {
      await migration.migrate();

      const findArgs: JSONObject = deviceService.findBy.mock
        .calls[0]![0] as JSONObject;

      expect(findArgs["sort"]).toEqual({ _id: SortOrder.Ascending });
      expect(findArgs["limit"]).toBe(LIMIT_MAX);
      expect(findArgs["skip"]).toBe(0);
    });

    /*
     * monitoringMethod decides whether a row is walked, and the four poll
     * columns decide whether it needs a residue write. A select that
     * dropped one of the latter would read it as "nothing there" and skip
     * a write that was needed.
     */
    test("selects every column it decides on", async () => {
      await migration.migrate();

      const select: JSONObject = deviceService.findBy.mock.calls[0]![0][
        "select"
      ] as JSONObject;

      for (const column of [
        "_id",
        "monitoringMethod",
        "lastSeenAt",
        "lastPolledAt",
        "isReachable",
        "interfacesUp",
        "interfacesDown",
      ]) {
        expect(select[column]).toBe(true);
      }
    });

    /*
     * The migration this one is modelled on read a single page at
     * LIMIT_MAX; on a fleet larger than that the tail was silently never
     * visited. Serve more rows than fit in one page and require every one
     * of them to be walked.
     */
    test("visits every row of a fleet larger than one page", async () => {
      const rows: Array<NetworkDevice> = [];
      for (let index: number = 0; index < LIMIT_MAX + 3; index++) {
        rows.push({
          id: ObjectID.generate(),
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        } as unknown as NetworkDevice);
      }
      serveInPages(rows);

      await migration.migrate();

      expect(deviceService.refreshStampedMonitorStatus).toHaveBeenCalledTimes(
        LIMIT_MAX + 3,
      );
      expect(deviceService.findBy).toHaveBeenCalledTimes(2);
      expect(
        (deviceService.findBy.mock.calls[1]![0] as JSONObject)["skip"],
      ).toBe(LIMIT_MAX);
    });

    test("stops after a page that comes back short", async () => {
      serveInPages([
        cleanMonitorBackedDevice(ObjectID.generate()),
        cleanMonitorBackedDevice(ObjectID.generate()),
      ]);

      await migration.migrate();

      expect(deviceService.findBy).toHaveBeenCalledTimes(1);
      expect(deviceService.refreshStampedMonitorStatus).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe("the walk", () => {
    test("re-derives the stamp and isReachable for every monitor-backed device", async () => {
      const first: ObjectID = ObjectID.generate();
      const second: ObjectID = ObjectID.generate();

      deviceService.findBy.mockResolvedValue([
        cleanMonitorBackedDevice(first),
        cleanMonitorBackedDevice(second),
      ] as never);

      await migration.migrate();

      expect(refreshedDeviceIds()).toEqual([
        first.toString(),
        second.toString(),
      ]);
    });

    /*
     * Never asked to clear: every row here is monitor-backed, and the flag
     * is for the write that moves a device off it.
     */
    test("never asks the re-stamp to clear", async () => {
      deviceService.findBy.mockResolvedValue([
        cleanMonitorBackedDevice(ObjectID.generate()),
      ] as never);

      await migration.migrate();

      expect(
        deviceService.refreshStampedMonitorStatus.mock.calls[0]![0][
          "clearWhenNotMonitorBacked"
        ],
      ).toBe(false);
    });

    /*
     * Most monitor-backed devices were created that way and have nothing
     * to clear. A residue write on those would be a no-op UPDATE per
     * device across the whole fleet.
     */
    test("writes no residue reset for a device that carries none", async () => {
      deviceService.findBy.mockResolvedValue([
        cleanMonitorBackedDevice(ObjectID.generate()),
      ] as never);

      await migration.migrate();

      expect(
        deviceService.updateColumnsByIdWithoutHooks,
      ).not.toHaveBeenCalled();
      expect(deviceService.refreshStampedMonitorStatus).toHaveBeenCalledTimes(
        1,
      );
    });

    /*
     * A device switched over from SNMP before the transition started
     * clearing: the four poll columns go, and `isReachable` is left to the
     * re-stamp, which derives it from the monitor.
     */
    test("clears the four poll columns of a device switched over from SNMP", async () => {
      const switched: ObjectID = ObjectID.generate();

      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: switched,
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          lastSeenAt: new Date("2026-08-01T00:00:00.000Z"),
          lastPolledAt: new Date("2026-08-01T00:00:00.000Z"),
          isReachable: true,
          interfacesUp: 22,
          interfacesDown: 2,
        }),
      ] as never);

      await migration.migrate();

      const writes: Array<{ id: string; data: JSONObject }> = residueWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0]!.id).toBe(switched.toString());
      expect(writes[0]!.data).toEqual({
        lastSeenAt: null,
        lastPolledAt: null,
        interfacesUp: null,
        interfacesDown: null,
      });
      expect("isReachable" in writes[0]!.data).toBe(false);
    });

    /*
     * Any one of the four is enough, and zero counts: an interfacesDown of
     * 0 is a finding the probe made, not an absence.
     */
    test.each([
      ["lastSeenAt", { lastSeenAt: new Date("2026-08-01T00:00:00.000Z") }],
      ["lastPolledAt", { lastPolledAt: new Date("2026-08-01T00:00:00.000Z") }],
      ["interfacesUp", { interfacesUp: 4 }],
      ["interfacesDown of zero", { interfacesDown: 0 }],
    ])(
      "treats a lone %s as residue",
      async (_label: string, residue: Record<string, unknown>) => {
        deviceService.findBy.mockResolvedValue([
          makeDevice({
            deviceId: ObjectID.generate(),
            monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
            ...residue,
          }),
        ] as never);

        await migration.migrate();

        expect(
          deviceService.updateColumnsByIdWithoutHooks,
        ).toHaveBeenCalledTimes(1);
      },
    );

    /*
     * A stale isReachable on its own is not residue for THIS write — the
     * re-stamp owns that column and will NULL or set it from the monitor.
     */
    test("leaves a lone isReachable to the re-stamp", async () => {
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: ObjectID.generate(),
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          isReachable: true,
        }),
      ] as never);

      await migration.migrate();

      expect(
        deviceService.updateColumnsByIdWithoutHooks,
      ).not.toHaveBeenCalled();
      expect(deviceService.refreshStampedMonitorStatus).toHaveBeenCalledTimes(
        1,
      );
    });

    /*
     * Residue first, re-stamp second: the re-stamp reads the row and
     * writes isReachable from the monitor, so it has to see the row after
     * the reset rather than race it.
     */
    test("resets residue before re-stamping the same device", async () => {
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: ObjectID.generate(),
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          lastSeenAt: new Date("2026-08-01T00:00:00.000Z"),
        }),
      ] as never);

      await migration.migrate();

      expect(
        deviceService.updateColumnsByIdWithoutHooks.mock.invocationCallOrder[0],
      ).toBeLessThan(
        deviceService.refreshStampedMonitorStatus.mock.invocationCallOrder[0]!,
      );
    });

    /*
     * The query matches the enum value, but the column is free text and
     * the parse is the contract: NULL, "" and anything unrecognised read as
     * SNMP, and an SNMP device's poll columns are its walk's own — they
     * must never be cleared from here, nor its stamp re-derived from a
     * monitor binding.
     */
    test.each([
      ["SNMP", NetworkDeviceMonitoringMethod.Snmp],
      ["a NULL method, from before the column existed", undefined],
      ["an empty string", ""],
      ["a typo", "Monitorr"],
    ])(
      "leaves a device with %s untouched",
      async (_label: string, method: string | undefined) => {
        deviceService.findBy.mockResolvedValue([
          makeDevice({
            deviceId: ObjectID.generate(),
            monitoringMethod: method,
            lastSeenAt: new Date("2026-08-01T00:00:00.000Z"),
            isReachable: true,
            interfacesDown: 1,
          }),
        ] as never);

        await migration.migrate();

        expect(
          deviceService.updateColumnsByIdWithoutHooks,
        ).not.toHaveBeenCalled();
        expect(
          deviceService.refreshStampedMonitorStatus,
        ).not.toHaveBeenCalled();
      },
    );

    test.each(["Monitor", "monitor", "  MONITOR  "])(
      "walks a device whose method reads as %p",
      async (method: string) => {
        deviceService.findBy.mockResolvedValue([
          makeDevice({
            deviceId: ObjectID.generate(),
            monitoringMethod: method,
          }),
        ] as never);

        await migration.migrate();

        expect(deviceService.refreshStampedMonitorStatus).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    /*
     * Migrations run in sequence at boot, so an unhandled throw here does
     * not just lose one device's reachability — it halts every migration
     * queued after it.
     */
    test("keeps going when one device's reset fails, and says which", async () => {
      const broken: ObjectID = ObjectID.generate();
      const healthy: ObjectID = ObjectID.generate();

      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: broken,
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          lastSeenAt: new Date("2026-08-01T00:00:00.000Z"),
        }),
        cleanMonitorBackedDevice(healthy),
      ] as never);

      deviceService.updateColumnsByIdWithoutHooks.mockRejectedValue(
        new Error("reset exploded") as never,
      );

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(refreshedDeviceIds()).toEqual([healthy.toString()]);
      expect(mockedLogger.error).toHaveBeenCalled();
      expect(String(mockedLogger.error.mock.calls[0]![0])).toContain(
        broken.toString(),
      );
    });

    test("keeps going when one device's re-stamp fails", async () => {
      const broken: ObjectID = ObjectID.generate();
      const healthy: ObjectID = ObjectID.generate();

      deviceService.findBy.mockResolvedValue([
        cleanMonitorBackedDevice(broken),
        cleanMonitorBackedDevice(healthy),
      ] as never);

      deviceService.refreshStampedMonitorStatus.mockImplementation(
        (...callArgs: Array<unknown>) => {
          const deviceId: string = (
            (callArgs[0] as JSONObject)["deviceId"] as ObjectID
          ).toString();

          if (deviceId === broken.toString()) {
            return Promise.reject(new Error("monitor lookup exploded"));
          }

          return Promise.resolve();
        },
      );

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(refreshedDeviceIds()).toEqual([
        broken.toString(),
        healthy.toString(),
      ]);
      expect(String(mockedLogger.error.mock.calls[0]![0])).toContain(
        broken.toString(),
      );
    });

    test("does nothing at all on an installation with no monitor-backed devices", async () => {
      await migration.migrate();

      expect(
        deviceService.updateColumnsByIdWithoutHooks,
      ).not.toHaveBeenCalled();
      expect(deviceService.refreshStampedMonitorStatus).not.toHaveBeenCalled();
    });

    // Nothing to undo: both columns are derived state, re-derived on every save.
    test("rolls back to a no-op", async () => {
      await expect(migration.rollback()).resolves.toBeUndefined();
    });
  });
});
