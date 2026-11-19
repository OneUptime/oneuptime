/*
 * PasswordHash carries a TS diagnostic that fails any suite whose require
 * graph reaches it (see HostServiceUpdateLastSeen.test.ts): replaced with a
 * factory, as there.
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

import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import HostService from "../../../Server/Services/HostService";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #9804: the Hosts list read an Android kiosk's OS as "linux". An
 * Android device sends os.type=linux (the kernel's name, as OpenTelemetry
 * Android and the OneUptime Android agent send it) and os.name=Android, and
 * the Host kept os.type alone. It now keeps `android` as the OS type of a
 * host whose os.name says Android, and only of one.
 */

const HOST_ID: ObjectID = ObjectID.generate();

type ColumnWrite = Parameters<
  typeof HostService.updateColumnsByIdIfUnlockedWithoutHooks
>[0];

let writes: Array<Record<string, unknown>> = [];
let cache: Map<string, string> = new Map<string, string>();

function mockCache(): void {
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        const full: string = `${namespace}:${key}`;
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
  jest
    .spyOn(GlobalCache, "setStringIfChanged")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        const full: string = `${namespace}:${key}`;
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      cache.delete(`${namespace}:${key}`);
    });
}

function mockWrites(): void {
  jest
    .spyOn(HostService, "updateColumnsByIdIfUnlockedWithoutHooks")
    .mockImplementation(async (input: ColumnWrite) => {
      writes.push({ ...(input.data as Record<string, unknown>) });
      return true;
    });
}

describe("an Android device's OS on its Host (issue #9804)", () => {
  beforeEach(() => {
    writes = [];
    cache = new Map<string, string>();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    mockCache();
    mockWrites();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("os.name Android makes the host's OS type android", async () => {
    await HostService.updateLastSeen(HOST_ID, {
      osType: "linux",
      osName: "Android",
      osVersion: "Android Version 14 (Build UP1A.231005.007 API level 34)",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!["osType"]).toBe("android");
    expect(writes[0]!["osVersion"]).toBe(
      "Android Version 14 (Build UP1A.231005.007 API level 34)",
    );
  });

  test("any other os.name keeps os.type as it came", async () => {
    await HostService.updateLastSeen(HOST_ID, {
      osType: "linux",
      osName: "Ubuntu",
    });

    expect(writes[0]!["osType"]).toBe("linux");
  });

  test("without os.name, os.type is kept as it came", async () => {
    await HostService.updateLastSeen(HOST_ID, { osType: "windows" });

    expect(writes[0]!["osType"]).toBe("windows");
  });

  test("os.name alone is enough for an Android device", async () => {
    await HostService.updateLastSeen(HOST_ID, { osName: " android " });

    expect(writes[0]!["osType"]).toBe("android");
  });

  test("a host recorded as linux before #9804 becomes android with its next write", async () => {
    await HostService.updateLastSeen(HOST_ID, { osType: "linux" });

    // A metadata change lands in the next enrichment window (ResourceHeartbeat): open it.
    cache.delete(`host-last-seen-write-window:${HOST_ID.toString()}`);
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    await HostService.updateLastSeen(HOST_ID, {
      osType: "linux",
      osName: "Android",
    });

    // os.name is in the fingerprint: the same os.type with Android beside it is a change.
    expect(writes).toHaveLength(2);
    expect(writes[1]!["osType"]).toBe("android");
  });
});
