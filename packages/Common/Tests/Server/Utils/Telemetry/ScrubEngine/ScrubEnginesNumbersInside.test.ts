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
  ScrubEngineRule,
} from "../../../../../Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import LogScrubEngine from "../../../../../Server/Utils/Telemetry/ScrubEngine/LogScrubEngine";
import TraceScrubEngine, {
  ExceptionContent,
} from "../../../../../Server/Utils/Telemetry/ScrubEngine/TraceScrubEngine";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../../../Types/Metrics/MetricPipelineRuleType";
import ObjectID from "../../../../../Types/ObjectID";
import { SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE } from "../../../../../Types/Telemetry/ScrubRuleKeys";
import TraceScrubField from "../../../../../Types/Trace/TraceScrubField";
import { findSensitiveValues } from "../../../../../Utils/DataSecurity/TextScanner";
import PatternWorkScope from "../../../../../Server/Utils/PatternWorkScope";
import { PatternWorkAllowance } from "../../../../../Utils/LinearRegExp/PatternWork";

/*
 * ---------------------------------------------------------------------------
 * A PHONE NUMBER OR SSN SENT AS A NUMBER INSIDE A LIST OR A MAP IS HIDDEN,
 * AS ONE SENT AS TEXT IS (#11500).
 *
 * The table stores a list or a map as its JSON text, and Data Security
 * reads that text: [{"system": "phone", "value": 2012345678}] holds a phone
 * number beside the key that names it, and [536221234] under
 * `customer.ssn` an SSN. A rule placed what it found there back on the
 * value's texts and dropped what fell on a number, so the number was kept
 * while coverage counted the rule. Now the number is written as the rule's
 * text, a string, as one alone under its key is - in a log's attributes, a
 * span's, an event's, a link's and an exception's, and in a metric's - and
 * a number nothing finds stays the number it is. A Custom Regex rule reads
 * the value's JSON text too, as it reads the same value sent as JSON text
 * (#11502), and a Named Attributes rule hides every number of a value it
 * names.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-000000115000";
const RULE_ID: string = "0192f1a0-0000-7000-8000-000000115001";

const ACTIONS: ReadonlyArray<string> = [
  LogScrubAction.Redact,
  LogScrubAction.Mask,
  LogScrubAction.Hash,
];

function compiled(rule: ScrubEngineRule): CompiledScrubRule {
  const result: CompiledScrubRule | null = compileScrubRule({
    _id: RULE_ID,
    projectId: new ObjectID(PROJECT_ID),
    ...rule,
  });

  expect(result).not.toBeNull();

  return result!;
}

function logRule(
  patternType: string,
  action: string = LogScrubAction.Redact,
  more: Partial<ScrubEngineRule> = {},
): CompiledScrubRule {
  return compiled({
    patternType,
    scrubAction: action,
    fieldsToScrub: LogScrubField.Both,
    ...more,
  });
}

function traceRule(
  patternType: string,
  action: string = LogScrubAction.Redact,
  more: Partial<ScrubEngineRule> = {},
): CompiledScrubRule {
  return compiled({
    patternType,
    scrubAction: action,
    fieldsToScrub: TraceScrubField.All,
    ...more,
  });
}

function scrubbedAttributes(
  attributes: JSONObject,
  rule: CompiledScrubRule,
): JSONObject {
  return LogScrubEngine.scrubLog(
    { body: "", attributes: JSON.parse(JSON.stringify(attributes)) },
    [rule],
    null,
    { countValues: false },
  )["attributes"] as JSONObject;
}

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

// What a rule leaves of a phone number, by its action.
function phoneLeft(action: string, digits: string): string {
  switch (action) {
    case LogScrubAction.Mask:
      return `***-***-${digits.slice(-4)}`;
    case LogScrubAction.Hash:
      return tokenOf(digits);
    default:
      return "[REDACTED]";
  }
}

function ssnLeft(action: string, digits: string): string {
  switch (action) {
    case LogScrubAction.Mask:
      return `***-**-${digits.slice(-4)}`;
    case LogScrubAction.Hash:
      return tokenOf(digits);
    default:
      return "[REDACTED]";
  }
}

// Whether Data Security finds a type in a value's JSON text, as the table stores it.
function dataSecurityFinds(value: unknown, dataTypeId: string): boolean {
  const text: string =
    typeof value === "string" ? value : JSON.stringify(value);

  return findSensitiveValues(text).some((match: { dataTypeId: string }) => {
    return match.dataTypeId === dataTypeId;
  });
}

describe("the log engine: a number inside a list or a map (#11500)", () => {
  test.each(
    ACTIONS.map((action: string): [string] => {
      return [action];
    }),
  )(
    "hides a phone number sent as a number beside the key that names it, under %s",
    (action: string) => {
      const attributes: JSONObject = scrubbedAttributes(
        {
          "customer.contacts": [
            { system: "phone", value: 2012345678 },
            { system: "email", value: "x" },
          ],
        },
        logRule(LogScrubPatternType.PhoneNumber, action),
      );

      expect(attributes["customer.contacts"]).toEqual([
        { system: "phone", value: phoneLeft(action, "2012345678") },
        { system: "email", value: "x" },
      ]);
      // What the table stores now holds no phone number for Data Security to find.
      expect(
        dataSecurityFinds(attributes["customer.contacts"], "phone-number"),
      ).toBe(false);
    },
  );

  test.each(
    ACTIONS.map((action: string): [string] => {
      return [action];
    }),
  )(
    "hides an SSN sent as a number in a list under a key that names it, under %s",
    (action: string) => {
      const attributes: JSONObject = scrubbedAttributes(
        { "customer.ssn": [536221234], "customer.tier": [3] },
        logRule(LogScrubPatternType.SSN, action),
      );

      expect(attributes).toEqual({
        "customer.ssn": [ssnLeft(action, "536221234")],
        "customer.tier": [3],
      });
    },
  );

  test("hides a number in a map beside a word another of its texts writes, deep in the value", () => {
    const attributes: JSONObject = scrubbedAttributes(
      {
        request: {
          customer: { contact: { kind: "mobile", number: 2012345678 } },
          retries: 3,
        },
      },
      logRule(LogScrubPatternType.PhoneNumber),
    );

    expect(attributes["request"]).toEqual({
      customer: { contact: { kind: "mobile", number: "[REDACTED]" } },
      retries: 3,
    });
  });

  test("keeps a number nothing names: an id, a count, a timestamp, under any key", () => {
    const attributes: JSONObject = {
      "order.items": [{ sku: "S-9", id: 2012345678, quantity: 2 }],
      "job.timestamps": [1732752000, 1732752060],
      "customer.contacts": [{ system: "order", value: 2012345678 }],
      "batch.ids": [536221234, 536221235],
    };

    for (const patternType of [
      LogScrubPatternType.PhoneNumber,
      LogScrubPatternType.SSN,
      LogScrubPatternType.PostalCode,
      LogScrubPatternType.Coordinates,
    ]) {
      expect([
        patternType,
        scrubbedAttributes(attributes, logRule(patternType)),
      ]).toEqual([patternType, attributes]);
    }
  });

  test("a number is still a number when nothing in it is hidden: the same value comes back", () => {
    const value: Array<JSONValue> = [
      { system: "phone", value: 2012345678 },
      { system: "phone", value: 42 },
    ];
    const attributes: JSONObject = scrubbedAttributes(
      { contacts: value },
      logRule(LogScrubPatternType.PhoneNumber),
    );

    // 42 beside "phone" is no phone number: kept as the number it is.
    expect(attributes["contacts"]).toEqual([
      { system: "phone", value: "[REDACTED]" },
      { system: "phone", value: 42 },
    ]);
    expect(
      typeof (attributes["contacts"] as Array<JSONObject>)[1]!["value"],
    ).toBe("number");
  });

  test("hides a US ZIP code and a lone coordinate sent as numbers beside their keys (#11502)", () => {
    expect(
      scrubbedAttributes(
        { shipping: { zip: 94107, weight: 12 } },
        logRule(LogScrubPatternType.PostalCode),
      ),
    ).toEqual({ shipping: { zip: "[REDACTED]", weight: 12 } });
    expect(
      scrubbedAttributes(
        { device: { lat: 51.50722, lng: -0.1275, battery: 0.87 } },
        logRule(LogScrubPatternType.Coordinates),
      ),
    ).toEqual({
      device: { lat: "[REDACTED]", lng: "[REDACTED]", battery: 0.87 },
    });
  });

  test("hides a coordinate pair sent as two numbers of a list, as Data Security finds the pair there", () => {
    const value: Array<number> = [51.50722, -0.1275];

    expect(dataSecurityFinds(value, "geolocation")).toBe(true);
    expect(
      scrubbedAttributes(
        { location: value },
        logRule(LogScrubPatternType.Coordinates),
      ),
    ).toEqual({ location: ["[REDACTED]", "[REDACTED]"] });
    // Two numbers too imprecise to find a building are no pair.
    expect(
      scrubbedAttributes(
        { location: [51.5, -0.12] },
        logRule(LogScrubPatternType.Coordinates),
      ),
    ).toEqual({ location: [51.5, -0.12] });
  });

  test("a rule that names attributes reads the numbers of those it names alone", () => {
    const rule: CompiledScrubRule = logRule(
      LogScrubPatternType.PhoneNumber,
      LogScrubAction.Redact,
      { attributeKeys: ["customer.contacts"] },
    );

    expect(
      scrubbedAttributes(
        {
          "customer.contacts": [{ system: "phone", value: 2012345678 }],
          "other.contacts": [{ system: "phone", value: 2012345678 }],
        },
        rule,
      ),
    ).toEqual({
      "customer.contacts": [{ system: "phone", value: "[REDACTED]" }],
      "other.contacts": [{ system: "phone", value: 2012345678 }],
    });
  });

  test("a rule of body only reads no attribute's numbers", () => {
    const rule: CompiledScrubRule = logRule(
      LogScrubPatternType.PhoneNumber,
      LogScrubAction.Redact,
      { fieldsToScrub: LogScrubField.Body },
    );
    const attributes: JSONObject = {
      contacts: [{ system: "phone", value: 2012345678 }],
    };

    expect(scrubbedAttributes(attributes, rule)).toEqual(attributes);
  });
});

describe("a Named Attributes rule hides the numbers of a value it names (#11500)", () => {
  test.each(
    ACTIONS.map((action: string): [string] => {
      return [action];
    }),
  )("under %s, in a log and in a span", (action: string) => {
    const value: JSONObject = {
      kind: "mobile",
      number: 2012345678,
      verified: true,
      tags: ["a", 7],
    };
    const rule: ScrubEngineRule = {
      patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
      scrubAction: action,
      attributeKeys: ["contact"],
    };
    const fromLog: JSONObject = scrubbedAttributes(
      { contact: value, other: { number: 2012345678 } },
      compiled({ ...rule, fieldsToScrub: LogScrubField.Attributes }),
    );
    const fromSpan: JSONObject = TraceScrubEngine.scrubSpan(
      {
        name: "GET /",
        attributes: { contact: JSON.parse(JSON.stringify(value)) },
        events: [],
        links: [],
      },
      [compiled({ ...rule, fieldsToScrub: TraceScrubField.All })],
      null,
      { countValues: false },
    )["attributes"] as JSONObject;

    for (const left of [fromLog["contact"], fromSpan["contact"]]) {
      const hidden: JSONObject = left as JSONObject;

      // Every text and number hidden; its keys, its true or false and its shape kept.
      expect(Object.keys(hidden)).toEqual([
        "kind",
        "number",
        "verified",
        "tags",
      ]);
      expect(typeof hidden["kind"]).toBe("string");
      expect(hidden["kind"]).not.toBe("mobile");
      expect(typeof hidden["number"]).toBe("string");
      expect(hidden["number"]).not.toContain("2012345678");
      expect(hidden["verified"]).toBe(true);
      expect((hidden["tags"] as Array<JSONValue>).length).toBe(2);
      expect(typeof (hidden["tags"] as Array<JSONValue>)[1]).toBe("string");
    }

    // A key it does not name keeps its value, numbers and all.
    expect(fromLog["other"]).toEqual({ number: 2012345678 });
  });
});

describe("the trace engine: a number inside a list or a map (#11500)", () => {
  test("in a span's, an event's and a link's attributes", () => {
    const value: () => Array<JSONValue> = (): Array<JSONValue> => {
      return [{ system: "phone", value: 2012345678 }];
    };
    const row: JSONObject = TraceScrubEngine.scrubSpan(
      {
        name: "POST /contacts",
        attributes: { contacts: value(), "customer.ssn": [536221234] },
        events: [{ name: "saved", attributes: { contacts: value() } }],
        links: [{ attributes: { contacts: value() } }],
      },
      [
        traceRule(LogScrubPatternType.PhoneNumber),
        traceRule(LogScrubPatternType.SSN),
      ],
      null,
      { countValues: false },
    );
    const hiddenContact: Array<JSONValue> = [
      { system: "phone", value: "[REDACTED]" },
    ];

    expect(row["attributes"]).toEqual({
      contacts: hiddenContact,
      "customer.ssn": ["[REDACTED]"],
    });
    expect(
      ((row["events"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "contacts"
      ],
    ).toEqual(hiddenContact);
    expect(
      ((row["links"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "contacts"
      ],
    ).toEqual(hiddenContact);
  });

  test("an event's attribute is read under its event's name: a list under a generic key of a `phone` event", () => {
    const row: JSONObject = TraceScrubEngine.scrubSpan(
      {
        name: "notify",
        attributes: {},
        events: [
          { name: "phone", attributes: { number: [2012345678] } },
          { name: "order", attributes: { number: [2012345678] } },
        ],
        links: [],
      },
      [traceRule(LogScrubPatternType.PhoneNumber)],
      null,
      { countValues: false },
    );
    const events: Array<JSONObject> = row["events"] as Array<JSONObject>;

    expect((events[0]!["attributes"] as JSONObject)["number"]).toEqual([
      "[REDACTED]",
    ]);
    expect((events[1]!["attributes"] as JSONObject)["number"]).toEqual([
      2012345678,
    ]);
  });

  test("an exception's attributes", () => {
    const content: ExceptionContent = TraceScrubEngine.scrubExceptionContent(
      {
        message: "save failed",
        stackTrace: "at save (app.js:1)",
        attributes: { contacts: [{ system: "fax", value: 2012345678 }] },
      },
      [
        compiled({
          patternType: LogScrubPatternType.PhoneNumber,
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: TraceScrubField.Events,
        }),
      ],
    );

    expect(content.attributes).toEqual({
      contacts: [{ system: "fax", value: "[REDACTED]" }],
    });
  });
});

describe("a Custom Regex rule reads a list or a map as its JSON text too (#11502)", () => {
  test("Scrub It's card security code rule hides a code beside the key that names it, in a map", () => {
    const rule: CompiledScrubRule = logRule(
      LogScrubPatternType.Custom,
      LogScrubAction.Redact,
      { customRegex: buildScrubPatternForDataType("card-verification-code")! },
    );

    expect(
      scrubbedAttributes(
        { payment: { cvv: "123", note: "cvv: 456", brand: "visa" } },
        rule,
      ),
    ).toEqual({
      payment: { cvv: "[REDACTED]", note: "cvv: [REDACTED]", brand: "visa" },
    });
    // As a number too, as the JSON text writes it.
    expect(scrubbedAttributes({ payment: { cvv: 987 } }, rule)).toEqual({
      payment: { cvv: "[REDACTED]" },
    });
  });

  test("Scrub It's secret rule hides a secret assigned to a key in a map, and never the key", () => {
    const secret: string = [
      "Nrzf",
      "DYlQ",
      "da06",
      "BJxh",
      "XRUj",
      "XClw",
    ].join("");
    const rule: CompiledScrubRule = logRule(
      LogScrubPatternType.Custom,
      LogScrubAction.Redact,
      { customRegex: buildScrubPatternForDataType("generic-secret")! },
    );
    const value: JSONObject = { name: "billing", api_key: secret };

    expect(dataSecurityFinds(value, "generic-secret")).toBe(true);

    const left: JSONObject = scrubbedAttributes({ config: value }, rule)[
      "config"
    ] as JSONObject;

    expect(Object.keys(left)).toEqual(["name", "api_key"]);
    expect(left["name"]).toBe("billing");
    expect(JSON.stringify(left)).not.toContain(secret);
    expect(dataSecurityFinds(left, "generic-secret")).toBe(false);
  });

  test("a person's pattern written against the JSON text matches a list's or a map's as it does a JSON text's", () => {
    const rule: CompiledScrubRule = logRule(
      LogScrubPatternType.Custom,
      LogScrubAction.Redact,
      { customRegex: '"password":"[^"]{1,64}"' },
    );
    const asText: JSONObject = scrubbedAttributes(
      { body: JSON.stringify({ user: "jane", password: "hunter2" }) },
      rule,
    );
    const asMap: JSONObject = scrubbedAttributes(
      { body: { user: "jane", password: "hunter2" } },
      rule,
    );

    expect(asText["body"]).not.toContain("hunter2");
    expect(asMap["body"]).toEqual({ user: "jane", password: "[REDACTED]" });
  });

  test("a pattern that finds nothing across the JSON text changes nothing, and reads each text as it always did", () => {
    const rule: CompiledScrubRule = logRule(
      LogScrubPatternType.Custom,
      LogScrubAction.Redact,
      { customRegex: "^secret-[0-9]{1,8}$" },
    );
    const attributes: JSONObject = {
      list: ["secret-42", "public", 42],
      map: { a: "secret-7", b: 1 },
    };

    // Anchored: the JSON text has no match, each text alone has.
    expect(scrubbedAttributes(attributes, rule)).toEqual({
      list: ["[REDACTED]", "public", 42],
      map: { a: "[REDACTED]", b: 1 },
    });
  });

  test("a map's key is never changed, even where the pattern finds it", () => {
    const rule: CompiledScrubRule = logRule(
      LogScrubPatternType.Custom,
      LogScrubAction.Redact,
      { customRegex: "token[0-9]{1,4}" },
    );

    expect(
      scrubbedAttributes({ map: { token1: "token22", other: "x" } }, rule),
    ).toEqual({ map: { token1: "[REDACTED]", other: "x" } });
  });

  /*
   * A pattern that cannot answer for the JSON text - the batch's work
   * allowance spent - would be taken as holding all of it, numbers and
   * all: each text is read alone then, as before, and scrubbed whole,
   * the list's shape and numbers kept.
   */
  test("with the batch's work allowance spent, each text is scrubbed whole and the numbers kept, as before", () => {
    const rule: CompiledScrubRule = logRule(
      LogScrubPatternType.Custom,
      LogScrubAction.Redact,
      { customRegex: "SECRET-[A-Z]+" },
    );
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
    });

    allowance.charge(1);

    expect(
      PatternWorkScope.run(allowance, (): JSONObject => {
        return scrubbedAttributes(
          { args: ["--key", "SECRET-ABC", 3, ["x"]], map: { pin: 1234 } },
          rule,
        );
      }),
    ).toEqual({
      args: ["[REDACTED]", "[REDACTED]", 3, ["[REDACTED]"]],
      map: { pin: 1234 },
    });
  });
});

function metricRow(attributes: JSONObject): MutableMetricRow {
  return {
    name: "signups",
    attributes: { ...attributes },
    attributeKeys: Object.keys(attributes).sort(),
  };
}

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

describe("a metric's attribute: a list or a map is read as its JSON text by a pattern filter (#11500)", () => {
  test.each([
    [
      "phone-number",
      "contacts",
      [{ system: "phone", value: 2012345678 }] as JSONValue,
    ],
    ["phone-number", "user.phone", [2012345678] as JSONValue],
    ["us-ssn", "customer.ssn", [536221234] as JSONValue],
    ["postal-code", "shipping", { zip: 94107 } as JSONValue],
    ["geolocation", "device", { lat: 51.50722, lng: -0.1275 } as JSONValue],
  ])(
    "Scrub It's rule for %s redacts %s holding it",
    (dataTypeId: string, key: string, value: JSONValue) => {
      const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
        metricRow({ [key]: value, region: "eu" }),
        [metricRedactRule(buildMetricScrubFilters(dataTypeId, key), key)],
        [],
      );

      expect(row!.attributes).toEqual({
        [key]: METRIC_REDACT_REPLACEMENT,
        region: "eu",
      });
    },
  );

  /*
   * What a filter reads in the JSON text it reads as it reads any text: a
   * Phone Number filter's own pattern takes any ten digits there, as in a
   * metric's text attribute, so the near misses hold none.
   */
  test("keeps a list or a map that holds none of the type", () => {
    for (const [dataTypeId, key, value] of [
      ["phone-number", "contacts", [{ system: "order", value: 4242 }]],
      ["phone-number", "contacts", [{ system: "phone", value: 4242 }]],
      ["us-ssn", "order.ids", [536221234]],
      ["postal-code", "shipping", { weight: 94107 }],
      ["geolocation", "device", { battery: 0.87654 }],
    ] as Array<[string, string, JSONValue]>) {
      const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
        metricRow({ [key]: value }),
        [metricRedactRule(buildMetricScrubFilters(dataTypeId, key), key)],
        [],
      );

      expect([dataTypeId, row!.attributes]).toEqual([
        dataTypeId,
        { [key]: value },
      ]);
    }
  });

  test("a Matches Regex filter reads a map's JSON text too, and another filter reads a value as it always did", () => {
    const regexRule: MetricPipelineRule = metricRedactRule(
      [
        {
          checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
          attributeKey: "payment",
          conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
          value: '"cvv":[0-9]{3}',
        },
      ],
      "payment",
    );
    const equalRule: MetricPipelineRule = metricRedactRule(
      [
        {
          checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
          attributeKey: "tags",
          conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
          value: "a,b",
        },
      ],
      "tags",
    );

    expect(
      MetricPipelineEngine.applyRules(
        metricRow({ payment: { cvv: 123 } }),
        [regexRule],
        [],
      )!.attributes,
    ).toEqual({ payment: METRIC_REDACT_REPLACEMENT });
    // Equal To compares a list as it always did: its items joined by commas.
    expect(
      MetricPipelineEngine.applyRules(
        metricRow({ tags: ["a", "b"] }),
        [equalRule],
        [],
      )!.attributes,
    ).toEqual({ tags: METRIC_REDACT_REPLACEMENT });
  });
});
