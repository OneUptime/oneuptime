import Crypto from "../Crypto";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource, {
  isSecurityDetectionSource,
} from "../../Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../Types/SecurityCase/SecurityEntity";
import {
  DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
  ENTITY_RISK_CASE_THRESHOLD_MAX,
  ENTITY_RISK_CASE_THRESHOLD_MIN,
  ENTITY_RISK_CONTRIBUTION_LIMIT,
  ENTITY_RISK_HISTORY_IN_DAYS,
  ENTITY_RISK_POINTS_BY_SEVERITY,
  ENTITY_RISK_POINTS_MAX,
  ENTITY_RISK_POINTS_MIN,
  ENTITY_RISK_WINDOW_IN_DAYS,
  RISK_ENTITY_TYPES,
  SECURITY_ENTITY_CRITICALITY_WEIGHTS,
  SecurityEntityCriticality,
  SecurityEntityRiskContribution,
  SecurityEntityRiskHistoryPoint,
  SecurityEntityRiskLevel,
} from "../../Types/SecurityCase/SecurityEntityRisk";
import { matchesProtectedEntityPattern } from "../../Types/SecurityPlaybook/SecurityProtectedEntity";

/*
 * How an entity's risk is worked out (Types/SecurityCase/SecurityEntityRisk
 * says why), as pure functions of the entity's sources and the clock, so the
 * server that writes a score and the page that explains it agree, and every
 * rule of it is pinned in a plain test.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

export const ENTITY_RISK_WINDOW_IN_MS: number =
  ENTITY_RISK_WINDOW_IN_DAYS * DAY_IN_MS;

// The longest entity value a risk key holds as it is; longer ones are hashed.
export const ENTITY_RISK_KEY_VALUE_LIMIT: number = 200;

// The most ATT&CK ids one source, and one entity, keeps.
const MITRE_ID_LIMIT: number = 25;

// The longest source name kept, so one product's rule name cannot grow a row.
const SOURCE_NAME_LIMIT: number = 200;

/*
 * The one key of an entity's risk: its value, trimmed and case folded - as a
 * case's grouping key and the events' observables fold it - and hashed when
 * it is too long to index whole.
 */
export function getEntityRiskKey(value: string): string {
  const folded: string = (value || "").trim().toLowerCase();

  if (folded.length > ENTITY_RISK_KEY_VALUE_LIMIT) {
    return `sha256:${Crypto.getSha256Hash(folded)}`;
  }

  return folded;
}

/*
 * The grouping key of the open case about an entity
 * (SecurityCaseIngest.securityCaseGroupingKey): the case a risk detection
 * joins, and the one an entity's page links to.
 */
export function getEntityCaseGroupingKey(value: string): string {
  return `entity:${getEntityRiskKey(value)}`;
}

export function isRiskEntityType(type: unknown): type is SecurityEntityType {
  return (
    typeof type === "string" &&
    (RISK_ENTITY_TYPES as ReadonlyArray<string>).includes(type)
  );
}

// The entities of a finding that can carry risk, each once.
export function getRiskEntities(
  entities: ReadonlyArray<SecurityEntity>,
): Array<SecurityEntity> {
  const seen: Set<string> = new Set();
  const result: Array<SecurityEntity> = [];

  for (const entity of entities) {
    if (!entity || !isRiskEntityType(entity.type)) {
      continue;
    }

    const value: string = (entity.value || "").trim();

    if (!value) {
      continue;
    }

    const key: string = getEntityRiskKey(value);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ type: entity.type, value });
  }

  return result;
}

function isOcsfSeverity(value: unknown): value is OcsfSeverity {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ENTITY_RISK_POINTS_BY_SEVERITY, value)
  );
}

// What a finding of this severity adds; an unknown severity counts as Medium.
export function getRiskPointsForSeverity(severity: unknown): number {
  if (!isOcsfSeverity(severity)) {
    return ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.Medium];
  }

  return ENTITY_RISK_POINTS_BY_SEVERITY[severity];
}

/*
 * A detection rule's own Risk Points, as stored: a whole number from 0 to
 * 100, or nothing (null) when the rule's level decides.
 */
export function readRiskPointsSetting(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.min(
    ENTITY_RISK_POINTS_MAX,
    Math.max(ENTITY_RISK_POINTS_MIN, Math.round(number)),
  );
}

// What one finding adds: the rule's own Risk Points when set, else its severity's.
export function resolveRiskPoints(data: {
  severity: unknown;
  riskPoints?: unknown;
}): number {
  const own: number | null = readRiskPointsSetting(data.riskPoints);

  return own === null ? getRiskPointsForSeverity(data.severity) : own;
}

function severityRank(severity: unknown): number {
  if (!isOcsfSeverity(severity) || severity === OcsfSeverity.Other) {
    return 0;
  }

  return OcsfSeverityId[severity];
}

function worse(a: OcsfSeverity, b: OcsfSeverity): OcsfSeverity {
  return severityRank(b) > severityRank(a) ? b : a;
}

function readTime(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }

  const time: number = new Date(value as string).getTime();

  return Number.isNaN(time) ? null : time;
}

function readIds(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item: unknown): item is string => {
      return typeof item === "string" && item.trim().length > 0;
    })
    .slice(0, MITRE_ID_LIMIT);
}

function readOptionalId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/*
 * An entity's sources as its row stores them, read defensively: a row
 * written by an older version, or by hand, may hold anything. An entry with
 * no key, no times or a source this version does not know is left out.
 */
export function readRiskContributions(
  value: unknown,
): Array<SecurityEntityRiskContribution> {
  if (!Array.isArray(value)) {
    return [];
  }

  const contributions: Array<SecurityEntityRiskContribution> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const sourceKey: unknown = record["sourceKey"];
    const firstSeenAt: number | null = readTime(record["firstSeenAt"]);
    const lastSeenAt: number | null = readTime(record["lastSeenAt"]);

    if (
      typeof sourceKey !== "string" ||
      !sourceKey ||
      firstSeenAt === null ||
      lastSeenAt === null ||
      !isSecurityDetectionSource(record["source"])
    ) {
      continue;
    }

    const points: number | null = readRiskPointsSetting(record["points"]);
    const hits: number = Number(record["hits"]);

    contributions.push({
      sourceKey,
      source: record["source"] as SecurityDetectionSource,
      sourceName:
        typeof record["sourceName"] === "string"
          ? (record["sourceName"] as string)
          : "",
      severity: isOcsfSeverity(record["severity"])
        ? (record["severity"] as OcsfSeverity)
        : OcsfSeverity.Unknown,
      points: points === null ? 0 : points,
      hits: Number.isFinite(hits) && hits > 0 ? Math.trunc(hits) : 1,
      firstSeenAt: new Date(firstSeenAt).toISOString(),
      lastSeenAt: new Date(lastSeenAt).toISOString(),
      mitreTactics: readIds(record["mitreTactics"]),
      mitreTechniques: readIds(record["mitreTechniques"]),
      detectionRuleId: readOptionalId(record["detectionRuleId"]),
      threatIntelFeedId: readOptionalId(record["threatIntelFeedId"]),
      securityEventConnectionId: readOptionalId(
        record["securityEventConnectionId"],
      ),
    });
  }

  return contributions;
}

// Whether a source still counts: it said something within the window.
export function isRiskContributionInWindow(
  contribution: SecurityEntityRiskContribution,
  now: Date,
): boolean {
  const lastSeenAt: number | null = readTime(contribution.lastSeenAt);

  return (
    lastSeenAt !== null && lastSeenAt >= now.getTime() - ENTITY_RISK_WINDOW_IN_MS
  );
}

// One finding about an entity, from one source, at one moment.
export interface SecurityEntityRiskObservation {
  sourceKey: string;
  source: SecurityDetectionSource;
  sourceName: string;
  severity: OcsfSeverity;
  points: number;
  seenAt: Date;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  detectionRuleId?: string | undefined;
  threatIntelFeedId?: string | undefined;
  securityEventConnectionId?: string | undefined;
}

function union(a: Array<string>, b: Array<string>): Array<string> {
  return Array.from(new Set([...a, ...b])).slice(0, MITRE_ID_LIMIT);
}

function clampName(name: string): string {
  const text: string = (name || "").trim();

  return text.length > SOURCE_NAME_LIMIT
    ? `${text.slice(0, SOURCE_NAME_LIMIT - 1)}…`
    : text;
}

/*
 * Keeps the sources that still count and, past the limit, the ones that add
 * most, the latest first among equals.
 */
export function pruneRiskContributions(
  contributions: Array<SecurityEntityRiskContribution>,
  now: Date,
): Array<SecurityEntityRiskContribution> {
  return contributions
    .filter((contribution: SecurityEntityRiskContribution): boolean => {
      return isRiskContributionInWindow(contribution, now);
    })
    .sort(
      (
        a: SecurityEntityRiskContribution,
        b: SecurityEntityRiskContribution,
      ): number => {
        if (b.points !== a.points) {
          return b.points - a.points;
        }

        return (readTime(b.lastSeenAt) || 0) - (readTime(a.lastSeenAt) || 0);
      },
    )
    .slice(0, ENTITY_RISK_CONTRIBUTION_LIMIT);
}

/*
 * An entity's sources once a finding about it is taken in:
 *  - a source already counting counts once still: the most it added and its
 *    worst severity, one more hit, its latest time and ATT&CK ids;
 *  - a source that went quiet for the whole window starts counting afresh,
 *    from this finding;
 *  - a new source joins.
 * A finding that adds no points still counts as the source's hit, so the
 * entity's page says what named it, but adds nothing to the score.
 */
export function addRiskObservation(
  contributions: Array<SecurityEntityRiskContribution>,
  observation: SecurityEntityRiskObservation,
  now: Date,
): Array<SecurityEntityRiskContribution> {
  const seenAt: string = observation.seenAt.toISOString();
  const points: number = readRiskPointsSetting(observation.points) || 0;
  const existing: SecurityEntityRiskContribution | undefined =
    contributions.find((contribution: SecurityEntityRiskContribution) => {
      return contribution.sourceKey === observation.sourceKey;
    });

  const others: Array<SecurityEntityRiskContribution> = contributions.filter(
    (contribution: SecurityEntityRiskContribution): boolean => {
      return contribution.sourceKey !== observation.sourceKey;
    },
  );

  let next: SecurityEntityRiskContribution;

  if (existing && isRiskContributionInWindow(existing, now)) {
    const isLater: boolean =
      observation.seenAt.getTime() >= (readTime(existing.lastSeenAt) || 0);

    next = {
      ...existing,
      // Named as its latest finding names it: a rule renamed since reads as it is now.
      sourceName: isLater
        ? clampName(observation.sourceName) || existing.sourceName
        : existing.sourceName,
      severity: worse(existing.severity, observation.severity),
      points: Math.max(existing.points, points),
      hits: existing.hits + 1,
      lastSeenAt: isLater ? seenAt : existing.lastSeenAt,
      mitreTactics: union(existing.mitreTactics, observation.mitreTactics),
      mitreTechniques: union(
        existing.mitreTechniques,
        observation.mitreTechniques,
      ),
    };
  } else {
    next = {
      sourceKey: observation.sourceKey,
      source: observation.source,
      sourceName: clampName(observation.sourceName),
      severity: observation.severity,
      points: points,
      hits: 1,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      mitreTactics: observation.mitreTactics.slice(0, MITRE_ID_LIMIT),
      mitreTechniques: observation.mitreTechniques.slice(0, MITRE_ID_LIMIT),
    };
  }

  if (observation.detectionRuleId) {
    next.detectionRuleId = observation.detectionRuleId;
  }

  if (observation.threatIntelFeedId) {
    next.threatIntelFeedId = observation.threatIntelFeedId;
  }

  if (observation.securityEventConnectionId) {
    next.securityEventConnectionId = observation.securityEventConnectionId;
  }

  return pruneRiskContributions([...others, next], now);
}

// How much an entity of this criticality counts: x1 when the project said nothing.
export function getCriticalityWeight(
  criticality: SecurityEntityCriticality | string | null | undefined,
): number {
  if (
    typeof criticality === "string" &&
    Object.prototype.hasOwnProperty.call(
      SECURITY_ENTITY_CRITICALITY_WEIGHTS,
      criticality,
    )
  ) {
    return SECURITY_ENTITY_CRITICALITY_WEIGHTS[
      criticality as SecurityEntityCriticality
    ];
  }

  return 1;
}

export function isSecurityEntityCriticality(
  value: unknown,
): value is SecurityEntityCriticality {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(
      SECURITY_ENTITY_CRITICALITY_WEIGHTS,
      value,
    )
  );
}

export interface SecurityEntityRiskSummary {
  // What the sources add up to, before the entity's criticality.
  baseScore: number;
  // The score: the sum weighted by the entity's criticality, rounded.
  score: number;
  // The sources that count.
  contributors: Array<SecurityEntityRiskContribution>;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  firstRiskAt: Date | null;
  lastRiskAt: Date | null;
  // When the next source stops counting, and the score next falls.
  expiresAt: Date | null;
}

export function weightRiskScore(
  baseScore: number,
  criticality: SecurityEntityCriticality | string | null | undefined,
): number {
  return Math.round(baseScore * getCriticalityWeight(criticality));
}

// An entity's risk now, from its sources and how much it matters.
export function computeEntityRisk(data: {
  contributions: Array<SecurityEntityRiskContribution>;
  criticality?: SecurityEntityCriticality | string | null | undefined;
  now: Date;
}): SecurityEntityRiskSummary {
  const contributors: Array<SecurityEntityRiskContribution> =
    pruneRiskContributions(data.contributions, data.now);

  let baseScore: number = 0;
  let firstRiskAt: number | null = null;
  let lastRiskAt: number | null = null;
  let expiresAt: number | null = null;
  let mitreTactics: Array<string> = [];
  let mitreTechniques: Array<string> = [];

  for (const contribution of contributors) {
    baseScore += contribution.points;

    const first: number = readTime(contribution.firstSeenAt) || 0;
    const last: number = readTime(contribution.lastSeenAt) || 0;

    firstRiskAt = firstRiskAt === null ? first : Math.min(firstRiskAt, first);
    lastRiskAt = lastRiskAt === null ? last : Math.max(lastRiskAt, last);

    // A source that adds nothing never makes the score fall when it goes.
    if (contribution.points > 0) {
      const leaves: number = last + ENTITY_RISK_WINDOW_IN_MS;
      expiresAt = expiresAt === null ? leaves : Math.min(expiresAt, leaves);
    }

    mitreTactics = union(mitreTactics, contribution.mitreTactics);
    mitreTechniques = union(mitreTechniques, contribution.mitreTechniques);
  }

  return {
    baseScore,
    score: weightRiskScore(baseScore, data.criticality),
    contributors,
    mitreTactics,
    mitreTechniques,
    firstRiskAt: firstRiskAt === null ? null : new Date(firstRiskAt),
    lastRiskAt: lastRiskAt === null ? null : new Date(lastRiskAt),
    expiresAt: expiresAt === null ? null : new Date(expiresAt),
  };
}

// A project's threshold as stored: a whole number in range, or the default.
export function readRiskCaseThreshold(value: unknown): number {
  const number: number = typeof value === "number" ? value : Number(value);

  if (value === null || value === undefined || !Number.isFinite(number)) {
    return DEFAULT_ENTITY_RISK_CASE_THRESHOLD;
  }

  return Math.min(
    ENTITY_RISK_CASE_THRESHOLD_MAX,
    Math.max(ENTITY_RISK_CASE_THRESHOLD_MIN, Math.round(number)),
  );
}

// What the server and the form say when a threshold is not one.
export const RISK_CASE_THRESHOLD_ERROR: string = `The risk threshold is a whole number from ${ENTITY_RISK_CASE_THRESHOLD_MIN} to ${ENTITY_RISK_CASE_THRESHOLD_MAX}.`;

/*
 * Why a threshold someone sets cannot be kept - not a whole number, or out
 * of range - or null when it can.
 */
export function getRiskCaseThresholdError(value: unknown): string | null {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isInteger(number) ||
    number < ENTITY_RISK_CASE_THRESHOLD_MIN ||
    number > ENTITY_RISK_CASE_THRESHOLD_MAX
  ) {
    return RISK_CASE_THRESHOLD_ERROR;
  }

  return null;
}

// How risky a score is against the project's threshold (SecurityEntityRiskLevel).
export function getEntityRiskLevel(
  score: number,
  threshold: number,
): SecurityEntityRiskLevel {
  const limit: number = readRiskCaseThreshold(threshold);

  if (!Number.isFinite(score) || score <= 0) {
    return SecurityEntityRiskLevel.None;
  }

  if (score >= limit * 2) {
    return SecurityEntityRiskLevel.Critical;
  }

  if (score >= limit) {
    return SecurityEntityRiskLevel.High;
  }

  if (score >= limit / 2) {
    return SecurityEntityRiskLevel.Medium;
  }

  return SecurityEntityRiskLevel.Low;
}

/*
 * The severity of the detection an entity's risk raises: High where a case
 * opens, Critical from twice the threshold. A case's priority follows it.
 */
export function getRiskDetectionSeverity(
  score: number,
  threshold: number,
): OcsfSeverity {
  return getEntityRiskLevel(score, threshold) ===
    SecurityEntityRiskLevel.Critical
    ? OcsfSeverity.Critical
    : OcsfSeverity.High;
}

/*
 * What the entity's risk adds up to from the sources that began counting
 * since its last risk case: once a case opened about its risk, what was
 * already behind it is not counted again, so a case closed as handled is not
 * opened again by the same findings. A source that went quiet for the whole
 * window and came back counts afresh.
 */
export function getRiskSinceLastCase(data: {
  contributions: Array<SecurityEntityRiskContribution>;
  riskCaseAt: Date | null | undefined;
  criticality?: SecurityEntityCriticality | string | null | undefined;
  now: Date;
}): number {
  const since: number | null = data.riskCaseAt
    ? data.riskCaseAt.getTime()
    : null;

  let baseScore: number = 0;

  for (const contribution of pruneRiskContributions(
    data.contributions,
    data.now,
  )) {
    const first: number = readTime(contribution.firstSeenAt) || 0;

    if (since === null || first > since) {
      baseScore += contribution.points;
    }
  }

  return weightRiskScore(baseScore, data.criticality);
}

// Whether an entity's risk opens (or joins) a case now.
export function shouldRaiseRiskCase(data: {
  isEnabled: boolean;
  threshold: number;
  riskSinceLastCase: number;
}): boolean {
  return (
    data.isEnabled === true &&
    data.riskSinceLastCase >= readRiskCaseThreshold(data.threshold)
  );
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DAY_REGEX: RegExp = /^\d{4}-\d{2}-\d{2}$/;

// An entity's history as its row stores it: a point a day, oldest first.
export function readRiskHistory(
  value: unknown,
): Array<SecurityEntityRiskHistoryPoint> {
  if (!Array.isArray(value)) {
    return [];
  }

  const byDay: Map<string, number> = new Map();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const day: unknown = record["day"];
    const score: number = Number(record["score"]);

    if (typeof day !== "string" || !DAY_REGEX.test(day)) {
      continue;
    }

    if (!Number.isFinite(score) || score < 0) {
      continue;
    }

    byDay.set(day, Math.round(score));
  }

  return Array.from(byDay.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .map(([day, score]: [string, number]): SecurityEntityRiskHistoryPoint => {
      return { day, score };
    });
}

/*
 * The history once the score of now is taken in: today's point is the latest
 * score of the day, and points older than ENTITY_RISK_HISTORY_IN_DAYS go.
 */
export function updateRiskHistory(
  history: Array<SecurityEntityRiskHistoryPoint>,
  score: number,
  now: Date,
): Array<SecurityEntityRiskHistoryPoint> {
  const today: string = dayOf(now);
  const oldest: string = dayOf(
    new Date(now.getTime() - (ENTITY_RISK_HISTORY_IN_DAYS - 1) * DAY_IN_MS),
  );

  return [
    ...readRiskHistory(history).filter(
      (point: SecurityEntityRiskHistoryPoint): boolean => {
        return point.day >= oldest && point.day !== today;
      },
    ),
    { day: today, score: Math.max(0, Math.round(score)) },
  ];
}

/*
 * One score for each of the last `days` days, oldest first: a day without a
 * point of its own carries the score of the day before - it changes only
 * when a finding arrives or a source stops counting - and a day before the
 * first point is 0.
 */
export function getRiskHistorySeries(data: {
  history: Array<SecurityEntityRiskHistoryPoint>;
  now: Date;
  days: number;
}): Array<SecurityEntityRiskHistoryPoint> {
  const points: Array<SecurityEntityRiskHistoryPoint> = readRiskHistory(
    data.history,
  );
  const days: number = Math.max(1, Math.trunc(data.days));
  const series: Array<SecurityEntityRiskHistoryPoint> = [];

  let index: number = 0;
  let carried: number = 0;

  for (let offset: number = days - 1; offset >= 0; offset--) {
    const day: string = dayOf(
      new Date(data.now.getTime() - offset * DAY_IN_MS),
    );

    while (index < points.length && points[index]!.day <= day) {
      carried = points[index]!.score;
      index++;
    }

    series.push({ day, score: carried });
  }

  return series;
}

// ---------- Criticality ----------

// One entry of the project's Entity Criticality list.
export interface SecurityEntityCriticalityRule {
  // The value or a `*` pattern, as the project wrote it.
  value: string;
  // The kind it is for; empty is any kind.
  entityType?: SecurityEntityType | null | undefined;
  criticality: SecurityEntityCriticality;
}

const WILDCARD: string = "*";

function literalLength(pattern: string): number {
  return pattern.split(WILDCARD).join("").length;
}

/*
 * The entry that says how much an entity matters, when several name it: the
 * most specific one - a value written out beats a pattern, a pattern with
 * more written out beats one with less - and, between two as specific, the
 * one that weighs more.
 */
export function findEntityCriticalityRule(data: {
  entity: SecurityEntity;
  rules: ReadonlyArray<SecurityEntityCriticalityRule>;
}): SecurityEntityCriticalityRule | undefined {
  let best: SecurityEntityCriticalityRule | undefined = undefined;
  let bestRank: [number, number, number] | null = null;

  for (const rule of data.rules) {
    if (!rule || !isSecurityEntityCriticality(rule.criticality)) {
      continue;
    }

    if (rule.entityType && rule.entityType !== data.entity.type) {
      continue;
    }

    if (!matchesProtectedEntityPattern(rule.value, data.entity.value)) {
      continue;
    }

    const pattern: string = (rule.value || "").trim();
    const rank: [number, number, number] = [
      pattern.includes(WILDCARD) ? 0 : 1,
      literalLength(pattern),
      getCriticalityWeight(rule.criticality),
    ];

    const isBetter: boolean =
      bestRank === null ||
      rank[0] > bestRank[0] ||
      (rank[0] === bestRank[0] &&
        (rank[1] > bestRank[1] ||
          (rank[1] === bestRank[1] && rank[2] > bestRank[2])));

    if (isBetter) {
      best = rule;
      bestRank = rank;
    }
  }

  return best;
}
