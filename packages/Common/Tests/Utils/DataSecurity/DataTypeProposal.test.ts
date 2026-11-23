import DataCategory from "../../../Types/DataSecurity/DataCategory";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { JSONObject } from "../../../Types/JSON";
import { CustomDataTypeValidator } from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import {
  checkDataTypeDraft,
  DataTypeDraft,
  DataTypeDraftProblem,
  DataTypeDraftVariant,
  DataTypeDropReason,
  DataTypeGroupField,
  DataTypeProof,
  DataTypeProofDecision,
  DataTypeProposalPlan,
  DataTypeStoreCount,
  DataTypeStoreVariantCount,
  decideDataTypeProof,
  getDataTypeProof,
  getElsewhereMatchShare,
  getGroupMatchShare,
  getOfferedDraft,
  getPlanStoreIds,
  getScatteredMatchShare,
  isEveryStoreCounted,
  MAX_DRAFT_WORDS,
  MAX_SCATTERED_MATCH_SHARE,
  MIN_GROUP_MATCH_SHARE,
  narrowDataTypeDraft,
  readDataTypeDraft,
  readDataTypeProposalPlan,
  readDataTypeStoreCounts,
  toCustomDataTypeFormValues,
  toStoreVariantCount,
} from "../../../Utils/DataSecurity/DataTypeProposal";
import { describe, expect, test } from "@jest/globals";

/*
 * A data type OneUptime AI proposes (#10371): its draft held to what a
 * saved type is held to, and proven on its stores' next scans before anyone
 * is asked - from counts alone.
 */

const NOW: Date = new Date("2026-11-23T12:00:00.000Z");
const SINCE: string = "2026-11-23T00:00:00.000Z";
const UNTIL: string = "2026-11-25T00:00:00.000Z";

const DRAFT: DataTypeDraft = {
  name: "Insurance policy number",
  description: "The number of an insurance policy, such as AB-1234567.",
  category: DataCategory.Financial,
  sensitivity: DataSensitivity.Confidential,
  pattern: "\\b[A-Z]{2}-?\\d{7}\\b",
  ignoreCase: false,
  keywords: ["policy"],
  requiresKeyword: false,
  nameHints: ["policy no", "policy number"],
  validator: CustomDataTypeValidator.None,
};

function groupField(store: string, location: string): DataTypeGroupField {
  return {
    dataStoreId: store,
    storeName: `Store ${store}`,
    storeKind: "PostgreSql",
    location,
    locationKind: "Column",
    shapes: [{ shape: "AA-9999999", share: 1 }],
    valueCount: 100,
  };
}

function plan(fields: Array<DataTypeGroupField>): DataTypeProposalPlan {
  return {
    groupKey: "data-type:0123456789abcdef",
    skeleton: "A9",
    words: ["policy", "police"],
    fields,
    fieldCount: fields.length,
    storeCount: new Set(
      fields.map((field: DataTypeGroupField): string => {
        return field.dataStoreId;
      }),
    ).size,
    shapes: [{ shape: "AA-9999999", share: 1 }],
    draft: DRAFT,
    narrowed: narrowDataTypeDraft(DRAFT, ["policy", "police"]),
    reason: "Every field's name says policy, and every value is two capitals and seven digits.",
    provingSince: SINCE,
    provingUntil: UNTIL,
  };
}

function variant(
  fields: Record<string, [number, number]>,
  elsewhere: [number, number],
  wholeFields: Record<string, [number, number]> = {},
): DataTypeStoreVariantCount {
  const toCounts: (
    entries: Record<string, [number, number]>,
  ) => Record<string, { values: number; matched: number }> = (
    entries: Record<string, [number, number]>,
  ) => {
    return Object.fromEntries(
      Object.entries(entries).map(
        ([location, [values, matched]]: [string, [number, number]]) => {
          return [location, { values, matched }];
        },
      ),
    );
  };

  return {
    fields: toCounts(fields),
    elsewhere: { values: elsewhere[0], matched: elsewhere[1] },
    wholeFields: toCounts(wholeFields),
  };
}

function storeCount(
  asDrafted: DataTypeStoreVariantCount,
  narrowed: DataTypeStoreVariantCount = asDrafted,
  scannedAt: string = "2026-11-23T06:00:00.000Z",
): DataTypeStoreCount {
  return {
    scannedAt,
    variants: {
      [DataTypeDraftVariant.AsDrafted]: asDrafted,
      [DataTypeDraftVariant.Narrowed]: narrowed,
    },
  };
}

// The eleven columns of six stores the issue names, and what their scans counted.
function elevenColumns(): DataTypeProposalPlan {
  return plan([
    groupField("s1", "public.policies.policy_no"),
    groupField("s1", "public.claims.policy_no"),
    groupField("s2", "sales.contracts.policyNumber"),
    groupField("s2", "sales.renewals.policyNumber"),
    groupField("s3", "public.vertraege.police_nr"),
    groupField("s3", "public.schaeden.police_nr"),
    groupField("s4", "crm.customers.policy_ref"),
    groupField("s4", "crm.leads.policy_ref"),
    groupField("s5", "billing.invoices.policy_id"),
    groupField("s5", "billing.payments.policy_id"),
    groupField("s6", "exports/*.csv > policies"),
  ]);
}

function elevenColumnsCounted(): Record<string, DataTypeStoreCount> {
  const stores: Record<string, DataTypeStoreCount> = {};
  const byStore: Map<string, Array<string>> = new Map();

  for (const field of elevenColumns().fields) {
    byStore.set(field.dataStoreId, [
      ...(byStore.get(field.dataStoreId) || []),
      field.location,
    ]);
  }

  for (const [store, locations] of byStore) {
    const fields: Record<string, [number, number]> = {};

    for (const location of locations) {
      fields[location] = [100, 98];
    }

    stores[store] = storeCount(variant(fields, [2000, 2]));
  }

  return stores;
}

describe("readDataTypeDraft", () => {
  test("reads a draft as a saved type keeps it", () => {
    expect(
      readDataTypeDraft({
        ...DRAFT,
        name: "  Insurance policy number  ",
        keywords: ["Policy", "policy", " ", 3],
      } as unknown as JSONObject),
    ).toEqual({ ...DRAFT, keywords: ["policy"] });
  });

  test("is none without a name, a pattern, a category, a sensitivity or a checksum a saved type can carry", () => {
    for (const broken of [
      { ...DRAFT, name: "" },
      { ...DRAFT, pattern: "" },
      { ...DRAFT, pattern: "x".repeat(501) },
      { ...DRAFT, category: "Pets" },
      { ...DRAFT, sensitivity: "Secret" },
      { ...DRAFT, validator: "Mod11" },
    ]) {
      expect(readDataTypeDraft(broken as unknown as JSONObject)).toBeNull();
    }

    expect(readDataTypeDraft(null)).toBeNull();
    expect(readDataTypeDraft([DRAFT])).toBeNull();
  });

  test("asks for a keyword only where it has one", () => {
    expect(
      readDataTypeDraft({
        ...DRAFT,
        keywords: [],
        requiresKeyword: true,
      } as unknown as JSONObject)!.requiresKeyword,
    ).toBe(false);
  });

  test(`keeps at most ${MAX_DRAFT_WORDS} keywords and field names`, () => {
    const many: Array<string> = Array.from(
      { length: 40 },
      (_value: unknown, index: number): string => {
        return `word${index}`;
      },
    );

    expect(
      readDataTypeDraft({
        ...DRAFT,
        keywords: many,
        nameHints: many,
      } as unknown as JSONObject)!.keywords,
    ).toHaveLength(MAX_DRAFT_WORDS);
  });
});

describe("checkDataTypeDraft", () => {
  test("passes a pattern a saved type could have, that finds its own shapes", () => {
    expect(
      checkDataTypeDraft(DRAFT, [{ shape: "AA-9999999", share: 1 }]),
    ).toBeNull();
    // Without the dash too: "sometimes without the dash".
    expect(
      checkDataTypeDraft(DRAFT, [
        { shape: "999-99", share: 0.1 },
        { shape: "AA9999999", share: 0.9 },
      ]),
    ).toBeNull();
  });

  test("drops a pattern that does not compile, cannot run in linear time or matches empty text", () => {
    for (const pattern of ["([A-Z", "\\d*", "(a|ab)*c\\1"]) {
      expect({
        pattern,
        problem: checkDataTypeDraft({ ...DRAFT, pattern }),
      }).toEqual({ pattern, problem: DataTypeDraftProblem.PatternUnusable });
    }
  });

  test("drops a pattern that finds plain words: it would find words everywhere", () => {
    for (const pattern of ["\\w+", "[a-z]{3,}", "[A-Za-z]+\\d*"]) {
      expect({
        pattern,
        problem: checkDataTypeDraft({ ...DRAFT, pattern }),
      }).toEqual({ pattern, problem: DataTypeDraftProblem.FindsPlainWords });
    }
  });

  test("drops a pattern that finds none of the shapes it was drafted from", () => {
    expect(
      checkDataTypeDraft({ ...DRAFT, pattern: "PL-\\d{7}" }, [
        { shape: "AA-9999999", share: 1 },
      ]),
    ).toBe(DataTypeDraftProblem.MissesItsShapes);
    // A sentence's draft has no shapes: a literal prefix is the person's own.
    expect(checkDataTypeDraft({ ...DRAFT, pattern: "EMP-?\\d{6}" })).toBeNull();
  });
});

describe("narrowDataTypeDraft", () => {
  test("adds the words its fields share as keywords, and asks for one", () => {
    const narrowed: DataTypeDraft = narrowDataTypeDraft(DRAFT, [
      "policy",
      "police",
      "no",
    ]);

    expect(narrowed.keywords).toEqual(["policy", "police"]);
    expect(narrowed.requiresKeyword).toBe(true);
    expect(narrowed.pattern).toBe(DRAFT.pattern);
    expect(narrowed.nameHints).toEqual(DRAFT.nameHints);
  });
});

describe("toStoreVariantCount", () => {
  test("splits a scan's counts into the group's fields, elsewhere and the fields that hold the same data", () => {
    const count: DataTypeStoreVariantCount | null = toStoreVariantCount({
      counted: {
        fields: 30,
        values: 3000,
        matched: 250,
        matchedFields: {
          "t.policy_no": { values: 100, matched: 99 },
          "t.vertragsnr": { values: 100, matched: 100 },
          "t.notes": { values: 1000, matched: 4 },
          "t.tiny": { values: 3, matched: 3 },
        },
      },
      groupLocations: ["t.policy_no", "t.police_nr", "t.gone"],
      readFieldValues: (location: string): number => {
        // police_nr found nothing: read from its description; gone was not read.
        return location === "t.police_nr" ? 80 : 0;
      },
    });

    expect(count).toEqual({
      fields: {
        "t.policy_no": { values: 100, matched: 99 },
        "t.police_nr": { values: 80, matched: 0 },
      },
      elsewhere: { values: 2820, matched: 151 },
      wholeFields: { "t.vertragsnr": { values: 100, matched: 100 } },
    });
  });

  test("is none when the scan did not run the draft", () => {
    expect(
      toStoreVariantCount({
        counted: undefined,
        groupLocations: ["t.policy_no"],
        readFieldValues: (): number => {
          return 10;
        },
      }),
    ).toBeNull();
  });
});

describe("the proof", () => {
  test("eleven columns in six stores: 98% of the values in the 11 fields, and 0.1% elsewhere", () => {
    const proof: DataTypeProof = getDataTypeProof({
      plan: elevenColumns(),
      stores: elevenColumnsCounted(),
      variant: DataTypeDraftVariant.AsDrafted,
    });

    expect(proof).toMatchObject({
      variant: DataTypeDraftVariant.AsDrafted,
      storesInGroup: 6,
      storesCounted: 6,
      fieldsInGroup: 11,
      fieldsCounted: 11,
      groupValues: 1100,
      groupMatched: 1078,
      elsewhereValues: 12000,
      elsewhereMatched: 12,
    });
    expect(getGroupMatchShare(proof)).toBe(0.98);
    expect(getElsewhereMatchShare(proof)).toBe(0.001);
    expect(proof.fields).toHaveLength(11);
  });

  test("counts only the group's own fields as its own, and a store outside the group not at all", () => {
    const stores: Record<string, DataTypeStoreCount> = {
      s1: storeCount(
        variant(
          { "t.policy_no": [50, 50], "t.not_in_group": [50, 50] },
          [100, 0],
        ),
      ),
      stranger: storeCount(variant({ "t.policy_no": [500, 500] }, [0, 0])),
    };
    const proof: DataTypeProof = getDataTypeProof({
      plan: plan([groupField("s1", "t.policy_no"), groupField("s2", "t.x")]),
      stores,
      variant: DataTypeDraftVariant.AsDrafted,
    });

    expect(proof.groupValues).toBe(50);
    expect(proof.storesCounted).toBe(1);
    expect(proof.storesInGroup).toBe(2);
  });

  test("leaves a field elsewhere that holds the same data out of what says it reaches too far", () => {
    const proof: DataTypeProof = getDataTypeProof({
      plan: plan([groupField("s1", "t.policy_no")]),
      stores: {
        s1: storeCount(
          variant({ "t.policy_no": [100, 100] }, [1100, 101], {
            "t.vertragsnr": [100, 100],
          }),
        ),
      },
      variant: DataTypeDraftVariant.AsDrafted,
    });

    expect(getElsewhereMatchShare(proof)).toBeCloseTo(101 / 1100, 5);
    expect(getScatteredMatchShare(proof)).toBe(0.001);
    expect(proof.alsoIn).toEqual([
      {
        dataStoreId: "s1",
        storeName: "Store s1",
        location: "t.vertragsnr",
        values: 100,
        matched: 100,
      },
    ]);
  });
});

describe("decideDataTypeProof", () => {
  test("waits while a store was not scanned and there is time", () => {
    const counted: Record<string, DataTypeStoreCount> = elevenColumnsCounted();

    delete counted["s6"];

    expect(
      decideDataTypeProof({ plan: elevenColumns(), stores: counted, now: NOW }),
    ).toEqual({ outcome: "waiting" });
  });

  test("offers it as drafted once every store was scanned, without waiting for the time to end", () => {
    const decision: DataTypeProofDecision = decideDataTypeProof({
      plan: elevenColumns(),
      stores: elevenColumnsCounted(),
      now: NOW,
    });

    expect(decision.outcome).toBe("propose");
    expect(
      (decision as { proof: DataTypeProof }).proof.variant,
    ).toBe(DataTypeDraftVariant.AsDrafted);
  });

  test("offers what was counted once the time is over, if some stores were scanned", () => {
    const counted: Record<string, DataTypeStoreCount> = elevenColumnsCounted();

    delete counted["s6"];
    delete counted["s5"];

    const decision: DataTypeProofDecision = decideDataTypeProof({
      plan: elevenColumns(),
      stores: counted,
      now: new Date(UNTIL),
    });

    expect(decision.outcome).toBe("propose");
    expect((decision as { proof: DataTypeProof }).proof).toMatchObject({
      storesCounted: 4,
      fieldsCounted: 8,
      fieldsInGroup: 11,
    });
  });

  test("a scan from before it was drafted does not count", () => {
    const stores: Record<string, DataTypeStoreCount> = elevenColumnsCounted();

    for (const store of Object.keys(stores)) {
      stores[store] = { ...stores[store]!, scannedAt: "2026-11-22T00:00:00.000Z" };
    }

    expect(isEveryStoreCounted({ plan: elevenColumns(), stores })).toBe(false);
  });

  test("drops it when no store was scanned while it was proven", () => {
    expect(
      decideDataTypeProof({
        plan: elevenColumns(),
        stores: {},
        now: new Date(UNTIL),
      }),
    ).toMatchObject({ outcome: "drop", reason: DataTypeDropReason.NotScanned });
  });

  test(`drops it when it finds under ${MIN_GROUP_MATCH_SHARE * 100}% of its own fields' values`, () => {
    expect(
      decideDataTypeProof({
        plan: plan([groupField("s1", "t.policy_no")]),
        stores: { s1: storeCount(variant({ "t.policy_no": [100, 79] }, [0, 0])) },
        now: NOW,
      }),
    ).toMatchObject({
      outcome: "drop",
      reason: DataTypeDropReason.MissesItsFields,
    });
  });

  test(`narrows it when it finds over ${MAX_SCATTERED_MATCH_SHARE * 100}% elsewhere, and the narrowed draft does not`, () => {
    const decision: DataTypeProofDecision = decideDataTypeProof({
      plan: plan([groupField("s1", "t.policy_no")]),
      stores: {
        s1: storeCount(
          variant({ "t.policy_no": [100, 100] }, [1000, 50]),
          variant({ "t.policy_no": [100, 100] }, [1000, 3]),
        ),
      },
      now: NOW,
    });

    expect(decision.outcome).toBe("propose");

    const proof: DataTypeProof = (decision as { proof: DataTypeProof }).proof;

    expect(proof.variant).toBe(DataTypeDraftVariant.Narrowed);
    expect(
      getOfferedDraft({ ...plan([groupField("s1", "t.policy_no")]), proof })
        .requiresKeyword,
    ).toBe(true);
  });

  test("drops it when it reaches too far, narrowed too", () => {
    expect(
      decideDataTypeProof({
        plan: plan([groupField("s1", "t.policy_no")]),
        stores: {
          s1: storeCount(
            variant({ "t.policy_no": [100, 100] }, [1000, 50]),
            variant({ "t.policy_no": [100, 100] }, [1000, 20]),
          ),
        },
        now: NOW,
      }),
    ).toMatchObject({
      outcome: "drop",
      reason: DataTypeDropReason.ReachesTooFar,
    });
  });

  test("drops the narrowed draft too when narrowing loses its own fields", () => {
    expect(
      decideDataTypeProof({
        plan: plan([groupField("s1", "t.policy_no")]),
        stores: {
          s1: storeCount(
            variant({ "t.policy_no": [100, 100] }, [1000, 50]),
            variant({ "t.policy_no": [100, 60] }, [1000, 0]),
          ),
        },
        now: NOW,
      }),
    ).toMatchObject({ outcome: "drop", reason: DataTypeDropReason.ReachesTooFar });
  });
});

describe("the plan, stored and read again", () => {
  test("reads back what was written, proof and all", () => {
    const written: DataTypeProposalPlan = {
      ...elevenColumns(),
      proof: getDataTypeProof({
        plan: elevenColumns(),
        stores: elevenColumnsCounted(),
        variant: DataTypeDraftVariant.AsDrafted,
      }),
    };

    expect(
      readDataTypeProposalPlan(JSON.parse(JSON.stringify(written)) as unknown),
    ).toEqual(written);
    expect(getPlanStoreIds(written)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
    ]);
  });

  test("reads the stores' counts back as they were recorded", () => {
    const counted: Record<string, DataTypeStoreCount> = elevenColumnsCounted();

    expect(
      readDataTypeStoreCounts(JSON.parse(JSON.stringify(counted)) as unknown),
    ).toEqual(counted);
    expect(readDataTypeStoreCounts({ s1: { scannedAt: "never" } })).toEqual({});
  });

  test("is none without a draft or a group's key, and drops a shape that is a value", () => {
    expect(readDataTypeProposalPlan({ groupKey: "k" })).toBeNull();
    expect(
      readDataTypeProposalPlan({ ...elevenColumns(), groupKey: "" }),
    ).toBeNull();

    const read: DataTypeProposalPlan = readDataTypeProposalPlan({
      ...elevenColumns(),
      shapes: [
        { shape: "AB-1234567", share: 0.5 },
        { shape: "AA-9999999", share: 0.5 },
      ],
    } as unknown as JSONObject)!;

    expect(read.shapes).toEqual([{ shape: "AA-9999999", share: 0.5 }]);
  });

  test("fills the data type form with the draft, switched on", () => {
    expect(toCustomDataTypeFormValues(DRAFT)).toEqual({
      name: DRAFT.name,
      description: DRAFT.description,
      category: DRAFT.category,
      sensitivity: DRAFT.sensitivity,
      pattern: DRAFT.pattern,
      ignoreCase: false,
      keywords: ["policy"],
      requiresKeyword: false,
      nameHints: ["policy no", "policy number"],
      validator: CustomDataTypeValidator.None,
      isEnabled: true,
    });
  });
});
