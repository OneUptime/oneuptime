import DatabaseType from "../Types/BaseDatabase/DatabaseType";
import ObjectID from "../Types/ObjectID";

export enum EventName {
  ListenToModalEvent = "ListenToModelEvent",
}

export enum ModelEventType {
  Create = "Create",
  Update = "Update",
  Delete = "Delete",
}

export interface ListenToModelEventJSON {
  modelName: string;
  modelType: DatabaseType;
  eventType: ModelEventType;
  tenantId: string;
  modelId?: string | undefined;
}

export interface EnableRealtimeEventsOn {
  create?: boolean | undefined;
  update?: boolean | undefined;
  delete?: boolean | undefined;
}

export default class RealtimeUtil {
  public static getRoomId(
    tenantId: string | ObjectID,
    modelName: string,
    eventType: ModelEventType,
    modelId?: string | ObjectID,
  ): string {
    const roomId: string =
      tenantId.toString() + "-" + modelName + "-" + eventType;

    if (modelId) {
      return roomId + "-" + modelId;
    }

    return roomId;
  }
}
