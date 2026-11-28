import { describe, expect, test } from "@jest/globals";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  compileScrubRuleCustomRegex,
  SCRUB_RULE_SENSITIVE_KEY_REGEX,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
  scrubRegExpUnderKey,
} from "../../../Types/Telemetry/ScrubRule";
import { PHONE_NUMBER_DETECTORS } from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { US_SSN_DETECTORS } from "../../../Utils/DataSecurity/Detectors/GovernmentIdDetectors";
import {
  FieldClassification,
  classifyField,
} from "../../../Utils/DataSecurity/FieldClassifier";
import {
  getHintedDataTypeIds,
  MAX_FIELD_PATH_LENGTH,
} from "../../../Utils/DataSecurity/FieldNameHints";
import {
  findDetectorRanges,
  TextRange,
} from "../../../Utils/DataSecurity/TextReadings";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import {
  compileBuiltInScrubPattern,
  findPhoneNumberRanges,
  findSsnRanges,
  getHintsOfKey,
} from "../../../Utils/Telemetry/ScrubBuiltInPatterns";
import {
  placeRangesOnStrings,
  readStoredText,
  StoredText,
  StoredTextString,
} from "../../../Utils/Telemetry/ScrubStoredText";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * ---------------------------------------------------------------------------
 * A PHONE NUMBER OR SSN RULE READS A VALUE UNDER ITS KEY AS DATA SECURITY
 * READS IT (#11383).
 *
 * Data Security finds a national phone number of 9 to 12 digits, or nine
 * digits in a row, beside a word that names it - and in a field whose name
 * names it: `user.phone` holding 02012345678, `customer.ssn` holding
 * 536221234 (the scanner's hintedDataTypeIds), and a whole value of a
 * phone's shape there (FieldClassifier's field shape). It reads a list or
 * a map as the JSON text the table stores it as, where a map's key, or a
 * word another of its values writes, sits beside a number. A rule handed
 * a value alone kept those, while Data Security's coverage said it hid
 * them.
 *
 * Here: the reading of a text as a field's value (findDetectorRanges'
 * hintedDataTypeIds), the key's hints, a list's or a map's JSON text and
 * where its texts are in it (ScrubStoredText), and each built-in pattern
 * under a key (ScrubRegExp.underKey) - what the rules hide against what
 * Data Security finds, value for value. The engines: ScrubEnginesUnderKeys.
 * ---------------------------------------------------------------------------
 */

// The texts of a text's ranges.
function textsOf(
  text: string,
  ranges: ReadonlyArray<TextRange>,
): Array<string> {
  return ranges.map(([start, end]: TextRange): string => {
    return text.slice(start, end);
  });
}

// What a pattern under a key finds in a text the key holds.
function foundUnder(
  regex: ScrubRegExp,
  key: string,
  value: string,
): Array<string> {
  return textsOf(
    value,
    scrubRegExpUnderKey(regex, key, value).matchRanges(value),
  );
}

const PHONE: ScrubRegExp = compileBuiltInScrubPattern(
  LogScrubPatternType.PhoneNumber,
)!;
const SSN: ScrubRegExp = compileBuiltInScrubPattern(LogScrubPatternType.SSN)!;

// The type a pattern of each of the two finds.
const DATA_TYPE_OF: Readonly<Record<string, string>> = {
  [LogScrubPatternType.PhoneNumber]: "phone-number",
  [LogScrubPatternType.SSN]: "us-ssn",
};

/*
 * What Data Security finds of a type in one value of a field, where it
 * finds it: the scanner's matches with the field's name for the words
 * (hintedDataTypeIds), and the whole value when only the field's shape
 * says it holds the type (FieldClassifier) - each [start, end) of the
 * value as written.
 */
function dataSecurityFinds(
  fieldPath: string,
  value: string,
  dataTypeId: string,
): Array<TextRange> {
  const classified: Array<FieldClassification> = classifyField(fieldPath, [
    value,
  ]).filter((classification: FieldClassification): boolean => {
    return classification.dataTypeId === dataTypeId;
  });

  if (classified.length === 0) {
    return [];
  }

  const matches: Array<TextRange> = findSensitiveValues(value.trim(), {
    hintedDataTypeIds: getHintedDataTypeIds(fieldPath),
  })
    .filter((match: TextMatch): boolean => {
      return match.dataTypeId === dataTypeId;
    })
    .map((match: TextMatch): TextRange => {
      const offset: number = value.length - value.trimStart().length;

      return [match.start + offset, match.end + offset];
    });

  if (matches.length > 0) {
    return matches;
  }

  // Found by the field's shape: the value whole, its white space aside.
  const start: number = value.length - value.trimStart().length;

  return [[start, value.trimEnd().length]];
}

describe("findDetectorRanges reads a field's value as Data Security reads the field", () => {
  const PHONE_HINTED: ReadonlySet<string> = new Set(["phone-number"]);
  const SSN_HINTED: ReadonlySet<string> = new Set(["us-ssn"]);

  test.each([
    ["a national number alone", "02012345678", ["02012345678"]],
    ["one of nine digits", "612345678", ["612345678"]],
    ["one of twelve digits", "020123456789", ["020123456789"]],
    [
      "two national numbers, set apart by words",
      "home 02012345678, office 02087654321",
      ["02012345678", "02087654321"],
    ],
    [
      "one in fullwidth digits",
      "０２０１２３４５６７８",
      ["０２０１２３４５６７８"],
    ],
    ["one in Arabic-Indic digits", "٠٢٠١٢٣٤٥٦٧٨", ["٠٢٠١٢٣٤٥٦٧٨"]],
    ["one in a URL", "/notify?to=02012345678", ["02012345678"]],
  ])(
    "under a key that names a phone, %s is a phone number: %s",
    (_label: string, value: string, expected: Array<string>) => {
      expect(
        textsOf(
          value,
          findDetectorRanges(PHONE_NUMBER_DETECTORS, value, undefined, {
            hintedDataTypeIds: PHONE_HINTED,
          }),
        ),
      ).toEqual(expected);
      // Without the key's name, no word names any of them.
      expect(findDetectorRanges(PHONE_NUMBER_DETECTORS, value)).toEqual([]);
    },
  );

  test.each([
    ["nine digits alone", "536221234", ["536221234"]],
    ["nine fullwidth digits", "５３６２２１２３４", ["５３６２２１２３４"]],
    ["nine digits after a word", "applicant 536221234", ["536221234"]],
    ["nine digits in a URL", "/verify?id=536221234", ["536221234"]],
  ])(
    "under a key that names an SSN, %s are one: %s",
    (_label: string, value: string, expected: Array<string>) => {
      expect(
        textsOf(
          value,
          findDetectorRanges(US_SSN_DETECTORS, value, undefined, {
            hintedDataTypeIds: SSN_HINTED,
          }),
        ),
      ).toEqual(expected);
      expect(findDetectorRanges(US_SSN_DETECTORS, value)).toEqual([]);
    },
  );

  test.each<[string, string, TextRange]>([
    ["in groups of spaces", "020 1234 5678", [0, 13]],
    ["in groups of hyphens", "020-1234-5678", [0, 13]],
    ["with a group in parentheses", "020 (1234) 5678", [0, 15]],
    ["of seven digits, with a hyphen", "555-1234", [0, 8]],
    ["with white space around it", "  020 1234 5678 ", [2, 15]],
    ["with a plus sign and groups", "+1 (415) 555 2671", [0, 17]],
  ])(
    "under a key that names a phone, a whole value of a phone's shape is one, %s",
    (_label: string, value: string, range: TextRange) => {
      expect(
        findDetectorRanges(PHONE_NUMBER_DETECTORS, value, undefined, {
          hintedDataTypeIds: PHONE_HINTED,
        }),
      ).toEqual([range]);
    },
  );

  test("the field's shape is read only where no detector found the type: a value in it is not hidden whole", () => {
    // The detectors find the number; the value's other characters are kept.
    expect(
      findDetectorRanges(PHONE_NUMBER_DETECTORS, "02012345678", undefined, {
        hintedDataTypeIds: PHONE_HINTED,
      }),
    ).toEqual([[0, 11]]);
    expect(
      findDetectorRanges(
        PHONE_NUMBER_DETECTORS,
        "call +44 20 7946 0958 now",
        undefined,
        { hintedDataTypeIds: PHONE_HINTED },
      ),
    ).toEqual([[5, 21]]);
  });

  test.each([
    ["a run of one digit", "0000000000"],
    ["a straight run", "1234567890"],
    ["a run down", "9876543210"],
    ["too few digits for a national number or a shape", "123456"],
    ["words", "call me later"],
    ["a value longer than a phone's shape", "020 1234 5678 9012 3456 7890 12"],
    ["a placeholder in a phone's shape", "000-000-0000"],
  ])(
    "under a key that names a phone, %s is none: %s",
    (_label: string, value: string) => {
      expect(
        findDetectorRanges(PHONE_NUMBER_DETECTORS, value, undefined, {
          hintedDataTypeIds: PHONE_HINTED,
        }),
      ).toEqual([]);
    },
  );

  test.each([
    ["an area never issued", "666221234"],
    ["an area of the ITIN's", "936221234"],
    ["a group of zeros", "536001234"],
    ["a serial of zeros", "536220000"],
    ["a straight run", "123456789"],
    ["ten digits", "5362212345"],
    ["nine digits inside a longer token", "x536221234"],
  ])(
    "under a key that names an SSN, %s is none: %s",
    (_label: string, value: string) => {
      expect(
        findDetectorRanges(US_SSN_DETECTORS, value, undefined, {
          hintedDataTypeIds: SSN_HINTED,
        }),
      ).toEqual([]);
    },
  );

  test("a hint of another type changes nothing a detector of one type finds", () => {
    expect(
      findDetectorRanges(PHONE_NUMBER_DETECTORS, "02012345678", undefined, {
        hintedDataTypeIds: SSN_HINTED,
      }),
    ).toEqual([]);
    expect(
      findDetectorRanges(US_SSN_DETECTORS, "536221234", undefined, {
        hintedDataTypeIds: PHONE_HINTED,
      }),
    ).toEqual([]);
    expect(
      findDetectorRanges(PHONE_NUMBER_DETECTORS, "02012345678", undefined, {
        hintedDataTypeIds: new Set<string>(),
      }),
    ).toEqual([]);
  });
});

describe("the hints of a key", () => {
  const KEYS: ReadonlyArray<string> = [
    "user.phone",
    "customer.mobile",
    "contact.telephone",
    "msisdn",
    "phoneNumber",
    "phone_number",
    "PhoneNumber",
    "user.tel",
    "customer.ssn",
    "applicant.social_security_number",
    "SSNNumber",
    "ss.number",
    "order.id",
    "request.number",
    "user.phones",
    "telemetry.count",
    "attributes.user.phone",
    "gen_ai.prompt.3.content",
    "",
  ];

  test.each(
    KEYS.map((key: string): [string] => {
      return [key];
    }),
  )("are what Data Security reads a field's name as: %s", (key: string) => {
    expect(Array.from(getHintsOfKey(key)).sort()).toEqual(
      Array.from(getHintedDataTypeIds(key)).sort(),
    );
    // Read again, the same answer.
    expect(getHintsOfKey(key)).toBe(getHintsOfKey(key));
  });

  test("are read from as much of a key as a field's name is read from", () => {
    const long: string = "x".repeat(MAX_FIELD_PATH_LENGTH) + ".phone";

    expect(getHintsOfKey(long).has("phone-number")).toBe(false);
    expect(getHintedDataTypeIds(long).has("phone-number")).toBe(false);
    expect(
      getHintsOfKey("a".repeat(MAX_FIELD_PATH_LENGTH - 6) + ".phone").has(
        "phone-number",
      ),
    ).toBe(true);
  });

  test("are remembered for no more keys than a bound: thousands of keys read once each still answer", () => {
    for (let index: number = 0; index < 10_000; index++) {
      const key: string = `field${index}.phone`;

      expect(getHintsOfKey(key).has("phone-number")).toBe(true);
    }

    expect(getHintsOfKey("field1.order").has("phone-number")).toBe(false);
  });
});

// Values whose JSON text the stored text must be exactly.
const STORED_VALUES: ReadonlyArray<[string, unknown]> = [
  ["an empty list", []],
  ["an empty map", {}],
  ["a list of texts", ["a", "b c", ""]],
  ["a map of texts", { a: "1", b: "two" }],
  ["numbers, true, false and null", [1, -0, 1.5, 1e21, true, false, null]],
  ["numbers JSON writes as null", [Number.NaN, Infinity, -Infinity]],
  [
    "a list's undefined and function",
    [
      undefined,
      (): number => {
        return 1;
      },
      "kept",
    ],
  ],
  [
    "a map's undefined and function, left out",
    {
      a: undefined,
      b: (): number => {
        return 1;
      },
      c: "kept",
    },
  ],
  ["a date", [new Date(Date.UTC(2026, 10, 28, 10, 15, 2))]],
  ["nested lists and maps", { a: [{ b: ["c", { d: "e" }] }], f: { g: [] } }],
  ["escapes", ['quote " back \\ slash', "line\nbreak\ttab", "\u0001\u001f"]],
  ["characters beyond ASCII", ["张伟", "😀", "é", "＋８１"]],
  ["lone surrogates", ["\ud800", "a\udc00b", "\udfff\ud800"]],
  ["keys that need escapes", { 'a"b': "1", "c\\d": "2", "e\nf": "3" }],
  ["a key named __proto__", JSON.parse('{"__proto__": "x", "y": "z"}')],
  ["a map without a prototype", Object.assign(Object.create(null), { a: "1" })],
];

describe("a list or a map as the table stores it (ScrubStoredText)", () => {
  test.each(STORED_VALUES)(
    "is the JSON text JSON.stringify writes: %s",
    (_label: string, value: unknown) => {
      const stored: StoredText | null = readStoredText(value);

      expect(stored).not.toBeNull();
      expect(stored!.text).toBe(JSON.stringify(value));
    },
  );

  test.each(STORED_VALUES)(
    "places each of its texts on the characters JSON writes it with: %s",
    (_label: string, value: unknown) => {
      const stored: StoredText = readStoredText(value)!;

      for (const string of stored.strings) {
        expect(stored.text.slice(string.start - 1, string.end + 1)).toBe(
          JSON.stringify(string.text),
        );
      }

      // In the order the text writes them.
      for (let index: number = 1; index < stored.strings.length; index++) {
        expect(stored.strings[index]!.start).toBeGreaterThan(
          stored.strings[index - 1]!.end,
        );
      }
    },
  );

  test("tells a map's keys from its values", () => {
    const stored: StoredText = readStoredText({
      phone: "02012345678",
      list: ["phone"],
    })!;

    expect(
      stored.strings.map((string: StoredTextString): [string, boolean] => {
        return [string.text, string.isKey];
      }),
    ).toEqual([
      ["phone", true],
      ["02012345678", false],
      ["list", true],
      ["phone", false],
    ]);
  });

  test("is none for a text, a number, a value JSON cannot write, or one deeper than a rule reads", () => {
    expect(readStoredText("a text")).toBeNull();
    expect(readStoredText(42)).toBeNull();
    expect(readStoredText(null)).toBeNull();
    expect(readStoredText([BigInt(1)])).toBeNull();

    let deep: unknown = ["bottom"];

    for (let level: number = 0; level < 40; level++) {
      deep = [deep];
    }

    expect(readStoredText(deep)).toBeNull();

    let fits: unknown = ["bottom"];

    for (let level: number = 0; level < 30; level++) {
      fits = [fits];
    }

    expect(readStoredText(fits)!.text).toBe(JSON.stringify(fits));
  });

  test("places a range of the text on the text that holds it, past the escapes before it", () => {
    const value: Array<string> = ['tel\n02012345678 "x" 02087654321', "kept"];
    const stored: StoredText = readStoredText(value)!;
    const first: number = stored.text.indexOf("02012345678");
    const second: number = stored.text.indexOf("02087654321");
    const placed: Map<string, Array<TextRange>> = placeRangesOnStrings(stored, [
      [first, first + 11],
      [second, second + 11],
    ]);

    expect(Array.from(placed.keys())).toEqual([value[0]]);
    expect(textsOf(value[0]!, placed.get(value[0]!)!)).toEqual([
      "02012345678",
      "02087654321",
    ]);
  });

  test("leaves out a range in a key, in a number, across two texts, or inside an escape", () => {
    const value: Record<string, unknown> = {
      "02012345678": "a\nb",
      n: 2012345678,
      list: ["0201", "2345"],
    };
    const stored: StoredText = readStoredText(value)!;
    const inKey: number = stored.text.indexOf("02012345678");
    const inNumber: number = stored.text.indexOf("2012345678", inKey + 11);
    const across: number = stored.text.indexOf("0201");
    const escape: number = stored.text.indexOf("\\n");

    expect(
      placeRangesOnStrings(stored, [
        [inKey, inKey + 11],
        [inNumber, inNumber + 10],
        [across, across + 13],
        [escape + 1, escape + 3],
        [escape, escape + 1],
      ]),
    ).toEqual(new Map());
  });

  test("places many ranges of a long text written with escapes, each where it is", () => {
    const parts: Array<string> = [];

    for (let index: number = 0; index < 2_000; index++) {
      parts.push(
        `line ${index}\t"q"\n0201234${String(index).padStart(4, "0")}`,
      );
    }

    const value: Array<string> = [parts.join(" ")];
    const stored: StoredText = readStoredText(value)!;
    const ranges: Array<TextRange> = [];
    let at: number = stored.text.indexOf("0201234");

    while (at !== -1) {
      ranges.push([at, at + 11]);
      at = stored.text.indexOf("0201234", at + 1);
    }

    const placed: Array<TextRange> = placeRangesOnStrings(stored, ranges).get(
      value[0]!,
    )!;

    expect(placed).toHaveLength(2_000);
    expect(textsOf(value[0]!, placed).slice(0, 2)).toEqual([
      "02012340000",
      "02012340001",
    ]);
    expect(textsOf(value[0]!, placed)[1_999]).toBe("02012341999");
  });
});

describe("each built-in pattern under a key", () => {
  test("a pattern that reads a text alone is itself under any key", () => {
    for (const patternType of [
      LogScrubPatternType.Email,
      LogScrubPatternType.CreditCard,
      LogScrubPatternType.IPAddress,
    ]) {
      const regex: ScrubRegExp = compileBuiltInScrubPattern(patternType)!;

      expect(scrubRegExpUnderKey(regex, "user.phone", "02012345678")).toBe(
        regex,
      );
      expect(scrubRegExpUnderKey(regex, "customer.ssn", ["536221234"])).toBe(
        regex,
      );
    }

    const custom: ScrubRegExp = compileScrubRuleCustomRegex("[0-9]{9}")!;
    const keys: ScrubRegExp = scrubRegExpFromBuiltIn(
      SCRUB_RULE_SENSITIVE_KEY_REGEX,
    );

    expect(scrubRegExpUnderKey(custom, "customer.ssn", "536221234")).toBe(
      custom,
    );
    expect(scrubRegExpUnderKey(keys, "customer.ssn", "536221234")).toBe(keys);
  });

  test("a Phone Number or SSN pattern is itself under no key, or a key that names nothing, over a text", () => {
    for (const regex of [PHONE, SSN]) {
      expect(scrubRegExpUnderKey(regex, undefined, "02012345678")).toBe(regex);
      expect(scrubRegExpUnderKey(regex, null, "02012345678")).toBe(regex);
      expect(scrubRegExpUnderKey(regex, "", "02012345678")).toBe(regex);
      expect(scrubRegExpUnderKey(regex, "order.id", "02012345678")).toBe(regex);
      expect(scrubRegExpUnderKey(regex, "order.id", 536221234)).toBe(regex);
    }

    // A key that names the other type changes nothing either.
    expect(scrubRegExpUnderKey(PHONE, "customer.ssn", "536221234")).toBe(PHONE);
    expect(scrubRegExpUnderKey(SSN, "user.phone", "02012345678")).toBe(SSN);
  });

  test.each([
    ["user.phone", "02012345678", ["02012345678"]],
    ["customer.mobile", "07700900123", ["07700900123"]],
    ["contact.telephone", "612345678", ["612345678"]],
    ["msisdn", "447700900123", ["447700900123"]],
    ["phoneNumber", "020 1234 5678", ["020 1234 5678"]],
    ["user.tel", "  555-1234  ", ["555-1234"]],
    [
      "user.phone",
      "home 02012345678 work 02087654321",
      ["02012345678", "02087654321"],
    ],
    // What the pattern always found is found under the key too.
    ["user.phone", "+44 20 7946 0958", ["+44 20 7946 0958"]],
  ])(
    "a Phone Number pattern hides under %s what Data Security finds there: %s",
    (key: string, value: string, expected: Array<string>) => {
      expect(foundUnder(PHONE, key, value)).toEqual(expected);
      expect(
        textsOf(
          value,
          dataSecurityFinds(`attributes.${key}`, value, "phone-number"),
        ),
      ).toEqual(expected);
    },
  );

  test.each([
    ["customer.ssn", "536221234", ["536221234"]],
    ["applicant.social_security_number", "536221234", ["536221234"]],
    ["SSNNumber", "５３６２２１２３４", ["５３６２２１２３４"]],
    ["ss.number", "ref 536221234", ["536221234"]],
    ["customer.ssn", "536-22-8731", ["536-22-8731"]],
  ])(
    "an SSN pattern hides under %s what Data Security finds there: %s",
    (key: string, value: string, expected: Array<string>) => {
      expect(foundUnder(SSN, key, value)).toEqual(expected);
      expect(
        textsOf(value, dataSecurityFinds(`attributes.${key}`, value, "us-ssn")),
      ).toEqual(expected);
    },
  );

  test.each([
    [LogScrubPatternType.PhoneNumber, "order.id", "02012345678"],
    [LogScrubPatternType.PhoneNumber, "request.number", "612345678"],
    [LogScrubPatternType.PhoneNumber, "user.phones", "02012345678"],
    [LogScrubPatternType.PhoneNumber, "telemetry.count", "02012345678"],
    [LogScrubPatternType.PhoneNumber, "user.phone", "000000000"],
    [LogScrubPatternType.PhoneNumber, "user.phone", "call me"],
    [LogScrubPatternType.SSN, "order.id", "536221234"],
    [LogScrubPatternType.SSN, "customer.ssn", "666221234"],
    [LogScrubPatternType.SSN, "customer.ssn", "123456789"],
    [LogScrubPatternType.SSN, "customer.ssn", "5362212345"],
  ])(
    "a %s pattern keeps under %s what Data Security does not find there: %s",
    (patternType: string, key: string, value: string) => {
      const regex: ScrubRegExp = compileBuiltInScrubPattern(patternType)!;

      expect(foundUnder(regex, key, value)).toEqual([]);
      expect(
        dataSecurityFinds(
          `attributes.${key}`,
          value,
          DATA_TYPE_OF[patternType]!,
        ),
      ).toEqual([]);
    },
  );

  test("reads a number under a key that names it as the text the table stores", () => {
    expect(
      scrubRegExpUnderKey(SSN, "customer.ssn", 536221234).matchRanges(
        String(536221234),
      ),
    ).toEqual([[0, 9]]);
    expect(
      scrubRegExpUnderKey(PHONE, "user.phone", 2012345678).matchRanges(
        String(2012345678),
      ),
    ).toEqual([[0, 10]]);
  });

  test("reads the texts of a list under a key that names it as Data Security reads the list's JSON text", () => {
    const value: Array<string> = ["02012345678", "02087654321", "n/a"];
    const regex: ScrubRegExp = scrubRegExpUnderKey(PHONE, "user.phone", value);

    expect(regex).not.toBe(PHONE);
    expect(
      value.map((text: string): Array<string> => {
        return textsOf(text, regex.matchRanges(text));
      }),
    ).toEqual([["02012345678"], ["02087654321"], []]);
    expect(
      dataSecurityFinds(
        "attributes.user.phone",
        JSON.stringify(value),
        "phone-number",
      ),
    ).toHaveLength(2);
  });

  test("reads a map's key as the word right beside its value, as the map's JSON text writes it", () => {
    const value: Array<Record<string, string>> = [
      {
        phone: "02012345678",
        description: "the account's own reference, as billing writes it",
        id: "02087654321",
      },
    ];
    const regex: ScrubRegExp = scrubRegExpUnderKey(PHONE, "contacts", value);

    expect(textsOf("02012345678", regex.matchRanges("02012345678"))).toEqual([
      "02012345678",
    ]);
    // Beside "id", and too far past "phone", Data Security finds none: kept.
    expect(regex.matchRanges("02087654321")).toEqual([]);
    expect(
      textsOf(
        JSON.stringify(value),
        dataSecurityFinds(
          "attributes.contacts",
          JSON.stringify(value),
          "phone-number",
        ),
      ),
    ).toEqual(["02012345678"]);
  });

  test("reads a word another of a map's values writes, as a contact written as FHIR writes one", () => {
    const value: Array<Record<string, string>> = [
      { system: "phone", value: "02012345678", use: "home" },
      {
        system: "email",
        note: "the account's own reference, as billing writes it",
        value: "02087654321",
      },
    ];
    const regex: ScrubRegExp = scrubRegExpUnderKey(
      PHONE,
      "patient.telecom",
      value,
    );

    expect(regex.matchRanges("02012345678")).toEqual([[0, 11]]);
    expect(regex.matchRanges("02087654321")).toEqual([]);
    expect(
      dataSecurityFinds(
        "attributes.patient.telecom",
        JSON.stringify(value),
        "phone-number",
      ),
    ).toHaveLength(1);
  });

  test("hides a value where Data Security finds it in a list's JSON text, and the same digits where it finds none are kept", () => {
    const value: Array<string> = [
      "tel 02012345678",
      "and, long after the word, again 02012345678 and 9902012345678",
      "tel 02012345678",
    ];
    const regex: ScrubRegExp = scrubRegExpUnderKey(PHONE, "events", value);

    expect(textsOf(value[0]!, regex.matchRanges(value[0]!))).toEqual([
      "02012345678",
    ]);
    // Out of the word's reach in the JSON text: no word's, kept - the longer number too.
    expect(regex.matchRanges(value[1]!)).toEqual([]);
    expect(
      textsOf(
        JSON.stringify(value),
        dataSecurityFinds(
          "attributes.events",
          JSON.stringify(value),
          "phone-number",
        ),
      ),
    ).toEqual(["02012345678", "02012345678"]);
  });

  test("a map's key that only holds a word is no word, as Data Security reads it", () => {
    const value: Array<Record<string, string>> = [
      { phoneNumber: "02012345678" },
    ];

    expect(scrubRegExpUnderKey(PHONE, "contacts", value)).toBe(PHONE);
    expect(
      dataSecurityFinds(
        "attributes.contacts",
        JSON.stringify(value),
        "phone-number",
      ),
    ).toEqual([]);
  });

  test("a list's numbers under a key that names them are read as their text, and a value deeper than a rule reads as it always was", () => {
    // #11500: [2012345678] under `user.phone` is a phone number to Data Security, which reads its JSON text.
    const underKey: ScrubRegExp = scrubRegExpUnderKey(
      PHONE,
      "user.phone",
      [2012345678],
    );

    expect(underKey).not.toBe(PHONE);
    expect(underKey.numbersInside!.matchRanges("2012345678")).toEqual([
      [0, 10],
    ]);
    // A number of the list nothing found is kept.
    expect(underKey.numbersInside!.matchRanges("42")).toEqual([]);
    // Under a key that names nothing, a list's numbers are kept as they always were.
    expect(scrubRegExpUnderKey(PHONE, "order.ids", [2012345678])).toBe(PHONE);

    let deep: unknown = ["tel 02012345678"];

    for (let level: number = 0; level < 40; level++) {
      deep = [deep];
    }

    expect(scrubRegExpUnderKey(PHONE, "contacts", deep)).toBe(PHONE);
  });

  test("find the same as the functions every engine compiles them from", () => {
    const hints: ReadonlySet<string> = getHintsOfKey("user.phone");

    expect(foundUnder(PHONE, "user.phone", "02012345678")).toEqual(
      textsOf("02012345678", findPhoneNumberRanges("02012345678", hints)),
    );
    expect(foundUnder(SSN, "customer.ssn", "536221234")).toEqual(
      textsOf(
        "536221234",
        findSsnRanges("536221234", getHintsOfKey("customer.ssn")),
      ),
    );
  });
});

/*
 * THE PROPERTY: UNDER ANY KEY, A RULE HIDES WHAT DATA SECURITY FINDS
 * THERE, AND KEEPS WHAT IT DOES NOT.
 *
 * Keys and values drawn from a seeded stream (Tests/Helpers/SeededRandom):
 * keys that name a phone, an SSN, both or neither; values of national
 * numbers, nine digits, numbers in groups, numbers no check passes and
 * words. For each, every value Data Security finds of the type is inside
 * what the rule hides, and the rule hides nothing Data Security does not
 * find - but the type's own pattern's matches, which it always hid.
 */
describe("under any key, a Phone Number or SSN rule hides exactly what Data Security finds there", () => {
  const KEYS_DRAWN: ReadonlyArray<string> = [
    "user.phone",
    "customer.mobile",
    "msisdn",
    "phone_number",
    "contact.tel",
    "customer.ssn",
    "applicant.social_security_number",
    "ss.number",
    "order.id",
    "request.id",
    "invoice.number",
    "phone_count",
    "batch",
  ];

  function digits(random: SeededRandom, count: number, first?: string): string {
    let drawn: string = first || "";

    while (drawn.length < count) {
      drawn += String(random(10));
    }

    return drawn;
  }

  function drawValue(random: SeededRandom): string {
    switch (random(9)) {
      case 0:
        return `0${digits(random, 10, String(1 + random(9)))}`;
      case 1:
        return digits(random, 9, String(1 + random(5)));
      case 2:
        return `${digits(random, 3)} ${digits(random, 4)} ${digits(random, 4)}`;
      case 3:
        return `${digits(random, 3, String(1 + random(5)))}-${digits(random, 2, "1")}-${digits(random, 4, "1")}`;
      case 4:
        return `ref ${digits(random, 9, String(1 + random(8)))}`;
      case 5:
        return digits(random, 7 + random(8));
      case 6:
        return ["n/a", "call me", "unknown", "none"][random(4)]!;
      case 7:
        return `+44 20 ${digits(random, 4)} ${digits(random, 4)}`;
      default:
        return `${digits(random, 3)}-${digits(random, 4)}`;
    }
  }

  test("over 3,000 keys and values drawn from a seeded stream", () => {
    const random: SeededRandom = seededRandom(11383);
    let hidden: number = 0;
    let kept: number = 0;

    for (let draw: number = 0; draw < 3_000; draw++) {
      const key: string = KEYS_DRAWN[random(KEYS_DRAWN.length)]!;
      const value: string = drawValue(random);

      for (const patternType of [
        LogScrubPatternType.PhoneNumber,
        LogScrubPatternType.SSN,
      ]) {
        const regex: ScrubRegExp = compileBuiltInScrubPattern(patternType)!;
        const ranges: Array<TextRange> = scrubRegExpUnderKey(
          regex,
          key,
          value,
        ).matchRanges(value);
        const own: Array<TextRange> = regex.matchRanges(value);
        const found: Array<TextRange> = dataSecurityFinds(
          `attributes.${key}`,
          value,
          DATA_TYPE_OF[patternType]!,
        );

        // Every value Data Security finds is hidden.
        for (const [start, end] of found) {
          expect({
            key,
            value,
            patternType,
            hidden: ranges.some(([from, to]: TextRange): boolean => {
              return from <= start && end <= to;
            }),
          }).toEqual({ key, value, patternType, hidden: true });
        }

        // Nothing else is: what the rule hides is a finding, or what it always hid.
        for (const [start, end] of ranges) {
          expect({
            key,
            value,
            patternType,
            explained:
              found.some(([from, to]: TextRange): boolean => {
                return from < end && start < to;
              }) ||
              own.some(([from, to]: TextRange): boolean => {
                return from < end && start < to;
              }),
          }).toEqual({ key, value, patternType, explained: true });
        }

        if (ranges.length > 0) {
          hidden++;
        } else {
          kept++;
        }
      }
    }

    // The draws reach both sides, many times.
    expect(hidden).toBeGreaterThan(500);
    expect(kept).toBeGreaterThan(500);
  });
});
