import RunCron from "../../Utils/Cron";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
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
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
  SubscriberNotificationEmailBodyTemplateVariables,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import IncidentTemplateVariableBuilder, {
  IncidentStatusPageTemplateVariables,
  IncidentTemplateVariables,
} from "Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder";
import { JSONObject } from "Common/Types/JSON";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
} from "Common/Server/Utils/StatusPage/IncidentStatusPageScope";
import SubscriberNotificationDeliveryRecord, {
  StatusPageDeliverySkipReason,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";

RunCron(
  "Incident:SendPostmortemNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const incidents: Array<Incident> = await IncidentService.findAllBy({
      query: {
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Pending,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      select: {
        showPostmortemOnStatusPage: true,
        notifySubscribersOnPostmortemPublished: true,
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
        postmortemNote: true,
        // {{incidentLabels}} and the custom fields (IncidentTemplateVariableBuilder).
        labels: {
          name: true,
        },
        customFields: true,
      },
    });

    logger.debug(
      `Found ${incidents.length} incidents to notify subscribers for postmortem.`,
    );

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(
      `Database host resolved as ${host.toString()} with protocol ${httpProtocol.toString()}.`,
    );

    for (const incident of incidents) {
      try {
        if (!incident.showPostmortemOnStatusPage) {
          logger.debug(
            `Incident ${incident.id} is not set to show postmortem on status page; marking as Skipped.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );
          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnPostmortemPublished:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessageOnPostmortemPublished:
                "Incident is not set to show postmortem on status page. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        if (!incident.notifySubscribersOnPostmortemPublished) {
          logger.debug(
            `Incident ${incident.id} is not set to notify subscribers on postmortem published; marking as Skipped.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );
          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnPostmortemPublished:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessageOnPostmortemPublished:
                "Incident is not set to notify subscribers on postmortem published. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        const incidentNumberDisplay: string =
          incident.incidentNumberWithPrefix ||
          "#" + (incident.incidentNumber?.toString() || " - ");
        const incidentFeedText: string = `📧 **Subscriber Incident Postmortem Notification Sent for [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()})**:
      Notification sent to status page subscribers because postmortem was published for this incident.`;

        if (!incident.monitors || incident.monitors.length === 0) {
          logger.debug(
            `Incident ${incident.id} has no monitors attached; marking subscriber notifications as Skipped.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );

          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnPostmortemPublished:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessageOnPostmortemPublished:
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
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });

        logger.debug(
          `Incident ${incident.id} status set to InProgress for subscriber postmortem notifications.`,
          {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          },
        );

        if (!incident.isVisibleOnStatusPage) {
          logger.debug(
            `Incident ${incident.id} is not visible on status page; skipping subscriber notifications.`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );

          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnPostmortemPublished:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessageOnPostmortemPublished:
                "Incident is not visible on status page. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          continue; // Do not send notification to subscribers if incident is not visible on status page.
        }

        /*
         * The status pages this incident reaches - through its monitors and
         * the monitor groups they are in, narrowed to the pages it is limited
         * to, and without the pages that only show incidents limited to them
         * when it is not - in name order. (This job used to look monitors up
         * directly and so missed pages that list a monitor group.)
         */
        const resolvedStatusPages: ResolvedIncidentStatusPages =
          await IncidentStatusPageScope.resolvePagesForIncidents({
            incidents: [incident],
          });

        const statusPageToResources: Dictionary<Array<StatusPageResource>> =
          resolvedStatusPages.statusPageToResources;
        const statusPages: Array<StatusPage> = resolvedStatusPages.statusPages;

        logger.debug(
          `Incident ${incident.id} reaches ${statusPages.length} status page(s) for postmortem notifications; ${resolvedStatusPages.excludedStatusPages.length} left out by its status page scope.`,
          {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          },
        );

        const deliveryRecord: SubscriberNotificationDeliveryRecord =
          new SubscriberNotificationDeliveryRecord({
            dedupeEmailAndSms: resolvedStatusPages.isScoped,
          });

        deliveryRecord.addExcludedStatusPages(
          resolvedStatusPages.excludedStatusPages,
        );

        /*
         * The values every message is filled with, read once per incident:
         * the postmortem note is converted once rather than once per
         * subscriber, and the incident's labels and custom fields are read
         * once. What varies per status page is added per page below.
         */
        const incidentTemplateVariables: IncidentTemplateVariables =
          await IncidentTemplateVariableBuilder.build({
            incident: incident,
            statusPages: statusPages,
            markdownVariables: {
              postmortemNote: incident.postmortemNote,
            },
          });
        const postmortemNoteHtml: string =
          incidentTemplateVariables.getMarkdownVariable("postmortemNote").html;

        for (const statuspage of statusPages) {
          try {
            if (!statuspage.id) {
              logger.debug(
                "Encountered a status page without an id; skipping.",
                {
                  projectId: incident.projectId?.toString(),
                  incidentId: incident.id?.toString(),
                },
              );
              continue;
            }

            if (!statuspage.showIncidentsOnStatusPage) {
              logger.debug(
                `Status page ${statuspage.id} is configured to hide incidents; skipping notifications.`,
                {
                  projectId: incident.projectId?.toString(),
                  incidentId: incident.id?.toString(),
                },
              );
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
                },
              );

            // Fetch custom notification templates for this status page
            const emailTemplate: StatusPageSubscriberNotificationTemplate | null =
              await StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.Email,
                },
              );

            const smsTemplate: StatusPageSubscriberNotificationTemplate | null =
              await StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.SMS,
                },
              );

            const slackTemplate: StatusPageSubscriberNotificationTemplate | null =
              await StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.Slack,
                },
              );

            const teamsTemplate: StatusPageSubscriberNotificationTemplate | null =
              await StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                {
                  statusPageId: statuspage.id!,
                  eventType:
                    StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished,
                  notificationMethod:
                    StatusPageSubscriberNotificationMethod.MicrosoftTeams,
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
              {
                projectId: incident.projectId?.toString(),
                incidentId: incident.id?.toString(),
              },
            );

            /*
             * Everything this page's messages are filled with, in the format
             * each channel renders (IncidentTemplateVariableBuilder). The
             * HTML resource list (escaped names, "<br/>" between groups) is
             * only for email bodies; SMS, Slack, Teams, subjects and webhooks
             * get the plain-text list.
             */
            const pageTemplateVariables: IncidentStatusPageTemplateVariables =
              incidentTemplateVariables.forStatusPage({
                statusPage: statuspage,
                statusPageUrl: statusPageURL,
                detailsUrl: incidentDetailsUrl,
                resources: statusPageToResources[statuspage._id!] || [],
              });
            const resourcesAffectedString: string =
              pageTemplateVariables.resourcesAffectedHtml;
            const resourcesAffectedPlainText: string =
              pageTemplateVariables.resourcesAffectedPlainText;

            /*
             * The fields marked "Include in Subscriber Notifications", for
             * the default Slack and Teams messages. The default SMS carries
             * none: it is billed by the segment.
             */
            const slackCustomFields: string =
              pageTemplateVariables.customFieldsMarkdownLines.length > 0
                ? `${pageTemplateVariables.customFieldsMarkdownLines.join("\n\n")}\n\n`
                : "";
            const teamsCustomFields: string =
              pageTemplateVariables.customFieldsMarkdownLines.length > 0
                ? `${pageTemplateVariables.customFieldsMarkdownLines.join("\n")}\n`
                : "";

            logger.debug(
              `Resources affected for incident ${incident.id} on status page ${statuspage.id}: ${resourcesAffectedPlainText}`,
              {
                projectId: incident.projectId?.toString(),
                incidentId: incident.id?.toString(),
              },
            );

            for (const subscriber of subscribers) {
              try {
                if (!subscriber._id) {
                  logger.debug(
                    "Encountered a subscriber without an _id; skipping.",
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
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
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
                  );
                  continue;
                }

                const unsubscribeUrl: string =
                  StatusPageSubscriberService.getUnsubscribeLink(
                    URL.fromString(statusPageURL),
                    subscriber,
                  ).toString();

                logger.debug(
                  `Prepared unsubscribe link for subscriber ${subscriber._id}.`,
                  {
                    projectId: incident.projectId?.toString(),
                    incidentId: incident.id?.toString(),
                  },
                );

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
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
                  );

                  /*
                   * The custom email body is HTML (it is wrapped only by
                   * BlankTemplate); the subject is plain text. The plain
                   * values are escaped in the body
                   * (compileEmailBodyTemplate), and only the values the
                   * builder wrapped in SafeHtml go into it as HTML.
                   */
                  const templateVars: SubscriberNotificationEmailBodyTemplateVariables =
                    {
                      ...pageTemplateVariables.emailBody,
                      unsubscribeUrl: unsubscribeUrl,
                    };
                  const subjectTemplateVars: Dictionary<string> = {
                    ...pageTemplateVariables.plainText,
                    unsubscribeUrl: unsubscribeUrl,
                  };

                  // Use custom template if available and custom SMTP is configured, otherwise use default
                  if (emailTemplate?.templateBody && statuspage.smtpConfig) {
                    const compiledBody: string =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate(
                        emailTemplate.templateBody,
                        templateVars,
                      );
                    const compiledSubject: string = emailTemplate.emailSubject
                      ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          emailTemplate.emailSubject,
                          subjectTemplateVars,
                        )
                      : "[Postmortem] " + incident.title || "";

                    deliveryRecord.recordQueued({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Email,
                      subject: compiledSubject,
                    });
                    await incidentTemplateVariables.recordFieldsUsedBy([
                      emailTemplate.templateBody,
                      emailTemplate.emailSubject,
                    ]);

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
                      logger.error(err, {
                        ...EXTERNAL_FAULT,
                        projectId: incident.projectId?.toString(),
                        incidentId: incident.id?.toString(),
                      });
                    });
                  } else {
                    deliveryRecord.recordQueued({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Email,
                      subject: "[Postmortem] " + incident.title || "",
                    });
                    await incidentTemplateVariables.recordIncludedFieldsSent();

                    MailService.sendMail(
                      {
                        toEmail: subscriber.subscriberEmail,
                        templateType:
                          EmailTemplateType.SubscriberIncidentPostmortemCreated,
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
                          postmortemNote: postmortemNoteHtml,
                          // The fields marked "Include in Subscriber Notifications".
                          customFieldRows:
                            pageTemplateVariables.customFieldRows as unknown as JSONObject,
                          unsubscribeUrl: unsubscribeUrl,

                          subscriberEmailNotificationFooterText:
                            StatusPageServiceType.getSubscriberEmailFooterText(
                              statuspage,
                            ),
                        },
                        subject: "[Postmortem] " + incident.title || "",
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
                      logger.error(err, {
                        ...EXTERNAL_FAULT,
                        projectId: incident.projectId?.toString(),
                        incidentId: incident.id?.toString(),
                      });
                    });
                  }
                  logger.debug(
                    `Email notification queued for subscriber ${subscriber._id}.`,
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
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
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
                  );

                  // Template variables for compilation, as plain text
                  const smsTemplateVars: Dictionary<string> = {
                    ...pageTemplateVariables.plainText,
                    unsubscribeUrl: unsubscribeUrl,
                  };

                  /*
                   * On a public status page the SMS keeps the shorter manage link,
                   * which works there without signing in: an SMS is billed by the
                   * segment (see StatusPageSubscriberUnsubscribe.buildSmsLink).
                   */
                  const smsUnsubscribeUrl: string =
                    StatusPageSubscriberUnsubscribe.buildSmsLink({
                      isPublicStatusPage: statuspage.isPublicStatusPage,
                      statusPageUrl: statusPageURL,
                      subscriberId: subscriber.id!,
                      unsubscribeUrl: unsubscribeUrl,
                    });

                  // Use custom template if available and custom Twilio is configured, otherwise use default
                  let smsMessage: string;
                  if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
                    smsMessage =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                        smsTemplate.templateBody,
                        {
                          ...smsTemplateVars,
                          unsubscribeUrl: smsUnsubscribeUrl,
                        },
                      );
                    await incidentTemplateVariables.recordFieldsUsedBy([
                      smsTemplate.templateBody,
                    ]);
                  } else {
                    smsMessage = `Postmortem: ${incident.title || ""} (${incident.incidentSeverity?.name || "-"}) on ${statusPageName}. Impact: ${resourcesAffectedPlainText}. Details: ${incidentDetailsUrl}. Unsub: ${smsUnsubscribeUrl}`;
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
                    logger.error(err, {
                      ...EXTERNAL_FAULT,
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    });
                  });
                  logger.debug(
                    `SMS notification queued for subscriber ${subscriber._id}.`,
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
                  );
                }

                if (subscriber.slackIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Slack notification to subscriber ${subscriber._id} via incoming webhook.`,
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
                  );

                  // Template variables for compilation, as Markdown
                  const slackTemplateVars: Dictionary<string> = {
                    ...pageTemplateVariables.markdown,
                    unsubscribeUrl: unsubscribeUrl,
                  };

                  // Use custom template if available, otherwise use default
                  let markdownMessage: string;
                  if (slackTemplate?.templateBody) {
                    markdownMessage =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                        slackTemplate.templateBody,
                        slackTemplateVars,
                      );
                    await incidentTemplateVariables.recordFieldsUsedBy([
                      slackTemplate.templateBody,
                    ]);
                  } else {
                    markdownMessage = `## 🚨 Incident Postmortem - ${incident.title || ""}

**Severity:** ${incident.incidentSeverity?.name || " - "}

**Resources Affected:** ${resourcesAffectedPlainText}

**Postmortem:** ${incident.postmortemNote || ""}

${slackCustomFields}[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                    await incidentTemplateVariables.recordIncludedFieldsSent();
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
                    logger.error(err, {
                      ...EXTERNAL_FAULT,
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    });
                  });
                  logger.debug(
                    `Slack notification queued for subscriber ${subscriber._id}.`,
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
                  );
                }

                if (subscriber.microsoftTeamsIncomingWebhookUrl) {
                  logger.debug(
                    `Queueing Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook.`,
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
                  );

                  // Template variables for compilation, as Markdown
                  const teamsTemplateVars: Dictionary<string> = {
                    ...pageTemplateVariables.markdown,
                    unsubscribeUrl: unsubscribeUrl,
                  };

                  // Use custom template if available, otherwise use default
                  let teamsMarkdownMessage: string;
                  if (teamsTemplate?.templateBody) {
                    teamsMarkdownMessage =
                      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                        teamsTemplate.templateBody,
                        teamsTemplateVars,
                      );
                    await incidentTemplateVariables.recordFieldsUsedBy([
                      teamsTemplate.templateBody,
                    ]);
                  } else {
                    teamsMarkdownMessage = `## 🚨 Incident Postmortem - ${incident.title || ""}
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Resources Affected:** ${resourcesAffectedPlainText}
**Postmortem:** ${incident.postmortemNote || ""}
${teamsCustomFields}[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                    await incidentTemplateVariables.recordIncludedFieldsSent();
                  }

                  deliveryRecord.recordQueued({
                    statusPage: statuspage,
                    method:
                      StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                  });

                  // send Teams notification
                  MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                    url: subscriber.microsoftTeamsIncomingWebhookUrl,
                    text: teamsMarkdownMessage,
                  }).catch((err: Error) => {
                    logger.error(err, {
                      ...EXTERNAL_FAULT,
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    });
                  });
                  logger.debug(
                    `Microsoft Teams notification queued for subscriber ${subscriber._id}.`,
                    {
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    },
                  );
                }

                if (subscriber.subscriberWebhook) {
                  deliveryRecord.recordQueued({
                    statusPage: statuspage,
                    method: StatusPageSubscriberNotificationMethod.Webhook,
                  });
                  await incidentTemplateVariables.recordIncludedFieldsSent();

                  StatusPageSubscriberWebhookUtil.sendWebhookNotification({
                    webhookUrl: subscriber.subscriberWebhook,
                    payload: {
                      eventType: "IncidentPostmortemPublished",
                      statusPageId: statuspage.id!.toString(),
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      unsubscribeUrl: unsubscribeUrl,
                      data: {
                        incidentId: incident.id?.toString() || "",
                        incidentNumber:
                          incident.incidentNumber?.toString() || "",
                        incidentTitle: incident.title || "",
                        incidentSeverity: incident.incidentSeverity?.name || "",
                        resourcesAffected: resourcesAffectedPlainText,
                        postmortemNote: incident.postmortemNote || "",
                        detailsUrl: incidentDetailsUrl,
                        // The fields marked "Include in Subscriber Notifications", by key.
                        customFields:
                          incidentTemplateVariables.getWebhookCustomFields(),
                      },
                    },
                  }).catch((err: Error) => {
                    logger.error(err, {
                      ...EXTERNAL_FAULT,
                      projectId: incident.projectId?.toString(),
                      incidentId: incident.id?.toString(),
                    });
                  });
                }
              } catch (err) {
                logger.error(err, {
                  projectId: incident.projectId?.toString(),
                  incidentId: incident.id?.toString(),
                });
              }
            }
          } catch (err) {
            logger.error(err, {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            });
            deliveryRecord.skipStatusPage(
              statuspage,
              StatusPageDeliverySkipReason.Failed,
            );
          }
        }

        logger.debug("Creating incident feed for subscriber notification", {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        });

        const deliveryMarkdown: string = deliveryRecord.toMarkdown();
        const queuedAny: boolean = deliveryRecord.hasQueuedAny();
        // The custom field values that went out, as they were sent.
        const customFieldsSentMarkdown: string =
          incidentTemplateVariables.getSentCustomFieldsMarkdown();

        /*
         * Each status page, the subject its email went out with, and what was
         * queued. When nothing was queued at all - every page hides
         * incidents, is left out by the incident's status page scope, or has
         * no matching subscriber - the item says so instead of claiming a
         * send.
         */
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: incident.id!,
          projectId: incident.projectId!,
          incidentFeedEventType:
            IncidentFeedEventType.SubscriberNotificationSent,
          displayColor: queuedAny ? Blue500 : Yellow500,
          feedInfoInMarkdown: queuedAny
            ? incidentFeedText
            : `📧 **No postmortem notification sent to subscribers** for [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()}).`,
          moreInformationInMarkdown:
            [deliveryMarkdown, customFieldsSentMarkdown]
              .filter(Boolean)
              .join("\n\n") || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: false,
          },
        });

        logger.debug("Incident Feed created", {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        });

        // If we get here, the notification was successful
        await IncidentService.updateOneById({
          id: incident.id!,
          data: {
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.Success,
            subscriberNotificationStatusMessageOnPostmortemPublished:
              "Notifications sent successfully to all subscribers",
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
        logger.debug(
          `Incident ${incident.id} marked as Success for subscriber postmortem notifications.`,
          {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          },
        );
      } catch (err) {
        // If there was an error, mark as failed
        logger.error(err, {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        });
        IncidentService.updateOneById({
          id: incident.id!,
          data: {
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.Failed,
            subscriberNotificationStatusMessageOnPostmortemPublished:
              err instanceof Error ? err.message : String(err),
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        }).catch((error: Error) => {
          logger.error(
            `Failed to update incident ${incident.id} status after error: ${error.message}`,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            },
          );
        });
      }
    }
  },
);
