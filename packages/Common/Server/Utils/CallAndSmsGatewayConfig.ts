import GlobalConfigService from "../Services/GlobalConfigService";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import CallAndSmsProviders, {
  CallAndSmsGateway,
} from "../../Types/CallAndSMS/CallAndSmsProvider";
import ObjectID from "../../Types/ObjectID";
import { GLOBAL_CALL_AND_SMS_GATEWAY_SELECT } from "./TwilioConfigSelect";

/*
 * THE GATEWAY THE ONEUPTIME SERVER SENDS ITS SMS AND CALLS THROUGH, IF ANY.
 *
 * Admin Dashboard > Settings > Call and SMS can send what would go through
 * the server's own Twilio account to the installation's own gateway instead
 * (Types/CallAndSMS/CallAndSmsProvider). The Notification service sends
 * through it (SmsService, CallService), and the checks made before a
 * verification code is sent ask whether there is one
 * (TwilioAccountAvailability) - one reading for both, as for the Twilio
 * account (ServerTwilioConfig).
 */
export default class CallAndSmsGatewayConfig {
  /*
   * The gateway, or null while the server sends through Twilio - or is set
   * to the gateway with no URL, which only a row edited by hand can hold.
   */
  public static async getGateway(): Promise<CallAndSmsGateway | null> {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,
      });

    if (!globalConfig) {
      return null;
    }

    return CallAndSmsProviders.getGateway(globalConfig);
  }
}
