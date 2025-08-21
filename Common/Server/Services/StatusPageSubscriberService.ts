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
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import MailService from "./MailService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import SmsService from "./SmsService";
import StatusPageService from "./StatusPageService";
import { FileRoute } from "../../ServiceRoute";
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
    logger.debug("onBeforeCreate called with data:");
    logger.debug(data);

    if (!data.data.statusPageId) {
      logger.debug("Status Page ID is missing.");
      throw new BadDataException("Status Page ID is required.");
    }

    if (!data.data.projectId) {
      logger.debug("Project ID is missing.");
      throw new BadDataException("Project ID is required.");
    }

    const projectId: ObjectID = data.data.projectId;
    logger.debug(`Project ID: ${projectId}`);

    // if the project is on the free plan, then only allow 1 status page.
    if (IsBillingEnabled) {
      logger.debug("Billing is enabled.");
      const currentPlan: CurrentPlan =
        await ProjectService.getCurrentPlan(projectId);
      logger.debug(`Current Plan: ${JSON.stringify(currentPlan)}`);

      if (currentPlan.isSubscriptionUnpaid) {
        logger.debug("Subscription is unpaid.");
        throw new BadDataException(
          "Your subscription is unpaid. Please update your payment method and to add subscribers.",
        );
      }

      if (currentPlan.plan === PlanType.Free) {
        logger.debug("Current plan is Free.");
        const subscribersCount: PositiveNumber = await this.countBy({
          query: {
            projectId: projectId,
          },
          props: {
            isRoot: true,
          },
        });
        logger.debug(`Subscribers Count: ${subscribersCount.toNumber()}`);

        if (subscribersCount.toNumber() >= AllowedSubscribersCountInFreePlan) {
          logger.debug(
            "Reached maximum allowed subscriber limit for the free plan.",
          );
          throw new BadDataException(
            `You have reached the maximum allowed subscriber limit for the free plan. Please upgrade your plan to add more subscribers.`,
          );
        }
      }
    }

    let subscriber: Model | null = null;

    if (data.data.subscriberEmail) {
      logger.debug(`Subscriber Email: ${data.data.subscriberEmail}`);
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
      logger.debug(`Found Subscriber by Email: ${JSON.stringify(subscriber)}`);
    }

    if (data.data.subscriberPhone) {
      logger.debug(`Subscriber Phone: ${data.data.subscriberPhone}`);
      // check if this project has SMS enabled.
      const isSMSEnabled: boolean =
        await ProjectService.isSMSNotificationsEnabled(projectId);
      logger.debug(`Is SMS Enabled: ${isSMSEnabled}`);

      if (!isSMSEnabled) {
        logger.debug("SMS notifications are not enabled for this project.");
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

      logger.debug(`Found Subscriber by Phone: ${JSON.stringify(subscriber)}`);
    }

    if (subscriber && !subscriber.isUnsubscribed) {
      logger.debug("Subscriber is already subscribed and not unsubscribed.");
      throw new BadDataException(
        "You are already subscribed to this status page.",
      );
    }

    // if the user is unsubscribed, delete this record and it'll create a new one.
    if (subscriber) {
      logger.debug("Subscriber is unsubscribed. Deleting old record.");
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
    logger.debug(`Status Pages: ${JSON.stringify(statuspages)}`);

    const statuspage: StatusPage | undefined = statuspages.find(
      (statuspage: StatusPage) => {
        return (
          statuspage._id?.toString() === data.data.statusPageId?.toString()
        );
      },
    );

    if (!statuspage || !statuspage.projectId) {
      logger.debug("Status Page not found or Project ID is missing.");
      throw new BadDataException("Status Page not found");
    }

    data.data.projectId = statuspage.projectId;
    logger.debug(`Updated Project ID: ${data.data.projectId}`);

    const isEmailSubscriber: boolean = Boolean(data.data.subscriberEmail);
    const isSubscriptionConfirmed: boolean = Boolean(
      data.data.isSubscriptionConfirmed,
    );
    logger.debug(`Is Email Subscriber: ${isEmailSubscriber}`);
    logger.debug(`Is Subscription Confirmed: ${isSubscriptionConfirmed}`);

    if (isEmailSubscriber && !isSubscriptionConfirmed) {
      data.data.isSubscriptionConfirmed = false;
    } else {
      data.data.isSubscriptionConfirmed = true; // if the subscriber is not email, then set it to true for SMS subscribers / slack subscribers.
    }
    logger.debug(
      `Final Subscription Confirmed: ${data.data.isSubscriptionConfirmed}`,
    );

    // if slack incoming webhook is provided, then see if it starts with https://hooks.slack.com/services/

    if (data.data.slackIncomingWebhookUrl) {
      logger.debug(
        `Slack Incoming Webhook URL: ${data.data.slackIncomingWebhookUrl}`,
      );
      if (
        !SlackUtil.isValidSlackIncomingWebhookUrl(
          data.data.slackIncomingWebhookUrl,
        )
      ) {
        logger.debug("Invalid Slack Incoming Webhook URL.");
        throw new BadDataException("Invalid Slack Incoming Webhook URL.");
      }
    }

    // Validate Microsoft Teams webhook URL if provided
    if (data.data.microsoftTeamsIncomingWebhookUrl) {
      logger.debug(
        `Microsoft Teams Incoming Webhook URL: ${data.data.microsoftTeamsIncomingWebhookUrl}`,
      );
      if (
        !MicrosoftTeamsUtil.isValidMicrosoftTeamsIncomingWebhookUrl(
          data.data.microsoftTeamsIncomingWebhookUrl,
        )
      ) {
        logger.debug("Invalid Microsoft Teams Incoming Webhook URL.");
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
    );

    logger.debug("onBeforeCreate processed data:");
    logger.debug(data);

    return { createBy: data, carryForward: statuspage };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    logger.debug("onCreateSuccess called with createdItem:");
    logger.debug(createdItem);

    if (!createdItem.statusPageId) {
      logger.debug("Status Page ID is missing in createdItem.");
      return createdItem;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      createdItem.statusPageId,
    );
    logger.debug(`Status Page URL: ${statusPageURL}`);

    const statusPageName: string =
      onCreate.carryForward.pageTitle ||
      onCreate.carryForward.name ||
      "Status Page";
    logger.debug(`Status Page Name: ${statusPageName}`);

    const unsubscribeLink: string = this.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      createdItem.id!,
    ).toString();
    logger.debug(`Unsubscribe Link: ${unsubscribeLink}`);

    if (
      createdItem.statusPageId &&
      createdItem.subscriberPhone &&
      createdItem._id &&
      createdItem.sendYouHaveSubscribedMessage
    ) {
      logger.debug(
        "Subscriber has a phone number and sendYouHaveSubscribedMessage is true.",
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
        logger.debug("Status Page not found.");
        return createdItem;
      }

      logger.debug(
        `Status Page Call SMS Config: ${JSON.stringify(statusPage.callSmsConfig)}`,
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
        logger.error(err);
      });
    }

    if (
      createdItem.statusPageId &&
      createdItem.subscriberEmail &&
      createdItem._id
    ) {
      logger.debug("Subscriber has an email.");
      const isSubcriptionConfirmed: boolean = Boolean(
        createdItem.isSubscriptionConfirmed,
      );
      logger.debug(`Is Subscription Confirmed: ${isSubcriptionConfirmed}`);

      if (!isSubcriptionConfirmed) {
        logger.debug(
          "Subscription is not confirmed. Sending confirmation email.",
        );
        await this.sendConfirmSubscriptionEmail({
          subscriberId: createdItem.id!,
        });
      }

      if (isSubcriptionConfirmed && createdItem.sendYouHaveSubscribedMessage) {
        logger.debug(
          "Subscription is confirmed and sendYouHaveSubscribedMessage is true. Sending 'You have subscribed' email.",
        );
        await this.sendYouHaveSubscribedEmail({
          subscriberId: createdItem.id!,
        });
      }
    }

    // if slack incoming webhook is provided, then send a message to the slack channel.
    if (createdItem.slackIncomingWebhookUrl) {
      logger.debug("Sending Slack notification for new subscriber.");
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

      logger.debug(`Slack Message: ${slackMessage}`);

      SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(createdItem.slackIncomingWebhookUrl.toString()),
        text: SlackUtil.convertMarkdownToSlackRichText(slackMessage),
      })
        .then(() => {
          logger.debug("Slack notification sent successfully.");
        })
        .catch((err: Error) => {
          logger.error("Error sending Slack notification:");
          logger.error(err);
        });
    }

    // if Microsoft Teams incoming webhook is provided and sendYouHaveSubscribedMessage is true, then send a message to the Teams channel.
    if (
      createdItem.microsoftTeamsIncomingWebhookUrl &&
      createdItem.sendYouHaveSubscribedMessage
    ) {
      logger.debug("Sending Microsoft Teams notification for new subscriber.");
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

      logger.debug(`Teams Message: ${teamsMessage}`);

      MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(
          createdItem.microsoftTeamsIncomingWebhookUrl.toString(),
        ),
        text: teamsMessage,
      })
        .then(() => {
          logger.debug("Microsoft Teams notification sent successfully.");
        })
        .catch((err: Error) => {
          logger.error("Error sending Microsoft Teams notification:");
          logger.error(err);
        });
    }

    logger.debug("onCreateSuccess completed.");
    return createdItem;
  }

  @CaptureSpan()
  public async sendConfirmSubscriptionEmail(data: {
    subscriberId: ObjectID;
  }): Promise<void> {
    logger.debug("sendConfirmSubscriptionEmail called with data:");
    logger.debug(data);

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
    logger.debug(`Found Subscriber: ${JSON.stringify(subscriber)}`);

    // get status page
    if (!subscriber || !subscriber.statusPageId) {
      logger.debug("Subscriber or Status Page ID is missing.");
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
    logger.debug(`Found Status Page: ${JSON.stringify(statusPage)}`);

    if (!statusPage || !statusPage.id) {
      logger.debug("Status Page not found or ID is missing.");
      return;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id,
    );
    logger.debug(`Status Page URL: ${statusPageURL}`);

    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";
    logger.debug(`Status Page Name: ${statusPageName}`);

    const host: Hostname = await DatabaseConfig.getHost();
    logger.debug(`Host: ${host}`);

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(`HTTP Protocol: ${httpProtocol}`);

    const confirmSubscriptionLink: string = this.getConfirmSubscriptionLink({
      statusPageUrl: statusPageURL,
      confirmationToken: subscriber.subscriptionConfirmationToken || "",
      statusPageSubscriberId: subscriber.id!,
    }).toString();
    logger.debug(`Confirm Subscription Link: ${confirmSubscriptionLink}`);

    if (
      subscriber.statusPageId &&
      subscriber.subscriberEmail &&
      subscriber._id
    ) {
      const unsubscribeUrl: string = this.getUnsubscribeLink(
        URL.fromString(statusPageURL),
        subscriber.id!,
      ).toString();
      logger.debug(`Unsubscribe URL: ${unsubscribeUrl}`);

      MailService.sendMail(
        {
          toEmail: subscriber.subscriberEmail,
          templateType: EmailTemplateType.ConfirmStatusPageSubscription,
          vars: {
            statusPageName: statusPageName,
            logoUrl: statusPage.logoFileId
              ? new URL(httpProtocol, host)
                  .addRoute(FileRoute)
                  .addRoute("/image/" + statusPage.logoFileId)
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
        logger.error(err);
      });
      logger.debug("Confirmation email sent.");
    } else {
      logger.debug("Subscriber email or ID is missing.");
    }
  }

  @CaptureSpan()
  public async sendYouHaveSubscribedEmail(data: {
    subscriberId: ObjectID;
  }): Promise<void> {
    logger.debug("sendYouHaveSubscribedEmail called with data:");
    logger.debug(data);

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
    logger.debug(`Found Subscriber: ${JSON.stringify(subscriber)}`);

    // get status page
    if (!subscriber || !subscriber.statusPageId) {
      logger.debug("Subscriber or Status Page ID is missing.");
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
    logger.debug(`Found Status Page: ${JSON.stringify(statusPage)}`);

    if (!statusPage || !statusPage.id) {
      logger.debug("Status Page not found or ID is missing.");
      return;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id,
    );
    logger.debug(`Status Page URL: ${statusPageURL}`);

    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";
    logger.debug(`Status Page Name: ${statusPageName}`);

    const host: Hostname = await DatabaseConfig.getHost();
    logger.debug(`Host: ${host}`);

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(`HTTP Protocol: ${httpProtocol}`);

    const unsubscribeLink: string = this.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      subscriber.id!,
    ).toString();
    logger.debug(`Unsubscribe Link: ${unsubscribeLink}`);

    if (
      subscriber.statusPageId &&
      subscriber.subscriberEmail &&
      subscriber._id
    ) {
      logger.debug("Subscriber has an email and ID.");
      MailService.sendMail(
        {
          toEmail: subscriber.subscriberEmail,
          templateType: EmailTemplateType.SubscribedToStatusPage,
          vars: {
            statusPageName: statusPageName,
            logoUrl: statusPage.logoFileId
              ? new URL(httpProtocol, host)
                  .addRoute(FileRoute)
                  .addRoute("/image/" + statusPage.logoFileId)
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
        logger.error("Error sending subscription email:");
        logger.error(err);
      });
      logger.debug("Subscription email sent successfully.");
    } else {
      logger.debug("Subscriber email or ID is missing.");
    }
  }

  public getConfirmSubscriptionLink(data: {
    statusPageUrl: string;
    confirmationToken: string;
    statusPageSubscriberId: ObjectID;
  }): URL {
    logger.debug("getConfirmSubscriptionLink called with data:");
    logger.debug(data);

    const confirmSubscriptionLink: URL = URL.fromString(
      data.statusPageUrl,
    ).addRoute(
      `/confirm-subscription/${data.statusPageSubscriberId.toString()}?verification-token=${data.confirmationToken}`,
    );

    logger.debug(
      `Generated Confirm Subscription Link: ${confirmSubscriptionLink.toString()}`,
    );
    return confirmSubscriptionLink;
  }

  @CaptureSpan()
  public async getSubscribersByStatusPage(
    statusPageId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<Model>> {
    logger.debug("getSubscribersByStatusPage called with statusPageId:");
    logger.debug(statusPageId);
    logger.debug("DatabaseCommonInteractionProps:");
    logger.debug(props);

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

    logger.debug("Found subscribers:");
    logger.debug(subscribers);

    return subscribers;
  }

  public getUnsubscribeLink(
    statusPageUrl: URL,
    statusPageSubscriberId: ObjectID,
  ): URL {
    logger.debug("getUnsubscribeLink called with statusPageUrl:");
    logger.debug(statusPageUrl);
    logger.debug("statusPageSubscriberId:");
    logger.debug(statusPageSubscriberId);

    const unsubscribeLink: URL = URL.fromString(
      statusPageUrl.toString(),
    ).addRoute("/update-subscription/" + statusPageSubscriberId.toString());

    logger.debug("Generated Unsubscribe Link:");
    logger.debug(unsubscribeLink);

    return unsubscribeLink;
  }

  public shouldSendNotification(data: {
    subscriber: Model;
    statusPageResources: Array<StatusPageResource>;
    statusPage: StatusPage;
    eventType: StatusPageEventType;
  }): boolean {
    logger.debug("shouldSendNotification called with data:");
    logger.debug(data);

    let shouldSendNotification: boolean = true; // default to true.

    if (data.subscriber.isUnsubscribed) {
      logger.debug("Subscriber is unsubscribed.");
      shouldSendNotification = false;
      return shouldSendNotification;
    }

    if (
      data.statusPage.allowSubscribersToChooseResources &&
      !data.subscriber.isSubscribedToAllResources &&
      data.eventType !== StatusPageEventType.Announcement // announcements dont have resources
    ) {
      logger.debug(
        "Subscriber can choose resources and is not subscribed to all resources.",
      );
      const subscriberResourceIds: Array<string> =
        data.subscriber.statusPageResources?.map(
          (resource: StatusPageResource) => {
            return resource.id?.toString() as string;
          },
        ) || [];

      logger.debug(`Subscriber Resource IDs: ${subscriberResourceIds}`);

      let shouldSendNotificationForResource: boolean = false;

      if (subscriberResourceIds.length === 0) {
        logger.debug("Subscriber has no resource IDs.");
        shouldSendNotificationForResource = false;
      } else {
        for (const resource of data.statusPageResources) {
          logger.debug(`Checking resource: ${resource.id}`);
          if (
            subscriberResourceIds.includes(resource.id?.toString() as string)
          ) {
            logger.debug("Resource ID matches subscriber's resource ID.");
            shouldSendNotificationForResource = true;
          }
        }
      }

      if (!shouldSendNotificationForResource) {
        logger.debug("Should not send notification for resource.");
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
      );
      const subscriberEventTypes: Array<StatusPageEventType> =
        data.subscriber.statusPageEventTypes || [];

      logger.debug(`Subscriber Event Types: ${subscriberEventTypes}`);

      let shouldSendNotificationForEventType: boolean = false;

      if (subscriberEventTypes.includes(data.eventType)) {
        logger.debug("Event type matches subscriber's event type.");
        shouldSendNotificationForEventType = true;
      }

      if (!shouldSendNotificationForEventType) {
        logger.debug("Should not send notification for event type.");
        shouldSendNotification = false;
      }
    }

    logger.debug(
      `Final decision on shouldSendNotification: ${shouldSendNotification}`,
    );
    return shouldSendNotification;
  }

  @CaptureSpan()
  public async getStatusPagesToSendNotification(
    statusPageIds: Array<ObjectID>,
  ): Promise<Array<StatusPage>> {
    logger.debug("getStatusPagesToSendNotification called with statusPageIds:");
    logger.debug(statusPageIds);

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

    logger.debug("Found status pages:");
    logger.debug(statusPages);

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
      logger.error("Error sending test Slack notification:");
      logger.error(error);
      throw error;
    }
  }
}

export default new Service();
