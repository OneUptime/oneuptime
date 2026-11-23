import { sha256Hex } from "../../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import {
  DataStoreKind,
  isDataStoreKind,
} from "../../../../../Types/DataSecurity/DataStoreKind";
import { ScrubRuleSignal } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  describeScrubRuleProof,
  getScrubOverreachShare,
  readScrubRuleProof,
  ScrubRuleProof,
} from "../../../../../Types/Telemetry/ScrubRuleProof";
import { readScrubRuleKeys } from "../../../../../Types/Telemetry/ScrubRuleKeys";
import {
  TELEMETRY_FIELD_READER_KINDS,
  TelemetryFieldReaderKind,
} from "../../../../../Types/Telemetry/TelemetryFieldReaders";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT ONEUPTIME AI'S CONTAINMENT OF A TELEMETRY ISSUE PLANS, AND WHICH OF
 * IT RUNS ON ITS OWN (#10366).
 *
 * Every place a telemetry issue's check counts gets the proven, narrow
 * rule Scrub It gets (DataSecurity/Telemetry/TelemetryScrubIt) - or one
 * OneUptime AI wrote and the verifier proved (ScrubRuleWriter) - and rules
 * that hide the same way in the same records are one (TelemetryScrubMerge).
 * Each rule then goes in one of three lanes, each its own proposal:
 *
 *  - Alone: the finding is a secret, and the rule is proven on the very
 *    records it was seen in, is its service's, changed none of the other
 *    values at its place, and nothing in the project reads what it hides
 *    (the readers lookup, #10601's). It runs without asking out of the
 *    box - meetsDefaultConditions - and as the project's AI rules say;
 *  - Widen: all of that, for data that is no secret - personal data is
 *    proposed by default (#10366's decision), and runs on its own only
 *    where a Data Security AI rule says Contain runs without asking;
 *  - Ask: everything else - a rule nothing could be proven on, one that
 *    changes other values, one something reads, one for every service, a
 *    metric's pipeline rule, or a place whose earlier rule a person took
 *    back. It waits for a person, whatever any rule says
 *    (canRunWithoutAsking: false).
 *
 * The plan holds names, places, counts and ids - never a value, a sample
 * or a record: a rule's pattern is OneUptime's, its type's, or OneUptime
 * AI's, written from shapes alone.
 */

export const SCRUB_PLAN_VERSION: number = 2;

// The most places one issue's containment scrubs: the most matched first.
export const MAX_SCRUB_PLACES_PER_PROPOSAL: number = 20;

export enum ScrubLane {
  Alone = "scrub-alone",
  Widen = "scrub-widen",
  Ask = "scrub",
}

const SCRUB_LANES: ReadonlyArray<ScrubLane> = [
  ScrubLane.Alone,
  ScrubLane.Widen,
  ScrubLane.Ask,
];

// Why a rule waits for a person: what it could not prove.
export enum ScrubWaitReason {
  // No record it could be run on: gone, or of a kind no rule is proven on.
  NotProven = "NotProven",
  // It changed some of the other values at its place.
  ChangesOtherValues = "ChangesOtherValues",
  // A monitor, dashboard, saved view, recording rule or SLO reads what it hides, or Security Events does.
  IsRead = "IsRead",
  // What reads what it hides could not be read just now.
  ReadersUnknown = "ReadersUnknown",
  // It is for every service, not the finding's.
  EveryService = "EveryService",
  // A metric's pipeline rule: never proven on records.
  MetricRule = "MetricRule",
  // A person took back, or dismissed, a rule for the place before.
  TakenBack = "TakenBack",
}

const WAIT_REASONS: ReadonlyArray<ScrubWaitReason> = Object.values(
  ScrubWaitReason,
) as ReadonlyArray<ScrubWaitReason>;

// One place the plan scrubs.
export interface ScrubPlace {
  findingId: string;
  dataTypeId: string;
  // The name the finding kept for its type: what a rule calls a type that is gone.
  dataTypeName?: string | undefined;
  location: string;
  signal: ScrubRuleSignal;
  // Its data is a secret (the Secrets and credentials category).
  isSecret?: boolean | undefined;
  // When the scans last saw it there (ISO 8601): where a secret to rotate was seen.
  lastSeenAt?: string | undefined;
  // How many values matched in the last scans.
  matchCount?: number | undefined;
}

// What reads what a rule hides, by kind, as OneUptime counted it.
export type ScrubReaderCounts = Partial<
  Record<TelemetryFieldReaderKind, number>
>;

// One rule the plan makes, for one place or several.
export interface ScrubPlanRule {
  signal: ScrubRuleSignal;
  name: string;
  description: string;
  // The places it is for.
  findingIds: Array<string>;
  // A log or trace scrub rule's: what it finds and does, and where.
  patternType?: string | undefined;
  customRegex?: string | undefined;
  attributeKeys?: Array<string> | undefined;
  scrubAction?: string | undefined;
  fieldsToScrub?: string | undefined;
  // How it was chosen: TelemetryScrubPlanner's ScrubRuleSource.
  source?: string | undefined;
  // Proven on the findings' records: counts and ids, never a value.
  proof?: ScrubRuleProof | undefined;
  // What reads what it hides: by kind; none when it could not be read.
  readers?: ScrubReaderCounts | undefined;
  // Security Events reads what it hides, and would lose it.
  securityEventsLoses?: boolean | undefined;
  waitReasons: Array<ScrubWaitReason>;
}

export interface ScrubPlan {
  version?: number | undefined;
  kind: DataStoreKind;
  // The service the store is the telemetry of: each rule is its own.
  serviceId?: string | undefined;
  serviceName?: string | undefined;
  lane?: ScrubLane | undefined;
  places: Array<ScrubPlace>;
  // The rules to make (#10366); a plan made before has none, and makes Scrub It's rule for each place.
  rules?: Array<ScrubPlanRule> | undefined;
}

// One rule the change used, as its result holds it.
export interface ScrubRuleUsed {
  findingId: string;
  signal: ScrubRuleSignal;
  scrubRuleId: string;
  scrubRuleName: string;
  // Made by this change: Undo deletes it. One that was there stays.
  created: boolean;
}

function isSignal(value: unknown): value is ScrubRuleSignal {
  return value === "log" || value === "trace" || value === "metric";
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function isLane(value: unknown): value is ScrubLane {
  return SCRUB_LANES.includes(value as ScrubLane);
}

function readPlace(item: unknown): ScrubPlace | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const place: JSONObject = item as JSONObject;
  const findingId: string = readText(place["findingId"]);
  const dataTypeId: string = readText(place["dataTypeId"]);
  const location: string = readText(place["location"]);

  if (
    !ObjectID.isValidUUID(findingId) ||
    !dataTypeId ||
    !location ||
    !isSignal(place["signal"])
  ) {
    return null;
  }

  const read: ScrubPlace = {
    findingId,
    dataTypeId,
    dataTypeName: readText(place["dataTypeName"]) || undefined,
    location,
    signal: place["signal"],
  };

  if (place["isSecret"] === true) {
    read.isSecret = true;
  }

  if (readText(place["lastSeenAt"])) {
    read.lastSeenAt = readText(place["lastSeenAt"]);
  }

  if (readCount(place["matchCount"]) !== undefined) {
    read.matchCount = readCount(place["matchCount"]);
  }

  return read;
}

function readReaders(value: unknown): ScrubReaderCounts | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const counts: ScrubReaderCounts = {};

  for (const kind of TELEMETRY_FIELD_READER_KINDS) {
    const count: number | undefined = readCount((value as JSONObject)[kind]);

    if (count !== undefined) {
      counts[kind] = count;
    }
  }

  return counts;
}

function readRule(item: unknown): ScrubPlanRule | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const raw: JSONObject = item as JSONObject;

  if (!isSignal(raw["signal"])) {
    return null;
  }

  const findingIds: Array<string> = (
    Array.isArray(raw["findingIds"]) ? raw["findingIds"] : []
  ).filter((id: unknown): id is string => {
    return typeof id === "string" && ObjectID.isValidUUID(id);
  });
  const name: string = readText(raw["name"]);

  if (findingIds.length === 0 || !name) {
    return null;
  }

  const rule: ScrubPlanRule = {
    signal: raw["signal"],
    name,
    description: readText(raw["description"]),
    findingIds,
    waitReasons: (Array.isArray(raw["waitReasons"])
      ? raw["waitReasons"]
      : []
    ).filter((reason: unknown): reason is ScrubWaitReason => {
      return WAIT_REASONS.includes(reason as ScrubWaitReason);
    }),
  };

  if (rule.signal !== "metric") {
    const patternType: string = readText(raw["patternType"]);

    // A log or trace rule that does not say what it finds makes nothing.
    if (!patternType) {
      return null;
    }

    rule.patternType = patternType;
    rule.scrubAction = readText(raw["scrubAction"]) || undefined;
    rule.fieldsToScrub = readText(raw["fieldsToScrub"]) || undefined;
    rule.source = readText(raw["source"]) || undefined;

    if (readText(raw["customRegex"])) {
      rule.customRegex = readText(raw["customRegex"]);
    }

    const keys: Array<string> = readScrubRuleKeys(raw["attributeKeys"]);

    if (keys.length > 0) {
      rule.attributeKeys = keys;
    }

    const proof: ScrubRuleProof | null = readScrubRuleProof(raw["proof"]);

    if (proof) {
      rule.proof = proof;
    }

    rule.readers = readReaders(raw["readers"]);

    if (raw["securityEventsLoses"] === true) {
      rule.securityEventsLoses = true;
    }
  }

  return rule;
}

// A plan as stored, read strictly: a place or a rule that is not one is left out.
export function readScrubPlan(value: unknown): ScrubPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw: JSONObject = value as JSONObject;

  if (!isDataStoreKind(raw["kind"])) {
    return null;
  }

  const places: Array<ScrubPlace> = [];

  for (const item of Array.isArray(raw["places"]) ? raw["places"] : []) {
    const place: ScrubPlace | null = readPlace(item);

    if (place) {
      places.push(place);
    }
  }

  const plan: ScrubPlan = {
    kind: raw["kind"] as DataStoreKind,
    serviceId: readText(raw["serviceId"]) || undefined,
    places: places.slice(0, MAX_SCRUB_PLACES_PER_PROPOSAL),
  };

  if (!Array.isArray(raw["rules"])) {
    return plan;
  }

  const placeIds: Set<string> = new Set<string>(
    plan.places.map((place: ScrubPlace): string => {
      return place.findingId;
    }),
  );
  const rules: Array<ScrubPlanRule> = [];

  for (const item of raw["rules"]) {
    const rule: ScrubPlanRule | null = readRule(item);

    // A rule for no place the plan holds makes nothing.
    if (
      rule &&
      rule.findingIds.every((id: string): boolean => {
        return placeIds.has(id);
      })
    ) {
      rules.push(rule);
    }
  }

  plan.version = SCRUB_PLAN_VERSION;
  plan.rules = rules;
  plan.serviceName = readText(raw["serviceName"]) || undefined;

  if (isLane(raw["lane"])) {
    plan.lane = raw["lane"];
  }

  return plan;
}

// The rules a change used, as its result holds them.
export function readScrubResult(value: unknown): Array<ScrubRuleUsed> {
  if (!value || typeof value !== "object") {
    return [];
  }

  const rules: unknown = (value as JSONObject)["rules"];
  const used: Array<ScrubRuleUsed> = [];

  for (const item of Array.isArray(rules) ? rules : []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const rule: JSONObject = item as JSONObject;
    const scrubRuleId: string = readText(rule["scrubRuleId"]);

    if (!ObjectID.isValidUUID(scrubRuleId) || !isSignal(rule["signal"])) {
      continue;
    }

    used.push({
      findingId: readText(rule["findingId"]),
      signal: rule["signal"],
      scrubRuleId,
      scrubRuleName: readText(rule["scrubRuleName"]),
      created: rule["created"] === true,
    });
  }

  return used;
}

export function placeKey(place: {
  dataTypeId: string;
  location: string;
}): string {
  return `${place.dataTypeId}@${place.location}`;
}

/*
 * What makes two scrub proposals for an issue the same: the lane they are
 * in, and the places they scrub. The lane that asks keeps the key every
 * scrub proposal had before lanes (#10364), so one made then is the same
 * proposal still.
 */
export function getScrubPlanKey(
  places: ReadonlyArray<{ dataTypeId: string; location: string }>,
  lane: ScrubLane = ScrubLane.Ask,
): string {
  const keys: Array<string> = places.map(placeKey).sort();

  return `${lane}:${sha256Hex(keys.join("\n")).slice(0, 16)}`;
}

// How many things read what a rule hides, all kinds together.
export function countScrubReaders(
  readers: ScrubReaderCounts | undefined,
): number {
  return TELEMETRY_FIELD_READER_KINDS.reduce(
    (sum: number, kind: TelemetryFieldReaderKind): number => {
      return sum + (readers?.[kind] || 0);
    },
    0,
  );
}

/*
 * Why a rule must wait for a person, from what was proven of it: none for
 * a rule that may run on its own.
 */
export function getScrubWaitReasons(data: {
  rule: Pick<
    ScrubPlanRule,
    "signal" | "proof" | "readers" | "securityEventsLoses"
  >;
  serviceId?: string | null | undefined;
  isTakenBack?: boolean | undefined;
}): Array<ScrubWaitReason> {
  const reasons: Array<ScrubWaitReason> = [];

  if (data.rule.signal === "metric") {
    return [ScrubWaitReason.MetricRule];
  }

  if (!data.rule.proof) {
    reasons.push(ScrubWaitReason.NotProven);
  } else if (getScrubOverreachShare(data.rule.proof) > 0) {
    reasons.push(ScrubWaitReason.ChangesOtherValues);
  }

  if (!data.rule.readers) {
    reasons.push(ScrubWaitReason.ReadersUnknown);
  } else if (
    countScrubReaders(data.rule.readers) > 0 ||
    data.rule.securityEventsLoses
  ) {
    reasons.push(ScrubWaitReason.IsRead);
  }

  if (!data.serviceId) {
    reasons.push(ScrubWaitReason.EveryService);
  }

  if (data.isTakenBack) {
    reasons.push(ScrubWaitReason.TakenBack);
  }

  return reasons;
}

// The lane a rule is in: Ask while anything was not proven, then by whether its places are secrets.
export function getScrubLane(data: {
  rule: Pick<ScrubPlanRule, "waitReasons" | "findingIds">;
  places: ReadonlyArray<ScrubPlace>;
}): ScrubLane {
  if (data.rule.waitReasons.length > 0) {
    return ScrubLane.Ask;
  }

  const isEverySecret: boolean = data.rule.findingIds.every(
    (id: string): boolean => {
      return data.places.some((place: ScrubPlace): boolean => {
        return place.findingId === id && place.isSecret === true;
      });
    },
  );

  return isEverySecret ? ScrubLane.Alone : ScrubLane.Widen;
}

const WAIT_REASON_SENTENCES: Readonly<Record<ScrubWaitReason, string>> = {
  [ScrubWaitReason.NotProven]:
    "it could not be run on any record the data was seen in - they are gone, or of a kind no rule is proven on",
  [ScrubWaitReason.ChangesOtherValues]:
    "it also changes some of the other values at its place",
  [ScrubWaitReason.IsRead]: "something in the project reads what it hides",
  [ScrubWaitReason.ReadersUnknown]:
    "what reads what it hides could not be read just now",
  [ScrubWaitReason.EveryService]:
    "it would apply to every service, not only the one the data was seen in",
  [ScrubWaitReason.MetricRule]:
    "it is a metric's pipeline rule, which is never proven on records",
  [ScrubWaitReason.TakenBack]:
    "a person took back or dismissed a rule for this place before",
};

export function describeScrubWaitReason(reason: ScrubWaitReason): string {
  return WAIT_REASON_SENTENCES[reason];
}

const READER_NOUNS: Readonly<
  Record<TelemetryFieldReaderKind, { one: string; many: string }>
> = {
  [TelemetryFieldReaderKind.Monitor]: { one: "monitor", many: "monitors" },
  [TelemetryFieldReaderKind.Dashboard]: {
    one: "dashboard",
    many: "dashboards",
  },
  [TelemetryFieldReaderKind.SavedView]: {
    one: "saved view",
    many: "saved views",
  },
  [TelemetryFieldReaderKind.RecordingRule]: {
    one: "recording rule",
    many: "recording rules",
  },
  [TelemetryFieldReaderKind.ServiceLevelObjective]: {
    one: "SLO",
    many: "SLOs",
  },
};

// "2 monitors and 1 dashboard": what reads what a rule hides, counted - never named.
export function describeScrubReaders(
  readers: ScrubReaderCounts | undefined,
): string {
  const parts: Array<string> = [];

  for (const kind of TELEMETRY_FIELD_READER_KINDS) {
    const count: number = readers?.[kind] || 0;

    if (count > 0) {
      parts.push(
        `${String(count)} ${count === 1 ? READER_NOUNS[kind].one : READER_NOUNS[kind].many}`,
      );
    }
  }

  if (parts.length <= 1) {
    return parts.join("");
  }

  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// What a rule's proposal says it was proven on, and what reads what it hides.
export function describeScrubPlanRule(
  rule: ScrubPlanRule,
): Array<MarkdownText> {
  const lines: Array<MarkdownText> = [
    mdText`**${rule.name}** (${rule.signal}): ${rule.description}`,
  ];

  if (rule.signal === "metric") {
    return lines;
  }

  lines.push(
    rule.proof
      ? mdText`${describeScrubRuleProof(rule.proof)}`
      : mdText`Not proven: there was no record it could be run on.`,
  );

  const readers: string = describeScrubReaders(rule.readers);

  if (!rule.readers) {
    lines.push(mdText`What reads what it hides could not be read just now.`);
  } else if (readers && rule.securityEventsLoses) {
    lines.push(
      mdText`Read by ${readers}, and by Security Events: they would read what the rule leaves instead.`,
    );
  } else if (readers) {
    lines.push(
      mdText`Read by ${readers}: they would read what the rule leaves instead.`,
    );
  } else if (rule.securityEventsLoses) {
    lines.push(
      mdText`Security Events reads what it hides, and would no longer see it.`,
    );
  } else {
    lines.push(mdText`Nothing in the project reads what it hides.`);
  }

  if (rule.waitReasons.length > 0) {
    lines.push(
      mdText`It waits for you because ${rule.waitReasons
        .map(describeScrubWaitReason)
        .join("; ")}.`,
    );
  }

  return lines;
}

function formatSeenAt(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ""
    : ` (last seen ${date.toISOString().slice(0, 10)})`;
}

/*
 * What a person still must do about a secret OneUptime AI hid: hiding it
 * stops new copies only - the secret still works, and the records stored
 * before keep it - so it is rotated, and where it was seen is said.
 */
export function getScrubRotateLines(data: {
  places: ReadonlyArray<ScrubPlace>;
  storeName: string;
}): Array<MarkdownText> {
  return data.places
    .filter((place: ScrubPlace): boolean => {
      return place.isSecret === true;
    })
    .map((place: ScrubPlace): MarkdownText => {
      return mdText`**Rotate this secret.** Hiding it stops new copies only: it still works, and records stored before the rule keep it until they age out. It was seen in ${FeedMarkdown.code(place.location)} of ${data.storeName}${formatSeenAt(place.lastSeenAt)}.`;
    });
}

// A rule's lines, under its bullet.
export function joinRuleLines(
  lines: ReadonlyArray<MarkdownText>,
): MarkdownText {
  return FeedMarkdown.join([...lines], "  \n  ");
}
