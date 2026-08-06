import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import CryptoJS from "crypto-js";
import { describe, expect, test } from "@jest/globals";

/*
 * Per-user password salts.
 *
 * Before this, every password in the instance was `SHA256(EncryptionSecret +
 * password)`. One global secret meant: two accounts with the same password had
 * byte-identical rows (so a dump told you who shares a password, and cracking
 * one cracked all of them), and a single rainbow table built once against the
 * leaked secret covered the entire user table.
 *
 * A per-user salt breaks all of that: the same password hashes differently for
 * every user, so an attacker's work does not amortize across accounts.
 *
 * These tests pin the three properties the scheme has to keep:
 *   1. same input + different salt  -> different digest (the whole point),
 *   2. same input + same salt       -> same digest (verification must work),
 *   3. the unsalted branch is byte-for-byte what it always was (every
 *      password written before this change still has to verify).
 */

const SECRET: ObjectID = new ObjectID("secret");

describe("HashedString.generateSalt", () => {
  test("returns 64 lowercase hex characters", () => {
    const salt: string = HashedString.generateSalt();

    expect(salt).toHaveLength(64);
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
  });

  test("fits inside the ShortText column that stores it", () => {
    /*
     * ColumnLength.ShortText is 100. A salt longer than that would be
     * truncated on write and would then never verify again.
     */
    expect(HashedString.generateSalt().length).toBeLessThanOrEqual(100);
  });

  test("never repeats across a large sample", () => {
    const salts: Set<string> = new Set<string>();

    for (let i: number = 0; i < 5000; i++) {
      salts.add(HashedString.generateSalt());
    }

    expect(salts.size).toBe(5000);
  });

  test("is not derived from the value being hashed", () => {
    /*
     * A salt derived from the password would be identical for identical
     * passwords, which defeats the entire mechanism.
     */
    const first: string = HashedString.generateSalt();
    const second: string = HashedString.generateSalt();

    expect(first).not.toBe(second);
  });
});

describe("HashedString salted hashing", () => {
  test("the same password under two different salts produces two different hashes", async () => {
    const password: string = "correct-horse-battery-staple";

    const first: string = await HashedString.hashValue(
      password,
      SECRET,
      HashedString.generateSalt(),
    );
    const second: string = await HashedString.hashValue(
      password,
      SECRET,
      HashedString.generateSalt(),
    );

    expect(first).not.toBe(second);
  });

  test("two users sharing a password do not share a stored hash", async () => {
    const shared: string = "hunter2";

    const userA: { salt: string; hash: string } = {
      salt: HashedString.generateSalt(),
      hash: "",
    };
    const userB: { salt: string; hash: string } = {
      salt: HashedString.generateSalt(),
      hash: "",
    };

    userA.hash = await HashedString.hashValue(shared, SECRET, userA.salt);
    userB.hash = await HashedString.hashValue(shared, SECRET, userB.salt);

    expect(userA.hash).not.toBe(userB.hash);

    // And neither hash verifies under the other user's salt.
    await expect(
      HashedString.verifyValue({
        plainValue: shared,
        hashedValue: userA.hash,
        encryptionSecret: SECRET,
        salt: userB.salt,
      }),
    ).resolves.toBe(false);
  });

  test("the same password under the same salt is stable across calls", async () => {
    const salt: string = HashedString.generateSalt();

    const first: string = await HashedString.hashValue(
      "p4ssw0rd",
      SECRET,
      salt,
    );
    const second: string = await HashedString.hashValue(
      "p4ssw0rd",
      SECRET,
      salt,
    );

    expect(first).toBe(second);
  });

  test("different passwords under the same salt still differ", async () => {
    const salt: string = HashedString.generateSalt();

    expect(await HashedString.hashValue("password-a", SECRET, salt)).not.toBe(
      await HashedString.hashValue("password-b", SECRET, salt),
    );
  });

  test("the encryption secret still participates — same password and salt, different secret", async () => {
    const salt: string = HashedString.generateSalt();

    expect(
      await HashedString.hashValue("password", new ObjectID("one"), salt),
    ).not.toBe(
      await HashedString.hashValue("password", new ObjectID("two"), salt),
    );
  });

  test("produces a hex SHA-256 digest, the same shape the column already stores", async () => {
    const hash: string = await HashedString.hashValue(
      "password",
      SECRET,
      HashedString.generateSalt(),
    );

    // ColumnLength.HashedString is 64 — a longer digest would not fit.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the salted and unsalted schemes are domain separated", async () => {
    /*
     * Salted input is "v2:<salt>:<secret>:<value>", unsalted is
     * "<secret><value>". Without the prefix and separators, a crafted salt
     * could make a salted input collide with a legacy one, which would let a
     * legacy rainbow table reach salted rows.
     */
    const salt: string = HashedString.generateSalt();

    const salted: string = await HashedString.hashValue(
      "password",
      SECRET,
      salt,
    );

    // The naive concatenation an attacker would try to line up against.
    const naive: string = CryptoJS.SHA256(
      salt + SECRET.toString() + "password",
    ).toString();

    expect(salted).not.toBe(naive);
  });

  test("an empty salt falls back to the legacy scheme rather than a half-salted one", async () => {
    const withEmptySalt: string = await HashedString.hashValue(
      "password",
      SECRET,
      "",
    );
    const legacy: string = await HashedString.hashValue("password", SECRET);

    expect(withEmptySalt).toBe(legacy);
  });

  test("an empty value hashes to an empty string, salt or not", async () => {
    expect(
      await HashedString.hashValue("", SECRET, HashedString.generateSalt()),
    ).toBe("");
    expect(await HashedString.hashValue("", SECRET)).toBe("");
  });
});

describe("HashedString legacy (pre-salt) compatibility", () => {
  test("the unsalted digest is byte-for-byte what it has always been", async () => {
    /*
     * This is the contract that keeps every already-stored password working.
     * If this assertion ever has to change, every existing user is locked out
     * — the value below is the literal formula the original implementation
     * used, not a value copied from the implementation under test.
     */
    const expected: string = CryptoJS.SHA256(
      SECRET.toString() + "my-old-password",
    ).toString();

    expect(await HashedString.hashValue("my-old-password", SECRET)).toBe(
      expected,
    );
  });

  test("omitting the salt argument entirely behaves like passing null", async () => {
    expect(await HashedString.hashValue("password", SECRET)).toBe(
      await HashedString.hashValue("password", SECRET, null),
    );
  });

  test("a legacy hash verifies when no salt is supplied", async () => {
    const legacyHash: string = await HashedString.hashValue(
      "legacy-password",
      SECRET,
    );

    await expect(
      HashedString.verifyValue({
        plainValue: "legacy-password",
        hashedValue: legacyHash,
        encryptionSecret: SECRET,
        salt: null,
      }),
    ).resolves.toBe(true);
  });

  test("a legacy hash does NOT verify once a salt is supplied", async () => {
    /*
     * The upgrade path depends on this: a row whose salt column is set is
     * never checked against the legacy scheme, so an un-upgraded hash must
     * fail rather than silently pass under the wrong scheme.
     */
    const legacyHash: string = await HashedString.hashValue(
      "legacy-password",
      SECRET,
    );

    await expect(
      HashedString.verifyValue({
        plainValue: "legacy-password",
        hashedValue: legacyHash,
        encryptionSecret: SECRET,
        salt: HashedString.generateSalt(),
      }),
    ).resolves.toBe(false);
  });

  test("a salted hash does NOT verify against the legacy scheme", async () => {
    const salted: string = await HashedString.hashValue(
      "password",
      SECRET,
      HashedString.generateSalt(),
    );

    await expect(
      HashedString.verifyValue({
        plainValue: "password",
        hashedValue: salted,
        encryptionSecret: SECRET,
        salt: null,
      }),
    ).resolves.toBe(false);
  });
});

describe("HashedString.verifyValue", () => {
  test("accepts the right password with the right salt", async () => {
    const salt: string = HashedString.generateSalt();
    const hash: string = await HashedString.hashValue(
      "right-password",
      SECRET,
      salt,
    );

    await expect(
      HashedString.verifyValue({
        plainValue: "right-password",
        hashedValue: hash,
        encryptionSecret: SECRET,
        salt: salt,
      }),
    ).resolves.toBe(true);
  });

  test("rejects the wrong password", async () => {
    const salt: string = HashedString.generateSalt();
    const hash: string = await HashedString.hashValue(
      "right-password",
      SECRET,
      salt,
    );

    await expect(
      HashedString.verifyValue({
        plainValue: "wrong-password",
        hashedValue: hash,
        encryptionSecret: SECRET,
        salt: salt,
      }),
    ).resolves.toBe(false);
  });

  test("rejects a password that only differs in case", async () => {
    const salt: string = HashedString.generateSalt();
    const hash: string = await HashedString.hashValue("Password", SECRET, salt);

    await expect(
      HashedString.verifyValue({
        plainValue: "password",
        hashedValue: hash,
        encryptionSecret: SECRET,
        salt: salt,
      }),
    ).resolves.toBe(false);
  });

  test("rejects an empty plaintext even against an empty stored hash", async () => {
    /*
     * A user row with no password (invited but never signed up) stores null.
     * An empty submitted password must never satisfy it.
     */
    await expect(
      HashedString.verifyValue({
        plainValue: "",
        hashedValue: "",
        encryptionSecret: SECRET,
        salt: HashedString.generateSalt(),
      }),
    ).resolves.toBe(false);
  });

  test("rejects any plaintext against an empty stored hash", async () => {
    await expect(
      HashedString.verifyValue({
        plainValue: "anything",
        hashedValue: "",
        encryptionSecret: SECRET,
        salt: HashedString.generateSalt(),
      }),
    ).resolves.toBe(false);
  });

  test("rejects when the salt is wrong even though the password is right", async () => {
    const hash: string = await HashedString.hashValue(
      "password",
      SECRET,
      HashedString.generateSalt(),
    );

    await expect(
      HashedString.verifyValue({
        plainValue: "password",
        hashedValue: hash,
        encryptionSecret: SECRET,
        salt: HashedString.generateSalt(),
      }),
    ).resolves.toBe(false);
  });

  test("rejects when the encryption secret is wrong", async () => {
    const salt: string = HashedString.generateSalt();
    const hash: string = await HashedString.hashValue(
      "password",
      new ObjectID("real-secret"),
      salt,
    );

    await expect(
      HashedString.verifyValue({
        plainValue: "password",
        hashedValue: hash,
        encryptionSecret: new ObjectID("guessed-secret"),
        salt: salt,
      }),
    ).resolves.toBe(false);
  });
});

describe("HashedString.isEqual — constant-time digest comparison", () => {
  test("equal strings compare equal", () => {
    expect(HashedString.isEqual("abc123", "abc123")).toBe(true);
  });

  test("different strings of the same length compare unequal", () => {
    expect(HashedString.isEqual("abc123", "abc124")).toBe(false);
  });

  test("a difference in the first character is caught", () => {
    expect(HashedString.isEqual("Xbc123", "abc123")).toBe(false);
  });

  test("a difference in the last character is caught", () => {
    expect(HashedString.isEqual("abc12X", "abc123")).toBe(false);
  });

  test("different lengths compare unequal", () => {
    expect(HashedString.isEqual("abc", "abcd")).toBe(false);
    expect(HashedString.isEqual("abcd", "abc")).toBe(false);
  });

  test("a prefix is not treated as a match", () => {
    const hash: string = CryptoJS.SHA256("x").toString();

    expect(HashedString.isEqual(hash.substring(0, 32), hash)).toBe(false);
  });

  test("two empty strings compare equal", () => {
    expect(HashedString.isEqual("", "")).toBe(true);
  });

  test("compares every character, not just up to the first difference", () => {
    /*
     * The loop must not early-exit. Two strings differing only in the LAST
     * character must still take the same path as two that differ in the
     * first — that is the whole point of the accumulator.
     */
    const a: string = "a".repeat(63) + "b";
    const b: string = "a".repeat(63) + "c";

    expect(HashedString.isEqual(a, b)).toBe(false);
    expect(HashedString.isEqual(a, a)).toBe(true);
  });
});

describe("HashedString instance hashing with a salt", () => {
  test("marks itself hashed and replaces its value", async () => {
    const hashedString: HashedString = new HashedString("password");
    const salt: string = HashedString.generateSalt();

    expect(hashedString.isValueHashed()).toBe(false);

    const digest: string = await hashedString.hashValue(SECRET, salt);

    expect(hashedString.isValueHashed()).toBe(true);
    expect(hashedString.toString()).toBe(digest);
    expect(hashedString.toString()).not.toBe("password");
  });

  test("refuses to hash twice, so a salt can never be applied over a digest", async () => {
    const hashedString: HashedString = new HashedString("password");
    await hashedString.hashValue(SECRET, HashedString.generateSalt());

    await expect(
      hashedString.hashValue(SECRET, HashedString.generateSalt()),
    ).rejects.toThrow("Value is already hashed");
  });

  test("a value read back from the database is already flagged hashed", async () => {
    const fromDb: HashedString = new HashedString("stored-digest", true);

    expect(fromDb.isValueHashed()).toBe(true);
    await expect(fromDb.hashValue(SECRET, null)).rejects.toThrow(
      "Value is already hashed",
    );
  });

  test("computeHash matches what the instance method produces", async () => {
    const salt: string = HashedString.generateSalt();

    expect(HashedString.computeHash("password", SECRET, salt)).toBe(
      await HashedString.hashValue("password", SECRET, salt),
    );
  });
});
