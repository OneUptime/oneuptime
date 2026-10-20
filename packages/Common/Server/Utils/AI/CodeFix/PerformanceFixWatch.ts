import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Service from "../../../../Models/DatabaseModels/Service";
import AIInsightStatus from "../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../Types/AI/AIInsightType";
import { PerformanceFinding } from "../../../../Types/AI/CodeFixTaskContext";
import { PerformanceFixBaseline } from "../../../../Types/AI/FixProductionBaseline";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import AIInsightService from "../../../Services/AIInsightService";
import ServiceService from "../../../Services/ServiceService";
import logger from "../../Logger";
import FixProductionTelemetry from "./FixProductionTelemetry";
import {
  FixProductionVerdict,
  HOUR_IN_MS,
  isMeasureDue,
  watchedMilliseconds,
} from "./FixProductionVerdict";
import FixProductionVerifier, {
  ShippedFix,
  VerifierRun,
} from "./FixProductionVerifier";
import {
  PERFORMANCE_FIX_THRESHOLDS,
  PerformanceMeasure,
  decidePerformanceBaseline,
  decidePerformanceVerdict,
  describeOperation,
  operationOfFinding,
} from "./PerformanceFixVerdict";

/*
 * A merged performance fix (FixPerformance), watched in production: the
 * Performance check of FixProductionVerifier.
 *
 * What it measures is decided once, on the fix's first check, and kept
 * with its p99 in the week before the merge (PerformanceFixBaseline):
 *
 *   - a fix a trace-latency insight opened measures what the insight
 *     measured - its operation's p99 in its service, or every span of the
 *     service when it named no operation;
 *   - a fix of a slow trace measures the operation its first finding slows
 *     (operationOfFinding) in the service the trace came from.
 *
 * Then the deploy that ships it is found like any fix's, the operation's
 * p99 in the deployed fix is measured once it has run a day and about
 * hourly after, and PerformanceFixVerdict decides. A fix an insight opened
 * resolves the insight when it is Verified and reopens it when it is
 * Regressed.
 */

// What a performance fix measures, before its baseline is read.
interface PerformanceTarget {
  serviceId: ObjectID;
  serviceName?: string | undefined;
  spanName?: string | undefined;
  insightId?: ObjectID | undefined;
}

export default class PerformanceFixWatch {
  public static async verify(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<void> {
    const mergedAt: Date = FixProductionVerifier.mergedAtOf(fix, run);
    let baseline: PerformanceFixBaseline | undefined =
      fix.productionBaseline?.performance;

    if (!baseline) {
      const target: PerformanceTarget | FixProductionVerdict =
        await PerformanceFixWatch.readTarget(fix);

      if ("status" in target) {
        await FixProductionVerifier.settle(fix, run, target);
        return;
      }

      const from: Date = OneUptimeDate.addRemoveDays(
        mergedAt,
        -PERFORMANCE_FIX_THRESHOLDS.baselineDays,
      );
      const measure: PerformanceMeasure =
        await FixProductionTelemetry.measureLatency({
          projectId: fix.projectId!,
          serviceId: target.serviceId,
          spanName: target.spanName,
          from,
          to: mergedAt,
        });

      baseline = {
        serviceId: target.serviceId.toString(),
        ...(target.spanName ? { spanName: target.spanName } : {}),
        ...(target.insightId ? { insightId: target.insightId.toString() } : {}),
        spanCount: measure.spanCount,
        p99Ms: measure.p99Ms,
        from: from.toISOString(),
        to: mergedAt.toISOString(),
      };

      await FixProductionVerifier.saveBaseline(fix, { performance: baseline });

      const thin: FixProductionVerdict | null = decidePerformanceBaseline({
        baseline: measure,
        operationLabel: PerformanceFixWatch.operationLabelOf(
          baseline,
          target.serviceName,
        ),
      });

      if (thin) {
        await FixProductionVerifier.settle(fix, run, thin);
        return;
      }
    }

    const serviceId: ObjectID = new ObjectID(baseline.serviceId);

    const shipped: ShippedFix | null = await FixProductionVerifier.awaitDeploy(
      { fix, run, serviceId, mergedAt },
    );

    if (!shipped) {
      return;
    }

    const watched: number = watchedMilliseconds({
      deployedAt: shipped.deployedAt,
      now: run.now,
      rolloutGraceMinutes: PERFORMANCE_FIX_THRESHOLDS.rolloutGraceMinutes,
    });
    const hasRunADay: boolean =
      watched >= PERFORMANCE_FIX_THRESHOLDS.minWatchHours * HOUR_IN_MS;

    // Past the first day, measured about hourly: in between there is nothing new.
    if (
      hasRunADay &&
      !shipped.isNew &&
      !isMeasureDue({
        watchedMs: watched,
        minWatchHours: PERFORMANCE_FIX_THRESHOLDS.minWatchHours,
        maxWatchDays: PERFORMANCE_FIX_THRESHOLDS.maxWatchDays,
      })
    ) {
      return;
    }

    let sinceDeploy: PerformanceMeasure | null = null;

    if (hasRunADay) {
      const version: string | undefined =
        await FixProductionVerifier.versionToRead({
          projectId: fix.projectId!,
          serviceId,
          shipped,
          now: run.now,
        });

      sinceDeploy = await FixProductionTelemetry.measureLatency({
        projectId: fix.projectId!,
        serviceId,
        spanName: baseline.spanName,
        from: FixProductionVerifier.sinceDeployWindowStart({
          shipped,
          version,
        }),
        to: run.now,
        version,
      });
    }

    const verdict: FixProductionVerdict = decidePerformanceVerdict({
      deployedAt: shipped.deployedAt,
      now: run.now,
      baseline: { spanCount: baseline.spanCount, p99Ms: baseline.p99Ms },
      sinceDeploy,
      deployLabel: FixProductionVerifier.deployLabelOf(shipped),
      operationLabel: PerformanceFixWatch.operationLabelOf(
        baseline,
        await PerformanceFixWatch.serviceNameOf(fix, baseline),
      ),
    });

    await FixProductionVerifier.settle(
      fix,
      run,
      verdict,
      shipped.isNew ? shipped : undefined,
    );

    if (
      baseline.insightId &&
      (verdict.status === FixProductionStatus.Verified ||
        verdict.status === FixProductionStatus.Regressed)
    ) {
      await PerformanceFixWatch.markInsight({
        fix,
        insightId: new ObjectID(baseline.insightId),
        status: verdict.status,
      });
    }
  }

  /*
   * What the fix measures (see the module comment), or the verdict that it
   * cannot be measured.
   */
  public static async readTarget(
    fix: AIAgentTaskPullRequest,
  ): Promise<PerformanceTarget | FixProductionVerdict> {
    const aiRun: AIRun | null = await FixProductionVerifier.readRun(fix);

    if (!aiRun) {
      return {
        status: FixProductionStatus.Unverifiable,
        summary:
          "The task that opened this fix no longer exists, so the operation it fixed cannot be measured.",
      };
    }

    if (aiRun.triggeredByAiInsightId) {
      const insight: AIInsight | null = await AIInsightService.findOneBy({
        query: {
          _id: aiRun.triggeredByAiInsightId.toString(),
          projectId: fix.projectId!,
        },
        select: {
          _id: true,
          insightType: true,
          telemetryServiceId: true,
          serviceName: true,
          evidence: true,
        },
        props: { isRoot: true },
      });

      if (
        insight?.insightType === AIInsightType.TraceLatencyRegression &&
        insight.telemetryServiceId
      ) {
        return {
          serviceId: insight.telemetryServiceId,
          serviceName: insight.serviceName || undefined,
          spanName: insight.evidence?.latency?.operationName || undefined,
          insightId: insight.id!,
        };
      }
    }

    const finding: PerformanceFinding | undefined =
      aiRun.taskContext?.performanceFindings?.[0];
    const spanName: string | undefined = operationOfFinding(finding);

    if (!spanName) {
      return {
        status: FixProductionStatus.Unverifiable,
        summary:
          "The trace this fix came from names no operation to measure, so whether the fix made it faster cannot be told.",
      };
    }

    const serviceName: string | undefined =
      aiRun.taskContext?.serviceName || undefined;
    const service: Service | null = serviceName
      ? await ServiceService.findOneBy({
          query: { projectId: fix.projectId!, name: serviceName },
          select: { _id: true, name: true },
          props: { isRoot: true },
        })
      : null;

    if (!service?.id) {
      return {
        status: FixProductionStatus.Unverifiable,
        summary:
          "The trace this fix came from names no service OneUptime knows, so the operation it fixed cannot be measured.",
      };
    }

    return {
      serviceId: service.id,
      serviceName: service.name || serviceName,
      spanName,
    };
  }

  /*
   * A verified fix resolves the insight that asked for it; a regressed one
   * puts it back in front of people. An insight someone dismissed stays
   * dismissed, and one already where the verdict would put it is left as
   * it is. A failure is logged: the verdict stands either way.
   */
  public static async markInsight(data: {
    fix: AIAgentTaskPullRequest;
    insightId: ObjectID;
    status: FixProductionStatus;
  }): Promise<void> {
    try {
      const insight: AIInsight | null = await AIInsightService.findOneBy({
        query: {
          _id: data.insightId.toString(),
          projectId: data.fix.projectId!,
        },
        select: { _id: true, status: true },
        props: { isRoot: true },
      });

      if (!insight?.id || insight.status === AIInsightStatus.Dismissed) {
        return;
      }

      const next: AIInsightStatus | null =
        data.status === FixProductionStatus.Verified
          ? insight.status === AIInsightStatus.Resolved
            ? null
            : AIInsightStatus.Resolved
          : insight.status === AIInsightStatus.ActionRequired
            ? null
            : AIInsightStatus.ActionRequired;

      if (!next) {
        return;
      }

      await AIInsightService.updateOneById({
        id: insight.id,
        data: { status: next },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Fix verification: could not update insight ${data.insightId.toString()} after fix pull request ${data.fix.id?.toString()} was decided: ${error}`,
      );
    }
  }

  private static operationLabelOf(
    baseline: PerformanceFixBaseline,
    serviceName: string | undefined,
  ): string {
    return describeOperation({ spanName: baseline.spanName, serviceName });
  }

  // The service's name, only needed when the whole service is measured.
  private static async serviceNameOf(
    fix: AIAgentTaskPullRequest,
    baseline: PerformanceFixBaseline,
  ): Promise<string | undefined> {
    if (baseline.spanName) {
      return undefined;
    }

    const service: Service | null = await ServiceService.findOneBy({
      query: {
        _id: baseline.serviceId,
        projectId: fix.projectId!,
      },
      select: { _id: true, name: true },
      props: { isRoot: true },
    });

    return service?.name || undefined;
  }
}
