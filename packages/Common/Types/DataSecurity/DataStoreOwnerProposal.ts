import escapeRegExp from "../../Utils/RegExpEscape";
import { readCloudTags } from "../Cloud/CloudInventory";
import { JSONObject } from "../JSON";

/*
 * AN OWNER FOR EVERY SENSITIVE DATA STORE (#10374): WHAT THE EVIDENCE OF
 * WHO OWNS A STORE IS, AND WHAT ONEUPTIME AI PROPOSES FROM IT.
 *
 * Everything in Data Security is routed to a store's owners, and a store
 * with none has nobody to tell. OneUptime already holds most of the answer,
 * spread across products, and plain code reads it
 * (Server/Utils/AI/DataSecurity/Owners/DataStoreOwnerEvidenceReader):
 *
 *   - CloudTag: a tag on the store that names an owner ("team=payments",
 *     "owner=alice@acme.com") - a team by its name, a person by email;
 *   - ServiceOwners: a service seen using the store in traces, or whose
 *     telemetry it is, and that service's owners;
 *   - CodeOwners: the code owners of the file that declares the store, in
 *     its repository (GitHub's CODEOWNERS, GitLab's code owners) - a team
 *     handle by the team's name, a person by email;
 *   - ChangedBy: who changed the store, as the cloud's change log names
 *     them - a person by email;
 *   - AddedBy: who added the store to OneUptime (#10290).
 *
 * Each piece of evidence says where it came from and whom it names, or why
 * it names nobody in OneUptime (a team no team of the project is called, an
 * email no member has). OneUptime AI then picks the owners from the
 * candidates the evidence names, and from nothing else: who, why in one
 * sentence, and how sure - and says so where the evidence disagrees
 * (Utils/DataSecurity/DataStoreOwnerAnswer). The owners it picks are a
 * proposal (DataSecurityAiProposalKind.SetStoreOwners) a person approves.
 *
 * Where three or more stores' owners rest on the same fact - the same tag,
 * the same name prefix - the owner rule that says so is proposed too
 * (CreateOwnerRule), with what the rule engine says it would do, so the
 * next store like them is owned the day it is found.
 *
 * Pure: the server, the Dashboard and the eval harness read it alike. It
 * holds ids, names and counts - never a value of a store's data.
 */

// Where a piece of evidence of who owns a store came from. Stored: never rename one.
export enum DataStoreOwnerEvidenceSource {
  CloudTag = "CloudTag",
  ServiceOwners = "ServiceOwners",
  CodeOwners = "CodeOwners",
  ChangedBy = "ChangedBy",
  AddedBy = "AddedBy",
}

export const DATA_STORE_OWNER_EVIDENCE_SOURCES: ReadonlyArray<DataStoreOwnerEvidenceSource> =
  Object.values(DataStoreOwnerEvidenceSource);

// How sure OneUptime AI is of the owners it proposes. Stored: never rename one.
export enum DataStoreOwnerConfidence {
  High = "High",
  Medium = "Medium",
  Low = "Low",
}

export const DATA_STORE_OWNER_CONFIDENCES: ReadonlyArray<DataStoreOwnerConfidence> =
  [
    DataStoreOwnerConfidence.High,
    DataStoreOwnerConfidence.Medium,
    DataStoreOwnerConfidence.Low,
  ];

// An owner is a person or a team, as a store's Owners page holds them.
export enum DataStoreOwnerKind {
  User = "User",
  Team = "Team",
}

// Why a piece of evidence names nobody in OneUptime. Stored: never rename one.
export enum DataStoreOwnerUnmatched {
  // A team's name or handle no team of the project has.
  NoTeamNamed = "NoTeamNamed",
  // An email address no member of the project has.
  NoMemberWithEmail = "NoMemberWithEmail",
  // Not a person: a role, a service account, an automation.
  NotAPerson = "NotAPerson",
  // A service that uses the store, and has no owners itself.
  ServiceHasNoOwners = "ServiceHasNoOwners",
  // A person's handle on the code host ("@alice"), no member is known by.
  UnknownHandle = "UnknownHandle",
}

// The most evidence one store's proposal keeps, and sends.
export const MAX_DATA_STORE_OWNER_EVIDENCE: number = 20;
// The most candidates one store's proposal keeps, and sends.
export const MAX_DATA_STORE_OWNER_CANDIDATES: number = 12;
// The most owners one proposal names.
export const MAX_PROPOSED_DATA_STORE_OWNERS: number = 5;
// The longest reason, and the longest disagreement, a proposal keeps.
export const MAX_DATA_STORE_OWNER_REASON_LENGTH: number = 300;
// How many stores resting on one fact make an owner rule (#10374's decision).
export const MIN_STORES_FOR_DATA_STORE_OWNER_RULE: number = 3;

export interface DataStoreOwnerRef {
  kind: DataStoreOwnerKind;
  id: string;
}

export interface DataStoreOwnerEvidence {
  // "E1": what a proposal, and OneUptime AI, call it.
  id: string;
  source: DataStoreOwnerEvidenceSource;
  // CloudTag: the tag, as the cloud holds it.
  tagKey?: string | undefined;
  tagValue?: string | undefined;
  // ServiceOwners: the service, and whether the store is its own telemetry.
  serviceId?: string | undefined;
  serviceName?: string | undefined;
  isServiceTelemetry?: boolean | undefined;
  // CodeOwners: the repository, the file that declares the store, the handle.
  repositoryName?: string | undefined;
  filePath?: string | undefined;
  codeOwnersPath?: string | undefined;
  codeOwner?: string | undefined;
  // ChangedBy: what was done, how often, and the last time.
  operation?: string | undefined;
  changeCount?: number | undefined;
  lastChangedAt?: string | undefined;
  // Whom it names in OneUptime: none, when unmatched says why.
  owners: Array<DataStoreOwnerRef>;
  unmatched?: DataStoreOwnerUnmatched | undefined;
}

export interface DataStoreOwnerCandidate extends DataStoreOwnerRef {
  // "T1" for a team, "P1" for a person: all OneUptime AI calls them.
  ref: string;
  /*
   * A team's name, or a person's as every line names a member - their name,
   * else the part of their address before the "@" (#10681): shown to people
   * only, in the proposal's title and its lines on the store's and its
   * issues' timelines. Never an address.
   */
  name: string;
  // The evidence that names it.
  evidenceIds: Array<string>;
  /*
   * Whether the candidate can open the store in Data Security - through a
   * project role, the Security roles, or the store's own permissions,
   * product levels included. An owner who cannot is told about a store
   * they cannot read.
   */
  canOpenStore: boolean;
}

/*
 * A fact of a store an owner rule can say: one of its cloud tags whose key
 * names an owner, or the start of its name.
 */
export type DataStoreOwnerRuleFact =
  | { kind: "CloudTag"; key: string; value: string }
  | { kind: "NamePrefix"; prefix: string };

/*
 * What a store's owners are proposed as: a SetStoreOwners proposal's plan.
 * Every candidate the evidence names is kept, so a person can pick another
 * before approving.
 */
export interface DataStoreOwnersPlan {
  dataStoreId: string;
  dataStoreName: string;
  // The owners OneUptime AI picked, each one of the candidates.
  owners: Array<DataStoreOwnerCandidate>;
  confidence: DataStoreOwnerConfidence;
  // Why, in one sentence, each owner by its name.
  reason: string;
  // Where the evidence disagrees, in one sentence; "" where it does not.
  disagreement: string;
  // The evidence the owners rest on, by id.
  restsOn: Array<string>;
  evidence: Array<DataStoreOwnerEvidence>;
  candidates: Array<DataStoreOwnerCandidate>;
  // What a rule could say of the store, for the rules that keep it owned.
  ruleFacts: Array<DataStoreOwnerRuleFact>;
  // The store is sensitive: its owners go first.
  isSensitive: boolean;
}

// What the rule engine said a proposed rule would do, when it was proposed.
export interface DataStoreOwnerRulePreview {
  // The stores the rule matches.
  matchingStores: number;
  // Of those, the ones that already have owners.
  alreadyOwned: number;
  // A few of the stores it matches, by name.
  storeNames: Array<string>;
  previewedAt: string;
}

/*
 * An owner rule OneUptime AI proposes: a CreateOwnerRule proposal's plan.
 * The rule is a DataStoreOwnerRule that matches the fact, and adds the
 * owners, telling them.
 */
export interface DataStoreOwnerRulePlan {
  fact: DataStoreOwnerRuleFact;
  ruleName: string;
  cloudTagPattern?: string | undefined;
  nameRegexPattern?: string | undefined;
  owners: Array<DataStoreOwnerRef & { name: string }>;
  // The stores whose owner proposals rest on the fact.
  dataStoreIds: Array<string>;
  preview: DataStoreOwnerRulePreview;
}

/*
 * Tag keys that name who owns a resource, compared folded (lower case,
 * "_", "." and ":" read as "-"). A team's name or a person's email is what
 * such a tag holds.
 */
export const DATA_STORE_OWNER_TAG_KEYS: ReadonlyArray<string> = [
  "owner",
  "owners",
  "owned-by",
  "ownedby",
  "owner-team",
  "owning-team",
  "team",
  "team-name",
  "squad",
  "contact",
  "owner-email",
  "contact-email",
  "email",
  "maintainer",
  "maintainers",
  "data-owner",
  "data-steward",
  "steward",
  "technical-owner",
  "business-owner",
  "responsible",
  "point-of-contact",
  "poc",
  "created-by",
  "createdby",
  "creator",
];

// A tag key as it is compared: lower case, its separators one "-".
export function foldOwnerTagKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s_.:/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/*
 * Whether a tag's key names who owns the resource: one of the keys above,
 * also under a prefix of the team's own ("acme:owner", "app/team").
 */
export function isOwnerTagKey(key: string): boolean {
  const folded: string = foldOwnerTagKey(key);

  if (!folded) {
    return false;
  }

  return DATA_STORE_OWNER_TAG_KEYS.some((ownerKey: string): boolean => {
    return folded === ownerKey || folded.endsWith(`-${ownerKey}`);
  });
}

/*
 * A team's name, a code owners handle or a tag's value, as names are
 * compared: lower case, an "@org/" or "org/" handle's team part only, and
 * every run of separators one space. "Payments Team" and "@acme/payments"
 * fold to "payments team" and "payments".
 */
export function foldOwnerName(name: string): string {
  let text: string = name.trim().toLowerCase();

  if (text.startsWith("@")) {
    text = text.slice(1);
  }

  const slash: number = text.lastIndexOf("/");

  if (slash >= 0) {
    text = text.slice(slash + 1);
  }

  return text
    .replace(/[\s_.\-:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * The forms of a name a team may go by: as written, and without a last
 * word that only says it is a team ("payments team" is "payments" too).
 */
export function getOwnerNameForms(name: string): Array<string> {
  const folded: string = foldOwnerName(name);

  if (!folded) {
    return [];
  }

  const forms: Array<string> = [folded];
  const words: Array<string> = folded.split(" ");
  const last: string = words[words.length - 1] || "";

  if (words.length > 1 && ["team", "squad", "group", "crew"].includes(last)) {
    forms.push(words.slice(0, -1).join(" "));
  }

  return forms;
}

// Whether two names name the same team, as getOwnerNameForms reads them.
export function isSameOwnerName(left: string, right: string): boolean {
  const rightForms: Array<string> = getOwnerNameForms(right);

  return getOwnerNameForms(left).some((form: string): boolean => {
    return rightForms.includes(form);
  });
}

// The email addresses in a text, lower case, each once.
export function findEmailAddresses(text: string): Array<string> {
  const found: Array<string> = [];
  // Bounded: a tag's value or an actor is short, and is read no further.
  const pattern: RegExp =
    /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+/gi;

  for (const match of text.slice(0, 1000).matchAll(pattern)) {
    const email: string = match[0].toLowerCase().replace(/[.-]+$/, "");

    if (!found.includes(email)) {
      found.push(email);
    }
  }

  return found;
}

/*
 * The words a store's name may start with that say nothing of who owns
 * it - a kind, a stage, a cloud - so no rule is made of them.
 */
const GENERIC_NAME_PREFIXES: ReadonlyArray<string> = [
  "prod",
  "production",
  "prd",
  "staging",
  "stage",
  "stg",
  "dev",
  "development",
  "test",
  "testing",
  "qa",
  "uat",
  "sandbox",
  "demo",
  "tmp",
  "temp",
  "backup",
  "backups",
  "bak",
  "logs",
  "log",
  "data",
  "db",
  "database",
  "bucket",
  "storage",
  "store",
  "default",
  "shared",
  "common",
  "public",
  "private",
  "internal",
  "my",
  "new",
  "old",
  "archive",
  "aws",
  "gcp",
  "azure",
  "s3",
  "gcs",
  "cdn",
  "terraform",
  "tf",
  "cloudtrail",
  "config",
  "us",
  "eu",
  "ap",
  "global",
];

// The shortest name prefix a rule is made of.
const MIN_NAME_PREFIX_LENGTH: number = 3;

/*
 * The start of a store's name an owner rule could match: its first word,
 * where the name has more than one ("payments-ledger" starts "payments-").
 * None for a one-word name, a short word or a word that says nothing of
 * who owns it ("prod-", "logs-").
 */
export function getStoreNamePrefix(name: string): string | null {
  const text: string = name.trim().toLowerCase();
  const match: RegExpMatchArray | null = text.match(
    /^([a-z][a-z0-9]{1,62})([-_.])[a-z0-9]/,
  );

  if (!match) {
    return null;
  }

  const word: string = match[1]!;

  if (
    word.length < MIN_NAME_PREFIX_LENGTH ||
    GENERIC_NAME_PREFIXES.includes(word)
  ) {
    return null;
  }

  return `${word}${match[2]!}`;
}

/*
 * What an owner rule could say of a store: each cloud tag whose key names
 * an owner, and the start of its name.
 */
export function getStoreOwnerRuleFacts(store: {
  name?: string | undefined;
  cloudTags?: unknown;
}): Array<DataStoreOwnerRuleFact> {
  const facts: Array<DataStoreOwnerRuleFact> = [];
  const tags: Record<string, string> = readCloudTags(store.cloudTags);

  for (const key of Object.keys(tags).sort()) {
    const value: string = (tags[key] || "").trim();

    if (value && isOwnerTagKey(key)) {
      facts.push({ kind: "CloudTag", key, value });
    }
  }

  const prefix: string | null = getStoreNamePrefix(store.name || "");

  if (prefix) {
    facts.push({ kind: "NamePrefix", prefix });
  }

  return facts;
}

// What makes two facts the same.
export function getOwnerRuleFactKey(fact: DataStoreOwnerRuleFact): string {
  return fact.kind === "CloudTag"
    ? `tag:${fact.key.toLowerCase()}=${fact.value.toLowerCase()}`
    : `prefix:${fact.prefix.toLowerCase()}`;
}

/*
 * The owner rule's pattern for a fact, as Data Security > Settings > Owner
 * Rules holds one: a cloud tag matched whole, written key=value
 * ("^team=payments$"), or a name's start ("^payments-").
 */
export function getOwnerRulePattern(fact: DataStoreOwnerRuleFact): {
  cloudTagPattern?: string;
  nameRegexPattern?: string;
} {
  if (fact.kind === "CloudTag") {
    return {
      cloudTagPattern: `^${escapeRegExp(`${fact.key}=${fact.value}`)}$`,
    };
  }

  return { nameRegexPattern: `^${escapeRegExp(fact.prefix)}` };
}

// The fact in words, for a rule's name and a proposal's title.
export function describeOwnerRuleFact(fact: DataStoreOwnerRuleFact): string {
  return fact.kind === "CloudTag"
    ? `tagged ${fact.key}=${fact.value}`
    : `whose names start with ${fact.prefix}`;
}

// What makes two sets of owners the same: their kinds and ids, in order.
export function getOwnersKey(owners: ReadonlyArray<DataStoreOwnerRef>): string {
  return Array.from(
    new Set(
      owners.map((owner: DataStoreOwnerRef): string => {
        return `${owner.kind}:${owner.id.toLowerCase()}`;
      }),
    ),
  )
    .sort()
    .join("|");
}

// The owners, by name, as a sentence lists them: "Payments and Alice".
export function listOwnerNames(names: ReadonlyArray<string>): string {
  const kept: Array<string> = names.filter((name: string): boolean => {
    return name.trim().length > 0;
  });

  if (kept.length <= 1) {
    return kept[0] || "";
  }

  return `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
}

// ---- Reading a stored plan -------------------------------------------------

function readText(value: unknown, maxLength: number = 500): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function readOptionalText(
  value: unknown,
  maxLength: number = 500,
): string | undefined {
  const text: string = readText(value, maxLength);

  return text ? text : undefined;
}

function readEnum<T extends string>(
  value: unknown,
  values: ReadonlyArray<T>,
): T | undefined {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : undefined;
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

const OWNER_KINDS: ReadonlyArray<DataStoreOwnerKind> =
  Object.values(DataStoreOwnerKind);

export function readDataStoreOwnerRef(
  value: unknown,
): DataStoreOwnerRef | null {
  const raw: JSONObject | null = asObject(value);
  const kind: DataStoreOwnerKind | undefined = readEnum(
    raw?.["kind"],
    OWNER_KINDS,
  );
  const id: string = readText(raw?.["id"], 100);

  return kind && id ? { kind, id } : null;
}

function readEvidence(value: unknown): DataStoreOwnerEvidence | null {
  const raw: JSONObject | null = asObject(value);
  const source: DataStoreOwnerEvidenceSource | undefined = readEnum(
    raw?.["source"],
    DATA_STORE_OWNER_EVIDENCE_SOURCES,
  );
  const id: string = readText(raw?.["id"], 20);

  if (!raw || !source || !id) {
    return null;
  }

  const changeCount: unknown = raw["changeCount"];

  return {
    id,
    source,
    tagKey: readOptionalText(raw["tagKey"]),
    tagValue: readOptionalText(raw["tagValue"]),
    serviceId: readOptionalText(raw["serviceId"], 100),
    serviceName: readOptionalText(raw["serviceName"]),
    isServiceTelemetry: raw["isServiceTelemetry"] === true ? true : undefined,
    repositoryName: readOptionalText(raw["repositoryName"]),
    filePath: readOptionalText(raw["filePath"]),
    codeOwnersPath: readOptionalText(raw["codeOwnersPath"]),
    codeOwner: readOptionalText(raw["codeOwner"]),
    operation: readOptionalText(raw["operation"]),
    changeCount:
      typeof changeCount === "number" && Number.isFinite(changeCount)
        ? changeCount
        : undefined,
    lastChangedAt: readOptionalText(raw["lastChangedAt"], 40),
    owners: readArray(raw["owners"])
      .map(readDataStoreOwnerRef)
      .filter((owner: DataStoreOwnerRef | null): owner is DataStoreOwnerRef => {
        return owner !== null;
      }),
    unmatched: readEnum(
      raw["unmatched"],
      Object.values(DataStoreOwnerUnmatched),
    ),
  };
}

function readCandidate(value: unknown): DataStoreOwnerCandidate | null {
  const ref: DataStoreOwnerRef | null = readDataStoreOwnerRef(value);
  const raw: JSONObject | null = asObject(value);
  const candidateRef: string = readText(raw?.["ref"], 20);

  if (!ref || !raw || !candidateRef) {
    return null;
  }

  return {
    ...ref,
    ref: candidateRef,
    name: readText(raw["name"]),
    evidenceIds: readArray(raw["evidenceIds"])
      .map((id: unknown): string => {
        return readText(id, 20);
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      }),
    canOpenStore: raw["canOpenStore"] !== false,
  };
}

function readRuleFact(value: unknown): DataStoreOwnerRuleFact | null {
  const raw: JSONObject | null = asObject(value);

  if (raw?.["kind"] === "CloudTag") {
    const key: string = readText(raw["key"]);
    const tagValue: string = readText(raw["value"]);

    return key && tagValue ? { kind: "CloudTag", key, value: tagValue } : null;
  }

  if (raw?.["kind"] === "NamePrefix") {
    const prefix: string = readText(raw["prefix"], 100);

    return prefix ? { kind: "NamePrefix", prefix } : null;
  }

  return null;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

/*
 * A SetStoreOwners proposal's plan as it was stored, read defensively: a
 * plan a newer server wrote may hold what this build does not know, and
 * what is not of its shape is left out rather than drawn as something it
 * is not. Null when it names no store or no owner.
 */
export function readDataStoreOwnersPlan(
  value: unknown,
): DataStoreOwnersPlan | null {
  const raw: JSONObject | null = asObject(value);
  const dataStoreId: string = readText(raw?.["dataStoreId"], 100);

  if (!raw || !dataStoreId) {
    return null;
  }

  const owners: Array<DataStoreOwnerCandidate> = readArray(raw["owners"])
    .map(readCandidate)
    .filter(isPresent);

  if (owners.length === 0) {
    return null;
  }

  return {
    dataStoreId,
    dataStoreName: readText(raw["dataStoreName"]),
    owners,
    confidence:
      readEnum(raw["confidence"], DATA_STORE_OWNER_CONFIDENCES) ||
      DataStoreOwnerConfidence.Low,
    reason: readText(raw["reason"], MAX_DATA_STORE_OWNER_REASON_LENGTH),
    disagreement: readText(
      raw["disagreement"],
      MAX_DATA_STORE_OWNER_REASON_LENGTH,
    ),
    restsOn: readArray(raw["restsOn"])
      .map((id: unknown): string => {
        return readText(id, 20);
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      }),
    evidence: readArray(raw["evidence"]).map(readEvidence).filter(isPresent),
    candidates: readArray(raw["candidates"])
      .map(readCandidate)
      .filter(isPresent),
    ruleFacts: readArray(raw["ruleFacts"]).map(readRuleFact).filter(isPresent),
    isSensitive: raw["isSensitive"] === true,
  };
}

/*
 * A CreateOwnerRule proposal's plan as it was stored, read as defensively.
 * Null when it says no fact, no pattern or no owner.
 */
export function readDataStoreOwnerRulePlan(
  value: unknown,
): DataStoreOwnerRulePlan | null {
  const raw: JSONObject | null = asObject(value);
  const fact: DataStoreOwnerRuleFact | null = readRuleFact(raw?.["fact"]);

  if (!raw || !fact) {
    return null;
  }

  const owners: Array<DataStoreOwnerRef & { name: string }> = readArray(
    raw["owners"],
  )
    .map((item: unknown): (DataStoreOwnerRef & { name: string }) | null => {
      const ref: DataStoreOwnerRef | null = readDataStoreOwnerRef(item);

      return ref ? { ...ref, name: readText(asObject(item)?.["name"]) } : null;
    })
    .filter(isPresent);
  const cloudTagPattern: string | undefined = readOptionalText(
    raw["cloudTagPattern"],
  );
  const nameRegexPattern: string | undefined = readOptionalText(
    raw["nameRegexPattern"],
  );

  if (owners.length === 0 || (!cloudTagPattern && !nameRegexPattern)) {
    return null;
  }

  const preview: JSONObject = asObject(raw["preview"]) || {};
  const count: (value: unknown) => number = (value: unknown): number => {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  };

  return {
    fact,
    ruleName: readText(raw["ruleName"], 100),
    cloudTagPattern,
    nameRegexPattern,
    owners,
    dataStoreIds: readArray(raw["dataStoreIds"])
      .map((id: unknown): string => {
        return readText(id, 100);
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      }),
    preview: {
      matchingStores: count(preview["matchingStores"]),
      alreadyOwned: count(preview["alreadyOwned"]),
      storeNames: readArray(preview["storeNames"])
        .map((name: unknown): string => {
          return readText(name);
        })
        .filter((name: string): boolean => {
          return name.length > 0;
        }),
      previewedAt: readText(preview["previewedAt"], 40),
    },
  };
}
