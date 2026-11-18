import { IsBillingEnabled } from "../../EnvironmentConfig";
import ProjectCallSMSConfigService from "../../Services/ProjectCallSMSConfigService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ServerSendingStatus from "./ServerSendingStatus";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import TwilioPhoneNumbers from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import ObjectID from "../../../Types/ObjectID";
import {
  PROJECT_CAN_SEND_EVERYTHING,
  ProjectCanSendAnswer,
} from "../../../Types/ServerSending/ProjectCanSend";
import ServerSendingStatusUtil, {
  ServerChannelStatus,
  ServerSendingChannel,
} from "../../../Types/ServerSending/ServerSendingStatus";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";

/*
 * WHETHER A PAGE CAN REACH A PROJECT'S PEOPLE BY EMAIL, SMS AND CALL
 * (Types/ServerSending/ProjectCanSend, #7151, #6880).
 *
 * Email goes out through the server's own settings, SMS and calls through
 * the project's default Twilio config for that kind of message, or else the
 * server's own account or gateway - as the senders pick them
 * (TwilioAccountAvailability). The server's channels are read from its
 * sending status (ServerSendingStatus): not set up, or failing, is no.
 *
 * A yes or no per channel, and nothing else: what is missing, what a
 * provider said and every setting stay the server's admins'
 * (GET /global-config/sending-status). OneUptime Cloud answers yes: its
 * sending is its operator's to watch.
 */
export default class ProjectCanSendReader {
  @CaptureSpan()
  public static async read(projectId: ObjectID): Promise<ProjectCanSendAnswer> {
    if (IsBillingEnabled) {
      return { ...PROJECT_CAN_SEND_EVERYTHING };
    }

    const statuses: Array<ServerChannelStatus> =
      await ServerSendingStatus.getStatuses();

    const serverCanSend: (channel: ServerSendingChannel) => boolean = (
      channel: ServerSendingChannel,
    ): boolean => {
      const status: ServerChannelStatus | undefined = statuses.find(
        (candidate: ServerChannelStatus): boolean => {
          return candidate.channel === channel;
        },
      );

      // A status not read is not known not to send.
      return !status || ServerSendingStatusUtil.canSendNow(status);
    };

    const [sms, call] = await Promise.all([
      ProjectCanSendReader.canSendThroughTwilio({
        projectId: projectId,
        kind: TwilioMessageKind.SMS,
        serverCanSend: serverCanSend(ServerSendingChannel.SMS),
      }),
      ProjectCanSendReader.canSendThroughTwilio({
        projectId: projectId,
        kind: TwilioMessageKind.Call,
        serverCanSend: serverCanSend(ServerSendingChannel.Call),
      }),
    ]);

    return {
      email: serverCanSend(ServerSendingChannel.Email),
      sms: sms,
      call: call,
    };
  }

  /*
   * An SMS or a call goes out when the project's own default Twilio config
   * sends that kind of message, or else when the server's own account or
   * gateway can: the project's own is read only when the server's cannot.
   */
  private static async canSendThroughTwilio(data: {
    projectId: ObjectID;
    kind: TwilioMessageKind;
    serverCanSend: boolean;
  }): Promise<boolean> {
    if (data.serverCanSend) {
      return true;
    }

    const projectConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        data.projectId,
        data.kind,
      );

    return TwilioPhoneNumbers.canSend(projectConfig, data.kind);
  }
}
