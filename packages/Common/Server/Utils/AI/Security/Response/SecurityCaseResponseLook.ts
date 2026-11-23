import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityBlock from "../../../../../Models/DatabaseModels/SecurityBlock";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityCasePriority from "../../../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStepCheck from "../../../../../Models/DatabaseModels/SecurityCaseStepCheck";
import SecurityCaseTask from "../../../../../Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybook from "../../../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../../../Models/DatabaseModels/SecurityPlaybookRun";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { Green500 } from "../../../../../Types/BrandColors";
import OneUptimeDate from "../../../../../Types/Date";
import PartialEntity from "../../../../../Types/Database/PartialEntity";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityBlockState } from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_CASE_AI_OPEN_ACTION_STATUSES,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiDecisionKind,
  SecurityCaseAiLimits,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
  readSecurityCaseAiLimits,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import { toSecurityCaseAiActionEvidenceJson } from "../../../../../Types/SecurityCase/SecurityCaseAiActionEvidence";
import SecurityCaseAiVerdict from "../../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import {
  SecurityCaseMatchesJson,
  getOpeningMatchedDetection,
} from "../../../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "../../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../../../Types/SecurityCase/SecurityCaseVerdict";
import { readSecurityEntities } from "../../../../../Types/SecurityCase/SecurityEntity";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetState,
  readStepResults,
} from "../../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import {
  HOST_CONTAINMENT_ACTIONS,
  USER_CONTAINMENT_ACTIONS,
  buildResponsePlan,
  findPlaybookDoing,
  readPlaybookRuns,
} from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanBuilder";
import {
  isSecurityCaseTaken,
  readResponsePlaybooks,
  readResponseStepChecks,
  readResponseTasks,
} from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanInputs";
import {
  ResponsePlan,
  ResponsePlaybook,
  ResponseStep,
} from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import SecurityCasePriorities from "../../../../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "../../../../../Utils/SecurityCase/SecurityCaseStatuses";
import AIService from "../../../../Services/AIService";
import ProjectService from "../../../../Services/ProjectService";
import SecurityBlockService from "../../../../Services/SecurityBlockService";
import SecurityCaseAiActionService from "../../../../Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Services/SecurityCaseService";
import SecurityCaseStepCheckService from "../../../../Services/SecurityCaseStepCheckService";
import SecurityCaseTaskService from "../../../../Services/SecurityCaseTaskService";
import SecurityPlaybookRunService from "../../../../Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../../../Services/SecurityPlaybookService";
import { SecurityCaseFeedEventType } from "../../../../../Models/DatabaseModels/SecurityCaseFeed";
import logger from "../../../Logger";
import ProductBrandingText from "../../../ProductBrandingText";
import SecurityBlockDestinations from "../../../SecurityBlocklist/SecurityBlockDestinations";
import SecurityCaseMatches from "../../../SecurityCase/Context/SecurityCaseMatches";
import SecurityCaseHandOff from "../../../SecurityCase/SecurityCaseHandOff";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../../../SecurityCase/SecurityCaseValues";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import AIInvestigationEngine from "../../SRE/AIInvestigationEngine";
import SecurityCaseAiEdgeTrial from "./SecurityCaseAiEdgeTrial";
import SecurityCaseAiTrackRecordReader, {
  SECURITY_CASE_AI_TRACKED_STEP_KINDS,
} from "./SecurityCaseAiTrackRecordReader";
import { buildSecurityCaseClosingReport } from "./SecurityCaseClosingReport";
import {
  ResponderCase,
  ResponderInput,
  ResponderIntent,
  ResponderLogRow,
  ResponderPlan,
  ResponderWait,
  planSecurityCaseResponse,
} from "./SecurityCaseResponsePlanner";
import SecurityCaseResponseProductOff, {
  SecurityCaseProductOffStop,
} from "./SecurityCaseResponseProductOff";
import SecurityCaseResponseToolkit, {
  ToolResult,
  ToolkitCase,
} from "./SecurityCaseResponseToolkit";

/*
 * ONE LOOK OF ONEUPTIME AI'S AT A CASE IT WORKS (#10352): what one run of
 * SecurityCaseResponseRunner does.
 *
 *  1. Read the case, what the project lets OneUptime AI do
 *     (Types/SecurityCase/SecurityCaseAi), and whether it may work at all:
 *     AI on, for cases too, a provider, credits, room under the daily
 *     limits.
 *  2. Read how what it started went - each step of its own the playbook
 *     engine ran, approved, turned down, failed or undid - and write it on
 *     its log, before deciding anything new.
 *  3. Read the case's Response Plan as OneUptime's checks see it, built
 *     without the triage's report (SubjectReadersOnlyGuard).
 *  4. Plan the look (SecurityCaseResponsePlanner) and carry it out
 *     (SecurityCaseResponseToolkit), the most urgent step first.
 *  5. Hand the case to people when the plan says so, or say where it stands
 *     - working, or waiting for people - and when it looks again: soon after
 *     a step of its own, when a check is due, when the quiet window before
 *     a close ends. Something it waits on changing looks at once
 *     (SecurityCaseResponseNudge).
 *
 * A case handed to people is theirs (#10816): a look claimed after a
 * hand-off - queued before it, or held in the queue while Security Events
 * was switched off - does nothing, and only Respond with AI takes the case
 * up again. Before each step it asks whether it may still go on: Security
 * Events still on (SecurityCaseResponseProductOff), and the case not handed
 * over since the look began - Take Over stops it there. Where it stands
 * once a look is done never undoes a hand-off made while it looked.
 *
 * Everything is read and written as OneUptime (root), with the project and
 * the case named in every query: the responder is a system actor, and every
 * change it makes goes through the engine, which records it as OneUptime
 * AI's.
 */

// When OneUptime AI looks again, by what it waits for.
export const SECURITY_CASE_AI_NEXT_LOOK_MINUTES: Readonly<
  Record<ResponderWait, number>
> = {
  [ResponderWait.Engine]: 2,
  [ResponderWait.Check]: 10,
  // An approval says itself when it is decided: this is only a safety net.
  [ResponderWait.Approval]: 6 * 60,
  [ResponderWait.Fix]: 6 * 60,
  [ResponderWait.QuietWindow]: 24 * 60,
};

// After carrying something out, it looks again this soon to go on.
export const SECURITY_CASE_AI_GO_ON_MINUTES: number = 2;

// A row Doing with no run this long - a look stopped part way - is settled.
export const SECURITY_CASE_AI_INTERRUPTED_MINUTES: number = 10;

// The most rows of a case's log a look reads.
export const SECURITY_CASE_AI_LOG_LIMIT: number = 200;

export interface LookOutcome {
  handedOff: SecurityCaseHandOffReason | null;
  carriedOut: number;
  waits: Array<ResponderWait>;
  isFinished: boolean;
  nextLookAt: Date | null;
  /*
   * The case was handed to people before the look, or while it looked - a
   * person's Take Over, Security Events switched off (#10816): it stopped,
   * and left the case to them.
   */
  isNoLongerWorking: boolean;
}

// Why a look stops before its next step (#10816).
export enum LookStop {
  // Security Events was switched off on the server: the case goes to people.
  ProductOff = "ProductOff",
  // The case was handed to people since the look began: it is theirs.
  HandedOver = "HandedOver",
}

/*
 * The states a look leaves the case in its own once it is done: still
 * worked, or closed while it looked - looked at once more, and finished
 * then. Never a case handed to people meanwhile (#10816).
 */
const LOOK_END_FROM_STATES: ReadonlyArray<SecurityCaseAiResponseState> = [
  SecurityCaseAiResponseState.Working,
  SecurityCaseAiResponseState.WaitingForPeople,
  SecurityCaseAiResponseState.Finished,
];

const CASE_SELECT: {
  _id: true;
  projectId: true;
  caseNumberWithPrefix: true;
  title: true;
  entities: true;
  mitreTactics: true;
  mitreTechniques: true;
  securityCaseStatusId: true;
  securityCasePriorityId: true;
  assignedToUserId: true;
  incidentId: true;
  aiVerdict: true;
  aiSuggestedSecurityCasePriorityId: true;
  aiSuggestedPlaybookId: true;
  aiTriagePromptInjectionSuspected: true;
  aiResponseState: true;
  aiTookCaseAt: true;
  createdAt: true;
  firstDetectedAt: true;
  lastDetectedAt: true;
  detectionCount: true;
  closedAt: true;
} = {
  _id: true,
  projectId: true,
  caseNumberWithPrefix: true,
  title: true,
  entities: true,
  mitreTactics: true,
  mitreTechniques: true,
  securityCaseStatusId: true,
  securityCasePriorityId: true,
  assignedToUserId: true,
  incidentId: true,
  aiVerdict: true,
  aiSuggestedSecurityCasePriorityId: true,
  aiSuggestedPlaybookId: true,
  aiTriagePromptInjectionSuspected: true,
  aiResponseState: true,
  aiTookCaseAt: true,
  createdAt: true,
  firstDetectedAt: true,
  lastDetectedAt: true,
  detectionCount: true,
  closedAt: true,
};

// The project's columns a look reads: whether it may work, and within what.
const PROJECT_SELECT: {
  _id: true;
  enableAi: true;
  enableAutomaticSecurityCaseResponse: true;
  securityCaseAiCaseMode: true;
  securityCaseAiEdgeMode: true;
  securityCaseAiAccountsMode: true;
  securityCaseAiHostsMode: true;
  securityCaseAiCodeMode: true;
  securityCaseAiCloseMode: true;
  securityCaseAiOnItsOwnStamps: true;
  aiDailyTokenLimit: true;
  aiDailySpendLimitInUSD: true;
  aiDailyTokenLimitReachedAt: true;
  aiDailySpendLimitReachedAt: true;
} = {
  _id: true,
  enableAi: true,
  enableAutomaticSecurityCaseResponse: true,
  securityCaseAiCaseMode: true,
  securityCaseAiEdgeMode: true,
  securityCaseAiAccountsMode: true,
  securityCaseAiHostsMode: true,
  securityCaseAiCodeMode: true,
  securityCaseAiCloseMode: true,
  securityCaseAiOnItsOwnStamps: true,
  aiDailyTokenLimit: true,
  aiDailySpendLimitInUSD: true,
  aiDailyTokenLimitReachedAt: true,
  aiDailySpendLimitReachedAt: true,
};

// What a case's log row carries for a look.
const ACTION_SELECT: {
  _id: true;
  kind: true;
  status: true;
  reason: true;
  stepKey: true;
  target: true;
  securityPlaybookRunId: true;
  report: true;
  askedAt: true;
  doneAt: true;
  createdAt: true;
} = {
  _id: true,
  kind: true,
  status: true,
  reason: true,
  stepKey: true,
  target: true,
  securityPlaybookRunId: true,
  report: true,
  askedAt: true,
  doneAt: true,
  createdAt: true,
};

function getAiName(): string {
  return `${ProductBrandingText.getProductName()} AI`;
}

export default class SecurityCaseResponseLook {
  @CaptureSpan()
  public static async look(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    aiRunId: ObjectID;
    now?: Date | undefined;
  }): Promise<LookOutcome> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: CASE_SELECT,
        props: { isRoot: true },
      });

    if (!securityCase?.id) {
      throw new NotFoundException("Security case not found.");
    }

    /*
     * Handed to people since this look was queued (#10816): the case is
     * theirs, and the look does nothing - however long it waited in the
     * queue, as one does while Security Events is switched off. Only
     * Respond with AI takes the case up again.
     */
    if (
      securityCase.aiResponseState ===
      SecurityCaseAiResponseState.HandedToPeople
    ) {
      return this.noLongerWorking(0);
    }

    const [project, values]: [Project | null, ProjectSecurityCaseValues] =
      await Promise.all([
        ProjectService.findOneById({
          id: data.projectId,
          select: PROJECT_SELECT,
          props: { isRoot: true },
        }),
        SecurityCaseValues.getForProject(data.projectId),
      ]);

    const limits: SecurityCaseAiLimits = readSecurityCaseAiLimits(project);
    const stage: SecurityCaseStage =
      SecurityCaseStatuses.getStage(
        values.statuses,
        securityCase.securityCaseStatusId,
      ) || SecurityCaseStage.New;

    // What it started, as it went - before anything new is decided.
    const rows: Array<SecurityCaseAiAction> = await this.reconcile({
      projectId: data.projectId,
      securityCase,
      now,
    });

    /*
     * Security Events switched off on the server (#10816): nothing new
     * starts. What it started is recorded above as it went - the engine
     * finishes or undoes it as usual - and the case goes to people, saying
     * why (SecurityCaseResponseProductOff).
     */
    if (await SecurityCaseResponseProductOff.isOff()) {
      return await this.stopWhileProductOff({
        projectId: data.projectId,
        securityCaseId: securityCase.id,
        aiRunId: data.aiRunId,
        carriedOut: 0,
        stepKeys: [],
        stepTitles: {},
        now,
      });
    }

    const reads: PlanReads = await this.readPlan({
      projectId: data.projectId,
      securityCase,
      values,
      stage,
      now,
    });

    const caseBlocks: Array<SecurityBlock> = await SecurityBlockService.findBy({
      query: {
        projectId: data.projectId,
        securityCaseId: securityCase.id,
        state: SecurityBlockState.Active,
      },
      select: { _id: true, value: true, expiresAt: true },
      skip: 0,
      limit: 50,
      props: { isRoot: true },
    });

    const input: ResponderInput = {
      now,
      limits,
      hasScannersPolicyFinishedTrial:
        await SecurityCaseAiEdgeTrial.hasScannersPolicyFinishedTrial({
          projectId: data.projectId,
          now,
        }),
      aiGate: await this.getAiGate({ project, limits }),
      securityCase: this.toResponderCase({ securityCase, values, stage }),
      plan: reads.plan,
      log: this.toCurrentEpoch(rows).map(toLogRow),
      hasBlockDestination: await this.hasBlockDestination(data.projectId),
      canContainUsers: Boolean(
        findPlaybookDoing({
          playbooks: reads.playbooks,
          actions: USER_CONTAINMENT_ACTIONS,
        }),
      ),
      canContainHosts: Boolean(
        findPlaybookDoing({
          playbooks: reads.playbooks,
          actions: HOST_CONTAINMENT_ACTIONS,
        }),
      ),
      caseBlocks: caseBlocks
        .filter((block: SecurityBlock): boolean => {
          return Boolean(block.id && block.value);
        })
        .map((block: SecurityBlock): { id: string; value: string } => {
          return { id: block.id!.toString(), value: block.value! };
        }),
    };

    const planned: ResponderPlan = planSecurityCaseResponse(input);
    const stepsByKey: Map<string, ResponseStep> = new Map(
      reads.plan.steps.map((step: ResponseStep): [string, ResponseStep] => {
        return [step.key, step];
      }),
    );
    const toolkit: ToolkitCase = {
      projectId: data.projectId,
      securityCase,
      aiRunId: data.aiRunId,
      limits,
      values,
      matches: reads.matches,
      stepsByKey,
      now,
    };

    let handOff: SecurityCaseHandOffReason | null = null;
    let handOffStepKeys: Array<string> = [];
    let carriedOut: number = 0;

    for (const [index, intent] of planned.intents.entries()) {
      /*
       * Before each step (#10816): Security Events still on, and the case
       * still OneUptime AI's. Switched off, the steps it was about to take
       * are left for a person; taken over, the case is the person's.
       */
      const stop: LookStop | null = await this.getStop({
        projectId: data.projectId,
        securityCaseId: securityCase.id,
      });

      if (stop === LookStop.ProductOff) {
        // The plan's steps it had not got to: the Response Plan's words for them.
        const left: Array<string> = getStepKeys(
          planned.intents.slice(index),
        ).filter((key: string): boolean => {
          return stepsByKey.has(key);
        });

        return await this.stopWhileProductOff({
          projectId: data.projectId,
          securityCaseId: securityCase.id,
          aiRunId: data.aiRunId,
          carriedOut,
          stepKeys: left,
          stepTitles: this.getStepTitles(toolkit, left),
          now,
        });
      }

      if (stop === LookStop.HandedOver) {
        return this.noLongerWorking(carriedOut);
      }

      const prepared: ResponderIntent = await this.prepare({
        intent,
        toolkit,
        reads,
        caseBlocks,
        rows,
      });
      const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
        toolkit,
        prepared,
      );

      carriedOut++;

      if (result.handOff) {
        handOff = result.handOff;
        handOffStepKeys = [intent.stepKey];
        break;
      }
    }

    if (!handOff && planned.handOff) {
      handOff = planned.handOff.reason;
      handOffStepKeys = planned.handOff.stepKeys;
    }

    if (handOff) {
      await SecurityCaseHandOff.handToPeople({
        projectId: data.projectId,
        securityCaseId: securityCase.id,
        reason: handOff,
        stepKeys: handOffStepKeys,
        stepTitles: this.getStepTitles(toolkit, handOffStepKeys),
        aiRunId: data.aiRunId,
        now,
      });

      return {
        handedOff: handOff,
        carriedOut,
        waits: planned.waits,
        isFinished: false,
        nextLookAt: null,
        isNoLongerWorking: false,
      };
    }

    if (planned.isFinished || stage === SecurityCaseStage.Closed) {
      if (
        !(await this.setWhereItStands({
          projectId: data.projectId,
          securityCaseId: securityCase.id,
          state: SecurityCaseAiResponseState.Finished,
          nextLookAt: null,
        }))
      ) {
        return this.noLongerWorking(carriedOut);
      }

      return {
        handedOff: null,
        carriedOut,
        waits: [],
        isFinished: true,
        nextLookAt: null,
        isNoLongerWorking: false,
      };
    }

    const isWaitingForPeople: boolean =
      planned.waits.includes(ResponderWait.Approval) ||
      planned.intents.some((intent: ResponderIntent): boolean => {
        return intent.decision === SecurityCaseAiDecisionKind.Ask;
      });
    const nextLookAt: Date = this.getNextLookAt({
      now,
      waits: planned.waits,
      quietUntil: planned.quietUntil,
      hasCarriedOut: planned.intents.some(
        (intent: ResponderIntent): boolean => {
          return intent.decision !== SecurityCaseAiDecisionKind.Leave;
        },
      ),
    });

    if (
      !(await this.setWhereItStands({
        projectId: data.projectId,
        securityCaseId: securityCase.id,
        state: isWaitingForPeople
          ? SecurityCaseAiResponseState.WaitingForPeople
          : SecurityCaseAiResponseState.Working,
        nextLookAt,
      }))
    ) {
      return this.noLongerWorking(carriedOut);
    }

    return {
      handedOff: null,
      carriedOut,
      waits: planned.waits,
      isFinished: false,
      nextLookAt,
      isNoLongerWorking: false,
    };
  }

  /*
   * What stops a look before its next step (#10816), or null when it may
   * go on: Security Events switched off on the server, or the case handed
   * to people since the look began - a person's Take Over, or the
   * every-minute job that hands every case over while the product is off.
   */
  public static async getStop(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<LookStop | null> {
    if (await SecurityCaseResponseProductOff.isOff()) {
      return LookStop.ProductOff;
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true, aiResponseState: true },
        props: { isRoot: true },
      });

    if (
      !securityCase ||
      securityCase.aiResponseState ===
        SecurityCaseAiResponseState.HandedToPeople
    ) {
      return LookStop.HandedOver;
    }

    return null;
  }

  /*
   * A look stopped for Security Events switched off (#10816): the case goes
   * to people, saying why, with the steps it was about to take as the ones
   * left for a person; a closed one is done with.
   */
  private static async stopWhileProductOff(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    aiRunId: ObjectID;
    carriedOut: number;
    stepKeys: Array<string>;
    stepTitles: Record<string, string>;
    now: Date;
  }): Promise<LookOutcome> {
    const stop: SecurityCaseProductOffStop =
      await SecurityCaseResponseProductOff.stopCase({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        aiRunId: data.aiRunId,
        stepKeys: data.stepKeys,
        stepTitles: data.stepTitles,
        now: data.now,
      });

    if (stop === SecurityCaseProductOffStop.None) {
      return this.noLongerWorking(data.carriedOut);
    }

    return {
      handedOff:
        stop === SecurityCaseProductOffStop.HandedOff
          ? SecurityCaseHandOffReason.ProductOff
          : null,
      carriedOut: data.carriedOut,
      waits: [],
      isFinished: stop === SecurityCaseProductOffStop.Finished,
      nextLookAt: null,
      isNoLongerWorking: false,
    };
  }

  // A look that left the case to the people it was handed to.
  private static noLongerWorking(carriedOut: number): LookOutcome {
    return {
      handedOff: null,
      carriedOut,
      waits: [],
      isFinished: false,
      nextLookAt: null,
      isNoLongerWorking: true,
    };
  }

  /*
   * Where OneUptime AI stands on the case once a look is done, and when it
   * looks again - unless the case was handed to people while it looked
   * (#10816): a person's Take Over, or Security Events switched off, is
   * never undone by a look already under way. One compare-and-set per state
   * the case may be in (LOOK_END_FROM_STATES). Returns whether it was set.
   */
  private static async setWhereItStands(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    state: SecurityCaseAiResponseState;
    nextLookAt: Date | null;
  }): Promise<boolean> {
    for (const from of LOOK_END_FROM_STATES) {
      const isSet: boolean =
        await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
          id: data.securityCaseId,
          data: {
            aiResponseState: data.state,
            aiNextLookAt: data.nextLookAt,
          } as unknown as PartialEntity<SecurityCase>,
          expectedData: {
            projectId: data.projectId,
            aiResponseState: from,
          } as unknown as PartialEntity<SecurityCase>,
        });

      if (isSet) {
        return true;
      }
    }

    return false;
  }

  // Each step's words, in English, for the timeline: by key.
  private static getStepTitles(
    toolkit: ToolkitCase,
    stepKeys: Array<string>,
  ): Record<string, string> {
    return Object.fromEntries(
      stepKeys.map((key: string): [string, string] => {
        return [key, SecurityCaseResponseToolkit.getStepWords(toolkit, key)];
      }),
    );
  }

  /*
   * What stops OneUptime AI working any case of the project now, as a
   * reason it hands a case over for: AI off - for the project, or for
   * cases - no provider, no credits, or a daily limit reached.
   */
  public static async getAiGate(data: {
    project: Project | null;
    limits: SecurityCaseAiLimits;
  }): Promise<SecurityCaseHandOffReason | null> {
    if (!data.project?.id || data.project.enableAi === false) {
      return SecurityCaseHandOffReason.AiOff;
    }

    if (!data.limits.isOn) {
      return SecurityCaseHandOffReason.AiOff;
    }

    try {
      const providerOrBalance:
        | "provider_missing"
        | "insufficient_ai_balance"
        | null = await AIInvestigationEngine.getProviderOrBalanceReason(
        data.project.id,
      );

      if (providerOrBalance === "provider_missing") {
        return SecurityCaseHandOffReason.NoLlmProvider;
      }

      if (providerOrBalance === "insufficient_ai_balance") {
        return SecurityCaseHandOffReason.OutOfCredits;
      }

      if (
        await AIService.getReachedProjectDailyLimit({
          projectId: data.project.id,
          project: data.project,
        })
      ) {
        return SecurityCaseHandOffReason.OutOfCredits;
      }
    } catch (error) {
      logger.error(
        `SecurityCaseResponseLook: could not check whether project ${data.project.id.toString()} may use AI:`,
      );
      logger.error(error);
      return SecurityCaseHandOffReason.CannotTell;
    }

    return null;
  }

  // The case as the planner reads it.
  public static toResponderCase(data: {
    securityCase: SecurityCase;
    values: ProjectSecurityCaseValues;
    stage: SecurityCaseStage;
  }): ResponderCase {
    const { securityCase, values } = data;
    // The project's most urgent priority that is still offered.
    const highest: SecurityCasePriority | undefined =
      SecurityCasePriorities.sort(values.priorities).find(
        (priority: SecurityCasePriority): boolean => {
          return priority.isArchived !== true;
        },
      );
    const highestId: string = highest?.id?.toString().toLowerCase() || "";
    const suggested: string =
      securityCase.aiSuggestedSecurityCasePriorityId?.toString() || "";
    const isRaising: boolean =
      Boolean(suggested) &&
      SecurityCasePriorities.isMoreUrgent(
        values.priorities,
        suggested,
        securityCase.securityCasePriorityId,
      );

    return {
      stage: data.stage,
      aiVerdict: (securityCase.aiVerdict as SecurityCaseAiVerdict) || null,
      hasSteeringText: securityCase.aiTriagePromptInjectionSuspected === true,
      isAtHighestPriority:
        Boolean(highestId) &&
        securityCase.securityCasePriorityId?.toString().toLowerCase() ===
          highestId,
      priorityToRaiseTo: isRaising ? suggested : null,
      isRaisingToHighestPriority:
        isRaising && suggested.toLowerCase() === highestId,
      lastDetectedAt: securityCase.lastDetectedAt
        ? new Date(securityCase.lastDetectedAt)
        : null,
      createdAt: securityCase.createdAt
        ? new Date(securityCase.createdAt)
        : OneUptimeDate.getCurrentDate(),
    };
  }

  /*
   * The log since OneUptime AI last handed the case to people: a person's
   * Respond with AI starts it afresh, so what was turned down before is
   * weighed again, not held against the case.
   */
  public static toCurrentEpoch(
    rows: Array<SecurityCaseAiAction>,
  ): Array<SecurityCaseAiAction> {
    let start: number = 0;

    rows.forEach((row: SecurityCaseAiAction, index: number): void => {
      if (row.kind === SecurityCaseAiActionKind.HandToPeople) {
        start = index + 1;
      }
    });

    return rows.slice(start);
  }

  // Whether anything enforces the project's blocklist.
  private static async hasBlockDestination(
    projectId: ObjectID,
  ): Promise<boolean> {
    try {
      const found: Awaited<
        ReturnType<typeof SecurityBlockDestinations.findForProject>
      > = await SecurityBlockDestinations.findForProject(projectId);

      return found.destinations.length > 0;
    } catch (error) {
      logger.error(
        `SecurityCaseResponseLook: could not read where project ${projectId.toString()}'s blocklist is enforced:`,
      );
      logger.error(error);
      return false;
    }
  }

  // ---------- The plan ----------

  /*
   * The case's Response Plan as OneUptime's checks see it - read as the
   * step checks read it (SecurityCaseStepCheckRunner), without the triage's
   * report: its suggested steps are for whoever may read the case.
   */
  public static async readPlan(data: {
    projectId: ObjectID;
    securityCase: SecurityCase;
    values: ProjectSecurityCaseValues;
    stage: SecurityCaseStage;
    now: Date;
  }): Promise<PlanReads> {
    const { projectId, securityCase } = data;
    const securityCaseId: ObjectID = securityCase.id!;

    const [matches, playbooks, runs, tasks, checks]: [
      SecurityCaseMatchesJson | null,
      Array<SecurityPlaybook>,
      Array<SecurityPlaybookRun>,
      Array<SecurityCaseTask>,
      Array<SecurityCaseStepCheck>,
    ] = await Promise.all([
      SecurityCaseMatches.build({
        projectId,
        securityCaseId,
        props: { isRoot: true },
        now: data.now,
      }).catch((error: unknown): null => {
        logger.error(
          `SecurityCaseResponseLook: could not read the detections of case ${securityCaseId.toString()}:`,
        );
        logger.error(error);
        return null;
      }),
      SecurityPlaybookService.findBy({
        query: { projectId, isEnabled: true },
        select: { _id: true, name: true, steps: true },
        sort: { name: SortOrder.Ascending },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      }),
      SecurityPlaybookRunService.findBy({
        query: { projectId, securityCaseId },
        select: { _id: true, securityPlaybookId: true, status: true },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      }),
      SecurityCaseTaskService.findBy({
        query: { projectId, securityCaseId },
        select: {
          _id: true,
          title: true,
          isDone: true,
          doneAt: true,
          responseStepKey: true,
          doneByUser: { _id: true, name: true, email: true },
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: 200,
        props: { isRoot: true },
      }),
      SecurityCaseStepCheckService.findBy({
        query: { projectId, securityCaseId },
        select: {
          _id: true,
          stepKey: true,
          state: true,
          evidence: true,
          checkedAt: true,
          stateSince: true,
          nextCheckAt: true,
        },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      }),
    ]);

    const responsePlaybooks: Array<ResponsePlaybook> =
      readResponsePlaybooks(playbooks);

    const plan: ResponsePlan = buildResponsePlan({
      entities: readSecurityEntities(securityCase.entities),
      mitreTactics: securityCase.mitreTactics || [],
      mitreTechniques: securityCase.mitreTechniques || [],
      isAssigned: isSecurityCaseTaken(securityCase),
      hasIncident: Boolean(securityCase.incidentId),
      stage: data.stage,
      hasContainedStatus: Boolean(
        SecurityCaseStatuses.getStatusOfStage(
          data.values.statuses,
          SecurityCaseStage.Contained,
        ),
      ),
      matches,
      playbooks: responsePlaybooks,
      ...readPlaybookRuns(
        runs.map(
          (
            run: SecurityPlaybookRun,
          ): { playbookId: string; status: string } => {
            return {
              playbookId: run.securityPlaybookId?.toString() || "",
              status: run.status || "",
            };
          },
        ),
      ),
      tasks: readResponseTasks(tasks),
      // The triage's suggestions stay with the case's readers: only the playbook it named.
      ai: {
        suggestedPlaybookId: securityCase.aiSuggestedPlaybookId?.toString(),
      },
      checks: readResponseStepChecks(checks),
    });

    return { plan, matches, playbooks: responsePlaybooks };
  }

  // ---------- Before a tool runs ----------

  /*
   * What a tool needs beside the plan: a close's report, written from the
   * case's records, and how the same action went on cases like this one.
   */
  private static async prepare(data: {
    intent: ResponderIntent;
    toolkit: ToolkitCase;
    reads: PlanReads;
    caseBlocks: Array<SecurityBlock>;
    rows: Array<SecurityCaseAiAction>;
  }): Promise<ResponderIntent> {
    const { intent, toolkit } = data;
    const prepared: ResponderIntent = { ...intent };

    if (
      intent.kind === SecurityCaseAiActionKind.CloseCase &&
      intent.decision !== SecurityCaseAiDecisionKind.Leave
    ) {
      prepared.report = buildSecurityCaseClosingReport({
        caseNumber: toolkit.securityCase.caseNumberWithPrefix || "",
        title: toolkit.securityCase.title || "",
        verdict: intent.verdict || SecurityCaseVerdict.Undetermined,
        firstDetectedAt: toolkit.securityCase.firstDetectedAt
          ? new Date(toolkit.securityCase.firstDetectedAt)
          : null,
        lastDetectedAt: toolkit.securityCase.lastDetectedAt
          ? new Date(toolkit.securityCase.lastDetectedAt)
          : null,
        detectionCount: toolkit.securityCase.detectionCount || 0,
        openingRuleName: data.reads.matches
          ? getOpeningMatchedDetection(data.reads.matches)?.rule?.name ||
            getOpeningMatchedDetection(data.reads.matches)?.title ||
            null
          : null,
        entities: readSecurityEntities(toolkit.securityCase.entities),
        mitreTactics: toolkit.securityCase.mitreTactics || [],
        hasIncident: Boolean(toolkit.securityCase.incidentId),
        plan: data.reads.plan,
        actions: data.rows.map(
          (
            row: SecurityCaseAiAction,
          ): {
            kind: SecurityCaseAiActionKind;
            status: SecurityCaseAiActionStatus;
            stepKey?: string | undefined;
            target?: string | undefined;
            doneAt?: Date | undefined;
          } => {
            return {
              kind: row.kind!,
              status: row.status!,
              stepKey: row.stepKey || undefined,
              target: row.target || undefined,
              doneAt: row.doneAt ? new Date(row.doneAt) : undefined,
            };
          },
        ),
        blocks: data.caseBlocks.map(
          (block: SecurityBlock): { value: string; expiresAt: Date | null } => {
            return {
              value: block.value || "",
              expiresAt: block.expiresAt ? new Date(block.expiresAt) : null,
            };
          },
        ),
        aiName: getAiName(),
      });
    }

    if (
      intent.decision !== SecurityCaseAiDecisionKind.Leave &&
      SECURITY_CASE_AI_TRACKED_STEP_KINDS[intent.kind]
    ) {
      const openingRuleId: string | undefined = data.reads.matches
        ? getOpeningMatchedDetection(data.reads.matches)?.rule?.id
        : undefined;

      const trackRecord: Awaited<
        ReturnType<typeof SecurityCaseAiTrackRecordReader.read>
      > = await SecurityCaseAiTrackRecordReader.read({
        projectId: toolkit.projectId,
        securityCaseId: toolkit.securityCase.id!,
        detectionRuleId: openingRuleId ? new ObjectID(openingRuleId) : null,
        kind: intent.kind,
      });

      if (trackRecord && trackRecord.similar > 0) {
        prepared.trackRecord = trackRecord;
      }
    }

    return prepared;
  }

  // ---------- How what it started went ----------

  /*
   * The case's log, with how each step of OneUptime AI's own went since the
   * last look written on it: done, asked, turned down, failed, undone. A
   * step of its own that stopped part way - recorded, never started - is
   * linked to the run that did start, or is said to have failed.
   */
  public static async reconcile(data: {
    projectId: ObjectID;
    securityCase: SecurityCase;
    now: Date;
  }): Promise<Array<SecurityCaseAiAction>> {
    const rows: Array<SecurityCaseAiAction> =
      await SecurityCaseAiActionService.findBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCase.id!,
        },
        select: ACTION_SELECT,
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: SECURITY_CASE_AI_LOG_LIMIT,
        props: { isRoot: true },
      });

    const runIds: Array<string> = rows
      .filter((row: SecurityCaseAiAction): boolean => {
        return (
          Boolean(row.securityPlaybookRunId) &&
          (SECURITY_CASE_AI_OPEN_ACTION_STATUSES.includes(row.status!) ||
            row.status === SecurityCaseAiActionStatus.Done)
        );
      })
      .map((row: SecurityCaseAiAction): string => {
        return row.securityPlaybookRunId!.toString();
      });

    const runs: Map<string, SecurityPlaybookRun> = new Map();

    if (runIds.length > 0) {
      for (const run of await SecurityPlaybookRunService.findBy({
        query: {
          projectId: data.projectId,
          _id: new Includes(runIds),
        },
        select: {
          _id: true,
          status: true,
          steps: true,
          stepResults: true,
          completedAt: true,
          errorMessage: true,
        },
        skip: 0,
        limit: runIds.length,
        props: { isRoot: true },
      })) {
        runs.set(run.id!.toString(), run);
      }
    }

    for (const row of rows) {
      const update: Partial<SecurityCaseAiAction> | null = this.settleRow({
        row,
        run: row.securityPlaybookRunId
          ? runs.get(row.securityPlaybookRunId.toString())
          : undefined,
        now: data.now,
      });

      if (!update) {
        continue;
      }

      await SecurityCaseResponseToolkit.updateRow(row.id!, update);

      const wasClosedNow: boolean =
        row.kind === SecurityCaseAiActionKind.CloseCase &&
        row.status !== SecurityCaseAiActionStatus.Done &&
        update.status === SecurityCaseAiActionStatus.Done;

      Object.assign(row, update);

      if (wasClosedNow) {
        await this.writeClosingReport({
          projectId: data.projectId,
          securityCaseId: data.securityCase.id!,
          report: row.report || "",
        });
      }
    }

    return rows;
  }

  /*
   * How one row stands now, from its run: what changed, or null for
   * nothing. Pure, so every outcome is tested on its own.
   */
  public static settleRow(data: {
    row: SecurityCaseAiAction;
    run: SecurityPlaybookRun | undefined;
    now: Date;
  }): Partial<SecurityCaseAiAction> | null {
    const { row, run, now } = data;
    const isOpen: boolean = SECURITY_CASE_AI_OPEN_ACTION_STATUSES.includes(
      row.status!,
    );

    // Recorded, never started: a look stopped part way.
    if (
      isOpen &&
      !row.securityPlaybookRunId &&
      row.status === SecurityCaseAiActionStatus.Doing &&
      row.createdAt &&
      now.getTime() - new Date(row.createdAt).getTime() >
        SECURITY_CASE_AI_INTERRUPTED_MINUTES * 60 * 1000
    ) {
      return {
        status: SecurityCaseAiActionStatus.Failed,
        reason: SecurityCaseAiActionReason.EngineFailed,
      };
    }

    if (!run) {
      return null;
    }

    let steps: Array<SecurityPlaybookStep> = [];

    try {
      steps = parseSecurityPlaybookSteps(run.steps);
    } catch {
      steps = [];
    }

    const result: SecurityPlaybookStepResult | undefined = readStepResults(
      run.stepResults,
      steps,
    )[0];
    const wasAsked: boolean =
      row.status === SecurityCaseAiActionStatus.Asked || Boolean(row.askedAt);
    const decided: Partial<SecurityCaseAiAction> = result?.approval
      ? {
          decidedAt: result.approval.decidedAt
            ? new Date(result.approval.decidedAt)
            : now,
          ...(result.approval.decidedByUserId
            ? { decidedByUserId: new ObjectID(result.approval.decidedByUserId) }
            : {}),
        }
      : {};

    // A step it did: a person undid it, from the case's run.
    if (row.status === SecurityCaseAiActionStatus.Done) {
      const undone: SecurityPlaybookTarget | undefined = (
        result?.targets || []
      ).find((target: SecurityPlaybookTarget): boolean => {
        return target.state === SecurityPlaybookTargetState.Undone;
      });

      if (!undone) {
        return null;
      }

      return {
        status: SecurityCaseAiActionStatus.Undone,
        reason: SecurityCaseAiActionReason.UndoneByPerson,
        undoneAt: undone.undoneAt ? new Date(undone.undoneAt) : now,
        ...(undone.undoneByUserId
          ? { undoneByUserId: new ObjectID(undone.undoneByUserId) }
          : {}),
      };
    }

    if (!isOpen) {
      return null;
    }

    switch (run.status) {
      case SecurityPlaybookRunStatus.WaitingForApproval:
        return row.status === SecurityCaseAiActionStatus.Asked
          ? null
          : { status: SecurityCaseAiActionStatus.Asked, askedAt: now };

      case SecurityPlaybookRunStatus.Succeeded: {
        const isSkipped: boolean =
          result?.status === SecurityPlaybookStepStatus.Skipped;
        const targets: Array<SecurityPlaybookTarget> = result?.targets || [];

        if (
          isSkipped &&
          targets.some((target: SecurityPlaybookTarget): boolean => {
            return target.state === SecurityPlaybookTargetState.Protected;
          })
        ) {
          return {
            status: SecurityCaseAiActionStatus.Left,
            reason: SecurityCaseAiActionReason.ProtectedTarget,
            ...decided,
          };
        }

        if (isSkipped && row.kind === SecurityCaseAiActionKind.RequestCodeFix) {
          return {
            status: SecurityCaseAiActionStatus.Left,
            reason: SecurityCaseAiActionReason.NothingToFixInCode,
            ...decided,
          };
        }

        if (
          isSkipped &&
          row.kind === SecurityCaseAiActionKind.BlockAddress &&
          targets.some((target: SecurityPlaybookTarget): boolean => {
            return target.state === SecurityPlaybookTargetState.AlreadyDone;
          })
        ) {
          return {
            status: SecurityCaseAiActionStatus.Left,
            reason: SecurityCaseAiActionReason.AlreadyBlocked,
            ...decided,
          };
        }

        return {
          status: SecurityCaseAiActionStatus.Done,
          reason: wasAsked
            ? SecurityCaseAiActionReason.Approved
            : SecurityCaseAiActionReason.OnItsOwn,
          doneAt: run.completedAt ? new Date(run.completedAt) : now,
          ...decided,
        };
      }

      case SecurityPlaybookRunStatus.Failed:
        return {
          status: SecurityCaseAiActionStatus.Failed,
          reason: SecurityCaseAiActionReason.EngineFailed,
          evidence: toSecurityCaseAiActionEvidenceJson({
            error: run.errorMessage || result?.error || "",
          }),
          ...decided,
        };

      case SecurityPlaybookRunStatus.Cancelled:
        return {
          status: SecurityCaseAiActionStatus.Declined,
          reason: SecurityCaseAiActionReason.DeclinedByPerson,
          ...(result?.approval?.decision ===
          SecurityPlaybookApprovalDecision.Rejected
            ? decided
            : { decidedAt: run.completedAt ? new Date(run.completedAt) : now }),
        };

      default:
        return null;
    }
  }

  /*
   * A close OneUptime AI made, now on the case: its report as the case's
   * closing note and on its timeline, as OneUptime AI's.
   */
  private static async writeClosingReport(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    report: string;
  }): Promise<void> {
    if (!data.report) {
      return;
    }

    await SecurityCaseService.updateColumnsByIdWithoutHooks({
      id: data.securityCaseId,
      data: {
        closingNote: data.report,
      } as unknown as PartialEntity<SecurityCase>,
    });

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      feedInfoInMarkdown:
        mdText`📋 **${getAiName()}'s closing report.** What happened, the impact, what was done, what was fixed and what to watch.`.toString(),
      moreInformationInMarkdown: data.report,
      eventType: SecurityCaseFeedEventType.AiResponse,
      displayColor: Green500,
    });
  }

  // ---------- When it looks again ----------

  public static getNextLookAt(data: {
    now: Date;
    waits: Array<ResponderWait>;
    quietUntil: Date | null;
    hasCarriedOut: boolean;
  }): Date {
    const candidates: Array<Date> = data.waits.map(
      (wait: ResponderWait): Date => {
        if (wait === ResponderWait.QuietWindow && data.quietUntil) {
          return data.quietUntil;
        }

        return OneUptimeDate.addRemoveMinutes(
          data.now,
          SECURITY_CASE_AI_NEXT_LOOK_MINUTES[wait],
        );
      },
    );

    if (data.hasCarriedOut || candidates.length === 0) {
      candidates.push(
        OneUptimeDate.addRemoveMinutes(
          data.now,
          SECURITY_CASE_AI_GO_ON_MINUTES,
        ),
      );
    }

    return candidates.reduce((soonest: Date, candidate: Date): Date => {
      return candidate.getTime() < soonest.getTime() ? candidate : soonest;
    });
  }
}

// What a look read of the case's plan.
export interface PlanReads {
  plan: ResponsePlan;
  matches: SecurityCaseMatchesJson | null;
  playbooks: Array<ResponsePlaybook>;
}

// The steps the intents are about, each once, in their order.
function getStepKeys(intents: Array<ResponderIntent>): Array<string> {
  const keys: Array<string> = [];

  for (const intent of intents) {
    if (intent.stepKey && !keys.includes(intent.stepKey)) {
      keys.push(intent.stepKey);
    }
  }

  return keys;
}

// A row of the log, as the planner reads it.
function toLogRow(row: SecurityCaseAiAction): ResponderLogRow {
  return {
    id: row.id?.toString() || "",
    kind: row.kind!,
    status: row.status!,
    reason: row.reason!,
    stepKey: row.stepKey || null,
    target: row.target || null,
    createdAt: row.createdAt
      ? new Date(row.createdAt)
      : OneUptimeDate.getCurrentDate(),
    doneAt: row.doneAt ? new Date(row.doneAt) : undefined,
  };
}
