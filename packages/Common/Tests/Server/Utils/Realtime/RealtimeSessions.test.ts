import RealtimeSessions, {
  RealtimeSessionSocket,
  RealtimeSocketSession,
  SESSION_ENDED_KEY,
  SESSION_OF_SOCKET_KEY,
} from "../../../../Server/Utils/Realtime/RealtimeSessions";
import EventName from "../../../../Types/Realtime/EventName";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The session a socket's live updates belong to: kept on the socket when a
 * join is allowed, read by every delivery, ended when its access token
 * expires (a timer per socket, which first asks the page to renew a minute
 * before) or when the session ends (endWhere), and remembered for a while
 * once ended, so a join decided meanwhile, or made later with a token
 * issued before the end, is refused.
 */

const USER: string = "11111111-1111-4111-8111-111111111111";
const OTHER_USER: string = "22222222-2222-4222-8222-222222222222";
const SESSION: string = "33333333-3333-4333-8333-333333333333";
const OTHER_SESSION: string = "44444444-4444-4444-8444-444444444444";

type Listener = () => void;

let nextId: number = 1;

class FakeSocket implements RealtimeSessionSocket {
  public id: string = `socket-${nextId++}`;
  public data: unknown = undefined;
  public rooms: Set<string> = new Set<string>([this.id]);
  public emitted: Array<{ event: string; payload: unknown }> = [];
  public disconnectListeners: Array<Listener> = [];

  public constructor(rooms: Array<string> = []) {
    for (const room of rooms) {
      this.rooms.add(room);
    }
  }

  public leave(room: string): void {
    this.rooms.delete(room);
  }

  public emit(event: string, payload: unknown): boolean {
    this.emitted.push({ event: event, payload: payload });
    return true;
  }

  public on(_event: "disconnect", listener: Listener): unknown {
    this.disconnectListeners.push(listener);
    return this;
  }

  public goAway(): void {
    for (const listener of this.disconnectListeners) {
      listener();
    }
  }

  public subscribedRooms(): Array<string> {
    return Array.from(this.rooms).filter((room: string): boolean => {
      return room !== this.id;
    });
  }
}

function session(
  overrides: Partial<RealtimeSocketSession> = {},
): RealtimeSocketSession {
  return {
    userId: USER,
    isMasterAdmin: false,
    sessionId: SESSION,
    expiresAtMs: Date.now() + 15 * 60 * 1000,
    ...overrides,
  };
}

describe("RealtimeSessions", () => {
  beforeEach(() => {
    RealtimeSessions.clear();
  });

  afterEach(() => {
    RealtimeSessions.clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("the session a delivery reads off a socket", () => {
    test("a socket that never joined has none", () => {
      expect(RealtimeSessions.getSession({ data: undefined })).toBeNull();
      expect(RealtimeSessions.getSession({ data: {} })).toBeNull();
      expect(RealtimeSessions.getSession({ data: "text" })).toBeNull();
    });

    test("a joined socket has the session it joined with", () => {
      const socket: FakeSocket = new FakeSocket();
      const joined: RealtimeSocketSession = session();

      RealtimeSessions.begin(socket, joined);

      expect(RealtimeSessions.getSession(socket)).toEqual(joined);
      expect(socket.data).toEqual({
        [SESSION_OF_SOCKET_KEY]: {
          userId: USER,
          isMasterAdmin: false,
          sessionId: SESSION,
          expiresAtMs: joined.expiresAtMs,
        },
      });
    });

    test("what else the socket keeps is kept", () => {
      const socket: FakeSocket = new FakeSocket();
      socket.data = { somethingElse: 1 };

      RealtimeSessions.begin(socket, session());

      expect(socket.data).toEqual(
        expect.objectContaining({ somethingElse: 1 }),
      );
    });

    test("past its access token's expiry it has none, even before the timer", () => {
      const expiresAtMs: number = Date.now() + 1000;
      const socket: FakeSocket = new FakeSocket();

      RealtimeSessions.begin(socket, session({ expiresAtMs }));

      expect(
        RealtimeSessions.getSession(socket, expiresAtMs - 1),
      ).not.toBeNull();
      expect(RealtimeSessions.getSession(socket, expiresAtMs)).toBeNull();
      expect(RealtimeSessions.getSession(socket, expiresAtMs + 1)).toBeNull();
    });

    test("one without an expiry, a user, or of the wrong shape is none (fails closed)", () => {
      expect(
        RealtimeSessions.getSession({
          data: { [SESSION_OF_SOCKET_KEY]: { userId: USER } },
        }),
      ).toBeNull();
      expect(
        RealtimeSessions.getSession({
          data: {
            [SESSION_OF_SOCKET_KEY]: {
              userId: USER,
              expiresAtMs: "later",
            },
          },
        }),
      ).toBeNull();
      expect(
        RealtimeSessions.getSession({
          data: {
            [SESSION_OF_SOCKET_KEY]: {
              userId: "",
              expiresAtMs: Date.now() + 1000,
            },
          },
        }),
      ).toBeNull();
      expect(
        RealtimeSessions.getSession({
          data: {
            [SESSION_OF_SOCKET_KEY]: {
              userId: USER,
              expiresAtMs: Number.POSITIVE_INFINITY,
            },
          },
        }),
      ).toBeNull();
    });

    test("an ended session is none, whatever is left on the socket", () => {
      expect(
        RealtimeSessions.getSession({
          data: {
            [SESSION_ENDED_KEY]: true,
            [SESSION_OF_SOCKET_KEY]: {
              userId: USER,
              isMasterAdmin: false,
              expiresAtMs: Date.now() + 1000,
            },
          },
        }),
      ).toBeNull();
    });

    test("only a real true makes a server admin", () => {
      expect(
        RealtimeSessions.getSession({
          data: {
            [SESSION_OF_SOCKET_KEY]: {
              userId: USER,
              isMasterAdmin: "true",
              expiresAtMs: Date.now() + 1000,
            },
          },
        })?.isMasterAdmin,
      ).toBe(false);
    });
  });

  describe("ending one socket's live updates", () => {
    test("it leaves every room it joined, is no longer anyone, joins nothing more, and is told once", () => {
      const socket: FakeSocket = new FakeSocket(["room-a", "room-b"]);

      RealtimeSessions.begin(socket, session());
      RealtimeSessions.end(socket);

      expect(socket.subscribedRooms()).toEqual([]);
      expect(socket.rooms.has(socket.id)).toBe(true);
      expect(RealtimeSessions.getSession(socket)).toBeNull();
      expect(RealtimeSessions.hasEnded(socket)).toBe(true);
      expect(socket.emitted).toEqual([
        { event: EventName.AuthenticationRequired, payload: {} },
      ]);
      expect(RealtimeSessions.size()).toBe(0);

      // Ending it again changes nothing and tells nobody twice.
      RealtimeSessions.end(socket);

      expect(socket.emitted).toHaveLength(1);
    });

    test("a room that cannot be left is logged, and the rest are still left", () => {
      const socket: FakeSocket = new FakeSocket(["room-a", "room-b"]);
      jest.spyOn(socket, "leave").mockImplementation((room: string): void => {
        if (room === "room-a") {
          throw new Error("adapter down");
        }

        socket.rooms.delete(room);
      });

      RealtimeSessions.begin(socket, session());
      RealtimeSessions.end(socket);

      expect(socket.subscribedRooms()).toEqual(["room-a"]);
      // Whatever rooms are left, the socket hears nothing: it is no longer anyone.
      expect(RealtimeSessions.getSession(socket)).toBeNull();
    });
  });

  describe("the access token's expiry", () => {
    test("a minute before it, the page is asked to renew; the socket still hears until it comes, and then its live updates end", () => {
      jest.useFakeTimers({ now: 1_000_000 });

      const socket: FakeSocket = new FakeSocket(["room-a"]);
      const expiresAtMs: number = 1_000_000 + 5 * 60_000;

      RealtimeSessions.begin(socket, session({ expiresAtMs }));

      jest.advanceTimersByTime(4 * 60_000 - 1);

      expect(socket.emitted).toEqual([]);

      jest.advanceTimersByTime(1);

      expect(socket.emitted).toEqual([
        { event: EventName.SessionExpiring, payload: {} },
      ]);
      // Being asked takes nothing away.
      expect(socket.subscribedRooms()).toEqual(["room-a"]);
      expect(RealtimeSessions.getSession(socket)?.expiresAtMs).toBe(
        expiresAtMs,
      );

      jest.advanceTimersByTime(RealtimeSessions.RENEWAL_NOTICE_IN_MS - 1);

      expect(socket.subscribedRooms()).toEqual(["room-a"]);
      expect(socket.emitted).toHaveLength(1);

      jest.advanceTimersByTime(1);

      expect(socket.subscribedRooms()).toEqual([]);
      expect(socket.emitted).toEqual([
        { event: EventName.SessionExpiring, payload: {} },
        { event: EventName.AuthenticationRequired, payload: {} },
      ]);
      expect(RealtimeSessions.size()).toBe(0);
    });

    test("a socket that joins with less than a minute left is asked to renew at once", () => {
      jest.useFakeTimers({ now: 1_000_000 });

      const socket: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(
        socket,
        session({ expiresAtMs: 1_000_000 + 30_000 }),
      );

      jest.advanceTimersByTime(0);

      expect(socket.emitted).toEqual([
        { event: EventName.SessionExpiring, payload: {} },
      ]);
      expect(socket.subscribedRooms()).toEqual(["room-a"]);

      jest.advanceTimersByTime(30_000);

      expect(socket.subscribedRooms()).toEqual([]);
    });

    test("the page is asked to renew once, however often the socket joins", () => {
      jest.useFakeTimers({ now: 0 });

      const socket: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(socket, session({ expiresAtMs: 5 * 60_000 }));
      jest.advanceTimersByTime(4 * 60_000 + 1_000);
      RealtimeSessions.begin(socket, session({ expiresAtMs: 5 * 60_000 }));
      RealtimeSessions.begin(socket, session({ expiresAtMs: 5 * 60_000 }));
      jest.advanceTimersByTime(30_000);

      expect(
        socket.emitted.filter((emitted: { event: string }): boolean => {
          return emitted.event === EventName.SessionExpiring;
        }),
      ).toHaveLength(1);
    });

    test("a page that renews in time takes this socket away first, and it is never ended", () => {
      jest.useFakeTimers({ now: 0 });

      const socket: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(socket, session({ expiresAtMs: 5 * 60_000 }));
      jest.advanceTimersByTime(4 * 60_000);

      expect(socket.emitted).toEqual([
        { event: EventName.SessionExpiring, payload: {} },
      ]);

      // The page reconnects: this socket goes, its new one joins afresh.
      socket.goAway();
      jest.advanceTimersByTime(10 * 60_000);

      expect(socket.emitted).toHaveLength(1);
      expect(RealtimeSessions.hasEnded(socket)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    test("an access token that has already expired ends at once, with nothing to renew", () => {
      jest.useFakeTimers({ now: 1_000_000 });

      const socket: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(socket, session({ expiresAtMs: 999_000 }));
      jest.advanceTimersByTime(0);

      expect(socket.subscribedRooms()).toEqual([]);
      expect(socket.emitted).toEqual([
        { event: EventName.AuthenticationRequired, payload: {} },
      ]);
    });

    test("an expiry further away than one timer can wait is waited for in steps", () => {
      jest.useFakeTimers({ now: 0 });

      const expiresAtMs: number = RealtimeSessions.MAX_TIMER_DELAY_IN_MS * 2;
      const socket: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(socket, session({ expiresAtMs }));

      jest.advanceTimersByTime(RealtimeSessions.MAX_TIMER_DELAY_IN_MS);

      expect(socket.subscribedRooms()).toEqual(["room-a"]);
      expect(jest.getTimerCount()).toBe(1);

      jest.advanceTimersByTime(RealtimeSessions.MAX_TIMER_DELAY_IN_MS);

      expect(socket.subscribedRooms()).toEqual([]);
      expect(jest.getTimerCount()).toBe(0);
    });

    test("a second join that expires earlier moves the end earlier; one that expires later does not move it", () => {
      jest.useFakeTimers({ now: 0 });

      const socket: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(socket, session({ expiresAtMs: 60_000 }));
      RealtimeSessions.begin(socket, session({ expiresAtMs: 120_000 }));

      expect(RealtimeSessions.getSession(socket)?.expiresAtMs).toBe(60_000);

      RealtimeSessions.begin(socket, session({ expiresAtMs: 30_000 }));

      expect(jest.getTimerCount()).toBe(1);
      expect(socket.disconnectListeners).toHaveLength(1);

      jest.advanceTimersByTime(30_000);

      expect(socket.subscribedRooms()).toEqual([]);
    });

    test("a socket that went away before its join was kept is not tracked: no timer, no entry", () => {
      jest.useFakeTimers({ now: 0 });

      const gone: FakeSocket = new FakeSocket(["room-a"]);
      (gone as unknown as { connected: boolean }).connected = false;

      RealtimeSessions.begin(gone, session({ expiresAtMs: 60_000 }));

      expect(RealtimeSessions.size()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      expect(gone.disconnectListeners).toHaveLength(0);
    });

    test("a socket that goes away stops its timer, and nothing is sent to it later", () => {
      jest.useFakeTimers({ now: 0 });

      const socket: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(socket, session({ expiresAtMs: 60_000 }));
      socket.goAway();

      expect(RealtimeSessions.size()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);

      jest.advanceTimersByTime(120_000);

      expect(socket.emitted).toEqual([]);
    });
  });

  describe("ending sessions on this server (endWhere)", () => {
    test("ends the sockets of the named sessions, whatever the case of the ids, and no others", () => {
      const ofSession: FakeSocket = new FakeSocket(["room-a"]);
      const sameSessionOtherTab: FakeSocket = new FakeSocket(["room-a"]);
      const ofOtherSession: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(ofSession, session());
      RealtimeSessions.begin(sameSessionOtherTab, session());
      RealtimeSessions.begin(
        ofOtherSession,
        session({ sessionId: OTHER_SESSION }),
      );

      expect(
        RealtimeSessions.endWhere({ sessionIds: [SESSION.toUpperCase()] }),
      ).toBe(2);

      expect(ofSession.subscribedRooms()).toEqual([]);
      expect(sameSessionOtherTab.subscribedRooms()).toEqual([]);
      expect(ofOtherSession.subscribedRooms()).toEqual(["room-a"]);
      expect(RealtimeSessions.size()).toBe(1);
    });

    test("ends every socket of a person, including one whose token named no session", () => {
      const first: FakeSocket = new FakeSocket(["room-a"]);
      const noSession: FakeSocket = new FakeSocket(["room-a"]);
      const someoneElse: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(first, session());
      RealtimeSessions.begin(noSession, session({ sessionId: undefined }));
      RealtimeSessions.begin(
        someoneElse,
        session({ userId: OTHER_USER, sessionId: OTHER_SESSION }),
      );

      expect(RealtimeSessions.endWhere({ userId: USER })).toBe(2);

      expect(first.subscribedRooms()).toEqual([]);
      expect(noSession.subscribedRooms()).toEqual([]);
      expect(someoneElse.subscribedRooms()).toEqual(["room-a"]);
    });

    test("naming nothing ends nothing", () => {
      const socket: FakeSocket = new FakeSocket(["room-a"]);

      RealtimeSessions.begin(socket, session());

      expect(RealtimeSessions.endWhere({})).toBe(0);
      expect(RealtimeSessions.endWhere({ sessionIds: [] })).toBe(0);
      expect(socket.subscribedRooms()).toEqual(["room-a"]);
      expect(RealtimeSessions.endedSize()).toBe(0);
    });
  });

  describe("an ended session is remembered", () => {
    test("a session that ended refuses any token of its own, whenever it was issued", () => {
      RealtimeSessions.endWhere({ sessionIds: [SESSION] });

      expect(
        RealtimeSessions.wasEnded({
          userId: USER,
          sessionId: SESSION,
          issuedAtMs: Date.now() + 60_000,
        }),
      ).toBe(true);
      expect(
        RealtimeSessions.wasEnded({
          userId: USER,
          sessionId: OTHER_SESSION,
          issuedAtMs: Date.now() - 60_000,
        }),
      ).toBe(false);
    });

    test("every session of a person ending refuses tokens issued before it, not after", () => {
      jest.useFakeTimers({ now: 10_000_000 });

      RealtimeSessions.endWhere({ userId: USER });

      expect(
        RealtimeSessions.wasEnded({
          userId: USER,
          sessionId: SESSION,
          issuedAtMs: 10_000_000 - 1000,
        }),
      ).toBe(true);
      expect(
        RealtimeSessions.wasEnded({
          userId: USER,
          sessionId: SESSION,
          issuedAtMs: 10_000_000 + 1000,
        }),
      ).toBe(false);
      expect(
        RealtimeSessions.wasEnded({
          userId: OTHER_USER,
          issuedAtMs: 10_000_000 - 1000,
        }),
      ).toBe(false);
    });

    test("is forgotten after ENDED_MEMORY_IN_MS, by when every token from before it has expired", () => {
      jest.useFakeTimers({ now: 0 });

      RealtimeSessions.endWhere({ sessionIds: [SESSION] });

      jest.setSystemTime(RealtimeSessions.ENDED_MEMORY_IN_MS);

      expect(
        RealtimeSessions.wasEnded({
          userId: USER,
          sessionId: SESSION,
          issuedAtMs: 0,
        }),
      ).toBe(true);

      jest.setSystemTime(RealtimeSessions.ENDED_MEMORY_IN_MS + 1);

      expect(
        RealtimeSessions.wasEnded({
          userId: USER,
          sessionId: SESSION,
          issuedAtMs: 0,
        }),
      ).toBe(false);
      expect(RealtimeSessions.endedSize()).toBe(0);
      expect(RealtimeSessions.ENDED_MEMORY_IN_MS).toBeGreaterThan(
        15 * 60 * 1000,
      );
    });

    test("holds at most MAX_ENDED_ENTRIES, the oldest going first", () => {
      const max: number = RealtimeSessions.MAX_ENDED_ENTRIES;

      for (let index: number = 0; index <= max; index++) {
        RealtimeSessions.endWhere({
          sessionIds: [
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          ],
        });
      }

      expect(RealtimeSessions.endedSize()).toBe(max);
      expect(
        RealtimeSessions.wasEnded({
          userId: USER,
          sessionId: "00000000-0000-4000-8000-000000000000",
          issuedAtMs: 0,
        }),
      ).toBe(false);
      expect(
        RealtimeSessions.wasEnded({
          userId: USER,
          sessionId: `00000000-0000-4000-8000-${String(max).padStart(12, "0")}`,
          issuedAtMs: 0,
        }),
      ).toBe(true);
    });
  });
});
