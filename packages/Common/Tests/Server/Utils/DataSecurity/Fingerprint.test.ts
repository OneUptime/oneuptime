import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../../Types/DataSecurity/DataConfidence";
import {
  buildFingerprint,
  deriveFingerprintKey,
  estimateOverlap,
  FINGERPRINT_SLOTS,
  FingerprintAccumulator,
  isFingerprint,
  MAX_FINGERPRINTED_DATA_TYPES,
  normalizeFingerprintValue,
} from "../../../../Server/Utils/DataSecurity/Fingerprint";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * COPY DETECTION FROM 128 NUMBERS.
 *
 * A fingerprint is a b-bit MinHash of a set of values hashed under the
 * project's key: two sets' fingerprints agree on about as many slots as
 * the sets overlap, so estimateOverlap reads their Jaccard similarity back
 * - here held to it on synthetic sets of known overlap - while nothing of
 * a value can be read out of one, and a fingerprint under another key
 * matches nothing.
 */

const KEY: string = "project-key-for-tests";

function people(from: number, to: number): Array<string> {
  const values: Array<string> = [];

  for (let index: number = from; index < to; index++) {
    values.push(`person.${index}@customers.example.net`);
  }

  return values;
}

/*
 * Two sets of `size` values sharing enough of them that their Jaccard
 * similarity is `jaccard`, and that similarity exactly.
 */
function setsWithOverlap(
  size: number,
  jaccard: number,
  offset: number,
): { a: Array<string>; b: Array<string>; jaccard: number } {
  const shift: number = Math.round((size * (1 - jaccard)) / (1 + jaccard));

  return {
    a: people(offset, offset + size),
    b: people(offset + shift, offset + shift + size),
    jaccard: (size - shift) / (size + shift),
  };
}

describe("buildFingerprint", () => {
  test("is 128 slots of 16 bits, the same for the same values in any order", () => {
    const values: Array<string> = people(0, 500);
    const fingerprint: Array<number> = buildFingerprint(values, KEY);

    expect(fingerprint).toHaveLength(FINGERPRINT_SLOTS);
    expect(isFingerprint(fingerprint)).toBe(true);

    for (const slot of fingerprint) {
      expect(Number.isInteger(slot)).toBe(true);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThanOrEqual(0xffff);
    }

    expect(buildFingerprint([...values].reverse(), KEY)).toEqual(fingerprint);
    // A value seen twice is the same set.
    expect(buildFingerprint([...values, ...values], KEY)).toEqual(fingerprint);
  });

  test("reads a value as its trimmed, lower-cased form", () => {
    expect(normalizeFingerprintValue("  Alice@Example.NET ")).toBe(
      "alice@example.net",
    );
    expect(
      buildFingerprint(["ALICE@EXAMPLE.NET", " bob@example.net"], KEY),
    ).toEqual(buildFingerprint(["alice@example.net", "bob@example.net"], KEY));
  });

  test("is nothing for no values, and nothing without a key", () => {
    expect(buildFingerprint([], KEY)).toEqual([]);
    expect(buildFingerprint(["", "   "], KEY)).toEqual([]);
    expect(buildFingerprint(people(0, 10), "")).toEqual([]);
  });

  test("holds no value and no hash of one: only 16 bits of each slot's minimum", () => {
    const fingerprint: Array<number> = buildFingerprint(
      ["the-only-value@example.net"],
      KEY,
    );

    expect(JSON.stringify(fingerprint)).not.toContain("example");
    // One value: every slot is the low 16 bits of one hash each.
    expect(new Set(fingerprint).size).toBeGreaterThan(100);
  });

  test("under another project's key compares as unrelated", () => {
    const values: Array<string> = people(0, 1000);

    expect(
      estimateOverlap(
        buildFingerprint(values, KEY),
        buildFingerprint(values, "another-project-key"),
      ),
    ).toBeLessThan(0.05);
  });
});

describe("estimateOverlap", () => {
  test("is 1 for the same set and about 0 for sets with nothing in common", () => {
    const a: Array<number> = buildFingerprint(people(0, 2000), KEY);

    expect(estimateOverlap(a, a)).toBe(1);
    expect(
      estimateOverlap(a, buildFingerprint(people(10_000, 12_000), KEY)),
    ).toBeLessThan(0.05);
  });

  test.each([0.1, 0.25, 0.5, 0.75, 0.9])(
    "reads a Jaccard similarity of %p back from two sets of 2000",
    (jaccard: number) => {
      const sets: { a: Array<string>; b: Array<string>; jaccard: number } =
        setsWithOverlap(2000, jaccard, 0);
      const estimate: number = estimateOverlap(
        buildFingerprint(sets.a, KEY),
        buildFingerprint(sets.b, KEY),
      );

      // 128 slots: a standard error of at most 0.044.
      expect(Math.abs(estimate - sets.jaccard)).toBeLessThan(0.14);
    },
  );

  test("tracks the Jaccard similarity of drawn sets of every size and overlap", () => {
    const random: SeededRandom = seededRandom(20261027);
    let totalError: number = 0;
    const draws: number = 40;

    for (let draw: number = 0; draw < draws; draw++) {
      const size: number = 50 + random(3000);
      const jaccard: number = random();
      const sets: { a: Array<string>; b: Array<string>; jaccard: number } =
        setsWithOverlap(size, jaccard, draw * 100_000);
      const estimate: number = estimateOverlap(
        buildFingerprint(sets.a, KEY),
        buildFingerprint(sets.b, KEY),
      );
      const error: number = Math.abs(estimate - sets.jaccard);

      // At most 0.5 / sqrt(128) = 0.044 standard error: 3.6 of them.
      expect(error).toBeLessThan(0.16);
      totalError += error;
    }

    // And no bias: on average far closer than any one draw may be.
    expect(totalError / draws).toBeLessThan(0.05);
  });

  test("is 0 for anything that is not two fingerprints", () => {
    const fingerprint: Array<number> = buildFingerprint(people(0, 10), KEY);

    expect(estimateOverlap([], fingerprint)).toBe(0);
    expect(estimateOverlap(fingerprint, [])).toBe(0);
    expect(estimateOverlap(fingerprint.slice(0, 64), fingerprint)).toBe(0);
  });
});

describe("FingerprintAccumulator", () => {
  test("sketches each data type from its High matches, as buildFingerprint would", () => {
    const accumulator: FingerprintAccumulator = new FingerprintAccumulator(KEY);
    const emails: Array<string> = people(0, 300);

    for (const email of emails) {
      accumulator.addMatch({
        dataTypeId: "email-address",
        normalized: email,
        confidence: DataConfidence.High,
        isTestValue: false,
      });
    }

    accumulator.add("us-ssn", "536904399", DataConfidence.High);

    const fingerprints: Record<
      string,
      Array<number>
    > = accumulator.getFingerprints();

    expect(Object.keys(fingerprints).sort()).toEqual([
      "email-address",
      "us-ssn",
    ]);
    expect(fingerprints["email-address"]).toEqual(
      buildFingerprint(emails, KEY),
    );
    expect(accumulator.toJSON()).toEqual(fingerprints);
  });

  test("leaves out Medium and Low matches and test values", () => {
    const accumulator: FingerprintAccumulator = new FingerprintAccumulator(KEY);

    accumulator.add("phone-number", "14155550123", DataConfidence.Medium);
    accumulator.add("ip-address", "52.1.2.3", DataConfidence.Low);
    accumulator.addMatch({
      dataTypeId: "credit-card-number",
      normalized: "4111111111111111",
      confidence: DataConfidence.High,
      isTestValue: true,
    });

    expect(accumulator.getFingerprints()).toEqual({});
    expect(accumulator.dataTypeCount).toBe(0);
  });

  test("keeps nothing without the project's key", () => {
    const accumulator: FingerprintAccumulator = new FingerprintAccumulator("");

    accumulator.add("email-address", "alice@example.net", DataConfidence.High);

    expect(accumulator.getFingerprints()).toEqual({});
  });

  test("sketches a bounded number of data types", () => {
    const accumulator: FingerprintAccumulator = new FingerprintAccumulator(KEY);

    for (
      let index: number = 0;
      index < MAX_FINGERPRINTED_DATA_TYPES + 20;
      index++
    ) {
      accumulator.add(`custom:${index}`, `value-${index}`, DataConfidence.High);
    }

    expect(accumulator.dataTypeCount).toBe(MAX_FINGERPRINTED_DATA_TYPES);
  });
});

describe("deriveFingerprintKey", () => {
  test("is one key per project, the same every time, from the server's secret", () => {
    const key: string = deriveFingerprintKey("server-secret", "project-1");

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveFingerprintKey("server-secret", "project-1")).toBe(key);
    expect(deriveFingerprintKey("server-secret", "project-2")).not.toBe(key);
    expect(deriveFingerprintKey("other-secret", "project-1")).not.toBe(key);
  });
});
