import Text from "../../Types/Text";
import { describe, expect, it } from "@jest/globals";

/*
 * GHSA-5cr8-vph4-3hrf, CWE-330.
 *
 * Text.generateRandomNumber is what mints notification-channel verification
 * codes. It used to draw from the literal string "12134567890" using
 * Math.random, which is wrong twice over: the alphabet has "1" in it twice so
 * the digits are not equally likely, and Math.random is a non-cryptographic
 * PRNG whose state is recoverable from its own output.
 *
 * Neither property can be observed by looking at one value, which is why they
 * survived. The tests below observe them the only ways available: by counting
 * a large sample for bias, and by watching which source the generator actually
 * pulls from.
 */
describe("Text random generation", () => {
  describe("generateRandomNumber", () => {
    it("emits only digits, at the requested length", () => {
      for (let length: number = 1; length <= 12; length++) {
        const value: string = Text.generateRandomNumber(length);

        expect(value).toHaveLength(length);
        expect(value).toMatch(/^[0-9]+$/);
      }
    });

    it("defaults to ten characters", () => {
      expect(Text.generateRandomNumber()).toHaveLength(10);
    });

    /*
     * The direct regression. With the old alphabet the digit "1" appeared
     * twice in an eleven-character string, so it came up 2/11 of the time
     * against 1/11 for every other digit — and "8" appeared once, like the
     * rest, only because the typo happened to leave it in.
     *
     * 60,000 digits puts the expected count per digit at 6,000 with a
     * standard deviation of about 73. The old generator produced ~10,909 ones
     * and ~5,454 of everything else, so the bound below is enormously loose
     * for a fair generator and enormously tight for the broken one.
     */
    it("draws every digit with equal probability", () => {
      const sampleSize: number = 10000;
      const digitsPerSample: number = 6;
      const counts: Record<string, number> = {};

      for (let i: number = 0; i < sampleSize; i++) {
        for (const digit of Text.generateRandomNumber(digitsPerSample)) {
          counts[digit] = (counts[digit] || 0) + 1;
        }
      }

      const totalDigits: number = sampleSize * digitsPerSample;
      const expectedPerDigit: number = totalDigits / 10;

      /*
       * Every digit must actually appear — "8" was reachable before, but a
       * future typo in the alphabet would show up here.
       */
      expect(Object.keys(counts).sort()).toEqual([
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
      ]);

      for (const digit of Object.keys(counts)) {
        const count: number = counts[digit] as number;

        /*
         * Six sigma either way: a fair generator fails this about once in
         * 500 million runs, the old one fails it every time.
         */
        expect(count).toBeGreaterThan(expectedPerDigit * 0.9);
        expect(count).toBeLessThan(expectedPerDigit * 1.1);
      }
    });

    /*
     * Leading zeros are part of the code space. Dropping them — by going
     * through a number, say — would quietly remove a tenth of it.
     */
    it("can produce codes with leading zeros", () => {
      let sawLeadingZero: boolean = false;

      for (let i: number = 0; i < 500; i++) {
        if (Text.generateRandomNumber(6).startsWith("0")) {
          sawLeadingZero = true;
          break;
        }
      }

      expect(sawLeadingZero).toBe(true);
    });

    /*
     * The other half of CWE-330. Math.random is seeded per process and its
     * internal state can be recovered from a handful of outputs, after which
     * every future value is known exactly — no guessing required. Asserting
     * on the SOURCE is the only way to pin this: any specific output is a
     * legal output of either generator.
     */
    it("does not fall back to Math.random when a CSPRNG is available", () => {
      const mathRandomSpy: jest.SpyInstance = jest.spyOn(Math, "random");

      try {
        for (let i: number = 0; i < 100; i++) {
          Text.generateRandomNumber(6);
        }

        expect(mathRandomSpy).not.toHaveBeenCalled();
      } finally {
        mathRandomSpy.mockRestore();
      }
    });

    it("takes its bytes from crypto.getRandomValues", () => {
      const getRandomValuesSpy: jest.SpyInstance = jest.spyOn(
        globalThis.crypto,
        "getRandomValues",
      );

      try {
        Text.generateRandomNumber(6);

        expect(getRandomValuesSpy).toHaveBeenCalled();
      } finally {
        getRandomValuesSpy.mockRestore();
      }
    });

    it("produces a different value practically every time", () => {
      const seen: Set<string> = new Set<string>();

      for (let i: number = 0; i < 1000; i++) {
        seen.add(Text.generateRandomNumber(10));
      }

      /*
       * Ten digits, a thousand draws: collisions are vanishingly unlikely,
       * and a stuck generator would collapse this to 1.
       */
      expect(seen.size).toBe(1000);
    });
  });

  describe("generateRandomText", () => {
    it("emits only letters, at the requested length", () => {
      for (let length: number = 1; length <= 40; length += 7) {
        const value: string = Text.generateRandomText(length);

        expect(value).toHaveLength(length);
        expect(value).toMatch(/^[A-Za-z]+$/);
      }
    });

    it("defaults to ten characters", () => {
      expect(Text.generateRandomText()).toHaveLength(10);
    });

    it("does not fall back to Math.random when a CSPRNG is available", () => {
      const mathRandomSpy: jest.SpyInstance = jest.spyOn(Math, "random");

      try {
        for (let i: number = 0; i < 100; i++) {
          Text.generateRandomText(20);
        }

        expect(mathRandomSpy).not.toHaveBeenCalled();
      } finally {
        mathRandomSpy.mockRestore();
      }
    });

    /*
     * Both alphabets have 52 characters, which does NOT divide 256 — so
     * `byte % 52` would be biased towards the first 48 letters. The rejection
     * sampling is what removes that, and this is the test that would notice
     * if somebody "simplified" it away.
     */
    it("draws every letter with roughly equal probability", () => {
      const counts: Record<string, number> = {};
      const totalCharacters: number = 52 * 2000;

      for (let i: number = 0; i < 2000; i++) {
        for (const character of Text.generateRandomText(52)) {
          counts[character] = (counts[character] || 0) + 1;
        }
      }

      expect(Object.keys(counts)).toHaveLength(52);

      const expectedPerCharacter: number = totalCharacters / 52;

      for (const character of Object.keys(counts)) {
        const count: number = counts[character] as number;

        expect(count).toBeGreaterThan(expectedPerCharacter * 0.85);
        expect(count).toBeLessThan(expectedPerCharacter * 1.15);
      }
    });
  });
});
