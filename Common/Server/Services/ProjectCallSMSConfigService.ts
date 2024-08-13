import DatabaseService from "./DatabaseService";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import Model from "Common/Models/DatabaseModels/ProjectCallSMSConfig";

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

    if (!projectCallSmsConfig.twilioPhoneNumber) {
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
      phoneNumber: projectCallSmsConfig.twilioPhoneNumber,
    };
  }
}
export default new Service();
