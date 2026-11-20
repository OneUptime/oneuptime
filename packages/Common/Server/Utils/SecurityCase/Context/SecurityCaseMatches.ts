import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Select from "../../../Types/Database/Select";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS,
  SecurityCaseEventSnapshot,
  buildSecurityCaseEventSnapshot,
} from "../../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SECURITY_CASE_MATCHES_MAX_DETECTIONS,
  SECURITY_CASE_MATCHES_MAX_EVENTS,
  SECURITY_CASE_MATCHES_MAX_WINDOW_IN_HOURS,
  SecurityCaseMatchBasis,
  SecurityCaseMatchRuleJson,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
  SecurityCaseMatchesSource,
} from "../../../../Types/SecurityCase/SecurityCaseMatches";
import {
  SecurityEntity,
  readSecurityEntities,
} from "../../../../Types/SecurityCase/SecurityEntity";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { getCutShortDetectionTextStart } from "../../../../Types/SecurityCase/SecurityDetectionText";
import {
  SecurityDetectionMatchedEvent,
  SecurityDetectionMatchedEvents,
  isSecurityDetectionMatchedEventPastRetention,
  readSecurityDetectionMatchedEvents,
} from "../../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import {
  DetectionRuleResponseStep,
  readDetectionRuleResponseSteps,
} from "../../../../Types/SecurityEvent/DetectionRuleResponseSteps";
import { getDetectionRuleLibraryResponseStepsForYaml } from "../../../../Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import { getDetectionDefinitionRules } from "../../../../Types/SecurityEvent/RealTimeDetection";
import {
  DetectionRuleDefinition,
  SigmaCorrelation,
  SigmaCorrelationStep,
} from "../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import { THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES } from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import { getObservableSearchValues } from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import {
  SecurityCaseMatchWindow,
  getDetectionMatchWindow,
  getSigmaRuleLookFor,
  readSigmaRuleGuidance,
} from "../../../../Utils/SecurityCase/SecurityCaseMatchRules";
import DetectionRuleService from "../../../Services/DetectionRuleService";
import SecurityDetectionService from "../../../Services/SecurityDetectionService";
import SecurityEventService, {
  SECURITY_CONNECTION_READ_TIME_LIMIT,
  SECURITY_FINDING_CLASS_UIDS,
} from "../../../Services/SecurityEventService";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import logger from "../../Logger";
import { buildCorrelationEventsRead } from "../../SecurityEvent/Correlation/CorrelationQueries";
import { getCorrelationMatchedEventsStart } from "../../SecurityEvent/Correlation/CorrelationRuleMatcher";
import DetectionRuleRetrohunt from "../../SecurityEvent/DetectionRuleRetrohunt";
import SigmaClickhouseCompiler, {
  buildSigmaFieldExpression,
} from "../../SecurityEvent/Sigma/SigmaClickhouseCompiler";
import { assertDetectionReadFits } from "../../SecurityEvent/Watchlists/SecurityWatchlistMatch";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import TelemetryReadAccess from "../../Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../../Telemetry/TelemetryReadScope";
import {
  SecurityCaseContextScope,
  SecurityCaseSourceTracker,
  readSecurityCaseContextScope,
} from "./SecurityCaseContextScope";

/*
 * WHY A CASE WAS OPENED, AND WHAT MATCHED
 * (Types/SecurityCase/SecurityCaseMatches.ts says what it holds).
 *
 * The detection that opened the case and the latest others, each with the
 * events it matched. A detection keeps them when it fires
 * (SecurityDetection.matchedEvents, #9619): those are listed first, exactly
 * as they were matched - after its rule is edited, and after the events
 * pass their retention - each only when the reader's role can read its
 * source. A detection that kept none (it fired before OneUptime kept them,
 * or its source keeps none) has them read again from the events table with
 * the reader's own permissions:
 *
 *   a rule's        its condition - compiled as its runs compile it, with
 *                   the watchlists it names - for the detection's group,
 *                   from a window before it first fired to when it last
 *                   did: exactly what it counted (a correlation: its steps'
 *                   events, for its group as its own group-by groups them,
 *                   from where the events its first run matched start -
 *                   the window it keeps them from as it fires, #9939);
 *   a feed's        the events carrying the indicator;
 *   a product's     the event its alert was recorded as;
 *   anything else   the events naming what it is about, around its firings.
 *
 * A source the reader's role cannot read is said to be (unreadableSources),
 * one that fails is said to have (failedSources), and a detection whose
 * rule no longer reads falls back to the events naming what it is about.
 * Every read is bounded in time and rows.
 */

// The detection rule's columns the answer reads.
const RULE_SELECT: Select<DetectionRule> = {
  _id: true,
  name: true,
  description: true,
  sigmaRuleYaml: true,
  isEnabled: true,
  isRealTime: true,
  groupByField: true,
  distinctCountField: true,
  matchCountThreshold: true,
  evaluationIntervalInMinutes: true,
  responseSteps: true,
};

const DETECTION_SELECT: Select<SecurityDetection> = {
  _id: true,
  title: true,
  severity: true,
  source: true,
  ruleName: true,
  groupValue: true,
  entities: true,
  eventCount: true,
  fireCount: true,
  firstSeenAt: true,
  lastSeenAt: true,
  sampleMessage: true,
  eventUid: true,
  detectionRuleId: true,
  threatIntelFeedId: true,
  securityEventConnectionId: true,
  createdAt: true,
};

// How the events of one detection are looked up.
export interface MatchLookup {
  basis: SecurityCaseMatchBasis;
  // What the events must match, beside the project, the window and the reader's resources.
  condition: Statement;
  window: SecurityCaseMatchWindow;
  // Leave the Detection Findings out: they are the case's detections, not its events.
  excludeFindings: boolean;
}

function iso(value: Date | string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// A single rule's counting, as its runs count (DetectionRuleEvaluator).
export function getRuleWindowInMinutes(
  rule: Pick<DetectionRule, "evaluationIntervalInMinutes">,
): number {
  return Math.max(1, Math.trunc(rule.evaluationIntervalInMinutes || 1));
}

/*
 * The rule as the case explains it: how it counts, its own guidance and
 * what its condition looks for. `definition` is null for a rule whose YAML
 * no longer reads.
 */
export function toMatchRule(data: {
  rule: DetectionRule;
  definition: DetectionRuleDefinition | null;
}): SecurityCaseMatchRuleJson {
  const { rule, definition } = data;
  const rules: Array<SigmaRule> = definition
    ? getDetectionDefinitionRules(definition)
    : [];
  const guidance: ReturnType<typeof readSigmaRuleGuidance> =
    readSigmaRuleGuidance(rule.sigmaRuleYaml || "");

  return {
    id: rule.id?.toString() || rule._id?.toString() || "",
    name: rule.name || "",
    description:
      rule.description ||
      (definition?.kind === "single" ? definition.rule.description : "") ||
      "",
    isEnabled: rule.isEnabled !== false,
    isRealTime: rule.isRealTime === true,
    isCorrelation: definition?.kind === "correlation",
    threshold: Math.max(1, Math.trunc(rule.matchCountThreshold || 1)),
    groupByField: (rule.groupByField || "").trim(),
    distinctCountField: (rule.distinctCountField || "").trim(),
    windowInMinutes: getRuleWindowInMinutes(rule),
    sigmaRuleYaml: rule.sigmaRuleYaml || "",
    falsePositives: guidance.falsePositives,
    references: guidance.references,
    lookFor: getSigmaRuleLookFor(rules),
    responseSteps: getRuleResponseSteps(rule),
  };
}

/*
 * A rule's response steps (#9621): its own, once it has any written - an
 * empty list when its author took them all out - else, for a Rule Library
 * rule added before rules had steps, its library entry's.
 */
export function getRuleResponseSteps(
  rule: Pick<DetectionRule, "responseSteps" | "sigmaRuleYaml">,
): Array<DetectionRuleResponseStep> {
  if (Array.isArray(rule.responseSteps)) {
    return readDetectionRuleResponseSteps(rule.responseSteps);
  }

  return getDetectionRuleLibraryResponseStepsForYaml(rule.sigmaRuleYaml);
}

/*
 * Whether the reader may read a kept event: one from a source their role
 * reads (TelemetryReadAccess's filter, as the events table is read with).
 * An event that names no source is read only by a role that reads every
 * source.
 */
export function isKeptEventReadable(data: {
  event: Pick<SecurityDetectionMatchedEvent, "sourceId">;
  serviceFilter: TelemetryServiceFilter;
}): boolean {
  const sourceId: string = data.event.sourceId
    ? TelemetryReadScopeUtil.normalizeId(data.event.sourceId)
    : "";
  const isSource: (id: ObjectID) => boolean = (id: ObjectID): boolean => {
    return TelemetryReadScopeUtil.normalizeId(id) === sourceId;
  };

  if (
    sourceId &&
    (data.serviceFilter.excludedServiceIds || []).some(isSource)
  ) {
    return false;
  }

  if (
    data.serviceFilter.serviceIds &&
    data.serviceFilter.serviceIds.length > 0
  ) {
    return Boolean(sourceId) && data.serviceFilter.serviceIds.some(isSource);
  }

  return true;
}

/*
 * What a detection kept, as the reader may see it: the events of the
 * sources their role reads (and how many others it kept), and how many of
 * those are past the events table's retention.
 */
export function getKeptEventsForReader(data: {
  kept: SecurityDetectionMatchedEvents;
  serviceFilter: TelemetryServiceFilter;
  now: Date;
}): {
  events: Array<SecurityDetectionMatchedEvent>;
  hiddenEventCount: number;
  pastRetentionCount: number;
} {
  const events: Array<SecurityDetectionMatchedEvent> = data.kept.events.filter(
    (event: SecurityDetectionMatchedEvent): boolean => {
      return isKeptEventReadable({ event, serviceFilter: data.serviceFilter });
    },
  );

  return {
    events,
    hiddenEventCount: data.kept.events.length - events.length,
    pastRetentionCount: events.filter(
      (event: SecurityDetectionMatchedEvent): boolean => {
        return isSecurityDetectionMatchedEventPastRetention({
          event,
          now: data.now,
        });
      },
    ).length,
  };
}

/*
 * The values a correlation's group holds - "203.0.113.7 / ana@acme.example"
 * for one grouped by two fields - each looked up as the events store it.
 */
export function getGroupValues(groupValue: string | undefined): Array<string> {
  return (groupValue || "")
    .split(" / ")
    .map((value: string): string => {
      return value.trim();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
}

function observablesCondition(values: Array<string>): Statement {
  return SQL`hasAny(observables, ${{
    type: TableColumnType.ArrayText,
    value: getObservableSearchValues(values),
  }})`;
}

/*
 * A rule's condition for one detection: the rule's own, compiled as its
 * runs compile it, and - for a rule that groups - only the detection's
 * group.
 *
 * A correlation's (#9939) is what it keeps its events by as it fires
 * (buildCorrelationEventsRead, #9795): any of its steps' events - what its
 * reads count - whose group is the detection's, taken as its own reads take
 * each group-by field (an alias by the step the event matched) and joined
 * as the case names the group ("alice / 203.0.113.7"). It used to be the
 * events of the steps' rules carrying one of the group's values among their
 * observables, which listed nothing for a correlation grouped by a field no
 * observable holds (an HTTP route), and, for one grouped by an address,
 * every event naming the address anywhere - as the source of another
 * group's request, or its target. Throws, as the reads do, for a step that
 * is not resolved to a rule.
 *
 * A group value longer than a detection keeps was recorded cut short
 * (SecurityCaseIngest): its group is the one whose value starts as the
 * recorded one does, where the value itself matched no event at all.
 */
export function buildRuleCondition(data: {
  rule: Pick<DetectionRule, "groupByField">;
  definition: DetectionRuleDefinition;
  groupValue: string;
}): { condition: Statement; basis: SecurityCaseMatchBasis } | null {
  const { definition } = data;
  const cutShortStart: string | null = getCutShortDetectionTextStart(
    data.groupValue,
  );

  // The group a value cut short as it was recorded names: every value it starts.
  const appendStartsWith: (
    condition: Statement,
    expression: Statement,
    start: string,
  ) => void = (
    condition: Statement,
    expression: Statement,
    start: string,
  ): void => {
    condition.append(" AND startsWith(");
    condition.append(expression);
    condition.append(SQL`, ${{ type: TableColumnType.Text, value: start }})`);
  };

  if (definition.kind === "single") {
    const condition: Statement = SQL`(`;
    condition.append(SigmaClickhouseCompiler.compile(definition.rule));
    condition.append(")");

    const groupByField: string = (data.rule.groupByField || "").trim();

    if (groupByField && cutShortStart) {
      appendStartsWith(
        condition,
        buildSigmaFieldExpression(groupByField),
        cutShortStart,
      );
    } else if (groupByField && data.groupValue) {
      condition.append(" AND ");
      condition.append(buildSigmaFieldExpression(groupByField));
      condition.append(
        SQL` = ${{ type: TableColumnType.Text, value: data.groupValue }}`,
      );
    }

    return { condition, basis: SecurityCaseMatchBasis.RuleCondition };
  }

  if (definition.steps.length === 0) {
    return null;
  }

  const read: ReturnType<typeof buildCorrelationEventsRead> =
    buildCorrelationEventsRead({
      correlation: definition.correlation,
      steps: definition.steps,
    });

  const condition: Statement = SQL`(`;
  condition.append(read.condition);
  condition.append(")");

  // A correlation that does not group keeps its events as one group.
  if (read.groupExpression && cutShortStart) {
    appendStartsWith(condition, read.groupExpression, cutShortStart);
  } else if (read.groupExpression && data.groupValue) {
    condition.append(
      SQL` AND has(${{
        type: TableColumnType.ArrayText,
        value: [data.groupValue],
      }}, `,
    );
    condition.append(read.groupExpression);
    condition.append(")");
  }

  return { condition, basis: SecurityCaseMatchBasis.CorrelationSteps };
}

function readTime(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

/*
 * The time a correlation's events are read over (#9939): the window it
 * keeps them from as it fires (getCorrelationMatchedEventsStart), from its
 * first run - the run whose interval ends as it first fired - to just after
 * it last fired: a count's rolling window, from the step a timespan before
 * that run; a sequence's timespan, and an event_count step's own, before
 * it; a new value's run itself - what came before it is the history its
 * values are new against, not what it matched. With a minute of slack
 * either side, as a rule's window has (getDetectionMatchWindow), at most
 * SECURITY_CASE_MATCHES_MAX_WINDOW_IN_HOURS from its start but never short
 * of its first firing, and never past now. Null for a detection with no
 * time at all.
 *
 * It used to look back the correlation's timespan and an interval: a new
 * value's day to thirty days of history, the day after its start cut short
 * well before it fired - so the case listed the history's events, never
 * the run's.
 */
export function getCorrelationMatchWindow(data: {
  correlation: SigmaCorrelation;
  steps: Array<SigmaCorrelationStep>;
  rule: Pick<DetectionRule, "evaluationIntervalInMinutes">;
  firstSeenAt: Date | string | null | undefined;
  lastSeenAt: Date | string | null | undefined;
  now: Date;
}): SecurityCaseMatchWindow | null {
  const first: number | null = readTime(data.firstSeenAt);
  const last: number | null = readTime(data.lastSeenAt) ?? first;

  if (first === null || last === null) {
    return null;
  }

  const minute: number = 60 * 1000;
  const firstFiring: number = Math.min(first, last);
  const lastFiring: number = Math.max(first, last);
  // The run that first fired: the rule's interval, ending as it fired.
  const runStart: Date = new Date(
    firstFiring - getRuleWindowInMinutes(data.rule) * minute,
  );
  const start: number =
    getCorrelationMatchedEventsStart({
      correlation: data.correlation,
      steps: data.steps,
      startTime: runStart,
    }).getTime() - minute;
  const end: number = Math.min(
    lastFiring + minute,
    Math.max(
      start + SECURITY_CASE_MATCHES_MAX_WINDOW_IN_HOURS * 60 * minute,
      firstFiring + minute,
    ),
    data.now.getTime(),
  );

  return {
    start: new Date(start),
    end: new Date(Math.max(start, end)),
  };
}

/*
 * How a detection's events are found when its rule cannot say: the
 * indicator a feed listed, the event a product's alert was recorded as, or
 * the values it is about. Null when it names nothing to look up.
 */
export function buildFallbackLookup(data: {
  detection: Pick<
    SecurityDetection,
    | "source"
    | "groupValue"
    | "entities"
    | "eventUid"
    | "firstSeenAt"
    | "lastSeenAt"
  >;
  now: Date;
}): MatchLookup | null {
  const { detection, now } = data;
  const groupValue: string = (detection.groupValue || "").trim();

  if (detection.source === SecurityDetectionSource.ThreatIntel && groupValue) {
    const window: SecurityCaseMatchWindow | null = getDetectionMatchWindow({
      firstSeenAt: detection.firstSeenAt,
      lastSeenAt: detection.lastSeenAt,
      lookBackInMinutes: THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES,
      now,
    });

    return window
      ? {
          basis: SecurityCaseMatchBasis.Indicator,
          condition: observablesCondition([groupValue]),
          window,
          excludeFindings: true,
        }
      : null;
  }

  const eventUid: string = (detection.eventUid || "").trim();

  if (
    detection.source === SecurityDetectionSource.ConnectedProduct &&
    eventUid
  ) {
    /*
     * A product's alert keeps the time the product gives it, which can be
     * long before OneUptime read it: the day before its first firing.
     */
    const window: SecurityCaseMatchWindow | null = getDetectionMatchWindow({
      firstSeenAt: detection.firstSeenAt,
      lastSeenAt: detection.lastSeenAt,
      lookBackInMinutes: 24 * 60 - 1,
      now,
    });

    return window
      ? {
          basis: SecurityCaseMatchBasis.RecordedEvent,
          condition: SQL`eventUid = ${{
            type: TableColumnType.Text,
            value: eventUid,
          }}`,
          window,
          excludeFindings: false,
        }
      : null;
  }

  const values: Array<string> = groupValue
    ? getGroupValues(groupValue)
    : readSecurityEntities(detection.entities).map(
        (entity: SecurityEntity): string => {
          return entity.value;
        },
      );
  const window: SecurityCaseMatchWindow | null = getDetectionMatchWindow({
    firstSeenAt: detection.firstSeenAt,
    lastSeenAt: detection.lastSeenAt,
    now,
  });

  if (values.length === 0 || !window) {
    return null;
  }

  return {
    basis: SecurityCaseMatchBasis.NamedEntities,
    condition: observablesCondition(values),
    window,
    excludeFindings: true,
  };
}

/*
 * The WHERE of a detection's events: the project, the window, what the
 * lookup must match, and only the resources the reader may read.
 */
export function buildMatchWhere(data: {
  projectId: ObjectID;
  lookup: MatchLookup;
  serviceFilter: TelemetryServiceFilter;
}): Statement {
  const statement: Statement = SQL`projectId = ${{
    type: TableColumnType.ObjectID,
    value: data.projectId,
  }} AND time >= ${{
    type: TableColumnType.DateTime64,
    value: data.lookup.window.start,
  }} AND time <= ${{
    type: TableColumnType.DateTime64,
    value: data.lookup.window.end,
  }} AND (`;

  statement.append(data.lookup.condition);
  statement.append(")");

  if (data.lookup.excludeFindings) {
    // The code's own numbers, appended as text (SQL`` binds a string as an identifier).
    statement.append(
      ` AND classUid NOT IN (${SECURITY_FINDING_CLASS_UIDS.map(
        (classUid: number): string => {
          return String(Math.trunc(classUid));
        },
      ).join(", ")})`,
    );
  }

  TelemetryReadScopeUtil.appendServiceFilter(statement, data.serviceFilter);

  return statement;
}

// The events themselves, oldest first: one more than listed, to tell there are more.
export function buildMatchedEventsStatement(data: {
  tableName: string;
  where: Statement;
  limit: number;
}): Statement {
  const statement: Statement = new Statement();

  statement.append(
    `SELECT ${SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS.join(", ")} FROM ${data.tableName} WHERE `,
  );
  statement.append(data.where);
  statement.append(
    SQL` ORDER BY time ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

  return statement;
}

// How many matched, by how far their requests got.
export function buildMatchedOutcomesStatement(data: {
  tableName: string;
  where: Statement;
}): Statement {
  const statement: Statement = new Statement();

  statement.append(
    `SELECT requestOutcome, count() AS matched FROM ${data.tableName} WHERE `,
  );
  statement.append(data.where);
  statement.append(" GROUP BY requestOutcome");
  statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

  return statement;
}

// The tally of the outcomes statement's rows, and how many in all.
export function readOutcomeRows(rows: Array<JSONObject>): {
  matchedEventCount: number;
  outcomes: Record<string, number>;
} {
  const outcomes: Record<string, number> = {};
  let matchedEventCount: number = 0;

  for (const row of rows) {
    const count: number = Math.max(0, Math.trunc(Number(row["matched"]) || 0));
    const outcome: string =
      typeof row["requestOutcome"] === "string" ? row["requestOutcome"] : "";

    if (count > 0) {
      outcomes[outcome] = (outcomes[outcome] || 0) + count;
      matchedEventCount += count;
    }
  }

  return { matchedEventCount, outcomes };
}

/*
 * The detections explained: the one that opened the case - the first to
 * fire - then the latest others, each once.
 */
export function pickDetectionsToExplain(data: {
  opening: Array<SecurityDetection>;
  latest: Array<SecurityDetection>;
  max: number;
}): Array<SecurityDetection> {
  const picked: Array<SecurityDetection> = [];
  const seen: Set<string> = new Set<string>();

  for (const detection of [...data.opening, ...data.latest]) {
    const id: string = detection.id?.toString() || detection._id || "";

    if (!id || seen.has(id) || picked.length >= data.max) {
      continue;
    }

    seen.add(id);
    picked.push(detection);
  }

  return picked;
}

async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  const result: Awaited<ReturnType<typeof SecurityEventService.executeQuery>> =
    await SecurityEventService.executeQuery(statement);
  const response: { data?: Array<JSONObject> } = await result.json<{
    data?: Array<JSONObject>;
  }>();

  return response.data || [];
}

export default class SecurityCaseMatches {
  @CaptureSpan()
  public static async build(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<SecurityCaseMatchesJson | null> {
    const scope: SecurityCaseContextScope | null =
      await readSecurityCaseContextScope(data);

    if (!scope) {
      return null;
    }

    const now: Date = data.now || new Date();
    const tracker: SecurityCaseSourceTracker<SecurityCaseMatchesSource> =
      new SecurityCaseSourceTracker<SecurityCaseMatchesSource>(
        "Security case matches",
      );

    const detections: Array<SecurityDetection> | null = await tracker.read(
      SecurityCaseMatchesSource.Detections,
      () => {
        return this.readDetections(data);
      },
    );

    const detectionCount: number = Math.max(
      detections?.length || 0,
      Math.trunc(Number(scope.securityCase.detectionCount) || 0),
    );

    if (!detections || detections.length === 0) {
      return {
        detections: [],
        detectionCount,
        unreadableSources: tracker.getUnreadable(),
        failedSources: tracker.getFailed(),
      };
    }

    const ruleIds: Array<string> = Array.from(
      new Set(
        detections
          .map((detection: SecurityDetection): string => {
            return detection.detectionRuleId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );

    const [rules, serviceFilter]: [
      Array<DetectionRule> | null,
      TelemetryServiceFilter | null,
    ] = await Promise.all([
      ruleIds.length > 0
        ? tracker.read(SecurityCaseMatchesSource.Rules, () => {
            return DetectionRuleService.findBy({
              query: {
                projectId: data.projectId,
                _id: new Includes(ruleIds),
              },
              select: RULE_SELECT,
              limit: ruleIds.length,
              skip: 0,
              props: data.props,
            });
          })
        : Promise.resolve([] as Array<DetectionRule>),
      tracker.read(SecurityCaseMatchesSource.Events, () => {
        // Whose events the reader may read; a refusal is the source's to say.
        return TelemetryReadAccess.getServiceFilter({
          modelType: SecurityEvent,
          props: data.props,
        });
      }),
    ]);

    // What each detection kept when it fired, read as OneUptime: shown only as the reader may read it.
    const keptById: Map<string, SecurityDetectionMatchedEvents> =
      await this.readKeptEvents(detections);

    const rulesById: Map<string, DetectionRule> = new Map();

    for (const rule of rules || []) {
      const id: string = rule.id?.toString() || rule._id?.toString() || "";

      if (id) {
        rulesById.set(id, rule);
      }
    }

    const openingId: string =
      detections[0]?.id?.toString() || detections[0]?._id || "";

    const explained: Array<SecurityCaseMatchedDetectionJson> =
      await Promise.all(
        detections.map(
          (
            detection: SecurityDetection,
          ): Promise<SecurityCaseMatchedDetectionJson> => {
            return this.explain({
              projectId: data.projectId,
              detection,
              isOpening:
                (detection.id?.toString() || detection._id || "") === openingId,
              rule: detection.detectionRuleId
                ? rulesById.get(detection.detectionRuleId.toString()) || null
                : null,
              kept:
                keptById.get(
                  detection.id?.toString() || detection._id?.toString() || "",
                ) || null,
              serviceFilter,
              tracker,
              now,
            });
          },
        ),
      );

    return {
      detections: explained,
      detectionCount,
      unreadableSources: tracker.getUnreadable(),
      failedSources: tracker.getFailed(),
    };
  }

  /*
   * The detection that opened the case, and the latest others: two bounded
   * reads, with the reader's own permissions.
   */
  private static async readDetections(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<SecurityDetection>> {
    const query: {
      projectId: ObjectID;
      securityCaseId: ObjectID;
    } = {
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
    };

    const [opening, latest]: [
      Array<SecurityDetection>,
      Array<SecurityDetection>,
    ] = await Promise.all([
      SecurityDetectionService.findBy({
        query,
        select: DETECTION_SELECT,
        sort: { firstSeenAt: SortOrder.Ascending },
        limit: 1,
        skip: 0,
        props: data.props,
      }),
      SecurityDetectionService.findBy({
        query,
        select: DETECTION_SELECT,
        sort: { lastSeenAt: SortOrder.Descending },
        limit: SECURITY_CASE_MATCHES_MAX_DETECTIONS,
        skip: 0,
        props: data.props,
      }),
    ]);

    return pickDetectionsToExplain({
      opening,
      latest,
      max: SECURITY_CASE_MATCHES_MAX_DETECTIONS,
    });
  }

  // One detection, with its rule and the events it matched.
  private static async explain(data: {
    projectId: ObjectID;
    detection: SecurityDetection;
    isOpening: boolean;
    rule: DetectionRule | null;
    // What it kept when it fired, if it kept anything.
    kept: SecurityDetectionMatchedEvents | null;
    serviceFilter: TelemetryServiceFilter | null;
    tracker: SecurityCaseSourceTracker<SecurityCaseMatchesSource>;
    now: Date;
  }): Promise<SecurityCaseMatchedDetectionJson> {
    const { detection, rule } = data;
    const groupValue: string = (detection.groupValue || "").trim();

    let matchRule: SecurityCaseMatchRuleJson | null = null;
    let lookup: MatchLookup | null = null;

    if (rule) {
      const definition: DetectionRuleDefinition | null =
        await this.readDefinition({ projectId: data.projectId, rule });

      matchRule = toMatchRule({ rule, definition });

      const built: ReturnType<typeof buildRuleCondition> = definition
        ? this.tryBuildRuleCondition({ rule, definition, groupValue })
        : null;
      const window: SecurityCaseMatchWindow | null = !definition
        ? null
        : definition.kind === "correlation"
          ? getCorrelationMatchWindow({
              correlation: definition.correlation,
              steps: definition.steps,
              rule,
              firstSeenAt: detection.firstSeenAt,
              lastSeenAt: detection.lastSeenAt,
              now: data.now,
            })
          : getDetectionMatchWindow({
              firstSeenAt: detection.firstSeenAt,
              lastSeenAt: detection.lastSeenAt,
              lookBackInMinutes: getRuleWindowInMinutes(rule),
              now: data.now,
            });

      if (built && window) {
        lookup = {
          basis: built.basis,
          condition: built.condition,
          window,
          excludeFindings: false,
        };
      }
    }

    if (!lookup) {
      lookup = buildFallbackLookup({ detection, now: data.now });
    }

    const answer: SecurityCaseMatchedDetectionJson = {
      id: detection.id?.toString() || detection._id || "",
      source: detection.source || "",
      title: detection.title || "",
      severity: detection.severity || "",
      groupValue,
      ruleName: detection.ruleName || "",
      eventCount: Math.max(0, Math.trunc(detection.eventCount || 0)),
      fireCount: Math.max(1, Math.trunc(detection.fireCount || 1)),
      firstSeenAt: iso(detection.firstSeenAt),
      lastSeenAt: iso(detection.lastSeenAt),
      sampleMessage: detection.sampleMessage || "",
      isOpening: data.isOpening,
      rule: matchRule,
      threatIntelFeedId: detection.threatIntelFeedId?.toString() || "",
      securityEventConnectionId:
        detection.securityEventConnectionId?.toString() || "",
      basis: lookup?.basis || SecurityCaseMatchBasis.NamedEntities,
      windowStart: null,
      windowEnd: null,
      events: [],
      isKept: false,
      keptPastRetentionCount: 0,
      hiddenEventCount: 0,
      matchedEventCount: null,
      outcomes: {},
    };

    /*
     * What it kept when it fired: exactly what it matched then, read from
     * no table now. Shown as the reader may read each event's source; a
     * reader who may read no security events sees none of them, as the
     * events table would show them none.
     */
    if (data.kept && data.kept.events.length > 0) {
      answer.isKept = true;

      if (lookup) {
        answer.windowStart = lookup.window.start.toISOString();
        answer.windowEnd = lookup.window.end.toISOString();
      }

      answer.outcomes = { ...data.kept.outcomes };
      answer.matchedEventCount = Math.max(
        answer.eventCount,
        data.kept.events.length,
      );

      if (!data.serviceFilter) {
        answer.hiddenEventCount = data.kept.events.length;
        return answer;
      }

      const readable: ReturnType<typeof getKeptEventsForReader> =
        getKeptEventsForReader({
          kept: data.kept,
          serviceFilter: data.serviceFilter,
          now: data.now,
        });

      answer.events = readable.events;
      answer.hiddenEventCount = readable.hiddenEventCount;
      answer.keptPastRetentionCount = readable.pastRetentionCount;

      return answer;
    }

    if (!lookup || !data.serviceFilter) {
      return answer;
    }

    answer.windowStart = lookup.window.start.toISOString();
    answer.windowEnd = lookup.window.end.toISOString();

    const read: {
      events: Array<SecurityCaseEventSnapshot>;
      matchedEventCount: number;
      outcomes: Record<string, number>;
    } | null = await data.tracker.read(SecurityCaseMatchesSource.Events, () => {
      return this.readEvents({
        projectId: data.projectId,
        lookup: lookup!,
        serviceFilter: data.serviceFilter!,
      });
    });

    if (read) {
      answer.events = read.events;
      answer.matchedEventCount = read.matchedEventCount;
      answer.outcomes = read.outcomes;
    }

    return answer;
  }

  /*
   * What each detection the reader may read kept when it fired, by its id:
   * read as OneUptime, since no role reads the column itself, and handed
   * on only as the reader may read each event (getKeptEventsForReader). A
   * read that fails keeps nothing: the events are read again, as before.
   */
  private static async readKeptEvents(
    detections: Array<SecurityDetection>,
  ): Promise<Map<string, SecurityDetectionMatchedEvents>> {
    const kept: Map<string, SecurityDetectionMatchedEvents> = new Map();
    const ids: Array<string> = detections
      .map((detection: SecurityDetection): string => {
        return detection.id?.toString() || detection._id?.toString() || "";
      })
      .filter(Boolean);

    if (ids.length === 0) {
      return kept;
    }

    try {
      const rows: Array<SecurityDetection> =
        await SecurityDetectionService.findBy({
          query: { _id: new Includes(ids) },
          select: { _id: true, matchedEvents: true },
          limit: ids.length,
          skip: 0,
          props: { isRoot: true },
        });

      for (const row of rows) {
        const id: string = row.id?.toString() || row._id?.toString() || "";
        const events: SecurityDetectionMatchedEvents | null =
          readSecurityDetectionMatchedEvents(row.matchedEvents);

        if (id && events) {
          kept.set(id, events);
        }
      }
    } catch (error) {
      logger.error(
        `Security case matches: what the detections kept could not be read: ${error}`,
      );
    }

    return kept;
  }

  /*
   * The rule's YAML, parsed as its runs and its retrohunt parse it: a
   * correlation's rules resolved, the watchlists it names bound. Null for
   * one that no longer reads - the case still says what the detection is
   * about.
   */
  private static async readDefinition(data: {
    projectId: ObjectID;
    rule: DetectionRule;
  }): Promise<DetectionRuleDefinition | null> {
    try {
      return await DetectionRuleRetrohunt.loadDefinition({
        projectId: data.projectId,
        rule: {
          id: data.rule.id || undefined,
          sigmaRuleYaml: data.rule.sigmaRuleYaml || "",
        },
      });
    } catch (error) {
      logger.debug(
        `Security case matches: rule ${data.rule.id?.toString()} did not read: ${error}`,
      );
      return null;
    }
  }

  private static tryBuildRuleCondition(data: {
    rule: DetectionRule;
    definition: DetectionRuleDefinition;
    groupValue: string;
  }): ReturnType<typeof buildRuleCondition> {
    try {
      const built: ReturnType<typeof buildRuleCondition> =
        buildRuleCondition(data);

      if (built) {
        // A rule's watchlists travel with the read, as they do in its runs.
        assertDetectionReadFits(built.condition);
      }

      return built;
    } catch (error) {
      logger.debug(
        `Security case matches: rule ${data.rule.id?.toString()} did not compile: ${error}`,
      );
      return null;
    }
  }

  private static async readEvents(data: {
    projectId: ObjectID;
    lookup: MatchLookup;
    serviceFilter: TelemetryServiceFilter;
  }): Promise<{
    events: Array<SecurityCaseEventSnapshot>;
    matchedEventCount: number;
    outcomes: Record<string, number>;
  }> {
    // The table by its own name, as the case's Story reads it.
    const tableName: string = AnalyticsTableName.SecurityEvent;

    const where: () => Statement = (): Statement => {
      return buildMatchWhere({
        projectId: data.projectId,
        lookup: data.lookup,
        serviceFilter: data.serviceFilter,
      });
    };

    const [eventRows, outcomeRows]: [Array<JSONObject>, Array<JSONObject>] =
      await Promise.all([
        readRows(
          buildMatchedEventsStatement({
            tableName,
            where: where(),
            limit: SECURITY_CASE_MATCHES_MAX_EVENTS,
          }),
        ),
        readRows(buildMatchedOutcomesStatement({ tableName, where: where() })),
      ]);

    const tally: ReturnType<typeof readOutcomeRows> =
      readOutcomeRows(outcomeRows);

    const events: Array<SecurityCaseEventSnapshot> = eventRows
      .slice(0, SECURITY_CASE_MATCHES_MAX_EVENTS)
      .map((row: JSONObject): SecurityCaseEventSnapshot => {
        return buildSecurityCaseEventSnapshot({ event: row });
      })
      .filter((snapshot: SecurityCaseEventSnapshot): boolean => {
        return Boolean(snapshot.eventUid || snapshot.time);
      });

    return {
      events,
      // Never fewer than were listed: the count reads the same window.
      matchedEventCount: Math.max(tally.matchedEventCount, events.length),
      outcomes: tally.outcomes,
    };
  }
}
