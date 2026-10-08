import GlobalConfigService from "../Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../Services/ProjectCallSMSConfigService";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import ObjectID from "../../Types/ObjectID";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";

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
 */
export default class TwilioAccountAvailability {
  /*
   * The server's own account counts once its three required values are
   * filled in, exactly as the Notification service reads them.
   */
  public static async isServerAccountSetUp(): Promise<boolean> {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          twilioAccountSID: true,
          twilioAuthToken: true,
          twilioPrimaryPhoneNumber: true,
        },
      });

    return Boolean(
      globalConfig &&
        globalConfig.twilioAccountSID &&
        globalConfig.twilioAuthToken &&
        globalConfig.twilioPrimaryPhoneNumber,
    );
  }

  /*
   * A caller that already read the project's default config (for the
   * balance check, which it skips when the project pays Twilio itself)
   * passes it in, so it is not read twice.
   */
  public static async isAccountAvailableForProject(data: {
    projectId: ObjectID;
    projectDefaultTwilioConfig?: TwilioConfig | undefined;
  }): Promise<boolean> {
    const projectDefaultTwilioConfig: TwilioConfig | undefined =
      data.projectDefaultTwilioConfig ||
      (await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        data.projectId,
      ));

    if (projectDefaultTwilioConfig) {
      return true;
    }

    return await TwilioAccountAvailability.isServerAccountSetUp();
  }
}
