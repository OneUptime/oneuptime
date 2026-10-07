import Redis from "../../../../Server/Infrastructure/Redis";
import GracefulShutdown from "../../../../Server/Utils/GracefulShutdown";
import logger from "../../../../Server/Utils/Logger";
import RealtimeAccessChanges, {
  RealtimeAccessChange,
  RealtimeAccessChangeKind,
} from "../../../../Server/Utils/Realtime/RealtimeAccessChanges";
import RealtimeReaders from "../../../../Server/Utils/Realtime/RealtimeReaders";
import RealtimeSessions from "../../../../Server/Utils/Realtime/RealtimeSessions";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A change to what someone may hear, made known to every server: the
 * server that makes it applies it at once and publishes it on a Valkey
 * channel; every server that holds sockets listens and applies what the
 * others publish. A message only ever makes a server forget or end
 * something.
 */

const mockForgetBlockedStatus: jest.Mock = jest.fn();
const mockForgetTeamIdsForUser: jest.Mock = jest.fn();

jest.mock("../../../../Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      forgetBlockedStatus: (...args: Array<unknown>): unknown => {
        return mockForgetBlockedStatus(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      forgetTeamIdsForUser: (...args: Array<unknown>): unknown => {
        return mockForgetTeamIdsForUser(...args);
      },
    },
  };
});

const USER: string = "11111111-1111-4111-8111-111111111111";
const PROJECT: string = "22222222-2222-4222-8222-222222222222";
const SESSION: string = "33333333-3333-4333-8333-333333333333";

type MessageListener = (channel: string, message: string) => void;

// Just enough of an ioredis client: publish, and a duplicate that subscribes.
class FakeSubscriber {
  public subscribed: Array<string> = [];
  public disconnected: boolean = false;
  public failSubscribe: boolean = false;
  private listeners: Map<string, Array<(...args: Array<unknown>) => void>> =
    new Map();

  public on(event: string, listener: (...args: Array<unknown>) => void): this {
    const existing: Array<(...args: Array<unknown>) => void> =
      this.listeners.get(event) || [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  public async subscribe(channel: string): Promise<number> {
    if (this.failSubscribe) {
      throw new Error("Valkey refused the subscription");
    }

    this.subscribed.push(channel);
    return 1;
  }

  public disconnect(): void {
    this.disconnected = true;
  }

  // Test side: a message arrives.
  public deliver(channel: string, message: string): void {
    for (const listener of this.listeners.get("message") || []) {
      (listener as MessageListener)(channel, message);
    }
  }
}

class FakeClient {
  public published: Array<{ channel: string; message: string }> = [];
  public subscriber: FakeSubscriber = new FakeSubscriber();
  public failPublish: boolean = false;

  public async publish(channel: string, message: string): Promise<number> {
    if (this.failPublish) {
      throw new Error("Valkey is down");
    }

    this.published.push({ channel, message });
    return 1;
  }

  public duplicate(): FakeSubscriber {
    return this.subscriber;
  }

  public changesPublished(): Array<RealtimeAccessChange> {
    return this.published.map(
      (published: { channel: string; message: string }) => {
        expect(published.channel).toBe(RealtimeAccessChanges.CHANNEL);
        return JSON.parse(published.message).change as RealtimeAccessChange;
      },
    );
  }

  public originOfLastMessage(): string {
    return JSON.parse(this.published[this.published.length - 1]!.message)
      .origin as string;
  }
}

describe("RealtimeAccessChanges", () => {
  let client: FakeClient;
  let forgetUser: jest.SpyInstance;
  let endWhere: jest.SpyInstance;

  beforeEach(async () => {
    client = new FakeClient();
    jest
      .spyOn(Redis, "getClient")
      .mockReturnValue(client as unknown as ReturnType<typeof Redis.getClient>);
    jest.spyOn(Redis, "isConnected").mockReturnValue(true);
    jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
      // Not under test.
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    forgetUser = jest.spyOn(RealtimeReaders, "forgetUser");
    endWhere = jest.spyOn(RealtimeSessions, "endWhere");
    mockForgetBlockedStatus.mockReset();
    mockForgetTeamIdsForUser.mockReset();
    await RealtimeAccessChanges.stopListening();
  });

  afterEach(async () => {
    await RealtimeAccessChanges.stopListening();
    jest.restoreAllMocks();
    RealtimeSessions.clear();
  });

  describe("announcing a change", () => {
    test("a permission change in a project: forgotten here at once, and sent to every server", () => {
      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.PermissionsChanged,
        userId: USER,
        projectId: PROJECT,
      });

      expect(forgetUser).toHaveBeenCalledWith(USER, PROJECT);
      expect(mockForgetTeamIdsForUser).toHaveBeenCalledWith(
        new ObjectID(USER),
        new ObjectID(PROJECT),
      );
      expect(client.changesPublished()).toEqual([
        {
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: USER,
          projectId: PROJECT,
        },
      ]);
    });

    test("a permission change in every project forgets every entry of the person", () => {
      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.PermissionsChanged,
        userId: USER,
      });

      expect(forgetUser).toHaveBeenCalledWith(USER, undefined);
      expect(mockForgetTeamIdsForUser).not.toHaveBeenCalled();
    });

    test("an account change (blocked, server admin) forgets whether they are blocked and every entry of theirs", () => {
      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.AccountChanged,
        userId: USER,
      });

      expect(mockForgetBlockedStatus).toHaveBeenCalledWith(new ObjectID(USER));
      expect(forgetUser).toHaveBeenCalledWith(USER);
      expect(client.changesPublished()).toHaveLength(1);
    });

    test("ended sessions end their sockets here at once", () => {
      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        sessionIds: [SESSION],
      });

      expect(endWhere).toHaveBeenCalledWith({
        userId: undefined,
        sessionIds: [SESSION],
      });
      expect(forgetUser).not.toHaveBeenCalled();
    });

    test("every session of a person ending also forgets their entries", () => {
      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        userId: USER,
      });

      expect(endWhere).toHaveBeenCalledWith({
        userId: USER,
        sessionIds: undefined,
      });
      expect(forgetUser).toHaveBeenCalledWith(USER);
    });

    test("many ended sessions go in messages of a bounded size", () => {
      const sessionIds: Array<string> = [];

      for (
        let index: number = 0;
        index < RealtimeAccessChanges.MAX_SESSIONS_PER_MESSAGE * 2 + 1;
        index++
      ) {
        sessionIds.push(ObjectID.generate().toString());
      }

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        sessionIds: sessionIds,
      });

      const published: Array<RealtimeAccessChange> = client.changesPublished();

      expect(published).toHaveLength(3);
      expect(
        published.flatMap((change: RealtimeAccessChange): Array<string> => {
          return change.kind === RealtimeAccessChangeKind.SessionsEnded
            ? change.sessionIds || []
            : [];
        }),
      ).toEqual(sessionIds);
    });

    test("without Valkey the change still applies on this server, and nothing is sent", () => {
      (Redis.isConnected as unknown as jest.Mock).mockReturnValue(false);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.AccountChanged,
        userId: USER,
      });

      expect(mockForgetBlockedStatus).toHaveBeenCalled();
      expect(client.published).toEqual([]);
    });

    test("a publish that fails is logged and never reaches the write that made the change", async () => {
      client.failPublish = true;

      expect(() => {
        RealtimeAccessChanges.announce({
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: USER,
        });
      }).not.toThrow();

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      expect(forgetUser).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    test("a step that fails here is logged, not thrown", () => {
      mockForgetBlockedStatus.mockImplementation(() => {
        throw new Error("cache unavailable");
      });

      expect(() => {
        RealtimeAccessChanges.announce({
          kind: RealtimeAccessChangeKind.AccountChanged,
          userId: USER,
        });
      }).not.toThrow();

      expect(logger.error).toHaveBeenCalled();
      // The others are still told.
      expect(client.published).toHaveLength(1);
    });
  });

  describe("listening for the changes other servers announce", () => {
    test("listens on its own connection, to the one channel, once", async () => {
      await RealtimeAccessChanges.listen();
      await RealtimeAccessChanges.listen();

      expect(client.subscriber.subscribed).toEqual([
        RealtimeAccessChanges.CHANNEL,
      ]);
      expect(GracefulShutdown.registerHandler).toHaveBeenCalledTimes(1);
    });

    test("a change another server announced is applied here", async () => {
      await RealtimeAccessChanges.listen();

      client.subscriber.deliver(
        RealtimeAccessChanges.CHANNEL,
        JSON.stringify({
          origin: "another-server",
          change: {
            kind: RealtimeAccessChangeKind.SessionsEnded,
            sessionIds: [SESSION],
          },
        }),
      );

      expect(endWhere).toHaveBeenCalledWith({
        userId: undefined,
        sessionIds: [SESSION],
      });
    });

    test("this server's own announcement is not applied a second time", async () => {
      await RealtimeAccessChanges.listen();

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        sessionIds: [SESSION],
      });

      expect(endWhere).toHaveBeenCalledTimes(1);

      // Valkey hands the server its own message back.
      client.subscriber.deliver(
        RealtimeAccessChanges.CHANNEL,
        client.published[0]!.message,
      );

      expect(endWhere).toHaveBeenCalledTimes(1);
      expect(client.originOfLastMessage()).not.toBe("another-server");
    });

    test("other channels, and messages that are not changes, are ignored", async () => {
      await RealtimeAccessChanges.listen();

      const ignored: Array<string> = [
        "not json",
        JSON.stringify(null),
        JSON.stringify({ origin: "x" }),
        JSON.stringify({ origin: "x", change: { kind: "Unknown" } }),
        JSON.stringify({
          origin: "x",
          change: {
            kind: RealtimeAccessChangeKind.PermissionsChanged,
            userId: "not-an-id",
          },
        }),
        JSON.stringify({
          origin: "x",
          change: {
            kind: RealtimeAccessChangeKind.PermissionsChanged,
            userId: USER,
            projectId: 42,
          },
        }),
        JSON.stringify({
          origin: "x",
          change: { kind: RealtimeAccessChangeKind.AccountChanged },
        }),
        JSON.stringify({
          origin: "x",
          change: { kind: RealtimeAccessChangeKind.SessionsEnded },
        }),
        JSON.stringify({
          origin: "x",
          change: {
            kind: RealtimeAccessChangeKind.SessionsEnded,
            sessionIds: [SESSION, "not-an-id"],
          },
        }),
        JSON.stringify({
          origin: "x",
          change: {
            kind: RealtimeAccessChangeKind.SessionsEnded,
            sessionIds: SESSION,
          },
        }),
      ];

      for (const message of ignored) {
        client.subscriber.deliver(RealtimeAccessChanges.CHANNEL, message);
      }

      client.subscriber.deliver(
        "some-other-channel",
        JSON.stringify({
          origin: "x",
          change: { kind: RealtimeAccessChangeKind.SessionsEnded, userId: USER },
        }),
      );

      expect(endWhere).not.toHaveBeenCalled();
      expect(forgetUser).not.toHaveBeenCalled();
      expect(mockForgetBlockedStatus).not.toHaveBeenCalled();
    });

    test("without Valkey it does not listen, and does not throw", async () => {
      (Redis.getClient as unknown as jest.Mock).mockReturnValue(null);

      await expect(RealtimeAccessChanges.listen()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalled();
    });

    test("a subscription that fails is logged, its connection closed, and it does not throw", async () => {
      client.subscriber.failSubscribe = true;

      await expect(RealtimeAccessChanges.listen()).resolves.toBeUndefined();

      expect(client.subscriber.disconnected).toBe(true);
      expect(logger.error).toHaveBeenCalled();
    });

    test("stopping closes the connection", async () => {
      await RealtimeAccessChanges.listen();
      await RealtimeAccessChanges.stopListening();

      expect(client.subscriber.disconnected).toBe(true);
    });
  });
});
