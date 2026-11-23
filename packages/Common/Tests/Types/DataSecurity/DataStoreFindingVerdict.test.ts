import { describe, expect, test } from "@jest/globals";
import {
  DATA_STORE_FINDING_VERDICT_LIMITS,
  DATA_STORE_FINDING_VERDICT_TITLES,
  DATA_STORE_FINDING_VERDICT_VERSION,
  DATA_STORE_FINDING_VERDICTS,
  DataStoreFindingDecision,
  DataStoreFindingVerdict,
  DataStoreFindingVerdictRecord,
  FINDING_VERDICT_INPUT_HASH_PATTERN,
  FINDING_WRONG_MATCH_SIGN_TITLES,
  FINDING_WRONG_MATCH_SIGNS,
  FindingWrongMatchSign,
  getFindingVerdictInputHash,
  isDataStoreFindingVerdict,
  readDataStoreFindingVerdictRecord,
  toDataStoreFindingVerdictJson,
} from "../../../Types/DataSecurity/DataStoreFindingVerdict";

/*
 * ONEUPTIME AI'S VERDICT ON A FINDING, AS THE FINDING KEEPS IT (#10372).
 *
 * The stored strings are a contract; a verdict read back is held to what a
 * build of OneUptime writes, and anything else reads as no verdict; the
 * input's hash is stable whatever order its keys come in.
 */

function record(
  more: Partial<DataStoreFindingVerdictRecord> = {},
): DataStoreFindingVerdictRecord {
  return {
    version: DATA_STORE_FINDING_VERDICT_VERSION,
    verdict: DataStoreFindingVerdict.NotSensitive,
    reason: "order_number holds order numbers, as your team said on 4 stores.",
    draft: "Order numbers that pass the Luhn check, not card numbers.",
    precedent: [
      {
        findingId: "11111111-1111-4111-8111-111111111111",
        dataStoreId: "22222222-2222-4222-8222-222222222222",
        location: "public.orders.order_number",
        decision: DataStoreFindingDecision.NotSensitive,
        reason: "Order numbers, not cards.",
        isSameName: true,
        decidedAt: "2026-11-01T10:00:00.000Z",
      },
    ],
    signs: [FindingWrongMatchSign.IdFieldWithLuhnNumbers],
    language: "en",
    writtenAt: "2026-11-23T10:00:00.000Z",
    ...more,
  };
}

describe("the verdicts", () => {
  test("are three, stored as written", () => {
    expect(DATA_STORE_FINDING_VERDICTS).toEqual([
      "Confirm",
      "NotSensitive",
      "CannotTell",
    ]);
  });

  test("each has a title", () => {
    for (const verdict of DATA_STORE_FINDING_VERDICTS) {
      expect(DATA_STORE_FINDING_VERDICT_TITLES[verdict]).toBeTruthy();
    }
  });

  test("a value no build wrote is no verdict", () => {
    expect(isDataStoreFindingVerdict("Confirm")).toBe(true);
    expect(isDataStoreFindingVerdict("confirm")).toBe(false);
    expect(isDataStoreFindingVerdict("Real")).toBe(false);
    expect(isDataStoreFindingVerdict(undefined)).toBe(false);
  });

  test("each sign has a title, stored as written", () => {
    expect(FINDING_WRONG_MATCH_SIGNS).toEqual([
      "MostlyTestValues",
      "NamePointsElsewhere",
      "IdFieldWithLuhnNumbers",
    ]);

    for (const sign of FINDING_WRONG_MATCH_SIGNS) {
      expect(FINDING_WRONG_MATCH_SIGN_TITLES[sign]).toBeTruthy();
    }
  });
});

describe("a verdict read back", () => {
  test("reads as it was written", () => {
    const written: DataStoreFindingVerdictRecord = record();

    expect(
      readDataStoreFindingVerdictRecord(toDataStoreFindingVerdictJson(written)),
    ).toEqual(written);
  });

  test.each([
    ["nothing", undefined],
    ["a list", []],
    ["text", "NotSensitive"],
    ["a verdict no build wrote", { verdict: "Real" }],
  ])("%s is no verdict", (_title: string, value: unknown) => {
    expect(readDataStoreFindingVerdictRecord(value)).toBeNull();
  });

  test("only Not sensitive keeps a draft", () => {
    expect(
      readDataStoreFindingVerdictRecord(
        toDataStoreFindingVerdictJson(
          record({ verdict: DataStoreFindingVerdict.Confirm }),
        ),
      )?.draft,
    ).toBe("");
  });

  test("a precedent that is not one is left out", () => {
    const read: DataStoreFindingVerdictRecord | null =
      readDataStoreFindingVerdictRecord({
        ...toDataStoreFindingVerdictJson(record()),
        precedent: [
          { findingId: "a", dataStoreId: "b", decision: "Maybe" },
          { findingId: "", dataStoreId: "b", decision: "NotSensitive" },
          "text",
          {
            findingId: "c",
            dataStoreId: "d",
            decision: "Confirmed",
            location: "customer_email",
          },
        ],
      });

    expect(read?.precedent).toEqual([
      {
        findingId: "c",
        dataStoreId: "d",
        location: "customer_email",
        decision: DataStoreFindingDecision.Confirmed,
        reason: "",
        isSameName: false,
      },
    ]);
  });

  test("keeps at most the most precedent a verdict cites, each held to its length", () => {
    const long: string = "x".repeat(1000);
    const read: DataStoreFindingVerdictRecord | null =
      readDataStoreFindingVerdictRecord({
        ...toDataStoreFindingVerdictJson(record()),
        reason: long,
        precedent: Array.from({ length: 30 }, (_: unknown, index: number) => {
          return {
            findingId: `f${index}`,
            dataStoreId: "s",
            decision: "NotSensitive",
            reason: long,
            location: long,
          };
        }),
      });

    expect(read?.precedent).toHaveLength(
      DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedent,
    );
    expect(read?.reason).toHaveLength(
      DATA_STORE_FINDING_VERDICT_LIMITS.maxReasonLength,
    );
    expect(read?.precedent[0]?.reason).toHaveLength(
      DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedentReasonLength,
    );
    expect(read?.precedent[0]?.location).toHaveLength(
      DATA_STORE_FINDING_VERDICT_LIMITS.maxLocationLength,
    );
  });

  test("a sign no build wrote is left out", () => {
    expect(
      readDataStoreFindingVerdictRecord({
        ...toDataStoreFindingVerdictJson(record()),
        signs: ["MostlyTestValues", "Nonsense"],
      })?.signs,
    ).toEqual([FindingWrongMatchSign.MostlyTestValues]);
  });
});

describe("the hash of what a verdict was written from", () => {
  test("is the same whatever order the keys come in", () => {
    expect(
      getFindingVerdictInputHash({
        data: { a: 1, b: { c: 2, d: 3 } },
        language: "en",
      }),
    ).toBe(
      getFindingVerdictInputHash({
        data: { b: { d: 3, c: 2 }, a: 1 },
        language: "en",
      }),
    );
  });

  test("changes with the data, the language and the version", () => {
    const base: string = getFindingVerdictInputHash({
      data: { a: 1 },
      language: "en",
    });

    expect(base).toMatch(FINDING_VERDICT_INPUT_HASH_PATTERN);
    expect(
      getFindingVerdictInputHash({ data: { a: 2 }, language: "en" }),
    ).not.toBe(base);
    expect(
      getFindingVerdictInputHash({ data: { a: 1 }, language: "de" }),
    ).not.toBe(base);
    expect(
      getFindingVerdictInputHash({
        data: { a: 1 },
        language: "en",
        version: DATA_STORE_FINDING_VERDICT_VERSION + 1,
      }),
    ).not.toBe(base);
  });
});
