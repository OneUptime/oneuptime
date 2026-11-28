import { describe, expect, test } from "@jest/globals";
import { buildScrubPatternForDataType } from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import LogScrubEngine from "../../../Server/Utils/Telemetry/ScrubEngine/LogScrubEngine";
import {
  compileScrubRule,
  CompiledScrubRule,
} from "../../../Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import { JSONObject } from "../../../Types/JSON";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  compileScrubRuleCustomRegex,
  ScrubRegExp,
  scrubRegExpUnderKey,
} from "../../../Types/Telemetry/ScrubRule";
import {
  readFullwidthForms,
  readFullwidthLetters,
} from "../../../Utils/DataSecurity/FullwidthForms";
import { findSensitiveValues } from "../../../Utils/DataSecurity/TextScanner";
import { compileBuiltInScrubPattern } from "../../../Utils/Telemetry/ScrubBuiltInPatterns";
import {
  placeRangesOnStrings,
  readStoredText,
  StoredText,
} from "../../../Utils/Telemetry/ScrubStoredText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * THE NEW READINGS, AND A RULE UNDER A KEY, IN TIME IN LINE WITH A TEXT'S
 * LENGTH (#11383, #11385).
 *
 * A rule runs over every record of a project with one, at ingest, over
 * text an application - or an attacker - writes. 400,000 characters of
 * each awkward text, through the readings, the rules and the scanner,
 * under two seconds (Tests/Helpers/FastestRun): dashes beside digits
 * without end, fullwidth letters without end, values typed so back to
 * back; a value under a key that names its type, of digits without end;
 * a list of 10,000 texts read as its JSON text.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400_000;
const LIMIT_IN_MS: number = 2000;

function repeat(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

function timed<T>(run: () => T): FastestRun<T> {
  return fastestRun({ run, limitInMs: LIMIT_IN_MS });
}

const DASH_AND_LETTER_CASES: ReadonlyArray<[string, string]> = [
  ["prolonged sound marks between digits without end", repeat("3ー", LENGTH)],
  ["fullwidth digits and prolonged sound marks", repeat("３ー", LENGTH)],
  ["en dashes between digits without end", repeat("4–", LENGTH)],
  ["every dash in turn between digits", repeat("1ー2ｰ3‐4‑5‒6–7−", LENGTH)],
  ["dashes beside no digit", repeat("サーバー ", LENGTH)],
  ["dashes beside one digit only", repeat("ー1 ", LENGTH)],
  [
    "phone numbers set apart by prolonged sound marks back to back",
    repeat("＋８１ ３ー１２３４ー５６７８ ", LENGTH),
  ],
  [
    "SSNs set apart by en dashes back to back",
    repeat("ssn 536–22–8731 ", LENGTH),
  ],
  ["cards set apart by en dashes", repeat("4532–0151–1283–0366 ", LENGTH)],
  ["fullwidth letters without end", repeat("Ａ", LENGTH)],
  ["fullwidth letters and digits in turn", repeat("Ａ１", LENGTH)],
  ["fullwidth at signs and letters", repeat("ａ＠", LENGTH)],
  [
    "addresses typed in fullwidth back to back",
    repeat("ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ ", LENGTH),
  ],
  [
    "IBANs typed in fullwidth back to back",
    repeat("ＤＥ４７　３７０４　００４４　０５３２　０１３０　７７ ", LENGTH),
  ],
  [
    "a fullwidth word, then digits without end",
    "ＴＥＬ　" + repeat("０", LENGTH),
  ],
  [
    "CJK prose with fullwidth punctuation",
    repeat("設定を確認してください。（注）以上です！", LENGTH),
  ],
];

describe("the readings of the other dashes and the fullwidth letters", () => {
  test.each(DASH_AND_LETTER_CASES)(
    "read %s in time",
    (_label: string, text: string) => {
      const result: FastestRun<number> = timed((): number => {
        return (
          (readFullwidthForms(text)?.length || 0) +
          (readFullwidthLetters(text)?.length || 0)
        );
      });

      expect(result.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );
});

describe("the rules read them in time", () => {
  const RULES: ReadonlyArray<[string, ScrubRegExp]> = [
    [
      "Phone Number",
      compileBuiltInScrubPattern(LogScrubPatternType.PhoneNumber)!,
    ],
    ["SSN", compileBuiltInScrubPattern(LogScrubPatternType.SSN)!],
    [
      "Credit Card",
      compileBuiltInScrubPattern(LogScrubPatternType.CreditCard)!,
    ],
    ["Email Address", compileBuiltInScrubPattern(LogScrubPatternType.Email)!],
    [
      "Scrub It's IBAN Custom Regex",
      compileScrubRuleCustomRegex(buildScrubPatternForDataType("iban"))!,
    ],
  ];

  const CASES: Array<[string, string, string, ScrubRegExp]> = RULES.flatMap(
    ([name, regex]: [string, ScrubRegExp]): Array<
      [string, string, string, ScrubRegExp]
    > => {
      return DASH_AND_LETTER_CASES.map(
        ([label, text]: [string, string]): [
          string,
          string,
          string,
          ScrubRegExp,
        ] => {
          return [name, label, text, regex];
        },
      );
    },
  );

  test.each(CASES)(
    "a %s rule reads %s",
    (_name: string, _label: string, text: string, regex: ScrubRegExp) => {
      const result: FastestRun<string> = timed((): string => {
        return regex.replace(text, (): string => {
          return "[REDACTED]";
        });
      });

      expect(result.inMs).toBeLessThan(LIMIT_IN_MS);
      expect(typeof result.result).toBe("string");
    },
  );
});

describe("the scanner reads them in time", () => {
  test.each(DASH_AND_LETTER_CASES)(
    "with every built-in detector, %s",
    (_label: string, text: string) => {
      const result: FastestRun<number> = timed((): number => {
        return findSensitiveValues(text).length;
      });

      expect(result.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );
});

describe("a rule under a key that names its type reads in time (#11383)", () => {
  const PHONE: ScrubRegExp = compileBuiltInScrubPattern(
    LogScrubPatternType.PhoneNumber,
  )!;
  const SSN: ScrubRegExp = compileBuiltInScrubPattern(LogScrubPatternType.SSN)!;

  test.each([
    ["digits without end", repeat("4", LENGTH)],
    ["national numbers back to back", repeat("02012345678 ", LENGTH)],
    ["nine digits back to back", repeat("536221234 ", LENGTH)],
    [
      "digits and spaces in a phone's shape without end",
      repeat("020 1234 ", LENGTH),
    ],
    ["fullwidth digits without end", repeat("０", LENGTH)],
  ])("over %s", (_label: string, text: string) => {
    for (const [key, regex] of [
      ["user.phone", PHONE],
      ["customer.ssn", SSN],
    ] as Array<[string, ScrubRegExp]>) {
      const keyed: ScrubRegExp = scrubRegExpUnderKey(regex, key, text);
      const result: FastestRun<number> = timed((): number => {
        return keyed.matchRanges(text).length;
      });

      expect([key, result.inMs < LIMIT_IN_MS]).toEqual([key, true]);
    }
  });

  test("over a list of 10,000 texts, read as its JSON text too", () => {
    const value: Array<string> = [];

    for (let index: number = 0; index < 10_000; index++) {
      value.push(`tel 0201234${String(index).padStart(4, "0")} and "q"\n`);
    }

    const result: FastestRun<number> = timed((): number => {
      const keyed: ScrubRegExp = scrubRegExpUnderKey(PHONE, "contacts", value);
      let found: number = 0;

      for (const text of value) {
        found += keyed.matchRanges(text).length;
      }

      return found;
    });

    expect(result.inMs).toBeLessThan(LIMIT_IN_MS);
    expect(result.result).toBe(10_000);
  });

  test("a list's JSON text, and its ranges placed on its texts, over 400,000 characters", () => {
    const value: Array<string> = [repeat('a"\\\n0', LENGTH)];
    const result: FastestRun<number> = timed((): number => {
      const stored: StoredText = readStoredText(value)!;
      const ranges: Array<[number, number]> = [];

      for (let at: number = 1; at < stored.text.length - 1; at += 7) {
        ranges.push([at, at + 1]);
      }

      return placeRangesOnStrings(stored, ranges).size;
    });

    expect(result.inMs).toBeLessThan(LIMIT_IN_MS);
  });

  test("the log engine over a record whose every attribute is under a key that names a phone", () => {
    const rule: CompiledScrubRule = compileScrubRule({
      _id: "0192f1a0-0000-7000-8000-000000113839",
      projectId: "0192f1a0-0000-7000-8000-000000113838",
      patternType: LogScrubPatternType.PhoneNumber,
      scrubAction: LogScrubAction.Redact,
      fieldsToScrub: LogScrubField.Both,
    })!;
    const attributes: JSONObject = {};

    for (let index: number = 0; index < 2_000; index++) {
      attributes[`user${index}.phone`] = repeat("0201234567 ", 200);
    }

    const result: FastestRun<JSONObject> = timed((): JSONObject => {
      return LogScrubEngine.scrubLog(
        { body: "", attributes: { ...attributes } },
        [rule],
        null,
        { countValues: false },
      );
    });

    expect(result.inMs).toBeLessThan(LIMIT_IN_MS);
  });
});
