import Express from "../Utils/Express";
import Redis from "./Redis";
import { RealtimeRoute } from "Common/ServiceRoute";
import DatabaseNotConnectedException from "Common/Types/Exception/DatabaseNotConnectedException";
import http from "http";
import SocketIO from "socket.io";

export type Socket = SocketIO.Socket;
export type SocketServer = SocketIO.Server;

export default abstract class IO {
  private static socketServer: SocketIO.Server | null = null;

  public static init(): void {
    const server: http.Server = Express.getHttpServer();

    this.socketServer = new SocketIO.Server(server, {
      path: RealtimeRoute.toString(),
    });

    if (!Redis.getClient()) {
      throw new DatabaseNotConnectedException(
        "Redis is not connected. Please connect to Redis before connecting to SocketIO.",
      );
    }

    // const pubClient: ClientType = Redis.getClient()!.duplicate();
    // const subClient: ClientType = Redis.getClient()!.duplicate();

    // this.socketServer.adapter(createAdapter(pubClient, subClient));
  }

  public static getSocketServer(): SocketIO.Server | null {
    if (!this.socketServer) {
      this.init();
    }

    return this.socketServer;
  }
}
