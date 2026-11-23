import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import { JSONObject, JSONValue } from "../JSON";
import { translationKey } from "../Translator";
import { toStableJsonText } from "./DataSecurityAi";

/*
 * WHAT THE COMPLIANCE PAPERWORK IS DRAFTED FROM (#10375).
 *
 * OneUptime AI drafts a store's record of processing (its purpose,
 * retention, legal basis and the people it is about), an impact assessment
 * for a store that needs one, and the paragraph an auditor reads under each
 * framework requirement. Every draft rests on facts Data Security's code
 * read - never on OneUptime AI's word - and says which ones: a draft that
 * names none is dropped, and a number it says that none of them holds is a
 * number it made up, so the draft is dropped too (holdTextToFacts).
 *
 * A fact has two names. Its id ("F3") is what one draft's answer cites; it
 * is given again on every read, in the order the facts were read. Its key
 * ("service:<id>", "store") says what it is about, and stays the same from
 * one read to the next: a confirmed draft keeps the keys of the facts it
 * rests on, and is redrafted only when one of them changed
 * (getFactsHash over those keys).
 *
 * The facts hold names, counts, kinds and configuration - never a value of
 * the data, a sample or a record - and every text a cloud, a person or a
 * service wrote is cleaned and held to a length where the facts are made
 * (Server/Utils/AI/DataSecurity/DataSecurityAiInput). The Dashboard words
 * each kind of fact in the reader's language; the exports say them in
 * English (describeComplianceFact).
 *
 * Pure, for the server and the Dashboard alike.
 */

export enum ComplianceFactKind {
  // What the store holds: its data types, their categories, its sensitivity and about how many records.
  StoreHolds = "StoreHolds",
  // What the store is: its name, kind, provider and environment, and the description its team wrote.
  StoreIdentity = "StoreIdentity",
  // Its cloud tags.
  StoreTags = "StoreTags",
  // Where it is: its region and that region's country, where it is copied to, and whose data it holds.
  Location = "Location",
  // A service the service map shows using it, with the description its team wrote.
  ServiceUse = "ServiceUse",
  // A host outside the project that a service using the store calls.
  ExternalHost = "ExternalHost",
  // An AI provider the store's data, or a service using it, is sent to.
  AiProvider = "AiProvider",
  // A copy of the store's data in another store, or the other way round.
  Copy = "Copy",
  // How it is backed up and recovered, as its configuration says.
  Backups = "Backups",
  // How long OneUptime keeps a telemetry store's records: the retention set for them.
  TelemetryRetention = "TelemetryRetention",
  // The repository and files that declare it as code.
  DeclaredCode = "DeclaredCode",
  // How exposed it is.
  Exposure = "Exposure",
  // How it is encrypted, at rest and in transit.
  Encryption = "Encryption",
  // Who can reach it, counted.
  Reach = "Reach",
  // One of its open issues.
  OpenIssue = "OpenIssue",
  // One of its issues fixed lately.
  FixedIssue = "FixedIssue",
  // What its record of processing says of one field.
  RecordEntry = "RecordEntry",
  // A framework requirement's scope: the stores it covers.
  RequirementScope = "RequirementScope",
  // A check that is evidence for a requirement, and where it stands.
  CheckState = "CheckState",
  // A requirement's issues in the period: opened, fixed and how fast.
  IssueHistory = "IssueHistory",
  // An accepted risk under a requirement: why, and until when.
  AcceptedRisk = "AcceptedRisk",
  // A resource that turned a requirement off, and why.
  TurnedOff = "TurnedOff",
}

export const COMPLIANCE_FACT_KINDS: ReadonlyArray<ComplianceFactKind> =
  Object.values(ComplianceFactKind);

// How long ago an issue was fixed, in buckets: no fact changes by the hour.
export enum ComplianceRecency {
  Week = "Week",
  Month = "Month",
  Quarter = "Quarter",
}

interface FactBase<Kind extends ComplianceFactKind> {
  // "F3": what an answer cites it by, given again on every read.
  id: string;
  // What it is about, the same from one read to the next ("service:<id>").
  key: string;
  kind: Kind;
}

export interface StoreHoldsFact
  extends FactBase<ComplianceFactKind.StoreHolds> {
  // By the project's names for them, never an id.
  dataTypes: Array<string>;
  categories: Array<string>;
  sensitivity: string;
  // About how many, rounded.
  records?: number | undefined;
}

export interface StoreIdentityFact
  extends FactBase<ComplianceFactKind.StoreIdentity> {
  name: string;
  storeKind: string;
  provider?: string | undefined;
  environment?: string | undefined;
  // What the store is for, in its team's words.
  description?: string | undefined;
}

export interface StoreTagsFact extends FactBase<ComplianceFactKind.StoreTags> {
  // Each [key, value].
  tags: Array<[string, string]>;
}

export interface LocationFact extends FactBase<ComplianceFactKind.Location> {
  region?: string | undefined;
  // Where the region keeps its data (CloudRegionCountry), when known.
  country?: string | undefined;
  isInEea?: boolean | undefined;
  // Regions its data is copied to by its cloud.
  replicationRegions: Array<string>;
  // Countries whose people's data it holds, from country-bound data types.
  subjectCountries: Array<string>;
}

export interface ServiceUseFact
  extends FactBase<ComplianceFactKind.ServiceUse> {
  service: string;
  // What the service is for, in its team's words.
  description?: string | undefined;
}

export interface ExternalHostFact
  extends FactBase<ComplianceFactKind.ExternalHost> {
  host: string;
  // The service that calls it.
  via: string;
}

export interface AiProviderFact
  extends FactBase<ComplianceFactKind.AiProvider> {
  provider: string;
  // The service whose calls reach it.
  via?: string | undefined;
}

export interface CopyFact extends FactBase<ComplianceFactKind.Copy> {
  otherStore: string;
  otherRegion?: string | undefined;
  otherCountry?: string | undefined;
  otherEnvironment?: string | undefined;
  // The other store holds a copy of this store's data; else this holds the other's.
  isCopyOfThisStore: boolean;
}

export interface BackupsFact extends FactBase<ComplianceFactKind.Backups> {
  backupsEnabled?: boolean | undefined;
  backupRetentionDays?: number | undefined;
  pointInTimeRecovery?: boolean | undefined;
  versioning?: boolean | undefined;
  softDelete?: boolean | undefined;
  deletionProtection?: boolean | undefined;
}

export enum TelemetryRetentionSignal {
  Logs = "logs",
  Traces = "traces",
  Metrics = "metrics",
  SessionReplays = "sessionReplays",
}

export interface TelemetryRetentionFact
  extends FactBase<ComplianceFactKind.TelemetryRetention> {
  signal: TelemetryRetentionSignal;
  days: number;
  // The longest a kind of record is kept, when some are kept longer (by severity, by status).
  maxDays?: number | undefined;
}

export interface DeclaredCodeFact
  extends FactBase<ComplianceFactKind.DeclaredCode> {
  repository: string;
  paths: Array<string>;
  codeKind: string;
}

export interface ExposureFact extends FactBase<ComplianceFactKind.Exposure> {
  exposure: string;
  isPublicByDesign: boolean;
  publicReason?: string | undefined;
}

export interface EncryptionFact
  extends FactBase<ComplianceFactKind.Encryption> {
  encryptedAtRest?: boolean | undefined;
  customerManagedKey?: boolean | undefined;
  encryptionInTransitEnforced?: boolean | undefined;
  minimumTlsVersion?: string | undefined;
}

export interface ReachFact extends FactBase<ComplianceFactKind.Reach> {
  identities: number;
  publicGrants: number;
  externalGrants: number;
  writeGrants: number;
  servicesSeen: number;
}

export interface OpenIssueFact extends FactBase<ComplianceFactKind.OpenIssue> {
  title: string;
  checkId: string;
  severity: string;
}

export interface FixedIssueFact
  extends FactBase<ComplianceFactKind.FixedIssue> {
  title: string;
  checkId: string;
  fixed: ComplianceRecency;
}

export interface RecordEntryFact
  extends FactBase<ComplianceFactKind.RecordEntry> {
  // A RecordField of the record of processing.
  field: string;
  // What the record says, as text: a legal basis or the people by their names.
  value: string;
  // A RecordFieldStatus: whether a person wrote or confirmed it, or it is still a draft.
  status: string;
}

export interface RequirementScopeFact
  extends FactBase<ComplianceFactKind.RequirementScope> {
  stores: number;
  // The first few, by name.
  storeNames: Array<string>;
  framework: string;
  requirement: string;
}

export interface CheckStateFact
  extends FactBase<ComplianceFactKind.CheckState> {
  // How many checks are evidence for the requirement.
  checks: number;
  // The ones an open issue fails on a store in scope, by title.
  failingChecks: Array<string>;
  // Stores in scope where one of them fails.
  failingStores: number;
  openIssues: number;
}

export interface IssueHistoryFact
  extends FactBase<ComplianceFactKind.IssueHistory> {
  periodInDays: number;
  opened: number;
  fixed: number;
  stillOpen: number;
  // How long a fixed issue took at the median, in hours and in days; absent when none was fixed.
  medianHoursToFix?: number | undefined;
  medianDaysToFix?: number | undefined;
}

export interface AcceptedRiskFact
  extends FactBase<ComplianceFactKind.AcceptedRisk> {
  issueTitle: string;
  store: string;
  reason: string;
  // The day it expires, YYYY-MM-DD; absent when it never does.
  until?: string | undefined;
}

export interface TurnedOffFact extends FactBase<ComplianceFactKind.TurnedOff> {
  resource: string;
  resourceKind: string;
  reason: string;
  // The whole framework, rather than the requirement alone.
  isWholeFramework: boolean;
}

export type ComplianceFact =
  | StoreHoldsFact
  | StoreIdentityFact
  | StoreTagsFact
  | LocationFact
  | ServiceUseFact
  | ExternalHostFact
  | AiProviderFact
  | CopyFact
  | BackupsFact
  | TelemetryRetentionFact
  | DeclaredCodeFact
  | ExposureFact
  | EncryptionFact
  | ReachFact
  | OpenIssueFact
  | FixedIssueFact
  | RecordEntryFact
  | RequirementScopeFact
  | CheckStateFact
  | IssueHistoryFact
  | AcceptedRiskFact
  | TurnedOffFact;

// What each kind of fact is, as OneUptime AI and an export are told it.
export const COMPLIANCE_FACT_KIND_WORDS: Readonly<
  Record<ComplianceFactKind, string>
> = {
  [ComplianceFactKind.StoreHolds]: "what the store holds",
  [ComplianceFactKind.StoreIdentity]: "what the store is",
  [ComplianceFactKind.StoreTags]: "the store's cloud tags",
  [ComplianceFactKind.Location]: "where the store's data is",
  [ComplianceFactKind.ServiceUse]: "a service seen using the store",
  [ComplianceFactKind.ExternalHost]:
    "a host outside the project that a service using the store calls",
  [ComplianceFactKind.AiProvider]:
    "an AI provider the store's data, or a service using it, is sent to",
  [ComplianceFactKind.Copy]: "a copy of the store's data in another store",
  [ComplianceFactKind.Backups]: "how the store is backed up and recovered",
  [ComplianceFactKind.TelemetryRetention]:
    "how long OneUptime keeps the store's records",
  [ComplianceFactKind.DeclaredCode]: "the code that declares the store",
  [ComplianceFactKind.Exposure]: "how exposed the store is",
  [ComplianceFactKind.Encryption]: "how the store is encrypted",
  [ComplianceFactKind.Reach]: "who can reach the store, counted",
  [ComplianceFactKind.OpenIssue]: "an open issue of the store",
  [ComplianceFactKind.FixedIssue]: "an issue of the store fixed lately",
  [ComplianceFactKind.RecordEntry]:
    "what the store's record of processing says",
  [ComplianceFactKind.RequirementScope]: "the stores the requirement covers",
  [ComplianceFactKind.CheckState]: "a check that is evidence for it",
  [ComplianceFactKind.IssueHistory]: "its issues in the period",
  [ComplianceFactKind.AcceptedRisk]: "an accepted risk",
  [ComplianceFactKind.TurnedOff]: "a resource that turned it off",
};

// What a reader is told each kind of fact is, in the Dashboard: a key the reader's language words.
export const COMPLIANCE_FACT_KIND_TITLES: Readonly<
  Record<ComplianceFactKind, string>
> = {
  [ComplianceFactKind.StoreHolds]: translationKey("What it holds"),
  [ComplianceFactKind.StoreIdentity]: translationKey("What it is"),
  [ComplianceFactKind.StoreTags]: translationKey("Cloud tags"),
  [ComplianceFactKind.Location]: translationKey("Where its data is"),
  [ComplianceFactKind.ServiceUse]: translationKey("A service that uses it"),
  [ComplianceFactKind.ExternalHost]: translationKey("Outside host"),
  [ComplianceFactKind.AiProvider]: translationKey("AI provider"),
  [ComplianceFactKind.Copy]: translationKey("Copy"),
  [ComplianceFactKind.Backups]: translationKey("Backups"),
  [ComplianceFactKind.TelemetryRetention]: translationKey(
    "Telemetry retention",
  ),
  [ComplianceFactKind.DeclaredCode]: translationKey("Declared in code"),
  [ComplianceFactKind.Exposure]: translationKey("Exposure"),
  [ComplianceFactKind.Encryption]: translationKey("Encryption"),
  [ComplianceFactKind.Reach]: translationKey("Who can reach it"),
  [ComplianceFactKind.OpenIssue]: translationKey("Open issue"),
  [ComplianceFactKind.FixedIssue]: translationKey("Fixed issue"),
  [ComplianceFactKind.RecordEntry]: translationKey("Record of processing"),
  [ComplianceFactKind.RequirementScope]: translationKey("Scope"),
  [ComplianceFactKind.CheckState]: translationKey("Check"),
  [ComplianceFactKind.IssueHistory]: translationKey("Issues in the period"),
  [ComplianceFactKind.AcceptedRisk]: translationKey("Accepted risk"),
  [ComplianceFactKind.TurnedOff]: translationKey("Turned off"),
};

/*
 * ---------------------------------------------------------------------------
 * Reading what was kept
 * ---------------------------------------------------------------------------
 */

// The most facts one draft keeps.
export const MAX_COMPLIANCE_FACTS: number = 120;
// The longest text a fact keeps.
export const MAX_COMPLIANCE_FACT_TEXT_LENGTH: number = 600;
// The most items a fact's list keeps.
const MAX_FACT_LIST: number = 40;

const FACT_ID_PATTERN: RegExp = /^[A-Z][0-9]{1,3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value.slice(0, MAX_COMPLIANCE_FACT_TEXT_LENGTH)
    : "";
}

function optionalText(value: unknown): string | undefined {
  const read: string = text(value);

  return read ? read : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function texts(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value
        .filter((item: unknown): item is string => {
          return typeof item === "string" && item.length > 0;
        })
        .slice(0, MAX_FACT_LIST)
        .map((item: string): string => {
          return item.slice(0, MAX_COMPLIANCE_FACT_TEXT_LENGTH);
        })
    : [];
}

function pairs(value: unknown): Array<[string, string]> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item: unknown): item is [string, string] => {
      return (
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === "string" &&
        typeof item[1] === "string"
      );
    })
    .slice(0, MAX_FACT_LIST)
    .map((item: [string, string]): [string, string] => {
      return [
        item[0].slice(0, MAX_COMPLIANCE_FACT_TEXT_LENGTH),
        item[1].slice(0, MAX_COMPLIANCE_FACT_TEXT_LENGTH),
      ];
    });
}

function isEnumValue<T extends string>(
  values: ReadonlyArray<T>,
  value: unknown,
): value is T {
  return (
    typeof value === "string" &&
    (values as ReadonlyArray<string>).includes(value)
  );
}

/*
 * A fact as it was kept, or null: one this build cannot read is left out
 * rather than guessed at.
 */
export function readComplianceFact(value: unknown): ComplianceFact | null {
  if (!isRecord(value)) {
    return null;
  }

  const id: string = text(value["id"]);
  const key: string = text(value["key"]);
  const kind: unknown = value["kind"];

  if (
    !FACT_ID_PATTERN.test(id) ||
    !key ||
    !isEnumValue(COMPLIANCE_FACT_KINDS, kind)
  ) {
    return null;
  }

  switch (kind) {
    case ComplianceFactKind.StoreHolds:
      return {
        id,
        key,
        kind,
        dataTypes: texts(value["dataTypes"]),
        categories: texts(value["categories"]),
        sensitivity: text(value["sensitivity"]),
        records: optionalNumber(value["records"]),
      };
    case ComplianceFactKind.StoreIdentity:
      return {
        id,
        key,
        kind,
        name: text(value["name"]),
        storeKind: text(value["storeKind"]),
        provider: optionalText(value["provider"]),
        environment: optionalText(value["environment"]),
        description: optionalText(value["description"]),
      };
    case ComplianceFactKind.StoreTags:
      return { id, key, kind, tags: pairs(value["tags"]) };
    case ComplianceFactKind.Location:
      return {
        id,
        key,
        kind,
        region: optionalText(value["region"]),
        country: optionalText(value["country"]),
        isInEea: optionalFlag(value["isInEea"]),
        replicationRegions: texts(value["replicationRegions"]),
        subjectCountries: texts(value["subjectCountries"]),
      };
    case ComplianceFactKind.ServiceUse:
      return {
        id,
        key,
        kind,
        service: text(value["service"]),
        description: optionalText(value["description"]),
      };
    case ComplianceFactKind.ExternalHost:
      return {
        id,
        key,
        kind,
        host: text(value["host"]),
        via: text(value["via"]),
      };
    case ComplianceFactKind.AiProvider:
      return {
        id,
        key,
        kind,
        provider: text(value["provider"]),
        via: optionalText(value["via"]),
      };
    case ComplianceFactKind.Copy:
      return {
        id,
        key,
        kind,
        otherStore: text(value["otherStore"]),
        otherRegion: optionalText(value["otherRegion"]),
        otherCountry: optionalText(value["otherCountry"]),
        otherEnvironment: optionalText(value["otherEnvironment"]),
        isCopyOfThisStore: value["isCopyOfThisStore"] === true,
      };
    case ComplianceFactKind.Backups:
      return {
        id,
        key,
        kind,
        backupsEnabled: optionalFlag(value["backupsEnabled"]),
        backupRetentionDays: optionalNumber(value["backupRetentionDays"]),
        pointInTimeRecovery: optionalFlag(value["pointInTimeRecovery"]),
        versioning: optionalFlag(value["versioning"]),
        softDelete: optionalFlag(value["softDelete"]),
        deletionProtection: optionalFlag(value["deletionProtection"]),
      };
    case ComplianceFactKind.TelemetryRetention: {
      const signal: unknown = value["signal"];

      if (!isEnumValue(Object.values(TelemetryRetentionSignal), signal)) {
        return null;
      }

      return {
        id,
        key,
        kind,
        signal,
        days: count(value["days"]),
        maxDays: optionalNumber(value["maxDays"]),
      };
    }
    case ComplianceFactKind.DeclaredCode:
      return {
        id,
        key,
        kind,
        repository: text(value["repository"]),
        paths: texts(value["paths"]),
        codeKind: text(value["codeKind"]),
      };
    case ComplianceFactKind.Exposure:
      return {
        id,
        key,
        kind,
        exposure: text(value["exposure"]),
        isPublicByDesign: value["isPublicByDesign"] === true,
        publicReason: optionalText(value["publicReason"]),
      };
    case ComplianceFactKind.Encryption:
      return {
        id,
        key,
        kind,
        encryptedAtRest: optionalFlag(value["encryptedAtRest"]),
        customerManagedKey: optionalFlag(value["customerManagedKey"]),
        encryptionInTransitEnforced: optionalFlag(
          value["encryptionInTransitEnforced"],
        ),
        minimumTlsVersion: optionalText(value["minimumTlsVersion"]),
      };
    case ComplianceFactKind.Reach:
      return {
        id,
        key,
        kind,
        identities: count(value["identities"]),
        publicGrants: count(value["publicGrants"]),
        externalGrants: count(value["externalGrants"]),
        writeGrants: count(value["writeGrants"]),
        servicesSeen: count(value["servicesSeen"]),
      };
    case ComplianceFactKind.OpenIssue:
      return {
        id,
        key,
        kind,
        title: text(value["title"]),
        checkId: text(value["checkId"]),
        severity: text(value["severity"]),
      };
    case ComplianceFactKind.FixedIssue: {
      const fixed: unknown = value["fixed"];

      return {
        id,
        key,
        kind,
        title: text(value["title"]),
        checkId: text(value["checkId"]),
        fixed: isEnumValue(Object.values(ComplianceRecency), fixed)
          ? fixed
          : ComplianceRecency.Quarter,
      };
    }
    case ComplianceFactKind.RecordEntry:
      return {
        id,
        key,
        kind,
        field: text(value["field"]),
        value: text(value["value"]),
        status: text(value["status"]),
      };
    case ComplianceFactKind.RequirementScope:
      return {
        id,
        key,
        kind,
        stores: count(value["stores"]),
        storeNames: texts(value["storeNames"]),
        framework: text(value["framework"]),
        requirement: text(value["requirement"]),
      };
    case ComplianceFactKind.CheckState:
      return {
        id,
        key,
        kind,
        checks: count(value["checks"]),
        failingChecks: texts(value["failingChecks"]),
        failingStores: count(value["failingStores"]),
        openIssues: count(value["openIssues"]),
      };
    case ComplianceFactKind.IssueHistory:
      return {
        id,
        key,
        kind,
        periodInDays: count(value["periodInDays"]),
        opened: count(value["opened"]),
        fixed: count(value["fixed"]),
        stillOpen: count(value["stillOpen"]),
        medianHoursToFix: optionalNumber(value["medianHoursToFix"]),
        medianDaysToFix: optionalNumber(value["medianDaysToFix"]),
      };
    case ComplianceFactKind.AcceptedRisk:
      return {
        id,
        key,
        kind,
        issueTitle: text(value["issueTitle"]),
        store: text(value["store"]),
        reason: text(value["reason"]),
        until: optionalText(value["until"]),
      };
    case ComplianceFactKind.TurnedOff:
      return {
        id,
        key,
        kind,
        resource: text(value["resource"]),
        resourceKind: text(value["resourceKind"]),
        reason: text(value["reason"]),
        isWholeFramework: value["isWholeFramework"] === true,
      };
    default:
      return null;
  }
}

// Every fact that could be read, at most MAX_COMPLIANCE_FACTS, each id once.
export function readComplianceFacts(value: unknown): Array<ComplianceFact> {
  if (!Array.isArray(value)) {
    return [];
  }

  const facts: Array<ComplianceFact> = [];
  const ids: Set<string> = new Set();

  for (const item of value.slice(0, MAX_COMPLIANCE_FACTS)) {
    const fact: ComplianceFact | null = readComplianceFact(item);

    if (fact && !ids.has(fact.id)) {
      ids.add(fact.id);
      facts.push(fact);
    }
  }

  return facts;
}

/*
 * ---------------------------------------------------------------------------
 * What a fact says, and whether a draft held to it
 * ---------------------------------------------------------------------------
 */

// A fact as data, without its id: what it says, whatever it was called in a read.
export function getFactContent(fact: ComplianceFact): JSONObject {
  const content: JSONObject = {};

  for (const [name, value] of Object.entries(fact)) {
    if (name !== "id" && value !== undefined) {
      content[name] = value as JSONValue;
    }
  }

  return content;
}

/*
 * What a set of facts says, in sixty-four hex digits, by their keys: the
 * same facts read twice - under other ids, in another order - hash the
 * same, and a key the facts no longer hold hashes as missing. A confirmed
 * draft keeps this of the facts it rests on, and is redrafted when it
 * changes.
 */
export function getFactsHash(data: {
  facts: ReadonlyArray<ComplianceFact>;
  keys: ReadonlyArray<string>;
}): string {
  const byKey: Map<string, ComplianceFact> = new Map(
    data.facts.map((fact: ComplianceFact): [string, ComplianceFact] => {
      return [fact.key, fact];
    }),
  );
  const keys: Array<string> = [...new Set(data.keys)].sort();

  return sha256Hex(
    toStableJsonText(
      keys.map((key: string): JSONValue => {
        const fact: ComplianceFact | undefined = byKey.get(key);

        return fact ? getFactContent(fact) : { key, missing: true };
      }),
    ),
  );
}

// The keys of the facts an answer cited by id, each known id once.
export function getFactKeys(data: {
  facts: ReadonlyArray<ComplianceFact>;
  ids: ReadonlyArray<string>;
}): Array<string> {
  const byId: Map<string, ComplianceFact> = new Map(
    data.facts.map((fact: ComplianceFact): [string, ComplianceFact] => {
      return [fact.id, fact];
    }),
  );
  const keys: Array<string> = [];

  for (const id of data.ids) {
    const fact: ComplianceFact | undefined = byId.get(
      typeof id === "string" ? id.trim().toUpperCase() : "",
    );

    if (fact && !keys.includes(fact.key)) {
      keys.push(fact.key);
    }
  }

  return keys;
}

// A number as written in a text: "1,200" and "1200" are the same number, "7.5" is 7.5.
const NUMBER_IN_TEXT: RegExp = /\d[\d,]*(?:\.\d+)?/g;

/*
 * A GDPR or framework reference inside a sentence ("Article 6(1)(f)",
 * "Art. 32", "A.8.13", "164.312(b)"): its numbers are the law's, not a
 * claim about the store.
 */
const LEGAL_REFERENCE: RegExp =
  /\b(?:Art(?:icle)?s?\.?|Recital|Sec(?:tion)?\.?|§)\s*\d+(?:\s*-\s*\d+)?(?:\(\d+\))*(?:\([a-z]\))*|\b[A-Z]{1,3}\.?\d+(?:\.\d+)*(?:\([a-z0-9]+\))*|\b\d{3}\.\d{3}(?:\([a-z0-9]+\))+/g;

function numbersOf(text: string): Array<string> {
  return (text.match(NUMBER_IN_TEXT) || []).map((written: string): string => {
    const value: number = Number(written.replace(/,/g, ""));

    return Number.isFinite(value) ? String(value) : written;
  });
}

// Every number a fact holds, in any of its values: a count, a day, a number in a name.
export function getFactNumbers(fact: ComplianceFact): Set<string> {
  return new Set(numbersOf(JSON.stringify(getFactContent(fact))));
}

/*
 * The numbers a text says that none of the facts holds - a count, a number
 * of days it made up - once the law's own references are set aside. A
 * draft that says one is dropped: a record that says "kept for 2 years"
 * must rest on a fact that says so.
 */
export function getUnfoundedNumbers(data: {
  text: string;
  facts: ReadonlyArray<ComplianceFact>;
}): Array<string> {
  const known: Set<string> = new Set();

  for (const fact of data.facts) {
    for (const number of getFactNumbers(fact)) {
      known.add(number);
    }
  }

  return numbersOf(data.text.replace(LEGAL_REFERENCE, " ")).filter(
    (number: string): boolean => {
      return !known.has(number);
    },
  );
}

// What a draft may not say: the ids of facts, which the page folds out instead.
const FACT_IDS_IN_TEXT: RegExp =
  /\s*[([](\s*[A-Z]\d{1,3}\s*(?:[,;]\s*[A-Z]\d{1,3}\s*)*)[)\]]/g;

export function withoutFactIds(text: string): string {
  return text.replace(FACT_IDS_IN_TEXT, "").replace(/\s+([.,;:])/g, "$1");
}

export interface HeldText {
  text: string;
  // The keys of the facts it rests on.
  factKeys: Array<string>;
}

/*
 * A text OneUptime AI wrote, held to the facts it was given: cut to its
 * length, with the ids it cited taken out of the words; dropped when it
 * cites no fact it was given, says too little, or says a number none of the
 * facts it cites holds.
 */
export function holdTextToFacts(data: {
  text: unknown;
  cited: unknown;
  facts: ReadonlyArray<ComplianceFact>;
  maxLength: number;
  minLength?: number | undefined;
  isOneLine?: boolean | undefined;
}): HeldText | null {
  if (typeof data.text !== "string") {
    return null;
  }

  const ids: Array<string> = Array.isArray(data.cited)
    ? data.cited.filter((id: unknown): id is string => {
        return typeof id === "string";
      })
    : [];
  const factKeys: Array<string> = getFactKeys({ facts: data.facts, ids });

  if (factKeys.length === 0) {
    return null;
  }

  const cleaned: string = withoutFactIds(
    data.isOneLine === false
      ? data.text
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
      : data.text.replace(/\s+/g, " ").trim(),
  ).trim();
  const characters: Array<string> = Array.from(cleaned);
  const text: string =
    characters.length > data.maxLength
      ? `${characters
          .slice(0, data.maxLength - 1)
          .join("")
          .trim()}…`
      : cleaned;

  if (Array.from(text).length < (data.minLength ?? 8)) {
    return null;
  }

  const citedFacts: Array<ComplianceFact> = data.facts.filter(
    (fact: ComplianceFact): boolean => {
      return factKeys.includes(fact.key);
    },
  );

  if (getUnfoundedNumbers({ text, facts: citedFacts }).length > 0) {
    return null;
  }

  return { text, factKeys };
}

/*
 * ---------------------------------------------------------------------------
 * A fact in English, for the exports
 * ---------------------------------------------------------------------------
 */

function yesNo(value: boolean | undefined, yes: string, no: string): string {
  return value === true ? yes : value === false ? no : "";
}

function list(items: ReadonlyArray<string>): string {
  return items.filter(Boolean).join(", ");
}

function days(value: number): string {
  return `${value} ${value === 1 ? "day" : "days"}`;
}

/*
 * A fact as one English line, as an export and an auditor read it. The
 * Dashboard words the same in the reader's language (ComplianceFactLine).
 */
export function describeComplianceFact(fact: ComplianceFact): string {
  switch (fact.kind) {
    case ComplianceFactKind.StoreHolds:
      return [
        fact.dataTypes.length > 0 ? `Holds ${list(fact.dataTypes)}` : "",
        fact.categories.length > 0 ? `(${list(fact.categories)})` : "",
        fact.sensitivity ? `, ${fact.sensitivity}` : "",
        fact.records !== undefined ? `, about ${fact.records} records` : "",
      ]
        .join(" ")
        .replace(/\s+,/g, ",")
        .trim();
    case ComplianceFactKind.StoreIdentity:
      return [
        `${fact.name} is a ${fact.storeKind}`,
        fact.environment ? ` in ${fact.environment}` : "",
        fact.description ? `: "${fact.description}"` : "",
      ].join("");
    case ComplianceFactKind.StoreTags:
      return `Tagged ${list(
        fact.tags.map((tag: [string, string]): string => {
          return `${tag[0]}=${tag[1]}`;
        }),
      )}`;
    case ComplianceFactKind.Location:
      return [
        fact.region
          ? `Kept in ${fact.region}${fact.country ? ` (${fact.country})` : ""}`
          : "Its region is not known",
        fact.replicationRegions.length > 0
          ? `, copied to ${list(fact.replicationRegions)}`
          : "",
        fact.subjectCountries.length > 0
          ? `; its data is about people in ${list(fact.subjectCountries)}`
          : "",
      ].join("");
    case ComplianceFactKind.ServiceUse:
      return `Used by ${fact.service}${
        fact.description ? `: "${fact.description}"` : ""
      }`;
    case ComplianceFactKind.ExternalHost:
      return `${fact.via} calls ${fact.host}`;
    case ComplianceFactKind.AiProvider:
      return fact.via
        ? `${fact.via} sends calls to ${fact.provider}`
        : `Sent to ${fact.provider}`;
    case ComplianceFactKind.Copy:
      return fact.isCopyOfThisStore
        ? `${fact.otherStore} holds a copy of its data${
            fact.otherRegion ? `, in ${fact.otherRegion}` : ""
          }`
        : `It holds a copy of ${fact.otherStore}'s data`;
    case ComplianceFactKind.Backups:
      return list([
        yesNo(fact.backupsEnabled, "Backed up", "Not backed up"),
        fact.backupRetentionDays !== undefined
          ? `backups kept ${days(fact.backupRetentionDays)}`
          : "",
        yesNo(
          fact.pointInTimeRecovery,
          "point-in-time recovery on",
          "no point-in-time recovery",
        ),
        yesNo(fact.versioning, "versioning on", "versioning off"),
        yesNo(fact.softDelete, "soft delete on", "soft delete off"),
        yesNo(
          fact.deletionProtection,
          "deletion protection on",
          "deletion protection off",
        ),
      ]);
    case ComplianceFactKind.TelemetryRetention:
      return fact.maxDays && fact.maxDays !== fact.days
        ? `OneUptime keeps its ${fact.signal} ${days(fact.days)}, some up to ${days(fact.maxDays)}`
        : `OneUptime keeps its ${fact.signal} ${days(fact.days)}`;
    case ComplianceFactKind.DeclaredCode:
      return `Declared in ${fact.repository}${
        fact.paths.length > 0 ? `: ${list(fact.paths)}` : ""
      } (${fact.codeKind})`;
    case ComplianceFactKind.Exposure:
      return `Exposure: ${fact.exposure}${
        fact.isPublicByDesign ? ", public by design" : ""
      }${fact.publicReason ? ` (${fact.publicReason})` : ""}`;
    case ComplianceFactKind.Encryption:
      return list([
        yesNo(
          fact.encryptedAtRest,
          "Encrypted at rest",
          "Not encrypted at rest",
        ),
        yesNo(
          fact.customerManagedKey,
          "with a customer-managed key",
          "with the provider's key",
        ),
        yesNo(
          fact.encryptionInTransitEnforced,
          "encryption in transit enforced",
          "encryption in transit not enforced",
        ),
        fact.minimumTlsVersion ? `TLS ${fact.minimumTlsVersion} or later` : "",
      ]);
    case ComplianceFactKind.Reach:
      return `${fact.identities} identities can reach it: ${fact.publicGrants} public, ${fact.externalGrants} outside the connected accounts, ${fact.writeGrants} that can write; ${fact.servicesSeen} services seen using it`;
    case ComplianceFactKind.OpenIssue:
      return `Open ${fact.severity} issue: ${fact.title}`;
    case ComplianceFactKind.FixedIssue:
      return `Fixed in the last ${
        fact.fixed === ComplianceRecency.Week
          ? "week"
          : fact.fixed === ComplianceRecency.Month
            ? "30 days"
            : "90 days"
      }: ${fact.title}`;
    case ComplianceFactKind.RecordEntry:
      return `Its record says, for ${fact.field}: ${fact.value}`;
    case ComplianceFactKind.RequirementScope:
      return `${fact.stores} ${fact.stores === 1 ? "store" : "stores"} in scope${
        fact.storeNames.length > 0 ? `: ${list(fact.storeNames)}` : ""
      }`;
    case ComplianceFactKind.CheckState:
      return fact.failingChecks.length > 0
        ? `${fact.failingChecks.length} of its ${fact.checks} checks fail on ${
            fact.failingStores
          } ${fact.failingStores === 1 ? "store" : "stores"} (${fact.openIssues} open ${
            fact.openIssues === 1 ? "issue" : "issues"
          }): ${list(fact.failingChecks)}`
        : `All ${fact.checks} of its checks pass on every store in scope`;
    case ComplianceFactKind.IssueHistory:
      return `In the last ${days(fact.periodInDays)}: ${fact.opened} opened, ${fact.fixed} fixed${
        fact.medianHoursToFix !== undefined
          ? ` in ${fact.medianHoursToFix} hours at the median`
          : ""
      }, ${fact.stillOpen} still open`;
    case ComplianceFactKind.AcceptedRisk:
      return `Risk accepted on ${fact.store}: ${fact.issueTitle}. Why: "${fact.reason}"${
        fact.until ? `, until ${fact.until}` : ", with no expiry"
      }`;
    case ComplianceFactKind.TurnedOff:
      return `Turned off ${
        fact.isWholeFramework
          ? "for the whole framework"
          : "for this requirement"
      } on ${fact.resource} (${fact.resourceKind})${
        fact.reason ? `: "${fact.reason}"` : ""
      }`;
    default:
      return "";
  }
}
