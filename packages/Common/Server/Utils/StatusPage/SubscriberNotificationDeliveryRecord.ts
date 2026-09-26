import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import {
  ExcludedStatusPage,
  StatusPageExclusionReason,
} from "./StatusPageExclusion";

/*
 * What one subscriber send - an incident created, a state change, a public
 * note, a postmortem, or the episode equivalents - did on each status page it
 * went to. It does two jobs for the send:
 *
 * - Email and SMS once per address. For an incident limited to specific
 *   status pages (see IncidentStatusPageScope), someone subscribed on two of
 *   the selected pages - a regional manager on Site 03 and Site 07 - gets one
 *   email, not two. Pages are visited in name order, so the first page's
 *   template, branding and unsubscribe link are the ones they get. Webhook,
 *   Slack and Teams deliveries are never merged: their payloads carry the
 *   page they are for (statusPageId, resourcesAffected, unsubscribeUrl), and
 *   an integration listening per page must see every page. An unscoped
 *   incident sends exactly as it always has, one message per subscription.
 *   The addresses are remembered for this send only.
 * - A record for the incident feed: each page, the subject its email went out
 *   with, and how many messages were queued on each channel, plus the pages
 *   that were left out and why.
 */

export enum StatusPageDeliverySkipReason {
  // The status page does not show incidents (showIncidentsOnStatusPage off).
  HidesIncidents = "HidesIncidents",
  // The status page does not show episodes (showEpisodesOnStatusPage off).
  HidesEpisodes = "HidesEpisodes",
  // Already sent this notification (Incident.statusPagesNotifiedOnCreation).
  AlreadyNotified = "AlreadyNotified",
  // Sending to this page failed part-way.
  Failed = "Failed",
}

type DedupedMethod =
  | StatusPageSubscriberNotificationMethod.Email
  | StatusPageSubscriberNotificationMethod.SMS;

interface StatusPageDelivery {
  statusPageId: string;
  statusPageName: string;
  skipReason?: StatusPageDeliverySkipReason | undefined;
  subject?: string | undefined;
  queued: Map<StatusPageSubscriberNotificationMethod, number>;
  // Email and SMS not sent again: the address already had it in this send.
  alreadySent: Map<DedupedMethod, number>;
}

// The order channels are listed in, and what each is called.
const METHOD_LABELS: Array<[StatusPageSubscriberNotificationMethod, string]> = [
  [StatusPageSubscriberNotificationMethod.Email, "email"],
  [StatusPageSubscriberNotificationMethod.SMS, "SMS"],
  [StatusPageSubscriberNotificationMethod.Slack, "Slack"],
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams, "Microsoft Teams"],
  [StatusPageSubscriberNotificationMethod.Webhook, "webhook"],
];

const SKIP_REASON_TEXT: Record<StatusPageDeliverySkipReason, string> = {
  [StatusPageDeliverySkipReason.HidesIncidents]:
    "not sent, this status page does not show incidents",
  [StatusPageDeliverySkipReason.HidesEpisodes]:
    "not sent, this status page does not show episodes",
  [StatusPageDeliverySkipReason.AlreadyNotified]:
    "not sent again, its subscribers were already sent this notification",
  [StatusPageDeliverySkipReason.Failed]:
    "Sending to this status page failed part-way",
};

const EXCLUSION_HEADINGS: Record<
  StatusPageExclusionReason,
  { one: string; many: string }
> = {
  [StatusPageExclusionReason.OutsideIncidentScope]: {
    one: "status page outside the status pages this is limited to",
    many: "status pages outside the status pages this is limited to",
  },
  [StatusPageExclusionReason.OnlyShowsScopedIncidents]: {
    one: "status page that only shows incidents limited to it",
    many: "status pages that only show incidents limited to them",
  },
};

// How many names a list of left-out pages shows before summing up the rest.
const MAX_LISTED_EXCLUDED_PAGES: number = 25;

export default class SubscriberNotificationDeliveryRecord {
  public readonly dedupeEmailAndSms: boolean;

  private readonly deliveries: Array<StatusPageDelivery> = [];
  private readonly sentEmails: Set<string> = new Set();
  private readonly sentPhones: Set<string> = new Set();
  private readonly excludedStatusPages: Array<ExcludedStatusPage> = [];

  public constructor(data: { dedupeEmailAndSms: boolean }) {
    this.dedupeEmailAndSms = data.dedupeEmailAndSms;
  }

  // The name a status page goes by in the feed: its name in the dashboard.
  public static getStatusPageName(statusPage: StatusPage): string {
    return (
      statusPage.name?.trim() ||
      statusPage.pageTitle?.trim() ||
      "Untitled status page"
    );
  }

  // The form addresses are compared in: trimmed, lower-cased.
  public static normalizeEmail(email: Email | string): string {
    return email.toString().trim().toLowerCase();
  }

  // The form phone numbers are compared in: digits, with a leading +.
  public static normalizePhone(phone: Phone | string): string {
    const text: string = phone.toString().trim();
    const digits: string = text.replace(/\D/g, "");

    return text.startsWith("+") ? `+${digits}` : digits;
  }

  // A status page the send is about to go to, in the order they are visited.
  public startStatusPage(statusPage: StatusPage): void {
    this.getOrCreateDelivery(statusPage);
  }

  // A status page the send passed over, and why.
  public skipStatusPage(
    statusPage: StatusPage,
    reason: StatusPageDeliverySkipReason,
  ): void {
    this.getOrCreateDelivery(statusPage).skipReason = reason;
  }

  // Pages the incident's monitors reach that its scope left out.
  public addExcludedStatusPages(
    excludedStatusPages: Array<ExcludedStatusPage>,
  ): void {
    this.excludedStatusPages.push(...excludedStatusPages);
  }

  /*
   * Whether to email this address on this page. With dedupe on, an address
   * already emailed in this send is not emailed again, and that is counted
   * against the page; otherwise always yes.
   */
  public shouldSendEmail(data: {
    statusPage: StatusPage;
    email: Email | string;
  }): boolean {
    return this.claim({
      statusPage: data.statusPage,
      address: SubscriberNotificationDeliveryRecord.normalizeEmail(data.email),
      sent: this.sentEmails,
      method: StatusPageSubscriberNotificationMethod.Email,
    });
  }

  // As shouldSendEmail, for a phone number and SMS.
  public shouldSendSms(data: {
    statusPage: StatusPage;
    phone: Phone | string;
  }): boolean {
    return this.claim({
      statusPage: data.statusPage,
      address: SubscriberNotificationDeliveryRecord.normalizePhone(data.phone),
      sent: this.sentPhones,
      method: StatusPageSubscriberNotificationMethod.SMS,
    });
  }

  /*
   * A message queued on a status page. An email passes its subject; the
   * first one queued on the page is the one the feed shows.
   */
  public recordQueued(data: {
    statusPage: StatusPage;
    method: StatusPageSubscriberNotificationMethod;
    subject?: string | undefined;
  }): void {
    const delivery: StatusPageDelivery = this.getOrCreateDelivery(
      data.statusPage,
    );

    delivery.queued.set(
      data.method,
      (delivery.queued.get(data.method) || 0) + 1,
    );

    if (data.subject !== undefined && delivery.subject === undefined) {
      delivery.subject = data.subject;
    }
  }

  // How many messages were queued on a status page, on every channel.
  public getQueuedCount(statusPageId: ObjectID | string): number {
    const delivery: StatusPageDelivery | undefined = this.deliveries.find(
      (item: StatusPageDelivery): boolean => {
        return item.statusPageId === this.normalizeId(statusPageId);
      },
    );

    if (!delivery) {
      return 0;
    }

    let count: number = 0;

    for (const queued of delivery.queued.values()) {
      count += queued;
    }

    return count;
  }

  public getQueuedCountForMethod(
    statusPageId: ObjectID | string,
    method: StatusPageSubscriberNotificationMethod,
  ): number {
    const delivery: StatusPageDelivery | undefined = this.deliveries.find(
      (item: StatusPageDelivery): boolean => {
        return item.statusPageId === this.normalizeId(statusPageId);
      },
    );

    return delivery?.queued.get(method) || 0;
  }

  // The subject the email on a status page went out with, if one did.
  public getSubject(statusPageId: ObjectID | string): string | undefined {
    return this.deliveries.find((item: StatusPageDelivery): boolean => {
      return item.statusPageId === this.normalizeId(statusPageId);
    })?.subject;
  }

  public hasQueuedAny(): boolean {
    return this.deliveries.some((delivery: StatusPageDelivery): boolean => {
      return this.getQueuedCount(delivery.statusPageId) > 0;
    });
  }

  /*
   * The record as Markdown for the incident (or episode) feed item: one line
   * per status page with what was queued and the subject, the pages passed
   * over and why, and the pages the scope left out. Empty when the send
   * touched no status page at all.
   */
  public toMarkdown(): string {
    const sections: Array<string> = [];

    if (this.deliveries.length > 0) {
      const lines: Array<string> = this.deliveries.map(
        (delivery: StatusPageDelivery): string => {
          return `- **${escapeMarkdown(delivery.statusPageName)}**: ${this.describeDelivery(delivery)}`;
        },
      );

      sections.push(`**Status pages:**\n\n${lines.join("\n")}`);

      if (this.dedupeEmailAndSms) {
        sections.push(
          "Email and SMS were sent once per address across these status pages, because this is limited to specific status pages. Someone subscribed on more than one of them got the message of the first page in this list.",
        );
      }
    }

    for (const reason of [
      StatusPageExclusionReason.OutsideIncidentScope,
      StatusPageExclusionReason.OnlyShowsScopedIncidents,
    ]) {
      const names: Array<string> = this.excludedStatusPages
        .filter((excluded: ExcludedStatusPage): boolean => {
          return excluded.reason === reason;
        })
        .map((excluded: ExcludedStatusPage): string => {
          return escapeMarkdown(
            SubscriberNotificationDeliveryRecord.getStatusPageName(
              excluded.statusPage,
            ),
          );
        });

      if (names.length === 0) {
        continue;
      }

      const listed: Array<string> = names.slice(0, MAX_LISTED_EXCLUDED_PAGES);
      const more: number = names.length - listed.length;

      sections.push(
        `**Not sent to ${names.length} ${names.length === 1 ? EXCLUSION_HEADINGS[reason].one : EXCLUSION_HEADINGS[reason].many}:** ${listed.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`,
      );
    }

    return sections.join("\n\n");
  }

  private describeDelivery(delivery: StatusPageDelivery): string {
    const failed: boolean =
      delivery.skipReason === StatusPageDeliverySkipReason.Failed;

    if (delivery.skipReason && !failed) {
      return `${SKIP_REASON_TEXT[delivery.skipReason]}.`;
    }

    const queued: Array<string> = METHOD_LABELS.filter(
      ([method]: [StatusPageSubscriberNotificationMethod, string]): boolean => {
        return (delivery.queued.get(method) || 0) > 0;
      },
    ).map(
      ([method, label]: [StatusPageSubscriberNotificationMethod, string]) => {
        return `${delivery.queued.get(method)} ${label}`;
      },
    );

    const alreadyEmailed: number =
      delivery.alreadySent.get(StatusPageSubscriberNotificationMethod.Email) ||
      0;
    const alreadyTexted: number =
      delivery.alreadySent.get(StatusPageSubscriberNotificationMethod.SMS) || 0;

    let text: string =
      queued.length > 0
        ? `${queued.join(", ")} queued.`
        : failed || alreadyEmailed + alreadyTexted > 0
          ? "nothing queued."
          : "nothing queued, no subscriber matched.";

    if (failed) {
      text += ` ${SKIP_REASON_TEXT[StatusPageDeliverySkipReason.Failed]}, so some of its subscribers may not have been sent it.`;
    }

    const alreadySent: Array<string> = [];

    if (alreadyEmailed > 0) {
      alreadySent.push(
        `${alreadyEmailed} email address${alreadyEmailed === 1 ? "" : "es"}`,
      );
    }

    if (alreadyTexted > 0) {
      alreadySent.push(
        `${alreadyTexted} phone number${alreadyTexted === 1 ? "" : "s"}`,
      );
    }

    if (alreadySent.length > 0) {
      text += ` Not sent again to ${alreadySent.join(" and ")} already sent it through another status page.`;
    }

    if (delivery.subject !== undefined) {
      text += ` Subject: "${escapeMarkdown(delivery.subject)}".`;
    }

    return text;
  }

  private claim(data: {
    statusPage: StatusPage;
    address: string;
    sent: Set<string>;
    method: DedupedMethod;
  }): boolean {
    if (!this.dedupeEmailAndSms || !data.address) {
      return true;
    }

    if (!data.sent.has(data.address)) {
      data.sent.add(data.address);
      return true;
    }

    const delivery: StatusPageDelivery = this.getOrCreateDelivery(
      data.statusPage,
    );

    delivery.alreadySent.set(
      data.method,
      (delivery.alreadySent.get(data.method) || 0) + 1,
    );

    return false;
  }

  private getOrCreateDelivery(statusPage: StatusPage): StatusPageDelivery {
    const statusPageId: string = this.normalizeId(
      statusPage._id || statusPage.id?.toString() || "",
    );

    let delivery: StatusPageDelivery | undefined = this.deliveries.find(
      (item: StatusPageDelivery): boolean => {
        return item.statusPageId === statusPageId;
      },
    );

    if (!delivery) {
      delivery = {
        statusPageId: statusPageId,
        statusPageName:
          SubscriberNotificationDeliveryRecord.getStatusPageName(statusPage),
        queued: new Map(),
        alreadySent: new Map(),
      };

      this.deliveries.push(delivery);
    }

    return delivery;
  }

  private normalizeId(id: ObjectID | string): string {
    return id.toString().trim().toLowerCase();
  }
}

/*
 * Page names and subjects are free text; keep them from turning into
 * Markdown (a name like "*Internal*" or a subject with brackets) or breaking
 * the line they are on.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]<>#|~])/g, "\\$1");
}
