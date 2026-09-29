import { ICallProvider } from "Common/Types/Call/CallProvider";
import CallProviderType from "Common/Types/Call/CallProviderType";
import TwilioCallProvider from "./TwilioCallProvider";
import { getTwilioConfig, CallProvider } from "../Config";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";

export default class CallProviderFactory {
  private static instance: ICallProvider | null = null;
  private static currentProviderType: CallProviderType | null = null;

  // Get a provider with the global configuration (cached)
  public static async getProvider(): Promise<ICallProvider> {
    const providerType: CallProviderType = this.getProviderType();

    // Return cached instance if provider type hasn't changed
    if (this.instance && this.currentProviderType === providerType) {
      return this.instance;
    }

    switch (providerType) {
      case CallProviderType.Twilio: {
        const twilioConfig: TwilioConfig | null = await getTwilioConfig();

        if (!twilioConfig) {
          throw new BadDataException(
            "Twilio configuration not found. Please configure Twilio in Admin Dashboard.",
          );
        }

        this.instance = new TwilioCallProvider(twilioConfig);
        this.currentProviderType = providerType;
        break;
      }
      default:
        throw new BadDataException(`Unknown call provider: ${providerType}`);
    }

    return this.instance;
  }

  /*
   * Get a provider with a custom configuration (not cached)
   * Used when a project has its own Twilio configuration
   */
  public static getProviderWithConfig(
    customConfig: TwilioConfig,
  ): ICallProvider {
    const providerType: CallProviderType = this.getProviderType();

    switch (providerType) {
      case CallProviderType.Twilio: {
        /*
         * Create a new provider instance with the custom config
         * This is not cached since it's project-specific
         */
        return new TwilioCallProvider(customConfig);
      }
      default:
        throw new BadDataException(`Unknown call provider: ${providerType}`);
    }
  }

  // Get a provider, using custom config if provided, otherwise global config
  public static async getProviderWithOptionalConfig(
    customConfig?: TwilioConfig,
  ): Promise<ICallProvider> {
    if (customConfig) {
      return this.getProviderWithConfig(customConfig);
    }
    return this.getProvider();
  }

  public static getProviderType(): CallProviderType {
    switch (CallProvider.toLowerCase()) {
      case "twilio":
        return CallProviderType.Twilio;
      default:
        return CallProviderType.Twilio;
    }
  }

  // Method to reset the cached instance (useful for testing or config changes)
  public static resetProvider(): void {
    this.instance = null;
    this.currentProviderType = null;
  }
}
