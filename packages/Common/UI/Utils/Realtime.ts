import { HOST, HTTP_PROTOCOL } from "../Config";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { RealtimeRoute } from "../../ServiceRoute";
import URL from "../../Types/API/URL";
import DatabaseType from "../../Types/BaseDatabase/DatabaseType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import RealtimeUtil from "../../Utils/Realtime";
import SocketIO, { Socket } from "socket.io-client";
import ModelEventType from "../../Types/Realtime/ModelEventType";
import ListenToModelEventJSON from "../../Types/Realtime/ListenToModelEventJSON";
import EventName from "../../Types/Realtime/EventName";

export interface ListenToModelEvent<
  Model extends AnalyticsBaseModel | BaseModel,
> {
  modelType: { new (): Model };
  eventType: ModelEventType;
  tenantId: ObjectID;
  modelId?: ObjectID | undefined;
}

export default abstract class Realtime {
  private static socket: Socket;

  public static init(): void {
    const socket: Socket = SocketIO(new URL(HTTP_PROTOCOL, HOST).toString(), {
      path: RealtimeRoute.toString(),
    });

    this.socket = socket;
  }

  public static listenToModelEvent<Model extends BaseModel>(
    listenToModelEvent: ListenToModelEvent<Model>,
    onEvent: (modelId: ObjectID) => void,
  ): () => void {
    // conver this to json and send it to the server.

    if (!this.socket) {
      this.init();
    }

    if (!listenToModelEvent.tenantId) {
      return (): void => {
        // Do nothing.
      };
    }

    const listenToModelEventJSON: ListenToModelEventJSON = {
      eventType: listenToModelEvent.eventType,
      modelType: DatabaseType.Database,
      modelName: listenToModelEvent.modelType.name,
      tenantId: listenToModelEvent.tenantId.toString(),
    };

    this.emit(EventName.ListenToModalEvent, listenToModelEventJSON as any);

    const roomId: string = RealtimeUtil.getRoomId(
      listenToModelEvent.tenantId,
      listenToModelEvent.modelType.name,
      listenToModelEvent.eventType,
    );

    this.socket.on(roomId, (data: JSONObject) => {
      const id: ObjectID = ObjectID.fromString(
        data["modelId"]?.toString() as string,
      );
      onEvent(id);
    });

    // Stop listening to the event.
    const stopListening: () => void = (): void => {
      this.socket.off(roomId);
    };

    return stopListening;
  }

  public static listenToAnalyticsModelEvent<Model extends AnalyticsBaseModel>(
    listenToModelEvent: ListenToModelEvent<Model>,
    onEvent: (model: Model) => void,
  ): () => void {
    if (!this.socket) {
      this.init();
    }

    const listenToModelEventJSON: ListenToModelEventJSON = {
      eventType: listenToModelEvent.eventType,
      modelType: DatabaseType.AnalyticsDatabase,
      modelName: listenToModelEvent.modelType.name,
      tenantId: listenToModelEvent.tenantId.toString(),
    };

    this.emit(EventName.ListenToModalEvent, listenToModelEventJSON as any);

    let roomId: string = RealtimeUtil.getRoomId(
      listenToModelEvent.tenantId,
      listenToModelEvent.modelType.name,
      listenToModelEvent.eventType,
    );

    if (listenToModelEvent.modelId) {
      roomId = RealtimeUtil.getRoomId(
        listenToModelEvent.tenantId,
        listenToModelEvent.modelType.name,
        listenToModelEvent.eventType,
        listenToModelEvent.modelId,
      );
    }

    this.socket.on(roomId, (model: JSONObject) => {
      onEvent(
        AnalyticsBaseModel.fromJSON(
          model,
          listenToModelEvent.modelType,
        ) as Model,
      );
    });

    // Stop listening to the event.
    const stopListening: () => void = (): void => {
      this.socket.off(roomId);
    };

    return stopListening;
  }

  public static emit(eventName: string, data: JSONObject): void {
    if (!this.socket) {
      this.init();
    }

    this.socket.emit(eventName, data);
  }
}
