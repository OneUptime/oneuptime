import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import Phone from "Common/Types/Phone";
import { ISmsProvider } from "Common/Types/SMS/SmsProvider";
import SmsProviderType from "Common/Types/SMS/SmsProviderType";
import { getTwilioConfig, SmsProvider } from "../Config";
import TwilioSmsProvider from "./TwilioSmsProvider";

export default class SmsProviderFactory {
  private static instance: ISmsProvider | null = null;
  private static currentProviderType: SmsProviderType | null = null;
  private static cachedConfig: TwilioConfig | null = null;

  /*
   * The global config lives in the DB and can change at any time, so it is
   * re-read on every call and the cached instance is rebuilt when it changes.
   */
  private static isSameConfig(
    a: TwilioConfig | null,
    b: TwilioConfig | null,
  ): boolean {
    if (!a || !b) {
      return a === b;
    }

    const secondaryOf: (config: TwilioConfig) => string = (
      config: TwilioConfig,
    ): string => {
      return (config.secondaryPhoneNumbers || [])
        .map((phone: Phone) => {
          return phone.toString();
        })
        .join(",");
    };

    return (
      a.accountSid === b.accountSid &&
      a.authToken === b.authToken &&
      a.primaryPhoneNumber.toString() === b.primaryPhoneNumber.toString() &&
      secondaryOf(a) === secondaryOf(b)
    );
  }

  // Get a provider with the global configuration (cached)
  public static async getProvider(): Promise<ISmsProvider> {
    const providerType: SmsProviderType = this.getProviderType();
    const twilioConfig: TwilioConfig | null = await getTwilioConfig();

    // Return cached instance if provider type and config haven't changed
    if (
      this.instance &&
      this.currentProviderType === providerType &&
      this.isSameConfig(this.cachedConfig, twilioConfig)
    ) {
      return this.instance;
    }

    switch (providerType) {
      case SmsProviderType.Twilio: {
        if (!twilioConfig) {
          throw new BadDataException("Twilio Config not found").asUserError();
        }

        this.instance = new TwilioSmsProvider(twilioConfig);
        this.currentProviderType = providerType;
        this.cachedConfig = twilioConfig;
        break;
      }
      default:
        throw new BadDataException(`Unknown SMS provider: ${providerType}`);
    }

    return this.instance;
  }

  /*
   * Get a provider with a custom configuration (not cached)
   * Used when a project has its own Twilio configuration
   */
  public static getProviderWithConfig(
    customConfig: TwilioConfig,
  ): ISmsProvider {
    return new TwilioSmsProvider(customConfig);
  }

  // Get a provider, using custom config if provided, otherwise global config
  public static async getProviderWithOptionalConfig(
    customConfig?: TwilioConfig,
  ): Promise<ISmsProvider> {
    if (customConfig) {
      return this.getProviderWithConfig(customConfig);
    }
    return this.getProvider();
  }

  public static getProviderType(): SmsProviderType {
    switch (SmsProvider.toLowerCase()) {
      case "twilio":
        return SmsProviderType.Twilio;
      default:
        return SmsProviderType.Twilio;
    }
  }

  // Method to reset the cached instance (useful for testing or config changes)
  public static resetProvider(): void {
    this.instance = null;
    this.currentProviderType = null;
    this.cachedConfig = null;
  }
}
