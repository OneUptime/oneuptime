import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseType from "../../../Types/BaseDatabase/DatabaseType";
import ObjectID from "../../../Types/ObjectID";
import EventName from "../../../Types/Realtime/EventName";
import ListenToModelEventJSON from "../../../Types/Realtime/ListenToModelEventJSON";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import RealtimeUtil from "../../../Utils/Realtime";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test - the dashboard's realtime subscriptions surviving an
 * expired session.
 *
 * The server authorizes each subscription with the access-token cookie the
 * browser sent in the socket HANDSHAKE, and that cookie is never re-read for
 * the life of the connection. The access token lives 15 minutes; a dashboard
 * tab lives all day. So after 15 minutes every NEW subscription (switching
 * project re-subscribes the header counters; opening live logs; the AI chat)
 * was refused, silently, and refreshing the HTTP session did not help because
 * the socket still carried the old handshake.
 *
 * The client now keeps every subscription it holds, re-sends all of them on
 * every (re)connect, and answers the server's AuthenticationRequired by
 * refreshing the session and reconnecting - once per burst, never in a loop.
 */

type Listener = (...args: Array<unknown>) => void;

interface EmittedEvent {
  event: string;
  data: unknown;
  whileConnected: boolean;
}

/*
 * Just enough of a socket.io-client Socket. Like the real one it only says it
 * is connected once the server has accepted the connection, which the test
 * decides with acceptConnection().
 */
class FakeSocket {
  public connected: boolean = false;
  public emitted: Array<EmittedEvent> = [];
  public connectCalls: number = 0;
  public disconnectCalls: number = 0;
  private listeners: Map<string, Array<Listener>> = new Map();

  public on(event: string, listener: Listener): FakeSocket {
    const existing: Array<Listener> = this.listeners.get(event) || [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  public off(event?: string, listener?: Listener): FakeSocket {
    if (!event) {
      this.listeners.clear();
      return this;
    }

    if (!listener) {
      this.listeners.delete(event);
      return this;
    }

    this.listeners.set(
      event,
      (this.listeners.get(event) || []).filter((existing: Listener) => {
        return existing !== listener;
      }),
    );
    return this;
  }

  public emit(event: string, data: unknown): FakeSocket {
    this.emitted.push({
      event: event,
      data: data,
      whileConnected: this.connected,
    });
    return this;
  }

  public connect(): FakeSocket {
    this.connectCalls++;
    return this;
  }

  public disconnect(): FakeSocket {
    this.disconnectCalls++;
    this.connected = false;
    return this;
  }

  // Test side: the server accepted a (re)connection.
  public acceptConnection(): void {
    this.connected = true;
    this.deliver("connect");
  }

  // Test side: the server sent an event to this socket.
  public deliver(event: string, payload?: unknown): void {
    for (const listener of [...(this.listeners.get(event) || [])]) {
      listener(payload);
    }
  }

  public listenerCount(event: string): number {
    return (this.listeners.get(event) || []).length;
  }

  public listenRequests(): Array<ListenToModelEventJSON> {
    return this.emitted
      .filter((emitted: EmittedEvent) => {
        return emitted.event === EventName.ListenToModalEvent;
      })
      .map((emitted: EmittedEvent) => {
        return emitted.data as ListenToModelEventJSON;
      });
  }

  public clearEmitted(): void {
    this.emitted = [];
  }
}

let mockSocket: FakeSocket = new FakeSocket();
let mockSocketsCreated: number = 0;

jest.mock("socket.io-client", () => {
  return {
    __esModule: true,
    default: (): FakeSocket => {
      mockSocketsCreated++;
      return mockSocket;
    },
  };
});

type RealtimeClass = typeof import("../../../UI/Utils/Realtime").default;
type APIClass = typeof import("../../../UI/Utils/API/API").default;

interface LoadedModules {
  Realtime: RealtimeClass;
  refreshSession: jest.Mock<Promise<boolean>, []>;
}

/*
 * Realtime keeps its socket and registry in static fields, so every test loads
 * a fresh copy of it (and of BaseAPI, whose refreshSession it calls).
 */
type LoadModulesFunction = () => Promise<LoadedModules>;

const loadModules: LoadModulesFunction = async (): Promise<LoadedModules> => {
  const { default: Realtime } = await import("../../../UI/Utils/Realtime");
  const { default: API } = await import("../../../UI/Utils/API/API");

  const refreshSession: jest.Mock<Promise<boolean>, []> = jest.fn<
    Promise<boolean>,
    []
  >();

  refreshSession.mockResolvedValue(true);

  jest
    .spyOn(API as APIClass, "refreshSession")
    .mockImplementation(refreshSession);

  return { Realtime, refreshSession };
};

// Lets the recovery's awaited refresh (a resolved mock) run to completion.
type FlushFunction = () => Promise<void>;

const flush: FlushFunction = async (): Promise<void> => {
  for (let i: number = 0; i < 5; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
};

const TENANT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OTHER_TENANT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const MODEL_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/*
 * Realtime only reads a model type's class name, so a named class stands in
 * for the real (and heavy) models.
 */
const Incident: { new (): BaseModel } = class Incident {} as unknown as {
  new (): BaseModel;
};
const Alert: { new (): BaseModel } = class Alert {} as unknown as {
  new (): BaseModel;
};
const Log: { new (): AnalyticsBaseModel } = class Log {} as unknown as {
  new (): AnalyticsBaseModel;
};

type RequestForFunction = (
  modelName: string,
  eventType: ModelEventType,
  tenantId?: ObjectID,
  modelType?: DatabaseType,
) => ListenToModelEventJSON;

const requestFor: RequestForFunction = (
  modelName: string,
  eventType: ModelEventType,
  tenantId: ObjectID = TENANT_ID,
  modelType: DatabaseType = DatabaseType.Database,
): ListenToModelEventJSON => {
  return {
    eventType: eventType,
    modelType: modelType,
    modelName: modelName,
    tenantId: tenantId.toString(),
  };
};

describe("Realtime (UI) subscriptions", () => {
  let Realtime: RealtimeClass;
  let refreshSession: jest.Mock<Promise<boolean>, []>;

  beforeEach(async () => {
    jest.resetModules();
    mockSocket = new FakeSocket();
    mockSocketsCreated = 0;

    const loaded: LoadedModules = await loadModules();
    Realtime = loaded.Realtime;
    refreshSession = loaded.refreshSession;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("subscribing", () => {
    test("asks the server for the room right away when the socket is connected, and delivers the room's events", () => {
      Realtime.init();
      mockSocket.acceptConnection();

      const received: Array<string> = [];

      Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        (modelId: ObjectID) => {
          received.push(modelId.toString());
        },
      );

      expect(mockSocket.listenRequests()).toEqual([
        requestFor("Incident", ModelEventType.Create),
      ]);

      mockSocket.deliver(
        RealtimeUtil.getRoomId(TENANT_ID, "Incident", ModelEventType.Create),
        { modelId: MODEL_ID },
      );

      expect(received).toEqual([MODEL_ID]);
    });

    test("a subscription made before the socket connects is sent once, on connect, and never while disconnected", () => {
      Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {},
      );

      /*
       * socket.io-client buffers what is emitted while disconnected and sends
       * it on connect, right before 'connect' fires. Emitting here as well as
       * re-sending on 'connect' would ask the server twice.
       */
      expect(mockSocket.emitted).toEqual([]);

      mockSocket.acceptConnection();

      expect(mockSocket.listenRequests()).toEqual([
        requestFor("Incident", ModelEventType.Create),
      ]);
      expect(mockSocketsCreated).toBe(1);
    });

    test("a subscription without a tenant is a no-op, as before", () => {
      const stop: () => void = Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: undefined as unknown as ObjectID,
        },
        () => {},
      );

      mockSocket.acceptConnection();

      expect(mockSocket.listenRequests()).toEqual([]);
      expect(() => {
        stop();
      }).not.toThrow();
    });
  });

  describe("reconnecting", () => {
    test("every registered subscription, database and analytics, is sent again on reconnect", () => {
      Realtime.init();
      mockSocket.acceptConnection();

      Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {},
      );
      Realtime.listenToModelEvent(
        {
          modelType: Alert,
          eventType: ModelEventType.Update,
          tenantId: TENANT_ID,
        },
        () => {},
      );
      Realtime.listenToAnalyticsModelEvent(
        {
          modelType: Log,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {},
      );

      // The server forgets a socket's rooms when the connection drops.
      mockSocket.disconnect();
      mockSocket.clearEmitted();
      mockSocket.acceptConnection();

      expect(mockSocket.listenRequests()).toEqual([
        requestFor("Incident", ModelEventType.Create),
        requestFor("Alert", ModelEventType.Update),
        requestFor(
          "Log",
          ModelEventType.Create,
          TENANT_ID,
          DatabaseType.AnalyticsDatabase,
        ),
      ]);
    });

    test("identical subscriptions from two callers are one request on reconnect, and both callers still get events", () => {
      Realtime.init();
      mockSocket.acceptConnection();

      let first: number = 0;
      let second: number = 0;

      Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {
          first++;
        },
      );
      Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {
          second++;
        },
      );

      mockSocket.disconnect();
      mockSocket.clearEmitted();
      mockSocket.acceptConnection();

      expect(mockSocket.listenRequests()).toEqual([
        requestFor("Incident", ModelEventType.Create),
      ]);

      mockSocket.deliver(
        RealtimeUtil.getRoomId(TENANT_ID, "Incident", ModelEventType.Create),
        { modelId: MODEL_ID },
      );

      expect(first).toBe(1);
      expect(second).toBe(1);
    });
  });

  describe("unsubscribing", () => {
    test("a stopped subscription is not sent again on reconnect (switching project drops the old project's rooms)", () => {
      Realtime.init();
      mockSocket.acceptConnection();

      const stopOldProject: () => void = Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {},
      );

      stopOldProject();

      Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: OTHER_TENANT_ID,
        },
        () => {},
      );

      mockSocket.disconnect();
      mockSocket.clearEmitted();
      mockSocket.acceptConnection();

      expect(mockSocket.listenRequests()).toEqual([
        requestFor("Incident", ModelEventType.Create, OTHER_TENANT_ID),
      ]);
    });

    test("stopping one subscription removes only its own handler, not another caller's on the same room", () => {
      Realtime.init();
      mockSocket.acceptConnection();

      const roomId: string = RealtimeUtil.getRoomId(
        TENANT_ID,
        "Incident",
        ModelEventType.Create,
      );

      let stopped: number = 0;
      let kept: number = 0;

      const stop: () => void = Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {
          stopped++;
        },
      );
      Realtime.listenToModelEvent(
        {
          modelType: Incident,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {
          kept++;
        },
      );

      stop();

      expect(mockSocket.listenerCount(roomId)).toBe(1);

      mockSocket.deliver(roomId, { modelId: MODEL_ID });

      expect(stopped).toBe(0);
      expect(kept).toBe(1);

      // And the one still held is still re-sent after a reconnect.
      mockSocket.disconnect();
      mockSocket.clearEmitted();
      mockSocket.acceptConnection();

      expect(mockSocket.listenRequests()).toEqual([
        requestFor("Incident", ModelEventType.Create),
      ]);
    });

    test("stopping twice is harmless", () => {
      Realtime.init();
      mockSocket.acceptConnection();

      const stop: () => void = Realtime.listenToAnalyticsModelEvent(
        {
          modelType: Log,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {},
      );

      stop();

      expect(() => {
        stop();
      }).not.toThrow();

      expect(
        mockSocket.listenerCount(
          RealtimeUtil.getRoomId(TENANT_ID, "Log", ModelEventType.Create),
        ),
      ).toBe(0);
    });
  });

  describe("the server says the handshake's session is missing or expired", () => {
    type SubscribeHeaderCountersFunction = () => void;

    // What Header.tsx does on a project switch: several rooms at once.
    const subscribeHeaderCounters: SubscribeHeaderCountersFunction =
      (): void => {
        for (const eventType of [
          ModelEventType.Create,
          ModelEventType.Update,
          ModelEventType.Delete,
        ]) {
          Realtime.listenToModelEvent(
            {
              modelType: Incident,
              eventType: eventType,
              tenantId: TENANT_ID,
            },
            () => {},
          );
        }
      };

    type RejectAllFunction = () => void;

    const rejectAll: RejectAllFunction = (): void => {
      for (const request of mockSocket.listenRequests()) {
        mockSocket.deliver(EventName.AuthenticationRequired, request);
      }
    };

    test("a burst of refusals refreshes the session once and reconnects once, then re-sends every subscription", async () => {
      Realtime.init();
      mockSocket.acceptConnection();

      subscribeHeaderCounters();

      expect(mockSocket.listenRequests()).toHaveLength(3);

      rejectAll();

      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.disconnectCalls).toBe(1);
      expect(mockSocket.connectCalls).toBe(1);

      // The reconnect's handshake carries the refreshed cookie.
      mockSocket.clearEmitted();
      mockSocket.acceptConnection();

      expect(mockSocket.listenRequests()).toEqual([
        requestFor("Incident", ModelEventType.Create),
        requestFor("Incident", ModelEventType.Update),
        requestFor("Incident", ModelEventType.Delete),
      ]);
    });

    test("refusals that arrive while the refresh is still in flight do not start a second one", async () => {
      Realtime.init();
      mockSocket.acceptConnection();

      let finishRefresh: (refreshed: boolean) => void = (): void => {};

      refreshSession.mockImplementation((): Promise<boolean> => {
        return new Promise<boolean>((resolve: (refreshed: boolean) => void) => {
          finishRefresh = resolve;
        });
      });

      subscribeHeaderCounters();

      mockSocket.deliver(
        EventName.AuthenticationRequired,
        requestFor("Incident", ModelEventType.Create),
      );

      await flush();

      mockSocket.deliver(
        EventName.AuthenticationRequired,
        requestFor("Incident", ModelEventType.Update),
      );

      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.disconnectCalls).toBe(0);

      finishRefresh(true);
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.disconnectCalls).toBe(1);
      expect(mockSocket.connectCalls).toBe(1);
    });

    test("a subscription made between the recovery's disconnect and the reconnect is sent once, after the reconnect", async () => {
      Realtime.init();
      mockSocket.acceptConnection();

      subscribeHeaderCounters();
      rejectAll();
      await flush();

      expect(mockSocket.connected).toBe(false);

      mockSocket.clearEmitted();

      Realtime.listenToModelEvent(
        {
          modelType: Alert,
          eventType: ModelEventType.Create,
          tenantId: TENANT_ID,
        },
        () => {},
      );

      expect(mockSocket.emitted).toEqual([]);

      mockSocket.acceptConnection();

      expect(mockSocket.listenRequests()).toEqual([
        requestFor("Incident", ModelEventType.Create),
        requestFor("Incident", ModelEventType.Update),
        requestFor("Incident", ModelEventType.Delete),
        requestFor("Alert", ModelEventType.Create),
      ]);
      expect(
        mockSocket.emitted.every((emitted: EmittedEvent) => {
          return emitted.whileConnected;
        }),
      ).toBe(true);
    });

    test("does not reconnect when the refresh fails (there is no new cookie to reconnect with)", async () => {
      Realtime.init();
      mockSocket.acceptConnection();

      refreshSession.mockResolvedValue(false);

      subscribeHeaderCounters();
      rejectAll();

      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.disconnectCalls).toBe(0);
      expect(mockSocket.connectCalls).toBe(0);
    });

    test("does not reconnect, and does not reject, when the refresh throws", async () => {
      Realtime.init();
      mockSocket.acceptConnection();

      refreshSession.mockRejectedValue(new Error("Network Error"));

      subscribeHeaderCounters();
      rejectAll();

      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.disconnectCalls).toBe(0);
    });

    test("a server that keeps refusing after a successful refresh is not answered with a reconnect loop", async () => {
      const startedAt: number = 1_700_000_000_000;
      let now: number = startedAt;

      jest.spyOn(Date, "now").mockImplementation((): number => {
        return now;
      });

      Realtime.init();
      mockSocket.acceptConnection();

      subscribeHeaderCounters();
      rejectAll();
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.disconnectCalls).toBe(1);

      /*
       * The reconnect re-sends every subscription and the server refuses them
       * all again: the refresh did not reach the socket's cookie. Inside the
       * cool-down that is not answered.
       */
      now = startedAt + 1000;
      mockSocket.clearEmitted();
      mockSocket.acceptConnection();
      rejectAll();
      await flush();

      now = startedAt + Realtime.AUTHENTICATION_RECOVERY_COOLDOWN_IN_MS - 1;
      rejectAll();
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.disconnectCalls).toBe(1);

      // After the cool-down, a new refusal gets one more attempt.
      now = startedAt + Realtime.AUTHENTICATION_RECOVERY_COOLDOWN_IN_MS + 1;
      rejectAll();
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(2);
      expect(mockSocket.disconnectCalls).toBe(2);
    });

    test("a failed refresh also waits out the cool-down before the next attempt", async () => {
      const startedAt: number = 1_700_000_000_000;
      let now: number = startedAt;

      jest.spyOn(Date, "now").mockImplementation((): number => {
        return now;
      });

      Realtime.init();
      mockSocket.acceptConnection();

      refreshSession.mockResolvedValue(false);

      subscribeHeaderCounters();
      rejectAll();
      await flush();

      now = startedAt + 5000;
      rejectAll();
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
    });
  });
});
