import { JSONObject } from 'Common/Types/JSON';
import IO, { SocketServer, Socket } from '../Infrastructure/SocketIO';
import RealtimeUtil, {
    EventName,
    ListenToModelEventJSON,
    ModelEventType,
} from 'Common/Utils/Realtime';
import DatabaseType from 'Common/Types/BaseDatabase/DatabaseType';
import JSONFunctions from 'Common/Types/JSONFunctions';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import BaseModel, { BaseModelType } from 'Common/Models/BaseModel';
import AnalyticsBaseModel, { AnalyticsBaseModelType } from 'Common/AnalyticsModels/BaseModel';
import logger from './Logger';

export default abstract class Realtime {
    private static socketServer: SocketServer | null = null;

    public static isInitialized(): boolean {
        return this.socketServer !== null;
    }

    public static init(): SocketServer | null {
        if (!this.socketServer) {
            this.socketServer = IO.getSocketServer();
            logger.info('Realtime socket server initialized');
        }

        this.socketServer!.on('connection', (socket: Socket) => {
            socket.on(
                EventName.ListenToModalEvent,
                async (data: JSONObject) => {
                    // TODO: validate if this soocket has access to this tenant

                    // TODO: validate if this socket has access to this model

                    // TODO: validate if this socket has access to this event type

                    // TODO: validate if this socket has access to this query

                    // TODO: validate if this socket has access to this select

                    // validate data

                    if (typeof data['eventType'] !== 'string') {
                        throw new BadDataException('eventType is not a string');
                    }
                    if (typeof data['modelType'] !== 'string') {
                        throw new BadDataException('modelType is not a string');
                    }
                    if (typeof data['modelName'] !== 'string') {
                        throw new BadDataException('modelName is not a string');
                    }
                    if (typeof data['query'] !== 'object') {
                        throw new BadDataException('query is not an object');
                    }
                    if (typeof data['tenantId'] !== 'string') {
                        throw new BadDataException('tenantId is not a string');
                    }
                    if (typeof data['select'] !== 'object') {
                        throw new BadDataException('select is not an object');
                    }

                    await Realtime.listenToModelEvent(socket, {
                        eventType: data['eventType'] as ModelEventType,
                        modelType: data['modelType'] as DatabaseType,
                        modelName: data['modelName'] as string,
                        query: JSONFunctions.deserialize(
                            data['query'] as JSONObject
                        ),
                        tenantId: data['tenantId'] as string,
                        select: JSONFunctions.deserialize(
                            data['select'] as JSONObject
                        ),
                    });
                }
            );
        });

        return this.socketServer;
    }

    public static async listenToModelEvent(
        socket: Socket,
        data: ListenToModelEventJSON
    ): Promise<void> {
        if (!this.socketServer) {
            this.init();
        }

        const roomId: string = RealtimeUtil.getRoomId(
            data.tenantId,
            data.modelName,
            data.eventType
        );

        // join the room.
        await socket.join(roomId);
    }

    public static async stopListeningToModelEvent(
        socket: Socket,
        data: ListenToModelEventJSON
    ): Promise<void> {
        if (!this.socketServer) {
            this.init();
        }

        // leave this room.
        await socket.leave(
            RealtimeUtil.getRoomId(
                data.tenantId,
                data.modelName,
                data.eventType
            )
        );
    }

    public static async emitModelEvent(data: {
        tenantId: string | ObjectID;
        eventType: ModelEventType;
        model: BaseModel | AnalyticsBaseModel;
        modelType: { new (): BaseModel | AnalyticsBaseModel };
    }): Promise<void> {
        if (!this.socketServer) {
            this.init();
        }

        let jsonObject: JSONObject = {};

        if (data.model instanceof BaseModel) {
            jsonObject = BaseModel.toJSON(
                data.model,
                data.modelType as BaseModelType
            );
        }

        if (data.model instanceof AnalyticsBaseModel) {
            jsonObject = AnalyticsBaseModel.toJSON(
                data.model,
                data.modelType as AnalyticsBaseModelType
            );
        }

        const roomId: string = RealtimeUtil.getRoomId(
            data.tenantId,
            data.model.tableName!,
            data.eventType
        );

        this.socketServer!.to(roomId).emit(roomId, jsonObject);
    }
}
