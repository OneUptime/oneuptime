import {
  AppApiClientUrl,
  GoogleMeetAppClientId,
  GoogleMeetAppClientSecret,
  MicrosoftTeamsMeetingsAppClientId,
  MicrosoftTeamsMeetingsAppClientSecret,
  ZoomAppClientId,
  ZoomAppClientSecret,
} from "../../../EnvironmentConfig";
import BadDataException from "../../../../Types/Exception/BadDataException";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "../../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallOAuthDefinition,
  getVideoCallOAuthDefinition,
} from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import VideoCallHttpClient from "../VideoCallHttpClient";
import GoogleMeetOAuthApp from "./GoogleMeetOAuthApp";
import MicrosoftTeamsMeetingsOAuthApp from "./MicrosoftTeamsMeetingsOAuthApp";
import {
  VideoCallOAuthApp,
  VideoCallOAuthAppCredentials,
} from "./VideoCallOAuth";
import ZoomOAuthApp from "./ZoomOAuthApp";

/*
 * This server's apps for the one-click Connect, read from its environment
 * (ZOOM_APP_*, GOOGLE_MEET_APP_*, MICROSOFT_TEAMS_MEETINGS_APP_*). A
 * provider needs both its client id and its client secret: with only the
 * id, the Connect button would send people to a sign-in that can never
 * finish.
 */

// The connect routes, under /api: /video-call-oauth/<slug>/...
export const VIDEO_CALL_OAUTH_ROUTE_PREFIX: string = "/video-call-oauth";

export default class VideoCallOAuthApps {
  public static getCredentials(
    provider: VideoCallProvider | string | undefined,
  ): VideoCallOAuthAppCredentials | null {
    let clientId: string | null = null;
    let clientSecret: string | null = null;

    switch (provider) {
      case VideoCallProvider.Zoom:
        clientId = ZoomAppClientId;
        clientSecret = ZoomAppClientSecret;
        break;
      case VideoCallProvider.GoogleMeet:
        clientId = GoogleMeetAppClientId;
        clientSecret = GoogleMeetAppClientSecret;
        break;
      case VideoCallProvider.MicrosoftTeams:
        clientId = MicrosoftTeamsMeetingsAppClientId;
        clientSecret = MicrosoftTeamsMeetingsAppClientSecret;
        break;
      default:
        return null;
    }

    if (!clientId?.trim() || !clientSecret) {
      return null;
    }

    return { clientId: clientId.trim(), clientSecret };
  }

  public static isConfigured(
    provider: VideoCallProvider | string | undefined,
  ): boolean {
    return VideoCallOAuthApps.getCredentials(provider) !== null;
  }

  // The provider's app, or null when this server does not have it set up.
  public static get(
    provider: VideoCallProvider | string | undefined,
    http?: VideoCallHttpClient | undefined,
  ): VideoCallOAuthApp | null {
    const credentials: VideoCallOAuthAppCredentials | null =
      VideoCallOAuthApps.getCredentials(provider);

    if (!credentials) {
      return null;
    }

    switch (provider) {
      case VideoCallProvider.Zoom:
        return new ZoomOAuthApp(credentials, http);
      case VideoCallProvider.GoogleMeet:
        return new GoogleMeetOAuthApp(credentials, http);
      case VideoCallProvider.MicrosoftTeams:
        return new MicrosoftTeamsMeetingsOAuthApp(credentials, http);
      default:
        return null;
    }
  }

  public static getOrThrow(
    provider: VideoCallProvider | string | undefined,
    http?: VideoCallHttpClient | undefined,
  ): VideoCallOAuthApp {
    const app: VideoCallOAuthApp | null = VideoCallOAuthApps.get(
      provider,
      http,
    );

    if (!app) {
      throw new BadDataException(
        VideoCallOAuthApps.getNotConfiguredMessage(provider),
      );
    }

    return app;
  }

  public static getNotConfiguredMessage(
    provider: VideoCallProvider | string | undefined,
  ): string {
    const title: string = getVideoCallProviderDisplayName(provider);

    return `Connecting ${title} by signing in is not set up on this OneUptime server. Ask your server administrator to set up its ${title} app, or connect your own ${title} app instead.`;
  }

  /*
   * Where the provider sends the browser back after the sign-in. The app
   * registers exactly this URL: https://<host>/api/video-call-oauth/<slug>/callback.
   */
  public static getRedirectUri(provider: VideoCallProvider): string {
    const definition: VideoCallOAuthDefinition | undefined =
      getVideoCallOAuthDefinition(provider);

    if (!definition) {
      throw new BadDataException(
        `${getVideoCallProviderDisplayName(provider)} has no one-click Connect.`,
      );
    }

    return `${AppApiClientUrl.toString().replace(/\/+$/, "")}${VIDEO_CALL_OAUTH_ROUTE_PREFIX}/${definition.slug}/callback`;
  }
}
