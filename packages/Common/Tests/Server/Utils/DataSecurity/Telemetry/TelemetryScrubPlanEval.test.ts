import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { getScrubTarget } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import {
  canMergeScrubRules,
  MergeableScrubRule,
  mergeScrubRuleKeys,
  mergeScrubRuleProofs,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubMerge";
import {
  planProvenScrubRule,
  ScrubPlanFindingRecord,
  ScrubRulePlanOfFinding,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlan";
import {
  proveScrubRule,
  readEachStatementOnce,
  ScrubProofOutcome,
  ScrubProofRowReader,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubProof";
import {
  ScrubRuleCandidate,
  ScrubRuleSource,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlanner";
import * as SecurityEventsFieldReaders from "../../../../../Server/Utils/SecurityEvent/SecurityEventsFieldReaders";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { ScrubTarget } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  getScrubRuleFingerprint,
  ScrubOverreach,
  ScrubRuleProof,
} from "../../../../../Types/Telemetry/ScrubRuleProof";
import { SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE } from "../../../../../Types/Telemetry/ScrubRuleKeys";
import { SecurityEventsTelemetrySource } from "../../../../../Types/Telemetry/TelemetryFieldReaders";

/*
 * THE RULE EACH FINDING GETS, ON THE RECORDS IT WAS SEEN IN (#10366): AN
 * EVAL SET.
 *
 * Each case is a finding - its data type, its place, the records it was
 * seen in and the newest of its service - and the rule it should get: the
 * planner's candidates, narrowest first, each proven by the verifier
 * through ingest's own engines, and the first that hides the data without
 * changing too much else chosen. No model is asked: a case fails when the
 * planner, the verifier or an engine changes what a finding gets.
 *
 * Then merging: one rule for several places does at each place what that
 * place's rule did, so their proofs add up to its own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000001036c0",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000001036c1";
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
  fingerprintKey: "plan-eval",
};

let rowCount: number = 0;

function attributeRow(key: string, value: string): JSONObject {
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

function spanRow(key: string, value: string): JSONObject {
  rowCount++;

  return {
    ownerId: CHECKOUT,
    recordTime: 1795000000000 + rowCount,
    readTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    readSpanId: ObjectID.generate().toString().slice(0, 16),
    readAttributes: [[key, value]],
    readEvents: [],
  };
}

// The kept records' read answers `kept`; the newest records' read, `newest`; each read once.
function reader(
  kept: Array<JSONObject>,
  newest: Array<JSONObject> = [],
): { read: ScrubProofRowReader; reads: () => number } {
  let reads: number = 0;

  return {
    read: async (): Promise<Array<JSONObject>> => {
      reads++;

      return reads === 1 ? kept : newest;
    },
    reads: (): number => {
      return reads;
    },
  };
}

function record(data: {
  dataTypeId: string;
  location: string;
  kind?: DataStoreKind;
  dataCategory?: DataCategory;
  kept?: boolean;
}): ScrubPlanFindingRecord {
  const kind: DataStoreKind = data.kind || DataStoreKind.TelemetryLogs;

  return {
    findingId: "0192f1a0-0000-7000-8000-0000001036cf",
    kind,
    dataTypeId: data.dataTypeId,
    dataCategory: data.dataCategory || null,
    location: data.location,
    target: getScrubTarget(kind, data.location) as ScrubTarget & {
      signal: "log" | "trace";
    },
    sampleRecords:
      data.kept === false
        ? []
        : [
            {
              time: "2026-11-22T09:30:00.000Z",
              logId: ObjectID.generate().toString(),
            },
          ],
    lastSeenAt: new Date("2026-11-22T09:30:00.000Z"),
  };
}

interface EvalCase {
  name: string;
  finding: ScrubPlanFindingRecord;
  kept: Array<JSONObject>;
  newest?: Array<JSONObject>;
  // Security Events reads logs (#10396): asked only for an IP address.
  securityEventsReadsLogs?: boolean;
  expect: {
    source: ScrubRuleSource;
    patternType: string;
    scrubAction: string;
    fieldsToScrub: string;
    attributeKeys?: Array<string>;
    isProven: boolean;
    overreach?: ScrubOverreach;
    hashesForSecurityEvents?: boolean;
  } | null;
}

const EVAL_SET: Array<EvalCase> = [
  {
    name: "an email in a log attribute: the email pattern, masked, in every attribute of its service",
    finding: record({
      dataTypeId: "email-address",
      location: "attributes.user.email",
    }),
    kept: [attributeRow("user.email", "jane.doe@acmecorp.io")],
    newest: [
      attributeRow("user.email", "bob.ray@globex.net"),
      attributeRow("user.email", "not provided"),
    ],
    expect: {
      source: ScrubRuleSource.TypePattern,
      patternType: LogScrubPatternType.Email,
      scrubAction: LogScrubAction.Mask,
      fieldsToScrub: LogScrubField.Attributes,
      isProven: true,
      overreach: ScrubOverreach.None,
    },
  },
  {
    name: "an email in a log body: the email pattern, in bodies",
    finding: record({ dataTypeId: "email-address", location: "body" }),
    kept: [bodyRow("Payment failed for jane.doe@acmecorp.io")],
    newest: [bodyRow("Payment retried")],
    expect: {
      source: ScrubRuleSource.TypePattern,
      patternType: LogScrubPatternType.Email,
      scrubAction: LogScrubAction.Mask,
      fieldsToScrub: LogScrubField.Body,
      isProven: true,
      overreach: ScrubOverreach.None,
    },
  },
  {
    name: "a card number in a span attribute: the card pattern, masked",
    finding: record({
      dataTypeId: "credit-card-number",
      location: "attributes.card",
      kind: DataStoreKind.TelemetryTraces,
    }),
    kept: [spanRow("card", "4539 1488 0343 6467")],
    newest: [spanRow("card", "declined")],
    expect: {
      source: ScrubRuleSource.TypePattern,
      patternType: LogScrubPatternType.CreditCard,
      scrubAction: LogScrubAction.Mask,
      fieldsToScrub: LogScrubField.Attributes,
      isProven: true,
      overreach: ScrubOverreach.None,
    },
  },
  {
    name: "a person's name under customer_name: the attribute, whole, masked",
    finding: record({
      dataTypeId: "person-name",
      location: "attributes.customer_name",
    }),
    kept: [attributeRow("customer_name", "Jane Doe")],
    newest: [attributeRow("customer_name", "Bob Smith")],
    expect: {
      source: ScrubRuleSource.NamedKeys,
      patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
      scrubAction: LogScrubAction.Mask,
      fieldsToScrub: LogScrubField.Attributes,
      attributeKeys: ["customer_name"],
      isProven: true,
      overreach: ScrubOverreach.None,
    },
  },
  {
    name: "a GitHub token in a log body: the token's own pattern, redacted",
    finding: record({
      dataTypeId: "github-token",
      location: "body",
      dataCategory: DataCategory.SecretsAndCredentials,
    }),
    kept: [
      bodyRow(
        // Made up, and put together here so no secret scanner reads it as one.
        `push rejected for token ${"ghp"}_R8x2Lq9VbN4mK7wP3tY6uJ1hG5fD0sA2zXcQ`,
      ),
    ],
    newest: [bodyRow("push accepted")],
    expect: {
      source: ScrubRuleSource.TypePattern,
      patternType: "custom",
      scrubAction: LogScrubAction.Redact,
      fieldsToScrub: LogScrubField.Body,
      isProven: true,
      overreach: ScrubOverreach.None,
    },
  },
  {
    name: "an IP address in logs Security Events reads: the address pattern, hashed, so Security Events still sees it (#10396)",
    finding: record({
      dataTypeId: "ip-address",
      location: "attributes.client.address",
    }),
    kept: [attributeRow("client.address", "185.220.101.42")],
    newest: [attributeRow("client.address", "unknown")],
    securityEventsReadsLogs: true,
    expect: {
      source: ScrubRuleSource.TypePattern,
      patternType: LogScrubPatternType.IPAddress,
      scrubAction: LogScrubAction.Hash,
      fieldsToScrub: LogScrubField.Attributes,
      isProven: true,
      overreach: ScrubOverreach.None,
      hashesForSecurityEvents: true,
    },
  },
  {
    name: "records that are gone: the narrowest rule, unproven - Scrub It makes it, OneUptime AI only proposes it",
    finding: record({
      dataTypeId: "email-address",
      location: "attributes.user.email",
      kept: false,
    }),
    kept: [],
    newest: [],
    expect: {
      source: ScrubRuleSource.TypePattern,
      patternType: LogScrubPatternType.Email,
      scrubAction: LogScrubAction.Mask,
      fieldsToScrub: LogScrubField.Attributes,
      isProven: false,
    },
  },
  {
    name: "a document's marking: no rule hides a document, so none is planned",
    finding: record({
      dataTypeId: "confidential-marking",
      location: "body",
      dataCategory: DataCategory.BusinessConfidential,
    }),
    kept: [bodyRow("CONFIDENTIAL: Q4 plan")],
    expect: null,
  },
];

beforeEach(() => {
  jest
    .spyOn(SecurityEventsFieldReaders, "findSecurityEventsSources")
    .mockResolvedValue({
      isChecked: true,
      sources: [SecurityEventsTelemetrySource.Logs],
    } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the rule each finding gets", () => {
  test.each(
    EVAL_SET.map((testCase: EvalCase): [string, EvalCase] => {
      return [testCase.name, testCase];
    }),
  )("%s", async (_name: string, testCase: EvalCase) => {
    if (!testCase.securityEventsReadsLogs) {
      jest
        .spyOn(SecurityEventsFieldReaders, "findSecurityEventsSources")
        .mockResolvedValue({ isChecked: true, sources: [] } as never);
    }

    const rows: { read: ScrubProofRowReader } = reader(
      testCase.kept,
      testCase.newest,
    );
    const planned: ScrubRulePlanOfFinding = await planProvenScrubRule({
      projectId: PROJECT_ID,
      finding: testCase.finding,
      serviceId: CHECKOUT,
      options: OPTIONS,
      now: NOW,
      readRows: rows.read,
    });

    if (!testCase.expect) {
      expect(planned.chosen).toBeNull();
      expect(planned.tried).toEqual([]);
      return;
    }

    const candidate: ScrubRuleCandidate = planned.chosen!.candidate;

    expect({
      source: candidate.source,
      patternType: candidate.patternType,
      scrubAction: candidate.scrubAction,
      fieldsToScrub: candidate.fieldsToScrub,
      attributeKeys: candidate.attributeKeys,
      isProven: planned.isProven,
      ...(testCase.expect.hashesForSecurityEvents
        ? { hashesForSecurityEvents: candidate.hashesForSecurityEvents }
        : {}),
    }).toEqual({
      source: testCase.expect.source,
      patternType: testCase.expect.patternType,
      scrubAction: testCase.expect.scrubAction,
      fieldsToScrub: testCase.expect.fieldsToScrub,
      attributeKeys: testCase.expect.attributeKeys,
      isProven: testCase.expect.isProven,
      ...(testCase.expect.hashesForSecurityEvents
        ? { hashesForSecurityEvents: true }
        : {}),
    });

    if (testCase.expect.overreach) {
      expect(planned.chosen!.overreach).toBe(testCase.expect.overreach);
      expect(planned.chosen!.outcome.covers).toBe(true);
    }
  });

  test("a secret under a key the type's pattern does not match: the pattern is proven not to hide it, so the attribute is hidden whole", async () => {
    const planned: ScrubRulePlanOfFinding = await planProvenScrubRule({
      projectId: PROJECT_ID,
      finding: record({
        dataTypeId: "generic-secret",
        location: "attributes.db.password",
        dataCategory: DataCategory.SecretsAndCredentials,
      }),
      serviceId: CHECKOUT,
      options: OPTIONS,
      now: NOW,
      readRows: reader(
        [attributeRow("db.password", "vH7#qL2!xT9$mR4@")],
        [attributeRow("db.password", "zP3&kW8*bN5^cJ1%")],
      ).read,
    });

    expect(planned.tried[0]!.candidate.source).toBe(
      ScrubRuleSource.TypePattern,
    );
    expect(planned.tried[0]!.outcome.covers).toBe(false);
    expect(planned.chosen!.candidate).toEqual(
      expect.objectContaining({
        source: ScrubRuleSource.NamedKeys,
        attributeKeys: ["db.password"],
        scrubAction: LogScrubAction.Redact,
      }),
    );
    expect(planned.isProven).toBe(true);
  });

  test("every candidate is proven on the very same records, read once", async () => {
    const rows: { read: ScrubProofRowReader; reads: () => number } = reader(
      [attributeRow("db.password", "vH7#qL2!xT9$mR4@")],
      [attributeRow("db.password", "zP3&kW8*bN5^cJ1%")],
    );

    const planned: ScrubRulePlanOfFinding = await planProvenScrubRule({
      projectId: PROJECT_ID,
      finding: record({
        dataTypeId: "generic-secret",
        location: "attributes.db.password",
        dataCategory: DataCategory.SecretsAndCredentials,
      }),
      serviceId: CHECKOUT,
      options: OPTIONS,
      now: NOW,
      readRows: rows.read,
    });

    expect(planned.tried.length).toBeGreaterThan(1);
    // The kept records' read and the newest's: once each, for every candidate.
    expect(rows.reads()).toBe(2);
  });

  test("OneUptime AI's candidates alone, once the planner's were tried", async () => {
    const planned: ScrubRulePlanOfFinding = await planProvenScrubRule({
      projectId: PROJECT_ID,
      finding: record({
        dataTypeId: "email-address",
        location: "attributes.user.email",
      }),
      serviceId: CHECKOUT,
      options: OPTIONS,
      now: NOW,
      readRows: reader([attributeRow("user.email", "jane.doe@acmecorp.io")])
        .read,
      onlyCandidates: [
        {
          source: ScrubRuleSource.OneUptimeAi,
          signal: "log",
          patternType: LogScrubPatternType.Custom,
          customRegex: "[a-z.]+@[a-z]+\\.io",
          attributeKeys: ["user.email"],
          scrubAction: LogScrubAction.Mask,
          fieldsToScrub: LogScrubField.Attributes,
        },
      ],
    });

    expect(planned.tried).toHaveLength(1);
    expect(planned.chosen!.candidate.source).toBe(ScrubRuleSource.OneUptimeAi);
    expect(planned.isProven).toBe(true);
  });
});

describe("one rule for several places", () => {
  function namedKeys(keys: Array<string>): MergeableScrubRule {
    return {
      signal: "log",
      patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
      attributeKeys: keys,
      scrubAction: LogScrubAction.Redact,
      fieldsToScrub: LogScrubField.Attributes,
      serviceId: CHECKOUT,
    };
  }

  test("rules that hide the same way in the same records merge; another action, service, pattern or reach does not", () => {
    expect(
      canMergeScrubRules(namedKeys(["db.password"]), namedKeys(["api_key"])),
    ).toBe(true);
    expect(
      canMergeScrubRules(namedKeys(["db.password"]), {
        ...namedKeys(["api_key"]),
        scrubAction: LogScrubAction.Mask,
      }),
    ).toBe(false);
    expect(
      canMergeScrubRules(namedKeys(["db.password"]), {
        ...namedKeys(["api_key"]),
        serviceId: "0192f1a0-0000-7000-8000-0000001036c2",
      }),
    ).toBe(false);
    expect(
      canMergeScrubRules(namedKeys(["db.password"]), {
        ...namedKeys([]),
        patternType: LogScrubPatternType.Email,
        attributeKeys: undefined,
      }),
    ).toBe(false);
    // Every attribute, and some: another reach.
    expect(
      canMergeScrubRules(
        { ...namedKeys([]), attributeKeys: undefined },
        namedKeys(["api_key"]),
      ),
    ).toBe(false);
    // The very same rule for every attribute: one.
    expect(
      canMergeScrubRules(
        {
          ...namedKeys([]),
          patternType: LogScrubPatternType.Email,
          attributeKeys: undefined,
        },
        {
          ...namedKeys([]),
          patternType: LogScrubPatternType.Email,
          attributeKeys: undefined,
        },
      ),
    ).toBe(true);
  });

  test("keys where one names the other's parents never merge: one would reach what the other's proof never read", () => {
    expect(
      canMergeScrubRules(namedKeys(["db"]), namedKeys(["db.password"])),
    ).toBe(false);
    expect(
      canMergeScrubRules(
        namedKeys(["db.password"]),
        namedKeys(["DB.Password"]),
      ),
    ).toBe(true);
    expect(
      mergeScrubRuleKeys(["db.password"], ["DB.Password", "api_key"]),
    ).toEqual(["db.password", "api_key"]);
  });

  test("the merged rule does at each place what that place's rule did: its proof is theirs, added up, under its own fingerprint", async () => {
    const passwordRows: Array<JSONObject> = [
      attributeRow("db.password", "vH7#qL2!xT9$mR4@"),
    ];
    const keyRows: Array<JSONObject> = [
      attributeRow("api_key", "k3y-51HxT9mR4vH7qL2xZp3kW8bN5cJ1"),
    ];
    const proveOn: (
      keys: Array<string>,
      dataTypeId: string,
      location: string,
      rows: Array<JSONObject>,
    ) => Promise<ScrubProofOutcome> = async (
      keys: Array<string>,
      dataTypeId: string,
      location: string,
      rows: Array<JSONObject>,
    ): Promise<ScrubProofOutcome> => {
      return await proveScrubRule({
        projectId: PROJECT_ID,
        rule: { ...namedKeys(keys), serviceId: CHECKOUT },
        finding: {
          kind: DataStoreKind.TelemetryLogs,
          dataTypeId,
          location,
          sampleRecords: [
            {
              time: "2026-11-22T09:30:00.000Z",
              logId: ObjectID.generate().toString(),
            },
          ],
        },
        options: OPTIONS,
        now: NOW,
        readRows: readEachStatementOnce(reader(rows).read),
      });
    };

    const alone: Array<ScrubProofOutcome> = [
      await proveOn(
        ["db.password"],
        "generic-secret",
        "attributes.db.password",
        passwordRows,
      ),
      await proveOn(
        ["api_key"],
        "generic-secret",
        "attributes.api_key",
        keyRows,
      ),
    ];
    const merged: Array<ScrubProofOutcome> = [
      await proveOn(
        ["db.password", "api_key"],
        "generic-secret",
        "attributes.db.password",
        passwordRows,
      ),
      await proveOn(
        ["db.password", "api_key"],
        "generic-secret",
        "attributes.api_key",
        keyRows,
      ),
    ];

    // At each place, the same counts.
    for (const index of [0, 1]) {
      expect({
        ...merged[index]!.proof,
        fingerprint: "",
        provenAt: "",
      }).toEqual({ ...alone[index]!.proof, fingerprint: "", provenAt: "" });
    }

    const combined: ScrubRuleProof | null = mergeScrubRuleProofs({
      rule: namedKeys(["db.password", "api_key"]),
      proofs: alone.map((outcome: ScrubProofOutcome): ScrubRuleProof => {
        return outcome.proof;
      }),
      now: NOW,
    });

    expect(combined!.fingerprint).toBe(
      getScrubRuleFingerprint({
        ...namedKeys(["db.password", "api_key"]),
        serviceId: CHECKOUT,
      }),
    );
    expect(combined!.places).toHaveLength(2);
    expect(combined!.recordsRead).toBe(
      alone[0]!.proof.recordsRead + alone[1]!.proof.recordsRead,
    );
    // A merged rule is proven for all its places, or for none.
    expect(
      mergeScrubRuleProofs({
        rule: namedKeys(["db.password", "api_key"]),
        proofs: [alone[0]!.proof, null],
        now: NOW,
      }),
    ).toBeNull();
  });
});
