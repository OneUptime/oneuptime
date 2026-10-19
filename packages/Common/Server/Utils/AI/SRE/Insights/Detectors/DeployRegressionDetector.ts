import ChangeEvent from "../../../../../../Models/AnalyticsModels/ChangeEvent";
import { SpanStatus } from "../../../../../../Models/AnalyticsModels/Span";
import Service from "../../../../../../Models/DatabaseModels/Service";
import AIInsightEvidence, {
  DeployRegressionWindowEvidence,
} from "../../../../../../Types/AI/AIInsightEvidence";
import AIInsightSeverity from "../../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import InBetween from "../../../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../../../Types/Date";
import Dictionary from "../../../../../../Types/Dictionary";
import ObjectID from "../../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../../Types/PositiveNumber";
import {
  ChangeEventSource,
  shortCommitSha,
} from "../../../../../../Utils/Telemetry/ChangeEventFields";
import GlobalCache from "../../../../../Infrastructure/GlobalCache";
import ExceptionInstanceService from "../../../../../Services/ExceptionInstanceService";
import ServiceService from "../../../../../Services/ServiceService";
import TraceAggregationService, {
  ServiceLatencyProfile,
  ServiceLatencyProfileRow,
} from "../../../../../Services/TraceAggregationService";
import ChangeEventService from "../../../../../Services/ChangeEventService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import logger from "../../../../Logger";
import {
  ChangeImpact,
  ChangeImpactVerdict,
  ChangeWindowStats,
  NewExceptionType,
  assessChangeImpact,
  formatDurationMs,
  formatPerMinute,
  formatRate,
} from "../../ChangeImpact";
import RecentChangesContext, {
  ChangeRelevance,
  IMPACT_WINDOW_MINUTES,
  NEW_EXCEPTION_LEAD_MINUTES,
  RecentChange,
  RecordedChange,
  groupRecordedChanges,
  toRecordedChange,
} from "../../RecentChangesContext";
import { untrustedLine } from "../../UntrustedText";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * DeployRegression - the release guardian. A service that got measurably
 * worse right after a recorded deploy is flagged on the service, naming the
 * deploy, before any monitor fires and whether or not anyone declares an
 * incident.
 *
 * Every scan tick reads the project's changes whose window after them has
 * passed - recorded from IMPACT_WINDOW_MINUTES to IMPACT_WINDOW_MINUTES +
 * DEPLOY_REGRESSION_LOOKBACK_MINUTES ago - folds the events of one deploy
 * into one (groupRecordedChanges), and checks each once: the service's
 * spans and exceptions in the window before the change against the window
 * after it, judged by ChangeImpact - the thresholds an investigation marks
 * a change SUSPECT with. Deterministic: no LLM decides anything here.
 *
 * It runs unattended for every opted-in project, so its reads are the
 * cheap ones: span counts and p99 come from the Span table's aggregate
 * projections (getResourceFacetCounts, getServiceLatencyProfile), never a
 * raw-span scan. A change checked once is not read again (a Redis marker),
 * and at most DEPLOY_REGRESSION_MAX_CHECKS_PER_SCAN are checked a tick.
 *
 * Not checked: a change that names no service, and the fixes and runbooks
 * OneUptime itself ran (the remediation verifier watches those).
 */

// The window on each side of a change.
export const DEPLOY_REGRESSION_WINDOW_MINUTES: number = IMPACT_WINDOW_MINUTES;

/*
 * How long after its window a change is still checked: a few scan ticks,
 * so a tick that failed or was skipped does not lose a deploy.
 */
export const DEPLOY_REGRESSION_LOOKBACK_MINUTES: number = 60;

// The most changes checked in one scan tick; the rest wait for the next.
export const DEPLOY_REGRESSION_MAX_CHECKS_PER_SCAN: number = 10;

// The most change events read in one scan tick.
export const DEPLOY_REGRESSION_MAX_CHANGES_READ: number = 200;

/*
 * A span error rate this high after a deploy is High severity on its own,
 * as is a regression in two signals at once.
 */
export const DEPLOY_REGRESSION_HIGH_ERROR_RATE: number = 0.1;

// The Redis marker of a change already checked, kept past its lookback.
export const DEPLOY_REGRESSION_CHECKED_NAMESPACE: string =
  "deploy-regression-checked";
export const DEPLOY_REGRESSION_CHECKED_TTL_IN_SECONDS: number = 24 * 60 * 60;

// Changes OneUptime made itself, which the remediation verifier watches.
const OWN_CHANGE_SOURCES: Array<string> = [
  ChangeEventSource.OneUptimeAi,
  ChangeEventSource.Runbook,
];

// The longest text from a change an insight quotes.
const MAX_QUOTED_TEXT_LENGTH: number = 120;

// Text a pipeline or a collector sent, as an inline code span.
function codeSpan(text: string): string {
  return `\`${untrustedLine(text, MAX_QUOTED_TEXT_LENGTH).replace(/`/g, "'")}\``;
}

// Nothing relates a change to a subject here: every change is "other".
const NO_RELEVANCE: ChangeRelevance = {
  serviceIds: new Set<string>(),
  kubernetesClusterIds: new Set<string>(),
  resourceIds: new Set<string>(),
  subjectKind: "incident",
  subjectId: "",
};

export default class DeployRegressionDetector implements InsightDetector {
  public insightType: AIInsightType = AIInsightType.DeployRegression;

  // The dedupe key: one insight per change of one service.
  public static buildFingerprint(serviceId: string, changeId: string): string {
    return `deploy-regression:${serviceId}:${changeId}`;
  }

  /*
   * The changes a tick checks: the deploys of a service, one per deploy,
   * whose window after them has passed, oldest first - the ones about to
   * leave the lookback go first.
   */
  public static selectChanges(
    changes: Array<RecordedChange>,
    now: Date,
  ): Array<RecentChange> {
    const checkable: Array<RecordedChange> = changes.filter(
      (change: RecordedChange): boolean => {
        return (
          Boolean(change.serviceId) &&
          !OWN_CHANGE_SOURCES.includes(change.fields.source || "")
        );
      },
    );

    return groupRecordedChanges(checkable, NO_RELEVANCE)
      .filter((change: RecentChange): boolean => {
        return (
          change.time.getTime() +
            DEPLOY_REGRESSION_WINDOW_MINUTES * 60 * 1000 <=
          now.getTime()
        );
      })
      .sort((a: RecentChange, b: RecentChange): number => {
        return a.time.getTime() - b.time.getTime();
      });
  }

  public static severityFor(impact: ChangeImpact): AIInsightSeverity {
    const after: ChangeWindowStats | undefined = impact.after;
    const afterErrorRate: number =
      after && after.spanCount > 0 ? after.errorSpanCount / after.spanCount : 0;

    return impact.reasons.length >= 2 ||
      afterErrorRate >= DEPLOY_REGRESSION_HIGH_ERROR_RATE
      ? AIInsightSeverity.High
      : AIInsightSeverity.Medium;
  }

  // The insight for a change the service regressed after.
  public static buildCandidate(data: {
    change: RecentChange;
    serviceName: string;
    impact: ChangeImpact;
  }): InsightCandidate {
    const { change, serviceName, impact } = data;
    const fields: RecentChange["fields"] = change.fields;
    const before: ChangeWindowStats = impact.before!;
    const after: ChangeWindowStats = impact.after!;
    const service: string = untrustedLine(serviceName, MAX_QUOTED_TEXT_LENGTH);
    const version: string = fields.version
      ? untrustedLine(fields.version, 40)
      : "";
    const title: string = change.titles[0] || change.eventType;

    const lines: Array<string> = [
      `**${service} got worse right after a ${
        change.eventType === "deployment" ? "deploy" : "change"
      }**`,
      "",
      `- Change: ${codeSpan(title)} at ${change.time.toISOString()}`,
    ];

    if (fields.version) {
      lines.push(
        `- Version: ${
          fields.previousVersion ? `${codeSpan(fields.previousVersion)} → ` : ""
        }${codeSpan(fields.version)}`,
      );
    }
    if (fields.commitSha) {
      lines.push(`- Commit: ${codeSpan(shortCommitSha(fields.commitSha))}`);
    }
    if (fields.environment) {
      lines.push(`- Environment: ${codeSpan(fields.environment)}`);
    }

    lines.push(
      "",
      `**In the ${DEPLOY_REGRESSION_WINDOW_MINUTES} minutes after it, compared with the ${DEPLOY_REGRESSION_WINDOW_MINUTES} minutes before:**`,
      "",
      ...impact.reasons.map((reason: string): string => {
        return `- ${reason}`;
      }),
      "",
      "| | Before | After |",
      "| --- | --- | --- |",
      `| Spans | ${before.spanCount} | ${after.spanCount} |`,
      `| Span error rate | ${formatRate(
        before.spanCount > 0 ? before.errorSpanCount / before.spanCount : 0,
      )} | ${formatRate(
        after.spanCount > 0 ? after.errorSpanCount / after.spanCount : 0,
      )} |`,
      `| p99 latency | ${formatDurationMs(before.p99Ms)} | ${formatDurationMs(after.p99Ms)} |`,
      `| Exceptions | ${formatPerMinute(
        before.durationMinutes > 0
          ? before.exceptionCount / before.durationMinutes
          : 0,
      )} | ${formatPerMinute(
        after.durationMinutes > 0
          ? after.exceptionCount / after.durationMinutes
          : 0,
      )} |`,
      "",
      `If the change caused it, rolling it back is usually the fastest safe fix. Change id: \`${change.id}\`.`,
    );

    const evidence: AIInsightEvidence = {
      deployRegression: {
        changeId: change.id,
        changeTime: change.time.toISOString(),
        changeTitle: untrustedLine(title, 500),
        changeType: change.eventType,
        ...(fields.version
          ? { version: untrustedLine(fields.version, 200) }
          : {}),
        ...(fields.previousVersion
          ? { previousVersion: untrustedLine(fields.previousVersion, 200) }
          : {}),
        ...(fields.commitSha
          ? { commitSha: shortCommitSha(fields.commitSha) }
          : {}),
        ...(fields.environment
          ? { environment: untrustedLine(fields.environment, 200) }
          : {}),
        ...(fields.source ? { source: fields.source } : {}),
        reasons: impact.reasons,
        before: DeployRegressionDetector.windowEvidence(before),
        after: DeployRegressionDetector.windowEvidence(after),
        newExceptionTypes: impact.newExceptionTypes.map(
          (exception: NewExceptionType) => {
            return {
              exceptionType: untrustedLine(
                exception.exceptionType || "Exception",
                200,
              ),
              occurrenceCount: exception.occurrenceCount,
            };
          },
        ),
      },
    };

    return {
      insightType: AIInsightType.DeployRegression,
      fingerprint: DeployRegressionDetector.buildFingerprint(
        change.serviceId!,
        change.id,
      ),
      title: `${service} got worse right after ${
        version ? `deploying ${version}` : "a change"
      }`,
      detailMarkdown: lines.join("\n"),
      severity: DeployRegressionDetector.severityFor(impact),
      serviceName: service,
      telemetryServiceId: new ObjectID(change.serviceId!),
      evidence,
    };
  }

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const now: Date = context.now;
    const recorded: Array<RecordedChange> = await this.readChanges(context);
    const changes: Array<RecentChange> = DeployRegressionDetector.selectChanges(
      recorded,
      now,
    );

    const toCheck: Array<RecentChange> = [];

    for (const change of changes) {
      if (toCheck.length >= DEPLOY_REGRESSION_MAX_CHECKS_PER_SCAN) {
        break;
      }

      if (!(await DeployRegressionDetector.wasChecked(change))) {
        toCheck.push(change);
      }
    }

    if (toCheck.length === 0) {
      return [];
    }

    const serviceNames: Dictionary<string> = await this.readServiceNames(
      context.projectId,
      toCheck,
    );
    const candidates: Array<InsightCandidate> = [];

    for (const change of toCheck) {
      try {
        const impact: ChangeImpact = await DeployRegressionDetector.readImpact({
          projectId: context.projectId,
          change,
        });

        await DeployRegressionDetector.markChecked(change);

        if (impact.verdict !== ChangeImpactVerdict.Suspect) {
          continue;
        }

        candidates.push(
          DeployRegressionDetector.buildCandidate({
            change,
            serviceName: serviceNames[change.serviceId!] || "A service",
            impact,
          }),
        );
      } catch (error) {
        logger.debug(
          `AI Insights: could not check change ${change.id} for a regression (project ${context.projectId.toString()}); the next tick tries again: ${error}`,
        );
      }
    }

    return candidates;
  }

  // The service's telemetry around a change, judged by ChangeImpact.
  public static async readImpact(data: {
    projectId: ObjectID;
    change: RecentChange;
  }): Promise<ChangeImpact> {
    const time: Date = data.change.time;
    const serviceId: ObjectID = new ObjectID(data.change.serviceId!);
    const beforeStart: Date = OneUptimeDate.addRemoveMinutes(
      time,
      -DEPLOY_REGRESSION_WINDOW_MINUTES,
    );
    const afterEnd: Date = OneUptimeDate.addRemoveMinutes(
      time,
      DEPLOY_REGRESSION_WINDOW_MINUTES,
    );

    const [before, after, newExceptionTypes]: [
      ChangeWindowStats,
      ChangeWindowStats,
      Array<NewExceptionType>,
    ] = await Promise.all([
      DeployRegressionDetector.readWindowStats({
        projectId: data.projectId,
        serviceId,
        start: beforeStart,
        end: time,
      }),
      DeployRegressionDetector.readWindowStats({
        projectId: data.projectId,
        serviceId,
        start: time,
        end: afterEnd,
      }),
      RecentChangesContext.readNewExceptionTypes({
        projectId: data.projectId,
        serviceId,
        version: data.change.fields.version,
        firstSeenFrom: OneUptimeDate.addRemoveMinutes(
          time,
          -NEW_EXCEPTION_LEAD_MINUTES,
        ),
        firstSeenTo: afterEnd,
      }),
    ]);

    return assessChangeImpact({
      before,
      after,
      newExceptionTypes,
      version: data.change.fields.version,
    });
  }

  /*
   * A service's spans and exceptions over [start, end), from the Span
   * table's aggregate projections: both windows are whole minutes, the
   * change's own minute in the window after it.
   */
  public static async readWindowStats(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    start: Date;
    end: Date;
  }): Promise<ChangeWindowStats> {
    const durationMinutes: number = Math.max(
      0,
      (data.end.getTime() - data.start.getTime()) / (60 * 1000),
    );

    const [counts, latency, exceptionCount]: [
      { serviceCounts: Map<string, number>; statusCounts: Map<string, number> },
      ServiceLatencyProfile,
      PositiveNumber,
    ] = await Promise.all([
      TraceAggregationService.getResourceFacetCounts({
        projectId: data.projectId,
        startTime: data.start,
        // Its end minute is inclusive: stop before the end's own minute.
        endTime: OneUptimeDate.addRemoveMinutes(data.end, -1),
        facetKeys: [],
        serviceIds: [data.serviceId],
      }),
      TraceAggregationService.getServiceLatencyProfile({
        projectId: data.projectId,
        startTime: data.start,
        endTime: data.end,
        limit: 1,
        serviceIds: [data.serviceId],
      }),
      ExceptionInstanceService.countBy({
        query: {
          projectId: data.projectId,
          primaryEntityId: data.serviceId,
          time: new InBetween(data.start, data.end),
        } as never,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
    ]);

    let spanCount: number = 0;

    for (const count of counts.statusCounts.values()) {
      spanCount += count;
    }

    // A p99 cut short by the time limit says nothing.
    const latencyRow: ServiceLatencyProfileRow | undefined = latency.isPartial
      ? undefined
      : latency.rows.find((row: ServiceLatencyProfileRow): boolean => {
          return row.primaryEntityId === data.serviceId.toString();
        });

    return {
      durationMinutes,
      spanCount,
      errorSpanCount: counts.statusCounts.get(String(SpanStatus.Error)) || 0,
      p99Ms: latencyRow?.p99DurationMs || 0,
      exceptionCount: exceptionCount.toNumber(),
    };
  }

  private static windowEvidence(
    stats: ChangeWindowStats,
  ): DeployRegressionWindowEvidence {
    return {
      durationMinutes: stats.durationMinutes,
      spanCount: stats.spanCount,
      errorSpanCount: stats.errorSpanCount,
      p99Ms: stats.p99Ms,
      exceptionCount: stats.exceptionCount,
    };
  }

  private static async wasChecked(change: RecentChange): Promise<boolean> {
    try {
      return Boolean(
        await GlobalCache.getString(
          DEPLOY_REGRESSION_CHECKED_NAMESPACE,
          change.id,
        ),
      );
    } catch {
      // Without the marker a change may be checked twice; never not at all.
      return false;
    }
  }

  private static async markChecked(change: RecentChange): Promise<void> {
    try {
      await GlobalCache.setString(
        DEPLOY_REGRESSION_CHECKED_NAMESPACE,
        change.id,
        "1",
        { expiresInSeconds: DEPLOY_REGRESSION_CHECKED_TTL_IN_SECONDS },
      );
    } catch (error) {
      logger.debug(
        `AI Insights: could not mark change ${change.id} checked: ${error}`,
      );
    }
  }

  private async readChanges(
    context: InsightScanContext,
  ): Promise<Array<RecordedChange>> {
    const windowEnd: Date = OneUptimeDate.addRemoveMinutes(
      context.now,
      -DEPLOY_REGRESSION_WINDOW_MINUTES,
    );
    const windowStart: Date = OneUptimeDate.addRemoveMinutes(
      windowEnd,
      -DEPLOY_REGRESSION_LOOKBACK_MINUTES,
    );

    const rows: Array<ChangeEvent> = await ChangeEventService.findBy({
      query: {
        projectId: context.projectId,
        time: new InBetween(windowStart, windowEnd),
      } as never,
      select: {
        _id: true,
        time: true,
        eventType: true,
        title: true,
        primaryEntityId: true,
        attributes: true,
      } as never,
      sort: { time: SortOrder.Ascending } as never,
      limit: DEPLOY_REGRESSION_MAX_CHANGES_READ,
      skip: 0,
      props: { isRoot: true },
    });

    return rows
      .map(toRecordedChange)
      .filter((change: RecordedChange | null): change is RecordedChange => {
        return change !== null;
      });
  }

  private async readServiceNames(
    projectId: ObjectID,
    changes: Array<RecentChange>,
  ): Promise<Dictionary<string>> {
    const ids: Array<string> = Array.from(
      new Set<string>(
        changes.map((change: RecentChange): string => {
          return change.serviceId!;
        }),
      ),
    );
    const names: Dictionary<string> = {};

    try {
      const services: Array<Service> = await ServiceService.findBy({
        query: {
          projectId,
          _id: QueryHelper.any(
            ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        } as never,
        select: { _id: true, name: true },
        limit: ids.length,
        skip: 0,
        props: { isRoot: true },
      });

      for (const service of services) {
        if (service._id && service.name) {
          names[service._id.toString()] = service.name;
        }
      }
    } catch (error) {
      logger.debug(
        `AI Insights: could not name the changed services: ${error}`,
      );
    }

    return names;
  }
}
