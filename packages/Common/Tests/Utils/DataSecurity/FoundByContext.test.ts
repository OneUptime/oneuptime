import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import { compileCustomDataType } from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import BUILT_IN_DETECTORS from "../../../Utils/DataSecurity/Detectors/Index";
import {
  classifyField,
  FieldClassification,
} from "../../../Utils/DataSecurity/FieldClassifier";
import {
  DataTypeTally,
  FindingTally,
} from "../../../Utils/DataSecurity/FindingTally";
import {
  findSensitiveValues,
  resolveOverlaps,
  ScanDetector,
  TextMatch,
  WINDOW_SIZE,
} from "../../../Utils/DataSecurity/TextScanner";

/*
 * HOW A FINDING SAYS IT WAS FOUND ONLY WITH WHAT IS AROUND IT (#11502).
 *
 * Some values are of their type only beside a word that names it, or under
 * a field whose name does: a US ZIP code beside "zip", a lone coordinate
 * beside "lat", nine digits beside "ITIN", a whole "123" under `cvv`. The
 * Custom Regex rule Scrub It makes for such a type is made of the type's
 * detectors that need no context, so it keeps those values - and Data
 * Security's coverage must not count it for a finding that holds one. So
 * the scanner says which of its matches it found so (TextMatch's
 * fromContext), a tally counts them (contextMatchCount), and a field's
 * classification says some were (foundByContext), which the finding keeps
 * (DataStoreFinding's isFoundByContext).
 * ---------------------------------------------------------------------------
 */

const M: DataConfidence = DataConfidence.Medium;

// Passes Luhn: a card number of no one.
const CARD: string = "4539148803436467";

function matchesIn(
  text: string,
  options: Parameters<typeof findSensitiveValues>[1] = {},
): Array<{ dataTypeId: string; value: string; fromContext: boolean }> {
  return findSensitiveValues(text, options).map(
    (
      match: TextMatch,
    ): { dataTypeId: string; value: string; fromContext: boolean } => {
      return {
        dataTypeId: match.dataTypeId,
        value: text.slice(match.start, match.end),
        fromContext: match.fromContext === true,
      };
    },
  );
}

function classifiedAs(
  fieldPath: string,
  values: ReadonlyArray<unknown>,
  dataTypeId: string,
  options: Parameters<typeof classifyField>[2] = {},
): FieldClassification {
  const found: FieldClassification | undefined = classifyField(
    fieldPath,
    values,
    options,
  ).find((classification: FieldClassification): boolean => {
    return classification.dataTypeId === dataTypeId;
  });

  if (!found) {
    throw new Error(`${fieldPath} was not classified as ${dataTypeId}.`);
  }

  return found;
}

// A type of six digits, one only beside "code", and one of its tags that needs no word.
const CODE_WITH_ITS_WORD: DataTypeDetector = {
  dataTypeId: "test-code",
  pattern: /(?<![0-9])[0-9]{6}(?![0-9])/g,
  keywords: ["code"],
  requiresContext: true,
  confidenceWithoutContext: M,
  specificity: 1,
  isTestValue: (normalized: string): boolean => {
    return normalized === "000000";
  },
};

const TAG_ALONE: DataTypeDetector = {
  dataTypeId: "test-code",
  pattern: /(?<![A-Za-z0-9])TAG-[0-9]{4}(?![0-9])/g,
  keywords: ["code"],
  confidenceWithoutContext: M,
  specificity: 2,
};

describe("the scanner says which values it found only with what is around them", () => {
  test.each([
    ["a US ZIP code beside its word", "ship to zip 94107 today", "postal-code", "94107", true],
    ["a ZIP+4 beside its word", "zip code: 94107-1234.", "postal-code", "94107-1234", true],
    ["a UK postcode, by its shape alone", "ship to SW1A 2AA today", "postal-code", "SW1A 2AA", false],
    ["a Canadian postal code, by its shape alone", "mail to K1A 0B1 now", "postal-code", "K1A 0B1", false],
    ["one coordinate beside its word", "lat 37.77493 ok", "geolocation", "37.77493", true],
    ["a pair of coordinates, by its shape alone", "at 37.77493, -122.41942 ok", "geolocation", "37.77493, -122.41942", false],
    ["an ITIN as nine bare digits beside its word", "ITIN 912701234 on file", "us-itin", "912701234", true],
    ["an ITIN in its groups, by its shape alone", "file 912-70-1234 today", "us-itin", "912-70-1234", false],
    ["a national phone number in its groups beside its word", "tel 03-1234-5678 ok", "phone-number", "03-1234-5678", true],
    ["a card security code after its word, which its own pattern reads", "paid, cvv 123 accepted", "card-verification-code", "123", false],
    ["an email address", "write to maria.gonzalez@acme.io today", "email-address", "maria.gonzalez@acme.io", false],
    ["a card number", `card ${CARD} declined`, "credit-card-number", CARD, false],
  ])(
    "%s: %s",
    (
      _label: string,
      text: string,
      dataTypeId: string,
      value: string,
      fromContext: boolean,
    ) => {
      expect(
        matchesIn(text).filter(
          (match: { dataTypeId: string }): boolean => {
            return match.dataTypeId === dataTypeId;
          },
        ),
      ).toEqual([{ dataTypeId, value, fromContext }]);
    },
  );

  test("a value found only so is never marked otherwise, and the flag is left out of one that is not", () => {
    const [byWord] = findSensitiveValues("zip 94107");
    const [byShape] = findSensitiveValues("SW1A 2AA");

    expect(byWord!.fromContext).toBe(true);
    // Left out, as fromModel is: a match carries only what is so.
    expect(byShape).not.toHaveProperty("fromContext");
  });

  test("a value under a field whose name names its type is found by the name, and marked as found so", () => {
    expect(
      matchesIn("94107", { hintedDataTypeIds: new Set(["postal-code"]) }),
    ).toEqual([
      { dataTypeId: "postal-code", value: "94107", fromContext: true },
    ]);
    expect(
      matchesIn("-122.41942", { hintedDataTypeIds: new Set(["geolocation"]) }),
    ).toEqual([
      { dataTypeId: "geolocation", value: "-122.41942", fromContext: true },
    ]);
    // With no name for it, the digits are no type's.
    expect(matchesIn("94107")).toEqual([]);
  });

  test("a detector that needs its word marks every match it makes; one that does not, none", () => {
    expect(
      matchesIn("code 123456, then TAG-1234", {
        detectors: [CODE_WITH_ITS_WORD, TAG_ALONE],
      }),
    ).toEqual([
      { dataTypeId: "test-code", value: "123456", fromContext: true },
      { dataTypeId: "test-code", value: "TAG-1234", fromContext: false },
    ]);
    // Without its word the six digits are not found at all.
    expect(
      matchesIn("ref 123456, then TAG-1234", {
        detectors: [CODE_WITH_ITS_WORD, TAG_ALONE],
      }),
    ).toEqual([
      { dataTypeId: "test-code", value: "TAG-1234", fromContext: false },
    ]);
  });

  test("a project's own type that needs its keyword marks its matches too", () => {
    const needsWord: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:member",
      pattern: "M-[0-9]{6}",
      keywords: ["member"],
      requiresKeyword: true,
    })!;
    const alone: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:badge",
      pattern: "B-[0-9]{6}",
    })!;

    expect(
      matchesIn("member M-123456 has badge B-654321", {
        detectors: [needsWord, alone],
      }),
    ).toEqual([
      { dataTypeId: "custom:member", value: "M-123456", fromContext: true },
      { dataTypeId: "custom:badge", value: "B-654321", fromContext: false },
    ]);
  });

  test("where a value found by its word and one found by its shape claim the same characters, the one kept says how it was found", () => {
    // A pair beside "lat": the pair is surer and longer, and its own pattern hides it.
    expect(matchesIn("lat 37.77493, -122.41942 ok")).toEqual([
      {
        dataTypeId: "geolocation",
        value: "37.77493, -122.41942",
        fromContext: false,
      },
    ]);

    const base: Omit<TextMatch, "start" | "end"> = {
      dataTypeId: "geolocation",
      normalized: "37.77493",
      confidence: M,
      isTestValue: false,
    };

    // The context one is surer: it wins, and keeps its mark.
    expect(
      resolveOverlaps([
        { ...base, start: 0, end: 20, score: 210 },
        { ...base, start: 0, end: 8, score: 311, fromContext: true },
      ]),
    ).toEqual([{ ...base, start: 0, end: 8, fromContext: true }]);
    // The shape one is surer: it wins, unmarked.
    expect(
      resolveOverlaps([
        { ...base, start: 0, end: 8, score: 210, fromContext: true },
        { ...base, start: 0, end: 20, score: 311 },
      ]),
    ).toEqual([{ ...base, start: 0, end: 20 }]);
    // Apart, each keeps its own.
    expect(
      resolveOverlaps([
        { ...base, start: 0, end: 8, score: 210, fromContext: true },
        { ...base, start: 30, end: 50, score: 311 },
      ]),
    ).toEqual([
      { ...base, start: 0, end: 8, fromContext: true },
      { ...base, start: 30, end: 50 },
    ]);
  });

  test("a value past the first window of a long text keeps its mark", () => {
    const padding: string = "lorem ipsum ".repeat(
      Math.ceil((WINDOW_SIZE * 1.5) / 12),
    );
    const text: string = `${padding}ship to zip 94107 today ${padding}SW1A 2AA`;

    expect(matchesIn(text)).toEqual([
      { dataTypeId: "postal-code", value: "94107", fromContext: true },
      { dataTypeId: "postal-code", value: "SW1A 2AA", fromContext: false },
    ]);
  });

  test("the types #11502 is about each have a built-in detector that needs its word", () => {
    const needsWord: Array<string> = BUILT_IN_DETECTORS.filter(
      (detector: DataTypeDetector): boolean => {
        return Boolean(detector.requiresContext);
      },
    ).map((detector: DataTypeDetector): string => {
      return detector.dataTypeId;
    });

    for (const dataTypeId of [
      "postal-code",
      "geolocation",
      "us-itin",
      "phone-number",
      "us-ssn",
    ]) {
      expect(needsWord).toContain(dataTypeId);
    }
  });
});

describe("a tally counts the values found only with what is around them", () => {
  test("of its real matches, those found so", () => {
    const tally: DataTypeTally = new DataTypeTally("postal-code");

    tally.add({
      normalized: "94107",
      confidence: M,
      isTestValue: false,
      fromContext: true,
    });
    tally.add({ normalized: "SW1A2AA", confidence: M, isTestValue: false });
    tally.add({
      normalized: "60614",
      confidence: M,
      isTestValue: false,
      fromContext: false,
    });
    tally.add({
      normalized: "94107",
      confidence: M,
      isTestValue: false,
      fromContext: true,
    });

    expect(tally.matchCount).toBe(4);
    expect(tally.contextMatchCount).toBe(2);
  });

  test("a test value is never one, found so or not", () => {
    const tally: DataTypeTally = new DataTypeTally("test-code");

    tally.add({
      normalized: "000000",
      confidence: M,
      isTestValue: true,
      fromContext: true,
    });

    expect(tally.testValueCount).toBe(1);
    expect(tally.matchCount).toBe(0);
    expect(tally.contextMatchCount).toBe(0);
  });

  test("a finding's tallies pass it to the type's, and its JSON is the tally's as it was", () => {
    const tallies: FindingTally = new FindingTally();

    tallies.add({
      dataTypeId: "postal-code",
      normalized: "94107",
      confidence: M,
      isTestValue: false,
      fromContext: true,
    });
    tallies.add({
      dataTypeId: "email-address",
      normalized: "maria.gonzalez@acme.io",
      confidence: M,
      isTestValue: false,
    });

    expect(tallies.get("postal-code")!.contextMatchCount).toBe(1);
    expect(tallies.get("email-address")!.contextMatchCount).toBe(0);
    // How a finding was found is the classification's to say, not the tally's JSON.
    expect(Object.keys(tallies.get("postal-code")!.toJSON()).sort()).toEqual([
      "confidence",
      "dataTypeId",
      "distinctValues",
      "distinctValuesCapped",
      "maskedSamples",
      "matchCount",
      "testValueCount",
    ]);
  });
});

describe("a field's classification says some of its values were found only with what is around them", () => {
  test("ZIP codes under a field named for them", () => {
    expect(
      classifiedAs("address.zip", ["94107", "10001", "60614"], "postal-code")
        .foundByContext,
    ).toBe(true);
  });

  test("a ZIP code beside its word in a field of text", () => {
    expect(
      classifiedAs(
        "message",
        [
          "Order 1182 shipped to zip 94107 on Monday.",
          "Order 1183 is still waiting at the warehouse.",
        ],
        "postal-code",
      ).foundByContext,
    ).toBe(true);
  });

  test("one coordinate under a field named for it, a number as the field sends it", () => {
    expect(
      classifiedAs("location.lat", [37.77493, 51.50722, -33.86882], "geolocation")
        .foundByContext,
    ).toBe(true);
  });

  test("a whole value of its type's shape under a field named for it: a card security code under cvv", () => {
    expect(
      classifiedAs("payment.cvv", ["123", "4567", "321"], "card-verification-code")
        .foundByContext,
    ).toBe(true);
  });

  test("one value found so among many found by their shape is enough", () => {
    const classification: FieldClassification = classifiedAs(
      "notes",
      [
        "Return to SW1A 2AA.",
        "Return to EC1A 1BB.",
        "Return to M1 1AE.",
        "Or to zip 94107.",
      ],
      "postal-code",
    );

    expect(classification.matchCount).toBe(4);
    expect(classification.foundByContext).toBe(true);
  });

  test.each([
    ["UK postcodes under a field named for them", "address.postcode", ["SW1A 2AA", "EC1A 1BB", "M1 1AE"], "postal-code"],
    ["pairs of coordinates", "location", ["37.77493, -122.41942", "51.50722, -0.12750"], "geolocation"],
    ["a card security code after its word, in text", "message", ["paid, cvv 123 accepted", "paid, cvc 456 accepted"], "card-verification-code"],
    ["card numbers under a field named for them, whose type takes a shape there too", "payment.card_number", [CARD, CARD], "credit-card-number"],
    ["email addresses", "user.email", ["maria.gonzalez@acme.io", "wei.chen@acme.io"], "email-address"],
  ])(
    "says nothing of it when every value was found by its shape: %s",
    (
      _label: string,
      fieldPath: string,
      values: Array<string>,
      dataTypeId: string,
    ) => {
      const classification: FieldClassification = classifiedAs(
        fieldPath,
        values,
        dataTypeId,
      );

      expect(classification.matchCount).toBeGreaterThan(0);
      // Left out, never false: as classifyField writes foundByModel.
      expect(classification).not.toHaveProperty("foundByContext");
    },
  );

  test("a test value found by its word marks nothing: it is never a finding's value", () => {
    const classification: FieldClassification = classifiedAs(
      "notes",
      ["code 000000"],
      "test-code",
      { detectors: [CODE_WITH_ITS_WORD] },
    );

    expect(classification.testValueCount).toBe(1);
    expect(classification.matchCount).toBe(0);
    expect(classification).not.toHaveProperty("foundByContext");
  });

  test("a field of free text reads no whole value by its shape, but a value beside its word still says so", () => {
    const longText: string = `${"The parcel left the depot and is on its way. ".repeat(3)}`;

    // Free text: a "123" alone under cvv is no shape match.
    expect(
      classifyField("payment.cvv", [`${longText}123`]).find(
        (classification: FieldClassification): boolean => {
          return classification.dataTypeId === "card-verification-code";
        },
      ),
    ).toBeUndefined();
    expect(
      classifiedAs("message", [`${longText}Deliver to zip 94107.`], "postal-code")
        .foundByContext,
    ).toBe(true);
  });
});
