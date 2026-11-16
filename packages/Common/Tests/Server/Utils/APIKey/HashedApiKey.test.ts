import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import HashedApiKey, {
  API_KEY_HASH_PATTERN,
  API_KEY_HINT_PATTERN,
} from "../../../../Server/Utils/APIKey/HashedApiKey";
import MasterApiKey from "../../../../Server/Utils/MasterApiKey";
import BadDataException from "../../../../Types/Exception/BadDataException";
import HashedString from "../../../../Types/HashedString";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";

/*
 * ONE SET OF RULES FOR EVERY API KEY (#8902): the server's master API key
 * and a project's API keys are made, hashed and matched alike
 * (Server/Utils/APIKey/HashedApiKey). MasterApiKey.test.ts holds the rules
 * themselves - a random v4 uuid, the SHA-256 of the lower-cased key with
 * ENCRYPTION_SECRET, a constant-time match that takes a key stored before
 * keys were hashed. This holds the master key's name for them to the same
 * rules, and pins what is new:
 *
 *   - a key's hint is its last four characters, lower-case, the same
 *     however the key is written, and never enough to use it;
 *   - a hash is told from anything else, a key above all.
 */

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";

// SHA-256 of the secret and the key, worked out apart from HashedString.
function expectedDigest(key: string): string {
  return crypto
    .createHash("sha256")
    .update(`${EncryptionSecret.toString()}${key}`, "utf8")
    .digest("hex");
}

describe("the master API key and a project's keys", () => {
  test("are hashed alike: the master key's rules are these", () => {
    expect(HashedApiKey.hash(KEY)).toBe(MasterApiKey.hash(KEY));
    expect(HashedApiKey.hash(KEY)).toBe(expectedDigest(KEY));
    expect(HashedApiKey.normalize(` ${KEY.toUpperCase()} `)).toBe(
      MasterApiKey.normalize(KEY),
    );
    expect(
      HashedApiKey.matches({
        presentedKey: KEY,
        storedValue: MasterApiKey.hash(KEY),
      }),
    ).toBe(true);
    expect(HashedApiKey.hash(KEY)).toBe(
      HashedString.computeHash(KEY, EncryptionSecret),
    );
  });

  test("a key is made from the server's own random source, as a version 4 uuid", () => {
    const key: string = HashedApiKey.generate();

    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(HashedApiKey.generate()).not.toBe(key);
  });
});

describe("getHint", () => {
  test("is the key's last four characters: what the pages show in place of the key", () => {
    expect(HashedApiKey.getHint(KEY)).toBe("2b34");
    expect(HashedApiKey.getHint(KEY)).toMatch(API_KEY_HINT_PATTERN);
  });

  test("is the same however the key is written", () => {
    expect(HashedApiKey.getHint(KEY.toUpperCase())).toBe("2b34");
    expect(HashedApiKey.getHint(`  ${KEY}\t`)).toBe("2b34");
    expect(HashedApiKey.getHint(new ObjectID(KEY))).toBe("2b34");
  });

  test("is no part of the hash, and too little of the key to use it", () => {
    const hint: string = HashedApiKey.getHint(KEY);

    // Four hex digits: 16 of the key's 122 random bits.
    expect(hint).toHaveLength(4);
    expect(HashedApiKey.matches({ presentedKey: hint, storedValue: KEY })).toBe(
      false,
    );
    expect(HashedApiKey.normalize(hint)).toBeNull();
  });

  test("of a key the server makes is that key's", () => {
    for (let i: number = 0; i < 20; i++) {
      const key: string = HashedApiKey.generate();

      expect(HashedApiKey.getHint(key)).toBe(key.slice(-4));
      expect(HashedApiKey.getHint(key)).toMatch(API_KEY_HINT_PATTERN);
    }
  });

  test.each([
    ["nothing", ""],
    ["a word", "garbage"],
    ["a digest", expectedDigest(KEY)],
  ])("refuses %s: no key has a hint", (_label: string, value: string) => {
    expect(() => {
      return HashedApiKey.getHint(value);
    }).toThrow(BadDataException);
  });
});

describe("isHash", () => {
  test("a key's digest is one", () => {
    expect(HashedApiKey.isHash(HashedApiKey.hash(KEY))).toBe(true);
    expect(API_KEY_HASH_PATTERN.test(HashedApiKey.hash(KEY))).toBe(true);
  });

  test.each([
    ["a key", KEY],
    [
      "a digest upper-cased, which HashedString never writes",
      expectedDigest(KEY).toUpperCase(),
    ],
    ["a digest cut short", expectedDigest(KEY).slice(0, 63)],
    ["nothing", ""],
    ["no value at all", null],
  ])("%s is not", (_label: string, value: string | null) => {
    expect(HashedApiKey.isHash(value)).toBe(false);
  });
});
