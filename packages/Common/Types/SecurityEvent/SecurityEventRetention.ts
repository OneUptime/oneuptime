import { JSONArray, JSONObject, JSONValue } from "../JSON";
import TelemetryRetentionConfig, {
  resolveTelemetryRetentionInDays,
} from "../Telemetry/TelemetryRetentionConfig";
import {
  DetectionRuleDefinition,
  DetectionRuleType,
  SigmaCorrelationStep,
  SigmaCorrelationType,
  detectionRuleTypeOf,
  isDetectionRuleType,
} from "./SigmaCorrelation";

/*
 * HOW FAR BACK SECURITY EVENTS GO (#10432).
 *
 * A security event is kept for the project's retention for security
 * events: its retention by telemetry type when one is set (Enterprise),
 * else its Default Retention (Days), 15 days unless it was changed. A
 * source with a retention of its own keeps its events for that instead.
 *
 * Security Events reads further back than that: a First seen rule tells a
 * value is new by up to 30 days of history, Run on Past Events reads up to
 * the last 30 days, and a hunt opens on up to three months. Read past the
 * kept events, a value last seen 20 days ago read as never seen, and a
 * period half deleted read as "nothing found".
 *
 * OneUptime keeps the default at 15 days: retention sets what a project
 * pays for its telemetry on OneUptime Cloud (a GB kept 30 days costs twice
 * one kept 15) and the disk it takes when self-hosted, and it is how long
 * personal data in events (addresses, user names) is kept. Instead, what
 * reads further back reads only the events that are kept, and says how far
 * back that is:
 *
 *   - a rule's lookback follows the retention: a First seen rule tells a
 *     value is new by the history that is kept, says "First awsRegion in 15
 *     days", and its row says why it is not 30 (the run's notice);
 *   - Run on Past Events reads only kept events and says which part of its
 *     period they no longer cover, never "nothing found" for it;
 *   - the rule form, the Rule Library, a hunt's time range and Settings ->
 *     Telemetry say when a window reaches past the kept events, and how
 *     many days it needs.
 *
 * Shared by the server, which reads and runs with it, and the Dashboard,
 * which says it.
 */

export const SECONDS_IN_A_DAY: number = 24 * 60 * 60;

// The settings a project keeps security events by, as its Project row holds them.
export interface SecurityEventRetentionSettings {
  defaultTelemetryRetentionInDays?: number | null | undefined;
  // Read only while retention overrides apply (the Enterprise feature).
  telemetryRetentionConfig?: TelemetryRetentionConfig | null | undefined;
}

/*
 * How many days the project keeps a security event whose source has no
 * retention of its own: the one answer every reader of past events, and
 * everything that says how far back they go, works from.
 */
export function getSecurityEventRetentionInDays(
  project: SecurityEventRetentionSettings,
): number {
  return resolveTelemetryRetentionInDays({
    pillar: "securityEvents",
    projectConfig: project.telemetryRetentionConfig ?? null,
    projectRetentionInDays: project.defaultTelemetryRetentionInDays ?? null,
  });
}

/*
 * Where the kept events start: the retention before now. Every event that
 * happened since is kept. One that happened earlier is kept only when it
 * arrived late, for the retention from when it arrived.
 */
export function getSecurityEventsKeptFrom(data: {
  retentionInDays: number;
  now: Date;
}): Date {
  return new Date(
    data.now.getTime() - data.retentionInDays * SECONDS_IN_A_DAY * 1000,
  );
}

// A counting step's own timespan, which a sequence reads back before the step happens.
function getStepLookbackInSeconds(step: SigmaCorrelationStep): number {
  return step.count ? step.count.correlation.timespanInSeconds : 0;
}

/*
 * How far back a rule reads before the events it judges, in seconds:
 *
 *   - First seen: its timespan, the history a value is new against;
 *   - Event count and Distinct values: its timespan, the window it counts;
 *   - Events together and Sequence: its timespan, and before that a
 *     counting step's own timespan;
 *   - a single rule: nothing before the events it judges.
 */
export function getDetectionRuleLookbackInSeconds(
  definition: DetectionRuleDefinition,
): number {
  if (definition.kind === "single") {
    return 0;
  }

  const { correlation } = definition;

  switch (correlation.type) {
    case SigmaCorrelationType.Temporal:
    case SigmaCorrelationType.TemporalOrdered:
      return (
        correlation.timespanInSeconds +
        Math.max(0, ...definition.steps.map(getStepLookbackInSeconds))
      );
    default:
      return correlation.timespanInSeconds;
  }
}

// Whether a rule reads further back than the events are kept.
export function doesLookbackReachPastRetention(data: {
  lookbackInSeconds: number;
  retentionInDays: number;
}): boolean {
  return data.lookbackInSeconds > data.retentionInDays * SECONDS_IN_A_DAY;
}

/*
 * How far back a rule can see: its lookback, or the retention when that is
 * shorter.
 */
export function getKeptLookbackInSeconds(data: {
  lookbackInSeconds: number;
  retentionInDays: number;
}): number {
  return Math.min(
    data.lookbackInSeconds,
    data.retentionInDays * SECONDS_IN_A_DAY,
  );
}

// The whole days a lookback needs kept: the retention that lets a rule see all of it.
export function getRetentionInDaysNeededFor(lookbackInSeconds: number): number {
  return Math.max(1, Math.ceil(lookbackInSeconds / SECONDS_IN_A_DAY));
}

// ---------- What the Dashboard is told (POST /detection-rule/retention) ----------

// An enabled rule that reads further back than the events are kept.
export interface DetectionRulePastRetention {
  id: string;
  name: string;
  type: DetectionRuleType;
  lookbackInSeconds: number;
}

// The most rules an answer lists: the ones that read furthest back first.
export const SECURITY_EVENT_RETENTION_MAX_LISTED_RULES: number = 50;

export interface SecurityEventRetentionStatus {
  // How many days the project keeps security events (getSecurityEventRetentionInDays).
  retentionInDays: number;
  /*
   * The enabled rules that read further back than that, furthest first.
   * Null when the person asking may not read detection rules.
   */
  rulesPastRetention: Array<DetectionRulePastRetention> | null;
  // More rules read past it than are listed.
  hasMoreRulesPastRetention: boolean;
}

/*
 * The enabled rules that read further back than the events are kept, from
 * their definitions: the ones that read furthest back first, then by name.
 */
export function findRulesPastRetention(data: {
  rules: Array<{
    id: string;
    name: string;
    definition: DetectionRuleDefinition;
  }>;
  retentionInDays: number;
}): Array<DetectionRulePastRetention> {
  return data.rules
    .map(
      (rule: {
        id: string;
        name: string;
        definition: DetectionRuleDefinition;
      }): DetectionRulePastRetention => {
        return {
          id: rule.id,
          name: rule.name,
          type: detectionRuleTypeOf(rule.definition),
          lookbackInSeconds: getDetectionRuleLookbackInSeconds(rule.definition),
        };
      },
    )
    .filter((rule: DetectionRulePastRetention): boolean => {
      return doesLookbackReachPastRetention({
        lookbackInSeconds: rule.lookbackInSeconds,
        retentionInDays: data.retentionInDays,
      });
    })
    .sort(
      (
        first: DetectionRulePastRetention,
        second: DetectionRulePastRetention,
      ): number => {
        return (
          second.lookbackInSeconds - first.lookbackInSeconds ||
          first.name.localeCompare(second.name)
        );
      },
    );
}

// The longest lookback of the rules listed, or 0 when none is.
export function getLongestLookbackInSeconds(
  rules: ReadonlyArray<Pick<DetectionRulePastRetention, "lookbackInSeconds">>,
): number {
  return Math.max(
    0,
    ...rules.map(
      (rule: Pick<DetectionRulePastRetention, "lookbackInSeconds">): number => {
        return rule.lookbackInSeconds;
      },
    ),
  );
}

export function securityEventRetentionStatusToJSON(
  status: SecurityEventRetentionStatus,
): JSONObject {
  return {
    retentionInDays: status.retentionInDays,
    rulesPastRetention: status.rulesPastRetention
      ? status.rulesPastRetention.map(
          (rule: DetectionRulePastRetention): JSONObject => {
            return {
              id: rule.id,
              name: rule.name,
              type: rule.type,
              lookbackInSeconds: rule.lookbackInSeconds,
            };
          },
        )
      : null,
    hasMoreRulesPastRetention: status.hasMoreRulesPastRetention,
  };
}

function readWholePositive(value: JSONValue | undefined): number | null {
  const number: number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function readRule(value: JSONValue): DetectionRulePastRetention | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const rule: JSONObject = value as JSONObject;
  const lookbackInSeconds: number | null = readWholePositive(
    rule["lookbackInSeconds"],
  );

  if (
    typeof rule["id"] !== "string" ||
    !rule["id"] ||
    lookbackInSeconds === null ||
    !isDetectionRuleType(rule["type"])
  ) {
    return null;
  }

  return {
    id: rule["id"],
    name: typeof rule["name"] === "string" ? rule["name"] : "",
    type: rule["type"],
    lookbackInSeconds,
  };
}

// The answer as the API sends it, read defensively: null when it is not one.
export function parseSecurityEventRetentionStatus(
  json: JSONObject | null | undefined,
): SecurityEventRetentionStatus | null {
  if (!json || typeof json !== "object") {
    return null;
  }

  const retentionInDays: number | null = readWholePositive(
    json["retentionInDays"],
  );

  if (retentionInDays === null) {
    return null;
  }

  const rules: JSONValue | undefined = json["rulesPastRetention"];

  return {
    retentionInDays,
    rulesPastRetention: Array.isArray(rules)
      ? (rules as JSONArray)
          .map(readRule)
          .filter(
            (
              rule: DetectionRulePastRetention | null,
            ): rule is DetectionRulePastRetention => {
              return rule !== null;
            },
          )
      : null,
    hasMoreRulesPastRetention: json["hasMoreRulesPastRetention"] === true,
  };
}
