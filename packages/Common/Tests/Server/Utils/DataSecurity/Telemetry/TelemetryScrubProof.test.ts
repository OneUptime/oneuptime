import { describe, expect, test } from "@jest/globals";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import {
  combineScrubRuleProofs,
  proveMetricScrubRule,
  proveScrubRule,
  ScrubProofFailure,
  ScrubProofOutcome,
  ScrubProofRowReader,
  ScrubProofRule,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubProof";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../../../Types/Metrics/MetricPipelineRuleType";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  buildMetricScrubRule,
  getScrubTarget,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import {
  getMetricScrubRuleFingerprint,
  getScrubRuleFingerprint,
  ScrubRuleProof,
} from "../../../../../Types/Telemetry/ScrubRuleProof";
import TraceScrubField from "../../../../../Types/Trace/TraceScrubField";

/*
 * THE VERIFIER: A RULE PROVEN ON THE VERY RECORDS A FINDING WAS SEEN IN
 * (#10366).
 *
 * The records are stood in for by what the occurrences read returns - the
 * same columns the scan reads, at the place - so each case is the rule run
 * through ingest's own engines and the scanner's own matcher: what it hid,
 * what it left, and what else at the place it changed. No model is asked,
 * and nothing but counts comes back.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000001036b0",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000001036b1";
const NOW: Date = new Date("2026-11-22T10:00:00.000Z");

const OPTIONS: ContentScanOptions = {
  limits: {
    maxObjects: 2000,
    maxBytesPerObject: 65536,
    maxBytesTotal: 52428800,
    maxRowsPerTable: 1000,
    maxTables: 200,
    deadline: new Date("2026-11-22T11:00:00.000Z"),
  },
  customDetectors: [],
  extraHints: [],
  disabledDataTypeIds: new Set<string>(),
  allowedValues: new Set<string>(),
  exclusions: [],
  fingerprintKey: "proof-test",
};

let rowCount: number = 0;

// A log row as the occurrences read returns it: its time, its id and the attribute at the place.
function logRow(key: string, value: string): JSONObject {
  rowCount++;

  return {
    ownerId: CHECKOUT,
    recordTime: 1795000000000 + rowCount,
    readLogId: ObjectID.generate().toString(),
    readAttributes: [[key, value]],
  };
}

function bodyRow(body: string): JSONObject {
  rowCount++;

  return {
    ownerId: CHECKOUT,
    recordTime: 1795000000000 + rowCount,
    readLogId: ObjectID.generate().toString(),
    readBody: body,
  };
}

// The kept records' read answers `kept`; the newest records' read, `newest`.
function reader(
  kept: Array<JSONObject>,
  newest: Array<JSONObject> = [],
): ScrubProofRowReader {
  let reads: number = 0;

  return async (): Promise<Array<JSONObject>> => {
    reads++;

    return reads === 1 ? kept : newest;
  };
}

function rule(more: Partial<ScrubProofRule>): ScrubProofRule {
  return {
    signal: "log",
    patternType: LogScrubPatternType.Email,
    scrubAction: LogScrubAction.Redact,
    fieldsToScrub: LogScrubField.Attributes,
    serviceId: CHECKOUT,
    ...more,
  };
}

const KEPT_RECORD: Array<{ time: string; logId: string }> = [
  { time: "2026-11-22T09:30:00.000Z", logId: ObjectID.generate().toString() },
];

async function prove(data: {
  rule: ScrubProofRule;
  dataTypeId: string;
  location: string;
  kind?: DataStoreKind;
  readRows: ScrubProofRowReader;
  kept?: boolean;
}): Promise<ScrubProofOutcome> {
  return await proveScrubRule({
    projectId: PROJECT_ID,
    rule: data.rule,
    finding: {
      findingId: "0192f1a0-0000-7000-8000-0000001036bf",
      kind: data.kind || DataStoreKind.TelemetryLogs,
      dataTypeId: data.dataTypeId,
      location: data.location,
      sampleRecords: data.kept === false ? [] : KEPT_RECORD,
    },
    options: OPTIONS,
    now: NOW,
    readRows: data.readRows,
  });
}

describe("a rule that hides the finding's data", () => {
  test("an email rule on the finding's records: covers, and changes nothing else there", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({}),
      dataTypeId: "email-address",
      location: "attributes.user.email",
      readRows: reader(
        [logRow("user.email", "jane.doe@acmecorp.io")],
        [
          logRow("user.email", "bob.ray@globex.net"),
          logRow("user.email", "not provided"),
        ],
      ),
    });

    expect(outcome.failure).toBeUndefined();
    expect(outcome.covers).toBe(true);
    expect(outcome.overreach).toBe(0);
    expect(outcome.proof).toEqual(
      expect.objectContaining({
        findingRecordsRead: 1,
        recordsRead: 3,
        valuesWithData: 2,
        valuesStillWithData: 0,
        otherValues: 1,
        otherValuesChanged: 0,
        fingerprint: getScrubRuleFingerprint(rule({})),
        places: [
          {
            dataTypeId: "email-address",
            location: "attributes.user.email",
            kind: DataStoreKind.TelemetryLogs,
            findingId: "0192f1a0-0000-7000-8000-0000001036bf",
          },
        ],
      }),
    );
  });

  test("a Named Attributes rule for a person's name under customer_name: covers, though the name is found by the key", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({
        patternType: LogScrubPatternType.NamedKeys,
        attributeKeys: ["customer_name"],
        scrubAction: LogScrubAction.Mask,
      }),
      dataTypeId: "person-name",
      location: "attributes.customer_name",
      readRows: reader(
        [logRow("customer_name", "Jane Doe")],
        [logRow("customer_name", "Bob Smith")],
      ),
    });

    expect(outcome.covers).toBe(true);
    expect(outcome.proof.valuesWithData).toBe(2);
    expect(outcome.proof.valuesStillWithData).toBe(0);
    expect(outcome.overreach).toBe(0);
  });

  test("a mask that leaves the email detectable does not cover - nor does a rule for another key", async () => {
    const other: ScrubProofOutcome = await prove({
      rule: rule({
        patternType: LogScrubPatternType.NamedKeys,
        attributeKeys: ["user.name"],
      }),
      dataTypeId: "email-address",
      location: "attributes.user.email",
      readRows: reader([logRow("user.email", "jane.doe@acmecorp.io")]),
    });

    expect(other.covers).toBe(false);
    expect(other.proof.valuesStillWithData).toBe(1);
  });

  test("an email in a log body", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({ fieldsToScrub: LogScrubField.Body }),
      dataTypeId: "email-address",
      location: "body",
      readRows: reader([bodyRow("Payment failed for jane.doe@acmecorp.io")]),
    });

    expect(outcome.covers).toBe(true);
  });
});

describe("overreach", () => {
  test("a pattern that changes the place's other values says by how much", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({
        patternType: LogScrubPatternType.Custom,
        customRegex: "[a-z]+",
        attributeKeys: ["user.email"],
      }),
      dataTypeId: "email-address",
      location: "attributes.user.email",
      readRows: reader(
        [logRow("user.email", "jane.doe@acmecorp.io")],
        [
          logRow("user.email", "unknown"),
          logRow("user.email", "pending"),
          logRow("user.email", "1234"),
        ],
      ),
    });

    expect(outcome.covers).toBe(true);
    expect(outcome.proof.otherValues).toBe(3);
    expect(outcome.proof.otherValuesChanged).toBe(2);
    expect(outcome.overreach).toBeCloseTo(2 / 3);
  });

  test("a value that holds another sensitive type is no overreach", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({
        patternType: LogScrubPatternType.NamedKeys,
        attributeKeys: ["contact"],
      }),
      dataTypeId: "email-address",
      location: "attributes.contact",
      readRows: reader(
        [logRow("contact", "jane.doe@acmecorp.io")],
        [logRow("contact", "4539 1488 0343 6467")],
      ),
    });

    expect(outcome.proof.otherValues).toBe(0);
    expect(outcome.overreach).toBe(0);
  });
});

describe("what cannot be proven", () => {
  test("records that cannot be read", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({}),
      dataTypeId: "email-address",
      location: "attributes.user.email",
      readRows: async (): Promise<Array<JSONObject>> => {
        throw new Error("ClickHouse is away");
      },
    });

    expect(outcome.covers).toBe(false);
    expect(outcome.failure).toBe(ScrubProofFailure.CouldNotRead);
  });

  test("records that no longer hold the data", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({}),
      dataTypeId: "email-address",
      location: "attributes.user.email",
      readRows: reader([], [logRow("user.email", "n/a")]),
      kept: false,
    });

    expect(outcome.failure).toBe(ScrubProofFailure.NothingToProveOn);
    expect(outcome.covers).toBe(false);
  });

  // #10753: an exception is proven now; with no exception left, there is nothing to prove on.
  test("an exception's place with no exception left that holds the data", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({ signal: "trace", fieldsToScrub: TraceScrubField.Events }),
      dataTypeId: "email-address",
      location: "message",
      kind: DataStoreKind.TelemetryExceptions,
      readRows: reader([]),
    });

    expect(outcome.failure).toBe(ScrubProofFailure.NothingToProveOn);
  });

  test("a session replay's place: no rule is proven on recordings", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({}),
      dataTypeId: "email-address",
      location: "sessions.identifiedUserLabel",
      kind: DataStoreKind.TelemetrySessionReplays,
      readRows: reader([]),
    });

    expect(outcome.failure).toBe(ScrubProofFailure.NotProvable);
  });

  test("a rule that scrubs nothing", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({ patternType: LogScrubPatternType.Custom, customRegex: "(" }),
      dataTypeId: "email-address",
      location: "attributes.user.email",
      readRows: reader([logRow("user.email", "jane.doe@acmecorp.io")]),
    });

    expect(outcome.failure).toBe(ScrubProofFailure.RuleScrubsNothing);
  });
});

describe("records read twice, spans and their events", () => {
  test("a kept record the newest read finds again counts once", async () => {
    const row: JSONObject = logRow("user.email", "jane.doe@acmecorp.io");
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({}),
      dataTypeId: "email-address",
      location: "attributes.user.email",
      readRows: reader([row], [row]),
    });

    expect(outcome.proof.recordsRead).toBe(1);
    expect(outcome.proof.valuesWithData).toBe(1);
  });

  test("an email in a span event's attribute, hidden by an Event Attributes rule", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({
        signal: "trace",
        fieldsToScrub: TraceScrubField.Events,
      }),
      dataTypeId: "email-address",
      location: "events.login.user",
      kind: DataStoreKind.TelemetryTraces,
      readRows: reader([
        {
          ownerId: CHECKOUT,
          recordTime: 1795000009999,
          readTraceId: "t-1",
          readSpanId: "s-1",
          readEvents: [["login", [["user", '"jane.doe@acmecorp.io"']]]],
        },
      ]),
    });

    expect(outcome.covers).toBe(true);
    expect(outcome.proof.valuesWithData).toBe(1);
  });
});

/*
 * #10753: an exception's rule and a metric attribute's rule are proven
 * too - an exception read from the exceptions it was seen in and scrubbed
 * as ingest scrubs a span's exception event, a metric rule run on the
 * finding's data points through the engine ingest runs metric rules with.
 */
describe("an exception's rule, proven on its exceptions", () => {
  const TOKEN: string = ["ghp", "_R8sK2mQ9vX4tL7wN1pZ6cB3yH5jD0fG2aE8u"].join(
    "",
  );

  function exceptionRow(data: {
    message?: string;
    stackTrace?: string;
    attributes?: Array<[string, string]>;
  }): JSONObject {
    rowCount++;

    return {
      ownerId: CHECKOUT,
      recordTime: 1795000000000 + rowCount,
      readTraceId: `trace-${rowCount}`,
      readSpanId: `span-${rowCount}`,
      readFingerprint: "f",
      readName: "Error",
      ...(data.message !== undefined ? { readMessage: data.message } : {}),
      ...(data.stackTrace !== undefined
        ? { readStackTrace: data.stackTrace }
        : {}),
      ...(data.attributes ? { readAttributes: data.attributes } : {}),
    };
  }

  test("a secret in an exception's message: covers, and changes no other message", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({
        signal: "trace",
        patternType: LogScrubPatternType.Custom,
        customRegex: "ghp_[A-Za-z0-9]{36}",
        fieldsToScrub: TraceScrubField.Events,
      }),
      dataTypeId: "github-token",
      location: "message",
      kind: DataStoreKind.TelemetryExceptions,
      readRows: reader(
        [exceptionRow({ message: `push refused for token ${TOKEN}` })],
        [
          exceptionRow({ message: `push refused for token ${TOKEN}` }),
          exceptionRow({ message: "connection reset by peer" }),
          exceptionRow({ message: "timeout after 30s" }),
        ],
      ),
    });

    expect(outcome.failure).toBeUndefined();
    expect(outcome.covers).toBe(true);
    expect(outcome.overreach).toBe(0);
    expect(outcome.proof).toMatchObject({
      findingRecordsRead: 1,
      recordsRead: 4,
      valuesWithData: 2,
      valuesStillWithData: 0,
      otherValues: 2,
      otherValuesChanged: 0,
    });
    expect(outcome.proof.places[0]!.kind).toBe(
      DataStoreKind.TelemetryExceptions,
    );
  });

  test("an email in a stack trace, and one in an exception's attribute", async () => {
    const inStack: ScrubProofOutcome = await prove({
      rule: rule({ signal: "trace", fieldsToScrub: TraceScrubField.All }),
      dataTypeId: "email-address",
      location: "stackTrace",
      kind: DataStoreKind.TelemetryExceptions,
      readRows: reader([
        exceptionRow({
          stackTrace:
            "Error: no account for jane.doe@acmecorp.io\n    at find (users.js:4:9)",
        }),
      ]),
    });
    const inAttribute: ScrubProofOutcome = await prove({
      rule: rule({ signal: "trace", fieldsToScrub: TraceScrubField.Events }),
      dataTypeId: "email-address",
      location: "attributes.user.email",
      kind: DataStoreKind.TelemetryExceptions,
      readRows: reader([
        exceptionRow({
          attributes: [["user.email", "jane.doe@acmecorp.io"]],
        }),
      ]),
    });

    expect(inStack.covers).toBe(true);
    expect(inStack.proof.valuesWithData).toBe(1);
    expect(inAttribute.covers).toBe(true);
    expect(inAttribute.proof.valuesWithData).toBe(1);
  });

  test("a rule that does not reach exceptions - span names only - does not cover", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({ signal: "trace", fieldsToScrub: TraceScrubField.Name }),
      dataTypeId: "email-address",
      location: "message",
      kind: DataStoreKind.TelemetryExceptions,
      readRows: reader([
        exceptionRow({ message: "no account for jane.doe@acmecorp.io" }),
      ]),
    });

    expect(outcome.covers).toBe(false);
    expect(outcome.proof.valuesStillWithData).toBe(1);
  });

  test("a pattern too broad for the place says how many other messages it changed", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({
        signal: "trace",
        patternType: LogScrubPatternType.Custom,
        customRegex: "[a-z]+",
        fieldsToScrub: TraceScrubField.Events,
      }),
      dataTypeId: "github-token",
      location: "message",
      kind: DataStoreKind.TelemetryExceptions,
      readRows: reader([
        exceptionRow({ message: `token ${TOKEN}` }),
        exceptionRow({ message: "connection reset by peer" }),
      ]),
    });

    expect(outcome.proof.otherValues).toBe(1);
    expect(outcome.proof.otherValuesChanged).toBe(1);
    expect(outcome.overreach).toBe(1);
  });
});

describe("a metric attribute's rule, proven on its data points", () => {
  const SERVICE_ID: string = CHECKOUT;

  function metricRow(
    attributes: Array<[string, string]>,
    metricName: string = "http.server.requests",
  ): JSONObject {
    rowCount++;

    return {
      ownerId: SERVICE_ID,
      recordTime: 1795000000000 + rowCount,
      readMetricName: metricName,
      readAttributes: attributes,
    };
  }

  function metricRule(data: {
    key: string;
    pattern?: string | undefined;
    serviceId?: string | undefined;
  }): MetricPipelineRule {
    const made: MetricPipelineRule = new MetricPipelineRule();

    made.serviceId = new ObjectID(data.serviceId || SERVICE_ID);
    made.ruleType = MetricPipelineRuleType.RedactAttribute;
    made.addAttributeKey = data.key;
    made.redactReplacement = "[REDACTED]";
    made.filterCondition = FilterCondition.All;
    made.filters = data.pattern
      ? [
          {
            checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
            attributeKey: data.key,
            conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
            value: data.pattern,
          },
        ]
      : [];

    return made;
  }

  async function proveMetric(data: {
    rule: MetricPipelineRule;
    location: string;
    dataTypeId: string;
    readRows: ScrubProofRowReader;
  }): Promise<ScrubProofOutcome> {
    return await proveMetricScrubRule({
      projectId: PROJECT_ID,
      rule: data.rule,
      finding: {
        findingId: "0192f1a0-0000-7000-8000-0000001036be",
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: data.dataTypeId,
        location: data.location,
        sampleRecords: KEPT_RECORD,
      },
      options: OPTIONS,
      now: NOW,
      readRows: data.readRows,
    });
  }

  test("an email in a metric's label, redacted where it has the email's shape: covers, and changes no other value", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: metricRule({ key: "user", pattern: "[^@\\s]+@[^@\\s]+\\.[a-z]+" }),
      location: "attributes.user",
      dataTypeId: "email-address",
      readRows: reader(
        [metricRow([["user", "jane.doe@acmecorp.io"]])],
        [
          metricRow(
            [["user", "max.mustermann@acmecorp.io"]],
            "http.server.duration",
          ),
          metricRow([["user", "anonymous"]]),
          metricRow([["user", "service-account"]]),
        ],
      ),
    });

    expect(outcome.failure).toBeUndefined();
    expect(outcome.covers).toBe(true);
    expect(outcome.overreach).toBe(0);
    expect(outcome.proof).toMatchObject({
      findingRecordsRead: 1,
      recordsRead: 4,
      valuesWithData: 2,
      valuesStillWithData: 0,
      otherValues: 2,
      otherValuesChanged: 0,
    });
  });

  test("a rule with no pattern, hiding every value of the attribute, says how many other values it changed", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: metricRule({ key: "user" }),
      location: "attributes.user",
      dataTypeId: "email-address",
      readRows: reader([
        metricRow([["user", "jane.doe@acmecorp.io"]]),
        metricRow([["user", "anonymous"]]),
      ]),
    });

    expect(outcome.covers).toBe(true);
    expect(outcome.proof.otherValues).toBe(1);
    expect(outcome.proof.otherValuesChanged).toBe(1);
    expect(outcome.overreach).toBe(1);
  });

  // The very rule Scrub It makes for the finding (TelemetryScrubCoverage.buildMetricScrubRule).
  function scrubItRule(
    location: string,
    dataTypeId: string,
  ): MetricPipelineRule {
    return buildMetricScrubRule({
      projectId: PROJECT_ID,
      serviceId: SERVICE_ID,
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId,
      location,
      target: getScrubTarget(DataStoreKind.TelemetryMetrics, location)!,
    });
  }

  test("the very rule Scrub It makes for an email in a route: proven, the route's other values kept", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: scrubItRule("attributes.http.route", "email-address"),
      location: "attributes.http.route",
      dataTypeId: "email-address",
      readRows: reader(
        [metricRow([["http.route", "/users/jane.doe@acme-corp.com/orders"]])],
        [
          metricRow([["http.route", "/orders/:id"]]),
          metricRow([["http.route", "/users/max.mustermann@acme-corp.com"]]),
        ],
      ),
    });

    expect(outcome.failure).toBeUndefined();
    expect(outcome).toMatchObject({ covers: true, overreach: 0 });
    expect(outcome.proof).toMatchObject({
      valuesWithData: 2,
      valuesStillWithData: 0,
      otherValues: 1,
      otherValuesChanged: 0,
    });
  });

  /*
   * A metric rule told the values it hides by the type's pattern alone, and
   * Scrub It's pattern for an IP address held its IPv4 detector only: the
   * IPv6 one does not fit the 500 characters a scrub pattern is made in
   * beside it. So the rule left every IPv6 address, the proof said so, and
   * the rule was never made without a person. Since #10934 it matches the
   * IP Address pattern type - what an IP Address log or trace rule hides,
   * found by Data Security's own detectors - so it is proven where the
   * attribute holds IPv6 addresses too, and may be made on its own again.
   */
  test("the rule Scrub It makes for an IP address, proven where the attribute holds IPv4 addresses alone", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: scrubItRule("attributes.peer", "ip-address"),
      location: "attributes.peer",
      dataTypeId: "ip-address",
      readRows: reader(
        [metricRow([["peer", "81.2.69.160"]])],
        [
          metricRow([["peer", "185.199.108.153"]]),
          metricRow([["peer", "unknown"]]),
        ],
      ),
    });

    expect(outcome.failure).toBeUndefined();
    expect(outcome).toMatchObject({ covers: true, overreach: 0 });
    expect(outcome.proof).toMatchObject({
      valuesWithData: 2,
      valuesStillWithData: 0,
      otherValues: 1,
      otherValuesChanged: 0,
    });
  });

  test("proven where the attribute holds IPv6 addresses - of the shapes #10466 finds too, and right after a key's colon (#10936) - which it hides since #10934", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: scrubItRule("attributes.peer", "ip-address"),
      location: "attributes.peer",
      dataTypeId: "ip-address",
      readRows: reader(
        [metricRow([["peer", "2001::1"]])],
        [
          metricRow([["peer", "81.2.69.160"]]),
          metricRow([["peer", "2a00:1450:4001:82a::200e"]]),
          metricRow([["peer", "remote:2606:4700:4700::1111"]]),
          // A clock and a scope of hex digits: no address, as the scan reads them.
          metricRow([["peer", "12::30"]]),
        ],
      ),
    });

    expect(outcome.failure).toBeUndefined();
    expect(outcome.proof).toMatchObject({
      valuesWithData: 4,
      // Each address hidden, IPv4 and IPv6 alike.
      valuesStillWithData: 0,
      otherValues: 1,
      otherValuesChanged: 0,
    });
    expect(outcome).toMatchObject({ covers: true, overreach: 0 });
  });

  /*
   * And the IP Address pattern reads a value with its percent-escapes read
   * (#10467), as the scan does: an address written only percent-encoded
   * is hidden, where the pattern frozen into the rule before #10934 read
   * the value as written and left it.
   */
  test("proven where the address is written only percent-encoded, which the pattern type reads", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: scrubItRule("attributes.url.full", "ip-address"),
      location: "attributes.url.full",
      dataTypeId: "ip-address",
      readRows: reader([
        metricRow([
          [
            "url.full",
            "https://checkout.example.com/geo?client=81%2E2%2E69%2E160",
          ],
        ]),
        metricRow([
          [
            "url.full",
            "https://checkout.example.com/geo?client=2606%3A4700%3A%3A1111",
          ],
        ]),
      ]),
    });

    expect(outcome.proof.valuesWithData).toBe(2);
    expect(outcome.proof.valuesStillWithData).toBe(0);
    expect(outcome.covers).toBe(true);
  });

  /*
   * An address of no one - private, loopback, link-local - is no finding,
   * and the IP Address pattern keeps it, where the frozen IPv4 pattern
   * redacted every dotted quad: the rule changes none of the attribute's
   * other values.
   */
  test("keeps the attribute's private addresses, which the frozen IPv4 pattern redacted", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: scrubItRule("attributes.peer", "ip-address"),
      location: "attributes.peer",
      dataTypeId: "ip-address",
      readRows: reader(
        [metricRow([["peer", "81.2.69.160"]])],
        [
          metricRow([["peer", "10.0.0.12"]]),
          metricRow([["peer", "fe80::1"]]),
          metricRow([["peer", "127.0.0.1"]]),
        ],
      ),
    });

    expect(outcome.proof).toMatchObject({
      valuesWithData: 1,
      valuesStillWithData: 0,
      otherValues: 3,
      otherValuesChanged: 0,
    });
    expect(outcome).toMatchObject({ covers: true, overreach: 0 });
  });

  /*
   * #10935 and #10960: Scrub It's rule for an email address matches the
   * Email Address pattern type, which hides an address in a percent-encoded
   * URL and one in any script, as the scan finds them; and its rule for a
   * card the Credit Card Number pattern type, which hides one in any
   * script's digits.
   */
  test("the rule for an email address is proven where an address is percent-encoded or in another script", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: scrubItRule("attributes.http.target", "email-address"),
      location: "attributes.http.target",
      dataTypeId: "email-address",
      readRows: reader(
        [metricRow([["http.target", "/signup?email=jane.doe%40acmecorp.io"]])],
        [
          metricRow([["http.target", "/invite?to=张伟@acmecorp.io"]]),
          metricRow([["http.target", "/invite?to=почта@пример.рф"]]),
          metricRow([["http.target", "/orders/:id"]]),
        ],
      ),
    });

    expect(outcome.failure).toBeUndefined();
    expect(outcome.proof).toMatchObject({
      valuesWithData: 3,
      valuesStillWithData: 0,
      otherValues: 1,
      otherValuesChanged: 0,
    });
    expect(outcome.covers).toBe(true);
  });

  test("the rule for a card number is proven where a card is in fullwidth, Arabic-Indic or Persian digits", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: scrubItRule("attributes.payment.card", "credit-card-number"),
      location: "attributes.payment.card",
      dataTypeId: "credit-card-number",
      readRows: reader(
        [metricRow([["payment.card", "４５３２ ０１５１ １２８３ ０３６６"]])],
        [
          metricRow([["payment.card", "٤٥٣٢٠١٥١١٢٨٣٠٣٦٦"]]),
          metricRow([["payment.card", "۴۵۳۲-۰۱۵۱-۱۲۸۳-۰۳۶۶"]]),
          metricRow([["payment.card", "4532 0151 1283 0366"]]),
          metricRow([["payment.card", "none"]]),
        ],
      ),
    });

    expect(outcome.failure).toBeUndefined();
    expect(outcome.proof).toMatchObject({
      valuesWithData: 4,
      valuesStillWithData: 0,
      otherValues: 1,
      otherValuesChanged: 0,
    });
    expect(outcome.covers).toBe(true);
  });

  test("a label that is the data by its name: Scrub It's rule hides every value, and the proof counts the others it changes", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: scrubItRule("attributes.customer.full_name", "person-name"),
      location: "attributes.customer.full_name",
      dataTypeId: "person-name",
      readRows: reader(
        [metricRow([["customer.full_name", "Jane Doe"]])],
        [metricRow([["customer.full_name", "n/a"]])],
      ),
    });

    expect(outcome.proof.valuesStillWithData).toBe(0);
    expect(outcome.proof.otherValuesChanged).toBe(outcome.proof.otherValues);
  });

  test("a rule for another attribute does not cover", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: metricRule({ key: "account" }),
      location: "attributes.user",
      dataTypeId: "email-address",
      readRows: reader([metricRow([["user", "jane.doe@acmecorp.io"]])]),
    });

    expect(outcome.covers).toBe(false);
    expect(outcome.proof.valuesStillWithData).toBe(1);
  });

  test("its fingerprint is the rule's: its service, key, filters and replacement", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: metricRule({ key: "user", pattern: "x" }),
      location: "attributes.user",
      dataTypeId: "email-address",
      readRows: reader([metricRow([["user", "jane.doe@acmecorp.io"]])]),
    });
    const fingerprint: string = getMetricScrubRuleFingerprint({
      serviceId: SERVICE_ID,
      attributeKey: "user",
      filters: metricRule({ key: "user", pattern: "x" }).filters,
      filterCondition: FilterCondition.All,
      redactReplacement: "[REDACTED]",
    });

    expect(outcome.proof.fingerprint).toBe(fingerprint);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(
      getMetricScrubRuleFingerprint({
        serviceId: SERVICE_ID,
        attributeKey: "user",
        filters: metricRule({ key: "user", pattern: "y" }).filters,
        filterCondition: FilterCondition.All,
        redactReplacement: "[REDACTED]",
      }),
    ).not.toBe(fingerprint);
  });

  test("a metric's name, or a place of another kind, is no place a metric rule is proven on", async () => {
    for (const [location, kind] of [
      ["name", DataStoreKind.TelemetryMetrics],
      ["attributes.user", DataStoreKind.TelemetryLogs],
    ] as Array<[string, DataStoreKind]>) {
      const outcome: ScrubProofOutcome = await proveMetricScrubRule({
        projectId: PROJECT_ID,
        rule: metricRule({ key: "user" }),
        finding: {
          kind,
          dataTypeId: "email-address",
          location,
        },
        options: OPTIONS,
        now: NOW,
        readRows: reader([]),
      });

      expect([location, outcome.failure]).toEqual([
        location,
        ScrubProofFailure.NotProvable,
      ]);
    }
  });

  test("a rule that names no attribute, or no service, scrubs nothing", async () => {
    const noKey: MetricPipelineRule = metricRule({ key: "user" });

    noKey.addAttributeKey = "";

    expect(
      (
        await proveMetric({
          rule: noKey,
          location: "attributes.user",
          dataTypeId: "email-address",
          readRows: reader([]),
        })
      ).failure,
    ).toBe(ScrubProofFailure.RuleScrubsNothing);
  });

  test("data points that cannot be read prove nothing", async () => {
    const outcome: ScrubProofOutcome = await proveMetric({
      rule: metricRule({ key: "user" }),
      location: "attributes.user",
      dataTypeId: "email-address",
      readRows: async (): Promise<Array<JSONObject>> => {
        throw new Error("ClickHouse is down");
      },
    });

    expect(outcome.failure).toBe(ScrubProofFailure.CouldNotRead);
  });
});

describe("one rule's proofs over several places", () => {
  test("add up, with every place", () => {
    const one: ScrubRuleProof = {
      version: 1,
      provenAt: NOW.toISOString(),
      fingerprint: "0123456789abcdef",
      places: [
        { dataTypeId: "person-name", location: "attributes.a", kind: "Logs" },
      ],
      findingRecordsRead: 2,
      recordsRead: 5,
      valuesWithData: 4,
      valuesStillWithData: 0,
      otherValues: 1,
      otherValuesChanged: 0,
    };

    expect(
      combineScrubRuleProofs(
        [
          one,
          {
            ...one,
            places: [
              {
                dataTypeId: "person-name",
                location: "attributes.b",
                kind: "Logs",
              },
            ],
          },
        ],
        "fedcba9876543210",
        NOW,
      ),
    ).toEqual({
      ...one,
      fingerprint: "fedcba9876543210",
      places: [
        { dataTypeId: "person-name", location: "attributes.a", kind: "Logs" },
        { dataTypeId: "person-name", location: "attributes.b", kind: "Logs" },
      ],
      findingRecordsRead: 4,
      recordsRead: 10,
      valuesWithData: 8,
      otherValues: 2,
    });
  });
});
