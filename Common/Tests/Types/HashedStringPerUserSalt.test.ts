import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import CryptoJS from "crypto-js";
import { describe, expect, test } from "@jest/globals";

/*
 * The two SHA-256 schemes that passwords used to be stored under.
 *
 * Passwords are hashed with scrypt now (see PasswordHash) — this class no
 * longer hashes any of them. What it still has to do, forever, is VERIFY the
 * hashes that came before, because every one of those rows is a user who
 * would otherwise be locked out at their next login:
 *
 *   no salt   `SHA256(secret + password)`, from before per-user salts.
 *   salted    `SHA256("v2:" + salt + ":" + secret + ":" + password)`.
 *
 * The salted branch is also what still hashes the high-entropy server-minted
 * values that legitimately want a fast, searchable hash: session refresh
 * tokens, reset tokens, permission fingerprints.
 *
 * These tests pin the three properties both schemes have to keep:
 *   1. same input + different salt  -> different digest,
 *   2. same input + same salt       -> same digest (verification must work),
 *   3. the unsalted branch is byte-for-byte what it always was.
 */

const SECRET: ObjectID = new ObjectID("secret");

/*
 * Salts are minted by PasswordHash (server-side) now that passwords go
 * through scrypt. This class only still knows how to VERIFY the two SHA-256
 * schemes that came before, so these tests supply their own salts rather than
 * reaching across into a Server util.
 */
type SaltFunction = () => string;

let saltCounter: number = 0;

const makeSalt: SaltFunction = (): string => {
  saltCounter++;
  return saltCounter.toString(16).padStart(64, "0");
};

describe("HashedString salted hashing", () => {
  test("the same password under two different salts produces two different hashes", async () => {
    const password: string = "correct-horse-battery-staple";

    const first: string = await HashedString.hashValue(
      password,
      SECRET,
      makeSalt(),
    );
    const second: string = await HashedString.hashValue(
      password,
      SECRET,
      makeSalt(),
    );

    expect(first).not.toBe(second);
  });

  test("two users sharing a password do not share a stored hash", async () => {
    const shared: string = "hunter2";

    const userA: { salt: string; hash: string } = {
      salt: makeSalt(),
      hash: "",
    };
    const userB: { salt: string; hash: string } = {
      salt: makeSalt(),
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
    const salt: string = makeSalt();

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
    const salt: string = makeSalt();

    expect(await HashedString.hashValue("password-a", SECRET, salt)).not.toBe(
      await HashedString.hashValue("password-b", SECRET, salt),
    );
  });

  test("the encryption secret still participates — same password and salt, different secret", async () => {
    const salt: string = makeSalt();

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
      makeSalt(),
    );

    // A bare hex SHA-256 digest, which is all these two schemes ever wrote.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the salted and unsalted schemes are domain separated", async () => {
    /*
     * Salted input is "v2:<salt>:<secret>:<value>", unsalted is
     * "<secret><value>". Without the prefix and separators, a crafted salt
     * could make a salted input collide with a legacy one, which would let a
     * legacy rainbow table reach salted rows.
     */
    const salt: string = makeSalt();

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
    expect(await HashedString.hashValue("", SECRET, makeSalt())).toBe("");
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
        salt: makeSalt(),
      }),
    ).resolves.toBe(false);
  });

  test("a salted hash does NOT verify against the legacy scheme", async () => {
    const salted: string = await HashedString.hashValue(
      "password",
      SECRET,
      makeSalt(),
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
    const salt: string = makeSalt();
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
    const salt: string = makeSalt();
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
    const salt: string = makeSalt();
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
        salt: makeSalt(),
      }),
    ).resolves.toBe(false);
  });

  test("rejects any plaintext against an empty stored hash", async () => {
    await expect(
      HashedString.verifyValue({
        plainValue: "anything",
        hashedValue: "",
        encryptionSecret: SECRET,
        salt: makeSalt(),
      }),
    ).resolves.toBe(false);
  });

  test("rejects when the salt is wrong even though the password is right", async () => {
    const hash: string = await HashedString.hashValue(
      "password",
      SECRET,
      makeSalt(),
    );

    await expect(
      HashedString.verifyValue({
        plainValue: "password",
        hashedValue: hash,
        encryptionSecret: SECRET,
        salt: makeSalt(),
      }),
    ).resolves.toBe(false);
  });

  test("rejects when the encryption secret is wrong", async () => {
    const salt: string = makeSalt();
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
    const salt: string = makeSalt();

    expect(hashedString.isValueHashed()).toBe(false);

    const digest: string = await hashedString.hashValue(SECRET, salt);

    expect(hashedString.isValueHashed()).toBe(true);
    expect(hashedString.toString()).toBe(digest);
    expect(hashedString.toString()).not.toBe("password");
  });

  test("refuses to hash twice, so a salt can never be applied over a digest", async () => {
    const hashedString: HashedString = new HashedString("password");
    await hashedString.hashValue(SECRET, makeSalt());

    await expect(hashedString.hashValue(SECRET, makeSalt())).rejects.toThrow(
      "Value is already hashed",
    );
  });

  test("a value read back from the database is already flagged hashed", async () => {
    const fromDb: HashedString = new HashedString("stored-digest", true);

    expect(fromDb.isValueHashed()).toBe(true);
    await expect(fromDb.hashValue(SECRET, null)).rejects.toThrow(
      "Value is already hashed",
    );
  });

  test("setHashedValue adopts a digest computed elsewhere", () => {
    /*
     * How a scrypt hash, computed server-side by PasswordHash, gets onto the
     * model this class represents.
     */
    const hashedString: HashedString = new HashedString("password");

    hashedString.setHashedValue("scrypt$N=16384,r=8,p=1$" + "a".repeat(64));

    expect(hashedString.isValueHashed()).toBe(true);
    expect(hashedString.toString()).toBe(
      "scrypt$N=16384,r=8,p=1$" + "a".repeat(64),
    );
  });

  test("setHashedValue refuses to write over an existing digest", async () => {
    const hashedString: HashedString = new HashedString("password");
    await hashedString.hashValue(SECRET, makeSalt());

    expect(() => {
      hashedString.setHashedValue("something-else");
    }).toThrow("Value is already hashed");
  });

  test("computeHash matches what the instance method produces", async () => {
    const salt: string = makeSalt();

    expect(HashedString.computeHash("password", SECRET, salt)).toBe(
      await HashedString.hashValue("password", SECRET, salt),
    );
  });
});
