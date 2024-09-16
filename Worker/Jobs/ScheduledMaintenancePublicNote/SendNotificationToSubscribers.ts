import RunCron from "../../Utils/Cron";
import { FileRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";

RunCron(
  "ScheduledMaintenancePublicNote:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all incident notes of all the projects

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const publicNotes: Array<ScheduledMaintenancePublicNote> =
      await ScheduledMaintenancePublicNoteService.findBy({
        query: {
          isStatusPageSubscribersNotifiedOnNoteCreated: false,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
          createdAt: QueryHelper.lessThan(OneUptimeDate.getCurrentDate()),
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          note: true,
          scheduledMaintenanceId: true,
        },
      });

    for (const publicNote of publicNotes) {
      // get all scheduled events of all the projects.
      const event: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: publicNote.scheduledMaintenanceId!,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            title: true,
            description: true,
            startsAt: true,
            monitors: {
              _id: true,
            },
            statusPages: {
              _id: true,
            },
          },
        });

      if (!event) {
        continue;
      }

      await ScheduledMaintenancePublicNoteService.updateOneById({
        id: publicNote.id!,
        data: {
          isStatusPageSubscribersNotifiedOnNoteCreated: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      // get status page resources from monitors.

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

        for (const subscriber of subscribers) {
          if (!subscriber._id) {
            continue;
          }

          const shouldNotifySubscriber: boolean =
            StatusPageSubscriberService.shouldSendNotification({
              subscriber: subscriber,
              statusPageResources: statusPageToResources[statuspage._id!] || [],
              statusPage: statuspage,
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
                                    ${statusPageName} - New note has been posted to maintenance event.

                                    ${event.title || ""}
                                    
                                    To view this note, visit ${statusPageURL}
        
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
                  EmailTemplateType.SubscriberScheduledMaintenanceEventNoteCreated,
                vars: {
                  note: await Markdown.convertToHTML(
                    publicNote.note!,
                    MarkdownContentType.Email,
                  ),
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
                  resourcesAffected:
                    statusPageToResources[statuspage._id!]
                      ?.map((r: StatusPageResource) => {
                        return r.displayName;
                      })
                      .join(", ") || "",

                  scheduledAt: OneUptimeDate.getDateAsFormattedString(
                    event.startsAt!,
                  ),
                  eventTitle: event.title || "",
                  eventDescription: event.description || "",
                  unsubscribeUrl: unsubscribeUrl,
                },
                subject: "[Scheduled Maintenance Update] " + statusPageName,
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
  },
);
