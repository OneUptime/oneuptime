import Dictionary from "../../../../Types/Dictionary";
import { DataStorePostureReadFrom } from "../../../../Types/DataSecurity/DataStorePosture";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { writeScanWarning } from "../../../../Types/DataSecurity/ScanWarnings";
import FieldCollector, {
  CollectedField,
} from "../../../../Utils/DataSecurity/FieldCollector";
import { MAX_FIELD_VALUES } from "../../../../Utils/DataSecurity/FieldClassifier";
import { ModelRecognitions } from "../../../../Utils/DataSecurity/Model/RecognizedEntity";
import { toPathPattern } from "../../../../Utils/DataSecurity/PathPattern";
import {
  mergeShadowCounts,
  ShadowCounts,
} from "../../../../Utils/DataSecurity/ShadowCount";
import {
  MAX_UNPLACED_LOCATION_LENGTH,
  UnplacedField,
} from "../../../../Utils/DataSecurity/UnplacedFields";
import { TargetTlsOptions } from "../../OutboundProxyAgents";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  emptyContentScanResult,
  LocationFindings,
  MAX_READ_LOG_ENTRIES,
  MAX_UNPLACED_FIELDS_PER_SCAN,
} from "../DataSecurityScanTypes";
import { FingerprintAccumulator } from "../Fingerprint";
import { CONTENT_STORE_KEY, recognizeFields } from "../Model/ModelScan";
import {
  ModelTurnTracker,
  readModelResumeAt,
  rotateForModel,
  withModelResumeAt,
} from "../Model/ModelTurns";
import {
  classifyCollectedFields,
  FieldsClassification,
} from "./ContentClassifier";
import {
  CONNECT_TIMEOUT_IN_MS,
  MAX_CELLS_PER_TABLE,
  MAX_VALUE_LENGTH,
  sanitizeErrorMessage,
  STATEMENT_TIMEOUT_IN_MS,
} from "./DatabaseSampler";
import { LOCATION_SEPARATOR } from "./ObjectStoreSampler";
import {
  checkSearchEndpoint,
  SearchEndpointAnswer,
  SearchEngineName,
} from "./SearchEndpointCheck";
import {
  getSearchConnectionSecrets,
  readSearchConnection,
  SearchConnection,
} from "./SearchStoreConnection";

/*
 * A SEARCH CLUSTER, SAMPLED A FEW DOCUMENTS PER INDEX, WITHOUT WRITING A
 * BYTE (#11140).
 *
 * Elasticsearch's and OpenSearch's documents are read the way a database's
 * rows are (DatabaseSampler), over the cluster's HTTP API, with the
 * read-only user or API key a person gives (SearchStoreConnection):
 *
 *  - the indices are listed (_cat/indices, every one, hidden ones too) and
 *    so are the data streams (_data_stream). A data stream is read as one
 *    index, by its name, whatever its backing indices; the rest of the
 *    hidden and system indices (a leading dot: .kibana, .security) are
 *    left out, and so are closed ones and the store's exclusions;
 *  - indices whose names differ only by dates and numbers -
 *    logstash-2026.11.26, logstash-2026.11.27 - are one index pattern
 *    (PathPattern, as a bucket's objects are), read at its newest index
 *    that holds documents, so a cluster of daily indices is read by kind,
 *    not by day, and its findings keep one name from one day to the next;
 *  - up to maxTables of them are read, those with documents first, each
 *    for up to maxRowsPerTable documents - the newest first where its
 *    mapping has a @timestamp, in index order otherwise - and never more
 *    values than a table's (MAX_CELLS_PER_TABLE), a page at a time, a page
 *    halved when its answer would be too large;
 *  - each document's fields are collected by path (FieldCollector: user.
 *    email, addresses[].city), each value cut to MAX_VALUE_LENGTH, and
 *    classified as fields of a document (ContentClassifier), named
 *    "index › field". Fields named for passwords are checked for passwords
 *    kept as they are, and High values feed the scan's fingerprints. With
 *    the names-and-addresses model on, the indices take turns at its time,
 *    as tables do (#10928).
 *
 * Every request is the sampler's own and a GET (sendReadOnly): the
 * listings, a mapping, a search with its parameters in the address. None
 * can write, whatever the credentials allow; the read-only user is the
 * second guard. Each is bounded by a timeout, the search by Elasticsearch's
 * own too. Before it reads, the scan asks the cluster - without
 * credentials - how exposed it is (SearchEndpointCheck): what it finds is
 * the result's posture, kept on the store.
 *
 * The connection string is never logged, and is taken out of every error
 * message. A cluster that cannot be reached, or that refuses the user, is a
 * thrown error, for the caller to record; anything after it - an index that
 * cannot be read - is a warning.
 */

export interface SearchStoreConnection {
  kind: string;
  connectionString: string;
}

export interface SearchHttpRequest {
  method: "GET";
  url: string;
  headers: Dictionary<string>;
  timeoutInMs: number;
  tls?: TargetTlsOptions | undefined;
}

export interface SearchHttpResponse {
  statusCode: number;
  bodyText: string;
}

/*
 * What a transport throws when no answer came, so the sampler can tell a
 * timeout from a dropped connection and an answer too large to read.
 */
export class SearchTransportError extends Error {
  public readonly reason: "timeout" | "dropped" | "unreachable" | "tooLarge";

  public constructor(
    reason: "timeout" | "dropped" | "unreachable" | "tooLarge",
    message: string,
  ) {
    super(message);
    this.reason = reason;
  }
}

// Sends one request and answers whatever status came back.
export type SearchHttpTransport = (
  request: SearchHttpRequest,
) => Promise<SearchHttpResponse>;

export interface SearchSamplerContext {
  transport: SearchHttpTransport;
  // Where the scan runs: outside your networks, or inside them (a probe).
  readFrom: DataStorePostureReadFrom;
}

// The most documents one index pattern gives a scan: Elasticsearch's own default window.
export const MAX_DOCUMENTS_PER_INDEX: number = 10_000;

// The most documents asked for in one request; halved when an answer is too large.
export const SEARCH_PAGE_SIZE: number = 200;

// The most fields of one index read, as a table's columns are.
export const MAX_FIELDS_PER_INDEX: number = 250;

// Indices listed for each one the scan may read, to choose from.
const MAX_LISTED_INDICES: number = 25_000;

// Requests that failed one after another before the scan gives up.
const MAX_CONSECUTIVE_FAILURES: number = 5;

const MAX_WARNINGS: number = 50;

const MAX_PLAINTEXT_PASSWORD_FIELDS: number = 50;

// The search's own time limit, a little inside the request's.
const SEARCH_TIMEOUT_IN_SECONDS: number = 25;

// The longest address a search's parameters may make.
const MAX_SEARCH_URL_LENGTH: number = 3_500;

// Mapping types that cannot hold what a scan looks for, or are not in _source.
const SKIPPED_TYPES: ReadonlySet<string> = new Set([
  "binary",
  "boolean",
  "geo_point",
  "geo_shape",
  "point",
  "shape",
  "dense_vector",
  "sparse_vector",
  "knn_vector",
  "rank_feature",
  "rank_features",
  "histogram",
  "aggregate_metric_double",
  "alias",
  "join",
  "percolator",
  "completion",
  "token_count",
]);

// Types whose values are bytes, not text: left out of the documents read.
const EXCLUDED_FROM_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "binary",
  "dense_vector",
  "sparse_vector",
  "knn_vector",
]);

const TIMESTAMP_TYPES: ReadonlySet<string> = new Set(["date", "date_nanos"]);

const TIMESTAMP_FIELD: string = "@timestamp";

// A data stream's backing index: .ds-<stream>-[<yyyy.MM.dd>-]<generation>.
const BACKING_INDEX: RegExp = /^\.ds-(.+?)-(?:\d{4}\.\d{2}\.\d{2}-)?\d{6}$/;

/*
 * Stars, the separators between them and the digits a version leaves
 * beside them, which a pattern collapses to one star: logstash-*.*.* is
 * logstash-*, and filebeat-7.*.0-* is filebeat-*, whatever release wrote
 * it. Three plain replacements, run until nothing changes: none can
 * backtrack.
 */
const DIGIT_BEFORE_STAR: RegExp = /\d[.\-_]*\*/g;
const DIGIT_AFTER_STAR: RegExp = /\*[.\-_]*\d/g;
const STAR_RUN: RegExp = /\*[.\-_]*\*/g;

/*
 * Every request goes out through here, and only a GET does: no listing,
 * mapping or search the sampler sends writes, and a request it builds
 * wrongly is refused rather than sent.
 */
export function assertReadOnlySearchRequest(
  request: SearchHttpRequest,
): void {
  if (request.method !== "GET") {
    throw new Error(
      "Data Security sends a search cluster nothing but GET requests.",
    );
  }
}

interface ListedIndex {
  name: string;
  isOpen: boolean;
  documents: number;
  createdAt: number;
}

/*
 * One thing the scan reads: a data stream, or the indices of one name
 * pattern. `target` is what is searched; `mappingIndex`, the index whose
 * mapping says how.
 */
export interface IndexGroup {
  // Its name in findings: the stream's, or the indices' pattern.
  name: string;
  target: string;
  mappingIndex: string;
  documents: number;
  isDataStream: boolean;
  // A data stream's timestamp field, which every document of it has.
  timestampField?: string | undefined;
}

interface MappedField {
  path: string;
  type: string;
}

function toNumber(value: unknown): number {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  return Number.isFinite(number) ? number : -1;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorOf(response: SearchHttpResponse): string {
  const body: unknown = parseJson(response.bodyText);
  let reason: string = "";

  if (body && typeof body === "object") {
    const error: unknown = (body as Record<string, unknown>)["error"];

    if (typeof error === "string") {
      reason = error;
    } else if (error && typeof error === "object") {
      const type: unknown = (error as Record<string, unknown>)["type"];
      const text: unknown = (error as Record<string, unknown>)["reason"];

      reason = [type, text]
        .filter((part: unknown): part is string => {
          return typeof part === "string" && part.length > 0;
        })
        .join(": ");
    }
  }

  return `HTTP ${response.statusCode}${
    reason ? `: ${reason}` : response.bodyText ? `: ${response.bodyText}` : ""
  }`;
}

// An index's name as a pattern: its dates and numbers stars, each run one.
export function toIndexPattern(index: string): string {
  let pattern: string = toPathPattern(index).split("/").join("_");
  let previous: string = "";

  while (pattern !== previous) {
    previous = pattern;
    pattern = pattern
      .replace(DIGIT_BEFORE_STAR, "*")
      .replace(DIGIT_AFTER_STAR, "*")
      .replace(STAR_RUN, "*");
  }

  return pattern;
}

export function readListedIndices(body: unknown): Array<ListedIndex> {
  if (!Array.isArray(body)) {
    return [];
  }

  return body
    .map((row: unknown): ListedIndex | null => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const record: Record<string, unknown> = row as Record<string, unknown>;
      const name: unknown = record["index"];

      if (typeof name !== "string" || !name) {
        return null;
      }

      return {
        name,
        isOpen: record["status"] !== "close",
        documents: Math.max(0, toNumber(record["docs.count"])),
        createdAt: Math.max(0, toNumber(record["creation.date"])),
      };
    })
    .filter((index: ListedIndex | null): index is ListedIndex => {
      return index !== null;
    });
}

export interface ListedDataStream {
  name: string;
  indices: Array<string>;
  timestampField: string;
}

export function readDataStreams(body: unknown): Array<ListedDataStream> {
  const streams: unknown =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)["data_streams"]
      : undefined;

  if (!Array.isArray(streams)) {
    return [];
  }

  return streams
    .map((stream: unknown): ListedDataStream | null => {
      if (!stream || typeof stream !== "object") {
        return null;
      }

      const record: Record<string, unknown> = stream as Record<
        string,
        unknown
      >;
      const name: unknown = record["name"];

      if (typeof name !== "string" || !name) {
        return null;
      }

      const indices: Array<string> = Array.isArray(record["indices"])
        ? (record["indices"] as Array<unknown>)
            .map((index: unknown): string => {
              return index && typeof index === "object"
                ? String((index as Record<string, unknown>)["index_name"] || "")
                : "";
            })
            .filter((index: string): boolean => {
              return index.length > 0;
            })
        : [];
      const timestamp: unknown = record["timestamp_field"];
      const timestampField: unknown =
        timestamp && typeof timestamp === "object"
          ? (timestamp as Record<string, unknown>)["name"]
          : undefined;

      return {
        name,
        indices,
        timestampField:
          typeof timestampField === "string" && timestampField
            ? timestampField
            : TIMESTAMP_FIELD,
      };
    })
    .filter((stream: ListedDataStream | null): stream is ListedDataStream => {
      return stream !== null;
    });
}

/*
 * What a cluster holds that the scan may read, as it reads it: each data
 * stream, then each pattern of the other indices, at its newest index that
 * holds documents. Hidden and system indices - a leading dot - and closed
 * ones are left out; so are data streams OneUptime cannot see.
 */
export function groupIndices(data: {
  indices: Array<ListedIndex>;
  dataStreams: Array<ListedDataStream>;
}): Array<IndexGroup> {
  const byName: Map<string, ListedIndex> = new Map(
    data.indices.map((index: ListedIndex): [string, ListedIndex] => {
      return [index.name, index];
    }),
  );
  const inStream: Set<string> = new Set();
  const groups: Array<IndexGroup> = [];

  for (const stream of data.dataStreams) {
    // A system data stream (.logs-deprecation...) is left out like a system index.
    if (stream.name.startsWith(".")) {
      for (const index of stream.indices) {
        inStream.add(index);
      }

      continue;
    }

    const backing: Array<ListedIndex> = stream.indices
      .map((name: string): ListedIndex | undefined => {
        inStream.add(name);
        return byName.get(name);
      })
      .filter((index: ListedIndex | undefined): index is ListedIndex => {
        return Boolean(index && index.isOpen);
      });

    if (backing.length === 0) {
      continue;
    }

    const newest: ListedIndex = [...backing].sort(
      (a: ListedIndex, b: ListedIndex): number => {
        return b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1);
      },
    )[0]!;

    groups.push({
      name: stream.name,
      target: stream.name,
      mappingIndex: newest.name,
      documents: backing.reduce((sum: number, index: ListedIndex): number => {
        return sum + index.documents;
      }, 0),
      isDataStream: true,
      timestampField: stream.timestampField,
    });
  }

  const patterns: Map<string, Array<ListedIndex>> = new Map();

  for (const index of data.indices) {
    if (
      inStream.has(index.name) ||
      !index.isOpen ||
      index.name.startsWith(".") ||
      BACKING_INDEX.test(index.name)
    ) {
      continue;
    }

    const pattern: string = toIndexPattern(index.name);
    const members: Array<ListedIndex> = patterns.get(pattern) || [];

    members.push(index);
    patterns.set(pattern, members);
  }

  for (const [pattern, members] of patterns) {
    const ordered: Array<ListedIndex> = [...members].sort(
      (a: ListedIndex, b: ListedIndex): number => {
        return b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1);
      },
    );
    const newestWithDocuments: ListedIndex =
      ordered.find((index: ListedIndex): boolean => {
        return index.documents > 0;
      }) || ordered[0]!;

    groups.push({
      name: pattern,
      target: newestWithDocuments.name,
      mappingIndex: newestWithDocuments.name,
      documents: members.reduce((sum: number, index: ListedIndex): number => {
        return sum + index.documents;
      }, 0),
      isDataStream: false,
    });
  }

  return groups.sort((a: IndexGroup, b: IndexGroup): number => {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/*
 * EXCLUSIONS: an index, a data stream or a pattern - with * for any run of
 * characters - or one field of it, "index.field" or "index › field",
 * compared without regard to case.
 */
/*
 * Whether a name matches a glob whose * is any run of characters, without
 * regard to case: walked part by part, so no pattern is built from what a
 * person wrote and nothing can backtrack.
 */
export function matchesGlob(name: string, glob: string): boolean {
  const text: string = name.toLowerCase();
  const parts: Array<string> = glob.toLowerCase().split("*");

  if (parts.length === 1) {
    return text === parts[0];
  }

  const first: string = parts[0]!;
  const last: string = parts[parts.length - 1]!;

  if (
    !text.startsWith(first) ||
    !text.endsWith(last) ||
    text.length < first.length + last.length
  ) {
    return false;
  }

  let at: number = first.length;
  const end: number = text.length - last.length;

  for (const part of parts.slice(1, -1)) {
    const found: number = text.indexOf(part, at);

    if (found < 0 || found + part.length > end) {
      return false;
    }

    at = found + part.length;
  }

  return true;
}

export interface SearchExclusions {
  isGroupExcluded: (group: IndexGroup) => boolean;
  isFieldExcluded: (group: IndexGroup, fieldPath: string) => boolean;
}

export function readSearchExclusions(
  exclusions: Array<string>,
): SearchExclusions {
  const lines: Array<string> = exclusions
    .map((exclusion: string): string => {
      return exclusion.trim();
    })
    .filter((exclusion: string): boolean => {
      return exclusion.length > 0;
    });

  const namesOf: (group: IndexGroup) => Array<string> = (
    group: IndexGroup,
  ): Array<string> => {
    return [group.name, group.target, group.mappingIndex];
  };

  return {
    isGroupExcluded: (group: IndexGroup): boolean => {
      return lines.some((glob: string): boolean => {
        return namesOf(group).some((name: string): boolean => {
          return matchesGlob(name, glob);
        });
      });
    },
    isFieldExcluded: (group: IndexGroup, fieldPath: string): boolean => {
      const field: string = fieldPath.split("[]").join("").toLowerCase();

      return lines.some((line: string): boolean => {
        const lower: string = line.toLowerCase();

        return namesOf(group).some((name: string): boolean => {
          const index: string = name.toLowerCase();

          return (
            lower === `${index}.${field}` ||
            lower === `${index}${LOCATION_SEPARATOR}${field}`
          );
        });
      });
    },
  };
}

// The fields a mapping names, by path, objects walked into.
export function readMappingFields(body: unknown): Array<MappedField> {
  const fields: Array<MappedField> = [];

  if (!body || typeof body !== "object") {
    return fields;
  }

  for (const index of Object.values(body as Record<string, unknown>)) {
    let mappings: unknown =
      index && typeof index === "object"
        ? (index as Record<string, unknown>)["mappings"]
        : undefined;

    // Elasticsearch 6 keeps a type's mapping a level down: mappings._doc.properties.
    if (
      mappings &&
      typeof mappings === "object" &&
      !(mappings as Record<string, unknown>)["properties"]
    ) {
      const inner: Array<unknown> = Object.values(
        mappings as Record<string, unknown>,
      );

      mappings = inner.length === 1 ? inner[0] : mappings;
    }

    const walk: (properties: unknown, prefix: string, depth: number) => void = (
      properties: unknown,
      prefix: string,
      depth: number,
    ): void => {
      if (!properties || typeof properties !== "object" || depth > 12) {
        return;
      }

      for (const [name, definition] of Object.entries(
        properties as Record<string, unknown>,
      )) {
        if (!definition || typeof definition !== "object") {
          continue;
        }

        const path: string = prefix ? `${prefix}.${name}` : name;
        const record: Record<string, unknown> = definition as Record<
          string,
          unknown
        >;

        if (record["properties"]) {
          walk(record["properties"], path, depth + 1);
          continue;
        }

        fields.push({
          path,
          type:
            typeof record["type"] === "string"
              ? (record["type"] as string)
              : "object",
        });
      }
    };

    walk(
      mappings && typeof mappings === "object"
        ? (mappings as Record<string, unknown>)["properties"]
        : undefined,
      "",
      0,
    );

    // One index's mapping says it: the newest of its group.
    break;
  }

  return fields;
}

function encodeTarget(target: string): string {
  return target
    .split(",")
    .map((part: string): string => {
      return encodeURIComponent(part);
    })
    .join(",");
}

/*
 * A search for a page of documents, its parameters in the address: the
 * newest first by the timestamp field, or in index order; the fields no
 * scan reads left out of each document, when they fit in the address.
 */
export function buildSearchPath(data: {
  target: string;
  from: number;
  size: number;
  sortField: string | null;
  excludedFields: Array<string>;
}): string {
  const parameters: URLSearchParams = new URLSearchParams();

  parameters.set("size", String(data.size));
  parameters.set("from", String(data.from));
  parameters.set(
    "sort",
    data.sortField ? `${data.sortField}:desc` : "_doc",
  );
  parameters.set("timeout", `${SEARCH_TIMEOUT_IN_SECONDS}s`);
  parameters.set("track_total_hits", "false");
  parameters.set("ignore_unavailable", "true");
  parameters.set("allow_no_indices", "true");

  const path: string = `/${encodeTarget(data.target)}/_search`;
  const excluded: string = data.excludedFields.join(",");
  const withExcludes: string = `${path}?${parameters.toString()}&_source_excludes=${encodeURIComponent(excluded)}`;

  if (excluded && withExcludes.length <= MAX_SEARCH_URL_LENGTH) {
    return withExcludes;
  }

  return `${path}?${parameters.toString()}`;
}

// The _source of each hit of a search answer.
export function readHitSources(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== "object") {
    return [];
  }

  const hits: unknown = (body as Record<string, unknown>)["hits"];
  const list: unknown =
    hits && typeof hits === "object"
      ? (hits as Record<string, unknown>)["hits"]
      : undefined;

  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((hit: unknown): Record<string, unknown> | null => {
      if (!hit || typeof hit !== "object") {
        return null;
      }

      const source: unknown = (hit as Record<string, unknown>)["_source"];

      return source && typeof source === "object" && !Array.isArray(source)
        ? (source as Record<string, unknown>)
        : {};
    })
    .filter((source: Record<string, unknown> | null): source is Record<
      string,
      unknown
    > => {
      return source !== null;
    });
}

/*
 * The engine a cluster is, from its own answer to GET /: OpenSearch says
 * so in version.distribution. Without an answer, the store's kind says.
 */
export function readEngine(
  rootBody: unknown,
  kind: string,
): SearchEngineName {
  const version: unknown =
    rootBody && typeof rootBody === "object"
      ? (rootBody as Record<string, unknown>)["version"]
      : undefined;
  const distribution: unknown =
    version && typeof version === "object"
      ? (version as Record<string, unknown>)["distribution"]
      : undefined;

  if (typeof distribution === "string") {
    return distribution.toLowerCase() === "opensearch"
      ? "opensearch"
      : "elasticsearch";
  }

  if (rootBody && typeof rootBody === "object" && version) {
    return "elasticsearch";
  }

  return kind === DataStoreKind.OpenSearch ? "opensearch" : "elasticsearch";
}

function plaintextUrlOf(baseUrl: string): string {
  const url: URL = new URL(baseUrl);
  /*
   * The same port the TLS address names, never http's own 80. Read before
   * the scheme changes: an https address's 443 is its default, so a URL
   * leaves it unwritten.
   */
  const port: string = url.port || "443";

  url.protocol = "http:";
  url.port = port;

  return url.toString().replace(/\/+$/, "");
}

export async function sampleSearchStore(
  store: SearchStoreConnection,
  options: ContentScanOptions,
  context: SearchSamplerContext,
): Promise<ContentScanResult> {
  const secrets: Array<string> = getSearchConnectionSecrets(
    store.connectionString,
  );
  const result: ContentScanResult = emptyContentScanResult();
  const warnings: Array<string> = [];
  const limits: ContentScanOptions["limits"] = options.limits;
  const deadline: number = limits.deadline.getTime();
  const fingerprints: FingerprintAccumulator = new FingerprintAccumulator(
    options.fingerprintKey,
  );
  const locations: Array<LocationFindings> = [];
  const plaintextPasswordFields: Array<string> = [];
  const unplacedFields: Array<UnplacedField> = [];
  // What the drafts run in shadow would find, by field (#10371).
  const shadowCounts: ShadowCounts = {};
  const exclusions: SearchExclusions = readSearchExclusions(options.exclusions);
  let isComplete: boolean = true;
  let estimatedRecords: number = 0;
  // With the model on, the indices take turns at its time (#10928).
  const turn: ModelTurnTracker = new ModelTurnTracker({
    model: options.model,
    previous: readModelResumeAt(options.previousState),
  });

  const warn: (message: string) => void = (message: string): void => {
    if (warnings.length < MAX_WARNINGS && !warnings.includes(message)) {
      warnings.push(message);
    }
  };

  const keepTurn: () => void = (): void => {
    if (turn.isTurning) {
      result.nextState = withModelResumeAt(
        result.nextState,
        readModelResumeAt(options.previousState),
      );
    }
  };

  const clean: (error: unknown) => string = (error: unknown): string => {
    return sanitizeErrorMessage(error, secrets);
  };

  // No time left: not even a request is sent.
  if (Date.now() >= deadline) {
    result.warnings = [writeScanWarning("databaseTimeLimitBeforeConnecting")];
    result.isComplete = false;
    keepTurn();
    return result;
  }

  let connection: SearchConnection;

  try {
    connection = readSearchConnection(store.connectionString);
  } catch (error) {
    throw new Error(`Could not read the connection: ${clean(error)}`);
  }

  // Every request goes out through here: a GET, bounded, its secrets kept out of its errors.
  const send: (data: {
    path: string;
    withCredentials: boolean;
    plaintext?: boolean | undefined;
    timeoutInMs?: number | undefined;
  }) => Promise<SearchHttpResponse> = async (data: {
    path: string;
    withCredentials: boolean;
    plaintext?: boolean | undefined;
    timeoutInMs?: number | undefined;
  }): Promise<SearchHttpResponse> => {
    const base: string = data.plaintext
      ? plaintextUrlOf(connection.baseUrl)
      : connection.baseUrl;
    const request: SearchHttpRequest = {
      method: "GET",
      url: `${base}${data.path}`,
      headers: {
        Accept: "application/json",
        ...(data.withCredentials && connection.authorization
          ? { Authorization: connection.authorization }
          : {}),
      },
      timeoutInMs: Math.max(
        1_000,
        Math.min(
          data.timeoutInMs || STATEMENT_TIMEOUT_IN_MS,
          deadline - Date.now(),
        ),
      ),
      ...(data.plaintext || !connection.tls ? {} : { tls: connection.tls }),
    };

    assertReadOnlySearchRequest(request);

    return await context.transport(request);
  };

  // 1. The cluster, with the person's credentials: what it is.
  let rootBody: unknown = undefined;

  try {
    const root: SearchHttpResponse = await send({
      path: "/",
      withCredentials: true,
      timeoutInMs: CONNECT_TIMEOUT_IN_MS,
    });

    if (root.statusCode === 401) {
      throw new Error(
        `the cluster refused the user or API key in the connection string (${errorOf(root)})`,
      );
    }

    // A read-only user may lack the cluster privilege GET / needs (403): it reads on.
    if (root.statusCode >= 500) {
      throw new Error(errorOf(root));
    }

    rootBody = parseJson(root.bodyText);
  } catch (error) {
    throw new Error(`Could not connect to the cluster: ${clean(error)}`);
  }

  const engine: SearchEngineName = readEngine(rootBody, store.kind);

  // 2. What it holds.
  let groups: Array<IndexGroup>;

  try {
    const listing: SearchHttpResponse = await send({
      path: "/_cat/indices?format=json&h=index,status,docs.count,creation.date&expand_wildcards=all&s=index",
      withCredentials: true,
    });

    if (listing.statusCode < 200 || listing.statusCode >= 300) {
      throw new Error(errorOf(listing));
    }

    const indices: Array<ListedIndex> = readListedIndices(
      parseJson(listing.bodyText),
    ).slice(0, MAX_LISTED_INDICES);
    let dataStreams: Array<ListedDataStream> = [];

    try {
      // No parameters: OpenSearch refuses expand_wildcards here (400).
      const streams: SearchHttpResponse = await send({
        path: "/_data_stream",
        withCredentials: true,
      });

      // A cluster older than data streams, or a user who may not list them, has none.
      if (streams.statusCode >= 200 && streams.statusCode < 300) {
        dataStreams = readDataStreams(parseJson(streams.bodyText));
      }
    } catch {
      dataStreams = [];
    }

    groups = groupIndices({ indices, dataStreams });
  } catch (error) {
    warn(
      writeScanWarning("searchCouldNotListIndices", { error: clean(error) }),
    );
    groups = [];
    isComplete = false;
  }

  const readable: number = groups.reduce(
    (sum: number, group: IndexGroup): number => {
      return sum + group.documents;
    },
    0,
  );

  // 3. How exposed it is, asked without credentials.
  try {
    result.posture = await checkSearchEndpoint({
      engine,
      isHttps: connection.isHttps,
      readFrom: context.readFrom,
      documentsReadableWithCredentials: isComplete ? readable : null,
      now: new Date(),
      ask: async (request: {
        path: string;
        plaintext: boolean;
      }): Promise<SearchEndpointAnswer> => {
        try {
          const response: SearchHttpResponse = await send({
            path: request.path,
            withCredentials: false,
            plaintext: request.plaintext,
            timeoutInMs: CONNECT_TIMEOUT_IN_MS,
          });

          return {
            statusCode: response.statusCode,
            bodyText: response.bodyText.slice(0, 2_000),
            bodyJson: parseJson(response.bodyText),
          };
        } catch (error) {
          return {
            statusCode: null,
            bodyText: "",
            bodyJson: undefined,
            failure:
              error instanceof SearchTransportError
                ? error.reason === "tooLarge"
                  ? "unreachable"
                  : error.reason
                : "unreachable",
          };
        }
      },
    });
  } catch (error) {
    warn(
      writeScanWarning("searchExposureNotChecked", { error: clean(error) }),
    );
  }

  if (groups.length === 0) {
    result.warnings = warnings;
    result.isComplete = isComplete;
    keepTurn();
    return result;
  }

  // 4. What the scan reads of it.
  const eligible: Array<IndexGroup> = groups.filter(
    (group: IndexGroup): boolean => {
      return !exclusions.isGroupExcluded(group);
    },
  );
  const chosenInOrder: Array<IndexGroup> = [...eligible]
    .sort((a: IndexGroup, b: IndexGroup): number => {
      return Number(a.documents === 0) - Number(b.documents === 0);
    })
    .slice(0, Math.max(0, limits.maxTables));
  const chosen: Array<IndexGroup> = turn.isTurning
    ? [
        ...rotateForModel(
          chosenInOrder.filter((group: IndexGroup): boolean => {
            return group.documents > 0;
          }),
          (group: IndexGroup): string => {
            return group.name;
          },
          readModelResumeAt(options.previousState),
        ),
        ...chosenInOrder.filter((group: IndexGroup): boolean => {
          return group.documents === 0;
        }),
      ]
    : chosenInOrder;

  if (eligible.length > chosen.length) {
    isComplete = false;
    warn(
      writeScanWarning("searchIndicesNotSampled", {
        count: eligible.length - chosen.length,
        max: limits.maxTables,
      }),
    );
  }

  const nameAt: (index: number) => string | null = (
    index: number,
  ): string | null => {
    return chosen[index % chosen.length]?.name || null;
  };

  // A group read in index order, one page: for an index that cannot sort by its timestamp.
  const readInIndexOrder: (
    group: IndexGroup,
    wanted: number,
    excludedFields: Array<string>,
  ) => Promise<Array<Record<string, unknown>>> = async (
    group: IndexGroup,
    wanted: number,
    excludedFields: Array<string>,
  ): Promise<Array<Record<string, unknown>>> => {
    const page: SearchHttpResponse = await send({
      path: buildSearchPath({
        target: group.target,
        from: 0,
        size: Math.min(SEARCH_PAGE_SIZE, wanted),
        sortField: null,
        excludedFields,
      }),
      withCredentials: true,
    });

    if (page.statusCode < 200 || page.statusCode >= 300) {
      throw new Error(errorOf(page));
    }

    result.bytesRead += page.bodyText.length;

    return readHitSources(parseJson(page.bodyText));
  };

  /*
   * One group's documents: a page at a time, from its newest, until the
   * scan has as many as it reads of one index - each page halved while its
   * answer is too large to take, and the byte budget kept.
   */
  const readDocuments: (
    group: IndexGroup,
  ) => Promise<Array<Record<string, unknown>>> = async (
    group: IndexGroup,
  ): Promise<Array<Record<string, unknown>>> => {
    let mapped: Array<MappedField> = [];

    try {
      const mapping: SearchHttpResponse = await send({
        path: `/${encodeTarget(group.mappingIndex)}/_mapping`,
        withCredentials: true,
      });

      // A user who may not read mappings still reads documents: in index order.
      if (mapping.statusCode >= 200 && mapping.statusCode < 300) {
        mapped = readMappingFields(parseJson(mapping.bodyText));
      }
    } catch (error) {
      if (
        error instanceof SearchTransportError &&
        error.reason === "timeout"
      ) {
        throw error;
      }
    }

    const readFields: Array<MappedField> = mapped.filter(
      (field: MappedField): boolean => {
        return !SKIPPED_TYPES.has(field.type);
      },
    );
    const sortField: string | null =
      group.timestampField ||
      (mapped.some((field: MappedField): boolean => {
        return (
          field.path === TIMESTAMP_FIELD && TIMESTAMP_TYPES.has(field.type)
        );
      })
        ? TIMESTAMP_FIELD
        : null);
    const excludedFields: Array<string> = mapped
      .filter((field: MappedField): boolean => {
        return EXCLUDED_FROM_SOURCE_TYPES.has(field.type);
      })
      .map((field: MappedField): string => {
        return field.path;
      });
    const width: number = Math.max(
      1,
      Math.min(MAX_FIELDS_PER_INDEX, readFields.length || MAX_FIELDS_PER_INDEX),
    );
    const wanted: number = Math.max(
      1,
      Math.min(
        limits.maxRowsPerTable,
        MAX_DOCUMENTS_PER_INDEX,
        Math.floor(MAX_CELLS_PER_TABLE / width),
      ),
    );
    const sources: Array<Record<string, unknown>> = [];
    let pageSize: number = Math.min(SEARCH_PAGE_SIZE, wanted);

    while (sources.length < wanted) {
      if (Date.now() >= deadline || result.bytesRead >= limits.maxBytesTotal) {
        isComplete = false;
        break;
      }

      const size: number = Math.min(pageSize, wanted - sources.length);
      let page: SearchHttpResponse;

      try {
        page = await send({
          path: buildSearchPath({
            target: group.target,
            from: sources.length,
            size,
            sortField,
            excludedFields,
          }),
          withCredentials: true,
        });
      } catch (error) {
        if (
          error instanceof SearchTransportError &&
          error.reason === "tooLarge" &&
          pageSize > 1
        ) {
          pageSize = Math.max(1, Math.floor(pageSize / 2));
          continue;
        }

        throw error;
      }

      if (page.statusCode < 200 || page.statusCode >= 300) {
        // Sorted by a timestamp an index does not map: read in index order instead.
        if (page.statusCode === 400 && sortField && sources.length === 0) {
          return await readInIndexOrder(group, wanted, excludedFields);
        }

        throw new Error(errorOf(page));
      }

      result.bytesRead += page.bodyText.length;

      const hits: Array<Record<string, unknown>> = readHitSources(
        parseJson(page.bodyText),
      );

      sources.push(...hits);

      if (hits.length < size) {
        break;
      }
    }

    return sources.slice(0, wanted);
  };

  let consecutiveFailures: number = 0;

  for (const [position, group] of chosen.entries()) {
    if (Date.now() >= deadline) {
      isComplete = false;
      turn.notReached(group.name);
      warn(
        writeScanWarning("searchTimeLimitAfterIndices", {
          read: result.objectsRead,
          total: chosen.length,
        }),
      );
      break;
    }

    if (result.bytesRead >= limits.maxBytesTotal) {
      isComplete = false;
      turn.notReached(group.name);
      warn(
        writeScanWarning("searchBytesAfterIndices", {
          bytes: limits.maxBytesTotal,
          read: result.objectsRead,
          total: chosen.length,
        }),
      );
      break;
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      isComplete = false;
      turn.notReached(group.name);
      warn(
        writeScanWarning("searchFailuresInARow", {
          count: MAX_CONSECUTIVE_FAILURES,
        }),
      );
      break;
    }

    if (group.documents === 0) {
      consecutiveFailures = 0;
      continue;
    }

    try {
      const sources: Array<Record<string, unknown>> = await readDocuments(
        group,
      );

      consecutiveFailures = 0;
      result.objectsRead++;
      result.rowsRead += sources.length;

      if (result.readLog.length < MAX_READ_LOG_ENTRIES) {
        result.readLog.push(
          group.target === group.name
            ? group.name
            : `${group.name} (${group.target})`,
        );
      }

      const collector: FieldCollector = new FieldCollector({
        maxFields: MAX_FIELDS_PER_INDEX,
        maxValuesPerField: MAX_FIELD_VALUES,
        maxValueLength: MAX_VALUE_LENGTH,
      });

      for (const source of sources) {
        collector.addRecord(source);
      }

      const fields: Array<CollectedField> = collector
        .getFields()
        .filter((field: CollectedField): boolean => {
          return !exclusions.isFieldExcluded(group, field.path);
        });

      if (sources.length === 0 || fields.length === 0) {
        continue;
      }

      // The names-and-addresses model reads the index's free-text fields.
      turn.begin();

      const recognitions: ModelRecognitions | undefined =
        await recognizeFields(options.model, CONTENT_STORE_KEY, fields);

      turn.end(group.name, nameAt(position + 1));

      const classified: FieldsClassification = classifyCollectedFields({
        fields,
        options,
        fingerprints,
        locationKind: DataStoreLocationKind.Field,
        recognitions,
      });
      const prefix: string = `${group.name}${LOCATION_SEPARATOR}`;

      for (const location of classified.locations) {
        locations.push({ ...location, location: prefix + location.location });
      }

      for (const unplaced of classified.unplacedFields) {
        const path: string = prefix + unplaced.location;

        if (
          unplacedFields.length < MAX_UNPLACED_FIELDS_PER_SCAN &&
          path.length <= MAX_UNPLACED_LOCATION_LENGTH
        ) {
          unplacedFields.push({ ...unplaced, location: path });
        }
      }

      mergeShadowCounts(shadowCounts, classified.shadowCounts, prefix);

      for (const field of classified.plaintextPasswordFields) {
        if (plaintextPasswordFields.length < MAX_PLAINTEXT_PASSWORD_FIELDS) {
          plaintextPasswordFields.push(prefix + field);
        }
      }

      // Documents holding sensitive data, scaled from the sample to the index.
      estimatedRecords +=
        classified.sensitiveShare *
        Math.max(group.documents, sources.length);
    } catch (error) {
      consecutiveFailures++;
      isComplete = false;
      warn(
        writeScanWarning("databaseCouldNotSampleTable", {
          table: group.name,
          error: clean(error),
        }),
      );
    }
  }

  result.locations = locations;
  result.fingerprints = fingerprints.getFingerprints();
  result.plaintextPasswordFields = plaintextPasswordFields;
  result.warnings = warnings;
  result.isComplete = isComplete;
  result.estimatedRecords =
    result.objectsRead > 0 ? Math.round(estimatedRecords) : undefined;
  result.unplacedFields = unplacedFields;

  // Where the next scan's model starts (#10928).
  if (turn.isTurning) {
    result.nextState = withModelResumeAt(result.nextState, turn.nextResumeAt);
  }

  if ((options.shadowDetectors || []).length > 0) {
    result.shadowCounts = shadowCounts;
  }

  return result;
}
