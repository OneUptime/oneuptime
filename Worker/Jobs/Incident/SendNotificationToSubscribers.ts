import RunCron from "../../Utils/Cron";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentService from "Common/Server/Services/IncidentService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";

RunCron(
  "Incident:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // First, mark incidents as Skipped if they should not be notified
    const incidentsToSkip: Array<Incident> = await IncidentService.findAllBy({
      query: {
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      select: {
        _id: true,
      },
    });

    logger.debug(
      `Found ${incidentsToSkip.length} incidents to mark as Skipped (subscribers should not be notified).`,
    );

    for (const incident of incidentsToSkip) {
      logger.debug(
        `Marking incident ${incident.id} as Skipped for subscriber notifications.`,
      );
      await IncidentService.updateOneById({
        id: incident.id!,
        data: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            "Notifications skipped as subscribers are not to be notified for this incident.",
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
      logger.debug(
        `Incident ${incident.id} marked as Skipped for subscriber notifications.`,
      );
    }

    // get all scheduled events of all the projects.
    const incidents: Array<Incident> = await IncidentService.findAllBy({
      query: {
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      select: {
        _id: true,
        title: true,
        description: true,
        projectId: true,
        isVisibleOnStatusPage: true,
        monitors: {
          _id: true,
        },
        incidentSeverity: {
          name: true,
        },
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      },
    });

    logger.debug(
      `Found ${incidents.length} incidents to notify subscribers for.`,
    );

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(
      `Database host resolved as ${host.toString()} with protocol ${httpProtocol.toString()}.`,
    );

    for (const incident of incidents) {
      try {
        logger.debug(
          `Processing incident ${incident.id} (project: ${incident.projectId}) for subscriber notifications.`,
        );
        const incidentId: ObjectID = incident.id!;
        const projectId: ObjectID = incident.projectId!;
        const incidentNumberDisplay: string =
          incident.incidentNumberWithPrefix ||
          "#" + (incident.incidentNumber?.toString() || " - ");
        const incidentFeedText: string = `📧 **Subscriber Incident Created Notification Sent for [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()})**:
      Notification sent to status page subscribers because this incident was created.`;

        if (!incident.monitors || incident.monitors.length === 0) {
          logger.debug(
            `Incident ${incident.id} has no monitors attached; marking subscriber notifications as Skipped.`,
          );

          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnIncidentCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "No monitors are attached to this incident. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          continue;
        }

        await IncidentService.updateOneById({
          id: incident.id!,
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Incident ${incident.id} status set to InProgress for subscriber notifications.`,
        );

        if (!incident.isVisibleOnStatusPage) {
          logger.debug(
            `Incident ${incident.id} is not visible on status page; skipping subscriber notifications.`,
          );
          continue; // Do not send notification to subscribers if incident is not visible on status page.
        }

        // get status page resources from monitors.

        const statusPageResources: Array<StatusPageResource> =
          await StatusPageResourceService.findAllBy({
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
          `Found ${statusPageResources.length} status page resources linked to incident ${incident.id}.`,
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
          `Incident ${incident.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for notifications.`,
        );

        const statusPages: Array<StatusPage> =
          await StatusPageSubscriberService.getStatusPagesToSendNotification(
            Object.keys(statusPageToResources).map((i: string) => {
              return new ObjectID(i);
            }),
          );

        logger.debug(
          `Loaded ${statusPages.length} status page(s) for incident ${incident.id}.`,
        );

        for (const statuspage of statusPages) {
          try {
            if (!statuspage.id) {
              logger.debug(
                "Encountered a status page without an id; skipping.",
              );
              continue;
            }

            if (!statuspage.showIncidentsOnStatusPage) {
              logger.debug(
                `Status page ${statuspage.id} is configured to hide incidents; skipping notifications.`,
              );
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
              `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s).`,
            );

            // Send email to Email subscribers.

            const resourcesAffectedString: string =
              StatusPageResourceUtil.getResourcesGroupedByGroupName(
                statusPageToResources[statuspage._id!] || [],
              );

            logger.debug(
              `Resources affected for incident ${incident.id} on status page ${statuspage.id}: ${resourcesAffectedString}`,
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
                    StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.Email,
                },
              ),
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.SMS,
                },
              ),
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.Slack,
                },
              ),
              StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                },
              ),
            ]);

            // Prepare template variables for custom templates
            const templateVariables: Record<string, string> = {
              statusPageName: statusPageName,
              statusPageUrl: statusPageURL,
              detailsUrl: incidentDetailsUrl,
              resourcesAffected: resourcesAffectedString,
              incidentSeverity: incident.incidentSeverity?.name || " - ",
              incidentTitle: incident.title || "",
              incidentDescription: incident.description || "",
            };

            // Prepare SMS-specific template variables with plain text (no HTML/Markdown)
            const smsTemplateVariables: Record<string, string> = {
              ...templateVariables,
              incidentDescription: Markdown.convertToPlainText(
                incident.description || "",
              ),
            };

            for (const subscriber of subscribers) {
              try {
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
                    `Skipping subscriber ${subscriber._id} based on preferences or filters.`,
                  );
                  continue;
                }

                const unsubscribeUrl: string =
                  StatusPageSubscriberService.getUnsubscribeLink(
                    URL.fromString(statusPageURL),
                    subscriber.id!,
                  ).toString();

                logger.debug(
                  `Prepared unsubscribe link for subscriber ${subscriber._id}.`,
                );

                // Add unsubscribeUrl to template variables
                const subscriberTemplateVariables: Record<string, string> = {
                  ...templateVariables,
                  unsubscribeUrl: unsubscribeUrl,
                };

                if (subscriber.subscriberEmail) {
                  // send email here.
                  logger.debug(
                    `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail}.`,
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
                      : "[Incident] " + incident.title || "";

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
                        mailServer: ProjectSMTPConfigService.toEmailServer(
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
                          EmailTemplateType.SubscriberIncidentCreated,
                        vars: {
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
                          incidentDescription: await Markdown.convertToHTML(
                            incident.description || "",
                            MarkdownContentType.Email,
                          ),
                          unsubscribeUrl: unsubscribeUrl,

                          subscriberEmailNotificationFooterText:
                            StatusPageServiceType.getSubscriberEmailFooterText(
                              statuspage,
                            ),
                        },
                        subject: "[Incident] " + incident.title || "",
                      },
                      {
                        mailServer: ProjectSMTPConfigService.toEmailServer(
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
                    `Email notification queued for subscriber ${subscriber._id}.`,
                  );
                }

                if (subscriber.subscriberPhone) {
                  const phoneStr: string =
                    subscriber.subscriberPhone.toString();
                  const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
                  logger.debug(
                    `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked}.`,
                  );

                  // SMS-specific template variables with unsubscribe URL
                  const subscriberSmsTemplateVariables: Record<string, string> =
                    {
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
                    smsMessage = `Incident ${incident.title || ""} (${incident.incidentSeverity?.name || "-"}) on ${statusPageName}. Impact: ${resourcesAffectedString}. Details: ${incidentDetailsUrl}. Unsub: ${unsubscribeUrl}`;
                  }

                  const sms: SMS = {
                    message: smsMessage,
                    to: subscriber.subscriberPhone,
                  };

                  // send sms here.
                  SmsService.sendSms(sms, {
                    projectId: statuspage.projectId,
                    customTwilioConfig:
                      ProjectCallSMSConfigService.toTwilioConfig(
                        statuspage.callSmsConfig,
                      ),
                    statusPageId: statuspage.id!,
                    incidentId: incident.id!,
                  }).catch((err: Error) => {
                    logger.error(err);
                  });
                  logger.debug(
                    `SMS notification queued for subscriber ${subscriber._id}.`,
                  );
                }

                if (subscriber.slackIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Slack notification to subscriber ${subscriber._id} via incoming webhook.`,
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
                    markdownMessage = `## 🚨 Incident - ${incident.title || ""}

**Severity:** ${incident.incidentSeverity?.name || " - "}

**Resources Affected:** ${resourcesAffectedString}

**Description:** ${incident.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  // send Slack notification with markdown conversion
                  SlackUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.slackIncomingWebhookUrl,
                    text: SlackUtil.convertMarkdownToSlackRichText(
                      markdownMessage,
                    ),
                  }).catch((err: Error) => {
                    logger.error(err);
                  });
                  logger.debug(
                    `Slack notification queued for subscriber ${subscriber._id}.`,
                  );
                }

                if (subscriber.microsoftTeamsIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook.`,
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
                    markdownMessage = `## 🚨 Incident - ${incident.title || ""}
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Resources Affected:** ${resourcesAffectedString}
**Description:** ${incident.description || ""}
[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  // send Teams notification
                  MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.microsoftTeamsIncomingWebhookUrl,
                    text: markdownMessage,
                  }).catch((err: Error) => {
                    logger.error(err);
                  });
                  logger.debug(
                    `Microsoft Teams notification queued for subscriber ${subscriber._id}.`,
                  );
                }
              } catch (err) {
                logger.error(err);
              }
            }
          } catch (err) {
            logger.error(err);
          }
        }

        logger.debug("Creating incident feed for subscriber notification");

        await IncidentFeedService.createIncidentFeedItem({
          incidentId: incident.id!,
          projectId: incident.projectId!,
          incidentFeedEventType:
            IncidentFeedEventType.SubscriberNotificationSent,
          displayColor: Blue500,
          feedInfoInMarkdown: incidentFeedText,
          workspaceNotification: {
            sendWorkspaceNotification: false,
          },
        });

        logger.debug("Incident Feed created");

        // If we get here, the notification was successful
        await IncidentService.updateOneById({
          id: incident.id!,
          data: {
            subscriberNotificationStatusOnIncidentCreated:
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
          `Incident ${incident.id} marked as Success for subscriber notifications.`,
        );
      } catch (err) {
        // If there was an error, mark as failed
        logger.error(err);
        IncidentService.updateOneById({
          id: incident.id!,
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Failed,
            subscriberNotificationStatusMessage:
              err instanceof Error ? err.message : String(err),
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        }).catch((error: Error) => {
          logger.error(
            `Failed to update incident ${incident.id} status after error: ${error.message}`,
          );
        });
      }
    }
  },
);
