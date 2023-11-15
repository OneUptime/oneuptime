import DatabaseType from "../Types/BaseDatabase/DatabaseType";
import { JSONObject } from "../Types/JSON";

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
    query: JSONObject;
    eventType: ModelEventType;
    tenantId: string;
}