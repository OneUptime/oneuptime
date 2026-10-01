import OneUptimeDate from "../Date";
import Dictionary from "../Dictionary";
import { JSONArray, JSONObject, JSONValue } from "../JSON";
import ObjectID from "../ObjectID";
import EmailAddressList from "../../Utils/Email/EmailAddressList";

/*
 * The Incoming Email trigger: every workflow that uses it gets an address of
 * its own on the server's inbound email domain (INBOUND_EMAIL_DOMAIN, the
 * domain Incoming Email monitors receive on), and each email sent to that
 * address starts one run.
 *
 * The address is `workflow-{incomingEmailSecretKey}@{inbound domain}`. Like the
 * Webhook trigger's URL it is a bearer credential - whoever has it can start
 * the workflow - so the key is a random UUID of its own (never the workflow's
 * ID, which every reader of the workflow can see) and only people who can edit
 * the workflow may read or reset it (Workflow.incomingEmailSecretKey).
 *
 * The way in is the inbound email webhook Incoming Email monitors already use
 * (POST /incoming-email/<provider>/<secret>). It tells the two apart by the
 * recipient's shape (IncomingEmailMonitorAddress.parseRecipient), queues the
 * email, and the queue worker hands it to the workflow service at
 * INCOMING_EMAIL_TRIGGER_DELIVERY_PATH, where the trigger
 * (Server/Types/Workflow/Components/IncomingEmail.ts) finds the workflow and
 * starts the run.
 */

export const INCOMING_EMAIL_TRIGGER_LOCAL_PART_PREFIX: string = "workflow-";

/*
 * Shown in place of the secret key until the reader asks to see it, as the
 * Webhook trigger's URL is. A fixed length, so it says nothing about the key.
 */
export const INCOMING_EMAIL_TRIGGER_SECRET_MASK: string = "•".repeat(16);

/*
 * Where the ingest worker hands an email to the workflow service. Relative to
 * the workflow service (/workflow), and only for callers with the cluster key.
 */
export const INCOMING_EMAIL_TRIGGER_DELIVERY_PATH: string =
  "/incoming-email/deliver";

/*
 * What became of one email handed to the workflow service. Only Scheduled
 * starts a run. The rest are not errors - mail to an address nothing uses any
 * more is ordinary, and the sender is not told either way - so the ingest
 * worker logs them and moves on rather than retrying.
 */
export enum IncomingEmailTriggerDeliveryStatus {
  Scheduled = "Scheduled",
  // No workflow has this address: it was reset, or never existed.
  NoWorkflow = "NoWorkflow",
  // The workflow's trigger is no longer Incoming Email.
  NotIncomingEmailTrigger = "NotIncomingEmailTrigger",
  // The workflow is off, so it starts no runs.
  WorkflowDisabled = "WorkflowDisabled",
}

/*
 * The longest body a run is handed, per body. Mail with a larger text or HTML
 * part is rare (newsletters with inline images come closest), and a run keeps
 * its trigger's values in its log, so a body is cut here rather than copied
 * whole into every run's log.
 */
export const MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH: number = 1024 * 1024;

export const INCOMING_EMAIL_TRIGGER_TRUNCATED_SUFFIX: string = "… [truncated]";

/*
 * The values the trigger hands the rest of the workflow. Kept in one place:
 * the component's metadata, the payload below, the help and the docs all read
 * these ids.
 */
export enum IncomingEmailTriggerValue {
  From = "from",
  To = "to",
  Cc = "cc",
  Subject = "subject",
  Body = "body",
  HtmlBody = "html-body",
  Headers = "headers",
  Attachments = "attachments",
  ReceivedAt = "received-at",
}

const UUID_PATTERN: string =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const LOCAL_PART_PATTERN: RegExp = new RegExp(
  `^${INCOMING_EMAIL_TRIGGER_LOCAL_PART_PREFIX}(${UUID_PATTERN})$`,
  "i",
);

export interface IncomingEmailTriggerAttachment {
  filename: string;
  contentType: string;
  size: number;
}

/*
 * One email, as the ingest worker hands it to the workflow service. Every
 * address is lowercased; `receivedAt` is when the inbound webhook took it.
 */
export interface IncomingEmailTriggerEmail {
  from: string;
  to: Array<string>;
  cc: Array<string>;
  subject: string;
  body: string;
  htmlBody?: string | undefined;
  headers?: Dictionary<string> | undefined;
  attachments?: Array<IncomingEmailTriggerAttachment> | undefined;
  receivedAt: string;
}

export default class IncomingEmailTrigger {
  public static getLocalPart(secretKey: ObjectID | string): string {
    return `${INCOMING_EMAIL_TRIGGER_LOCAL_PART_PREFIX}${secretKey
      .toString()
      .trim()
      .toLowerCase()}`;
  }

  /*
   * The workflow's address, or null when there is no key to build it from
   * or the server has no inbound email domain (so nowhere to send mail).
   */
  public static getAddress(data: {
    secretKey: ObjectID | string | null | undefined;
    inboundDomain: string | null | undefined;
  }): string | null {
    const inboundDomain: string = (data.inboundDomain || "").trim();
    const secretKey: string = (data.secretKey || "").toString().trim();

    if (!inboundDomain || !secretKey) {
      return null;
    }

    return `${this.getLocalPart(secretKey)}@${inboundDomain}`;
  }

  /*
   * The address with its key masked: `workflow-••••…@inbound.example.com`.
   * Built without the key, so it can be drawn while the key stays hidden.
   */
  public static getMaskedAddress(inboundDomain: string): string {
    return `${INCOMING_EMAIL_TRIGGER_LOCAL_PART_PREFIX}${INCOMING_EMAIL_TRIGGER_SECRET_MASK}@${inboundDomain.trim()}`;
  }

  // Whether a local part is a workflow's: `workflow-` and a whole UUID.
  public static isLocalPart(localPart: string): boolean {
    return LOCAL_PART_PATTERN.test(localPart.trim());
  }

  // The secret key in a workflow's local part, lowercased, or null.
  public static getSecretKeyFromLocalPart(localPart: string): string | null {
    const match: RegExpMatchArray | null = localPart
      .trim()
      .match(LOCAL_PART_PATTERN);

    return match && match[1] ? match[1].toLowerCase() : null;
  }

  /*
   * The values a run starts with, from one delivered email. Every value is
   * there, in the type its metadata names: an address list is one line of
   * text ("a@example.com, b@example.com"), as a message would quote it.
   *
   * The email arrives over the network, so nothing about its shape is taken
   * on trust: normalizeReturnValues turns whatever is there into those types.
   */
  public static getReturnValues(email: IncomingEmailTriggerEmail): JSONObject {
    return this.normalizeReturnValues({
      [IncomingEmailTriggerValue.From]: email.from,
      [IncomingEmailTriggerValue.To]: email.to,
      [IncomingEmailTriggerValue.Cc]: email.cc,
      [IncomingEmailTriggerValue.Subject]: email.subject,
      [IncomingEmailTriggerValue.Body]: email.body,
      [IncomingEmailTriggerValue.HtmlBody]: email.htmlBody,
      [IncomingEmailTriggerValue.Headers]: email.headers as JSONObject,
      [IncomingEmailTriggerValue.Attachments]:
        email.attachments as unknown as JSONArray,
      [IncomingEmailTriggerValue.ReceivedAt]: email.receivedAt,
    } as JSONObject);
  }

  /*
   * What the trigger hands the next step, whatever it started from: a
   * delivered email, or the few values someone typed into Run Workflow to
   * try the workflow out. Every value is present and of its type, so a later
   * step reading one never gets `undefined`: missing text is "", headers {},
   * attachments [], and the time received is now.
   *
   * Header names are lowercased - email header names are case-insensitive,
   * and the Webhook trigger hands its headers over the same way - so a
   * reference such as `headers.message-id` works for every sender.
   */
  public static normalizeReturnValues(
    values: JSONObject,
    now?: Date | undefined,
  ): JSONObject {
    const receivedAt: Date | null = this.toDate(
      values[IncomingEmailTriggerValue.ReceivedAt],
    );

    return {
      [IncomingEmailTriggerValue.From]: this.toAddressLine(
        values[IncomingEmailTriggerValue.From],
      ),
      [IncomingEmailTriggerValue.To]: this.toAddressLine(
        values[IncomingEmailTriggerValue.To],
      ),
      [IncomingEmailTriggerValue.Cc]: this.toAddressLine(
        values[IncomingEmailTriggerValue.Cc],
      ),
      [IncomingEmailTriggerValue.Subject]: this.toText(
        values[IncomingEmailTriggerValue.Subject],
      ),
      [IncomingEmailTriggerValue.Body]: this.toBody(
        values[IncomingEmailTriggerValue.Body],
      ),
      [IncomingEmailTriggerValue.HtmlBody]: this.toBody(
        values[IncomingEmailTriggerValue.HtmlBody],
      ),
      [IncomingEmailTriggerValue.Headers]: this.toHeaders(
        values[IncomingEmailTriggerValue.Headers],
      ),
      [IncomingEmailTriggerValue.Attachments]: this.toAttachments(
        values[IncomingEmailTriggerValue.Attachments],
      ),
      [IncomingEmailTriggerValue.ReceivedAt]: OneUptimeDate.toString(
        receivedAt || now || OneUptimeDate.getCurrentDate(),
      ),
    };
  }

  private static toText(value: JSONValue | undefined): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    return "";
  }

  private static toBody(value: JSONValue | undefined): string {
    const text: string = this.toText(value);

    if (text.length <= MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH) {
      return text;
    }

    return (
      text.slice(0, MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH) +
      INCOMING_EMAIL_TRIGGER_TRUNCATED_SUFFIX
    );
  }

  /*
   * "a@example.com, b@example.com" from a list, from a header someone typed
   * ("Jane <jane@example.com>"), or from text that is not an address at all
   * (a test run's "From" can be anything) - which is kept as it was typed.
   */
  private static toAddressLine(value: JSONValue | undefined): string {
    if (Array.isArray(value)) {
      const addresses: Array<string> = [];

      for (const item of value as Array<JSONValue>) {
        if (typeof item === "string") {
          addresses.push(...EmailAddressList.parse(item));
        }
      }

      return EmailAddressList.format(EmailAddressList.merge(addresses));
    }

    const text: string = this.toText(value).trim();

    if (!text) {
      return "";
    }

    const addresses: Array<string> = EmailAddressList.parse(text);

    return addresses.length > 0 ? EmailAddressList.format(addresses) : text;
  }

  private static toHeaders(value: JSONValue | undefined): JSONObject {
    let source: JSONValue | undefined = value;

    if (typeof source === "string") {
      try {
        source = JSON.parse(source) as JSONValue;
      } catch {
        return {};
      }
    }

    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {};
    }

    const headers: JSONObject = {};

    for (const [name, headerValue] of Object.entries(source as JSONObject)) {
      const key: string = name.trim().toLowerCase();

      if (!key) {
        continue;
      }

      headers[key] = this.toText(headerValue as JSONValue);
    }

    return headers;
  }

  private static toAttachments(value: JSONValue | undefined): JSONArray {
    let source: JSONValue | undefined = value;

    if (typeof source === "string") {
      try {
        source = JSON.parse(source) as JSONValue;
      } catch {
        return [];
      }
    }

    if (!Array.isArray(source)) {
      return [];
    }

    const attachments: JSONArray = [];

    for (const item of source) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const attachment: JSONObject = item as JSONObject;
      const size: number = Number(attachment["size"]);

      attachments.push({
        filename: this.toText(attachment["filename"] as JSONValue),
        contentType: this.toText(attachment["contentType"] as JSONValue),
        size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
      });
    }

    return attachments;
  }

  private static toDate(value: JSONValue | undefined): Date | null {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }

    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const date: Date = new Date(value);

    return isNaN(date.getTime()) ? null : date;
  }
}
