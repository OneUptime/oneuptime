import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import MasterApiKey from "../../../Server/Utils/MasterApiKey";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ProjectMiddleware.isMasterApiKey AGAINST A STORED HASH (#7901).
 *
 * The server's master API key is stored as its hash. Whether a request's
 * key is it is decided by reading the server's settings row by its id and
 * comparing (MasterApiKey.matches), never by putting the key in a query:
 *
 *   - the right key is accepted, however its hex digits are written;
 *   - a wrong key, a malformed one and the hash itself are refused;
 *   - a key that is turned off, or a row with no key, accepts nothing;
 *   - a key stored before keys were hashed still works until the data
 *     migration hashes it;
 *   - the key presented is in nothing the lookup sends to the database.
 *
 * The row is answered by a stand-in for GlobalConfigService.findOneBy, as
 * Postgres answers the lookup it is handed: what it holds, whatever key
 * was presented - so the decision is the code's, not the stand-in's.
 */

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const OTHER_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";

type FindOneByFunction = (
  findOneBy: FindOneBy<GlobalConfig>,
) => Promise<GlobalConfig | null>;

let findOneBy: SpyInstance<FindOneByFunction>;

// The server's settings row, as the database holds it.
function storeRow(
  row: {
    masterApiKey?: string | null | undefined;
    isMasterApiKeyEnabled?: boolean | null | undefined;
  } | null,
): void {
  findOneBy.mockImplementation(async (): Promise<GlobalConfig | null> => {
    if (!row) {
      return null;
    }

    const config: GlobalConfig = new GlobalConfig();
    config._id = ObjectID.getZeroObjectID().toString();

    if (row.masterApiKey) {
      // As the HashedString transformer reads a column back.
      config.masterApiKey = new HashedString(row.masterApiKey, true);
    }

    if (row.isMasterApiKeyEnabled !== undefined) {
      config.isMasterApiKeyEnabled = row.isMasterApiKeyEnabled as boolean;
    }

    return config;
  });
}

function isMasterApiKey(key: string): Promise<boolean> {
  return ProjectMiddleware.isMasterApiKey(new ObjectID(key));
}

beforeEach(() => {
  findOneBy = getJestSpyOn(
    GlobalConfigService,
    "findOneBy",
  ) as unknown as SpyInstance<FindOneByFunction>;
  storeRow(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a key stored as its hash", () => {
  beforeEach(() => {
    storeRow({
      masterApiKey: MasterApiKey.hash(KEY),
      isMasterApiKeyEnabled: true,
    });
  });

  test("the right key is accepted", async () => {
    expect(await isMasterApiKey(KEY)).toBe(true);
  });

  test("written upper-case, as a client may, it is still the key", async () => {
    expect(await isMasterApiKey(KEY.toUpperCase())).toBe(true);
  });

  test("a wrong key is refused", async () => {
    expect(await isMasterApiKey(OTHER_KEY)).toBe(false);
  });

  test("the hash itself is refused, and nothing is read for it", async () => {
    expect(await isMasterApiKey(MasterApiKey.hash(KEY))).toBe(false);
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test.each([
    ["a word", "garbage"],
    ["nothing", ""],
    ["a uuid in braces", `{${KEY}}`],
    ["two keys", `${KEY},${OTHER_KEY}`],
  ])(
    "a malformed key (%s) is refused, and nothing is read for it",
    async (_label: string, key: string) => {
      expect(await isMasterApiKey(key)).toBe(false);
      expect(findOneBy).not.toHaveBeenCalled();
    },
  );
});

describe("whether it is on", () => {
  test("a key turned off accepts nothing, the right key included", async () => {
    storeRow({
      masterApiKey: MasterApiKey.hash(KEY),
      isMasterApiKeyEnabled: false,
    });

    expect(await isMasterApiKey(KEY)).toBe(false);
  });

  test("a key never turned on accepts nothing", async () => {
    storeRow({ masterApiKey: MasterApiKey.hash(KEY) });

    expect(await isMasterApiKey(KEY)).toBe(false);
  });

  test("a row with no key accepts nothing, even turned on", async () => {
    storeRow({ isMasterApiKeyEnabled: true });

    expect(await isMasterApiKey(KEY)).toBe(false);
  });

  test("no settings row accepts nothing", async () => {
    storeRow(null);

    expect(await isMasterApiKey(KEY)).toBe(false);
  });
});

describe("a key stored before keys were hashed, before the data migration hashes it", () => {
  test("keeps working: every integration that uses it does, through the upgrade", async () => {
    storeRow({ masterApiKey: KEY, isMasterApiKeyEnabled: true });

    expect(await isMasterApiKey(KEY)).toBe(true);
    expect(await isMasterApiKey(KEY.toUpperCase())).toBe(true);
  });

  test("and still refuses any other key", async () => {
    storeRow({ masterApiKey: KEY, isMasterApiKeyEnabled: true });

    expect(await isMasterApiKey(OTHER_KEY)).toBe(false);
  });

  test("and nothing while it is off", async () => {
    storeRow({ masterApiKey: KEY, isMasterApiKeyEnabled: false });

    expect(await isMasterApiKey(KEY)).toBe(false);
  });
});

describe("what the lookup sends to the database", () => {
  beforeEach(() => {
    storeRow({
      masterApiKey: MasterApiKey.hash(KEY),
      isMasterApiKeyEnabled: true,
    });
  });

  test("reads the server's settings row by its id, as OneUptime itself, with the key's columns", async () => {
    await isMasterApiKey(KEY);

    expect(findOneBy).toHaveBeenCalledTimes(1);

    const call: FindOneBy<GlobalConfig> = findOneBy.mock.calls[0]![0];

    expect(call.query).toEqual({ _id: ObjectID.getZeroObjectID().toString() });
    expect(call.select).toEqual({
      _id: true,
      isMasterApiKeyEnabled: true,
      masterApiKey: true,
    });
    expect(call.props).toEqual({ isRoot: true });
  });

  test("holds neither the key presented nor its hash, so no query log can", async () => {
    await isMasterApiKey(OTHER_KEY);

    const sent: string = JSON.stringify(findOneBy.mock.calls[0]![0]);

    expect(sent).not.toContain(OTHER_KEY);
    expect(sent).not.toContain(MasterApiKey.hash(OTHER_KEY));
  });

  test("a lookup that fails is an error, not a pass", async () => {
    findOneBy.mockRejectedValue(new Error("connection terminated"));

    await expect(isMasterApiKey(KEY)).rejects.toThrow("connection terminated");
  });
});
