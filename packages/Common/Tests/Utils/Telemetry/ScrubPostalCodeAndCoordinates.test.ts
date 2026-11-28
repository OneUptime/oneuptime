import { describe, expect, test } from "@jest/globals";
import MetricPipelineRule from "../../../Models/DatabaseModels/MetricPipelineRule";
import {
  buildMetricScrubFilters,
  METRIC_REDACT_REPLACEMENT,
} from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import MetricPipelineEngine, {
  MutableMetricRow,
} from "../../../Server/Utils/Telemetry/MetricPipelineEngine";
import ScrubAction from "../../../Server/Utils/Telemetry/ScrubAction";
import {
  compileScrubRule,
  CompiledScrubRule,
} from "../../../Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import LogScrubEngine from "../../../Server/Utils/Telemetry/ScrubEngine/LogScrubEngine";
import TraceScrubEngine from "../../../Server/Utils/Telemetry/ScrubEngine/TraceScrubEngine";
import { JSONObject } from "../../../Types/JSON";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import { METRIC_FILTER_PATTERN_TYPES } from "../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../Types/Metrics/MetricPipelineRuleType";
import ObjectID from "../../../Types/ObjectID";
import {
  DATA_TYPE_OF_SCRUB_PATTERN_TYPE,
  LOG_SCRUB_PATTERN_TYPES,
  ScrubRegExp,
  scrubRegExpUnderKey,
  TRACE_SCRUB_PATTERN_TYPES,
} from "../../../Types/Telemetry/ScrubRule";
import TraceScrubField from "../../../Types/Trace/TraceScrubField";
import {
  COORDINATE_DETECTORS,
  POSTAL_CODE_DETECTORS,
} from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import { getHintedDataTypeIds } from "../../../Utils/DataSecurity/FieldNameHints";
import {
  findDetectorRanges,
  TextRange,
} from "../../../Utils/DataSecurity/TextReadings";
import {
  compileBuiltInScrubPattern,
  findCoordinateRanges,
  findPostalCodeRanges,
} from "../../../Utils/Telemetry/ScrubBuiltInPatterns";

/*
 * ---------------------------------------------------------------------------
 * THE POSTAL CODE AND COORDINATES RULES READ THE KEY AND THE WORDS A VALUE
 * NEEDS, AS DATA SECURITY DOES (#11502).
 *
 * Scrub It made a Custom Regex rule for a postal code of the UK and
 * Canadian postcodes' shapes, and for a precise location of a coordinate
 * pair's: it kept a US ZIP code beside "zip" or under `address.zip`, and a
 * lone coordinate beside "lat" or under `location.lat`, which Data Security
 * finds. The Postal Code and Coordinates pattern types hide what the
 * detectors find - in every reading they read, beside their words as the
 * scanner judges them, under a key that names them, a number there too -
 * and keep what they do not. Every engine runs them, and a metric rule's
 * Matches Pattern Type filter matches them.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-000000115020";

const POSTAL_CODE: ScrubRegExp = compileBuiltInScrubPattern(
  LogScrubPatternType.PostalCode,
)!;
const COORDINATES: ScrubRegExp = compileBuiltInScrubPattern(
  LogScrubPatternType.Coordinates,
)!;

function textsOf(text: string, ranges: Array<[number, number]>): Array<string> {
  return ranges.map(([start, end]: [number, number]): string => {
    return text.slice(start, end);
  });
}

// What a rule finds in a value held under a key, as an engine reads it.
function foundUnder(
  regex: ScrubRegExp,
  key: string | undefined,
  value: string,
): Array<string> {
  return textsOf(
    value,
    scrubRegExpUnderKey(regex, key, value).matchRanges(value),
  );
}

// What the detectors find, as a rule built on them finds it under the key.
function detectorsFind(
  detectors: ReadonlyArray<DataTypeDetector>,
  key: string | undefined,
  value: string,
): Array<string> {
  return textsOf(
    value,
    findDetectorRanges(detectors, value, undefined, {
      hintedDataTypeIds:
        key === undefined ? undefined : getHintedDataTypeIds(key),
    }),
  );
}

function compiled(patternType: string, action: string): CompiledScrubRule {
  const rule: CompiledScrubRule | null = compileScrubRule({
    projectId: new ObjectID(PROJECT_ID),
    patternType,
    scrubAction: action,
    fieldsToScrub: LogScrubField.Both,
  });

  expect(rule).not.toBeNull();

  return rule!;
}

describe("the pattern types", () => {
  test("are log and trace rules' both, and find postal codes and precise locations", () => {
    expect(LOG_SCRUB_PATTERN_TYPES).toEqual(
      expect.arrayContaining(["postalCode", "coordinates"]),
    );
    expect(TRACE_SCRUB_PATTERN_TYPES).toEqual(
      expect.arrayContaining(["postalCode", "coordinates"]),
    );
    expect(DATA_TYPE_OF_SCRUB_PATTERN_TYPE["postalCode"]).toBe("postal-code");
    expect(DATA_TYPE_OF_SCRUB_PATTERN_TYPE["coordinates"]).toBe("geolocation");
    expect(METRIC_FILTER_PATTERN_TYPES).toEqual(
      expect.arrayContaining(["postalCode", "coordinates"]),
    );
  });

  test("compile to a pattern of the detectors, a new one each time", () => {
    expect(POSTAL_CODE.source).toBe(
      POSTAL_CODE_DETECTORS.map((detector: DataTypeDetector): string => {
        return `(?:${detector.pattern.source})`;
      }).join("|"),
    );
    expect(COORDINATES.source).toContain(
      COORDINATE_DETECTORS[0]!.pattern.source,
    );
    expect(compileBuiltInScrubPattern(LogScrubPatternType.PostalCode)).not.toBe(
      POSTAL_CODE,
    );
  });

  test("are the very detectors the scanner runs", () => {
    expect(
      POSTAL_CODE_DETECTORS.map((detector: DataTypeDetector): string => {
        return detector.dataTypeId;
      }),
    ).toEqual(["postal-code", "postal-code", "postal-code"]);
    expect(
      COORDINATE_DETECTORS.map((detector: DataTypeDetector): string => {
        return detector.dataTypeId;
      }),
    ).toEqual(["geolocation", "geolocation"]);
  });
});

describe("a Postal Code rule", () => {
  test.each([
    ["a UK postcode", "shipped to SW1A 2AA today", ["SW1A 2AA"]],
    ["a Canadian postal code", "office at K1A 0B1 ok", ["K1A 0B1"]],
    ["a Canadian postal code with no space", "office at K1A0B1 ok", ["K1A0B1"]],
    ["a US ZIP code beside zip", "shipped to zip 94107 ok", ["94107"]],
    ["a ZIP+4 beside zip code", "zip code: 94107-1234", ["94107-1234"]],
    ["a ZIP code beside zipcode", '{"zipcode": "10001"}', ["10001"]],
    ["a ZIP code beside postal", "postal 30301 ok", ["30301"]],
    ["a ZIP code, its word right after it", "94107 zip", ["94107"]],
    [
      "a UK postcode typed in fullwidth letters",
      "送付先 ＳＷ１Ａ ２ＡＡ",
      ["ＳＷ１Ａ ２ＡＡ"],
    ],
    [
      "a UK postcode in a URL",
      "GET /x?postcode=SW1A+2AA HTTP/1.1",
      ["SW1A+2AA"],
    ],
    [
      "a ZIP code in fullwidth digits beside zip",
      "zip ９４１０７ ok",
      ["９４１０７"],
    ],
  ])("hides %s: %s", (_label: string, text: string, hidden: Array<string>) => {
    expect(textsOf(text, POSTAL_CODE.matchRanges(text))).toEqual(hidden);
    expect(detectorsFind(POSTAL_CODE_DETECTORS, undefined, text)).toEqual(
      hidden,
    );
    expect(textsOf(text, findPostalCodeRanges(text))).toEqual(hidden);
  });

  test.each([
    ["five digits beside no word", "order 94107 shipped"],
    ["five zeros beside zip", "zip 00000 ok"],
    ["a ZIP code too far after its word", `zip ${"x".repeat(24)} 94107`],
    ["five digits inside a longer number", "zip 941071 ok"],
    ["a word inside another", "unzip 94107 ok"],
    ["no postcode at all", "status ok, 3 of 5 done"],
  ])("keeps %s: %s", (_label: string, text: string) => {
    expect(POSTAL_CODE.matchRanges(text)).toEqual([]);
    expect(detectorsFind(POSTAL_CODE_DETECTORS, undefined, text)).toEqual([]);
  });

  test.each([
    ["address.zip", "94107"],
    ["shipping.postal_code", "94107-1234"],
    ["customer.zipcode", "10001"],
    ["billing.zip_code", "  30301  "],
    ["postcode", "94107"],
  ])("hides a ZIP code alone under %s: %s", (key: string, value: string) => {
    expect(foundUnder(POSTAL_CODE, key, value)).toEqual([value.trim()]);
    expect(detectorsFind(POSTAL_CODE_DETECTORS, key, value)).toEqual([
      value.trim(),
    ]);
  });

  test("keeps a ZIP code's digits under a key that names nothing, and five zeros under one that names it", () => {
    expect(foundUnder(POSTAL_CODE, "order.id", "94107")).toEqual([]);
    expect(foundUnder(POSTAL_CODE, "address.zip", "00000")).toEqual([]);
    // A UK postcode is one under any key.
    expect(foundUnder(POSTAL_CODE, "order.id", "SW1A 2AA")).toEqual([
      "SW1A 2AA",
    ]);
  });
});

describe("a Coordinates rule", () => {
  test.each([
    ["a pair", "at 51.50722, -0.12750 now", ["51.50722, -0.12750"]],
    ["a pair with no space", "at 51.50722,-0.12750 now", ["51.50722,-0.12750"]],
    ["one beside lat", "pin lat 51.50722 ok", ["51.50722"]],
    ["one beside lng", "pin lng -0.12750 ok", ["-0.12750"]],
    ["one beside lon", "pin lon -73.98566 ok", ["-73.98566"]],
    ["one beside latitude", "latitude: 40.74844", ["40.74844"]],
    [
      "one beside longitude, its word in a JSON key",
      '{"longitude": -73.98566}',
      ["-73.98566"],
    ],
  ])("hides %s: %s", (_label: string, text: string, hidden: Array<string>) => {
    expect(textsOf(text, COORDINATES.matchRanges(text))).toEqual(hidden);
    expect(detectorsFind(COORDINATE_DETECTORS, undefined, text)).toEqual(
      hidden,
    );
    expect(textsOf(text, findCoordinateRanges(text))).toEqual(hidden);
  });

  test.each([
    ["a decimal beside no word", "ratio 0.12345 ok"],
    ["a coordinate too imprecise to find a building", "lat 51.507 ok"],
    ["a pair too imprecise", "at 51.507, -0.127 now"],
    ["one beyond any longitude", "lng 190.12345 ok"],
    ["its word too far before it", `lat ${"x".repeat(16)} 51.50722`],
    ["a pair of zeros", "at 0.00000, 0.00000 now"],
  ])("keeps %s: %s", (_label: string, text: string) => {
    expect(COORDINATES.matchRanges(text)).toEqual([]);
    expect(detectorsFind(COORDINATE_DETECTORS, undefined, text)).toEqual([]);
  });

  test.each([
    ["location.lat", "51.50722"],
    ["device.lng", "-0.12750"],
    ["geo.latitude", "40.74844"],
    ["gps", "40.74844"],
  ])("hides one alone under %s: %s", (key: string, value: string) => {
    expect(foundUnder(COORDINATES, key, value)).toEqual([value]);
  });

  test("keeps a decimal under a key that names nothing", () => {
    expect(foundUnder(COORDINATES, "metrics.ratio", "0.12345")).toEqual([]);
    expect(foundUnder(COORDINATES, "device.battery", "0.87654")).toEqual([]);
  });
});

describe("the engines run them, under Redact, Mask and Hash", () => {
  test.each([
    [LogScrubAction.Redact, "[REDACTED]", "[REDACTED]"],
    [LogScrubAction.Mask, "9***7", "5******2"],
  ])(
    "a log's body and attributes, numbers under a key that names them too, under %s",
    (action: string, zip: string, latitude: string) => {
      const postal: JSONObject = LogScrubEngine.scrubLog(
        {
          body: "parcel shipped to zip 94107; the order number for it is 94107",
          attributes: { "address.zip": 94107, "order.id": 94107 },
        },
        [compiled(LogScrubPatternType.PostalCode, action)],
        null,
        { countValues: false },
      );
      const coordinates: JSONObject = LogScrubEngine.scrubLog(
        {
          body: "pin at lat 51.50722",
          attributes: { "location.lat": 51.50722, ratio: 0.5 },
        },
        [compiled(LogScrubPatternType.Coordinates, action)],
        null,
        { countValues: false },
      );

      expect(postal).toEqual({
        body: `parcel shipped to zip ${zip}; the order number for it is 94107`,
        attributes: { "address.zip": zip, "order.id": 94107 },
      });
      expect(coordinates).toEqual({
        body: `pin at lat ${latitude}`,
        attributes: { "location.lat": latitude, ratio: 0.5 },
      });
    },
  );

  test("a Hash token is the value's however it is written: a postcode typed in fullwidth or in a URL is SW1A 2AA's", () => {
    const token: string = ScrubAction.hash({
      match: "SW1A 2AA",
      patternType: LogScrubPatternType.PostalCode,
      projectId: PROJECT_ID,
    });

    for (const written of ["ＳＷ１Ａ ２ＡＡ", "SW1A+2AA", "SW1A%202AA"]) {
      expect([
        written,
        ScrubAction.hash({
          match: written,
          patternType: LogScrubPatternType.PostalCode,
          projectId: PROJECT_ID,
        }),
      ]).toEqual([written, token]);
    }

    // Mask keeps its first and last characters as it reads.
    expect(
      ScrubAction.mask("ＳＷ１Ａ ２ＡＡ", LogScrubPatternType.PostalCode),
    ).toBe(ScrubAction.mask("SW1A 2AA", LogScrubPatternType.PostalCode));
  });

  test("a span's attributes, an event's under its event's name, and a link's", () => {
    const row: JSONObject = TraceScrubEngine.scrubSpan(
      {
        name: "GET /store",
        attributes: { "store.zip": "94107", "store.id": "94107" },
        events: [{ name: "zip", attributes: { value: "94107" } }],
        links: [{ attributes: { "device.lat": "51.50722" } }],
      },
      [
        compileScrubRule({
          projectId: new ObjectID(PROJECT_ID),
          patternType: LogScrubPatternType.PostalCode,
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: TraceScrubField.All,
        })!,
        compileScrubRule({
          projectId: new ObjectID(PROJECT_ID),
          patternType: LogScrubPatternType.Coordinates,
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: TraceScrubField.All,
        })!,
      ],
      null,
      { countValues: false },
    );

    expect(row["attributes"]).toEqual({
      "store.zip": "[REDACTED]",
      "store.id": "94107",
    });
    expect(
      ((row["events"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "value"
      ],
    ).toBe("[REDACTED]");
    expect(
      ((row["links"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "device.lat"
      ],
    ).toBe("[REDACTED]");
  });
});

describe("a metric rule's Matches Pattern Type filter matches them", () => {
  function redact(
    dataTypeId: string,
    key: string,
    value: string | number,
  ): JSONObject {
    const rule: MetricPipelineRule = new MetricPipelineRule();

    rule.id = ObjectID.generate();
    rule.ruleType = MetricPipelineRuleType.RedactAttribute;
    rule.addAttributeKey = key;
    rule.redactReplacement = METRIC_REDACT_REPLACEMENT;
    rule.filters = buildMetricScrubFilters(dataTypeId, key);

    const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
      { name: "orders", attributes: { [key]: value }, attributeKeys: [key] },
      [rule],
      [],
    );

    return row!.attributes as JSONObject;
  }

  test.each([
    ["postal-code", "address.zip", "94107"],
    ["postal-code", "address.zip", 94107],
    ["postal-code", "store", "SW1A 2AA"],
    ["geolocation", "location.lat", "51.50722"],
    ["geolocation", "location.lat", 51.50722],
    ["geolocation", "location", "51.50722,-0.12750"],
  ])(
    "%s under %s: %s is redacted",
    (dataTypeId: string, key: string, value: string | number) => {
      expect(redact(dataTypeId, key, value)).toEqual({
        [key]: METRIC_REDACT_REPLACEMENT,
      });
    },
  );

  test.each([
    ["postal-code", "order.id", "94107"],
    ["postal-code", "address.zip", "00000"],
    ["geolocation", "metrics.ratio", "0.12345"],
    ["geolocation", "location.lat", "51.5"],
  ])(
    "%s under %s: %s is kept",
    (dataTypeId: string, key: string, value: string) => {
      expect(redact(dataTypeId, key, value)).toEqual({ [key]: value });
    },
  );
});

describe("they hide exactly what Data Security finds, and nothing it does not", () => {
  const TEXTS: ReadonlyArray<[string | undefined, string]> = [
    [undefined, "ship to SW1A 2AA or zip 94107; order 94107; K1A 0B1"],
    [
      undefined,
      "lat 51.50722 lng -0.12750 at 40.74844,-73.98566 ratio 0.12345",
    ],
    ["address.zip", "94107"],
    ["address.zip", "zip 94107-1234 and 12345"],
    ["location.lat", "51.50722"],
    ["metrics.ratio", "0.12345 lat 51.50722"],
    [undefined, "nothing here 12345 3.14159"],
  ];

  test.each(TEXTS)("under %s: %s", (key: string | undefined, text: string) => {
    expect(foundUnder(POSTAL_CODE, key, text)).toEqual(
      detectorsFind(POSTAL_CODE_DETECTORS, key, text),
    );
    expect(foundUnder(COORDINATES, key, text)).toEqual(
      detectorsFind(COORDINATE_DETECTORS, key, text),
    );
  });

  test("and a ZIP code's own detector needs its word or its key, as the scanner's does", () => {
    const zip: DataTypeDetector = POSTAL_CODE_DETECTORS.find(
      (detector: DataTypeDetector): boolean => {
        return Boolean(detector.requiresContext);
      },
    )!;

    expect(zip.keywords).toEqual(
      expect.arrayContaining(["zip", "zip code", "zipcode", "postal"]),
    );
    expect(
      findDetectorRanges([zip], "94107").length +
        findDetectorRanges([zip], "zip 94107").length,
    ).toBe(1);
  });

  test("text with no digit at all is read in no reading", () => {
    const ranges: Array<TextRange> = findPostalCodeRanges("");

    expect(ranges).toEqual([]);
    expect(findCoordinateRanges("")).toEqual([]);
  });
});
