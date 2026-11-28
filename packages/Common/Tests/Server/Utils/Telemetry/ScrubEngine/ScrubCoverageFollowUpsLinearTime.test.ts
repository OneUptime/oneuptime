import { describe, expect, test } from "@jest/globals";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import {
  buildMetricScrubFilters,
  buildScrubPatternForDataType,
  METRIC_REDACT_REPLACEMENT,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import MetricPipelineEngine, {
  MutableMetricRow,
} from "../../../../../Server/Utils/Telemetry/MetricPipelineEngine";
import {
  compileScrubRule,
  CompiledScrubRule,
} from "../../../../../Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import LogScrubEngine from "../../../../../Server/Utils/Telemetry/ScrubEngine/LogScrubEngine";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import MetricPipelineRuleFilterCondition from "../../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../../../Types/Metrics/MetricPipelineRuleType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ScrubRegExp,
  scrubRegExpUnderKey,
} from "../../../../../Types/Telemetry/ScrubRule";
import { DataTypeDetector } from "../../../../../Utils/DataSecurity/Detector";
import {
  COORDINATE_DETECTORS,
  PHONE_NUMBER_DETECTORS,
  POSTAL_CODE_DETECTORS,
} from "../../../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { TextRange } from "../../../../../Utils/DataSecurity/TextReadings";
import { findSensitiveValues } from "../../../../../Utils/DataSecurity/TextScanner";
import { compileBuiltInScrubPattern } from "../../../../../Utils/Telemetry/ScrubBuiltInPatterns";
import {
  placeRangesOnNumbers,
  placeRangesOnStrings,
  readStoredText,
  StoredText,
} from "../../../../../Utils/Telemetry/ScrubStoredText";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * WHAT THE SCRUB COVERAGE FOLLOW-UPS READ, THEY READ IN TIME IN LINE WITH
 * ITS LENGTH (#11493, #11496, #11500, #11502).
 *
 * The national phone numbers in their groups beside a word, the words that
 * make nine to twelve digits a phone number, the Postal Code and
 * Coordinates rules - read alone and under a key that names their type -
 * and a list's or a map's JSON text, its numbers placed back on the value,
 * run over every record of a project with such a rule, at ingest, over
 * text an application - or an attacker - writes. Each pattern is bounded,
 * each reading made once, and each placing walks the value once: 400,000
 * characters of each awkward text, under two seconds (Tests/Helpers/
 * FastestRun).
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400_000;
const LIMIT_IN_MS: number = 2000;
const PROJECT_ID: ObjectID = new ObjectID(
  "11502000-0000-4000-8000-0000000000aa",
);

function repeat(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

// As many copies of an item as make a list whose JSON text is at least LENGTH long.
function listOf(item: JSONValue): Array<JSONValue> {
  const count: number = Math.ceil(LENGTH / (JSON.stringify(item).length + 1));

  return Array.from({ length: count }, (): JSONValue => {
    return JSON.parse(JSON.stringify(item)) as JSONValue;
  });
}

const PHONE_CASES: Array<[string, string]> = [
  [
    "a phone word and groups of two without end",
    "tel " + repeat("12 ", LENGTH),
  ],
  [
    "a phone word and hyphenated groups without end",
    "tel " + repeat("12-", LENGTH),
  ],
  [
    "a phone word and dotted groups without end",
    "phone " + repeat("12.", LENGTH),
  ],
  [
    "a phone word and groups of eight without end",
    "tel " + repeat("12345678 ", LENGTH),
  ],
  [
    "an area code in parentheses, then groups without end",
    "tel (03) " + repeat("1234 ", LENGTH),
  ],
  ["open parentheses and digits without end", "tel " + repeat("(03", LENGTH)],
  [
    "national numbers in groups back to back",
    repeat("tel 03-1234-5678 ", LENGTH),
  ],
  [
    "London numbers in groups back to back",
    repeat("phone 020 3123 4567 ", LENGTH),
  ],
  ["Berlin numbers back to back", repeat("telephone 030 12345678 ", LENGTH)],
  ["dates beside phone words back to back", repeat("tel 2026-11-28 ", LENGTH)],
  [
    "IPv4 addresses beside phone words back to back",
    repeat("tel 192.168.100.200 ", LENGTH),
  ],
  ["a phone word then digits without end", "tel " + repeat("0", LENGTH)],
  [
    "a phone word then trunk zeros and spaces without end",
    "phone " + repeat("0 ", LENGTH),
  ],
  ["phone words without end", repeat("phone ", LENGTH)],
  [
    "call, cell and contact before Unix times back to back",
    repeat("call 1732780800 cell 1732780800 contact 1732780800 ", LENGTH),
  ],
  [
    "call me on, then a number, back to back",
    repeat("call me on 020 3123 4567 ", LENGTH),
  ],
  [
    "fullwidth groups beside the word without end",
    "tel " + repeat("０３－", LENGTH),
  ],
  [
    "prolonged sound marks between digits without end",
    "tel " + repeat("03ー", LENGTH),
  ],
  [
    "numbers typed into a form back to back",
    repeat("phone=03-1234-5678&", LENGTH),
  ],
  [
    "percent-encoded hyphens back to back",
    repeat("tel 03%2D1234%2D5678 ", LENGTH),
  ],
];

const POSTAL_CODE_CASES: Array<[string, string]> = [
  ["ZIP codes beside their word back to back", repeat("zip 94107 ", LENGTH)],
  ["ZIP+4 codes back to back", repeat("zip code: 94107-1234 ", LENGTH)],
  ["a zip word then digits without end", "zip " + repeat("9", LENGTH)],
  ["five digits and hyphens without end", "zip " + repeat("94107-", LENGTH)],
  ["UK postcodes back to back", repeat("SW1A 2AA ", LENGTH)],
  ["Canadian postal codes back to back", repeat("K1A 0B1 ", LENGTH)],
  ["letters and digits in turn without end", repeat("A1", LENGTH)],
  [
    "postcodes typed into a form back to back",
    repeat("postcode=SW1A+2AA&", LENGTH),
  ],
  ["zip words without end", repeat("zip ", LENGTH)],
  [
    "fullwidth digits after a zip word without end",
    "zip " + repeat("９", LENGTH),
  ],
  [
    "ZIP codes in Arabic-Indic digits back to back",
    repeat("zip ٩٤١٠٧ ", LENGTH),
  ],
];

const COORDINATE_CASES: Array<[string, string]> = [
  [
    "coordinates beside their word back to back",
    repeat("lat 37.77493 ", LENGTH),
  ],
  ["pairs back to back", repeat("37.77493, -122.41942 ", LENGTH)],
  ["decimals without end", repeat("1.2345", LENGTH)],
  ["minus signs and digits without end", repeat("-1", LENGTH)],
  ["a lat word then digits without end", "lat " + repeat("1", LENGTH)],
  ["a fraction without end after a lat word", "lat 37." + repeat("7", LENGTH)],
  ["decimals and commas in turn", repeat("1.2345,", LENGTH)],
  [
    "coordinates typed into a form back to back",
    repeat("lat=37.77493&lng=-122.41942&", LENGTH),
  ],
  ["lat words without end", repeat("lat ", LENGTH)],
];

describe.each([
  ["phone numbers", PHONE_NUMBER_DETECTORS, PHONE_CASES],
  ["postal codes", POSTAL_CODE_DETECTORS, POSTAL_CODE_CASES],
  ["coordinates", COORDINATE_DETECTORS, COORDINATE_CASES],
] as Array<[string, ReadonlyArray<DataTypeDetector>, Array<[string, string]>]>)(
  "Data Security's scanner, finding %s",
  (
    _type: string,
    detectors: ReadonlyArray<DataTypeDetector>,
    cases: Array<[string, string]>,
  ) => {
    test.each(cases)(
      "reads %s in time in line with its length",
      (_label: string, text: string) => {
        const timed: FastestRun<number> = fastestRun({
          run: (): number => {
            return findSensitiveValues(text, { detectors }).length;
          },
          limitInMs: LIMIT_IN_MS,
        });

        expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
      },
    );
  },
);

describe.each([
  [
    "a Phone Number rule",
    LogScrubPatternType.PhoneNumber,
    "user.phone",
    PHONE_CASES,
  ],
  [
    "a Postal Code rule",
    LogScrubPatternType.PostalCode,
    "address.zip",
    POSTAL_CODE_CASES,
  ],
  [
    "a Coordinates rule",
    LogScrubPatternType.Coordinates,
    "location.lat",
    COORDINATE_CASES,
  ],
] as Array<[string, string, string, Array<[string, string]>]>)(
  "%s",
  (
    _rule: string,
    patternType: string,
    key: string,
    cases: Array<[string, string]>,
  ) => {
    const regex: ScrubRegExp = compileBuiltInScrubPattern(patternType)!;

    test.each(cases)(
      "reads %s alone and under a key that names its type, in time in line with its length",
      (_label: string, text: string) => {
        const timed: FastestRun<[string, string]> = fastestRun({
          run: (): [string, string] => {
            const hide: () => string = (): string => {
              return "[REDACTED]";
            };

            return [
              regex.replace(text, hide),
              scrubRegExpUnderKey(regex, key, text).replace(text, hide),
            ];
          },
          limitInMs: LIMIT_IN_MS,
        });

        expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
        expect(typeof timed.result[0]).toBe("string");
      },
    );
  },
);

describe("a list's or a map's JSON text, its numbers and texts placed back on it (#11500, #11502)", () => {
  const VALUES: Array<[string, JSONValue]> = [
    ["a list of numbers", listOf(2012345678)],
    ["a list of decimals", listOf(-122.41942)],
    [
      "a list of maps with a phone and its number",
      listOf({ system: "phone", value: 2012345678 }),
    ],
    ["a list of texts with escapes", listOf('line "one"\nphone')],
    [
      "a map of many keys",
      Object.fromEntries(
        Array.from(
          { length: 20_000 },
          (_: unknown, index: number): [string, string] => {
            return [`key${index}`, `value${index}`];
          },
        ),
      ),
    ],
    // As deep as a rule reads a value (SCRUB_MAX_VALUE_DEPTH, 32).
    ["a list nested as deep as a rule reads", nestedIn(30, listOf(7))],
  ];

  // A value inside `levels` lists, one in the other.
  function nestedIn(levels: number, value: JSONValue): JSONValue {
    return JSON.parse(
      `${"[".repeat(levels)}${JSON.stringify(value)}${"]".repeat(levels)}`,
    ) as JSONValue;
  }

  test.each(VALUES)(
    "%s is read, and a range on every character placed, in time in line with its length",
    (_label: string, value: JSONValue) => {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          const stored: StoredText = readStoredText(value)!;
          // One range a character, and one across all of it.
          const ranges: Array<TextRange> = [[0, stored.text.length]];

          for (let at: number = 0; at < stored.text.length; at += 7) {
            ranges.push([at, at + 3]);
          }

          return (
            placeRangesOnNumbers(stored, ranges).size +
            placeRangesOnStrings(stored, ranges).size
          );
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
      expect(JSON.stringify(value).length).toBeGreaterThanOrEqual(LENGTH);
    },
  );

  test("a list nested deeper than a rule reads is not read as JSON text at all, however long", () => {
    const timed: FastestRun<StoredText | null> = fastestRun({
      run: (): StoredText | null => {
        return readStoredText(nestedIn(100, listOf(7)));
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    expect(timed.result).toBeNull();
  });
});

function logRule(
  patternType: string,
  customRegex?: string | undefined,
): CompiledScrubRule {
  return compileScrubRule({
    _id: "11502000-0000-4000-8000-0000000000ab",
    projectId: PROJECT_ID,
    patternType,
    scrubAction: LogScrubAction.Redact,
    fieldsToScrub: LogScrubField.Both,
    ...(customRegex ? { customRegex } : {}),
  })!;
}

describe("the log engine, over a list or a map of 400,000 characters under a key", () => {
  const CASES: Array<[string, CompiledScrubRule, string, JSONValue, string]> = [
    [
      "a Phone Number rule, a phone's numbers in maps",
      logRule(LogScrubPatternType.PhoneNumber),
      "contacts",
      listOf({ system: "phone", value: 2012345678 }),
      "2012345678",
    ],
    [
      "an SSN rule, nine digits under a key that names them",
      logRule(LogScrubPatternType.SSN),
      "customer.ssn",
      listOf(536221234),
      "536221234",
    ],
    [
      "a Postal Code rule, ZIP codes under their key",
      logRule(LogScrubPatternType.PostalCode),
      "shipping",
      listOf({ zip: 94107 }),
      "94107",
    ],
    [
      "a Coordinates rule, pairs as two numbers",
      logRule(LogScrubPatternType.Coordinates),
      "route",
      listOf([37.77493, -122.41942]),
      "37.77493",
    ],
    [
      "Scrub It's card security code rule, a code beside the key that names it",
      logRule(
        LogScrubPatternType.Custom,
        buildScrubPatternForDataType("card-verification-code")!,
      ),
      "payments",
      listOf({ cvv: "123" }),
      '"123"',
    ],
  ];

  test.each(CASES)(
    "%s: every one hidden, in time in line with its length",
    (
      _label: string,
      rule: CompiledScrubRule,
      key: string,
      value: JSONValue,
      kept: string,
    ) => {
      const timed: FastestRun<JSONObject> = fastestRun({
        run: (): JSONObject => {
          return LogScrubEngine.scrubLog(
            {
              body: "",
              attributes: { [key]: JSON.parse(JSON.stringify(value)) },
            },
            [rule],
            null,
            { countValues: false },
          );
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
      expect(JSON.stringify(timed.result["attributes"])).not.toContain(kept);
    },
  );
});

describe("a metric's pattern filter, over a list or a map of 400,000 characters (#11500)", () => {
  function metricRedactRule(
    filters: Array<MetricPipelineRuleFilterCondition>,
    attributeKey: string,
  ): MetricPipelineRule {
    const rule: MetricPipelineRule = new MetricPipelineRule();

    rule.id = ObjectID.generate();
    rule.ruleType = MetricPipelineRuleType.RedactAttribute;
    rule.addAttributeKey = attributeKey;
    rule.redactReplacement = METRIC_REDACT_REPLACEMENT;
    rule.filters = filters;

    return rule;
  }

  test.each([
    [
      "a phone's numbers in maps, by the Phone Number pattern type",
      "phone-number",
      "contacts",
      listOf({ system: "phone", value: 2012345678 }),
    ],
    [
      "ZIP codes under their key, by the Postal Code pattern type",
      "postal-code",
      "shipping",
      listOf({ zip: 94107 }),
    ],
    [
      "ITINs in their groups, by the ITIN's own pattern",
      "us-itin",
      "tax",
      listOf("912-70-1234"),
    ],
  ] as Array<[string, string, string, JSONValue]>)(
    "%s: read and redacted in time in line with its length",
    (_label: string, dataTypeId: string, key: string, value: JSONValue) => {
      const rule: MetricPipelineRule = metricRedactRule(
        buildMetricScrubFilters(dataTypeId, key, {
          isFoundByContext: false,
          isFoundByModel: false,
        }),
        key,
      );
      const timed: FastestRun<MutableMetricRow | null> = fastestRun({
        run: (): MutableMetricRow | null => {
          return MetricPipelineEngine.applyRules(
            {
              name: "signups",
              attributes: { [key]: value },
              attributeKeys: [key],
            },
            [rule],
            [],
          );
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
      expect(timed.result!.attributes).toEqual({
        [key]: METRIC_REDACT_REPLACEMENT,
      });
    },
  );
});
