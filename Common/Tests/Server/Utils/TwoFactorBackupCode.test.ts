import TwoFactorBackupCode, {
  BackupCodeAlphabet,
  BackupCodeLength,
  BackupCodeSetSize,
} from "../../../Server/Utils/TwoFactorBackupCode";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import ObjectID from "../../../Types/ObjectID";
import crypto from "crypto";
import { describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The code generation and hashing behind two factor backup codes.
 *
 * WHAT THIS FILE IS GUARDING
 *
 * A backup code is the last door into an account whose second factor is gone,
 * so it fails in two directions and both are unacceptable:
 *
 *  - too weak, and a caller who has the password guesses their way past two
 *    factor auth. The whole security argument for this feature rests on the
 *    code space being enormous, so the alphabet, the length and the uniformity
 *    of the draw are pinned here rather than left to a comment;
 *  - too strict, and a user who typed exactly the right code off a piece of
 *    paper is told it is wrong. Those users are, by definition, already locked
 *    out and already panicking, and every transcription rule the alphabet was
 *    designed around (I/1, L/1, O/0, the display hyphen, a lowercase phone
 *    keyboard) is a way to produce that failure if normalization drifts.
 *
 * NOTHING IS MOCKED. The point of these tests is the real crypto: real
 * randomness from crypto.randomInt, real HMAC keyed by the real
 * EnvironmentConfig secret. The expected digests are recomputed here from
 * Node's crypto directly rather than by calling the function under test, so a
 * change to the construction has to be a deliberate, visible one.
 *
 * The single-use SEMANTICS are not here -- they live in Postgres, and are
 * covered by Common/Tests/Server/Services/UserTwoFactorBackupCodeService.test.ts.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

/*
 * The digest, recomputed from the RFC primitives rather than from the module
 * under test. If the construction in TwoFactorBackupCode.hashCode is changed,
 * this stops matching -- which is the point: the digest of every stored code
 * depends on it, so a silent change is a silent invalidation of every backup
 * code every user is holding.
 */
type ExpectedHashFunction = (data: {
  code: string;
  userId: ObjectID;
}) => string;

const expectedHash: ExpectedHashFunction = (data: {
  code: string;
  userId: ObjectID;
}): string => {
  const parts: Array<string> = ["v1", data.userId.toString(), data.code];

  const message: string = parts
    .map((part: string) => {
      return `${part.length}:${part}`;
    })
    .join("");

  return crypto
    .createHmac("sha256", EncryptionSecret.toString())
    .update(message)
    .digest("hex");
};

describe("TwoFactorBackupCode.generateCode -- the code space", () => {
  it("draws only from the declared alphabet", () => {
    const violations: Array<string> = [];

    for (let attempt: number = 0; attempt < 200; attempt++) {
      const code: string = TwoFactorBackupCode.generateCode();

      for (const character of code) {
        if (!BackupCodeAlphabet.includes(character)) {
          violations.push(`${code} contains ${character}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("is exactly BackupCodeLength characters long every time", () => {
    const lengths: Set<number> = new Set<number>();

    for (let attempt: number = 0; attempt < 200; attempt++) {
      lengths.add(TwoFactorBackupCode.generateCode().length);
    }

    expect(Array.from(lengths)).toEqual([BackupCodeLength]);
  });

  /*
   * The alphabet is not decoration. Every symbol it excludes is one a person
   * transcribes wrongly off a printed list -- and `normalizeCode` MAPS those
   * symbols onto their lookalikes, so a generator that emitted an `O` would
   * produce a code that normalizes to a DIFFERENT code and can never be
   * redeemed. The exclusion and the mapping have to stay in step.
   */
  it.each(["I", "L", "O", "U"])(
    "never emits the ambiguous character %p",
    (character: string) => {
      expect(BackupCodeAlphabet).not.toContain(character);
    },
  );

  it("has a 32 symbol alphabet, so ten characters is 2^50", () => {
    expect(BackupCodeAlphabet.length).toBe(32);
    expect(BackupCodeLength).toBe(10);

    /*
     * Stated as an assertion rather than a comment because the security case
     * for this whole feature is this number. At 2^50 a caller holding the
     * password guesses one of ten live codes with probability ~1e-14 per
     * attempt; shortening the code or shrinking the alphabet would quietly
     * move that into range of the rate limiter's budget.
     */
    expect(Math.pow(BackupCodeAlphabet.length, BackupCodeLength)).toBe(
      Math.pow(2, 50),
    );
  });

  /*
   * A uniformity smoke test, not a statistical proof. It exists to catch the
   * one realistic implementation slip -- a modulo reduction over a range that
   * is not a multiple of the alphabet size, which biases the first few symbols
   * and shrinks the effective key space. With 32000 draws every symbol should
   * land ~1000 times; a biased implementation misses this by a mile.
   */
  it("draws every symbol, roughly uniformly", () => {
    const counts: Map<string, number> = new Map<string, number>();

    for (const character of BackupCodeAlphabet) {
      counts.set(character, 0);
    }

    const drawCount: number = 3200;

    for (let attempt: number = 0; attempt < drawCount; attempt++) {
      for (const character of TwoFactorBackupCode.generateCode()) {
        counts.set(character, (counts.get(character) || 0) + 1);
      }
    }

    const totalDraws: number = drawCount * BackupCodeLength;
    const expectedPerSymbol: number = totalDraws / BackupCodeAlphabet.length;

    const violations: Array<string> = [];

    for (const [character, count] of counts) {
      if (count < expectedPerSymbol * 0.6 || count > expectedPerSymbol * 1.4) {
        violations.push(
          `${character}: ${count} (expected ~${expectedPerSymbol})`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("does not repeat itself", () => {
    const codes: Set<string> = new Set<string>();

    for (let attempt: number = 0; attempt < 500; attempt++) {
      codes.add(TwoFactorBackupCode.generateCode());
    }

    expect(codes.size).toBe(500);
  });
});

describe("TwoFactorBackupCode.generateCodeSet", () => {
  it("issues BackupCodeSetSize codes by default", () => {
    expect(TwoFactorBackupCode.generateCodeSet()).toHaveLength(
      BackupCodeSetSize,
    );
  });

  it("honours an explicit count", () => {
    expect(TwoFactorBackupCode.generateCodeSet(3)).toHaveLength(3);
  });

  /*
   * Duplicates inside one set would not weaken the code space -- they would
   * break SINGLE USE. Two rows sharing a digest means consuming one leaves an
   * identical, still-unspent second row behind, so a code advertised as
   * one-time would work twice.
   */
  it("never issues the same code twice in one set", () => {
    for (let attempt: number = 0; attempt < 50; attempt++) {
      const codes: Array<string> = TwoFactorBackupCode.generateCodeSet();

      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});

describe("TwoFactorBackupCode.formatForDisplay", () => {
  it("splits a ten character code into two groups of five", () => {
    expect(TwoFactorBackupCode.formatForDisplay("ABCDE12345")).toBe(
      "ABCDE-12345",
    );
  });

  /*
   * The hyphen is cosmetic and must survive the round trip, or every code we
   * show the user is a code they cannot type back in.
   */
  it("produces something normalizeCode maps back to the original", () => {
    const violations: Array<string> = [];

    for (let attempt: number = 0; attempt < 200; attempt++) {
      const code: string = TwoFactorBackupCode.generateCode();
      const displayed: string = TwoFactorBackupCode.formatForDisplay(code);

      if (TwoFactorBackupCode.normalizeCode(displayed) !== code) {
        violations.push(`${code} -> ${displayed}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("TwoFactorBackupCode.normalizeCode -- what a locked-out user types", () => {
  it("accepts the code exactly as displayed", () => {
    expect(TwoFactorBackupCode.normalizeCode("ABCDE-12345")).toBe("ABCDE12345");
  });

  it.each([
    ["lowercase from a phone keyboard", "abcde-12345", "ABCDE12345"],
    ["no hyphen at all", "ABCDE12345", "ABCDE12345"],
    ["a space where the hyphen was", "ABCDE 12345", "ABCDE12345"],
    ["leading and trailing whitespace", "  ABCDE-12345  ", "ABCDE12345"],
    ["a clipboard that inserted newlines", "ABCDE\n12345", "ABCDE12345"],
    ["mixed case and stray punctuation", "aB.cD/e-1 2345", "ABCDE12345"],
  ])("handles %s", (_label: string, raw: string, expected: string) => {
    expect(TwoFactorBackupCode.normalizeCode(raw)).toBe(expected);
  });

  /*
   * Crockford's transcription rules. These are the ONLY reason the alphabet
   * drops these letters -- if the mapping went away, the exclusion would just
   * be an arbitrary restriction and a user reading `0` as `O` off a printout
   * would be told their code is invalid.
   */
  it.each([
    ["O", "0"],
    ["o", "0"],
    ["I", "1"],
    ["i", "1"],
    ["L", "1"],
    ["l", "1"],
  ])("maps the lookalike %p to %p", (typed: string, canonical: string) => {
    expect(TwoFactorBackupCode.normalizeCode(typed)).toBe(canonical);
  });

  /*
   * `U` is excluded from the alphabet with no lookalike to map onto, so it is
   * dropped rather than translated. Pinned so that nobody "helpfully" maps it
   * to V later and changes what a submitted code means.
   */
  it("drops U rather than mapping it", () => {
    expect(TwoFactorBackupCode.normalizeCode("UUU")).toBe("");
  });

  /*
   * The code arrives straight off a JSON body, so it is only a string because
   * the caller chose to make it one. Anything else must fail verification
   * rather than throw out of the normalizer and surface as a 500 -- an
   * unhandled exception on the login path is both an availability bug and a
   * way to tell requests apart.
   */
  it.each([[undefined], [null], [12345], [{}], [[]], [true]])(
    "returns empty for the non-string input %p",
    (raw: unknown) => {
      expect(TwoFactorBackupCode.normalizeCode(raw as string)).toBe("");
    },
  );

  it("returns empty for a string with nothing usable in it", () => {
    expect(TwoFactorBackupCode.normalizeCode("   ---   ")).toBe("");
  });
});

describe("TwoFactorBackupCode.hashCode", () => {
  it("matches an independently computed HMAC", () => {
    const code: string = "ABCDE12345";

    expect(TwoFactorBackupCode.hashCode({ code: code, userId: USER_ID })).toBe(
      expectedHash({ code: code, userId: USER_ID }),
    );
  });

  it("is deterministic, which is what lets a code be looked up by digest", () => {
    const code: string = TwoFactorBackupCode.generateCode();

    expect(TwoFactorBackupCode.hashCode({ code: code, userId: USER_ID })).toBe(
      TwoFactorBackupCode.hashCode({ code: code, userId: USER_ID }),
    );
  });

  /*
   * Domain separation. Without it, one precomputed table inverts every
   * account's codes at once, and two users issued the same code would be
   * visibly linked by identical rows.
   */
  it("gives two users different digests for the same code", () => {
    const code: string = "ABCDE12345";

    expect(
      TwoFactorBackupCode.hashCode({ code: code, userId: USER_ID }),
    ).not.toBe(
      TwoFactorBackupCode.hashCode({ code: code, userId: OTHER_USER_ID }),
    );
  });

  /*
   * The digest is computed over the NORMALIZED code, not the raw submission.
   * If it were not, a user who typed their code with the hyphen would hash to
   * something that matches nothing -- the exact lockout the normalizer exists
   * to prevent, moved one function along.
   */
  it.each(["ABCDE-12345", "abcde12345", " abcde-12345 ", "ABCDE 12345"])(
    "hashes %p to the same digest as the canonical form",
    (raw: string) => {
      expect(TwoFactorBackupCode.hashCode({ code: raw, userId: USER_ID })).toBe(
        TwoFactorBackupCode.hashCode({
          code: "ABCDE12345",
          userId: USER_ID,
        }),
      );
    },
  );

  it("produces 64 hex characters, which fits the ShortText column", () => {
    const digest: string = TwoFactorBackupCode.hashCode({
      code: TwoFactorBackupCode.generateCode(),
      userId: USER_ID,
    });

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest.length).toBeLessThanOrEqual(100);
  });

  /*
   * Length prefixing. Without it, concatenation is ambiguous: a userId of
   * "ab" with code "cd" and a userId of "abc" with code "d" would produce the
   * same message and therefore the same digest.
   */
  it("cannot be confused by rearranging the boundary between user and code", () => {
    const first: string = TwoFactorBackupCode.hashCode({
      code: "CD",
      userId: new ObjectID("ab"),
    });

    const second: string = TwoFactorBackupCode.hashCode({
      code: "D",
      userId: new ObjectID("abc"),
    });

    expect(first).not.toBe(second);
  });

  /*
   * The plaintext must not be recoverable from the digest by anything short of
   * brute force -- in particular, the digest must not merely BE the code, or
   * contain it, which is the shape a careless "hash" refactor tends to take.
   */
  it("does not contain the code it was computed from", () => {
    const code: string = TwoFactorBackupCode.generateCode();

    const digest: string = TwoFactorBackupCode.hashCode({
      code: code,
      userId: USER_ID,
    });

    expect(digest).not.toContain(code);
    expect(digest).not.toContain(code.toLowerCase());
  });

  it("changes completely when a single character of the code changes", () => {
    const a: string = TwoFactorBackupCode.hashCode({
      code: "ABCDE12345",
      userId: USER_ID,
    });

    const b: string = TwoFactorBackupCode.hashCode({
      code: "ABCDE12346",
      userId: USER_ID,
    });

    expect(a).not.toBe(b);
  });

  it("hashes an empty code to something no real code can collide with", () => {
    /*
     * An empty submission still produces a digest here -- the refusal lives in
     * the service, which never gets this far. What matters is that the digest
     * of "" is not the digest of any generated code, so a caller sending an
     * empty string can never match a row even if a future caller forgets the
     * guard.
     */
    const emptyDigest: string = TwoFactorBackupCode.hashCode({
      code: "",
      userId: USER_ID,
    });

    const violations: Array<string> = [];

    for (let attempt: number = 0; attempt < 100; attempt++) {
      const code: string = TwoFactorBackupCode.generateCode();

      if (
        TwoFactorBackupCode.hashCode({ code: code, userId: USER_ID }) ===
        emptyDigest
      ) {
        violations.push(code);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("TwoFactorBackupCode.isHashEqual", () => {
  it("accepts two identical digests", () => {
    const digest: string = TwoFactorBackupCode.hashCode({
      code: "ABCDE12345",
      userId: USER_ID,
    });

    expect(TwoFactorBackupCode.isHashEqual(digest, digest)).toBe(true);
  });

  it("rejects two different digests", () => {
    expect(
      TwoFactorBackupCode.isHashEqual(
        TwoFactorBackupCode.hashCode({ code: "AAAAA11111", userId: USER_ID }),
        TwoFactorBackupCode.hashCode({ code: "BBBBB22222", userId: USER_ID }),
      ),
    ).toBe(false);
  });

  /*
   * crypto.timingSafeEqual THROWS on a length mismatch, so the length check in
   * front of it is not an optimisation -- without it, a short or malformed
   * value turns a failed comparison into a 500 on the login path.
   */
  it.each([
    ["", ""],
    ["abc", ""],
    ["", "abc"],
    ["abc", "abcd"],
  ])(
    "returns false rather than throwing for (%p, %p)",
    (a: string, b: string) => {
      expect(() => {
        return TwoFactorBackupCode.isHashEqual(a, b);
      }).not.toThrow();

      expect(TwoFactorBackupCode.isHashEqual(a, b)).toBe(false);
    },
  );
});
