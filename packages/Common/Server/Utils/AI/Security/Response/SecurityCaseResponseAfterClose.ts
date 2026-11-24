import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityBlock from "../../../../../Models/DatabaseModels/SecurityBlock";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import OneUptimeDate from "../../../../../Types/Date";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityBlockState } from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiLimits,
  readSecurityCaseAiLimits,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import {
  SECURITY_CASE_AI_ACTION_REASON_SENTENCES,
  SECURITY_CASE_HAND_OFF_SENTENCES,
  getSecurityCaseAiActionTitle,
} from "../../../../../Types/SecurityCase/SecurityCaseAiWords";
import SecurityCaseStage from "../../../../../Types/SecurityCase/SecurityCaseStage";
import { createTranslator } from "../../../../../Types/Translator";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import { ResponseStep } from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import SecurityCaseStatuses from "../../../../../Utils/SecurityCase/SecurityCaseStatuses";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Infrastructure/Semaphore";
import ProjectService from "../../../../Services/ProjectService";
import SecurityBlockService from "../../../../Services/SecurityBlockService";
import SecurityCaseService from "../../../../Services/SecurityCaseService";
import logger from "../../../Logger";
import ProductBrandingText from "../../../ProductBrandingText";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../../../SecurityCase/SecurityCaseValues";
import SecurityEventsSwitch from "../../../SecurityCase/SecurityEventsSwitch";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import SecurityCaseResponseLook, {
  PlanReads,
  SECURITY_CASE_RESPONSE_CASE_SELECT,
  SECURITY_CASE_RESPONSE_PROJECT_SELECT,
} from "./SecurityCaseResponseLook";
import {
  ResponderIntent,
  ResponderPlan,
  planSecurityCaseResponse,
} from "./SecurityCaseResponsePlanner";
import {
  SECURITY_CASE_RESPONSE_LOCK_MS,
  SECURITY_CASE_RESPONSE_LOCK_NAMESPACE,
} from "./SecurityCaseResponseRunner";
import SecurityCaseResponseToolkit, {
  ToolResult,
  ToolkitCase,
} from "./SecurityCaseResponseToolkit";

/*
 * WHAT FOLLOWS ONEUPTIME AI'S OWN CLOSE OF A CASE (#10847), carried out by
 * the playbook engine as the close's run finishes
 * (SecurityPlaybookEngine.finishRun) - with no look: closing a case ends
 * OneUptime AI's work on it (SecurityCaseService), and what follows is
 * deterministic, so no model is asked.
 *
 *   - Its log is settled from the engine's runs, as a look settles it
 *     (SecurityCaseResponseLook.reconcile): the close reads as done, and its
 *     closing report becomes the case's closing note and a timeline entry.
 *   - A close as False Positive or Benign Positive is followed by what
 *     planAfterDismissal plans (SecurityCaseResponsePlanner): the case's
 *     blocks lifted, and its rule offered an exception - each through the
 *     same tool a look uses (SecurityCaseResponseToolkit), with the same
 *     steps and approval rules: the lift goes as the close went, the
 *     exception always waits for a person. Each is on the case's log and its
 *     timeline as OneUptime AI's.
 *
 * Cancelled - nothing new is done - when, before it runs:
 *   - a person reopened the case: it is theirs again;
 *   - a person took the case over (Take Over) after OneUptime AI asked to
 *     close it - or OneUptime AI handed it to people for another reason:
 *     its log since that hand-off holds no close of its own
 *     (SecurityCaseResponseLook.toLog);
 *   - Security Events is switched off on the server (#10816): what follows
 *     is left for a person, on the log and the timeline, and never taken up
 *     by itself.
 *
 * Once, however often it runs: the close's run and every later run of
 * OneUptime AI's on the case call it, and a job may run twice. It works
 * under the case's lock, the looks' own, and what the log holds already is
 * not done again (planAfterDismissal plans each once). A look that holds
 * the case past the wait leaves it OneUptime AI's to look at once more
 * (SecurityCaseResponseLook's LOOK_END_FROM_STATES), and that look does
 * the same.
 *
 * Everything is read and written as OneUptime (root), with the project and
 * the case named in every query. Never throws to the engine.
 */

// How long it waits for a look that holds the case.
export const SECURITY_CASE_AFTER_CLOSE_LOCK_WAIT_MS: number = 60 * 1000;

// What following up a close came to.
export enum SecurityCaseAfterCloseOutcome {
  // The case is not closed: reopened before it ran, or never closed.
  NotClosed = "NotClosed",
  // A look still holds the case: it reads how the close went itself.
  LookUnderWay = "LookUnderWay",
  // Settled, with nothing to follow: not a dismissal, done before, or taken over.
  Settled = "Settled",
  // The case's blocks lifted and its rule offered an exception, as planned.
  FollowedUp = "FollowedUp",
  // Stopped short by OneUptime AI's own limits: the rest is a person's.
  LeftForPeople = "LeftForPeople",
  // Security Events is switched off: what follows was left for a person.
  ProductOff = "ProductOff",
  // Reopened while it went on: what was left is not done.
  Reopened = "Reopened",
  // It could not be read or carried out.
  Failed = "Failed",
}

// English, for the timeline: every reader sees the same entry.
const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
  undefined,
  "en",
);

function getAiName(): string {
  return `${ProductBrandingText.getProductName()} AI`;
}

export default class SecurityCaseResponseAfterClose {
  /*
   * One of OneUptime AI's own runs on the case finished: when the case is
   * closed now, what follows a close of its own is carried out. Never
   * throws.
   */
  @CaptureSpan()
  public static async followUp(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    now?: Date | undefined;
  }): Promise<SecurityCaseAfterCloseOutcome> {
    try {
      // Most of its runs finish on a case still open: one read, and nothing more.
      if (!(await this.isClosed(data))) {
        return SecurityCaseAfterCloseOutcome.NotClosed;
      }

      let mutex: SemaphoreMutex | null = null;

      try {
        mutex = await Semaphore.lock({
          key: data.securityCaseId.toString(),
          namespace: SECURITY_CASE_RESPONSE_LOCK_NAMESPACE,
          lockTimeout: SECURITY_CASE_RESPONSE_LOCK_MS,
          acquireTimeout: SECURITY_CASE_AFTER_CLOSE_LOCK_WAIT_MS,
        });
      } catch {
        return SecurityCaseAfterCloseOutcome.LookUnderWay;
      }

      try {
        return await this.followUpLocked({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          now: data.now || OneUptimeDate.getCurrentDate(),
        });
      } finally {
        try {
          await Semaphore.release(mutex);
        } catch (error) {
          logger.error(
            `SecurityCaseResponseAfterClose: could not release the lock of case ${data.securityCaseId.toString()}: ${error}`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `SecurityCaseResponseAfterClose: could not carry out what follows OneUptime AI's close of case ${data.securityCaseId.toString()}:`,
      );
      logger.error(error);
      return SecurityCaseAfterCloseOutcome.Failed;
    }
  }

  private static async followUpLocked(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    now: Date;
  }): Promise<SecurityCaseAfterCloseOutcome> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: SECURITY_CASE_RESPONSE_CASE_SELECT,
        props: { isRoot: true },
      });

    // Reopened while it waited for the case: it is a person's again.
    if (!securityCase?.id || !securityCase.closedAt) {
      return SecurityCaseAfterCloseOutcome.NotClosed;
    }

    const [project, values]: [Project | null, ProjectSecurityCaseValues] =
      await Promise.all([
        ProjectService.findOneById({
          id: data.projectId,
          select: SECURITY_CASE_RESPONSE_PROJECT_SELECT,
          props: { isRoot: true },
        }),
        SecurityCaseValues.getForProject(data.projectId),
      ]);

    if (
      SecurityCaseStatuses.getStage(
        values.statuses,
        securityCase.securityCaseStatusId,
      ) !== SecurityCaseStage.Closed
    ) {
      return SecurityCaseAfterCloseOutcome.NotClosed;
    }

    // Its log, settled: the close done, and its closing report on the case - once.
    const rows: Array<SecurityCaseAiAction> =
      await SecurityCaseResponseLook.reconcile({
        projectId: data.projectId,
        securityCase,
        now: data.now,
      });

    const reads: PlanReads = await SecurityCaseResponseLook.readPlan({
      projectId: data.projectId,
      securityCase,
      values,
      stage: SecurityCaseStage.Closed,
      now: data.now,
    });
    const caseBlocks: Array<SecurityBlock> = await SecurityBlockService.findBy({
      query: {
        projectId: data.projectId,
        securityCaseId: securityCase.id,
        state: SecurityBlockState.Active,
      },
      select: { _id: true, value: true },
      skip: 0,
      limit: 50,
      props: { isRoot: true },
    });
    const limits: SecurityCaseAiLimits = readSecurityCaseAiLimits(project);

    // What follows the close, as a look of a closed case plans it (planAfterDismissal).
    const planned: ResponderPlan = planSecurityCaseResponse({
      now: data.now,
      limits,
      hasScannersPolicyFinishedTrial: false,
      aiGate: null,
      securityCase: SecurityCaseResponseLook.toResponderCase({
        securityCase,
        values,
        stage: SecurityCaseStage.Closed,
      }),
      plan: reads.plan,
      log: SecurityCaseResponseLook.toLog(rows),
      hasBlockDestination: false,
      canContainUsers: false,
      canContainHosts: false,
      caseBlocks: caseBlocks
        .filter((block: SecurityBlock): boolean => {
          return Boolean(block.id && block.value);
        })
        .map((block: SecurityBlock): { id: string; value: string } => {
          return { id: block.id!.toString(), value: block.value! };
        }),
    });

    if (planned.intents.length === 0) {
      return SecurityCaseAfterCloseOutcome.Settled;
    }

    const toolkit: ToolkitCase = {
      projectId: data.projectId,
      securityCase,
      limits,
      values,
      matches: reads.matches,
      stepsByKey: new Map(
        reads.plan.steps.map((step: ResponseStep): [string, ResponseStep] => {
          return [step.key, step];
        }),
      ),
      now: data.now,
    };

    for (const [index, intent] of planned.intents.entries()) {
      /*
       * Security Events switched off (#10816): no new step starts, and what
       * is left is a person's - on the log, so it is never taken up by
       * itself, and on the timeline.
       */
      if (await SecurityEventsSwitch.isOff()) {
        await this.leaveForPeople({
          toolkit,
          intents: planned.intents.slice(index),
          why: SECURITY_CASE_AI_ACTION_REASON_SENTENCES[
            SecurityCaseAiActionReason.ProductOff
          ],
          reason: SecurityCaseAiActionReason.ProductOff,
        });
        return SecurityCaseAfterCloseOutcome.ProductOff;
      }

      // Reopened while it went on: what is left is not done.
      if (!(await this.isClosed(data))) {
        return SecurityCaseAfterCloseOutcome.Reopened;
      }

      const result: ToolResult = await SecurityCaseResponseToolkit.carryOut(
        toolkit,
        intent,
      );

      /*
       * Stopped short by OneUptime AI's own limits - the hour's actions on
       * its own, a protected target: a closed case is no longer one it hands
       * over, so the timeline says what is left, and why.
       */
      if (result.handOff) {
        await this.sayLeft({
          toolkit,
          intents: planned.intents.slice(index),
          why: SECURITY_CASE_HAND_OFF_SENTENCES[result.handOff],
        });
        return SecurityCaseAfterCloseOutcome.LeftForPeople;
      }
    }

    return SecurityCaseAfterCloseOutcome.FollowedUp;
  }

  // Whether the case is closed now.
  private static async isClosed(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<boolean> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true, closedAt: true },
        props: { isRoot: true },
      });

    return Boolean(securityCase?.closedAt);
  }

  // What follows the close, left for a person: on the log, then the timeline.
  private static async leaveForPeople(data: {
    toolkit: ToolkitCase;
    intents: Array<ResponderIntent>;
    why: string;
    reason: SecurityCaseAiActionReason;
  }): Promise<void> {
    for (const intent of data.intents) {
      await SecurityCaseResponseToolkit.recordLeft(
        data.toolkit,
        intent,
        data.reason,
      );
    }

    await this.sayLeft(data);
  }

  // The timeline: what follows the close that OneUptime AI did not do, and why.
  private static async sayLeft(data: {
    toolkit: ToolkitCase;
    intents: Array<ResponderIntent>;
    why: string;
  }): Promise<void> {
    await SecurityCaseResponseToolkit.writeFeed(data.toolkit, {
      markdown: mdText`🤖 **${getAiName()} left what follows its close to a person.** ${
        ENGLISH.translateText(data.why) || data.why
      }`,
      details: FeedMarkdown.join(
        data.intents.map((intent: ResponderIntent): MarkdownText => {
          return mdText`- ${ENGLISH.translateTemplate(
            getSecurityCaseAiActionTitle({
              kind: intent.kind,
              status: SecurityCaseAiActionStatus.Left,
            }),
            { value: intent.target || "", verdict: intent.verdict || "" },
          )}`;
        }),
        "\n",
      ),
    });
  }
}
