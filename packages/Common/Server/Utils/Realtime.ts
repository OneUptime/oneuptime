import IO, { Socket, SocketServer } from "../Infrastructure/SocketIO";
import logger, { LogAttributes } from "./Logger";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseType from "../../Types/BaseDatabase/DatabaseType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import RealtimeUtil from "../../Utils/Realtime";
import JSONWebTokenData from "../../Types/JsonWebTokenData";
import JSONWebToken from "./JsonWebToken";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import { getModelTypeByName } from "../../Models/DatabaseModels/Index";
import { getModelTypeByName as getAnalyticsModelTypeByname } from "../../Models/AnalyticsModels/Index";
import ModelPermission from "../../Types/BaseDatabase/ModelPermission";
import ModelEventType from "../../Types/Realtime/ModelEventType";
import ListenToModelEventJSON from "../../Types/Realtime/ListenToModelEventJSON";
import EventName from "../../Types/Realtime/EventName";
import CookieUtil from "./Cookie";
import Dictionary from "../../Types/Dictionary";
import UserPermissionUtil from "./UserPermission/UserPermission";
import CaptureSpan from "./Telemetry/CaptureSpan";

// What became of one ListenToModelEvent request.
export enum ListenToModelEventOutcome {
  Joined = "Joined",
  // No access token, or one that no longer decodes. The client was told.
  AuthenticationRequired = "AuthenticationRequired",
  // A valid session without access to this tenant or model.
  NotAuthorized = "NotAuthorized",
  // The request itself was malformed.
  InvalidRequest = "InvalidRequest",
  // Something failed while authorizing (for example the permission cache).
  Failed = "Failed",
}

export default abstract class Realtime {
  private static socketServer: SocketServer | null = null;

  @CaptureSpan()
  public static isInitialized(): boolean {
    logger.debug("Checking if socket server is initialized");
    const isInitialized: boolean = this.socketServer !== null;
    logger.debug(`Socket server is initialized: ${isInitialized}`);
    return isInitialized;
  }

  @CaptureSpan()
  public static async init(): Promise<SocketServer | null> {
    if (!this.socketServer) {
      logger.debug("Initializing socket server");
      this.socketServer = IO.getSocketServer();
      logger.debug("Realtime socket server initialized");

      this.socketServer!.on("connection", (socket: Socket) => {
        logger.debug("New socket connection established");

        /*
         * socket.io calls a listener and throws away what it returns. An async
         * listener that throws is therefore an unhandled rejection: nothing
         * goes back to the client, and the subscription it asked for simply
         * never happens. handleListenToModelEventRequest settles every outcome
         * itself; the catch is a backstop, not the error handling.
         */
        socket.on(EventName.ListenToModalEvent, (data: JSONObject): void => {
          Realtime.handleListenToModelEventRequest(socket, data).catch(
            (err: unknown) => {
              logger.error(err);
            },
          );
        });
      });
    }

    return this.socketServer;
  }

  /*
   * One ListenToModelEvent from a client, start to finish. Never throws: a
   * malformed request, a missing or expired access token, a refused
   * subscription and a failing permission lookup each end here as an outcome,
   * so none of them can become an unhandled rejection in the socket listener.
   */
  @CaptureSpan()
  public static async handleListenToModelEventRequest(
    socket: Socket,
    data: JSONObject,
  ): Promise<ListenToModelEventOutcome> {
    logger.debug("Received ListenToModalEvent with data:");
    logger.debug(data);

    let request: ListenToModelEventJSON;

    try {
      request = Realtime.parseListenToModelEventRequest(data);
    } catch (err) {
      logger.error(err);
      return ListenToModelEventOutcome.InvalidRequest;
    }

    try {
      return await Realtime.listenToModelEvent(socket, request);
    } catch (err) {
      // A permission-cache (Redis) failure, say. The room is not joined.
      const failureLogAttributes: LogAttributes = {
        projectId: request.tenantId,
      };

      logger.error(err, failureLogAttributes);
      return ListenToModelEventOutcome.Failed;
    }
  }

  private static parseListenToModelEventRequest(
    data: JSONObject,
  ): ListenToModelEventJSON {
    if (!data || typeof data !== "object") {
      logger.error("ListenToModelEvent data is not an object");
      throw new BadDataException("ListenToModelEvent data is not an object");
    }

    const socketLogAttributes: LogAttributes = {
      projectId: data["tenantId"]?.toString(),
    };

    if (typeof data["eventType"] !== "string") {
      logger.error("eventType is not a string", socketLogAttributes);
      throw new BadDataException("eventType is not a string");
    }
    if (typeof data["modelType"] !== "string") {
      logger.error("modelType is not a string", socketLogAttributes);
      throw new BadDataException("modelType is not a string");
    }
    if (typeof data["modelName"] !== "string") {
      logger.error("modelName is not a string", socketLogAttributes);
      throw new BadDataException("modelName is not a string");
    }
    if (typeof data["tenantId"] !== "string") {
      logger.error("tenantId is not a string", socketLogAttributes);
      throw new BadDataException("tenantId is not a string");
    }

    return {
      eventType: data["eventType"] as ModelEventType,
      modelType: data["modelType"] as DatabaseType,
      modelName: data["modelName"] as string,
      tenantId: data["tenantId"] as string,
    };
  }

  /*
   * The socket has no usable user session: tell the client, which refreshes
   * its session and reconnects so the new handshake carries the new cookie.
   * Dropping the request silently is what used to happen, and it left every
   * subscription made after the access token expired dead (no live counters
   * after switching project, no live logs) with nothing in the browser to
   * show why.
   */
  private static rejectForMissingAuthentication(
    socket: Socket,
    data: ListenToModelEventJSON,
    reason: string,
    listenLogAttributes: LogAttributes,
  ): ListenToModelEventOutcome {
    logger.debug(
      `${reason}, aborting joining room and asking the client to re-authenticate`,
      listenLogAttributes,
    );

    socket.emit(EventName.AuthenticationRequired, data);

    return ListenToModelEventOutcome.AuthenticationRequired;
  }

  @CaptureSpan()
  public static async listenToModelEvent(
    socket: Socket,
    data: ListenToModelEventJSON,
  ): Promise<ListenToModelEventOutcome> {
    const listenLogAttributes: LogAttributes = {
      projectId: data.tenantId?.toString(),
    };

    logger.debug("Listening to model event with data:", listenLogAttributes);
    logger.debug(data, listenLogAttributes);

    if (!this.socketServer) {
      logger.debug(
        "Socket server not initialized, initializing now",
        listenLogAttributes,
      );
      await this.init();
    }

    /*
     * before joining room check the user token and check if the user has access to this tenant
     * and to this model and to this event type
     */

    logger.debug(
      "Extracting user access token from socket",
      listenLogAttributes,
    );
    const userAccessToken: string | undefined =
      this.getAccessTokenFromSocket(socket);

    if (!userAccessToken) {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "User access token not found in socket",
        listenLogAttributes,
      );
    }

    logger.debug("Decoding user access token", listenLogAttributes);

    /*
     * The token is the one the browser sent with the handshake, and it is not
     * re-read for the life of the connection. Once it expires every decode
     * throws, which is the normal state of a dashboard tab left open past the
     * access token's lifetime, not an error in the request.
     */
    let userAuthorizationData: JSONWebTokenData;

    try {
      userAuthorizationData = JSONWebToken.decode(userAccessToken);
    } catch {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "User access token in socket is invalid or expired",
        listenLogAttributes,
      );
    }

    if (!userAuthorizationData) {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "User authorization data not found in socket",
        listenLogAttributes,
      );
    }

    if (!userAuthorizationData.userId) {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "User ID not found in socket",
        listenLogAttributes,
      );
    }

    logger.debug("Checking user access permissions", listenLogAttributes);
    let hasAccess: boolean = false;

    if (userAuthorizationData.isMasterAdmin) {
      logger.debug(
        "User is a master admin, granting access",
        listenLogAttributes,
      );
      hasAccess = true;
    }

    logger.debug(
      "Fetching user global access permissions",
      listenLogAttributes,
    );
    const userGlobalAccessPermission: UserGlobalAccessPermission | null =
      await UserPermissionUtil.getUserGlobalAccessPermissionFromCache(
        userAuthorizationData.userId,
      );

    // check if the user has access to this tenant
    if (userGlobalAccessPermission && !hasAccess) {
      logger.debug(
        "Checking if user has access to the tenant",
        listenLogAttributes,
      );
      const hasAccessToProjectId: boolean =
        userGlobalAccessPermission.projectIds.some((projectId: ObjectID) => {
          return projectId.toString() === data.tenantId.toString();
        });

      if (!hasAccessToProjectId) {
        logger.debug(
          "User does not have access to this tenant, aborting joining room",
          listenLogAttributes,
        );
        return ListenToModelEventOutcome.NotAuthorized;
      }

      logger.debug(
        "User has access to the tenant, checking model access",
        listenLogAttributes,
      );
      const userId: ObjectID = new ObjectID(
        userAuthorizationData.userId.toString(),
      );
      const projectId: ObjectID = new ObjectID(data.tenantId.toString());

      // if it has the access to the tenant, check if it has access to the model
      const userTenantAccessPermission: UserTenantAccessPermission | null =
        await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
          userId,
          projectId,
        );

      // check if the user has access to this model
      if (
        userTenantAccessPermission &&
        this.hasPermissionsByModelName(
          userTenantAccessPermission,
          data.modelName,
        )
      ) {
        logger.debug(
          "User has access to the model, granting access",
          listenLogAttributes,
        );
        hasAccess = true;
      }
    }

    /*
     * Authenticated but not allowed. The room is not joined and, as before,
     * nothing is sent back: a fresh session would not change the answer.
     */
    if (!hasAccess) {
      logger.debug(
        "User does not have access to this tenant, aborting joining room",
        listenLogAttributes,
      );
      return ListenToModelEventOutcome.NotAuthorized;
    }

    if (data.modelId) {
      const modelRoomId: string = RealtimeUtil.getRoomId(
        data.tenantId,
        data.modelName,
        ModelEventType.Create,
        data.modelId,
      );

      logger.debug(`Joining room with ID: ${modelRoomId}`, listenLogAttributes);
      // join the room.
      await socket.join(modelRoomId);
    } else {
      const roomId: string = RealtimeUtil.getRoomId(
        data.tenantId,
        data.modelName,
        data.eventType,
      );

      logger.debug(`Joining room with ID: ${roomId}`, listenLogAttributes);
      // join the room.
      await socket.join(roomId);
    }

    return ListenToModelEventOutcome.Joined;
  }

  @CaptureSpan()
  public static async stopListeningToModelEvent(
    socket: Socket,
    data: ListenToModelEventJSON,
  ): Promise<void> {
    const stopLogAttributes: LogAttributes = {
      projectId: data.tenantId?.toString(),
    };

    logger.debug(
      "Stopping listening to model event with data:",
      stopLogAttributes,
    );
    logger.debug(data, stopLogAttributes);

    if (!this.socketServer) {
      logger.debug(
        "Socket server not initialized, initializing now",
        stopLogAttributes,
      );
      await this.init();
    }

    const roomId: string = RealtimeUtil.getRoomId(
      data.tenantId,
      data.modelName,
      data.eventType,
      data.modelId,
    );

    logger.debug(`Leaving room with ID: ${roomId}`, stopLogAttributes);
    // leave this room.
    await socket.leave(roomId);
  }

  @CaptureSpan()
  public static async emitModelEvent(data: {
    tenantId: string | ObjectID;
    eventType: ModelEventType;
    modelId: ObjectID;
    modelType: { new (): BaseModel | AnalyticsBaseModel };
  }): Promise<void> {
    const emitLogAttributes: LogAttributes = {
      projectId: data.tenantId?.toString(),
    };

    logger.debug("Emitting model event with data:", emitLogAttributes);
    logger.debug(`Tenant ID: ${data.tenantId}`, emitLogAttributes);
    logger.debug(`Event Type: ${data.eventType}`, emitLogAttributes);
    logger.debug(`Model ID: ${data.modelId}`, emitLogAttributes);

    if (!this.socketServer) {
      logger.debug(
        "Socket server not initialized, initializing now",
        emitLogAttributes,
      );
      await this.init();
    }

    const jsonObject: JSONObject = {
      modelId: data.modelId.toString(),
    };

    const model: BaseModel | AnalyticsBaseModel = new data.modelType();

    if (!model.tableName) {
      logger.warn(
        "Model does not have a tableName, aborting emit",
        emitLogAttributes,
      );
      return;
    }

    const roomId: string = RealtimeUtil.getRoomId(
      data.tenantId,
      model.tableName!,
      data.eventType,
    );

    const modelRoomId: string = RealtimeUtil.getRoomId(
      data.tenantId,
      model.tableName!,
      ModelEventType.Create,
      data.modelId,
    );

    logger.debug(
      `Emitting event to room with ID: ${roomId}`,
      emitLogAttributes,
    );
    logger.debug(jsonObject, emitLogAttributes);

    this.socketServer!.to(roomId).emit(roomId, jsonObject);
    this.socketServer!.to(modelRoomId).emit(modelRoomId, jsonObject);
  }

  @CaptureSpan()
  public static hasPermissionsByModelName(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    modelName: string,
  ): boolean {
    let modelPermissions: Array<Permission> = [];

    let modelType:
      | { new (): BaseModel }
      | { new (): AnalyticsBaseModel }
      | null = getModelTypeByName(modelName);

    if (!modelType) {
      // check if it is an analytics model
      modelType = getAnalyticsModelTypeByname(modelName);

      if (!modelType) {
        return false;
      }
    }

    modelPermissions = new modelType().getReadPermissions();

    return ModelPermission.hasPermissions(
      userProjectPermissions,
      modelPermissions,
    );
  }

  @CaptureSpan()
  public static getAccessTokenFromSocket(socket: Socket): string | undefined {
    let accessToken: string | undefined = undefined;

    if (socket.handshake.headers.cookie) {
      const cookies: Dictionary<string> = CookieUtil.getCookiesFromCookieString(
        socket.handshake.headers.cookie,
      );

      if (cookies[CookieUtil.getUserTokenKey()]) {
        accessToken = cookies[CookieUtil.getUserTokenKey()];
      }
    }

    return accessToken;
  }
}
