import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import {
  DropFilterImpact,
  DropFilterImpactAction,
  DropFilterImpactRequest,
  DropFilterRecordCount,
  DropFilterRecordCountState,
  DropFilterThresholdRule,
  DropFilterThresholdRules,
  getDropFilterKeepPercentage,
  getEmptyDropFilterImpact,
  getNeededWhenSampled,
} from "../../../Types/Telemetry/DropFilterImpact";
import {
  getEmptyTelemetryFieldReadersByKind,
  SecurityEventsTelemetrySource,
  TelemetryFieldReadersByKind,
  TelemetryFieldSignal,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import {
  doesDropFilterReachQuery,
  DropFilterReading,
} from "../../../Utils/Telemetry/DropFilterQueryReads";
import { TelemetryReadQuery } from "../../../Utils/Telemetry/TelemetryFieldReferences";
import {
  readTelemetryFilterQuery,
  ReadTelemetryFilterQuery,
} from "../../../Utils/Telemetry/TelemetryFilterQuery";
import QueryHelper from "../../Types/Database/QueryHelper";
import DetectionRuleService from "../../Services/DetectionRuleService";
import logger from "../Logger";
import { isOpenStackDefaultDropFilter } from "../OpenStack/OpenStackLogDefaults";
import {
  findSecurityEventsSources,
  SecurityEventsSources,
} from "../SecurityEvent/SecurityEventsFieldReaders";
import {
  countDropFilterRecords,
  DROP_FILTER_COUNT_TIME_LIMIT_IN_SECONDS,
} from "./DropFilterRecordCount";
import { findTelemetryQueryReaders } from "./TelemetryFieldReaders";
import { getFilterRowColumns } from "./TelemetryFilterQuerySql";

/*
 * WHAT A DROP OR SAMPLE FILTER WOULD TAKE, BEFORE IT IS SAVED OR TURNED ON
 * (#10436).
 *
 * The form, a filter's Enable and the API ask here, with the filter as it
 * is being written: its signal, query, action and share kept. The answer
 * (Types/Telemetry/DropFilterImpact):
 *
 *   - how many of the last day's records it matches, and of those how many
 *     Security Events read where it reads that signal: one bounded count
 *     (DropFilterRecordCount);
 *   - the monitors, dashboards, saved views, recording rules and SLOs whose
 *     queries can keep the records it takes: #10433's lookup, asked of each
 *     query (findTelemetryQueryReaders) whether the filter reaches it
 *     (DropFilterQueryReads) - named where the person may read them,
 *     counted where they may not, and said to be unchecked when a kind
 *     could not be read;
 *   - for a sample of records Security Events reads, its enabled rules that
 *     fire at a count, and about how many each then needs: a rule that
 *     fires at 10 failed sign-ins needs about 100 when a tenth is kept.
 *
 * It reads; it changes nothing, and it never refuses a filter for what it
 * takes. The person decides.
 */

// A sample keeps what it keeps of these signals' records: the words the API says it in.
const RECORD_NOUN: Readonly<Record<TelemetryFieldSignal, string>> = {
  log: "logs",
  trace: "spans",
};

function isPermissionRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof NotAuthenticatedException ||
    error instanceof PaymentRequiredException
  );
}

function idOf(record: { id?: ObjectID | null | undefined }): string {
  return record.id?.toString().toLowerCase() || "";
}

/*
 * The request held to what a saved filter of the signal may say: a query,
 * and an action with its share. Refuses (BadDataException) anything else,
 * in the words the filter's own save refuses it with.
 */
export function readDropFilterImpactRequest(
  body: unknown,
  signal: TelemetryFieldSignal,
): DropFilterImpactRequest {
  const json: Record<string, unknown> =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const filterQuery: unknown = json["filterQuery"];

  if (typeof filterQuery !== "string" || !filterQuery.trim()) {
    throw new BadDataException(
      `Filter query is required. A drop filter with an empty query matches every record, which would discard all of this project's ${RECORD_NOUN[signal]}. Add a condition, or delete the filter.`,
    );
  }

  const action: unknown = json["action"] ?? DropFilterImpactAction.Drop;

  if (
    action !== DropFilterImpactAction.Drop &&
    action !== DropFilterImpactAction.Sample
  ) {
    throw new BadDataException('Choose the action: "drop" or "sample".');
  }

  const samplePercentage: unknown = json["samplePercentage"];

  if (
    action === DropFilterImpactAction.Sample &&
    getDropFilterKeepPercentage({ action, samplePercentage }) >= 100
  ) {
    throw new BadDataException(
      `Sample percentage is required when the action is "Sample". Enter the percentage of matching ${RECORD_NOUN[signal]} to keep, between 1 and 99.`,
    );
  }

  const name: unknown = json["name"];

  return {
    signal,
    filterQuery,
    action,
    ...(action === DropFilterImpactAction.Sample
      ? { samplePercentage: samplePercentage as number }
      : {}),
    ...(typeof name === "string" ? { name } : {}),
  };
}

/*
 * The enabled Security Events rules that fire once a group reaches a count
 * above one, with about how many each needs of what a sample keeps.
 */
export async function findThresholdRules(data: {
  projectId: ObjectID;
  keepPercentage: number;
  props: DatabaseCommonInteractionProps;
}): Promise<DropFilterThresholdRules> {
  let rules: Array<DetectionRule>;

  try {
    rules = await DetectionRuleService.findBy({
      query: {
        projectId: data.projectId,
        isEnabled: true,
        matchCountThreshold: QueryHelper.greaterThan(1),
      },
      select: {
        _id: true,
        name: true,
        matchCountThreshold: true,
        evaluationIntervalInMinutes: true,
        distinctCountField: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  } catch (error) {
    logger.warn(
      `Drop filter impact: could not read the detection rules of project ${data.projectId.toString()}:`,
    );
    logger.warn(error);

    return { rules: [], hiddenCount: 0, isChecked: false };
  }

  const ids: Array<string> = rules.map(idOf).filter(Boolean);
  let visible: Set<string> = new Set<string>();

  if (ids.length > 0) {
    try {
      const readable: Array<DetectionRule> = await DetectionRuleService.findBy({
        query: { projectId: data.projectId, _id: QueryHelper.any(ids) },
        select: { _id: true },
        skip: 0,
        limit: ids.length,
        props: data.props,
      });

      visible = new Set<string>(readable.map(idOf).filter(Boolean));
    } catch (error) {
      if (!isPermissionRefusal(error)) {
        logger.warn(
          `Drop filter impact: could not tell which detection rules of project ${data.projectId.toString()} the person asking may read:`,
        );
        logger.warn(error);

        return { rules: [], hiddenCount: 0, isChecked: false };
      }
    }
  }

  const named: Array<DropFilterThresholdRule> = [];
  let hiddenCount: number = 0;

  for (const rule of rules) {
    const id: string = idOf(rule);
    const threshold: number = Math.floor(Number(rule.matchCountThreshold));

    if (!id || !Number.isFinite(threshold) || threshold <= 1) {
      continue;
    }

    if (!visible.has(id)) {
      hiddenCount++;
      continue;
    }

    named.push({
      id,
      name: rule.name || "",
      threshold,
      windowInMinutes: Math.max(
        0,
        Math.floor(Number(rule.evaluationIntervalInMinutes) || 0),
      ),
      neededWhenSampled: getNeededWhenSampled({
        threshold,
        keepPercentage: data.keepPercentage,
      }),
      countsDistinct: Boolean(rule.distinctCountField),
    });
  }

  named.sort((a: DropFilterThresholdRule, b: DropFilterThresholdRule) => {
    return a.threshold - b.threshold || a.name.localeCompare(b.name);
  });

  return { rules: named, hiddenCount, isChecked: true };
}

// The scan that reads the records a filter of this signal takes, and whose prefilter is counted.
function scanOfSignal(
  signal: TelemetryFieldSignal,
): SecurityEventsTelemetrySource {
  return signal === "log"
    ? SecurityEventsTelemetrySource.Logs
    : SecurityEventsTelemetrySource.Traces;
}

// Whether the count says Security Events read some of the matched records, or cannot say.
function mayTakeWhatSecurityEventsReads(count: DropFilterRecordCount): boolean {
  return (
    count.state !== DropFilterRecordCountState.Counted ||
    (count.securityEventsRead || 0) > 0
  );
}

/*
 * What the filter would take, for the person asking (`props`): only what
 * they may read is named or counted.
 */
export async function findDropFilterImpact(data: {
  projectId: ObjectID;
  request: DropFilterImpactRequest;
  props: DatabaseCommonInteractionProps;
  now?: Date | undefined;
  countTimeLimitInSeconds?: number | undefined;
}): Promise<DropFilterImpact> {
  const signal: TelemetryFieldSignal = data.request.signal;
  const action: DropFilterImpactAction =
    data.request.action === DropFilterImpactAction.Sample
      ? DropFilterImpactAction.Sample
      : DropFilterImpactAction.Drop;
  const keepPercentage: number = getDropFilterKeepPercentage({
    action,
    samplePercentage: data.request.samplePercentage,
  });
  const impact: DropFilterImpact = getEmptyDropFilterImpact({
    signal,
    action,
    keepPercentage,
    timeLimitInSeconds:
      data.countTimeLimitInSeconds || DROP_FILTER_COUNT_TIME_LIMIT_IN_SECONDS,
  });
  if (keepPercentage >= 100) {
    // Refused as the filter's own save refuses it: a sample with no share keeps everything.
    throw new BadDataException(
      `Sample percentage is required when the action is "Sample". Enter the percentage of matching ${RECORD_NOUN[signal]} to keep, between 1 and 99.`,
    );
  }

  const read: ReadTelemetryFilterQuery = readTelemetryFilterQuery(
    data.request.filterQuery,
  );

  if (read.kind !== "expr") {
    /*
     * A query ingest cannot read matches nothing (compileFilter's
     * always-false), and an empty one is refused: neither takes a record.
     */
    impact.isQueryReadable = false;
    impact.count.state = DropFilterRecordCountState.Counted;
    impact.readers = getEmptyTelemetryFieldReadersByKind(true);
    impact.securityEvents.isChecked = true;

    return impact;
  }

  const sources: SecurityEventsSources = await findSecurityEventsSources({
    projectId: data.projectId,
    signal,
  });
  const scansTheSignal: boolean = sources.sources.includes(
    scanOfSignal(signal),
  );
  const filter: DropFilterReading = {
    signal,
    expr: read.expr,
    rowFields: new Set<string>(getFilterRowColumns(signal).keys()),
  };

  impact.securityEvents.isChecked = sources.isChecked;
  impact.securityEvents.sources = sources.sources;
  impact.securityEvents.keepsWhatSecurityEventsReads =
    signal === "log" &&
    scansTheSignal &&
    isOpenStackDefaultDropFilter({
      name: data.request.name,
      filterQuery: data.request.filterQuery,
    });

  const [count, readers]: [DropFilterRecordCount, TelemetryFieldReadersByKind] =
    await Promise.all([
      countDropFilterRecords({
        signal,
        projectId: data.projectId,
        expr: read.expr,
        countSecurityEvents: scansTheSignal,
        props: data.props,
        now: data.now,
        timeLimitInSeconds: data.countTimeLimitInSeconds,
      }),
      findTelemetryQueryReaders({
        projectId: data.projectId,
        reads: (query: TelemetryReadQuery): boolean => {
          return doesDropFilterReachQuery(filter, query);
        },
        props: data.props,
      }),
    ]);

  impact.count = count;
  impact.readers = readers;

  if (
    action === DropFilterImpactAction.Sample &&
    scansTheSignal &&
    !impact.securityEvents.keepsWhatSecurityEventsReads &&
    mayTakeWhatSecurityEventsReads(count)
  ) {
    impact.securityEvents.thresholdRules = await findThresholdRules({
      projectId: data.projectId,
      keepPercentage,
      props: data.props,
    });
  }

  return impact;
}
