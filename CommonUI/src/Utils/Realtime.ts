import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import BaseModel from 'Common/Models/BaseModel';
import Query from './BaseDatabase/Query';
import RealtimeUtil, {
    EventName,
    ListenToModelEventJSON,
    ModelEventType,
} from 'Common/Utils/Realtime';
import ObjectID from 'Common/Types/ObjectID';
import SocketIO, { Socket } from 'socket.io-client';
import { HOST, HTTP_PROTOCOL } from '../Config';
import URL from 'Common/Types/API/URL';
import JSONFunctions from 'Common/Types/JSONFunctions';
import DatabaseType from 'Common/Types/BaseDatabase/DatabaseType';
import Select from './BaseDatabase/Select';
import { JSONObject } from 'Common/Types/JSON';
import { RealtimeRoute } from 'Common/ServiceRoute';

export interface ListenToModelEvent<Model extends AnalyticsBaseModel | BaseModel> {
    modelType: { new (): Model };
    query: Query<Model>;
    eventType: ModelEventType;
    tenantId: ObjectID;
    select: Select<Model>;
}


export default abstract class Reatime {
    private static socket: Socket;

    public static init(): void {
        const socket: Socket = SocketIO(
            new URL(HTTP_PROTOCOL, HOST).toString(),
            {
                path: RealtimeRoute.toString(),
            }
        );

        this.socket = socket;
    }

    public static listenToModelEvent<Model extends BaseModel>(
        listenToModelEvent: ListenToModelEvent<Model>,
        onEvent: (model: Model) => void
    ): () => void {
        // conver this to json and send it to the server.

        if (!this.socket) {
            this.init();
        }

        const listenToModelEventJSON: ListenToModelEventJSON = {
            eventType: listenToModelEvent.eventType,
            modelType: DatabaseType.Database,
            modelName: listenToModelEvent.modelType.name,
            query: JSONFunctions.serialize(listenToModelEvent.query),
            tenantId: listenToModelEvent.tenantId.toString(),
            select: JSONFunctions.serialize(listenToModelEvent.select),
        };

        this.emit(EventName.ListenToModalEvent, listenToModelEventJSON as any);

        const roomId: string = RealtimeUtil.getRoomId(
            listenToModelEvent.tenantId,
            listenToModelEvent.modelType.name,
            listenToModelEvent.eventType
        );

        this.socket.on(roomId, (model: JSONObject) => {
            onEvent(
                BaseModel.fromJSON(model, listenToModelEvent.modelType) as Model
            );
        });

        // Stop listening to the event.
        const stopListening: () => void = (): void => {
            this.socket.off(roomId);
        };

        return stopListening;
    }

    public static listenToAnalyticsModelEvent<Model extends AnalyticsBaseModel>(
        listenToModelEvent: ListenToModelEvent<Model>,
        onEvent: (model: Model) => void
    ): () => void {
        if (!this.socket) {
            this.init();
        }

        const listenToModelEventJSON: ListenToModelEventJSON = {
            eventType: listenToModelEvent.eventType,
            modelType: DatabaseType.AnalyticsDatabase,
            modelName: listenToModelEvent.modelType.name,
            query: JSONFunctions.serialize(listenToModelEvent.query),
            tenantId: listenToModelEvent.tenantId.toString(),
            select: JSONFunctions.serialize(listenToModelEvent.select),
        };

        this.emit(EventName.ListenToModalEvent, listenToModelEventJSON as any);

        const roomId: string = RealtimeUtil.getRoomId(
            listenToModelEvent.tenantId,
            listenToModelEvent.modelType.name,
            listenToModelEvent.eventType
        );

        this.socket.on(roomId, (model: JSONObject) => {
            onEvent(
                AnalyticsBaseModel.fromJSON(
                    model,
                    listenToModelEvent.modelType
                ) as Model
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
