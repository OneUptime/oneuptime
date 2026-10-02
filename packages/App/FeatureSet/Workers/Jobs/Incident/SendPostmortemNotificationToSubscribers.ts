import RunCron from "../../Utils/Cron";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
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
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
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
import { Blue500, Red500, Yellow500 } from "Common/Types/BrandColors";
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
  SubscriberNotificationRetryScope,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import SubscriberNotificationTiming, {
  SubscriberNotificationRunClock,
  SubscriberNotificationSendWindow,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationTiming";
import SubscriberNotificationClaim from "Common/Server/Utils/StatusPage/SubscriberNotificationClaim";
import SubscriberNotificationRunLimit, {
  SubscriberNotificationProjectSlot,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationRunLimit";
import SubscriberNotificationFanOut from "Common/Server/Utils/StatusPage/SubscriberNotificationFanOut";
import Email from "Common/Types/Email";

RunCron(
  "Incident:SendPostmortemNotificationToSubscribers",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    // Sized to one notification's send window (SubscriberNotificationTiming).
    timeoutInMS: SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
  },
  SubscriberNotificationRunLimit.limit(
    "Incident:SendPostmortemNotificationToSubscribers",
    async () => {
      const runClock: SubscriberNotificationRunClock =
        SubscriberNotificationTiming.startRun();

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
        /*
         * Oldest first, and each sent in full before the next: a state
         * change or note queued before another reaches subscribers before it
         * (the default order is newest first).
         */
        sort: {
          createdAt: SortOrder.Ascending,
        },
        select: {
          // What the claim checks the row against (SubscriberNotificationClaim).
          version: true,
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
            color: true,
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
        if (!runClock.canClaimAnotherNotification()) {
          /*
           * Whatever this run claims now might not finish before its timeout.
           * The rest stay Pending for the runs that follow.
           */
          logger.debug(
            "Leaving the remaining incidents' postmortem notifications for the next run.",
          );
          break;
        }

        /*
         * One of the project's slots for this job: a project already sending
         * its share of these notifications leaves this one Pending, so one
         * tenant's slow sends cannot hold every run (SubscriberNotificationRunLimit).
         */
        const projectSlot: SubscriberNotificationProjectSlot | null =
          await SubscriberNotificationRunLimit.takeProjectSlot({
            jobName: "Incident:SendPostmortemNotificationToSubscribers",
            projectId: incident.projectId,
          });

        if (!projectSlot) {
          continue;
        }

        // Whether this run owns the notification, and so may settle it.
        let claimed: boolean = false;

        try {
          /*
           * Pending to InProgress, only if no other run has claimed it and it
           * has not changed since this run read it (SubscriberNotificationClaim).
           *
           * Claimed before anything is decided from the row: this run read it
           * when it started, which can be minutes ago once earlier sends have
           * taken their time, so a decision to skip it made from that read
           * could overwrite a notification re-queued or claimed since. Only the
           * run that owns it settles it, Skipped included.
           */
          claimed = await SubscriberNotificationClaim.claim({
            service: IncidentService,
            id: incident.id!,
            statusColumn: "subscriberNotificationStatusOnPostmortemPublished",
            // What the sweeper times an interrupted send from.
            claimedAtColumn:
              "subscriberNotificationClaimedAtOnPostmortemPublished",
            version: incident.version,
          });

          if (!claimed) {
            logger.debug(
              `Incident ${incident.id}'s postmortem notification was claimed by another run, or changed since this run read it; leaving it.`,
            );
            continue;
          }

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

          const sendWindow: SubscriberNotificationSendWindow =
            SubscriberNotificationTiming.startSendWindow();
          const logAttributes: LogAttributes = {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          };

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
          const statusPages: Array<StatusPage> =
            resolvedStatusPages.statusPages;

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
            incidentTemplateVariables.getMarkdownVariable(
              "postmortemNote",
            ).html;

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

              if (!sendWindow.isOpen()) {
                // Out of time before this page (SubscriberNotificationTiming).
                deliveryRecord.skipStatusPage(
                  statuspage,
                  StatusPageDeliverySkipReason.OutOfTime,
                );
                continue;
              }

              deliveryRecord.startStatusPage(statuspage);

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

              /*
               * Every subscriber of the page, read in batches past LIMIT_MAX,
               * a bounded number at a time, each message awaited and counted
               * sent or failed (SubscriberNotificationFanOut).
               */
              await SubscriberNotificationFanOut.forEachSubscriber({
                statusPage: statuspage,
                record: deliveryRecord,
                sendWindow: sendWindow,
                logAttributes: logAttributes,
                handler: async (
                  subscriber: StatusPageSubscriber,
                ): Promise<void> => {
                  if (!subscriber._id) {
                    logger.debug(
                      "Encountered a subscriber without an _id; skipping.",
                      {
                        projectId: incident.projectId?.toString(),
                        incidentId: incident.id?.toString(),
                      },
                    );
                    return;
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
                    return;
                  }

                  deliveryRecord.recordSubscriberMatched();

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
                    const subscriberEmail: Email = subscriber.subscriberEmail;
                    logger.debug(
                      `Sending email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail}.`,
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
                      await incidentTemplateVariables.recordFieldsUsedBy([
                        emailTemplate.templateBody,
                        emailTemplate.emailSubject,
                      ]);

                      await deliveryRecord.deliver({
                        statusPage: statuspage,
                        method: StatusPageSubscriberNotificationMethod.Email,
                        // Which address it was, so a failed send frees it for a later page.
                        to: subscriberEmail,
                        subject: compiledSubject,
                        logAttributes: logAttributes,
                        send: () => {
                          return MailService.sendMail(
                            {
                              toEmail: subscriberEmail,
                              templateType: EmailTemplateType.BlankTemplate,
                              vars: {
                                body: compiledBody,
                              },
                              subject: compiledSubject,
                              isSubjectLiteral: true,
                            },
                            {
                              mailServer:
                                ProjectSMTPConfigService.toEmailServer(
                                  statuspage.smtpConfig,
                                ),
                              projectId: statuspage.projectId,
                              statusPageId: statuspage.id!,
                              incidentId: incident.id!,
                            },
                          );
                        },
                      });
                    } else {
                      await incidentTemplateVariables.recordIncludedFieldsSent();

                      await deliveryRecord.deliver({
                        statusPage: statuspage,
                        method: StatusPageSubscriberNotificationMethod.Email,
                        // Which address it was, so a failed send frees it for a later page.
                        to: subscriberEmail,
                        subject: "[Postmortem] " + incident.title || "",
                        logAttributes: logAttributes,
                        send: () => {
                          return MailService.sendMail(
                            {
                              toEmail: subscriberEmail,
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
                                isPublicStatusPage:
                                  statuspage.isPublicStatusPage
                                    ? "true"
                                    : "false",
                                resourcesAffected: resourcesAffectedString,
                                incidentSeverity:
                                  incident.incidentSeverity?.name || " - ",
                                ...EmailColorUtil.getTemplateVariables(
                                  "incidentSeverity",
                                  incident.incidentSeverity?.color,
                                ),
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
                              mailServer:
                                ProjectSMTPConfigService.toEmailServer(
                                  statuspage.smtpConfig,
                                ),
                              projectId: statuspage.projectId,
                              statusPageId: statuspage.id!,
                              incidentId: incident.id!,
                            },
                          );
                        },
                      });
                    }
                    logger.debug(
                      `Email notification sent to subscriber ${subscriber._id}.`,
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
                      `Sending SMS notification to subscriber ${subscriber._id} at ${phoneMasked}.`,
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

                    // send sms here.
                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.SMS,
                      // Which number it was, so a failed send frees it for a later page.
                      to: sms.to,
                      logAttributes: logAttributes,
                      send: () => {
                        return SmsService.sendSms(sms, {
                          projectId: statuspage.projectId,
                          customTwilioConfig:
                            ProjectCallSMSConfigService.toTwilioConfig(
                              statuspage.callSmsConfig,
                            ),
                          statusPageId: statuspage.id!,
                          // An SMS the project cannot send (SMS off, no balance) is failed.
                          failIfNotSent: true,
                          incidentId: incident.id!,
                        });
                      },
                    });
                    logger.debug(
                      `SMS notification sent to subscriber ${subscriber._id}.`,
                      {
                        projectId: incident.projectId?.toString(),
                        incidentId: incident.id?.toString(),
                      },
                    );
                  }

                  if (subscriber.slackIncomingWebhookUrl) {
                    const slackIncomingWebhookUrl: URL =
                      subscriber.slackIncomingWebhookUrl;

                    logger.debug(
                      `Sending Slack notification to subscriber ${subscriber._id} via incoming webhook.`,
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

                    // send Slack notification with markdown conversion
                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Slack,
                      logAttributes: logAttributes,
                      send: () => {
                        return SlackUtil.sendMessageToChannelViaIncomingWebhook(
                          {
                            url: slackIncomingWebhookUrl,
                            text: SlackUtil.convertMarkdownToSlackRichText(
                              markdownMessage,
                            ),
                          },
                        );
                      },
                    });
                    logger.debug(
                      `Slack notification sent to subscriber ${subscriber._id}.`,
                      {
                        projectId: incident.projectId?.toString(),
                        incidentId: incident.id?.toString(),
                      },
                    );
                  }

                  if (subscriber.microsoftTeamsIncomingWebhookUrl) {
                    const microsoftTeamsIncomingWebhookUrl: URL =
                      subscriber.microsoftTeamsIncomingWebhookUrl;

                    logger.debug(
                      `Sending Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook.`,
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

                    // send Teams notification
                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method:
                        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                      logAttributes: logAttributes,
                      send: () => {
                        return MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook(
                          {
                            url: microsoftTeamsIncomingWebhookUrl,
                            text: teamsMarkdownMessage,
                          },
                        );
                      },
                    });
                    logger.debug(
                      `Microsoft Teams notification sent to subscriber ${subscriber._id}.`,
                      {
                        projectId: incident.projectId?.toString(),
                        incidentId: incident.id?.toString(),
                      },
                    );
                  }

                  if (subscriber.subscriberWebhook) {
                    const subscriberWebhook: URL = subscriber.subscriberWebhook;

                    await incidentTemplateVariables.recordIncludedFieldsSent();

                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Webhook,
                      logAttributes: logAttributes,
                      send: () => {
                        return StatusPageSubscriberWebhookUtil.sendWebhookNotification(
                          {
                            webhookUrl: subscriberWebhook,
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
                                incidentSeverity:
                                  incident.incidentSeverity?.name || "",
                                resourcesAffected: resourcesAffectedPlainText,
                                postmortemNote: incident.postmortemNote || "",
                                detailsUrl: incidentDetailsUrl,
                                // The fields marked "Include in Subscriber Notifications", by key.
                                customFields:
                                  incidentTemplateVariables.getWebhookCustomFields(),
                              },
                            },
                          },
                        );
                      },
                    });
                  }
                },
              });
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
          const attemptedAny: boolean = deliveryRecord.hasAttemptedAny();
          /*
           * Fell short when a message failed, or the send stopped before it
           * reached every subscriber: the notification settles as Failed.
           */
          const sendFellShort: boolean = deliveryRecord.hasFailures();
          // The custom field values that went out, as they were sent.
          const customFieldsSentMarkdown: string =
            incidentTemplateVariables.getSentCustomFieldsMarkdown();

          const incidentLink: string = (
            await IncidentService.getIncidentLinkInDashboard(
              incident.projectId!,
              incident.id!,
            )
          ).toString();

          /*
           * Each status page, the subject its email went out with, and what was
           * sent and what failed. When nothing was sent at all - every page
           * hides incidents, is left out by the incident's status page scope,
           * or has no matching subscriber - the item says so instead of
           * claiming a send.
           */
          await IncidentFeedService.createIncidentFeedItem({
            incidentId: incident.id!,
            projectId: incident.projectId!,
            incidentFeedEventType:
              IncidentFeedEventType.SubscriberNotificationSent,
            displayColor: sendFellShort
              ? Red500
              : attemptedAny
                ? Blue500
                : Yellow500,
            feedInfoInMarkdown: sendFellShort
              ? `📧 **Not every subscriber was sent the postmortem notification** for [Incident ${incidentNumberDisplay}](${incidentLink}).`
              : attemptedAny
                ? incidentFeedText
                : `📧 **No postmortem notification sent to subscribers** for [Incident ${incidentNumberDisplay}](${incidentLink}).`,
            moreInformationInMarkdown:
              [deliveryMarkdown, customFieldsSentMarkdown]
                .filter(Boolean)
                .join("\n\n") || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: false,
            },
          });

          logger.debug("Incident Feed created", logAttributes);

          // Settle: Success, or Failed with what was sent and failed per page.
          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnPostmortemPublished: sendFellShort
                ? StatusPageSubscriberNotificationStatus.Failed
                : StatusPageSubscriberNotificationStatus.Success,
              subscriberNotificationStatusMessageOnPostmortemPublished:
                deliveryRecord.toStatusMessage({
                  sentMessage:
                    "Notifications sent successfully to all subscribers.",
                  retryScope: SubscriberNotificationRetryScope.EveryPage,
                }),
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          logger.debug(
            `Incident ${incident.id} marked as ${sendFellShort ? "Failed" : "Success"} for subscriber postmortem notifications.`,
            logAttributes,
          );
        } catch (err) {
          logger.error(err, {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          });

          /*
           * Only a notification this run claimed is its to fail. Anything
           * before the claim leaves it Pending for the next run.
           */
          if (!claimed) {
            continue;
          }

          // If there was an error, mark as failed
          await IncidentService.updateOneById({
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
        } finally {
          await projectSlot.release();
        }
      }
    },
  ),
);
