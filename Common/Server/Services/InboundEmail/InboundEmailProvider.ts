import { JSONObject } from "../../../Types/JSON";

export interface ParsedInboundEmail {
  from: string;
  to: string;
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
   */
  public abstract validateWebhook(data: {
    headers: Record<string, string>;
    body: JSONObject | string;
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
