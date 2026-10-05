import RunCron from "../../Utils/Cron";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
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
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
  SubscriberNotificationEmailBodyTemplateVariables,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
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
import StatusPageEmailLogo from "Common/Server/Utils/StatusPage/StatusPageEmailLogo";

RunCron(
  "IncidentStateTimeline:SendNotificationToSubscribers",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    // Sized to one notification's send window (SubscriberNotificationTiming).
    timeoutInMS: SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
  },
  SubscriberNotificationRunLimit.limit(
    "IncidentStateTimeline:SendNotificationToSubscribers",
    async () => {
      const runClock: SubscriberNotificationRunClock =
        SubscriberNotificationTiming.startRun();

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
          /*
           * Oldest first, and each sent in full before the next: a state
           * change or note queued before another reaches subscribers before it
           * (the default order is newest first).
           */
          sort: {
            createdAt: SortOrder.Ascending,
          },
          select: {
            _id: true,
            // What the claim checks the row against (SubscriberNotificationClaim).
            version: true,
            projectId: true,
            incidentId: true,
            incidentStateId: true,
            incidentState: {
              name: true,
              color: true,
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
        if (!runClock.canClaimAnotherNotification()) {
          /*
           * Whatever this run claims now might not finish before its timeout.
           * The rest stay Pending for the runs that follow.
           */
          logger.debug(
            "Leaving the remaining incident state timelines for the next run.",
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
            jobName: "IncidentStateTimeline:SendNotificationToSubscribers",
            projectId: incidentStateTimeline.projectId,
          });

        if (!projectSlot) {
          continue;
        }

        // Whether this run owns the notification, and so may settle it.
        let claimed: boolean = false;

        try {
          logger.debug(
            `Processing incident state timeline ${incidentStateTimeline.id}.`,
            {
              projectId: incidentStateTimeline.projectId?.toString(),
              incidentId: incidentStateTimeline.incidentId?.toString(),
            },
          );

          /*
           * Set to InProgress at the start of processing: Pending to
           * InProgress, only if no other run has claimed it and it has not
           * changed since this run read it (SubscriberNotificationClaim).
           */
          claimed = await SubscriberNotificationClaim.claim({
            service: IncidentStateTimelineService,
            id: incidentStateTimeline.id!,
            statusColumn: "subscriberNotificationStatus",
            version: incidentStateTimeline.version,
          });

          if (!claimed) {
            logger.debug(
              `Incident state timeline ${incidentStateTimeline.id} was claimed by another run, or changed since this run read it; leaving it.`,
            );
            continue;
          }

          const sendWindow: SubscriberNotificationSendWindow =
            SubscriberNotificationTiming.startSendWindow();

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
              // Templates offer {{incidentDescription}}.
              description: true,
              projectId: true,
              monitors: {
                _id: true,
              },
              incidentSeverity: {
                name: true,
                color: true,
              },
              isVisibleOnStatusPage: true,
              incidentNumber: true,
              incidentNumberWithPrefix: true,
              // {{incidentLabels}} and the custom fields (IncidentTemplateVariableBuilder).
              labels: {
                name: true,
              },
              customFields: true,
            },
          });

          if (!incident) {
            logger.debug(
              `Incident ${incidentStateTimeline.incidentId} not found; marking as Skipped.`,
              {
                projectId: incidentStateTimeline.projectId?.toString(),
                incidentId: incidentStateTimeline.incidentId?.toString(),
              },
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
              {
                projectId: incident.projectId?.toString(),
                incidentId: incident.id?.toString(),
              },
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
              {
                projectId: incident.projectId?.toString(),
                incidentId: incident.id?.toString(),
              },
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
          const statusPages: Array<StatusPage> =
            resolvedStatusPages.statusPages;

          logger.debug(
            `Incident ${incident.id} reaches ${statusPages.length} status page(s) for state timeline notification; ${resolvedStatusPages.excludedStatusPages.length} left out by its status page scope.`,
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
           * The values every message is filled with, read once per state
           * change: {{incidentDescription}} is converted once into the format
           * each channel renders - HTML for a custom email body (BlankTemplate
           * adds no markup of its own), plain text for SMS and the email
           * subject, and the Markdown as written for Slack and Teams - and the
           * incident's labels and custom fields are read once. What varies per
           * status page is added per page below.
           */
          const incidentTemplateVariables: IncidentTemplateVariables =
            await IncidentTemplateVariableBuilder.build({
              incident: incident,
              statusPages: statusPages,
              markdownVariables: {
                incidentDescription: incident.description,
              },
              textVariables: {
                incidentState: incidentStateTimeline.incidentState.name,
              },
            });

          const logAttributes: LogAttributes = {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          };

          for (const statuspage of statusPages) {
            try {
              if (!statuspage.id) {
                logger.debug(
                  "Encountered a status page without an id; skipping.",
                  logAttributes,
                );
                continue;
              }

              if (!statuspage.showIncidentsOnStatusPage) {
                logger.debug(
                  `Status page ${statuspage.id} hides incidents; skipping.`,
                  logAttributes,
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

              const statusPageURL: string =
                await StatusPageService.getStatusPageURL(statuspage.id);
              const statusPageName: string =
                statuspage.pageTitle || statuspage.name || "Status Page";

              const incidentDetailsUrl: string =
                incident.id && statusPageURL
                  ? URL.fromString(statusPageURL)
                      .addRoute(`/incidents/${incident.id.toString()}`)
                      .toString()
                  : statusPageURL;

              // Fetch custom templates for this status page (if any)
              const [
                emailTemplate,
                smsTemplate,
                slackTemplate,
                teamsTemplate,
              ]: [
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
                    notificationMethod:
                      StatusPageSubscriberNotificationMethod.Email,
                  },
                ),
                StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                  {
                    statusPageId: statuspage.id!,
                    eventType:
                      StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
                    notificationMethod:
                      StatusPageSubscriberNotificationMethod.SMS,
                  },
                ),
                StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
                  {
                    statusPageId: statuspage.id!,
                    eventType:
                      StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
                    notificationMethod:
                      StatusPageSubscriberNotificationMethod.Slack,
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

              /*
               * Every variable SubscriberNotificationTemplateVariables advertises
               * for the incident state changed event, built once per status page
               * (IncidentTemplateVariableBuilder) in the format each channel
               * renders; every channel adds the subscriber's unsubscribeUrl, so
               * no channel can miss a variable the others have.
               *
               * - The custom email body is HTML: nothing converts it after
               *   compiling. compileEmailBodyTemplate escapes the plain values;
               *   only the SafeHtml ones go in as HTML.
               * - SMS and the email subject render neither HTML nor Markdown.
               * - Slack and Teams render Markdown, but show "<br/>" as literal
               *   text.
               *
               * The HTML resource list (escaped names, "<br/>" between groups)
               * is only for email bodies; every other channel, and the email
               * heading, which the template escapes, gets the plain-text list.
               * A custom template reads "None" when the page lists no resource.
               */
              const pageTemplateVariables: IncidentStatusPageTemplateVariables =
                incidentTemplateVariables.forStatusPage({
                  statusPage: statuspage,
                  statusPageUrl: statusPageURL,
                  detailsUrl: incidentDetailsUrl,
                  resources: statusPageToResources[statuspage._id!] || [],
                  noResourcesText: "None",
                });
              const resourcesAffectedHtml: string =
                pageTemplateVariables.resourcesAffectedHtml;
              const resourcesAffectedPlainText: string =
                pageTemplateVariables.resourcesAffectedPlainText;

              const emailBodyTemplateVariables: SubscriberNotificationEmailBodyTemplateVariables =
                pageTemplateVariables.emailBody;
              const plainTextTemplateVariables: Record<string, string> =
                pageTemplateVariables.plainText;
              const markdownTemplateVariables: Record<string, string> =
                pageTemplateVariables.markdown;

              /*
               * The fields marked "Include in Subscriber Notifications", for the
               * default Slack and Teams messages, one per line. The default SMS
               * carries none: it is billed by the segment.
               */
              const chatCustomFields: string =
                pageTemplateVariables.customFieldsMarkdownLines.length > 0
                  ? `\n${pageTemplateVariables.customFieldsMarkdownLines.join("\n")}`
                  : "";

              const incidentStateName: string =
                incidentStateTimeline.incidentState.name;

              /*
               * Every subscriber of the page, read in batches past LIMIT_MAX, a
               * bounded number at a time, each message awaited and counted sent
               * or failed (SubscriberNotificationFanOut).
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
                      logAttributes,
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
                      `Skipping subscriber ${subscriber._id} based on preferences for state timeline ${incidentStateTimeline.id}.`,
                      logAttributes,
                    );
                    return;
                  }

                  deliveryRecord.recordSubscriberMatched();

                  const unsubscribeUrl: string =
                    StatusPageSubscriberService.getUnsubscribeLink(
                      URL.fromString(statusPageURL),
                      subscriber,
                    ).toString();

                  // Add unsubscribeUrl to template variables
                  const subscriberEmailBodyTemplateVariables: SubscriberNotificationEmailBodyTemplateVariables =
                    {
                      ...emailBodyTemplateVariables,
                      unsubscribeUrl: unsubscribeUrl,
                    };
                  const subscriberPlainTextTemplateVariables: Record<
                    string,
                    string
                  > = {
                    ...plainTextTemplateVariables,
                    unsubscribeUrl: unsubscribeUrl,
                  };
                  const subscriberMarkdownTemplateVariables: Record<
                    string,
                    string
                  > = {
                    ...markdownTemplateVariables,
                    unsubscribeUrl: unsubscribeUrl,
                  };

                  /*
                   * An email address or phone number already sent this in this
                   * send, through an earlier page, is not sent it again (only for
                   * a scoped incident; see SubscriberNotificationDeliveryRecord).
                   */
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
                      `Sending SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for incident state timeline ${incidentStateTimeline.id}.`,
                      logAttributes,
                    );

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

                    let smsMessage: string;
                    if (smsTemplate?.templateBody && statuspage.callSmsConfig) {
                      // Use custom template only when custom Twilio is configured
                      smsMessage =
                        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          smsTemplate.templateBody,
                          {
                            ...subscriberPlainTextTemplateVariables,
                            unsubscribeUrl: smsUnsubscribeUrl,
                          },
                        );
                      await incidentTemplateVariables.recordFieldsUsedBy([
                        smsTemplate.templateBody,
                      ]);
                    } else {
                      // Use default hard-coded template
                      smsMessage = `Incident ${incident.title || ""} on ${statusPageName} is ${Text.uppercaseFirstLetter(incidentStateName)}. Details: ${incidentDetailsUrl}. Unsub: ${smsUnsubscribeUrl}`;
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
                  }

                  let emailTitle: string = `Incident `;

                  if (resourcesAffectedPlainText) {
                    emailTitle += `on ${resourcesAffectedPlainText} `;
                  }

                  emailTitle += `is ${incidentStateName}`;

                  if (
                    subscriber.subscriberEmail &&
                    deliveryRecord.shouldSendEmail({
                      statusPage: statuspage,
                      email: subscriber.subscriberEmail,
                    })
                  ) {
                    // send email here.
                    logger.debug(
                      `Sending email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for incident state timeline ${incidentStateTimeline.id}.`,
                      logAttributes,
                    );

                    const subscriberEmail: Email = subscriber.subscriberEmail;

                    if (emailTemplate?.templateBody && statuspage.smtpConfig) {
                      // Use custom template with BlankTemplate only when custom SMTP is configured
                      const compiledBody: string =
                        StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate(
                          emailTemplate.templateBody,
                          subscriberEmailBodyTemplateVariables,
                        );
                      const compiledSubject: string = emailTemplate.emailSubject
                        ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                            emailTemplate.emailSubject,
                            subscriberPlainTextTemplateVariables,
                          )
                        : `[Incident ${Text.uppercaseFirstLetter(incidentStateName)}] ${incident.title || ""}`;

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
                      const subject: string = `[${Text.uppercaseFirstLetter(
                        incidentStateName,
                      )} Incident] ${incident.title}`;

                      await incidentTemplateVariables.recordIncludedFieldsSent();

                      // Use default hard-coded template
                      await deliveryRecord.deliver({
                        statusPage: statuspage,
                        method: StatusPageSubscriberNotificationMethod.Email,
                        // Which address it was, so a failed send frees it for a later page.
                        to: subscriberEmail,
                        subject: subject,
                        logAttributes: logAttributes,
                        send: () => {
                          return MailService.sendMail(
                            {
                              toEmail: subscriberEmail,
                              templateType:
                                EmailTemplateType.SubscriberIncidentStateChanged,
                              vars: {
                                emailTitle: emailTitle,
                                statusPageName: statusPageName,
                                statusPageUrl: statusPageURL,
                                detailsUrl: incidentDetailsUrl,
                                logoUrl: StatusPageEmailLogo.getLogoUrl({
                                  statusPage: statuspage,
                                  host: host,
                                  httpProtocol: httpProtocol,
                                }),
                                isPublicStatusPage:
                                  statuspage.isPublicStatusPage
                                    ? "true"
                                    : "false",
                                resourcesAffected:
                                  resourcesAffectedHtml || "None",
                                incidentSeverity:
                                  incident.incidentSeverity?.name || " - ",
                                ...EmailColorUtil.getTemplateVariables(
                                  "incidentSeverity",
                                  incident.incidentSeverity?.color,
                                ),
                                incidentTitle: incident.title || "",

                                incidentState: incidentStateName,
                                ...EmailColorUtil.getTemplateVariables(
                                  "incidentState",
                                  incidentStateTimeline.incidentState?.color,
                                ),
                                // The fields marked "Include in Subscriber Notifications".
                                customFieldRows:
                                  pageTemplateVariables.customFieldRows as unknown as JSONObject,
                                unsubscribeUrl: unsubscribeUrl,
                                subscriberEmailNotificationFooterText:
                                  StatusPageServiceType.getSubscriberEmailFooterText(
                                    statuspage,
                                  ),
                              },
                              subject: subject,
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
                  }

                  if (subscriber.slackIncomingWebhookUrl) {
                    const slackIncomingWebhookUrl: URL =
                      subscriber.slackIncomingWebhookUrl;

                    let slackTitle: string;
                    if (slackTemplate?.templateBody) {
                      // Use custom template
                      slackTitle =
                        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          slackTemplate.templateBody,
                          subscriberMarkdownTemplateVariables,
                        );
                      await incidentTemplateVariables.recordFieldsUsedBy([
                        slackTemplate.templateBody,
                      ]);
                    } else {
                      // Use default hard-coded template
                      slackTitle = `🚨 ## Incident - ${incident.title || " - "}

`;

                      if (resourcesAffectedPlainText) {
                        slackTitle += `
**Resources Affected:** ${resourcesAffectedPlainText}`;
                      }

                      slackTitle += `
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Status:** ${incidentStateName}${chatCustomFields}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                      await incidentTemplateVariables.recordIncludedFieldsSent();
                    }

                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Slack,
                      logAttributes: logAttributes,
                      send: () => {
                        return SlackUtil.sendMessageToChannelViaIncomingWebhook(
                          {
                            url: slackIncomingWebhookUrl,
                            text: SlackUtil.convertMarkdownToSlackRichText(
                              slackTitle,
                            ),
                          },
                        );
                      },
                    });
                    logger.debug(
                      `Slack notification sent to subscriber ${subscriber._id} for incident state timeline ${incidentStateTimeline.id}.`,
                      logAttributes,
                    );
                  }

                  if (subscriber.microsoftTeamsIncomingWebhookUrl) {
                    const microsoftTeamsIncomingWebhookUrl: URL =
                      subscriber.microsoftTeamsIncomingWebhookUrl;

                    let teamsTitle: string;
                    if (teamsTemplate?.templateBody) {
                      // Use custom template
                      teamsTitle =
                        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          teamsTemplate.templateBody,
                          subscriberMarkdownTemplateVariables,
                        );
                      await incidentTemplateVariables.recordFieldsUsedBy([
                        teamsTemplate.templateBody,
                      ]);
                    } else {
                      // Use default hard-coded template
                      teamsTitle = `🚨 ## Incident - ${incident.title || " - "}

`;

                      if (resourcesAffectedPlainText) {
                        teamsTitle += `
**Resources Affected:** ${resourcesAffectedPlainText}`;
                      }

                      teamsTitle += `
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Status:** ${incidentStateName}${chatCustomFields}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
                      await incidentTemplateVariables.recordIncludedFieldsSent();
                    }

                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method:
                        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
                      logAttributes: logAttributes,
                      send: () => {
                        return MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook(
                          {
                            url: microsoftTeamsIncomingWebhookUrl,
                            text: teamsTitle,
                          },
                        );
                      },
                    });
                    logger.debug(
                      `Microsoft Teams notification sent to subscriber ${subscriber._id} for incident state timeline ${incidentStateTimeline.id}.`,
                      logAttributes,
                    );
                  }

                  if (subscriber.subscriberWebhook) {
                    logger.debug(
                      `Sending webhook notification to subscriber ${subscriber._id} for incident state timeline ${incidentStateTimeline.id}.`,
                      logAttributes,
                    );

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
                              eventType: "IncidentStateChanged",
                              statusPageId: statuspage.id!.toString(),
                              statusPageName: statusPageName,
                              statusPageUrl: statusPageURL,
                              unsubscribeUrl: unsubscribeUrl,
                              data: {
                                incidentId: incident.id?.toString() || "",
                                incidentNumber:
                                  incident.incidentNumber?.toString() || "",
                                incidentTitle: incident.title || "",
                                // As written, like the incident created webhook.
                                incidentDescription: incident.description || "",
                                incidentSeverity:
                                  incident.incidentSeverity?.name || "",
                                incidentState: incidentStateName || "",
                                resourcesAffected:
                                  resourcesAffectedPlainText || "",
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
              /*
               * One page failing - a subscriber read, its URL, a template lookup -
               * does not stop the send: the page is recorded as failed part-way,
               * and the send goes on to the next one and settles as usual, with
               * the per-page record and the feed item.
               */
              logger.error(err, logAttributes);
              deliveryRecord.skipStatusPage(
                statuspage,
                StatusPageDeliverySkipReason.Failed,
              );
            }
          }

          const deliveryMarkdown: string = deliveryRecord.toMarkdown();
          // The custom field values that went out, as they were sent.
          const customFieldsSentMarkdown: string =
            incidentTemplateVariables.getSentCustomFieldsMarkdown();

          const incidentNumberDisplay: string =
            incident.incidentNumberWithPrefix ||
            "#" + (incident.incidentNumber?.toString() || " - ");
          const projectId: ObjectID = incident.projectId!;
          const incidentId: ObjectID = incident.id!;

          /*
           * Fell short when a message failed, or the send stopped before it
           * reached every subscriber: the notification settles as Failed.
           */
          const sendFellShort: boolean = deliveryRecord.hasFailures();

          if (sendFellShort) {
            logger.debug(
              "Not every subscriber was sent the incident state change notification",
              logAttributes,
            );

            await IncidentFeedService.createIncidentFeedItem({
              incidentId: incident.id!,
              projectId: incident.projectId!,
              incidentFeedEventType:
                IncidentFeedEventType.SubscriberNotificationSent,
              displayColor: Red500,
              feedInfoInMarkdown: `📧 **Not every Status Page Subscriber was notified** about the state change of the [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}) to **${incidentStateTimeline.incidentState.name}**`,
              /*
               * Each status page with what was sent and what failed, and the
               * subject its email went out with; then the custom field values
               * sent.
               */
              moreInformationInMarkdown:
                [deliveryMarkdown, customFieldsSentMarkdown]
                  .filter(Boolean)
                  .join("\n\n") || undefined,
              workspaceNotification: {
                sendWorkspaceNotification: true,
              },
            });
          } else if (deliveryRecord.hasMatchedAnySubscriber()) {
            logger.debug(
              "Notification sent to subscribers for incident state change",
              logAttributes,
            );

            await IncidentFeedService.createIncidentFeedItem({
              incidentId: incident.id!,
              projectId: incident.projectId!,
              incidentFeedEventType:
                IncidentFeedEventType.SubscriberNotificationSent,
              displayColor: Blue500,
              feedInfoInMarkdown: `📧 **Status Page Subscribers have been notified** about the state change of the [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}) to **${incidentStateTimeline.incidentState.name}**`,
              /*
               * Each status page, the subject its email went out with, and
               * what was sent; then the custom field values sent.
               */
              moreInformationInMarkdown:
                [deliveryMarkdown, customFieldsSentMarkdown]
                  .filter(Boolean)
                  .join("\n\n") || undefined,
              workspaceNotification: {
                sendWorkspaceNotification: true,
              },
            });

            logger.debug("Incident Feed created", logAttributes);
          } else {
            logger.debug(
              `No subscribers were notified for incident state change. All status pages either hide incidents or had no matching subscribers.`,
              logAttributes,
            );

            await IncidentFeedService.createIncidentFeedItem({
              incidentId: incident.id!,
              projectId: incident.projectId!,
              incidentFeedEventType:
                IncidentFeedEventType.SubscriberNotificationSent,
              displayColor: Yellow500,
              feedInfoInMarkdown: `📧 **No notification sent to subscribers** for the state change of [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}) to **${incidentStateTimeline.incidentState.name}**`,
              moreInformationInMarkdown: [
                "Subscriber notifications were skipped because every associated status page either hides incidents, is left out by this incident's status page scope, or had no matching subscribers.",
                deliveryMarkdown,
              ]
                .filter(Boolean)
                .join("\n\n"),
              workspaceNotification: {
                sendWorkspaceNotification: false,
              },
            });
          }

          // Settle: Success, or Failed with what was sent and failed per page.
          await IncidentStateTimelineService.updateOneById({
            id: incidentStateTimeline.id!,
            data: {
              subscriberNotificationStatus: sendFellShort
                ? StatusPageSubscriberNotificationStatus.Failed
                : StatusPageSubscriberNotificationStatus.Success,
              subscriberNotificationStatusMessage:
                deliveryRecord.toStatusMessage({
                  sentMessage:
                    "Notifications sent successfully to all subscribers.",
                  retryScope: SubscriberNotificationRetryScope.EveryPage,
                }),
            },
            props: { isRoot: true, ignoreHooks: true },
          });
        } catch (err) {
          /*
           * Settle the row. It is InProgress by now and the cron only picks up
           * Pending rows, so an error here used to leave it "being sent"
           * forever - and, uncaught, it also ended this run before the
           * remaining incident state timelines were looked at.
           */
          logger.error(
            `Error sending subscriber notifications for incident state timeline ${incidentStateTimeline.id}: ${err}`,
          );

          // Only a notification this run claimed is its to fail.
          if (!claimed) {
            continue;
          }

          await IncidentStateTimelineService.updateOneById({
            id: incidentStateTimeline.id!,
            data: {
              subscriberNotificationStatus:
                StatusPageSubscriberNotificationStatus.Failed,
              subscriberNotificationStatusMessage:
                err instanceof Error ? err.message : String(err),
            },
            props: { isRoot: true, ignoreHooks: true },
          }).catch((updateError: unknown) => {
            logger.error(
              `Failed to mark incident state timeline ${incidentStateTimeline.id} as Failed: ${updateError}`,
            );
          });
        } finally {
          await projectSlot.release();
        }
      }
    },
  ),
);
