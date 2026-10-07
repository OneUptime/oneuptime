import {
  IsBillingEnabled,
  NotificationSlackWebhookOnSubscriptionUpdate,
} from "../EnvironmentConfig";
import { SemaphoreMutex } from "../Infrastructure/Semaphore";
import logger, { LogAttributes } from "../Utils/Logger";
import BaseService from "./BaseService";
import BillingService from "./BillingService";
import ProjectService from "./ProjectService";
import BadDataException from "../../Types/Exception/BadDataException";
import Email from "../../Types/Email";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import AutoRechargeState from "../../Types/Billing/AutoRechargeState";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import {
  BillingFailureNoticeKind,
  shouldSendBillingFailureNotice,
} from "../Utils/Billing/BillingFailureNoticeThrottle";
import BalanceRechargeGuard, {
  AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS,
  AutoRechargeSettings,
  getAutoRechargeSettings,
} from "../Utils/Billing/BalanceRechargeGuard";
import URL from "../../Types/API/URL";
import Exception from "../../Types/Exception/Exception";

/*
 * The balance SMS, calls, WhatsApp and Telegram are paid from where
 * OneUptime bills (OneUptime Cloud), and its recharges.
 *
 * Every change to the balance is one statement on the project row that
 * answers what the balance became (ProjectService.creditSmsOrCallBalance
 * InUSDCents / deductSmsOrCallBalanceInUSDCents) - never "read it, then
 * write back what it should be", which lost whatever another message or
 * recharge wrote in between.
 *
 * Every recharge - by hand, or by Auto Recharge when a message finds the
 * balance low - takes this lock first, one project at a time, and reads the
 * balance again once it holds it. So the messages of a paging storm that
 * find the balance low at the same moment charge the card once: the first
 * recharges, and the others, waiting their turn, find the balance it added
 * and charge nothing. They used to each charge the card.
 *
 * Messages never stop for the lock. Without the shared cache there is no
 * lock, and Auto Recharge charges nothing - two servers could each charge
 * the card - but the message still goes out on the balance that is there,
 * and the recharge is tried again with the next message (with a log line).
 */
export const SMS_OR_CALL_RECHARGE_LOCK_NAMESPACE: string =
  "NotificationService.recharge";

/*
 * After an automatic recharge fails - no payment method, a declined card -
 * Auto Recharge waits this long before it charges the card again: an hour,
 * as for AI credits (Utils/Billing/BalanceRechargeGuard). It used to try
 * the card again for every message sent while the balance was low - during
 * a paging storm, a voided invoice per page. A recharge by hand, or saving
 * Auto Recharge again, tries at once and, when it works, ends the wait.
 */
export const SMS_OR_CALL_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS: number =
  AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS;

const SMS_OR_CALL_AUTO_RECHARGE_FAILED_NAMESPACE: string =
  "sms-or-call-auto-recharge-failed";

// The recharge lock and the wait after a failed charge, in the shared cache.
const smsOrCallRechargeGuard: BalanceRechargeGuard = new BalanceRechargeGuard({
  balanceName: "SMS and call balance",
  lockNamespace: SMS_OR_CALL_RECHARGE_LOCK_NAMESPACE,
  failureNamespace: SMS_OR_CALL_AUTO_RECHARGE_FAILED_NAMESPACE,
});

// A change to Auto Recharge that is not written yet (ProjectService).
export interface SmsOrCallAutoRechargeChange {
  enableAutoRechargeSmsOrCallBalance: boolean;
  autoRechargeSmsOrCallByBalanceInUSD?: number | undefined;
  autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD?: number | undefined;
  /*
   * Somebody saving Auto Recharge: try the card now, whatever failed
   * before - it is a deliberate try, and its answer is shown to them.
   */
  ignoreRecentFailure?: boolean | undefined;
}

type AutoRechargeColumns = Pick<
  Project,
  | "enableAutoRechargeSmsOrCallBalance"
  | "autoRechargeSmsOrCallByBalanceInUSD"
  | "autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD"
>;

export class NotificationService extends BaseService {
  public constructor() {
    super();
  }

  /*
   * What Auto Recharge of the balance is set to: on, with an amount to add
   * and a balance to add it at - or, with any of them missing, off
   * (Utils/Billing/BalanceRechargeGuard). A change not written yet decides
   * over the row.
   */
  public getAutoRechargeSettings(
    project: AutoRechargeColumns,
    change?: SmsOrCallAutoRechargeChange | undefined,
  ): AutoRechargeSettings {
    return getAutoRechargeSettings({
      isEnabled: change
        ? change.enableAutoRechargeSmsOrCallBalance === true
        : project.enableAutoRechargeSmsOrCallBalance === true,
      rechargeByInUSD: {
        changed: change?.autoRechargeSmsOrCallByBalanceInUSD,
        stored: project.autoRechargeSmsOrCallByBalanceInUSD,
      },
      whenBalanceFallsToInUSD: {
        changed: change?.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD,
        stored: project.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD,
      },
    });
  }

  /*
   * What Auto Recharge would do for this project now, when a message finds
   * the balance low: nothing (Off), recharge it first (Ready), or nothing
   * for now because its last charge failed (Failed) - which Project
   * Settings > Notification Settings shows, so nobody has to wait for the
   * owners' email to find out.
   *
   * A failure that cannot be read (the shared cache is down) reads as none.
   */
  @CaptureSpan()
  public async getAutoRechargeState(data: {
    projectId: ObjectID;
    project: AutoRechargeColumns;
  }): Promise<AutoRechargeState> {
    if (!this.getAutoRechargeSettings(data.project).isSetUp) {
      return AutoRechargeState.Off;
    }

    if (await smsOrCallRechargeGuard.hasRecentFailure(data.projectId)) {
      return AutoRechargeState.Failed;
    }

    return AutoRechargeState.Ready;
  }

  /*
   * A recharge somebody asked for: the Recharge button on Project Settings
   * > Notification Settings (POST /notification/recharge, which checks who
   * may first).
   *
   * It takes the same lock as Auto Recharge, so an automatic recharge
   * waiting behind it finds the balance this one adds and does not charge
   * the card again. If the lock cannot be taken (the shared cache is down),
   * the recharge goes ahead anyway: the person who asked for it is told
   * whether it worked, and the balance is added in one statement whatever
   * else is writing it.
   */
  @CaptureSpan()
  public async rechargeBalance(
    projectId: ObjectID,
    amountInUSD: number,
    options?: {
      /*
       * Whether a successful recharge is worth telling the owners about.
       *
       * True for the manual "Recharge" button in Project Settings, where the
       * email is the only confirmation a person gets that their card was
       * charged: Project.sendInvoicesByEmail defaults to false, so the Stripe
       * invoice is filed rather than sent, and the Slack notification is an
       * operator webhook that most installs never configure.
       *
       * False where nobody pressed anything (rechargeIfBalanceIsLow runs
       * inline on SMS, call, WhatsApp and Telegram attempts) - there, "we
       * topped your balance up" is not news, and during a paging storm it
       * would be one email to every owner per recharge.
       */
      sendOwnerConfirmationEmail?: boolean | undefined;
    },
  ): Promise<number> {
    if (!IsBillingEnabled) {
      throw new BadDataException("Billing is not enabled");
    }

    const lock: SemaphoreMutex | null =
      await smsOrCallRechargeGuard.takeLock(projectId);

    try {
      return await this.chargeAndCredit({
        projectId,
        amountInUSD,
        isAutomatic: false,
        sendOwnerConfirmationEmail:
          options?.sendOwnerConfirmationEmail !== false,
      });
    } finally {
      await smsOrCallRechargeGuard.releaseLock(lock, projectId);
    }
  }

  /*
   * Auto Recharge: if the balance is below the one Auto Recharge is set to
   * recharge at, add its amount. Answers the balance afterwards - the one
   * the message that asked is then paid from.
   *
   * Asked inline by every SMS, call, WhatsApp and Telegram message paid from
   * the balance (SmsService, CallService, WhatsAppService,
   * TelegramService), and when somebody turns Auto Recharge on (`change`,
   * not written yet: then the card is tried at once).
   *
   * Once per low balance, however many messages ask at once: the check is
   * made again holding the recharge lock, so the messages that waited find
   * the balance the first one added. Never without the lock - two servers
   * could each charge the card - so when it cannot be taken nothing is
   * charged, and the balance is answered as it is: the message still goes
   * out if that pays for it, and the next message tries the recharge again.
   * After a failed charge it waits SMS_OR_CALL_AUTO_RECHARGE_RETRY_AFTER_IN
   * _SECONDS before trying the card again.
   *
   * A charge that fails throws, after telling the owners (once a day); the
   * senders log it and go on with the balance that is there.
   */
  @CaptureSpan()
  public async rechargeIfBalanceIsLow(
    projectId: ObjectID,
    change?: SmsOrCallAutoRechargeChange | undefined,
  ): Promise<number> {
    if (!projectId || !IsBillingEnabled) {
      return 0;
    }

    // A first look without the lock: most messages end here, with no charge.
    const firstLook: Project | null = await this.readAutoRechargeRow(projectId);

    if (!firstLook) {
      return 0;
    }

    if (!this.needsRecharge(firstLook, change)) {
      return firstLook.smsOrCallCurrentBalanceInUSDCents || 0;
    }

    if (
      !change?.ignoreRecentFailure &&
      (await smsOrCallRechargeGuard.hasRecentFailure(projectId))
    ) {
      return firstLook.smsOrCallCurrentBalanceInUSDCents || 0;
    }

    const lock: SemaphoreMutex | null =
      await smsOrCallRechargeGuard.takeLock(projectId);

    if (!lock) {
      logger.error(
        `SMS and call balance: Auto Recharge of project ${projectId.toString()} did not run: the recharge lock could not be taken, and without it two servers could each charge the card. Messages the balance still pays for go out; the next message tries the recharge again.`,
        { projectId: projectId.toString() } as LogAttributes,
      );
      return firstLook.smsOrCallCurrentBalanceInUSDCents || 0;
    }

    try {
      /*
       * Again, holding the lock: a recharge that finished while this one
       * waited has added its balance, and a failure meanwhile starts the
       * wait.
       */
      const project: Project | null = await this.readAutoRechargeRow(projectId);

      if (!project) {
        return 0;
      }

      if (!this.needsRecharge(project, change)) {
        return project.smsOrCallCurrentBalanceInUSDCents || 0;
      }

      if (
        !change?.ignoreRecentFailure &&
        (await smsOrCallRechargeGuard.hasRecentFailure(projectId))
      ) {
        return project.smsOrCallCurrentBalanceInUSDCents || 0;
      }

      return await this.chargeAndCredit({
        projectId,
        amountInUSD: this.getAutoRechargeSettings(project, change)
          .rechargeByInUSD,
        isAutomatic: true,
        /*
         * This runs inline on SMS, call, WhatsApp and Telegram attempts, so
         * a success email here is one message to every owner per recharge,
         * in the middle of the storm that caused it.
         */
        sendOwnerConfirmationEmail: false,
      });
    } finally {
      await smsOrCallRechargeGuard.releaseLock(lock, projectId);
    }
  }

  // Set up, and below the balance it recharges at.
  private needsRecharge(
    project: Project,
    change?: SmsOrCallAutoRechargeChange | undefined,
  ): boolean {
    const settings: AutoRechargeSettings = this.getAutoRechargeSettings(
      project,
      change,
    );

    return (
      settings.isSetUp &&
      (project.smsOrCallCurrentBalanceInUSDCents || 0) / 100 <
        settings.whenBalanceFallsToInUSD
    );
  }

  private async readAutoRechargeRow(
    projectId: ObjectID,
  ): Promise<Project | null> {
    return await ProjectService.findOneById({
      id: projectId,
      select: {
        smsOrCallCurrentBalanceInUSDCents: true,
        enableAutoRechargeSmsOrCallBalance: true,
        autoRechargeSmsOrCallByBalanceInUSD: true,
        autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Charge the project's card and add the balance. The caller holds the
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
     * place. This is a local flag rather than a mutation of `project` so it is
     * obvious it exists only to coordinate those two blocks.
     */
    let ownersAlreadyToldAboutThisFailure: boolean = false;

    try {
      if (
        !(await BillingService.hasPaymentMethods(
          project.paymentProviderCustomerId!,
        ))
      ) {
        /*
         * The same 24h window as the catch below, for the same reason: the
         * project boolean this branch used to latch on is cleared only by a
         * SUCCESSFUL recharge, so a project that never manages one was told
         * once and then never again. A window says it once a day until
         * somebody fixes it, which is what an ACTION REQUIRED message is for.
         */
        ownersAlreadyToldAboutThisFailure = true;

        const shouldTellOwners: boolean = await shouldSendBillingFailureNotice({
          projectId: project.id!,
          kind: BillingFailureNoticeKind.SmsAndCallRechargeFailed,
        });

        if (shouldTellOwners) {
          await ProjectService.updateOneById({
            data: {
              failedCallAndSMSBalanceChargeNotificationSentToOwners: true,
            },
            id: project.id!,
            props: {
              isRoot: true,
            },
          });
          await ProjectService.sendEmailToProjectOwners(
            project.id!,
            "ACTION REQUIRED: SMS and Call Recharge Failed for project - " +
              (project.name || ""),
            `We have tried to recharge your SMS and Call balance for project - ${
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
        "SMS or Call Balance Recharge",
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
       * Auto Recharge waits before it tries the card again, so the messages
       * sent while the balance is low do not each try it once more.
       */
      if (data.isAutomatic) {
        await smsOrCallRechargeGuard.rememberFailure(project.id!);
      }

      /*
       * This block used to write failedCallAndSMSBalanceChargeNotificationSent
       * ToOwners and then send WITHOUT ever reading it, so a project with a
       * declined card mailed every owner once per paging attempt - inline on
       * every SMS and call, during the outage the pages were about.
       *
       * The guard is a 24h window rather than that boolean deliberately. The
       * boolean is only cleared by a successful recharge, so latching on it
       * would mean: no card -> mail once and latch -> owner adds a card -> the
       * card is declined -> the recharge can never succeed -> the latch never
       * clears -> nobody is ever told the new card failed, and paging quietly
       * stops. A window collapses the storm to one email a day and still
       * reports a new failure within a day. See BillingFailureNoticeThrottle.
       */
      if (!ownersAlreadyToldAboutThisFailure) {
        const shouldTellOwners: boolean = await shouldSendBillingFailureNotice({
          projectId: project.id!,
          kind: BillingFailureNoticeKind.SmsAndCallRechargeFailed,
        });

        if (shouldTellOwners) {
          await ProjectService.updateOneById({
            data: {
              failedCallAndSMSBalanceChargeNotificationSentToOwners: true,
            },
            id: project.id!,
            props: {
              isRoot: true,
            },
          });
          await ProjectService.sendEmailToProjectOwners(
            project.id!,
            "ACTION REQUIRED: SMS and Call Recharge Failed for project - " +
              (project.name || ""),
            `We have tried recharged your SMS and Call balance for project - ${
              project.name || ""
            } and failed. Please make sure your payment method is upto date and has sufficient balance. You can add new payment methods in Project Settings.`,
          );
        }
      }
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
      throw err;
    }

    /*
     * The card is charged: add the balance in one statement, to whatever it
     * is now, and re-arm the owners' notices with it.
     */
    let updatedAmount: number;

    try {
      updatedAmount = await ProjectService.creditSmsOrCallBalanceInUSDCents({
        projectId: project.id!,
        amountInUSDCents: Math.round(amountInUSD * 100),
      });
    } catch (err) {
      logger.error(
        `SMS and call balance: project ${project.id!.toString()} was charged ${amountInUSD} USD for SMS and call balance, and the balance could not be added: ${err}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      throw err;
    }

    // The card works: Auto Recharge need not wait any more.
    await smsOrCallRechargeGuard.forgetFailure(project.id!);

    /*
     * The confirmation is suppressed for AUTO-recharge only. This used to
     * fire unconditionally, and because rechargeIfBalanceIsLow runs inline
     * on SMS, call, WhatsApp and Telegram attempts, a project that
     * auto-recharges during a paging storm mailed every owner once per
     * recharge. Somebody who deliberately clicked "Recharge" still gets
     * told: nothing else reliably tells them, because
     * Project.sendInvoicesByEmail defaults to false.
     */
    if (data.sendOwnerConfirmationEmail) {
      await ProjectService.sendEmailToProjectOwners(
        project.id!,
        "SMS and Call Recharge Successful for project - " +
          (project.name || ""),
        `We have successfully recharged your SMS and Call balance for project - ${
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
      logger.error("Error sending slack message for balance refill: " + error, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
    });

    return updatedAmount;
  }

  @CaptureSpan()
  private async sendBalanceRefillSlackNotification(data: {
    project: Project;
    amountInUSD: number;
    currentBalanceInUSD: number;
  }): Promise<void> {
    const { project, amountInUSD, currentBalanceInUSD } = data;

    if (NotificationSlackWebhookOnSubscriptionUpdate) {
      const slackMessage: string = `*SMS and Call Balance Refilled:*
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
          "Error sending slack message for balance refill: " + error,
          { projectId: project.id?.toString() } as LogAttributes,
        );
      });
    }
  }
}

export default new NotificationService();
