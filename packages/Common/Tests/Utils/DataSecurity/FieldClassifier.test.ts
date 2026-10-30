import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import { compileCustomDataType } from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import CONTACT_DETECTORS from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import BUILT_IN_DETECTORS from "../../../Utils/DataSecurity/Detectors/Index";
import {
  classifyField,
  FieldClassification,
  MAX_FIELD_VALUE_LENGTH,
  MAX_FIELD_VALUES,
  toScannableValue,
} from "../../../Utils/DataSecurity/FieldClassifier";
import { ScanDetector } from "../../../Utils/DataSecurity/TextScanner";

/*
 * WHAT ONE FIELD HOLDS, JUDGED AS A WHOLE.
 *
 * A column of values is one piece of evidence: the share of its values
 * that hold a type sets the finding's confidence, its name can confirm
 * that, a type found only from names is checked for plausible values, and
 * free text keeps what each match earned on its own. Test values never
 * count as matches, and a field is read only up to its caps.
 */

const H: DataConfidence = DataConfidence.High;
const M: DataConfidence = DataConfidence.Medium;
const L: DataConfidence = DataConfidence.Low;

const CARD: string = "4539148803436467";

function resultOf(
  results: Array<FieldClassification>,
  dataTypeId: string,
): FieldClassification | undefined {
  return results.find((result: FieldClassification) => {
    return result.dataTypeId === dataTypeId;
  });
}

function classifiedAs(
  fieldPath: string,
  values: ReadonlyArray<unknown>,
  dataTypeId: string,
  options: Parameters<typeof classifyField>[2] = {},
): FieldClassification | undefined {
  return resultOf(classifyField(fieldPath, values, options), dataTypeId);
}

// `matching` emails among `total` values, the rest words that hold nothing.
function emailsAmong(matching: number, total: number): Array<string> {
  const values: Array<string> = [];

  for (let index: number = 0; index < total; index++) {
    values.push(
      index < matching
        ? `person${index}@acme.io`
        : ["n/a", "none", "pending"][index % 3]!,
    );
  }

  return values;
}

describe("the share of values that hold a type", () => {
  test("60% or more is High, with or without the name", () => {
    expect(
      classifiedAs("reference", emailsAmong(6, 10), "email-address"),
    ).toMatchObject({
      confidence: H,
      matchRatio: 0.6,
      valuesWithMatch: 6,
      valueCount: 10,
      nameHinted: false,
      isFreeText: false,
      foundByName: false,
    });
    expect(
      classifiedAs("reference", emailsAmong(3, 5), "email-address")?.confidence,
    ).toBe(H);
  });

  test("25% or more is High when the name agrees and Medium when it does not", () => {
    expect(
      classifiedAs("contact_email", emailsAmong(1, 4), "email-address"),
    ).toMatchObject({
      confidence: H,
      matchRatio: 0.25,
      nameHinted: true,
    });
    expect(
      classifiedAs("reference", emailsAmong(1, 4), "email-address"),
    ).toMatchObject({
      confidence: M,
      matchRatio: 0.25,
    });
    expect(
      classifiedAs("reference", emailsAmong(5, 10), "email-address")
        ?.confidence,
    ).toBe(M);
  });

  test("a few is Medium when the name agrees and Low when it does not", () => {
    expect(
      classifiedAs("contact_email", emailsAmong(1, 10), "email-address")
        ?.confidence,
    ).toBe(M);
    expect(
      classifiedAs("reference", emailsAmong(1, 10), "email-address"),
    ).toMatchObject({
      confidence: L,
      matchRatio: 0.1,
      matchCount: 1,
    });
  });

  test("counts a value once however many matches it holds", () => {
    expect(
      classifiedAs(
        "reference",
        ["a@acme.io b@acme.io c@acme.io", "none", "none", "none"],
        "email-address",
      ),
    ).toMatchObject({
      matchCount: 3,
      valuesWithMatch: 1,
      matchRatio: 0.25,
      distinctValues: 3,
    });
  });

  test("finds nothing in a field with no values", () => {
    expect(classifyField("email", [])).toEqual([]);
    expect(classifyField("email", [null, undefined, "", "   ", true])).toEqual(
      [],
    );
  });
});

describe("free text", () => {
  const sentence: string =
    "The customer called about a delayed parcel and asked us to call back after five in the evening. ";

  test("keeps the confidence each match earned on its own", () => {
    const withContext: FieldClassification | undefined = classifiedAs(
      "description",
      [`${sentence}Paid by card number ${CARD} yesterday.`, sentence, sentence],
      "credit-card-number",
    );

    expect(withContext).toMatchObject({
      confidence: H,
      isFreeText: true,
      valuesWithMatch: 1,
    });
    expect(withContext!.matchRatio).toBeCloseTo(1 / 3);

    // Every value holds one, but free text is not judged by its share.
    expect(
      classifiedAs(
        "description",
        [`${sentence}Ref ${CARD}.`],
        "credit-card-number",
      ),
    ).toMatchObject({ confidence: M, isFreeText: true, matchRatio: 1 });
  });

  test("is not read by shape: a long note is not a CVV however its field is named", () => {
    expect(
      classifiedAs("cvv", [`${sentence}123`], "card-verification-code"),
    ).toBeUndefined();
  });
});

describe("types found from names", () => {
  test("a first-name column of plausible names is a person's name, High", () => {
    const result: FieldClassification | undefined = classifiedAs(
      "first_name",
      ["Jane", "José", "O'Brien", "Mary-Ann", "Jane"],
      "person-name",
    );

    expect(result).toMatchObject({
      confidence: H,
      matchCount: 5,
      valuesWithMatch: 5,
      matchRatio: 1,
      distinctValues: 4,
      nameHinted: true,
      foundByName: true,
      testValueCount: 0,
    });
    expect(result!.maskedSamples).toEqual(["J****", "O****", "M****"]);
  });

  test("is Medium when most values are not plausible, and absent when none is", () => {
    expect(
      classifiedAs("last_name", ["Smith", "1234", "5678"], "person-name"),
    ).toMatchObject({ confidence: M, matchCount: 1 });
    expect(
      classifiedAs("last_name", ["1234", "5678"], "person-name"),
    ).toBeUndefined();
  });

  test("a gender column of what forms offer is High; codes that are not genders are not", () => {
    expect(
      classifiedAs(
        "gender",
        ["F", "M", "non-binary", "Prefer not to say"],
        "gender",
      ),
    ).toMatchObject({ confidence: H, matchCount: 4 });
    expect(classifiedAs("gender", ["1", "2", "3"], "gender")).toBeUndefined();
  });

  test("a type with no value shape is Medium from its name alone", () => {
    expect(
      classifiedAs("religion", ["a", "b"], "religious-belief"),
    ).toMatchObject({
      confidence: M,
      foundByName: true,
      matchCount: 2,
    });
  });

  test("needs the name: the same values in another field are nothing", () => {
    expect(
      classifiedAs("status", ["Jane", "Mary-Ann"], "person-name"),
    ).toBeUndefined();
  });
});

describe("shapes in a field named for a type", () => {
  test("a cvv column of three-digit numbers is card security codes", () => {
    expect(
      classifiedAs(
        "cvv",
        ["123", "456", 789, "1234"],
        "card-verification-code",
      ),
    ).toMatchObject({
      confidence: H,
      matchCount: 4,
      valuesWithMatch: 4,
      nameHinted: true,
    });
  });

  test("the shape must fit the whole value", () => {
    expect(
      classifiedAs("cvv", ["12", "abc", "12345"], "card-verification-code"),
    ).toBeUndefined();
  });

  test("the same numbers in a field not named for a type are nothing", () => {
    expect(
      classifiedAs("quantity", ["123", "456"], "card-verification-code"),
    ).toBeUndefined();
  });
});

describe("test values", () => {
  test("a column of test cards has no matches, only test values, each counted once", () => {
    expect(
      classifiedAs(
        "card_number",
        ["4242424242424242", "4111111111111111", "4242 4242 4242 4242"],
        "credit-card-number",
      ),
    ).toMatchObject({
      matchCount: 0,
      testValueCount: 3,
      valuesWithMatch: 0,
      matchRatio: 0,
      confidence: L,
      maskedSamples: [],
    });
  });

  test("real values among test ones are judged by their own share", () => {
    expect(
      classifiedAs(
        "card_number",
        [CARD, "4242424242424242", "4111111111111111", "5555555555554444"],
        "credit-card-number",
      ),
    ).toMatchObject({
      matchCount: 1,
      testValueCount: 3,
      matchRatio: 0.25,
      confidence: H,
      maskedSamples: ["**** **** **** 6467"],
    });
  });

  test("documentation emails in an email column count apart", () => {
    expect(
      classifiedAs(
        "email",
        ["a@example.com", "b@example.org", "c@acme.io"],
        "email-address",
      ),
    ).toMatchObject({ matchCount: 1, testValueCount: 2 });
  });
});

describe("disabled types", () => {
  test("are not found, and their name hints are dropped", () => {
    const disabled: Set<string> = new Set(["email-address", "person-name"]);

    expect(
      classifiedAs("email", ["jane.doe@acme.io"], "email-address", {
        disabledDataTypeIds: disabled,
      }),
    ).toBeUndefined();
    expect(
      classifiedAs("first_name", ["Jane"], "person-name", {
        disabledDataTypeIds: disabled,
      }),
    ).toBeUndefined();
  });

  test("take their shapes and their context with them", () => {
    const disabled: Set<string> = new Set([
      "card-verification-code",
      "us-bank-routing-number",
    ]);

    expect(
      classifiedAs("routing_number", ["021000021"], "us-bank-routing-number"),
    ).toMatchObject({
      confidence: H,
    });
    expect(
      classifiedAs("routing_number", ["021000021"], "us-bank-routing-number", {
        disabledDataTypeIds: disabled,
      }),
    ).toBeUndefined();
    expect(
      classifiedAs("cvv", ["123"], "card-verification-code", {
        disabledDataTypeIds: disabled,
      }),
    ).toBeUndefined();
  });
});

describe("values of every kind", () => {
  test("toScannableValue turns each into text, or into nothing to classify", () => {
    expect(toScannableValue(null)).toBeNull();
    expect(toScannableValue(undefined)).toBeNull();
    expect(toScannableValue(true)).toBeNull();
    expect(toScannableValue(false)).toBeNull();
    expect(toScannableValue(4539148803436467)).toBe("4539148803436467");
    expect(toScannableValue(12.5)).toBe("12.5");
    expect(toScannableValue(BigInt("4539148803436467"))).toBe(
      "4539148803436467",
    );
    expect(toScannableValue("  padded  ")).toBe("padded");
    expect(toScannableValue("   ")).toBeNull();
    expect(toScannableValue(new Date(Date.UTC(1985, 2, 12)))).toBe(
      "1985-03-12T00:00:00.000Z",
    );
    expect(toScannableValue({ a: { b: "jane@acme.io" } })).toBe(
      '{"a":{"b":"jane@acme.io"}}',
    );
    expect(toScannableValue(["x"])).toBe('["x"]');
    expect(toScannableValue({})).toBeNull();
    expect(toScannableValue([])).toBeNull();
    expect(
      toScannableValue("x".repeat(MAX_FIELD_VALUE_LENGTH + 10)),
    ).toHaveLength(MAX_FIELD_VALUE_LENGTH);
  });

  test("toScannableValue gives nothing for a value JSON cannot write", () => {
    const circular: Record<string, unknown> = { name: "loop" };

    circular["self"] = circular;

    expect(toScannableValue(circular)).toBeNull();
    expect(
      toScannableValue({
        toJSON: (): undefined => {
          return undefined;
        },
      }),
    ).toBeNull();
  });

  test("a field of mixed values counts only those with something in them", () => {
    expect(
      classifiedAs(
        "contact",
        [
          { email: "jane.doe@acme.io" },
          ["john@acme.io"],
          null,
          true,
          undefined,
          "",
          4242,
          new Date(Date.UTC(2026, 9, 27)),
        ],
        "email-address",
      ),
    ).toMatchObject({ matchCount: 2, valueCount: 4, matchRatio: 0.5 });
  });

  test("numbers in a card column are read as their digits", () => {
    expect(
      classifiedAs("card_number", [4539148803436467], "credit-card-number"),
    ).toMatchObject({
      matchCount: 1,
      confidence: H,
    });
  });
});

describe("caps", () => {
  test(`reads at most MAX_FIELD_VALUES (${MAX_FIELD_VALUES}) values of a field`, () => {
    const values: Array<string> = [
      ...new Array<string>(MAX_FIELD_VALUES).fill("none"),
      ...emailsAmong(200, 200),
    ];

    expect(classifyField("reference", values)).toEqual([]);
    expect(
      classifiedAs("reference", ["jane@acme.io", ...values], "email-address"),
    ).toMatchObject({ valueCount: MAX_FIELD_VALUES, matchCount: 1 });
  });

  test("skips empty values before the cap, so they do not use it up", () => {
    expect(
      classifiedAs(
        "reference",
        [...new Array<null>(MAX_FIELD_VALUES * 2).fill(null), "jane@acme.io"],
        "email-address",
      ),
    ).toMatchObject({ valueCount: 1, matchCount: 1 });
  });

  test(`reads at most MAX_FIELD_VALUE_LENGTH (${MAX_FIELD_VALUE_LENGTH}) characters of a value`, () => {
    const early: string = "jane@acme.io " + "x ".repeat(MAX_FIELD_VALUE_LENGTH);
    const late: string = "x ".repeat(MAX_FIELD_VALUE_LENGTH) + "jane@acme.io";

    expect(classifiedAs("notes", [early], "email-address")?.matchCount).toBe(1);
    expect(classifiedAs("notes", [late], "email-address")).toBeUndefined();
  });
});

describe("a project's own types", () => {
  test("are hinted by the names the project gave them", () => {
    const employeeId: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:employee-id",
      pattern: "[0-9]{6}",
      keywords: ["employee"],
      requiresKeyword: true,
    })!;
    const options: Parameters<typeof classifyField>[2] = {
      detectors: [employeeId],
      extraHints: [
        { dataTypeId: "custom:employee-id", hints: ["staff number"] },
      ],
    };

    // The field's name stands in for the keyword the type requires.
    expect(
      classifiedAs(
        "staffNumber",
        ["104233", "104234"],
        "custom:employee-id",
        options,
      ),
    ).toMatchObject({ confidence: H, matchCount: 2, nameHinted: true });
    expect(
      classifiedAs(
        "reference",
        ["104233", "104234"],
        "custom:employee-id",
        options,
      ),
    ).toBeUndefined();
  });
});

describe("the shapes a field is read by", () => {
  const employeeId: ScanDetector = compileCustomDataType({
    dataTypeId: "custom:employee-id",
    pattern: "EMP-[0-9]{6}",
  })!;

  test("come from the detectors the scan runs, so none is counted twice", () => {
    const detectors: Array<ScanDetector> = [...BUILT_IN_DETECTORS, employeeId];

    expect(
      classifiedAs(
        "card_number",
        ["4242424242424242", "4111111111111111", "5555555555554444"],
        "credit-card-number",
        { detectors },
      ),
    ).toMatchObject({ matchCount: 0, testValueCount: 3 });
    expect(
      classifiedAs("cvv", ["123", "456"], "card-verification-code", {
        detectors,
      }),
    ).toMatchObject({ matchCount: 2, valuesWithMatch: 2, confidence: H });
  });

  test("are only those of the given detectors when a list is given", () => {
    expect(
      classifiedAs("cvv", ["123", "456"], "card-verification-code", {
        detectors: CONTACT_DETECTORS,
      }),
    ).toBeUndefined();
    expect(
      classifiedAs("cvv", ["123", "456"], "card-verification-code"),
    ).toMatchObject({
      matchCount: 2,
    });
  });

  test("include a given detector's own shape, for a field its hints name", () => {
    const badge: DataTypeDetector = {
      dataTypeId: "custom:badge",
      pattern: /(?<![A-Z0-9])B-[0-9]{4}(?![0-9])/g,
      confidenceWithoutContext: L,
      specificity: 1,
      fieldValuePattern: /^[0-9]{4}$/,
    };

    expect(
      classifiedAs("badge_number", ["1234", "5678", "B-9012"], "custom:badge", {
        detectors: [...BUILT_IN_DETECTORS, badge],
        extraHints: [{ dataTypeId: "custom:badge", hints: ["badge number"] }],
      }),
    ).toMatchObject({
      matchCount: 3,
      valuesWithMatch: 3,
      confidence: H,
      nameHinted: true,
    });
    expect(
      classifiedAs("reference", ["1234", "5678"], "custom:badge", {
        detectors: [...BUILT_IN_DETECTORS, badge],
      }),
    ).toBeUndefined();
  });
});
