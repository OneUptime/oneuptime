import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import BaseModel from "Common/Models/BaseModel";
import AnalyticsQuery from "./AnalyticsModelAPI/Query";
import Query from "./ModelAPI/Query";
import { EventName, ListenToModelEventJSON, ModelEventType } from "Common/Utils/Realtime";
import ObjectID from "Common/Types/ObjectID";
import SocketIO, { Socket } from "socket.io-client";
import { REALTIME_URL } from "../Config";
import URL from "Common/Types/API/URL";
import JSONFunctions from "Common/Types/JSONFunctions";
import DatabaseType from "Common/Types/BaseDatabase/DatabaseType";

export interface ListenToAnalyticsModelEvent<Model extends AnalyticsBaseModel> {
    modelType: { new(): Model },
    query: AnalyticsQuery<Model>,
    eventType: ModelEventType,
    tenantId: ObjectID
}

export interface ListenToModelEvent<Model extends BaseModel> {
    modelType: { new(): Model },
    query: Query<Model>,
    tenantId: ObjectID
    eventType: ModelEventType,
}

export default class Reatime {

    private socket!: Socket;

    public constructor(){
        const socket: Socket = SocketIO(URL.fromString(REALTIME_URL.toString()).addRoute("/socket.io").toString());
        this.socket = socket;
    }

    public listenToModelEvent<Model extends BaseModel>(listenToModelEvent: ListenToModelEvent<Model>) {
        // conver this to json and send it to the server. 

        const listenToModelEventJSON: ListenToModelEventJSON = {
            eventType: listenToModelEvent.eventType,
            modelType: DatabaseType.Database,
            modelName: listenToModelEvent.modelType.name,
            query: JSONFunctions.serialize(listenToModelEvent.query),
            tenantId: listenToModelEvent.tenantId.toString()
        }

        this.socket.emit(EventName.ListenToModalEvent, listenToModelEventJSON);
    }

    public listenToAnalyticsModelEvent<Model extends AnalyticsBaseModel>(listenToModelEvent: ListenToAnalyticsModelEvent<Model>) {

        const listenToModelEventJSON: ListenToModelEventJSON = {
            eventType: listenToModelEvent.eventType,
            modelType: DatabaseType.AnalyticsDatabase,
            modelName: listenToModelEvent.modelType.name,
            query: JSONFunctions.serialize(listenToModelEvent.query),
            tenantId: listenToModelEvent.tenantId.toString()
        }

        this.socket.emit(EventName.ListenToModalEvent, listenToModelEventJSON);

    }
}