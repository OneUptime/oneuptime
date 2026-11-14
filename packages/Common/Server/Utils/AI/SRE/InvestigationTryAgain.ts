import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import { AIRunStatusHelper } from "../../../../Types/AI/AIRunStatus";
import BadDataException from "../../../../Types/Exception/BadDataException";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Query from "../../../../Types/BaseDatabase/Query";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import ProjectAiDailyLimits from "../../../../Types/AI/ProjectAiDailyLimits";
import { getRecordAiTokenLimitMessage } from "../../../../Types/AI/RecordAiTokenLimit";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../../Utils/Project/ProjectBalance";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Services/AIRunService";
import { AutonomousBudgetStatus } from "../../../Services/AIService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AIInvestigationEngine from "./AIInvestigationEngine";
import AIInvestigationQueue from "./InvestigationQueue";
import InvestigationRules from "./InvestigationRules";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Try again for an incident's or alert's AI investigation (issue #6438).
 *
 * When the subject's last investigation did not finish - it failed, stopped
 * reporting progress, or expired in the queue - a person who may change the
 * subject starts it again from its AI card. It is a new run, queued exactly
 * as Ask AI's start_investigation queues one: one live run per subject at a
 * time, the LLM provider the subject's investigation rules pick, the queue's
 * own budget and concurrency gates. Like start_investigation, it does not
 * wait for the automatic lane's switch or severity floor - a person asked
 * for it - but it does not start while AI is off, without a provider to use,
 * or past the project's own limits, and says which.
 *
 * The caller checks who may (the AI investigation route: the one who may
 * change the incident or alert, canViewerStartInvestigation).
 */

export type InvestigationTryAgainSubjectType = "incident" | "alert";

/*
 * What the person reads when it cannot start, by what stopped it. It is said
 * to whoever pressed Try again, who may not be able to change what stopped
 * it, so it names who can (the shared wordings for the AI credits and the
 * daily AI limits).
 */
export const INVESTIGATION_NOT_STARTED_MESSAGES: Partial<
  Record<InvestigationNotStartedCode, string>
> = {
  ai_disabled:
    "OneUptime AI is switched off for this project. A project owner or someone with Manage Billing can turn it on in Project Settings > AI > AI Features.",
  provider_missing:
    "This project has no LLM provider to investigate with. Add one in Project Settings > AI > LLM Providers, then try again.",
  insufficient_ai_balance: PROJECT_AI_CREDITS_USED_UP_MESSAGE,
  project_daily_limit_reached: `The project reached its daily AI limit. OneUptime AI starts again at midnight UTC. ${ProjectAiDailyLimits.getWhoCanChangeSentence()}`,
};

// What Try again says when the queue gave no reason it could name.
export const INVESTIGATION_NOT_ENQUEUED_MESSAGE: string =
  "The investigation could not start: the project may have reached its daily AI limit, which resets at midnight UTC. Try again later.";

export default class InvestigationTryAgain {
  /*
   * Why the queue did not take the run, said to whoever pressed Try again.
   * The incident's (alert's) own daily AI token limit names that setting,
   * and a limit of 0 says it pauses the work until it is raised: waiting
   * for midnight does not lift it (#7157). Anything else the queue named
   * is said as the checks before it say it; the rest as before.
   */
  public static getNotEnqueuedMessage(data: {
    subjectType: InvestigationTryAgainSubjectType;
    notEnqueued: {
      code: InvestigationNotStartedCode;
      budget?: AutonomousBudgetStatus | undefined;
    } | null;
  }): string {
    if (data.notEnqueued?.code === "daily_budget_exhausted") {
      return getRecordAiTokenLimitMessage(
        data.subjectType,
        data.notEnqueued.budget,
      );
    }

    return (
      (data.notEnqueued &&
        INVESTIGATION_NOT_STARTED_MESSAGES[data.notEnqueued.code]) ||
      INVESTIGATION_NOT_ENQUEUED_MESSAGE
    );
  }

  // The latest investigation run of the subject, as the AI card reads it.
  public static buildLatestRunQuery(data: {
    projectId: ObjectID;
    subjectType: InvestigationTryAgainSubjectType;
    subjectId: ObjectID;
  }): Query<AIRun> {
    return {
      projectId: data.projectId,
      runType: AIRunType.Investigation,
      ...(data.subjectType === "incident"
        ? { triggeredByIncidentId: data.subjectId }
        : { triggeredByAlertId: data.subjectId }),
    };
  }

  /*
   * Start the subject's investigation again. Returns the new run's id, or
   * throws a BadDataException that says why it did not start.
   */
  @CaptureSpan()
  public static async tryAgain(data: {
    projectId: ObjectID;
    subjectType: InvestigationTryAgainSubjectType;
    subjectId: ObjectID;
  }): Promise<ObjectID> {
    const noun: string = data.subjectType;

    const latestRuns: Array<AIRun> = await AIRunService.findBy({
      query: this.buildLatestRunQuery(data),
      select: { _id: true, status: true },
      sort: { createdAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    const latestRun: AIRun | undefined = latestRuns[0];

    if (!latestRun) {
      throw new BadDataException(
        `This ${noun} has no investigation to try again.`,
      );
    }

    if (!AIRunStatusHelper.isTerminalStatus(latestRun.status!)) {
      throw new BadDataException(
        `This ${noun}'s investigation is queued or running already.`,
      );
    }

    if (!AIRunStatusHelper.didNotFinish(latestRun.status)) {
      throw new BadDataException(
        "Only an investigation that did not finish can be tried again.",
      );
    }

    const subject: {
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
    } =
      data.subjectType === "incident"
        ? { incidentId: data.subjectId }
        : { alertId: data.subjectId };

    const llmProviderId: ObjectID | undefined =
      await InvestigationRules.getSubjectLlmProviderId({
        projectId: data.projectId,
        ...subject,
      });

    const disabledReason: InvestigationNotStartedCode | null =
      await AIInvestigationEngine.getDisabledReasonForSubject({
        projectId: data.projectId,
        subjectType: data.subjectType === "incident" ? "Incident" : "Alert",
        getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
          return llmProviderId;
        },
      });

    const refusal: string | undefined = disabledReason
      ? INVESTIGATION_NOT_STARTED_MESSAGES[disabledReason]
      : undefined;

    if (refusal) {
      throw new BadDataException(refusal);
    }

    /*
     * Asked again inside the subject's lock, right before the run is
     * created: two people pressing Try again at once start it once.
     */
    let isStartedAlready: boolean = false;
    // What the queue said when it did not take the run, and the limit then.
    let notEnqueued: {
      code: InvestigationNotStartedCode;
      budget?: AutonomousBudgetStatus | undefined;
    } | null = null;

    const runId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.projectId,
      ...(data.subjectType === "incident"
        ? { subjectIncidentId: data.subjectId }
        : { subjectAlertId: data.subjectId }),
      llmProviderId,
      onNotEnqueued: async (
        code: InvestigationNotStartedCode,
        budget?: AutonomousBudgetStatus,
      ): Promise<void> => {
        notEnqueued = { code, budget };
      },
      admitInsideSubjectLock: async (): Promise<boolean> => {
        const liveRunCount: number = (
          await AIRunService.countBy({
            query: {
              ...this.buildLatestRunQuery(data),
              status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
            },
            props: { isRoot: true },
          })
        ).toNumber();

        isStartedAlready = liveRunCount > 0;

        return !isStartedAlready;
      },
    });

    if (!runId && isStartedAlready) {
      throw new BadDataException(
        `This ${noun}'s investigation is queued or running already.`,
      );
    }

    if (!runId) {
      throw new BadDataException(
        InvestigationTryAgain.getNotEnqueuedMessage({
          subjectType: data.subjectType,
          notEnqueued,
        }),
      );
    }

    logger.info(
      `AI: the investigation of ${noun} ${data.subjectId.toString()} was tried again as run ${runId.toString()}.`,
    );

    return runId;
  }
}
