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

  /*
   * The longest wait before trying again after refreshes that did not
   * happen (offline, the identity service restarting). The wait starts at
   * the cool-down and doubles with each attempt that fails, up to this.
   */
  public static readonly MAX_AUTHENTICATION_RETRY_DELAY_IN_MS: number =
    15 * 60 * 1000;

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

  // A recovery waiting for the cool-down, or a retry's wait, to run out.
  private static pendingAuthenticationRecovery: ReturnType<
    typeof setTimeout
  > | null = null;

  // When the waiting recovery starts, as Date.now() counts.
  private static pendingAuthenticationRecoveryAt: number | null = null;

  // Recoveries in a row whose refresh did not happen.
  private static failedAuthenticationRecoveries: number = 0;

  // Who hears that a project's live updates need an SSO sign-in.
  private static ssoAuthorizationRequiredListeners: Set<
    (tenantId: ObjectID) => void
  > = new Set();

  public static init(): void {
    const socket: Socket = SocketIO(new URL(HTTP_PROTOCOL, HOST).toString(), {
      path: RealtimeRoute.toString(),
    });

    // Initial connect and every reconnect: the new connection is in no rooms.
    socket.on("connect", (): void => {
      this.resubscribeAll();
    });

    socket.on(
      EventName.AuthenticationRequired,
      (payload: JSONObject | undefined): void => {
        this.onAuthenticationRequired(payload);
      },
    );

    /*
     * The socket's access token expires in a minute, and its live updates
     * with it: renew first, so they carry on without a break.
     */
    socket.on(EventName.SessionExpiring, (): void => {
      this.requestAuthenticationRecovery({ mayLetGo: false, isUrgent: true });
    });

    socket.on(
      EventName.SsoAuthorizationRequired,
      (refused: JSONObject | undefined): void => {
        this.onSsoAuthorizationRequired(refused);
      },
    );

    this.socket = socket;
  }

  /*
   * Hears that the server refused a subscription because its project
   * requires an SSO sign-in this session does not have - the answer an API
   * request of the same session gets. The listener is given the project,
   * and decides what the person sees (the Dashboard sends them to sign in
   * with SSO, as it does when an API request is refused that way). Returns
   * the function that stops listening.
   */
  public static listenForSsoAuthorizationRequired(
    listener: (tenantId: ObjectID) => void,
  ): () => void {
    this.ssoAuthorizationRequiredListeners.add(listener);

    return (): void => {
      this.ssoAuthorizationRequiredListeners.delete(listener);
    };
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

  private static onSsoAuthorizationRequired(
    refused: JSONObject | undefined,
  ): void {
    const tenantId: unknown =
      refused && typeof refused === "object" ? refused["tenantId"] : undefined;

    if (typeof tenantId !== "string" || !tenantId) {
      return;
    }

    for (const listener of Array.from(this.ssoAuthorizationRequiredListeners)) {
      try {
        listener(new ObjectID(tenantId));
      } catch {
        // One listener failing does not keep the others from hearing it.
      }
    }
  }

  /*
   * The server refused a subscription because this socket's handshake carries
   * no access token, or an expired one - or the session the socket joined
   * with has ended (its access token expired, or it was signed out or
   * revoked), and the socket has left every room. The cookie is read once,
   * when the socket connects, so an HTTP request refreshing the session does
   * nothing for the socket: refresh (or reuse a refresh another request or
   * tab just did), then reconnect so the new handshake carries the new
   * cookie. The reconnect's 'connect' re-sends every subscription, including
   * the refused one. A session that cannot be refreshed (signed out,
   * revoked, blocked) sends the person to sign in instead.
   *
   * A burst of refusals (a page subscribing to several rooms at once) is one
   * recovery: the first starts it, the rest arrive while it is in flight or
   * inside the cool-down.
   *
   * A refusal carries the refused request; an ended session carries {}. A
   * refusal inside the cool-down is let go, so a server that keeps refusing
   * a freshly refreshed session is not answered with a reconnect loop. An
   * ended session is never let go: the server says it once, and a page
   * that let it go would have no live updates left. Inside the cool-down it
   * waits for the cool-down to run out instead.
   */
  private static onAuthenticationRequired(payload?: JSONObject): void {
    const isRefusal: boolean = Boolean(
      payload && typeof payload === "object" && payload["tenantId"],
    );

    this.requestAuthenticationRecovery(
      isRefusal
        ? { mayLetGo: true, isUrgent: false }
        : { mayLetGo: false, isUrgent: true },
    );
  }

  /*
   * Starts a refresh-and-reconnect, unless one is in flight (it covers this
   * too). Otherwise it waits: for the cool-down after the last attempt, or,
   * after refreshes that did not happen, for the longer wait between
   * retries. A refused subscription that may be let go is let go instead of
   * waiting. An urgent request - the session ended, or ends in a minute -
   * waits no longer than the cool-down, however many refreshes failed: it
   * brings a retry that waits longer forward, and never pushes one back.
   */
  private static requestAuthenticationRecovery(options: {
    mayLetGo: boolean;
    isUrgent: boolean;
  }): void {
    if (this.isRecoveringAuthentication) {
      return;
    }

    const waitMs: number = options.isUrgent
      ? this.getCooldownWaitMs()
      : this.getAuthenticationRecoveryWaitMs();

    if (this.pendingAuthenticationRecovery) {
      const startsAt: number = Date.now() + waitMs;

      if (
        this.pendingAuthenticationRecoveryAt !== null &&
        startsAt < this.pendingAuthenticationRecoveryAt
      ) {
        this.scheduleAuthenticationRecovery(waitMs);
      }

      return;
    }

    if (waitMs > 0) {
      if (options.mayLetGo) {
        return;
      }

      this.scheduleAuthenticationRecovery(waitMs);
      return;
    }

    this.startAuthenticationRecovery();
  }

  // The one waiting recovery: starts after `waitMs`, replacing any other.
  private static scheduleAuthenticationRecovery(waitMs: number): void {
    if (this.pendingAuthenticationRecovery) {
      clearTimeout(this.pendingAuthenticationRecovery);
    }

    this.pendingAuthenticationRecoveryAt = Date.now() + waitMs;

    this.pendingAuthenticationRecovery = setTimeout((): void => {
      this.pendingAuthenticationRecovery = null;
      this.pendingAuthenticationRecoveryAt = null;

      if (!this.isRecoveringAuthentication) {
        this.startAuthenticationRecovery();
      }
    }, waitMs);
  }

  private static startAuthenticationRecovery(): void {
    this.isRecoveringAuthentication = true;
    this.lastAuthenticationRecoveryAt = Date.now();

    this.recoverAuthentication().catch(() => {
      // recoverAuthentication settles every outcome itself.
    });
  }

  // How long until the cool-down after the last attempt runs out.
  private static getCooldownWaitMs(): number {
    if (this.lastAuthenticationRecoveryAt === null) {
      return 0;
    }

    return Math.max(
      0,
      this.lastAuthenticationRecoveryAt +
        this.AUTHENTICATION_RECOVERY_COOLDOWN_IN_MS -
        Date.now(),
    );
  }

  /*
   * How long until the next recovery may start: the cool-down after the
   * last one, and twice as long after each refresh in a row that did not
   * happen, up to MAX_AUTHENTICATION_RETRY_DELAY_IN_MS.
   */
  private static getAuthenticationRecoveryWaitMs(): number {
    if (this.lastAuthenticationRecoveryAt === null) {
      return 0;
    }

    const delayMs: number = Math.min(
      this.AUTHENTICATION_RECOVERY_COOLDOWN_IN_MS *
        Math.pow(2, Math.max(0, this.failedAuthenticationRecoveries - 1)),
      this.MAX_AUTHENTICATION_RETRY_DELAY_IN_MS,
    );

    return Math.max(
      0,
      this.lastAuthenticationRecoveryAt + delayMs - Date.now(),
    );
  }

  private static async recoverAuthentication(): Promise<void> {
    let reconnected: boolean = false;

    try {
      /*
       * Without a new cookie a reconnect would only be refused again. When
       * the refresh failed because the session is over, the refresh request
       * has already sent the user to the login page.
       */
      const refreshed: boolean = await API.refreshSession();

      if (refreshed) {
        this.socket.disconnect();
        this.socket.connect();
        reconnected = true;
      }
    } catch {
      // A refresh that could not complete (offline, say) did not happen.
    } finally {
      this.isRecoveringAuthentication = false;
      // The cool-down runs from the end of the attempt, however long it took.
      this.lastAuthenticationRecoveryAt = Date.now();
    }

    if (reconnected) {
      this.failedAuthenticationRecoveries = 0;
      return;
    }

    /*
     * The refresh did not happen (offline, the identity service restarting).
     * Nothing else would bring the live updates back: the server does not
     * repeat itself to a socket whose session has ended, and a page that
     * subscribes to nothing new sends it nothing to refuse. So the page tries
     * again once the wait runs out, waiting longer after each attempt that
     * fails.
     */
    this.failedAuthenticationRecoveries++;
    this.requestAuthenticationRecovery({ mayLetGo: false, isUrgent: false });
  }
}
