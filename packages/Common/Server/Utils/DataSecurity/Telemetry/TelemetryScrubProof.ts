import { ResponseJSON } from "@clickhouse/client";
import DataConfidence from "../../../../Types/DataSecurity/DataConfidence";
import { getBuiltInDataType } from "../../../../Types/DataSecurity/DataTypeCatalog";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { FindingSampleRecord } from "../../../../Types/DataSecurity/FindingSampleRecord";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import MetricPipelineRule from "../../../../Models/DatabaseModels/MetricPipelineRule";
import { isScrubPlaceholder } from "../../../../Types/Telemetry/ScrubRule";
import { getHintedDataTypeIds } from "../../../../Utils/DataSecurity/FieldNameHints";
import {
  getMetricScrubRuleFingerprint,
  getScrubRuleFingerprint,
  ScrubRuleProof,
  ScrubRuleProofPlace,
  SCRUB_RULE_PROOF_VERSION,
} from "../../../../Types/Telemetry/ScrubRuleProof";
import {
  classifyField,
  FieldClassification,
  FieldClassifierOptions,
} from "../../../../Utils/DataSecurity/FieldClassifier";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import logger from "../../Logger";
import {
  compileScrubRule,
  CompiledScrubRule,
  ScrubEngineRule,
} from "../../Telemetry/ScrubEngine/CompiledScrubRule";
import MetricPipelineEngine, {
  MutableMetricRow,
} from "../../Telemetry/MetricPipelineEngine";
import LogScrubEngine from "../../Telemetry/ScrubEngine/LogScrubEngine";
import TraceScrubEngine, {
  ExceptionContent,
} from "../../Telemetry/ScrubEngine/TraceScrubEngine";
import { ContentScanOptions } from "../DataSecurityScanTypes";
import { ModelRereads } from "../Model/ModelRereads";
import { RecognizerAvailability } from "../Model/NameAddressRecognizer";
import {
  capsOf,
  classifierOptionsOf,
  fromRawJsonValue,
  getTelemetrySource,
  readEvents,
  readPairs,
  ReadEvent,
  readTelemetryRecordValues,
  readText,
  SourceDefinition,
  TelemetryRecordValue,
  TelemetrySampleCaps,
} from "./TelemetryDataScanner";
// Read while this module loads, which can be in the middle of the scanner's: see its module.
import { TelemetrySampleSource } from "./TelemetrySampleSource";
import {
  buildOccurrenceMatcher,
  buildTelemetryOccurrenceStatement,
  getOccurrenceReadLimit,
  getOccurrenceWindow,
  OccurrencePlan,
  planOccurrenceRead,
} from "./TelemetryFindingOccurrences";

/*
 * A SCRUB RULE, PROVEN ON THE VERY RECORDS A FINDING WAS SEEN IN (#10366).
 *
 * Plain code, with no model in it: before OneUptime offers a rule for a
 * finding - or makes one on its own - this reads
 *
 *   - the records the finding was seen in (DataStoreFinding.sampleRecords),
 *     by the keys the scan kept, as Show the records it was seen in reads
 *     them (TelemetryFindingOccurrences), and
 *   - the newest records of the same service with a value at the same
 *     place, over the last days,
 *
 * runs the rule over each, through the very engines ingest runs
 * (Telemetry/ScrubEngine/LogScrubEngine, TraceScrubEngine) - on copies,
 * counting nothing - and asks the scanner what is left at the place:
 *
 *   - covers: the data type is found in none of the values that held it.
 *     A value a rule left as what it leaves ("[REDACTED]", a mask, a token)
 *     holds nothing, even where a type found by the field's name alone
 *     would still be "found" in it by that name;
 *   - overreach: of the values at the place that held no sensitive data at
 *     all, the share the rule changed. A value that holds another sensitive
 *     type is no overreach: hiding it is no loss.
 *
 * What it read is what the scan read - the same columns, cut to the same
 * lengths (TelemetryDataScanner's caps) - and only at the place: a rule's
 * effect elsewhere is what the readers lookup asks about. Nothing it reads
 * leaves this function: the proof holds counts only.
 *
 * Logs, spans, AI calls and exceptions are proven here, and a metric
 * attribute's Redact Attribute rule too (proveMetricScrubRule, #10753): an
 * exception is read from the exceptions the finding was seen in - its
 * message, stack trace and attributes - and a trace rule is run on it as
 * ingest runs it on a span's exception event
 * (TraceScrubEngine.scrubExceptionContent); a metric rule is run on the
 * finding's data points through the one engine ingest runs metric rules
 * with (Telemetry/MetricPipelineEngine). Session replays are not proven, so
 * their rules never are - Scrub It still makes them, and OneUptime AI only
 * proposes them.
 *
 * A finding the names-and-addresses model made is proven as any other, with
 * the model (#10926): it is handed the values at the place before and after
 * the rule, record by record, the finding's own records first, within the
 * time it has for a read (Model/ModelRereads.ts) - one plan's rules share
 * it, each value read once. What it found in a value says whether the value holds the data;
 * a value it had no time for, or whose value after the rule it had no time
 * for, is not counted at all, so a proof never takes a value the model did
 * not read for one that holds nothing. Where the model cannot run, such a
 * finding's rules cannot be proven (ModelUnavailable). Still no prompt: the
 * model is the scanner's own, inside OneUptime.
 */

// The records of each store kind this proves log and trace rules on: the records such a rule scrubs.
const PROVABLE_SOURCES: ReadonlySet<TelemetrySampleSource> = new Set([
  TelemetrySampleSource.Logs,
  TelemetrySampleSource.Traces,
  TelemetrySampleSource.AiConversations,
  TelemetrySampleSource.Exceptions,
]);

// What a proof is asked about: one finding's place, and the records to read it in.
export interface ScrubProofFinding {
  findingId?: string | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  // The records the last scan kept with the finding.
  sampleRecords?: ReadonlyArray<FindingSampleRecord> | undefined;
  lastSeenAt?: Date | null | undefined;
  // The names-and-addresses model made it (DataStoreFinding.isFoundByModel).
  isFoundByModel?: boolean | undefined;
}

// The rule being proven, as it would be saved.
export interface ScrubProofRule {
  signal: "log" | "trace";
  patternType: string;
  customRegex?: string | undefined;
  attributeKeys?: Array<string> | undefined;
  scrubAction: string;
  fieldsToScrub: string;
  // The service it is for: its records are the service's.
  serviceId: string;
}

export enum ScrubProofFailure {
  // The place is in records no rule of this kind is proven on.
  NotProvable = "NotProvable",
  // The records could not be read just now.
  CouldNotRead = "CouldNotRead",
  // No record read still held the data: nothing to prove the rule on.
  NothingToProveOn = "NothingToProveOn",
  // The rule cannot run: a pattern that does not compile, keys that name nothing.
  RuleScrubsNothing = "RuleScrubsNothing",
  /*
   * The names-and-addresses model made the finding, and cannot run on this
   * server just now: only it can tell the data in a value.
   */
  ModelUnavailable = "ModelUnavailable",
}

export interface ScrubProofOutcome {
  proof: ScrubRuleProof;
  // It hid the data in every value that held it.
  covers: boolean;
  // The share of the place's other values it changed, 0 to 1.
  overreach: number;
  failure?: ScrubProofFailure | undefined;
}

// What a read answered: the rows, and how many were the finding's own records.
interface ReadRows {
  rows: Array<JSONObject>;
  findingRecordsRead: number;
}

/*
 * The rows a proof reads, through one function a test can stand in for:
 * the source's own runner, as the occurrences read runs it.
 */
export type ScrubProofRowReader = (data: {
  source: SourceDefinition;
  statement: ReturnType<typeof buildTelemetryOccurrenceStatement>;
}) => Promise<Array<JSONObject>>;

export const readRowsWithRunner: ScrubProofRowReader = async (data: {
  source: SourceDefinition;
  statement: ReturnType<typeof buildTelemetryOccurrenceStatement>;
}): Promise<Array<JSONObject>> => {
  const result: Results = await data.source.runner.executeQuery(data.statement);
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return (response.data || []) as Array<JSONObject>;
};

/*
 * A reader that reads each statement once: every candidate a finding is
 * planned with is proven on the very same records, and they are read from
 * the database once for all of them (#10366). A read that failed fails
 * for each candidate alike.
 */
export function readEachStatementOnce(
  reader: ScrubProofRowReader,
): ScrubProofRowReader {
  const read: Map<string, Promise<Array<JSONObject>>> = new Map<
    string,
    Promise<Array<JSONObject>>
  >();

  return (data: {
    source: SourceDefinition;
    statement: ReturnType<typeof buildTelemetryOccurrenceStatement>;
  }): Promise<Array<JSONObject>> => {
    const key: string = JSON.stringify([
      data.source.source,
      data.statement.toJSON(),
    ]);
    let rows: Promise<Array<JSONObject>> | undefined = read.get(key);

    if (!rows) {
      rows = reader(data);
      read.set(key, rows);
    }

    return rows;
  };
}

function emptyProof(data: {
  fingerprint: string;
  places: Array<ScrubRuleProofPlace>;
  now: Date;
}): ScrubRuleProof {
  return {
    version: SCRUB_RULE_PROOF_VERSION,
    provenAt: data.now.toISOString(),
    fingerprint: data.fingerprint,
    places: data.places,
    findingRecordsRead: 0,
    recordsRead: 0,
    valuesWithData: 0,
    valuesStillWithData: 0,
    otherValues: 0,
    otherValuesChanged: 0,
  };
}

function failed(
  proof: ScrubRuleProof,
  failure: ScrubProofFailure,
): ScrubProofOutcome {
  return { proof, covers: false, overreach: 0, failure };
}

// A row's identity, so a record read twice - kept and newest - counts once.
function rowKey(row: JSONObject): string {
  return JSON.stringify([
    row["recordTime"],
    row["readLogId"] || "",
    row["readTraceId"] || "",
    row["readSpanId"] || "",
  ]);
}

// An event attribute's raw JSON value, as the read keeps it, read as the text it holds.
function eventAttributesOf(event: ReadEvent): JSONObject {
  const attributes: JSONObject = {};

  for (const [key, raw] of event.attributes) {
    attributes[key] = fromRawJsonValue(raw);
  }

  return attributes;
}

/*
 * A row of the read as the engines take a record: the service it was sent
 * under, and the part of it the read holds - a log's body, the attribute
 * at the place, a span's events that hold it.
 */
function toEngineRecord(data: {
  row: JSONObject;
  source: TelemetrySampleSource;
  serviceId: string;
}): JSONObject {
  const record: JSONObject = { primaryEntityId: data.serviceId };
  const attributes: JSONObject = {};

  for (const [key, value] of readPairs(data.row["readAttributes"])) {
    attributes[key] = value;
  }

  record["attributes"] = attributes;

  if (data.source === TelemetrySampleSource.Logs) {
    if (typeof data.row["readBody"] === "string") {
      record["body"] = data.row["readBody"];
    }

    return record;
  }

  // An exception: the texts it keeps apart, and its attributes.
  if (data.source === TelemetrySampleSource.Exceptions) {
    record["message"] = readText(data.row["readMessage"]);
    record["stackTrace"] = readText(data.row["readStackTrace"]);

    return record;
  }

  record["events"] = readEvents(data.row["readEvents"]).map(
    (event: ReadEvent): JSONObject => {
      return { name: event.name, attributes: eventAttributesOf(event) };
    },
  );

  return record;
}

// A record the engines left, read back in the shape the scanner reads.
function toReadRow(data: {
  row: JSONObject;
  record: JSONObject;
  source: TelemetrySampleSource;
}): JSONObject {
  const read: JSONObject = { ...data.row };
  const attributes: JSONObject =
    (data.record["attributes"] as JSONObject) || {};

  read["readAttributes"] = Object.keys(attributes).map(
    (key: string): Array<string> => {
      const value: unknown = attributes[key];

      return [key, typeof value === "string" ? value : JSON.stringify(value)];
    },
  );

  if (data.source === TelemetrySampleSource.Logs) {
    if (typeof data.record["body"] === "string") {
      read["readBody"] = data.record["body"];
    }

    return read;
  }

  // An exception's texts, where the read held them.
  if (data.source === TelemetrySampleSource.Exceptions) {
    for (const [column, part] of [
      ["readMessage", "message"],
      ["readStackTrace", "stackTrace"],
    ] as Array<[string, string]>) {
      if (typeof data.row[column] === "string") {
        read[column] = readText(data.record[part]);
      }
    }

    return read;
  }

  read["readEvents"] = ((data.record["events"] as Array<JSONObject>) || []).map(
    (event: JSONObject): JSONValue => {
      const eventAttributes: JSONObject =
        (event["attributes"] as JSONObject) || {};

      return [
        typeof event["name"] === "string" ? event["name"] : "",
        Object.keys(eventAttributes).map((key: string): Array<string> => {
          return [key, JSON.stringify(eventAttributes[key])];
        }),
      ];
    },
  );

  return read;
}

// The values a row holds at the place, in the order the scan reads them.
function valuesAt(data: {
  row: JSONObject;
  source: TelemetrySampleSource;
  caps: TelemetrySampleCaps;
  location: string;
}): Array<string> {
  return (readTelemetryRecordValues(data.source, data.row, data.caps) || [])
    .filter((value: TelemetryRecordValue): boolean => {
      return value.location === data.location;
    })
    .map((value: TelemetryRecordValue): string => {
      return value.value;
    });
}

/*
 * Whether a value holds no sensitive data the project's scan would find:
 * classified at the place with every detector, the project's own too - and,
 * for a finding the model made, with what the model found in it: a value
 * that names a person holds data, whatever its patterns say.
 */
function buildCleanValueTest(data: {
  location: string;
  options: ContentScanOptions;
  model?: ModelRereads | null | undefined;
}): (value: string) => boolean {
  const classifierOptions: FieldClassifierOptions = classifierOptionsOf(
    data.options,
  );

  return (value: string): boolean => {
    return !classifyField(data.location, [value], {
      ...classifierOptions,
      maxMatchedValueIndexes: 0,
      ...(data.model ? { recognitions: data.model, readWithModel: true } : {}),
    }).some((classification: FieldClassification): boolean => {
      return (
        classification.valuesWithMatch > 0 &&
        classification.confidence !== DataConfidence.Low
      );
    });
  };
}

/*
 * The finding's own records, then the newest of the service with a value
 * at the place, once each. Null when they could not be read.
 */
async function readRows(data: {
  projectId: ObjectID;
  plan: OccurrencePlan;
  serviceId: string;
  finding: ScrubProofFinding;
  caps: TelemetrySampleCaps;
  now: Date;
  readRows: ScrubProofRowReader;
}): Promise<ReadRows | null> {
  const source: SourceDefinition = getTelemetrySource(data.plan.source);
  const kept: Array<FindingSampleRecord> = [
    ...(data.finding.sampleRecords || []),
  ];
  const seen: Set<string> = new Set<string>();
  const rows: Array<JSONObject> = [];
  let findingRecordsRead: number = 0;

  try {
    if (kept.length > 0) {
      const times: Array<number> = kept.map(
        (record: FindingSampleRecord): number => {
          return new Date(record.time).getTime();
        },
      );

      for (const row of await data.readRows({
        source,
        statement: buildTelemetryOccurrenceStatement({
          projectId: data.projectId,
          since: new Date(Math.min(...times)),
          until: new Date(Math.max(...times) + 1),
          plan: data.plan,
          ownerId: data.serviceId,
          limit: getOccurrenceReadLimit(data.plan, kept),
          caps: data.caps,
          records: kept,
          prefilter: null,
        }),
      })) {
        const key: string = rowKey(row);

        if (!seen.has(key)) {
          seen.add(key);
          rows.push(row);
          findingRecordsRead++;
        }
      }
    }

    const window: { since: Date; until: Date } = getOccurrenceWindow(data.now);

    for (const row of await data.readRows({
      source,
      statement: buildTelemetryOccurrenceStatement({
        projectId: data.projectId,
        since: window.since,
        until: window.until,
        plan: data.plan,
        ownerId: data.serviceId,
        limit: getOccurrenceReadLimit(data.plan),
        caps: data.caps,
        prefilter: null,
      }),
    })) {
      const key: string = rowKey(row);

      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }
  } catch (error) {
    logger.warn(
      `DataSecurity: could not read the records of service ${data.serviceId} at ${data.finding.location} in project ${data.projectId.toString()} to prove a scrub rule on them:`,
    );
    logger.warn(error);

    return null;
  }

  return { rows, findingRecordsRead };
}

/*
 * The rule over each record, through ingest's engine, on a copy: the
 * record as the rule leaves it.
 */
function scrubCopy(data: {
  record: JSONObject;
  compiled: CompiledScrubRule<ScrubEngineRule>;
  signal: "log" | "trace";
  source: TelemetrySampleSource;
}): JSONObject {
  const copy: JSONObject = JSON.parse(JSON.stringify(data.record));

  if (data.signal === "log") {
    return LogScrubEngine.scrubLog(copy, [data.compiled], null, {
      countValues: false,
    });
  }

  /*
   * An exception is a copy of its span's exception event: a trace rule
   * scrubs it as ingest does, with the rules that scrub events (#10753).
   * It counts nothing: its span counted it.
   */
  if (data.source === TelemetrySampleSource.Exceptions) {
    const scrubbed: ExceptionContent = TraceScrubEngine.scrubExceptionContent(
      {
        message: readText(copy["message"]),
        stackTrace: readText(copy["stackTrace"]),
        attributes: (copy["attributes"] as JSONObject) || {},
      },
      [data.compiled],
      copy["primaryEntityId"],
    );

    return {
      ...copy,
      message: scrubbed.message,
      stackTrace: scrubbed.stackTrace,
      attributes: scrubbed.attributes,
    };
  }

  return TraceScrubEngine.scrubSpan(copy, [data.compiled], null, {
    countValues: false,
  });
}

// A record's values at the place before the rule, and as the rule leaves them.
interface ValuesBeforeAndAfter {
  before: Array<string>;
  after: Array<string>;
}

/*
 * The model to read a finding's values with: the one a plan's rules share,
 * else one of its own - or null for a finding the model did not make.
 */
async function modelForProof(data: {
  finding: ScrubProofFinding;
  model?: ModelRereads | null | undefined;
  getRecognizer?: (() => Promise<RecognizerAvailability>) | undefined;
}): Promise<ModelRereads | null> {
  if (data.model !== undefined) {
    return data.model;
  }

  return await ModelRereads.forFinding({
    isFoundByModel: data.finding.isFoundByModel,
    getRecognizer: data.getRecognizer,
  });
}

/*
 * Whether the model judged a value: it read it whole - or there is nothing
 * in it to read. Every value is judged where there is no model.
 */
function isJudged(
  model: ModelRereads | null,
  value: string | undefined,
): boolean {
  return (
    !model ||
    value === undefined ||
    value.trim().length === 0 ||
    model.isRead(value)
  );
}

/*
 * The rows of a place, each as a rule leaves it, counted into a proof:
 * the values that held the data and still do, and the others it changed.
 * Shared by every kind of rule a proof runs - a log's or a span's, an
 * exception's, a metric's - so each is proven the same way.
 */
async function countAtPlace(data: {
  projectId: ObjectID;
  finding: ScrubProofFinding;
  options: ContentScanOptions;
  plan: OccurrencePlan;
  serviceId: string;
  proof: ScrubRuleProof;
  now: Date;
  readRows: ScrubProofRowReader;
  // A row of the read, as the rule leaves it, in the shape the scanner reads.
  scrubRow: (row: JSONObject) => JSONObject;
  // The model a plan's rules share, for a finding it made (null: none).
  model?: ModelRereads | null | undefined;
  getRecognizer?: (() => Promise<RecognizerAvailability>) | undefined;
}): Promise<ScrubProofOutcome> {
  const proof: ScrubRuleProof = data.proof;
  const model: ModelRereads | null = await modelForProof(data);

  // Only the model tells the data in a value: where it cannot run, nothing is proven.
  if (model && !model.isAvailable) {
    return failed(proof, ScrubProofFailure.ModelUnavailable);
  }

  const source: SourceDefinition = getTelemetrySource(data.plan.source);
  const caps: TelemetrySampleCaps = capsOf(source, data.options);
  const read: ReadRows | null = await readRows({
    projectId: data.projectId,
    plan: data.plan,
    serviceId: data.serviceId,
    finding: data.finding,
    caps,
    now: data.now,
    readRows: data.readRows,
  });

  if (!read) {
    return failed(proof, ScrubProofFailure.CouldNotRead);
  }

  const holdsTheData: (value: string) => string | null = buildOccurrenceMatcher(
    {
      dataTypeId: data.finding.dataTypeId,
      location: data.finding.location,
      options: data.options,
      model,
    },
  );
  const isClean: (value: string) => boolean = buildCleanValueTest({
    location: data.finding.location,
    options: data.options,
    model,
  });
  /*
   * A type found by the field's name is "found" in any value there: a
   * placeholder holds none of it. Not so for what the model found: a line
   * whose street address a rule left as [REDACTED] still names the person
   * in it, and the model, reading what the rule left, says so. Nor for a
   * name a URL's query parameter names in a place not named for it
   * (#11034): a rule that left [REDACTED] elsewhere in the URL left the
   * name, and the matcher, reading what the rule left, says so.
   */
  const isFoundByName: boolean =
    !model &&
    getBuiltInDataType(data.finding.dataTypeId)?.foundBy === "name" &&
    getHintedDataTypeIds(data.finding.location, data.options.extraHints).has(
      data.finding.dataTypeId,
    );

  proof.findingRecordsRead = read.findingRecordsRead;
  proof.recordsRead = read.rows.length;

  const count: (values: ValuesBeforeAndAfter) => void = (
    values: ValuesBeforeAndAfter,
  ): void => {
    values.before.forEach((value: string, index: number): void => {
      const left: string | undefined = values.after[index];

      // A value the model had no time for is not counted: it is not known to hold nothing.
      if (!isJudged(model, value)) {
        return;
      }

      if (holdsTheData(value)) {
        // Nor one whose value after the rule it had no time for.
        if (left !== value && !isJudged(model, left)) {
          return;
        }

        proof.valuesWithData++;

        const stillHolds: boolean =
          left !== undefined &&
          Boolean(holdsTheData(left)) &&
          !(isFoundByName && left !== value && isScrubPlaceholder(left));

        if (stillHolds) {
          proof.valuesStillWithData++;
        }

        return;
      }

      if (isClean(value)) {
        proof.otherValues++;

        if (left !== value) {
          proof.otherValuesChanged++;
        }
      }
    });
  };

  /*
   * Record by record, the finding's own first. With the model, each
   * record's values are read before the next record's - what they held,
   * then what the rule left of those that held the data - so every value
   * counted was judged whole, and once its time is spent no record after
   * is counted.
   */
  for (const row of read.rows) {
    const before: Array<string> = valuesAt({
      row,
      source: data.plan.source,
      caps,
      location: data.finding.location,
    });

    if (before.length === 0) {
      continue;
    }

    const values: ValuesBeforeAndAfter = {
      before,
      after: valuesAt({
        row: data.scrubRow(row),
        source: data.plan.source,
        caps,
        location: data.finding.location,
      }),
    };

    if (model) {
      await model.read(values.before);

      // What the rule left of each value that held the data.
      await model.read(
        values.before
          .map((value: string, index: number): string | null => {
            const left: string | undefined = values.after[index];

            return left !== undefined &&
              left !== value &&
              model.isRead(value) &&
              holdsTheData(value)
              ? left
              : null;
          })
          .filter((left: string | null): left is string => {
            return left !== null;
          }),
      );
    }

    count(values);

    if (model && (model.isOutOfTime || !model.isAvailable)) {
      break;
    }
  }

  if (proof.valuesWithData === 0) {
    return failed(
      proof,
      model && !model.isAvailable
        ? ScrubProofFailure.ModelUnavailable
        : ScrubProofFailure.NothingToProveOn,
    );
  }

  return {
    proof,
    covers: proof.valuesStillWithData === 0,
    overreach:
      proof.otherValues > 0 ? proof.otherValuesChanged / proof.otherValues : 0,
  };
}

function placeOf(finding: ScrubProofFinding): ScrubRuleProofPlace {
  return {
    dataTypeId: finding.dataTypeId,
    location: finding.location,
    kind: finding.kind,
    ...(finding.findingId ? { findingId: finding.findingId } : {}),
  };
}

/*
 * Prove a rule on a finding's place: the counts of what it hid and what
 * else it changed, kept as the rule's proof. Never throws: records that
 * cannot be read, or a place no rule of this kind is proven on, prove
 * nothing, and say why.
 */
export async function proveScrubRule(data: {
  projectId: ObjectID;
  rule: ScrubProofRule;
  finding: ScrubProofFinding;
  // The project's scan setup: its own data types, hints and allowed values.
  options: ContentScanOptions;
  now?: Date | undefined;
  // Stands in for the database in a test.
  readRows?: ScrubProofRowReader | undefined;
  /*
   * For a finding the model made: the model a plan's rules share, so each
   * value is read once for all of them. One of its own when absent.
   */
  model?: ModelRereads | null | undefined;
  // Stands in for the process's model in a test.
  getRecognizer?: (() => Promise<RecognizerAvailability>) | undefined;
}): Promise<ScrubProofOutcome> {
  const now: Date = data.now || OneUptimeDate.getCurrentDate();
  const proof: ScrubRuleProof = emptyProof({
    fingerprint: getScrubRuleFingerprint(data.rule),
    places: [placeOf(data.finding)],
    now,
  });
  const plan: OccurrencePlan | null = planOccurrenceRead(
    data.finding.kind,
    data.finding.location,
  );

  if (!plan || !PROVABLE_SOURCES.has(plan.source)) {
    return failed(proof, ScrubProofFailure.NotProvable);
  }

  const compiled: CompiledScrubRule<ScrubEngineRule> | null = compileScrubRule({
    _id: "00000000-0000-4000-8000-000000000000",
    projectId: data.projectId,
    patternType: data.rule.patternType,
    customRegex: data.rule.customRegex,
    attributeKeys: data.rule.attributeKeys,
    scrubAction: data.rule.scrubAction,
    fieldsToScrub: data.rule.fieldsToScrub,
    serviceId: data.rule.serviceId,
  });

  if (!compiled) {
    return failed(proof, ScrubProofFailure.RuleScrubsNothing);
  }

  return await countAtPlace({
    projectId: data.projectId,
    finding: data.finding,
    options: data.options,
    plan,
    serviceId: data.rule.serviceId,
    proof,
    now,
    readRows: data.readRows || readRowsWithRunner,
    model: data.model,
    getRecognizer: data.getRecognizer,
    scrubRow: (row: JSONObject): JSONObject => {
      return toReadRow({
        row,
        record: scrubCopy({
          record: toEngineRecord({
            row,
            source: plan.source,
            serviceId: data.rule.serviceId,
          }),
          compiled,
          signal: data.rule.signal,
          source: plan.source,
        }),
        source: plan.source,
      });
    },
  });
}

/*
 * A metric data point of the read as the metric engine takes a row - its
 * metric's name and its attributes - left by the rule, and read back in
 * the shape the scanner reads.
 */
function scrubMetricRow(row: JSONObject, rule: MetricPipelineRule): JSONObject {
  const attributes: JSONObject = {};

  for (const [key, value] of readPairs(row["readAttributes"])) {
    attributes[key] = value;
  }

  const metricRow: MutableMetricRow = {
    name: readText(row["readMetricName"]),
    attributes,
  };
  const left: MutableMetricRow | null = MetricPipelineEngine.applyRules(
    metricRow,
    [rule],
    [],
  );
  const leftAttributes: JSONObject = left
    ? MetricPipelineEngine.getAttributes(left)
    : {};

  return {
    ...row,
    readAttributes: Object.keys(leftAttributes).map(
      (key: string): Array<string> => {
        const value: unknown = leftAttributes[key];

        return [key, typeof value === "string" ? value : JSON.stringify(value)];
      },
    ),
  };
}

/*
 * Prove a metric attribute's rule - the Redact Attribute metric pipeline
 * rule Scrub It makes (TelemetryScrubCoverage.buildMetricScrubRule) - on
 * the finding's data points and the newest of its service with a value at
 * the place, through the one engine ingest runs metric rules with
 * (Telemetry/MetricPipelineEngine, #10753): every value that held the
 * data hidden, and how many of the attribute's other values it changed.
 * Never throws, as proveScrubRule.
 */
export async function proveMetricScrubRule(data: {
  projectId: ObjectID;
  rule: MetricPipelineRule;
  finding: ScrubProofFinding;
  options: ContentScanOptions;
  now?: Date | undefined;
  readRows?: ScrubProofRowReader | undefined;
  model?: ModelRereads | null | undefined;
  getRecognizer?: (() => Promise<RecognizerAvailability>) | undefined;
}): Promise<ScrubProofOutcome> {
  const now: Date = data.now || OneUptimeDate.getCurrentDate();
  const serviceId: string = data.rule.serviceId?.toString() || "";
  const proof: ScrubRuleProof = emptyProof({
    fingerprint: getMetricScrubRuleFingerprint({
      serviceId,
      attributeKey: data.rule.addAttributeKey,
      filters: data.rule.filters,
      filterCondition: data.rule.filterCondition,
      redactReplacement: data.rule.redactReplacement,
    }),
    places: [placeOf(data.finding)],
    now,
  });
  const plan: OccurrencePlan | null = planOccurrenceRead(
    data.finding.kind,
    data.finding.location,
  );

  // A metric's attribute, and nothing else: a name is never scrubbed by a rule.
  if (
    !plan ||
    plan.source !== TelemetrySampleSource.Metrics ||
    plan.read.kind !== "pairs"
  ) {
    return failed(proof, ScrubProofFailure.NotProvable);
  }

  if (!data.rule.addAttributeKey || !ObjectID.isValidUUID(serviceId)) {
    return failed(proof, ScrubProofFailure.RuleScrubsNothing);
  }

  return await countAtPlace({
    projectId: data.projectId,
    finding: data.finding,
    options: data.options,
    plan,
    serviceId,
    proof,
    now,
    readRows: data.readRows || readRowsWithRunner,
    model: data.model,
    getRecognizer: data.getRecognizer,
    scrubRow: (row: JSONObject): JSONObject => {
      return scrubMetricRow(row, data.rule);
    },
  });
}

/*
 * The values at a finding's place in the records a proof reads - its own
 * records, then the newest of its service - those that hold its data type
 * first: what OneUptime AI's shapes are made from (TelemetryScrubShapes).
 * They never leave the server. Null when the records could not be read, or
 * the place is in records no rule is proven on - or, for a finding the
 * model made, where the model cannot run. A value the model had no time
 * for is in neither list.
 */
export async function readScrubPlaceValues(data: {
  projectId: ObjectID;
  finding: ScrubProofFinding;
  serviceId: string;
  options: ContentScanOptions;
  now?: Date | undefined;
  readRows?: ScrubProofRowReader | undefined;
  model?: ModelRereads | null | undefined;
  getRecognizer?: (() => Promise<RecognizerAvailability>) | undefined;
}): Promise<{ holding: Array<string>; others: Array<string> } | null> {
  const plan: OccurrencePlan | null = planOccurrenceRead(
    data.finding.kind,
    data.finding.location,
  );

  if (!plan || !PROVABLE_SOURCES.has(plan.source)) {
    return null;
  }

  const model: ModelRereads | null = await modelForProof(data);

  if (model && !model.isAvailable) {
    return null;
  }

  const source: SourceDefinition = getTelemetrySource(plan.source);
  const caps: TelemetrySampleCaps = capsOf(source, data.options);
  const read: ReadRows | null = await readRows({
    projectId: data.projectId,
    plan,
    serviceId: data.serviceId,
    finding: data.finding,
    caps,
    now: data.now || OneUptimeDate.getCurrentDate(),
    readRows: data.readRows || readRowsWithRunner,
  });

  if (!read) {
    return null;
  }

  const holdsTheData: (value: string) => string | null = buildOccurrenceMatcher(
    {
      dataTypeId: data.finding.dataTypeId,
      location: data.finding.location,
      options: data.options,
      model,
    },
  );
  const holding: Array<string> = [];
  const others: Array<string> = [];
  const values: Array<string> = read.rows.flatMap(
    (row: JSONObject): Array<string> => {
      return valuesAt({
        row,
        source: plan.source,
        caps,
        location: data.finding.location,
      });
    },
  );

  // The finding's own records' values first, as many as the model has time for.
  if (model) {
    await model.read(values);
  }

  for (const value of values) {
    if (!isJudged(model, value)) {
      continue;
    }

    (holdsTheData(value) ? holding : others).push(value);
  }

  return { holding, others };
}

/*
 * The proofs of one rule over several places - several findings one rule
 * hides - as one: every place, every count added up.
 */
export function combineScrubRuleProofs(
  proofs: ReadonlyArray<ScrubRuleProof>,
  fingerprint: string,
  now: Date,
): ScrubRuleProof {
  const combined: ScrubRuleProof = {
    version: SCRUB_RULE_PROOF_VERSION,
    provenAt: now.toISOString(),
    fingerprint,
    places: [],
    findingRecordsRead: 0,
    recordsRead: 0,
    valuesWithData: 0,
    valuesStillWithData: 0,
    otherValues: 0,
    otherValuesChanged: 0,
  };

  for (const proof of proofs) {
    combined.places.push(...proof.places);
    combined.findingRecordsRead += proof.findingRecordsRead;
    combined.recordsRead += proof.recordsRead;
    combined.valuesWithData += proof.valuesWithData;
    combined.valuesStillWithData += proof.valuesStillWithData;
    combined.otherValues += proof.otherValues;
    combined.otherValuesChanged += proof.otherValuesChanged;
  }

  return combined;
}
