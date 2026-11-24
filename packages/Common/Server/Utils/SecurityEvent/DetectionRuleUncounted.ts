import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DETECTION_RULE_UNCOUNTED_PERIOD_IN_HOURS,
  DetectionRuleUncounted,
  DetectionRulesUncounted,
  MAX_DETECTION_RULES_UNCOUNTED_PER_ASK,
} from "../../../Types/SecurityEvent/DetectionRuleUncounted";
import { doesDetectionRuleLeaveOutEventsWithNoValue } from "../../../Types/SecurityEvent/DetectionUncountedEvents";
import { DetectionRuleDefinition } from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import DetectionRuleService from "../../Services/DetectionRuleService";
import SecurityEventService from "../../Services/SecurityEventService";
import QueryHelper from "../../Types/Database/QueryHelper";
import {
  INTERACTIVE_READ_TIME_LIMIT,
  getQuerySettings,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { buildHoldsSharedScrubPlaceholderSql } from "../Telemetry/ScrubPlaceholderSql";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../Telemetry/TelemetryReadScope";
import DetectionRuleExceptions, {
  LoadedDetectionRuleException,
  buildDetectionRuleExceptionsMatch,
} from "./DetectionRuleExceptions";
import {
  HiddenValueMarker,
  getHiddenValueMarker,
} from "./DetectionRuleRetrohunt";
import SigmaClickhouseCompiler, {
  buildSigmaFieldHasValue,
} from "./Sigma/SigmaClickhouseCompiler";
import SecurityWatchlists, {
  SecurityWatchlistReader,
} from "./Watchlists/SecurityWatchlists";
import {
  MAX_DETECTION_READ_PARAMETERS,
  assertDetectionReadFits,
} from "./Watchlists/SecurityWatchlistMatch";

/*
 * WHAT A DETECTION RULE COULD NOT COUNT IN THE LAST DAY, FOR ITS ROW ON
 * DETECTION RULES (#10547, Types/SecurityEvent/DetectionRuleUncounted).
 *
 * A rule that counts per value leaves out the matching events that have no
 * value for its field (#10415). Run on Past Events counts them for the rule
 * it is opened on (DetectionRuleRetrohunt.buildUncountedRetrohuntStatement);
 * this counts them for every rule a page of Detection Rules lists, so a
 * rule that cannot count is never quiet where people look at it.
 *
 * The cost is held to what a page needs:
 *
 *   - only the rules the page names, at most a page of them, and of those
 *     only the enabled single rules that leave events out at all
 *     (doesDetectionRuleLeaveOutEventsWithNoValue): a rule that fires on
 *     each event, a correlation and a rule that is off read nothing;
 *   - all of them in one read of the project's last day of events - a
 *     range of the table's sort key (projectId, time) - with four counts a
 *     rule, each rule's condition written once (WITH); only when their
 *     conditions hold more parameters than one read can send are they read
 *     in as few reads as they fit in;
 *   - their exceptions in one read of Postgres, applied as in their runs;
 *   - only the sources the reader may read, only the events the project
 *     still keeps, stopped at the interactive time limit;
 *   - each answer kept five minutes, for the rules as they stand and the
 *     sources the reader may read: a refresh of the page reads nothing.
 *
 * A rule whose YAML no longer compiles is left out: its Status says why.
 */

// How long an answer is kept, for the same rules as they stand and the same reader's sources.
export const DETECTION_RULE_UNCOUNTED_CACHE_TTL_MS: number = 5 * 60 * 1000;

/*
 * The most parameters one read packs rules' conditions into: below what a
 * detection read may send, with room for the read's own (the project, the
 * period, the kept events, the reader's sources).
 */
export const UNCOUNTED_READ_PARAMETER_BUDGET: number =
  MAX_DETECTION_READ_PARAMETERS - 100;

const MAX_CACHED_ANSWERS: number = 2_000;

const cache: InMemoryTTLCache<Array<DetectionRuleUncounted>> =
  new InMemoryTTLCache<Array<DetectionRuleUncounted>>(MAX_CACHED_ANSWERS);

// A rule as one read counts it: its condition, its field, what its exceptions skip.
export interface UncountedRuleRead {
  detectionRuleId: string;
  groupByField: string;
  ruleWhere: Statement;
  skipped: Statement | null;
}

function countOf(value: unknown): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? count : 0;
}

function parameterCount(statement: Statement): number {
  return Object.keys(statement.query_params).length;
}

/*
 * One rule's part of the read's WITH clause: its condition, what its
 * exceptions skip, whether an event has a value for its field, whether a
 * scrub rule hid that value and whether it hid it in a span - each named
 * by the rule's place in the read, as Run on Past Events names them for
 * its one rule.
 */
function buildRuleAliases(rule: UncountedRuleRead, index: number): Statement {
  const marker: HiddenValueMarker = getHiddenValueMarker(rule.groupByField);
  const statement: Statement = SQL`(`;

  statement.append(rule.ruleWhere);
  statement.append(`) AS __matches_${index}, (`);

  if (rule.skipped) {
    statement.append(rule.skipped);
  } else {
    statement.append("false");
  }

  statement.append(`) AS __skipped_${index}, (`);
  statement.append(buildSigmaFieldHasValue(rule.groupByField));
  statement.append(`) AS __hasValue_${index}, (`);
  statement.append(
    SQL`attributes[${{
      type: TableColumnType.Text,
      value: marker.hiddenKey,
    }}] = ${{
      type: TableColumnType.Text,
      value: marker.hiddenValue,
    }}`,
  );

  if (marker.storedIn) {
    statement.append(" OR ");
    statement.append(buildHoldsSharedScrubPlaceholderSql(marker.storedIn));
  }

  statement.append(`) AS __hidden_${index}, `);
  statement.append(
    SQL`attributes[${{
      type: TableColumnType.Text,
      value: marker.inKey,
    }}] = ${{
      type: TableColumnType.Text,
      value: marker.inTracesValue,
    }}`,
  );
  statement.append(` AS __inTraces_${index}`);

  return statement;
}

/*
 * One read of the period for `rules`: per rule, the events it matched and
 * its exceptions kept (matched_<n>), those with no value for its field
 * (uncounted_<n>), and those whose value a scrub rule hid in a log line or
 * in a span (hiddenInLogs_<n>, hiddenInTraces_<n>). Only events some rule
 * matched are read.
 */
export function buildUncountedRulesStatement(data: {
  projectId: ObjectID;
  tableName: string;
  rules: ReadonlyArray<UncountedRuleRead>;
  serviceFilter: TelemetryServiceFilter;
  startTime: Date;
  endTime: Date;
  // Read only the events still kept at this moment (retentionDate).
  keptAt?: Date | undefined;
}): Statement {
  const statement: Statement = SQL`WITH `;

  data.rules.forEach((rule: UncountedRuleRead, index: number): void => {
    if (index > 0) {
      statement.append(", ");
    }

    statement.append(buildRuleAliases(rule, index));
  });

  statement.append(" SELECT ");
  statement.append(
    data.rules
      .map((_rule: UncountedRuleRead, index: number): string => {
        const kept: string = `__matches_${index} AND NOT __skipped_${index}`;
        const uncounted: string = `${kept} AND NOT __hasValue_${index}`;

        return [
          `countIf(${kept}) AS matched_${index}`,
          `countIf(${uncounted}) AS uncounted_${index}`,
          `countIf(${uncounted} AND __hidden_${index} AND NOT __inTraces_${index}) AS hiddenInLogs_${index}`,
          `countIf(${uncounted} AND __hidden_${index} AND __inTraces_${index}) AS hiddenInTraces_${index}`,
        ].join(", ");
      })
      .join(", "),
  );
  statement.append(" FROM ");
  statement.append(data.tableName);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.startTime,
    }} AND time < ${{
      type: TableColumnType.DateTime64,
      value: data.endTime,
    }} AND (`,
  );
  statement.append(
    data.rules
      .map((_rule: UncountedRuleRead, index: number): string => {
        return `__matches_${index}`;
      })
      .join(" OR "),
  );
  statement.append(")");

  if (data.keptAt) {
    statement.append(
      SQL` AND retentionDate >= ${{
        type: TableColumnType.Date,
        value: data.keptAt,
      }}`,
    );
  }

  TelemetryReadScopeUtil.appendServiceFilter(statement, data.serviceFilter);
  statement.append(getQuerySettings(INTERACTIVE_READ_TIME_LIMIT));

  return statement;
}

/*
 * The rules in as few reads as their conditions fit in: each read takes
 * rules in order while their parameters stay within the budget. A rule
 * that does not fit even alone is read alone, and refused there as its own
 * runs would refuse it (assertDetectionReadFits).
 */
export function packUncountedRules(
  rules: ReadonlyArray<UncountedRuleRead>,
  budget: number = UNCOUNTED_READ_PARAMETER_BUDGET,
): Array<Array<UncountedRuleRead>> {
  const packs: Array<Array<UncountedRuleRead>> = [];
  let pack: Array<UncountedRuleRead> = [];
  let used: number = 0;

  for (const rule of rules) {
    const cost: number = parameterCount(buildRuleAliases(rule, 0));

    if (pack.length > 0 && used + cost > budget) {
      packs.push(pack);
      pack = [];
      used = 0;
    }

    pack.push(rule);
    used += cost;
  }

  if (pack.length > 0) {
    packs.push(pack);
  }

  return packs;
}

// What one read's row says of each of its rules: only those that left events out.
export function readUncountedRulesRow(data: {
  row: JSONObject | undefined;
  rules: ReadonlyArray<UncountedRuleRead>;
}): Array<DetectionRuleUncounted> {
  const answered: Array<DetectionRuleUncounted> = [];

  data.rules.forEach((rule: UncountedRuleRead, index: number): void => {
    const uncountedCount: number = countOf(data.row?.[`uncounted_${index}`]);

    if (uncountedCount <= 0) {
      return;
    }

    answered.push({
      detectionRuleId: rule.detectionRuleId,
      field: rule.groupByField,
      matchedCount: Math.max(
        uncountedCount,
        countOf(data.row?.[`matched_${index}`]),
      ),
      uncountedCount,
      hiddenInLogsCount: countOf(data.row?.[`hiddenInLogs_${index}`]),
      hiddenInTracesCount: countOf(data.row?.[`hiddenInTraces_${index}`]),
    });
  });

  return answered;
}

// What a rule is, as far as whether it leaves events out and how it is read.
interface CountingRule {
  id: string;
  sigmaRuleYaml: string;
  groupByField: string;
  distinctCountField: string;
  matchCountThreshold: number | undefined;
}

/*
 * The rules that leave events out, in a stable order: enabled ones with a
 * Group By Field that need more than one event per group.
 */
export function getRulesThatLeaveOutEvents(
  rules: ReadonlyArray<DetectionRule>,
): Array<CountingRule> {
  const counting: Array<CountingRule> = [];

  for (const rule of rules) {
    const id: string = rule.id?.toString() || "";

    if (
      !id ||
      rule.isEnabled === false ||
      !rule.sigmaRuleYaml ||
      !doesDetectionRuleLeaveOutEventsWithNoValue({
        groupByField: rule.groupByField,
        distinctCountField: rule.distinctCountField,
        matchCountThreshold: rule.matchCountThreshold,
      })
    ) {
      continue;
    }

    counting.push({
      id,
      sigmaRuleYaml: rule.sigmaRuleYaml,
      groupByField: (rule.groupByField || "").trim(),
      distinctCountField: (rule.distinctCountField || "").trim(),
      matchCountThreshold: rule.matchCountThreshold,
    });
  }

  return counting.sort((first: CountingRule, second: CountingRule): number => {
    return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
  });
}

// What the answer for `rules` is kept under: they as they stand, and the reader's sources.
export function getUncountedCacheKey(data: {
  projectId: ObjectID;
  rules: ReadonlyArray<CountingRule>;
  serviceFilter: TelemetryServiceFilter;
}): string {
  return JSON.stringify([
    data.projectId.toString(),
    data.serviceFilter,
    data.rules.map((rule: CountingRule): Array<unknown> => {
      return [
        rule.id,
        rule.sigmaRuleYaml,
        rule.groupByField,
        rule.distinctCountField,
        rule.matchCountThreshold ?? null,
      ];
    }),
  ]);
}

export default class DetectionRuleUncountedReader {
  // Forget what was read, so a test reads the rules it set up.
  public static clearCache(): void {
    cache.clear();
  }

  /*
   * What the rules `detectionRuleIds` names - read as the caller reads,
   * so a rule they may not read is none - could not count in the last day.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    detectionRuleIds: ReadonlyArray<ObjectID>;
    props: DatabaseCommonInteractionProps;
    serviceFilter: TelemetryServiceFilter;
    now?: Date | undefined;
  }): Promise<DetectionRulesUncounted> {
    const answer: DetectionRulesUncounted = {
      periodInHours: DETECTION_RULE_UNCOUNTED_PERIOD_IN_HOURS,
      rules: [],
    };

    const ids: Array<ObjectID> = data.detectionRuleIds.slice(
      0,
      MAX_DETECTION_RULES_UNCOUNTED_PER_ASK,
    );

    if (ids.length === 0) {
      return answer;
    }

    const saved: Array<DetectionRule> = await DetectionRuleService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(ids) as never,
      },
      select: {
        _id: true,
        isEnabled: true,
        sigmaRuleYaml: true,
        groupByField: true,
        distinctCountField: true,
        matchCountThreshold: true,
      },
      skip: 0,
      limit: MAX_DETECTION_RULES_UNCOUNTED_PER_ASK,
      props: data.props,
    });

    const counting: Array<CountingRule> = getRulesThatLeaveOutEvents(saved);

    if (counting.length === 0) {
      return answer;
    }

    const key: string = getUncountedCacheKey({
      projectId: data.projectId,
      rules: counting,
      serviceFilter: data.serviceFilter,
    });
    const cached: Array<DetectionRuleUncounted> | undefined = cache.get(key);

    if (cached) {
      return { ...answer, rules: cached };
    }

    const endTime: Date = data.now || OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveHours(
      endTime,
      -DETECTION_RULE_UNCOUNTED_PERIOD_IN_HOURS,
    );

    const exceptions: Map<string, Array<LoadedDetectionRuleException>> =
      await DetectionRuleExceptions.loadForProject({
        projectId: data.projectId,
        ruleIds: counting.map((rule: CountingRule): ObjectID => {
          return new ObjectID(rule.id);
        }),
        from: startTime,
        until: endTime,
        now: endTime,
      });

    const watchlists: SecurityWatchlistReader = SecurityWatchlists.readerFor(
      data.projectId,
    );
    const reads: Array<UncountedRuleRead> = [];

    for (const rule of counting) {
      try {
        const definition: DetectionRuleDefinition = await watchlists.bind(
          SigmaRuleSetParser.parse(rule.sigmaRuleYaml),
        );

        if (definition.kind !== "single") {
          continue;
        }

        reads.push({
          detectionRuleId: rule.id,
          groupByField: rule.groupByField,
          ruleWhere: SigmaClickhouseCompiler.compile(definition.rule),
          skipped: buildDetectionRuleExceptionsMatch(
            exceptions.get(rule.id) || [],
          ),
        });
      } catch (error) {
        // Its runs fail too, and its Status says why: nothing to count here.
        logger.debug(
          `DetectionRuleUncounted: rule ${rule.id} does not compile, so it is not counted. ${String(error)}`,
        );
      }
    }

    if (!SecurityEventService.database) {
      SecurityEventService.useDefaultDatabase();
    }

    const tableName: string = `${
      SecurityEventService.database!.getDatasourceOptions().database
    }.${SecurityEventService.model.tableName}`;

    const uncounted: Array<DetectionRuleUncounted> = [];

    for (const pack of packUncountedRules(reads)) {
      const statement: Statement = buildUncountedRulesStatement({
        projectId: data.projectId,
        tableName,
        rules: pack,
        serviceFilter: data.serviceFilter,
        startTime,
        endTime,
        keptAt: endTime,
      });

      assertDetectionReadFits(statement);

      const result: Results = await SecurityEventService.executeQuery(statement);
      const response: DbJSONResponse = await result.json<{
        data?: Array<JSONObject>;
      }>();

      uncounted.push(
        ...readUncountedRulesRow({
          row: ((response.data || []) as Array<JSONObject>)[0],
          rules: pack,
        }),
      );
    }

    cache.set(key, uncounted, DETECTION_RULE_UNCOUNTED_CACHE_TTL_MS);

    return { ...answer, rules: uncounted };
  }
}
