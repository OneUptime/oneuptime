import { describe, expect, test } from "@jest/globals";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  combineScrubRuleProofs,
  proveScrubRule,
  ScrubProofFailure,
  ScrubProofOutcome,
  ScrubProofRowReader,
  ScrubProofRule,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubProof";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import {
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

  test("an exception's place: no rule is proven on exceptions", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: rule({ signal: "trace", fieldsToScrub: TraceScrubField.Events }),
      dataTypeId: "email-address",
      location: "message",
      kind: DataStoreKind.TelemetryExceptions,
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
