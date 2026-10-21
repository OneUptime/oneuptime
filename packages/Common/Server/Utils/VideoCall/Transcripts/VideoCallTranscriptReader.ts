import VideoCallConnection from "../../../../Models/DatabaseModels/VideoCallConnection";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { isVideoCallOAuth } from "../../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallTranscriptUnavailableReason,
  canReadVideoCallTranscriptFromProvider,
} from "../../../../Types/VideoCall/VideoCallTranscript";
import VideoCallConnectionService, {
  Service as VideoCallConnectionServiceType,
} from "../../../Services/VideoCallConnectionService";
import { VideoCallOAuthAccessToken } from "../OAuth/VideoCallOAuth";
import GoogleMeetClient from "../Providers/GoogleMeetClient";
import MicrosoftTeamsMeetingClient from "../Providers/MicrosoftTeamsMeetingClient";
import ZoomMeetingClient, {
  ZoomAccessToken,
} from "../Providers/ZoomMeetingClient";
import VideoCallConnectionSettingsUtil, {
  VideoCallConnectionSettings,
} from "../VideoCallConnectionSettings";
import VideoCallHttpClient from "../VideoCallHttpClient";
import GoogleMeetTranscriptClient from "./GoogleMeetTranscriptClient";
import MicrosoftTeamsTranscriptClient from "./MicrosoftTeamsTranscriptClient";
import {
  VideoCallTranscriptRead,
  transcriptUnavailable,
} from "./VideoCallTranscriptRead";
import ZoomTranscriptClient from "./ZoomTranscriptClient";

/*
 * READS AN INCIDENT CALL'S TRANSCRIPT FROM ITS PROVIDER, with the connection
 * that started the call: the same sign-in or app credentials that created
 * the meeting (VideoCallConnectionService.getSettings), read as root, never
 * returned.
 *
 * Only a meeting OneUptime created can be read: a Zoom or Google Meet
 * meeting, or a Microsoft Teams meeting it put on its organizer's calendar
 * (canReadVideoCallTranscriptFromProvider). For every other call the
 * answer says how to add the transcript instead:
 *
 *   - Any other Microsoft Teams meeting: Graph has no transcripts for an
 *     online meeting created with no calendar event, which is how
 *     OneUptime creates one while Record and transcribe incident calls is
 *     off. Teams lets anyone in the meeting download its transcript as a
 *     .vtt file.
 *   - A Slack huddle: Slack has no API for a huddle's transcript.
 *   - A link of one's own: a meeting OneUptime knows nothing about.
 */
// The call whose transcript is read, as its row has it.
export interface VideoCallTranscriptReaderCall {
  provider?: VideoCallProvider | undefined;
  videoCallConnectionId?: ObjectID | undefined;
  externalMeetingId?: string | undefined;
  externalCalendarEventId?: string | undefined;
  // When the call started: Microsoft Teams no longer has a meeting long over.
  startedAt?: Date | undefined;
}

export default class VideoCallTranscriptReader {
  public static async read(data: {
    call: VideoCallTranscriptReaderCall;
    projectId: ObjectID;
    http?: VideoCallHttpClient | undefined;
  }): Promise<VideoCallTranscriptRead> {
    const call: VideoCallTranscriptReaderCall = data.call;

    if (!canReadVideoCallTranscriptFromProvider(call)) {
      return VideoCallTranscriptReader.getNotSupported(call.provider);
    }

    let connection: VideoCallConnection;
    let settings: VideoCallConnectionSettings;

    try {
      ({ connection, settings } = await VideoCallConnectionService.getSettings({
        connectionId: call.videoCallConnectionId!,
        projectId: data.projectId,
      }));
    } catch {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotSupported,
        "The connection that started this call no longer exists, so OneUptime cannot ask the provider for its transcript. Add the transcript yourself.",
      );
    }

    const http: VideoCallHttpClient = data.http || new VideoCallHttpClient();
    const isSignIn: boolean = isVideoCallOAuth(settings.authMethod);
    const meetingId: string = call.externalMeetingId || "";

    try {
      if (settings.provider === VideoCallProvider.Zoom) {
        const token: ZoomAccessToken = isSignIn
          ? await VideoCallTranscriptReader.getZoomSignInToken({
              connection,
              http,
            })
          : await new ZoomMeetingClient(
              {
                accountId: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "accountId",
                ),
                clientId: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "clientId",
                ),
                clientSecret: VideoCallConnectionSettingsUtil.readSecret(
                  settings.secrets,
                  "clientSecret",
                ),
                hostEmail: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "hostEmail",
                ),
              },
              http,
            ).getAccessToken();

        const grantedScope: JSONValue | undefined = settings.secrets["scope"];

        return await ZoomTranscriptClient.readTranscript({
          http,
          token,
          meetingId,
          isSignIn,
          grantedScope:
            isSignIn && typeof grantedScope === "string"
              ? grantedScope
              : undefined,
        });
      }

      if (settings.provider === VideoCallProvider.GoogleMeet) {
        const accessToken: string = isSignIn
          ? (
              await VideoCallTranscriptReader.getSignInToken({
                connection,
                http,
              })
            ).accessToken
          : await new GoogleMeetClient(
              {
                serviceAccountJson: VideoCallConnectionSettingsUtil.readSecret(
                  settings.secrets,
                  "serviceAccountJson",
                ),
                impersonatedUserEmail:
                  VideoCallConnectionSettingsUtil.readString(
                    settings.config,
                    "impersonatedUserEmail",
                  ),
                accessType: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "accessType",
                ),
              },
              http,
            ).getAccessToken();

        return await GoogleMeetTranscriptClient.readTranscript({
          http,
          accessToken,
          spaceName: meetingId,
          isSignIn,
          ownerLabel: connection.connectedAccount || undefined,
        });
      }

      if (settings.provider === VideoCallProvider.MicrosoftTeams) {
        const accessToken: string = isSignIn
          ? (
              await VideoCallTranscriptReader.getSignInToken({
                connection,
                http,
              })
            ).accessToken
          : await new MicrosoftTeamsMeetingClient(
              {
                tenantId: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "tenantId",
                ),
                clientId: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "clientId",
                ),
                clientSecret: VideoCallConnectionSettingsUtil.readSecret(
                  settings.secrets,
                  "clientSecret",
                ),
                organizerUserId: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "organizerUserId",
                ),
                lobbyBypass: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "lobbyBypass",
                ),
              },
              http,
            ).getAccessToken();

        const grantedScope: JSONValue | undefined = settings.secrets["scope"];

        return await MicrosoftTeamsTranscriptClient.readTranscript({
          http,
          accessToken,
          organizer: isSignIn
            ? {
                path: "/me",
                label:
                  connection.connectedAccount || "the Microsoft Teams account",
                isSignIn: true,
              }
            : MicrosoftTeamsMeetingClient.getAppOrganizer({
                organizerUserId: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "organizerUserId",
                ),
                clientId: VideoCallConnectionSettingsUtil.readString(
                  settings.config,
                  "clientId",
                ),
              }),
          meetingId,
          grantedScope:
            isSignIn && typeof grantedScope === "string"
              ? grantedScope
              : undefined,
          callStartedAt: call.startedAt,
        });
      }
    } catch (error) {
      /*
       * A provider that does not answer, or answers with a 5xx or a rate
       * limit, is no answer about the transcript: that is an error.
       */
      if (error instanceof APIException) {
        throw error;
      }

      // Everything else is the connection's sign-in or credentials failing.
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.ConnectionProblem,
        VideoCallConnectionServiceType.getErrorMessage(error),
      );
    }

    return VideoCallTranscriptReader.getNotSupported(call.provider);
  }

  public static getNotSupported(
    provider: VideoCallProvider | undefined,
  ): VideoCallTranscriptRead {
    switch (provider) {
      case VideoCallProvider.MicrosoftTeams:
        return transcriptUnavailable(
          VideoCallTranscriptUnavailableReason.NotSupported,
          "Microsoft Teams lets apps read the transcripts only of meetings on a calendar, and OneUptime started this one without putting it on its organizer's calendar. In Teams, open the meeting's Recap, download the transcript as a .vtt file, and add it here.",
        );
      case VideoCallProvider.SlackHuddle:
        return transcriptUnavailable(
          VideoCallTranscriptUnavailableReason.NotSupported,
          "Slack has no way for apps to read a huddle's transcript. Copy it from the huddle's notes in Slack and add it here.",
        );
      default:
        return transcriptUnavailable(
          VideoCallTranscriptUnavailableReason.NotSupported,
          "OneUptime did not start this meeting, so it cannot ask the provider for its transcript. Add the transcript yourself.",
        );
    }
  }

  private static async getSignInToken(data: {
    connection: VideoCallConnection;
    http: VideoCallHttpClient;
  }): Promise<VideoCallOAuthAccessToken> {
    const access: ReturnType<typeof VideoCallConnectionService.getOAuthAccess> =
      VideoCallConnectionService.getOAuthAccess({
        connection: data.connection,
        http: data.http,
      });

    if (!access) {
      throw new Error(
        "This connection has no sign-in to read transcripts with. Reconnect it in Project Settings > Workspace > Video Calls.",
      );
    }

    return await access.getAccessToken();
  }

  private static async getZoomSignInToken(data: {
    connection: VideoCallConnection;
    http: VideoCallHttpClient;
  }): Promise<ZoomAccessToken> {
    const token: VideoCallOAuthAccessToken =
      await VideoCallTranscriptReader.getSignInToken(data);

    return {
      accessToken: token.accessToken,
      apiBaseUrl: ZoomMeetingClient.getApiBaseUrl(token.apiBaseUrl),
    };
  }
}
