import BadDataException from "../../../Types/Exception/BadDataException";
import VideoCallMeeting from "../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import GoogleMeetClient from "./Providers/GoogleMeetClient";
import MicrosoftTeamsMeetingClient from "./Providers/MicrosoftTeamsMeetingClient";
import ZoomMeetingClient from "./Providers/ZoomMeetingClient";
import VideoCallConnectionSettingsUtil, {
  VideoCallConnectionSettings,
} from "./VideoCallConnectionSettings";
import VideoCallHttpClient from "./VideoCallHttpClient";
import { VideoCallMeetingRequest } from "./VideoCallMeetingRequest";

/*
 * Starts one call with a connection's settings: a new meeting from the
 * provider's API, or the standing link of a Meeting link connection. The
 * settings are the decrypted ones, so nothing here may log or return them.
 */
export default class VideoCallMeetingFactory {
  public static async createMeeting(data: {
    settings: VideoCallConnectionSettings;
    request: VideoCallMeetingRequest;
    http?: VideoCallHttpClient | undefined;
  }): Promise<VideoCallMeeting> {
    const config: VideoCallConnectionSettings["config"] = data.settings.config;
    const secrets: VideoCallConnectionSettings["secrets"] =
      data.settings.secrets;
    const read: (key: string) => string = (key: string): string => {
      return VideoCallConnectionSettingsUtil.readString(config, key);
    };
    const readSecret: (key: string) => string = (key: string): string => {
      return VideoCallConnectionSettingsUtil.readSecret(secrets, key);
    };

    switch (data.settings.provider) {
      case VideoCallProvider.Zoom:
        return await new ZoomMeetingClient(
          {
            accountId: read("accountId"),
            clientId: read("clientId"),
            clientSecret: readSecret("clientSecret"),
            hostEmail: read("hostEmail"),
          },
          data.http,
        ).createMeeting(data.request);

      case VideoCallProvider.GoogleMeet:
        return await new GoogleMeetClient(
          {
            serviceAccountJson: readSecret("serviceAccountJson"),
            impersonatedUserEmail: read("impersonatedUserEmail"),
            accessType: read("accessType"),
          },
          data.http,
        ).createMeeting(data.request);

      case VideoCallProvider.MicrosoftTeams:
        return await new MicrosoftTeamsMeetingClient(
          {
            tenantId: read("tenantId"),
            clientId: read("clientId"),
            clientSecret: readSecret("clientSecret"),
            organizerUserId: read("organizerUserId"),
            lobbyBypass: read("lobbyBypass"),
          },
          data.http,
        ).createMeeting(data.request);

      case VideoCallProvider.CustomLink: {
        const joinUrl: string = read("joinUrl");

        VideoCallConnectionSettingsUtil.validateMeetingLink(
          joinUrl,
          "Meeting link",
        );

        return {
          provider: VideoCallProvider.CustomLink,
          joinUrl: joinUrl,
        };
      }

      default:
        throw new BadDataException(
          `A ${data.settings.provider} connection cannot start a call.`,
        );
    }
  }
}
