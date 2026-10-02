import RunCron from "../../Utils/Cron";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import Email from "Common/Types/Email";
import SMS from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentService from "Common/Server/Services/IncidentService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentCreatedRenotify from "Common/Types/StatusPage/IncidentCreatedRenotify";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500, Red500, Yellow500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import {
  IncidentStatusPageTemplateVariables,
  IncidentTemplateVariables,
} from "Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder";
import SubscriberIncidentEmailBuilder, {
  SubscriberIncidentEmail,
  SubscriberIncidentEmailEvent,
  SubscriberIncidentStatusPageEmail,
} from "Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
} from "Common/Server/Utils/StatusPage/IncidentStatusPageScope";
import SubscriberNotificationDeliveryRecord, {
  StatusPageDeliverySkipReason,
  SubscriberNotificationRetryScope,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import IncidentScopeAddedPagesNotification from "Common/Types/StatusPage/IncidentScopeAddedPagesNotification";
import SubscriberNotificationTiming, {
  SubscriberNotificationRunClock,
  SubscriberNotificationSendWindow,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationTiming";
import SubscriberNotificationClaim from "Common/Server/Utils/StatusPage/SubscriberNotificationClaim";
import SubscriberNotificationRunLimit, {
  SubscriberNotificationProjectSlot,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationRunLimit";
import SubscriberNotificationFanOut from "Common/Server/Utils/StatusPage/SubscriberNotificationFanOut";

// The status message of a 'created' notification that reached everyone.
const SENT_MESSAGE: string =
  "Notifications sent successfully to all subscribers.";

RunCron(
  "Incident:SendNotificationToSubscribers",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    // Sized to one notification's send window (SubscriberNotificationTiming).
    timeoutInMS: SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
  },
  SubscriberNotificationRunLimit.limit(
    "Incident:SendNotificationToSubscribers",
    async () => {
      const runClock: SubscriberNotificationRunClock =
        SubscriberNotificationTiming.startRun();

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
          // The status pages already sent this notification, which it skips.
          statusPagesNotifiedOnCreation: true,
          // What the claim checks the row against (SubscriberNotificationClaim).
          version: true,
          // {{incidentLabels}} and the custom fields (IncidentTemplateVariableBuilder).
          labels: {
            name: true,
          },
          customFields: true,
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
        if (!runClock.canClaimAnotherNotification()) {
          /*
           * Whatever this run claims now might not finish before its timeout.
           * The rest stay Pending for the runs that follow.
           */
          logger.debug(
            "Leaving the remaining incidents' created notifications for the next run.",
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
            jobName: "Incident:SendNotificationToSubscribers",
            projectId: incident.projectId,
          });

        if (!projectSlot) {
          continue;
        }

        /*
         * The pages this send has told in full so far, on top of the ones told
         * before. Kept outside the try, so a send that fails part-way still
         * records the pages it finished and Retry resumes after them.
         */
        let notifiedStatusPageIds: Array<string> | null = null;
        // Whether this run owns the notification, and so may settle it.
        let claimed: boolean = false;

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

          /*
           * Pending to InProgress, only if no other run has claimed it and it
           * has not changed since this run read it (SubscriberNotificationClaim).
           *
           * Claimed before anything is decided from the row: this run read it
           * when it started, which can be minutes ago once earlier sends have
           * taken their time, so a decision to skip it made from that read -
           * hidden, no monitors - could overwrite a notification re-queued or
           * claimed since. Only the run that owns it settles it, Skipped
           * included.
           */
          claimed = await SubscriberNotificationClaim.claim({
            service: IncidentService,
            id: incident.id!,
            statusColumn: "subscriberNotificationStatusOnIncidentCreated",
            // What the sweeper times an interrupted send from.
            claimedAtColumn: "subscriberNotificationClaimedAtOnIncidentCreated",
            version: incident.version,
          });

          if (!claimed) {
            logger.debug(
              `Incident ${incident.id}'s created notification was claimed by another run, or changed since this run read it; leaving it.`,
            );
            continue;
          }

          logger.debug(
            `Incident ${incident.id} status set to InProgress for subscriber notifications.`,
          );

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

          const sendWindow: SubscriberNotificationSendWindow =
            SubscriberNotificationTiming.startSendWindow();
          const logAttributes: LogAttributes = {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          };

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
            `Incident ${incident.id} reaches ${statusPages.length} status page(s) for notifications; ${resolvedStatusPages.excludedStatusPages.length} left out by its status page scope.`,
          );

          /*
           * The pages already told about this incident. Adding pages to an
           * incident's scope puts this notification back to Pending (see
           * IncidentScopeAddedPagesNotification); this record is what keeps the
           * pages that already heard from hearing it twice. The pages this send
           * tells in full are added to it. It is written hook-free as each such
           * page finishes (recordNotifiedStatusPagesSoFar), so a send that is
           * interrupted keeps them, and once more through the incident service
           * with the status the send settles on - Success, or Failed so that
           * Retry resumes after the pages it finished. Writing it through the
           * service after every page would fire the incident's 'on update'
           * workflows, realtime events and audit log once per page.
           *
           * An incident with no record yet (null) has never had a send settle
           * since the record was introduced: IncidentService does not queue a
           * notification that already went out without one, and writes one
           * when it queues a notification that was skipped.
           */
          const alreadyNotifiedStatusPageIds: Array<string> =
            IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
              incident.statusPagesNotifiedOnCreation,
            );
          const toldStatusPageIds: Array<string> = [
            ...alreadyNotifiedStatusPageIds,
          ];
          notifiedStatusPageIds = toldStatusPageIds;

          const deliveryRecord: SubscriberNotificationDeliveryRecord =
            new SubscriberNotificationDeliveryRecord({
              dedupeEmailAndSms: resolvedStatusPages.isScoped,
            });

          deliveryRecord.addExcludedStatusPages(
            resolvedStatusPages.excludedStatusPages,
          );

          /*
           * The values every message is filled with, read once per incident:
           * the description is rendered once rather than once per subscriber,
           * and the incident's labels and custom fields are read once. They
           * do not vary per status page or per subscriber; what does is added
           * per page below. Read the way the notification preview reads them
           * (SubscriberIncidentEmailBuilder).
           */
          const incidentTemplateVariables: IncidentTemplateVariables =
            await SubscriberIncidentEmailBuilder.buildTemplateVariables({
              event: SubscriberIncidentEmailEvent.IncidentCreated,
              incident: incident,
              statusPages: statusPages,
            });

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

              if (!sendWindow.isOpen()) {
                /*
                 * Out of time before this page: not told, so Retry sends to
                 * it (SubscriberNotificationTiming).
                 */
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
                SubscriberIncidentEmailBuilder.getDetailsUrl({
                  statusPageUrl: statusPageURL,
                  incidentId: incident.id,
                });

              /*
               * Everything this page's messages are filled with (see
               * IncidentTemplateVariableBuilder). The HTML resource list
               * (escaped names, "<br/>" between groups) is only for email
               * bodies; SMS, Slack, Teams, subjects and webhooks get the
               * plain-text list, which shows names as written.
               */
              const pageTemplateVariables: IncidentStatusPageTemplateVariables =
                incidentTemplateVariables.forStatusPage({
                  statusPage: statuspage,
                  statusPageUrl: statusPageURL,
                  detailsUrl: incidentDetailsUrl,
                  resources: statusPageToResources[statuspage._id!] || [],
                });
              const resourcesAffectedPlainText: string =
                pageTemplateVariables.resourcesAffectedPlainText;

              logger.debug(
                `Resources affected for incident ${incident.id} on status page ${statuspage.id}: ${resourcesAffectedPlainText}`,
              );

              /*
               * The page's email - its custom template or the default one, and
               * why - built by the code the notification preview shows it
               * with, so what was previewed is what is sent.
               */
              const pageEmail: SubscriberIncidentStatusPageEmail =
                await SubscriberIncidentEmailBuilder.forStatusPage({
                  event: SubscriberIncidentEmailEvent.IncidentCreated,
                  incident: incident,
                  incidentTemplateVariables: incidentTemplateVariables,
                  statusPage: statuspage,
                  statusPageUrl: statusPageURL,
                  detailsUrl: incidentDetailsUrl,
                  pageTemplateVariables: pageTemplateVariables,
                  host: host,
                  httpProtocol: httpProtocol,
                });

              // Fetch the other channels' custom templates for this page (if any)
              const [
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
               * renders: plain text for SMS, and Markdown for Slack and Teams.
               * (The email's are the builder's: see
               * SubscriberIncidentEmailBuilder.)
               */
              const plainTextTemplateVariables: Record<string, string> =
                pageTemplateVariables.plainText;
              const markdownTemplateVariables: Record<string, string> =
                pageTemplateVariables.markdown;

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
                  );

                  // Add unsubscribeUrl to template variables
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
                      `Sending email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail}.`,
                    );

                    const subscriberEmail: Email = subscriber.subscriberEmail;

                    // The page's email, with this subscriber's unsubscribe link.
                    const email: SubscriberIncidentEmail =
                      pageEmail.forSubscriber({
                        unsubscribeUrl: unsubscribeUrl,
                      });

                    await pageEmail.recordSending();

                    await deliveryRecord.deliver({
                      statusPage: statuspage,
                      method: StatusPageSubscriberNotificationMethod.Email,
                      // Which address it was, so a failed send frees it for a later page.
                      to: subscriberEmail,
                      subject: email.subject,
                      logAttributes: logAttributes,
                      send: () => {
                        return MailService.sendMail(
                          {
                            toEmail: subscriberEmail,
                            ...email.envelope,
                          },
                          {
                            mailServer: ProjectSMTPConfigService.toEmailServer(
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
                      smsMessage = `Incident ${incident.title || ""} (${incident.incidentSeverity?.name || "-"}) on ${statusPageName}. Impact: ${resourcesAffectedPlainText}. Details: ${incidentDetailsUrl}. Unsub: ${smsUnsubscribeUrl}`;
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

                  if (subscriber.slackIncomingWebhookUrl) {
                    logger.debug(
                      `Sending Slack notification to subscriber ${subscriber._id} via incoming webhook.`,
                    );

                    const slackIncomingWebhookUrl: URL =
                      subscriber.slackIncomingWebhookUrl;

                    let markdownMessage: string;
                    if (slackTemplate?.templateBody) {
                      // Use custom template
                      markdownMessage =
                        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          slackTemplate.templateBody,
                          subscriberMarkdownTemplateVariables,
                        );
                      await incidentTemplateVariables.recordFieldsUsedBy([
                        slackTemplate.templateBody,
                      ]);
                    } else {
                      // Use default hard-coded template
                      markdownMessage = `## 🚨 Incident - ${incident.title || ""}

**Severity:** ${incident.incidentSeverity?.name || " - "}

**Resources Affected:** ${resourcesAffectedPlainText}

**Description:** ${incident.description || ""}

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
                  }

                  if (subscriber.microsoftTeamsIncomingWebhookUrl) {
                    logger.debug(
                      `Sending Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook.`,
                    );

                    const microsoftTeamsIncomingWebhookUrl: URL =
                      subscriber.microsoftTeamsIncomingWebhookUrl;

                    let markdownMessage: string;
                    if (teamsTemplate?.templateBody) {
                      // Use custom template
                      markdownMessage =
                        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                          teamsTemplate.templateBody,
                          subscriberMarkdownTemplateVariables,
                        );
                      await incidentTemplateVariables.recordFieldsUsedBy([
                        teamsTemplate.templateBody,
                      ]);
                    } else {
                      // Use default hard-coded template
                      markdownMessage = `## 🚨 Incident - ${incident.title || ""}
**Severity:** ${incident.incidentSeverity?.name || " - "}
**Resources Affected:** ${resourcesAffectedPlainText}
**Description:** ${incident.description || ""}
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
                            text: markdownMessage,
                          },
                        );
                      },
                    });
                  }

                  if (subscriber.subscriberWebhook) {
                    logger.debug(
                      `Sending webhook notification to subscriber ${subscriber._id}.`,
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
                                incidentSeverity:
                                  incident.incidentSeverity?.name || "",
                                resourcesAffected: resourcesAffectedPlainText,
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

              /*
               * Told only when every subscriber of the page was reached and
               * none of their messages failed; otherwise Retry sends to it
               * again. Recorded straight away, so a send that is interrupted
               * by a crash still leaves the pages it finished.
               */
              if (deliveryRecord.didStatusPageSucceed(statuspage.id)) {
                toldStatusPageIds.push(statuspage.id.toString().toLowerCase());

                await recordNotifiedStatusPagesSoFar({
                  incident: incident,
                  toldStatusPageIds: toldStatusPageIds,
                });
              }
            } catch (err) {
              logger.error(err);
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

          /*
           * Fell short when a message failed, or the send stopped before it
           * reached every subscriber: the notification settles as Failed, with
           * the pages sent in full recorded, so Retry resumes after them.
           */
          const sendFellShort: boolean = deliveryRecord.hasFailures();

          if (sendFellShort) {
            logger.debug(
              `Not every subscriber was sent the created notification of incident ${incident.id}.`,
              logAttributes,
            );

            await IncidentFeedService.createIncidentFeedItem({
              incidentId: incident.id!,
              projectId: incident.projectId!,
              incidentFeedEventType:
                IncidentFeedEventType.SubscriberNotificationSent,
              displayColor: Red500,
              feedInfoInMarkdown: `📧 **Subscriber Incident Created Notification Failed for some subscribers of [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()})**:
      Not every status page subscriber was sent the notification that this incident was created. Retry sends it to the status pages that were not sent it in full.`,
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
                sendWorkspaceNotification: false,
              },
            });
          } else if (deliveryRecord.hasMatchedAnySubscriber()) {
            logger.debug("Creating incident feed for subscriber notification");

            await IncidentFeedService.createIncidentFeedItem({
              incidentId: incident.id!,
              projectId: incident.projectId!,
              incidentFeedEventType:
                IncidentFeedEventType.SubscriberNotificationSent,
              displayColor: Blue500,
              feedInfoInMarkdown: incidentFeedText,
              /*
               * Each status page, the subject its email went out with, and
               * what was sent; then the custom field values sent.
               */
              moreInformationInMarkdown:
                [deliveryMarkdown, customFieldsSentMarkdown]
                  .filter(Boolean)
                  .join("\n\n") || undefined,
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

          await IncidentService.updateOneById({
            id: incident.id!,
            data: {
              subscriberNotificationStatusOnIncidentCreated: sendFellShort
                ? StatusPageSubscriberNotificationStatus.Failed
                : StatusPageSubscriberNotificationStatus.Success,
              // What was sent and failed on each status page.
              subscriberNotificationStatusMessage:
                deliveryRecord.toStatusMessage({
                  sentMessage: SENT_MESSAGE,
                  retryScope: SubscriberNotificationRetryScope.PagesNotYetSent,
                }),
              /*
               * Written in full even when no page was told: from now on the
               * incident has a record, and an empty one means nobody was told.
               * After a send that fell short, it is what Retry resumes after.
               */
              statusPagesNotifiedOnCreation: [...toldStatusPageIds],
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          logger.debug(
            `Incident ${incident.id} marked as ${sendFellShort ? "Failed" : "Success"} for subscriber notifications.`,
          );

          /*
           * Only after a send that reached everyone: one that fell short is
           * Failed, and its Retry sends to every page not yet told, including
           * any added in the meantime.
           */
          if (!sendFellShort) {
            await requeueForStatusPagesAddedWhileSending({
              incident: incident,
              visitedStatusPageIds: statusPages.map(
                (statusPage: StatusPage): string => {
                  return (statusPage.id?.toString() || "").toLowerCase();
                },
              ),
              toldStatusPageIds: toldStatusPageIds,
            });
          }
        } catch (err) {
          logger.error(err);

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
              subscriberNotificationStatusOnIncidentCreated:
                StatusPageSubscriberNotificationStatus.Failed,
              subscriberNotificationStatusMessage:
                err instanceof Error ? err.message : String(err),
              /*
               * The pages it did tell, so Retry resumes after them. Left alone
               * when the send failed before it read the record.
               */
              ...(notifiedStatusPageIds
                ? { statusPagesNotifiedOnCreation: [...notifiedStatusPageIds] }
                : {}),
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
        } finally {
          await projectSlot.release();
        }
      }
    },
  ),
);

/*
 * The pages told so far, written as each one is sent in full, so a send that
 * is interrupted before it settles - its worker crashes, or is redeployed -
 * still leaves the pages it finished, and Retry after the sweeper fails it
 * (StatusPageSubscriber:TimeoutStuckNotifications) resumes after them.
 *
 * A hook-free write: it fires none of the incident's 'on update' workflows,
 * realtime events or audit log entries, which a write per page through the
 * incident service would, and it does not change the version the claim and
 * the sweeper check. The status the send settles on writes the record once
 * more, through the service. Never throws: the record is written again then.
 */
async function recordNotifiedStatusPagesSoFar(data: {
  incident: Incident;
  toldStatusPageIds: Array<string>;
}): Promise<void> {
  try {
    await IncidentService.updateColumnsByIdWithoutHooks({
      id: data.incident.id!,
      data: {
        statusPagesNotifiedOnCreation: [...data.toldStatusPageIds],
      },
    });
  } catch (err) {
    logger.error(
      `Failed to record the status pages told so far about incident ${data.incident.id}: ${err}`,
    );
  }
}

/*
 * Status pages can be added to an incident's scope while its 'created'
 * notification is being sent. IncidentService leaves a notification that is
 * Pending or InProgress alone when that happens (see
 * IncidentScopeAddedPagesNotification): a queued send reads the scope when it
 * goes out. A send that is already running read it before the pages were
 * added, so once it has settled it reads the scope again, and queues itself
 * once more when it now reaches a page it neither visited nor has a record of
 * telling. The next run tells only those pages: everything else is in the
 * record or was looked at already.
 *
 * Pages that do not show incidents are left out: the next run would skip them
 * too. Never throws: the send it follows has already succeeded.
 */
async function requeueForStatusPagesAddedWhileSending(data: {
  incident: Incident;
  visitedStatusPageIds: Array<string>;
  toldStatusPageIds: Array<string>;
}): Promise<void> {
  try {
    const current: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [data.incident],
      });

    const addedWhileSending: Array<StatusPage> = current.statusPages.filter(
      (statusPage: StatusPage): boolean => {
        const id: string = (statusPage.id?.toString() || "").toLowerCase();

        return (
          Boolean(id) &&
          statusPage.showIncidentsOnStatusPage !== false &&
          !data.visitedStatusPageIds.includes(id) &&
          !data.toldStatusPageIds.includes(id)
        );
      },
    );

    if (addedWhileSending.length === 0) {
      return;
    }

    logger.debug(
      `Status pages were added to incident ${data.incident.id} while its created notification was being sent; queueing it again for ${addedWhileSending.length} page(s).`,
    );

    await IncidentService.updateOneById({
      id: data.incident.id!,
      data: {
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        subscriberNotificationStatusMessage:
          IncidentScopeAddedPagesNotification.addedWhileSendingMessage,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  } catch (err) {
    logger.error(
      `Failed to check incident ${data.incident.id} for status pages added while its created notification was being sent: ${err}`,
    );
  }
}
