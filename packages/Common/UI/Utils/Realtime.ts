import { HOST, HTTP_PROTOCOL } from "../Config";
import API from "./API/API";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { RealtimeRoute } from "../../ServiceRoute";
import URL from "../../Types/API/URL";
import DatabaseType from "../../Types/BaseDatabase/DatabaseType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import RealtimeUtil from "../../Utils/Realtime";
import SocketIO, { Socket } from "socket.io-client";
import ModelEventType from "../../Types/Realtime/ModelEventType";
import ListenToModelEventJSON from "../../Types/Realtime/ListenToModelEventJSON";
import EventName from "../../Types/Realtime/EventName";

export interface ListenToModelEvent<
  Model extends AnalyticsBaseModel | BaseModel,
> {
  modelType: { new (): Model };
  eventType: ModelEventType;
  tenantId: ObjectID;
  modelId?: ObjectID | undefined;
}

/*
 * One subscription a caller holds: what the server has to be asked for (again
 * after every reconnect) and the handler listening on its room.
 */
interface RealtimeSubscription {
  request: ListenToModelEventJSON;
  roomId: string;
  handler: (data: JSONObject) => void;
}

export default abstract class Realtime {
  /*
   * The least time between two refresh-and-reconnects. A reconnect with a
   * freshly refreshed session that the server still refuses (a cookie that
   * does not reach the socket, say) must not turn into a reconnect loop; the
   * next refusal after this long tries again. Far shorter than the 15-minute
   * access token, so a session that genuinely expires again is still renewed.
   */
  public static readonly AUTHENTICATION_RECOVERY_COOLDOWN_IN_MS: number =
    60 * 1000;

  private static socket: Socket;

  /*
   * Every subscription still wanted, by identity: two callers asking for the
   * same room are two entries, and each one's stop function removes only its
   * own. The server forgets a socket's rooms when the connection drops, so
   * this is what gets re-sent on every (re)connect.
   */
  private static subscriptions: Set<RealtimeSubscription> = new Set();

  private static isRecoveringAuthentication: boolean = false;

  private static lastAuthenticationRecoveryAt: number | null = null;

  public static init(): void {
    const socket: Socket = SocketIO(new URL(HTTP_PROTOCOL, HOST).toString(), {
      path: RealtimeRoute.toString(),
    });

    // Initial connect and every reconnect: the new connection is in no rooms.
    socket.on("connect", (): void => {
      this.resubscribeAll();
    });

    socket.on(EventName.AuthenticationRequired, (): void => {
      this.onAuthenticationRequired();
    });

    this.socket = socket;
  }

  public static listenToModelEvent<Model extends BaseModel>(
    listenToModelEvent: ListenToModelEvent<Model>,
    onEvent: (modelId: ObjectID) => void,
  ): () => void {
    // conver this to json and send it to the server.

    if (!this.socket) {
      this.init();
    }

    if (!listenToModelEvent.tenantId) {
      return (): void => {
        // Do nothing.
      };
    }

    const listenToModelEventJSON: ListenToModelEventJSON = {
      eventType: listenToModelEvent.eventType,
      modelType: DatabaseType.Database,
      modelName: listenToModelEvent.modelType.name,
      tenantId: listenToModelEvent.tenantId.toString(),
    };

    const roomId: string = RealtimeUtil.getRoomId(
      listenToModelEvent.tenantId,
      listenToModelEvent.modelType.name,
      listenToModelEvent.eventType,
    );

    return this.subscribe(
      listenToModelEventJSON,
      roomId,
      (data: JSONObject): void => {
        const id: ObjectID = ObjectID.fromString(
          data["modelId"]?.toString() as string,
        );
        onEvent(id);
      },
    );
  }

  public static listenToAnalyticsModelEvent<Model extends AnalyticsBaseModel>(
    listenToModelEvent: ListenToModelEvent<Model>,
    onEvent: (model: Model) => void,
  ): () => void {
    if (!this.socket) {
      this.init();
    }

    const listenToModelEventJSON: ListenToModelEventJSON = {
      eventType: listenToModelEvent.eventType,
      modelType: DatabaseType.AnalyticsDatabase,
      modelName: listenToModelEvent.modelType.name,
      tenantId: listenToModelEvent.tenantId.toString(),
    };

    let roomId: string = RealtimeUtil.getRoomId(
      listenToModelEvent.tenantId,
      listenToModelEvent.modelType.name,
      listenToModelEvent.eventType,
    );

    if (listenToModelEvent.modelId) {
      roomId = RealtimeUtil.getRoomId(
        listenToModelEvent.tenantId,
        listenToModelEvent.modelType.name,
        listenToModelEvent.eventType,
        listenToModelEvent.modelId,
      );
    }

    return this.subscribe(
      listenToModelEventJSON,
      roomId,
      (model: JSONObject): void => {
        onEvent(
          AnalyticsBaseModel.fromJSON(
            model,
            listenToModelEvent.modelType,
          ) as Model,
        );
      },
    );
  }

  public static emit(eventName: string, data: JSONObject): void {
    if (!this.socket) {
      this.init();
    }

    this.socket.emit(eventName, data);
  }

  private static subscribe(
    request: ListenToModelEventJSON,
    roomId: string,
    handler: (data: JSONObject) => void,
  ): () => void {
    const subscription: RealtimeSubscription = {
      request: request,
      roomId: roomId,
      handler: handler,
    };

    this.subscriptions.add(subscription);

    this.socket.on(roomId, handler);

    /*
     * Not connected yet (or between a disconnect and a reconnect): the
     * 'connect' handler sends every registered subscription, this one
     * included. Emitting now as well would have socket.io buffer this one and
     * send it a second time on connect.
     */
    if (this.socket.connected) {
      this.socket.emit(EventName.ListenToModalEvent, request);
    }

    // Stop listening to the event.
    const stopListening: () => void = (): void => {
      this.subscriptions.delete(subscription);

      /*
       * Only this subscription's handler. Removing every listener on the room
       * would also silence any other subscription to the same room.
       */
      this.socket.off(roomId, handler);
    };

    return stopListening;
  }

  private static resubscribeAll(): void {
    // The server's join is idempotent, so identical requests go once.
    const sentRequests: Set<string> = new Set();

    for (const subscription of this.subscriptions) {
      const requestKey: string = JSON.stringify(subscription.request);

      if (sentRequests.has(requestKey)) {
        continue;
      }

      sentRequests.add(requestKey);

      this.socket.emit(EventName.ListenToModalEvent, subscription.request);
    }
  }

  /*
   * The server refused a subscription because this socket's handshake carries
   * no access token, or an expired one. The cookie is read once, when the
   * socket connects, so an HTTP request refreshing the session does nothing
   * for the socket: refresh (or reuse a refresh another request or tab just
   * did), then reconnect so the new handshake carries the new cookie. The
   * reconnect's 'connect' re-sends every subscription, including the refused
   * one.
   *
   * A burst of refusals (a page subscribing to several rooms at once) is one
   * recovery: the first starts it, the rest arrive while it is in flight or
   * inside the cool-down.
   */
  private static onAuthenticationRequired(): void {
    if (this.isRecoveringAuthentication) {
      return;
    }

    if (
      this.lastAuthenticationRecoveryAt !== null &&
      Date.now() - this.lastAuthenticationRecoveryAt <
        this.AUTHENTICATION_RECOVERY_COOLDOWN_IN_MS
    ) {
      return;
    }

    this.isRecoveringAuthentication = true;
    this.lastAuthenticationRecoveryAt = Date.now();

    this.recoverAuthentication().catch(() => {
      // recoverAuthentication settles every outcome itself.
    });
  }

  private static async recoverAuthentication(): Promise<void> {
    try {
      /*
       * Without a new cookie a reconnect would only be refused again. When
       * the refresh failed because the session is over, the refresh request
       * has already sent the user to the login page.
       */
      const refreshed: boolean = await API.refreshSession();

      if (!refreshed) {
        return;
      }

      this.socket.disconnect();
      this.socket.connect();
    } catch {
      // A refresh that could not complete (offline, say) did not happen.
    } finally {
      this.isRecoveringAuthentication = false;
      // The cool-down runs from the end of the attempt, however long it took.
      this.lastAuthenticationRecoveryAt = Date.now();
    }
  }
}
