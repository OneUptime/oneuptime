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
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentCreatedRenotify from "Common/Types/StatusPage/IncidentCreatedRenotify";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
} from "Common/Server/Utils/StatusPage/IncidentStatusPageScope";
import SubscriberNotificationDeliveryRecord, {
  StatusPageDeliverySkipReason,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import IncidentScopeAddedPagesNotification from "Common/Types/StatusPage/IncidentScopeAddedPagesNotification";

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
        // The status pages already sent this notification, which it skips.
        statusPagesNotifiedOnCreation: true,
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

        /*
         * A hidden incident is settled as Skipped, never left InProgress.
         * The cron only picks up Pending rows, so an InProgress row is never
         * looked at again: the incident's 'created' notification used to sit
         * there forever, and publishing the incident later could not send it.
         * Skipped is what lets the dashboard offer to notify subscribers when
         * 'Visible on Status Page' is turned on (see IncidentCreatedRenotify),
         * which puts the row back to Pending; the reason is what the
         * notification badge shows.
         */
        if (!incident.isVisibleOnStatusPage) {
          logger.debug(
            `Incident ${incident.id} is not visible on status page; marking subscriber notifications as Skipped.`,
          );

          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnIncidentCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          continue; // Do not send notification to subscribers if incident is not visible on status page.
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

        /*
         * The status pages this incident reaches - through its monitors,
         * narrowed to the pages it is limited to, and without the pages that
         * only show incidents limited to them when it is not - in name order.
         */
        const resolvedStatusPages: ResolvedIncidentStatusPages =
          await IncidentStatusPageScope.resolvePagesForIncidents({
            incidents: [incident],
          });

        const statusPageToResources: Dictionary<Array<StatusPageResource>> =
          resolvedStatusPages.statusPageToResources;
        const statusPages: Array<StatusPage> = resolvedStatusPages.statusPages;

        logger.debug(
          `Incident ${incident.id} reaches ${statusPages.length} status page(s) for notifications; ${resolvedStatusPages.excludedStatusPages.length} left out by its status page scope.`,
        );

        /*
         * The pages already told about this incident. Adding pages to an
         * incident's scope puts this notification back to Pending (see
         * IncidentScopeAddedPagesNotification); this record is what keeps the
         * pages that already heard from hearing it twice. Each page is added
         * once it has been sent, so a run that stops part-way resumes where
         * it stopped.
         */
        const alreadyNotifiedStatusPageIds: Array<string> =
          IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
            incident.statusPagesNotifiedOnCreation,
          );
        const notifiedStatusPageIds: Array<string> = [
          ...alreadyNotifiedStatusPageIds,
        ];

        const deliveryRecord: SubscriberNotificationDeliveryRecord =
          new SubscriberNotificationDeliveryRecord({
            dedupeEmailAndSms: resolvedStatusPages.isScoped,
          });

        deliveryRecord.addExcludedStatusPages(
          resolvedStatusPages.excludedStatusPages,
        );

        /*
         * Pre-compute markdown conversions for incident.description once per
         * incident. These values do not vary per status page or per subscriber,
         * so memoizing here avoids N redundant markdown parses during fan-out.
         * For a status page with 100k subscribers, this turns 100k markdown
         * parses into 1.
         */
        const incidentDescriptionHtml: string = await Markdown.convertToHTML(
          incident.description || "",
          MarkdownContentType.Email,
        );
        const incidentDescriptionPlainText: string =
          Markdown.convertToPlainText(incident.description || "");

        let notificationSentToAtLeastOneSubscriber: boolean = false;

        for (const statuspage of statusPages) {
          try {
            if (!statuspage.id) {
              logger.debug(
                "Encountered a status page without an id; skipping.",
              );
              continue;
            }

            if (
              alreadyNotifiedStatusPageIds.includes(
                statuspage.id.toString().toLowerCase(),
              )
            ) {
              logger.debug(
                `Status page ${statuspage.id} was already sent the incident created notification for incident ${incident.id}; skipping.`,
              );
              deliveryRecord.skipStatusPage(
                statuspage,
                StatusPageDeliverySkipReason.AlreadyNotified,
              );
              continue;
            }

            if (!statuspage.showIncidentsOnStatusPage) {
              logger.debug(
                `Status page ${statuspage.id} is configured to hide incidents; skipping notifications.`,
              );
              /*
               * Not recorded as told: if the page starts showing incidents,
               * a later send for added pages still reaches it.
               */
              deliveryRecord.skipStatusPage(
                statuspage,
                StatusPageDeliverySkipReason.HidesIncidents,
              );
              continue; // Do not send notification to subscribers if incidents are not visible on status page.
            }

            deliveryRecord.startStatusPage(statuspage);

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
            const resourcesAffectedPlainText: string =
              StatusPageResourceUtil.getResourcesGroupedByGroupNameAsPlainText(
                statusPageToResources[statuspage._id!] || [],
              );

            logger.debug(
              `Resources affected for incident ${incident.id} on status page ${statuspage.id}: ${resourcesAffectedString}`,
            );

            // Fetch custom templates for this status page (if any)
            const [
              emailTemplate,
              smsTemplate,
              slackTemplate,
              teamsTemplate,
            ]: Array<StatusPageSubscriberNotificationTemplate | null> =
              await Promise.all([
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

            /*
             * Custom templates get each value in the format their channel
             * renders: HTML for the email body (it is wrapped only by
             * BlankTemplate), plain text for SMS and the email subject, and
             * Markdown for Slack and Teams. The conversions are the memoized
             * ones computed once per incident above.
             */
            const templateVariables: Record<string, string> = {
              statusPageName: statusPageName,
              statusPageUrl: statusPageURL,
              detailsUrl: incidentDetailsUrl,
              incidentSeverity: incident.incidentSeverity?.name || " - ",
              incidentTitle: incident.title || "",
            };

            const emailBodyTemplateVariables: Record<string, string> = {
              ...templateVariables,
              resourcesAffected: resourcesAffectedString,
              incidentDescription: incidentDescriptionHtml,
            };

            const plainTextTemplateVariables: Record<string, string> = {
              ...templateVariables,
              resourcesAffected: resourcesAffectedPlainText,
              incidentDescription: incidentDescriptionPlainText,
            };

            const markdownTemplateVariables: Record<string, string> = {
              ...templateVariables,
              resourcesAffected: resourcesAffectedPlainText,
              incidentDescription: incident.description || "",
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

                notificationSentToAtLeastOneSubscriber = true;

                const unsubscribeUrl: string =
                  StatusPageSubscriberService.getUnsubscribeLink(
                    URL.fromString(statusPageURL),
                    subscriber.id!,
                  ).toString();

                logger.debug(
                  `Prepared unsubscribe link for subscriber ${subscriber._id}.`,
                );

                // Add unsubscribeUrl to template variables
                const subscriberEmailBodyTemplateVariables: Dictionary<string> =
                  {
                    ...emailBodyTemplateVariables,
                    unsubscribeUrl: unsubscribeUrl,
                  };
                const subscriberPlainTextTemplateVariables: Dictionary<string> =
                  {
                    ...plainTextTemplateVariables,
                    unsubscribeUrl: unsubscribeUrl,
                  };
                const subscriberMarkdownTemplateVariables: Dictionary<string> =
                  {
                    ...markdownTemplateVariables,
                    unsubscribeUrl: unsubscribeUrl,
                  };

                /*
                 * An email address or phone number already sent this in this
                 * send, through an earlier page, is not sent it again (only
                 * for a scoped incident; see
                 * SubscriberNotificationDeliveryRecord).
                 */
                if (
                  subscriber.subscriberEmail &&
                  deliveryRecord.shouldSendEmail({
                    statusPage: statuspage,
                    email: subscriber.subscriberEmail,
                  })
                ) {
                  // send email here.
                  logger.debug(
                    `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail}.`,
                  );

                  if (emailTemplate?.templateBody && statuspage.smtpConfig) {
                    // Use custom template with BlankTemplate only when custom SMTP is configured
                    const compiledBody: string =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                        emailTemplate.templateBody,
                        subscriberEmailBodyTemplateVariables,
                      );
                    const compiledSubject: string = emailTemplate.emailSubject
                      ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          emailTemplate.emailSubject,
                          subscriberPlainTextTemplateVariables,
                        )
                      : "[Incident] " + incident.title || "";

                    deliveryRecord.recordQueued({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Email,
                      subject: compiledSubject,
                    });

                    MailService.sendMail(
                      {
                        toEmail: subscriber.subscriberEmail,
                        templateType: EmailTemplateType.BlankTemplate,
                        vars: {
                          body: compiledBody,
                        },
                        subject: compiledSubject,
                        isSubjectLiteral: true,
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
                      /*
                       * Delivery to a channel the SUBSCRIBER chose: their mailbox, their
                       * phone, their Slack/Teams webhook, their HTTP endpoint. A bounce, a
                       * 404 on a deleted webhook or an unreachable host is their side of the
                       * wire, not a OneUptime defect — and one status page can fan out to
                       * thousands of subscribers, so leaving these at ERROR buries real
                       * failures under a single tenant's dead webhook.
                       */
                      logger.error(err, EXTERNAL_FAULT);
                    });
                  } else {
                    deliveryRecord.recordQueued({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Email,
                      subject: "[Incident] " + incident.title || "",
                    });

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
                          incidentDescription: incidentDescriptionHtml,
                          unsubscribeUrl: unsubscribeUrl,

                          subscriberEmailNotificationFooterText:
                            StatusPageServiceType.getSubscriberEmailFooterText(
                              statuspage,
                            ),
                        },
                        subject: "[Incident] " + incident.title || "",
                        isSubjectLiteral: true,
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
                      logger.error(err, EXTERNAL_FAULT);
                    });
                  }
                  logger.debug(
                    `Email notification queued for subscriber ${subscriber._id}.`,
                  );
                }

                if (
                  subscriber.subscriberPhone &&
                  deliveryRecord.shouldSendSms({
                    statusPage: statuspage,
                    phone: subscriber.subscriberPhone,
                  })
                ) {
                  const phoneStr: string =
                    subscriber.subscriberPhone.toString();
                  const phoneMasked: string = `${phoneStr.slice(0, 2)}******${phoneStr.slice(-2)}`;
                  logger.debug(
                    `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked}.`,
                  );

                  let smsMessage: string;
                  if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
                    // Use custom template only when custom Twilio is configured
                    smsMessage =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                        smsTemplate.templateBody,
                        subscriberPlainTextTemplateVariables,
                      );
                  } else {
                    // Use default hard-coded template
                    smsMessage = `Incident ${incident.title || ""} (${incident.incidentSeverity?.name || "-"}) on ${statusPageName}. Impact: ${resourcesAffectedString}. Details: ${incidentDetailsUrl}. Unsub: ${unsubscribeUrl}`;
                  }

                  const sms: SMS = {
                    message: smsMessage,
                    to: subscriber.subscriberPhone,
                  };

                  deliveryRecord.recordQueued({
                    statusPage: statuspage,
                    method: StatusPageSubscriberNotificationMethod.SMS,
                  });

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
                    logger.error(err, EXTERNAL_FAULT);
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
                        subscriberMarkdownTemplateVariables,
                      );
                  } else {
                    // Use default hard-coded template
                    markdownMessage = `## 🚨 Incident - ${incident.title || ""}

**Severity:** ${incident.incidentSeverity?.name || " - "}

**Resources Affected:** ${resourcesAffectedString}

**Description:** ${incident.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  deliveryRecord.recordQueued({
                    statusPage: statuspage,
                    method: StatusPageSubscriberNotificationMethod.Slack,
                  });

                  // send Slack notification with markdown conversion
                  SlackUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.slackIncomingWebhookUrl,
                    text: SlackUtil.convertMarkdownToSlackRichText(
                      markdownMessage,
                    ),
                  }).catch((err: Error) => {
                    logger.error(err, EXTERNAL_FAULT);
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
                        subscriberMarkdownTemplateVariables,
                      );
                  } else {
                    // Use default hard-coded template
                    markdownMessage = `## 🚨 Incident - ${incident.title || ""}
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Resources Affected:** ${resourcesAffectedString}
**Description:** ${incident.description || ""}
[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                  }

                  deliveryRecord.recordQueued({
                    statusPage: statuspage,
                    method:
                      StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                  });

                  // send Teams notification
                  MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.microsoftTeamsIncomingWebhookUrl,
                    text: markdownMessage,
                  }).catch((err: Error) => {
                    logger.error(err, EXTERNAL_FAULT);
                  });
                  logger.debug(
                    `Microsoft Teams notification queued for subscriber ${subscriber._id}.`,
                  );
                }

                if (subscriber.subscriberWebhook) {
                  logger.debug(
                    `Queueing webhook notification to subscriber ${subscriber._id}.`,
                  );

                  deliveryRecord.recordQueued({
                    statusPage: statuspage,
                    method: StatusPageSubscriberNotificationMethod.Webhook,
                  });

                  StatusPageSubscriberWebhookUtil.sendWebhookNotification({
                    webhookUrl: subscriber.subscriberWebhook,
                    payload: {
                      eventType: "IncidentCreated",
                      statusPageId: statuspage.id!.toString(),
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      unsubscribeUrl: unsubscribeUrl,
                      data: {
                        incidentId: incident.id?.toString() || "",
                        incidentNumber:
                          incident.incidentNumber?.toString() || "",
                        incidentTitle: incident.title || "",
                        incidentDescription: incident.description || "",
                        incidentSeverity: incident.incidentSeverity?.name || "",
                        resourcesAffected: resourcesAffectedPlainText,
                        detailsUrl: incidentDetailsUrl,
                      },
                    },
                  }).catch((err: Error) => {
                    logger.error(err, EXTERNAL_FAULT);
                  });
                  logger.debug(
                    `Webhook notification queued for subscriber ${subscriber._id}.`,
                  );
                }
              } catch (err) {
                logger.error(err);
              }
            }

            /*
             * Every subscriber of this page has been looked at, so the page
             * has been told. It is recorded straight away, so a run that
             * stops part-way does not tell it again when it resumes.
             */
            notifiedStatusPageIds.push(statuspage.id.toString().toLowerCase());

            await IncidentService.updateOneById({
              id: incident.id!,
              data: {
                statusPagesNotifiedOnCreation: [...notifiedStatusPageIds],
              },
              props: {
                isRoot: true,
                ignoreHooks: true,
              },
            }).catch((err: Error) => {
              // The record is written again in full when the send finishes.
              logger.error(
                `Failed to record status page ${statuspage.id} as notified for incident ${incident.id}: ${err.message}`,
              );
            });
          } catch (err) {
            logger.error(err);
            deliveryRecord.skipStatusPage(
              statuspage,
              StatusPageDeliverySkipReason.Failed,
            );
          }
        }

        const deliveryMarkdown: string = deliveryRecord.toMarkdown();

        if (notificationSentToAtLeastOneSubscriber) {
          logger.debug("Creating incident feed for subscriber notification");

          await IncidentFeedService.createIncidentFeedItem({
            incidentId: incident.id!,
            projectId: incident.projectId!,
            incidentFeedEventType:
              IncidentFeedEventType.SubscriberNotificationSent,
            displayColor: Blue500,
            feedInfoInMarkdown: incidentFeedText,
            // Each status page, the subject its email went out with, and what was queued.
            moreInformationInMarkdown: deliveryMarkdown || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: false,
            },
          });

          logger.debug("Incident Feed created");
        } else {
          logger.debug(
            `No subscribers were notified for incident created: ${incident.id}. All status pages either hide incidents, are left out by its status page scope, were already notified or had no matching subscribers.`,
          );

          await IncidentFeedService.createIncidentFeedItem({
            incidentId: incident.id!,
            projectId: incident.projectId!,
            incidentFeedEventType:
              IncidentFeedEventType.SubscriberNotificationSent,
            displayColor: Yellow500,
            feedInfoInMarkdown: `📧 **No notification sent to subscribers** for the creation of [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}).`,
            moreInformationInMarkdown: [
              "Subscriber notifications were skipped because every associated status page either hides incidents, is left out by this incident's status page scope, was already sent this notification, or had no matching subscribers.",
              deliveryMarkdown,
            ]
              .filter(Boolean)
              .join("\n\n"),
            workspaceNotification: {
              sendWorkspaceNotification: false,
            },
          });
        }

        // If we get here, the notification was successful
        await IncidentService.updateOneById({
          id: incident.id!,
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Success,
            subscriberNotificationStatusMessage:
              "Notifications sent successfully to all subscribers",
            /*
             * Written in full even when no page was told, so a record that
             * is still empty (null) means the send never ran.
             */
            statusPagesNotifiedOnCreation: [...notifiedStatusPageIds],
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
