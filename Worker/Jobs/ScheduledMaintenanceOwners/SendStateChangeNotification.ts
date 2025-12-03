import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import Text from "Common/Types/Text";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProjectService from "Common/Server/Services/ProjectService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import User from "Common/Models/DatabaseModels/User";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import UserService from "Common/Server/Services/UserService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "ScheduledMaintenanceOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.

    const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
      await ScheduledMaintenanceStateTimelineService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          createdAt: true,
          startsAt: true,
          projectId: true,
          project: {
            name: true,
          },
          scheduledMaintenanceId: true,
          scheduledMaintenance: {
            _id: true,
            title: true,
            description: true,
            projectId: true,
            scheduledMaintenanceNumber: true,
          },
          scheduledMaintenanceStateId: true,
          scheduledMaintenanceState: {
            name: true,
            color: true,
          },
        },
      });

    for (const scheduledMaintenanceStateTimeline of scheduledMaintenanceStateTimelines) {
      let moreScheduledMaintenanceFeedInformationInMarkdown: string = "";

      const scheduledMaintenance: ScheduledMaintenance =
        scheduledMaintenanceStateTimeline.scheduledMaintenance!;
      const scheduledMaintenanceState: ScheduledMaintenanceState =
        scheduledMaintenanceStateTimeline.scheduledMaintenanceState!;

      await ScheduledMaintenanceStateTimelineService.updateOneById({
        id: scheduledMaintenanceStateTimeline.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      // Fetch the previous state timeline entry
      let previousState: ScheduledMaintenanceState | null = null;

      if (
        scheduledMaintenanceStateTimeline.scheduledMaintenanceId &&
        scheduledMaintenanceStateTimeline.startsAt
      ) {
        const previousTimeline: ScheduledMaintenanceStateTimeline | null =
          await ScheduledMaintenanceStateTimelineService.findOneBy({
            query: {
              scheduledMaintenanceId:
                scheduledMaintenanceStateTimeline.scheduledMaintenanceId,
              startsAt: QueryHelper.lessThan(
                scheduledMaintenanceStateTimeline.startsAt,
              ),
            },
            sort: {
              startsAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
            select: {
              scheduledMaintenanceStateId: true,
            },
          });

        if (previousTimeline?.scheduledMaintenanceStateId) {
          previousState = await ScheduledMaintenanceStateService.findOneById({
            id: previousTimeline.scheduledMaintenanceStateId,
            props: {
              isRoot: true,
            },
            select: {
              name: true,
              color: true,
            },
          });
        }
      }

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await ScheduledMaintenanceService.findOwners(
        scheduledMaintenance.id!,
      );

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(
          scheduledMaintenanceStateTimeline.projectId!,
        );
      }

      if (owners.length === 0) {
        continue;
      }

      for (const user of owners) {
        const vars: Dictionary<string> = {
          scheduledMaintenanceTitle: scheduledMaintenance.title!,
          projectName: scheduledMaintenanceStateTimeline.project!.name!,
          currentState: scheduledMaintenanceState!.name!,
          currentStateColor:
            scheduledMaintenanceState!.color?.toString() || "#000000",
          previousState: previousState?.name || "",
          previousStateColor: previousState?.color?.toString() || "#6b7280",
          scheduledMaintenanceDescription: await Markdown.convertToHTML(
            scheduledMaintenance.description! || "",
            MarkdownContentType.Email,
          ),
          stateChangedAt:
            OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: scheduledMaintenanceStateTimeline.startsAt!,
              timezones: user.timezone ? [user.timezone] : [],
            }),
          scheduledMaintenanceViewLink: (
            await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
              scheduledMaintenanceStateTimeline.projectId!,
              scheduledMaintenance.id!,
            )
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ScheduledMaintenanceOwnerStateChanged,
          vars: vars,
          subject: `[Scheduled Maintenance ${Text.uppercaseFirstLetter(
            scheduledMaintenanceState!.name!,
          )}] - ${scheduledMaintenance.title}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. Scheduled maintenance event - ${
            scheduledMaintenance.title
          }, state changed${previousState ? ` from ${previousState.name}` : ""} to ${scheduledMaintenanceState!
            .name!}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Scheduled maintenance event ${
                scheduledMaintenance.title
              } state changed${previousState ? ` from ${previousState.name}` : ""} to ${scheduledMaintenanceState!
                .name!}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Scheduled Maintenance State Changed",
            body: `Scheduled maintenance ${scheduledMaintenance.title} state changed${previousState ? ` from ${previousState.name}` : ""} to ${scheduledMaintenanceState!.name!}. Click to view details.`,
            clickAction: (
              await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                scheduledMaintenance.projectId!,
                scheduledMaintenance.id!,
              )
            ).toString(),
            tag: "scheduled-maintenance-state-changed",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              event_title: scheduledMaintenance.title!,
              event_state: scheduledMaintenanceState!.name!,
              maintenance_link: vars["scheduledMaintenanceViewLink"] || "",
              event_number:
                scheduledMaintenance.scheduledMaintenanceNumber?.toString() ??
                "N/A",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: scheduledMaintenanceStateTimeline.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          scheduledMaintenanceId: scheduledMaintenance.id!,
          eventType,
        });

        moreScheduledMaintenanceFeedInformationInMarkdown += `**Notified:** ${await UserService.getUserMarkdownString(
          {
            userId: user.id!,
            projectId: scheduledMaintenanceStateTimeline.projectId!,
          },
        )})\n`;
      }

      const scheduledMaintenanceNumber: number =
        scheduledMaintenance.scheduledMaintenanceNumber!;
      const projectId: ObjectID = scheduledMaintenance.projectId!;
      const scheduledMaintenanceId: ObjectID = scheduledMaintenance.id!;

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: scheduledMaintenance.id!,
        projectId: scheduledMaintenance.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `🔔 **Owners have been notified about the state change of the [Scheduled Maintenance ${scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId, scheduledMaintenanceId)).toString()}).**: Owners have been notified about the state change of the scheduledMaintenance because the scheduledMaintenance state changed to **${scheduledMaintenanceState.name}**.`,
        moreInformationInMarkdown:
          moreScheduledMaintenanceFeedInformationInMarkdown,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    }
  },
);
