import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberUnsubscribe from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import logger, { EXTERNAL_FAULT, LogAttributes } from "../Logger";
import {
  ExcludedStatusPage,
  StatusPageExclusionReason,
} from "./StatusPageExclusion";
import SubscriberNotificationTiming from "./SubscriberNotificationTiming";

/*
 * What one subscriber send - an incident created, a state change, a public
 * note, a postmortem, or the episode equivalents - did on each status page it
 * went to. It does three jobs for the send:
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
 * - Delivery (deliver): each message is awaited, and counted sent or failed.
 *   A failure is a send that throws (an unreachable host, a refused URL), one
 *   that answers with an HTTPErrorResponse (the Notification service's email
 *   and SMS endpoints, and the Slack and webhook senders, return one rather
 *   than throw), or one still unanswered after
 *   SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS. The SMS endpoint
 *   answers success for an SMS the project deliberately does not send -
 *   SMS notifications turned off, too little SMS balance - unless the
 *   request asks otherwise, so the jobs send with SmsService's
 *   failIfNotSent: such an SMS then answers with an error and counts as
 *   failed, and a page reached that way is not recorded as told.
 * - A record of it: for the incident (or episode) feed item, each page, the
 *   subject its email went out with, and how many messages were sent and
 *   failed on each channel, plus the pages that were left out and why; and
 *   the same counts, in plain text, for the notification's status message.
 *   A page "succeeded" when every one of its subscribers was reached and no
 *   message to them failed; the incident created notification records only
 *   those pages as told, so Retry resumes after them.
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
  /*
   * The send ran out of time (SubscriberNotificationTiming.SEND_WINDOW_IN_MS)
   * before it reached every subscriber of this page, or before it reached
   * the page at all.
   */
  OutOfTime = "OutOfTime",
}

/*
 * What Retry does after a send that did not reach everyone, for the status
 * message to say so.
 */
export enum SubscriberNotificationRetryScope {
  /*
   * The incident created notification: Retry sends only to the pages not
   * sent it in full (Incident.statusPagesNotifiedOnCreation).
   */
  PagesNotYetSent = "PagesNotYetSent",
  // Everything else: Retry sends to every page again.
  EveryPage = "EveryPage",
}

type DedupedMethod =
  | StatusPageSubscriberNotificationMethod.Email
  | StatusPageSubscriberNotificationMethod.SMS;

interface StatusPageDelivery {
  statusPageId: string;
  statusPageName: string;
  skipReason?: StatusPageDeliverySkipReason | undefined;
  subject?: string | undefined;
  // The send got as far as reading this page's subscribers.
  started: boolean;
  // Every subscriber of the page was reached.
  finished: boolean;
  sent: Map<StatusPageSubscriberNotificationMethod, number>;
  failed: Map<StatusPageSubscriberNotificationMethod, number>;
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

// Why a page was passed over, for a page the send never started on.
const SKIP_REASON_TEXT: Record<StatusPageDeliverySkipReason, string> = {
  [StatusPageDeliverySkipReason.HidesIncidents]:
    "not sent, this status page does not show incidents",
  [StatusPageDeliverySkipReason.HidesEpisodes]:
    "not sent, this status page does not show episodes",
  [StatusPageDeliverySkipReason.AlreadyNotified]:
    "not sent again, its subscribers were already sent this notification",
  [StatusPageDeliverySkipReason.Failed]:
    "Sending to this status page failed part-way",
  [StatusPageDeliverySkipReason.OutOfTime]:
    "not sent, the send ran out of time before it reached this status page",
};

// Said after the counts of a page the send stopped part-way through.
const STOPPED_PART_WAY_TEXT: Partial<
  Record<StatusPageDeliverySkipReason, string>
> = {
  [StatusPageDeliverySkipReason.Failed]:
    "Sending to this status page failed part-way, so some of its subscribers may not have been sent it.",
  [StatusPageDeliverySkipReason.OutOfTime]:
    "The send ran out of time part-way through this status page, so some of its subscribers were not sent it.",
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

// How many pages the status message lists before summing up the rest.
const MAX_LISTED_STATUS_MESSAGE_PAGES: number = 25;

export default class SubscriberNotificationDeliveryRecord {
  public readonly dedupeEmailAndSms: boolean;

  private readonly sendTimeoutInMs: number;
  private readonly deliveries: Array<StatusPageDelivery> = [];
  private readonly sentEmails: Set<string> = new Set();
  private readonly sentPhones: Set<string> = new Set();
  private readonly excludedStatusPages: Array<ExcludedStatusPage> = [];
  private subscriberMatched: boolean = false;

  public constructor(data: {
    dedupeEmailAndSms: boolean;
    // How long a message may go unanswered before it counts as failed.
    sendTimeoutInMs?: number | undefined;
  }) {
    this.dedupeEmailAndSms = data.dedupeEmailAndSms;
    this.sendTimeoutInMs =
      data.sendTimeoutInMs ?? SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS;
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
    this.getOrCreateDelivery(statusPage).started = true;
  }

  // Every subscriber of a status page the send started on was reached.
  public finishStatusPage(statusPage: StatusPage): void {
    this.getOrCreateDelivery(statusPage).finished = true;
  }

  // A status page the send passed over or stopped part-way through, and why.
  public skipStatusPage(
    statusPage: StatusPage,
    reason: StatusPageDeliverySkipReason,
  ): void {
    this.getOrCreateDelivery(statusPage).skipReason = reason;
  }

  /*
   * A subscriber whose preferences let this send through: it is sent
   * something, unless its address already was through an earlier page.
   */
  public recordSubscriberMatched(): void {
    this.subscriberMatched = true;
  }

  // Whether any subscriber's preferences let this send through.
  public hasMatchedAnySubscriber(): boolean {
    return this.subscriberMatched;
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
   * Send one message and wait for the answer, counting it sent or failed on
   * its page and channel. True when it was sent. Never throws: a failed
   * message is recorded and logged, and the send goes on to the next one.
   *
   * An email passes its subject; the first one on a page is the one the
   * feed shows.
   */
  public async deliver(data: {
    statusPage: StatusPage;
    method: StatusPageSubscriberNotificationMethod;
    subject?: string | undefined;
    send: () => Promise<unknown>;
    logAttributes?: LogAttributes | undefined;
  }): Promise<boolean> {
    let failed: boolean = false;
    let failure: unknown = undefined;

    try {
      const result: unknown = await this.waitForAnswer(data.send);

      if (result instanceof HTTPErrorResponse) {
        failed = true;
        failure = result;
      }
    } catch (err) {
      // Whatever was thrown, even nothing at all.
      failed = true;
      failure = err;
    }

    if (!failed) {
      this.recordSent({
        statusPage: data.statusPage,
        method: data.method,
        subject: data.subject,
      });

      return true;
    }

    this.recordFailed({
      statusPage: data.statusPage,
      method: data.method,
      subject: data.subject,
    });

    /*
     * Delivery to a channel the SUBSCRIBER chose: their mailbox, their
     * phone, their Slack/Teams webhook, their HTTP endpoint. A bounce, a
     * 404 on a deleted webhook or an unreachable host is their side of the
     * wire, not a OneUptime defect - and one status page can fan out to
     * thousands of subscribers, so leaving these at ERROR buries real
     * failures under a single tenant's dead webhook. What failed is counted
     * in the record; the error itself (which can carry a subscriber's
     * webhook URL) stays in the server log.
     */
    logger.error(
      `Subscriber ${data.method} notification failed on status page ${this.normalizeId(
        data.statusPage._id || data.statusPage.id?.toString() || "",
      )}: ${describeFailure(failure)}`,
      {
        ...EXTERNAL_FAULT,
        ...(data.logAttributes || {}),
      },
    );

    return false;
  }

  // A message sent on a status page.
  public recordSent(data: {
    statusPage: StatusPage;
    method: StatusPageSubscriberNotificationMethod;
    subject?: string | undefined;
  }): void {
    const delivery: StatusPageDelivery = this.getOrCreateDelivery(
      data.statusPage,
    );

    increment(delivery.sent, data.method);
    this.recordSubject(delivery, data.subject);
  }

  // A message that could not be sent on a status page.
  public recordFailed(data: {
    statusPage: StatusPage;
    method: StatusPageSubscriberNotificationMethod;
    subject?: string | undefined;
  }): void {
    const delivery: StatusPageDelivery = this.getOrCreateDelivery(
      data.statusPage,
    );

    increment(delivery.failed, data.method);
    this.recordSubject(delivery, data.subject);
  }

  // How many messages were sent on a status page, on one channel or all.
  public getSentCount(
    statusPageId: ObjectID | string,
    method?: StatusPageSubscriberNotificationMethod,
  ): number {
    return countOf(this.findDelivery(statusPageId)?.sent, method);
  }

  // How many messages failed on a status page, on one channel or all.
  public getFailedCount(
    statusPageId: ObjectID | string,
    method?: StatusPageSubscriberNotificationMethod,
  ): number {
    return countOf(this.findDelivery(statusPageId)?.failed, method);
  }

  // The subject the email on a status page went out with, if one did.
  public getSubject(statusPageId: ObjectID | string): string | undefined {
    return this.findDelivery(statusPageId)?.subject;
  }

  // Whether any message was sent or tried, on any page.
  public hasAttemptedAny(): boolean {
    return this.deliveries.some((delivery: StatusPageDelivery): boolean => {
      return countOf(delivery.sent) + countOf(delivery.failed) > 0;
    });
  }

  /*
   * Whether the send fell short anywhere: a message failed, a page failed
   * part-way, or the send ran out of time before it reached everyone.
   */
  public hasFailures(): boolean {
    return this.deliveries.some((delivery: StatusPageDelivery): boolean => {
      return isShortfall(delivery);
    });
  }

  /*
   * Whether every subscriber of a status page was reached and nobody's
   * message failed: the page was sent this in full, and a retry need not
   * go back to it.
   */
  public didStatusPageSucceed(statusPageId: ObjectID | string): boolean {
    const delivery: StatusPageDelivery | undefined =
      this.findDelivery(statusPageId);

    return Boolean(
      delivery &&
        delivery.started &&
        delivery.finished &&
        !isShortfall(delivery),
    );
  }

  // How many messages were sent and failed across every page.
  public getTotals(): { sent: number; failed: number } {
    let sent: number = 0;
    let failed: number = 0;

    for (const delivery of this.deliveries) {
      sent += countOf(delivery.sent);
      failed += countOf(delivery.failed);
    }

    return { sent, failed };
  }

  /*
   * The record as Markdown for the incident (or episode) feed item: one line
   * per status page with what was sent and failed and the subject, the pages
   * passed over and why, and the pages the scope left out. Empty when the
   * send touched no status page at all.
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

  /*
   * The notification's status message, in plain text: whether everyone was
   * sent it, then what was sent and failed on each status page the send
   * went to - "Site 03: 41 email sent. Site 07: 16 email sent, 2 failed." -
   * and, when it fell short, what Retry will do.
   *
   * `sentMessage` is the job's own line for a send that reached everyone.
   * Pages passed over (they hide incidents, or were already sent it) are in
   * the feed item, not here.
   */
  public toStatusMessage(data: {
    sentMessage: string;
    retryScope: SubscriberNotificationRetryScope;
  }): string {
    const parts: Array<string> = [];
    const { sent, failed } = this.getTotals();

    if (!this.hasFailures()) {
      parts.push(data.sentMessage);
    } else {
      parts.push(
        failed > 0
          ? `Not every subscriber was sent this notification: ${failed} of ${sent + failed} message${sent + failed === 1 ? "" : "s"} failed.`
          : "Not every subscriber was sent this notification.",
      );

      if (
        this.deliveries.some((delivery: StatusPageDelivery): boolean => {
          return delivery.skipReason === StatusPageDeliverySkipReason.OutOfTime;
        })
      ) {
        parts.push(
          "The send ran out of time before it reached every subscriber.",
        );
      }

      if (
        this.deliveries.some((delivery: StatusPageDelivery): boolean => {
          return delivery.skipReason === StatusPageDeliverySkipReason.Failed;
        })
      ) {
        parts.push("Sending to a status page failed part-way.");
      }
    }

    const reported: Array<StatusPageDelivery> = this.deliveries.filter(
      (delivery: StatusPageDelivery): boolean => {
        return delivery.started || isShortfall(delivery);
      },
    );
    const listed: Array<StatusPageDelivery> = reported.slice(
      0,
      MAX_LISTED_STATUS_MESSAGE_PAGES,
    );

    for (const delivery of listed) {
      parts.push(
        `${toPlainText(delivery.statusPageName)}: ${this.describeForStatusMessage(delivery)}.`,
      );
    }

    if (reported.length > listed.length) {
      parts.push(
        `And ${reported.length - listed.length} more status page${reported.length - listed.length === 1 ? "" : "s"}.`,
      );
    }

    if (this.hasFailures()) {
      if (
        data.retryScope === SubscriberNotificationRetryScope.PagesNotYetSent
      ) {
        const notSent: Array<string> = this.deliveries
          .filter((delivery: StatusPageDelivery): boolean => {
            return isShortfall(delivery);
          })
          .map((delivery: StatusPageDelivery): string => {
            return toPlainText(delivery.statusPageName);
          });

        parts.push(
          `Retry sends it again only to the status pages that were not sent it in full${notSent.length > 0 ? `: ${joinNames(notSent)}` : ""}.`,
        );
      } else {
        parts.push(
          "Retry sends it again to every status page, including the subscribers who already got it.",
        );
      }
    }

    return parts.join(" ");
  }

  private describeDelivery(delivery: StatusPageDelivery): string {
    if (isPassedOver(delivery)) {
      return `${SKIP_REASON_TEXT[delivery.skipReason!]}.`;
    }

    let text: string = `${this.describeCounts(delivery)}.`;

    const stoppedPartWay: string | undefined = delivery.skipReason
      ? STOPPED_PART_WAY_TEXT[delivery.skipReason]
      : undefined;

    if (stoppedPartWay) {
      text += ` ${stoppedPartWay}`;
    }

    const alreadyEmailed: number =
      delivery.alreadySent.get(StatusPageSubscriberNotificationMethod.Email) ||
      0;
    const alreadyTexted: number =
      delivery.alreadySent.get(StatusPageSubscriberNotificationMethod.SMS) || 0;

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

  // One page's line in the status message, without the page's name.
  private describeForStatusMessage(delivery: StatusPageDelivery): string {
    if (isPassedOver(delivery)) {
      return SKIP_REASON_TEXT[delivery.skipReason!];
    }

    const counts: string = this.describeCounts(delivery);

    if (delivery.skipReason === StatusPageDeliverySkipReason.OutOfTime) {
      return `${counts}, then the send ran out of time`;
    }

    if (delivery.skipReason === StatusPageDeliverySkipReason.Failed) {
      return `${counts}, then sending failed part-way`;
    }

    return counts;
  }

  /*
   * What was sent and what failed on a page, by channel: "41 email, 3
   * webhook sent" or "16 email sent; 2 email, 1 SMS failed".
   */
  private describeCounts(delivery: StatusPageDelivery): string {
    const sent: Array<string> = describeByChannel(delivery.sent);
    const failed: Array<string> = describeByChannel(delivery.failed);

    if (sent.length === 0 && failed.length === 0) {
      return delivery.skipReason || countOf(delivery.alreadySent) > 0
        ? "nothing sent"
        : "nothing sent, no subscriber matched";
    }

    const sentText: string =
      sent.length > 0 ? `${sent.join(", ")} sent` : "nothing sent";

    return failed.length > 0
      ? `${sentText}; ${failed.join(", ")} failed`
      : sentText;
  }

  private recordSubject(
    delivery: StatusPageDelivery,
    subject: string | undefined,
  ): void {
    if (subject === undefined || delivery.subject !== undefined) {
      return;
    }

    /*
     * The feed is read by everyone who can read the incident. A custom
     * subject template can carry {{unsubscribeUrl}}, whose token belongs to
     * the one subscriber that email went to, so the feed keeps the link
     * with its token redacted.
     */
    delivery.subject =
      StatusPageSubscriberUnsubscribe.redactCredentials(subject);
  }

  /*
   * The send's answer, or a rejection once it has gone unanswered for the
   * send timeout. The request itself is not cancelled; this only stops
   * waiting for it, so one hanging endpoint cannot hold a slot of the send
   * forever.
   */
  private async waitForAnswer(send: () => Promise<unknown>): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        send(),
        new Promise<never>(
          (_resolve: (value: never) => void, reject: (err: Error) => void) => {
            timer = setTimeout(() => {
              reject(
                new Error(
                  `No answer after ${Math.round(this.sendTimeoutInMs / 1000)} seconds.`,
                ),
              );
            }, this.sendTimeoutInMs);
          },
        ),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
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

    increment(delivery.alreadySent, data.method);

    return false;
  }

  private findDelivery(
    statusPageId: ObjectID | string,
  ): StatusPageDelivery | undefined {
    const id: string = this.normalizeId(statusPageId);

    return this.deliveries.find((item: StatusPageDelivery): boolean => {
      return item.statusPageId === id;
    });
  }

  private getOrCreateDelivery(statusPage: StatusPage): StatusPageDelivery {
    const statusPageId: string = this.normalizeId(
      statusPage._id || statusPage.id?.toString() || "",
    );

    let delivery: StatusPageDelivery | undefined =
      this.findDelivery(statusPageId);

    if (!delivery) {
      delivery = {
        statusPageId: statusPageId,
        statusPageName:
          SubscriberNotificationDeliveryRecord.getStatusPageName(statusPage),
        started: false,
        finished: false,
        sent: new Map(),
        failed: new Map(),
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
 * A page the send never went to: it hides incidents or episodes, it was
 * already sent this notification, or the send ran out of time before it got
 * there. Its line is the reason alone.
 */
function isPassedOver(delivery: StatusPageDelivery): boolean {
  if (!delivery.skipReason) {
    return false;
  }

  if (delivery.skipReason === StatusPageDeliverySkipReason.OutOfTime) {
    return !delivery.started;
  }

  return delivery.skipReason !== StatusPageDeliverySkipReason.Failed;
}

/*
 * A page the send fell short on: a message to one of its subscribers
 * failed, sending to it failed part-way, or the send ran out of time before
 * it reached every subscriber.
 */
function isShortfall(delivery: StatusPageDelivery): boolean {
  return (
    countOf(delivery.failed) > 0 ||
    delivery.skipReason === StatusPageDeliverySkipReason.Failed ||
    delivery.skipReason === StatusPageDeliverySkipReason.OutOfTime
  );
}

// "41 email, 3 webhook": each channel with a count, in METHOD_LABELS order.
function describeByChannel(
  counts: Map<StatusPageSubscriberNotificationMethod, number>,
): Array<string> {
  return METHOD_LABELS.filter(
    ([method]: [StatusPageSubscriberNotificationMethod, string]): boolean => {
      return (counts.get(method) || 0) > 0;
    },
  ).map(([method, label]: [StatusPageSubscriberNotificationMethod, string]) => {
    return `${counts.get(method)} ${label}`;
  });
}

function increment<TKey>(counts: Map<TKey, number>, key: TKey): void {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function countOf<TKey>(
  counts: Map<TKey, number> | undefined,
  key?: TKey,
): number {
  if (!counts) {
    return 0;
  }

  if (key !== undefined) {
    return counts.get(key) || 0;
  }

  let total: number = 0;

  for (const count of counts.values()) {
    total += count;
  }

  return total;
}

// What went wrong with a message, for the server log.
function describeFailure(failure: unknown): string {
  if (failure instanceof HTTPErrorResponse) {
    return `HTTP ${failure.statusCode}${failure.message ? `: ${failure.message}` : ""}`;
  }

  if (failure instanceof Error) {
    return failure.message || failure.name;
  }

  return String(failure);
}

// "Site 03", "Site 03 and Site 07", "Site 03, Site 05 and Site 07", capped.
function joinNames(names: Array<string>): string {
  const listed: Array<string> = names.slice(0, MAX_LISTED_STATUS_MESSAGE_PAGES);
  const more: number = names.length - listed.length;

  if (more > 0) {
    return `${listed.join(", ")} and ${more} more`;
  }

  if (listed.length <= 1) {
    return listed.join("");
  }

  return `${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1]}`;
}

/*
 * Page names and subjects are free text; keep them from turning into
 * Markdown (a name like "*Internal*" or a subject with brackets) or breaking
 * the line they are on.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]<>#|~])/g, "\\$1");
}

// A page name on one line, for the plain-text status message.
function toPlainText(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}
