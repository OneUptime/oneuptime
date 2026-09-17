import InboundEmailProvider, {
  InboundEmailProviderConfig,
  ParsedInboundEmail,
} from "../InboundEmailProvider";
import { JSONObject } from "../../../../Types/JSON";

// SendGrid uses the base config - add SendGrid-specific options here if needed in the future
export type SendGridInboundConfig = InboundEmailProviderConfig;

/**
 * SendGrid Inbound Parse provider implementation
 *
 * This provider handles email parsing from SendGrid's Inbound Parse webhook.
 * SendGrid sends emails to the webhook as multipart/form-data with the following fields:
 * - from: Email sender
 * - to: Email recipient(s)
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
      subject,
      body,
      bodyHtml,
      headers,
      attachments,
    };
  }

  public async validateWebhook(data: {
    headers: Record<string, string>;
    body: JSONObject | string;
    pathSecret: string;
  }): Promise<boolean> {
    /*
     * SendGrid Inbound Parse doesn't provide webhook signature verification by default
     * We validate using a secret in the URL path
     * URL format: /incoming-email/sendgrid/{webhookSecret}
     */
    if (this.config.webhookSecret) {
      return data.pathSecret === this.config.webhookSecret;
    }

    /*
     * If no webhook secret is configured, accept all requests
     * This is acceptable for SendGrid as the webhook URL itself is a secret
     */
    return true;
  }

  public extractSecretKeyFromEmail(email: string): string | null {
    /*
     * Extract from: monitor-{secretKey}@inbound.domain.com
     * Handle email formats like "name@domain" or "Name <name@domain>"
     */
    const emailAddress: string = this.extractEmailAddress(email);

    /*
     * Create regex pattern that matches the email prefix format
     * The secret key is a UUID-like string
     */
    const pattern: RegExp = new RegExp(
      `^monitor-([a-zA-Z0-9-]+)@${this.escapeRegex(this.config.inboundDomain)}$`,
      "i",
    );
    const match: RegExpMatchArray | null = emailAddress.match(pattern);

    return match ? match[1]! : null;
  }

  public generateMonitorEmailAddress(secretKey: string): string {
    return `monitor-${secretKey}@${this.config.inboundDomain}`;
  }

  /**
   * Extract email address from various formats
   * Examples:
   * - "user@domain.com" -> "user@domain.com"
   * - "User Name <user@domain.com>" -> "user@domain.com"
   * - "<user@domain.com>" -> "user@domain.com"
   */
  private extractEmailAddress(email: string): string {
    const match: RegExpMatchArray | null = email.match(/<([^>]+)>/);

    if (match && match[1]) {
      return match[1].toLowerCase().trim();
    }

    return email.toLowerCase().trim();
  }

  /**
   * Parse SendGrid headers string into a key-value object
   * SendGrid sends headers as a string with each header on a new line
   */
  private parseHeaders(
    headersString?: string,
  ): Record<string, string> | undefined {
    if (!headersString) {
      return undefined;
    }

    const headers: Record<string, string> = {};
    const lines: string[] = headersString.split("\n");

    for (const line of lines) {
      const colonIndex: number = line.indexOf(":");

      if (colonIndex > 0) {
        const key: string = line.substring(0, colonIndex).trim();
        const value: string = line.substring(colonIndex + 1).trim();

        headers[key] = value;
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

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
