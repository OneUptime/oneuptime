import Incident from "../../../Models/DatabaseModels/Incident";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import { StatusPageApiRoute } from "../../../ServiceRoute";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import {
  SubscriberEmailTemplateChoice,
  SubscriberEmailTemplateChoiceReason,
} from "../../../Types/StatusPage/SubscriberNotificationPreview";
import SubscriberNotificationTrigger from "../../../Types/StatusPage/SubscriberNotificationTrigger";
import { Service as StatusPageServiceType } from "../../Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
  SubscriberNotificationEmailBodyTemplateVariables,
} from "../../Services/StatusPageSubscriberNotificationTemplateService";
import IncidentTemplateVariableBuilder, {
  IncidentStatusPageTemplateVariables,
  IncidentTemplateVariables,
} from "./IncidentTemplateVariableBuilder";

/*
 * The email a status page's subscribers get about an incident - its subject
 * and its body, from the page's custom template or the default one - for the
 * 'incident created' and public note (posted and updated) notifications.
 *
 * The one code path for it. The subscriber jobs send what this builds
 * (Workers/Jobs/Incident/SendNotificationToSubscribers and
 * Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers), and "Preview
 * notification" and "Send test to me" show and send the same thing
 * (Notification/API/SubscriberNotificationPreview), rendered by the same
 * mailer (Notification MailService.render). A preview therefore cannot show
 * one email while subscribers are sent another.
 *
 * It builds on what the jobs already share, rather than repeating it:
 *
 *   - IncidentTemplateVariableBuilder for the values, in each channel's
 *     format (buildTemplateVariables reads them for an event), and
 *   - SubscriberNotificationTemplateCompiler, through the template service,
 *     for a custom template: compileEmailBodyTemplate for the body, which
 *     escapes every plain value, and compileTemplate for the subject.
 *
 * The page's custom email template is used only when it has a body and the
 * page sends through its own SMTP server, as the jobs have always done;
 * templateChoice says which email the page's subscribers get, and why.
 *
 * Building an email has no side effects. Sending one does: the custom field
 * values it carries are recorded for the incident feed, and a Rich text
 * field's inline images are made public so the recipient can load them. So a
 * job calls recordSending before each message goes out, and a preview never
 * does - previewing an email must not publish anything.
 */

// Which notification the email is for.
export enum SubscriberIncidentEmailEvent {
  IncidentCreated = "IncidentCreated",
  IncidentPublicNoteCreated = "IncidentPublicNoteCreated",
  IncidentPublicNoteUpdated = "IncidentPublicNoteUpdated",
}

interface SubscriberIncidentEmailCopy {
  // The custom templates this event's email is looked up by.
  templateEventType: StatusPageSubscriberNotificationEventType;
  // The default email's template.
  defaultTemplateType: EmailTemplateType;
  // The default email's subject, before the incident title.
  defaultSubjectPrefix: string;
  // A custom template with no subject of its own: before the incident title.
  customTemplateSubjectPrefix: string;
}

const EMAIL_COPY: Record<
  SubscriberIncidentEmailEvent,
  SubscriberIncidentEmailCopy
> = {
  [SubscriberIncidentEmailEvent.IncidentCreated]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
    defaultTemplateType: EmailTemplateType.SubscriberIncidentCreated,
    defaultSubjectPrefix: "[Incident] ",
    customTemplateSubjectPrefix: "[Incident] ",
  },
  [SubscriberIncidentEmailEvent.IncidentPublicNoteCreated]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
    defaultTemplateType: EmailTemplateType.SubscriberIncidentNoteCreated,
    defaultSubjectPrefix: "[Update Incident] ",
    customTemplateSubjectPrefix: "[Incident Update] ",
  },
  [SubscriberIncidentEmailEvent.IncidentPublicNoteUpdated]: {
    templateEventType:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
    defaultTemplateType: EmailTemplateType.SubscriberIncidentNoteUpdated,
    defaultSubjectPrefix: "[Incident Note Updated] ",
    customTemplateSubjectPrefix: "[Incident Note Updated] ",
  },
};

// One subscriber's email, ready for the mailer.
export interface SubscriberIncidentEmail {
  // The subject as it is sent: final text, never compiled again.
  subject: string;
  /*
   * Everything the mailer takes but the recipient: the template and its
   * variables, and the subject. MailService.sendMail sends it (with toEmail
   * added) and Notification MailService.render renders it.
   */
  envelope: EmailEnvelope;
}

// One status page's email, before it is addressed to anyone.
export interface SubscriberIncidentStatusPageEmail {
  // Which email the page's subscribers get, and why.
  templateChoice: SubscriberEmailTemplateChoice;
  /*
   * The email one subscriber gets: the page's email, with the subscriber's
   * own unsubscribe link. Pure: it can be called for a preview.
   */
  forSubscriber: (data: { unsubscribeUrl: string }) => SubscriberIncidentEmail;
  /*
   * An email is about to go out: records the custom field values it carries
   * (for the incident feed) and makes their inline images public. Awaited
   * before each send. Never called for a preview. Never throws.
   */
  recordSending: () => Promise<void>;
}

export default class SubscriberIncidentEmailBuilder {
  // The event a public note's notification is.
  public static getPublicNoteEvent(
    trigger: SubscriberNotificationTrigger,
  ): SubscriberIncidentEmailEvent {
    return trigger === SubscriberNotificationTrigger.Updated
      ? SubscriberIncidentEmailEvent.IncidentPublicNoteUpdated
      : SubscriberIncidentEmailEvent.IncidentPublicNoteCreated;
  }

  // The event type the event's custom templates are saved under.
  public static getTemplateEventType(
    event: SubscriberIncidentEmailEvent,
  ): StatusPageSubscriberNotificationEventType {
    return EMAIL_COPY[event].templateEventType;
  }

  /**
   * The values every message of this event is filled with, on every
   * channel, read once per send (IncidentTemplateVariableBuilder).
   *
   * The incident needs projectId, title, incidentSeverity.name, labels.name
   * and customFields; a public note's also currentIncidentState.name.
   * statusPages are the pages the send reaches, which name
   * {{affectedStatusPages}}. A public note's event takes the note and when
   * it says it was posted - an update reads it fresh from the row, and only a
   * note with none falls back to now.
   */
  public static async buildTemplateVariables(data: {
    event: SubscriberIncidentEmailEvent;
    incident: Incident;
    statusPages: Array<StatusPage>;
    note?:
      | {
          text: string | null | undefined;
          postedAt: Date | null | undefined;
        }
      | undefined;
  }): Promise<IncidentTemplateVariables> {
    if (data.event === SubscriberIncidentEmailEvent.IncidentCreated) {
      return IncidentTemplateVariableBuilder.build({
        incident: data.incident,
        statusPages: data.statusPages,
        markdownVariables: {
          incidentDescription: data.incident.description,
        },
      });
    }

    return IncidentTemplateVariableBuilder.build({
      incident: data.incident,
      statusPages: data.statusPages,
      markdownVariables: {
        note: data.note?.text,
      },
      textVariables: {
        incidentState: data.incident.currentIncidentState?.name || "",
        postedAt: OneUptimeDate.getDateAsUserFriendlyFormattedString(
          data.note?.postedAt || OneUptimeDate.getCurrentDate(),
        ),
      },
    });
  }

  /*
   * The incident on the status page, or the status page itself for an
   * incident that has no id yet (one being previewed before it is declared).
   */
  public static getDetailsUrl(data: {
    statusPageUrl: string;
    incidentId: ObjectID | null | undefined;
  }): string {
    return data.incidentId && data.statusPageUrl
      ? URL.fromString(data.statusPageUrl)
          .addRoute(`/incidents/${data.incidentId.toString()}`)
          .toString()
      : data.statusPageUrl;
  }

  // The status page's logo, for the default email, or "" when it has none.
  public static getLogoUrl(data: {
    statusPage: StatusPage;
    host: Hostname;
    httpProtocol: Protocol;
  }): string {
    const statusPageId: string | null =
      data.statusPage.id?.toString() || data.statusPage._id?.toString() || null;

    return data.statusPage.logoFileId && statusPageId
      ? new URL(data.httpProtocol, data.host)
          .addRoute(StatusPageApiRoute)
          .addRoute(`/logo/${statusPageId}`)
          .toString()
      : "";
  }

  /*
   * Which email a page's subscribers get: its custom template only when the
   * template has a body and the page sends through its own SMTP server.
   */
  public static chooseTemplate(data: {
    emailTemplate: StatusPageSubscriberNotificationTemplate | null;
    statusPage: StatusPage;
  }): SubscriberEmailTemplateChoice {
    const customTemplateName: string | undefined =
      data.emailTemplate?.templateName || undefined;

    if (!data.emailTemplate) {
      return {
        usesCustomTemplate: false,
        reason: SubscriberEmailTemplateChoiceReason.NoCustomTemplate,
      };
    }

    if (!data.emailTemplate.templateBody) {
      return {
        usesCustomTemplate: false,
        reason: SubscriberEmailTemplateChoiceReason.CustomTemplateIsEmpty,
        customTemplateName: customTemplateName,
      };
    }

    if (!data.statusPage.smtpConfig) {
      return {
        usesCustomTemplate: false,
        reason:
          SubscriberEmailTemplateChoiceReason.CustomTemplateNeedsCustomSmtp,
        customTemplateName: customTemplateName,
      };
    }

    return {
      usesCustomTemplate: true,
      reason: SubscriberEmailTemplateChoiceReason.CustomTemplate,
      customTemplateName: customTemplateName,
    };
  }

  /**
   * One status page's email for this event. Looks up the page's custom
   * email template for the event; everything else comes in: the values
   * (buildTemplateVariables, then forStatusPage for this page), the page's
   * URL and the incident's details URL on it (getDetailsUrl), and the
   * instance's host and protocol for the logo.
   *
   * The page needs what StatusPageSubscriberService.
   * getStatusPagesToSendNotification reads: its names, logoFileId,
   * isPublicStatusPage, smtpConfig and the footer text columns.
   */
  public static async forStatusPage(data: {
    event: SubscriberIncidentEmailEvent;
    incident: Incident;
    incidentTemplateVariables: IncidentTemplateVariables;
    statusPage: StatusPage;
    statusPageUrl: string;
    detailsUrl: string;
    pageTemplateVariables: IncidentStatusPageTemplateVariables;
    host: Hostname;
    httpProtocol: Protocol;
  }): Promise<SubscriberIncidentStatusPageEmail> {
    const copy: SubscriberIncidentEmailCopy = EMAIL_COPY[data.event];
    const statusPage: StatusPage = data.statusPage;
    const incidentTemplateVariables: IncidentTemplateVariables =
      data.incidentTemplateVariables;
    const pageTemplateVariables: IncidentStatusPageTemplateVariables =
      data.pageTemplateVariables;
    const incidentTitle: string = data.incident.title || "";

    if (!statusPage.id) {
      throw new BadDataException(
        "Cannot build a status page's subscriber email without its id.",
      );
    }

    const emailTemplate: StatusPageSubscriberNotificationTemplate | null =
      await StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
        {
          statusPageId: statusPage.id,
          eventType: copy.templateEventType,
          notificationMethod: StatusPageSubscriberNotificationMethod.Email,
        },
      );

    const templateChoice: SubscriberEmailTemplateChoice = this.chooseTemplate({
      emailTemplate: emailTemplate,
      statusPage: statusPage,
    });

    if (templateChoice.usesCustomTemplate) {
      return {
        templateChoice: templateChoice,
        forSubscriber: (subscriber: {
          unsubscribeUrl: string;
        }): SubscriberIncidentEmail => {
          /*
           * The body is HTML (BlankTemplate wraps nothing around it), so its
           * plain values are escaped; the subject is text, and gets them as
           * written.
           */
          const emailBodyTemplateVariables: SubscriberNotificationEmailBodyTemplateVariables =
            {
              ...pageTemplateVariables.emailBody,
              unsubscribeUrl: subscriber.unsubscribeUrl,
            };
          const plainTextTemplateVariables: Record<string, string> = {
            ...pageTemplateVariables.plainText,
            unsubscribeUrl: subscriber.unsubscribeUrl,
          };

          const compiledBody: string =
            StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate(
              emailTemplate!.templateBody!,
              emailBodyTemplateVariables,
            );
          const compiledSubject: string = emailTemplate!.emailSubject
            ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
                emailTemplate!.emailSubject,
                plainTextTemplateVariables,
              )
            : copy.customTemplateSubjectPrefix + incidentTitle;

          return {
            subject: compiledSubject,
            envelope: {
              templateType: EmailTemplateType.BlankTemplate,
              vars: {
                body: compiledBody,
              },
              subject: compiledSubject,
              isSubjectLiteral: true,
            },
          };
        },
        recordSending: async (): Promise<void> => {
          await incidentTemplateVariables.recordFieldsUsedBy([
            emailTemplate!.templateBody,
            emailTemplate!.emailSubject,
          ]);
        },
      };
    }

    const subject: string = copy.defaultSubjectPrefix + incidentTitle;

    // What the default email reads that does not vary per subscriber.
    const pageVars: JSONObject = {
      statusPageName:
        IncidentTemplateVariableBuilder.getStatusPageName(statusPage),
      statusPageUrl: data.statusPageUrl,
      detailsUrl: data.detailsUrl,
      logoUrl: this.getLogoUrl({
        statusPage: statusPage,
        host: data.host,
        httpProtocol: data.httpProtocol,
      }),
      isPublicStatusPage: statusPage.isPublicStatusPage ? "true" : "false",
      // Every name escaped, "<br/>" between groups: for the raw slot.
      resourcesAffected: pageTemplateVariables.resourcesAffectedHtml,
      incidentSeverity: data.incident.incidentSeverity?.name || " - ",
      incidentTitle: incidentTitle,
      // The fields marked "Include in Subscriber Notifications".
      customFieldRows:
        pageTemplateVariables.customFieldRows as unknown as JSONObject,
      subscriberEmailNotificationFooterText:
        StatusPageServiceType.getSubscriberEmailFooterText(statusPage),
    };

    // The event's own content, rendered from Markdown once per send.
    if (data.event === SubscriberIncidentEmailEvent.IncidentCreated) {
      pageVars["incidentDescription"] =
        incidentTemplateVariables.getMarkdownVariable(
          "incidentDescription",
        ).html;
    } else {
      pageVars["note"] =
        incidentTemplateVariables.getMarkdownVariable("note").html;
    }

    return {
      templateChoice: templateChoice,
      forSubscriber: (subscriber: {
        unsubscribeUrl: string;
      }): SubscriberIncidentEmail => {
        return {
          subject: subject,
          envelope: {
            templateType: copy.defaultTemplateType,
            vars: {
              ...pageVars,
              unsubscribeUrl: subscriber.unsubscribeUrl,
            } as EmailEnvelope["vars"],
            subject: subject,
            isSubjectLiteral: true,
          },
        };
      },
      recordSending: async (): Promise<void> => {
        await incidentTemplateVariables.recordIncludedFieldsSent();
      },
    };
  }
}
