import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import DatabaseConfig from "../DatabaseConfig";
import {
  AllowedSubscribersCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import ProjectSMTPConfigService from "../Services/ProjectSmtpConfigService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import MailService from "./MailService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import SmsService from "./SmsService";
import StatusPageService from "./StatusPageService";
import { FileRoute } from "Common/ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import Model from "Common/Models/DatabaseModels/StatusPageSubscriber";
import PositiveNumber from "../../Types/PositiveNumber";
import StatusPageEventType from "../../Types/StatusPage/StatusPageEventType";
import NumberUtil from "../../Utils/Number";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    data: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!data.data.statusPageId) {
      throw new BadDataException("Status Page ID is required.");
    }

    if (!data.data.projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const projectId: ObjectID = data.data.projectId;

    // if the project is on the free plan, then only allow 1 status page.
    if (IsBillingEnabled) {
      const currentPlan: CurrentPlan =
        await ProjectService.getCurrentPlan(projectId);

      if (currentPlan.isSubscriptionUnpaid) {
        throw new BadDataException(
          "Your subscription is unpaid. Please update your payment method and to add subscribers.",
        );
      }

      if (currentPlan.plan === PlanType.Free) {
        const subscribersCount: PositiveNumber = await this.countBy({
          query: {
            projectId: projectId,
          },
          props: {
            isRoot: true,
          },
        });

        if (subscribersCount.toNumber() >= AllowedSubscribersCountInFreePlan) {
          throw new BadDataException(
            `You have reached the maximum allowed subscriber limit for the free plan. Please upgrade your plan to add more subscribers.`,
          );
        }
      }
    }

    let subscriber: Model | null = null;

    if (data.data.subscriberEmail) {
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
    }

    if (data.data.subscriberPhone) {
      // check if this project has SMS enabled.

      const isSMSEnabled: boolean =
        await ProjectService.isSMSNotificationsEnabled(projectId);

      if (!isSMSEnabled) {
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
    }

    if (subscriber && !subscriber.isUnsubscribed) {
      throw new BadDataException(
        "You are already subscribed to this status page.",
      );
    }

    // if the user is unsubscribed, delete this record and it'll create a new one.
    if (subscriber) {
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

    const statuspage: StatusPage | undefined = statuspages.find(
      (statuspage: StatusPage) => {
        return (
          statuspage._id?.toString() === data.data.statusPageId?.toString()
        );
      },
    );

    if (!statuspage || !statuspage.projectId) {
      throw new BadDataException("Status Page not found");
    }

    data.data.projectId = statuspage.projectId;

    const isEmailSubscriber: boolean = Boolean(data.data.subscriberEmail);
    const isSubscriptionConfirmed: boolean = Boolean(
      data.data.isSubscriptionConfirmed,
    );

    if (isEmailSubscriber && !isSubscriptionConfirmed) {
      data.data.isSubscriptionConfirmed = false;
    } else {
      data.data.isSubscriptionConfirmed = true; // if the subscriber is not email, then set it to true for SMS subscribers.
    }

    data.data.subscriptionConfirmationToken = NumberUtil.getRandomNumber(
      100000,
      999999,
    ).toString();

    return { createBy: data, carryForward: statuspage };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.statusPageId) {
      return createdItem;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      createdItem.statusPageId,
    );

    const statusPageName: string =
      onCreate.carryForward.pageTitle ||
      onCreate.carryForward.name ||
      "Status Page";

    const unsubscribeLink: string = this.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      createdItem.id!,
    ).toString();

    if (
      createdItem.statusPageId &&
      createdItem.subscriberPhone &&
      createdItem._id &&
      createdItem.sendYouHaveSubscribedMessage
    ) {
      const statusPage: StatusPage | null = await StatusPageService.findOneBy({
        query: {
          _id: createdItem.statusPageId.toString(),
        },
        select: {
          callSmsConfig: {
            _id: true,
            twilioAccountSID: true,
            twilioAuthToken: true,
            twilioPhoneNumber: true,
          },
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (!statusPage) {
        return createdItem;
      }

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
      // Call mail service and send an email.

      // get status page domain for this status page.
      // if the domain is not found, use the internal status page preview link.

      const isSubcriptionConfirmed: boolean = Boolean(
        createdItem.isSubscriptionConfirmed,
      );

      if (!isSubcriptionConfirmed) {
        await this.sendConfirmSubscriptionEmail({
          subscriberId: createdItem.id!,
        });
      }

      if (isSubcriptionConfirmed && createdItem.sendYouHaveSubscribedMessage) {
        await this.sendYouHaveSubscribedEmail({
          subscriberId: createdItem.id!,
        });
      }
    }

    return createdItem;
  }

  public async sendConfirmSubscriptionEmail(data: {
    subscriberId: ObjectID;
  }): Promise<void> {
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

    // get status page
    if (!subscriber || !subscriber.statusPageId) {
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

    if (!statusPage || !statusPage.id) {
      return;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id,
    );

    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";

    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const confirmSubscriptionLink: string = this.getConfirmSubscriptionLink({
      statusPageUrl: statusPageURL,
      confirmationToken: subscriber.subscriptionConfirmationToken || "",
      statusPageSubscriberId: subscriber.id!,
    }).toString();

    if (
      subscriber.statusPageId &&
      subscriber.subscriberEmail &&
      subscriber._id
    ) {
      const unsubscribeUrl: string = this.getUnsubscribeLink(
        URL.fromString(statusPageURL),
        subscriber.id!,
      ).toString();

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
        },
      ).catch((err: Error) => {
        logger.error(err);
      });
    }
  }

  public async sendYouHaveSubscribedEmail(data: {
    subscriberId: ObjectID;
  }): Promise<void> {
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

    // get status page
    if (!subscriber || !subscriber.statusPageId) {
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

    if (!statusPage || !statusPage.id) {
      return;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id,
    );

    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";

    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const unsubscribeLink: string = this.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      subscriber.id!,
    ).toString();

    if (
      subscriber.statusPageId &&
      subscriber.subscriberEmail &&
      subscriber._id
    ) {
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
        },
      ).catch((err: Error) => {
        logger.error(err);
      });
    }
  }

  public getConfirmSubscriptionLink(data: {
    statusPageUrl: string;
    confirmationToken: string;
    statusPageSubscriberId: ObjectID;
  }): URL {
    return URL.fromString(data.statusPageUrl).addRoute(
      `/confirm-subscription/${data.statusPageSubscriberId.toString()}?verification-token=${data.confirmationToken}`,
    );
  }

  public async getSubscribersByStatusPage(
    statusPageId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<Model>> {
    return await this.findBy({
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
        isSubscribedToAllResources: true,
        statusPageResources: true,
        isSubscribedToAllEventTypes: true,
        statusPageEventTypes: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: props,
    });
  }

  public getUnsubscribeLink(
    statusPageUrl: URL,
    statusPageSubscriberId: ObjectID,
  ): URL {
    return URL.fromString(statusPageUrl.toString()).addRoute(
      "/update-subscription/" + statusPageSubscriberId.toString(),
    );
  }

  public shouldSendNotification(data: {
    subscriber: Model;
    statusPageResources: Array<StatusPageResource>;
    statusPage: StatusPage;
    eventType: StatusPageEventType;
  }): boolean {
    let shouldSendNotification: boolean = true; // default to true.

    if (data.subscriber.isUnsubscribed) {
      shouldSendNotification = false;
      return shouldSendNotification;
    }

    if (
      data.statusPage.allowSubscribersToChooseResources &&
      !data.subscriber.isSubscribedToAllResources &&
      data.eventType !== StatusPageEventType.Announcement // announcements dont have resources
    ) {
      const subscriberResourceIds: Array<string> =
        data.subscriber.statusPageResources?.map(
          (resource: StatusPageResource) => {
            return resource.id?.toString() as string;
          },
        ) || [];

      let shouldSendNotificationForResource: boolean = false;

      if (subscriberResourceIds.length === 0) {
        shouldSendNotificationForResource = false;
      } else {
        for (const resource of data.statusPageResources) {
          if (
            subscriberResourceIds.includes(resource.id?.toString() as string)
          ) {
            shouldSendNotificationForResource = true;
          }
        }
      }

      if (!shouldSendNotificationForResource) {
        shouldSendNotification = false;
      }
    }

    // now do for event types

    if (
      data.statusPage.allowSubscribersToChooseEventTypes &&
      !data.subscriber.isSubscribedToAllEventTypes
    ) {
      const subscriberEventTypes: Array<StatusPageEventType> =
        data.subscriber.statusPageEventTypes || [];

      let shouldSendNotificationForEventType: boolean = false;

      if (subscriberEventTypes.includes(data.eventType)) {
        shouldSendNotificationForEventType = true;
      }

      if (!shouldSendNotificationForEventType) {
        shouldSendNotification = false;
      }
    }

    return shouldSendNotification;
  }

  public async getStatusPagesToSendNotification(
    statusPageIds: Array<ObjectID>,
  ): Promise<Array<StatusPage>> {
    return await StatusPageService.findBy({
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
          twilioPhoneNumber: true,
        },
        subscriberTimezones: true,
        reportDataInDays: true,
        isReportEnabled: true,
      },
    });
  }
}
export default new Service();
