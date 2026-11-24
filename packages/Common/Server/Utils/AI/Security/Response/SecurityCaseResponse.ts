import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import { InvestigationNotStartedCode } from "../../../../../Types/AI/InvestigationNotStartedReason";
import { SecurityCaseResponseNotStartedCode } from "../../../../../Types/SecurityCase/SecurityCaseAiWords";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../../Types/Date";
import PartialEntity from "../../../../../Types/Database/PartialEntity";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES,
  SecurityCaseAiLimits,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
  isSecurityCaseAiResponseActive,
  readSecurityCaseAiLimits,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseAiVerdict from "../../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseStage from "../../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStatuses from "../../../../../Utils/SecurityCase/SecurityCaseStatuses";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Infrastructure/Semaphore";
import AIRunService from "../../../../Services/AIRunService";
import ProjectService from "../../../../Services/ProjectService";
import SecurityCaseService from "../../../../Services/SecurityCaseService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import logger from "../../../Logger";
import { isSetupTestCase } from "../../../SecurityCase/SecurityCaseNotifications";
import SecurityCaseAiHold from "../../../SecurityCase/SecurityCaseAiHold";
import SecurityCaseHandOff from "../../../SecurityCase/SecurityCaseHandOff";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../../../SecurityCase/SecurityCaseValues";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import AIInvestigationQueue from "../../SRE/InvestigationQueue";
import SecurityCaseResponseLook from "./SecurityCaseResponseLook";
import SecurityCaseResponseProductOff from "./SecurityCaseResponseProductOff";

/*
 * WHEN ONEUPTIME AI WORKS A SECURITY CASE (#10352), and the one way a look
 * at a case is started: a SecurityCaseResponse run on the AI queue, which
 * SecurityCaseResponseRunner carries out.
 *
 *   - After a triage (SecurityCaseTriageRunner): a case it read as Likely
 *     Malicious is taken up, while the project lets OneUptime AI work cases
 *     (Project.enableAutomaticSecurityCaseResponse - on for new projects).
 *     A case whose data held text written to steer an AI goes to people at
 *     once, saying so.
 *   - A person's Respond with AI, on the case's AI card: any case OneUptime
 *     AI's triage read as Likely Malicious, Likely Benign or Likely False
 *     Positive, while the project lets it work cases.
 *   - The every-minute job (Workers, SecurityCases:WorkCasesWithAi): each
 *     case it works whose next look is due (SecurityCase.aiNextLookAt) -
 *     soon after something it waits on changes (SecurityCaseResponseNudge).
 *
 * One look queued or running per case at a time, under the case's lock: a
 * second start while one is on its way adds nothing. Whatever stops
 * OneUptime AI on a case it was going to work - AI off, no credits,
 * Security Events switched off on the server - hands the case to people,
 * saying why: it never stands down quietly. While Security Events is off
 * no look starts, and every case it works goes to people within a minute
 * (SecurityCaseResponseProductOff, #10816).
 */

/*
 * Why OneUptime AI does not work a case, and what each reason says: shared
 * words (Types/SecurityCase/SecurityCaseAiWords), so the card says them in
 * the reader's language.
 */
export type { SecurityCaseResponseNotStartedCode } from "../../../../../Types/SecurityCase/SecurityCaseAiWords";
export { SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES } from "../../../../../Types/SecurityCase/SecurityCaseAiWords";

export type SecurityCaseResponseStartResult =
  | { started: true; runId: ObjectID }
  | { started: false; code: SecurityCaseResponseNotStartedCode };

// The run statuses that mean a look is on its way.
const ACTIVE_RUN_STATUSES: Array<AIRunStatus> = [
  AIRunStatus.Queued,
  AIRunStatus.Running,
];

// The most cases the every-minute job starts a look at in one go.
export const SECURITY_CASE_AI_DUE_LOOKS_PER_TICK: number = 50;

/*
 * A case the job started a look at is not read again for this long: the
 * look sets its next one when it ends.
 */
export const SECURITY_CASE_AI_LOOK_LEASE_MINUTES: number = 5;

// The case's start lock: held while one look is checked and queued.
const START_LOCK_NAMESPACE: string = "SecurityCaseResponseStart";

// The project's columns the gates read.
const PROJECT_SELECT: {
  _id: true;
  enableAi: true;
  enableAutomaticSecurityCaseResponse: true;
  aiDailyTokenLimit: true;
  aiDailySpendLimitInUSD: true;
  aiDailyTokenLimitReachedAt: true;
  aiDailySpendLimitReachedAt: true;
} = {
  _id: true,
  enableAi: true,
  enableAutomaticSecurityCaseResponse: true,
  aiDailyTokenLimit: true,
  aiDailySpendLimitInUSD: true,
  aiDailyTokenLimitReachedAt: true,
  aiDailySpendLimitReachedAt: true,
};

const GATE_HAND_OFFS: Partial<
  Record<SecurityCaseResponseNotStartedCode, SecurityCaseHandOffReason>
> = {
  ai_disabled: SecurityCaseHandOffReason.AiOff,
  response_disabled: SecurityCaseHandOffReason.AiOff,
  product_off: SecurityCaseHandOffReason.ProductOff,
  provider_missing: SecurityCaseHandOffReason.NoLlmProvider,
  insufficient_ai_balance: SecurityCaseHandOffReason.OutOfCredits,
  project_daily_limit_reached: SecurityCaseHandOffReason.OutOfCredits,
};

export default class SecurityCaseResponse {
  /*
   * Why OneUptime AI cannot work a case of this project now, or null when
   * it can: AI on, for cases too, Security Events on on the server, a
   * provider, credits and room under the project's daily AI limits.
   */
  @CaptureSpan()
  public static async getNotStartedReason(data: {
    projectId: ObjectID;
  }): Promise<SecurityCaseResponseNotStartedCode | null> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: PROJECT_SELECT,
        props: { isRoot: true },
      });

      if (!project) {
        return "eligibility_check_failed";
      }

      if (project.enableAi === false) {
        return "ai_disabled";
      }

      const limits: SecurityCaseAiLimits = readSecurityCaseAiLimits(project);

      if (!limits.isOn) {
        return "response_disabled";
      }

      // Switched off on the server (#10816): none of the product's work starts.
      if (await SecurityCaseResponseProductOff.isOff()) {
        return "product_off";
      }

      switch (await SecurityCaseResponseLook.getAiGate({ project, limits })) {
        case SecurityCaseHandOffReason.NoLlmProvider:
          return "provider_missing";
        case SecurityCaseHandOffReason.OutOfCredits:
          return "insufficient_ai_balance";
        case SecurityCaseHandOffReason.AiOff:
          return "ai_disabled";
        case SecurityCaseHandOffReason.CannotTell:
          return "eligibility_check_failed";
        default:
          return null;
      }
    } catch (error) {
      logger.error(
        `SecurityCaseResponse: could not check whether project ${data.projectId.toString()} can work security cases: ${error}`,
      );
      return "eligibility_check_failed";
    }
  }

  /*
   * A triage of the case just recorded its read (SecurityCaseTriageRunner).
   * Never throws: the triage is recorded either way.
   */
  @CaptureSpan()
  public static async startAfterTriage(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    verdict: SecurityCaseAiVerdict;
    // The case's data held text written to steer an AI.
    isSteeringTextFound: boolean;
  }): Promise<void> {
    try {
      const reason: SecurityCaseResponseNotStartedCode | null =
        await this.getNotStartedReason({ projectId: data.projectId });

      // The project does not let OneUptime AI work cases: nothing of its own to hand over.
      if (reason === "response_disabled" || reason === "ai_disabled") {
        return;
      }

      const securityCase: SecurityCase | null = await this.readCase(data);

      if (
        !securityCase ||
        isSetupTestCase(securityCase) ||
        securityCase.closedAt
      ) {
        return;
      }

      // Text written to steer an AI: the case goes to people at once.
      if (data.isSteeringTextFound) {
        await SecurityCaseHandOff.handToPeople({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          reason: SecurityCaseHandOffReason.SteeringText,
        });
        return;
      }

      if (data.verdict !== SecurityCaseAiVerdict.LikelyMalicious) {
        return;
      }

      const handOff: SecurityCaseHandOffReason | undefined = reason
        ? GATE_HAND_OFFS[reason]
        : undefined;

      // It would work the case, but cannot: people are told why.
      if (handOff) {
        await SecurityCaseHandOff.handToPeople({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          reason: handOff,
        });
        return;
      }

      if (
        reason ||
        isSecurityCaseAiResponseActive(securityCase.aiResponseState)
      ) {
        return;
      }

      await this.startLook({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        isFirstLook: true,
      });
    } catch (error) {
      logger.error(
        `SecurityCaseResponse: could not take up security case ${data.securityCaseId.toString()} after its triage: ${error}`,
      );
    } finally {
      /*
       * A case OneUptime AI responds first to (#10353): a triage that will
       * not have it work the case - not malicious, text written to steer an
       * AI - hands the case to people now. Never throws.
       */
      await SecurityCaseAiHold.reviewSoon({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
      });
    }
  }

  /*
   * A person asked OneUptime AI to work the case (Respond with AI). Says why
   * not when it cannot: the case needs OneUptime AI's read of it, and one
   * that leaves it nothing to stand on - text written to steer an AI, the
   * project's highest priority, a read that could not tell - is a person's.
   */
  @CaptureSpan()
  public static async startForPerson(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<SecurityCaseResponseStartResult> {
    const reason: SecurityCaseResponseNotStartedCode | null =
      await this.getNotStartedReason({ projectId: data.projectId });

    if (reason) {
      return { started: false, code: reason };
    }

    const securityCase: SecurityCase | null = await this.readCase(data);

    if (!securityCase) {
      return { started: false, code: "eligibility_check_failed" };
    }

    const caseReason: SecurityCaseResponseNotStartedCode | null =
      await this.getCaseNotStartedReason(securityCase);

    if (caseReason) {
      return { started: false, code: caseReason };
    }

    const runId: ObjectID | null = await this.startLook({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      isFirstLook: true,
    });

    if (!runId) {
      return { started: false, code: "not_enqueued" };
    }

    return { started: true, runId };
  }

  // What about the case itself stops a person's Respond with AI.
  public static async getCaseNotStartedReason(
    securityCase: SecurityCase,
  ): Promise<SecurityCaseResponseNotStartedCode | null> {
    if (securityCase.closedAt) {
      return "case_closed";
    }

    if (isSecurityCaseAiResponseActive(securityCase.aiResponseState)) {
      return "already_working";
    }

    if (securityCase.aiTriagePromptInjectionSuspected === true) {
      return "steering_text";
    }

    if (!securityCase.aiVerdict) {
      return "not_triaged";
    }

    if (securityCase.aiVerdict === SecurityCaseAiVerdict.Inconclusive) {
      return "inconclusive";
    }

    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(securityCase.projectId!);

    if (
      SecurityCaseStatuses.getStage(
        values.statuses,
        securityCase.securityCaseStatusId,
      ) === SecurityCaseStage.Closed
    ) {
      return "case_closed";
    }

    if (
      SecurityCaseResponseLook.toResponderCase({
        securityCase,
        values,
        stage: SecurityCaseStage.New,
      }).isAtHighestPriority
    ) {
      return "highest_priority";
    }

    return null;
  }

  /*
   * The every-minute job: a look at each case OneUptime AI works whose next
   * look is due, oldest first. Returns how many it started.
   */
  @CaptureSpan()
  public static async startDueLooks(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    /*
     * Security Events switched off on the server (#10816): no look starts,
     * and every case OneUptime AI works goes to people instead, saying why -
     * whenever its next look was due (SecurityCaseResponseProductOff).
     */
    if (await SecurityCaseResponseProductOff.isOff()) {
      await SecurityCaseResponseProductOff.stopEveryCase(now);
      return 0;
    }

    const due: Array<SecurityCase> = await SecurityCaseService.findBy({
      query: {
        aiNextLookAt: QueryHelper.lessThanEqualTo(now),
        aiResponseState: new Includes([
          ...SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES,
        ]),
      },
      select: { _id: true, projectId: true, aiNextLookAt: true },
      sort: { aiNextLookAt: SortOrder.Ascending },
      skip: 0,
      limit: SECURITY_CASE_AI_DUE_LOOKS_PER_TICK,
      props: { isRoot: true },
    });

    let started: number = 0;

    for (const securityCase of due) {
      if (!securityCase.id || !securityCase.projectId) {
        continue;
      }

      try {
        // Leased, so the next tick does not start it again while it is queued.
        const isLeased: boolean =
          await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
            id: securityCase.id,
            data: {
              aiNextLookAt: OneUptimeDate.addRemoveMinutes(
                now,
                SECURITY_CASE_AI_LOOK_LEASE_MINUTES,
              ),
            } as unknown as PartialEntity<SecurityCase>,
            expectedData: {
              aiNextLookAt: securityCase.aiNextLookAt,
            } as unknown as PartialEntity<SecurityCase>,
            skipUpdateDateColumn: true,
          });

        if (!isLeased) {
          continue;
        }

        if (
          await this.startLook({
            projectId: securityCase.projectId,
            securityCaseId: securityCase.id,
            isFirstLook: false,
          })
        ) {
          started++;
        }
      } catch (error) {
        logger.error(
          `SecurityCaseResponse: could not start a look at security case ${securityCase.id.toString()}: ${error}`,
        );
      }
    }

    return started;
  }

  /*
   * One look at the case, queued - unless one is already on its way.
   * Under the case's start lock, so two starts at once queue one look. A
   * first look marks the case as OneUptime AI's to work. A look the queue
   * will not take - no credits, a product switched off - hands the case to
   * people, saying why.
   */
  public static async startLook(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    isFirstLook: boolean;
  }): Promise<ObjectID | null> {
    /*
     * Security Events switched off on the server (#10816): the queue would
     * take no look, quietly. None starts, the case is not marked as
     * OneUptime AI's, and it goes to people, saying why.
     */
    if (await SecurityCaseResponseProductOff.isOff()) {
      await SecurityCaseResponseProductOff.stopCase({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
      });
      return null;
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.securityCaseId.toString(),
        namespace: START_LOCK_NAMESPACE,
        lockTimeout: 15000,
        acquireTimeout: 5000,
      });
    } catch {
      // Another start of the case holds it: that one queues the look.
      return null;
    }

    try {
      if (await this.findActiveRun(data)) {
        return null;
      }

      if (data.isFirstLook) {
        await SecurityCaseService.updateColumnsByIdWithoutHooks({
          id: data.securityCaseId,
          data: {
            aiResponseState: SecurityCaseAiResponseState.Working,
            aiHandOffReason: null,
            aiNextLookAt: OneUptimeDate.addRemoveMinutes(
              OneUptimeDate.getCurrentDate(),
              SECURITY_CASE_AI_LOOK_LEASE_MINUTES,
            ),
          } as unknown as PartialEntity<SecurityCase>,
        });
      }

      let notEnqueued: InvestigationNotStartedCode | null = null;

      const runId: ObjectID | null = await AIInvestigationQueue.enqueue({
        projectId: data.projectId,
        subjectSecurityCaseId: data.securityCaseId,
        isSecurityCaseResponse: true,
        onNotEnqueued: async (
          code: InvestigationNotStartedCode,
        ): Promise<void> => {
          notEnqueued = code;
        },
      });

      if (
        !runId &&
        (notEnqueued === "daily_budget_exhausted" ||
          notEnqueued === "project_daily_limit_reached")
      ) {
        await SecurityCaseHandOff.handToPeople({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          reason: SecurityCaseHandOffReason.OutOfCredits,
        });
      }

      return runId;
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        logger.error(
          `SecurityCaseResponse: could not release the start lock of case ${data.securityCaseId.toString()}: ${error}`,
        );
      }
    }
  }

  // The case's look that is queued or running, if there is one.
  public static async findActiveRun(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<AIRun | null> {
    return await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.SecurityCaseResponse,
        triggeredBySecurityCaseId: data.securityCaseId,
        status: new Includes(ACTIVE_RUN_STATUSES),
      },
      select: { _id: true, status: true },
      props: { isRoot: true },
    });
  }

  // The case's latest look, whatever its status.
  public static async findLatestRun(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<AIRun | null> {
    const runs: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.SecurityCaseResponse,
        triggeredBySecurityCaseId: data.securityCaseId,
      },
      select: {
        _id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        errorMessage: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return runs[0] || null;
  }

  private static async readCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<SecurityCase | null> {
    return await SecurityCaseService.findOneBy({
      query: { _id: data.securityCaseId, projectId: data.projectId },
      select: {
        _id: true,
        projectId: true,
        groupingKey: true,
        closedAt: true,
        securityCaseStatusId: true,
        securityCasePriorityId: true,
        aiVerdict: true,
        aiSuggestedSecurityCasePriorityId: true,
        aiTriagePromptInjectionSuspected: true,
        aiResponseState: true,
        aiTookCaseAt: true,
        createdAt: true,
        lastDetectedAt: true,
      },
      props: { isRoot: true },
    });
  }
}
