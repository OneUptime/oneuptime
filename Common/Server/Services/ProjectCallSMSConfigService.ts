import DatabaseService from "./DatabaseService";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/ProjectCallSMSConfig";
import Phone from "../../Types/Phone";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public toTwilioConfig(
    projectCallSmsConfig: Model | undefined,
  ): TwilioConfig | undefined {
    if (!projectCallSmsConfig) {
      return undefined;
    }

    if (!projectCallSmsConfig.id) {
      throw new BadDataException("Project Call and SMS Config id is not set");
    }

    if (!projectCallSmsConfig.twilioAccountSID) {
      throw new BadDataException(
        "Project Call and SMS Config twilio account SID is not set",
      );
    }

    if (!projectCallSmsConfig.twilioPrimaryPhoneNumber) {
      throw new BadDataException(
        "Project Call and SMS Config twilio phone number is not set",
      );
    }

    if (!projectCallSmsConfig.twilioAuthToken) {
      throw new BadDataException(
        "Project Call and SMS Config twilio auth token is not set",
      );
    }

    return {
      accountSid: projectCallSmsConfig.twilioAccountSID.toString(),
      authToken: projectCallSmsConfig.twilioAuthToken.toString(),
      primaryPhoneNumber: projectCallSmsConfig.twilioPrimaryPhoneNumber,
      secondaryPhoneNumbers:
        projectCallSmsConfig.twilioSecondaryPhoneNumbers &&
        projectCallSmsConfig.twilioSecondaryPhoneNumbers.length > 0
          ? projectCallSmsConfig.twilioSecondaryPhoneNumbers
              .split(",")
              .map((phone: string) => {
                return new Phone(phone);
              })
          : [],
    };
  }
}
export default new Service();
