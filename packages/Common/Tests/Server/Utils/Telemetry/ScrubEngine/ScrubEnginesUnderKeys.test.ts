import { describe, expect, test } from "@jest/globals";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import {
  buildMetricScrubFilters,
  CoveringScrubRule,
  findCoveringScrubRule,
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
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import MetricPipelineRuleType from "../../../../../Types/Metrics/MetricPipelineRuleType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  TelemetryFieldPart,
  TelemetryFieldUse,
} from "../../../../../Types/Telemetry/TelemetryFieldReaders";
import TraceScrubField from "../../../../../Types/Trace/TraceScrubField";
import {
  classifyField,
  FieldClassification,
} from "../../../../../Utils/DataSecurity/FieldClassifier";
import {
  compileScrubRuleReading,
  doesScrubRuleTakeFrom,
} from "../../../../../Utils/Telemetry/ScrubRuleFieldReads";

/*
 * ---------------------------------------------------------------------------
 * EVERY ENGINE HANDS A PHONE NUMBER OR SSN RULE THE KEY A VALUE IS HELD
 * UNDER, AND DATA SECURITY'S COVERAGE OF IT IS TRUE (#11383).
 *
 * The log engine (attributes, lists and maps, JSON texts, numbers), the
 * trace engine (a span's, a link's and an event's attributes - an event's
 * read under its event's name, as Data Security names them - and an
 * exception's), a metric pipeline rule's Matches Pattern Type filter, and
 * the lookup of what a rule takes from a saved query: each reads a value
 * under the key that holds it, under Redact, Mask and Hash, Hash giving
 * the token of the value as it reads. A text no key holds - a body, a
 * span's name - and a key that names nothing read as they always did.
 *
 * And the property coverage stands on: wherever Data Security finds a
 * phone number or an SSN by a field's name, the rule its coverage says
 * hides it there leaves no finding of the type - "covered" is never said
 * of a value that stays.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-000000113830";
const RULE_ID: string = "0192f1a0-0000-7000-8000-000000113831";

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

function ruleOf(
  patternType: string,
  action: string,
  more: Partial<ScrubEngineRule> = {},
): CompiledScrubRule {
  return compiled({
    patternType,
    scrubAction: action,
    fieldsToScrub: LogScrubField.Both,
    ...more,
  });
}

function traceRuleOf(
  patternType: string,
  action: string,
  more: Partial<ScrubEngineRule> = {},
): CompiledScrubRule {
  return compiled({
    patternType,
    scrubAction: action,
    fieldsToScrub: TraceScrubField.All,
    ...more,
  });
}

function scrubLog(
  row: JSONObject,
  rules: Array<CompiledScrubRule>,
): JSONObject {
  return LogScrubEngine.scrubLog(row, rules, null, { countValues: false });
}

function scrubSpan(
  row: JSONObject,
  rules: Array<CompiledScrubRule>,
): JSONObject {
  return TraceScrubEngine.scrubSpan(row, rules, null, { countValues: false });
}

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

// What a rule leaves of a whole value it hides, by its action.
interface Hidden {
  [LogScrubAction.Redact]: string;
  [LogScrubAction.Mask]: string;
  [LogScrubAction.Hash]: string;
}

function hidden(mask: string, reads: string): Hidden {
  return {
    [LogScrubAction.Redact]: "[REDACTED]",
    [LogScrubAction.Mask]: mask,
    [LogScrubAction.Hash]: tokenOf(reads),
  };
}

// A value under a key that names its type, and what each action leaves of it.
interface KeyedCase {
  label: string;
  patternType: string;
  key: string;
  value: string | number;
  left: Hidden;
}

const KEYED: ReadonlyArray<KeyedCase> = [
  {
    label: "a national number alone under user.phone",
    patternType: LogScrubPatternType.PhoneNumber,
    key: "user.phone",
    value: "02012345678",
    left: hidden("***-***-5678", "02012345678"),
  },
  {
    label: "one of nine digits under customer.mobile",
    patternType: LogScrubPatternType.PhoneNumber,
    key: "customer.mobile",
    value: "612345678",
    left: hidden("***-***-5678", "612345678"),
  },
  {
    label: "a whole value of a phone's shape under phone_number",
    patternType: LogScrubPatternType.PhoneNumber,
    key: "phone_number",
    value: "020 1234 5678",
    left: hidden("***-***-5678", "020 1234 5678"),
  },
  {
    label: "one in fullwidth digits under msisdn",
    patternType: LogScrubPatternType.PhoneNumber,
    key: "msisdn",
    value: "４４７７００９００１２３",
    left: hidden("***-***-0123", "447700900123"),
  },
  {
    label: "a phone number sent as a number under user.phone",
    patternType: LogScrubPatternType.PhoneNumber,
    key: "user.phone",
    value: 2012345678,
    left: hidden("***-***-5678", "2012345678"),
  },
  {
    label: "nine digits under customer.ssn",
    patternType: LogScrubPatternType.SSN,
    key: "customer.ssn",
    value: "536221234",
    left: hidden("***-**-1234", "536221234"),
  },
  {
    label: "nine digits under applicant.social_security_number",
    patternType: LogScrubPatternType.SSN,
    key: "applicant.social_security_number",
    value: "536221234",
    left: hidden("***-**-1234", "536221234"),
  },
  {
    label: "nine fullwidth digits under ssn",
    patternType: LogScrubPatternType.SSN,
    key: "ssn",
    value: "５３６２２１２３４",
    left: hidden("***-**-1234", "536221234"),
  },
  {
    label: "an SSN sent as a number under customer.ssn",
    patternType: LogScrubPatternType.SSN,
    key: "customer.ssn",
    value: 536221234,
    left: hidden("***-**-1234", "536221234"),
  },
];

const KEYED_CASES: Array<[string, string, KeyedCase]> = ACTIONS.flatMap(
  (action: string): Array<[string, string, KeyedCase]> => {
    return KEYED.map((keyed: KeyedCase): [string, string, KeyedCase] => {
      return [keyed.label, action, keyed];
    });
  },
);

// What no key names, or no check passes: kept, under every action.
const KEPT: ReadonlyArray<[string, string, string | number]> = [
  [LogScrubPatternType.PhoneNumber, "order.id", "02012345678"],
  [LogScrubPatternType.PhoneNumber, "request.number", "612345678"],
  [LogScrubPatternType.PhoneNumber, "user.phones", "02012345678"],
  [LogScrubPatternType.PhoneNumber, "duration_ns", 2012345678],
  [LogScrubPatternType.PhoneNumber, "user.phone", "000000000"],
  [LogScrubPatternType.PhoneNumber, "user.phone", "n/a"],
  [LogScrubPatternType.SSN, "order.id", "536221234"],
  [LogScrubPatternType.SSN, "customer.ref", 536221234],
  [LogScrubPatternType.SSN, "customer.ssn", "666221234"],
  [LogScrubPatternType.SSN, "customer.ssn", 123456789],
  [LogScrubPatternType.SSN, "customer.ssn", 5362212345],
];

describe("the log engine", () => {
  test.each(KEYED_CASES)(
    "hides %s under %s",
    (_label: string, action: string, keyed: KeyedCase) => {
      const row: JSONObject = scrubLog(
        {
          body: "signed up",
          attributes: { [keyed.key]: keyed.value, "http.method": "POST" },
        },
        [ruleOf(keyed.patternType, action)],
      );

      expect(row).toEqual({
        body: "signed up",
        attributes: {
          [keyed.key]: keyed.left[action as keyof Hidden],
          "http.method": "POST",
        },
      });
    },
  );

  test.each(KEPT)(
    "a %s rule keeps under %s what Data Security finds none of there: %s",
    (patternType: string, key: string, value: string | number) => {
      for (const action of ACTIONS) {
        const row: JSONObject = scrubLog(
          { body: "ok", attributes: { [key]: value } },
          [ruleOf(patternType, action)],
        );

        expect([action, row["attributes"]]).toEqual([action, { [key]: value }]);
      }
    },
  );

  test("reads a body as it is: no key names its value", () => {
    for (const [patternType, value] of [
      [LogScrubPatternType.PhoneNumber, "02012345678"],
      [LogScrubPatternType.SSN, "536221234"],
    ] as Array<[string, string]>) {
      expect(
        scrubLog({ body: value, attributes: {} }, [
          ruleOf(patternType, LogScrubAction.Redact),
        ])["body"],
      ).toBe(value);
    }
  });

  test("a list under a key that names it: each of its numbers hidden, its shape kept", () => {
    const row: JSONObject = scrubLog(
      {
        body: "",
        attributes: {
          "user.phone": ["02012345678", "n/a", "02087654321"],
          "customer.ssn": ["536221234", 7],
        },
      },
      [
        ruleOf(LogScrubPatternType.PhoneNumber, LogScrubAction.Redact),
        ruleOf(LogScrubPatternType.SSN, LogScrubAction.Redact),
      ],
    );

    expect(row["attributes"]).toEqual({
      "user.phone": ["[REDACTED]", "n/a", "[REDACTED]"],
      "customer.ssn": ["[REDACTED]", 7],
    });
  });

  test("a list of maps, read as Data Security reads its JSON text: a key and another value's word beside a number", () => {
    const contacts: Array<JSONObject> = [
      { system: "phone", value: "02012345678", use: "home" },
      {
        system: "email",
        note: "the account's own reference, as billing writes it",
        value: "02087654321",
      },
    ];
    const kin: Array<JSONObject> = [{ mobile: "02011112222" }];
    const row: JSONObject = scrubLog(
      {
        body: "",
        attributes: {
          "patient.telecom": contacts,
          "patient.kin": kin,
        },
      },
      [ruleOf(LogScrubPatternType.PhoneNumber, LogScrubAction.Redact)],
    );

    expect(row["attributes"]).toEqual({
      "patient.telecom": [
        { system: "phone", value: "[REDACTED]", use: "home" },
        contacts[1],
      ],
      "patient.kin": [{ mobile: "[REDACTED]" }],
    });
    // The values as the request sent them are left as they came.
    expect(contacts[0]!["value"]).toBe("02012345678");
  });

  test("a JSON text under a key that names it stays JSON, its number hidden", () => {
    const row: JSONObject = scrubLog(
      {
        body: "",
        attributes: {
          "customer.ssn": JSON.stringify({ primary: "536221234", count: 2 }),
        },
      },
      [ruleOf(LogScrubPatternType.SSN, LogScrubAction.Redact)],
    );

    expect(
      JSON.parse((row["attributes"] as JSONObject)["customer.ssn"] as string),
    ).toEqual({ primary: "[REDACTED]", count: 2 });
  });

  test("a rule that names attributes reads each under its own key, a dotted prefix too", () => {
    const row: JSONObject = scrubLog(
      {
        body: "",
        attributes: { "user.phone": "02012345678", "order.id": "02012345678" },
      },
      [
        ruleOf(LogScrubPatternType.PhoneNumber, LogScrubAction.Redact, {
          attributeKeys: ["user", "order.id"],
        }),
      ],
    );

    expect(row["attributes"]).toEqual({
      "user.phone": "[REDACTED]",
      "order.id": "02012345678",
    });
  });

  test("a body-only rule reads no attribute, under any key", () => {
    const row: JSONObject = scrubLog(
      { body: "", attributes: { "user.phone": "02012345678" } },
      [
        ruleOf(LogScrubPatternType.PhoneNumber, LogScrubAction.Redact, {
          fieldsToScrub: LogScrubField.Body,
        }),
      ],
    );

    expect(row["attributes"]).toEqual({ "user.phone": "02012345678" });
  });

  test("a Named Attributes rule hides a number it names too: whatever the attribute holds", () => {
    const row: JSONObject = scrubLog(
      {
        body: "",
        attributes: { "customer.ssn": 536221234, "customer.tier": 3 },
      },
      [
        compiled({
          patternType: LogScrubPatternType.NamedKeys,
          attributeKeys: ["customer.ssn"],
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: LogScrubField.Attributes,
        }),
      ],
    );

    expect(row["attributes"]).toEqual({
      "customer.ssn": "[REDACTED]",
      "customer.tier": 3,
    });
  });
});

describe("the trace engine", () => {
  test.each(KEYED_CASES)(
    "hides %s under %s in a span's, a link's and an event's attributes",
    (_label: string, action: string, keyed: KeyedCase) => {
      const left: string = keyed.left[action as keyof Hidden];
      const row: JSONObject = scrubSpan(
        {
          name: "POST /signup",
          attributes: { [keyed.key]: keyed.value },
          events: [
            { name: "verified", attributes: { [keyed.key]: keyed.value } },
          ],
          links: [{ attributes: { [keyed.key]: keyed.value } }],
        },
        [traceRuleOf(keyed.patternType, action)],
      );

      expect(row).toEqual({
        name: "POST /signup",
        attributes: { [keyed.key]: left },
        events: [{ name: "verified", attributes: { [keyed.key]: left } }],
        links: [{ attributes: { [keyed.key]: left } }],
      });
    },
  );

  test("reads an event's attribute under the name Data Security gives it: its event's name before a generic key", () => {
    const row: JSONObject = scrubSpan(
      {
        name: "notify",
        attributes: {},
        events: [
          { name: "phone", attributes: { number: "02012345678" } },
          { name: "order", attributes: { number: "02012345678" } },
        ],
        links: [],
      },
      [traceRuleOf(LogScrubPatternType.PhoneNumber, LogScrubAction.Redact)],
    );

    expect(row["events"]).toEqual([
      { name: "phone", attributes: { number: "[REDACTED]" } },
      { name: "order", attributes: { number: "02012345678" } },
    ]);
    // As Data Security finds them: the first event's, not the second's.
    expect(
      classifyField("events.phone.number", ["02012345678"]).map(
        (classification: FieldClassification): string => {
          return classification.dataTypeId;
        },
      ),
    ).toContain("phone-number");
    expect(
      classifyField("events.order.number", ["02012345678"]).map(
        (classification: FieldClassification): string => {
          return classification.dataTypeId;
        },
      ),
    ).not.toContain("phone-number");
  });

  test("reads a span's name and status message as they are: no key names them", () => {
    const row: JSONObject = scrubSpan(
      {
        name: "02012345678",
        statusMessage: "536221234",
        attributes: {},
        events: [],
        links: [],
      },
      [
        traceRuleOf(LogScrubPatternType.PhoneNumber, LogScrubAction.Redact),
        traceRuleOf(LogScrubPatternType.SSN, LogScrubAction.Redact),
      ],
    );

    expect(row["name"]).toBe("02012345678");
    expect(row["statusMessage"]).toBe("536221234");
  });

  test.each(
    ACTIONS.map((action: string): [string] => {
      return [action];
    }),
  )(
    "an exception's attributes are read under their keys, and its message as it is, under %s",
    (action: string) => {
      const content: ExceptionContent = TraceScrubEngine.scrubExceptionContent(
        {
          message: "lookup of 536221234 failed",
          stackTrace: "at verify (app.js:1)",
          attributes: { "customer.ssn": "536221234", attempt: 2 },
        },
        [
          compiled({
            patternType: LogScrubPatternType.SSN,
            scrubAction: action,
            fieldsToScrub: TraceScrubField.Events,
          }),
        ],
      );

      expect(content).toEqual({
        message: "lookup of 536221234 failed",
        stackTrace: "at verify (app.js:1)",
        attributes: {
          "customer.ssn": hidden("***-**-1234", "536221234")[
            action as keyof Hidden
          ],
          attempt: 2,
        },
      });
    },
  );
});

function metricRow(attributes: JSONObject): MutableMetricRow {
  return {
    name: "signups",
    attributes: { ...attributes },
    attributeKeys: Object.keys(attributes).sort(),
  };
}

function metricRedactRule(
  dataTypeId: string,
  attributeKey: string,
): MetricPipelineRule {
  const rule: MetricPipelineRule = new MetricPipelineRule();

  rule.id = ObjectID.generate();
  rule.ruleType = MetricPipelineRuleType.RedactAttribute;
  rule.addAttributeKey = attributeKey;
  // The filter "Scrub it" gives the rule: the type's Pattern Type, on its key.
  rule.filters = buildMetricScrubFilters(dataTypeId, attributeKey);

  return rule;
}

describe("a metric pipeline rule's Matches Pattern Type filter", () => {
  test.each([
    ["phone-number", "user.phone", "02012345678"],
    ["phone-number", "resource.user.phone", "02012345678"],
    ["phone-number", "phone_number", "020 1234 5678"],
    ["phone-number", "user.phone", 2012345678],
    ["us-ssn", "customer.ssn", "536221234"],
    ["us-ssn", "customer.ssn", 536221234],
  ])(
    "reads a %s under %s as the key says: %s redacted",
    (dataTypeId: string, key: string, value: string | number) => {
      const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
        metricRow({ [key]: value, region: "eu" }),
        [metricRedactRule(dataTypeId, key)],
        [],
      );

      expect(row!.attributes).toEqual({
        [key]: METRIC_REDACT_REPLACEMENT,
        region: "eu",
      });
    },
  );

  test.each([
    ["phone-number", "order.id", "02012345678"],
    ["phone-number", "user.phone", "000000000"],
    ["us-ssn", "order.id", "536221234"],
    ["us-ssn", "customer.ssn", "666221234"],
  ])(
    "keeps a %s under %s that Data Security finds none of there: %s",
    (dataTypeId: string, key: string, value: string) => {
      const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
        metricRow({ [key]: value }),
        [metricRedactRule(dataTypeId, key)],
        [],
      );

      expect(row!.attributes).toEqual({ [key]: value });
    },
  );
});

describe("what a rule takes from a saved query", () => {
  test("a filter for a number under a key that names it reads nothing once the rule runs", () => {
    for (const [patternType, key, value] of [
      [LogScrubPatternType.PhoneNumber, "user.phone", "02012345678"],
      [LogScrubPatternType.SSN, "customer.ssn", "536221234"],
    ] as Array<[string, string, string]>) {
      const rule: ReturnType<typeof compileScrubRuleReading> =
        compileScrubRuleReading({ signal: "log", patternType });

      expect(
        doesScrubRuleTakeFrom(rule, {
          signal: "log",
          serviceIds: null,
          part: TelemetryFieldPart.Attributes,
          key,
          use: TelemetryFieldUse.Filter,
          values: [value],
        }),
      ).toBe(true);
      // Under a key that names nothing, the value is kept: the query still reads it.
      expect(
        doesScrubRuleTakeFrom(rule, {
          signal: "log",
          serviceIds: null,
          part: TelemetryFieldPart.Attributes,
          key: "order.id",
          use: TelemetryFieldUse.Filter,
          values: [value],
        }),
      ).toBe(false);
    }
  });
});

/*
 * COVERAGE IS NEVER SAID OF A VALUE THAT STAYS.
 *
 * For each place a phone number or an SSN is found by its field's name -
 * a log's attribute, a span's, an event's, an exception's, a RUM
 * application's log and span, a metric point's - Data Security's finding
 * there is covered by the rule of its type, and that rule, run by the
 * engine of the place, leaves no finding of the type.
 */
interface Place {
  label: string;
  kind: DataStoreKind;
  location: string;
  signal: "log" | "trace" | "metric";
  // The value as the engine of the place leaves it, under a rule.
  scrub: (
    key: string,
    value: string | number,
    rule: CompiledScrubRule,
  ) => unknown;
  key: string;
}

function scrubbedLogAttribute(
  key: string,
  value: string | number,
  rule: CompiledScrubRule,
): unknown {
  return (
    scrubLog({ body: "", attributes: { [key]: value } }, [rule])[
      "attributes"
    ] as JSONObject
  )[key];
}

function scrubbedSpanAttribute(
  key: string,
  value: string | number,
  rule: CompiledScrubRule,
): unknown {
  return (
    scrubSpan(
      { name: "s", attributes: { [key]: value }, events: [], links: [] },
      [rule],
    )["attributes"] as JSONObject
  )[key];
}

const PLACES: ReadonlyArray<Place> = [
  {
    label: "a log's attribute",
    kind: DataStoreKind.TelemetryLogs,
    location: "attributes.KEY",
    signal: "log",
    scrub: scrubbedLogAttribute,
    key: "KEY",
  },
  {
    label: "a span's attribute",
    kind: DataStoreKind.TelemetryTraces,
    location: "attributes.KEY",
    signal: "trace",
    scrub: scrubbedSpanAttribute,
    key: "KEY",
  },
  {
    label: "an event's attribute",
    kind: DataStoreKind.TelemetryTraces,
    location: "events.verified.KEY",
    signal: "trace",
    scrub: (key: string, value: string | number, rule: CompiledScrubRule) => {
      const events: Array<JSONObject> = scrubSpan(
        {
          name: "s",
          attributes: {},
          events: [{ name: "verified", attributes: { [key]: value } }],
          links: [],
        },
        [rule],
      )["events"] as Array<JSONObject>;

      return (events[0]!["attributes"] as JSONObject)[key];
    },
    key: "KEY",
  },
  {
    label: "an exception's attribute",
    kind: DataStoreKind.TelemetryExceptions,
    location: "attributes.KEY",
    signal: "trace",
    scrub: (key: string, value: string | number, rule: CompiledScrubRule) => {
      return TraceScrubEngine.scrubExceptionContent(
        { message: "", stackTrace: "", attributes: { [key]: value } },
        [rule],
      ).attributes[key];
    },
    key: "KEY",
  },
  {
    label: "a RUM application's log",
    kind: DataStoreKind.TelemetrySessionReplays,
    location: "logs.attributes.KEY",
    signal: "log",
    scrub: scrubbedLogAttribute,
    key: "KEY",
  },
  {
    label: "a RUM application's span",
    kind: DataStoreKind.TelemetrySessionReplays,
    location: "spans.attributes.KEY",
    signal: "trace",
    scrub: scrubbedSpanAttribute,
    key: "KEY",
  },
];

const FOUND_BY_NAME: ReadonlyArray<[string, string, string, string | number]> =
  [
    [
      "phone-number",
      LogScrubPatternType.PhoneNumber,
      "user.phone",
      "02012345678",
    ],
    [
      "phone-number",
      LogScrubPatternType.PhoneNumber,
      "customer.mobile",
      "612345678",
    ],
    [
      "phone-number",
      LogScrubPatternType.PhoneNumber,
      "phone_number",
      "020 1234 5678",
    ],
    ["phone-number", LogScrubPatternType.PhoneNumber, "msisdn", 447700900123],
    ["us-ssn", LogScrubPatternType.SSN, "customer.ssn", "536221234"],
    ["us-ssn", LogScrubPatternType.SSN, "customer.ssn", 536221234],
    [
      "us-ssn",
      LogScrubPatternType.SSN,
      "social_security_number",
      "５３６２２１２３４",
    ],
  ];

// Whether Data Security finds a type in a field's values.
function isFound(
  location: string,
  value: unknown,
  dataTypeId: string,
): boolean {
  return classifyField(location, [value]).some(
    (classification: FieldClassification): boolean => {
      return classification.dataTypeId === dataTypeId;
    },
  );
}

describe("coverage is never said of a value that stays", () => {
  const cases: Array<
    [string, string, Place, [string, string, string, string | number]]
  > = PLACES.flatMap(
    (
      place: Place,
    ): Array<
      [string, string, Place, [string, string, string, string | number]]
    > => {
      return FOUND_BY_NAME.map(
        (
          found: [string, string, string, string | number],
        ): [
          string,
          string,
          Place,
          [string, string, string, string | number],
        ] => {
          return [`${found[2]}=${String(found[3])}`, place.label, place, found];
        },
      );
    },
  );

  test.each(cases)(
    "%s in %s: found, covered, and gone once its rule runs, under every action",
    (
      _value: string,
      _place: string,
      place: Place,
      [dataTypeId, patternType, key, value]: [
        string,
        string,
        string,
        string | number,
      ],
    ) => {
      const location: string = place.location.split(place.key).join(key);

      expect(isFound(location, value, dataTypeId)).toBe(true);

      const covering: CoveringScrubRule = {
        id: RULE_ID,
        name: "Scrub",
        signal: place.signal as "log" | "trace",
        patternType,
        fieldsToScrub:
          place.signal === "log" ? LogScrubField.Both : TraceScrubField.All,
      };

      expect(
        findCoveringScrubRule(
          { rules: [covering] },
          { kind: place.kind, dataTypeId, location },
        ),
      ).toBe(covering);

      for (const action of ACTIONS) {
        const rule: CompiledScrubRule =
          place.signal === "log"
            ? ruleOf(patternType, action)
            : traceRuleOf(patternType, action);
        const left: unknown = place.scrub(key, value, rule);

        expect([
          action,
          left === value,
          isFound(location, left, dataTypeId),
        ]).toEqual([action, false, false]);
      }
    },
  );

  test.each(FOUND_BY_NAME)(
    "a metric point's %s under %s=%s: found, covered by Scrub It's rule, and gone once it runs",
    (
      dataTypeId: string,
      _patternType: string,
      key: string,
      value: string | number,
    ) => {
      const location: string = `attributes.${key}`;

      expect(isFound(location, value, dataTypeId)).toBe(true);

      const rule: MetricPipelineRule = metricRedactRule(dataTypeId, key);
      const covering: CoveringScrubRule = {
        id: RULE_ID,
        name: "Scrub",
        signal: "metric",
        patternType: MetricPipelineRuleType.RedactAttribute,
        fieldsToScrub: "",
        attributeKey: key,
        filters: rule.filters,
      };

      expect(
        findCoveringScrubRule(
          { rules: [covering] },
          { kind: DataStoreKind.TelemetryMetrics, dataTypeId, location },
        ),
      ).toBe(covering);

      const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
        metricRow({ [key]: value }),
        [rule],
        [],
      );
      const left: unknown = (row!.attributes as JSONObject)[key];

      expect(left).toBe(METRIC_REDACT_REPLACEMENT);
      expect(isFound(location, left, dataTypeId)).toBe(false);
    },
  );
});
