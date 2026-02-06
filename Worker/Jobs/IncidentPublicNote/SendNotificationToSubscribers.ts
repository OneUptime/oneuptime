import RunCron from "../../Utils/Cron";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";

RunCron(
  "IncidentPublicNote:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all incident notes of all the projects

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const incidentPublicNoteNotes: Array<IncidentPublicNote> =
      await IncidentPublicNoteService.findBy({
        query: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          note: true,
          incidentId: true,
          projectId: true,
        },
      });

    logger.debug(
      `Found ${incidentPublicNoteNotes.length} incident public note(s) to notify subscribers for.`,
    );

    for (const incidentPublicNote of incidentPublicNoteNotes) {
      try {
        logger.debug(
          `Processing incident public note ${incidentPublicNote.id}.`,
        );
        if (!incidentPublicNote.incidentId) {
          logger.debug(
            `Incident public note ${incidentPublicNote.id} has no incidentId; skipping.`,
          );
          continue; // skip if incidentId is not set
        }

        // get all scheduled events of all the projects.
        const incident: Incident | null = await IncidentService.findOneById({
          id: incidentPublicNote.incidentId!,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            title: true,
            description: true,
            projectId: true,
            monitors: {
              _id: true,
            },
            incidentSeverity: {
              name: true,
            },
            isVisibleOnStatusPage: true,
            incidentNumber: true,
            incidentNumberWithPrefix: true,
          },
        });

        if (!incident) {
          logger.debug(
            `Incident ${incidentPublicNote.incidentId} not found; marking public note ${incidentPublicNote.id} as Skipped.`,
          );
          await IncidentPublicNoteService.updateOneById({
            id: incidentPublicNote.id!,
            data: {
              subscriberNotificationStatusOnNoteCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Related incident not found. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        if (!incident.monitors || incident.monitors.length === 0) {
          logger.debug(
            `Incident ${incident.id} has no monitors; marking public note ${incidentPublicNote.id} as Skipped.`,
          );
          await IncidentPublicNoteService.updateOneById({
            id: incidentPublicNote.id!,
            data: {
              subscriberNotificationStatusOnNoteCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "No monitors are attached to the related incident. Skipping notifications.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        // Set status to InProgress
        await IncidentPublicNoteService.updateOneById({
          id: incidentPublicNote.id!,
          data: {
            subscriberNotificationStatusOnNoteCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Incident public note ${incidentPublicNote.id} status set to InProgress for subscriber notifications.`,
        );

        if (!incident.isVisibleOnStatusPage) {
          // Set status to Skipped for non-visible incidents
          logger.debug(
            `Incident ${incident.id} is not visible on status page; marking public note ${incidentPublicNote.id} as Skipped.`,
          );
          await IncidentPublicNoteService.updateOneById({
            id: incidentPublicNote.id!,
            data: {
              subscriberNotificationStatusOnNoteCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Notifications skipped as incident is not visible on status page.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        // get status page resources from monitors.

        const statusPageResources: Array<StatusPageResource> =
          await StatusPageResourceService.findBy({
            query: {
              monitorId: QueryHelper.any(
                incident.monitors
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
              statusPageGroupId: true,
              statusPageGroup: {
                name: true,
              },
            },
          });

        logger.debug(
          `Found ${statusPageResources.length} status page resource(s) for incident ${incident.id}.`,
        );

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

        logger.debug(
          `Incident ${incident.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for public note notifications.`,
        );

        const statusPages: Array<StatusPage> =
          await StatusPageSubscriberService.getStatusPagesToSendNotification(
            Object.keys(statusPageToResources).map((i: string) => {
              return new ObjectID(i);
            }),
          );

        for (const statuspage of statusPages) {
          logger.debug("Encountered a status page without an id; skipping.");
          if (!statuspage.id) {
            continue;
          }

          logger.debug(
            `Status page ${statuspage.id} hides incidents; skipping.`,
          );
          if (!statuspage.showIncidentsOnStatusPage) {
            continue; // Do not send notification to subscribers if incidents are not visible on status page.
          }

          const subscribers: Array<StatusPageSubscriber> =
            await StatusPageSubscriberService.getSubscribersByStatusPage(
              statuspage.id!,
              {
                isRoot: true,
                ignoreHooks: true,
              },
            );

          const statusPageURL: string =
            await StatusPageService.getStatusPageURL(statuspage.id);
          const statusPageName: string =
            statuspage.pageTitle || statuspage.name || "Status Page";
          const statusPageIdString: string | null =
            statuspage.id?.toString() || statuspage._id?.toString() || null;

          const incidentDetailsUrl: string =
            incident.id && statusPageURL
              ? URL.fromString(statusPageURL)
                  .addRoute(`/incidents/${incident.id.toString()}`)
                  .toString()
              : statusPageURL;

          logger.debug(
            `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for public note ${incidentPublicNote.id}.`,
          );

          // Fetch custom templates for this status page (if any)
          const [emailTemplate, smsTemplate, slackTemplate, teamsTemplate]: [
            StatusPageSubscriberNotificationTemplate | null,
            StatusPageSubscriberNotificationTemplate | null,
            StatusPageSubscriberNotificationTemplate | null,
            StatusPageSubscriberNotificationTemplate | null,
          ] = await Promise.all([
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.Email,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
                notificationMethod: StatusPageSubscriberNotificationMethod.SMS,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.Slack,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.MicrosoftTeams,
              },
            ),
          ]);

          // Prepare template variables for custom templates
          const resourcesAffectedString: string =
            StatusPageResourceUtil.getResourcesGroupedByGroupName(
              statusPageToResources[statuspage._id!] || [],
            );

          const templateVariables: Record<string, string> = {
            statusPageName: statusPageName,
            statusPageUrl: statusPageURL,
            detailsUrl: incidentDetailsUrl,
            resourcesAffected: resourcesAffectedString,
            incidentSeverity: incident.incidentSeverity?.name || " - ",
            incidentTitle: incident.title || "",
            note: incidentPublicNote.note || "",
          };

          // Prepare SMS-specific template variables with plain text (no HTML/Markdown)
          const smsTemplateVariables: Record<string, string> = {
            ...templateVariables,
            note: Markdown.convertToPlainText(incidentPublicNote.note || ""),
          };

          // Send email to Email subscribers.

          for (const subscriber of subscribers) {
            if (!subscriber._id) {
              logger.debug(
                "Encountered a subscriber without an _id; skipping.",
              );
              continue;
            }

            const shouldNotifySubscriber: boolean =
              StatusPageSubscriberService.shouldSendNotification({
                subscriber: subscriber,
                statusPageResources:
                  statusPageToResources[statuspage._id!] || [],
                statusPage: statuspage,
                eventType: StatusPageEventType.Incident,
              });

            if (!shouldNotifySubscriber) {
              logger.debug(
                `Skipping subscriber ${subscriber._id} based on preferences for public note ${incidentPublicNote.id}.`,
              );
              continue;
            }

            const unsubscribeUrl: string =
              StatusPageSubscriberService.getUnsubscribeLink(
                URL.fromString(statusPageURL),
                subscriber.id!,
              ).toString();

            logger.debug(
              `Prepared unsubscribe link for subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
            );

            // Add unsubscribeUrl to template variables
            const subscriberTemplateVariables: Record<string, string> = {
              ...templateVariables,
              unsubscribeUrl: unsubscribeUrl,
            };

            if (subscriber.subscriberPhone) {
              const phoneStr: string = subscriber.subscriberPhone.toString();
              const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
              logger.debug(
                `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for public note ${incidentPublicNote.id}.`,
              );

              // SMS-specific template variables with unsubscribe URL
              const subscriberSmsTemplateVariables: Record<string, string> = {
                ...smsTemplateVariables,
                unsubscribeUrl: unsubscribeUrl,
              };

              let smsMessage: string;
              if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
                // Use custom template only when custom Twilio is configured
                smsMessage =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    smsTemplate.templateBody,
                    subscriberSmsTemplateVariables,
                  );
              } else {
                // Use default hard-coded template
                smsMessage = `Incident update: ${incident.title || "-"} on ${statusPageName}. A new note is posted. Details: ${incidentDetailsUrl}. Unsub: ${unsubscribeUrl}`;
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
                incidentId: incident.id!,
              }).catch((err: Error) => {
                logger.error(err);
              });
            }

            if (subscriber.subscriberEmail) {
              // send email here.
              logger.debug(
                `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for public note ${incidentPublicNote.id}.`,
              );

              if (emailTemplate?.templateBody && statuspage.smtpConfig) {
                // Use custom template with BlankTemplate only when custom SMTP is configured
                const compiledBody: string =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    emailTemplate.templateBody,
                    subscriberTemplateVariables,
                  );
                const compiledSubject: string = emailTemplate.emailSubject
                  ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                      emailTemplate.emailSubject,
                      subscriberTemplateVariables,
                    )
                  : "[Incident Update] " + incident.title || "";

                MailService.sendMail(
                  {
                    toEmail: subscriber.subscriberEmail,
                    templateType: EmailTemplateType.BlankTemplate,
                    vars: {
                      body: compiledBody,
                    },
                    subject: compiledSubject,
                  },
                  {
                    mailServer: ProjectSmtpConfigService.toEmailServer(
                      statuspage.smtpConfig,
                    ),
                    projectId: statuspage.projectId,
                    statusPageId: statuspage.id!,
                    incidentId: incident.id!,
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
                      EmailTemplateType.SubscriberIncidentNoteCreated,
                    vars: {
                      note: await Markdown.convertToHTML(
                        incidentPublicNote.note!,
                        MarkdownContentType.Email,
                      ),
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      detailsUrl: incidentDetailsUrl,
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
                      resourcesAffected: resourcesAffectedString,
                      incidentSeverity:
                        incident.incidentSeverity?.name || " - ",
                      incidentTitle: incident.title || "",
                      incidentDescription: incident.description || "",
                      unsubscribeUrl: unsubscribeUrl,
                      subscriberEmailNotificationFooterText:
                        StatusPageServiceType.getSubscriberEmailFooterText(
                          statuspage,
                        ),
                    },
                    subject: "[Incident Update] " + incident.title,
                  },
                  {
                    mailServer: ProjectSmtpConfigService.toEmailServer(
                      statuspage.smtpConfig,
                    ),
                    projectId: statuspage.projectId,
                    statusPageId: statuspage.id!,
                    incidentId: incident.id!,
                  },
                ).catch((err: Error) => {
                  logger.error(err);
                });
              }
              logger.debug(
                `Email notification queued for subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
              );
            }

            if (subscriber.slackIncomingWebhookUrl) {
              // send slack message here.
              logger.debug(
                `Queueing Slack notification to subscriber ${subscriber._id} via incoming webhook for public note ${incidentPublicNote.id}.`,
              );

              let markdownMessage: string;
              if (slackTemplate?.templateBody) {
                // Use custom template
                markdownMessage =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    slackTemplate.templateBody,
                    subscriberTemplateVariables,
                  );
              } else {
                // Use default hard-coded template
                markdownMessage = `## Incident - ${incident.title || ""}

**New note has been added to an incident**

**Resources Affected:** ${resourcesAffectedString}
**Severity:** ${incident.incidentSeverity?.name || " - "}

**Note:**
${incidentPublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
              }

              SlackUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.slackIncomingWebhookUrl,
                text: SlackUtil.convertMarkdownToSlackRichText(markdownMessage),
              }).catch((err: Error) => {
                logger.error(err);
              });
              logger.debug(
                `Slack notification queued for subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
              );
            }

            if (subscriber.microsoftTeamsIncomingWebhookUrl) {
              // send Teams message here.
              logger.debug(
                `Queueing Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook for public note ${incidentPublicNote.id}.`,
              );

              let markdownMessage: string;
              if (teamsTemplate?.templateBody) {
                // Use custom template
                markdownMessage =
                  StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    teamsTemplate.templateBody,
                    subscriberTemplateVariables,
                  );
              } else {
                // Use default hard-coded template
                markdownMessage = `## Incident - ${incident.title || ""}

**New note has been added to an incident**

**Resources Affected:** ${resourcesAffectedString}
**Severity:** ${incident.incidentSeverity?.name || " - "}

**Note:**
${incidentPublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
              }

              MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.microsoftTeamsIncomingWebhookUrl,
                text: markdownMessage,
              }).catch((err: Error) => {
                logger.error(err);
              });
              logger.debug(
                `Microsoft Teams notification queued for subscriber ${subscriber._id} for public note ${incidentPublicNote.id}.`,
              );
            }
          }
        }

        logger.debug(
          `Notification sent to subscribers for public note added to incident: ${incident.id}`,
        );

        await IncidentFeedService.createIncidentFeedItem({
          incidentId: incident.id!,
          projectId: incident.projectId!,
          incidentFeedEventType:
            IncidentFeedEventType.SubscriberNotificationSent,
          displayColor: Blue500,
          feedInfoInMarkdown: `📧 **Notification sent to subscribers** because a public note is added to this [Incident ${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()}).`,
          moreInformationInMarkdown: `**Public Note:**
        
${incidentPublicNote.note}`,
          workspaceNotification: {
            sendWorkspaceNotification: true,
          },
        });

        logger.debug("Incident Feed created");

        // Set status to Success after successful notification
        await IncidentPublicNoteService.updateOneById({
          id: incidentPublicNote.id!,
          data: {
            subscriberNotificationStatusOnNoteCreated:
              StatusPageSubscriberNotificationStatus.Success,
            subscriberNotificationStatusMessage:
              "Notifications sent successfully to all subscribers",
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Incident public note ${incidentPublicNote.id} marked as Success for subscriber notifications.`,
        );
      } catch (err) {
        logger.error(
          `Error sending notification for incident public note ${incidentPublicNote.id}: ${err}`,
        );

        // Set status to Failed with error reason
        await IncidentPublicNoteService.updateOneById({
          id: incidentPublicNote.id!,
          data: {
            subscriberNotificationStatusOnNoteCreated:
              StatusPageSubscriberNotificationStatus.Failed,
            subscriberNotificationStatusMessage: (err as Error).message,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      }
    }
  },
);
