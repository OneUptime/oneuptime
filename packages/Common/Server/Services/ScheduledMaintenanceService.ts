import DatabaseConfig from "../DatabaseConfig";
import ServiceType from "../../Types/Telemetry/ServiceType";
import MeasurementMetricWriter from "../Utils/Measurement/MeasurementMetricWriter";
import NumberPrefixUtil from "../../Utils/Project/NumberPrefix";
import ScheduledMaintenanceMeasurementService from "./ScheduledMaintenanceMeasurementService";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ProjectReferencesService from "./ProjectReferencesService";
import ScheduledMaintenanceCustomField from "../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import CustomFieldMappingService from "./CustomFieldMappingService";
import MonitorService from "./MonitorService";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceRelation,
} from "../Utils/AffectedResources/LinkedAffectedResources";
import ScheduledMaintenanceOwnerTeamService from "./ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "./ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "./ScheduledMaintenanceStateTimelineService";
import ScheduledMaintenanceMeasurementValueService from "./ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceReminderRuleService from "./ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceReminderRule from "../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import TeamMemberService from "./TeamMemberService";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import {
  escapeMarkdownInline,
  escapeMarkdownValue,
} from "../../Utils/Markdown/MarkdownEscape";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Model from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerTeam from "../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import MonitorStatusService from "./MonitorStatusService";
import ProjectScopedReferenceValidator, {
  getWrittenRelationReferences,
  HeldRelationIds,
  ProjectScopedReference,
  ProjectScopedRelation,
  resolveReferenceIds,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import {
  getAffectedResourceColumns,
  getAffectedResourceRelations,
} from "../Utils/Database/AffectedResourceRelations";
import Query from "../Types/Database/Query";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ScheduledMaintenanceStateTimeline from "../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import User from "../../Models/DatabaseModels/User";
import Recurring from "../../Types/Events/Recurring";
import OneUptimeDate from "../../Types/Date";
import UpdateBy from "../Types/Database/UpdateBy";
import Dictionary from "../../Types/Dictionary";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import SMS from "../../Types/SMS/SMS";
import MailService from "../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "../../Server/Services/ProjectSmtpConfigService";
import SmsService from "../../Server/Services/SmsService";
import AffectedStatusPageResources from "../Utils/StatusPage/AffectedStatusPageResources";
import StatusPageService from "../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberUnsubscribe from "../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import QueryHelper from "../../Server/Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "../../Server/Types/Markdown";
import logger, { LogAttributes } from "../../Server/Utils/Logger";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../Models/DatabaseModels/StatusPageSubscriber";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import { IsBillingEnabled } from "../EnvironmentConfig";
import StatusPageEventType from "../../Types/StatusPage/StatusPageEventType";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import ScheduledMaintenanceLabelRuleEngineService from "./ScheduledMaintenanceLabelRuleEngineService";
import ScheduledMaintenanceOwnerRuleEngineService from "./ScheduledMaintenanceOwnerRuleEngineService";
import RunbookRuleEngineService from "./RunbookRuleEngineService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import StatusPageSubscriberWebhookUtil from "../Utils/StatusPageSubscriberWebhook";
import { Gray500, Red500 } from "../../Types/BrandColors";
import Label from "../../Models/DatabaseModels/Label";
import LabelService from "./LabelService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { MessageBlocksByWorkspaceType } from "./WorkspaceNotificationRuleService";
import ScheduledMaintenanceWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/ScheduledMaintenance";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OwnerRuleAssignment from "../Utils/Rules/OwnerRuleAssignment";
import ProjectService from "./ProjectService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "./StatusPageSubscriberNotificationTemplateService";
import StatusPageResourceUtil from "../Utils/StatusPageResource";
import SafeHtml from "../../Types/SafeHtml";
import StatusPageSubscriberNotificationTemplate from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import Select from "../Types/Database/Select";
import StatusPageEmailLogo from "../Utils/StatusPage/StatusPageEmailLogo";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceStartUtil from "../../Utils/ScheduledMaintenanceStart";
import EventFieldChange from "../Utils/EventFieldChange";
import ReferenceChange from "../Utils/Database/ReferenceChange";
import ScheduledMaintenanceFieldChange, {
  ScheduledMaintenanceFieldSet,
  ScheduledMaintenanceValuesBeforeUpdate,
} from "../Utils/ScheduledMaintenance/ScheduledMaintenanceFieldChange";

/*
 * The attachments whose membership an ongoing event acts on. Monitors are
 * put into maintenance by a flag and a status written onto them, and network
 * sites by re-rolling the chains above them, so an edit to either list while
 * the window runs has to do what the state transition did for the old list.
 */
type AttachmentColumn = "monitors" | "networkSites";

const ATTACHMENT_COLUMNS: Array<AttachmentColumn> = [
  "monitors",
  "networkSites",
];

/*
 * Enough of a state to tell which kind it is. A project can add its own
 * states between the built-in ones, and those are none of the four kinds.
 */
const STATE_KIND_SELECT: Select<ScheduledMaintenanceState> = {
  _id: true,
  isScheduledState: true,
  isOngoingState: true,
  isEndedState: true,
  isResolvedState: true,
};

/*
 * A state with its place in the project's list as well: what tells whether
 * an event in a state of the project's own has started
 * (ScheduledMaintenanceStartUtil).
 */
const STATE_PLACE_SELECT: Select<ScheduledMaintenanceState> = {
  ...STATE_KIND_SELECT,
  order: true,
};

/*
 * What onBeforeUpdate hands to onUpdateSuccess for one event the update
 * matched: the lists the event held just before the write, and what its
 * state meant for them. The state after the write can differ - the same
 * update can move the event, and so can the ChangeStateToOngoing job or
 * another request between this read and the write - so
 * applyAttachmentChangeToEvent weighs both.
 *
 * Only the ids the event held are kept, not the ids the payload asked for.
 * The write drops list entries it cannot read as an id (see
 * DatabaseService.sanitizeCreateOrUpdate), so the payload can name a
 * monitor that never gets attached, or leave out one it seems to keep. What
 * changed is read back from the event after the write instead.
 */
type AttachmentsBeforeUpdate = {
  projectId: ObjectID | undefined;
  // Live ongoing: what suppresses the event's network sites.
  wasOngoingBeforeUpdate: boolean;
  // Ongoing, or past it without having ended: what keeps monitors disabled.
  wasHoldingMonitorsBeforeUpdate: boolean;
  // Undefined when the update does not write that list.
  monitorIdsBeforeUpdate: Array<ObjectID> | undefined;
  networkSiteIdsBeforeUpdate: Array<ObjectID> | undefined;
};

// Keyed by event id.
type AttachmentsCarryForward = Dictionary<AttachmentsBeforeUpdate>;

/*
 * The Change Monitor Status to one event the update matched held just
 * before the write, read when the update writes it under either name
 * (getMonitorStatusBeforeUpdate). onUpdateSuccess compares it with what the
 * write stored: only a real change is named in the feed, and put on the
 * monitors of an event that started in between.
 */
type MonitorStatusBeforeUpdate = {
  projectId: ObjectID | undefined;
  // Lower-cased (toMonitorStatusKey); null when it held none.
  monitorStatusId: string | null;
};

/*
 * What onBeforeUpdate hands to onUpdateSuccess, each part keyed by event id
 * and null unless the update writes what it is read for. The whole of it is
 * null when none is.
 */
type UpdateCarryForward = {
  attachments: AttachmentsCarryForward | null;
  monitorStatus: Dictionary<MonitorStatusBeforeUpdate> | null;
  /*
   * The event's own compared columns the update writes - its title,
   * window, description, reminders before the event, labels and Send
   * reminders switch - as it held them (recordStoredValuesBeforeUpdate).
   */
  valuesBeforeUpdate: Dictionary<ScheduledMaintenanceValuesBeforeUpdate> | null;
  /*
   * The ids each event held in each list the update writes - its status
   * pages and what it affects - by the list's column, normalized
   * (ReferenceChange.normalizeList).
   */
  listIdsBeforeUpdate: Dictionary<Dictionary<Array<string>>> | null;
};

/*
 * What the one stored read before the write found: the Change Monitor
 * Status to each event held, when the update writes it, and the compared
 * columns the update writes. Each part is keyed by event id, and null
 * unless the update writes what it is read for.
 */
type StoredValuesBeforeUpdate = {
  monitorStatus: Dictionary<MonitorStatusBeforeUpdate> | null;
  valuesBeforeUpdate: Dictionary<ScheduledMaintenanceValuesBeforeUpdate> | null;
};

// What the reads of the lists the update writes found, one read per list.
type ListsBeforeUpdate = {
  attachments: AttachmentsCarryForward | null;
  listIdsBeforeUpdate: Dictionary<Dictionary<Array<string>>> | null;
};

/*
 * The two names of an event's state, ID column first. A write may name it
 * under either, and the two must agree (RelationIdUtil.readConsistent), so
 * the state the service acts on is the state stored.
 */
const STATE_KEYS: Array<string> = [
  "currentScheduledMaintenanceStateId",
  "currentScheduledMaintenanceState",
];

/*
 * The two names of the monitor status an event changes its monitors to when
 * it starts (Change Monitor Status to), ID column first. They must agree too.
 */
const MONITOR_STATUS_KEYS: Array<string> = [
  "changeMonitorStatusToId",
  "changeMonitorStatusTo",
];

/*
 * What a change to an event's Change Monitor Status to gets once the event
 * has started (getMonitorStatusBeforeUpdate) - from the dashboard, the API,
 * Terraform or a workflow alike.
 */
export const MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE: string =
  "Change Monitor Status to can no longer be changed: this event has already started.";

/*
 * What the write actually attached to and detached from one event, from its
 * lists before and after.
 */
type AttachmentChange = {
  monitorsAdded: Array<ObjectID>;
  monitorsRemoved: Array<ObjectID>;
  // Attached or detached - both edges re-roll the same way.
  networkSitesChanged: Array<ObjectID>;
  /*
   * The event as read back with its monitors, carrying the state it is in
   * now and the status it applies. Null when the monitors were not written.
   */
  eventAfterUpdate: Model | null;
};

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * The monitor status to switch to, the monitors, the labels, the status
   * pages and the affected-resource lists are checked by this service's own
   * hooks below, with ProjectScopedReferenceValidator and its own words.
   * Everything else an event names - its state, say - is checked by
   * ProjectReferencesService.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return ["changeMonitorStatusTo"];
  }

  protected override getListsCheckedByService(): Array<string> {
    return [
      "monitors",
      "labels",
      "statusPages",
      ...getAffectedResourceColumns(this.getModel()),
    ];
  }

  @CaptureSpan()
  public async notififySubscribersOnEventScheduled(
    scheduledEvents: Array<Model>,
  ): Promise<void> {
    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Running",
    );

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const event of scheduledEvents) {
      // get status page resources from monitors.

      logger.debug(
        "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Sending notification for event: " +
          event.id,
        {
          projectId: event.projectId?.toString(),
          scheduledMaintenanceId: event.id?.toString(),
        } as LogAttributes,
      );

      /*
       * The resources the event affects on each status page: its monitors,
       * and the monitor groups that hold them.
       */
      const statusPageToResources: Dictionary<Array<StatusPageResource>> =
        await AffectedStatusPageResources.findForMonitors({
          monitors: event.monitors || [],
          statusPages: event.statusPages || [],
          select: {
            _id: true,
            displayName: true,
            statusPageId: true,
          },
        });

      const statusPages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification(
          event.statusPages?.map((i: StatusPage) => {
            return i.id!;
          }) || [],
        );

      /*
       * The description does not vary per status page or per subscriber, so
       * it is converted once per event: HTML for email bodies, plain text for
       * SMS and email subjects. Slack gets the Markdown as written.
       */
      const eventDescriptionHtml: string = await Markdown.convertToHTML(
        event.description || "",
        MarkdownContentType.Email,
      );
      const eventDescriptionPlainText: string = Markdown.convertToPlainText(
        event.description || "",
      );

      for (const statuspage of statusPages) {
        if (!statuspage.id) {
          continue;
        }

        if (!statuspage.showScheduledMaintenanceEventsOnStatusPage) {
          continue; // Do not send notification to subscribers if scheduledMaintenances are not visible on status page.
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

        const scheduledEventDetailsUrl: string =
          event.id && statusPageURL
            ? URL.fromString(statusPageURL)
                .addRoute(`/scheduled-events/${event.id.toString()}`)
                .toString()
            : statusPageURL;

        // Send email to Email subscribers.

        /*
         * The resources are read without their groups, so both forms are the
         * names joined by commas. The HTML one, for email bodies, has every
         * name escaped; SMS, Slack, subjects and webhooks get the names as
         * written.
         */
        const resourcesAffected: string =
          StatusPageResourceUtil.getResourcesGroupedByGroupNameAsPlainText(
            statusPageToResources[statuspage._id!] || [],
          );
        const resourcesAffectedHtml: string =
          StatusPageResourceUtil.getResourcesGroupedByGroupName(
            statusPageToResources[statuspage._id!] || [],
          );

        // Fetch custom templates for each notification method
        const [
          emailTemplate,
          smsTemplate,
          slackTemplate,
        ]: Array<StatusPageSubscriberNotificationTemplate | null> =
          await Promise.all([
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.Email,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
                notificationMethod: StatusPageSubscriberNotificationMethod.SMS,
              },
            ),
            StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
              {
                statusPageId: statuspage.id!,
                eventType:
                  StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
                notificationMethod:
                  StatusPageSubscriberNotificationMethod.Slack,
              },
            ),
          ]);

        for (const subscriber of subscribers) {
          if (!subscriber._id) {
            continue;
          }

          const shouldNotifySubscriber: boolean =
            StatusPageSubscriberService.shouldSendNotification({
              subscriber: subscriber,
              statusPageResources: statusPageToResources[statuspage._id!] || [],
              statusPage: statuspage,
              eventType: StatusPageEventType.ScheduledEvent,
            });

          if (!shouldNotifySubscriber) {
            continue;
          }

          const unsubscribeUrl: string =
            StatusPageSubscriberService.getUnsubscribeLink(
              URL.fromString(statusPageURL),
              subscriber,
            ).toString();

          // Template variables for custom templates, as Markdown (Slack)
          const templateVariables: Record<string, string> = {
            statusPageName: statusPageName,
            statusPageUrl: statusPageURL,
            detailsUrl: scheduledEventDetailsUrl,
            scheduledMaintenanceTitle: event.title || "",
            scheduledMaintenanceDescription: event.description || "",
            scheduledStartTime:
              OneUptimeDate.getDateAsUserFriendlyFormattedString(
                event.startsAt!,
              ),
            scheduledEndTime: event.endsAt
              ? OneUptimeDate.getDateAsUserFriendlyFormattedString(event.endsAt)
              : "",
            resourcesAffected: resourcesAffected,
            unsubscribeUrl: unsubscribeUrl,
          };

          // Template variables for SMS and email subjects, as plain text
          const plainTextTemplateVariables: Record<string, string> = {
            ...templateVariables,
            scheduledMaintenanceDescription: eventDescriptionPlainText,
          };

          if (subscriber.subscriberPhone) {
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

            if (
              smsTemplate &&
              smsTemplate.templateBody &&
              statuspage.callSmsConfig
            ) {
              // Use custom template only when custom Twilio is configured
              smsMessage =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  smsTemplate.templateBody,
                  {
                    ...plainTextTemplateVariables,
                    unsubscribeUrl: smsUnsubscribeUrl,
                  },
                );
            } else {
              // Use default template
              smsMessage = `Scheduled Maintenance: ${event.title || ""} on ${statusPageName}.${resourcesAffected ? ` Impact: ${resourcesAffected}.` : ""} Details: ${scheduledEventDetailsUrl}. Unsub: ${smsUnsubscribeUrl}`;
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
              scheduledMaintenanceId: event.id!,
            }).catch((err: Error) => {
              logger.error(err, {
                projectId: statuspage.projectId?.toString(),
              } as LogAttributes);
            });
          }

          if (subscriber.slackIncomingWebhookUrl) {
            let slackMessage: string;

            if (slackTemplate && slackTemplate.templateBody) {
              // Use custom template
              slackMessage =
                StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                  slackTemplate.templateBody,
                  templateVariables,
                );
            } else {
              // Use default template
              slackMessage = `## 🔧 Scheduled Maintenance - ${event.title || ""}

**Scheduled Date:** ${OneUptimeDate.getDateAsUserFriendlyFormattedString(event.startsAt!)}

${resourcesAffected ? `**Resources Affected:** ${resourcesAffected}` : ""}

**Description:** ${event.description || ""}

[View Status Page](${statusPageURL}) | [Unsubscribe](${unsubscribeUrl})`;
            }

            // send Slack notification here.
            SlackUtil.sendMessageToChannelViaIncomingWebhook({
              url: subscriber.slackIncomingWebhookUrl,
              text: SlackUtil.convertMarkdownToSlackRichText(slackMessage),
            }).catch((err: Error) => {
              logger.error(err, {
                projectId: statuspage.projectId?.toString(),
              } as LogAttributes);
            });
          }

          if (subscriber.subscriberWebhook) {
            StatusPageSubscriberWebhookUtil.sendWebhookNotification({
              webhookUrl: subscriber.subscriberWebhook,
              payload: {
                eventType: "ScheduledMaintenanceCreated",
                statusPageId: statuspage.id!.toString(),
                statusPageName: statusPageName,
                statusPageUrl: statusPageURL,
                unsubscribeUrl: unsubscribeUrl,
                data: {
                  scheduledMaintenanceId: event.id?.toString() || "",
                  scheduledMaintenanceTitle: event.title || "",
                  scheduledMaintenanceDescription: event.description || "",
                  scheduledStartTime:
                    OneUptimeDate.getDateAsUserFriendlyFormattedString(
                      event.startsAt!,
                    ),
                  scheduledEndTime: event.endsAt
                    ? OneUptimeDate.getDateAsUserFriendlyFormattedString(
                        event.endsAt,
                      )
                    : "",
                  resourcesAffected: resourcesAffected,
                  detailsUrl: scheduledEventDetailsUrl,
                },
              },
            }).catch((err: Error) => {
              logger.error(err, {
                projectId: statuspage.projectId?.toString(),
              } as LogAttributes);
            });
          }

          if (subscriber.subscriberEmail) {
            // send email here.

            const scheduledAtHtml: string =
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: event.startsAt!,
                timezones: statuspage.subscriberTimezones || [],
                use12HourFormat: true,
              });

            /*
             * The default template's variables. resourcesAffected,
             * scheduledAt and eventDescription are HTML (the template puts
             * them in its raw-HTML slot); the footer is HTML the status
             * page's admins wrote, as they write the template. Everything
             * else is plain text, which the template escapes.
             */
            const emailVars: Record<string, string> = {
              statusPageName: statusPageName,
              statusPageUrl: statusPageURL,
              detailsUrl: scheduledEventDetailsUrl,
              logoUrl: StatusPageEmailLogo.getLogoUrl({
                statusPage: statuspage,
                host: host,
                httpProtocol: httpProtocol,
              }),
              isPublicStatusPage: statuspage.isPublicStatusPage
                ? "true"
                : "false",
              subscriberEmailNotificationFooterText:
                statuspage.subscriberEmailNotificationFooterText || "",
              resourcesAffected: resourcesAffectedHtml,
              scheduledAt: scheduledAtHtml,
              eventTitle: event.title || "",
              eventDescription: eventDescriptionHtml,
              unsubscribeUrl: unsubscribeUrl,
            };

            // Check for custom email template - only use when custom SMTP is configured
            if (
              emailTemplate &&
              emailTemplate.templateBody &&
              statuspage.smtpConfig
            ) {
              /*
               * Use custom template with BlankTemplate only when custom SMTP
               * is configured. The body is HTML, so the description is too.
               * The subject is plain text, including the email-only
               * variables that are HTML in the body.
               *
               * In the body, the plain values are escaped
               * (compileEmailBodyTemplate) and only the ones wrapped in
               * SafeHtml below go in as HTML.
               */
              const customEmailBody: string =
                StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate(
                  emailTemplate.templateBody,
                  {
                    ...templateVariables,
                    ...emailVars,
                    resourcesAffected: SafeHtml.fromTrustedHtml(
                      resourcesAffectedHtml,
                    ),
                    scheduledAt: SafeHtml.fromTrustedHtml(scheduledAtHtml),
                    eventDescription:
                      SafeHtml.fromTrustedHtml(eventDescriptionHtml),
                    scheduledMaintenanceDescription:
                      SafeHtml.fromTrustedHtml(eventDescriptionHtml),
                    subscriberEmailNotificationFooterText:
                      SafeHtml.fromTrustedHtml(
                        emailVars["subscriberEmailNotificationFooterText"],
                      ),
                  },
                );
              const customEmailSubject: string = emailTemplate.emailSubject
                ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                    emailTemplate.emailSubject,
                    {
                      ...emailVars,
                      ...plainTextTemplateVariables,
                      eventDescription: eventDescriptionPlainText,
                      scheduledAt:
                        OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones(
                          {
                            date: event.startsAt!,
                            timezones: statuspage.subscriberTimezones || [],
                            use12HourFormat: true,
                          },
                        ).join(", "),
                    },
                  )
                : "[Scheduled Maintenance] " + (event.title || statusPageName);

              MailService.sendMail(
                {
                  toEmail: subscriber.subscriberEmail,
                  templateType: EmailTemplateType.BlankTemplate,
                  vars: {
                    body: customEmailBody,
                  },
                  subject: customEmailSubject,
                  isSubjectLiteral: true,
                },
                {
                  mailServer: ProjectSmtpConfigService.toEmailServer(
                    statuspage.smtpConfig,
                  ),
                  projectId: statuspage.projectId!,
                  statusPageId: statuspage.id!,
                  scheduledMaintenanceId: event.id!,
                },
              ).catch((err: Error) => {
                logger.error(err, {
                  projectId: statuspage.projectId?.toString(),
                } as LogAttributes);
              });
            } else {
              // Use default hard-coded template
              MailService.sendMail(
                {
                  toEmail: subscriber.subscriberEmail,
                  templateType:
                    EmailTemplateType.SubscriberScheduledMaintenanceEventCreated,
                  vars: emailVars,
                  subject:
                    "[Scheduled Maintenance] " +
                    (event.title || statusPageName),
                  isSubjectLiteral: true,
                },
                {
                  mailServer: ProjectSmtpConfigService.toEmailServer(
                    statuspage.smtpConfig,
                  ),
                  projectId: statuspage.projectId!,
                  statusPageId: statuspage.id!,
                  scheduledMaintenanceId: event.id!,
                },
              ).catch((err: Error) => {
                logger.error(err, {
                  projectId: statuspage.projectId?.toString(),
                } as LogAttributes);
              });
            }
          }
        }
      }
    }

    logger.debug(
      "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Completed",
    );
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (
      updateBy.query._id &&
      (updateBy.data.sendSubscriberNotificationsOnBeforeTheEvent ||
        updateBy.data.startsAt)
    ) {
      logger.debug(
        `Calculating nextSubscriberNotificationBeforeTheEventAt for Scheduled Maintenance: ${updateBy.query.id}`,
      );

      const scheduledMaintenance: Model | null = await this.findOneById({
        id: updateBy.query._id! as ObjectID,
        select: {
          startsAt: true,
          sendSubscriberNotificationsOnBeforeTheEvent: true,
        },
        props: {
          isRoot: true,
        },
      });

      logger.debug(
        `Current Scheduled Maintenance data: ${JSON.stringify(scheduledMaintenance)}`,
      );

      if (!scheduledMaintenance) {
        throw new BadDataException("Scheduled Maintenance Event not found");
      }

      const startsAt: Date =
        (updateBy.data.startsAt as Date) ||
        (scheduledMaintenance.startsAt! as Date);

      let notificationSettings: Array<Recurring> | null = null;

      const updatedNotificationSettings: Array<Recurring> | null | undefined =
        updateBy.data.sendSubscriberNotificationsOnBeforeTheEvent as
          | Array<Recurring>
          | null
          | undefined;

      if (
        updatedNotificationSettings !== null &&
        updatedNotificationSettings !== undefined
      ) {
        notificationSettings = updatedNotificationSettings;
      } else {
        const existingNotificationSettings:
          | Array<Recurring>
          | null
          | undefined =
          scheduledMaintenance.sendSubscriberNotificationsOnBeforeTheEvent as
            | Array<Recurring>
            | null
            | undefined;

        if (
          existingNotificationSettings !== null &&
          existingNotificationSettings !== undefined
        ) {
          notificationSettings = existingNotificationSettings;
        }
      }

      logger.debug(
        `Using startsAt: ${startsAt} and notificationSettings: ${JSON.stringify(notificationSettings)}`,
      );

      if (!notificationSettings || notificationSettings.length === 0) {
        logger.debug(
          "No subscriber notification schedule configured. Clearing nextSubscriberNotificationBeforeTheEventAt.",
        );
        updateBy.data.nextSubscriberNotificationBeforeTheEventAt = null;
      } else {
        const nextTimeToNotifyBeforeTheEvent: Date | null =
          this.getNextTimeToNotify({
            eventScheduledDate: startsAt,
            sendSubscriberNotifiationsOn: notificationSettings,
          });

        updateBy.data.nextSubscriberNotificationBeforeTheEventAt =
          nextTimeToNotifyBeforeTheEvent;

        logger.debug(
          `nextSubscriberNotificationBeforeTheEventAt set to: ${nextTimeToNotifyBeforeTheEvent}`,
        );
      }
    }

    /*
     * Notifying subscribers that the event was scheduled
     * (shouldStatusPageSubscribersBeNotifiedOnEventCreated) is decided when
     * it is created. An update that writes it - only root and master admins
     * can - leaves the 'scheduled' message alone: re-sending the value the
     * event holds used to send that message to every subscriber again, and
     * turning it on does not send a message the event was created without.
     * Turned off, a message still queued is skipped by the job that would
     * send it, which reads the flag.
     */

    await this.validateProjectScopedReferences(updateBy);

    /*
     * The one stored read of the event's own columns the update writes. A
     * change of Change Monitor Status to is refused here once the event has
     * started.
     */
    const storedValues: StoredValuesBeforeUpdate =
      await this.recordStoredValuesBeforeUpdate(updateBy);

    /*
     * Read before the write, because afterwards the detached monitors are no
     * longer on the event and nothing else remembers them.
     */
    const listsBeforeUpdate: ListsBeforeUpdate =
      await this.getListsBeforeUpdate(updateBy);

    /*
     * Re-apply mapped custom field values. Covers the Custom Fields modal
     * saving the whole bag back over a mapped value, and the event's monitors
     * changing — both change what a mapped field should hold, and folding the
     * answer into this payload keeps it one write with a truthful audit entry.
     */
    await CustomFieldMappingService.applyMappingsToUpdate({
      definitionModelType: ScheduledMaintenanceCustomField,
      updateBy: updateBy,
    });

    const carryForward: UpdateCarryForward | null =
      listsBeforeUpdate.attachments ||
      listsBeforeUpdate.listIdsBeforeUpdate ||
      storedValues.monitorStatus ||
      storedValues.valuesBeforeUpdate
        ? {
            attachments: listsBeforeUpdate.attachments,
            monitorStatus: storedValues.monitorStatus,
            valuesBeforeUpdate: storedValues.valuesBeforeUpdate,
            listIdsBeforeUpdate: listsBeforeUpdate.listIdsBeforeUpdate,
          }
        : null;

    return {
      updateBy,
      carryForward: carryForward,
    };
  }

  /*
   * CHANGE MONITOR STATUS TO CAN BE CHANGED UNTIL THE EVENT STARTS.
   *
   * An event's monitors change to that status when it starts - the move into
   * its ongoing state reads it then (ScheduledMaintenanceStateTimelineService)
   * - and back to operational when it ends. So whoever may edit the event can
   * change it, under either name, while the event waits to start. Once the
   * event has started (ScheduledMaintenanceStartUtil: ongoing, ended,
   * completed, or a state of the project's own after Ongoing) a change is
   * refused, for every event the update matches, with one plain message
   * (MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE): its monitors were moved by
   * the status it held, and would not follow a new one.
   *
   * Sending back the status an event already holds is no change, and goes
   * through whatever the event's state: a form or an API client that sends a
   * whole record back is not refused for a field it did not touch.
   *
   * The status each event the update matches held just before the write is
   * read in the one stored read below (recordStoredValuesBeforeUpdate), only
   * when the update writes it, and checked here, event by event. Returns
   * what that event held, for onUpdateSuccess.
   */
  private async assertMonitorStatusMayChange(data: {
    // Read with its Change Monitor Status to and its state's place and flags.
    scheduledMaintenanceEvent: Model;
    // What the update writes (toMonitorStatusKey).
    newMonitorStatusId: string | null;
    statesByProjectId: Map<string, Array<ScheduledMaintenanceState>>;
  }): Promise<MonitorStatusBeforeUpdate> {
    const scheduledMaintenanceEvent: Model = data.scheduledMaintenanceEvent;

    const storedMonitorStatusId: string | null = this.toMonitorStatusKey(
      scheduledMaintenanceEvent.changeMonitorStatusToId,
    );

    if (
      storedMonitorStatusId !== data.newMonitorStatusId &&
      (await this.hasScheduledMaintenanceStarted({
        scheduledMaintenanceEvent: scheduledMaintenanceEvent,
        statesByProjectId: data.statesByProjectId,
      }))
    ) {
      throw new BadDataException(MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE);
    }

    return {
      projectId: scheduledMaintenanceEvent.projectId,
      monitorStatusId: storedMonitorStatusId,
    };
  }

  /*
   * What onUpdateSuccess compares an update with: each event it matches as
   * it is stored, read here, before the write, so a feed line and a
   * reminder refresh follow a real change only. Updates often write back
   * what an event holds - the Maintenance Details card sends the title, the
   * window, the labels, the status pages and the reminders before the event
   * with every save, and an API client, Terraform or a workflow may write
   * the whole event. One read, of the event's own columns the update needs
   * compared and no others, and only when it needs any:
   *
   * - Change Monitor Status to, with the state the event is in, when the
   *   update writes it under either name: a change is refused once the
   *   event has started (assertMonitorStatusMayChange), and a real change
   *   is named in the feed;
   * - the title, the window, the description, the reminders before the
   *   event, the labels and the Send reminders switch the update writes
   *   (ScheduledMaintenanceFieldChange). The "updated" feed item records
   *   each one that really changed, and a labels change or the switch
   *   flipped matches the reminder rule again, which starts the reminder
   *   interval over.
   *
   * The event's other lists - the status pages and what it affects - are
   * read one list at a time (getListsBeforeUpdate). Read as root but held to
   * the tenant's project, like the other update reads here; the permission
   * checks that narrow the write run after this hook, and onUpdateSuccess
   * only visits the rows actually written.
   */
  private async recordStoredValuesBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<StoredValuesBeforeUpdate> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    const isMonitorStatusWritten: boolean = RelationIdUtil.isPresent(
      data,
      MONITOR_STATUS_KEYS,
    );

    const fieldsWritten: ScheduledMaintenanceFieldSet =
      ScheduledMaintenanceFieldChange.getFieldsWritten(data);

    const isFieldWritten: boolean =
      ScheduledMaintenanceFieldChange.isAnySet(fieldsWritten);

    if (!isMonitorStatusWritten && !isFieldWritten) {
      return {
        monitorStatus: null,
        valuesBeforeUpdate: null,
      };
    }

    // Two names that disagree are refused before anything is read.
    const newMonitorStatusId: string | null = isMonitorStatusWritten
      ? this.toMonitorStatusKey(
          RelationIdUtil.readConsistent(
            data,
            MONITOR_STATUS_KEYS,
            "Monitor Status",
          ),
        )
      : null;

    const scheduledMaintenanceEvents: Array<Model> = await this.findBy({
      query: updateBy.props.tenantId
        ? { ...updateBy.query, projectId: updateBy.props.tenantId }
        : updateBy.query,
      select: {
        _id: true,
        projectId: true,
        ...(isMonitorStatusWritten
          ? {
              changeMonitorStatusToId: true,
              currentScheduledMaintenanceState: STATE_PLACE_SELECT,
            }
          : {}),
        ...(ScheduledMaintenanceFieldChange.getSelect(
          fieldsWritten,
        ) as Select<Model>),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const monitorStatus: Dictionary<MonitorStatusBeforeUpdate> | null =
      isMonitorStatusWritten ? {} : null;

    const valuesBeforeUpdate: Dictionary<ScheduledMaintenanceValuesBeforeUpdate> | null =
      isFieldWritten ? {} : null;

    // Each project's states, read at most once, and only when a state needs them.
    const statesByProjectId: Map<
      string,
      Array<ScheduledMaintenanceState>
    > = new Map<string, Array<ScheduledMaintenanceState>>();

    for (const scheduledMaintenanceEvent of scheduledMaintenanceEvents) {
      if (!scheduledMaintenanceEvent.id) {
        continue;
      }

      const eventKey: string = scheduledMaintenanceEvent.id.toString();

      if (valuesBeforeUpdate) {
        valuesBeforeUpdate[eventKey] =
          ScheduledMaintenanceFieldChange.getValuesBeforeUpdate({
            record: scheduledMaintenanceEvent,
            fields: fieldsWritten,
          });
      }

      if (monitorStatus) {
        monitorStatus[eventKey] = await this.assertMonitorStatusMayChange({
          scheduledMaintenanceEvent: scheduledMaintenanceEvent,
          newMonitorStatusId: newMonitorStatusId,
          statesByProjectId: statesByProjectId,
        });
      }
    }

    return {
      monitorStatus: monitorStatus,
      valuesBeforeUpdate: valuesBeforeUpdate,
    };
  }

  /*
   * Whether an event read with its state's place and flags has started
   * (ScheduledMaintenanceStartUtil). A built-in state answers by its flag;
   * only a state of the project's own needs the project's list, which is
   * read once per project into statesByProjectId.
   */
  private async hasScheduledMaintenanceStarted(data: {
    scheduledMaintenanceEvent: Model;
    statesByProjectId: Map<string, Array<ScheduledMaintenanceState>>;
  }): Promise<boolean> {
    const currentState: ScheduledMaintenanceState | undefined =
      data.scheduledMaintenanceEvent.currentScheduledMaintenanceState;

    const startedByFlags: boolean | null =
      ScheduledMaintenanceStartUtil.hasStartedByFlags(currentState);

    if (startedByFlags !== null) {
      return startedByFlags;
    }

    const projectId: ObjectID | undefined =
      data.scheduledMaintenanceEvent.projectId;

    if (!currentState || !projectId) {
      return false;
    }

    const projectKey: string = projectId.toString();

    let states: Array<ScheduledMaintenanceState> | undefined =
      data.statesByProjectId.get(projectKey);

    if (!states) {
      states =
        await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates(
          {
            projectId: projectId,
            props: {
              isRoot: true,
            },
          },
        );

      data.statesByProjectId.set(projectKey, states);
    }

    return ScheduledMaintenanceStartUtil.hasStarted({
      states: states,
      state: currentState,
    });
  }

  /*
   * A monitor status id as the checks compare it: trimmed and lower-cased,
   * since Postgres compares uuids by value whatever their case. Null for
   * none.
   */
  private toMonitorStatusKey(
    value: ObjectID | string | null | undefined,
  ): string | null {
    const key: string = value ? value.toString().trim().toLowerCase() : "";

    return key || null;
  }

  /*
   * The lists each event the update matches holds just before the write,
   * for each list the update writes - one read per list, as a find that
   * selects two many-to-many relations returns a row for every combination
   * of their ids (see ProjectScopedReferenceValidator.getHeldRelationIds):
   *
   * - the status pages and every affected-resource list, as the ids they
   *   name (listIdsBeforeUpdate): onUpdateSuccess names what the event is
   *   shown on and what it affects only when the update really changed it;
   * - for the monitors and the network sites, what the event's state meant
   *   for them as well (attachments): onUpdateSuccess compares those with
   *   what the event holds after the write, and acts on the difference.
   *
   * Each part is null, with nothing read, unless the payload writes one of
   * its lists. Only a list that is left out is left alone: null or an empty
   * list can clear one.
   *
   * Read as root but held to the tenant's project, like the other update
   * reads here; the permission checks that narrow the write run after this
   * hook, so an event read here that the write then skips is simply never
   * looked up again (onUpdateSuccess only visits the rows actually written).
   */
  private async getListsBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<ListsBeforeUpdate> {
    const data: Dictionary<unknown> = updateBy.data as Dictionary<unknown>;

    const columns: Array<string> = this.getComparedListColumns().filter(
      (column: string): boolean => {
        return data[column] !== undefined;
      },
    );

    if (columns.length === 0) {
      return {
        attachments: null,
        listIdsBeforeUpdate: null,
      };
    }

    const attachments: AttachmentsCarryForward | null = columns.some(
      (column: string): boolean => {
        return ATTACHMENT_COLUMNS.includes(column as AttachmentColumn);
      },
    )
      ? {}
      : null;

    const listIdsBeforeUpdate: Dictionary<Dictionary<Array<string>>> = {};

    for (const column of columns) {
      const isAttachment: boolean = ATTACHMENT_COLUMNS.includes(
        column as AttachmentColumn,
      );

      const select: Select<Model> = {
        _id: true,
        projectId: true,
        ...(isAttachment
          ? { currentScheduledMaintenanceState: STATE_KIND_SELECT }
          : {}),
        [column]: {
          _id: true,
        },
      } as Select<Model>;

      const scheduledMaintenanceEvents: Array<Model> = await this.findBy({
        query: updateBy.props.tenantId
          ? { ...updateBy.query, projectId: updateBy.props.tenantId }
          : updateBy.query,
        select: select,
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const scheduledMaintenanceEvent of scheduledMaintenanceEvents) {
        if (!scheduledMaintenanceEvent.id) {
          continue;
        }

        const eventKey: string = scheduledMaintenanceEvent.id.toString();

        listIdsBeforeUpdate[eventKey] = {
          ...listIdsBeforeUpdate[eventKey],
          [column]: ReferenceChange.normalizeList(
            (scheduledMaintenanceEvent as unknown as Dictionary<unknown>)[
              column
            ],
          ),
        };

        if (!attachments || !isAttachment) {
          continue;
        }

        const attachmentsBeforeUpdate: AttachmentsBeforeUpdate = attachments[
          eventKey
        ] || {
          projectId: undefined,
          wasOngoingBeforeUpdate: false,
          wasHoldingMonitorsBeforeUpdate: false,
          monitorIdsBeforeUpdate: undefined,
          networkSiteIdsBeforeUpdate: undefined,
        };

        attachmentsBeforeUpdate.projectId = scheduledMaintenanceEvent.projectId;
        attachmentsBeforeUpdate.wasOngoingBeforeUpdate = Boolean(
          scheduledMaintenanceEvent.currentScheduledMaintenanceState
            ?.isOngoingState,
        );

        if (column === "monitors") {
          attachmentsBeforeUpdate.monitorIdsBeforeUpdate = this.getIdsNotIn({
            ids: resolveReferenceIds(scheduledMaintenanceEvent.monitors),
            exclude: [],
          });

          // Only monitors are held; sites follow the live state.
          attachmentsBeforeUpdate.wasHoldingMonitorsBeforeUpdate =
            await ScheduledMaintenanceStateTimelineService.isScheduledMaintenanceHoldingMonitors(
              {
                scheduledMaintenanceId: scheduledMaintenanceEvent.id,
                projectId: scheduledMaintenanceEvent.projectId,
                currentState:
                  scheduledMaintenanceEvent.currentScheduledMaintenanceState,
              },
            );
        } else {
          attachmentsBeforeUpdate.networkSiteIdsBeforeUpdate = this.getIdsNotIn(
            {
              ids: resolveReferenceIds(scheduledMaintenanceEvent.networkSites),
              exclude: [],
            },
          );
        }

        attachments[eventKey] = attachmentsBeforeUpdate;
      }
    }

    return {
      attachments: attachments,
      listIdsBeforeUpdate: listIdsBeforeUpdate,
    };
  }

  /*
   * The lists of an event that its "updated" feed item names when an update
   * changes them: the status pages it is shown on, and everything it
   * affects (LinkedAffectedResources: its monitors, hosts, clusters, network
   * sites, services, SLOs and so on).
   */
  private getComparedListColumns(): Array<string> {
    return ["statusPages", ...this.getAffectedResourceListColumns()];
  }

  // The lists of what an event affects, in the order its feed lists them.
  private getAffectedResourceListColumns(): Array<string> {
    return LinkedAffectedResources.getRelations(this.getModel()).map(
      (relation: LinkedAffectedResourceRelation): string => {
        return relation.column;
      },
    );
  }

  /*
   * The lists in `columns` the update really changed on one event: it
   * writes them, and they name other records than the event held before the
   * write - their order, a repeat and the spelling of an id mean nothing
   * (ReferenceChange.isListChanged). An event the reads before the write did
   * not see counts as changed.
   */
  private getChangedListColumns(data: {
    written: Dictionary<unknown>;
    columns: Array<string>;
    listIdsBeforeUpdate: Dictionary<Array<string>> | undefined;
  }): Array<string> {
    return data.columns.filter((column: string): boolean => {
      return ReferenceChange.isListChanged({
        writtenList: data.written[column],
        idsBeforeUpdate: data.listIdsBeforeUpdate?.[column],
      });
    });
  }

  /*
   * The ids in `ids` that `exclude` does not hold, each once and lower-cased
   * (with nothing to exclude, a list read the same way). Compared case-blind,
   * so an id that reached one side in another case is never reported as
   * both removed and added.
   */
  private getIdsNotIn(data: {
    ids: Array<ObjectID | string>;
    exclude: Array<ObjectID | string>;
  }): Array<ObjectID> {
    const excludedKeys: Set<string> = new Set<string>(
      data.exclude.map((id: ObjectID | string): string => {
        return id.toString().trim().toLowerCase();
      }),
    );

    const result: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const id of data.ids) {
      const key: string = id.toString().trim().toLowerCase();

      if (!key || excludedKeys.has(key) || result.has(key)) {
        continue;
      }

      result.set(key, new ObjectID(key));
    }

    return Array.from(result.values());
  }

  /*
   * An update can repoint a scheduled maintenance event at another project's
   * state or monitor status just as easily as a create can, and the result is
   * the same: the referenced project can no longer be deleted. The same goes
   * for the monitors, labels, status pages and affected-resource lists, which
   * put the event on another project's monitors, status pages, hosts and so
   * on. Only the columns actually being written are checked, so ordinary
   * updates cost no extra queries.
   */
  private async validateProjectScopedReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    /*
     * The state and the monitor status, each by both of its names: the API
     * takes the ID column and the relation alike, and every name that holds
     * an id is checked. Two names that disagree are refused before anything
     * is read.
     */
    const references: Array<ProjectScopedReference> = [
      ...getWrittenRelationReferences({
        payload: updateBy.data,
        idColumn: "currentScheduledMaintenanceStateId",
        relation: "currentScheduledMaintenanceState",
        modelName: "Scheduled Maintenance State",
        service: ScheduledMaintenanceStateService,
      }),
      ...getWrittenRelationReferences({
        payload: updateBy.data,
        idColumn: "changeMonitorStatusToId",
        relation: "changeMonitorStatusTo",
        modelName: "Monitor Status",
        service: MonitorStatusService,
      }),
    ];

    // An empty list only removes rows and needs no check.
    const relations: Array<ProjectScopedRelation> =
      this.getProjectScopedRelations().filter(
        (relation: ProjectScopedRelation) => {
          return (
            resolveReferenceIds(
              (updateBy.data as Dictionary<unknown>)[relation.column],
            ).length > 0
          );
        },
      );

    if (references.length === 0 && relations.length === 0) {
      return;
    }

    /*
     * Root/API updates do not always carry a tenantId, so fall back to the
     * project of each event the query actually matches.
     */
    const projectIds: Array<ObjectID> = updateBy.props.tenantId
      ? [updateBy.props.tenantId]
      : await this.getProjectIdsForUpdateQuery(updateBy);

    // See ProjectScopedReferenceValidator.getRelationReferences.
    const heldIds: HeldRelationIds | undefined =
      relations.length > 0
        ? await ProjectScopedReferenceValidator.getHeldRelationIds({
            service: this as unknown as DatabaseService<DatabaseBaseModel>,
            query: updateBy.query as Query<DatabaseBaseModel>,
            columns: relations.map((relation: ProjectScopedRelation) => {
              return relation.column;
            }),
          })
        : undefined;

    for (const projectId of projectIds) {
      const referencesInProject: Array<ProjectScopedReference> = [
        ...references,
        ...ProjectScopedReferenceValidator.getRelationReferences({
          payload: updateBy.data,
          relations: relations,
          projectId: projectId,
          heldIds: heldIds,
        }),
      ];

      if (referencesInProject.length === 0) {
        continue;
      }

      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: projectId,
        subject: "scheduled maintenance event",
        references: referencesInProject,
      });
    }
  }

  /*
   * The many-to-many lists whose ids must belong to the event's project.
   * Built per call rather than at module load: these services sit in an
   * import graph that loops back to this one, and a module-level table would
   * capture whichever of them had not finished loading yet as undefined.
   */
  private getProjectScopedRelations(): Array<ProjectScopedRelation> {
    return [
      {
        column: "monitors",
        modelName: "Monitor",
        service: MonitorService,
      },
      {
        column: "labels",
        modelName: "Label",
        service: LabelService,
      },
      {
        column: "statusPages",
        modelName: "Status Page",
        service: StatusPageService,
      },
      ...getAffectedResourceRelations(this.getModel()),
    ];
  }

  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const scheduledMaintenanceEvents: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Dictionary<ObjectID> = {};

    for (const scheduledMaintenance of scheduledMaintenanceEvents) {
      if (scheduledMaintenance.projectId) {
        projectIds[scheduledMaintenance.projectId.toString()] =
          scheduledMaintenance.projectId;
      }
    }

    return Object.values(projectIds);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const scheduledMaintenanceEvents: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        projectId: true,
        monitors: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    return {
      carryForward: {
        scheduledMaintenanceEvents: scheduledMaintenanceEvents,
      },
      deleteBy: deleteBy,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _deletedItemIds: ObjectID[],
  ): Promise<OnDelete<Model>> {
    if (onDelete.carryForward?.scheduledMaintenanceEvents) {
      for (const scheduledMaintenanceEvent of onDelete?.carryForward
        ?.scheduledMaintenanceEvents || []) {
        await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
          scheduledMaintenanceEvent,
        );

        if (
          scheduledMaintenanceEvent.projectId &&
          scheduledMaintenanceEvent.id
        ) {
          /*
           * Measurement points carry project-defined names, so nothing else
           * sweeps them up. Without this they stay charted against an event
           * that no longer exists until their retention date.
           */
          const measurementMetricNames: Array<string> =
            await ScheduledMaintenanceMeasurementService.getMetricNamesForProject(
              scheduledMaintenanceEvent.projectId,
            );

          await MeasurementMetricWriter.tombstoneAll({
            projectId: scheduledMaintenanceEvent.projectId,
            primaryEntityId: scheduledMaintenanceEvent.id,
            primaryEntityType: ServiceType.ScheduledMaintenance,
            allMeasurementMetricNames: measurementMetricNames,
          });
        }
      }
    }

    return onDelete;
  }

  public getNextTimeToNotify(data: {
    eventScheduledDate: Date;
    sendSubscriberNotifiationsOn?: Array<Recurring> | null | undefined;
  }): Date | null {
    let recurringDate: Date | null = null;

    logger.debug(`getNextTimeToNotify: `);
    logger.debug(data);

    logger.debug(
      `Calculating next time to notify for event scheduled date: ${data.eventScheduledDate}`,
    );

    const notificationSchedules: Array<Recurring> = Array.isArray(
      data.sendSubscriberNotifiationsOn,
    )
      ? (data.sendSubscriberNotifiationsOn as Array<Recurring>)
      : [];

    if (notificationSchedules.length === 0) {
      logger.debug(
        "No sendSubscriberNotifiationsOn entries. Returning null for next notification time.",
      );
      return null;
    }

    for (const recurringItem of notificationSchedules) {
      if (!recurringItem) {
        continue;
      }
      const notificationDate: Date = Recurring.getNextDateInterval(
        data.eventScheduledDate,
        recurringItem,
        true,
      );

      logger.debug(
        `Notification date calculated: ${notificationDate} for recurring item: ${recurringItem}`,
      );

      // if this date is in the future. set it to recurring date.
      if (!recurringDate && OneUptimeDate.isInTheFuture(notificationDate)) {
        recurringDate = notificationDate;
        logger.debug(
          `Notification date is in the future. Setting recurring date to: ${recurringDate}`,
        );
      } else {
        logger.debug(`Notification date is in the past. Skipping.`);
      }

      // if this new date is less than the recurring date then set it to recurring date. We need to get the least date.
      if (recurringDate) {
        if (
          OneUptimeDate.isBefore(notificationDate, recurringDate) &&
          OneUptimeDate.isInTheFuture(notificationDate)
        ) {
          recurringDate = notificationDate;
          logger.debug(
            `Found an earlier notification date. Updating recurring date to: ${recurringDate}`,
          );
        } else {
          logger.debug(
            `Notification date is not earlier than recurring date. Skipping.`,
          );
        }
      }
    }

    logger.debug(`Final recurring date: ${recurringDate}`);
    return recurringDate;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.props.tenantId && !createBy.data.projectId) {
      throw new BadDataException(
        "ProjectId required to create scheduled maintenance.",
      );
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          projectId: projectId,
          isScheduledState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
      throw new BadDataException(
        "Scheduled state not found for this project. Please add an scheduled event state from settings.",
      );
    }

    /*
     * Every event starts scheduled, whatever state the write named under
     * either name: stamp leaves no other name of it to be stored instead.
     */
    RelationIdUtil.stamp(
      createBy.data as unknown as Record<string, unknown>,
      STATE_KEYS,
      scheduledMaintenanceState.id,
    );

    /*
     * The monitor status to switch to comes straight from the API caller or
     * a template, under either of its names, and nothing checked it belongs
     * to this project. Persisting another project's id leaves that project
     * undeletable. Every name that holds an id is checked, and two that
     * disagree are refused.
     *
     * The monitors, labels and status pages lists are checked too: the event
     * changes the status of every listed monitor and notifies the subscribers
     * of every listed status page, so another project's ids here would act on
     * that project's monitors and message its subscribers. So are the
     * affected-resource lists (see getAffectedResourceRelations): a listed
     * network site's uptime excludes the window, and every listed resource
     * shows the event on its Activity tab.
     *
     * Runs before the counter increment so a rejected create does not burn an
     * event number.
     */
    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: projectId,
      subject: "scheduled maintenance event",
      references: [
        ...getWrittenRelationReferences({
          payload: createBy.data,
          idColumn: "changeMonitorStatusToId",
          relation: "changeMonitorStatusTo",
          modelName: "Monitor Status",
          service: MonitorStatusService,
        }),
        ...ProjectScopedReferenceValidator.getRelationReferences({
          payload: createBy.data,
          relations: this.getProjectScopedRelations(),
        }),
      ],
    });

    const scheduledMaintenanceCounterResult: {
      counter: number;
      prefix: string | undefined;
    } =
      await ProjectService.incrementAndGetScheduledMaintenanceCounter(
        projectId,
      );

    createBy.data.scheduledMaintenanceNumber =
      scheduledMaintenanceCounterResult.counter;
    createBy.data.scheduledMaintenanceNumberWithPrefix =
      NumberPrefixUtil.formatNumber(
        scheduledMaintenanceCounterResult.prefix,
        scheduledMaintenanceCounterResult.counter,
      );

    // get next notification date.

    if (
      createBy.data.sendSubscriberNotificationsOnBeforeTheEvent &&
      createBy.data.startsAt
    ) {
      const nextNotificationDate: Date | null = this.getNextTimeToNotify({
        eventScheduledDate: createBy.data.startsAt,
        sendSubscriberNotifiationsOn:
          createBy.data.sendSubscriberNotificationsOnBeforeTheEvent,
      });

      if (nextNotificationDate) {
        // set this.
        createBy.data.nextSubscriberNotificationBeforeTheEventAt =
          nextNotificationDate;
      }
    }

    // Set notification status based on shouldStatusPageSubscribersBeNotifiedOnEventCreated
    if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnEventCreated ===
      false
    ) {
      createBy.data.subscriberNotificationStatusOnEventScheduled =
        StatusPageSubscriberNotificationStatus.Skipped;
      createBy.data.subscriberNotificationStatusMessage =
        "Notifications skipped as subscribers are not to be notified for this scheduled maintenance.";
    } else if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnEventCreated === true
    ) {
      createBy.data.subscriberNotificationStatusOnEventScheduled =
        StatusPageSubscriberNotificationStatus.Pending;
    }

    /*
     * Custom fields configured to inherit from the event's monitors are
     * stamped here rather than in onCreateSuccess: `customFields` is a column
     * on this row and the onCreateSuccess chain is un-awaited, so a value
     * written there would be missing from the event the caller gets back.
     * Written not to throw — a field failing to inherit must not stop an event
     * from being scheduled.
     */
    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: ScheduledMaintenanceCustomField,
      createBy: createBy,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  public async refreshReminderSchedule(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: data.scheduledMaintenanceId,
      select: {
        enableReminders: true,
        startsAt: true,
        labels: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      return;
    }

    let nextReminderNotificationAt: Date | null = null;

    if (scheduledMaintenance.enableReminders !== false) {
      const matchingRule: ScheduledMaintenanceReminderRule | null =
        await ScheduledMaintenanceReminderRuleService.findMatchingRule({
          projectId: data.projectId,
          labelIds: scheduledMaintenance.labels?.map((label: Label) => {
            return label.id!;
          }),
        });

      if (
        matchingRule &&
        matchingRule.reminderIntervalInMinutes &&
        !(await this.isScheduledMaintenanceCompleted({
          scheduledMaintenanceId: data.scheduledMaintenanceId,
        }))
      ) {
        /*
         * When the rule does not remind while the event is still scheduled,
         * defer the first reminder until after the event has started so that
         * owners are not notified about an event that has not begun yet.
         */
        let referenceDate: Date = OneUptimeDate.getCurrentDate();

        if (
          !matchingRule.remindWhileScheduled &&
          scheduledMaintenance.startsAt &&
          OneUptimeDate.isInTheFuture(scheduledMaintenance.startsAt)
        ) {
          referenceDate = scheduledMaintenance.startsAt;
        }

        nextReminderNotificationAt = OneUptimeDate.addRemoveMinutes(
          referenceDate,
          matchingRule.reminderIntervalInMinutes,
        );
      }
    }

    await this.updateOneById({
      id: data.scheduledMaintenanceId,
      data: {
        nextReminderNotificationAt: nextReminderNotificationAt,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // Get scheduled maintenance data for feed creation
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: createdItem.id!,
      select: {
        projectId: true,
        scheduledMaintenanceNumber: true,
        scheduledMaintenanceNumberWithPrefix: true,
        title: true,
        description: true,
        currentScheduledMaintenanceState: {
          name: true,
        },
        startsAt: true,
        endsAt: true,
        labels: {
          name: true,
        },
        createdByUserId: true,
        createdByUser: {
          _id: true,
          name: true,
          email: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("Scheduled Maintenance not found");
    }

    // Execute operations sequentially with error handling
    Promise.resolve()
      .then(async () => {
        try {
          if (createdItem.projectId && createdItem.id) {
            return await this.handleScheduledMaintenanceWorkspaceOperationsAsync(
              createdItem,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Workspace operations failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              scheduledMaintenanceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.createScheduledMaintenanceFeedAsync(
            scheduledMaintenance,
          );
        } catch (error) {
          logger.error(
            `Create scheduled maintenance feed failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              scheduledMaintenanceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.createScheduledMaintenanceStateTimelineAsync(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Create scheduled maintenance state timeline failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              scheduledMaintenanceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          if (
            createdItem.projectId &&
            createdItem.id &&
            onCreate.createBy.miscDataProps &&
            (onCreate.createBy.miscDataProps["ownerTeams"] ||
              onCreate.createBy.miscDataProps["ownerUsers"])
          ) {
            return await this.addOwners(
              createdItem.projectId!,
              createdItem.id!,
              (onCreate.createBy.miscDataProps[
                "ownerUsers"
              ] as Array<ObjectID>) || [],
              (onCreate.createBy.miscDataProps[
                "ownerTeams"
              ] as Array<ObjectID>) || [],
              false,
              onCreate.createBy.props,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Add owners failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              scheduledMaintenanceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        // Apply owner rules: add matched owner users/teams to the event.
        try {
          await ScheduledMaintenanceOwnerRuleEngineService.applyRulesToScheduledMaintenance(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply scheduled maintenance owner rules failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              scheduledMaintenanceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        // Apply label rules: attach matched (and optionally inherited monitor) labels to the event.
        try {
          await ScheduledMaintenanceLabelRuleEngineService.applyRulesToScheduledMaintenance(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply scheduled maintenance label rules failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              scheduledMaintenanceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        try {
          await RunbookRuleEngineService.applyRulesToScheduledMaintenance(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply runbook rules failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              scheduledMaintenanceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        // Schedule reminder notifications for scheduled maintenance if a matching reminder rule exists
        try {
          if (createdItem.projectId && createdItem.id) {
            await this.refreshReminderSchedule({
              scheduledMaintenanceId: createdItem.id,
              projectId: createdItem.projectId,
            });
          }
        } catch (error) {
          logger.error(
            `Reminder scheduling failed in ScheduledMaintenanceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              scheduledMaintenanceId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in ScheduledMaintenanceService sequential operations: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            scheduledMaintenanceId: createdItem.id?.toString(),
          } as LogAttributes,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  private async handleScheduledMaintenanceWorkspaceOperationsAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      if (!createdItem.projectId || !createdItem.id) {
        throw new BadDataException(
          "projectId and id are required for workspace operations",
        );
      }

      // send message to workspaces - slack, teams, etc.
      const workspaceResult: {
        channelsCreated: Array<NotificationRuleWorkspaceChannel>;
      } | null =
        await ScheduledMaintenanceWorkspaceMessages.createChannelsAndInviteUsersToChannels(
          {
            projectId: createdItem.projectId,
            scheduledMaintenanceId: createdItem.id,
            scheduledMaintenanceNumber: createdItem.scheduledMaintenanceNumber!,
          },
        );

      if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
        // update scheduledMaintenance with these channels.
        await this.updateOneById({
          id: createdItem.id,
          data: {
            postUpdatesToWorkspaceChannels:
              workspaceResult.channelsCreated || [],
          },
          props: {
            isRoot: true,
          },
        });
      }
    } catch (error) {
      logger.error(
        `Error in handleScheduledMaintenanceWorkspaceOperationsAsync: ${error}`,
        {
          projectId: createdItem.projectId?.toString(),
          scheduledMaintenanceId: createdItem.id?.toString(),
        } as LogAttributes,
      );
      throw error;
    }
  }

  @CaptureSpan()
  private async createScheduledMaintenanceFeedAsync(
    scheduledMaintenance: Model,
  ): Promise<void> {
    try {
      const createdByUserId: ObjectID | undefined | null =
        scheduledMaintenance.createdByUserId ||
        scheduledMaintenance.createdByUser?.id;

      let feedInfoInMarkdown: string = `#### 🕒 Scheduled Maintenance ${scheduledMaintenance.scheduledMaintenanceNumberWithPrefix || "#" + scheduledMaintenance.scheduledMaintenanceNumber?.toString()} Created:
            
**${escapeMarkdownValue(scheduledMaintenance.title || "No title provided.")}**:
      
${scheduledMaintenance.description || "No description provided."}
      
`;

      // add starts at and ends at.
      if (scheduledMaintenance.startsAt) {
        feedInfoInMarkdown += `**Starts At**: ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(scheduledMaintenance.startsAt)} \n\n`;
      }

      if (scheduledMaintenance.endsAt) {
        feedInfoInMarkdown += `**Ends At**: ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(scheduledMaintenance.endsAt)} \n\n`;
      }

      if (scheduledMaintenance.currentScheduledMaintenanceState?.name) {
        feedInfoInMarkdown += `⏳ **Scheduled Maintenance State**: ${escapeMarkdownValue(scheduledMaintenance.currentScheduledMaintenanceState.name)} \n\n`;
      }

      // Everything the event's Affected Resources card lists, monitors first.
      const resources: Array<LinkedAffectedResource> =
        await LinkedAffectedResources.readForScheduledMaintenance({
          service: this,
          projectId: scheduledMaintenance.projectId!,
          scheduledMaintenanceId: scheduledMaintenance.id!,
        });

      if (resources.length > 0) {
        feedInfoInMarkdown += `🌎 **Resources Affected**:\n`;

        for (const resourceLine of LinkedAffectedResources.getMarkdownLines({
          dashboardUrl: await DatabaseConfig.getDashboardUrl(),
          projectId: scheduledMaintenance.projectId!,
          resources: resources,
        })) {
          feedInfoInMarkdown += `${resourceLine}\n`;
        }

        feedInfoInMarkdown += `\n\n`;
      }

      const scheduledMaintenanceCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
        await ScheduledMaintenanceWorkspaceMessages.getScheduledMaintenanceCreateMessageBlocks(
          {
            scheduledMaintenanceId: scheduledMaintenance.id!,
            projectId: scheduledMaintenance.projectId!,
          },
        );

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: scheduledMaintenance.id!,
        projectId: scheduledMaintenance.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated,
        displayColor: Red500,
        feedInfoInMarkdown: feedInfoInMarkdown,
        userId: createdByUserId || undefined,
        workspaceNotification: {
          appendMessageBlocks: scheduledMaintenanceCreateMessageBlocks,
          sendWorkspaceNotification: true,
        },
      });
    } catch (error) {
      logger.error(`Error in createScheduledMaintenanceFeedAsync: ${error}`, {
        projectId: scheduledMaintenance.projectId?.toString(),
        scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  private async createScheduledMaintenanceStateTimelineAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      const timeline: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      timeline.projectId = createdItem.projectId!;
      timeline.scheduledMaintenanceId = createdItem.id!;
      timeline.isOwnerNotified = true; // ignore notifying owners because you already notify for Scheduled Event, no need to notify them for timeline event.
      timeline.shouldStatusPageSubscribersBeNotified = Boolean(
        createdItem.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
      );
      // Map boolean to enum value - ignore notifying subscribers because you already notify for Scheduled Event, no need to notify them for timeline event.
      timeline.subscriberNotificationStatus =
        createdItem.shouldStatusPageSubscribersBeNotifiedOnEventCreated
          ? StatusPageSubscriberNotificationStatus.Success
          : StatusPageSubscriberNotificationStatus.Pending;
      timeline.scheduledMaintenanceStateId =
        createdItem.currentScheduledMaintenanceStateId!;

      await ScheduledMaintenanceStateTimelineService.create({
        data: timeline,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(
        `Error in createScheduledMaintenanceStateTimelineAsync: ${error}`,
        {
          projectId: createdItem.projectId?.toString(),
          scheduledMaintenanceId: createdItem.id?.toString(),
        } as LogAttributes,
      );
      throw error;
    }
  }

  @CaptureSpan()
  public async addOwners(
    projectId: ObjectID,
    scheduledMaintenanceId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    // Owners already on the event are skipped, not added a second time.
    await OwnerRuleAssignment.addOwners({
      ownerUserService: ScheduledMaintenanceOwnerUserService,
      ownerTeamService: ScheduledMaintenanceOwnerTeamService,
      resourceIdColumn: "scheduledMaintenanceId",
      resourceId: scheduledMaintenanceId,
      projectId: projectId,
      userIds: userIds,
      teamIds: teamIds,
      isOwnerNotified: !notifyOwners,
      props: props,
    });
  }

  @CaptureSpan()
  public async getScheduledMaintenanceLinkInDashboard(
    projectId: ObjectID,
    scheduledMaintenanceId: ObjectID,
  ): Promise<URL> {
    if (!projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is required");
    }

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (!dashboardUrl) {
      throw new BadDataException("Dashboard URL not found");
    }

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/scheduled-maintenance-events/${scheduledMaintenanceId.toString()}`,
    );
  }

  @CaptureSpan()
  public async findOwners(
    scheduledMaintenanceId: ObjectID,
  ): Promise<Array<User>> {
    if (!scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is required");
    }

    const ownerUsers: Array<ScheduledMaintenanceOwnerUser> =
      await ScheduledMaintenanceOwnerUserService.findBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenanceId,
        },
        select: {
          _id: true,
          projectId: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          },
        },

        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<ScheduledMaintenanceOwnerTeam> =
      await ScheduledMaintenanceOwnerTeamService.findBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenanceId,
        },
        select: {
          _id: true,
          projectId: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: ScheduledMaintenanceOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: ScheduledMaintenanceOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        //check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    const projectId: ObjectID | undefined =
      ownerUsers[0]?.projectId || ownerTeams[0]?.projectId;

    if (!projectId) {
      return [];
    }

    // Owners who left the project are not notified, nor listed as notified.
    return await TeamMemberService.filterUsersToProjectMembers({
      projectId: projectId,
      users: users,
    });
  }

  @CaptureSpan()
  public async changeAttachedMonitorStates(
    item: Model,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    if (!item.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!item.id) {
      throw new BadDataException("id is required");
    }

    if (item.changeMonitorStatusToId && item.projectId) {
      // change status of all the monitors.
      await MonitorService.changeMonitorStatus(
        item.projectId,
        item.monitors?.map((monitor: Monitor) => {
          return new ObjectID(monitor._id || "");
        }) || [],
        item.changeMonitorStatusToId,
        true, // notify owners
        "Changed because of scheduled maintenance event: " + item.id.toString(),
        undefined,
        props,
      );
    }
  }

  /*
   * What the write actually changed on one event: its lists as read back
   * now, against the ones onBeforeUpdate read before the write. Comparing
   * with the payload instead would trust entries the write may have dropped
   * (see AttachmentsBeforeUpdate) - a monitor put into maintenance without
   * being attached could never be restored, since ending or deleting the
   * event only reaches the monitors it holds.
   *
   * The monitors are read back whenever they were written, because the feed
   * names the change on any event. The sites are only needed by an event
   * that was suppressing them.
   */
  private async getAttachmentChange(data: {
    scheduledMaintenanceId: ObjectID;
    attachmentsBeforeUpdate: AttachmentsBeforeUpdate;
  }): Promise<AttachmentChange> {
    const attachmentsBeforeUpdate: AttachmentsBeforeUpdate =
      data.attachmentsBeforeUpdate;

    const change: AttachmentChange = {
      monitorsAdded: [],
      monitorsRemoved: [],
      networkSitesChanged: [],
      eventAfterUpdate: null,
    };

    const monitorIdsBeforeUpdate: Array<ObjectID> | undefined =
      attachmentsBeforeUpdate.monitorIdsBeforeUpdate;

    if (monitorIdsBeforeUpdate) {
      const eventAfterUpdate: Model | null = await this.findOneById({
        id: data.scheduledMaintenanceId,
        select: {
          _id: true,
          changeMonitorStatusToId: true,
          currentScheduledMaintenanceState: STATE_KIND_SELECT,
          monitors: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * An event that cannot be read back was deleted since the write, and
       * its delete hook deals with whatever it held.
       */
      if (eventAfterUpdate) {
        const monitorIdsAfterUpdate: Array<ObjectID | string> =
          resolveReferenceIds(eventAfterUpdate.monitors);

        change.monitorsAdded = this.getIdsNotIn({
          ids: monitorIdsAfterUpdate,
          exclude: monitorIdsBeforeUpdate,
        });
        change.monitorsRemoved = this.getIdsNotIn({
          ids: monitorIdsBeforeUpdate,
          exclude: monitorIdsAfterUpdate,
        });
        change.eventAfterUpdate = eventAfterUpdate;
      }
    }

    const networkSiteIdsBeforeUpdate: Array<ObjectID> | undefined =
      attachmentsBeforeUpdate.networkSiteIdsBeforeUpdate;

    if (
      networkSiteIdsBeforeUpdate &&
      attachmentsBeforeUpdate.wasOngoingBeforeUpdate
    ) {
      // A read of its own, for the same reason as in onBeforeUpdate.
      const eventAfterUpdate: Model | null = await this.findOneById({
        id: data.scheduledMaintenanceId,
        select: {
          _id: true,
          networkSites: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (eventAfterUpdate) {
        const networkSiteIdsAfterUpdate: Array<ObjectID | string> =
          resolveReferenceIds(eventAfterUpdate.networkSites);

        change.networkSitesChanged = [
          ...this.getIdsNotIn({
            ids: networkSiteIdsAfterUpdate,
            exclude: networkSiteIdsBeforeUpdate,
          }),
          ...this.getIdsNotIn({
            ids: networkSiteIdsBeforeUpdate,
            exclude: networkSiteIdsAfterUpdate,
          }),
        ];
      }
    }

    return change;
  }

  /*
   * Moving to ongoing puts the attached monitors into maintenance (the flag
   * that stops probing, and the configured status) and ending restores the
   * ones attached at that moment. Both read the list only at the transition,
   * so a monitor detached mid-window would stay disabled for good - ending
   * or deleting the event no longer reaches it, and the flag is not
   * user-editable - and one attached mid-window would keep being probed and
   * alerting. This does for the edited part of the list what the
   * transitions did for the rest.
   *
   * Monitors are acted on while the event holds them (see
   * ScheduledMaintenanceStateTimelineService.isScheduledMaintenanceHoldingMonitors):
   * a scheduled event picks up its list when it starts, and an ended one
   * has nothing held. Network sites are suppressed only while the event is
   * live in an ongoing state.
   *
   * The write has already committed, so nothing here may undo it or turn it
   * into an error. Each step fails on its own, and each monitor within a
   * step, logged; the steps after it still run.
   */
  private async applyAttachmentChangeToEvent(data: {
    scheduledMaintenanceId: ObjectID;
    attachmentsBeforeUpdate: AttachmentsBeforeUpdate;
    change: AttachmentChange;
  }): Promise<void> {
    const attachmentsBeforeUpdate: AttachmentsBeforeUpdate =
      data.attachmentsBeforeUpdate;
    const change: AttachmentChange = data.change;
    const projectId: ObjectID | undefined = attachmentsBeforeUpdate.projectId;

    if (!projectId) {
      return;
    }

    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      scheduledMaintenanceId: data.scheduledMaintenanceId.toString(),
    } as LogAttributes;

    const wasHoldingMonitorsBeforeUpdate: boolean =
      attachmentsBeforeUpdate.wasHoldingMonitorsBeforeUpdate;

    /*
     * Whether the event holds its monitors now, as read back after the write
     * and after any state change the same update made. The state can also
     * move between onBeforeUpdate's read and the write - the
     * ChangeStateToOngoing job starting the event, or another request
     * changing its state - so the state before the write cannot decide
     * either list alone. Read only when it can change what happens.
     *
     * If it cannot be read, nothing new is held: a monitor probed through
     * the window is better than one disabled with nothing to restore it.
     */
    let isHoldingMonitorsAfterUpdate: boolean = false;

    if (
      change.eventAfterUpdate &&
      (change.monitorsAdded.length > 0 ||
        (change.monitorsRemoved.length > 0 && !wasHoldingMonitorsBeforeUpdate))
    ) {
      try {
        isHoldingMonitorsAfterUpdate =
          await ScheduledMaintenanceStateTimelineService.isScheduledMaintenanceHoldingMonitors(
            {
              scheduledMaintenanceId: data.scheduledMaintenanceId,
              projectId: projectId,
              currentState:
                change.eventAfterUpdate.currentScheduledMaintenanceState,
            },
          );
      } catch (err) {
        logger.error(
          `ScheduledMaintenanceService.applyAttachmentChangeToEvent: could not read whether scheduled maintenance ${data.scheduledMaintenanceId.toString()} holds its monitors after the update; holding none of the monitors it attached.`,
          logAttributes,
        );
        logger.error(err, logAttributes);
      }
    }

    /*
     * A detached monitor is released if the event held its monitors on
     * either side of the write: before it, or after it when the event
     * started in between and the transition flagged the list it read then,
     * which may still have had this monitor on it. Only the monitors
     * actually flagged are released (see restoreMonitorsDetachedFromEvent).
     */
    if (
      change.monitorsRemoved.length > 0 &&
      (wasHoldingMonitorsBeforeUpdate || isHoldingMonitorsAfterUpdate)
    ) {
      try {
        await this.restoreMonitorsDetachedFromEvent({
          scheduledMaintenanceId: data.scheduledMaintenanceId,
          projectId: projectId,
          monitorIds: change.monitorsRemoved,
        });
      } catch (err) {
        logger.error(
          `ScheduledMaintenanceService.applyAttachmentChangeToEvent: could not restore the monitors detached from scheduled maintenance ${data.scheduledMaintenanceId.toString()}.`,
          logAttributes,
        );
        logger.error(err, logAttributes);
      }
    }

    /*
     * An attached monitor is held when the event holds its monitors after
     * the write, whatever it was doing before: the job (or another request)
     * can have started it between onBeforeUpdate's read and the write,
     * flagging the list without this monitor. A transition that ran after
     * the write - the same update started the event, or the job did just
     * after - has reached this monitor already, and holding it again
     * changes nothing. An event the same update ended has had its whole list
     * restored by the transition, and holds nothing.
     */
    if (
      change.monitorsAdded.length > 0 &&
      isHoldingMonitorsAfterUpdate &&
      change.eventAfterUpdate
    ) {
      await this.holdMonitorsAttachedToEvent({
        scheduledMaintenanceId: data.scheduledMaintenanceId,
        projectId: projectId,
        monitorIds: change.monitorsAdded,
        changeMonitorStatusToId:
          change.eventAfterUpdate.changeMonitorStatusToId,
      });
    }

    /*
     * Sites are suppressed by the live attachment, so the edit itself has
     * already taken effect; this only re-rolls the chains now rather than at
     * the next stale sweep, as the state transition does. Detached sites
     * need it as much as attached ones: they were suppressed until now.
     * recomputeNetworkSiteRollups logs its own failures.
     */
    if (
      attachmentsBeforeUpdate.wasOngoingBeforeUpdate &&
      change.networkSitesChanged.length > 0
    ) {
      const eventWithChangedSites: Model = new Model(
        data.scheduledMaintenanceId,
      );
      eventWithChangedSites.projectId = projectId;
      eventWithChangedSites.networkSites = change.networkSitesChanged.map(
        (siteId: ObjectID): NetworkSite => {
          return new NetworkSite(siteId);
        },
      );

      await ScheduledMaintenanceStateTimelineService.recomputeNetworkSiteRollups(
        eventWithChangedSites,
      );
    }
  }

  /*
   * Releases the monitors an edit detached from an event that was holding
   * them, exactly as ending the event releases its list:
   * enableActiveMonitoringForMonitors clears the flag and puts each back in
   * the operational status, skipping a monitor another event still holds
   * and carrying on past one that fails. This event no longer counts as
   * holding them: the write has already removed them from it.
   *
   * Only a monitor whose flag is set is released. That the event held its
   * monitors says it held the list it read when it started, not that it
   * held this monitor: an event the same update (or the job, just after the
   * write) started never flagged a monitor the write had already detached,
   * and one ended by another request just before the write has released it
   * already. Released anyway, that monitor would be forced into the
   * operational status over the one it is really in.
   */
  private async restoreMonitorsDetachedFromEvent(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
  }): Promise<void> {
    const heldMonitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any(data.monitorIds),
        projectId: data.projectId,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (heldMonitors.length === 0) {
      return;
    }

    const eventWithRemovedMonitors: Model = new Model(
      data.scheduledMaintenanceId,
    );
    eventWithRemovedMonitors.projectId = data.projectId;
    eventWithRemovedMonitors.monitors = this.getIdsNotIn({
      ids: resolveReferenceIds(heldMonitors),
      exclude: [],
    }).map((monitorId: ObjectID): Monitor => {
      return new Monitor(monitorId);
    });

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      eventWithRemovedMonitors,
    );
  }

  /*
   * Puts the monitors an edit attached into maintenance, as entering ongoing
   * does for the list (ScheduledMaintenanceStateTimelineService): the flag
   * that stops probing, then the status the event applies, if any. Both are
   * idempotent, so a monitor the transition has reached as well - the event
   * started just after the write - is left as it is.
   *
   * One monitor at a time, as the release is: one that fails must not leave
   * the rest of what the edit attached probed and alerting through the
   * window.
   */
  private async holdMonitorsAttachedToEvent(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
    changeMonitorStatusToId: ObjectID | undefined;
  }): Promise<void> {
    for (const monitorId of data.monitorIds) {
      try {
        await MonitorService.updateOneById({
          id: monitorId,
          data: {
            disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true, /// This will stop active monitoring.
          },
          props: {
            isRoot: true,
          },
        });

        const eventWithAddedMonitor: Model = new Model(
          data.scheduledMaintenanceId,
        );
        eventWithAddedMonitor.projectId = data.projectId;
        eventWithAddedMonitor.monitors = [new Monitor(monitorId)];

        if (data.changeMonitorStatusToId) {
          eventWithAddedMonitor.changeMonitorStatusToId =
            data.changeMonitorStatusToId;
        }

        // A no-op when the event does not change monitor status.
        await this.changeAttachedMonitorStates(eventWithAddedMonitor, {
          isRoot: true,
        });
      } catch (err) {
        const logAttributes: LogAttributes = {
          projectId: data.projectId.toString(),
          scheduledMaintenanceId: data.scheduledMaintenanceId.toString(),
          monitorId: monitorId.toString(),
        } as LogAttributes;

        logger.error(
          `ScheduledMaintenanceService.holdMonitorsAttachedToEvent: could not put monitor ${monitorId.toString()} into maintenance; continuing with the remaining monitors.`,
          logAttributes,
        );
        logger.error(err, logAttributes);
        continue;
      }
    }
  }

  /*
   * "Monitors Removed" / "Monitors Added" for the updated feed item, worded
   * as the incident feed words them. The names are read back held to the
   * project, so an id that is not this project's monitor is never named.
   */
  private async getMonitorChangesFeedMarkdown(data: {
    projectId: ObjectID;
    change: AttachmentChange;
  }): Promise<string> {
    const sections: Array<{ title: string; monitorIds: Array<ObjectID> }> = [
      {
        title: "🗑️ Monitors Removed",
        monitorIds: data.change.monitorsRemoved,
      },
      {
        title: "🌎 Monitors Added",
        monitorIds: data.change.monitorsAdded,
      },
    ];

    let markdown: string = "";

    for (const section of sections) {
      if (section.monitorIds.length === 0) {
        continue;
      }

      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          _id: QueryHelper.any(section.monitorIds),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (monitors.length === 0) {
        continue;
      }

      markdown += `\n\n**${section.title}**:\n`;

      // Each name is plain text inside its link's own text.
      for (const monitor of monitors) {
        markdown += `- [${escapeMarkdownInline(monitor.name)}](${(await MonitorService.getMonitorLinkInDashboard(data.projectId, monitor.id!)).toString()})\n`;
      }
    }

    return markdown;
  }

  /*
   * The Change Monitor Status to an update stored on one event, when it is
   * not the one the event held before the write (what onBeforeUpdate read):
   * an id, or null when the update cleared it. Null as a whole when the
   * update did not change it - it did not write it, or wrote back the
   * status the event already held.
   */
  private getMonitorStatusChange(data: {
    data: Record<string, unknown>;
    monitorStatusBeforeUpdate: MonitorStatusBeforeUpdate | undefined;
  }): { monitorStatusId: string | null } | null {
    if (
      !data.monitorStatusBeforeUpdate ||
      !RelationIdUtil.isPresent(data.data, MONITOR_STATUS_KEYS)
    ) {
      return null;
    }

    // onBeforeUpdate refused two names that disagree, so this reads one value.
    const monitorStatusId: string | null = this.toMonitorStatusKey(
      RelationIdUtil.readConsistent(
        data.data,
        MONITOR_STATUS_KEYS,
        "Monitor Status",
      ),
    );

    if (monitorStatusId === data.monitorStatusBeforeUpdate.monitorStatusId) {
      return null;
    }

    return { monitorStatusId: monitorStatusId };
  }

  /*
   * A Change Monitor Status to the update changed, put on the monitors of
   * an event that holds them by now. onBeforeUpdate let the change through
   * because the event had not started; when it started before the write
   * landed - the ChangeStateToOngoing job at its start time, Mark as
   * Ongoing, or this very update moving it - the move put its monitors in
   * the status it read then, which may be the one this write replaced. The
   * monitors follow the status the event holds, as if the write had come
   * first. MonitorService.changeMonitorStatus leaves a monitor already in it
   * as it is, so a monitor the move did reach in the new status is not
   * written twice.
   *
   * A status cleared changes nothing: the monitors keep the status they
   * have until the event ends and puts them back to operational. An event
   * that does not hold its monitors (still scheduled, or over) has nothing
   * to apply it to.
   *
   * The write has committed: whatever fails here is logged, never turned
   * into an error.
   */
  private async applyMonitorStatusToStartedEvent(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID | undefined;
    monitorStatusId: string | null;
  }): Promise<void> {
    if (!data.monitorStatusId || !data.projectId) {
      return;
    }

    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
      scheduledMaintenanceId: data.scheduledMaintenanceId.toString(),
    } as LogAttributes;

    try {
      const scheduledMaintenanceEvent: Model | null = await this.findOneById({
        id: data.scheduledMaintenanceId,
        select: {
          _id: true,
          currentScheduledMaintenanceState: STATE_KIND_SELECT,
          monitors: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      const monitorIds: Array<ObjectID> = this.getIdsNotIn({
        ids: resolveReferenceIds(scheduledMaintenanceEvent?.monitors),
        exclude: [],
      });

      if (!scheduledMaintenanceEvent || monitorIds.length === 0) {
        return;
      }

      const isHoldingMonitors: boolean =
        await ScheduledMaintenanceStateTimelineService.isScheduledMaintenanceHoldingMonitors(
          {
            scheduledMaintenanceId: data.scheduledMaintenanceId,
            projectId: data.projectId,
            currentState:
              scheduledMaintenanceEvent.currentScheduledMaintenanceState,
          },
        );

      if (!isHoldingMonitors) {
        return;
      }

      const eventWithStatus: Model = new Model(data.scheduledMaintenanceId);
      eventWithStatus.projectId = data.projectId;
      eventWithStatus.changeMonitorStatusToId = new ObjectID(
        data.monitorStatusId,
      );
      eventWithStatus.monitors = monitorIds.map(
        (monitorId: ObjectID): Monitor => {
          return new Monitor(monitorId);
        },
      );

      await this.changeAttachedMonitorStates(eventWithStatus, {
        isRoot: true,
      });
    } catch (err) {
      logger.error(
        `ScheduledMaintenanceService.applyMonitorStatusToStartedEvent: could not put the monitors of scheduled maintenance ${data.scheduledMaintenanceId.toString()} in the status it changes them to; the update itself is saved.`,
        logAttributes,
      );
      logger.error(err, logAttributes);
    }
  }

  /*
   * "Change Monitor Status to" for the updated feed item: the status the
   * event now changes its monitors to, by name, or that they keep theirs -
   * the words its Affected Resources card uses. The name is read held to
   * the project, so a status that is not the project's is never named; an
   * empty line then.
   */
  private async getMonitorStatusFeedMarkdown(data: {
    projectId: ObjectID | undefined;
    monitorStatusId: string | null;
  }): Promise<string> {
    if (!data.monitorStatusId) {
      return `\n\n**Change Monitor Status to**: Monitors keep their status.`;
    }

    if (!data.projectId) {
      return "";
    }

    const monitorStatus: MonitorStatus | null =
      await MonitorStatusService.findOneBy({
        query: {
          _id: data.monitorStatusId,
          projectId: data.projectId,
        },
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!monitorStatus?.name) {
      return "";
    }

    // The status's name is plain text.
    return `\n\n**Change Monitor Status to**: ${escapeMarkdownValue(monitorStatus.name)}`;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    CustomFieldMappingService.restampAfterMultiRowUpdate({
      definitionModelType: ScheduledMaintenanceCustomField,
      updateBy: onUpdate.updateBy,
      updatedItemIds: updatedItemIds,
    });

    /*
     * Rescheduling the planned window is the whole point of making these
     * fields editable, so the numbers derived from them have to move. Without
     * this the recompute fires only from the state-timeline hooks, and a
     * corrected startsAt leaves every derived value stale for good.
     */
    const anchorTimestampChanged: boolean = ["startsAt", "endsAt"].some(
      (key: string) => {
        return Object.prototype.hasOwnProperty.call(
          onUpdate.updateBy.data,
          key,
        );
      },
    );

    if (anchorTimestampChanged) {
      for (const itemId of updatedItemIds) {
        ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance(
          {
            scheduledMaintenanceId: itemId,
          },
        ).catch((err: Error) => {
          logger.error(err);
        });
      }
    }

    /*
     * The state the update wrote, under either of its names: onBeforeUpdate
     * refused two that disagree, so this reads one value.
     */
    const updatedStateId: ObjectID | null = RelationIdUtil.readConsistent(
      onUpdate.updateBy.data as unknown as Record<string, unknown>,
      STATE_KEYS,
      "Scheduled Maintenance State",
    );

    if (updatedStateId && onUpdate.updateBy.props.tenantId) {
      for (const itemId of updatedItemIds) {
        await this.changeScheduledMaintenanceState({
          projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          scheduledMaintenanceId: itemId,
          scheduledMaintenanceStateId: updatedStateId,
          shouldNotifyStatusPageSubscribers: true,
          isSubscribersNotified: false,
          notifyOwners: true, // notifyOwners = true
          props: {
            isRoot: true,
          },
        });
      }
    }

    if (updatedItemIds.length > 0) {
      for (const scheduledMaintenanceId of updatedItemIds) {
        let shouldAddScheduledMaintenanceFeed: boolean = false;
        let feedInfoInMarkdown: string =
          "**Scheduled Maintenance was updated.**";

        const createdByUserId: ObjectID | undefined | null =
          onUpdate.updateBy.props.userId;

        const carryForward: UpdateCarryForward | null | undefined =
          onUpdate.carryForward as UpdateCarryForward | null | undefined;

        const attachmentsBeforeUpdate: AttachmentsBeforeUpdate | undefined =
          carryForward?.attachments?.[scheduledMaintenanceId.toString()];

        const monitorStatusBeforeUpdate: MonitorStatusBeforeUpdate | undefined =
          carryForward?.monitorStatus?.[scheduledMaintenanceId.toString()];

        const written: Dictionary<unknown> = onUpdate.updateBy
          .data as unknown as Dictionary<unknown>;

        /*
         * What the update changed of the event's title, window, description,
         * reminders before the event, labels and Send reminders switch,
         * against what it held before the write
         * (recordStoredValuesBeforeUpdate). One the read did not see counts
         * as changed.
         */
        const fieldChanges: ScheduledMaintenanceFieldSet =
          ScheduledMaintenanceFieldChange.getChanges({
            written: written,
            valuesBeforeUpdate:
              carryForward?.valuesBeforeUpdate?.[
                scheduledMaintenanceId.toString()
              ],
          });

        // The lists it really changed: the status pages, what it affects.
        const changedListColumns: Array<string> = this.getChangedListColumns({
          written: written,
          columns: this.getComparedListColumns(),
          listIdsBeforeUpdate:
            carryForward?.listIdsBeforeUpdate?.[
              scheduledMaintenanceId.toString()
            ],
        });

        /*
         * The Change Monitor Status to the write stored, when it is another
         * than the event held: onBeforeUpdate let it through because the
         * event had not started. Null when the update did not change it -
         * sending back the status the event held is no change.
         */
        const changedMonitorStatus: { monitorStatusId: string | null } | null =
          this.getMonitorStatusChange({
            data: onUpdate.updateBy.data as unknown as Record<string, unknown>,
            monitorStatusBeforeUpdate: monitorStatusBeforeUpdate,
          });

        if (changedMonitorStatus && monitorStatusBeforeUpdate) {
          await this.applyMonitorStatusToStartedEvent({
            scheduledMaintenanceId: scheduledMaintenanceId,
            projectId: monitorStatusBeforeUpdate.projectId,
            monitorStatusId: changedMonitorStatus.monitorStatusId,
          });
        }

        let attachmentChange: AttachmentChange | null = null;

        if (attachmentsBeforeUpdate) {
          /*
           * The update is saved by now. Whatever fails here is logged, and
           * the feed item and the other events of a bulk update still
           * follow - with the change named in the feed, when it was read
           * back before the failure.
           */
          try {
            attachmentChange = await this.getAttachmentChange({
              scheduledMaintenanceId: scheduledMaintenanceId,
              attachmentsBeforeUpdate: attachmentsBeforeUpdate,
            });

            await this.applyAttachmentChangeToEvent({
              scheduledMaintenanceId: scheduledMaintenanceId,
              attachmentsBeforeUpdate: attachmentsBeforeUpdate,
              change: attachmentChange,
            });
          } catch (err) {
            const logAttributes: LogAttributes = {
              projectId: attachmentsBeforeUpdate.projectId?.toString(),
              scheduledMaintenanceId: scheduledMaintenanceId.toString(),
            } as LogAttributes;

            logger.error(
              `ScheduledMaintenanceService.onUpdateSuccess: could not apply the edit of the monitors or network sites of scheduled maintenance ${scheduledMaintenanceId.toString()}; the update itself is saved.`,
              logAttributes,
            );
            logger.error(err, logAttributes);
          }
        }

        /*
         * A line for each of the title, the window, the description and the
         * reminders before the event the update really changed: writing back
         * what the event holds - every save of its Maintenance Details card
         * sends them all - adds none.
         */
        const fieldsMarkdown: string =
          ScheduledMaintenanceFieldChange.getFeedMarkdown({
            written: written,
            changes: fieldChanges,
          });

        if (fieldsMarkdown) {
          feedInfoInMarkdown += fieldsMarkdown;
          shouldAddScheduledMaintenanceFeed = true;
        }

        /*
         * What the event affects now, when the update really changed any
         * affected-resource list - not only the monitors; the Affected
         * Resources card sends every list back with each save, so a list
         * sent back as it is changes nothing. The event is read back rather
         * than the ids in the payload being looked up: the read is held to
         * this project, and it names the whole list the card now shows. An
         * edit that leaves it affecting nothing has no list to show, as
         * before; the monitors taken off are named below.
         */
        const affectedResourcesChanged: boolean =
          this.getAffectedResourceListColumns().some(
            (column: string): boolean => {
              return changedListColumns.includes(column);
            },
          );

        if (affectedResourcesChanged && onUpdate.updateBy.props.tenantId) {
          const projectId: ObjectID = onUpdate.updateBy.props
            .tenantId as ObjectID;

          // A line the names could not be read for is left out, not the item.
          try {
            const resources: Array<LinkedAffectedResource> =
              await LinkedAffectedResources.readForScheduledMaintenance({
                service: this,
                projectId: projectId,
                scheduledMaintenanceId: scheduledMaintenanceId,
              });

            if (resources.length > 0) {
              feedInfoInMarkdown += `\n\n**Resources Affected**:

${LinkedAffectedResources.getMarkdownLines({
  dashboardUrl: await DatabaseConfig.getDashboardUrl(),
  projectId: projectId,
  resources: resources,
}).join("\n")}
`;

              shouldAddScheduledMaintenanceFeed = true;
            }
          } catch (err) {
            const logAttributes: LogAttributes = {
              projectId: projectId.toString(),
              scheduledMaintenanceId: scheduledMaintenanceId.toString(),
            } as LogAttributes;

            logger.error(
              `ScheduledMaintenanceService.onUpdateSuccess: could not name what scheduled maintenance ${scheduledMaintenanceId.toString()} now affects in its feed.`,
              logAttributes,
            );
            logger.error(err, logAttributes);
          }
        }

        /*
         * The list above is what the event affects now; these say what the
         * edit changed. Removing every monitor leaves no list to show, and
         * without this the feed would not record the edit at all.
         */
        if (attachmentChange && onUpdate.updateBy.props.tenantId) {
          // A line the names could not be read for is left out, not the item.
          try {
            const monitorChangesMarkdown: string =
              await this.getMonitorChangesFeedMarkdown({
                projectId: onUpdate.updateBy.props.tenantId as ObjectID,
                change: attachmentChange,
              });

            if (monitorChangesMarkdown) {
              feedInfoInMarkdown += monitorChangesMarkdown;
              shouldAddScheduledMaintenanceFeed = true;
            }
          } catch (err) {
            const logAttributes: LogAttributes = {
              projectId: onUpdate.updateBy.props.tenantId?.toString(),
              scheduledMaintenanceId: scheduledMaintenanceId.toString(),
            } as LogAttributes;

            logger.error(
              `ScheduledMaintenanceService.onUpdateSuccess: could not name the monitors added to or removed from scheduled maintenance ${scheduledMaintenanceId.toString()} in its feed.`,
              logAttributes,
            );
            logger.error(err, logAttributes);
          }
        }

        // Under the monitors it acts on, as the Affected Resources card shows it.
        if (changedMonitorStatus && monitorStatusBeforeUpdate) {
          // A line the name could not be read for is left out, not the item.
          try {
            const monitorStatusMarkdown: string =
              await this.getMonitorStatusFeedMarkdown({
                projectId: monitorStatusBeforeUpdate.projectId,
                monitorStatusId: changedMonitorStatus.monitorStatusId,
              });

            if (monitorStatusMarkdown) {
              feedInfoInMarkdown += monitorStatusMarkdown;
              shouldAddScheduledMaintenanceFeed = true;
            }
          } catch (err) {
            const logAttributes: LogAttributes = {
              projectId: monitorStatusBeforeUpdate.projectId?.toString(),
              scheduledMaintenanceId: scheduledMaintenanceId.toString(),
            } as LogAttributes;

            logger.error(
              `ScheduledMaintenanceService.onUpdateSuccess: could not name the monitor status scheduled maintenance ${scheduledMaintenanceId.toString()} now changes its monitors to in its feed.`,
              logAttributes,
            );
            logger.error(err, logAttributes);
          }
        }

        /*
         * The status pages the event is shown on now, when the update really
         * changed them, and its labels, when it really changed those - by
         * name, read within the event's project.
         */
        if (
          changedListColumns.includes("statusPages") &&
          onUpdate.updateBy.props.tenantId
        ) {
          const statusPagesMarkdown: string =
            await ScheduledMaintenanceFieldChange.getStatusPagesMarkdown({
              writtenStatusPages: written["statusPages"],
              projectId: onUpdate.updateBy.props.tenantId,
            });

          if (statusPagesMarkdown) {
            feedInfoInMarkdown += statusPagesMarkdown;
            shouldAddScheduledMaintenanceFeed = true;
          }
        }

        if (fieldChanges.labels && onUpdate.updateBy.props.tenantId) {
          const labelsMarkdown: string =
            await EventFieldChange.getLabelsMarkdown({
              writtenLabels: written["labels"],
              projectId: onUpdate.updateBy.props.tenantId,
            });

          if (labelsMarkdown) {
            feedInfoInMarkdown += labelsMarkdown;
            shouldAddScheduledMaintenanceFeed = true;
          }
        }

        if (shouldAddScheduledMaintenanceFeed) {
          await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
            {
              scheduledMaintenanceId: scheduledMaintenanceId,
              projectId: onUpdate.updateBy.props.tenantId as ObjectID,
              scheduledMaintenanceFeedEventType:
                ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated,
              displayColor: Gray500,
              feedInfoInMarkdown: feedInfoInMarkdown,
              userId: createdByUserId || undefined,
            },
          );
        }

        /*
         * The reminder rule is matched on the labels, and reminders can be
         * switched on or off. One refresh covers whichever of those the
         * update really changed - clearing the labels included - and none
         * runs when it changed neither: each refresh starts the interval
         * over, so writing back the labels the event has, as every save of
         * its Maintenance Details card does, must not.
         */
        if (
          onUpdate.updateBy.props.tenantId &&
          (fieldChanges.labels || fieldChanges.enableReminders)
        ) {
          try {
            await this.refreshReminderSchedule({
              scheduledMaintenanceId: scheduledMaintenanceId,
              projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            });
          } catch (reminderError) {
            logger.error(
              `Reminder rescheduling failed in ScheduledMaintenanceService.onUpdateSuccess: ${reminderError}`,
              {
                projectId: onUpdate.updateBy.props.tenantId?.toString(),
                scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
              } as LogAttributes,
            );
          }
        }
      }
    }

    return onUpdate;
  }

  @CaptureSpan()
  public async changeScheduledMaintenanceState(data: {
    projectId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    scheduledMaintenanceStateId: ObjectID;
    shouldNotifyStatusPageSubscribers: boolean;
    isSubscribersNotified: boolean;
    notifyOwners: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const {
      projectId,
      scheduledMaintenanceId,
      scheduledMaintenanceStateId,
      notifyOwners,
      shouldNotifyStatusPageSubscribers,
      isSubscribersNotified,
      props,
    } = data;

    if (!projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is required");
    }

    if (!scheduledMaintenanceStateId) {
      throw new BadDataException("scheduledMaintenanceStateId is required");
    }

    // get last scheduled status timeline.
    const lastState: ScheduledMaintenanceStateTimeline | null =
      await ScheduledMaintenanceStateTimelineService.findOneBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenanceId,
          projectId: projectId,
        },
        select: {
          _id: true,
          scheduledMaintenanceStateId: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      lastState &&
      lastState.scheduledMaintenanceStateId &&
      lastState.scheduledMaintenanceStateId.toString() ===
        scheduledMaintenanceStateId.toString()
    ) {
      return;
    }

    const statusTimeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();

    statusTimeline.scheduledMaintenanceId = scheduledMaintenanceId;
    statusTimeline.scheduledMaintenanceStateId = scheduledMaintenanceStateId;
    statusTimeline.projectId = projectId;
    statusTimeline.isOwnerNotified = !notifyOwners;
    // Map boolean to enum value
    statusTimeline.subscriberNotificationStatus = isSubscribersNotified
      ? StatusPageSubscriberNotificationStatus.Success
      : StatusPageSubscriberNotificationStatus.Pending;
    statusTimeline.shouldStatusPageSubscribersBeNotified =
      shouldNotifyStatusPageSubscribers;

    await ScheduledMaintenanceStateTimelineService.create({
      data: statusTimeline,
      props: props,
    });

    await this.updateBy({
      data: {
        currentScheduledMaintenanceStateId: scheduledMaintenanceStateId.id,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      query: {
        _id: scheduledMaintenanceId.toString()!,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async isScheduledMaintenanceCompleted(data: {
    scheduledMaintenanceId: ObjectID;
  }): Promise<boolean> {
    const scheduledMaintenance: Model | null = await this.findOneBy({
      query: {
        _id: data.scheduledMaintenanceId,
      },
      select: {
        projectId: true,
        currentScheduledMaintenanceState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("ScheduledMaintenance not found");
    }

    if (!scheduledMaintenance.projectId) {
      throw new BadDataException("Incident Project ID not found");
    }

    const resolvedScheduledMaintenanceState: ScheduledMaintenanceState =
      await ScheduledMaintenanceStateService.getCompletedScheduledMaintenanceState(
        {
          projectId: scheduledMaintenance.projectId,
          props: {
            isRoot: true,
          },
        },
      );

    const currentScheduledMaintenanceStateOrder: number =
      scheduledMaintenance.currentScheduledMaintenanceState!.order!;
    const resolvedScheduledMaintenanceStateOrder: number =
      resolvedScheduledMaintenanceState.order!;

    if (
      currentScheduledMaintenanceStateOrder >=
      resolvedScheduledMaintenanceStateOrder
    ) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public async getScheduledMaintenanceNumber(data: {
    scheduledMaintenanceId: ObjectID;
  }): Promise<{
    number: number | null;
    numberWithPrefix: string | null;
  }> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: data.scheduledMaintenanceId,
      select: {
        scheduledMaintenanceNumber: true,
        scheduledMaintenanceNumberWithPrefix: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("ScheduledMaintenance not found.");
    }

    return {
      number: scheduledMaintenance.scheduledMaintenanceNumber
        ? Number(scheduledMaintenance.scheduledMaintenanceNumber)
        : null,
      numberWithPrefix:
        scheduledMaintenance.scheduledMaintenanceNumberWithPrefix || null,
    };
  }

  @CaptureSpan()
  public async isScheduledMaintenanceOngoing(data: {
    scheduledMaintenanceId: ObjectID;
  }): Promise<boolean> {
    const scheduledMaintenance: Model | null = await this.findOneBy({
      query: {
        _id: data.scheduledMaintenanceId,
      },
      select: {
        projectId: true,
        currentScheduledMaintenanceState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("ScheduledMaintenance not found");
    }

    if (!scheduledMaintenance.projectId) {
      throw new BadDataException("Incident Project ID not found");
    }

    const ackScheduledMaintenanceState: ScheduledMaintenanceState =
      await ScheduledMaintenanceStateService.getOngoingScheduledMaintenanceState(
        {
          projectId: scheduledMaintenance.projectId,
          props: {
            isRoot: true,
          },
        },
      );

    const currentScheduledMaintenanceStateOrder: number =
      scheduledMaintenance.currentScheduledMaintenanceState!.order!;
    const ackScheduledMaintenanceStateOrder: number =
      ackScheduledMaintenanceState.order!;

    if (
      currentScheduledMaintenanceStateOrder >= ackScheduledMaintenanceStateOrder
    ) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public async markScheduledMaintenanceAsComplete(
    scheduledMaintenanceId: ObjectID,
    resolvedByUserId: ObjectID,
  ): Promise<Model> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: scheduledMaintenanceId,
      select: {
        projectId: true,
        scheduledMaintenanceNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance || !scheduledMaintenance.projectId) {
      throw new BadDataException("ScheduledMaintenance not found.");
    }

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          projectId: scheduledMaintenance.projectId,
          isResolvedState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
      throw new BadDataException(
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    scheduledMaintenanceStateTimeline.projectId =
      scheduledMaintenance.projectId;
    scheduledMaintenanceStateTimeline.scheduledMaintenanceId =
      scheduledMaintenanceId;
    scheduledMaintenanceStateTimeline.scheduledMaintenanceStateId =
      scheduledMaintenanceState.id;
    scheduledMaintenanceStateTimeline.createdByUserId = resolvedByUserId;

    await ScheduledMaintenanceStateTimelineService.create({
      data: scheduledMaintenanceStateTimeline,
      props: {
        isRoot: true,
      },
    });

    // store scheduledMaintenance metric

    return scheduledMaintenance;
  }

  @CaptureSpan()
  public async markScheduledMaintenanceAsOngoing(
    scheduledMaintenanceId: ObjectID,
    markedByUserId: ObjectID,
  ): Promise<Model> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: scheduledMaintenanceId,
      select: {
        projectId: true,
        scheduledMaintenanceNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance || !scheduledMaintenance.projectId) {
      throw new BadDataException("ScheduledMaintenance not found.");
    }

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          projectId: scheduledMaintenance.projectId,
          isOngoingState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
      throw new BadDataException(
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    scheduledMaintenanceStateTimeline.projectId =
      scheduledMaintenance.projectId;
    scheduledMaintenanceStateTimeline.scheduledMaintenanceId =
      scheduledMaintenanceId;
    scheduledMaintenanceStateTimeline.scheduledMaintenanceStateId =
      scheduledMaintenanceState.id;
    scheduledMaintenanceStateTimeline.createdByUserId = markedByUserId;

    await ScheduledMaintenanceStateTimelineService.create({
      data: scheduledMaintenanceStateTimeline,
      props: {
        isRoot: true,
      },
    });

    // store scheduledMaintenance metric

    return scheduledMaintenance;
  }

  @CaptureSpan()
  public async getWorkspaceChannelForScheduledMaintenance(data: {
    scheduledMaintenanceId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: data.scheduledMaintenanceId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!scheduledMaintenance) {
      throw new BadDataException("ScheduledMaintenance not found.");
    }

    return (scheduledMaintenance.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  /**
   * Ensures the currentScheduledMaintenanceStateId of the scheduled maintenance matches the latest timeline entry.
   */
  public async refreshScheduledMaintenanceCurrentStatus(
    scheduledMaintenanceId: ObjectID,
  ): Promise<void> {
    const scheduledMaintenance: Model | null = await this.findOneById({
      id: scheduledMaintenanceId,
      select: {
        _id: true,
        projectId: true,
        currentScheduledMaintenanceStateId: true,
      },
      props: { isRoot: true },
    });
    if (!scheduledMaintenance || !scheduledMaintenance.projectId) {
      return;
    }
    const latestTimeline: ScheduledMaintenanceStateTimeline | null =
      await ScheduledMaintenanceStateTimelineService.findOneBy({
        query: {
          scheduledMaintenanceId: scheduledMaintenance.id!,
          projectId: scheduledMaintenance.projectId,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        select: {
          scheduledMaintenanceStateId: true,
        },
        props: {
          isRoot: true,
        },
      });
    if (
      latestTimeline &&
      latestTimeline.scheduledMaintenanceStateId &&
      scheduledMaintenance.currentScheduledMaintenanceStateId?.toString() !==
        latestTimeline.scheduledMaintenanceStateId.toString()
    ) {
      await this.updateOneBy({
        query: { _id: scheduledMaintenance.id!.toString() },
        data: {
          currentScheduledMaintenanceStateId:
            latestTimeline.scheduledMaintenanceStateId,
        },
        props: { isRoot: true },
      });
      logger.info(
        `Updated ScheduledMaintenance ${scheduledMaintenance.id} current state to ${latestTimeline.scheduledMaintenanceStateId}`,
        {
          projectId: scheduledMaintenance.projectId?.toString(),
        } as LogAttributes,
      );
    }
  }
}
export default new Service();
