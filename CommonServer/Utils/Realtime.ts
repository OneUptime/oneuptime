import { JSONObject } from "Common/Types/JSON";
import io from "../Infrastructure/SocketIO";
import { EventName, ListenToModelEventJSON, ModelEventType } from 'Common/Utils/Realtime';
import { Socket } from "socket.io";
import DatabaseType from "Common/Types/BaseDatabase/DatabaseType";
import JSONFunctions from "Common/Types/JSONFunctions";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/BaseModel";
import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";


export default class Realtime {

    public static getRoomId(tenantId: string | ObjectID, modelName: string, eventType: ModelEventType): string {
        return tenantId.toString() + '-' + modelName + '-' + eventType;
    }

    public static async listenToModelEvent(socket: Socket, data: ListenToModelEventJSON): Promise<void> {
        // join the room. 
        socket.join(this.getRoomId(data.tenantId, data.modelName, data.eventType));
    }

    public static stopListeningToModelEvent(socket: Socket, data: ListenToModelEventJSON): void {
        // leave this room.
        socket.leave(this.getRoomId(data.tenantId, data.modelName, data.eventType));
    }

    public static emitModelEvent(data: { tenantId: string | ObjectID, eventType: ModelEventType, model: BaseModel | AnalyticsBaseModel, modelType: { new(): BaseModel | AnalyticsBaseModel } }): void {

        let jsonObject: JSONObject = {};

        if (data.model instanceof BaseModel) {
            jsonObject = BaseModel.toJSON(data.model, data.modelType as { new(): BaseModel });
        }

        if (data.model instanceof AnalyticsBaseModel) {
            jsonObject = AnalyticsBaseModel.toJSON(data.model, data.modelType as { new(): AnalyticsBaseModel });
        }

        io.to(this.getRoomId(data.tenantId, data.model.tableName!, data.eventType)).emit(this.getRoomId(data.tenantId, data.model.tableName!, data.eventType), jsonObject);
    }
}

io.on('connection', (socket) => {
    socket.on(EventName.ListenToModalEvent, async (data: JSONObject) => {

        // TODO: validate if this soocket has access to this tenant

        // TODO: validate if this socket has access to this model

        // TODO: validate if this socket has access to this event type

        // TODO: validate if this socket has access to this query

        // TODO: validate if this socket has access to this select

        // validate data

        if (typeof data['eventType'] !== 'string') throw new BadDataException('eventType is not a string');
        if (typeof data['modelType'] !== 'string') throw new BadDataException('modelType is not a string');
        if (typeof data['modelName'] !== 'string') throw new BadDataException('modelName is not a string');
        if (typeof data['query'] !== 'object') throw new BadDataException('query is not an object');
        if (typeof data['tenantId'] !== 'string') throw new BadDataException('tenantId is not a string');
        if (typeof data['select'] !== 'object') throw new BadDataException('select is not an object');

        Realtime.listenToModelEvent(socket, {
            eventType: data['eventType'] as ModelEventType,
            modelType: data['modelType'] as DatabaseType,
            modelName: data['modelName'] as string,
            query: JSONFunctions.deserialize(
                data['query'] as JSONObject,
            ),
            tenantId: data['tenantId'] as string,
            select: JSONFunctions.deserialize(
                data['select'] as JSONObject,
            )
        });
    })
});