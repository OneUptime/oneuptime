import IO, { Socket, SocketServer } from "../Infrastructure/SocketIO";
import logger from "./Logger";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseType from "Common/Types/BaseDatabase/DatabaseType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RealtimeUtil, {
  EventName,
  ListenToModelEventJSON,
  ModelEventType,
} from "Common/Utils/Realtime";

export default abstract class Realtime {
  private static socketServer: SocketServer | null = null;

  public static isInitialized(): boolean {
    logger.debug("Checking if socket server is initialized");
    const isInitialized: boolean = this.socketServer !== null;
    logger.debug(`Socket server is initialized: ${isInitialized}`);
    return isInitialized;
  }

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

          // TODO: validate if this socket has access to this tenant

          // TODO: validate if this socket has access to this model

          // TODO: validate if this socket has access to this event type

          // TODO: validate if this socket has access to this query

          // TODO: validate if this socket has access to this select

          // validate data

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

    const roomId: string = RealtimeUtil.getRoomId(
      data.tenantId,
      data.modelName,
      data.eventType,
    );

    logger.debug(`Joining room with ID: ${roomId}`);
    // join the room.
    await socket.join(roomId);
  }

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
    );
    logger.debug(`Leaving room with ID: ${roomId}`);
    // leave this room.
    await socket.leave(roomId);
  }

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

    logger.debug(`Emitting event to room with ID: ${roomId}`);
    logger.debug(jsonObject);
    this.socketServer!.to(roomId).emit(roomId, jsonObject);
  }
}
