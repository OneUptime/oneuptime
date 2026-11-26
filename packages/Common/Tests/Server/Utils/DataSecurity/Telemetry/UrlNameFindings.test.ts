import { describe, expect, test } from "@jest/globals";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { RecognizerAvailability } from "../../../../../Server/Utils/DataSecurity/Model/NameAddressRecognizer";
import { SourceDefinition } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import {
  buildOccurrenceMatcher,
  findTelemetryFindingOccurrences,
  OccurrencePlan,
  planOccurrenceRead,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import {
  planProvenScrubRule,
  ScrubRulePlanOfFinding,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlan";
import { ScrubRuleSource } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlanner";
import {
  proveScrubRule,
  ScrubProofOutcome,
  ScrubProofRowReader,
  ScrubProofRule,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubProof";
import { DataSecurityFindingOccurrences } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
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
} from "../Model/FakeEntityRecognizer";

/*
 * A PERSON'S NAME PERCENT-ENCODED IN A URL, FROM THE SCAN TO THE RULE THAT
 * HIDES IT (#11034).
 *
 * Found by the names-and-addresses model where it runs - it reads a URL
 * with its escapes read - and, where it does not, by a query parameter
 * named for a person's name (full_name=...). Either way it behaves as any
 * finding: Show the records it was seen in lists the records that hold it,
 * masked, and Scrub It proves a rule on them - a Named Attributes rule over
 * the URL's attribute, a pattern rule written for the name as it reads -
 * that hides the name as it is written, escapes and all. Each name is made
 * up; the records are stood in for by what the database would answer.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000110340",
);
const SERVICE: string = "0192f1a0-0000-7000-8000-000000110341";
const NOW: Date = new Date("2026-11-26T12:00:00.000Z");

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
  fingerprintKey: "url-names",
};

const PHRASES: Array<FakePhrase> = [
  { text: "José García", dataTypeId: "person-name", score: 0.95 },
];

// A URL a query parameter named for a name holds one in; one that holds none.
const NAMED_URL: string =
  "/contacts?full_name=Lars+Eriksson&source=import&lang=en";
const ENCODED_NAMED_URL: string =
  "/contacts?full_name=Ottilie%20Quarrington&source=import";
const PLAIN_URL: string = "/contacts?page=2&source=import";
// A log line the model reads, its name under a parameter named "name" alone.
const MODEL_LINE: string =
  "GET /profile?name=Jos%C3%A9%20Garc%C3%ADa&tab=orders 200";

const KEPT: Array<FindingSampleRecord> = [
  { time: "2026-11-26T11:30:00.000Z", logId: ObjectID.generate().toString() },
];

let rowCount: number = 0;

function bodyRow(body: string): JSONObject {
  rowCount++;

  return {
    ownerId: SERVICE,
    recordTime: String(NOW.getTime() - rowCount * 60_000),
    readLogId: ObjectID.generate().toString(),
    readBody: body,
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

function rows(...values: Array<JSONObject>): ScrubProofRowReader {
  return async (): Promise<Array<JSONObject>> => {
    return values;
  };
}

// Whether any of the names' words is in what leaves a read.
function namesShownIn(value: unknown): Array<string> {
  const text: string = JSON.stringify(value);

  return ["Lars", "Eriksson", "Ottilie", "Quarrington", "Jos", "Garc"].filter(
    (word: string): boolean => {
      return text.includes(word);
    },
  );
}

async function occurrences(data: {
  location: string;
  rows: Array<JSONObject>;
  isFoundByModel: boolean;
  recognizer?: FakeEntityRecognizer;
}): Promise<DataSecurityFindingOccurrences> {
  return await findTelemetryFindingOccurrences({
    projectId: PROJECT_ID,
    plan: plan(data.location),
    ownerId: SERVICE,
    location: data.location,
    dataTypeId: "person-name",
    options: OPTIONS,
    sampleRecords: KEPT,
    lastSeenAt: new Date("2026-11-26T11:30:00.000Z"),
    now: NOW,
    isFoundByModel: data.isFoundByModel,
    getRecognizer: data.recognizer ? available(data.recognizer) : NOT_INSTALLED,
    readRows: async (
      _source: SourceDefinition,
      _statement: Statement,
    ): Promise<Array<JSONObject>> => {
      return data.rows;
    },
  });
}

describe("Show the records it was seen in", () => {
  test("a name a query parameter names: the URLs that hold one, masked, and no other", async () => {
    const result: DataSecurityFindingOccurrences = await occurrences({
      location: "attributes.http.url",
      isFoundByModel: false,
      rows: [
        attributeRow("http.url", NAMED_URL),
        attributeRow("http.url", PLAIN_URL),
        attributeRow("http.url", ENCODED_NAMED_URL),
      ],
    });

    expect(result.unavailableReason).toBeUndefined();
    expect(result.occurrences.length).toBe(2);
    expect(
      result.occurrences.map((occurrence: { maskedValue?: string }) => {
        return occurrence.maskedValue;
      }),
    ).toEqual(["L****", "O****"]);
    expect(namesShownIn(result)).toEqual([]);
  });

  test("a name the model found in a log line's encoded URL, as the scan found it", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: PHRASES,
    });
    const result: DataSecurityFindingOccurrences = await occurrences({
      location: "body",
      isFoundByModel: true,
      recognizer,
      rows: [bodyRow(MODEL_LINE), bodyRow("GET /profile?tab=orders 200")],
    });

    expect(result.occurrences.length).toBe(1);
    expect(result.occurrences[0]!.maskedValue).toBe("J****");
    // The model was handed the line as a URL reads.
    expect(recognizer.given).toContain(
      "GET /profile?name=José García&tab=orders 200",
    );
    expect(namesShownIn(result)).toEqual([]);
  });

  test("the matcher: a URL is a record of the name when its parameter names one", () => {
    const matcher: (value: string) => string | null = buildOccurrenceMatcher({
      dataTypeId: "person-name",
      location: "attributes.http.url",
      options: OPTIONS,
    });

    expect(matcher(NAMED_URL)).toBe("L****");
    expect(matcher(ENCODED_NAMED_URL)).toBe("O****");
    expect(matcher(PLAIN_URL)).toBeNull();
    expect(matcher("/contacts?name=Lars%20Eriksson")).toBeNull();
  });
});

describe("Scrub It's proof", () => {
  const URL_RULE: ScrubProofRule = {
    signal: "log",
    patternType: LogScrubPatternType.NamedKeys,
    attributeKeys: ["http.url"],
    scrubAction: LogScrubAction.Redact,
    fieldsToScrub: LogScrubField.Attributes,
    serviceId: SERVICE,
  };

  async function prove(data: {
    rule: ScrubProofRule;
    location: string;
    readRows: ScrubProofRowReader;
    isFoundByModel: boolean;
    recognizer?: FakeEntityRecognizer;
  }): Promise<ScrubProofOutcome> {
    return await proveScrubRule({
      projectId: PROJECT_ID,
      rule: data.rule,
      finding: {
        findingId: "0192f1a0-0000-7000-8000-00000011034f",
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "person-name",
        location: data.location,
        sampleRecords: KEPT,
        isFoundByModel: data.isFoundByModel,
      },
      options: OPTIONS,
      now: NOW,
      readRows: data.readRows,
      getRecognizer: data.recognizer
        ? available(data.recognizer)
        : NOT_INSTALLED,
    });
  }

  test.each([LogScrubAction.Redact, LogScrubAction.Mask, LogScrubAction.Hash])(
    "a Named Attributes rule over the URL's attribute hides the name as written, by %s",
    async (scrubAction: LogScrubAction) => {
      const outcome: ScrubProofOutcome = await prove({
        rule: { ...URL_RULE, scrubAction },
        location: "attributes.http.url",
        isFoundByModel: false,
        readRows: rows(
          attributeRow("http.url", NAMED_URL),
          attributeRow("http.url", ENCODED_NAMED_URL),
          attributeRow("http.url", PLAIN_URL),
        ),
      });

      expect(outcome.failure).toBeUndefined();
      expect(outcome.covers).toBe(true);
      expect(outcome.proof.valuesWithData).toBe(2);
      expect(outcome.proof.valuesStillWithData).toBe(0);
      expect(namesShownIn(outcome)).toEqual([]);
    },
  );

  test.each([LogScrubAction.Redact, LogScrubAction.Mask, LogScrubAction.Hash])(
    "a pattern rule written for the name as it reads hides it as the URL writes it, by %s",
    async (scrubAction: LogScrubAction) => {
      const outcome: ScrubProofOutcome = await prove({
        rule: {
          signal: "log",
          patternType: LogScrubPatternType.Custom,
          customRegex: "José García",
          scrubAction,
          fieldsToScrub: LogScrubField.Body,
          serviceId: SERVICE,
        },
        location: "body",
        isFoundByModel: true,
        recognizer: new FakeEntityRecognizer({ phrases: PHRASES }),
        readRows: rows(bodyRow(MODEL_LINE)),
      });

      expect(outcome.failure).toBeUndefined();
      expect(outcome.covers).toBe(true);
      expect(outcome.proof.valuesWithData).toBe(1);
      expect(outcome.proof.valuesStillWithData).toBe(0);
    },
  );

  test("a rule that leaves the encoded name in the URL does not cover it", async () => {
    const outcome: ScrubProofOutcome = await prove({
      rule: {
        ...URL_RULE,
        patternType: LogScrubPatternType.Custom,
        customRegex: "source=[a-z]+",
        attributeKeys: ["http.url"],
      },
      location: "attributes.http.url",
      isFoundByModel: false,
      readRows: rows(attributeRow("http.url", ENCODED_NAMED_URL)),
    });

    expect(outcome.covers).toBe(false);
    expect(outcome.proof.valuesStillWithData).toBe(1);
  });
});

describe("Scrub It's plan", () => {
  test("a name a query parameter names, where the model does not run: a proven Named Attributes rule over the URL", async () => {
    const planned: ScrubRulePlanOfFinding = await planProvenScrubRule({
      projectId: PROJECT_ID,
      finding: {
        findingId: "0192f1a0-0000-7000-8000-00000011034e",
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "person-name",
        location: "attributes.http.url",
        target: {
          signal: "log",
          field: ScrubbedField.Attributes,
          key: "http.url",
        },
        sampleRecords: KEPT,
        isFoundByModel: false,
      },
      serviceId: SERVICE,
      options: OPTIONS,
      now: NOW,
      readRows: rows(
        attributeRow("http.url", NAMED_URL),
        attributeRow("http.url", ENCODED_NAMED_URL),
      ),
      getRecognizer: NOT_INSTALLED,
    });

    expect(planned.isProven).toBe(true);
    expect(planned.chosen?.candidate.source).toBe(ScrubRuleSource.NamedKeys);
    expect(planned.chosen?.candidate.attributeKeys).toEqual(["http.url"]);
    expect(namesShownIn(planned)).toEqual([]);
  });
});
