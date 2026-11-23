import { CustomDataTypeValidator } from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import {
  compileShadowDetectors,
  countShadowField,
  isShadowKey,
  MAX_SHADOW_DETECTORS,
  MAX_SHADOW_FIELDS_PER_DRAFT,
  mergeShadowCounts,
  readShadowCounts,
  SHADOW_DATA_TYPE_ID_PREFIX,
  ShadowCounts,
  ShadowDraft,
  ShadowScanDetector,
} from "../../../Utils/DataSecurity/ShadowCount";
import { describe, expect, test } from "@jest/globals";

/*
 * A drafted data type run in shadow (#10371): every field a scan reads is
 * counted - how many of its values the draft would find - and nothing is
 * found, kept or named but the counts.
 */

const POLICY: ShadowDraft = {
  key: "proposal-1:AsDrafted",
  definition: {
    pattern: "[A-Z]{2}-?\\d{7}",
    nameHints: ["policy no"],
  },
};

// The same, finding a value elsewhere only beside "policy".
const POLICY_NARROWED: ShadowDraft = {
  key: "proposal-1:Narrowed",
  definition: {
    pattern: "[A-Z]{2}-?\\d{7}",
    nameHints: ["policy no"],
    keywords: ["policy"],
    requiresKeyword: true,
  },
};

function policies(count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `PL-${String(1000000 + index * 17)}`;
  });
}

function counted(
  detectors: Array<ShadowScanDetector>,
  fields: Array<{ location: string; values: Array<unknown> }>,
): ShadowCounts {
  const counts: ShadowCounts = {};

  for (const entry of fields) {
    countShadowField({
      counts,
      detectors,
      location: entry.location,
      values: entry.values,
    });
  }

  return counts;
}

describe("compileShadowDetectors", () => {
  test("compiles each draft as a saved type, under a type no finding can have", () => {
    const detectors: Array<ShadowScanDetector> = compileShadowDetectors([
      POLICY,
    ]);

    expect(detectors).toHaveLength(1);
    expect(detectors[0]!.key).toBe(POLICY.key);
    expect(detectors[0]!.detector.dataTypeId).toBe(
      `${SHADOW_DATA_TYPE_ID_PREFIX}${POLICY.key}`,
    );
    expect(detectors[0]!.hints).toEqual(["policy no"]);
  });

  test("leaves out a draft that cannot run, a key twice and a key that is not one", () => {
    const detectors: Array<ShadowScanDetector> = compileShadowDetectors([
      POLICY,
      POLICY,
      { key: "broken", definition: { pattern: "([A-Z" } },
      { key: "empty", definition: { pattern: "" } },
      { key: "no spaces please", definition: POLICY.definition },
    ]);

    expect(
      detectors.map((detector: ShadowScanDetector): string => {
        return detector.key;
      }),
    ).toEqual([POLICY.key]);
    expect(isShadowKey("a:b_c-1")).toBe(true);
    expect(isShadowKey("a b")).toBe(false);
    expect(isShadowKey("x".repeat(101))).toBe(false);
  });

  test(`runs at most ${MAX_SHADOW_DETECTORS} drafts in one scan`, () => {
    expect(
      compileShadowDetectors(
        Array.from(
          { length: MAX_SHADOW_DETECTORS + 5 },
          (_value: unknown, index: number): ShadowDraft => {
            return { key: `d${index}`, definition: POLICY.definition };
          },
        ),
      ),
    ).toHaveLength(MAX_SHADOW_DETECTORS);
  });
});

describe("countShadowField", () => {
  test("counts every field the scan read, and names only those it would find a value in", () => {
    const counts: ShadowCounts = counted(compileShadowDetectors([POLICY]), [
      { location: "public.policies.policy_no", values: policies(40) },
      {
        location: "public.policies.notes",
        values: ["renewed PL-1234567 today", "no reference", "", null],
      },
      { location: "public.policies.email", values: ["kim@acme.example"] },
    ]);

    expect(counts[POLICY.key]).toEqual({
      fields: 3,
      values: 43,
      matched: 41,
      matchedFields: {
        "public.policies.policy_no": { values: 40, matched: 40 },
        "public.policies.notes": { values: 2, matched: 1 },
      },
    });
  });

  test("narrowed, it finds a value elsewhere only beside a keyword, and in its own fields as before", () => {
    const counts: ShadowCounts = counted(
      compileShadowDetectors([POLICY, POLICY_NARROWED]),
      [
        { location: "crm.leads.policy_no", values: policies(10) },
        {
          location: "crm.leads.comment",
          values: ["call back about AB1234567", "policy AB7654321 lapsed"],
        },
      ],
    );

    expect(counts[POLICY.key]!.matched).toBe(12);
    expect(counts[POLICY_NARROWED.key]!.matched).toBe(11);
    expect(counts[POLICY_NARROWED.key]!.matchedFields).toEqual({
      "crm.leads.policy_no": { values: 10, matched: 10 },
      "crm.leads.comment": { values: 2, matched: 1 },
    });
  });

  test("never counts a value the project says is never sensitive", () => {
    const counts: ShadowCounts = {};

    countShadowField({
      counts,
      detectors: compileShadowDetectors([POLICY]),
      location: "t.policy_no",
      values: ["AB-1234567", "AB-7654321"],
      allowedValues: new Set(["ab-1234567"]),
    });

    expect(counts[POLICY.key]!.matched).toBe(1);
  });

  test("passes the checksum a draft asks for, as a saved type would", () => {
    const counts: ShadowCounts = counted(
      compileShadowDetectors([
        {
          key: "luhn",
          definition: {
            pattern: "\\b\\d{16}\\b",
            validator: CustomDataTypeValidator.Luhn,
          },
        },
      ]),
      [{ location: "t.member_card", values: ["4111111111111111", "4111111111111112"] }],
    );

    expect(counts["luhn"]!.matched).toBe(1);
  });

  test("a field with nothing to read counts nothing, and no draft counts nothing", () => {
    const counts: ShadowCounts = counted(compileShadowDetectors([POLICY]), [
      { location: "t.empty", values: ["", null, undefined, "   "] },
    ]);

    expect(counts).toEqual({});
    expect(counted([], [{ location: "t.x", values: policies(3) }])).toEqual(
      {},
    );
  });

  test(`names at most ${MAX_SHADOW_FIELDS_PER_DRAFT} fields, and counts all of them`, () => {
    const fields: Array<{ location: string; values: Array<unknown> }> =
      Array.from(
        { length: MAX_SHADOW_FIELDS_PER_DRAFT + 20 },
        (_value: unknown, index: number) => {
          return { location: `t.f${index}`, values: policies(1) };
        },
      );
    const counts: ShadowCounts = counted(
      compileShadowDetectors([POLICY]),
      fields,
    );

    expect(Object.keys(counts[POLICY.key]!.matchedFields)).toHaveLength(
      MAX_SHADOW_FIELDS_PER_DRAFT,
    );
    expect(counts[POLICY.key]!.matched).toBe(MAX_SHADOW_FIELDS_PER_DRAFT + 20);
  });

  test("keeps no value: the counts say how many, never what", () => {
    const counts: ShadowCounts = counted(compileShadowDetectors([POLICY]), [
      { location: "t.policy_no", values: policies(5) },
    ]);

    expect(JSON.stringify(counts)).not.toContain("PL-");
  });
});

describe("mergeShadowCounts", () => {
  test("adds a part's counts under the prefix its locations take", () => {
    const whole: ShadowCounts = counted(compileShadowDetectors([POLICY]), [
      { location: "container-a/exports > policy_no", values: policies(2) },
    ]);
    const part: ShadowCounts = counted(compileShadowDetectors([POLICY]), [
      { location: "exports > policy_no", values: policies(3) },
      { location: "exports > other", values: ["x"] },
    ]);

    mergeShadowCounts(whole, part, "container-b/");

    expect(whole[POLICY.key]).toEqual({
      fields: 3,
      values: 6,
      matched: 5,
      matchedFields: {
        "container-a/exports > policy_no": { values: 2, matched: 2 },
        "container-b/exports > policy_no": { values: 3, matched: 3 },
      },
    });
  });

  test("adds a field counted twice - two objects of one pattern - into one", () => {
    const whole: ShadowCounts = {};

    mergeShadowCounts(
      whole,
      counted(compileShadowDetectors([POLICY]), [
        { location: "policy_no", values: policies(2) },
      ]),
      "exports/*.csv > ",
    );
    mergeShadowCounts(
      whole,
      counted(compileShadowDetectors([POLICY]), [
        { location: "policy_no", values: policies(4) },
      ]),
      "exports/*.csv > ",
    );

    expect(whole[POLICY.key]!.matchedFields).toEqual({
      "exports/*.csv > policy_no": { values: 6, matched: 6 },
    });
  });
});

describe("readShadowCounts", () => {
  test("reads back what a scan wrote", () => {
    const written: ShadowCounts = counted(compileShadowDetectors([POLICY]), [
      { location: "t.policy_no", values: policies(4) },
    ]);

    expect(
      readShadowCounts(JSON.parse(JSON.stringify(written)) as unknown),
    ).toEqual(written);
  });

  test("keeps only the drafts the probe was handed, each count a count", () => {
    const read: ShadowCounts = readShadowCounts(
      {
        expected: {
          fields: 2,
          values: 10,
          matched: 99,
          matchedFields: {
            "t.a": { values: 5, matched: 50 },
            "t.b": { values: "5", matched: 1 },
            "t.c": { values: 5, matched: 0 },
          },
        },
        stranger: { fields: 1, values: 1, matched: 1, matchedFields: {} },
        "not a key": { fields: 1, values: 1, matched: 1, matchedFields: {} },
        negative: { fields: -1, values: 1, matched: 1, matchedFields: {} },
      },
      (key: string): boolean => {
        return key !== "stranger";
      },
    );

    expect(read).toEqual({
      expected: {
        fields: 2,
        values: 10,
        matched: 10,
        matchedFields: { "t.a": { values: 5, matched: 5 } },
      },
    });
  });

  test("reads nothing from what is not counts", () => {
    expect(readShadowCounts(null)).toEqual({});
    expect(readShadowCounts([1, 2])).toEqual({});
    expect(readShadowCounts("counts")).toEqual({});
  });
});
