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
import Text from "Common/Types/Text";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
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
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
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
  "IncidentStateTimeline:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const incidentStateTimelines: Array<IncidentStateTimeline> =
      await IncidentStateTimelineService.findBy({
        query: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotified: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          incidentStateId: true,
          incidentState: {
            name: true,
            isCreatedState: true,
          },
        },
      });

    logger.debug(
      `Found ${incidentStateTimelines.length} incident state timeline(s) to notify subscribers for.`,
    );

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const incidentStateTimeline of incidentStateTimelines) {
      logger.debug(
        `Processing incident state timeline ${incidentStateTimeline.id}.`,
      );
      // Set to InProgress at the start of processing
      await IncidentStateTimelineService.updateOneById({
        id: incidentStateTimeline.id!,
        data: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.InProgress,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (
        !incidentStateTimeline.incidentId ||
        !incidentStateTimeline.incidentStateId
      ) {
        await IncidentStateTimelineService.updateOneById({
          id: incidentStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "Missing incident or incident state reference. Skipping notifications.",
          },
          props: { isRoot: true, ignoreHooks: true },
        });
        continue;
      }

      if (!incidentStateTimeline.incidentState?.name) {
        await IncidentStateTimelineService.updateOneById({
          id: incidentStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "Incident state has no name. Skipping notifications.",
          },
          props: { isRoot: true, ignoreHooks: true },
        });
        continue;
      }

      if (incidentStateTimeline.incidentState.isCreatedState) {
        await IncidentStateTimelineService.updateOneById({
          id: incidentStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "Notification already sent when the incident was created. So, incident state change notifiction is skipped.",
          },
          props: { isRoot: true, ignoreHooks: true },
        });
        continue;
      }

      // get all scheduled events of all the projects.
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentStateTimeline.incidentId!,
        props: {
          isRoot: true,
        },

        select: {
          _id: true,
          title: true,
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
          `Incident ${incidentStateTimeline.incidentId} not found; marking as Skipped.`,
        );
        await IncidentStateTimelineService.updateOneById({
          id: incidentStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "Related incident not found. Skipping notifications.",
          },
          props: { isRoot: true, ignoreHooks: true },
        });
        continue;
      }

      if (!incident.monitors || incident.monitors.length === 0) {
        logger.debug(
          `Incident ${incident.id} has no monitors; marking timeline ${incidentStateTimeline.id} as Skipped.`,
        );
        await IncidentStateTimelineService.updateOneById({
          id: incidentStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "No monitors are attached to the related incident. Skipping notifications.",
          },
          props: { isRoot: true, ignoreHooks: true },
        });
        continue;
      }

      if (!incident.isVisibleOnStatusPage) {
        logger.debug(
          `Incident ${incident.id} not visible on status page; marking as Skipped.`,
        );
        await IncidentStateTimelineService.updateOneById({
          id: incidentStateTimeline.id!,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "Incident is not visible on status page. Skipping notifications.",
          },
          props: { isRoot: true, ignoreHooks: true },
        });
        continue; // skip if not visible on status page.
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
        `Incident ${incident.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for state timeline notification.`,
      );

      const statusPages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification(
          Object.keys(statusPageToResources).map((i: string) => {
            return new ObjectID(i);
          }),
        );

      for (const statuspage of statusPages) {
        if (!statuspage.id) {
          logger.debug("Encountered a status page without an id; skipping.");
          continue;
        }

        if (!statuspage.showIncidentsOnStatusPage) {
          logger.debug(
            `Status page ${statuspage.id} hides incidents; skipping.`,
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

        const statusPageURL: string = await StatusPageService.getStatusPageURL(
          statuspage.id,
        );
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
          `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for incident state timeline ${incidentStateTimeline.id}.`,
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
                StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
              notificationMethod: StatusPageSubscriberNotificationMethod.Email,
            },
          ),
          StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
            {
              statusPageId: statuspage.id!,
              eventType:
                StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
              notificationMethod: StatusPageSubscriberNotificationMethod.SMS,
            },
          ),
          StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
            {
              statusPageId: statuspage.id!,
              eventType:
                StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
              notificationMethod: StatusPageSubscriberNotificationMethod.Slack,
            },
          ),
          StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
            {
              statusPageId: statuspage.id!,
              eventType:
                StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
              notificationMethod:
                StatusPageSubscriberNotificationMethod.MicrosoftTeams,
            },
          ),
        ]);

        // Send email to Email subscribers.

        for (const subscriber of subscribers) {
          if (!subscriber._id) {
            logger.debug("Encountered a subscriber without an _id; skipping.");
            continue;
          }

          const shouldNotifySubscriber: boolean =
            StatusPageSubscriberService.shouldSendNotification({
              subscriber: subscriber,
              statusPageResources: statusPageToResources[statuspage._id!] || [],
              statusPage: statuspage,
              eventType: StatusPageEventType.Incident,
            });

          if (!shouldNotifySubscriber) {
            logger.debug(
              `Skipping subscriber ${subscriber._id} based on preferences for state timeline ${incidentStateTimeline.id}.`,
            );
            continue;
          }

          const unsubscribeUrl: string =
            StatusPageSubscriberService.getUnsubscribeLink(
              URL.fromString(statusPageURL),
              subscriber.id!,
            ).toString();

          const resourcesAffected: string =
            StatusPageResourceUtil.getResourcesGroupedByGroupName(
              statusPageToResources[statuspage._id!] || [],
              "", // Use empty string as default for backward compatibility
            );

          // Prepare template variables for custom templates
          const templateVariables: Record<string, string> = {
            statusPageName: statusPageName,
            statusPageUrl: statusPageURL,
            detailsUrl: incidentDetailsUrl,
            resourcesAffected: resourcesAffected || "None",
            incidentSeverity: incident.incidentSeverity?.name || " - ",
            incidentTitle: incident.title || "",
            incidentState: incidentStateTimeline.incidentState.name,
            unsubscribeUrl: unsubscribeUrl,
          };

          if (subscriber.subscriberPhone) {
            const phoneStr: string = subscriber.subscriberPhone.toString();
            const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
            logger.debug(
              `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for incident state timeline ${incidentStateTimeline.id}.`,
            );

            let smsMessage: string;
            if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
              // Use custom template only when custom Twilio is configured
              smsMessage =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  smsTemplate.templateBody,
                  templateVariables,
                );
            } else {
              // Use default hard-coded template
              smsMessage = `Incident ${incident.title || ""} on ${statusPageName} is ${Text.uppercaseFirstLetter(incidentStateTimeline.incidentState.name)}. Details: ${incidentDetailsUrl}. Unsub: ${unsubscribeUrl}`;
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

          let emailTitle: string = `Incident `;

          if (resourcesAffected) {
            emailTitle += `on ${resourcesAffected} `;
          }

          emailTitle += `is ${incidentStateTimeline.incidentState.name}`;

          if (subscriber.subscriberEmail) {
            // send email here.
            logger.debug(
              `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for incident state timeline ${incidentStateTimeline.id}.`,
            );

            if (emailTemplate?.templateBody && statuspage.smtpConfig) {
              // Use custom template with BlankTemplate only when custom SMTP is configured
              const compiledBody: string =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  emailTemplate.templateBody,
                  templateVariables,
                );
              const compiledSubject: string = emailTemplate.emailSubject
                ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    emailTemplate.emailSubject,
                    templateVariables,
                  )
                : `[Incident ${Text.uppercaseFirstLetter(incidentStateTimeline.incidentState.name)}] ${incident.title}`;

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
                    EmailTemplateType.SubscriberIncidentStateChanged,
                  vars: {
                    emailTitle: emailTitle,
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
                    resourcesAffected: resourcesAffected || "None",
                    incidentSeverity: incident.incidentSeverity?.name || " - ",
                    incidentTitle: incident.title || "",

                    incidentState: incidentStateTimeline.incidentState.name,
                    unsubscribeUrl: unsubscribeUrl,
                    subscriberEmailNotificationFooterText:
                      StatusPageServiceType.getSubscriberEmailFooterText(
                        statuspage,
                      ),
                  },
                  subject: `[Incident ${Text.uppercaseFirstLetter(
                    incidentStateTimeline.incidentState.name,
                  )}] ${incident.title}`,
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
          }

          if (subscriber.slackIncomingWebhookUrl) {
            let slackTitle: string;
            if (slackTemplate?.templateBody) {
              // Use custom template
              slackTitle =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  slackTemplate.templateBody,
                  templateVariables,
                );
            } else {
              // Use default hard-coded template
              slackTitle = `🚨 ## Incident - ${incident.title || " - "}

`;

              if (resourcesAffected) {
                slackTitle += `
**Resources Affected:** ${resourcesAffected}`;
              }

              slackTitle += `
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Status:** ${incidentStateTimeline.incidentState.name}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
            }

            SlackUtil.sendMessageToChannelViaIncomingWebhook({
              url: subscriber.slackIncomingWebhookUrl,
              text: SlackUtil.convertMarkdownToSlackRichText(slackTitle),
            }).catch((err: Error) => {
              logger.error(err);
            });
            logger.debug(
              `Slack notification queued for subscriber ${subscriber._id} for incident state timeline ${incidentStateTimeline.id}.`,
            );
          }

          if (subscriber.microsoftTeamsIncomingWebhookUrl) {
            let teamsTitle: string;
            if (teamsTemplate?.templateBody) {
              // Use custom template
              teamsTitle =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  teamsTemplate.templateBody,
                  templateVariables,
                );
            } else {
              // Use default hard-coded template
              teamsTitle = `🚨 ## Incident - ${incident.title || " - "}

`;

              if (resourcesAffected) {
                teamsTitle += `
**Resources Affected:** ${resourcesAffected}`;
              }

              teamsTitle += `
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Status:** ${incidentStateTimeline.incidentState.name}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
            }

            MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
              url: subscriber.microsoftTeamsIncomingWebhookUrl,
              text: teamsTitle,
            }).catch((err: Error) => {
              logger.error(err);
            });
            logger.debug(
              `Microsoft Teams notification queued for subscriber ${subscriber._id} for incident state timeline ${incidentStateTimeline.id}.`,
            );
          }
        }
      }

      logger.debug(
        "Notification sent to subscribers for incident state change",
      );

      const incidentNumberDisplay: string =
        incident.incidentNumberWithPrefix || '#' + (incident.incidentNumber?.toString() || " - ");
      const projectId: ObjectID = incident.projectId!;
      const incidentId: ObjectID = incident.id!;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.SubscriberNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `📧 **Status Page Subscribers have been notified** about the state change of the [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}) to **${incidentStateTimeline.incidentState.name}**`,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });

      logger.debug("Incident Feed created");

      // Mark Success at the end
      await IncidentStateTimelineService.updateOneById({
        id: incidentStateTimeline.id!,
        data: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Success,
          subscriberNotificationStatusMessage:
            "Notifications sent successfully to all subscribers",
        },
        props: { isRoot: true, ignoreHooks: true },
      });
    }
  },
);
