import VideoCallConnection from "../../Models/DatabaseModels/VideoCallConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { isVideoCallOAuth } from "../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallMeeting from "../../Types/VideoCall/VideoCallMeeting";
import UserMiddleware from "../Middleware/UserAuthorization";
import VideoCallConnectionService, {
  Service as VideoCallConnectionServiceType,
} from "../Services/VideoCallConnectionService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import VideoCallConnectionSettingsUtil, {
  VideoCallConnectionSettings,
} from "../Utils/VideoCall/VideoCallConnectionSettings";
import VideoCallMeetingFactory from "../Utils/VideoCall/VideoCallMeetingFactory";
import { VideoCallMeetingRequest } from "../Utils/VideoCall/VideoCallMeetingRequest";
import ZoomTranscriptReconnect, {
  ZoomConnectionToReconnect,
} from "../Utils/VideoCall/OAuth/ZoomTranscriptReconnect";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import Permission from "../../Types/Permission";

/*
 * What a test meeting is called at the provider, so whoever finds it in the
 * host's account knows where it came from.
 */
export const TEST_MEETING_REQUEST: VideoCallMeetingRequest = {
  title: "OneUptime test call",
  description:
    "A test meeting OneUptime created to check a video call connection. It is safe to delete.",
};

// The project's Zoom connections to sign in again for call transcripts.
export const ZOOM_TRANSCRIPT_RECONNECT_PATH: string =
  "/zoom-transcript-reconnect";

export default class VideoCallConnectionAPI extends BaseAPI<
  VideoCallConnection,
  VideoCallConnectionServiceType
> {
  public constructor() {
    super(VideoCallConnection, VideoCallConnectionService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    /*
     * Starts a real test meeting, end to end, and answers with its join
     * link - the only check that proves the credentials, the provider-side
     * permission (a Zoom scope, a Google delegation, a Teams access policy)
     * and the host all work together. It sends nobody a message.
     *
     * The body is either
     *   { connectionId, config?, secrets? } - a saved connection, with the
     *     edit form's unsaved values over it by the rule a save applies (a
     *     config replaces the stored one; a secret value replaces, "" keeps,
     *     null removes). The stored secrets are read as root and never
     *     returned. Or
     *   { provider, config, secrets } - settings that were never saved, so
     *     the create form can test before storing anything.
     * Only a saved connection tested exactly as stored records the outcome
     * on the connection: a test of settings that were never saved says
     * nothing about the connection's health.
     *
     * A connection made by signing in is always tested with its own
     * sign-in; the edit form's unsaved settings (who joins without waiting)
     * may go over it, and secrets may not.
     */
    this.router.post(
      `${basePath}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanTest(props);

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          const connectionIdValue: JSONValue | undefined = body["connectionId"];

          let meeting: VideoCallMeeting;

          if (connectionIdValue !== undefined && connectionIdValue !== null) {
            const connectionId: string = String(connectionIdValue);

            if (!ObjectID.isValidUUID(connectionId)) {
              throw new BadDataException("A valid connection ID is required.");
            }

            const accessible: VideoCallConnection | null =
              await this.service.findOneBy({
                query: { _id: connectionId, projectId },
                select: { _id: true, projectId: true },
                props,
              });
            CommonAPI.assertResourceBelongsToProject({
              resourceProjectId: accessible?.projectId,
              projectId,
            });

            const overlays: boolean =
              body["config"] !== undefined || body["secrets"] !== undefined;

            if (!overlays) {
              meeting = (
                await this.service.startMeeting({
                  connectionId: new ObjectID(connectionId),
                  projectId,
                  request: TEST_MEETING_REQUEST,
                })
              ).meeting;
            } else {
              const stored: {
                connection: VideoCallConnection;
                settings: VideoCallConnectionSettings;
              } = await this.service.getSettings({
                connectionId: new ObjectID(connectionId),
                projectId,
              });

              if (isVideoCallOAuth(stored.settings.authMethod)) {
                /*
                 * A connection made by signing in: the edit form's settings
                 * over its sign-in, which no form sends.
                 */
                if (body["secrets"] !== undefined) {
                  throw new BadDataException(
                    "A connection made by signing in is tested with its own sign-in. Send only its configuration.",
                  );
                }

                meeting = await VideoCallMeetingFactory.createMeeting({
                  settings: VideoCallConnectionSettingsUtil.validateOAuth({
                    provider: stored.settings.provider,
                    config:
                      body["config"] !== undefined
                        ? VideoCallConnectionSettingsUtil.parseJsonObject(
                            body["config"],
                            "Configuration",
                          )
                        : stored.settings.config,
                  }),
                  request: TEST_MEETING_REQUEST,
                  oauth: this.service.getOAuthAccess({
                    connection: stored.connection,
                  }),
                });

                return Response.sendJsonObjectResponse(req, res, {
                  provider: meeting.provider,
                  joinUrl: meeting.joinUrl,
                });
              }

              const settings: VideoCallConnectionSettings =
                VideoCallConnectionSettingsUtil.validate({
                  provider: stored.settings.provider,
                  config:
                    body["config"] !== undefined
                      ? VideoCallConnectionSettingsUtil.parseJsonObject(
                          body["config"],
                          "Configuration",
                        )
                      : stored.settings.config,
                  secrets: VideoCallConnectionSettingsUtil.mergeSecrets({
                    definition:
                      VideoCallConnectionSettingsUtil.getDefinitionOrThrow(
                        stored.settings.provider,
                      ),
                    stored: stored.settings.secrets,
                    provided: VideoCallConnectionSettingsUtil.parseJsonObject(
                      body["secrets"],
                      "Credentials",
                    ),
                  }),
                  requireRequiredSecrets: true,
                });

              meeting = await VideoCallMeetingFactory.createMeeting({
                settings,
                request: TEST_MEETING_REQUEST,
              });
            }
          } else {
            const settings: VideoCallConnectionSettings =
              VideoCallConnectionSettingsUtil.validate({
                provider: body["provider"],
                config: VideoCallConnectionSettingsUtil.parseJsonObject(
                  body["config"],
                  "Configuration",
                ),
                secrets: VideoCallConnectionSettingsUtil.parseJsonObject(
                  body["secrets"],
                  "Credentials",
                ),
                requireRequiredSecrets: true,
              });

            meeting = await VideoCallMeetingFactory.createMeeting({
              settings,
              request: TEST_MEETING_REQUEST,
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            provider: meeting.provider,
            joinUrl: meeting.joinUrl,
          });
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * The project's Zoom connections made by signing in before this
     * server's Zoom app could read call transcripts, once it can
     * (ZoomTranscriptReconnect): the Video Calls page asks for each to be
     * reconnected. Read by whoever may read how the project's connections
     * are set up; nothing of the sign-ins themselves is returned.
     */
    this.router.get(
      `${basePath}${ZOOM_TRANSCRIPT_RECONNECT_PATH}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions:
              VideoCallConnectionAPI.getSetupReadPermissions(),
            errorMessage:
              "Only people who can read the project's settings can see which video call connections to reconnect.",
          });

          const connections: Array<ZoomConnectionToReconnect> =
            await ZoomTranscriptReconnect.getConnectionsToReconnect(projectId);

          return Response.sendJsonObjectResponse(req, res, {
            connections: connections.map(
              (connection: ZoomConnectionToReconnect): JSONObject => {
                return {
                  _id: connection.id.toString(),
                  name: connection.name,
                  connectedAccount: connection.connectedAccount || null,
                };
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  /*
   * Who may read how a connection is set up - its configuration - may read
   * which connections to reconnect.
   */
  public static getSetupReadPermissions(): Array<Permission> {
    return (
      new VideoCallConnection().getColumnAccessControlFor("config")?.read || []
    );
  }

  // Whoever may set a connection up may test it.
  private assertCanTest(props: DatabaseCommonInteractionProps): void {
    const model: VideoCallConnection = new VideoCallConnection();

    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: Array.from(
        new Set([
          ...model.getCreatePermissions(),
          ...model.getUpdatePermissions(),
        ]),
      ),
      errorMessage:
        "Project Owners, Project Admins and Settings Admins can test video call connections.",
    });
  }
}
