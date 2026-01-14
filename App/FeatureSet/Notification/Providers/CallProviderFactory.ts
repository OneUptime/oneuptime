import { ICallProvider } from "Common/Types/Call/CallProvider";
import CallProviderType from "Common/Types/Call/CallProviderType";
import TwilioCallProvider from "./TwilioCallProvider";
import { getTwilioConfig } from "../Config";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";

export default class CallProviderFactory {
  private static instance: ICallProvider | null = null;
  private static currentProviderType: CallProviderType | null = null;

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

  public static getProviderType(): CallProviderType {
    const providerTypeString: string =
      process.env["CALL_PROVIDER"] || "twilio";

    switch (providerTypeString.toLowerCase()) {
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
