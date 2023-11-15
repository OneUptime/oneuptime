import DatabaseType from '../Types/BaseDatabase/DatabaseType';
import { JSONObject } from '../Types/JSON';

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

export default interface EnableRealtimeEventsOn {
    create?: boolean | undefined;
    update?: boolean | undefined;
    delete?: boolean | undefined;
    read?: boolean | undefined;
}
