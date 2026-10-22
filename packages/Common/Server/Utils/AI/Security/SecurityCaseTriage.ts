import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import AIRunService from "../../../Services/AIRunService";
import AIService from "../../../Services/AIService";
import ProjectService from "../../../Services/ProjectService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../SRE/InvestigationQueue";

/*
 * WHEN ONEUPTIME AI TRIAGES A SECURITY CASE, and the one way a triage is
 * started: an Investigation run on the AI queue (InvestigationQueue), with
 * the case as its subject, which SecurityCaseTriageRunner executes.
 *
 * Two ways in:
 *
 *   - automatically, when a detection opens a case (SecurityCaseIngest),
 *     while the project's "Triage new cases" switch is on
 *     (Project.enableAutomaticSecurityCaseTriage - on for new projects);
 *   - by a person, from the case's AI card ("Triage with AI", "Triage
 *     again"), whatever that switch says.
 *
 * Either way it needs what all of OneUptime AI needs, checked before any
 * run is recorded: AI on for the project (Project.enableAi, the project's
 * one AI switch), an LLM provider, AI credits where AI is billed, and room
 * under the project's own daily AI limits. The queue checks the daily
 * budget again, and the model call enforces every limit whatever was
 * checked here. A case has at most one triage queued or running at a time.
 */

export type SecurityCaseTriageNotStartedCode =
  | "ai_disabled"
  | "automatic_triage_disabled"
  | "provider_missing"
  | "insufficient_ai_balance"
  | "project_daily_limit_reached"
  | "already_triaging"
  | "not_enqueued"
  | "eligibility_check_failed";

/*
 * What each reason says, for the card and the API. The card words them in
 * the reader's language from the code; these are the English.
 */
export const SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES: Record<
  SecurityCaseTriageNotStartedCode,
  string
> = {
  ai_disabled:
    "AI is turned off for this project. Turn it on in Project Settings → AI → AI Features.",
  automatic_triage_disabled:
    "Triaging new cases automatically is turned off for this project.",
  provider_missing:
    "No LLM provider is set up for OneUptime AI. Add one in Project Settings → AI → LLM Providers.",
  insufficient_ai_balance:
    "The project is out of AI credits. Add credits in Project Settings → AI → AI Credits.",
  project_daily_limit_reached:
    "The project reached its daily AI limit. OneUptime AI starts again at midnight UTC.",
  already_triaging: "OneUptime AI is already triaging this case.",
  not_enqueued:
    "OneUptime AI could not start the triage right now. Try again in a few minutes.",
  eligibility_check_failed:
    "OneUptime AI could not check whether it can triage this case. Try again in a few minutes.",
};

export type SecurityCaseTriageStartResult =
  | { started: true; runId: ObjectID }
  | { started: false; code: SecurityCaseTriageNotStartedCode };

// The run statuses that mean a triage is on its way.
const ACTIVE_RUN_STATUSES: Array<AIRunStatus> = [
  AIRunStatus.Queued,
  AIRunStatus.Running,
];

export default class SecurityCaseTriage {
  /*
   * Why OneUptime AI cannot triage a case of this project now, or null when
   * it can. An automatic triage also needs the project's switch on.
   */
  @CaptureSpan()
  public static async getNotStartedReason(data: {
    projectId: ObjectID;
    automatic: boolean;
  }): Promise<SecurityCaseTriageNotStartedCode | null> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          enableAi: true,
          enableAutomaticSecurityCaseTriage: true,
          aiDailyTokenLimit: true,
          aiDailySpendLimitInUSD: true,
          aiDailyTokenLimitReachedAt: true,
          aiDailySpendLimitReachedAt: true,
        },
        props: { isRoot: true },
      });

      if (!project) {
        return "eligibility_check_failed";
      }

      if (project.enableAi === false) {
        return "ai_disabled";
      }

      if (
        data.automatic &&
        project.enableAutomaticSecurityCaseTriage !== true
      ) {
        return "automatic_triage_disabled";
      }

      const providerOrBalance:
        | "provider_missing"
        | "insufficient_ai_balance"
        | null = await AIInvestigationEngine.getProviderOrBalanceReason(
        data.projectId,
      );

      if (providerOrBalance) {
        return providerOrBalance;
      }

      if (
        await AIService.getReachedProjectDailyLimit({
          projectId: data.projectId,
          project,
        })
      ) {
        return "project_daily_limit_reached";
      }

      return null;
    } catch (error) {
      logger.error(
        `AI: could not check whether project ${data.projectId.toString()} can triage security cases: ${error}`,
      );
      return "eligibility_check_failed";
    }
  }

  /*
   * A detection opened this case: triage it when the project triages new
   * cases. Never throws - a case opens whether or not it is triaged.
   */
  @CaptureSpan()
  public static async triageNewCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<ObjectID | null> {
    try {
      const result: SecurityCaseTriageStartResult = await this.start({
        ...data,
        automatic: true,
      });

      if (!result.started) {
        logger.debug(
          `AI: not triaging new security case ${data.securityCaseId.toString()} - ${result.code}.`,
        );
        return null;
      }

      return result.runId;
    } catch (error) {
      logger.error(
        `AI: could not triage new security case ${data.securityCaseId.toString()}: ${error}`,
      );
      return null;
    }
  }

  /*
   * A person asked OneUptime AI to triage the case (again). Says why not
   * when it cannot.
   */
  @CaptureSpan()
  public static async startTriage(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<SecurityCaseTriageStartResult> {
    return await this.start({ ...data, automatic: false });
  }

  private static async start(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    automatic: boolean;
  }): Promise<SecurityCaseTriageStartResult> {
    const reason: SecurityCaseTriageNotStartedCode | null =
      await this.getNotStartedReason({
        projectId: data.projectId,
        automatic: data.automatic,
      });

    if (reason) {
      return { started: false, code: reason };
    }

    if (await this.findActiveRun(data)) {
      return { started: false, code: "already_triaging" };
    }

    const runId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.projectId,
      subjectSecurityCaseId: data.securityCaseId,
    });

    if (!runId) {
      return { started: false, code: "not_enqueued" };
    }

    return { started: true, runId };
  }

  // The case's triage that is queued or running, if there is one.
  public static async findActiveRun(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<AIRun | null> {
    return await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.Investigation,
        triggeredBySecurityCaseId: data.securityCaseId,
        status: new Includes(ACTIVE_RUN_STATUSES),
      },
      select: { _id: true, status: true },
      props: { isRoot: true },
    });
  }

  // The case's latest triage run, whatever its status.
  public static async findLatestRun(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<AIRun | null> {
    const runs: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.Investigation,
        triggeredBySecurityCaseId: data.securityCaseId,
      },
      select: {
        _id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        errorMessage: true,
        llmCallCount: true,
        toolCallCount: true,
        totalTokens: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return runs[0] || null;
  }
}
