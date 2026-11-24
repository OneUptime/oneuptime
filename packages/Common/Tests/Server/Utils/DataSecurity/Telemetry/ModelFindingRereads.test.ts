import { afterEach, describe, expect, jest, test } from "@jest/globals";
import TelemetryLeakFixReads, {
  LeakDataFound,
  LeakRowReader,
} from "../../../../../Server/Utils/AI/CodeFix/TelemetryLeakFixReads";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { ModelBudget } from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import { ModelRereads } from "../../../../../Server/Utils/DataSecurity/Model/ModelRereads";
import { RecognizerAvailability } from "../../../../../Server/Utils/DataSecurity/Model/NameAddressRecognizer";
import {
  SourceDefinition,
  TelemetrySampleCaps,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import {
  buildOccurrenceMatcher,
  findTelemetryFindingOccurrences,
  getOccurrencePrefilter,
  MAX_OCCURRENCES,
  MODEL_REREAD_VALUES_PER_ROUND,
  OccurrencePlan,
  planOccurrenceRead,
  readValuesAtLocation,
  readWithModelUntilFound,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import {
  planProvenScrubRule,
  ScrubRulePlanOfFinding,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlan";
import { ScrubRuleSource } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlanner";
import {
  proveScrubRule,
  readScrubPlaceValues,
  ScrubProofFailure,
  ScrubProofOutcome,
  ScrubProofRowReader,
  ScrubProofRule,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubProof";
import { TelemetrySampleSource } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetrySampleSource";
import {
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceExcerptPart,
  DataSecurityOccurrenceExcerptPartKind,
  DataSecurityOccurrencesSource,
  DataSecurityOccurrencesUnavailableReason,
} from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { FindingSampleRecord } from "../../../../../Types/DataSecurity/FindingSampleRecord";
import { ScrubbedField } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import FakeEntityRecognizer, {
  FakePhrase,
  ISSUE_PHRASES,
  ISSUE_SENTENCE,
} from "../Model/FakeEntityRecognizer";

/*
 * A FINDING THE NAMES-AND-ADDRESSES MODEL MADE, BEHAVING LIKE ANY OTHER
 * (#10926).
 *
 * The model finds a person's name or a street address in a log line; no
 * pattern can find it again. Before this, everything that reads a
 * finding's records again after its scan asked the detectors alone: Show
 * the records it was seen in listed none of them, Scrub It's proof found
 * nothing to prove a rule on - so no rule for it could be made without a
 * person - OneUptime AI had no values to shape a rule from, and the check
 * that a code fix worked found the leak gone. Each now hands the model the
 * values it reads, within a budget of its own, and these tests hold each
 * to what the model found - against the tests' fake recogniser, the
 * records stood in for by what the database would answer.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000109260",
);
const SERVICE: string = "0192f1a0-0000-7000-8000-000000109261";
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");

const OPTIONS: ContentScanOptions = {
  limits: {
    maxObjects: 2000,
    maxBytesPerObject: 65536,
    maxBytesTotal: 52428800,
    maxRowsPerTable: 1000,
    maxTables: 200,
    deadline: new Date(NOW.getTime() + 60 * 60 * 1000),
  },
  customDetectors: [],
  extraHints: [],
  disabledDataTypeIds: new Set<string>(),
  allowedValues: new Set<string>(),
  exclusions: [],
  fingerprintKey: "model-rereads",
};

const CAPS: TelemetrySampleCaps = {
  textLength: 8192,
  attributeValueLength: 4096,
  attributesPerRecord: 128,
  eventsPerSpan: 16,
  attributesPerEvent: 32,
};

// Names the fake model finds in these tests' lines, beside the issue's.
const PEOPLE: Array<string> = [
  "Lucia Fernandez",
  "Jonas Becker",
  "Amelie Laurent",
  "Giulia Romano",
  "Tiago Almeida",
  "Sanne de Vries",
  "Oliver Hughes",
  "Carmen Ruiz",
  "Lena Hoffmann",
  "Marco Bianchi",
  "Ines Costa",
  "Pieter Jansen",
];

const PHRASES: Array<FakePhrase> = [
  ...ISSUE_PHRASES,
  ...PEOPLE.map((name: string): FakePhrase => {
    return { text: name, dataTypeId: "person-name", score: 0.93 };
  }),
  // A placeholder: counted apart, never a record of a finding.
  { text: "Jane Doe", dataTypeId: "person-name", score: 0.97 },
];

let rowCount: number = 0;

function bodyRow(body: string, more: JSONObject = {}): JSONObject {
  rowCount++;

  return {
    ownerId: SERVICE,
    recordTime: String(NOW.getTime() - rowCount * 60_000),
    readLogId: ObjectID.generate().toString(),
    readBody: body,
    ...more,
  };
}

function attributeRow(key: string, value: string): JSONObject {
  rowCount++;

  return {
    ownerId: SERVICE,
    recordTime: String(NOW.getTime() - rowCount * 60_000),
    readLogId: ObjectID.generate().toString(),
    readAttributes: [[key, value]],
  };
}

function plan(location: string): OccurrencePlan {
  const planned: OccurrencePlan | null = planOccurrenceRead(
    DataStoreKind.TelemetryLogs,
    location,
  );

  expect(planned).not.toBeNull();

  return planned!;
}

function available(
  recognizer: FakeEntityRecognizer,
): () => Promise<RecognizerAvailability> {
  return async (): Promise<RecognizerAvailability> => {
    return { recognizer };
  };
}

const NOT_INSTALLED: () => Promise<RecognizerAvailability> =
  async (): Promise<RecognizerAvailability> => {
    return { reason: "the model's model_quantized.onnx is not installed" };
  };

const KEPT: Array<FindingSampleRecord> = [
  { time: "2026-11-24T11:30:00.000Z", logId: ObjectID.generate().toString() },
];

// Every text an object holds, for checking nothing raw leaves.
function rawNamesIn(value: unknown): Array<string> {
  const text: string = JSON.stringify(value);

  return [
    "Maria",
    "Gonzalez",
    "Calle",
    "Mayor",
    ...PEOPLE.flatMap((name: string): Array<string> => {
      return name.split(" ").filter((word: string): boolean => {
        return word.length > 3;
      });
    }),
  ].filter((word: string): boolean => {
    return text.includes(word);
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Show the records it was seen in, for a finding the model made", () => {
  async function find(data: {
    rows: Array<JSONObject>;
    dataTypeId?: string;
    location?: string;
    isFoundByModel?: boolean;
    recognizer?: FakeEntityRecognizer;
    getRecognizer?: () => Promise<RecognizerAvailability>;
    sampleRecords?: Array<FindingSampleRecord>;
    statements?: Array<Statement>;
    options?: ContentScanOptions;
  }): Promise<DataSecurityFindingOccurrences> {
    const location: string = data.location || "body";

    return await findTelemetryFindingOccurrences({
      projectId: PROJECT_ID,
      plan: plan(location),
      ownerId: SERVICE,
      location,
      dataTypeId: data.dataTypeId || "person-name",
      options: data.options || OPTIONS,
      sampleRecords: data.sampleRecords,
      lastSeenAt: new Date("2026-11-24T11:30:00.000Z"),
      now: NOW,
      isFoundByModel: data.isFoundByModel ?? true,
      getRecognizer:
        data.getRecognizer ||
        available(
          data.recognizer || new FakeEntityRecognizer({ phrases: PHRASES }),
        ),
      readRows: async (
        _source: SourceDefinition,
        statement: Statement,
      ): Promise<Array<JSONObject>> => {
        data.statements?.push(statement);
        return data.rows;
      },
    });
  }

  test("lists the very records the scan found the name in, masked as its samples are", async () => {
    const result: DataSecurityFindingOccurrences = await find({
      sampleRecords: KEPT,
      rows: [bodyRow(ISSUE_SENTENCE), bodyRow("Disk 3 is almost full")],
    });

    expect(result.source).toBe(DataSecurityOccurrencesSource.SampledRecords);
    expect(result.unavailableReason).toBeUndefined();
    expect(result.modelValuesNotRead).toBeUndefined();
    expect(result.occurrences.length).toBe(1);
    expect(result.occurrences[0]!.maskedValue).toBe("M****");
    expect(
      (result.occurrences[0]!.excerpt?.parts || []).map(
        (part: DataSecurityOccurrenceExcerptPart): string => {
          return `${part.kind}:${part.text}`;
        },
      ),
    ).toEqual([
      `${DataSecurityOccurrenceExcerptPartKind.Text}:Refund approved for `,
      `${DataSecurityOccurrenceExcerptPartKind.Match}:M****`,
      `${DataSecurityOccurrenceExcerptPartKind.Text}:, `,
      `${DataSecurityOccurrenceExcerptPartKind.Masked}:1****`,
      `${DataSecurityOccurrenceExcerptPartKind.Text}:, Madrid`,
    ]);
  });

  test("before #10926 it listed none: read without the model, the same records hold no name", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
    });
    const result: DataSecurityFindingOccurrences = await find({
      isFoundByModel: false,
      recognizer,
      sampleRecords: KEPT,
      rows: [bodyRow(ISSUE_SENTENCE)],
    });

    expect(result.occurrences).toEqual([]);
    // A finding of a pattern never asks for the model.
    expect(recognizer.calls).toBe(0);
  });

  test("a street address the model found, written as Spain writes one, is listed too", async () => {
    const result: DataSecurityFindingOccurrences = await find({
      dataTypeId: "postal-address",
      sampleRecords: KEPT,
      rows: [bodyRow(ISSUE_SENTENCE)],
    });

    expect(
      result.occurrences.map((occurrence: DataSecurityFindingOccurrence) => {
        return occurrence.maskedValue;
      }),
    ).toEqual(["1****"]);
  });

  test("nothing of a name or an address leaves but masked", async () => {
    const result: DataSecurityFindingOccurrences = await find({
      sampleRecords: KEPT,
      rows: [
        bodyRow(ISSUE_SENTENCE),
        ...PEOPLE.map((name: string): JSONObject => {
          return bodyRow(`Password reset requested by ${name}`);
        }),
      ],
    });

    expect(result.occurrences.length).toBe(MAX_OCCURRENCES);
    expect(rawNamesIn(result)).toEqual([]);
  });

  test("a placeholder name, and a name the project allows, are not records of it", async () => {
    const result: DataSecurityFindingOccurrences = await find({
      sampleRecords: KEPT,
      options: { ...OPTIONS, allowedValues: new Set(["jonas becker"]) },
      rows: [
        bodyRow("Welcome email sent to Jane Doe"),
        bodyRow("Invoice re-sent to Jonas Becker"),
        bodyRow("Invoice re-sent to Carmen Ruiz"),
      ],
    });

    expect(
      result.occurrences.map((occurrence: DataSecurityFindingOccurrence) => {
        return occurrence.excerpt?.parts[0]?.text;
      }),
    ).toEqual(["Invoice re-sent to "]);
  });

  test("the model is handed only the values at the finding's place, each once", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
    });

    await find({
      recognizer,
      sampleRecords: KEPT,
      rows: [
        bodyRow(ISSUE_SENTENCE, {
          readAttributes: [["customer", "Lucia Fernandez"]],
        }),
        bodyRow(ISSUE_SENTENCE),
        bodyRow("Order 7 shipped"),
      ],
    });

    expect(recognizer.given).toEqual([ISSUE_SENTENCE, "Order 7 shipped"]);
  });

  test("once the records to show are found, it is handed no more", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
    });
    const rows: Array<JSONObject> = Array.from(
      { length: 120 },
      (_: unknown, index: number): JSONObject => {
        return bodyRow(
          `Login ${index} by ${PEOPLE[index % PEOPLE.length]} from the app`,
        );
      },
    );
    const result: DataSecurityFindingOccurrences = await find({
      recognizer,
      rows,
    });

    expect(result.occurrences.length).toBe(MAX_OCCURRENCES);
    expect(recognizer.given.length).toBe(MODEL_REREAD_VALUES_PER_ROUND);
    expect(result.modelValuesNotRead).toBeUndefined();
  });

  test("a search for its records is not narrowed by its type's patterns, which cannot find what the model found", async () => {
    const statements: Array<Statement> = [];
    const narrowed: Array<Statement> = [];

    // The English street pattern narrows a search for a pattern's address.
    expect(
      getOccurrencePrefilter({
        dataTypeId: "postal-address",
        location: "body",
        options: OPTIONS,
      }),
    ).not.toBeNull();

    const found: DataSecurityFindingOccurrences = await find({
      dataTypeId: "postal-address",
      statements,
      rows: [bodyRow(ISSUE_SENTENCE)],
    });

    await find({
      dataTypeId: "postal-address",
      isFoundByModel: false,
      statements: narrowed,
      rows: [bodyRow(ISSUE_SENTENCE)],
    });

    expect(found.source).toBe(DataSecurityOccurrencesSource.SampleWindow);
    expect(found.occurrences.length).toBe(1);
    expect(statements.length).toBe(1);
    expect(narrowed[0]!.query).toContain("match(");
    expect(statements[0]!.query).not.toContain("match(");
  });

  test("where the model cannot run, it says so and reads no record", async () => {
    let reads: number = 0;
    const result: DataSecurityFindingOccurrences =
      await findTelemetryFindingOccurrences({
        projectId: PROJECT_ID,
        plan: plan("body"),
        ownerId: SERVICE,
        location: "body",
        dataTypeId: "person-name",
        options: OPTIONS,
        sampleRecords: KEPT,
        lastSeenAt: new Date("2026-11-24T11:30:00.000Z"),
        now: NOW,
        isFoundByModel: true,
        getRecognizer: NOT_INSTALLED,
        readRows: async (): Promise<Array<JSONObject>> => {
          reads++;
          return [bodyRow(ISSUE_SENTENCE)];
        },
      });

    expect(reads).toBe(0);
    expect(result.occurrences).toEqual([]);
    expect(result.unavailableReason).toBe(
      DataSecurityOccurrencesUnavailableReason.ModelUnavailable,
    );
    expect(result.lastSeenAt).toBe("2026-11-24T11:30:00.000Z");
  });

  test("when its time runs out, what it read is listed, and how many it had no time for is said", async () => {
    // Two seconds a line: ten lines read in the twenty seconds a read has.
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
      millisecondsPerText: 2000,
    });
    const rows: Array<JSONObject> = Array.from(
      { length: 40 },
      (_: unknown, index: number): JSONObject => {
        // One line in ten names someone: one of the ten read does.
        return bodyRow(
          index % 10 === 3
            ? `Address changed for ${PEOPLE[index % PEOPLE.length]}`
            : `Health check ${index} passed`,
        );
      },
    );
    const result: DataSecurityFindingOccurrences = await find({
      recognizer,
      rows,
    });

    expect(result.occurrences.length).toBe(1);
    expect(result.modelValuesNotRead).toBe(30);
    expect(result.isComplete).toBe(false);
  });

  test("handed in rounds: the rest are counted unread once the time is spent", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
      millisecondsPerText: 1000,
    });
    const model: ModelRereads | null = await ModelRereads.forFinding({
      isFoundByModel: true,
      getRecognizer: available(recognizer),
      budget: new ModelBudget({ scanLimitInMs: 5000, storeLimitInMs: 5000 }),
    });
    const values: Array<string> = Array.from(
      { length: 50 },
      (_: unknown, index: number): string => {
        return `Line ${index}`;
      },
    );

    await readWithModelUntilFound({
      model: model!,
      values,
      foundSoFar: (): number => {
        return 0;
      },
    });

    expect(model!.valuesRead).toBe(5);
    expect(model!.valuesNotRead).toBe(45);
    // Asked for the first round only: the time ran out in it.
    expect(recognizer.calls).toBe(1);
  });

  test("the values at a place, in the order the records are read, each once", () => {
    expect(
      readValuesAtLocation({
        source: TelemetrySampleSource.Logs,
        rows: [
          bodyRow("b", { readAttributes: [["note", "x"]] }),
          bodyRow("a"),
          bodyRow("b"),
          attributeRow("note", "y"),
        ],
        location: "body",
        caps: CAPS,
      }),
    ).toEqual(["b", "a"]);
  });
});

describe("the matcher, with what the model read", () => {
  test("a value is the type when the model found it there, however short, and not one it had no time for", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
    });
    const model: ModelRereads | null = await ModelRereads.forFinding({
      isFoundByModel: true,
      getRecognizer: available(recognizer),
    });

    await model!.read(["Carmen Ruiz", "Paid"]);

    const matcher: (value: string) => string | null = buildOccurrenceMatcher({
      dataTypeId: "person-name",
      location: "attributes.note",
      options: OPTIONS,
      model,
    });

    expect(matcher("Carmen Ruiz")).toBe("C****");
    expect(matcher("Paid")).toBeNull();
    // Never handed to the model: not judged, not a record of it.
    expect(matcher("Lena Hoffmann")).toBeNull();
  });
});

describe("Scrub It's proof, for a finding the model made", () => {
  const NOTE_RULE: ScrubProofRule = {
    signal: "log",
    patternType: LogScrubPatternType.NamedKeys,
    attributeKeys: ["note"],
    scrubAction: LogScrubAction.Redact,
    fieldsToScrub: LogScrubField.Attributes,
    serviceId: SERVICE,
  };

  function reader(
    kept: Array<JSONObject>,
    newest: Array<JSONObject> = [],
  ): ScrubProofRowReader & { calls: number } {
    let reads: number = 0;
    const read: ScrubProofRowReader & { calls: number } = Object.assign(
      async (): Promise<Array<JSONObject>> => {
        reads++;
        read.calls = reads;
        return reads === 1 ? kept : newest;
      },
      { calls: 0 },
    );

    return read;
  }

  async function prove(data: {
    rule: ScrubProofRule;
    dataTypeId?: string;
    location: string;
    readRows: ScrubProofRowReader;
    isFoundByModel?: boolean;
    recognizer?: FakeEntityRecognizer;
    getRecognizer?: () => Promise<RecognizerAvailability>;
    model?: ModelRereads | null;
  }): Promise<ScrubProofOutcome> {
    return await proveScrubRule({
      projectId: PROJECT_ID,
      rule: data.rule,
      finding: {
        findingId: "0192f1a0-0000-7000-8000-00000010926f",
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: data.dataTypeId || "person-name",
        location: data.location,
        sampleRecords: KEPT,
        isFoundByModel: data.isFoundByModel ?? true,
      },
      options: OPTIONS,
      now: NOW,
      readRows: data.readRows,
      model: data.model,
      getRecognizer:
        data.getRecognizer ||
        available(
          data.recognizer || new FakeEntityRecognizer({ phrases: PHRASES }),
        ),
    });
  }

  test("a rule that hides a free-text note's names is proven: it covers, and changes nothing else", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: NOTE_RULE,
      location: "attributes.note",
      readRows: reader(
        [attributeRow("note", `Called back: ${ISSUE_SENTENCE}`)],
        [
          attributeRow("note", "Customer Lucia Fernandez asked for a refund"),
          attributeRow("other", "Nothing to see"),
        ],
      ),
    });

    expect(outcome.failure).toBeUndefined();
    expect(outcome.covers).toBe(true);
    expect(outcome.proof.valuesWithData).toBe(2);
    expect(outcome.proof.valuesStillWithData).toBe(0);
    expect(outcome.proof.findingRecordsRead).toBe(1);
  });

  test("before #10926 nothing could be proven: read without the model, the values held no name", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: NOTE_RULE,
      location: "attributes.note",
      isFoundByModel: false,
      readRows: reader([
        attributeRow("note", `Called back: ${ISSUE_SENTENCE}`),
      ]),
    });

    expect(outcome.failure).toBe(ScrubProofFailure.NothingToProveOn);
  });

  test("a rule that leaves the name in the line does not cover it", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: {
        ...NOTE_RULE,
        patternType: LogScrubPatternType.Custom,
        customRegex: "[0-9]+ Calle [A-Za-z]+",
        attributeKeys: undefined,
        fieldsToScrub: LogScrubField.Body,
      },
      location: "body",
      readRows: reader([bodyRow(ISSUE_SENTENCE)]),
    });

    expect(outcome.covers).toBe(false);
    expect(outcome.proof.valuesWithData).toBe(1);
    expect(outcome.proof.valuesStillWithData).toBe(1);
  });

  test("the same rule hides the street address: an address finding is covered by it", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: {
        ...NOTE_RULE,
        patternType: LogScrubPatternType.Custom,
        customRegex: "[0-9]+ Calle [A-Za-z]+",
        attributeKeys: undefined,
        fieldsToScrub: LogScrubField.Body,
      },
      dataTypeId: "postal-address",
      location: "body",
      readRows: reader([bodyRow(ISSUE_SENTENCE)]),
    });

    expect(outcome.covers).toBe(true);
    expect(outcome.proof.valuesWithData).toBe(1);
  });

  test("a value naming someone else is no clean value: hiding it is no overreach", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: NOTE_RULE,
      dataTypeId: "postal-address",
      location: "attributes.note",
      readRows: reader(
        [attributeRow("note", `Ship to ${ISSUE_SENTENCE}`)],
        [
          attributeRow("note", "Ask Jonas Becker about the invoice"),
          attributeRow("note", "Nothing else to add"),
        ],
      ),
    });

    expect(outcome.covers).toBe(true);
    // Only the line naming nobody counts among the others.
    expect(outcome.proof.otherValues).toBe(1);
    expect(outcome.proof.otherValuesChanged).toBe(1);
    expect(outcome.overreach).toBe(1);
  });

  test("where the model cannot run, it is not proven, and no record is read", async () => {
    const read: ScrubProofRowReader & { calls: number } = reader([
      attributeRow("note", ISSUE_SENTENCE),
    ]);
    const outcome: ScrubProofOutcome = await prove({
      rule: NOTE_RULE,
      location: "attributes.note",
      readRows: read,
      getRecognizer: NOT_INSTALLED,
    });

    expect(outcome.failure).toBe(ScrubProofFailure.ModelUnavailable);
    expect(outcome.covers).toBe(false);
    expect(read.calls).toBe(0);
  });

  test("a value the model had no time for is not counted at all, nor one whose value after the rule it had no time for", async () => {
    // Three seconds a value: what a record held, then what the rule left of it.
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
      millisecondsPerText: 3000,
    });
    const outcome: ScrubProofOutcome = await prove({
      rule: NOTE_RULE,
      location: "attributes.note",
      recognizer,
      readRows: reader(
        [],
        PEOPLE.map((name: string): JSONObject => {
          return attributeRow("note", `Follow up with ${name} tomorrow`);
        }),
      ),
    });

    /*
     * 0 s: the first note, 3 s: "[REDACTED]", once for all of them; then a
     * note each 3 s until the twenty seconds are spent at the sixth.
     */
    expect(outcome.failure).toBeUndefined();
    expect(outcome.covers).toBe(true);
    expect(outcome.proof.valuesWithData).toBe(6);
    expect(outcome.proof.recordsRead).toBe(PEOPLE.length);
  });

  test("nothing of a value is in a proof: counts only", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: NOTE_RULE,
      location: "attributes.note",
      readRows: reader([attributeRow("note", ISSUE_SENTENCE)]),
    });

    expect(rawNamesIn(outcome)).toEqual([]);
  });
});

describe("a plan's rules share one read of the model", () => {
  test("each value is handed to the model once, however many rules are proven on it", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
    });
    const rows: Array<JSONObject> = [
      attributeRow("note", `Called back: ${ISSUE_SENTENCE}`),
      attributeRow("note", "Ticket closed by Oliver Hughes"),
    ];
    const plan: ScrubRulePlanOfFinding = await planProvenScrubRule({
      projectId: PROJECT_ID,
      finding: {
        findingId: "0192f1a0-0000-7000-8000-00000010926e",
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "person-name",
        location: "attributes.note",
        target: {
          signal: "log",
          field: ScrubbedField.Attributes,
          key: "note",
        },
        sampleRecords: KEPT,
        isFoundByModel: true,
      },
      serviceId: SERVICE,
      options: OPTIONS,
      now: NOW,
      onlyCandidates: [
        {
          source: ScrubRuleSource.OneUptimeAi,
          signal: "log",
          patternType: LogScrubPatternType.Custom,
          customRegex: "Oliver [A-Za-z]+",
          attributeKeys: ["note"],
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: LogScrubField.Attributes,
        },
        {
          source: ScrubRuleSource.NamedKeys,
          signal: "log",
          patternType: LogScrubPatternType.NamedKeys,
          attributeKeys: ["note"],
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: LogScrubField.Attributes,
        },
      ],
      readRows: async (): Promise<Array<JSONObject>> => {
        return rows;
      },
      getRecognizer: available(recognizer),
    });

    // The first hides one name of two; the second hides both, proven.
    expect(plan.tried.length).toBe(2);
    expect(plan.tried[0]!.outcome.covers).toBe(false);
    expect(plan.isProven).toBe(true);
    expect(plan.chosen?.candidate.source).toBe(ScrubRuleSource.NamedKeys);

    const handed: Map<string, number> = new Map();

    for (const text of recognizer.given) {
      handed.set(text, (handed.get(text) || 0) + 1);
    }

    for (const [text, times] of handed) {
      expect({ text, times }).toEqual({ text, times: 1 });
    }
  });

  test("where the model cannot run, no rule is proven: the first is offered unproven, as where the records are gone", async () => {
    const plan: ScrubRulePlanOfFinding = await planProvenScrubRule({
      projectId: PROJECT_ID,
      finding: {
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "person-name",
        location: "attributes.note",
        target: {
          signal: "log",
          field: ScrubbedField.Attributes,
          key: "note",
        },
        sampleRecords: KEPT,
        isFoundByModel: true,
      },
      serviceId: SERVICE,
      options: OPTIONS,
      now: NOW,
      readRows: async (): Promise<Array<JSONObject>> => {
        return [attributeRow("note", ISSUE_SENTENCE)];
      },
      getRecognizer: NOT_INSTALLED,
    });

    expect(plan.isProven).toBe(false);
    expect(plan.chosen?.candidate.source).toBe(ScrubRuleSource.NamedKeys);
    expect(plan.tried[0]!.outcome.failure).toBe(
      ScrubProofFailure.ModelUnavailable,
    );
  });
});

describe("the values OneUptime AI shapes a rule from", () => {
  test("those that name someone, apart from those that do not; none the model had no time for", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
      millisecondsPerText: 5000,
    });
    // The same records whichever read asks: the finding's own, then the newest.
    const rows: Array<JSONObject> = [
      bodyRow(ISSUE_SENTENCE),
      bodyRow("Cache warmed"),
      bodyRow("Ticket closed by Oliver Hughes"),
      bodyRow("Queue drained"),
      bodyRow("Login by Ines Costa"),
      bodyRow("Login by Pieter Jansen"),
    ];
    const values: { holding: Array<string>; others: Array<string> } | null =
      await readScrubPlaceValues({
        projectId: PROJECT_ID,
        finding: {
          kind: DataStoreKind.TelemetryLogs,
          dataTypeId: "person-name",
          location: "body",
          sampleRecords: KEPT,
          isFoundByModel: true,
        },
        serviceId: SERVICE,
        options: OPTIONS,
        now: NOW,
        readRows: async (): Promise<Array<JSONObject>> => {
          return rows;
        },
        getRecognizer: available(recognizer),
      });

    // Five seconds a value: four read in twenty.
    expect(values).toEqual({
      holding: [ISSUE_SENTENCE, "Ticket closed by Oliver Hughes"],
      others: ["Cache warmed", "Queue drained"],
    });
  });

  test("none where the model cannot run", async () => {
    expect(
      await readScrubPlaceValues({
        projectId: PROJECT_ID,
        finding: {
          kind: DataStoreKind.TelemetryLogs,
          dataTypeId: "person-name",
          location: "body",
          isFoundByModel: true,
        },
        serviceId: SERVICE,
        options: OPTIONS,
        now: NOW,
        readRows: async (): Promise<Array<JSONObject>> => {
          return [bodyRow(ISSUE_SENTENCE)];
        },
        getRecognizer: NOT_INSTALLED,
      }),
    ).toBeNull();
  });
});

describe("the check that a code fix stopped the leak", () => {
  function leakReader(
    rows: Array<JSONObject>,
    statements: Array<Statement> = [],
  ): LeakRowReader {
    return async (data: {
      statement: Statement;
    }): Promise<Array<JSONObject>> => {
      statements.push(data.statement);
      return rows;
    };
  }

  test("finds the names the deployed version still writes, by the model", async () => {
    const statements: Array<Statement> = [];
    const found: LeakDataFound = await TelemetryLeakFixReads.findDataAtPlaces({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryLogs,
      serviceId: SERVICE,
      places: [
        {
          dataTypeId: "postal-address",
          location: "body",
          isFoundByModel: true,
        },
      ],
      since: new Date(NOW.getTime() - 60 * 60 * 1000),
      until: NOW,
      version: "2.4.1",
      options: OPTIONS,
      readRows: leakReader(
        [
          bodyRow(ISSUE_SENTENCE, { readServiceVersion: "2.4.1" }),
          bodyRow("Checkout finished", { readServiceVersion: "2.4.1" }),
        ],
        statements,
      ),
      getRecognizer: available(new FakeEntityRecognizer({ phrases: PHRASES })),
    });

    expect(found).toEqual({
      recordsRead: 2,
      recordsWithData: 1,
      versions: ["2.4.1"],
    });
    // Not narrowed by the English street pattern, which cannot find it.
    expect(statements[0]!.query).not.toContain("match(");
  });

  test("before #10926 the leak looked fixed: without the model, no record held it", async () => {
    const found: LeakDataFound = await TelemetryLeakFixReads.findDataAtPlaces({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryLogs,
      serviceId: SERVICE,
      places: [{ dataTypeId: "person-name", location: "body" }],
      since: new Date(NOW.getTime() - 60 * 60 * 1000),
      until: NOW,
      options: OPTIONS,
      readRows: leakReader([bodyRow(ISSUE_SENTENCE)]),
    });

    expect(found.recordsWithData).toBe(0);
  });

  test("a record whose line the model had no time for is not counted as read", async () => {
    const found: LeakDataFound = await TelemetryLeakFixReads.findDataAtPlaces({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryLogs,
      serviceId: SERVICE,
      places: [
        { dataTypeId: "person-name", location: "body", isFoundByModel: true },
      ],
      since: new Date(NOW.getTime() - 60 * 60 * 1000),
      until: NOW,
      options: OPTIONS,
      readRows: leakReader(
        PEOPLE.map((name: string): JSONObject => {
          return bodyRow(`Session opened for ${name}`);
        }),
      ),
      getRecognizer: available(
        new FakeEntityRecognizer({
          phrases: PHRASES,
          millisecondsPerText: 4000,
        }),
      ),
    });

    // Four seconds a line: five lines in twenty.
    expect(found).toEqual({
      recordsRead: 5,
      recordsWithData: 5,
      versions: [],
    });
  });

  test("where the model cannot run, the read stops with an error, to be made again next time", async () => {
    await expect(
      TelemetryLeakFixReads.findDataAtPlaces({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryLogs,
        serviceId: SERVICE,
        places: [
          { dataTypeId: "person-name", location: "body", isFoundByModel: true },
        ],
        since: new Date(NOW.getTime() - 60 * 60 * 1000),
        until: NOW,
        options: OPTIONS,
        readRows: leakReader([bodyRow(ISSUE_SENTENCE)]),
        getRecognizer: NOT_INSTALLED,
      }),
    ).rejects.toThrow(
      "The names-and-addresses model cannot read the records at body: the model's model_quantized.onnx is not installed on this server.",
    );
  });
});
