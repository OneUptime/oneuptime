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
  ): string {
    return tenantId.toString() + "-" + modelName + "-" + eventType;
  }
}
