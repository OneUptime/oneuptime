import {
  IsBillingEnabled,
  NotificationSlackWebhookOnSubscriptionUpdate,
} from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import BaseService from "./BaseService";
import BillingService from "./BillingService";
import ProjectService from "./ProjectService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import URL from "../../Types/API/URL";
import Exception from "../../Types/Exception/Exception";

export class AIBillingService extends BaseService {
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
        aiCurrentBalanceInUSDCents: true,
        enableAutoRechargeAiBalance: true,
        enableAi: true,
        autoAiRechargeByBalanceInUSD: true,
        autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
        paymentProviderCustomerId: true,
        name: true,
        failedAiBalanceChargeNotificationSentToOwners: true,
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
        if (!project.failedAiBalanceChargeNotificationSentToOwners) {
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

      // recharge balance
      const updatedAmount: number = Math.floor(
        (project.aiCurrentBalanceInUSDCents || 0) + amountInUSD * 100,
      );

      // If the recharge is successful, then update the project balance.
      await BillingService.generateInvoiceAndChargeCustomer(
        project.paymentProviderCustomerId!,
        "AI Balance Recharge",
        amountInUSD,
      );

      await ProjectService.updateOneById({
        data: {
          aiCurrentBalanceInUSDCents: updatedAmount,
          failedAiBalanceChargeNotificationSentToOwners: false, // reset this flag
          lowAiBalanceNotificationSentToOwners: false, // reset this flag
          notEnabledAiNotificationSentToOwners: false,
        },
        id: project.id!,
        props: {
          isRoot: true,
        },
      });

      await ProjectService.sendEmailToProjectOwners(
        project.id!,
        "AI Balance Recharge Successful for project - " + (project.name || ""),
        `We have successfully recharged your AI balance for project - ${
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
          "Error sending slack message for AI balance refill: " + error,
        );
      });

      project.aiCurrentBalanceInUSDCents = updatedAmount;

      return updatedAmount;
    } catch (err) {
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
      logger.error(err);
      throw err;
    }
  }

  @CaptureSpan()
  public async rechargeIfBalanceIsLow(
    projectId: ObjectID,
    options?: {
      autoAiRechargeByBalanceInUSD: number;
      autoRechargeAiWhenCurrentBalanceFallsInUSD: number;
      enableAutoRechargeAiBalance: boolean;
    },
  ): Promise<number> {
    let project: Project | null = null;
    if (projectId && IsBillingEnabled) {
      // check payment methods.

      project = await ProjectService.findOneById({
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

      const autoRechargeAiWhenCurrentBalanceFallsInUSD: number =
        options?.autoRechargeAiWhenCurrentBalanceFallsInUSD ||
        project?.autoRechargeAiWhenCurrentBalanceFallsInUSD ||
        0;
      const autoAiRechargeByBalanceInUSD: number =
        options?.autoAiRechargeByBalanceInUSD ||
        project?.autoAiRechargeByBalanceInUSD ||
        0;

      const enableAutoRechargeAiBalance: boolean = options
        ? options.enableAutoRechargeAiBalance
        : project?.enableAutoRechargeAiBalance || false;

      if (!project) {
        return 0;
      }

      if (
        enableAutoRechargeAiBalance &&
        autoAiRechargeByBalanceInUSD &&
        autoRechargeAiWhenCurrentBalanceFallsInUSD
      ) {
        if (
          (project.aiCurrentBalanceInUSDCents || 0) / 100 <
          autoRechargeAiWhenCurrentBalanceFallsInUSD
        ) {
          const updatedAmount: number = await this.rechargeBalance(
            projectId,
            autoAiRechargeByBalanceInUSD,
          );
          project.aiCurrentBalanceInUSDCents = updatedAmount;
        }
      }
    }

    return project?.aiCurrentBalanceInUSDCents || 0;
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
