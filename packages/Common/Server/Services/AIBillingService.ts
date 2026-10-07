import {
  IsBillingEnabled,
  NotificationSlackWebhookOnSubscriptionUpdate,
} from "../EnvironmentConfig";
import GlobalCache from "../Infrastructure/GlobalCache";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import logger from "../Utils/Logger";
import BaseService from "./BaseService";
import BillingService from "./BillingService";
import ProjectService from "./ProjectService";
import BadDataException from "../../Types/Exception/BadDataException";
import Email from "../../Types/Email";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import AiAutoRechargeState from "../../Types/Billing/AiAutoRechargeState";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import {
  BillingFailureNoticeKind,
  shouldSendBillingFailureNotice,
} from "../Utils/Billing/BillingFailureNoticeThrottle";
import URL from "../../Types/API/URL";
import Exception from "../../Types/Exception/Exception";

/*
 * Every recharge of a project's AI credits - by hand, or by Auto Recharge
 * before or after an AI call - takes this lock first, one project at a
 * time, and reads the balance again once it holds it. So AI calls that find
 * the credits low at the same moment charge the card once: the first
 * recharges, and the others, waiting their turn, find the credits it added
 * and charge nothing.
 */
export const AI_RECHARGE_LOCK_NAMESPACE: string = "AIBillingService.recharge";

// Long enough for the payment provider; refreshed while it is held.
const AI_RECHARGE_LOCK_TIMEOUT_IN_MS: number = 30_000;

// How long a caller waits for a recharge already under way.
const AI_RECHARGE_LOCK_ACQUIRE_TIMEOUT_IN_MS: number = 30_000;

/*
 * After an automatic recharge fails - no payment method, a declined card -
 * Auto Recharge waits this long before it charges the card again. Without
 * it, every AI call made while the credits are used up would try the card
 * once more (each try a voided invoice at the payment provider). A recharge
 * by hand, or saving Auto Recharge again, tries at once and, when it works,
 * ends the wait.
 */
export const AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS: number = 60 * 60;

const AI_AUTO_RECHARGE_FAILED_NAMESPACE: string = "ai-auto-recharge-failed";

// What Auto Recharge is set to, from the project row or a change to it.
export interface AiAutoRechargeSettings {
  isSetUp: boolean;
  rechargeByInUSD: number;
  whenBalanceFallsToInUSD: number;
}

// A change to Auto Recharge that is not written yet (ProjectService).
export interface AiAutoRechargeChange {
  enableAutoRechargeAiBalance: boolean;
  autoAiRechargeByBalanceInUSD?: number | undefined;
  autoRechargeAiWhenCurrentBalanceFallsInUSD?: number | undefined;
  /*
   * Somebody saving Auto Recharge: try the card now, whatever failed
   * before - it is a deliberate try, and its answer is shown to them.
   */
  ignoreRecentFailure?: boolean | undefined;
}

export class AIBillingService extends BaseService {
  public constructor() {
    super();
  }

  /*
   * Auto Recharge can only refill the credits when it is on and has an
   * amount to add and a balance to add it at. The dashboard asks for both,
   * and they default to 20 and 10 USD, so "on" almost always means "set up";
   * one set to nothing through the API recharges nothing, so it counts as
   * off everywhere - here, in the recharge itself, and in what the readiness
   * checks say.
   */
  public getAutoRechargeSettings(
    project: Pick<
      Project,
      | "enableAutoRechargeAiBalance"
      | "autoAiRechargeByBalanceInUSD"
      | "autoRechargeAiWhenCurrentBalanceFallsInUSD"
    >,
    change?: AiAutoRechargeChange | undefined,
  ): AiAutoRechargeSettings {
    const isEnabled: boolean = change
      ? change.enableAutoRechargeAiBalance === true
      : project.enableAutoRechargeAiBalance === true;

    // What the change sets, even to nothing; otherwise what is stored.
    const pick: (
      changed: number | undefined | null,
      stored: number | undefined | null,
    ) => number = (
      changed: number | undefined | null,
      stored: number | undefined | null,
    ): number => {
      const value: number | undefined | null =
        changed !== undefined && changed !== null ? changed : stored;

      return Number(value || 0) || 0;
    };

    const rechargeByInUSD: number = pick(
      change?.autoAiRechargeByBalanceInUSD,
      project.autoAiRechargeByBalanceInUSD,
    );

    const whenBalanceFallsToInUSD: number = pick(
      change?.autoRechargeAiWhenCurrentBalanceFallsInUSD,
      project.autoRechargeAiWhenCurrentBalanceFallsInUSD,
    );

    return {
      isSetUp: isEnabled && rechargeByInUSD > 0 && whenBalanceFallsToInUSD > 0,
      rechargeByInUSD,
      whenBalanceFallsToInUSD,
    };
  }

  /*
   * What Auto Recharge would do for this project now, if its AI credits are
   * used up: nothing (Off), recharge them before the next billed call
   * (Ready), or nothing for now because its last charge failed (Failed).
   * AIService.getAiBalanceBlocker asks it, so the readiness checks say what
   * the next AI call will do.
   *
   * A failure that cannot be read (the shared cache is down) reads as none:
   * the call itself still decides, and without the cache it charges nothing.
   */
  @CaptureSpan()
  public async getAutoRechargeState(data: {
    projectId: ObjectID;
    project: Pick<
      Project,
      | "enableAutoRechargeAiBalance"
      | "autoAiRechargeByBalanceInUSD"
      | "autoRechargeAiWhenCurrentBalanceFallsInUSD"
    >;
  }): Promise<AiAutoRechargeState> {
    if (!this.getAutoRechargeSettings(data.project).isSetUp) {
      return AiAutoRechargeState.Off;
    }

    if (await this.hasRecentAutoRechargeFailure(data.projectId)) {
      return AiAutoRechargeState.Failed;
    }

    return AiAutoRechargeState.Ready;
  }

  /*
   * A recharge somebody asked for: the Recharge button on AI Credits
   * (POST /ai/recharge, which checks who may first).
   *
   * It takes the same lock as Auto Recharge, so an automatic recharge
   * waiting behind it finds the credits this one adds and does not charge
   * the card again. If the lock cannot be taken (the shared cache is down),
   * the recharge goes ahead anyway: the person who asked for it is told
   * whether it worked, and the credit is added in one statement whatever
   * else is writing the balance.
   */
  @CaptureSpan()
  public async rechargeBalance(
    projectId: ObjectID,
    amountInUSD: number,
    options?: {
      /*
       * See NotificationService.rechargeBalance for the full reasoning. In
       * short: true for the manual "Recharge" button, where this email is the
       * only confirmation a person gets that their card was charged, and false
       * where nobody pressed anything.
       */
      sendOwnerConfirmationEmail?: boolean | undefined;
    },
  ): Promise<number> {
    if (!IsBillingEnabled) {
      throw new BadDataException("Billing is not enabled");
    }

    const lock: SemaphoreMutex | null = await this.takeRechargeLock(projectId);

    try {
      return await this.chargeAndCredit({
        projectId,
        amountInUSD,
        isAutomatic: false,
        sendOwnerConfirmationEmail:
          options?.sendOwnerConfirmationEmail !== false,
      });
    } finally {
      await this.releaseRechargeLock(lock, projectId);
    }
  }

  /*
   * Auto Recharge: if the AI credits are below the balance Auto Recharge is
   * set to recharge at, add its amount. Answers the balance afterwards.
   *
   * Asked before a billed AI call that finds the credits used up (so the
   * call runs on the credits this adds), after every billed call, and when
   * somebody turns Auto Recharge on (`change`, not written yet: then the
   * card is tried at once, as for SMS and calls).
   *
   * Once per low balance, however many callers ask at once: the check is
   * made again holding the recharge lock, so callers that waited find the
   * credits the first one added. Never without the lock - two servers could
   * each charge the card - so when it cannot be taken, nothing is charged
   * and the balance is answered as it is. After a failed charge it waits
   * AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS before trying the card again.
   *
   * A charge that fails throws, after telling the owners (once a day).
   */
  @CaptureSpan()
  public async rechargeIfBalanceIsLow(
    projectId: ObjectID,
    change?: AiAutoRechargeChange | undefined,
  ): Promise<number> {
    if (!projectId || !IsBillingEnabled) {
      return 0;
    }

    // A first look without the lock: most calls end here, with no charge.
    const firstLook: Project | null = await this.readAutoRechargeRow(projectId);

    if (!firstLook) {
      return 0;
    }

    if (!this.needsRecharge(firstLook, change)) {
      return firstLook.aiCurrentBalanceInUSDCents || 0;
    }

    if (
      !change?.ignoreRecentFailure &&
      (await this.hasRecentAutoRechargeFailure(projectId))
    ) {
      return firstLook.aiCurrentBalanceInUSDCents || 0;
    }

    const lock: SemaphoreMutex | null = await this.takeRechargeLock(projectId);

    if (!lock) {
      logger.error(
        `AI credits: Auto Recharge of project ${projectId.toString()} did not run: the recharge lock could not be taken, and without it two servers could each charge the card.`,
      );
      return firstLook.aiCurrentBalanceInUSDCents || 0;
    }

    try {
      /*
       * Again, holding the lock: a recharge that finished while this one
       * waited has added its credits, and a failure meanwhile starts the
       * wait.
       */
      const project: Project | null = await this.readAutoRechargeRow(projectId);

      if (!project) {
        return 0;
      }

      if (!this.needsRecharge(project, change)) {
        return project.aiCurrentBalanceInUSDCents || 0;
      }

      if (
        !change?.ignoreRecentFailure &&
        (await this.hasRecentAutoRechargeFailure(projectId))
      ) {
        return project.aiCurrentBalanceInUSDCents || 0;
      }

      return await this.chargeAndCredit({
        projectId,
        amountInUSD: this.getAutoRechargeSettings(project, change)
          .rechargeByInUSD,
        isAutomatic: true,
        /*
         * Nobody pressed anything: a success email here would be one message
         * to every owner per recharge, on a busy project many a day.
         */
        sendOwnerConfirmationEmail: false,
      });
    } finally {
      await this.releaseRechargeLock(lock, projectId);
    }
  }

  // Set up, and below the balance it recharges at.
  private needsRecharge(
    project: Project,
    change?: AiAutoRechargeChange | undefined,
  ): boolean {
    const settings: AiAutoRechargeSettings = this.getAutoRechargeSettings(
      project,
      change,
    );

    return (
      settings.isSetUp &&
      (project.aiCurrentBalanceInUSDCents || 0) / 100 <
        settings.whenBalanceFallsToInUSD
    );
  }

  private async readAutoRechargeRow(
    projectId: ObjectID,
  ): Promise<Project | null> {
    return await ProjectService.findOneById({
      id: projectId,
      select: {
        aiCurrentBalanceInUSDCents: true,
        enableAutoRechargeAiBalance: true,
        autoAiRechargeByBalanceInUSD: true,
        autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Charge the project's card and add the credits. The caller holds the
   * recharge lock (or, for a recharge by hand, tried to).
   */
  private async chargeAndCredit(data: {
    projectId: ObjectID;
    amountInUSD: number;
    isAutomatic: boolean;
    sendOwnerConfirmationEmail: boolean;
  }): Promise<number> {
    const { amountInUSD } = data;

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        paymentProviderCustomerId: true,
        name: true,
        sendInvoicesByEmail: true,
        financeAccountingEmail: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      return 0;
    }

    /*
     * The no-payment-method branch below throws, and that throw lands in this
     * method's own catch. Without this the FIRST no-payment-method failure
     * sends two "ACTION REQUIRED" emails about the same fact, one from each
     * place.
     */
    let ownersAlreadyToldAboutThisFailure: boolean = false;

    try {
      if (
        !(await BillingService.hasPaymentMethods(
          project.paymentProviderCustomerId!,
        ))
      ) {
        /*
         * The same 24h window as the catch below. The project boolean this
         * branch used to latch on is cleared only by a SUCCESSFUL recharge, so
         * a project that never manages one was told once and then never again.
         */
        ownersAlreadyToldAboutThisFailure = true;

        const shouldTellOwners: boolean = await shouldSendBillingFailureNotice({
          projectId: project.id!,
          kind: BillingFailureNoticeKind.AiCreditRechargeFailed,
        });

        if (shouldTellOwners) {
          await ProjectService.updateOneById({
            data: {
              failedAiBalanceChargeNotificationSentToOwners: true,
            },
            id: project.id!,
            props: {
              isRoot: true,
            },
          });
          await ProjectService.sendEmailToProjectOwners(
            project.id!,
            "ACTION REQUIRED: AI Balance Recharge Failed for project - " +
              (project.name || ""),
            `We have tried to recharge your AI balance for project - ${
              project.name || ""
            } and failed. We could not find a payment method for the project. Please add a payment method in Project Settings.`,
          );
        }
        throw new BadDataException(
          "No payment methods found for the project. Please add a payment method in Project Settings to continue.",
        );
      }

      await BillingService.generateInvoiceAndChargeCustomer(
        project.paymentProviderCustomerId!,
        "AI Balance Recharge",
        amountInUSD,
        {
          sendInvoiceByEmail: project.sendInvoicesByEmail || false,
          recipientEmails: project.financeAccountingEmail
            ? Email.parseList(project.financeAccountingEmail)
            : undefined,
          projectId: project.id || undefined,
        },
      );
    } catch (err) {
      /*
       * Auto Recharge waits before it tries the card again, so the AI calls
       * made while the credits are used up do not each try it once more.
       */
      if (data.isAutomatic) {
        await this.rememberAutoRechargeFailure(project.id!);
      }

      /*
       * This block used to write failedAiBalanceChargeNotificationSentToOwners
       * and then send WITHOUT ever reading it, so a project with a declined
       * card mailed every owner once per recharge attempt.
       *
       * A 24h window rather than that boolean, for the same reason as the
       * SMS/call path: the boolean is only cleared by a SUCCESSFUL recharge,
       * so latching on it would let "no card -> add a card -> the card is
       * declined" end in permanent silence. See BillingFailureNoticeThrottle.
       */
      if (!ownersAlreadyToldAboutThisFailure) {
        const shouldTellOwners: boolean = await shouldSendBillingFailureNotice({
          projectId: project.id!,
          kind: BillingFailureNoticeKind.AiCreditRechargeFailed,
        });

        if (shouldTellOwners) {
          await ProjectService.updateOneById({
            data: {
              failedAiBalanceChargeNotificationSentToOwners: true,
            },
            id: project.id!,
            props: {
              isRoot: true,
            },
          });
          await ProjectService.sendEmailToProjectOwners(
            project.id!,
            "ACTION REQUIRED: AI Balance Recharge Failed for project - " +
              (project.name || ""),
            `We have tried to recharge your AI balance for project - ${
              project.name || ""
            } and failed. Please make sure your payment method is up to date and has sufficient balance. You can add new payment methods in Project Settings.`,
          );
        }
      }
      logger.error(err);
      throw err;
    }

    /*
     * The card is charged: add the credits in one statement, to whatever the
     * balance is now. It used to write back the balance read before the
     * charge plus the amount, which lost the cost of every AI call billed
     * while the payment provider answered - and a second recharge running at
     * the same moment overwrote the first one's credits, so a card charged
     * twice was credited once. The owners' notice flags are cleared with it:
     * the next time the credits run low, they are told again.
     */
    try {
      await ProjectService.atomicAddToColumnsByIdWithoutHooks({
        id: project.id!,
        add: {
          aiCurrentBalanceInUSDCents: Math.round(amountInUSD * 100),
        },
        set: {
          failedAiBalanceChargeNotificationSentToOwners: false,
          lowAiBalanceNotificationSentToOwners: false,
          notEnabledAiNotificationSentToOwners: false,
        },
      });
    } catch (err) {
      logger.error(
        `AI credits: project ${project.id!.toString()} was charged ${amountInUSD} USD for AI credits, and the credits could not be added: ${err}`,
      );
      throw err;
    }

    // The card works: Auto Recharge need not wait any more.
    await this.forgetAutoRechargeFailure(project.id!);

    const updatedAmount: number = await this.readBalanceInUSDCents(project.id!);

    /*
     * The confirmation is suppressed for AUTO-recharge only. It used to fire
     * unconditionally, and AI auto-recharge runs from the balance check on
     * every AI call, so a busy project mailed every owner once per recharge.
     * Somebody who deliberately clicked "Recharge" still gets told, because
     * Project.sendInvoicesByEmail defaults to false and nothing else
     * reliably confirms the charge.
     */
    if (data.sendOwnerConfirmationEmail) {
      await ProjectService.sendEmailToProjectOwners(
        project.id!,
        "AI Balance Recharge Successful for project - " + (project.name || ""),
        `We have successfully recharged your AI balance for project - ${
          project.name || ""
        } by ${amountInUSD} USD. Your current balance is ${
          updatedAmount / 100
        } USD.`,
      );
    }

    // Send Slack notification for balance refill
    this.sendBalanceRefillSlackNotification({
      project: project,
      amountInUSD: amountInUSD,
      currentBalanceInUSD: updatedAmount / 100,
    }).catch((error: Exception) => {
      logger.error(
        "Error sending slack message for AI balance refill: " + error,
      );
    });

    return updatedAmount;
  }

  private async readBalanceInUSDCents(projectId: ObjectID): Promise<number> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        aiCurrentBalanceInUSDCents: true,
      },
      props: {
        isRoot: true,
      },
    });

    return project?.aiCurrentBalanceInUSDCents || 0;
  }

  /*
   * The recharge lock, or null when it cannot be taken (the shared cache is
   * down, or a recharge under way did not finish in time).
   */
  private async takeRechargeLock(
    projectId: ObjectID,
  ): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: projectId.toString(),
        namespace: AI_RECHARGE_LOCK_NAMESPACE,
        lockTimeout: AI_RECHARGE_LOCK_TIMEOUT_IN_MS,
        acquireTimeout: AI_RECHARGE_LOCK_ACQUIRE_TIMEOUT_IN_MS,
        onLockLost: (err: Error): void => {
          logger.error(
            `AI credits: the recharge lock of project ${projectId.toString()} was lost while it was held: ${err}`,
          );
        },
      });
    } catch (err) {
      logger.error(
        `AI credits: could not take the recharge lock of project ${projectId.toString()}: ${err}`,
      );
      return null;
    }
  }

  private async releaseRechargeLock(
    lock: SemaphoreMutex | null,
    projectId: ObjectID,
  ): Promise<void> {
    if (!lock) {
      return;
    }

    try {
      await Semaphore.release(lock);
    } catch (err) {
      logger.error(
        `AI credits: could not release the recharge lock of project ${projectId.toString()}: ${err}`,
      );
    }
  }

  private async hasRecentAutoRechargeFailure(
    projectId: ObjectID,
  ): Promise<boolean> {
    try {
      return Boolean(
        await GlobalCache.getString(
          AI_AUTO_RECHARGE_FAILED_NAMESPACE,
          projectId.toString(),
        ),
      );
    } catch (err) {
      logger.error(
        `AI credits: could not read whether Auto Recharge of project ${projectId.toString()} failed recently: ${err}`,
      );
      return false;
    }
  }

  private async rememberAutoRechargeFailure(
    projectId: ObjectID,
  ): Promise<void> {
    try {
      await GlobalCache.setString(
        AI_AUTO_RECHARGE_FAILED_NAMESPACE,
        projectId.toString(),
        new Date().toISOString(),
        { expiresInSeconds: AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS },
      );
    } catch (err) {
      logger.error(
        `AI credits: could not record that Auto Recharge of project ${projectId.toString()} failed: ${err}`,
      );
    }
  }

  private async forgetAutoRechargeFailure(projectId: ObjectID): Promise<void> {
    try {
      await GlobalCache.deleteKey(
        AI_AUTO_RECHARGE_FAILED_NAMESPACE,
        projectId.toString(),
      );
    } catch (err) {
      logger.error(
        `AI credits: could not clear the Auto Recharge failure of project ${projectId.toString()}: ${err}`,
      );
    }
  }

  @CaptureSpan()
  private async sendBalanceRefillSlackNotification(data: {
    project: Project;
    amountInUSD: number;
    currentBalanceInUSD: number;
  }): Promise<void> {
    const { project, amountInUSD, currentBalanceInUSD } = data;

    if (NotificationSlackWebhookOnSubscriptionUpdate) {
      const slackMessage: string = `*AI Balance Refilled:*
*Project Name:* ${project.name?.toString() || "N/A"}
*Project ID:* ${project.id?.toString() || "N/A"}
*Refill Amount:* $${amountInUSD} USD
*Current Balance:* $${currentBalanceInUSD} USD

${project.createdOwnerName && project.createdOwnerEmail ? `*Project Created By:* ${project.createdOwnerName.toString()} (${project.createdOwnerEmail.toString()})` : ""}`;

      SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(NotificationSlackWebhookOnSubscriptionUpdate),
        text: slackMessage,
      }).catch((error: Exception) => {
        logger.error(
          "Error sending slack message for AI balance refill: " + error,
        );
      });
    }
  }
}

export default new AIBillingService();
