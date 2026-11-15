import Express from "../Utils/Express";
import Redis from "./Redis";
import {
  ValkeySocketIOClusterBus,
  createSocketIOClusterAdapter,
} from "./SocketIOCluster";
import { RealtimeRoute } from "../../ServiceRoute";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import http from "http";
import SocketIO from "socket.io";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export type Socket = SocketIO.Socket;
export type SocketServer = SocketIO.Server;

export default abstract class IO {
  private static socketServer: SocketIO.Server | null = null;

  /*
   * This process's socket.io server, one member of every App process's
   * (#8662): its adapter (SocketIOCluster) joins them over Valkey, so a
   * record written on any process - another replica, a worker - reaches the
   * pages connected to this one, as Realtime decides who may hear it.
   */
  @CaptureSpan()
  public static init(): void {
    if (!Redis.getClient()) {
      throw new DatabaseNotConnectedException(
        "Redis is not connected. Please connect to Redis before connecting to SocketIO.",
      );
    }

    const server: http.Server = Express.getHttpServer();

    this.socketServer = new SocketIO.Server(server, {
      path: RealtimeRoute.toString(),
      // A constructor of the namespace, as socket.io makes its adapters.
      adapter: createSocketIOClusterAdapter({
        bus: new ValkeySocketIOClusterBus(),
      }) as unknown as SocketIO.ServerOptions["adapter"],
    });
  }

  public static getSocketServer(): SocketIO.Server | null {
    if (!this.socketServer) {
      this.init();
    }

    return this.socketServer;
  }
}
