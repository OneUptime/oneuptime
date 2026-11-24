import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  classifyField,
  FieldClassification,
  getValuesForModel,
  isFreeTextValues,
  isReadByModel,
  readScannableValues,
} from "../../../Utils/DataSecurity/FieldClassifier";
import {
  ModelRecognitions,
  RecognizedEntity,
} from "../../../Utils/DataSecurity/Model/RecognizedEntity";

/*
 * A field's values and what the names-and-addresses model found in them.
 * The model reads a free-text field's values - and a log body's, a message's
 * or a prompt's however short - and its findings count like any match,
 * keeping the confidence each earned on its own.
 */

const SENTENCE: string =
  "Refund approved for Maria Gonzalez, 14 Calle Mayor, Madrid";

// What a model would find, phrase by phrase, in whatever it is asked about.
function recognitionsOf(
  phrases: Array<[string, RecognizedEntity["dataTypeId"], number?]>,
): ModelRecognitions & { asked: Array<string> } {
  const asked: Array<string> = [];

  return {
    asked,
    get(text: string): ReadonlyArray<RecognizedEntity> | undefined {
      asked.push(text);

      const found: Array<RecognizedEntity> = [];

      for (const [phrase, dataTypeId, score] of phrases) {
        const start: number = text.indexOf(phrase);

        if (start >= 0) {
          found.push({
            dataTypeId,
            start,
            end: start + phrase.length,
            score: score ?? 0.95,
          });
        }
      }

      return found;
    },
  };
}

const ISSUE: Array<[string, RecognizedEntity["dataTypeId"], number?]> = [
  ["Maria Gonzalez", "person-name"],
  ["14 Calle Mayor", "postal-address"],
];

function supportNote(index: number): string {
  return `Support note ${index}: the customer asked about the delivery window and was told it would be tomorrow morning.`;
}

function byType(
  classifications: Array<FieldClassification>,
): Record<string, FieldClassification> {
  return Object.fromEntries(
    classifications.map((classification: FieldClassification) => {
      return [classification.dataTypeId, classification];
    }),
  );
}

describe("classifyField with the model's recognitions", () => {
  test("the issue's sentence in a free-text column is a person name and a street address, Medium, masked, found by the model", () => {
    const values: Array<string> = [supportNote(1), SENTENCE, supportNote(2)];
    const found: Record<string, FieldClassification> = byType(
      classifyField("public.tickets.notes", values, {
        recognitions: recognitionsOf(ISSUE),
      }),
    );

    expect(found["person-name"]).toEqual(
      expect.objectContaining({
        matchCount: 1,
        valuesWithMatch: 1,
        valueCount: 3,
        confidence: DataConfidence.Medium,
        maskedSamples: ["M****"],
        isFreeText: true,
        foundByModel: true,
        foundByName: false,
      }),
    );
    expect(found["postal-address"]).toEqual(
      expect.objectContaining({
        matchCount: 1,
        confidence: DataConfidence.Medium,
        maskedSamples: ["1****"],
        foundByModel: true,
      }),
    );
  });

  test("without recognitions the same column holds no name, as before the model", () => {
    const values: Array<string> = [supportNote(1), SENTENCE, supportNote(2)];
    const found: Record<string, FieldClassification> = byType(
      classifyField("public.tickets.notes", values),
    );

    expect(found["person-name"]).toBeUndefined();
    expect(found["postal-address"]).toBeUndefined();
  });

  test("a field that is not free text is not looked up at all", () => {
    const recognitions: ReturnType<typeof recognitionsOf> =
      recognitionsOf(ISSUE);

    classifyField("public.orders.status", ["Maria Gonzalez", "shipped"], {
      recognitions,
    });
    expect(recognitions.asked).toEqual([]);
  });

  test("a log body is read however short, and a name in one of many lines keeps its Medium", () => {
    const values: Array<string> = [
      SENTENCE,
      ...Array.from({ length: 199 }, (_: unknown, index: number): string => {
        return `GET /health 200 ${index}ms`;
      }),
    ];
    const found: Record<string, FieldClassification> = byType(
      classifyField("body", values, {
        recognitions: recognitionsOf(ISSUE),
        readWithModel: true,
      }),
    );

    expect(found["person-name"]?.confidence).toBe(DataConfidence.Medium);
    expect(found["person-name"]?.isFreeText).toBe(false);
    expect(found["person-name"]?.matchRatio).toBeCloseTo(1 / 200);
    expect(found["postal-address"]?.confidence).toBe(DataConfidence.Medium);
  });

  test("the same short body without readWithModel is left to the detectors", () => {
    const recognitions: ReturnType<typeof recognitionsOf> =
      recognitionsOf(ISSUE);

    expect(
      byType(classifyField("body", [SENTENCE, "ok"], { recognitions }))[
        "person-name"
      ],
    ).toBeUndefined();
    expect(recognitions.asked).toEqual([]);
  });

  test("High when the field's name says it holds names", () => {
    const values: Array<string> = [
      `${SENTENCE}. ${supportNote(1)}`,
      supportNote(2),
    ];
    const found: Record<string, FieldClassification> = byType(
      classifyField("customer_name_notes", values, {
        recognitions: recognitionsOf(ISSUE),
      }),
    );

    expect(found["person-name"]?.nameHinted).toBe(true);
    expect(found["person-name"]?.confidence).toBe(DataConfidence.High);
  });

  test("Low when the model is unsure of every name it found", () => {
    const found: Record<string, FieldClassification> = byType(
      classifyField("notes", [supportNote(1), SENTENCE], {
        recognitions: recognitionsOf([["Maria Gonzalez", "person-name", 0.41]]),
      }),
    );

    expect(found["person-name"]?.confidence).toBe(DataConfidence.Low);
  });

  test("test values are counted apart and never sampled", () => {
    const found: Record<string, FieldClassification> = byType(
      classifyField(
        "notes",
        [
          `Refund approved for Jane Doe, 123 Main Street. ${supportNote(1)}`,
          supportNote(2),
        ],
        {
          recognitions: recognitionsOf([
            ["Jane Doe", "person-name"],
            ["123 Main Street", "postal-address"],
          ]),
        },
      ),
    );

    expect(found["person-name"]).toEqual(
      expect.objectContaining({
        matchCount: 0,
        testValueCount: 1,
        maskedSamples: [],
      }),
    );
    expect(found["postal-address"]?.testValueCount).toBeGreaterThanOrEqual(1);
  });

  test("the model's matches never name a value's record when no value held a real one", () => {
    const found: Record<string, FieldClassification> = byType(
      classifyField(
        "notes",
        [`Jane Doe asked. ${supportNote(1)}`, supportNote(2)],
        {
          recognitions: recognitionsOf([["Jane Doe", "person-name"]]),
          maxMatchedValueIndexes: 3,
        },
      ),
    );

    expect(found["person-name"]?.matchedValueIndexes).toEqual([]);
  });

  test("names the records of the values the model found a real name in", () => {
    const found: Record<string, FieldClassification> = byType(
      classifyField("notes", [supportNote(1), null, SENTENCE, supportNote(2)], {
        recognitions: recognitionsOf(ISSUE),
        maxMatchedValueIndexes: 3,
      }),
    );

    expect(found["person-name"]?.matchedValueIndexes).toEqual([2]);
  });

  test("a value the model did not read (its time ran out) is classified without it", () => {
    const recognitions: ModelRecognitions = {
      get: (): undefined => {
        return undefined;
      },
    };

    expect(
      byType(
        classifyField("notes", [supportNote(1), SENTENCE], { recognitions }),
      )["person-name"],
    ).toBeUndefined();
  });
});

describe("the field helpers the model shares with classifyField", () => {
  test("readScannableValues skips empty values and keeps where the others were", () => {
    expect(readScannableValues(["a", null, " ", "b", 5])).toEqual({
      values: ["a", "b", "5"],
      rawIndexes: [0, 3, 4],
    });
  });

  test("free text averages more than 80 characters", () => {
    expect(isFreeTextValues(["x".repeat(81)])).toBe(true);
    expect(isFreeTextValues(["x".repeat(80)])).toBe(false);
    expect(isFreeTextValues([])).toBe(false);
    expect(isReadByModel(["short"], { readWithModel: true })).toBe(true);
    expect(isReadByModel(["short"], {})).toBe(false);
  });

  test("getValuesForModel gives a free-text field's different values in order, and none of another field's", () => {
    expect(
      getValuesForModel([supportNote(1), supportNote(1), supportNote(2)]),
    ).toEqual([supportNote(1), supportNote(2)]);
    expect(getValuesForModel(["shipped", "pending"])).toEqual([]);
    expect(getValuesForModel(["shipped"], { readWithModel: true })).toEqual([
      "shipped",
    ]);
  });
});
