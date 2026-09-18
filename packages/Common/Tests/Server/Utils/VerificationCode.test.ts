import VerificationCode, {
  VERIFICATION_CODE_LENGTH,
} from "../../../Server/Utils/VerificationCode";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";
import crypto from "crypto";

/*
 * GHSA-5cr8-vph4-3hrf.
 *
 * The cryptography under notification-channel verification: a code drawn from
 * a real CSPRNG, stored only as a keyed digest that is domain-separated by the
 * row it belongs to, and compared in constant time.
 */
describe("VerificationCode", () => {
  describe("generate", () => {
    it("produces a six digit code by default", () => {
      const code: string = VerificationCode.generate();

      expect(code).toHaveLength(VERIFICATION_CODE_LENGTH);
      expect(code).toMatch(/^[0-9]{6}$/);
    });

    it("honours an explicit length", () => {
      expect(VerificationCode.generate(8)).toMatch(/^[0-9]{8}$/);
      expect(VerificationCode.generate(4)).toMatch(/^[0-9]{4}$/);
    });

    /*
     * The whole point of this module existing separately from
     * Common/Types/Text: Text has to tolerate a runtime without a CSPRNG
     * because it is bundled into the browser, and falls back to Math.random
     * there. A code minted on the server must never take that path.
     */
    it("never falls back to Math.random", () => {
      const mathRandomSpy: jest.SpyInstance = jest.spyOn(Math, "random");

      try {
        for (let i: number = 0; i < 200; i++) {
          VerificationCode.generate();
        }

        expect(mathRandomSpy).not.toHaveBeenCalled();
      } finally {
        mathRandomSpy.mockRestore();
      }
    });

    it("draws from crypto.randomInt", () => {
      const randomIntSpy: jest.SpyInstance = jest.spyOn(crypto, "randomInt");

      try {
        VerificationCode.generate(6);

        expect(randomIntSpy).toHaveBeenCalledTimes(6);
        expect(randomIntSpy).toHaveBeenCalledWith(0, 10);
      } finally {
        randomIntSpy.mockRestore();
      }
    });

    it("keeps leading zeros, so the code space really is 10^6", () => {
      let sawLeadingZero: boolean = false;

      for (let i: number = 0; i < 500; i++) {
        if (VerificationCode.generate().startsWith("0")) {
          sawLeadingZero = true;
          break;
        }
      }

      expect(sawLeadingZero).toBe(true);
    });

    it("spreads across the space rather than repeating itself", () => {
      const seen: Set<string> = new Set<string>();

      for (let i: number = 0; i < 500; i++) {
        seen.add(VerificationCode.generate());
      }

      /*
       * 500 draws from 10^6 values: the birthday bound puts the expected
       * number of collisions at well under one, so anything below 490 means
       * the generator is not spreading.
       */
      expect(seen.size).toBeGreaterThan(490);
    });

    it("uses every digit in every position", () => {
      const perPosition: Array<Set<string>> = [
        new Set<string>(),
        new Set<string>(),
        new Set<string>(),
        new Set<string>(),
        new Set<string>(),
        new Set<string>(),
      ];

      for (let i: number = 0; i < 2000; i++) {
        const code: string = VerificationCode.generate();

        for (let position: number = 0; position < 6; position++) {
          (perPosition[position] as Set<string>).add(code.charAt(position));
        }
      }

      for (const position of perPosition) {
        expect(position.size).toBe(10);
      }
    });
  });

  describe("hashCode", () => {
    const channelId: ObjectID = new ObjectID(
      "8f7c1a1a-4bb0-4f0d-9f01-1c0d0d0d0d01",
    );

    it("returns a 64 character hex digest", () => {
      expect(VerificationCode.hashCode({ code: "123456", channelId })).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });

    it("is deterministic for the same code and row", () => {
      expect(VerificationCode.hashCode({ code: "123456", channelId })).toBe(
        VerificationCode.hashCode({ code: "123456", channelId }),
      );
    });

    it("never returns the code itself", () => {
      const digest: string = VerificationCode.hashCode({
        code: "123456",
        channelId,
      });

      expect(digest).not.toBe("123456");
      expect(digest).not.toContain("123456");
    });

    it("changes completely when a single digit changes", () => {
      const a: string = VerificationCode.hashCode({
        code: "123456",
        channelId,
      });
      const b: string = VerificationCode.hashCode({
        code: "123457",
        channelId,
      });

      expect(a).not.toBe(b);
    });

    /*
     * Domain separation. Without the row id in the message, one precomputed
     * table of 10^6 digests would invert every row in the table at once, and
     * two rows that happened to draw the same code would be visibly equal to
     * anybody holding a database dump.
     */
    it("gives the same code different digests on different rows", () => {
      const otherChannelId: ObjectID = new ObjectID(
        "8f7c1a1a-4bb0-4f0d-9f01-1c0d0d0d0d02",
      );

      expect(VerificationCode.hashCode({ code: "123456", channelId })).not.toBe(
        VerificationCode.hashCode({
          code: "123456",
          channelId: otherChannelId,
        }),
      );
    });

    /*
     * Length-prefixing. Without it, ("ab", "cde") and ("abc", "de") would
     * concatenate to the same message — the id and code fields could be slid
     * past each other to forge a digest for a different pair.
     */
    it("cannot be confused by moving a character between the id and the code", () => {
      const first: string = VerificationCode.hashCode({
        code: "3456",
        channelId: new ObjectID("ab12"),
      });
      const second: string = VerificationCode.hashCode({
        code: "23456",
        channelId: new ObjectID("ab1"),
      });

      expect(first).not.toBe(second);
    });

    it("is keyed, not a bare digest of its inputs", () => {
      const digest: string = VerificationCode.hashCode({
        code: "123456",
        channelId,
      });

      const unkeyed: string = crypto
        .createHash("sha256")
        .update(`${channelId.toString()}123456`)
        .digest("hex");

      expect(digest).not.toBe(unkeyed);
    });
  });

  describe("isHashEqual", () => {
    it("accepts identical digests", () => {
      const digest: string = VerificationCode.hashCode({
        code: "123456",
        channelId: new ObjectID("row-1"),
      });

      expect(VerificationCode.isHashEqual(digest, digest)).toBe(true);
    });

    it("rejects different digests", () => {
      const channelId: ObjectID = new ObjectID("row-1");

      expect(
        VerificationCode.isHashEqual(
          VerificationCode.hashCode({ code: "123456", channelId }),
          VerificationCode.hashCode({ code: "654321", channelId }),
        ),
      ).toBe(false);
    });

    it("rejects empty and mismatched-length values without throwing", () => {
      /*
       * timingSafeEqual throws on differing lengths, so the guard in front of
       * it is load-bearing rather than cosmetic.
       */
      expect(VerificationCode.isHashEqual("", "")).toBe(false);
      expect(VerificationCode.isHashEqual("abc", "")).toBe(false);
      expect(VerificationCode.isHashEqual("", "abc")).toBe(false);
      expect(VerificationCode.isHashEqual("abc", "abcd")).toBe(false);
    });

    it("compares with a constant-time primitive rather than ===", () => {
      const timingSafeEqualSpy: jest.SpyInstance = jest.spyOn(
        crypto,
        "timingSafeEqual",
      );

      try {
        const digest: string = VerificationCode.hashCode({
          code: "123456",
          channelId: new ObjectID("row-1"),
        });

        VerificationCode.isHashEqual(digest, digest);

        expect(timingSafeEqualSpy).toHaveBeenCalled();
      } finally {
        timingSafeEqualSpy.mockRestore();
      }
    });
  });

  describe("generateUnusableHash", () => {
    it("looks like a digest, so a stored value gives nothing away", () => {
      expect(VerificationCode.generateUnusableHash()).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is different every time", () => {
      const seen: Set<string> = new Set<string>();

      for (let i: number = 0; i < 100; i++) {
        seen.add(VerificationCode.generateUnusableHash());
      }

      expect(seen.size).toBe(100);
    });

    /*
     * The property that makes it a safe "no live code" marker: no six-digit
     * code hashes to it. Exhausting 10^6 codes per assertion is not something
     * a unit test can do, so this samples — the real guarantee is that the
     * value comes from a 256-bit space the 10^6 digests cannot cover.
     */
    it("is not the digest of any code that happens to be tried against it", () => {
      const channelId: ObjectID = new ObjectID("row-1");
      const unusable: string = VerificationCode.generateUnusableHash();

      for (let i: number = 0; i < 2000; i++) {
        const code: string = i.toString().padStart(6, "0");

        expect(
          VerificationCode.isHashEqual(
            VerificationCode.hashCode({ code, channelId }),
            unusable,
          ),
        ).toBe(false);
      }
    });
  });
});
