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

  /*
   * A record's own room: where a page that shows one record (a task's
   * conversation, say) hears about that record alone - every change of it,
   * created, changed or deleted - rather than about every record of its
   * model in the project. The server sends each event of a record to it
   * (Realtime.deliver), to the listeners who may read the record; the name
   * has always carried Create, whatever the kind of change. The id is read
   * in lower case, as records' ids are written, so a page that asked in
   * capitals still hears its record.
   */
  public static getRecordRoomId(
    tenantId: string | ObjectID,
    modelName: string,
    modelId: string | ObjectID,
  ): string {
    return RealtimeUtil.getRoomId(
      tenantId,
      modelName,
      ModelEventType.Create,
      modelId.toString().toLowerCase(),
    );
  }
}
