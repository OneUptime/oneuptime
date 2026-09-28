import URL from "../API/URL";
import { JSONObject } from "../JSON";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceCounts,
  IncidentSubscriberAudienceResult,
} from "./IncidentSubscriberAudience";
import StatusPageSubscriberUnsubscribe from "./StatusPageSubscriberUnsubscribe";

/*
 * "Preview notification" and "Send test to me": the email a status page's
 * subscribers would get about an incident, shown before anything is sent -
 * on the last step of declaring an incident, and while a public note is being
 * written.
 *
 * The server (App/FeatureSet/Notification/API/SubscriberNotificationPreview)
 * builds each page's email through SubscriberIncidentEmailBuilder, the one
 * code path the subscriber jobs send through, and renders it with the mailer's
 * own MailService.render. So the subject and HTML shown here are the ones a
 * subscriber gets, apart from one thing: every subscriber's unsubscribe link
 * carries their own token, which a preview has no subscriber to take it from,
 * so the preview's link is a sample (getPreviewUnsubscribeUrl).
 *
 * Only counts ever leave the server: no subscriber address is read out.
 *
 * Everything here is shared by the server, which answers, and the dashboard,
 * which asks and shows, so the two cannot drift apart.
 */

// Which email is previewed.
export enum SubscriberNotificationPreviewEvent {
  // "Incident created", for an incident that is being declared.
  IncidentCreated = "IncidentCreated",
  // "Incident update", for a public note being written on an incident.
  IncidentPublicNoteCreated = "IncidentPublicNoteCreated",
}

/*
 * Why a status page's subscribers get the email they get. The jobs use the
 * page's custom email template only when it has a body and the page sends
 * through its own SMTP server; everything else gets the default email.
 */
export enum SubscriberEmailTemplateChoiceReason {
  // The page's custom template, sent through the page's own SMTP server.
  CustomTemplate = "CustomTemplate",
  // No custom email template is linked to the page for this event.
  NoCustomTemplate = "NoCustomTemplate",
  // A custom template is linked, but the page has no SMTP server of its own.
  CustomTemplateNeedsCustomSmtp = "CustomTemplateNeedsCustomSmtp",
  // A custom template is linked, but its body is empty.
  CustomTemplateIsEmpty = "CustomTemplateIsEmpty",
}

export interface SubscriberEmailTemplateChoice {
  usesCustomTemplate: boolean;
  reason: SubscriberEmailTemplateChoiceReason;
  // The linked custom template's name, when there is one (used or not).
  customTemplateName?: string | undefined;
}

// Why nothing will be sent, whatever the email would look like.
export enum SubscriberNotificationPreviewNothingSentReason {
  // No monitor: subscribers hear about an incident through its monitors.
  NoMonitors = "NoMonitors",
  // The incident exists and is hidden from status pages (or private).
  HiddenFromStatusPages = "HiddenFromStatusPages",
  // The incident being declared is private.
  PrivateIncident = "PrivateIncident",
  // 'Notify Status Page Subscribers' is off on the incident being declared.
  NotifyOff = "NotifyOff",
  // No status page that lists its monitors will show it.
  NoStatusPages = "NoStatusPages",
}

// One status page's email, as its subscribers would get it.
export interface SubscriberNotificationPreviewStatusPage {
  statusPageId: string;
  name: string;
  // The audience summary's "up to" counts, per channel (IncidentSubscriberAudience).
  subscriberCounts: IncidentSubscriberAudienceCounts;
  subject: string;
  html: string;
  templateChoice: SubscriberEmailTemplateChoice;
}

export interface SubscriberNotificationPreviewResult {
  event: SubscriberNotificationPreviewEvent;
  /*
   * Set when nothing will be sent at all; there are no emails to show then.
   * Null when at least one status page will be sent the email.
   */
  nothingSentReason: SubscriberNotificationPreviewNothingSentReason | null;
  /*
   * The pages that will be sent the email that the caller can see, in name
   * order. A page the caller cannot read is neither named nor previewed: it
   * is counted in audience.hiddenStatusPageCount.
   */
  statusPages: Array<SubscriberNotificationPreviewStatusPage>;
  // Who will be told, as the "Will notify" summary shows it.
  audience: IncidentSubscriberAudienceResult;
}

/*
 * The fields of the Declare Incident form that reach the 'incident created'
 * email. The email shows no state, so the state is not asked for.
 */
export interface SubscriberNotificationPreviewIncidentDraft {
  title: string;
  description: string;
  incidentSeverityId: string | null;
  monitorIds: Array<string>;
  statusPageIds: Array<string>;
  labelIds: Array<string>;
  // The custom field values, by field name, as the incident would store them.
  customFields: JSONObject;
  isPrivate: boolean;
  shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: boolean;
}

export type SubscriberNotificationPreviewRequest =
  | {
      event: SubscriberNotificationPreviewEvent.IncidentCreated;
      incident: SubscriberNotificationPreviewIncidentDraft;
    }
  | {
      event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated;
      incidentId: string;
      // The note being written, as Markdown.
      note: string;
      // When the note will say it was posted; null means now.
      postedAt: Date | null;
    };

// "Send test to me": one page's email, sent to the caller's own address.
export type SubscriberNotificationSendTestRequest =
  SubscriberNotificationPreviewRequest & {
    statusPageId: string;
  };

export interface SubscriberNotificationSendTestResult {
  // The caller's own account email, where the test went.
  sentTo: string;
}

export default class SubscriberNotificationPreview {
  // Where the router is mounted, under the notification API.
  public static readonly routerPath: string =
    "/subscriber-notification-preview";

  public static readonly previewPath: string = "/preview";

  public static readonly sendTestPath: string = "/send-test";

  // The longest note or description a preview takes.
  public static readonly maxTextLength: number = 100000;

  // The longest title a preview takes.
  public static readonly maxTitleLength: number = 1000;

  /*
   * The most custom field values an incident being previewed carries, and
   * how long they may be together, written out as JSON. Each value is
   * rendered, Markdown included, and goes into every page's email, so
   * without a bound one request could make the server render as much as it
   * can be sent. A project's own fields fit many times over.
   */
  public static readonly maxCustomFieldCount: number = 250;

  public static readonly maxCustomFieldsLength: number = 200000;

  // What a test email's subject starts with, so it reads as a test.
  public static readonly testEmailSubjectPrefix: string = "[Test] ";

  /*
   * The unsubscribe link a preview and a test email carry. A subscriber's
   * real link carries its own token (StatusPageSubscriberUnsubscribe), which
   * a preview has no subscriber for, so this one names no subscription: the
   * status page opens it as an out-of-date link and changes nothing.
   */
  public static getPreviewUnsubscribeUrl(statusPageUrl: string): string {
    return URL.fromString(statusPageUrl)
      .addRoute(
        `/${StatusPageSubscriberUnsubscribe.PAGE_ROUTE_SEGMENT}/preview`,
      )
      .toString();
  }

  public static toJSON(
    result: SubscriberNotificationPreviewResult,
  ): JSONObject {
    return {
      event: result.event,
      nothingSentReason: result.nothingSentReason,
      statusPages: result.statusPages.map(
        (statusPage: SubscriberNotificationPreviewStatusPage): JSONObject => {
          return {
            statusPageId: statusPage.statusPageId,
            name: statusPage.name,
            subscriberCounts: { ...statusPage.subscriberCounts },
            subject: statusPage.subject,
            html: statusPage.html,
            templateChoice: {
              usesCustomTemplate: statusPage.templateChoice.usesCustomTemplate,
              reason: statusPage.templateChoice.reason,
              customTemplateName:
                statusPage.templateChoice.customTemplateName || null,
            },
          };
        },
      ),
      audience: IncidentSubscriberAudience.toJSON(result.audience),
    };
  }

  /*
   * The server's answer as the dashboard receives it. Read defensively: a
   * field that is missing or of the wrong type reads as "nothing", so a
   * preview can never break the form it opens from.
   */
  public static fromJSON(
    json: JSONObject,
  ): SubscriberNotificationPreviewResult {
    const events: Array<string> = Object.values(
      SubscriberNotificationPreviewEvent,
    );
    const reasons: Array<string> = Object.values(
      SubscriberNotificationPreviewNothingSentReason,
    );
    const choiceReasons: Array<string> = Object.values(
      SubscriberEmailTemplateChoiceReason,
    );

    const statusPagesJson: Array<JSONObject> = Array.isArray(
      json["statusPages"],
    )
      ? ((json["statusPages"] as Array<unknown>).filter(
          (item: unknown): boolean => {
            return Boolean(item) && typeof item === "object";
          },
        ) as Array<JSONObject>)
      : [];

    return {
      event: events.includes(String(json["event"]))
        ? (json["event"] as SubscriberNotificationPreviewEvent)
        : SubscriberNotificationPreviewEvent.IncidentCreated,
      nothingSentReason: reasons.includes(String(json["nothingSentReason"]))
        ? (json[
            "nothingSentReason"
          ] as SubscriberNotificationPreviewNothingSentReason)
        : null,
      statusPages: statusPagesJson.map(
        (item: JSONObject): SubscriberNotificationPreviewStatusPage => {
          const choice: JSONObject =
            (item["templateChoice"] as JSONObject | undefined) || {};

          return {
            statusPageId: String(item["statusPageId"] || ""),
            name: String(item["name"] || ""),
            subscriberCounts: IncidentSubscriberAudience.countsFromJSON(
              item["subscriberCounts"],
            ),
            subject: String(item["subject"] || ""),
            html: String(item["html"] || ""),
            templateChoice: {
              usesCustomTemplate: choice["usesCustomTemplate"] === true,
              reason: choiceReasons.includes(String(choice["reason"]))
                ? (choice["reason"] as SubscriberEmailTemplateChoiceReason)
                : SubscriberEmailTemplateChoiceReason.NoCustomTemplate,
              customTemplateName:
                typeof choice["customTemplateName"] === "string" &&
                choice["customTemplateName"]
                  ? choice["customTemplateName"]
                  : undefined,
            },
          };
        },
      ),
      audience: IncidentSubscriberAudience.fromJSON(
        (json["audience"] as JSONObject | undefined) || {},
      ),
    };
  }

  // A request as it travels: the dates as ISO strings.
  public static requestToJSON(
    request:
      | SubscriberNotificationPreviewRequest
      | SubscriberNotificationSendTestRequest,
  ): JSONObject {
    const json: JSONObject = {
      event: request.event,
    };

    if (request.event === SubscriberNotificationPreviewEvent.IncidentCreated) {
      json["incident"] = {
        title: request.incident.title,
        description: request.incident.description,
        incidentSeverityId: request.incident.incidentSeverityId,
        monitorIds: [...request.incident.monitorIds],
        statusPageIds: [...request.incident.statusPageIds],
        labelIds: [...request.incident.labelIds],
        customFields: { ...request.incident.customFields },
        isPrivate: request.incident.isPrivate,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
          request.incident
            .shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      };
    } else {
      json["incidentId"] = request.incidentId;
      json["note"] = request.note;
      json["postedAt"] = request.postedAt
        ? request.postedAt.toISOString()
        : null;
    }

    if ("statusPageId" in request && request.statusPageId) {
      json["statusPageId"] = request.statusPageId;
    }

    return json;
  }
}
