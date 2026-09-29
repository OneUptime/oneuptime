import PasswordHash, { ScryptParams } from "../../../Server/Utils/PasswordHash";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import ColumnLength from "../../../Types/Database/ColumnLength";
import HashedString from "../../../Types/HashedString";
import BadDataException from "../../../Types/Exception/BadDataException";
import crypto from "crypto";
import { describe, expect, test } from "@jest/globals";

/*
 * Password hashing with scrypt.
 *
 * A per-user salt stops one attacker's work being reused across accounts, but
 * it does nothing to slow down a single guess — SHA-256 is a few nanoseconds,
 * so a leaked User table used to be a dictionary attack that finished over
 * lunch. scrypt makes each guess cost real time AND real memory, which is the
 * half that GPUs and custom silicon cannot buy their way out of.
 *
 * These tests pin four things:
 *
 *   1. the construction is exactly scrypt over an HMAC-peppered password,
 *      recomputed here from primitives rather than read back off the
 *      implementation;
 *   2. the stored string carries its own cost parameters, which is what makes
 *      raising the cost later a one-line change instead of a migration;
 *   3. every earlier scheme still verifies, or the deploy locks everyone out;
 *   4. needsUpgrade() reports precisely the hashes that are not what we write
 *      today — that predicate IS the migration.
 */

const SALT: string =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

type ScryptFunction = (data: {
  plainValue: string;
  salt: string;
  params?: ScryptParams;
}) => string;

/*
 * The construction, spelled out from Node primitives. Deliberately NOT built
 * on anything in PasswordHash: if the implementation drifts, this has to
 * disagree with it.
 */
const scryptFromPrimitives: ScryptFunction = (data: {
  plainValue: string;
  salt: string;
  params?: ScryptParams;
}): string => {
  const params: ScryptParams = data.params || { N: 16384, r: 8, p: 1 };

  const peppered: Buffer = crypto
    .createHmac("sha256", EncryptionSecret.toString())
    .update(data.plainValue, "utf8")
    .digest();

  return crypto
    .scryptSync(peppered, data.salt, 32, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: 128 * params.N * params.r * 2,
    })
    .toString("hex");
};

describe("PasswordHash — the stored format", () => {
  test("is algorithm, parameters, then digest", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "password",
      salt: SALT,
    });

    expect(stored).toMatch(/^scrypt\$N=\d+,r=\d+,p=\d+\$[0-9a-f]{64}$/);
  });

  test("records the parameters actually in use", async () => {
    const params: ScryptParams = PasswordHash.getCurrentParams();
    const stored: string = await PasswordHash.hash({
      plainValue: "password",
      salt: SALT,
    });

    expect(stored.split("$")[1]).toBe(
      `N=${params.N},r=${params.r},p=${params.p}`,
    );
  });

  test("fits the column that stores it, with room to raise the cost", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "password",
      salt: SALT,
    });

    expect(stored.length).toBeLessThanOrEqual(ColumnLength.HashedString);
    // Headroom for a much larger N and a longer parameter list later.
    expect(ColumnLength.HashedString - stored.length).toBeGreaterThan(100);
  });

  test("the cost is high enough to be worth having", () => {
    const params: ScryptParams = PasswordHash.getCurrentParams();

    /*
     * scrypt's memory cost is 128 * N * r bytes. Anything below a few MiB is
     * not meaningfully harder than a fast hash on attack hardware.
     */
    expect(128 * params.N * params.r).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    // N must be a power of two or scrypt rejects it outright.
    expect(params.N & (params.N - 1)).toBe(0);
  });
});

describe("PasswordHash — the construction", () => {
  test("is scrypt over the peppered password, digit for digit", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "correct-horse-battery-staple",
      salt: SALT,
    });

    expect(stored.split("$")[2]).toBe(
      scryptFromPrimitives({
        plainValue: "correct-horse-battery-staple",
        salt: SALT,
      }),
    );
  });

  test("the pepper participates — this is not plain scrypt(password, salt)", async () => {
    /*
     * Without the HMAC step, a stolen database would be crackable on its own.
     * The pepper lives in configuration, so the attacker needs that too.
     */
    const stored: string = await PasswordHash.hash({
      plainValue: "password",
      salt: SALT,
    });

    const withoutPepper: string = crypto
      .scryptSync("password", SALT, 32, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 128 * 16384 * 8 * 2,
      })
      .toString("hex");

    expect(stored.split("$")[2]).not.toBe(withoutPepper);
  });

  test("is not a SHA-256 digest of anything", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "password",
      salt: SALT,
    });

    const digest: string = stored.split("$")[2] as string;

    expect(digest).not.toBe(
      HashedString.computeHash("password", EncryptionSecret, SALT),
    );
    expect(digest).not.toBe(
      HashedString.computeHash("password", EncryptionSecret, null),
    );
  });
});

describe("PasswordHash.generateSalt", () => {
  test("returns 64 hex characters", () => {
    expect(PasswordHash.generateSalt()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("fits the ShortText column that stores it", () => {
    expect(PasswordHash.generateSalt().length).toBeLessThanOrEqual(
      ColumnLength.ShortText,
    );
  });

  test("never repeats across a large sample", () => {
    const salts: Set<string> = new Set<string>();

    for (let i: number = 0; i < 5000; i++) {
      salts.add(PasswordHash.generateSalt());
    }

    expect(salts.size).toBe(5000);
  });
});

describe("PasswordHash.hash", () => {
  test("the same password under two salts gives two different hashes", async () => {
    const first: string = await PasswordHash.hash({
      plainValue: "shared",
      salt: PasswordHash.generateSalt(),
    });
    const second: string = await PasswordHash.hash({
      plainValue: "shared",
      salt: PasswordHash.generateSalt(),
    });

    expect(first).not.toBe(second);
  });

  test("the same password under the same salt is stable", async () => {
    expect(await PasswordHash.hash({ plainValue: "p", salt: SALT })).toBe(
      await PasswordHash.hash({ plainValue: "p", salt: SALT }),
    );
  });

  test("different passwords under the same salt differ", async () => {
    expect(await PasswordHash.hash({ plainValue: "a", salt: SALT })).not.toBe(
      await PasswordHash.hash({ plainValue: "b", salt: SALT }),
    );
  });

  test("an empty password hashes to an empty string, not to a usable hash", async () => {
    expect(await PasswordHash.hash({ plainValue: "", salt: SALT })).toBe("");
  });

  test("refuses to hash without a salt", async () => {
    await expect(
      PasswordHash.hash({ plainValue: "password", salt: "" }),
    ).rejects.toThrow(BadDataException);
  });

  test("handles a very long password", async () => {
    /*
     * The HMAC step normalises the input to 32 bytes before scrypt sees it,
     * so there is no length limit to trip over (unlike bcrypt's 72 bytes).
     */
    const long: string = "x".repeat(10000);

    const stored: string = await PasswordHash.hash({
      plainValue: long,
      salt: SALT,
    });

    await expect(
      PasswordHash.verify({
        plainValue: long,
        storedValue: stored,
        salt: SALT,
      }),
    ).resolves.toBe(true);
  });

  test("handles unicode and does not confuse it with its bytes", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "pässwörd–🔐",
      salt: SALT,
    });

    await expect(
      PasswordHash.verify({
        plainValue: "pässwörd–🔐",
        storedValue: stored,
        salt: SALT,
      }),
    ).resolves.toBe(true);

    await expect(
      PasswordHash.verify({
        plainValue: "password-🔐",
        storedValue: stored,
        salt: SALT,
      }),
    ).resolves.toBe(false);
  });
});

describe("PasswordHash.verify — scrypt hashes", () => {
  test("accepts the right password", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "right",
      salt: SALT,
    });

    await expect(
      PasswordHash.verify({
        plainValue: "right",
        storedValue: stored,
        salt: SALT,
      }),
    ).resolves.toBe(true);
  });

  test("rejects the wrong password", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "right",
      salt: SALT,
    });

    await expect(
      PasswordHash.verify({
        plainValue: "wrong",
        storedValue: stored,
        salt: SALT,
      }),
    ).resolves.toBe(false);
  });

  test("rejects the right password under someone else's salt", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "shared",
      salt: PasswordHash.generateSalt(),
    });

    await expect(
      PasswordHash.verify({
        plainValue: "shared",
        storedValue: stored,
        salt: PasswordHash.generateSalt(),
      }),
    ).resolves.toBe(false);
  });

  test("throws rather than silently failing when the salt was not selected", async () => {
    /*
     * A missing salt is a bug in the caller's SELECT, not a bad password.
     * Returning false would turn it into "nobody can log in" with no clue why.
     */
    const stored: string = await PasswordHash.hash({
      plainValue: "right",
      salt: SALT,
    });

    await expect(
      PasswordHash.verify({
        plainValue: "right",
        storedValue: stored,
        salt: null,
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("verifies a hash written at older cost parameters", async () => {
    /*
     * The whole point of putting the parameters in the hash: raising the cost
     * must not invalidate what is already stored.
     */
    const cheapParams: ScryptParams = { N: 1024, r: 8, p: 1 };
    const stored: string = `scrypt$N=1024,r=8,p=1$${scryptFromPrimitives({
      plainValue: "old-cost",
      salt: SALT,
      params: cheapParams,
    })}`;

    await expect(
      PasswordHash.verify({
        plainValue: "old-cost",
        storedValue: stored,
        salt: SALT,
      }),
    ).resolves.toBe(true);

    await expect(
      PasswordHash.verify({
        plainValue: "wrong",
        storedValue: stored,
        salt: SALT,
      }),
    ).resolves.toBe(false);
  });

  test("does not accept a hash verified at the wrong parameters", async () => {
    // Same password, same salt, different N — must not collide.
    const atCheap: string = scryptFromPrimitives({
      plainValue: "password",
      salt: SALT,
      params: { N: 1024, r: 8, p: 1 },
    });

    const stored: string = await PasswordHash.hash({
      plainValue: "password",
      salt: SALT,
    });

    expect(stored.split("$")[2]).not.toBe(atCheap);
  });

  test("returns false for empty input rather than throwing", async () => {
    await expect(
      PasswordHash.verify({
        plainValue: "",
        storedValue: "anything",
        salt: SALT,
      }),
    ).resolves.toBe(false);

    await expect(
      PasswordHash.verify({
        plainValue: "anything",
        storedValue: "",
        salt: SALT,
      }),
    ).resolves.toBe(false);
  });
});

describe("PasswordHash.verify — the schemes that came before", () => {
  test("a bare SHA-256 hash from before salts existed still verifies", async () => {
    const legacy: string = await HashedString.hashValue(
      "old-password",
      EncryptionSecret,
    );

    await expect(
      PasswordHash.verify({
        plainValue: "old-password",
        storedValue: legacy,
        salt: null,
      }),
    ).resolves.toBe(true);

    await expect(
      PasswordHash.verify({
        plainValue: "guess",
        storedValue: legacy,
        salt: null,
      }),
    ).resolves.toBe(false);
  });

  test("a salted SHA-256 hash still verifies", async () => {
    const saltedSha: string = await HashedString.hashValue(
      "interim-password",
      EncryptionSecret,
      SALT,
    );

    await expect(
      PasswordHash.verify({
        plainValue: "interim-password",
        storedValue: saltedSha,
        salt: SALT,
      }),
    ).resolves.toBe(true);

    await expect(
      PasswordHash.verify({
        plainValue: "guess",
        storedValue: saltedSha,
        salt: SALT,
      }),
    ).resolves.toBe(false);
  });

  test("a salted SHA-256 hash checked without its salt fails, it does not throw", async () => {
    /*
     * Only scrypt hashes throw on a missing salt. A bare digest is
     * indistinguishable between the two SHA-256 schemes, so the salt's
     * absence is the scheme selector rather than an error.
     */
    const saltedSha: string = await HashedString.hashValue(
      "interim-password",
      EncryptionSecret,
      SALT,
    );

    await expect(
      PasswordHash.verify({
        plainValue: "interim-password",
        storedValue: saltedSha,
        salt: null,
      }),
    ).resolves.toBe(false);
  });

  test("a bare legacy hash with a stale salt still verifies during a rolling deployment", async () => {
    /*
     * An old pod knows nothing about the salt column. If it changes a
     * password after a new pod has already put a salt on the row, it writes
     * the original bare digest and leaves that salt behind. New code must try
     * the bare legacy scheme after the salted legacy scheme fails, then the
     * caller upgrades the row to scrypt.
     */
    const legacy: string = await HashedString.hashValue(
      "rolling-password",
      EncryptionSecret,
    );

    await expect(
      PasswordHash.verify({
        plainValue: "rolling-password",
        storedValue: legacy,
        salt: SALT,
      }),
    ).resolves.toBe(true);

    await expect(
      PasswordHash.verify({
        plainValue: "wrong-password",
        storedValue: legacy,
        salt: SALT,
      }),
    ).resolves.toBe(false);
  });
});

describe("PasswordHash.verify — malformed stored values", () => {
  type CaseList = ReadonlyArray<string>;

  const MALFORMED: CaseList = [
    "scrypt$",
    "scrypt$$",
    "scrypt$N=16384,r=8,p=1$",
    "scrypt$N=16384,r=8$deadbeef",
    "scrypt$garbage$deadbeef",
    "scrypt$N=16384,r=8,p=1$deadbeef$extra",
    "bcrypt$N=16384,r=8,p=1$deadbeef",
    "$scrypt$N=16384,r=8,p=1$deadbeef",
    "scrypt$N=0,r=8,p=1$deadbeef",
    "scrypt$N=16383,r=8,p=1$deadbeef", // not a power of two
    "scrypt$N=99999999999,r=8,p=1$deadbeef", // absurd memory ask
    "scrypt$N=16384,r=0,p=1$deadbeef",
    "scrypt$N=16384,r=8,p=0$deadbeef",
    "scrypt$N=16384,r=999,p=1$deadbeef",
  ];

  test.each(MALFORMED)(
    "%s is rejected without throwing and without allocating",
    async (storedValue: string) => {
      /*
       * Anything unparseable falls through to the legacy SHA-256 comparison,
       * where it simply will not match. It must never throw, and an absurd N
       * must never reach scrypt.
       */
      await expect(
        PasswordHash.verify({
          plainValue: "password",
          storedValue: storedValue,
          salt: SALT,
        }),
      ).resolves.toBe(false);
    },
  );
});

describe("PasswordHash.needsUpgrade", () => {
  test("a hash written today does not need upgrading", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "password",
      salt: SALT,
    });

    expect(PasswordHash.needsUpgrade(stored)).toBe(false);
  });

  test("a bare SHA-256 hash needs upgrading", async () => {
    expect(
      PasswordHash.needsUpgrade(
        await HashedString.hashValue("password", EncryptionSecret),
      ),
    ).toBe(true);
  });

  test("a salted SHA-256 hash needs upgrading", async () => {
    expect(
      PasswordHash.needsUpgrade(
        await HashedString.hashValue("password", EncryptionSecret, SALT),
      ),
    ).toBe(true);
  });

  test("a scrypt hash at stale cost parameters needs upgrading", () => {
    /*
     * This is what turns a cost bump into a migration: change the parameters
     * and every existing hash starts reporting true here.
     */
    expect(
      PasswordHash.needsUpgrade(`scrypt$N=1024,r=8,p=1$${"a".repeat(64)}`),
    ).toBe(true);
  });

  test("an empty stored value does not, because there is nothing to upgrade", () => {
    expect(PasswordHash.needsUpgrade("")).toBe(false);
  });

  test("the current prefix is exactly what hash() writes", async () => {
    const stored: string = await PasswordHash.hash({
      plainValue: "password",
      salt: SALT,
    });

    expect(stored.startsWith(PasswordHash.getCurrentPrefix())).toBe(true);
  });
});
