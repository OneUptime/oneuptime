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
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Model from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import User from "Common/Models/DatabaseModels/User";
import Recurring from "../../Types/Events/Recurring";
import OneUptimeDate from "../../Types/Date";
import UpdateBy from "../Types/Database/UpdateBy";
import { FileRoute } from "Common/ServiceRoute";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import SMS from "Common/Types/SMS/SMS";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import { IsBillingEnabled } from "../EnvironmentConfig";
import StatusPageEventType from "../../Types/StatusPage/StatusPageEventType";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import Label from "../../Models/DatabaseModels/Label";
import LabelService from "./LabelService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }



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

    return lastScheduledMaintenance.scheduledMaintenanceNumber || 0;
  }

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

        // Send email to Email subscribers.

        const resourcesAffected: string =
          statusPageToResources[statuspage._id!]
            ?.map((r: StatusPageResource) => {
              return r.displayName;
            })
            .join(", ") || "";

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

          if (subscriber.subscriberPhone) {
            const sms: SMS = {
              message: `
                            Scheduled Maintenance - ${statusPageName}

                            ${event.title || ""}

                            ${
                              resourcesAffected
                                ? "Resources Affected: " + resourcesAffected
                                : ""
                            }

                            To view this event, visit ${statusPageURL}

                            To update notification preferences or unsubscribe, visit ${unsubscribeUrl}
                            `,
              to: subscriber.subscriberPhone,
            };

            // send sms here.
            SmsService.sendSms(sms, {
              projectId: statuspage.projectId,
              customTwilioConfig: ProjectCallSMSConfigService.toTwilioConfig(
                statuspage.callSmsConfig,
              ),
            }).catch((err: Error) => {
              logger.error(err);
            });
          }

          if (subscriber.subscriberEmail) {
            // send email here.

            MailService.sendMail(
              {
                toEmail: subscriber.subscriberEmail,
                templateType:
                  EmailTemplateType.SubscriberScheduledMaintenanceEventCreated,
                vars: {
                  statusPageName: statusPageName,
                  statusPageUrl: statusPageURL,
                  logoUrl: statuspage.logoFileId
                    ? new URL(httpProtocol, host)
                        .addRoute(FileRoute)
                        .addRoute("/image/" + statuspage.logoFileId)
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
                    }),
                  eventTitle: event.title || "",
                  eventDescription: await Markdown.convertToHTML(
                    event.description || "",
                    MarkdownContentType.Email,
                  ),
                  unsubscribeUrl: unsubscribeUrl,
                },
                subject: "[Scheduled Maintenance] " + statusPageName,
              },
              {
                mailServer: ProjectSmtpConfigService.toEmailServer(
                  statuspage.smtpConfig,
                ),
                projectId: statuspage.projectId!,
              },
            ).catch((err: Error) => {
              logger.error(err);
            });
          }
        }
      }
    }

    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Completed",
    );
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (
      updateBy.query.id &&
      updateBy.data.sendSubscriberNotificationsOnBeforeTheEvent
    ) {
      const scheduledMaintenance: Model | null = await this.findOneById({
        id: updateBy.query.id! as ObjectID,
        select: {
          startsAt: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!scheduledMaintenance) {
        throw new BadDataException("Scheduled Maintennace Event not found");
      }

      const startsAt: Date =
        (updateBy.data.startsAt as Date) ||
        (scheduledMaintenance.startsAt! as Date);

      const nextTimeToNotifyBeforeTheEvent: Date | null =
        this.getNextTimeToNotify({
          eventScheduledDate: startsAt,
          sendSubscriberNotifiationsOn: updateBy.data
            .sendSubscriberNotificationsOnBeforeTheEvent as Array<Recurring>,
        });

      updateBy.data.nextSubscriberNotificationBeforeTheEventAt =
        nextTimeToNotifyBeforeTheEvent;
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

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
    sendSubscriberNotifiationsOn: Array<Recurring>;
  }): Date | null {
    let recurringDate: Date | null = null;

    for (const recurringItem of data.sendSubscriberNotifiationsOn) {
      const notificationDate: Date = Recurring.getNextDateInterval(
        data.eventScheduledDate,
        recurringItem,
        true,
      );

      // if this date is in the future. set it to recurring date.
      if (OneUptimeDate.isInTheFuture(notificationDate)) {
        recurringDate = notificationDate;
      }

      // if this new date is less than the recurring date then set it to recuring date. We need to get the least date.

      if (recurringDate) {
        if (OneUptimeDate.isBefore(notificationDate, recurringDate)) {
          recurringDate = notificationDate;
        }
      }
    }

    return recurringDate;
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {




    if (!createBy.props.tenantId && !createBy.data.projectId) {
      throw new BadDataException(
        "ProjectId required to create scheduled maintenane.",
      );
    }

    const projectId: ObjectID = createBy.props.tenantId || createBy.data.projectId!; 

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

    createBy.data.scheduledMaintenanceNumber = scheduledMaintenanceNumberForThisScheduledMaintenance;

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

    return { createBy, carryForward: null };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // create new scheduled maintenance state timeline.

    const createdByUserId: ObjectID | undefined | null =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
      scheduledMaintenanceId: createdItem.id!,
      projectId: createdItem.projectId!,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated,
      displayColor: Red500,
      feedInfoInMarkdown: `**Scheduled Maintenance #${createdItem.scheduledMaintenanceNumber?.toString()} Created**: 
          
**Scheduled Maintenance Title**:

${createdItem.title || "No title provided."}

**Description**:

${createdItem.description || "No description provided."}
    
          `,
      userId: createdByUserId || undefined,
    });

    const timeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    timeline.projectId = createdItem.projectId!;
    timeline.scheduledMaintenanceId = createdItem.id!;
    timeline.isOwnerNotified = true; // ignore notifying owners because you already notify for Scheduled Event, you don't have to notify them for timeline event.
    timeline.shouldStatusPageSubscribersBeNotified = Boolean(
      createdItem.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
    );
    timeline.isStatusPageSubscribersNotified = Boolean(
      createdItem.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
    ); // ignore notifying subscribers because you already notify for Scheduled Event, you don't have to notify them for timeline event.
    timeline.scheduledMaintenanceStateId =
      createdItem.currentScheduledMaintenanceStateId!;

    await ScheduledMaintenanceStateTimelineService.create({
      data: timeline,
      props: {
        isRoot: true,
      },
    });

    if (
      createdItem.projectId &&
      createdItem.id &&
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["ownerTeams"] ||
        onCreate.createBy.miscDataProps["ownerUsers"])
    ) {
      await this.addOwners(
        createdItem.projectId!,
        createdItem.id!,
        (onCreate.createBy.miscDataProps["ownerUsers"] as Array<ObjectID>) ||
          [],
        (onCreate.createBy.miscDataProps["ownerTeams"] as Array<ObjectID>) ||
          [],
        false,
        onCreate.createBy.props,
      );
    }

    return createdItem;
  }

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

  public async getScheduledMaintenanceLinkInDashboard(
    projectId: ObjectID,
    scheduledMaintenanceId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/scheduled-maintenance-events/${scheduledMaintenanceId.toString()}`,
    );
  }

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
${OneUptimeDate.getDateAsLocalFormattedString(onUpdate.updateBy.data.startsAt as Date) || "No title provided."}
`;
          shouldAddScheduledMaintenanceFeed = true;
        }

        if (onUpdate.updateBy.data.endsAt) {
          // add scheduledMaintenance feed.

          feedInfoInMarkdown += `\n\n**Ends At**:
${OneUptimeDate.getDateAsLocalFormattedString(onUpdate.updateBy.data.endsAt as Date) || "No title provided."}
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
          await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
            scheduledMaintenanceId: scheduledMaintenanceId,
            projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated,
            displayColor: Gray500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: createdByUserId || undefined,
          });
        }
      }
    }

    return onUpdate;
  }

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
    statusTimeline.isStatusPageSubscribersNotified = isSubscribersNotified;
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
}
export default new Service();
