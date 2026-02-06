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
import IncidentEpisodePublicNoteService from "Common/Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
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
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
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
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500 } from "Common/Types/BrandColors";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";

RunCron(
  "IncidentEpisodePublicNote:SendNotificationToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // First, mark public notes as Skipped if they should not be notified
    const notesToSkip: Array<IncidentEpisodePublicNote> =
      await IncidentEpisodePublicNoteService.findBy({
        query: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
        },
      });

    logger.debug(
      `Found ${notesToSkip.length} episode public note(s) to mark as Skipped (subscribers should not be notified).`,
    );

    for (const note of notesToSkip) {
      logger.debug(
        `Marking episode public note ${note.id} as Skipped for subscriber notifications.`,
      );
      await IncidentEpisodePublicNoteService.updateOneById({
        id: note.id!,
        data: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            "Notifications skipped as subscribers are not to be notified for this note.",
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
      logger.debug(
        `Episode public note ${note.id} marked as Skipped for subscriber notifications.`,
      );
    }

    // get all episode public notes that need notification

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const episodePublicNotes: Array<IncidentEpisodePublicNote> =
      await IncidentEpisodePublicNoteService.findBy({
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
          incidentEpisodeId: true,
          projectId: true,
        },
      });

    logger.debug(
      `Found ${episodePublicNotes.length} episode public note(s) to notify subscribers for.`,
    );

    for (const episodePublicNote of episodePublicNotes) {
      try {
        logger.debug(`Processing episode public note ${episodePublicNote.id}.`);
        if (!episodePublicNote.incidentEpisodeId) {
          logger.debug(
            `Episode public note ${episodePublicNote.id} has no incidentEpisodeId; skipping.`,
          );
          continue; // skip if incidentEpisodeId is not set
        }

        // get the episode
        const episode: IncidentEpisode | null =
          await IncidentEpisodeService.findOneById({
            id: episodePublicNote.incidentEpisodeId!,
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
              title: true,
              description: true,
              projectId: true,
              incidentSeverity: {
                name: true,
              },
              isVisibleOnStatusPage: true,
              episodeNumber: true,
              episodeNumberWithPrefix: true,
            },
          });

        if (!episode) {
          logger.debug(
            `Episode ${episodePublicNote.incidentEpisodeId} not found; marking public note ${episodePublicNote.id} as Skipped.`,
          );
          await IncidentEpisodePublicNoteService.updateOneById({
            id: episodePublicNote.id!,
            data: {
              subscriberNotificationStatusOnNoteCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Related episode not found. Skipping notifications to subscribers.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        // Get monitors from member incidents
        const episodeMembers: Array<IncidentEpisodeMember> =
          await IncidentEpisodeMemberService.findBy({
            query: {
              incidentEpisodeId: episode.id!,
            },
            select: {
              incident: {
                monitors: {
                  _id: true,
                },
              },
            },
            props: {
              isRoot: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          });

        // Collect all unique monitors from member incidents
        const monitorIds: Set<string> = new Set();
        for (const member of episodeMembers) {
          if (member.incident?.monitors) {
            for (const monitor of member.incident.monitors) {
              if (monitor._id) {
                monitorIds.add(monitor._id.toString());
              }
            }
          }
        }

        if (monitorIds.size === 0) {
          logger.debug(
            `Episode ${episode.id} has no monitors; marking public note ${episodePublicNote.id} as Skipped.`,
          );
          await IncidentEpisodePublicNoteService.updateOneById({
            id: episodePublicNote.id!,
            data: {
              subscriberNotificationStatusOnNoteCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "No monitors are attached to the incidents in this episode. Skipping notifications.",
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
          continue;
        }

        // Set status to InProgress
        await IncidentEpisodePublicNoteService.updateOneById({
          id: episodePublicNote.id!,
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
          `Episode public note ${episodePublicNote.id} status set to InProgress for subscriber notifications.`,
        );

        if (!episode.isVisibleOnStatusPage) {
          // Set status to Skipped for non-visible episodes
          logger.debug(
            `Episode ${episode.id} is not visible on status page; marking public note ${episodePublicNote.id} as Skipped.`,
          );
          await IncidentEpisodePublicNoteService.updateOneById({
            id: episodePublicNote.id!,
            data: {
              subscriberNotificationStatusOnNoteCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "Notifications skipped as episode is not visible on status page.",
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
                Array.from(monitorIds).map((id: string) => {
                  return new ObjectID(id);
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
          `Found ${statusPageResources.length} status page resource(s) for episode ${episode.id}.`,
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
          `Episode ${episode.id} maps to ${Object.keys(statusPageToResources).length} status page(s) for public note notifications.`,
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
            `Status page ${statuspage.id} hides episodes; skipping.`,
          );
          if (!statuspage.showEpisodesOnStatusPage) {
            continue; // Do not send notification to subscribers if episodes are not visible on status page.
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

          const episodeDetailsUrl: string =
            episode.id && statusPageURL
              ? URL.fromString(statusPageURL)
                  .addRoute(`/episodes/${episode.id.toString()}`)
                  .toString()
              : statusPageURL;

          logger.debug(
            `Status page ${statuspage.id} (${statusPageName}) has ${subscribers.length} subscriber(s) for public note ${episodePublicNote.id}.`,
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
                  StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.Email,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated,
                notificationMethod: StatusPageSubscriberNotificationMethod.SMS,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.Slack,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated,
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
            detailsUrl: episodeDetailsUrl,
            resourcesAffected: resourcesAffectedString,
            episodeSeverity: episode.incidentSeverity?.name || " - ",
            episodeTitle: episode.title || "",
            note: episodePublicNote.note || "",
          };

          // Prepare SMS-specific template variables with plain text (no HTML/Markdown)
          const smsTemplateVariables: Record<string, string> = {
            ...templateVariables,
            note: Markdown.convertToPlainText(episodePublicNote.note || ""),
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
                eventType: StatusPageEventType.Incident, // Episodes use incident event type
              });

            if (!shouldNotifySubscriber) {
              logger.debug(
                `Skipping subscriber ${subscriber._id} based on preferences for public note ${episodePublicNote.id}.`,
              );
              continue;
            }

            const unsubscribeUrl: string =
              StatusPageSubscriberService.getUnsubscribeLink(
                URL.fromString(statusPageURL),
                subscriber.id!,
              ).toString();

            logger.debug(
              `Prepared unsubscribe link for subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
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
                `Queueing SMS notification to subscriber ${subscriber._id} at ${phoneMasked} for public note ${episodePublicNote.id}.`,
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
                smsMessage = `Incident update: ${episode.title || "-"} on ${statusPageName}. A new note is posted. Details: ${episodeDetailsUrl}. Unsub: ${unsubscribeUrl}`;
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
              }).catch((err: Error) => {
                logger.error(err);
              });
            }

            if (subscriber.subscriberEmail) {
              // send email here.
              logger.debug(
                `Queueing email notification to subscriber ${subscriber._id} at ${subscriber.subscriberEmail} for public note ${episodePublicNote.id}.`,
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
                  : "[Incident Update] " + episode.title || "";

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
                      EmailTemplateType.SubscriberEpisodeNoteCreated,
                    vars: {
                      note: await Markdown.convertToHTML(
                        episodePublicNote.note!,
                        MarkdownContentType.Email,
                      ),
                      statusPageName: statusPageName,
                      statusPageUrl: statusPageURL,
                      detailsUrl: episodeDetailsUrl,
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
                      episodeSeverity: episode.incidentSeverity?.name || " - ",
                      episodeTitle: episode.title || "",
                      episodeDescription: episode.description || "",
                      unsubscribeUrl: unsubscribeUrl,
                      subscriberEmailNotificationFooterText:
                        StatusPageServiceType.getSubscriberEmailFooterText(
                          statuspage,
                        ),
                    },
                    subject: "[Incident Update] " + episode.title,
                  },
                  {
                    mailServer: ProjectSmtpConfigService.toEmailServer(
                      statuspage.smtpConfig,
                    ),
                    projectId: statuspage.projectId,
                    statusPageId: statuspage.id!,
                  },
                ).catch((err: Error) => {
                  logger.error(err);
                });
              }
              logger.debug(
                `Email notification queued for subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
              );
            }

            if (subscriber.slackIncomingWebhookUrl) {
              // send slack message here.
              logger.debug(
                `Queueing Slack notification to subscriber ${subscriber._id} via incoming webhook for public note ${episodePublicNote.id}.`,
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
                markdownMessage = `## Incident - ${episode.title || ""}

**New note has been added to an incident**

**Resources Affected:** ${resourcesAffectedString}
**Severity:** ${episode.incidentSeverity?.name || " - "}

**Note:**
${episodePublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
              }

              SlackUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.slackIncomingWebhookUrl,
                text: SlackUtil.convertMarkdownToSlackRichText(markdownMessage),
              }).catch((err: Error) => {
                logger.error(err);
              });
              logger.debug(
                `Slack notification queued for subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
              );
            }

            if (subscriber.microsoftTeamsIncomingWebhookUrl) {
              // send Teams message here.
              logger.debug(
                `Queueing Microsoft Teams notification to subscriber ${subscriber._id} via incoming webhook for public note ${episodePublicNote.id}.`,
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
                markdownMessage = `## Incident - ${episode.title || ""}

**New note has been added to an incident**

**Resources Affected:** ${resourcesAffectedString}
**Severity:** ${episode.incidentSeverity?.name || " - "}

**Note:**
${episodePublicNote.note || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
              }

              MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
                url: subscriber.microsoftTeamsIncomingWebhookUrl,
                text: markdownMessage,
              }).catch((err: Error) => {
                logger.error(err);
              });
              logger.debug(
                `Microsoft Teams notification queued for subscriber ${subscriber._id} for public note ${episodePublicNote.id}.`,
              );
            }
          }
        }

        logger.debug(
          `Notification sent to subscribers for public note added to episode: ${episode.id}`,
        );

        await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
          incidentEpisodeId: episode.id!,
          projectId: episode.projectId!,
          incidentEpisodeFeedEventType:
            IncidentEpisodeFeedEventType.SubscriberNotificationSent,
          displayColor: Blue500,
          feedInfoInMarkdown: `📧 **Notification sent to subscribers** because a public note is added to this [Episode ${episode.episodeNumberWithPrefix || '#' + episode.episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(episode.projectId!, episode.id!)).toString()}).`,
          moreInformationInMarkdown: `**Public Note:**

${episodePublicNote.note}`,
        });

        logger.debug("Episode Feed created");

        // Set status to Success after successful notification
        await IncidentEpisodePublicNoteService.updateOneById({
          id: episodePublicNote.id!,
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
          `Episode public note ${episodePublicNote.id} marked as Success for subscriber notifications.`,
        );
      } catch (err) {
        logger.error(
          `Error sending notification for episode public note ${episodePublicNote.id}: ${err}`,
        );

        // Set status to Failed with error reason
        await IncidentEpisodePublicNoteService.updateOneById({
          id: episodePublicNote.id!,
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
