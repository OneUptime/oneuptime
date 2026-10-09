import BadDataException from "../../../Types/Exception/BadDataException";
import { isVideoCallOAuth } from "../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallMeeting from "../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallOAuthAccess,
  VideoCallOAuthAccessToken,
} from "./OAuth/VideoCallOAuth";
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
 *
 * A connection made by signing in creates its meeting with the sign-in's
 * own token, which `oauth` hands out (VideoCallOAuthTokenStore): as the
 * signed-in account, the same meeting a service identity would create.
 */
export default class VideoCallMeetingFactory {
  public static async createMeeting(data: {
    settings: VideoCallConnectionSettings;
    request: VideoCallMeetingRequest;
    http?: VideoCallHttpClient | undefined;
    // The connection's sign-in, for a connection made by signing in.
    oauth?: VideoCallOAuthAccess | undefined;
  }): Promise<VideoCallMeeting> {
    if (isVideoCallOAuth(data.settings.authMethod)) {
      return await VideoCallMeetingFactory.createMeetingWithSignIn(data);
    }

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

  private static async createMeetingWithSignIn(data: {
    settings: VideoCallConnectionSettings;
    request: VideoCallMeetingRequest;
    http?: VideoCallHttpClient | undefined;
    oauth?: VideoCallOAuthAccess | undefined;
  }): Promise<VideoCallMeeting> {
    const title: string = getVideoCallProviderDisplayName(
      data.settings.provider,
    );

    if (!data.oauth) {
      throw new BadDataException(
        `This ${title} connection has no sign-in to start a call with. Reconnect ${title} in Project Settings > Video Calls.`,
      );
    }

    const http: VideoCallHttpClient = data.http || new VideoCallHttpClient();
    const token: VideoCallOAuthAccessToken = await data.oauth.getAccessToken();
    const label: string = data.oauth.accountLabel || `the ${title} account`;
    const read: (key: string) => string = (key: string): string => {
      return VideoCallConnectionSettingsUtil.readString(
        data.settings.config,
        key,
      );
    };

    switch (data.settings.provider) {
      case VideoCallProvider.Zoom:
        return await ZoomMeetingClient.createMeetingWithToken({
          http,
          token: {
            accessToken: token.accessToken,
            apiBaseUrl: ZoomMeetingClient.getApiBaseUrl(token.apiBaseUrl),
          },
          host: { userId: "me", label, isSignIn: true },
          request: data.request,
        });

      case VideoCallProvider.GoogleMeet:
        return await GoogleMeetClient.createSpaceWithToken({
          http,
          accessToken: token.accessToken,
          accessType: read("accessType"),
          owner: { label, isSignIn: true },
        });

      case VideoCallProvider.MicrosoftTeams:
        return await MicrosoftTeamsMeetingClient.createMeetingWithToken({
          http,
          accessToken: token.accessToken,
          organizer: { path: "/me", label, isSignIn: true },
          lobbyBypass: read("lobbyBypass"),
          request: data.request,
        });

      default:
        throw new BadDataException(
          `A ${data.settings.provider} connection cannot be made by signing in.`,
        );
    }
  }
}
