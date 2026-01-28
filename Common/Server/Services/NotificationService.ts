import {
  IsBillingEnabled,
  NotificationSlackWebhookOnSubscriptionUpdate,
} from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import BaseService from "./BaseService";
import BillingService from "./BillingService";
import ProjectService from "./ProjectService";
import BadDataException from "../../Types/Exception/BadDataException";
import Email from "../../Types/Email";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
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
  ): Promise<number> {
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

    try {
      if (
        !(await BillingService.hasPaymentMethods(
          project.paymentProviderCustomerId!,
        ))
      ) {
        if (!project.failedCallAndSMSBalanceChargeNotificationSentToOwners) {
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
          recipientEmail: project.financeAccountingEmail
            ? new Email(project.financeAccountingEmail)
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

      // Send Slack notification for balance refill
      this.sendBalanceRefillSlackNotification({
        project: project,
        amountInUSD: amountInUSD,
        currentBalanceInUSD: updatedAmount / 100,
      }).catch((error: Exception) => {
        logger.error(
          "Error sending slack message for balance refill: " + error,
        );
      });

      project.smsOrCallCurrentBalanceInUSDCents = updatedAmount;

      return updatedAmount;
    } catch (err) {
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
      logger.error(err);
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
        );
      });
    }
  }
}

export default new NotificationService();
