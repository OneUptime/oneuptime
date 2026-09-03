import {
  IsBillingEnabled,
  NotificationSlackWebhookOnSubscriptionUpdate,
} from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import BaseService from "./BaseService";
import BillingService from "./BillingService";
import ProjectService from "./ProjectService";
import BadDataException from "../../Types/Exception/BadDataException";
import Email from "../../Types/Email";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import {
  BillingFailureNoticeKind,
  shouldSendBillingFailureNotice,
} from "../Utils/Billing/BillingFailureNoticeThrottle";
import URL from "../../Types/API/URL";
import Exception from "../../Types/Exception/Exception";

export class NotificationService extends BaseService {
  public constructor() {
    super();
  }

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
       * False for rechargeIfBalanceIsLow, which runs inline on every SMS,
       * call, WhatsApp and Telegram attempt - there, "we topped your balance
       * up" is not news, and during a paging storm it is one email to every
       * owner per recharge.
       */
      sendOwnerConfirmationEmail?: boolean | undefined;
    },
  ): Promise<number> {
    const sendOwnerConfirmationEmail: boolean =
      options?.sendOwnerConfirmationEmail !== false;

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        smsOrCallCurrentBalanceInUSDCents: true,
        enableAutoRechargeSmsOrCallBalance: true,
        enableSmsNotifications: true,
        autoRechargeSmsOrCallByBalanceInUSD: true,
        autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
        paymentProviderCustomerId: true,
        name: true,
        failedCallAndSMSBalanceChargeNotificationSentToOwners: true,
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

      // recharge balance
      const updatedAmount: number = Math.floor(
        (project.smsOrCallCurrentBalanceInUSDCents || 0) + amountInUSD * 100,
      );

      // If the recharge is successful, then update the project balance.
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

      await ProjectService.updateOneById({
        data: {
          smsOrCallCurrentBalanceInUSDCents: updatedAmount,
          failedCallAndSMSBalanceChargeNotificationSentToOwners: false, // reset this flag
          lowCallAndSMSBalanceNotificationSentToOwners: false, // reset this flag
          notEnabledSmsOrCallNotificationSentToOwners: false,
        },
        id: project.id!,
        props: {
          isRoot: true,
        },
      });

      /*
       * The confirmation is suppressed for AUTO-recharge only. This used to
       * fire unconditionally, and because rechargeIfBalanceIsLow runs inline
       * on every SMS, call, WhatsApp and Telegram attempt, a project that
       * auto-recharges during a paging storm mailed every owner once per
       * recharge. Somebody who deliberately clicked "Recharge" still gets
       * told: nothing else reliably tells them, because
       * Project.sendInvoicesByEmail defaults to false.
       */
      if (sendOwnerConfirmationEmail) {
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
        logger.error(
          "Error sending slack message for balance refill: " + error,
          { projectId: projectId?.toString() } as LogAttributes,
        );
      });

      project.smsOrCallCurrentBalanceInUSDCents = updatedAmount;

      return updatedAmount;
    } catch (err) {
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
      logger.error(err, { projectId: projectId?.toString() } as LogAttributes);
      throw err;
    }
  }

  @CaptureSpan()
  public async rechargeIfBalanceIsLow(
    projectId: ObjectID,
    options?: {
      autoRechargeSmsOrCallByBalanceInUSD: number;
      autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: number;
      enableAutoRechargeSmsOrCallBalance: boolean;
    },
  ): Promise<number> {
    let project: Project | null = null;
    if (projectId && IsBillingEnabled) {
      // check payment methods.

      project = await ProjectService.findOneById({
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

      const autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: number =
        options?.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD ||
        project?.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD ||
        0;
      const autoRechargeSmsOrCallByBalanceInUSD: number =
        options?.autoRechargeSmsOrCallByBalanceInUSD ||
        project?.autoRechargeSmsOrCallByBalanceInUSD ||
        0;

      const enableAutoRechargeSmsOrCallBalance: boolean = options
        ? options.enableAutoRechargeSmsOrCallBalance
        : project?.enableAutoRechargeSmsOrCallBalance || false;

      if (!project) {
        return 0;
      }

      if (
        enableAutoRechargeSmsOrCallBalance &&
        autoRechargeSmsOrCallByBalanceInUSD &&
        autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD
      ) {
        if (
          (project.smsOrCallCurrentBalanceInUSDCents || 0) / 100 <
          autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD
        ) {
          const updatedAmount: number = await this.rechargeBalance(
            projectId,
            autoRechargeSmsOrCallByBalanceInUSD,
            {
              /*
               * This method is called inline from SmsService, CallService,
               * WhatsAppService and TelegramService on EVERY notification
               * attempt, so a success email here is one message to every owner
               * per recharge, in the middle of the storm that caused it.
               */
              sendOwnerConfirmationEmail: false,
            },
          );
          project.smsOrCallCurrentBalanceInUSDCents = updatedAmount;
        }
      }
    }

    return project?.smsOrCallCurrentBalanceInUSDCents || 0;
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
