import { JSONObject } from "../../../Types/JSON";
import EmailAddressList from "../../../Utils/Email/EmailAddressList";

export interface ParsedInboundEmail {
  from: string;
  to: string;
  /*
   * Every address in the To and Cc headers, lowercased. `to` above is kept as
   * it always was, because Incoming Email monitors evaluate it.
   */
  toAddresses?: Array<string> | undefined;
  ccAddresses?: Array<string> | undefined;
  /*
   * Who this delivery is for: the SMTP recipients (RCPT TO) on the inbound
   * domain, when the provider says. They need not appear in To or Cc at all -
   * a Bcc, a forwarding rule, a mailing list - and when they are known they
   * are the only recipients that count. SendGrid posts one webhook per
   * recipient, so routing by the headers instead would hand an email sent to
   * two addresses to both of them twice.
   */
  envelopeRecipients?: Array<string> | undefined;
  subject: string;
  body: string;
  bodyHtml?: string | undefined;
  headers?: Record<string, string> | undefined;
  rawEmail?: string | undefined;
  attachments?:
    | Array<{
        filename: string;
        contentType: string;
        size: number;
      }>
    | undefined;
}

/*
 * The addresses an inbound delivery is for, in the order to try them: the
 * envelope's recipients when the provider gave them, else everyone in To and
 * Cc, else the one `to` address. Lowercased, and each once.
 */
export const getInboundEmailRecipientAddresses: (
  email: ParsedInboundEmail,
) => Array<string> = (email: ParsedInboundEmail): Array<string> => {
  const envelope: Array<string> = EmailAddressList.merge(
    email.envelopeRecipients,
  );

  if (envelope.length > 0) {
    return envelope;
  }

  const headers: Array<string> = EmailAddressList.merge(
    email.toAddresses,
    email.ccAddresses,
  );

  if (headers.length > 0) {
    return headers;
  }

  return EmailAddressList.merge(email.to ? [email.to] : []);
};

export interface InboundEmailProviderConfig {
  webhookSecret?: string | undefined;
  inboundDomain: string;
}

export default abstract class InboundEmailProvider {
  protected config: InboundEmailProviderConfig;

  public constructor(config: InboundEmailProviderConfig) {
    this.config = config;
  }

  /**
   * Parse raw webhook/request data into ParsedInboundEmail
   */
  public abstract parseInboundEmail(
    rawData: JSONObject,
  ): Promise<ParsedInboundEmail>;

  /**
   * Validate webhook signature/authentication
   * @param data.pathSecret - Secret from the URL path (e.g., /incoming-email/sendgrid/:secret)
   */
  public abstract validateWebhook(data: {
    headers: Record<string, string>;
    body: JSONObject | string;
    pathSecret: string;
  }): Promise<boolean>;

  /**
   * Extract monitor secret key from email address
   * e.g., monitor-abc123@inbound.oneuptime.com -> abc123
   */
  public abstract extractSecretKeyFromEmail(email: string): string | null;

  /**
   * Generate inbound email address for a monitor
   */
  public abstract generateMonitorEmailAddress(secretKey: string): string;

  /**
   * Get the inbound domain
   */
  public getInboundDomain(): string {
    return this.config.inboundDomain;
  }
}
