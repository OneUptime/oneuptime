import DatabaseType from '../Types/BaseDatabase/DatabaseType';
import { JSONObject } from '../Types/JSON';
import ObjectID from '../Types/ObjectID';

export enum EventName {
    ListenToModalEvent = 'ListenToModelEvent',
}

export enum ModelEventType {
    Create = 'Create',
    Update = 'Update',
    Delete = 'Delete',
}

export interface ListenToModelEventJSON {
    modelName: string;
    modelType: DatabaseType;
    query: JSONObject;
    eventType: ModelEventType;
    tenantId: string;
    select: JSONObject;
}

export interface EnableRealtimeEventsOn {
    create?: boolean | undefined;
    update?: boolean | undefined;
    delete?: boolean | undefined;
    read?: boolean | undefined;
}

export default class RealtimeUtil {
    public static getRoomId(
        tenantId: string | ObjectID,
        modelName: string,
        eventType: ModelEventType
    ): string {
        return tenantId.toString() + '-' + modelName + '-' + eventType;
    }
}
