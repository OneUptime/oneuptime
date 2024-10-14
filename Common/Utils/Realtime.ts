import ObjectID from "../Types/ObjectID";
import ModelEventType from "../Types/Realtime/ModelEventType";

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
