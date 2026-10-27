import GlobalConfigService from "../Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../Services/ProjectCallSMSConfigService";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import TwilioPhoneNumbers from "../../Types/CallAndSMS/TwilioPhoneNumbers";
import ObjectID from "../../Types/ObjectID";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import { TwilioMessageKind } from "../../Utils/Project/TwilioAccount";
import {
  GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,
  GLOBAL_TWILIO_CONFIG_SELECT,
} from "./TwilioConfigSelect";
import CallAndSmsProviders from "../../Types/CallAndSMS/CallAndSmsProvider";
import { toServerTwilioConfig } from "./ServerTwilioConfig";

/*
 * Whether an SMS or a call to a project's members has a Twilio account to go
 * through at all: the project's default Twilio config, or else the OneUptime
 * server's own (Utils/Project/TwilioAccount says who sets each, and where).
 *
 * The same question the Notification service answers when it sends
 * (Notification/Config getTwilioConfig, and the project default every
 * channel service hands it), asked BEFORE anything is sent: a verification
 * code that cannot go anywhere is refused up front, with the reason, instead
 * of being issued, failing in the background and leaving the person waiting
 * for a message that is never coming.
 *
 * Asked of one kind of message: a config used for SMS only makes no calls,
 * and one used for calls only sends no SMS (Types/CallAndSMS/TwilioConfigUse),
 * so a project whose default is used for SMS only has an account for its SMS
 * and, for its calls, only the server's.
 */
export default class TwilioAccountAvailability {
  /*
   * The server's own account counts once its account SID, its token and
   * the numbers what it is used for takes are filled in, exactly as the
   * Notification service reads them (ServerTwilioConfig) - and, given a
   * kind of message, only when it is used for that kind. A server that
   * sends through its own gateway instead (CallAndSmsProvider) counts for
   * both kinds.
   */
  public static async isServerAccountSetUp(
    kind?: TwilioMessageKind | undefined,
  ): Promise<boolean> {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        /*
         * Read as the Notification service reads it (TwilioConfigSelect),
         * with what carries the server's SMS and calls beside it.
         */
        select: {
          ...GLOBAL_TWILIO_CONFIG_SELECT,
          ...GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,
        },
      });

    /*
     * A server that sends through its own gateway has somewhere to send
     * every SMS and call, whatever its Twilio account holds: the gateway
     * delivers both (CallAndSmsGatewayConfig).
     */
    if (globalConfig && CallAndSmsProviders.getGateway(globalConfig)) {
      return true;
    }

    let serverTwilioConfig: TwilioConfig | null = null;

    try {
      serverTwilioConfig = toServerTwilioConfig(globalConfig);
    } catch {
      /*
       * A list of numbers kept from before lists were checked, holding one
       * that is not a number: the account is there, and the message sent
       * through it says what is wrong with the list, as it always did.
       */
      return true;
    }

    if (!serverTwilioConfig) {
      return false;
    }

    return kind ? TwilioPhoneNumbers.canSend(serverTwilioConfig, kind) : true;
  }

  /*
   * A caller that already read the project's default config (for the
   * balance check, which it skips when the project pays Twilio itself)
   * passes it in, so it is not read twice. A default that is not used for
   * this kind of message does not count: the message would go through the
   * server's own account.
   */
  public static async isAccountAvailableForProject(data: {
    projectId: ObjectID;
    kind: TwilioMessageKind;
    projectDefaultTwilioConfig?: TwilioConfig | undefined;
  }): Promise<boolean> {
    const projectDefaultTwilioConfig: TwilioConfig | undefined =
      data.projectDefaultTwilioConfig ||
      (await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        data.projectId,
      ));

    if (TwilioPhoneNumbers.canSend(projectDefaultTwilioConfig, data.kind)) {
      return true;
    }

    return await TwilioAccountAvailability.isServerAccountSetUp(data.kind);
  }
}
