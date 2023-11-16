import SocketIO from 'socket.io';
import http from 'http';
import Express from '../Utils/Express';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { ClientType } from './Redis';
import DatabaseNotConnectedException from 'Common/Types/Exception/DatabaseNotConnectedException';
import { RealtimeRoute } from 'Common/ServiceRoute';
import logger from '../Utils/Logger';
// import { RealtimeRoute } from 'Common/ServiceRoute';

export type Socket = SocketIO.Socket;
export type SocketServer = SocketIO.Server;

export default abstract class IO {

    private static socketServer: SocketIO.Server | null = null;

    public static init() {
        const server: http.Server = Express.getHttpServer();

        this.socketServer = new SocketIO.Server(server, {
            path: RealtimeRoute.toString()
        });


        this.socketServer.on("connection", (_socket) => {
            logger.info("Client socket connected!");
        });

        if (!Redis.getClient()) {
            throw new DatabaseNotConnectedException(
                'Redis is not connected. Please connect to Redis before connecting to SocketIO.'
            );
        }

        const pubClient: ClientType = Redis.getClient()!.duplicate();
        const subClient: ClientType = Redis.getClient()!.duplicate();

        this.socketServer.adapter(createAdapter(pubClient, subClient));

    }

    public static getSocketServer(): SocketIO.Server | null {

        if (!this.socketServer) {
            this.init();
        }

        return this.socketServer;
    }
}




