import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import { AIRunStatusHelper } from "../../../../Types/AI/AIRunStatus";
import BadDataException from "../../../../Types/Exception/BadDataException";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Query from "../../../../Types/BaseDatabase/Query";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Services/AIRunService";
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

// What the person reads when it cannot start, by what stopped it.
const NOT_STARTED_MESSAGES: Partial<Record<InvestigationNotStartedCode, string>> =
  {
    ai_disabled:
      "OneUptime AI is switched off for this project. Turn it on in Project Settings > AI, then try again.",
    provider_missing:
      "This project has no AI provider to investigate with. Add one in Project Settings > AI > LLM Providers, then try again.",
    insufficient_ai_balance:
      "The project's AI balance is used up. Add AI credits in Project Settings > Billing, then try again.",
    project_daily_limit_reached:
      "The project reached its own daily AI limit. Try again tomorrow, or raise the limit in Project Settings > AI.",
  };

export default class InvestigationTryAgain {
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
      ? NOT_STARTED_MESSAGES[disabledReason]
      : undefined;

    if (refusal) {
      throw new BadDataException(refusal);
    }

    const runId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.projectId,
      ...(data.subjectType === "incident"
        ? { subjectIncidentId: data.subjectId }
        : { subjectAlertId: data.subjectId }),
      llmProviderId,
    });

    if (!runId) {
      throw new BadDataException(
        "The investigation could not start: the project's AI budget for today may be used up. Try again later.",
      );
    }

    logger.info(
      `AI: the investigation of ${noun} ${data.subjectId.toString()} was tried again as run ${runId.toString()}.`,
    );

    return runId;
  }
}
