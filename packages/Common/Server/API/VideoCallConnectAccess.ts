import VideoCallConnectionService from "../Services/VideoCallConnectionService";
import { ExpressRequest } from "../Utils/Express";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { VideoCallOAuthApp } from "../Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallOAuthApps from "../Utils/VideoCall/OAuth/VideoCallOAuthApps";
import { WorkspaceOAuthStateRecord } from "../Utils/Workspace/WorkspaceOAuthState";
import CommonAPI from "./CommonAPI";
import WorkspaceOAuthCallbackAccess from "./WorkspaceOAuthCallbackAccess";
import VideoCallConnection from "../../Models/DatabaseModels/VideoCallConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { isVideoCallOAuth } from "../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "../../Types/VideoCall/VideoCallProvider";

/*
 * Who may connect a video call provider to a project by signing in, or sign
 * one of its connections in again.
 *
 * Connecting writes a connection - and the sign-in every call is started
 * with - as OneUptime, not as the person connecting. So it asks what
 * creating that connection through the API would ask: a signed-in member of
 * the project, as a person (an API key never signs in to Zoom), with a
 * credential that may make changes, holding one of the connection's create
 * permissions with no team block on them (CommonAPI.assertCanCreateTable).
 * Reconnecting a connection asks its edit permissions instead, of a
 * connection the caller can read.
 *
 * It is asked twice: when the connection starts, of the signed-in caller,
 * before a state is issued (assertMayStart); and when the provider sends the
 * browser back, of the person the one-use state names, as they are now
 * (assertMayFinish), before anything is written.
 */

export const VIDEO_CALL_CONNECT_PERMISSION_MESSAGE: string =
  "You do not have permission to connect video call providers in this project.";

// The query parameter that names a connection to sign in again.
export const VIDEO_CALL_RECONNECT_QUERY_PARAM: string = "connectionId";

// Who is connecting and what, once the rule has let them.
export interface VideoCallConnectStart {
  projectId: ObjectID;
  userId: ObjectID;
  app: VideoCallOAuthApp;
  // For the state: the connection to sign in again, when it is a reconnect.
  payload?: JSONObject | undefined;
}

export default class VideoCallConnectAccess {
  @CaptureSpan()
  public static async assertMayStart(data: {
    req: ExpressRequest;
    provider: VideoCallProvider;
  }): Promise<VideoCallConnectStart> {
    const props: DatabaseCommonInteractionProps = {
      ...(await CommonAPI.getDatabaseCommonInteractionProps(data.req)),
      isMultiTenantRequest: false,
    };

    const projectId: ObjectID = VideoCallConnectAccess.withOneMessage(() => {
      return CommonAPI.assertAuthenticatedProjectMember(props);
    });

    VideoCallConnectAccess.withOneMessage(() => {
      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);
    });

    const reconnectId: ObjectID | null =
      VideoCallConnectAccess.readConnectionId(
        data.req.query[VIDEO_CALL_RECONNECT_QUERY_PARAM],
      );

    VideoCallConnectAccess.assertMayConnect({
      props,
      isReconnect: Boolean(reconnectId),
    });

    if (reconnectId) {
      // A connection of this project the caller can read, made by signing in to this provider.
      const connection: VideoCallConnection | null =
        await VideoCallConnectionService.findOneBy({
          query: { _id: reconnectId, projectId },
          select: {
            _id: true,
            projectId: true,
            provider: true,
            authMethod: true,
          },
          props,
        });

      if (
        !connection ||
        connection.provider !== data.provider ||
        !isVideoCallOAuth(connection.authMethod)
      ) {
        throw new BadDataException(
          `No ${getVideoCallProviderDisplayName(data.provider)} connection made by signing in has this ID in the project.`,
        );
      }
    }

    // Asked last, so nobody who may not connect learns how the server is set up.
    const app: VideoCallOAuthApp = VideoCallOAuthApps.getOrThrow(data.provider);

    return {
      projectId,
      userId: props.userId!,
      app,
      payload: reconnectId
        ? { connectionId: reconnectId.toString() }
        : undefined,
    };
  }

  @CaptureSpan()
  public static async assertMayFinish(
    record: WorkspaceOAuthStateRecord,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await WorkspaceOAuthCallbackAccess.getStartedByProps({
        record,
        errorMessage: VIDEO_CALL_CONNECT_PERMISSION_MESSAGE,
      });

    VideoCallConnectAccess.assertMayConnect({
      props,
      isReconnect: Boolean(VideoCallConnectAccess.getReconnectId(record)),
    });
  }

  // The connection a state was started to sign in again, if any.
  public static getReconnectId(
    record: WorkspaceOAuthStateRecord,
  ): ObjectID | null {
    return VideoCallConnectAccess.readConnectionId(
      record.payload?.["connectionId"],
    );
  }

  private static readConnectionId(value: unknown): ObjectID | null {
    const text: string = typeof value === "string" ? value.trim() : "";

    if (!text) {
      return null;
    }

    if (!ObjectID.isValidUUID(text)) {
      throw new BadDataException("A valid connection ID is required.");
    }

    return new ObjectID(text);
  }

  private static assertMayConnect(data: {
    props: DatabaseCommonInteractionProps;
    isReconnect: boolean;
  }): void {
    VideoCallConnectAccess.withOneMessage(() => {
      if (data.isReconnect) {
        CommonAPI.assertPermittedInProject({
          databaseProps: data.props,
          allowedPermissions: new VideoCallConnection().getUpdatePermissions(),
          errorMessage: VIDEO_CALL_CONNECT_PERMISSION_MESSAGE,
        });
        return;
      }

      CommonAPI.assertCanCreateTable({
        modelType: VideoCallConnection,
        props: data.props,
        errorMessage: VIDEO_CALL_CONNECT_PERMISSION_MESSAGE,
      });
    });
  }

  /*
   * Runs a check and answers any authorization refusal it makes with the
   * one sentence, so nobody is told which of the reasons applied. A missing
   * session (401) passes through as it is.
   */
  private static withOneMessage<T>(check: () => T): T {
    try {
      return check();
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(VIDEO_CALL_CONNECT_PERMISSION_MESSAGE);
      }

      throw err;
    }
  }
}
