import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod, {
  LEGACY_SNMP_MONITORING_METHOD,
} from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import NormalizeNetworkDeviceMonitoringMethod from "../../../FeatureSet/Workers/DataMigrations/NormalizeNetworkDeviceMonitoringMethod";
import fs from "fs";
import path from "path";

/*
 * The upgrade half of renaming the probe-polled monitoring method.
 *
 * Ping-first polling renamed it from "SNMP" to "Probe" — the assigned probe
 * pings every device and walks it over SNMP only when credentials exist —
 * and every runtime reader already parses NULL, "", "SNMP" and anything
 * unrecognised as Probe, so nothing misbehaves on the old rows. This makes
 * the column SAY what it means, once, for the raw SQL that filters on it and
 * for anyone reading the table.
 *
 * What is pinned here is the shape of that walk: the whole fleet in
 * id-ordered PAGES rather than one truncating read; exactly which spellings
 * are rewritten and to what (the parse is the contract, and a monitor-backed
 * row is normalised, never converted); that canonical rows are never
 * written, which is what makes a second run a no-op; and that one bad row
 * cannot take the rest of the fleet — or the migrations queued behind this
 * one — down with it.
 */
jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
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

const MIGRATION_NAME: string = "NormalizeNetworkDeviceMonitoringMethod";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const deviceService: {
  findBy: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
} = NetworkDeviceService as unknown as {
  findBy: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
};

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

function makeDevice(data: {
  deviceId: ObjectID;
  monitoringMethod?: string | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(data.deviceId);
  if (data.monitoringMethod !== undefined) {
    device.monitoringMethod = data.monitoringMethod;
  }
  return device;
}

function methodWrites(): Array<{ id: string; data: JSONObject }> {
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

describe("NormalizeNetworkDeviceMonitoringMethod", () => {
  const migration: NormalizeNetworkDeviceMonitoringMethod =
    new NormalizeNetworkDeviceMonitoringMethod();

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.findBy.mockResolvedValue([] as never);
    deviceService.updateColumnsByIdWithoutHooks.mockResolvedValue(
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
    const REGISTERED_POSITION: number = 107;

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
     * After everything that shipped before it, which the reachability
     * backfill was the last of — and after that one in particular, since
     * it walks the same rows by the same parse.
     */
    test("runs after the migrations it follows", () => {
      const position: number = indexSource.indexOf(`new ${MIGRATION_NAME}()`);

      expect(position).toBeGreaterThan(
        indexSource.indexOf("new BackfillMonitorBackedDeviceReachability()"),
      );
      expect(position).toBeGreaterThan(
        indexSource.indexOf("new BackfillMonitorBackedDeviceStatus()"),
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("the query", () => {
    /*
     * The whole fleet, filtered in memory: the column is free text, so no
     * SQL predicate can name every spelling that needs rewriting, and the
     * parse in the loop is the contract.
     */
    test("pages the whole fleet as root and decides the spelling in memory", async () => {
      await migration.migrate();

      expect(deviceService.findBy).toHaveBeenCalledTimes(1);
      const findArgs: JSONObject = deviceService.findBy.mock
        .calls[0]![0] as JSONObject;

      expect(findArgs["query"]).toEqual({});
      expect((findArgs["props"] as JSONObject)["isRoot"]).toBe(true);
    });

    test("pages on a stable id order", async () => {
      await migration.migrate();

      const findArgs: JSONObject = deviceService.findBy.mock
        .calls[0]![0] as JSONObject;

      expect(findArgs["sort"]).toEqual({ _id: SortOrder.Ascending });
      expect(findArgs["limit"]).toBe(LIMIT_MAX);
      expect(findArgs["skip"]).toBe(0);
    });

    // The id to write, and the one column the decision is made on.
    test("selects only the id and the method", async () => {
      await migration.migrate();

      const select: JSONObject = deviceService.findBy.mock.calls[0]![0][
        "select"
      ] as JSONObject;

      expect(select).toEqual({ _id: true, monitoringMethod: true });
    });

    /*
     * Serve more rows than fit in one page and require every one of them
     * to be walked: a single read at LIMIT_MAX would silently leave the
     * tail of a large fleet spelled the old way.
     */
    test("visits every row of a fleet larger than one page", async () => {
      const rows: Array<NetworkDevice> = [];
      for (let index: number = 0; index < LIMIT_MAX + 1; index++) {
        rows.push(
          makeDevice({
            deviceId: ObjectID.generate(),
            monitoringMethod: LEGACY_SNMP_MONITORING_METHOD,
          }),
        );
      }
      serveInPages(rows);

      await migration.migrate();

      expect(deviceService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(
        LIMIT_MAX + 1,
      );
      expect(deviceService.findBy).toHaveBeenCalledTimes(2);
      expect(
        (deviceService.findBy.mock.calls[1]![0] as JSONObject)["skip"],
      ).toBe(LIMIT_MAX);
    });

    test("stops after a page that comes back short", async () => {
      serveInPages([
        makeDevice({
          deviceId: ObjectID.generate(),
          monitoringMethod: LEGACY_SNMP_MONITORING_METHOD,
        }),
        makeDevice({ deviceId: ObjectID.generate(), monitoringMethod: "" }),
      ]);

      await migration.migrate();

      expect(deviceService.findBy).toHaveBeenCalledTimes(1);
      expect(deviceService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe("the normalisation", () => {
    /*
     * The parse is the contract. Everything that is not positively
     * "monitor" reads as Probe — NULL from before the column existed, the
     * legacy "SNMP" in every case, an unrecognised value — and is spelled
     * "Probe"; a "monitor" in any case or whitespace is spelled "Monitor".
     */
    test.each([
      ["a NULL method, from before the column existed", undefined, "Probe"],
      ["an empty string", "", "Probe"],
      ["whitespace", "   ", "Probe"],
      ["the legacy SNMP spelling", LEGACY_SNMP_MONITORING_METHOD, "Probe"],
      ["lower-case snmp", "snmp", "Probe"],
      ["mixed-case Snmp", "Snmp", "Probe"],
      ["lower-case probe", "probe", "Probe"],
      ["a padded Probe", " Probe ", "Probe"],
      ["an unrecognised value", "ping", "Probe"],
      ["a typo of Monitor", "Monitorr", "Probe"],
      ["lower-case monitor", "monitor", "Monitor"],
      ["upper-case MONITOR", "MONITOR", "Monitor"],
      ["a padded Monitor", "  Monitor  ", "Monitor"],
    ])(
      "rewrites %s as %p",
      async (_label: string, stored: string | undefined, expected: string) => {
        const deviceId: ObjectID = ObjectID.generate();

        deviceService.findBy.mockResolvedValue([
          makeDevice({ deviceId, monitoringMethod: stored }),
        ] as never);

        await migration.migrate();

        expect(methodWrites()).toEqual([
          { id: deviceId.toString(), data: { monitoringMethod: expected } },
        ]);
      },
    );

    // Idempotency in one line: the canonical spelling is never rewritten.
    test.each([
      NetworkDeviceMonitoringMethod.Probe,
      NetworkDeviceMonitoringMethod.Monitor,
    ])("leaves a row already spelled %p untouched", async (method: string) => {
      deviceService.findBy.mockResolvedValue([
        makeDevice({ deviceId: ObjectID.generate(), monitoringMethod: method }),
      ] as never);

      await migration.migrate();

      expect(
        deviceService.updateColumnsByIdWithoutHooks,
      ).not.toHaveBeenCalled();
    });

    /*
     * The one thing this migration must NOT do. A monitor-backed device
     * never had its probeId set, so switched blindly to Probe it would sit
     * "Pending" with nothing to poll it. Its spelling is normalised; its
     * method is not changed. The Devices page bulk action, which asks for a
     * probe, is the way to switch it.
     */
    test("never converts a monitor-backed device to Probe", async () => {
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: ObjectID.generate(),
          monitoringMethod: "monitor",
        }),
        makeDevice({
          deviceId: ObjectID.generate(),
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        }),
      ] as never);

      await migration.migrate();

      const writes: Array<{ id: string; data: JSONObject }> = methodWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0]!.data["monitoringMethod"]).toBe(
        NetworkDeviceMonitoringMethod.Monitor,
      );
    });

    test("writes only the method column", async () => {
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: ObjectID.generate(),
          monitoringMethod: LEGACY_SNMP_MONITORING_METHOD,
        }),
      ] as never);

      await migration.migrate();

      expect(Object.keys(methodWrites()[0]!.data)).toEqual([
        "monitoringMethod",
      ]);
    });

    test("a page mixing every spelling rewrites exactly the non-canonical rows", async () => {
      const legacy: ObjectID = ObjectID.generate();
      const nullMethod: ObjectID = ObjectID.generate();
      const canonicalProbe: ObjectID = ObjectID.generate();
      const spelledLowerCase: ObjectID = ObjectID.generate();
      const canonicalMonitor: ObjectID = ObjectID.generate();

      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: legacy,
          monitoringMethod: LEGACY_SNMP_MONITORING_METHOD,
        }),
        makeDevice({ deviceId: nullMethod }),
        makeDevice({
          deviceId: canonicalProbe,
          monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
        }),
        makeDevice({ deviceId: spelledLowerCase, monitoringMethod: "monitor" }),
        makeDevice({
          deviceId: canonicalMonitor,
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        }),
      ] as never);

      await migration.migrate();

      expect(methodWrites()).toEqual([
        { id: legacy.toString(), data: { monitoringMethod: "Probe" } },
        { id: nullMethod.toString(), data: { monitoringMethod: "Probe" } },
        {
          id: spelledLowerCase.toString(),
          data: { monitoringMethod: "Monitor" },
        },
      ]);
    });

    test("skips a row that carries no id", async () => {
      deviceService.findBy.mockResolvedValue([
        { monitoringMethod: LEGACY_SNMP_MONITORING_METHOD } as NetworkDevice,
      ] as never);

      await migration.migrate();

      expect(
        deviceService.updateColumnsByIdWithoutHooks,
      ).not.toHaveBeenCalled();
    });

    /*
     * Migrations run in sequence at boot, so an unhandled throw here does
     * not just lose one device's spelling — it halts every migration
     * queued after it. And the runtime reads the old spelling correctly
     * anyway, so one failure costs nothing but a log line.
     */
    test("keeps going when one device's write fails, and says which", async () => {
      const broken: ObjectID = ObjectID.generate();
      const healthy: ObjectID = ObjectID.generate();

      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: broken,
          monitoringMethod: LEGACY_SNMP_MONITORING_METHOD,
        }),
        makeDevice({
          deviceId: healthy,
          monitoringMethod: LEGACY_SNMP_MONITORING_METHOD,
        }),
      ] as never);

      deviceService.updateColumnsByIdWithoutHooks.mockRejectedValueOnce(
        new Error("write exploded") as never,
      );

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(
        methodWrites().map((write: { id: string; data: JSONObject }) => {
          return write.id;
        }),
      ).toEqual([broken.toString(), healthy.toString()]);
      expect(mockedLogger.error).toHaveBeenCalled();
      expect(String(mockedLogger.error.mock.calls[0]![0])).toContain(
        broken.toString(),
      );
    });

    test("does nothing at all on an installation with no devices", async () => {
      await migration.migrate();

      expect(
        deviceService.updateColumnsByIdWithoutHooks,
      ).not.toHaveBeenCalled();
    });

    /*
     * Nothing to undo: the old spellings read exactly the same as the new
     * one, and every reader would keep parsing them either way.
     */
    test("rolls back to a no-op", async () => {
      await expect(migration.rollback()).resolves.toBeUndefined();
    });
  });
});
