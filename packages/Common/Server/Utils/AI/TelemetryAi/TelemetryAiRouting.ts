import AIInsightService from "../../../Services/AIInsightService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import InsightTriage, { InsightTriageResult } from "../SRE/Insights/Triage";
import ExceptionInsightFix from "./ExceptionInsightFix";
import ProfileInsightFix from "./ProfileInsightFix";
import { TelemetryAiFixResult } from "./TelemetryAiFix";
import TraceInsightFix from "./TraceInsightFix";
import LogInsightFix from "./LogInsightFix";
import TelemetryAiRules, { TelemetryAiRuleService } from "./TelemetryAiRules";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Project from "../../../../Models/DatabaseModels/Project";
import AIInsightStatus from "../../../../Types/AI/AIInsightStatus";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_MAX_PROBLEMS_PER_SWEEP,
  TelemetryAiLane,
  TelemetryAiLaneDefinition,
  TelemetryAiNextSteps,
  TelemetryAiWork,
  getStillFoundMinutes,
  getTelemetryAiFixVerdict,
  getTelemetryAiNextSteps,
} from "../../../../Types/AI/TelemetryAi";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT ONEUPTIME AI DOES, ON ITS OWN, WITH THE PROBLEMS A TELEMETRY LANE
 * FOUND (Types/AI/TelemetryAi): one look per lane per project, on the lane's
 * own scan tick, after its detectors filed what they found.
 *
 * The look reads the lane's open problems that are still being found and
 * still lack an investigation or a fix, decides for each - from Enable AI,
 * the lane's switch and the lane's AI rules, matched by the problem's
 * service - what OneUptime AI does now, and does it: the investigation (the
 * insight's triage, with the rules' LLM provider) and the fix (the lane's
 * own starter: for Profiles, a Code task in the repository that holds the
 * code - ProfileInsightFix). Each problem gets one investigation and one
 * fix, ever: a problem found again refreshes its insight and nothing more.
 * A fix that cannot start yet (no repository connected, a Runner offline,
 * the day's share opened) is simply looked at again on the next scan, while
 * the problem is still being found; "ask before fixing" leaves the fix to a
 * person, on the insight. A kind of problem whose fix waits for the
 * investigation's verdict (a failing operation, a new or rising exception)
 * opens its pull request on its own only once the investigation found the
 * code at fault - or, for an exception, an expected error to handle better.
 *
 * Never throws: one problem's failure is logged and the look goes on.
 */

// What one look did, for its log line and its tests.
export interface TelemetryAiSweepResult {
  problemsRead: number;
  investigationsStarted: number;
  fixesStarted: number;
  waiting: number;
  // Problems whose pull request waits for the investigation's verdict.
  waitingForVerdict: number;
}

// The fix starter of each lane: the pull request for one problem.
export type TelemetryAiFixStarter = (data: {
  insight: AIInsight;
  work: TelemetryAiWork;
}) => Promise<TelemetryAiFixResult>;

export const TELEMETRY_AI_FIX_STARTERS: Record<
  TelemetryAiLane,
  TelemetryAiFixStarter
> = {
  [TelemetryAiLane.Profile]: (data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<TelemetryAiFixResult> => {
    return ProfileInsightFix.start(data);
  },
  [TelemetryAiLane.Trace]: (data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<TelemetryAiFixResult> => {
    return TraceInsightFix.start(data);
  },
  [TelemetryAiLane.Exception]: (data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<TelemetryAiFixResult> => {
    return ExceptionInsightFix.start(data);
  },
  [TelemetryAiLane.Log]: (data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<TelemetryAiFixResult> => {
    return LogInsightFix.start(data);
  },
};

export default class TelemetryAiRouting {
  @CaptureSpan()
  public static async sweepLane(data: {
    project: Project;
    lane: TelemetryAiLane;
    now: Date;
  }): Promise<TelemetryAiSweepResult> {
    const result: TelemetryAiSweepResult = {
      problemsRead: 0,
      investigationsStarted: 0,
      fixesStarted: 0,
      waiting: 0,
      waitingForVerdict: 0,
    };

    const projectId: ObjectID | undefined = data.project.id || undefined;
    const definition: TelemetryAiLaneDefinition = TELEMETRY_AI_LANES[data.lane];

    // Strictly `=== false`, as every enableAi read: unset means on.
    const isAiEnabled: boolean = data.project.enableAi !== false;
    const isLaneOn: boolean = TelemetryAiRules.isLaneOn(
      data.project,
      data.lane,
    );

    if (!projectId || !isAiEnabled || !isLaneOn) {
      return result;
    }

    let problems: Array<AIInsight> = [];

    try {
      problems = await AIInsightService.findBy({
        query: {
          projectId,
          insightType: QueryHelper.any([...definition.insightTypes]),
          status: QueryHelper.any([
            AIInsightStatus.ActionRequired,
            AIInsightStatus.FixOpened,
          ]),
          lastSeenAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveMinutes(
              data.now,
              -1 * getStillFoundMinutes(data.lane),
            ),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          insightType: true,
          status: true,
          title: true,
          serviceName: true,
          telemetryServiceId: true,
          evidence: true,
          firstSeenAt: true,
          lastSeenAt: true,
          triageAiRunId: true,
          fixAiRunId: true,
          // What the investigation concluded, for a fix that waits on it.
          classification: true,
          triageCompletedAt: true,
        },
        sort: { lastSeenAt: SortOrder.Descending },
        limit: TELEMETRY_AI_MAX_PROBLEMS_PER_SWEEP,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `AI: could not read the ${data.lane} problems of project ${projectId.toString()}: ${error}`,
      );
      return result;
    }

    // Nothing left to do for a problem with both.
    const open: Array<AIInsight> = problems.filter(
      (problem: AIInsight): boolean => {
        return !problem.triageAiRunId || !problem.fixAiRunId;
      },
    );

    result.problemsRead = open.length;

    if (open.length === 0) {
      return result;
    }

    const rules: Array<AutoRemediationRule> | null =
      await TelemetryAiRules.readRules({ projectId, lane: data.lane });

    const serviceIds: Array<string> = open.map((problem: AIInsight): string => {
      return TelemetryAiRules.getServiceId(problem);
    });

    let services: Map<string, TelemetryAiRuleService> = new Map<
      string,
      TelemetryAiRuleService
    >();

    try {
      services = await TelemetryAiRules.readServices({ projectId, serviceIds });
    } catch (error) {
      logger.error(
        `AI: could not read the services of project ${projectId.toString()}'s ${data.lane} problems; matching them by service id alone: ${error}`,
      );
    }

    const workByService: Map<string, TelemetryAiWork> =
      TelemetryAiRules.decideForServices({
        isAiEnabled,
        isLaneOn,
        rules,
        serviceIds,
        services,
      });

    for (const problem of open) {
      try {
        const work: TelemetryAiWork | undefined = workByService.get(
          TelemetryAiRules.getServiceId(problem),
        );

        if (!work) {
          continue;
        }

        await TelemetryAiRouting.workOn({
          lane: data.lane,
          problem,
          work,
          now: data.now,
          result,
        });
      } catch (error) {
        logger.error(
          `AI: could not work on insight ${problem.id?.toString()} of project ${projectId.toString()} - continuing with the others: ${error}`,
        );
      }
    }

    logger.debug(
      `AI: ${data.lane} look for project ${projectId.toString()}: ${result.problemsRead} open, ${result.investigationsStarted} investigations and ${result.fixesStarted} fixes started, ${result.waiting} waiting, ${result.waitingForVerdict} waiting for a verdict.`,
    );

    return result;
  }

  private static async workOn(data: {
    lane: TelemetryAiLane;
    problem: AIInsight;
    work: TelemetryAiWork;
    now: Date;
    result: TelemetryAiSweepResult;
  }): Promise<void> {
    const problem: AIInsight = data.problem;

    if (!problem.id || !problem.firstSeenAt || !problem.lastSeenAt) {
      return;
    }

    const steps: TelemetryAiNextSteps = getTelemetryAiNextSteps({
      lane: data.lane,
      work: data.work,
      problem: {
        firstSeenAt: OneUptimeDate.fromString(problem.firstSeenAt),
        lastSeenAt: OneUptimeDate.fromString(problem.lastSeenAt),
        hasInvestigation: Boolean(problem.triageAiRunId),
        hasFix: Boolean(problem.fixAiRunId),
        isClosed: false,
        fixVerdict: getTelemetryAiFixVerdict({
          insightType: problem.insightType,
          hasTriageCompleted: Boolean(problem.triageCompletedAt),
          classification: problem.classification,
        }),
      },
      now: data.now,
    });

    if (steps.isWaiting) {
      data.result.waiting++;
      return;
    }

    if (steps.isWaitingForVerdict) {
      data.result.waitingForVerdict++;
    }

    if (steps.startInvestigation) {
      const triage: InsightTriageResult =
        await InsightTriage.enqueueInsightTriage({
          insight: problem,
          llmProviderId: data.work.llmProviderId || undefined,
        });

      if (triage.triageAiRunId) {
        data.result.investigationsStarted++;
      }
    }

    if (steps.startFix) {
      const fix: TelemetryAiFixResult = await TELEMETRY_AI_FIX_STARTERS[
        data.lane
      ]({ insight: problem, work: data.work });

      if (fix.taskId) {
        /*
         * Conditional: only an insight still without a fix takes this one,
         * so two looks at once can only ever attach one, and a person who
         * closed it meanwhile keeps it closed.
         */
        await AIInsightService.updateOneBy({
          query: {
            _id: problem.id.toString(),
            fixAiRunId: QueryHelper.isNull(),
            status: QueryHelper.any([
              AIInsightStatus.ActionRequired,
              AIInsightStatus.FixOpened,
            ]),
          },
          data: {
            status: AIInsightStatus.FixOpened,
            fixAiRunId: fix.taskId,
          },
          props: { isRoot: true },
        });

        data.result.fixesStarted++;
      } else if (fix.skip) {
        logger.debug(
          `AI: no pull request yet for insight ${problem.id.toString()}: ${fix.skip}${fix.detail ? ` (${fix.detail})` : ""}.`,
        );
      }
    }
  }
}
