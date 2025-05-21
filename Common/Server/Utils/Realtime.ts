import IO, { Socket, SocketServer } from "../Infrastructure/SocketIO";
import logger from "./Logger";
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

        socket.on(EventName.ListenToModalEvent, async (data: JSONObject) => {
          logger.debug("Received ListenToModalEvent with data:");
          logger.debug(data);

          if (typeof data["eventType"] !== "string") {
            logger.error("eventType is not a string");
            throw new BadDataException("eventType is not a string");
          }
          if (typeof data["modelType"] !== "string") {
            logger.error("modelType is not a string");
            throw new BadDataException("modelType is not a string");
          }
          if (typeof data["modelName"] !== "string") {
            logger.error("modelName is not a string");
            throw new BadDataException("modelName is not a string");
          }
          if (typeof data["tenantId"] !== "string") {
            logger.error("tenantId is not a string");
            throw new BadDataException("tenantId is not a string");
          }

          await Realtime.listenToModelEvent(socket, {
            eventType: data["eventType"] as ModelEventType,
            modelType: data["modelType"] as DatabaseType,
            modelName: data["modelName"] as string,
            tenantId: data["tenantId"] as string,
          });
        });
      });
    }

    return this.socketServer;
  }

  @CaptureSpan()
  public static async listenToModelEvent(
    socket: Socket,
    data: ListenToModelEventJSON,
  ): Promise<void> {
    logger.debug("Listening to model event with data:");
    logger.debug(data);

    if (!this.socketServer) {
      logger.debug("Socket server not initialized, initializing now");
      await this.init();
    }

    // before joining room check the user token and check if the user has access to this tenant
    // and to this model and to this event type

    logger.debug("Extracting user access token from socket");
    const userAccessToken: string | undefined =
      this.getAccessTokenFromSocket(socket);

    if (!userAccessToken) {
      logger.debug(
        "User access token not found in socket, aborting joining room",
      );
      return;
    }

    logger.debug("Decoding user access token");
    const userAuthorizationData: JSONWebTokenData =
      JSONWebToken.decode(userAccessToken);

    if (!userAuthorizationData) {
      logger.debug(
        "User authorization data not found in socket, aborting joining room",
      );
      return;
    }

    if (!userAuthorizationData.userId) {
      logger.debug("User ID not found in socket, aborting joining room");
      return;
    }

    logger.debug("Checking user access permissions");
    let hasAccess: boolean = false;

    if (userAuthorizationData.isMasterAdmin) {
      logger.debug("User is a master admin, granting access");
      hasAccess = true;
    }

    logger.debug("Fetching user global access permissions");
    const userGlobalAccessPermission: UserGlobalAccessPermission | null =
      await UserPermissionUtil.getUserGlobalAccessPermissionFromCache(
        userAuthorizationData.userId,
      );

    // check if the user has access to this tenant
    if (userGlobalAccessPermission && !hasAccess) {
      logger.debug("Checking if user has access to the tenant");
      const hasAccessToProjectId: boolean =
        userGlobalAccessPermission.projectIds.some((projectId: ObjectID) => {
          return projectId.toString() === data.tenantId.toString();
        });

      if (!hasAccessToProjectId) {
        logger.debug(
          "User does not have access to this tenant, aborting joining room",
        );
        return;
      }

      logger.debug("User has access to the tenant, checking model access");
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
        logger.debug("User has access to the model, granting access");
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      logger.debug(
        "User does not have access to this tenant, aborting joining room",
      );
      return;
    }

    if (data.modelId) {
      const modelRoomId: string = RealtimeUtil.getRoomId(
        data.tenantId,
        data.modelName,
        ModelEventType.Create,
        data.modelId,
      );

      logger.debug(`Joining room with ID: ${modelRoomId}`);
      // join the room.
      await socket.join(modelRoomId);
    } else {
      const roomId: string = RealtimeUtil.getRoomId(
        data.tenantId,
        data.modelName,
        data.eventType,
      );

      logger.debug(`Joining room with ID: ${roomId}`);
      // join the room.
      await socket.join(roomId);
    }
  }

  @CaptureSpan()
  public static async stopListeningToModelEvent(
    socket: Socket,
    data: ListenToModelEventJSON,
  ): Promise<void> {
    logger.debug("Stopping listening to model event with data:");
    logger.debug(data);

    if (!this.socketServer) {
      logger.debug("Socket server not initialized, initializing now");
      await this.init();
    }

    const roomId: string = RealtimeUtil.getRoomId(
      data.tenantId,
      data.modelName,
      data.eventType,
      data.modelId,
    );

    logger.debug(`Leaving room with ID: ${roomId}`);
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
    logger.debug("Emitting model event with data:");
    logger.debug(`Tenant ID: ${data.tenantId}`);
    logger.debug(`Event Type: ${data.eventType}`);
    logger.debug(`Model ID: ${data.modelId}`);

    if (!this.socketServer) {
      logger.debug("Socket server not initialized, initializing now");
      await this.init();
    }

    const jsonObject: JSONObject = {
      modelId: data.modelId.toString(),
    };

    const model: BaseModel | AnalyticsBaseModel = new data.modelType();

    if (!model.tableName) {
      logger.warn("Model does not have a tableName, aborting emit");
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

    logger.debug(`Emitting event to room with ID: ${roomId}`);
    logger.debug(jsonObject);

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
