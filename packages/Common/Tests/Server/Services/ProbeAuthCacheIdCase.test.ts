/*
 * A probe has one auth cache entry, whatever case its id is written in.
 *
 * Postgres reads a uuid in any case, so a probe authenticates with its id
 * upper-cased as well as lower-cased. Rotating a probe's key or deleting the
 * probe writes the revocation sentinel under the id as Postgres stores it,
 * lower-cased. Were the cache keyed on the id as a request happened to spell
 * it, an upper-cased id would keep an entry of its own that the sentinel
 * never reaches - and a key its owner had just rotated out would go on
 * authenticating there until that entry expired.
 *
 * The cache here is a real map behind GlobalCache's three calls, so what one
 * call writes is what the next one reads. MonitorService is mocked at the
 * module boundary, as in ProbeAuthKeyCacheAndHeartbeat.test.ts: the real one
 * pulls in the whole database stack. The Probe SELECT is spied on the
 * ProbeService singleton and answers as Postgres would - by the uuid,
 * whatever its case, and the key the probe has now.
 */

const cacheEntries: Map<string, string> = new Map<string, string>();

function cacheEntryName(namespace: string, key: string): string {
  return `${namespace}::${key}`;
}

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: async (
        namespace: string,
        key: string,
      ): Promise<string | null> => {
        return cacheEntries.get(cacheEntryName(namespace, key)) ?? null;
      },
      setString: async (
        namespace: string,
        key: string,
        value: string,
      ): Promise<void> => {
        cacheEntries.set(cacheEntryName(namespace, key), value);
      },
      deleteKey: async (namespace: string, key: string): Promise<void> => {
        cacheEntries.delete(cacheEntryName(namespace, key));
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
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

// Letters in every group, so the upper-cased id really is spelled otherwise.
const STORED_PROBE_ID: string = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const OLD_KEY: string = "key-before-rotation";
const NEW_KEY: string = "key-after-rotation";

const AUTH_CACHE_NAMESPACE: string = "probe-auth-key-hash";

const SPELLINGS: Array<string> = [
  STORED_PROBE_ID,
  STORED_PROBE_ID.toUpperCase(),
  "A1b2C3d4-E5f6-4A7b-8C9d-0E1f2A3b4C5d",
];

describe("ProbeService auth cache: one entry per probe, whatever the id's case", () => {
  // The probe's key as the database holds it right now.
  let currentKey: string = OLD_KEY;
  let findOneBySpy: jest.SpyInstance;

  beforeEach(() => {
    cacheEntries.clear();
    currentKey = OLD_KEY;

    // Postgres compares a uuid whatever its case, and the key exactly.
    findOneBySpy = jest
      .spyOn(ProbeService, "findOneBy")
      .mockImplementation(async (input: unknown): Promise<Probe | null> => {
        const query: { _id: string; key: string } = (
          input as { query: { _id: string; key: string } }
        ).query;

        if (
          query._id.toLowerCase() !== STORED_PROBE_ID ||
          query.key !== currentKey
        ) {
          return null;
        }

        const probe: Probe = new Probe();
        probe.id = new ObjectID(STORED_PROBE_ID);
        return probe;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function verify(probeId: string, probeKey: string): Promise<boolean> {
    return await ProbeService.verifyProbeKey({
      probeId: new ObjectID(probeId),
      probeKey: probeKey,
    });
  }

  function cachedKeys(): Array<string> {
    return Array.from(cacheEntries.keys()).sort();
  }

  test("an id in any case reads and writes the probe's one entry", async () => {
    expect(await verify(STORED_PROBE_ID.toUpperCase(), OLD_KEY)).toBe(true);

    expect(cachedKeys()).toEqual([
      cacheEntryName(AUTH_CACHE_NAMESPACE, STORED_PROBE_ID),
    ]);
    expect(findOneBySpy).toHaveBeenCalledTimes(1);

    // Every other spelling is served by that entry: no second Probe SELECT.
    for (const spelling of SPELLINGS) {
      expect(await verify(spelling, OLD_KEY)).toBe(true);
    }

    expect(findOneBySpy).toHaveBeenCalledTimes(1);
    expect(cachedKeys()).toHaveLength(1);
  });

  test("a rotated key stops working at once, in every spelling of the id", async () => {
    // Cached while the key was still good - by an upper-cased id.
    expect(await verify(STORED_PROBE_ID.toUpperCase(), OLD_KEY)).toBe(true);

    // The owner rotates the key: the sentinel goes under the stored id.
    currentKey = NEW_KEY;
    await ProbeService.invalidateProbeAuthCache([
      new ObjectID(STORED_PROBE_ID),
    ]);

    for (const spelling of SPELLINGS) {
      expect(await verify(spelling, OLD_KEY)).toBe(false);
    }

    // The new key works, in every spelling too.
    for (const spelling of SPELLINGS) {
      expect(await verify(spelling, NEW_KEY)).toBe(true);
    }
  });

  test("a deleted probe's key stops working at once, in every spelling of the id", async () => {
    for (const spelling of SPELLINGS) {
      expect(await verify(spelling, OLD_KEY)).toBe(true);
    }

    // Deleting the probe: the row is gone and the sentinel is written.
    currentKey = "";
    await ProbeService.invalidateProbeAuthCache([
      new ObjectID(STORED_PROBE_ID.toUpperCase()),
    ]);

    for (const spelling of SPELLINGS) {
      expect(await verify(spelling, OLD_KEY)).toBe(false);
    }

    expect(cachedKeys()).toEqual([
      cacheEntryName(AUTH_CACHE_NAMESPACE, STORED_PROBE_ID),
    ]);
  });
});
