import { isDataConfidence } from "../../../Types/DataSecurity/DataConfidence";
import {
  DataStoreKind,
  isSearchEngineDataStoreKind,
  PROBE_SCANNABLE_DATA_STORE_KINDS,
  PROBE_SCANNABLE_DATABASE_KINDS,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  DataStorePostureFacts,
  DataStorePostureReadFrom,
} from "../../../Types/DataSecurity/DataStorePosture";
import { JSONObject } from "../../../Types/JSON";
import {
  ALL_CUSTOM_DATA_TYPE_VALIDATORS,
  compileCustomDataType,
  CustomDataTypeDefinition,
  CustomDataTypeValidator,
} from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import { FieldClassification } from "../../../Utils/DataSecurity/FieldClassifier";
import { MAX_MASKED_SAMPLES } from "../../../Utils/DataSecurity/FindingTally";
import { MAX_MASKED_SAMPLE_LENGTH } from "../../../Utils/DataSecurity/Masking";
import {
  compileShadowDetectors,
  isShadowKey,
  MAX_SHADOW_DETECTORS,
  readShadowCounts,
  ShadowCounts,
  ShadowDraft,
  toShadowDefinition,
} from "../../../Utils/DataSecurity/ShadowCount";
import { ScanDetector } from "../../../Utils/DataSecurity/TextScanner";
import { readUnplacedFields } from "../../../Utils/DataSecurity/UnplacedFields";
import type { DatabaseEngine } from "./Content/DatabaseSampler";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  LocationFindings,
  MAX_READ_LOG_ENTRIES,
} from "./DataSecurityScanTypes";
import { isFingerprint, MAX_FINGERPRINTED_DATA_TYPES } from "./Fingerprint";
import { readModelResumeAt, withModelResumeAt } from "./Model/ModelTurns";

/*
 * A DATABASE ONLY A CUSTOMER'S PROBE CAN REACH, SCANNED FROM THAT PROBE.
 *
 * A database inside a private network is scanned by the probe the
 * customer runs there, with a connection string only the probe knows: the
 * store names an environment variable of the probe (probeConnectionVariable)
 * and the probe reads the connection string from it. The conversation:
 *
 *   POST /probe/data-security/work    the stores due for a scan by this
 *                                     probe, each claimed so no other poll
 *                                     gets it, with what the scan needs -
 *                                     the variable's name, never a
 *                                     connection string
 *   POST /probe/data-security/result  what the scan found (a
 *                                     ContentScanResult: findings by
 *                                     column, never values), or why it
 *                                     could not run
 *
 * This file is that conversation's contract: what each side sends, how the
 * probe turns a store's work into scan options, and how the server reads a
 * result it does not trust - every field checked and bounded, every data
 * type one the project knows.
 */

export const DATA_SECURITY_PROBE_WORK_ROUTE: string =
  "/probe/data-security/work";
export const DATA_SECURITY_PROBE_RESULT_ROUTE: string =
  "/probe/data-security/result";

// How long one store's scan may run on the probe.
export const DATA_SECURITY_PROBE_SCAN_TIME_LIMIT_IN_SECONDS: number = 600;

// How long a claimed store is held for its probe before it is due again.
export const DATA_SECURITY_PROBE_CLAIM_IN_MINUTES: number = 120;

// The most stores handed to a probe in one poll.
export const DATA_SECURITY_PROBE_STORES_PER_POLL: number = 2;

/*
 * The name of the probe's environment variable that holds a store's
 * connection string: a shell variable's name, upper case.
 */
export const PROBE_CONNECTION_VARIABLE_PATTERN: RegExp =
  /^[A-Z_][A-Z0-9_]{0,63}$/;

// The probe's own settings, which never hold a database's connection string.
const PROBE_OWN_VARIABLE_PREFIXES: ReadonlyArray<string> = ["PROBE_"];
const PROBE_OWN_VARIABLES: ReadonlySet<string> = new Set([
  "REGISTER_PROBE_KEY",
  "ONEUPTIME_SECRET",
]);

export function isValidProbeConnectionVariable(name: unknown): name is string {
  return (
    typeof name === "string" &&
    PROBE_CONNECTION_VARIABLE_PATTERN.test(name) &&
    !PROBE_OWN_VARIABLES.has(name) &&
    !PROBE_OWN_VARIABLE_PREFIXES.some((prefix: string) => {
      return name.startsWith(prefix);
    })
  );
}

// The engine a self-managed database of this kind is sampled with.
export function getDatabaseEngineOfKind(
  kind: string | undefined | null,
): DatabaseEngine | null {
  switch (kind) {
    case DataStoreKind.PostgreSql:
      return "postgresql";
    case DataStoreKind.MySql:
      return "mysql";
    case DataStoreKind.SqlServer:
      return "sqlserver";
    default:
      return null;
  }
}

/*
 * What a probe samples a store with: a database driver (DatabaseSampler),
 * or, for an Elasticsearch or OpenSearch cluster, its HTTP API
 * (SearchStoreSampler, #11140) - handed only to a probe that declares it
 * reads one (ProbeCapability.DataSecuritySearchScan).
 */
type SearchProbeEngine = "search";

export const SEARCH_PROBE_ENGINE: SearchProbeEngine = "search" as const;

export type DataSecurityProbeEngine =
  | DatabaseEngine
  | typeof SEARCH_PROBE_ENGINE;

const PROBE_ENGINES: ReadonlyArray<string> = [
  "postgresql",
  "mysql",
  "sqlserver",
  SEARCH_PROBE_ENGINE,
];

export function getProbeEngineOfKind(
  kind: string | undefined | null,
): DataSecurityProbeEngine | null {
  return isSearchEngineDataStoreKind(kind)
    ? SEARCH_PROBE_ENGINE
    : getDatabaseEngineOfKind(kind);
}

// The kinds a probe samples: one list, which a store's page reads too.
export const PROBE_SCANNABLE_KINDS: ReadonlyArray<DataStoreKind> =
  PROBE_SCANNABLE_DATA_STORE_KINDS;

/*
 * The kinds a probe's claim hands out, by what the probe declares: a
 * search cluster only to one whose build reads it. A probe from before
 * search clusters would refuse the work and leave the store claimed.
 */
export function getProbeClaimableKinds(data: {
  readsSearchClusters: boolean;
}): ReadonlyArray<DataStoreKind> {
  return data.readsSearchClusters
    ? PROBE_SCANNABLE_KINDS
    : PROBE_SCANNABLE_DATABASE_KINDS;
}

export interface DataSecurityProbeLimits {
  maxRowsPerTable: number;
  maxTables: number;
  maxBytesTotal: number;
  // How long the scan may take from when the probe starts it.
  timeLimitInSeconds: number;
}

export interface DataSecurityProbeStoreWork {
  dataStoreId: string;
  kind: string;
  engine: DataSecurityProbeEngine;
  probeConnectionVariable: string;
  limits: DataSecurityProbeLimits;
  exclusions: Array<string>;
  customDataTypes: Array<CustomDataTypeDefinition>;
  disabledDataTypeIds: Array<string>;
  allowedValues: Array<string>;
  /*
   * The project's fingerprint key, so the probe's fingerprints compare with
   * the project's other stores'. Handed only to the project's own probe.
   */
  fingerprintKey: string;
  /*
   * Whether the probe reads free-text columns for names and street
   * addresses with the model in its own image (Model/ModelScan.ts). Off
   * when a server older than the model says nothing.
   */
  findNamesAndAddresses: boolean;
  /*
   * The table the model's turn starts at in this scan: where the store's
   * last scan's model stopped (Model/ModelTurns.ts, #10928). Absent to
   * start at the first, and from a server older than the turns.
   */
  modelResumeAt?: string | undefined;
  /*
   * The data types OneUptime AI drafted from this store's fields, run in
   * shadow (#10371): counted, never found. A probe older than them leaves
   * them out, and its store is proven by the others of the group.
   */
  shadowDataTypes?: Array<ShadowDraft> | undefined;
}

export interface DataSecurityProbeWorkResponse {
  stores: Array<DataSecurityProbeStoreWork>;
}

export interface DataSecurityProbeResultReport {
  dataStoreId: string;
  result?: ContentScanResult | undefined;
  startedAt: string;
  error?: string | undefined;
}

/*
 * THE PROBE'S SIDE: reading the work it is handed.
 */
function readStrings(
  value: unknown,
  max: number,
  maxLength: number,
): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item: unknown): item is string => {
      return typeof item === "string" && item.length > 0;
    })
    .slice(0, max)
    .map((item: string) => {
      return item.slice(0, maxLength);
    });
}

function readWholeNumber(
  value: unknown,
  fallback: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), max)
    : fallback;
}

// A draft run in shadow, as the server hands it: a key and how it is found.
function readShadowDataType(value: unknown): ShadowDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const draft: JSONObject = value as JSONObject;
  const definition: CustomDataTypeDefinition | null = readCustomDataType({
    ...((draft["definition"] as JSONObject | undefined) || {}),
    dataTypeId: "custom:shadow",
  });

  if (!isShadowKey(draft["key"]) || !definition?.pattern) {
    return null;
  }

  return {
    key: draft["key"] as string,
    definition: toShadowDefinition(definition),
  };
}

function readCustomDataType(value: unknown): CustomDataTypeDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const definition: JSONObject = value as JSONObject;
  const dataTypeId: unknown = definition["dataTypeId"];

  if (typeof dataTypeId !== "string" || !dataTypeId.startsWith("custom:")) {
    return null;
  }

  const validator: unknown = definition["validator"];

  return {
    dataTypeId: dataTypeId.slice(0, 100),
    pattern:
      typeof definition["pattern"] === "string"
        ? (definition["pattern"] as string).slice(0, 1000)
        : undefined,
    ignoreCase: definition["ignoreCase"] === true,
    keywords: readStrings(definition["keywords"], 50, 100),
    requiresKeyword: definition["requiresKeyword"] === true,
    nameHints: readStrings(definition["nameHints"], 50, 100),
    validator: (
      ALL_CUSTOM_DATA_TYPE_VALIDATORS as ReadonlyArray<unknown>
    ).includes(validator)
      ? (validator as CustomDataTypeValidator)
      : CustomDataTypeValidator.None,
  };
}

// One store of the server's answer, or null when it is not one.
export function readProbeStoreWork(
  value: unknown,
): DataSecurityProbeStoreWork | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const work: JSONObject = value as JSONObject;
  const engine: unknown = work["engine"];
  const limits: JSONObject =
    work["limits"] && typeof work["limits"] === "object"
      ? (work["limits"] as JSONObject)
      : {};

  if (
    typeof work["dataStoreId"] !== "string" ||
    typeof engine !== "string" ||
    !PROBE_ENGINES.includes(engine) ||
    typeof work["probeConnectionVariable"] !== "string"
  ) {
    return null;
  }

  // A search cluster is read as its kind says: Elasticsearch or OpenSearch.
  if (
    engine === SEARCH_PROBE_ENGINE &&
    !isSearchEngineDataStoreKind(work["kind"] as string)
  ) {
    return null;
  }

  const customDataTypes: Array<CustomDataTypeDefinition> = [];

  if (Array.isArray(work["customDataTypes"])) {
    for (const item of (work["customDataTypes"] as Array<unknown>).slice(
      0,
      200,
    )) {
      const definition: CustomDataTypeDefinition | null =
        readCustomDataType(item);

      if (definition) {
        customDataTypes.push(definition);
      }
    }
  }

  return {
    dataStoreId: work["dataStoreId"] as string,
    kind: typeof work["kind"] === "string" ? (work["kind"] as string) : "",
    engine: engine as DataSecurityProbeEngine,
    probeConnectionVariable: work["probeConnectionVariable"] as string,
    limits: {
      maxRowsPerTable: readWholeNumber(
        limits["maxRowsPerTable"],
        1000,
        100_000,
      ),
      maxTables: readWholeNumber(limits["maxTables"], 200, 5000),
      maxBytesTotal: readWholeNumber(
        limits["maxBytesTotal"],
        50 * 1024 * 1024,
        1024 * 1024 * 1024,
      ),
      timeLimitInSeconds: Math.max(
        10,
        readWholeNumber(
          limits["timeLimitInSeconds"],
          DATA_SECURITY_PROBE_SCAN_TIME_LIMIT_IN_SECONDS,
          3600,
        ),
      ),
    },
    exclusions: readStrings(work["exclusions"], 500, 500),
    customDataTypes,
    disabledDataTypeIds: readStrings(work["disabledDataTypeIds"], 500, 100),
    allowedValues: readStrings(work["allowedValues"], 1000, 500),
    fingerprintKey:
      typeof work["fingerprintKey"] === "string"
        ? (work["fingerprintKey"] as string)
        : "",
    findNamesAndAddresses: work["findNamesAndAddresses"] === true,
    ...(readModelResumeAt({ model: { resumeAt: work["modelResumeAt"] } })
      ? {
          modelResumeAt: readModelResumeAt({
            model: { resumeAt: work["modelResumeAt"] },
          })!,
        }
      : {}),
    shadowDataTypes: (Array.isArray(work["shadowDataTypes"])
      ? (work["shadowDataTypes"] as Array<unknown>)
      : []
    )
      .slice(0, MAX_SHADOW_DETECTORS)
      .map(readShadowDataType)
      .filter((draft: ShadowDraft | null): draft is ShadowDraft => {
        return draft !== null;
      }),
  };
}

const NUMBER_SEPARATORS: ReadonlySet<string> = new Set([
  " ",
  "-",
  ".",
  "(",
  ")",
  "+",
  "/",
]);

/*
 * The project's never-sensitive values as the scanner compares them:
 * trimmed and lower-cased, and a number written with separators
 * ("4111 1111 1111 1111") also as its digits, the form its detector
 * normalizes it to.
 */
export function normalizeAllowedValues(values: Array<string>): Set<string> {
  const allowed: Set<string> = new Set();

  for (const value of values) {
    const normalized: string = value.trim().toLowerCase();

    if (!normalized) {
      continue;
    }

    allowed.add(normalized);

    let digits: string = "";
    let isNumber: boolean = true;

    for (const character of normalized) {
      if (character >= "0" && character <= "9") {
        digits += character;
      } else if (!NUMBER_SEPARATORS.has(character)) {
        isNumber = false;
        break;
      }
    }

    if (isNumber && digits.length > 0) {
      allowed.add(digits);
    }
  }

  return allowed;
}

// The options a probe scans one store with, its deadline from now.
export function buildProbeScanOptions(
  work: DataSecurityProbeStoreWork,
  now: Date = new Date(),
): ContentScanOptions {
  const customDetectors: Array<ScanDetector> = [];

  for (const definition of work.customDataTypes) {
    const detector: ScanDetector | null = compileCustomDataType(definition);

    if (detector) {
      customDetectors.push(detector);
    }
  }

  return {
    limits: {
      maxObjects: 0,
      maxBytesPerObject: 0,
      maxBytesTotal: work.limits.maxBytesTotal,
      maxRowsPerTable: work.limits.maxRowsPerTable,
      maxTables: work.limits.maxTables,
      deadline: new Date(now.getTime() + work.limits.timeLimitInSeconds * 1000),
    },
    customDetectors,
    extraHints: work.customDataTypes
      .filter((definition: CustomDataTypeDefinition) => {
        return (definition.nameHints || []).length > 0;
      })
      .map((definition: CustomDataTypeDefinition) => {
        return {
          dataTypeId: definition.dataTypeId,
          hints: [...(definition.nameHints || [])],
        };
      }),
    disabledDataTypeIds: new Set(work.disabledDataTypeIds),
    allowedValues: normalizeAllowedValues(work.allowedValues),
    exclusions: work.exclusions,
    fingerprintKey: work.fingerprintKey,
    shadowDetectors: compileShadowDetectors(work.shadowDataTypes || []),
    // Where the model's turn starts: the server keeps it between scans.
    previousState: withModelResumeAt(undefined, work.modelResumeAt || null),
  };
}

/*
 * THE SERVER'S SIDE: a result from a probe, read without trusting it.
 * Bounded like the writer bounds it, and with only data types the project
 * knows - built-in or its own - so a probe cannot invent findings of a
 * type no one defined.
 */
export const MAX_PROBE_RESULT_LOCATIONS: number = 5_000;
const MAX_CLASSIFICATIONS_PER_LOCATION: number = 50;
const MAX_COUNT: number = 1_000_000_000;

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), MAX_COUNT)
    : 0;
}

const LOCATION_KINDS: ReadonlySet<string> = new Set(
  Object.values(DataStoreLocationKind),
);

function readClassification(
  value: unknown,
  isKnownDataType: (dataTypeId: string) => boolean,
): FieldClassification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: JSONObject = value as JSONObject;
  const dataTypeId: unknown = raw["dataTypeId"];

  if (
    typeof dataTypeId !== "string" ||
    dataTypeId.length > 100 ||
    !isKnownDataType(dataTypeId) ||
    !isDataConfidence(raw["confidence"])
  ) {
    return null;
  }

  const valueCount: number = readCount(raw["valueCount"]);
  const valuesWithMatch: number = Math.min(
    valueCount,
    readCount(raw["valuesWithMatch"]),
  );

  const classification: FieldClassification = {
    dataTypeId,
    matchCount: readCount(raw["matchCount"]),
    testValueCount: readCount(raw["testValueCount"]),
    confidence: raw["confidence"],
    maskedSamples: readStrings(
      raw["maskedSamples"],
      MAX_MASKED_SAMPLES,
      MAX_MASKED_SAMPLE_LENGTH,
    ),
    distinctValues: readCount(raw["distinctValues"]),
    distinctValuesCapped: raw["distinctValuesCapped"] === true,
    matchRatio: valueCount > 0 ? valuesWithMatch / valueCount : 0,
    valueCount,
    valuesWithMatch,
    isFreeText: raw["isFreeText"] === true,
    nameHinted: raw["nameHinted"] === true,
    foundByName: raw["foundByName"] === true,
  };

  if (raw["foundByModel"] === true) {
    classification.foundByModel = true;
  }

  return classification;
}

/*
 * A probe's ContentScanResult, checked and bounded, or null when what it
 * sent is not one.
 */
export function readProbeScanResult(
  value: unknown,
  isKnownDataType: (dataTypeId: string) => boolean,
  // The drafts the probe was handed to run in shadow: only their counts are kept.
  isExpectedShadowKey: (key: string) => boolean = (): boolean => {
    return false;
  },
  /*
   * A search cluster's scan says how exposed it is, too (#11140): read only
   * for a store whose endpoint a scan checks, as of when the server heard.
   */
  posture?: { readAt: Date } | undefined,
): ContentScanResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: JSONObject = value as JSONObject;
  const locations: Array<LocationFindings> = [];

  if (Array.isArray(raw["locations"])) {
    for (const item of (raw["locations"] as Array<unknown>).slice(
      0,
      MAX_PROBE_RESULT_LOCATIONS,
    )) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const location: JSONObject = item as JSONObject;
      const name: unknown = location["location"];
      const kind: unknown = location["locationKind"];

      if (
        typeof name !== "string" ||
        name.length === 0 ||
        typeof kind !== "string" ||
        !LOCATION_KINDS.has(kind) ||
        !Array.isArray(location["classifications"])
      ) {
        continue;
      }

      const classifications: Array<FieldClassification> = [];

      for (const classification of (
        location["classifications"] as Array<unknown>
      ).slice(0, MAX_CLASSIFICATIONS_PER_LOCATION)) {
        const read: FieldClassification | null = readClassification(
          classification,
          isKnownDataType,
        );

        if (read) {
          classifications.push(read);
        }
      }

      if (classifications.length > 0) {
        locations.push({
          location: name.slice(0, 500),
          locationKind: kind as DataStoreLocationKind,
          classifications,
        });
      }
    }
  }

  const fingerprints: Record<string, Array<number>> = {};
  const rawFingerprints: unknown = raw["fingerprints"];

  if (
    rawFingerprints &&
    typeof rawFingerprints === "object" &&
    !Array.isArray(rawFingerprints)
  ) {
    for (const [dataTypeId, fingerprint] of Object.entries(
      rawFingerprints as Record<string, unknown>,
    )) {
      if (Object.keys(fingerprints).length >= MAX_FINGERPRINTED_DATA_TYPES) {
        break;
      }

      if (isKnownDataType(dataTypeId) && isFingerprint(fingerprint)) {
        fingerprints[dataTypeId] = [...fingerprint];
      }
    }
  }

  const estimatedRecords: unknown = raw["estimatedRecords"];

  return {
    locations,
    readLog: readStrings(raw["readLog"], MAX_READ_LOG_ENTRIES, 300),
    objectsRead: readCount(raw["objectsRead"]),
    rowsRead: readCount(raw["rowsRead"]),
    bytesRead: readCount(raw["bytesRead"]),
    warnings: readStrings(raw["warnings"], 50, 500),
    fingerprints,
    plaintextPasswordFields: readStrings(
      raw["plaintextPasswordFields"],
      50,
      500,
    ),
    estimatedRecords:
      typeof estimatedRecords === "number" &&
      Number.isFinite(estimatedRecords) &&
      estimatedRecords >= 0
        ? Math.min(Math.round(estimatedRecords), Number.MAX_SAFE_INTEGER)
        : undefined,
    isComplete: raw["isComplete"] === true,
    // Where the next scan's model starts: a table's name, nothing else of the state.
    ...readProbeModelTurn(raw["nextState"]),
    // Shapes and names only: each shape is read again (isValueShape).
    unplacedFields: readUnplacedFields(
      raw["unplacedFields"],
      (kind: string): boolean => {
        return LOCATION_KINDS.has(kind);
      },
    ),
    ...readProbeShadowCounts(raw["shadowCounts"], isExpectedShadowKey),
    ...(posture ? readProbePosture(raw["posture"], posture.readAt) : {}),
  };
}

// The facts a probe's endpoint check may say, each true, false or null.
const PROBE_POSTURE_FACTS: ReadonlyArray<
  "anonymousRead" | "anonymousWrite" | "encryptionInTransitEnforced"
> = ["anonymousRead", "anonymousWrite", "encryptionInTransitEnforced"];

// The facts a probe may say it cannot know, when they are null.
const PROBE_UNKNOWABLE_FACTS: ReadonlySet<string> = new Set([
  "anonymousWrite",
  "publicRead",
  "publicWrite",
  "publicNetworkAccess",
  "openToAllAddresses",
  "minimumTlsVersion",
]);

function readFact(value: unknown): boolean | null | undefined {
  return value === true
    ? true
    : value === false
      ? false
      : value === null
        ? null
        : undefined;
}

/*
 * How exposed a search cluster is, as a probe found it (#11140), read
 * without trusting it. A probe sees the cluster from inside the customer's
 * network, whatever it says, so it never says the internet reaches the
 * cluster, or that anyone on the internet reads it: only whether whoever
 * reaches it does, and nobody without credentials can mean nobody on the
 * internet either. Every other fact is the server's to say.
 */
export function readProbePosture(
  value: unknown,
  readAt: Date,
): { posture?: DataStorePostureFacts } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const raw: JSONObject = value as JSONObject;
  const facts: DataStorePostureFacts = {
    readAt: readAt.toISOString(),
    readFrom: DataStorePostureReadFrom.Network,
  };

  for (const key of PROBE_POSTURE_FACTS) {
    const fact: boolean | null | undefined = readFact(raw[key]);

    if (fact !== undefined) {
      facts[key] = fact;
    }
  }

  facts.publicRead = facts.anonymousRead === false ? false : null;
  facts.publicWrite = facts.anonymousWrite === false ? false : null;
  facts.publicNetworkAccess = null;
  facts.openToAllAddresses = null;

  if (raw["minimumTlsVersion"] === null) {
    facts.minimumTlsVersion = null;
  }

  const unknowable: Set<string> = new Set([
    "publicNetworkAccess",
    "openToAllAddresses",
  ]);

  for (const key of Array.isArray(raw["unknowableFacts"])
    ? (raw["unknowableFacts"] as Array<unknown>)
    : []) {
    if (
      typeof key === "string" &&
      PROBE_UNKNOWABLE_FACTS.has(key) &&
      (facts as Record<string, unknown>)[key] === null
    ) {
      unknowable.add(key);
    }
  }

  facts.unknowableFacts = [...unknowable];

  return { posture: facts };
}

/*
 * The model's turn a probe's scan ended at (#10928): a table's name, and
 * nothing else a probe could put in a store's state.
 */
function readProbeModelTurn(value: unknown): { nextState?: JSONObject } {
  const resumeAt: string | null =
    value && typeof value === "object" && !Array.isArray(value)
      ? readModelResumeAt(value as JSONObject)
      : null;

  return resumeAt ? { nextState: withModelResumeAt(undefined, resumeAt) } : {};
}

// A probe's shadow counts (#10371): counts only, of the drafts it was handed.
function readProbeShadowCounts(
  value: unknown,
  isExpectedShadowKey: (key: string) => boolean,
): { shadowCounts?: ShadowCounts } {
  const counts: ShadowCounts = readShadowCounts(value, isExpectedShadowKey);

  return Object.keys(counts).length > 0 ? { shadowCounts: counts } : {};
}
