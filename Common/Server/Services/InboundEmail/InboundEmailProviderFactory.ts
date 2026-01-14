import InboundEmailProvider from "./InboundEmailProvider";
import SendGridInboundProvider from "./Providers/SendGridInboundProvider";
import {
  InboundEmailProviderType,
  InboundEmailProvider as InboundEmailProviderConfig,
  InboundEmailDomain,
  InboundEmailWebhookSecret,
} from "../../EnvironmentConfig";
import BadDataException from "../../../Types/Exception/BadDataException";

export default class InboundEmailProviderFactory {
  private static instance: InboundEmailProvider | null = null;

  public static getProvider(): InboundEmailProvider {
    if (this.instance) {
      return this.instance;
    }

    if (!InboundEmailDomain) {
      throw new BadDataException(
        "Inbound email is not configured. Please set the INBOUND_EMAIL_DOMAIN environment variable.",
      );
    }

    switch (InboundEmailProviderConfig) {
      case InboundEmailProviderType.SendGrid:
        this.instance = new SendGridInboundProvider({
          inboundDomain: InboundEmailDomain,
          webhookSecret: InboundEmailWebhookSecret,
        });
        break;

      default:
        throw new BadDataException(
          `Unknown inbound email provider: ${InboundEmailProviderConfig}`,
        );
    }

    return this.instance;
  }

  /**
   * Check if inbound email is configured
   */
  public static isConfigured(): boolean {
    return Boolean(InboundEmailDomain);
  }

  /**
   * Generate the email address for a monitor based on its secret key
   */
  public static generateMonitorEmailAddress(secretKey: string): string {
    const provider: InboundEmailProvider = this.getProvider();

    return provider.generateMonitorEmailAddress(secretKey);
  }

  /**
   * Extract the secret key from an email address
   */
  public static extractSecretKeyFromEmail(email: string): string | null {
    const provider: InboundEmailProvider = this.getProvider();

    return provider.extractSecretKeyFromEmail(email);
  }

  /**
   * Get the inbound domain
   */
  public static getInboundDomain(): string | undefined {
    return InboundEmailDomain;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  public static resetInstance(): void {
    this.instance = null;
  }
}
