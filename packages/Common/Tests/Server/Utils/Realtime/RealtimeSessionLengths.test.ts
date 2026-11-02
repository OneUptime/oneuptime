import Redis from "../../../../Server/Infrastructure/Redis";
import GracefulShutdown from "../../../../Server/Utils/GracefulShutdown";
import logger from "../../../../Server/Utils/Logger";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../../../../Server/Utils/Realtime/RealtimeAccessChanges";
import RealtimeJoinAccess from "../../../../Server/Utils/Realtime/RealtimeJoinAccess";
import RealtimeSessions, {
  RealtimeSessionFacts,
  RealtimeSessionSocket,
  RealtimeSocketSession,
  SESSION_OF_SOCKET_KEY,
} from "../../../../Server/Utils/Realtime/RealtimeSessions";
import JSONWebTokenData from "../../../../Types/JsonWebTokenData";
import EventName from "../../../../Types/Realtime/EventName";
import { SessionLengths } from "../../../../Types/UserSession/SessionLength";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../../Enterprise/FakeEnterpriseModule";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * HOW LONG A SIGN-IN LASTS, FOR THE REALTIME SOCKET (RealtimeSessions,
 * RealtimeJoinAccess, RealtimeAccessChanges, Types/UserSession/
 * SessionLength.ts).
 *
 * A socket's live updates belong to the session its handshake carried,
 * and they end when it does:
 *
 *   - a join keeps, with the session, what its end is counted from - when
 *     it signed in, when its person was last active, whether it is SSO -
 *     and ends its live updates at its access token's expiry or the end of
 *     its session under the lengths, whichever comes first;
 *   - when a master admin shortens the lengths (SessionLengthsChanged, on
 *     every server), each server ends its sockets whose session they have
 *     already ended, and ends the others when they do, asking each to
 *     renew a minute before; a longer length changes nothing: the token
 *     ends first anyway, and its renewal is asked afresh;
 *   - a socket whose token says nothing of its session (an earlier
 *     release's) ends with its token.
 */

const USER: string = "71717171-7171-4171-8171-717171717171";
const SESSION: string = "72727272-7272-4272-8272-727272727272";
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

type Listener = () => void;

let nextId: number = 1;

class FakeSocket implements RealtimeSessionSocket {
  public id: string = `session-length-socket-${nextId++}`;
  public data: unknown = undefined;
  public rooms: Set<string> = new Set<string>([this.id, "a-project-room"]);
  public emitted: Array<string> = [];
  public connected: boolean = true;

  public leave(room: string): void {
    this.rooms.delete(room);
  }

  public emit(event: string): boolean {
    this.emitted.push(event);
    return true;
  }

  public on(_event: "disconnect", _listener: Listener): unknown {
    return this;
  }
}

const lengths: (
  standard: { length?: number | null; idle?: number | null },
  sso?: { length?: number | null; idle?: number | null },
) => SessionLengths = (
  standard: { length?: number | null; idle?: number | null },
  sso?: { length?: number | null; idle?: number | null },
): SessionLengths => {
  const ssoRule: { length?: number | null; idle?: number | null } =
    sso || standard;

  return {
    standard: {
      lengthInMinutes: standard.length ?? null,
      idleTimeoutInMinutes: standard.idle ?? null,
    },
    sso: {
      lengthInMinutes: ssoRule.length ?? null,
      idleTimeoutInMinutes: ssoRule.idle ?? null,
    },
  };
};

const joined: (data: {
  now: number;
  signedInAgoMs?: number | undefined;
  lastActiveAgoMs?: number | undefined;
  isSsoSignIn?: boolean | undefined;
  tokenLeftMs?: number | undefined;
  withFacts?: boolean | undefined;
}) => { socket: FakeSocket; session: RealtimeSocketSession } = (data: {
  now: number;
  signedInAgoMs?: number | undefined;
  lastActiveAgoMs?: number | undefined;
  isSsoSignIn?: boolean | undefined;
  tokenLeftMs?: number | undefined;
  withFacts?: boolean | undefined;
}): { socket: FakeSocket; session: RealtimeSocketSession } => {
  const socket: FakeSocket = new FakeSocket();
  const facts: RealtimeSessionFacts = {
    signedInAtMs: data.now - (data.signedInAgoMs ?? 0),
    lastActiveAtMs: data.now - (data.lastActiveAgoMs ?? 0),
    isSsoSignIn: Boolean(data.isSsoSignIn),
  };
  const session: RealtimeSocketSession = {
    userId: USER,
    isMasterAdmin: false,
    sessionId: SESSION,
    expiresAtMs: data.now + (data.tokenLeftMs ?? 15 * MINUTE),
    ...(data.withFacts === false ? {} : { sessionFacts: facts }),
  };

  RealtimeSessions.begin(socket, session);

  return { socket, session };
};

beforeEach(() => {
  RealtimeSessions.clear();
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(() => {
  RealtimeSessions.clear();
  uninstallEnterpriseModule();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("what a socket keeps of its session", () => {
  test("its facts are kept on the socket, as plain JSON, and read back by every delivery", () => {
    const now: number = Date.now();
    const { socket, session } = joined({
      now,
      signedInAgoMs: HOUR,
      lastActiveAgoMs: MINUTE,
      isSsoSignIn: true,
    });

    expect(
      (socket.data as Record<string, Record<string, unknown>>)[
        SESSION_OF_SOCKET_KEY
      ]!["sessionFacts"],
    ).toEqual({
      signedInAtMs: now - HOUR,
      lastActiveAtMs: now - MINUTE,
      isSsoSignIn: true,
    });
    expect(RealtimeSessions.getSession(socket)).toEqual(session);
  });

  test("a socket without facts keeps none, as before", () => {
    const { socket } = joined({ now: Date.now(), withFacts: false });

    expect(
      (socket.data as Record<string, Record<string, unknown>>)[
        SESSION_OF_SOCKET_KEY
      ]!["sessionFacts"],
    ).toBeUndefined();
    expect(RealtimeSessions.getSession(socket)?.sessionFacts).toBeUndefined();
  });

  test("facts that are not facts are none", () => {
    for (const value of [
      null,
      "facts",
      {},
      { signedInAtMs: "1", lastActiveAtMs: 1 },
      { signedInAtMs: 1, lastActiveAtMs: Number.NaN },
      { signedInAtMs: -5, lastActiveAtMs: 10 },
    ]) {
      expect(RealtimeSessions.readSessionFacts(value)).toBeUndefined();
    }

    expect(
      RealtimeSessions.readSessionFacts({
        signedInAtMs: 10,
        lastActiveAtMs: 20,
        isSsoSignIn: "yes",
      }),
    ).toEqual({ signedInAtMs: 10, lastActiveAtMs: 20, isSsoSignIn: false });
  });
});

describe("RealtimeSessions.applySessionLengths: a change of the lengths reaches the sockets", () => {
  test("a socket whose session the new lengths have already ended ends now, and is told so", () => {
    const now: number = Date.now();
    const { socket } = joined({ now, signedInAgoMs: 2 * HOUR });

    expect(
      RealtimeSessions.applySessionLengths(lengths({ length: 60 }), now),
    ).toBe(1);

    expect(RealtimeSessions.getSession(socket)).toBeNull();
    expect(RealtimeSessions.hasEnded(socket)).toBe(true);
    expect(socket.emitted).toEqual([EventName.AuthenticationRequired]);
    expect(Array.from(socket.rooms)).toEqual([socket.id]);
  });

  test("a socket whose session ends before its token now hears only until then, asked to renew a minute before", () => {
    jest.useFakeTimers();
    const now: number = Date.now();
    // Signed in 55 minutes ago: an hour-long session ends in 5, its token in 15.
    const { socket } = joined({ now, signedInAgoMs: 55 * MINUTE });

    expect(
      RealtimeSessions.applySessionLengths(lengths({ length: 60 }), now),
    ).toBe(1);
    expect(RealtimeSessions.getSession(socket)?.expiresAtMs).toBe(
      now + 5 * MINUTE,
    );

    jest.advanceTimersByTime(4 * MINUTE + 1000);
    expect(socket.emitted).toEqual([EventName.SessionExpiring]);
    expect(RealtimeSessions.getSession(socket)).not.toBeNull();

    jest.advanceTimersByTime(MINUTE);
    expect(RealtimeSessions.hasEnded(socket)).toBe(true);
    expect(socket.emitted).toEqual([
      EventName.SessionExpiring,
      EventName.AuthenticationRequired,
    ]);
  });

  test("an idle timeout counts from the activity the token says", () => {
    const now: number = Date.now();
    const idle: { socket: FakeSocket } = joined({
      now,
      signedInAgoMs: 3 * HOUR,
      lastActiveAgoMs: 40 * MINUTE,
    });
    const active: { socket: FakeSocket } = joined({
      now,
      signedInAgoMs: 3 * HOUR,
      lastActiveAgoMs: 2 * MINUTE,
    });

    RealtimeSessions.applySessionLengths(lengths({ idle: 30 }), now);

    expect(RealtimeSessions.hasEnded(idle.socket)).toBe(true);
    expect(RealtimeSessions.hasEnded(active.socket)).toBe(false);
  });

  test("an SSO sign-in is held to the SSO lengths", () => {
    const now: number = Date.now();
    const sso: { socket: FakeSocket } = joined({
      now,
      signedInAgoMs: 2 * HOUR,
      isSsoSignIn: true,
    });
    const password: { socket: FakeSocket } = joined({
      now,
      signedInAgoMs: 2 * HOUR,
    });

    RealtimeSessions.applySessionLengths(
      lengths({ length: 60 }, { length: 12 * 60 }),
      now,
    );

    expect(RealtimeSessions.hasEnded(sso.socket)).toBe(false);
    expect(RealtimeSessions.hasEnded(password.socket)).toBe(true);
  });

  test("a longer length, or none, changes nothing: the token still ends first", () => {
    const now: number = Date.now();
    const { socket, session } = joined({ now, signedInAgoMs: 2 * HOUR });

    expect(
      RealtimeSessions.applySessionLengths(lengths({ length: 8 * 60 }), now),
    ).toBe(0);
    expect(RealtimeSessions.applySessionLengths(null, now)).toBe(0);
    expect(RealtimeSessions.getSession(socket)?.expiresAtMs).toBe(
      session.expiresAtMs,
    );
  });

  test("a socket whose token says nothing of its session is left to its token", () => {
    const now: number = Date.now();
    const { socket } = joined({ now, withFacts: false });

    expect(
      RealtimeSessions.applySessionLengths(lengths({ length: 15 }), now),
    ).toBe(0);
    expect(RealtimeSessions.hasEnded(socket)).toBe(false);
  });
});

describe("RealtimeJoinAccess: what a join reads of a session's end", () => {
  test("the facts come from the token's claims; a token without them gives none", () => {
    expect(
      RealtimeJoinAccess.getSessionFacts({
        isGlobalLogin: false,
        signedInAtMs: 1000,
        lastActiveAtMs: 5000,
      } as JSONWebTokenData),
    ).toEqual({ signedInAtMs: 1000, lastActiveAtMs: 5000, isSsoSignIn: true });

    expect(
      RealtimeJoinAccess.getSessionFacts({
        isGlobalLogin: true,
        signedInAtMs: 1000,
      } as JSONWebTokenData),
    ).toEqual({ signedInAtMs: 1000, lastActiveAtMs: 1000, isSsoSignIn: false });

    expect(
      RealtimeJoinAccess.getSessionFacts({
        isGlobalLogin: true,
      } as JSONWebTokenData),
    ).toBeUndefined();
  });

  test("the session's end under the lengths, as Date.now() counts", () => {
    const facts: RealtimeSessionFacts = {
      signedInAtMs: 1_000_000,
      lastActiveAtMs: 1_000_000 + HOUR,
      isSsoSignIn: false,
    };

    expect(
      RealtimeJoinAccess.getSessionEndsAtMs(facts, lengths({ length: 90 })),
    ).toBe(1_000_000 + 90 * MINUTE);
    expect(
      RealtimeJoinAccess.getSessionEndsAtMs(facts, lengths({ idle: 15 })),
    ).toBe(1_000_000 + HOUR + 15 * MINUTE);
    // With none, 30 days after the last activity.
    expect(RealtimeJoinAccess.getSessionEndsAtMs(facts, null)).toBe(
      1_000_000 + HOUR + 30 * 24 * HOUR,
    );
  });
});

describe("RealtimeAccessChanges: SessionLengthsChanged", () => {
  let fake: FakeEnterpriseModule;

  beforeEach(() => {
    fake = installFakeEnterpriseModule({ userSessionLengths: null });
    jest.spyOn(Redis, "getClient").mockReturnValue(null);
    jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
      // Not under test.
    });
  });

  afterEach(() => {
    RealtimeAccessChanges.onSessionLengthsChanged(null);
  });

  test("this server forgets the lengths it holds, then holds its sockets to the new ones", () => {
    const order: Array<string> = [];

    fake.forgetUserSessionLengths = (): void => {
      order.push("forget");
    };
    RealtimeAccessChanges.onSessionLengthsChanged((): void => {
      order.push("sockets");
    });

    RealtimeAccessChanges.apply({
      kind: RealtimeAccessChangeKind.SessionLengthsChanged,
    });

    expect(order).toEqual(["forget", "sockets"]);
  });

  test("announcing the change applies it here at once, even without Valkey", () => {
    let socketsHeld: number = 0;

    RealtimeAccessChanges.onSessionLengthsChanged((): void => {
      socketsHeld++;
    });

    RealtimeAccessChanges.announce({
      kind: RealtimeAccessChangeKind.SessionLengthsChanged,
    });

    expect(fake.forgetUserSessionLengthsCount).toBe(1);
    expect(socketsHeld).toBe(1);
  });

  test("without a listener (a server holding no sockets) it only forgets", () => {
    RealtimeAccessChanges.onSessionLengthsChanged(null);

    expect(() => {
      RealtimeAccessChanges.apply({
        kind: RealtimeAccessChangeKind.SessionLengthsChanged,
      });
    }).not.toThrow();
    expect(fake.forgetUserSessionLengthsCount).toBe(1);
  });
});
