import { describe, expect, test } from "@jest/globals";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  CONTEXT_AFTER,
  CONTEXT_BEFORE,
  DataTypeDetector,
} from "../../../Utils/DataSecurity/Detector";
import HEALTH_IDENTIFIER_DETECTORS from "../../../Utils/DataSecurity/Detectors/HealthIdentifierDetectors";

/*
 * NATIONAL HEALTH NUMBERS, FOUND THE WAY THE SCANNER FINDS THEM.
 *
 * Each detector runs here as TextScanner runs it: every match of its
 * pattern, normalized and validated, kept only with a word of its type
 * nearby when it requires one, and counted apart when it is a published
 * sample. The valid values are worked out with each number's own check
 * (independently of the detectors) or are published examples.
 */

interface Found {
  value: string;
  sample: boolean;
}

const WORD_CHARACTER: RegExp = /[A-Za-z0-9]/;

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

// Whether a word stands on its own in the text, as TextScanner reads it.
function containsWord(text: string, word: string): boolean {
  let index: number = text.indexOf(word);

  while (index >= 0) {
    const joinedBefore: boolean =
      isWordCharacter(word[0]) && isWordCharacter(text[index - 1]);
    const joinedAfter: boolean =
      isWordCharacter(word[word.length - 1]) &&
      isWordCharacter(text[index + word.length]);

    if (!joinedBefore && !joinedAfter) {
      return true;
    }

    index = text.indexOf(word, index + 1);
  }

  return false;
}

function detectorOf(id: string): DataTypeDetector {
  const detector: DataTypeDetector | undefined =
    HEALTH_IDENTIFIER_DETECTORS.find((candidate: DataTypeDetector): boolean => {
      return candidate.dataTypeId === id;
    });

  if (!detector) {
    throw new Error(`No detector for ${id}`);
  }

  return detector;
}

// What a type's detector finds in a text, run as the scanner runs it.
function scan(id: string, text: string): Array<Found> {
  const detector: DataTypeDetector = detectorOf(id);
  const found: Array<Found> = [];
  const lowerText: string = text.toLowerCase();

  if (
    detector.quickCheck &&
    !detector.quickCheck(detector.quickCheckLowerCase ? lowerText : text)
  ) {
    return found;
  }

  for (const match of text.matchAll(detector.pattern)) {
    const raw: string | undefined = match[detector.valueGroup || 0];

    if (raw === undefined || match.index === undefined) {
      continue;
    }

    const start: number = match.index + Math.max(0, match[0].indexOf(raw));
    const end: number = start + raw.length;
    const value: string = detector.normalize ? detector.normalize(raw) : raw;

    if (detector.validate && !detector.validate(value, raw)) {
      continue;
    }

    const around: string = lowerText.slice(
      Math.max(0, start - (detector.contextBefore ?? CONTEXT_BEFORE)),
      end + (detector.contextAfter ?? CONTEXT_AFTER),
    );
    const confirmed: boolean = (detector.keywords || []).some(
      (keyword: string): boolean => {
        return containsWord(around, keyword);
      },
    );

    if (detector.requiresContext && !confirmed) {
      continue;
    }

    found.push({ value, sample: Boolean(detector.isTestValue?.(value)) });
  }

  return found;
}

// The values found as findings; samples are counted apart.
function findings(id: string, text: string): Array<string> {
  return scan(id, text)
    .filter((found: Found): boolean => {
      return !found.sample;
    })
    .map((found: Found): string => {
      return found.value;
    });
}

function samples(id: string, text: string): Array<string> {
  return scan(id, text)
    .filter((found: Found): boolean => {
      return found.sample;
    })
    .map((found: Found): string => {
      return found.value;
    });
}

function normalized(id: string, value: string): string {
  const detector: DataTypeDetector = detectorOf(id);

  return detector.normalize ? detector.normalize(value) : value;
}

interface HealthCase {
  id: string;
  // Two valid values, as people type them.
  valid: [string, string];
  // A word that names the type.
  keyword: string;
  // Whether the first value counts with no word around it.
  alone: boolean;
  // A wrong check digit, or a value the format's rules refuse.
  invalid: Array<string>;
  placeholders?: Array<string>;
  samples?: Array<string>;
}

const CASES: Array<HealthCase> = [
  {
    id: "uk-nhs-number",
    valid: ["401 823 4562", "632-815-9471"],
    keyword: "NHS number",
    alone: false,
    invalid: ["401 823 4563", "632-815-9470"],
    placeholders: ["000 000 0000", "123 456 7890"],
    samples: ["943 476 5919", "999 002 1341"],
  },
  {
    id: "us-medicare-mbi",
    valid: ["5KN7-HT2-AM41", "9DW2C83PX06"],
    keyword: "MBI",
    alone: true,
    invalid: [
      "5SN7-HT2-AM41",
      "0KN7-HT2-AM41",
      "5KN7-HT2-AM4",
      "5KN7-HT2-AO41",
    ],
    samples: ["1EG4-TE5-MK73"],
  },
  {
    id: "au-medicare-number",
    valid: ["3950 82179 1", "5273 18464 2 1"],
    keyword: "Medicare",
    alone: false,
    invalid: ["3950 82178 1", "7950 82179 1"],
    placeholders: ["2222 22222 2"],
    samples: ["2123 45670 1"],
  },
  {
    id: "de-health-insurance-number",
    valid: ["M381502647", "T705192833"],
    keyword: "KVNR",
    alone: true,
    invalid: ["M381502648", "T705192834"],
    placeholders: ["A111111111"],
    samples: ["A123456780"],
  },
  {
    id: "us-npi",
    valid: ["1982736450", "2861034579"],
    keyword: "NPI",
    alone: false,
    invalid: ["1982736451", "3982736450"],
    placeholders: ["1111111111"],
    samples: ["1234567893"],
  },
  {
    id: "us-dea-number",
    valid: ["BJ6130253", "MS2947185"],
    keyword: "DEA",
    alone: false,
    invalid: ["BJ6130254", "ZJ6130253"],
    placeholders: ["AB1111111"],
    samples: ["AB1234563"],
  },
];

describe("HEALTH_IDENTIFIER_DETECTORS", () => {
  test("has one detector for each national health number, each a Health type of the catalog", () => {
    expect(
      HEALTH_IDENTIFIER_DETECTORS.map((detector: DataTypeDetector): string => {
        return detector.dataTypeId;
      }).sort(),
    ).toEqual([
      "au-medicare-number",
      "de-health-insurance-number",
      "uk-nhs-number",
      "us-dea-number",
      "us-medicare-mbi",
      "us-npi",
    ]);

    for (const detector of HEALTH_IDENTIFIER_DETECTORS) {
      expect(getBuiltInDataType(detector.dataTypeId)?.category).toBe(
        DataCategory.Health,
      );
      expect(detector.pattern.flags).toContain("g");
    }
  });
});

describe.each(CASES)("$id", (healthCase: HealthCase) => {
  const { id, keyword }: HealthCase = healthCase;

  test("finds both valid values in text, separators and all", () => {
    const text: string = `First ${keyword}: ${healthCase.valid[0]}; and the other ${keyword} ${healthCase.valid[1]}.`;

    expect(findings(id, text)).toEqual([
      normalized(id, healthCase.valid[0]),
      normalized(id, healthCase.valid[1]),
    ]);
  });

  test("refuses a wrong check digit and what the format's rules refuse", () => {
    for (const value of healthCase.invalid) {
      expect(findings(id, `${keyword}: ${value}.`)).toEqual([]);
    }
  });

  test("does not take a value from inside a longer token", () => {
    const value: string = healthCase.valid[0];

    for (const text of [
      `${keyword}: X${value}`,
      `${keyword}: ${value}X`,
      `${keyword}: 7${value}`,
      `${keyword}: ${value}7`,
    ]) {
      expect(findings(id, text)).not.toContain(normalized(id, value));
    }
  });

  test(
    healthCase.alone
      ? "counts on its own, with no word around it"
      : "counts only beside a word that names it",
    () => {
      const value: string = healthCase.valid[0];
      const expected: Array<string> = [normalized(id, value)];

      expect(findings(id, `Value ${value} kept.`)).toEqual(
        healthCase.alone ? expected : [],
      );
      expect(findings(id, `${keyword} ${value} kept.`)).toEqual(expected);
    },
  );

  test("refuses placeholders and counts published samples apart", () => {
    for (const value of healthCase.placeholders || []) {
      expect(scan(id, `${keyword}: ${value}.`)).toEqual([]);
    }

    for (const value of healthCase.samples || []) {
      const text: string = `${keyword}: ${value}.`;

      expect(findings(id, text)).toEqual([]);
      expect(samples(id, text)).toEqual([normalized(id, value)]);
    }
  });
});

describe("the rules of each number", () => {
  test("an NHS number whose check would be 10 is never issued", () => {
    for (let digit: number = 0; digit < 10; digit++) {
      expect(findings("uk-nhs-number", `NHS no 401 823 452${digit}`)).toEqual(
        [],
      );
    }
  });

  test("NHS numbers starting with 999 are test numbers", () => {
    expect(samples("uk-nhs-number", "NHS number 9990021341")).toEqual([
      "9990021341",
    ]);
  });

  test("an MBI's letters are never S, L, O, I, B or Z, and it is written in capitals", () => {
    for (const letter of ["S", "L", "O", "I", "B", "Z"]) {
      expect(findings("us-medicare-mbi", `MBI 5K${letter}7HT2AM41`)).toEqual(
        [],
      );
    }

    expect(findings("us-medicare-mbi", "mbi 5kn7ht2am41")).toEqual([]);
  });

  test("a Medicare number's reference number on the card is optional", () => {
    expect(findings("au-medicare-number", "Medicare 3950821791")).toEqual([
      "3950821791",
    ]);
    expect(findings("au-medicare-number", "Medicare 3950 82179 1-2")).toEqual([
      "39508217912",
    ]);
  });

  test("a KVNR's letter counts as its place in the alphabet, in two digits", () => {
    // T is the 20th letter: its digits 2 and 0 are the first two weighted.
    expect(
      findings("de-health-insurance-number", "Versichertennummer T705192833"),
    ).toEqual(["T705192833"]);
    expect(
      findings("de-health-insurance-number", "Versichertennummer U705192833"),
    ).toEqual([]);
  });

  test("an NPI is Luhn over 80840 and its ten digits, not over the ten alone", () => {
    expect(findings("us-npi", "NPI 1982736450")).toEqual(["1982736450"]);
    expect(findings("us-npi", "NPI 1982736453")).toEqual([]);
  });

  test("a DEA number's first letter is a kind of registrant, its second may be 9", () => {
    expect(findings("us-dea-number", "DEA# BJ6130253")).toEqual(["BJ6130253"]);
    expect(findings("us-dea-number", "DEA# B96130253")).toEqual(["B96130253"]);
    expect(findings("us-dea-number", "DEA# QJ6130253")).toEqual([]);
  });
});
