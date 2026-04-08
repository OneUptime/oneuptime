import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import DatabaseConfig from "../DatabaseConfig";
import {
  AllowedSubscribersCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import ProjectSMTPConfigService from "../Services/ProjectSmtpConfigService";
import CreateBy from "../Types/Database/CreateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import MailService from "./MailService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import SmsService from "./SmsService";
import StatusPageService from "./StatusPageService";
import { StatusPageApiRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Model from "../../Models/DatabaseModels/StatusPageSubscriber";
import PositiveNumber from "../../Types/PositiveNumber";
import StatusPageEventType from "../../Types/StatusPage/StatusPageEventType";
import NumberUtil from "../../Utils/Number";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    data: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    logger.debug("onBeforeCreate called with data:", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
    logger.debug(data, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);

    if (!data.data.statusPageId) {
      logger.debug("Status Page ID is missing.", { projectId: data.data.projectId?.toString() } as LogAttributes);
      throw new BadDataException("Status Page ID is required.");
    }

    if (!data.data.projectId) {
      logger.debug("Project ID is missing.", { statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
      throw new BadDataException("Project ID is required.");
    }

    const projectId: ObjectID = data.data.projectId;
    logger.debug(`Project ID: ${projectId}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);

    // if the project is on the free plan, then only allow 1 status page.
    if (IsBillingEnabled) {
      logger.debug("Billing is enabled.", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
      const currentPlan: CurrentPlan =
        await ProjectService.getCurrentPlan(projectId);
      logger.debug(`Current Plan: ${JSON.stringify(currentPlan)}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);

      if (currentPlan.isSubscriptionUnpaid) {
        logger.debug("Subscription is unpaid.", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
        throw new BadDataException(
          "Your subscription is unpaid. Please update your payment method and to add subscribers.",
        );
      }

      if (currentPlan.plan === PlanType.Free) {
        logger.debug("Current plan is Free.", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
        const subscribersCount: PositiveNumber = await this.countBy({
          query: {
            projectId: projectId,
          },
          props: {
            isRoot: true,
          },
        });
        logger.debug(`Subscribers Count: ${subscribersCount.toNumber()}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);

        if (subscribersCount.toNumber() >= AllowedSubscribersCountInFreePlan) {
          logger.debug(
            "Reached maximum allowed subscriber limit for the free plan.",
            { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes,
          );
          throw new BadDataException(
            `You have reached the maximum allowed subscriber limit for the free plan. Please upgrade your plan to add more subscribers.`,
          );
        }
      }
    }

    let subscriber: Model | null = null;

    if (data.data.subscriberEmail) {
      logger.debug(`Subscriber Email: ${data.data.subscriberEmail}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
      subscriber = await this.findOneBy({
        query: {
          statusPageId: data.data.statusPageId,
          subscriberEmail: data.data.subscriberEmail,
        },
        select: {
          _id: true,
          isUnsubscribed: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
      logger.debug(`Found Subscriber by Email: ${JSON.stringify(subscriber)}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
    }

    if (data.data.subscriberPhone) {
      logger.debug(`Subscriber Phone: ${data.data.subscriberPhone}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
      // check if this project has SMS enabled.
      const isSMSEnabled: boolean =
        await ProjectService.isSMSNotificationsEnabled(projectId);
      logger.debug(`Is SMS Enabled: ${isSMSEnabled}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);

      if (!isSMSEnabled) {
        logger.debug("SMS notifications are not enabled for this project.", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
        throw new BadDataException(
          "SMS notifications are not enabled for this project. Please enable SMS notifications in the Project Settings > Notifications Settings.",
        );
      }

      subscriber = await this.findOneBy({
        query: {
          statusPageId: data.data.statusPageId,
          subscriberPhone: data.data.subscriberPhone,
        },
        select: {
          _id: true,
          isUnsubscribed: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      logger.debug(`Found Subscriber by Phone: ${JSON.stringify(subscriber)}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
    }

    if (subscriber && !subscriber.isUnsubscribed) {
      logger.debug("Subscriber is already subscribed and not unsubscribed.", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
      throw new BadDataException(
        "You are already subscribed to this status page.",
      );
    }

    // if the user is unsubscribed, delete this record and it'll create a new one.
    if (subscriber) {
      logger.debug("Subscriber is unsubscribed. Deleting old record.", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
      await this.deleteOneBy({
        query: {
          _id: subscriber?._id as string,
        },
        props: {
          ignoreHooks: true,
          isRoot: true,
        },
      });
    }

    const statuspages: Array<StatusPage> =
      await this.getStatusPagesToSendNotification([data.data.statusPageId]);
    logger.debug(`Status Pages: ${JSON.stringify(statuspages)}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);

    const statuspage: StatusPage | undefined = statuspages.find(
      (statuspage: StatusPage) => {
        return (
          statuspage._id?.toString() === data.data.statusPageId?.toString()
        );
      },
    );

    if (!statuspage || !statuspage.projectId) {
      logger.debug("Status Page not found or Project ID is missing.", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
      throw new BadDataException("Status Page not found");
    }

    data.data.projectId = statuspage.projectId;
    logger.debug(`Updated Project ID: ${data.data.projectId}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);

    const isEmailSubscriber: boolean = Boolean(data.data.subscriberEmail);
    const isSubscriptionConfirmed: boolean = Boolean(
      data.data.isSubscriptionConfirmed,
    );
    logger.debug(`Is Email Subscriber: ${isEmailSubscriber}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
    logger.debug(`Is Subscription Confirmed: ${isSubscriptionConfirmed}`, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);

    if (isEmailSubscriber && !isSubscriptionConfirmed) {
      data.data.isSubscriptionConfirmed = false;
    } else {
      data.data.isSubscriptionConfirmed = true; // if the subscriber is not email, then set it to true for SMS subscribers / slack subscribers.
    }
    logger.debug(
      `Final Subscription Confirmed: ${data.data.isSubscriptionConfirmed}`,
      { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes,
    );

    // if slack incoming webhook is provided, then see if it starts with https://hooks.slack.com/services/

    if (data.data.slackIncomingWebhookUrl) {
      logger.debug(
        `Slack Incoming Webhook URL: ${data.data.slackIncomingWebhookUrl}`,
        { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes,
      );
      if (
        !SlackUtil.isValidSlackIncomingWebhookUrl(
          data.data.slackIncomingWebhookUrl,
        )
      ) {
        logger.debug("Invalid Slack Incoming Webhook URL.", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
        throw new BadDataException("Invalid Slack Incoming Webhook URL.");
      }
    }

    // Validate Microsoft Teams webhook URL if provided
    if (data.data.microsoftTeamsIncomingWebhookUrl) {
      logger.debug(
        `Microsoft Teams Incoming Webhook URL: ${data.data.microsoftTeamsIncomingWebhookUrl}`,
        { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes,
      );
      if (
        !MicrosoftTeamsUtil.isValidMicrosoftTeamsIncomingWebhookUrl(
          data.data.microsoftTeamsIncomingWebhookUrl,
        )
      ) {
        logger.debug("Invalid Microsoft Teams Incoming Webhook URL.", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
        throw new BadDataException(
          "Invalid Microsoft Teams Incoming Webhook URL.",
        );
      }
    }

    data.data.subscriptionConfirmationToken = NumberUtil.getRandomNumber(
      100000,
      999999,
    ).toString();
    logger.debug(
      `Subscription Confirmation Token: ${data.data.subscriptionConfirmationToken}`,
      { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes,
    );

    logger.debug("onBeforeCreate processed data:", { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);
    logger.debug(data, { projectId: data.data.projectId?.toString(), statusPageId: data.data.statusPageId?.toString() } as LogAttributes);

    return { createBy: data, carryForward: statuspage };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    logger.debug("onCreateSuccess called with createdItem:", { projectId: createdItem.projectId?.toString() } as LogAttributes);
    logger.debug(createdItem, { projectId: createdItem.projectId?.toString() } as LogAttributes);

    if (!createdItem.statusPageId) {
      logger.debug("Status Page ID is missing in createdItem.", { projectId: createdItem.projectId?.toString() } as LogAttributes);
      return createdItem;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      createdItem.statusPageId,
    );
    logger.debug(`Status Page URL: ${statusPageURL}`, { projectId: createdItem.projectId?.toString() } as LogAttributes);

    const statusPageName: string =
      onCreate.carryForward.pageTitle ||
      onCreate.carryForward.name ||
      "Status Page";
    logger.debug(`Status Page Name: ${statusPageName}`, { projectId: createdItem.projectId?.toString() } as LogAttributes);

    const unsubscribeLink: string = this.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      createdItem.id!,
    ).toString();
    logger.debug(`Unsubscribe Link: ${unsubscribeLink}`, { projectId: createdItem.projectId?.toString() } as LogAttributes);

    if (
      createdItem.statusPageId &&
      createdItem.subscriberPhone &&
      createdItem._id &&
      createdItem.sendYouHaveSubscribedMessage
    ) {
      logger.debug(
        "Subscriber has a phone number and sendYouHaveSubscribedMessage is true.",
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );
      const statusPage: StatusPage | null = await StatusPageService.findOneBy({
        query: {
          _id: createdItem.statusPageId.toString(),
        },
        select: {
          callSmsConfig: {
            _id: true,
            twilioAccountSID: true,
            twilioAuthToken: true,
            twilioPrimaryPhoneNumber: true,
            twilioSecondaryPhoneNumbers: true,
          },
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (!statusPage) {
        logger.debug("Status Page not found.", { projectId: createdItem.projectId?.toString() } as LogAttributes);
        return createdItem;
      }

      logger.debug(
        `Status Page Call SMS Config: ${JSON.stringify(statusPage.callSmsConfig)}`,
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );

      SmsService.sendSms(
        {
          to: createdItem.subscriberPhone,
          message: `You have been subscribed to ${statusPageName}. To unsubscribe, click on the link: ${unsubscribeLink}`,
        },
        {
          projectId: createdItem.projectId,
          isSensitive: false,
          customTwilioConfig: ProjectCallSMSConfigService.toTwilioConfig(
            statusPage.callSmsConfig,
          ),
          statusPageId: createdItem.statusPageId!,
        },
      ).catch((err: Error) => {
        logger.error(err, { projectId: createdItem.projectId?.toString() } as LogAttributes);
      });
    }

    if (
      createdItem.statusPageId &&
      createdItem.subscriberEmail &&
      createdItem._id
    ) {
      logger.debug("Subscriber has an email.", { projectId: createdItem.projectId?.toString() } as LogAttributes);
      const isSubcriptionConfirmed: boolean = Boolean(
        createdItem.isSubscriptionConfirmed,
      );
      logger.debug(`Is Subscription Confirmed: ${isSubcriptionConfirmed}`, { projectId: createdItem.projectId?.toString() } as LogAttributes);

      if (!isSubcriptionConfirmed) {
        logger.debug(
          "Subscription is not confirmed. Sending confirmation email.",
          { projectId: createdItem.projectId?.toString() } as LogAttributes,
        );
        await this.sendConfirmSubscriptionEmail({
          subscriberId: createdItem.id!,
        });
      }

      if (isSubcriptionConfirmed && createdItem.sendYouHaveSubscribedMessage) {
        logger.debug(
          "Subscription is confirmed and sendYouHaveSubscribedMessage is true. Sending 'You have subscribed' email.",
          { projectId: createdItem.projectId?.toString() } as LogAttributes,
        );
        await this.sendYouHaveSubscribedEmail({
          subscriberId: createdItem.id!,
        });
      }
    }

    // if slack incoming webhook is provided, then send a message to the slack channel.
    if (createdItem.slackIncomingWebhookUrl) {
      logger.debug("Sending Slack notification for new subscriber.", { projectId: createdItem.projectId?.toString() } as LogAttributes);
      const slackMessage: string = `## 📢 New Subscription to ${statusPageName}

**You have successfully subscribed to receive status updates!**

🔗 **Status Page:** [${statusPageName}](${statusPageURL})
📧 **Manage Subscription:** [Update preferences or unsubscribe](${unsubscribeLink})

You will receive real-time notifications for:
• Incidents and outages 
• Scheduled maintenance events  
• Service announcements
• Status updates

Stay informed about service availability! 🚀`;

      logger.debug(`Slack Message: ${slackMessage}`, { projectId: createdItem.projectId?.toString() } as LogAttributes);

      SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(createdItem.slackIncomingWebhookUrl.toString()),
        text: SlackUtil.convertMarkdownToSlackRichText(slackMessage),
      })
        .then(() => {
          logger.debug("Slack notification sent successfully.", { projectId: createdItem.projectId?.toString() } as LogAttributes);
        })
        .catch((err: Error) => {
          logger.error("Error sending Slack notification:", { projectId: createdItem.projectId?.toString() } as LogAttributes);
          logger.error(err, { projectId: createdItem.projectId?.toString() } as LogAttributes);
        });
    }

    // if Microsoft Teams incoming webhook is provided and sendYouHaveSubscribedMessage is true, then send a message to the Teams channel.
    if (
      createdItem.microsoftTeamsIncomingWebhookUrl &&
      createdItem.sendYouHaveSubscribedMessage
    ) {
      logger.debug("Sending Microsoft Teams notification for new subscriber.", { projectId: createdItem.projectId?.toString() } as LogAttributes);
      const teamsMessage: string = `## 📢 New Subscription to ${statusPageName}

**You have successfully subscribed to receive status updates!**

🔗 **Status Page:** [${statusPageName}](${statusPageURL})
📧 **Manage Subscription:** [Update preferences or unsubscribe](${unsubscribeLink})

You will receive real-time notifications for:
• Incidents and outages 
• Scheduled maintenance events  
• Service announcements
• Status updates

Stay informed about service availability! 🚀`;

      logger.debug(`Teams Message: ${teamsMessage}`, { projectId: createdItem.projectId?.toString() } as LogAttributes);

      MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(
          createdItem.microsoftTeamsIncomingWebhookUrl.toString(),
        ),
        text: teamsMessage,
      })
        .then(() => {
          logger.debug("Microsoft Teams notification sent successfully.", { projectId: createdItem.projectId?.toString() } as LogAttributes);
        })
        .catch((err: Error) => {
          logger.error("Error sending Microsoft Teams notification:", { projectId: createdItem.projectId?.toString() } as LogAttributes);
          logger.error(err, { projectId: createdItem.projectId?.toString() } as LogAttributes);
        });
    }

    logger.debug("onCreateSuccess completed.", { projectId: createdItem.projectId?.toString() } as LogAttributes);
    return createdItem;
  }

  @CaptureSpan()
  public async sendConfirmSubscriptionEmail(data: {
    subscriberId: ObjectID;
  }): Promise<void> {
    logger.debug("sendConfirmSubscriptionEmail called with data:", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
    logger.debug(data, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    // get subscriber
    const subscriber: Model | null = await this.findOneBy({
      query: {
        _id: data.subscriberId,
      },
      select: {
        statusPageId: true,
        subscriberEmail: true,
        subscriberPhone: true,
        projectId: true,
        subscriptionConfirmationToken: true,
        sendYouHaveSubscribedMessage: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
    logger.debug(`Found Subscriber: ${JSON.stringify(subscriber)}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    // get status page
    if (!subscriber || !subscriber.statusPageId) {
      logger.debug("Subscriber or Status Page ID is missing.", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
      return;
    }

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: subscriber.statusPageId.toString(),
      },
      select: {
        logoFileId: true,
        isPublicStatusPage: true,
        pageTitle: true,
        name: true,
        smtpConfig: {
          _id: true,
          hostname: true,
          port: true,
          username: true,
          password: true,
          fromEmail: true,
          fromName: true,
          secure: true,
        },
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
    logger.debug(`Found Status Page: ${JSON.stringify(statusPage)}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    if (!statusPage || !statusPage.id) {
      logger.debug("Status Page not found or ID is missing.", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
      return;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id,
    );
    logger.debug(`Status Page URL: ${statusPageURL}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";
    logger.debug(`Status Page Name: ${statusPageName}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    const host: Hostname = await DatabaseConfig.getHost();
    logger.debug(`Host: ${host}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(`HTTP Protocol: ${httpProtocol}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
    const statusPageIdString: string | null =
      statusPage.id?.toString() || statusPage._id?.toString() || null;

    const confirmSubscriptionLink: string = this.getConfirmSubscriptionLink({
      statusPageUrl: statusPageURL,
      confirmationToken: subscriber.subscriptionConfirmationToken || "",
      statusPageSubscriberId: subscriber.id!,
    }).toString();
    logger.debug(`Confirm Subscription Link: ${confirmSubscriptionLink}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    if (
      subscriber.statusPageId &&
      subscriber.subscriberEmail &&
      subscriber._id
    ) {
      const unsubscribeUrl: string = this.getUnsubscribeLink(
        URL.fromString(statusPageURL),
        subscriber.id!,
      ).toString();
      logger.debug(`Unsubscribe URL: ${unsubscribeUrl}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

      MailService.sendMail(
        {
          toEmail: subscriber.subscriberEmail,
          templateType: EmailTemplateType.ConfirmStatusPageSubscription,
          vars: {
            statusPageName: statusPageName,
            logoUrl:
              statusPage.logoFileId && statusPageIdString
                ? new URL(httpProtocol, host)
                    .addRoute(StatusPageApiRoute)
                    .addRoute(`/logo/${statusPageIdString}`)
                    .toString()
                : "",
            statusPageUrl: statusPageURL,
            isPublicStatusPage: statusPage.isPublicStatusPage
              ? "true"
              : "false",
            confirmationUrl: confirmSubscriptionLink,
            unsubscribeUrl: unsubscribeUrl,
          },
          subject: "Confirm your subscription to " + statusPageName,
        },
        {
          projectId: subscriber.projectId,
          mailServer: ProjectSMTPConfigService.toEmailServer(
            statusPage.smtpConfig,
          ),
          statusPageId: statusPage.id!,
        },
      ).catch((err: Error) => {
        logger.error(err, { projectId: subscriber.projectId?.toString() } as LogAttributes);
      });
      logger.debug("Confirmation email sent.", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
    } else {
      logger.debug("Subscriber email or ID is missing.", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
    }
  }

  @CaptureSpan()
  public async sendYouHaveSubscribedEmail(data: {
    subscriberId: ObjectID;
  }): Promise<void> {
    logger.debug("sendYouHaveSubscribedEmail called with data:", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
    logger.debug(data, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    // get subscriber
    const subscriber: Model | null = await this.findOneBy({
      query: {
        _id: data.subscriberId,
      },
      select: {
        statusPageId: true,
        subscriberEmail: true,
        subscriberPhone: true,
        projectId: true,
        sendYouHaveSubscribedMessage: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
    logger.debug(`Found Subscriber: ${JSON.stringify(subscriber)}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    // get status page
    if (!subscriber || !subscriber.statusPageId) {
      logger.debug("Subscriber or Status Page ID is missing.", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
      return;
    }

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: subscriber.statusPageId.toString(),
      },
      select: {
        logoFileId: true,
        isPublicStatusPage: true,
        pageTitle: true,
        name: true,
        smtpConfig: {
          _id: true,
          hostname: true,
          port: true,
          username: true,
          password: true,
          fromEmail: true,
          fromName: true,
          secure: true,
        },
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
    logger.debug(`Found Status Page: ${JSON.stringify(statusPage)}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    if (!statusPage || !statusPage.id) {
      logger.debug("Status Page not found or ID is missing.", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
      return;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id,
    );
    logger.debug(`Status Page URL: ${statusPageURL}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";
    logger.debug(`Status Page Name: ${statusPageName}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    const host: Hostname = await DatabaseConfig.getHost();
    logger.debug(`Host: ${host}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(`HTTP Protocol: ${httpProtocol}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
    const statusPageIdString: string | null =
      statusPage.id?.toString() || statusPage._id?.toString() || null;

    const unsubscribeLink: string = this.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      subscriber.id!,
    ).toString();
    logger.debug(`Unsubscribe Link: ${unsubscribeLink}`, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    if (
      subscriber.statusPageId &&
      subscriber.subscriberEmail &&
      subscriber._id
    ) {
      logger.debug("Subscriber has an email and ID.", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
      MailService.sendMail(
        {
          toEmail: subscriber.subscriberEmail,
          templateType: EmailTemplateType.SubscribedToStatusPage,
          vars: {
            statusPageName: statusPageName,
            logoUrl:
              statusPage.logoFileId && statusPageIdString
                ? new URL(httpProtocol, host)
                    .addRoute(StatusPageApiRoute)
                    .addRoute(`/logo/${statusPageIdString}`)
                    .toString()
                : "",
            statusPageUrl: statusPageURL,
            isPublicStatusPage: statusPage.isPublicStatusPage
              ? "true"
              : "false",
            unsubscribeUrl: unsubscribeLink,
          },
          subject: "You have been subscribed to " + statusPageName,
        },
        {
          projectId: subscriber.projectId,
          mailServer: ProjectSMTPConfigService.toEmailServer(
            statusPage.smtpConfig,
          ),
          statusPageId: statusPage.id!,
        },
      ).catch((err: Error) => {
        logger.error("Error sending subscription email:", { projectId: subscriber.projectId?.toString() } as LogAttributes);
        logger.error(err, { projectId: subscriber.projectId?.toString() } as LogAttributes);
      });
      logger.debug("Subscription email sent successfully.", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
    } else {
      logger.debug("Subscriber email or ID is missing.", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
    }
  }

  public getConfirmSubscriptionLink(data: {
    statusPageUrl: string;
    confirmationToken: string;
    statusPageSubscriberId: ObjectID;
  }): URL {
    logger.debug("getConfirmSubscriptionLink called with data:", { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);
    logger.debug(data, { statusPageSubscriberId: data.subscriberId?.toString() } as LogAttributes);

    const confirmSubscriptionLink: URL = URL.fromString(
      data.statusPageUrl,
    ).addRoute(
      `/confirm-subscription/${data.subscriberId.toString()}?verification-token=${data.confirmationToken}`,
    );

    logger.debug(
      `Generated Confirm Subscription Link: ${confirmSubscriptionLink.toString()}`,
      { statusPageId: statusPageId?.toString() } as LogAttributes,
    );
    return confirmSubscriptionLink;
  }

  @CaptureSpan()
  public async getSubscribersByStatusPage(
    statusPageId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<Model>> {
    logger.debug("getSubscribersByStatusPage called with statusPageId:", { statusPageId: statusPageId?.toString() } as LogAttributes);
    logger.debug(statusPageId, { statusPageId: statusPageId?.toString() } as LogAttributes);
    logger.debug("DatabaseCommonInteractionProps:", { statusPageId: statusPageId?.toString() } as LogAttributes);
    logger.debug(props, { statusPageId: statusPageId?.toString() } as LogAttributes);

    const subscribers: Array<Model> = await this.findBy({
      query: {
        statusPageId: statusPageId,
        isUnsubscribed: false,
        isSubscriptionConfirmed: true,
      },
      select: {
        _id: true,
        subscriberEmail: true,
        subscriberPhone: true,
        subscriberWebhook: true,
        slackIncomingWebhookUrl: true,
        microsoftTeamsIncomingWebhookUrl: true,
        isSubscribedToAllResources: true,
        statusPageResources: true,
        isSubscribedToAllEventTypes: true,
        statusPageEventTypes: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: props,
    });

    logger.debug("Found subscribers:", { statusPageId: statusPageId?.toString() } as LogAttributes);
    logger.debug(subscribers, { statusPageId: statusPageId?.toString() } as LogAttributes);

    return subscribers;
  }

  public getUnsubscribeLink(
    statusPageUrl: URL,
    statusPageSubscriberId: ObjectID,
  ): URL {
    logger.debug("getUnsubscribeLink called with statusPageUrl:", { statusPageSubscriberId: statusPageSubscriberId?.toString() } as LogAttributes);
    logger.debug(statusPageUrl, { statusPageSubscriberId: statusPageSubscriberId?.toString() } as LogAttributes);
    logger.debug("statusPageSubscriberId:", { statusPageSubscriberId: statusPageSubscriberId?.toString() } as LogAttributes);
    logger.debug(statusPageSubscriberId, { statusPageSubscriberId: statusPageSubscriberId?.toString() } as LogAttributes);

    const unsubscribeLink: URL = URL.fromString(
      statusPageUrl.toString(),
    ).addRoute("/update-subscription/" + statusPageSubscriberId.toString());

    logger.debug("Generated Unsubscribe Link:", { statusPageSubscriberId: statusPageSubscriberId?.toString() } as LogAttributes);
    logger.debug(unsubscribeLink, { statusPageSubscriberId: statusPageSubscriberId?.toString() } as LogAttributes);

    return unsubscribeLink;
  }

  public shouldSendNotification(data: {
    subscriber: Model;
    statusPageResources: Array<StatusPageResource>;
    statusPage: StatusPage;
    eventType: StatusPageEventType;
  }): boolean {
    logger.debug("shouldSendNotification called with data:", { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);
    logger.debug(data, { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);

    let shouldSendNotification: boolean = true; // default to true.

    if (data.subscriber.isUnsubscribed) {
      logger.debug("Subscriber is unsubscribed.", { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);
      shouldSendNotification = false;
      return shouldSendNotification;
    }

    if (
      data.statusPage.allowSubscribersToChooseResources &&
      !data.subscriber.isSubscribedToAllResources &&
      !(
        data.eventType === StatusPageEventType.Announcement &&
        data.statusPageResources.length === 0
      ) // announcements with no monitors don't use resource filtering
    ) {
      logger.debug(
        "Subscriber can choose resources and is not subscribed to all resources.",
        { statusPageId: data.statusPage?.id?.toString() } as LogAttributes,
      );
      const subscriberResourceIds: Array<string> =
        data.subscriber.statusPageResources?.map(
          (resource: StatusPageResource) => {
            return resource.id?.toString() as string;
          },
        ) || [];

      logger.debug(`Subscriber Resource IDs: ${subscriberResourceIds}`, { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);

      let shouldSendNotificationForResource: boolean = false;

      if (subscriberResourceIds.length === 0) {
        logger.debug("Subscriber has no resource IDs.", { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);
        shouldSendNotificationForResource = false;
      } else {
        for (const resource of data.statusPageResources) {
          logger.debug(`Checking resource: ${resource.id}`, { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);
          if (
            subscriberResourceIds.includes(resource.id?.toString() as string)
          ) {
            logger.debug("Resource ID matches subscriber's resource ID.", { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);
            shouldSendNotificationForResource = true;
          }
        }
      }

      if (!shouldSendNotificationForResource) {
        logger.debug("Should not send notification for resource.", { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);
        shouldSendNotification = false;
      }
    }

    // now do for event types

    if (
      data.statusPage.allowSubscribersToChooseEventTypes &&
      !data.subscriber.isSubscribedToAllEventTypes
    ) {
      logger.debug(
        "Subscriber can choose event types and is not subscribed to all event types.",
        { statusPageId: data.statusPage?.id?.toString() } as LogAttributes,
      );
      const subscriberEventTypes: Array<StatusPageEventType> =
        data.subscriber.statusPageEventTypes || [];

      logger.debug(`Subscriber Event Types: ${subscriberEventTypes}`, { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);

      let shouldSendNotificationForEventType: boolean = false;

      if (subscriberEventTypes.includes(data.eventType)) {
        logger.debug("Event type matches subscriber's event type.", { statusPageId: data.statusPage?.id?.toString() } as LogAttributes);
        shouldSendNotificationForEventType = true;
      }

      if (!shouldSendNotificationForEventType) {
        logger.debug("Should not send notification for event type.", {} as LogAttributes);
        shouldSendNotification = false;
      }
    }

    logger.debug(
      `Final decision on shouldSendNotification: ${shouldSendNotification}`,
      {} as LogAttributes,
    );
    return shouldSendNotification;
  }

  @CaptureSpan()
  public async getStatusPagesToSendNotification(
    statusPageIds: Array<ObjectID>,
  ): Promise<Array<StatusPage>> {
    logger.debug("getStatusPagesToSendNotification called with statusPageIds:", {} as LogAttributes);
    logger.debug(statusPageIds, {} as LogAttributes);

    const statusPages: Array<StatusPage> = await StatusPageService.findBy({
      query: {
        _id: QueryHelper.any(statusPageIds),
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        _id: true,
        name: true,
        pageTitle: true,
        projectId: true,
        isPublicStatusPage: true,
        logoFileId: true,
        allowSubscribersToChooseResources: true,
        subscriberEmailNotificationFooterText: true,
        enableCustomSubscriberEmailNotificationFooterText: true,
        allowSubscribersToChooseEventTypes: true,
        smtpConfig: {
          _id: true,
          hostname: true,
          port: true,
          username: true,
          password: true,
          fromEmail: true,
          fromName: true,
          secure: true,
        },
        callSmsConfig: {
          _id: true,
          twilioAccountSID: true,
          twilioAuthToken: true,
          twilioPrimaryPhoneNumber: true,
          twilioSecondaryPhoneNumbers: true,
        },
        subscriberTimezones: true,
        reportDataInDays: true,
        isReportEnabled: true,
        showAnnouncementsOnStatusPage: true,
        showIncidentsOnStatusPage: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
      },
    });

    logger.debug("Found status pages:", {} as LogAttributes);
    logger.debug(statusPages, {} as LogAttributes);

    return statusPages;
  }

  @CaptureSpan()
  public async testSlackWebhook(data: {
    webhookUrl: string;
    statusPageId: ObjectID;
  }): Promise<void> {
    // Validate the webhook URL
    if (!data.webhookUrl.startsWith("https://hooks.slack.com/services/")) {
      throw new BadDataException("Invalid Slack webhook URL");
    }

    // Get status page info
    const statusPage: StatusPage | null = await StatusPageService.findOneById({
      id: data.statusPageId,
      props: {
        isRoot: true,
      },
      select: {
        name: true,
        pageTitle: true,
        projectId: true,
        _id: true,
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status page not found");
    }

    // Create test notification message
    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";
    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id!,
    );

    // Create markdown message for Slack
    const markdownMessage: string = `## Test Notification - ${statusPageName}

**This is a test notification from OneUptime.**

You have successfully configured Slack notifications for this status page.

You will receive real-time notifications for:
- Incidents
- Scheduled Maintenance Events
- Status Updates
- Announcements

[View Status Page](${statusPageURL})`;

    // Send the test notification
    try {
      await SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(data.webhookUrl),
        text: SlackUtil.convertMarkdownToSlackRichText(markdownMessage),
      });
    } catch (error) {
      logger.error("Error sending test Slack notification:", { projectId: statusPage?.projectId?.toString() } as LogAttributes);
      logger.error(error, { projectId: statusPage?.projectId?.toString() } as LogAttributes);
      throw error;
    }
  }
}

export default new Service();
