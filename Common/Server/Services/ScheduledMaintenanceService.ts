import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import ScheduledMaintenanceOwnerTeamService from "./ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "./ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "./ScheduledMaintenanceStateTimelineService";
import TeamMemberService from "./TeamMemberService";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Typeof from "../../Types/Typeof";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Model from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerTeam from "../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import User from "../../Models/DatabaseModels/User";
import Recurring from "../../Types/Events/Recurring";
import OneUptimeDate from "../../Types/Date";
import UpdateBy from "../Types/Database/UpdateBy";
import { StatusPageApiRoute } from "../../ServiceRoute";
import Dictionary from "../../Types/Dictionary";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import SMS from "../../Types/SMS/SMS";
import MailService from "../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "../../Server/Services/ProjectSmtpConfigService";
import SmsService from "../../Server/Services/SmsService";
import StatusPageResourceService from "../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../Server/Services/StatusPageSubscriberService";
import QueryHelper from "../../Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "../../Server/Types/Markdown";
import logger from "../../Server/Utils/Logger";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../Models/DatabaseModels/StatusPageSubscriber";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import { IsBillingEnabled } from "../EnvironmentConfig";
import StatusPageEventType from "../../Types/StatusPage/StatusPageEventType";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import { Gray500, Red500 } from "../../Types/BrandColors";
import Label from "../../Models/DatabaseModels/Label";
import LabelService from "./LabelService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { MessageBlocksByWorkspaceType } from "./WorkspaceNotificationRuleService";
import ScheduledMaintenanceWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/ScheduledMaintenance";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "./StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../Types/StatusPage/StatusPageSubscriberNotificationMethod";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public async getExistingScheduledMaintenanceNumberForProject(data: {
    projectId: ObjectID;
  }): Promise<number> {
    // get last scheduledMaintenance number.
    const lastScheduledMaintenance: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        scheduledMaintenanceNumber: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    if (!lastScheduledMaintenance) {
      return 0;
    }

    return lastScheduledMaintenance.scheduledMaintenanceNumber
      ? Number(lastScheduledMaintenance.scheduledMaintenanceNumber)
      : 0;
  }

  @CaptureSpan()
  public async notififySubscribersOnEventScheduled(
    scheduledEvents: Array<Model>,
  ): Promise<void> {
    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Running",
    );

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const event of scheduledEvents) {
      // get status page resources from monitors.

      logger.debug(
        "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Sending notification for event: " +
          event.id,
      );

      let statusPageResources: Array<StatusPageResource> = [];

      if (event.monitors && event.monitors.length > 0) {
        statusPageResources = await StatusPageResourceService.findBy({
          query: {
            monitorId: QueryHelper.any(
              event.monitors
                .filter((m: Monitor) => {
                  return m._id;
                })
                .map((m: Monitor) => {
                  return new ObjectID(m._id!);
                }),
            ),
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          select: {
            _id: true,
            displayName: true,
            statusPageId: true,
          },
        });
      }

      const statusPageToResources: Dictionary<Array<StatusPageResource>> = {};

      for (const resource of statusPageResources) {
        if (!resource.statusPageId) {
          continue;
        }

        if (!statusPageToResources[resource.statusPageId?.toString()]) {
          statusPageToResources[resource.statusPageId?.toString()] = [];
        }

        statusPageToResources[resource.statusPageId?.toString()]?.push(
          resource,
        );
      }

      const statusPages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification(
          event.statusPages?.map((i: StatusPage) => {
            return i.id!;
          }) || [],
        );

      for (const statuspage of statusPages) {
        if (!statuspage.id) {
          continue;
        }

        if (!statuspage.showScheduledMaintenanceEventsOnStatusPage) {
          continue; // Do not send notification to subscribers if scheduledMaintenances are not visible on status page.
        }

        const subscribers: Array<StatusPageSubscriber> =
          await StatusPageSubscriberService.getSubscribersByStatusPage(
            statuspage.id!,
            {
              isRoot: true,
              ignoreHooks: true,
            },
          );

        const statusPageURL: string = await StatusPageService.getStatusPageURL(
          statuspage.id,
        );

        const statusPageName: string =
          statuspage.pageTitle || statuspage.name || "Status Page";

        const scheduledEventDetailsUrl: string =
          event.id && statusPageURL
            ? URL.fromString(statusPageURL)
                .addRoute(`/scheduled-events/${event.id.toString()}`)
                .toString()
            : statusPageURL;

        // Send email to Email subscribers.

        const resourcesAffected: string =
          statusPageToResources[statuspage._id!]
            ?.map((r: StatusPageResource) => {
              return r.displayName;
            })
            .join(", ") || "";

        // Fetch custom templates for each notification method
        const [
          emailTemplate,
          smsTemplate,
          slackTemplate,
        ]: Array<StatusPageSubscriberNotificationTemplate | null> =
          await Promise.all([
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.Email,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.SMS,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.Slack,
              },
            ),
          ]);

        for (const subscriber of subscribers) {
          if (!subscriber._id) {
            continue;
          }

          const shouldNotifySubscriber: boolean =
            StatusPageSubscriberService.shouldSendNotification({
              subscriber: subscriber,
              statusPageResources: statusPageToResources[statuspage._id!] || [],
              statusPage: statuspage,
              eventType: StatusPageEventType.ScheduledEvent,
            });

          if (!shouldNotifySubscriber) {
            continue;
          }

          const unsubscribeUrl: string =
            StatusPageSubscriberService.getUnsubscribeLink(
              URL.fromString(statusPageURL),
              subscriber.id!,
            ).toString();

          // Create template variables for custom templates
          const templateVariables: Record<string, string> = {
            statusPageName: statusPageName,
            statusPageUrl: statusPageURL,
            detailsUrl: scheduledEventDetailsUrl,
            scheduledMaintenanceTitle: event.title || "",
            scheduledMaintenanceDescription: event.description || "",
            scheduledStartTime:
              OneUptimeDate.getDateAsUserFriendlyFormattedString(
                event.startsAt!,
              ),
            scheduledEndTime: event.endsAt
              ? OneUptimeDate.getDateAsUserFriendlyFormattedString(event.endsAt)
              : "",
            resourcesAffected: resourcesAffected,
            unsubscribeUrl: unsubscribeUrl,
          };

          if (subscriber.subscriberPhone) {
            let smsMessage: string;

            if (smsTemplate && smsTemplate.templateBody) {
              // Use custom template
              smsMessage =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  smsTemplate.templateBody,
                  templateVariables,
                );
            } else {
              // Use default template
              smsMessage = `
                            Scheduled Maintenance - ${statusPageName}

                            ${event.title || ""}

                            ${
                              resourcesAffected
                                ? "Resources Affected: " + resourcesAffected
                                : ""
                            }

                            To view this event, visit ${statusPageURL}

                            To update notification preferences or unsubscribe, visit ${unsubscribeUrl}
                            `;
            }

            const sms: SMS = {
              message: smsMessage,
              to: subscriber.subscriberPhone,
            };

            // send sms here.
            SmsService.sendSms(sms, {
              projectId: statuspage.projectId,
              customTwilioConfig: ProjectCallSMSConfigService.toTwilioConfig(
                statuspage.callSmsConfig,
              ),
              statusPageId: statuspage.id!,
              scheduledMaintenanceId: event.id!,
            }).catch((err: Error) => {
              logger.error(err);
            });
          }

          if (subscriber.slackIncomingWebhookUrl) {
            let slackMessage: string;

            if (slackTemplate && slackTemplate.templateBody) {
              // Use custom template
              slackMessage =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  slackTemplate.templateBody,
                  templateVariables,
                );
            } else {
              // Use default template
              slackMessage = `## 🔧 Scheduled Maintenance - ${event.title || ""}

**Scheduled Date:** ${OneUptimeDate.getDateAsUserFriendlyFormattedString(event.startsAt!)}

${resourcesAffected ? `**Resources Affected:** ${resourcesAffected}` : ""}

**Description:** ${event.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
            }

            // send Slack notification here.
            SlackUtil.sendMessageToChannelViaIncomingWebhook({
              url: subscriber.slackIncomingWebhookUrl,
              text: SlackUtil.convertMarkdownToSlackRichText(slackMessage),
            }).catch((err: Error) => {
              logger.error(err);
            });
          }

          if (subscriber.subscriberEmail) {
            // send email here.
            const statusPageIdString: string | null =
              statuspage.id?.toString() || statuspage._id?.toString() || null;

            // Prepare email variables
            const emailVars: Record<string, string> = {
              statusPageName: statusPageName,
              statusPageUrl: statusPageURL,
              detailsUrl: scheduledEventDetailsUrl,
              logoUrl:
                statuspage.logoFileId && statusPageIdString
                  ? new URL(httpProtocol, host)
                      .addRoute(StatusPageApiRoute)
                      .addRoute(`/logo/${statusPageIdString}`)
                      .toString()
                  : "",
              isPublicStatusPage: statuspage.isPublicStatusPage
                ? "true"
                : "false",
              subscriberEmailNotificationFooterText:
                statuspage.subscriberEmailNotificationFooterText || "",
              resourcesAffected: resourcesAffected,
              scheduledAt:
                OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                  date: event.startsAt!,
                  timezones: statuspage.subscriberTimezones || [],
                  use12HourFormat: true,
                }),
              eventTitle: event.title || "",
              eventDescription: await Markdown.convertToHTML(
                event.description || "",
                MarkdownContentType.Email,
              ),
              unsubscribeUrl: unsubscribeUrl,
            };

            // Check for custom email template
            if (emailTemplate && emailTemplate.templateBody) {
              // Use custom template with BlankTemplate
              const customEmailBody: string =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  emailTemplate.templateBody,
                  { ...templateVariables, ...emailVars },
                );
              const customEmailSubject: string = emailTemplate.emailSubject
                ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    emailTemplate.emailSubject,
                    { ...templateVariables, ...emailVars },
                  )
                : "[Scheduled Maintenance] " + (event.title || statusPageName);

              MailService.sendMail(
                {
                  toEmail: subscriber.subscriberEmail,
                  templateType: EmailTemplateType.BlankTemplate,
                  vars: {
                    body: customEmailBody,
                    logoUrl: emailVars["logoUrl"] || "",
                    isPublicStatusPage: emailVars["isPublicStatusPage"] || "",
                    subscriberEmailNotificationFooterText:
                      emailVars["subscriberEmailNotificationFooterText"] || "",
                  },
                  subject: customEmailSubject,
                },
                {
                  mailServer: ProjectSmtpConfigService.toEmailServer(
                    statuspage.smtpConfig,
                  ),
                  projectId: statuspage.projectId!,
                  statusPageId: statuspage.id!,
                  scheduledMaintenanceId: event.id!,
                },
              ).catch((err: Error) => {
                logger.error(err);
              });
            } else {
              // Use default hard-coded template
              MailService.sendMail(
                {
                  toEmail: subscriber.subscriberEmail,
                  templateType:
                    EmailTemplateType.SubscriberScheduledMaintenanceEventCreated,
                  vars: emailVars,
                  subject:
                    "[Scheduled Maintenance] " + (event.title || statusPageName),
                },
                {
                  mailServer: ProjectSmtpConfigService.toEmailServer(
                    statuspage.smtpConfig,
                  ),
                  projectId: statuspage.projectId!,
                  statusPageId: statuspage.id!,
                  scheduledMaintenanceId: event.id!,
                },
              ).catch((err: Error) => {
                logger.error(err);
              });
            }
          }
        }
      }
    }

    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Completed",
    );
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (
      updateBy.query._id &&
      (updateBy.data.sendSubscriberNotificationsOnBeforeTheEvent ||
        updateBy.data.startsAt)
    ) {
      logger.debug(
        `Calculating nextSubscriberNotificationBeforeTheEventAt for Scheduled Maintenance: ${updateBy.query.id}`,
      );

      const scheduledMaintenance: Model | null = await this.findOneById({
        id: updateBy.query._id! as ObjectID,
        select: {
          startsAt: true,
          sendSubscriberNotificationsOnBeforeTheEvent: true,
        },
        props: {
          isRoot: true,
        },
      });

      logger.debug(
        `Current Scheduled Maintenance data: ${JSON.stringify(scheduledMaintenance)}`,
      );

      if (!scheduledMaintenance) {
        throw new BadDataException("Scheduled Maintenance Event not found");
      }

      const startsAt: Date =
        (updateBy.data.startsAt as Date) ||
        (scheduledMaintenance.startsAt! as Date);

      let notificationSettings: Array<Recurring> | null = null;

      const updatedNotificationSettings: Array<Recurring> | null | undefined =
        updateBy.data.sendSubscriberNotificationsOnBeforeTheEvent as
          | Array<Recurring>
          | null
          | undefined;

      if (
        updatedNotificationSettings !== null &&
        updatedNotificationSettings !== undefined
      ) {
        notificationSettings = updatedNotificationSettings;
      } else {
        const existingNotificationSettings:
          | Array<Recurring>
          | null
          | undefined =
          scheduledMaintenance.sendSubscriberNotificationsOnBeforeTheEvent as
            | Array<Recurring>
            | null
            | undefined;

        if (
          existingNotificationSettings !== null &&
          existingNotificationSettings !== undefined
        ) {
          notificationSettings = existingNotificationSettings;
        }
      }

      logger.debug(
        `Using startsAt: ${startsAt} and notificationSettings: ${JSON.stringify(notificationSettings)}`,
      );

      if (!notificationSettings || notificationSettings.length === 0) {
        logger.debug(
          "No subscriber notification schedule configured. Clearing nextSubscriberNotificationBeforeTheEventAt.",
        );
        updateBy.data.nextSubscriberNotificationBeforeTheEventAt = null;
      } else {
        const nextTimeToNotifyBeforeTheEvent: Date | null =
          this.getNextTimeToNotify({
            eventScheduledDate: startsAt,
            sendSubscriberNotifiationsOn: notificationSettings,
          });

        updateBy.data.nextSubscriberNotificationBeforeTheEventAt =
          nextTimeToNotifyBeforeTheEvent;

        logger.debug(
          `nextSubscriberNotificationBeforeTheEventAt set to: ${nextTimeToNotifyBeforeTheEvent}`,
        );
      }
    }

    // Set notification status based on shouldStatusPageSubscribersBeNotifiedOnEventCreated if it's being updated
    if (
      updateBy.data.shouldStatusPageSubscribersBeNotifiedOnEventCreated !==
      undefined
    ) {
      if (
        updateBy.data.shouldStatusPageSubscribersBeNotifiedOnEventCreated ===
        false
      ) {
        updateBy.data.subscriberNotificationStatusOnEventScheduled =
          StatusPageSubscriberNotificationStatus.Skipped;
        updateBy.data.subscriberNotificationStatusMessage =
          "Notifications skipped as subscribers are not to be notified for this scheduled maintenance.";
      } else if (
        updateBy.data.shouldStatusPageSubscribersBeNotifiedOnEventCreated ===
        true
      ) {
        updateBy.data.subscriberNotificationStatusOnEventScheduled =
          StatusPageSubscriberNotificationStatus.Pending;
      }
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const scheduledMaintenanceEvents: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        projectId: true,
        monitors: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    return {
      carryForward: {
        scheduledMaintenanceEvents: scheduledMaintenanceEvents,
      },
      deleteBy: deleteBy,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _deletedItemIds: ObjectID[],
  ): Promise<OnDelete<Model>> {
    if (onDelete.carryForward?.scheduledMaintenanceEvents) {
      for (const scheduledMaintenanceEvent of onDelete?.carryForward
        ?.scheduledMaintenanceEvents || []) {
        await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
          scheduledMaintenanceEvent,
        );
      }
    }

    return onDelete;
  }

  public getNextTimeToNotify(data: {
    eventScheduledDate: Date;
    sendSubscriberNotifiationsOn?: Array<Recurring> | null | undefined;
  }): Date | null {
    let recurringDate: Date | null = null;

    logger.debug(`getNextTimeToNotify: `);
    logger.debug(data);

    logger.debug(
      `Calculating next time to notify for event scheduled date: ${data.eventScheduledDate}`,
    );

    const notificationSchedules: Array<Recurring> = Array.isArray(
      data.sendSubscriberNotifiationsOn,
    )
      ? (data.sendSubscriberNotifiationsOn as Array<Recurring>)
      : [];

    if (notificationSchedules.length === 0) {
      logger.debug(
        "No sendSubscriberNotifiationsOn entries. Returning null for next notification time.",
      );
      return null;
    }

    for (const recurringItem of notificationSchedules) {
      if (!recurringItem) {
        continue;
      }
      const notificationDate: Date = Recurring.getNextDateInterval(
        data.eventScheduledDate,
        recurringItem,
        true,
      );

      logger.debug(
        `Notification date calculated: ${notificationDate} for recurring item: ${recurringItem}`,
      );

      // if this date is in the future. set it to recurring date.
      if (!recurringDate && OneUptimeDate.isInTheFuture(notificationDate)) {
        recurringDate = notificationDate;
        logger.debug(
          `Notification date is in the future. Setting recurring date to: ${recurringDate}`,
        );
      } else {
        logger.debug(`Notification date is in the past. Skipping.`);
      }

      // if this new date is less than the recurring date then set it to recurring date. We need to get the least date.
      if (recurringDate) {
        if (
          OneUptimeDate.isBefore(notificationDate, recurringDate) &&
          OneUptimeDate.isInTheFuture(notificationDate)
        ) {
          recurringDate = notificationDate;
          logger.debug(
            `Found an earlier notification date. Updating recurring date to: ${recurringDate}`,
          );
        } else {
          logger.debug(
            `Notification date is not earlier than recurring date. Skipping.`,
          );
        }
      }
    }

    logger.debug(`Final recurring date: ${recurringDate}`);
    return recurringDate;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.tenantId && !createBy.data.projectId) {
      throw new BadDataException(
        "ProjectId required to create scheduled maintenance.",
      );
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          projectId: projectId,
          isScheduledState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
      throw new BadDataException(
        "Scheduled state not found for this project. Please add an scheduled event state from settings.",
      );
    }

    createBy.data.currentScheduledMaintenanceStateId =
      scheduledMaintenanceState.id;

    const scheduledMaintenanceNumberForThisScheduledMaintenance: number =
      (await this.getExistingScheduledMaintenanceNumberForProject({
        projectId: projectId,
      })) + 1;

    createBy.data.scheduledMaintenanceNumber =
      scheduledMaintenanceNumberForThisScheduledMaintenance;

    // get next notification date.

    if (
      createBy.data.sendSubscriberNotificationsOnBeforeTheEvent &&
      createBy.data.startsAt
    ) {
      const nextNotificationDate: Date | null = this.getNextTimeToNotify({
        eventScheduledDate: createBy.data.startsAt,
        sendSubscriberNotifiationsOn:
          createBy.data.sendSubscriberNotificationsOnBeforeTheEvent,
      });

      if (nextNotificationDate) {
        // set this.
        createBy.data.nextSubscriberNotificationBeforeTheEventAt =
          nextNotificationDate;
      }
    }

    // Set notification status based on shouldStatusPageSubscribersBeNotifiedOnEventCreated
    if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnEventCreated ===
      false
    ) {
      createBy.data.subscriberNotificationStatusOnEventScheduled =
        StatusPageSubscriberNotificationStatus.Skipped;
      createBy.data.subscriberNotificationStatusMessage =
        "Notifications skipped as subscribers are not to be notified for this scheduled maintenance.";
    } else if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnEventCreated === true
    ) {
      createBy.data.subscriberNotificationStatusOnEventScheduled =
        StatusPageSubscriberNotificationStatus.Pending;
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // Get scheduled maintenance data for feed creation
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: createdItem.id!,
      select: {
        projectId: true,
        scheduledMaintenanceNumber: true,
        title: true,
        description: true,
        currentScheduledMaintenanceState: {
          name: true,
        },
        startsAt: true,
        endsAt: true,
        monitors: {
          name: true,
          _id: true,
        },
        labels: {
          name: true,
        },
        createdByUserId: true,
        createdByUser: {
          _id: true,
          name: true,
          email: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("Scheduled Maintenance not found");
    }

    // Execute operations sequentially with error handling
    Promise.resolve()
      .then(async () => {
        try {
          if (createdItem.projectId && createdItem.id) {
            return await this.handleScheduledMaintenanceWorkspaceOperationsAsync(
              createdItem,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Workspace operations failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.createScheduledMaintenanceFeedAsync(
            scheduledMaintenance,
          );
        } catch (error) {
          logger.error(
            `Create scheduled maintenance feed failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.createScheduledMaintenanceStateTimelineAsync(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Create scheduled maintenance state timeline failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          if (
            createdItem.projectId &&
            createdItem.id &&
            onCreate.createBy.miscDataProps &&
            (onCreate.createBy.miscDataProps["ownerTeams"] ||
              onCreate.createBy.miscDataProps["ownerUsers"])
          ) {
            return await this.addOwners(
              createdItem.projectId!,
              createdItem.id!,
              (onCreate.createBy.miscDataProps[
                "ownerUsers"
              ] as Array<ObjectID>) || [],
              (onCreate.createBy.miscDataProps[
                "ownerTeams"
              ] as Array<ObjectID>) || [],
              false,
              onCreate.createBy.props,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Add owners failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in ScheduledMaintenanceService sequential operations: ${error}`,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  private async handleScheduledMaintenanceWorkspaceOperationsAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      if (!createdItem.projectId || !createdItem.id) {
        throw new BadDataException(
          "projectId and id are required for workspace operations",
        );
      }

      // send message to workspaces - slack, teams, etc.
      const workspaceResult: {
        channelsCreated: Array<NotificationRuleWorkspaceChannel>;
      } | null =
        await ScheduledMaintenanceWorkspaceMessages.createChannelsAndInviteUsersToChannels(
          {
            projectId: createdItem.projectId,
            scheduledMaintenanceId: createdItem.id,
            scheduledMaintenanceNumber: createdItem.scheduledMaintenanceNumber!,
          },
        );

      if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
        // update scheduledMaintenance with these channels.
        await this.updateOneById({
          id: createdItem.id,
          data: {
            postUpdatesToWorkspaceChannels:
              workspaceResult.channelsCreated || [],
          },
          props: {
            isRoot: true,
          },
        });
      }
    } catch (error) {
      logger.error(
        `Error in handleScheduledMaintenanceWorkspaceOperationsAsync: ${error}`,
      );
      throw error;
    }
  }

  @CaptureSpan()
  private async createScheduledMaintenanceFeedAsync(
    scheduledMaintenance: Model,
  ): Promise<void> {
    try {
      const createdByUserId: ObjectID | undefined | null =
        scheduledMaintenance.createdByUserId ||
        scheduledMaintenance.createdByUser?.id;

      let feedInfoInMarkdown: string = `#### 🕒 Scheduled Maintenance ${scheduledMaintenance.scheduledMaintenanceNumber?.toString()} Created: 
            
**${scheduledMaintenance.title || "No title provided."}**:
      
${scheduledMaintenance.description || "No description provided."}
      
`;

      // add starts at and ends at.
      if (scheduledMaintenance.startsAt) {
        feedInfoInMarkdown += `**Starts At**: ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(scheduledMaintenance.startsAt)} \n\n`;
      }

      if (scheduledMaintenance.endsAt) {
        feedInfoInMarkdown += `**Ends At**: ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(scheduledMaintenance.endsAt)} \n\n`;
      }

      if (scheduledMaintenance.currentScheduledMaintenanceState?.name) {
        feedInfoInMarkdown += `⏳ **Scheduled Maintenance State**: ${scheduledMaintenance.currentScheduledMaintenanceState.name} \n\n`;
      }

      if (
        scheduledMaintenance.monitors &&
        scheduledMaintenance.monitors.length > 0
      ) {
        feedInfoInMarkdown += `🌎 **Resources Affected**:\n`;

        for (const monitor of scheduledMaintenance.monitors) {
          feedInfoInMarkdown += `- [${monitor.name}](${(await MonitorService.getMonitorLinkInDashboard(scheduledMaintenance.projectId!, monitor.id!)).toString()})\n`;
        }

        feedInfoInMarkdown += `\n\n`;
      }

      const scheduledMaintenanceCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
        await ScheduledMaintenanceWorkspaceMessages.getScheduledMaintenanceCreateMessageBlocks(
          {
            scheduledMaintenanceId: scheduledMaintenance.id!,
            projectId: scheduledMaintenance.projectId!,
          },
        );

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: scheduledMaintenance.id!,
        projectId: scheduledMaintenance.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated,
        displayColor: Red500,
        feedInfoInMarkdown: feedInfoInMarkdown,
        userId: createdByUserId || undefined,
        workspaceNotification: {
          appendMessageBlocks: scheduledMaintenanceCreateMessageBlocks,
          sendWorkspaceNotification: true,
        },
      });
    } catch (error) {
      logger.error(`Error in createScheduledMaintenanceFeedAsync: ${error}`);
      throw error;
    }
  }

  @CaptureSpan()
  private async createScheduledMaintenanceStateTimelineAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      const timeline: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      timeline.projectId = createdItem.projectId!;
      timeline.scheduledMaintenanceId = createdItem.id!;
      timeline.isOwnerNotified = true; // ignore notifying owners because you already notify for Scheduled Event, no need to notify them for timeline event.
      timeline.shouldStatusPageSubscribersBeNotified = Boolean(
        createdItem.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
      );
      // Map boolean to enum value - ignore notifying subscribers because you already notify for Scheduled Event, no need to notify them for timeline event.
      timeline.subscriberNotificationStatus =
        createdItem.shouldStatusPageSubscribersBeNotifiedOnEventCreated
          ? StatusPageSubscriberNotificationStatus.Success
          : StatusPageSubscriberNotificationStatus.Pending;
      timeline.scheduledMaintenanceStateId =
        createdItem.currentScheduledMaintenanceStateId!;

      await ScheduledMaintenanceStateTimelineService.create({
        data: timeline,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(
        `Error in createScheduledMaintenanceStateTimelineAsync: ${error}`,
      );
      throw error;
    }
  }

  @CaptureSpan()
  public async addOwners(
    projectId: ObjectID,
    scheduledMaintenanceId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: ScheduledMaintenanceOwnerTeam =
        new ScheduledMaintenanceOwnerTeam();
      teamOwner.scheduledMaintenanceId = scheduledMaintenanceId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;
      teamOwner.isOwnerNotified = !notifyOwners;

      await ScheduledMaintenanceOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: ScheduledMaintenanceOwnerUser =
        new ScheduledMaintenanceOwnerUser();
      teamOwner.scheduledMaintenanceId = scheduledMaintenanceId;
      teamOwner.projectId = projectId;
      teamOwner.isOwnerNotified = !notifyOwners;
      teamOwner.userId = userId;
      await ScheduledMaintenanceOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }

  @CaptureSpan()
  public async getScheduledMaintenanceLinkInDashboard(
    projectId: ObjectID,
    scheduledMaintenanceId: ObjectID,
  ): Promise<URL> {
    if (!projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is required");
    }

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (!dashboardUrl) {
      throw new BadDataException("Dashboard URL not found");
    }

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/scheduled-maintenance-events/${scheduledMaintenanceId.toString()}`,
    );
  }

  @CaptureSpan()
  public async findOwners(
    scheduledMaintenanceId: ObjectID,
  ): Promise<Array<User>> {
    if (!scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is required");
    }

    const ownerUsers: Array<ScheduledMaintenanceOwnerUser> =
      await ScheduledMaintenanceOwnerUserService.findBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenanceId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          },
        },

        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<ScheduledMaintenanceOwnerTeam> =
      await ScheduledMaintenanceOwnerTeamService.findBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenanceId,
        },
        select: {
          _id: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: ScheduledMaintenanceOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: ScheduledMaintenanceOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        //check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    return users;
  }

  @CaptureSpan()
  public async changeAttachedMonitorStates(
    item: Model,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    if (!item.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!item.id) {
      throw new BadDataException("id is required");
    }

    if (item.changeMonitorStatusToId && item.projectId) {
      // change status of all the monitors.
      await MonitorService.changeMonitorStatus(
        item.projectId,
        item.monitors?.map((monitor: Monitor) => {
          return new ObjectID(monitor._id || "");
        }) || [],
        item.changeMonitorStatusToId,
        true, // notify owners
        "Changed because of scheduled maintenance event: " + item.id.toString(),
        undefined,
        props,
      );
    }
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.updateBy.data.currentScheduledMaintenanceStateId &&
      onUpdate.updateBy.props.tenantId
    ) {
      for (const itemId of updatedItemIds) {
        await this.changeScheduledMaintenanceState({
          projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          scheduledMaintenanceId: itemId,
          scheduledMaintenanceStateId: onUpdate.updateBy.data
            .currentScheduledMaintenanceStateId as ObjectID,
          shouldNotifyStatusPageSubscribers: true,
          isSubscribersNotified: false,
          notifyOwners: true, // notifyOwners = true
          props: {
            isRoot: true,
          },
        });
      }
    }

    if (updatedItemIds.length > 0) {
      for (const scheduledMaintenanceId of updatedItemIds) {
        let shouldAddScheduledMaintenanceFeed: boolean = false;
        let feedInfoInMarkdown: string =
          "**Scheduled Maintenance was updated.**";

        const createdByUserId: ObjectID | undefined | null =
          onUpdate.updateBy.props.userId;

        if (onUpdate.updateBy.data.title) {
          // add scheduledMaintenance feed.

          feedInfoInMarkdown += `\n\n**Title**: 
${onUpdate.updateBy.data.title || "No title provided."}
`;
          shouldAddScheduledMaintenanceFeed = true;
        }

        if (onUpdate.updateBy.data.startsAt) {
          // add scheduledMaintenance feed.

          feedInfoInMarkdown += `\n\n**Starts At**: 
${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(onUpdate.updateBy.data.startsAt as Date) || "No title provided."}
`;
          shouldAddScheduledMaintenanceFeed = true;
        }

        if (onUpdate.updateBy.data.endsAt) {
          // add scheduledMaintenance feed.

          feedInfoInMarkdown += `\n\n**Ends At**:
${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(onUpdate.updateBy.data.endsAt as Date) || "No title provided."}
`;
          shouldAddScheduledMaintenanceFeed = true;
        }

        if (onUpdate.updateBy.data.description) {
          // add scheduledMaintenance feed.

          feedInfoInMarkdown += `\n\n**Scheduled Maintenance Description**: 
${onUpdate.updateBy.data.description || "No description provided."}
          `;
          shouldAddScheduledMaintenanceFeed = true;
        }

        if (
          onUpdate.updateBy.data.sendSubscriberNotificationsOnBeforeTheEvent &&
          Array.isArray(
            onUpdate.updateBy.data.sendSubscriberNotificationsOnBeforeTheEvent,
          ) &&
          onUpdate.updateBy.data.sendSubscriberNotificationsOnBeforeTheEvent
            .length > 0
        ) {
          feedInfoInMarkdown += `\n\n**Notify Subscribers Before Event Starts**: 
${(
  onUpdate.updateBy.data
    .sendSubscriberNotificationsOnBeforeTheEvent as Array<Recurring>
)
  .map((recurring: Recurring) => {
    return `- ${(recurring as Recurring).toString()}`;
  })
  .join("\n")}
          `;
          shouldAddScheduledMaintenanceFeed = true;
        }

        if (
          onUpdate.updateBy.data.monitors &&
          onUpdate.updateBy.data.monitors.length > 0 &&
          Array.isArray(onUpdate.updateBy.data.monitors)
        ) {
          const monitorIds: Array<ObjectID> = (
            onUpdate.updateBy.data.monitors as any
          )
            .map((monitor: Label) => {
              if (monitor._id) {
                return new ObjectID(monitor._id?.toString());
              }

              return null;
            })
            .filter((monitorId: ObjectID | null) => {
              return monitorId !== null;
            });

          const monitors: Array<Label> = await MonitorService.findBy({
            query: {
              _id: QueryHelper.any(monitorIds),
            },
            select: {
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          if (monitors.length > 0) {
            feedInfoInMarkdown += `\n\n**Resources Affected**:

${monitors
  .map((monitor: Monitor) => {
    return `- ${monitor.name}`;
  })
  .join("\n")}
`;

            shouldAddScheduledMaintenanceFeed = true;
          }
        }

        if (
          onUpdate.updateBy.data.statusPages &&
          onUpdate.updateBy.data.statusPages.length > 0 &&
          Array.isArray(onUpdate.updateBy.data.statusPages)
        ) {
          const statusPageIds: Array<ObjectID> = (
            onUpdate.updateBy.data.statusPages as any
          )
            .map((statusPage: Label) => {
              if (statusPage._id) {
                return new ObjectID(statusPage._id?.toString());
              }

              return null;
            })
            .filter((statusPageId: ObjectID | null) => {
              return statusPageId !== null;
            });

          const statusPages: Array<Label> = await StatusPageService.findBy({
            query: {
              _id: QueryHelper.any(statusPageIds),
            },
            select: {
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          if (statusPages.length > 0) {
            feedInfoInMarkdown += `\n\n**Show on these status pages:**:

${statusPages
  .map((statusPage: StatusPage) => {
    return `- ${statusPage.name}`;
  })
  .join("\n")}
`;

            shouldAddScheduledMaintenanceFeed = true;
          }
        }

        if (
          onUpdate.updateBy.data.labels &&
          onUpdate.updateBy.data.labels.length > 0 &&
          Array.isArray(onUpdate.updateBy.data.labels)
        ) {
          const labelIds: Array<ObjectID> = (
            onUpdate.updateBy.data.labels as any
          )
            .map((label: Label) => {
              if (label._id) {
                return new ObjectID(label._id?.toString());
              }

              return null;
            })
            .filter((labelId: ObjectID | null) => {
              return labelId !== null;
            });

          const labels: Array<Label> = await LabelService.findBy({
            query: {
              _id: QueryHelper.any(labelIds),
            },
            select: {
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          if (labels.length > 0) {
            feedInfoInMarkdown += `\n\n**Labels**:

${labels
  .map((label: Label) => {
    return `- ${label.name}`;
  })
  .join("\n")}
`;

            shouldAddScheduledMaintenanceFeed = true;
          }
        }

        if (shouldAddScheduledMaintenanceFeed) {
          await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
            {
              scheduledMaintenanceId: scheduledMaintenanceId,
              projectId: onUpdate.updateBy.props.tenantId as ObjectID,
              scheduledMaintenanceFeedEventType:
                ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated,
              displayColor: Gray500,
              feedInfoInMarkdown: feedInfoInMarkdown,
              userId: createdByUserId || undefined,
            },
          );
        }
      }
    }

    return onUpdate;
  }

  @CaptureSpan()
  public async changeScheduledMaintenanceState(data: {
    projectId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    scheduledMaintenanceStateId: ObjectID;
    shouldNotifyStatusPageSubscribers: boolean;
    isSubscribersNotified: boolean;
    notifyOwners: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const {
      projectId,
      scheduledMaintenanceId,
      scheduledMaintenanceStateId,
      notifyOwners,
      shouldNotifyStatusPageSubscribers,
      isSubscribersNotified,
      props,
    } = data;

    if (!projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is required");
    }

    if (!scheduledMaintenanceStateId) {
      throw new BadDataException("scheduledMaintenanceStateId is required");
    }

    // get last scheduled status timeline.
    const lastState: ScheduledMaintenanceStateTimeline | null =
      await ScheduledMaintenanceStateTimelineService.findOneBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenanceId,
          projectId: projectId,
        },
        select: {
          _id: true,
          scheduledMaintenanceStateId: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      lastState &&
      lastState.scheduledMaintenanceStateId &&
      lastState.scheduledMaintenanceStateId.toString() ===
        scheduledMaintenanceStateId.toString()
    ) {
      return;
    }

    const statusTimeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();

    statusTimeline.scheduledMaintenanceId = scheduledMaintenanceId;
    statusTimeline.scheduledMaintenanceStateId = scheduledMaintenanceStateId;
    statusTimeline.projectId = projectId;
    statusTimeline.isOwnerNotified = !notifyOwners;
    // Map boolean to enum value
    statusTimeline.subscriberNotificationStatus = isSubscribersNotified
      ? StatusPageSubscriberNotificationStatus.Success
      : StatusPageSubscriberNotificationStatus.Pending;
    statusTimeline.shouldStatusPageSubscribersBeNotified =
      shouldNotifyStatusPageSubscribers;

    await ScheduledMaintenanceStateTimelineService.create({
      data: statusTimeline,
      props: props,
    });

    await this.updateBy({
      data: {
        currentScheduledMaintenanceStateId: scheduledMaintenanceStateId.id,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      query: {
        _id: scheduledMaintenanceId.toString()!,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async isScheduledMaintenanceCompleted(data: {
    scheduledMaintenanceId: ObjectID;
  }): Promise<boolean> {
    const scheduledMaintenance: Model | null = await this.findOneBy({
      query: {
        _id: data.scheduledMaintenanceId,
      },
      select: {
        projectId: true,
        currentScheduledMaintenanceState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("ScheduledMaintenance not found");
    }

    if (!scheduledMaintenance.projectId) {
      throw new BadDataException("Incident Project ID not found");
    }

    const resolvedScheduledMaintenanceState: ScheduledMaintenanceState =
      await ScheduledMaintenanceStateService.getCompletedScheduledMaintenanceState(
        {
          projectId: scheduledMaintenance.projectId,
          props: {
            isRoot: true,
          },
        },
      );

    const currentScheduledMaintenanceStateOrder: number =
      scheduledMaintenance.currentScheduledMaintenanceState!.order!;
    const resolvedScheduledMaintenanceStateOrder: number =
      resolvedScheduledMaintenanceState.order!;

    if (
      currentScheduledMaintenanceStateOrder >=
      resolvedScheduledMaintenanceStateOrder
    ) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public async getScheduledMaintenanceNumber(data: {
    scheduledMaintenanceId: ObjectID;
  }): Promise<number | null> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: data.scheduledMaintenanceId,
      select: {
        scheduledMaintenanceNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("ScheduledMaintenance not found.");
    }

    return scheduledMaintenance.scheduledMaintenanceNumber
      ? Number(scheduledMaintenance.scheduledMaintenanceNumber)
      : null;
  }

  @CaptureSpan()
  public async isScheduledMaintenanceOngoing(data: {
    scheduledMaintenanceId: ObjectID;
  }): Promise<boolean> {
    const scheduledMaintenance: Model | null = await this.findOneBy({
      query: {
        _id: data.scheduledMaintenanceId,
      },
      select: {
        projectId: true,
        currentScheduledMaintenanceState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("ScheduledMaintenance not found");
    }

    if (!scheduledMaintenance.projectId) {
      throw new BadDataException("Incident Project ID not found");
    }

    const ackScheduledMaintenanceState: ScheduledMaintenanceState =
      await ScheduledMaintenanceStateService.getOngoingScheduledMaintenanceState(
        {
          projectId: scheduledMaintenance.projectId,
          props: {
            isRoot: true,
          },
        },
      );

    const currentScheduledMaintenanceStateOrder: number =
      scheduledMaintenance.currentScheduledMaintenanceState!.order!;
    const ackScheduledMaintenanceStateOrder: number =
      ackScheduledMaintenanceState.order!;

    if (
      currentScheduledMaintenanceStateOrder >= ackScheduledMaintenanceStateOrder
    ) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public async markScheduledMaintenanceAsComplete(
    scheduledMaintenanceId: ObjectID,
    resolvedByUserId: ObjectID,
  ): Promise<Model> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: scheduledMaintenanceId,
      select: {
        projectId: true,
        scheduledMaintenanceNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance || !scheduledMaintenance.projectId) {
      throw new BadDataException("ScheduledMaintenance not found.");
    }

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          projectId: scheduledMaintenance.projectId,
          isResolvedState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
      throw new BadDataException(
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    scheduledMaintenanceStateTimeline.projectId =
      scheduledMaintenance.projectId;
    scheduledMaintenanceStateTimeline.scheduledMaintenanceId =
      scheduledMaintenanceId;
    scheduledMaintenanceStateTimeline.scheduledMaintenanceStateId =
      scheduledMaintenanceState.id;
    scheduledMaintenanceStateTimeline.createdByUserId = resolvedByUserId;

    await ScheduledMaintenanceStateTimelineService.create({
      data: scheduledMaintenanceStateTimeline,
      props: {
        isRoot: true,
      },
    });

    // store scheduledMaintenance metric

    return scheduledMaintenance;
  }

  @CaptureSpan()
  public async markScheduledMaintenanceAsOngoing(
    scheduledMaintenanceId: ObjectID,
    markedByUserId: ObjectID,
  ): Promise<Model> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: scheduledMaintenanceId,
      select: {
        projectId: true,
        scheduledMaintenanceNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance || !scheduledMaintenance.projectId) {
      throw new BadDataException("ScheduledMaintenance not found.");
    }

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          projectId: scheduledMaintenance.projectId,
          isOngoingState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
      throw new BadDataException(
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    scheduledMaintenanceStateTimeline.projectId =
      scheduledMaintenance.projectId;
    scheduledMaintenanceStateTimeline.scheduledMaintenanceId =
      scheduledMaintenanceId;
    scheduledMaintenanceStateTimeline.scheduledMaintenanceStateId =
      scheduledMaintenanceState.id;
    scheduledMaintenanceStateTimeline.createdByUserId = markedByUserId;

    await ScheduledMaintenanceStateTimelineService.create({
      data: scheduledMaintenanceStateTimeline,
      props: {
        isRoot: true,
      },
    });

    // store scheduledMaintenance metric

    return scheduledMaintenance;
  }

  @CaptureSpan()
  public async getWorkspaceChannelForScheduledMaintenance(data: {
    scheduledMaintenanceId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: data.scheduledMaintenanceId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("ScheduledMaintenance not found.");
    }

    return (scheduledMaintenance.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  /**
   * Ensures the currentScheduledMaintenanceStateId of the scheduled maintenance matches the latest timeline entry.
   */
  public async refreshScheduledMaintenanceCurrentStatus(
    scheduledMaintenanceId: ObjectID,
  ): Promise<void> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: scheduledMaintenanceId,
      select: {
        _id: true,
        projectId: true,
        currentScheduledMaintenanceStateId: true,
      },
      props: { isRoot: true },
    });
    if (!scheduledMaintenance || !scheduledMaintenance.projectId) {
      return;
    }
    const latestTimeline: ScheduledMaintenanceStateTimeline | null =
      await ScheduledMaintenanceStateTimelineService.findOneBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenance.id!,
          projectId: scheduledMaintenance.projectId,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        select: {
          scheduledMaintenanceStateId: true,
        },
        props: {
          isRoot: true,
        },
      });
    if (
      latestTimeline &&
      latestTimeline.scheduledMaintenanceStateId &&
      scheduledMaintenance.currentScheduledMaintenanceStateId?.toString() !==
        latestTimeline.scheduledMaintenanceStateId.toString()
    ) {
      await this.updateOneBy({
        query: { _id: scheduledMaintenance.id!.toString() },
        data: {
          currentScheduledMaintenanceStateId:
            latestTimeline.scheduledMaintenanceStateId,
        },
        props: { isRoot: true },
      });
      logger.info(
        `Updated ScheduledMaintenance ${scheduledMaintenance.id} current state to ${latestTimeline.scheduledMaintenanceStateId}`,
      );
    }
  }
}
export default new Service();
