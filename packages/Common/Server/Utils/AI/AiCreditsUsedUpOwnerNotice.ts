import AIBillingService from "../../Services/AIBillingService";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ProjectBalanceOwnerNotice from "../ProjectBalanceOwnerNotice";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import SafeHtml from "../../../Types/SafeHtml";
import {
  getProjectAiCreditsUsedUpOwnerSubject,
  PROJECT_AI_AUTO_RECHARGE_COULD_NOT_ADD_OWNER_SENTENCE,
  PROJECT_AI_CREDITS_USED_UP_OWNER_FREQUENCY_SENTENCE,
  PROJECT_AI_CREDITS_USED_UP_OWNER_SENTENCE,
  ProjectBalanceType,
} from "../../../Utils/Project/ProjectBalance";

/*
 * The project's owners hear when its AI credits run out.
 *
 * Before this, nobody did: an AI call billed to used-up credits was refused,
 * and the AI Logs, the AI agent pages and the investigation card said so,
 * but the people who may add credits were not told - while SMS and calls
 * email the owners once when their balance cannot pay for a message, and
 * Project.lowAiBalanceNotificationSentToOwners existed and was never set.
 *
 * Now the owners get one email the first time OneUptime AI cannot run for
 * want of credits: when the call that spends the last of them finishes, when
 * an AI call is refused, or when a readiness check (an investigation about to
 * start, an AI agent page) finds them used up - whichever comes first. It
 * says AI has stopped, and what to do: add credits or turn on Auto Recharge;
 * or, when Auto Recharge is on and could not add more, check the payment
 * method. It links to AI Credits, which the owners may use (they hold the
 * recharge permission, Utils/Project/ProjectBalance).
 *
 * Once each time the credits run out. The claim is one conditional UPDATE of
 * the project row's lowAiBalanceNotificationSentToOwners
 * (ProjectService.claimAiCreditsUsedUpNotice), which only one caller wins on
 * any server - the pattern of the daily AI limits' notice
 * (ProjectAiDailyLimitOwnerNotice). Every recharge clears the flag
 * (AIBillingService), as does a master admin adding credits, so the next run
 * out is told again. A row the caller already read that says the owners were
 * told costs no query at all.
 *
 * It reuses the email the owners get about the project's balances
 * (ProjectService.sendEmailToProjectOwners, current members of the owner
 * teams only), so it reaches the same people the same way.
 *
 * It never throws and never changes what the caller does: a refusal is
 * refused, a skip skipped, whether or not the email could be sent. One whose
 * email failed after the claim is not sent twice.
 */

export enum AiCreditsUsedUpNoticeOutcome {
  // The credits are not used up: nothing to tell.
  NotUsedUp = "NotUsedUp",
  // This caller won the claim: the owners were emailed.
  Told = "Told",
  // They were told since the credits were last added.
  AlreadyTold = "AlreadyTold",
  // The claim or the email could not be made; logged.
  Failed = "Failed",
}

export default class AiCreditsUsedUpOwnerNotice {
  /*
   * Tell the owners, unless somebody has since the credits were last added.
   * `alreadyTold` is the row's lowAiBalanceNotificationSentToOwners as the
   * caller read it: true spares the claim; otherwise the database decides.
   * `isAutoRechargeOn`: Auto Recharge is on, so it is what could not add
   * more - which changes what they are asked to do.
   */
  @CaptureSpan()
  public static async notifyIfFirst(data: {
    projectId: ObjectID;
    isAutoRechargeOn: boolean;
    alreadyTold?: boolean | undefined;
  }): Promise<AiCreditsUsedUpNoticeOutcome> {
    if (data.alreadyTold === true) {
      return AiCreditsUsedUpNoticeOutcome.AlreadyTold;
    }

    try {
      const isFirst: boolean = await ProjectService.claimAiCreditsUsedUpNotice(
        data.projectId,
      );

      if (!isFirst) {
        return AiCreditsUsedUpNoticeOutcome.AlreadyTold;
      }

      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: { name: true },
        props: { isRoot: true },
      });

      await ProjectService.sendEmailToProjectOwners(
        data.projectId,
        getProjectAiCreditsUsedUpOwnerSubject(project?.name),
        this.getHtml({
          projectId: data.projectId,
          isAutoRechargeOn: data.isAutoRechargeOn,
        }),
      );

      return AiCreditsUsedUpNoticeOutcome.Told;
    } catch (error) {
      logger.error(
        `AI credits: could not tell the owners of project ${data.projectId.toString()} that its AI credits are used up: ${error}`,
      );
      return AiCreditsUsedUpNoticeOutcome.Failed;
    }
  }

  /*
   * For a caller that does not know the balance now - after a billed call,
   * when the recharge check could not say: reads the row, and tells the
   * owners only if the credits are used up.
   */
  @CaptureSpan()
  public static async notifyIfUsedUp(data: {
    projectId: ObjectID;
  }): Promise<AiCreditsUsedUpNoticeOutcome> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          aiCurrentBalanceInUSDCents: true,
          enableAutoRechargeAiBalance: true,
          autoAiRechargeByBalanceInUSD: true,
          autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
          lowAiBalanceNotificationSentToOwners: true,
        },
        props: { isRoot: true },
      });

      if (!project || (project.aiCurrentBalanceInUSDCents || 0) > 0) {
        return AiCreditsUsedUpNoticeOutcome.NotUsedUp;
      }

      return await this.notifyIfFirst({
        projectId: data.projectId,
        isAutoRechargeOn:
          AIBillingService.getAutoRechargeSettings(project).isSetUp,
        alreadyTold: project.lowAiBalanceNotificationSentToOwners,
      });
    } catch (error) {
      logger.error(
        `AI credits: could not check whether the AI credits of project ${data.projectId.toString()} are used up: ${error}`,
      );
      return AiCreditsUsedUpNoticeOutcome.Failed;
    }
  }

  /*
   * The email's body, as the HTML the owners' email places it in
   * (SimpleMessage's info block): what happened; what to do, with the link
   * to AI Credits; and how often this email comes.
   */
  public static getHtml(data: {
    projectId: ObjectID;
    isAutoRechargeOn: boolean;
  }): string {
    return [
      SafeHtml.escape(PROJECT_AI_CREDITS_USED_UP_OWNER_SENTENCE),
      ProjectBalanceOwnerNotice.getHtml({
        balance: ProjectBalanceType.AI,
        projectId: data.projectId,
        sentence: data.isAutoRechargeOn
          ? PROJECT_AI_AUTO_RECHARGE_COULD_NOT_ADD_OWNER_SENTENCE
          : undefined,
      }),
      SafeHtml.escape(PROJECT_AI_CREDITS_USED_UP_OWNER_FREQUENCY_SENTENCE),
    ].join(" <br/> <br/> ");
  }
}
