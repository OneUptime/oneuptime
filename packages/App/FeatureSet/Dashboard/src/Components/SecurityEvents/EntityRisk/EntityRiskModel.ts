import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Color from "Common/Types/Color";
import { Blue, Gray500, Orange, Red, Yellow } from "Common/Types/BrandColors";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  SecurityEntityCriticality,
  SecurityEntityRiskContribution,
  SecurityEntityRiskHistoryPoint,
  SecurityEntityRiskLevel,
} from "Common/Types/SecurityCase/SecurityEntityRisk";
import {
  getCriticalityWeight,
  getEntityRiskLevel,
  getRiskHistorySeries,
  isSecurityEntityCriticality,
  readRiskCaseThreshold,
  readRiskContributions,
} from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import { DayCount } from "Common/Utils/SecurityCase/SecurityOverviewMetrics";

/*
 * What the Entity Risk pages draw from a risk row and the project's
 * threshold: a level's colour, the meter's fill, the score worked out in
 * words, the history as days of bars, and the address of an entity's page.
 * React-free, so each is pinned in a plain test against the server's own
 * arithmetic (Common/Utils/SecurityCase/SecurityEntityRiskScore).
 */

// The query parameter an entity's page reads its value from.
export const ENTITY_VALUE_QUERY_PARAM: string = "value";

/*
 * And its kind, when the page that links to it knows it (a case's entity,
 * a risk row): a host's name alone reads as no kind in particular.
 */
export const ENTITY_TYPE_QUERY_PARAM: string = "type";

// How many days of history an entity's page draws.
export const ENTITY_RISK_HISTORY_DAYS: number = 30;

// A level as the severities of the Events table draw them.
export function getEntityRiskLevelColor(level: SecurityEntityRiskLevel): Color {
  switch (level) {
    case SecurityEntityRiskLevel.Critical:
      return Red;
    case SecurityEntityRiskLevel.High:
      return Orange;
    case SecurityEntityRiskLevel.Medium:
      return Yellow;
    case SecurityEntityRiskLevel.Low:
      return Blue;
    default:
      return Gray500;
  }
}

// The levels a bar of the history is drawn in, from the bottom up.
export const ENTITY_RISK_HISTORY_LEVELS: ReadonlyArray<SecurityEntityRiskLevel> =
  [
    SecurityEntityRiskLevel.Low,
    SecurityEntityRiskLevel.Medium,
    SecurityEntityRiskLevel.High,
    SecurityEntityRiskLevel.Critical,
  ];

// An entity's page, for any value: a user, a host or an address.
export function getEntityRiskRoute(
  value: string,
  type?: string | null | undefined,
): Route {
  const knownType: SecurityEntityType | null = readEntityTypeFromQuery(type);

  return (
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW] as Route,
    ) as Route
  ).addQueryParams({
    [ENTITY_VALUE_QUERY_PARAM]: encodeURIComponent(value.trim()),
    ...(knownType
      ? { [ENTITY_TYPE_QUERY_PARAM]: encodeURIComponent(knownType) }
      : {}),
  });
}

// A kind from the page's query: one of the kinds there are, or none.
export function readEntityTypeFromQuery(
  raw: string | null | undefined,
): SecurityEntityType | null {
  const value: string = (raw || "").trim();

  return (Object.values(SecurityEntityType) as Array<string>).includes(value)
    ? (value as SecurityEntityType)
    : null;
}

/*
 * The value an entity's page is about, from its query as the browser reads
 * it (URLSearchParams, decoded already: decoding again would garble a value
 * that holds a %), trimmed; nothing when it names nothing.
 */
export function readEntityValueFromQuery(
  raw: string | null | undefined,
): string {
  return (raw || "").trim();
}

/*
 * How full the meter is: the score against twice the threshold, where
 * Critical starts, so the threshold - where a case opens - sits halfway.
 */
export function getEntityRiskMeterPercent(
  score: number,
  threshold: number,
): number {
  const limit: number = readRiskCaseThreshold(threshold) * 2;

  if (!Number.isFinite(score) || score <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((score / limit) * 1000) / 10);
}

export function readEntityCriticality(
  value: unknown,
): SecurityEntityCriticality | null {
  return isSecurityEntityCriticality(value) ? value : null;
}

export interface EntityRiskBreakdown {
  score: number;
  level: SecurityEntityRiskLevel;
  threshold: number;
  // What the sources add up to before the entity's criticality.
  baseScore: number;
  criticality: SecurityEntityCriticality | null;
  weight: number;
  sources: Array<SecurityEntityRiskContribution>;
}

/*
 * A risk row worked out for its page: its sources (the most first), what
 * they add up to and the criticality weight that makes the score, the
 * level against the project's threshold and how far the threshold is.
 */
export function getEntityRiskBreakdown(data: {
  riskScore: number | undefined;
  criticality: unknown;
  contributions: unknown;
  threshold: number;
}): EntityRiskBreakdown {
  const threshold: number = readRiskCaseThreshold(data.threshold);
  const score: number = Math.max(0, Math.round(data.riskScore || 0));
  const criticality: SecurityEntityCriticality | null = readEntityCriticality(
    data.criticality,
  );
  const sources: Array<SecurityEntityRiskContribution> = readRiskContributions(
    data.contributions,
  ).sort(
    (
      a: SecurityEntityRiskContribution,
      b: SecurityEntityRiskContribution,
    ): number => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }

      return (
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
      );
    },
  );

  let baseScore: number = 0;

  for (const source of sources) {
    baseScore += source.points;
  }

  return {
    score,
    level: getEntityRiskLevel(score, threshold),
    threshold,
    baseScore,
    criticality,
    weight: getCriticalityWeight(criticality),
    sources,
  };
}

/*
 * The history as the day bars draw it: each day's score under its level, so
 * a bar is coloured by how risky the entity was that day.
 */
export function getEntityRiskHistoryDays(data: {
  history: unknown;
  threshold: number;
  now: Date;
  days?: number | undefined;
}): Array<DayCount> {
  const series: Array<SecurityEntityRiskHistoryPoint> = getRiskHistorySeries({
    history: Array.isArray(data.history)
      ? (data.history as Array<SecurityEntityRiskHistoryPoint>)
      : [],
    now: data.now,
    days: data.days || ENTITY_RISK_HISTORY_DAYS,
  });

  return series.map((point: SecurityEntityRiskHistoryPoint): DayCount => {
    const level: SecurityEntityRiskLevel = getEntityRiskLevel(
      point.score,
      data.threshold,
    );
    const byKey: Record<string, number> = {};

    for (const key of ENTITY_RISK_HISTORY_LEVELS) {
      byKey[key] = key === level ? point.score : 0;
    }

    return { day: point.day, total: point.score, byKey };
  });
}
