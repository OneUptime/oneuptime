import { JSONObject } from "../../../Types/JSON";
import EmailAddressList from "../../../Utils/Email/EmailAddressList";
import { getUsableInboundEmailWebhookSecret } from "../../EnvironmentConfig";

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
  /*
   * The installation's INBOUND_EMAIL_WEBHOOK_SECRET. A provider keeps it only
   * when it is one the installation may use
   * (EnvironmentConfig.getUsableInboundEmailWebhookSecret): unset, blank, a
   * value the repository ships or a placeholder the setup guide prints is no
   * secret at all.
   */
  webhookSecret?: string | undefined;
  inboundDomain: string;
}

/*
 * What a delivery shows before its body is read: the request's headers, and
 * the last part of the address it was posted to
 * (/incoming-email/sendgrid/:secret).
 */
export interface InboundEmailDelivery {
  headers: Record<string, string>;
  pathSecret: string;
}

export default abstract class InboundEmailProvider {
  protected config: InboundEmailProviderConfig;

  public constructor(config: InboundEmailProviderConfig) {
    this.config = {
      ...config,
      webhookSecret: getUsableInboundEmailWebhookSecret(config.webhookSecret),
    };
  }

  /*
   * Whether the installation has a secret a delivery can prove itself with.
   * Without one, validateWebhook refuses every delivery.
   */
  public hasWebhookSecret(): boolean {
    return Boolean(this.config.webhookSecret);
  }

  /**
   * Whether a delivery comes from the mail provider, decided before its body
   * is read, so a request that cannot prove it costs nothing to refuse.
   *
   * Every provider is held to one rule here: an installation with no secret
   * of its own has nothing to tell the provider's deliveries from anybody
   * else's, so it refuses every one of them, whatever the provider would
   * check. Only then does the provider check the delivery against the secret.
   */
  public async validateWebhook(data: InboundEmailDelivery): Promise<boolean> {
    const webhookSecret: string | undefined = this.config.webhookSecret;

    if (!webhookSecret) {
      return false;
    }

    return await this.isFromProvider({
      ...data,
      webhookSecret: webhookSecret,
    });
  }

  /**
   * The provider's own check of a delivery against the installation's
   * secret, which validateWebhook has made sure there is.
   */
  protected abstract isFromProvider(
    data: InboundEmailDelivery & { webhookSecret: string },
  ): Promise<boolean>;

  /**
   * Parse raw webhook/request data into ParsedInboundEmail
   */
  public abstract parseInboundEmail(
    rawData: JSONObject,
  ): Promise<ParsedInboundEmail>;

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
