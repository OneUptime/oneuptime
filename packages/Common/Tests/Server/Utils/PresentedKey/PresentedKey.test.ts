import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import PresentedKey, {
  STORED_HASH_PATTERN,
  STORED_HASH_PREFIX,
} from "../../../../Server/Utils/PresentedKey/PresentedKey";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import crypto from "crypto";

/*
 * A KEY OR A TOKEN PRESENTED TO ONEUPTIME (#9012): how it is hashed for its
 * lookup, compared with the one stored, and - for a key nobody reads again,
 * a SCIM bearer token - kept as its hash.
 *
 *   - a key kept in what was a uuid column is the same key whatever the
 *     case of its hex digits, as Postgres compared it; any other key is the
 *     key exactly as written;
 *   - its lookup hash is the SHA-256 of the key with ENCRYPTION_SECRET, as
 *     an API key's is: the same for the same key, and no key;
 *   - a key is compared in constant time, and no key is never a match;
 *   - a key kept as its hash is told from a token stored as written - a
 *     token the Dashboard made was 64 hex digits, as a digest is - by its
 *     prefix, so a hash read from a backup is never taken for a token.
 */

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";

// SHA-256 of the secret and the key, worked out apart from HashedString.
function expectedDigest(key: string): string {
  return crypto
    .createHash("sha256")
    .update(`${EncryptionSecret.toString()}${key}`, "utf8")
    .digest("hex");
}

describe("PresentedKey.normalize", () => {
  test("a key in an ObjectID column: trimmed and in lower case", () => {
    expect(
      PresentedKey.normalize(
        ` ${KEY.toUpperCase()} `,
        TableColumnType.ObjectID,
      ),
    ).toBe(KEY);
    expect(
      PresentedKey.normalize(new ObjectID(KEY), TableColumnType.ObjectID),
    ).toBe(KEY);
  });

  test("any other key exactly as written: a probe's key is case-sensitive", () => {
    expect(
      PresentedKey.normalize(" Probe-Key ", TableColumnType.ShortText),
    ).toBe(" Probe-Key ");
    expect(PresentedKey.normalize("ABC", TableColumnType.LongText)).toBe("ABC");
  });

  test("no key is no key", () => {
    expect(PresentedKey.normalize(null, TableColumnType.ObjectID)).toBeNull();
    expect(
      PresentedKey.normalize(undefined, TableColumnType.ShortText),
    ).toBeNull();
    expect(PresentedKey.normalize("", TableColumnType.ShortText)).toBeNull();
    expect(PresentedKey.normalize("   ", TableColumnType.ObjectID)).toBeNull();
  });
});

describe("PresentedKey.hash, a key's lookup hash", () => {
  test("is the SHA-256 of the key with ENCRYPTION_SECRET", () => {
    expect(PresentedKey.hash(KEY, TableColumnType.ObjectID)).toBe(
      expectedDigest(KEY),
    );
    expect(PresentedKey.hash("probe-key", TableColumnType.ShortText)).toBe(
      expectedDigest("probe-key"),
    );
  });

  test("is the same for a uuid key however it is written", () => {
    expect(PresentedKey.hash(KEY.toUpperCase(), TableColumnType.ObjectID)).toBe(
      PresentedKey.hash(KEY, TableColumnType.ObjectID),
    );
    expect(PresentedKey.hash(new ObjectID(KEY), TableColumnType.ObjectID)).toBe(
      PresentedKey.hash(KEY, TableColumnType.ObjectID),
    );
  });

  test("is another hash for another case of a text key", () => {
    expect(PresentedKey.hash("Key", TableColumnType.ShortText)).not.toBe(
      PresentedKey.hash("key", TableColumnType.ShortText),
    );
  });

  test("is no key, and holds none of it", () => {
    const keyHash: string = PresentedKey.hash(KEY, TableColumnType.ObjectID)!;

    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash).not.toContain(KEY);
    expect(keyHash).not.toContain(KEY.replace(/-/g, ""));
  });

  test("of no key is null", () => {
    expect(PresentedKey.hash(null, TableColumnType.ObjectID)).toBeNull();
    expect(PresentedKey.hash("", TableColumnType.ShortText)).toBeNull();
  });
});

describe("PresentedKey.matches", () => {
  test("the key stored matches, as written or, in a uuid column, in any case", () => {
    expect(
      PresentedKey.matches({
        presented: KEY,
        stored: KEY,
        columnType: TableColumnType.ObjectID,
      }),
    ).toBe(true);
    expect(
      PresentedKey.matches({
        presented: KEY.toUpperCase(),
        stored: new ObjectID(KEY),
        columnType: TableColumnType.ObjectID,
      }),
    ).toBe(true);
    expect(
      PresentedKey.matches({
        presented: "probe-key",
        stored: "probe-key",
        columnType: TableColumnType.ShortText,
      }),
    ).toBe(true);
  });

  test("another key does not, nor one that only starts the same", () => {
    expect(
      PresentedKey.matches({
        presented: "probe-key-2",
        stored: "probe-key",
        columnType: TableColumnType.ShortText,
      }),
    ).toBe(false);
    expect(
      PresentedKey.matches({
        presented: "probe-key",
        stored: "probe-key-2",
        columnType: TableColumnType.ShortText,
      }),
    ).toBe(false);
    expect(
      PresentedKey.matches({
        presented: "PROBE-KEY",
        stored: "probe-key",
        columnType: TableColumnType.ShortText,
      }),
    ).toBe(false);
  });

  test("no key matches nothing, not even no key", () => {
    for (const [presented, stored] of [
      ["", ""],
      [null, null],
      [undefined, KEY],
      [KEY, null],
      ["", KEY],
    ] as Array<[string | null | undefined, string | null | undefined]>) {
      expect(
        PresentedKey.matches({
          presented: presented,
          stored: stored,
          columnType: TableColumnType.ObjectID,
        }),
      ).toBe(false);
    }
  });

  test("compares in constant time: both sides through digests of one length", () => {
    const timingSafeEqual: SpyInstance<typeof crypto.timingSafeEqual> =
      jest.spyOn(crypto, "timingSafeEqual");

    PresentedKey.matches({
      presented: "a",
      stored: "a much longer stored key",
      columnType: TableColumnType.ShortText,
    });

    expect(timingSafeEqual).toHaveBeenCalledTimes(1);

    const [left, right] = timingSafeEqual.mock.calls[0] as unknown as [
      Buffer,
      Buffer,
    ];

    expect(left.length).toBe(32);
    expect(right.length).toBe(32);

    timingSafeEqual.mockRestore();
  });
});

describe("a key kept only as its hash (a SCIM bearer token)", () => {
  const TOKEN: string = "a".repeat(64);

  test("is the prefix and the token's SHA-256 with ENCRYPTION_SECRET", () => {
    expect(PresentedKey.toStoredHash(TOKEN)).toBe(
      `${STORED_HASH_PREFIX}${expectedDigest(TOKEN)}`,
    );
    expect(PresentedKey.toStoredHash(TOKEN)).toMatch(STORED_HASH_PATTERN);
  });

  test("is told from a token, however much the token looks like a digest", () => {
    expect(PresentedKey.isStoredHash(PresentedKey.toStoredHash(TOKEN))).toBe(
      true,
    );
    expect(PresentedKey.isStoredHash(TOKEN)).toBe(false);
    expect(PresentedKey.isStoredHash(expectedDigest(TOKEN))).toBe(false);
    expect(PresentedKey.isStoredHash(KEY)).toBe(false);
    expect(PresentedKey.isStoredHash("")).toBe(false);
    expect(PresentedKey.isStoredHash(null)).toBe(false);
  });

  test("matches the token it hashes, and no other", () => {
    const stored: string = PresentedKey.toStoredHash(TOKEN);

    expect(
      PresentedKey.matchesStoredHash({ presented: TOKEN, stored: stored }),
    ).toBe(true);
    expect(
      PresentedKey.matchesStoredHash({
        presented: "b".repeat(64),
        stored: stored,
      }),
    ).toBe(false);
  });

  test("is not a token: presenting the hash itself matches nothing", () => {
    const stored: string = PresentedKey.toStoredHash(TOKEN);

    expect(
      PresentedKey.matchesStoredHash({ presented: stored, stored: stored }),
    ).toBe(false);
  });

  test("a token stored as written before, not hashed yet, still matches as written", () => {
    expect(
      PresentedKey.matchesStoredHash({ presented: TOKEN, stored: TOKEN }),
    ).toBe(true);
    expect(
      PresentedKey.matchesStoredHash({
        presented: "b".repeat(64),
        stored: TOKEN,
      }),
    ).toBe(false);
  });

  test("no token matches nothing", () => {
    expect(PresentedKey.matchesStoredHash({ presented: "", stored: "" })).toBe(
      false,
    );
    expect(
      PresentedKey.matchesStoredHash({
        presented: null,
        stored: PresentedKey.toStoredHash(TOKEN),
      }),
    ).toBe(false);
    expect(
      PresentedKey.matchesStoredHash({ presented: TOKEN, stored: null }),
    ).toBe(false);
  });
});

describe("PresentedKey.generate", () => {
  test("is 256 random bits, as 64 hex digits, never the same twice", () => {
    const first: string = PresentedKey.generate();
    const second: string = PresentedKey.generate();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});
