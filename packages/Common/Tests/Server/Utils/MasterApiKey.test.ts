import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import MasterApiKey from "../../../Server/Utils/MasterApiKey";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";
import crypto from "crypto";

/*
 * THE SERVER'S MASTER API KEY, STORED HASHED (#7901): how a key is made,
 * hashed and matched (Server/Utils/MasterApiKey).
 *
 *   - a key is a random version 4 uuid made on the server;
 *   - it is stored as the SHA-256 of the key, lower-cased, with the
 *     server's ENCRYPTION_SECRET - as the server's other minted tokens are;
 *   - a key a request presents matches the hash stored, however the client
 *     writes the uuid's hex digits, and nothing else does: another key, a
 *     value that is no uuid, the hash itself;
 *   - a key stored before keys were hashed (a uuid) still matches, until
 *     the HashMasterApiKey data migration hashes it;
 *   - every comparison is the constant-time one (HashedString.isEqual).
 */

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const OTHER_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";
const UUID_V4: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA_256_HEX: RegExp = /^[0-9a-f]{64}$/;

// SHA-256 of the secret and the key, worked out apart from HashedString.
function expectedDigest(key: string): string {
  return crypto
    .createHash("sha256")
    .update(`${EncryptionSecret.toString()}${key}`, "utf8")
    .digest("hex");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("generate", () => {
  test("makes a version 4 uuid, written lower-case", () => {
    const key: string = MasterApiKey.generate();

    expect(key).toMatch(UUID_V4);
    expect(ObjectID.isValidUUID(key)).toBe(true);
    expect(MasterApiKey.normalize(key)).toBe(key);
  });

  test("makes a new key every time", () => {
    const keys: Set<string> = new Set<string>();

    for (let index: number = 0; index < 1000; index++) {
      keys.add(MasterApiKey.generate());
    }

    expect(keys.size).toBe(1000);
  });

  test("takes it from the server's own random source", () => {
    const randomUUID: jest.SpyInstance = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValue(OTHER_KEY as ReturnType<typeof crypto.randomUUID>);

    expect(MasterApiKey.generate()).toBe(OTHER_KEY);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});

describe("normalize", () => {
  test("trims and lower-cases a uuid", () => {
    expect(MasterApiKey.normalize(`  ${KEY.toUpperCase()}\t`)).toBe(KEY);
    expect(MasterApiKey.normalize(new ObjectID(KEY.toUpperCase()))).toBe(KEY);
  });

  test.each([
    ["nothing", ""],
    ["spaces", "   "],
    ["a word", "garbage"],
    ["a uuid in braces", `{${KEY}}`],
    ["a uuid without its hyphens", KEY.split("-").join("")],
    ["a uuid with a space in it", `${KEY.slice(0, 8)} ${KEY.slice(9)}`],
    ["two keys, as a header sent twice", `${KEY},${OTHER_KEY}`],
    ["a SHA-256 digest", expectedDigest(KEY)],
  ])("is null for %s: no key is one", (_label: string, value: string) => {
    expect(MasterApiKey.normalize(value)).toBeNull();
  });

  test("is null for no value at all", () => {
    expect(MasterApiKey.normalize(null)).toBeNull();
    expect(MasterApiKey.normalize(undefined)).toBeNull();
  });
});

describe("hash", () => {
  test("is the SHA-256 of ENCRYPTION_SECRET and the key, as HashedString hashes the server's tokens", () => {
    const digest: string = MasterApiKey.hash(KEY);

    expect(digest).toMatch(SHA_256_HEX);
    expect(digest).toBe(expectedDigest(KEY));
    expect(digest).toBe(HashedString.computeHash(KEY, EncryptionSecret));
  });

  test("hashes the key lower-cased and trimmed, so every way of writing it is one hash", () => {
    expect(MasterApiKey.hash(KEY.toUpperCase())).toBe(MasterApiKey.hash(KEY));
    expect(MasterApiKey.hash(` ${KEY} `)).toBe(MasterApiKey.hash(KEY));
    expect(MasterApiKey.hash(new ObjectID(KEY))).toBe(MasterApiKey.hash(KEY));
  });

  test("gives each key a hash of its own, and holds nothing of the key", () => {
    const digest: string = MasterApiKey.hash(KEY);

    expect(MasterApiKey.hash(OTHER_KEY)).not.toBe(digest);
    expect(digest).not.toContain(KEY.split("-")[0]!);
    expect(MasterApiKey.isStoredAsWritten(digest)).toBe(false);
  });

  test("refuses a value that is no uuid", () => {
    expect(() => {
      return MasterApiKey.hash("garbage");
    }).toThrow(BadDataException);
  });
});

describe("isStoredAsWritten", () => {
  test("a uuid is a key stored as it was written, in either case", () => {
    expect(MasterApiKey.isStoredAsWritten(KEY)).toBe(true);
    expect(MasterApiKey.isStoredAsWritten(KEY.toUpperCase())).toBe(true);
  });

  test("a hash never is one", () => {
    expect(MasterApiKey.isStoredAsWritten(MasterApiKey.hash(KEY))).toBe(false);
    expect(MasterApiKey.isStoredAsWritten("")).toBe(false);
  });
});

describe("matches", () => {
  const STORED: string = MasterApiKey.hash(KEY);

  test("the key whose hash is stored matches", () => {
    expect(
      MasterApiKey.matches({ presentedKey: KEY, storedValue: STORED }),
    ).toBe(true);
  });

  test("so does the same key written upper-case or padded, as Postgres matched it in its uuid column", () => {
    for (const presentedKey of [
      KEY.toUpperCase(),
      `  ${KEY}  `,
      new ObjectID(KEY.toUpperCase()),
    ]) {
      expect(
        MasterApiKey.matches({
          presentedKey: presentedKey,
          storedValue: STORED,
        }),
      ).toBe(true);
    }
  });

  test("another key does not", () => {
    expect(
      MasterApiKey.matches({ presentedKey: OTHER_KEY, storedValue: STORED }),
    ).toBe(false);
  });

  test("the hash itself is no key: someone who read the database cannot present it", () => {
    expect(
      MasterApiKey.matches({ presentedKey: STORED, storedValue: STORED }),
    ).toBe(false);
  });

  test.each([
    ["no key", ""],
    ["a word", "garbage"],
    ["a uuid without its hyphens", KEY.split("-").join("")],
  ])("%s presented does not match", (_label: string, presentedKey: string) => {
    expect(
      MasterApiKey.matches({ presentedKey: presentedKey, storedValue: STORED }),
    ).toBe(false);
  });

  test("nothing matches while no key is stored", () => {
    for (const storedValue of [null, undefined, "", "   "]) {
      expect(
        MasterApiKey.matches({ presentedKey: KEY, storedValue: storedValue }),
      ).toBe(false);
    }
  });

  test("a value stored that is neither a key nor a hash matches nothing", () => {
    expect(
      MasterApiKey.matches({ presentedKey: KEY, storedValue: "garbage" }),
    ).toBe(false);
    expect(
      MasterApiKey.matches({
        presentedKey: KEY,
        storedValue: STORED.slice(0, 63),
      }),
    ).toBe(false);
  });

  describe("a key stored before keys were hashed, which the data migration has not hashed yet", () => {
    test("still matches, however either is written", () => {
      expect(
        MasterApiKey.matches({ presentedKey: KEY, storedValue: KEY }),
      ).toBe(true);
      expect(
        MasterApiKey.matches({
          presentedKey: KEY,
          storedValue: KEY.toUpperCase(),
        }),
      ).toBe(true);
      expect(
        MasterApiKey.matches({
          presentedKey: ` ${KEY.toUpperCase()} `,
          storedValue: KEY,
        }),
      ).toBe(true);
    });

    test("and another key still does not", () => {
      expect(
        MasterApiKey.matches({ presentedKey: OTHER_KEY, storedValue: KEY }),
      ).toBe(false);
    });

    test("its hash presented is no key either", () => {
      expect(
        MasterApiKey.matches({
          presentedKey: MasterApiKey.hash(KEY),
          storedValue: KEY,
        }),
      ).toBe(false);
    });
  });

  test("compares the hash presented with the hash stored in constant time", () => {
    const isEqual: jest.SpyInstance = jest.spyOn(HashedString, "isEqual");

    MasterApiKey.matches({ presentedKey: OTHER_KEY, storedValue: STORED });

    expect(isEqual).toHaveBeenCalledTimes(1);
    expect(isEqual).toHaveBeenCalledWith(MasterApiKey.hash(OTHER_KEY), STORED);
  });

  test("and a key stored as written with the key presented, the same way", () => {
    const isEqual: jest.SpyInstance = jest.spyOn(HashedString, "isEqual");

    MasterApiKey.matches({
      presentedKey: OTHER_KEY.toUpperCase(),
      storedValue: KEY.toUpperCase(),
    });

    expect(isEqual).toHaveBeenCalledTimes(1);
    expect(isEqual).toHaveBeenCalledWith(OTHER_KEY, KEY);
  });

  test("never compares a value that is no key: nothing to compare it with", () => {
    const isEqual: jest.SpyInstance = jest.spyOn(HashedString, "isEqual");

    MasterApiKey.matches({ presentedKey: "garbage", storedValue: STORED });

    expect(isEqual).not.toHaveBeenCalled();
  });
});
