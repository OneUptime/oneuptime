import InboundEmailProvider, {
  InboundEmailDelivery,
  InboundEmailProviderConfig,
  ParsedInboundEmail,
} from "../InboundEmailProvider";
import SecretKeyComparison from "../../../Utils/SecretKeyComparison";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import EmailAddressList from "../../../../Utils/Email/EmailAddressList";
import IncomingEmailMonitorAddress, {
  IncomingEmailRecipient,
  IncomingEmailRecipientKind,
} from "../../../../Utils/Monitor/IncomingEmailMonitorAddress";

// SendGrid uses the base config - add SendGrid-specific options here if needed in the future
export type SendGridInboundConfig = InboundEmailProviderConfig;

/*
 * The address of "Name <address>". What is between the brackets holds no "<"
 * either, so a match tried from each "<" of a header reads only up to the
 * next one: a From or To header, which whoever sends the email writes, is
 * read in time in line with its length. Where several "<" open before a ">",
 * the address is what follows the last of them.
 */
const ANGLE_BRACKETED_ADDRESS: RegExp = /<([^<>]+)>/;

/**
 * SendGrid Inbound Parse provider implementation
 *
 * This provider handles email parsing from SendGrid's Inbound Parse webhook.
 * SendGrid sends emails to the webhook as multipart/form-data with the following fields:
 * - from: Email sender
 * - to: Email recipient(s)
 * - cc: Copied recipient(s)
 * - subject: Email subject
 * - text: Plain text body
 * - html: HTML body
 * - headers: Email headers as a string
 * - envelope: JSON envelope with from/to addresses
 * - attachments: Number of attachments
 * - attachment-info: JSON with attachment metadata
 */
export default class SendGridInboundProvider extends InboundEmailProvider {
  public constructor(config: SendGridInboundConfig) {
    super(config);
  }

  public async parseInboundEmail(
    rawData: JSONObject,
  ): Promise<ParsedInboundEmail> {
    /*
     * SendGrid Inbound Parse webhook format
     * Reference: https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
     */

    const from: string = this.extractEmailAddress(
      rawData["from"]?.toString() || "",
    );
    const to: string = this.extractEmailAddress(
      rawData["to"]?.toString() || "",
    );
    const toAddresses: Array<string> = EmailAddressList.parse(
      rawData["to"]?.toString(),
    );
    const ccAddresses: Array<string> = EmailAddressList.parse(
      rawData["cc"]?.toString(),
    );
    const envelopeRecipients: Array<string> = this.parseEnvelopeRecipients(
      rawData["envelope"],
    );
    const subject: string = rawData["subject"]?.toString() || "";
    const body: string = rawData["text"]?.toString() || "";
    const bodyHtml: string | undefined = rawData["html"]?.toString();
    const headers: Record<string, string> | undefined = this.parseHeaders(
      rawData["headers"]?.toString(),
    );
    const attachments:
      | Array<{ filename: string; contentType: string; size: number }>
      | undefined = this.parseAttachments(rawData);

    return {
      from,
      to,
      toAddresses,
      ccAddresses,
      envelopeRecipients,
      subject,
      body,
      bodyHtml,
      headers,
      attachments,
    };
  }

  /*
   * SendGrid's `envelope` field is JSON: {"to": ["rcpt@inbound..."], "from":
   * "bounce@sender..."}. `to` holds the address this POST was delivered for.
   * Anything that is not that shape is no envelope at all, and the router
   * falls back to the To and Cc headers.
   */
  private parseEnvelopeRecipients(
    rawEnvelope: JSONValue | undefined,
  ): Array<string> {
    let envelope: JSONValue | undefined = rawEnvelope;

    if (typeof envelope === "string") {
      try {
        envelope = JSON.parse(envelope) as JSONValue;
      } catch {
        return [];
      }
    }

    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      return [];
    }

    const recipients: JSONValue | undefined = (envelope as JSONObject)["to"];

    if (typeof recipients === "string") {
      return EmailAddressList.parse(recipients);
    }

    if (!Array.isArray(recipients)) {
      return [];
    }

    return EmailAddressList.merge(
      recipients.flatMap((recipient: JSONValue): Array<string> => {
        return typeof recipient === "string"
          ? EmailAddressList.parse(recipient)
          : [];
      }),
    );
  }

  /*
   * SendGrid posts to the Destination URL the operator gave Inbound Parse,
   * https://<host>/incoming-email/sendgrid/<secret>, so a delivery is
   * SendGrid's when the last part of the address it was posted to is the
   * installation's secret. Compared in constant time: how long a wrong guess
   * takes to refuse says nothing about how much of it was right.
   */
  protected async isFromProvider(
    data: InboundEmailDelivery & { webhookSecret: string },
  ): Promise<boolean> {
    return SecretKeyComparison.timingSafeEqual(
      data.pathSecret,
      data.webhookSecret,
    );
  }

  public extractSecretKeyFromEmail(email: string): string | null {
    /*
     * Extract from: monitor-{secretKey}@inbound.domain.com
     * Handle email formats like "name@domain" or "Name <name@domain>".
     * A custom monitor address carries no secret key, so it yields null.
     */
    const recipient: IncomingEmailRecipient | null =
      IncomingEmailMonitorAddress.parseRecipient({
        emailAddress: this.extractEmailAddress(email),
        inboundDomain: this.config.inboundDomain,
      });

    return recipient?.kind === IncomingEmailRecipientKind.Generated
      ? recipient.secretKey
      : null;
  }

  public generateMonitorEmailAddress(secretKey: string): string {
    return `${IncomingEmailMonitorAddress.getGeneratedLocalPart(secretKey)}@${this.config.inboundDomain}`;
  }

  /**
   * Extract email address from various formats
   * Examples:
   * - "user@domain.com" -> "user@domain.com"
   * - "User Name <user@domain.com>" -> "user@domain.com"
   * - "<user@domain.com>" -> "user@domain.com"
   */
  private extractEmailAddress(email: string): string {
    const match: RegExpMatchArray | null = email.match(ANGLE_BRACKETED_ADDRESS);

    if (match && match[1]) {
      return match[1].toLowerCase().trim();
    }

    return email.toLowerCase().trim();
  }

  /**
   * Parse SendGrid headers string into a key-value object
   * SendGrid sends headers as a string with each header on a new line
   *
   * A long header is folded over several lines, each line after the first
   * starting with a space or a tab (RFC 5322 section 2.2.3): a References
   * header of a long thread, a Message-ID some mail programs start on the
   * line after its name, a Received header. Those lines are joined back onto
   * their header, one space between them. Read alone, they were lost - or,
   * when one held a colon (a Received header's time), read as a header of
   * their own.
   */
  private parseHeaders(
    headersString?: string,
  ): Record<string, string> | undefined {
    if (!headersString) {
      return undefined;
    }

    const headers: Record<string, string> = {};
    const lines: string[] = headersString.split("\n");
    // The header a folded line continues, until a line that is not one.
    let foldingInto: string | null = null;

    for (const line of lines) {
      const firstCharacter: string = line.charAt(0);

      if (
        foldingInto !== null &&
        (firstCharacter === " " || firstCharacter === "\t")
      ) {
        const continuation: string = line.trim();

        if (continuation) {
          const soFar: string = headers[foldingInto] || "";

          headers[foldingInto] = soFar
            ? `${soFar} ${continuation}`
            : continuation;
        }

        continue;
      }

      const colonIndex: number = line.indexOf(":");

      if (colonIndex > 0) {
        const key: string = line.substring(0, colonIndex).trim();
        const value: string = line.substring(colonIndex + 1).trim();

        headers[key] = value;
        foldingInto = key;
      } else {
        foldingInto = null;
      }
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  /**
   * Parse attachments from SendGrid webhook data
   */
  private parseAttachments(
    rawData: JSONObject,
  ):
    | Array<{ filename: string; contentType: string; size: number }>
    | undefined {
    const attachmentCount: number = parseInt(
      rawData["attachments"]?.toString() || "0",
      10,
    );

    if (attachmentCount === 0) {
      return undefined;
    }

    // Parse attachment-info JSON if available
    const attachmentInfoStr: string | undefined =
      rawData["attachment-info"]?.toString();

    if (!attachmentInfoStr) {
      return undefined;
    }

    try {
      const attachmentInfo: JSONObject = JSON.parse(attachmentInfoStr);
      const attachments: Array<{
        filename: string;
        contentType: string;
        size: number;
      }> = [];

      for (const key of Object.keys(attachmentInfo)) {
        const info: JSONObject = attachmentInfo[key] as JSONObject;

        attachments.push({
          filename: info["filename"]?.toString() || "unknown",
          contentType: info["type"]?.toString() || "application/octet-stream",
          size: parseInt(info["content-length"]?.toString() || "0", 10),
        });
      }

      return attachments.length > 0 ? attachments : undefined;
    } catch {
      return undefined;
    }
  }
}
