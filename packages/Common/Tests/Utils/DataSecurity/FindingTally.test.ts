import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DataTypeTally,
  DataTypeTallyJSON,
  FindingTally,
  fnv1a,
  MAX_COUNTED_DISTINCT_VALUES,
  MAX_MASKED_SAMPLES,
} from "../../../Utils/DataSecurity/FindingTally";

/*
 * WHAT A SCAN KEEPS OF ONE TYPE IN ONE PLACE: COUNTS, NEVER VALUES.
 *
 * Matches and test values are counted apart, the confidence is the highest
 * a real match earned, at most three masked samples are kept (each one
 * once), and distinct values are counted by hash up to a cap.
 */

function add(
  tally: DataTypeTally,
  normalized: string,
  confidence: DataConfidence = DataConfidence.Medium,
  isTestValue: boolean = false,
): void {
  tally.add({ normalized, confidence, isTestValue });
}

describe("DataTypeTally", () => {
  test("counts matches and the distinct values among them", () => {
    const tally: DataTypeTally = new DataTypeTally("email-address");

    for (const email of [
      "a@acme.io",
      "a@acme.io",
      "c@acme.io",
      "e@acme.io",
      "g@acme.io",
    ]) {
      add(tally, email);
    }

    expect(tally.matchCount).toBe(5);
    expect(tally.distinctValues).toBe(4);
  });

  test("counts test values apart, and never as matches, samples or confidence", () => {
    const tally: DataTypeTally = new DataTypeTally("email-address");

    add(tally, "qa@example.com", DataConfidence.High, true);
    add(tally, "jane@acme.io", DataConfidence.Low);

    expect(tally.toJSON()).toEqual({
      dataTypeId: "email-address",
      matchCount: 1,
      testValueCount: 1,
      confidence: DataConfidence.Low,
      maskedSamples: ["j***@a***.io"],
      distinctValues: 1,
      distinctValuesCapped: false,
    } as DataTypeTallyJSON);
  });

  test("takes its confidence from the first real match, then only raises it", () => {
    const tally: DataTypeTally = new DataTypeTally("email-address");

    add(tally, "a@acme.io", DataConfidence.Low);
    expect(tally.confidence).toBe(DataConfidence.Low);

    add(tally, "b@acme.io", DataConfidence.High);
    add(tally, "c@acme.io", DataConfidence.Medium);
    expect(tally.confidence).toBe(DataConfidence.High);
  });

  test(`keeps at most ${MAX_MASKED_SAMPLES} masked samples, each one once`, () => {
    const tally: DataTypeTally = new DataTypeTally("credit-card-number");

    add(tally, "4539148803436467");
    add(tally, "4539148803436467");
    add(tally, "4916338365281094");
    add(tally, "5425233430109903");
    add(tally, "2223000048410010");

    expect(tally.maskedSamples).toEqual([
      "**** **** **** 6467",
      "**** **** **** 1094",
      "**** **** **** 9903",
    ]);
  });

  test("masks the raw text when it has it, the normalized value otherwise", () => {
    const tally: DataTypeTally = new DataTypeTally("phone-number");

    tally.add({
      normalized: "14155552671",
      raw: "+1 (415) 555-2671",
      confidence: DataConfidence.High,
      isTestValue: false,
    });
    add(tally, "14155552672");

    expect(tally.maskedSamples).toEqual(["+* (***) ***-2671", "*******2672"]);
  });

  test("never keeps a value unmasked", () => {
    const tally: DataTypeTally = new DataTypeTally("credit-card-number");

    add(tally, "4539148803436467");

    expect(JSON.stringify(tally.toJSON())).not.toContain("4539148803436467");
  });

  test(`stops counting distinct values at ${MAX_COUNTED_DISTINCT_VALUES} and says so`, () => {
    const tally: DataTypeTally = new DataTypeTally("email-address");

    for (let index: number = 0; index < MAX_COUNTED_DISTINCT_VALUES; index++) {
      add(tally, `user${index}@acme.io`);
    }

    // A value already counted changes nothing.
    add(tally, "user0@acme.io");
    expect(tally.toJSON()).toMatchObject({
      distinctValues: MAX_COUNTED_DISTINCT_VALUES,
      distinctValuesCapped: false,
    });

    add(tally, "one.more@acme.io");
    expect(tally.toJSON()).toMatchObject({
      matchCount: MAX_COUNTED_DISTINCT_VALUES + 2,
      distinctValues: MAX_COUNTED_DISTINCT_VALUES,
      distinctValuesCapped: true,
    });
  });

  test("toJSON hands out a copy of its samples", () => {
    const tally: DataTypeTally = new DataTypeTally("email-address");

    add(tally, "a@acme.io");

    const json: DataTypeTallyJSON = tally.toJSON();

    json.maskedSamples.push("changed");
    expect(tally.maskedSamples).toEqual(["a***@a***.io"]);
  });
});

describe("FindingTally", () => {
  test("keeps one tally per data type", () => {
    const tally: FindingTally = new FindingTally();

    tally.add({
      dataTypeId: "email-address",
      normalized: "a@acme.io",
      confidence: DataConfidence.High,
      isTestValue: false,
    });
    tally.add({
      dataTypeId: "email-address",
      normalized: "b@acme.io",
      confidence: DataConfidence.High,
      isTestValue: false,
    });
    tally.add({
      dataTypeId: "credit-card-number",
      normalized: "4242424242424242",
      confidence: DataConfidence.High,
      isTestValue: true,
    });

    expect(tally.size).toBe(2);
    expect(tally.get("email-address")?.matchCount).toBe(2);
    expect(tally.get("credit-card-number")?.toJSON()).toMatchObject({
      matchCount: 0,
      testValueCount: 1,
      maskedSamples: [],
    });
    expect(tally.get("iban")).toBeUndefined();
    expect(
      tally.all().map((each: DataTypeTally) => {
        return each.dataTypeId;
      }),
    ).toEqual(["email-address", "credit-card-number"]);
  });
});

describe("fnv1a", () => {
  test("is the 32-bit FNV-1a hash", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
  });
});
