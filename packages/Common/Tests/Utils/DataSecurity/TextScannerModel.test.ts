import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import { DataTypeTally } from "../../../Utils/DataSecurity/FindingTally";
import {
  isTestPersonName,
  isTestStreetAddress,
  RecognizedEntity,
  UNSURE_SCORE,
} from "../../../Utils/DataSecurity/Model/RecognizedEntity";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";

/*
 * The names-and-addresses model's findings, judged by the scanner's own
 * rules (Model/RecognizedEntity.ts): Medium on its own, High when the field's
 * name or the words around it agree, Low when the model is unsure, test
 * values counted apart, allowed values and turned-off types no finding, and
 * a contest with the detectors over the same characters like any detector's.
 */

const SENTENCE: string =
  "Refund approved for Maria Gonzalez, 14 Calle Mayor, Madrid";

function entity(
  text: string,
  value: string,
  dataTypeId: RecognizedEntity["dataTypeId"],
  score: number = 0.95,
): RecognizedEntity {
  const start: number = text.indexOf(value);

  if (start < 0) {
    throw new Error(`${value} is not in the text`);
  }

  return { dataTypeId, start, end: start + value.length, score };
}

function modelMatches(
  text: string,
  recognized: Array<RecognizedEntity>,
  options: Parameters<typeof findSensitiveValues>[1] = {},
): Array<TextMatch> {
  return findSensitiveValues(text, options, recognized).filter(
    (match: TextMatch): boolean => {
      return Boolean(match.fromModel);
    },
  );
}

describe("findSensitiveValues with the model's findings", () => {
  test("a name and a street address alone are Medium, and marked as the model's", () => {
    const matches: Array<TextMatch> = modelMatches(SENTENCE, [
      entity(SENTENCE, "Maria Gonzalez", "person-name"),
      entity(SENTENCE, "14 Calle Mayor", "postal-address"),
    ]);

    expect(matches).toEqual([
      {
        dataTypeId: "person-name",
        start: 20,
        end: 34,
        normalized: "Maria Gonzalez",
        confidence: DataConfidence.Medium,
        isTestValue: false,
        fromModel: true,
      },
      {
        dataTypeId: "postal-address",
        start: 36,
        end: 50,
        normalized: "14 Calle Mayor",
        confidence: DataConfidence.Medium,
        isTestValue: false,
        fromModel: true,
      },
    ]);
  });

  test("no finding of the model's without it", () => {
    expect(
      findSensitiveValues(SENTENCE).filter((match: TextMatch): boolean => {
        return match.dataTypeId === "person-name";
      }),
    ).toEqual([]);
  });

  test("High when the field's name says what it holds", () => {
    const [name] = modelMatches(
      SENTENCE,
      [entity(SENTENCE, "Maria Gonzalez", "person-name")],
      { hintedDataTypeIds: new Set(["person-name"]) },
    );

    expect(name?.confidence).toBe(DataConfidence.High);
  });

  test.each([
    ["Customer: Maria Gonzalez called twice", "Maria Gonzalez", "person-name"],
    ["Estimado Sr. Domínguez, gracias", "Domínguez", "person-name"],
    ["Sehr geehrter Herr Neumann, danke", "Neumann", "person-name"],
    ["Merci Madame Robin pour votre message", "Robin", "person-name"],
    ["Geachte heer Smit, bedankt", "Smit", "person-name"],
    // In lower case, so the English street pattern does not find it first.
    ["Ship to 27 orchard way, Bristol", "27 orchard way", "postal-address"],
    [
      "Dirección de envío: Calle de Toledo 42",
      "Calle de Toledo 42",
      "postal-address",
    ],
    [
      "Lieferadresse Lindenstraße 23, Berlin",
      "Lindenstraße 23",
      "postal-address",
    ],
    [
      "Adresse de livraison : 12 rue des Lilas",
      "12 rue des Lilas",
      "postal-address",
    ],
    [
      "Indirizzo: Via Garibaldi 18, Torino",
      "Via Garibaldi 18",
      "postal-address",
    ],
    ["Morada: Rua das Flores 45, Porto", "Rua das Flores 45", "postal-address"],
    ["Adres: Kerkstraat 12, Utrecht", "Kerkstraat 12", "postal-address"],
  ])(
    "High when the words around it agree: %s",
    (text: string, value: string, dataTypeId: string) => {
      const [match] = modelMatches(text, [
        entity(text, value, dataTypeId as RecognizedEntity["dataTypeId"]),
      ]);

      expect(match?.confidence).toBe(DataConfidence.High);
    },
  );

  test("a context word far from the value does not count", () => {
    const text: string = `Customer support ticket opened.${" filler".repeat(20)} Maria Gonzalez called.`;
    const [match] = modelMatches(text, [
      entity(text, "Maria Gonzalez", "person-name"),
    ]);

    expect(match?.confidence).toBe(DataConfidence.Medium);
  });

  test(`Low when the model is unsure (below ${UNSURE_SCORE}), and Medium when it is unsure but the words around it agree`, () => {
    const [unsure] = modelMatches(SENTENCE, [
      entity(SENTENCE, "Maria Gonzalez", "person-name", UNSURE_SCORE - 0.01),
    ]);
    const text: string = "Customer Maria Gonzalez called";
    const [unsureInContext] = modelMatches(text, [
      entity(text, "Maria Gonzalez", "person-name", 0.4),
    ]);
    const [sure] = modelMatches(SENTENCE, [
      entity(SENTENCE, "Maria Gonzalez", "person-name", UNSURE_SCORE),
    ]);

    expect(unsure?.confidence).toBe(DataConfidence.Low);
    expect(unsureInContext?.confidence).toBe(DataConfidence.Medium);
    expect(sure?.confidence).toBe(DataConfidence.Medium);
  });

  test("test values are counted apart: Jane Doe, John Smith, 123 Main Street", () => {
    const text: string =
      "Jane Doe and John Smith live at 123 Main Street, Springfield";
    const matches: Array<TextMatch> = modelMatches(text, [
      entity(text, "Jane Doe", "person-name"),
      entity(text, "John Smith", "person-name"),
      entity(text, "123 Main Street, Springfield", "postal-address"),
    ]);

    expect(
      matches.map((match: TextMatch): boolean => {
        return match.isTestValue;
      }),
    ).toEqual([true, true, true]);
  });

  test("a value the project says is never sensitive is no finding, in any case", () => {
    expect(
      modelMatches(
        SENTENCE,
        [entity(SENTENCE, "Maria Gonzalez", "person-name")],
        { allowedValues: new Set(["maria gonzalez"]) },
      ),
    ).toEqual([]);
  });

  test("a type the project turned off is no finding", () => {
    expect(
      modelMatches(
        SENTENCE,
        [
          entity(SENTENCE, "Maria Gonzalez", "person-name"),
          entity(SENTENCE, "14 Calle Mayor", "postal-address"),
        ],
        { disabledDataTypeIds: new Set(["person-name"]) },
      ).map((match: TextMatch): string => {
        return match.dataTypeId;
      }),
    ).toEqual(["postal-address"]);
  });

  test("an entity that does not fit the text is ignored", () => {
    expect(
      modelMatches(SENTENCE, [
        { dataTypeId: "person-name", start: -1, end: 4, score: 0.9 },
        { dataTypeId: "person-name", start: 10, end: 10, score: 0.9 },
        { dataTypeId: "person-name", start: 50, end: 500, score: 0.9 },
        { dataTypeId: "person-name", start: 1.5, end: 4, score: 0.9 },
      ]),
    ).toEqual([]);
  });

  test("spaces inside a value are collapsed in its normalized form", () => {
    const text: string = "Signed by Maria\n   Gonzalez today";
    const [match] = modelMatches(text, [
      entity(text, "Maria\n   Gonzalez", "person-name"),
    ]);

    expect(match?.normalized).toBe("Maria Gonzalez");
  });

  test("an email a detector finds keeps its characters from a name the model saw in it", () => {
    const text: string = "Contact maria.gonzalez@example.com about it";
    const matches: Array<TextMatch> = findSensitiveValues(text, {}, [
      entity(text, "maria.gonzalez", "person-name", 0.7),
    ]);

    expect(
      matches.map((match: TextMatch): string => {
        return match.dataTypeId;
      }),
    ).toEqual(["email-address"]);
  });

  test("a street address both the model and the English street pattern find is one finding", () => {
    const text: string = "Ship it to 4512 Maple Avenue today";
    const matches: Array<TextMatch> = findSensitiveValues(text, {}, [
      entity(text, "4512 Maple Avenue", "postal-address"),
    ]);

    expect(
      matches.filter((match: TextMatch): boolean => {
        return match.dataTypeId === "postal-address";
      }),
    ).toHaveLength(1);
  });
});

describe("the placeholders counted apart", () => {
  test.each([
    ["Jane Doe", true],
    ["john  smith", true],
    ["Max Mustermann", true],
    ["Juan Pérez", true],
    ["Mario Rossi", true],
    ["Maria Gonzalez", false],
    ["John Smithers", false],
  ])("%s is a test name: %s", (value: string, expected: boolean) => {
    expect(isTestPersonName(value)).toBe(expected);
  });

  test.each([
    ["123 Main Street", true],
    ["123 Main St, Springfield", true],
    ["742 Evergreen Terrace", true],
    ["Musterstraße 1, 12345 Musterstadt", true],
    ["Calle Falsa 123", true],
    ["1234 Main Street", true],
    ["123 Main Streetwise Road", false],
    ["14 Calle Mayor", false],
    ["Musterstraße 12", false],
  ])("%s is a test address: %s", (value: string, expected: boolean) => {
    expect(isTestStreetAddress(value)).toBe(expected);
  });
});

describe("a model's finding in a tally", () => {
  test("is masked as a name-found value is: its first character and a fixed mask", () => {
    const tally: DataTypeTally = new DataTypeTally("postal-address");

    tally.add({
      normalized: "14 Calle Mayor",
      raw: "14 Calle Mayor",
      confidence: DataConfidence.Medium,
      isTestValue: false,
      fromModel: true,
    });
    tally.add({
      normalized: "4512 Maple Avenue",
      raw: "4512 Maple Avenue",
      confidence: DataConfidence.Medium,
      isTestValue: false,
    });

    // The pattern's finding keeps its last characters; the model's only its first.
    expect(tally.maskedSamples).toEqual(["1****", "**** ***** **enue"]);
    expect(tally.modelMatchCount).toBe(1);
    expect(tally.matchCount).toBe(2);
  });

  test("a test value is counted apart and never sampled", () => {
    const tally: DataTypeTally = new DataTypeTally("person-name");

    tally.add({
      normalized: "Jane Doe",
      raw: "Jane Doe",
      confidence: DataConfidence.Medium,
      isTestValue: true,
      fromModel: true,
    });

    expect(tally.testValueCount).toBe(1);
    expect(tally.matchCount).toBe(0);
    expect(tally.modelMatchCount).toBe(0);
    expect(tally.maskedSamples).toEqual([]);
  });
});
