/*
 * ProbeService.verifyProbeKey refuses a probe key the repository ships.
 *
 * Every authenticated probe request passes through verifyProbeKey, so this
 * one check keeps a probe whose key is public in the repository — unset,
 * "secret", or a config.example.env placeholder (GLOBAL_PROBE_n_KEY ships
 * "probe-1-please-change-this-to-random-value") — from authenticating on any
 * probe-ingest route, whether or not a row with that key exists. A real
 * probe's key is a long random value, so this never turns one away.
 *
 * GlobalCache and MonitorService are mocked at the module boundary (they pull
 * in Redis and the database stack); the DB read is spied on the ProbeService
 * singleton. The point is that a shipped key is refused BEFORE either the
 * cache or the database is read.
 */

const mockGetString: jest.Mock = jest.fn();
const mockSetString: jest.Mock = jest.fn();
const mockDeleteKey: jest.Mock = jest.fn();

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: (...args: Array<unknown>) => {
        return mockGetString(...args);
      },
      setString: (...args: Array<unknown>) => {
        return mockSetString(...args);
      },
      deleteKey: (...args: Array<unknown>) => {
        return mockDeleteKey(...args);
      },
    },
  };
});

jest.mock("../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      refreshProbeStatus: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(() => {
      return {};
    }),
  };
});

import ProbeService from "../../../Server/Services/ProbeService";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

describe("verifyProbeKey refuses a shipped probe key", () => {
  beforeEach(() => {
    // The cache would say "valid" for any key — the refusal must come first.
    mockGetString.mockResolvedValue(null);
    mockSetString.mockResolvedValue(undefined);
    mockDeleteKey.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test.each([
    ["the old fallback", "secret"],
    ["the bare placeholder", "please-change-this-to-random-value"],
    ["a probe placeholder", "probe-1-please-change-this-to-random-value"],
    ["a partially edited placeholder", "please-change-this-to-random-value-9"],
    ["a blank key", "   "],
  ])(
    "refuses %s without reading the cache or the database",
    async (_label: string, probeKey: string) => {
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(
          Object.assign(new Probe(), { id: PROBE_ID, _id: PROBE_ID }) as never,
        );

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: probeKey,
      });

      expect(result).toBe(false);
      expect(findOneBySpy).not.toHaveBeenCalled();
      expect(mockGetString).not.toHaveBeenCalled();
    },
  );

  test("even a cache hit cannot admit a shipped key", async () => {
    // Pretend the cache holds the hash of this exact key: still refused.
    mockGetString.mockResolvedValue(
      ProbeService.hashProbeKey("please-change-this-to-random-value"),
    );

    const result: boolean = await ProbeService.verifyProbeKey({
      probeId: PROBE_ID,
      probeKey: "please-change-this-to-random-value",
    });

    expect(result).toBe(false);
    expect(mockGetString).not.toHaveBeenCalled();
  });

  test("a real random key still reaches the database", async () => {
    const realKey: string = new ObjectID(
      "22222222-2222-4222-8222-222222222222",
    ).toString();

    const findOneBySpy: jest.SpyInstance = jest
      .spyOn(ProbeService, "findOneBy")
      .mockResolvedValue(
        Object.assign(new Probe(), { id: PROBE_ID, _id: PROBE_ID }) as never,
      );

    const result: boolean = await ProbeService.verifyProbeKey({
      probeId: PROBE_ID,
      probeKey: realKey,
    });

    expect(result).toBe(true);
    /*
     * A real key is checked against the cache (and the DB on a miss); a
     * shipped key never gets this far.
     */
    expect(mockGetString).toHaveBeenCalled();
    expect(findOneBySpy).toHaveBeenCalledTimes(1);
  });

  test("an empty key is still rejected as missing", async () => {
    await expect(
      ProbeService.verifyProbeKey({ probeId: PROBE_ID, probeKey: "" }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});
