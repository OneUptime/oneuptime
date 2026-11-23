import {
  CandidateInputField,
  DataTypeCandidate,
  DOMINANT_SKELETON_SHARE,
  findDataTypeCandidates,
  getDataTypeCandidateKey,
  getFieldSkeleton,
  getOwnNameWords,
  isSameNameWord,
  isSignificantWord,
  MAX_CANDIDATE_FIELDS,
  MIN_CANDIDATE_FIELDS,
  MIN_CANDIDATE_STORES,
  shapeSkeleton,
} from "../../../Utils/DataSecurity/DataTypeCandidates";
import {
  describeUnplacedField,
  UnplacedField,
  UnplacedValueShape,
} from "../../../Utils/DataSecurity/UnplacedFields";
import { describe, expect, test } from "@jest/globals";

/*
 * The company's own data types, found in the fields scans could not place
 * (#10371): grouped across stores by the shape of their values and the
 * words of their names, from names and shapes alone.
 */

function unplaced(
  location: string,
  shapes: Array<UnplacedValueShape>,
  valueCount: number = 50,
): UnplacedField {
  return {
    location,
    locationKind: "Column",
    neighbours: ["created_at", "customer_name"],
    shapes,
    valueCount,
    averageLength: 10,
  };
}

function field(
  store: string,
  location: string,
  shapes: Array<UnplacedValueShape> = [{ shape: "AA-9999999", share: 1 }],
  valueCount: number = 50,
): CandidateInputField {
  return {
    dataStoreId: store,
    storeName: `Store ${store}`,
    storeKind: "PostgreSql",
    field: unplaced(location, shapes, valueCount),
  };
}

// Eleven policy number columns in six stores, under the names a company really uses.
function elevenPolicyColumns(): Array<CandidateInputField> {
  return [
    field("s1", "public.policies.policy_no"),
    field("s1", "public.claims.policy_no"),
    field("s2", "sales.contracts.policyNumber"),
    field("s2", "sales.renewals.policyNumber"),
    field("s3", "public.vertraege.police_nr"),
    field("s3", "public.schaeden.police_nr"),
    field("s4", "crm.customers.policy_ref"),
    field("s4", "crm.leads.policy_ref", [{ shape: "AA9999999", share: 1 }]),
    field("s5", "billing.invoices.policy_id"),
    field("s5", "billing.payments.policy_id"),
    field("s6", "exports/*.csv > policies", [
      { shape: "AA-9999999", share: 0.7 },
      { shape: "AA9999999", share: 0.3 },
    ]),
  ];
}

describe("shapeSkeleton", () => {
  test("keeps each run of capitals, small letters and digits once, in order", () => {
    expect(shapeSkeleton("AA-9999999")).toBe("A9");
    expect(shapeSkeleton("AA9999999")).toBe("A9");
    expect(shapeSkeleton("AAA-999999")).toBe("A9");
    expect(shapeSkeleton("AA-9999-A")).toBe("A9A");
    expect(shapeSkeleton("Aaaaa")).toBe("Aa");
  });

  test("leaves out the separators a value may leave out, and keeps any other character", () => {
    expect(shapeSkeleton("999-99-9999")).toBe("9");
    expect(shapeSkeleton("999 99 9999")).toBe("9");
    expect(shapeSkeleton("aaaa@aaaa.aaa")).toBe("a@a");
    expect(shapeSkeleton("+99 (99) 9999")).toBe("+9(9)9");
  });
});

describe("getFieldSkeleton", () => {
  test("is the skeleton most of the field's values share", () => {
    expect(
      getFieldSkeleton(
        unplaced("t.policy_no", [
          { shape: "AA-9999999", share: 0.5 },
          { shape: "AA9999999", share: 0.3 },
          { shape: "999", share: 0.2 },
        ]),
      ),
    ).toBe("A9");
  });

  test(`is none when no skeleton has ${DOMINANT_SKELETON_SHARE * 100}% of the values`, () => {
    expect(
      getFieldSkeleton(
        unplaced("t.mixed_ref", [
          { shape: "AA-9999999", share: 0.5 },
          { shape: "aaaa", share: 0.5 },
        ]),
      ),
    ).toBeNull();
  });

  test("is none for values with no digit: words, names, statuses", () => {
    expect(
      getFieldSkeleton(unplaced("t.city", [{ shape: "Aaaaaa", share: 1 }])),
    ).toBeNull();
    expect(
      getFieldSkeleton(unplaced("t.tier", [{ shape: "AAAA", share: 1 }])),
    ).toBeNull();
  });

  test("is none for a date, a time or a decimal number", () => {
    for (const shape of [
      "9999-99-99",
      "9999-99-99A99:99:99",
      "99.99.9999",
      "99/99/99",
      "99:99",
      "99:99:99.999",
      "999.99",
      "-99,99",
    ]) {
      expect({
        shape,
        skeleton: getFieldSkeleton(unplaced("t.x", [{ shape, share: 1 }])),
      }).toEqual({ shape, skeleton: null });
    }
  });

  test("is the skeleton for an identifier made of digits alone", () => {
    expect(
      getFieldSkeleton(
        unplaced("t.account_no", [{ shape: "9999999999", share: 1 }]),
      ),
    ).toBe("9");
  });
});

describe("the words of a field's name", () => {
  test("are its own name's, in lower case, plurals made singular", () => {
    expect(getOwnNameWords("public.claims.policy_no")).toEqual([
      "policy",
      "no",
    ]);
    expect(getOwnNameWords("sales.contracts.policyNumber")).toEqual([
      "policy",
      "number",
    ]);
    expect(getOwnNameWords("t.policies")).toEqual(["policy"]);
    expect(getOwnNameWords("t.customer_numbers")).toEqual([
      "customer",
      "number",
    ]);
  });

  test("take the part before a name that says nothing by itself", () => {
    expect(getOwnNameWords("attributes.customer.id")).toEqual([
      "customer",
      "id",
    ]);
    expect(getOwnNameWords("attributes.app.customer.number")).toEqual([
      "customer",
      "number",
    ]);
    // Never further than one part back: a path's start says where, not what.
    expect(getOwnNameWords("billing.ref.id")).toEqual(["ref", "id"]);
  });

  test("a word says what a field holds unless it is generic or a letter or two", () => {
    expect(isSignificantWord("policy")).toBe(true);
    expect(isSignificantWord("kundennr")).toBe(true);

    for (const word of ["no", "nr", "number", "id", "ref", "code", "value"]) {
      expect({ word, significant: isSignificantWord(word) }).toEqual({
        word,
        significant: false,
      });
    }

    expect(isSignificantWord("x")).toBe(false);
    expect(isSignificantWord("2024")).toBe(false);
  });

  test("two words say the same thing when equal, one starts the other, or one letter apart", () => {
    expect(isSameNameWord("policy", "policy")).toBe(true);
    expect(isSameNameWord("policy", "police")).toBe(true);
    expect(isSameNameWord("cust", "customer")).toBe(true);
    expect(isSameNameWord("kunde", "kunden")).toBe(true);
    expect(isSameNameWord("policy", "claim")).toBe(false);
    // Short words must be equal: "pin" is not "pan".
    expect(isSameNameWord("pin", "pan")).toBe(false);
    expect(isSameNameWord("order", "owner")).toBe(false);
  });
});

describe("findDataTypeCandidates", () => {
  test("eleven AA-9999999 columns under policy_no-like names in six stores become one candidate", () => {
    const candidates: Array<DataTypeCandidate> = findDataTypeCandidates(
      elevenPolicyColumns(),
    );

    expect(candidates).toHaveLength(1);

    const candidate: DataTypeCandidate = candidates[0]!;

    expect(candidate.fields).toHaveLength(11);
    expect(candidate.stores).toBe(6);
    expect(candidate.skeleton).toBe("A9");
    expect(candidate.words[0]).toBe("policy");
    expect(candidate.words).toContain("police");
    expect(candidate.values).toBe(550);
    // Its shapes together, by their share of all its values.
    expect(candidate.shapes[0]).toEqual({ shape: "AA-9999999", share: 0.88 });
    expect(candidate.shapes[1]).toEqual({ shape: "AA9999999", share: 0.12 });
    expect(candidate.key).toBe(
      getDataTypeCandidateKey({ skeleton: "A9", word: "policy" }),
    );
  });

  test(`needs ${MIN_CANDIDATE_FIELDS} fields in ${MIN_CANDIDATE_STORES} stores: one odd column, or one store's, is no data type`, () => {
    expect(
      findDataTypeCandidates([
        field("s1", "a.policy_no"),
        field("s2", "b.policy_no"),
      ]),
    ).toEqual([]);
    expect(
      findDataTypeCandidates([
        field("s1", "a.policy_no"),
        field("s1", "b.policy_no"),
        field("s1", "c.policy_no"),
      ]),
    ).toEqual([]);
    expect(
      findDataTypeCandidates([
        field("s1", "a.policy_no"),
        field("s1", "b.policy_no"),
        field("s2", "c.policy_no"),
      ]),
    ).toHaveLength(1);
  });

  test("fields of one shape whose names share nothing are two candidates, not one", () => {
    const candidates: Array<DataTypeCandidate> = findDataTypeCandidates([
      field("s1", "a.policy_no"),
      field("s2", "b.policy_no"),
      field("s3", "c.policy_number"),
      field("s1", "a.claim_ref"),
      field("s2", "b.claim_ref"),
      field("s3", "c.claim_no"),
    ]);

    expect(
      candidates
        .map((candidate: DataTypeCandidate): string => {
          return candidate.words[0]!;
        })
        .sort(),
    ).toEqual(["claim", "policy"]);
  });

  test("fields of one name whose values differ in shape are not one candidate", () => {
    expect(
      findDataTypeCandidates([
        field("s1", "a.policy_no", [{ shape: "AA-9999999", share: 1 }]),
        field("s2", "b.policy_no", [{ shape: "9999-AAA", share: 1 }]),
        field("s3", "c.policy_no", [{ shape: "999999", share: 1 }]),
      ]),
    ).toEqual([]);
  });

  test("leaves out words, names, dates and fields with no dominant shape", () => {
    expect(
      findDataTypeCandidates([
        field("s1", "a.city", [{ shape: "Aaaaaa", share: 1 }]),
        field("s2", "b.city", [{ shape: "Aaaaaa", share: 1 }]),
        field("s3", "c.city", [{ shape: "Aaaaaa", share: 1 }]),
        field("s1", "a.birth_date", [{ shape: "9999-99-99", share: 1 }]),
        field("s2", "b.birth_date", [{ shape: "9999-99-99", share: 1 }]),
        field("s3", "c.birth_date", [{ shape: "9999-99-99", share: 1 }]),
      ]),
    ).toEqual([]);
  });

  test("groups names of generic words alone by the whole name", () => {
    // A document's top-level fields: no table names them.
    const candidates: Array<DataTypeCandidate> = findDataTypeCandidates([
      field("s1", "ref"),
      field("s2", "ref"),
      field("s3", "ref"),
      field("s3", "number"),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.fields).toHaveLength(3);
    expect(candidates[0]!.words).toEqual(["ref"]);
  });

  test("reads a table's name with a field named by a generic word alone", () => {
    // policies.ref holds a policy as much as policy_no does.
    const candidates: Array<DataTypeCandidate> = findDataTypeCandidates([
      field("s1", "public.policies.ref"),
      field("s2", "app.policy_no"),
      field("s3", "crm.policyNumber"),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.words[0]).toBe("policy");
  });

  test("keeps the same key as the group gains a field, so a group a person turned down stays turned down", () => {
    const before: DataTypeCandidate = findDataTypeCandidates(
      elevenPolicyColumns().slice(0, 6),
    )[0]!;
    const after: DataTypeCandidate = findDataTypeCandidates([
      ...elevenPolicyColumns(),
      field("s7", "dw.facts.policy_no"),
    ])[0]!;

    expect(after.fields.length).toBeGreaterThan(before.fields.length);
    expect(after.key).toBe(before.key);
  });

  test(`keeps at most ${MAX_CANDIDATE_FIELDS} fields, the most valued first`, () => {
    const many: Array<CandidateInputField> = Array.from(
      { length: MAX_CANDIDATE_FIELDS + 10 },
      (_value: unknown, index: number): CandidateInputField => {
        return field(`s${index % 7}`, `t${index}.policy_no`, undefined, index + 5);
      },
    );
    const candidate: DataTypeCandidate = findDataTypeCandidates(many)[0]!;

    expect(candidate.fields).toHaveLength(MAX_CANDIDATE_FIELDS);
    expect(candidate.fields[0]!.field.valueCount).toBe(
      MAX_CANDIDATE_FIELDS + 14,
    );
  });

  test("reads the fields as a scan describes them, never a value", () => {
    const values: Array<string> = Array.from(
      { length: 20 },
      (_value: unknown, index: number): string => {
        return `PL-${String(1000000 + index * 13)}`;
      },
    );
    const described: Array<CandidateInputField> = ["s1", "s2", "s3"].map(
      (store: string): CandidateInputField => {
        return {
          dataStoreId: store,
          storeName: store,
          storeKind: "MySql",
          field: describeUnplacedField({
            path: "app.policies.policy_no",
            values,
            neighbours: [],
            locationKind: "Column",
          })!,
        };
      },
    );
    const candidate: DataTypeCandidate = findDataTypeCandidates(described)[0]!;

    expect(candidate.shapes).toEqual([{ shape: "AA-9999999", share: 1 }]);
    expect(JSON.stringify(candidate)).not.toContain("PL-1000000");
  });

  test("orders candidates by their fields, then their stores", () => {
    const candidates: Array<DataTypeCandidate> = findDataTypeCandidates([
      field("s1", "a.claim_ref"),
      field("s2", "b.claim_ref"),
      field("s3", "c.claim_ref"),
      ...elevenPolicyColumns(),
    ]);

    expect(
      candidates.map((candidate: DataTypeCandidate): number => {
        return candidate.fields.length;
      }),
    ).toEqual([11, 3]);
  });
});
