import OcsfSeverity from "../SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "./SecurityDetectionSource";
import { SecurityEntityType } from "./SecurityEntity";

/*
 * ENTITY RISK: what everything found about a user, a host or an address adds
 * up to.
 *
 * A single finding rarely says much. A failed-sign-in burst, a first sudo on
 * a host and an Okta sign-in from a new country are each worth a glance; the
 * same account in all three in a week is worth a case. So every finding -
 * a detection rule's match, a threat intel match, an alert a connected
 * security product raised - adds risk points to the entity it is about, and
 * the entity's risk score is what those points add up to over the last
 * ENTITY_RISK_WINDOW_IN_DAYS days. When it reaches the project's threshold,
 * a case opens about the entity (or the open one about it takes the risk
 * in), naming everything that added to it. This is how the leading SIEMs
 * prioritise (Splunk's risk-based alerting, Elastic's entity risk scoring,
 * Google Security Operations' risk analytics, Sumo Logic's activity scores),
 * made simple enough to read at a glance:
 *
 *  - Points come from the finding's severity (ENTITY_RISK_POINTS_BY_SEVERITY),
 *    or from a detection rule's own Risk Points.
 *  - Each source - one rule, one threat intel feed, one product's rule -
 *    counts once in the window however often it fires, at the most it
 *    added, so one noisy rule can never make an entity look worse than three
 *    different ones. Repetition is what a rule's threshold is for; risk is
 *    about how many different things point at the same entity.
 *  - A source that has said nothing for ENTITY_RISK_WINDOW_IN_DAYS days stops
 *    counting.
 *  - An entity the project marked as mattering more or less (its
 *    criticality, SecurityEntityCriticality) has its score weighted.
 *
 * Kept free of anything server-only: the Dashboard reads the same points,
 * levels and words, so what a page says is what the server did.
 */

// How far back an entity's risk is counted.
export const ENTITY_RISK_WINDOW_IN_DAYS: number = 7;

/*
 * How long an entity whose risk went quiet is kept, with its history, before
 * it is forgotten: a month, so the risk of the last weeks can still be read.
 */
export const ENTITY_RISK_HISTORY_IN_DAYS: number = 30;

/*
 * The most sources an entity keeps. Past it, the ones that added least, and
 * of those the longest quiet, give way, so one entity's row cannot grow
 * without bound.
 */
export const ENTITY_RISK_CONTRIBUTION_LIMIT: number = 50;

// A detection rule's own Risk Points: whole numbers from 0 (adds no risk) to 100.
export const ENTITY_RISK_POINTS_MIN: number = 0;
export const ENTITY_RISK_POINTS_MAX: number = 100;

/*
 * Where a new project opens a case: two different High findings, or a High
 * and two Medium, about the same entity within a week. A project changes it
 * under Security Events > Settings > Entity Risk.
 */
export const DEFAULT_ENTITY_RISK_CASE_THRESHOLD: number = 100;
export const ENTITY_RISK_CASE_THRESHOLD_MIN: number = 10;
export const ENTITY_RISK_CASE_THRESHOLD_MAX: number = 10000;

/*
 * The kinds of entity that carry risk: who acted and where. A domain, a URL
 * or a file hash is what threat intel already says is bad; a process name is
 * the same on every machine. Neither is somebody to investigate.
 */
export const RISK_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> = [
  SecurityEntityType.User,
  SecurityEntityType.Host,
  SecurityEntityType.IpAddress,
];

/*
 * What a finding adds, by its severity. Informational findings are context
 * and add nothing; an unknown severity counts as Medium, as a detection of
 * unknown severity opens its case at Medium.
 */
export const ENTITY_RISK_POINTS_BY_SEVERITY: Readonly<
  Record<OcsfSeverity, number>
> = {
  [OcsfSeverity.Unknown]: 25,
  [OcsfSeverity.Informational]: 0,
  [OcsfSeverity.Low]: 10,
  [OcsfSeverity.Medium]: 25,
  [OcsfSeverity.High]: 50,
  [OcsfSeverity.Critical]: 75,
  [OcsfSeverity.Fatal]: 100,
  [OcsfSeverity.Other]: 25,
};

/*
 * The severities whose points a person reads in the docs and the product's
 * explanations, in that order.
 */
export const ENTITY_RISK_EXPLAINED_SEVERITIES: ReadonlyArray<OcsfSeverity> = [
  OcsfSeverity.Low,
  OcsfSeverity.Medium,
  OcsfSeverity.High,
  OcsfSeverity.Critical,
];

/*
 * How risky an entity is, against the project's threshold T:
 *   Critical  at least twice T
 *   High      at least T - where a case opens
 *   Medium    at least half of T
 *   Low       anything above nothing
 * Read off the score and the threshold of the moment, never stored, so a new
 * threshold reads at once on every entity.
 */
export enum SecurityEntityRiskLevel {
  None = "None",
  Low = "Low",
  Medium = "Medium",
  High = "High",
  Critical = "Critical",
}

// Most risky first.
export const SECURITY_ENTITY_RISK_LEVELS: ReadonlyArray<SecurityEntityRiskLevel> =
  [
    SecurityEntityRiskLevel.Critical,
    SecurityEntityRiskLevel.High,
    SecurityEntityRiskLevel.Medium,
    SecurityEntityRiskLevel.Low,
  ];

/*
 * How much an entity matters, as the project says it under Entity
 * Criticality: its whole score is weighted by it. An entity no entry names
 * counts as it is (x1).
 */
export enum SecurityEntityCriticality {
  Low = "Low",
  High = "High",
  Extreme = "Extreme",
}

export const SECURITY_ENTITY_CRITICALITIES: ReadonlyArray<SecurityEntityCriticality> =
  [
    SecurityEntityCriticality.Extreme,
    SecurityEntityCriticality.High,
    SecurityEntityCriticality.Low,
  ];

export const SECURITY_ENTITY_CRITICALITY_WEIGHTS: Readonly<
  Record<SecurityEntityCriticality, number>
> = {
  [SecurityEntityCriticality.Low]: 0.5,
  [SecurityEntityCriticality.High]: 1.5,
  [SecurityEntityCriticality.Extreme]: 2,
};

export const SECURITY_ENTITY_CRITICALITY_VALUE_MAX_LENGTH: number = 500;

/*
 * What can add risk: the three detection sources. A person opening a case
 * judged it already, and a case risk opened adds nothing back to the risk
 * that opened it.
 */
export const RISK_DETECTION_SOURCES: ReadonlyArray<SecurityDetectionSource> = [
  SecurityDetectionSource.DetectionRule,
  SecurityDetectionSource.ThreatIntel,
  SecurityDetectionSource.ConnectedProduct,
];

/*
 * One source's part in an entity's risk: everything one rule, one threat
 * intel feed or one connected product's rule found about it, in one entry.
 * Stored in a JSON column of the entity's risk row, so times are ISO text.
 */
export interface SecurityEntityRiskContribution {
  // rule:<id>, intel:<feed id> or connection:<id>:<the product's rule>.
  sourceKey: string;
  source: SecurityDetectionSource;
  // The rule, the feed, or the product's rule (and product), as named when it fired.
  sourceName: string;
  // The worst severity it fired at in the window.
  severity: OcsfSeverity;
  // What it adds: the most it added in the window.
  points: number;
  // How many times it named the entity since it started counting.
  hits: number;
  // When it started counting: its first finding, or the first after a quiet window.
  firstSeenAt: string;
  lastSeenAt: string;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  detectionRuleId?: string | undefined;
  threatIntelFeedId?: string | undefined;
  securityEventConnectionId?: string | undefined;
}

// An entity's score at the end of a day (UTC), as its history keeps it.
export interface SecurityEntityRiskHistoryPoint {
  // YYYY-MM-DD, UTC.
  day: string;
  score: number;
}
