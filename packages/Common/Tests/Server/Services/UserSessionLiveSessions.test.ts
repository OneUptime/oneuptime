import UserSessionService, {
  ENDED_SESSION_CACHE_TTL_MS,
  LIVE_SESSION_CACHE_TTL_MS,
  Service as UserSessionServiceClass,
} from "../../../Server/Services/UserSessionService";
import UserService from "../../../Server/Services/UserService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import RealtimeAccessChanges, {
  RealtimeAccessChange,
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import User from "../../../Models/DatabaseModels/User";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import ObjectID from "../../../Types/ObjectID";
import {
  getSessionEndCauseRevokedReason,
  SessionEndCause,
} from "../../../Types/UserSession/SessionEndCause";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * ---------------------------------------------------------------------------
 * WHETHER THE SESSION AN ACCESS TOKEN NAMES IS STILL LIVE, ON EVERY REQUEST,
 * WITHOUT A DATABASE READ PER REQUEST (#9534).
 *
 * Signing out, revoking a session, a new password, a block and the session
 * lengths end a session in the database. Its access token is a stateless
 * JWT that lived on for up to 15 minutes after. Every request now asks
 * UserSessionService.isSessionLive, and this file pins what that costs and
 * how an end reaches it:
 *
 *   1. one primary-key read answers it, kept per server: a live session for
 *      LIVE_SESSION_CACHE_TTL_MS, an ended one for as long as any token of
 *      it can live - the requests in between touch no database;
 *   2. a session that is revoked, or deleted, is held as ended on the server
 *      that ended it at once, and on every other one when it hears of it
 *      (RealtimeAccessChanges, SessionsEnded);
 *   3. a read that fails is an error, never "live", and is not kept.
 *
 * No database: findOneById and the announcement's channel are stubbed (no
 * Valkey is connected, so nothing is sent), and the protected hooks are
 * reached through a cast. Every test uses sessions of its own, so what one
 * test leaves in the per-server cache never reaches another.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("61616161-6161-4161-8161-616161616161");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "62626262-6262-4262-8262-626262626262",
);

interface UserSessionServiceInternals {
  onUpdateSuccess: (
    onUpdate: OnUpdate<UserSession>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<UserSession>>;
  onDeleteSuccess: (
    onDelete: OnDelete<UserSession>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<UserSession>>;
}

interface UserServiceInternals {
  onDeleteSuccess: (
    onDelete: OnDelete<User>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<User>>;
}

function hooks(): UserSessionServiceInternals {
  return UserSessionService as unknown as UserSessionServiceInternals;
}

function storedSession(data: {
  id: ObjectID;
  userId?: ObjectID;
  isRevoked?: boolean;
}): UserSession {
  const session: UserSession = new UserSession();
  session.id = data.id;
  session.userId = data.userId || USER_ID;
  session.isRevoked = data.isRevoked === true;
  return session;
}

// A revocation, as revokeSessionById and the sweeps write it.
function revocationOf(sessionIds: Array<ObjectID>): OnUpdate<UserSession> {
  const updateBy: UpdateBy<UserSession> = {
    query: {
      _id: sessionIds[0]!.toString(),
    } as unknown as UpdateBy<UserSession>["query"],
    data: {
      isRevoked: true,
      revokedAt: new Date(),
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.SignedOut),
    } as unknown as UpdateBy<UserSession>["data"],
    props: { isRoot: true },
    limit: sessionIds.length,
    skip: 0,
  };

  return { updateBy, carryForward: null };
}

function deletionOf(sessionIds: Array<ObjectID>): OnDelete<UserSession> {
  const deleteBy: DeleteBy<UserSession> = {
    query: {
      _id: sessionIds[0]!.toString(),
    } as unknown as DeleteBy<UserSession>["query"],
    props: { isRoot: true },
    limit: sessionIds.length,
    skip: 0,
  };

  return { deleteBy, carryForward: null };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;

  const promise: Promise<T> = new Promise<T>((res: (value: T) => void) => {
    resolve = res;
  });

  return { promise, resolve };
}

// What another server publishes on the access change channel.
function messageFromAnotherServer(change: RealtimeAccessChange): string {
  return JSON.stringify({
    origin: ObjectID.generate().toString(),
    change: change,
  });
}

let findOneById: jest.SpyInstance;
let announced: Array<RealtimeAccessChange>;

beforeEach(() => {
  // Every session is live and the user's, unless a test says otherwise.
  findOneById = jest
    .spyOn(UserSessionService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      return storedSession({ id: data.id });
    }) as never);

  /*
   * What is announced to the other servers is recorded, and still applied
   * here as on every server.
   */
  announced = [];
  const announce: typeof RealtimeAccessChanges.announce =
    RealtimeAccessChanges.announce.bind(RealtimeAccessChanges);
  jest
    .spyOn(RealtimeAccessChanges, "announce")
    .mockImplementation((change: RealtimeAccessChange): void => {
      announced.push(change);
      announce(change);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserSessionService.isSessionLive", () => {
  test("reads the session's id, owner and whether it was revoked, by its id, as root", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(true);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledWith({
      id: new ObjectID(sessionId.toString()),
      select: { _id: true, userId: true, isRevoked: true },
      props: { isRoot: true },
    });
  });

  test("is false for a session that was revoked", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    findOneById.mockResolvedValue(
      storedSession({ id: sessionId, isRevoked: true }) as never,
    );

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
  });

  // Deleted with its person, or purged long after it ended.
  test("is false for a session that is not there", async () => {
    findOneById.mockResolvedValue(null as never);

    await expect(
      UserSessionService.isSessionLive({
        sessionId: ObjectID.generate(),
        userId: USER_ID,
      }),
    ).resolves.toBe(false);
  });

  // A token is signed by the server, but a session is only ever its own person's.
  test("is false for somebody else's session", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    findOneById.mockResolvedValue(
      storedSession({ id: sessionId, userId: OTHER_USER_ID }) as never,
    );

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
  });

  // Only the boolean false is a session that was not revoked.
  test.each([
    ["no value", undefined],
    ["null", null],
    ["the text 'false'", "false"],
  ])(
    "is false for a row whose isRevoked holds %s",
    async (_: string, value: unknown) => {
      const sessionId: ObjectID = ObjectID.generate();
      const session: UserSession = storedSession({ id: sessionId });
      (session as unknown as { isRevoked: unknown }).isRevoked = value;
      findOneById.mockResolvedValue(session as never);

      await expect(
        UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
      ).resolves.toBe(false);
    },
  );

  test("reads an id written in capitals as the same session", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await UserSessionService.isSessionLive({ sessionId, userId: USER_ID });

    await expect(
      UserSessionService.isSessionLive({
        sessionId: new ObjectID(sessionId.toString().toUpperCase()),
        userId: new ObjectID(USER_ID.toString().toUpperCase()),
      }),
    ).resolves.toBe(true);

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("shares one read between concurrent requests for the same session", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const row: Deferred<UserSession> = deferred<UserSession>();
    findOneById.mockReturnValue(row.promise as never);

    const answers: Promise<Array<boolean>> = Promise.all([
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ]);

    row.resolve(storedSession({ id: sessionId }));

    await expect(answers).resolves.toEqual([true, true, true]);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("keeps sessions apart", async () => {
    const liveSessionId: ObjectID = ObjectID.generate();
    const revokedSessionId: ObjectID = ObjectID.generate();

    findOneById.mockImplementation((async (data: { id: ObjectID }) => {
      return storedSession({
        id: data.id,
        isRevoked: data.id.toString() === revokedSessionId.toString(),
      });
    }) as never);

    await expect(
      UserSessionService.isSessionLive({
        sessionId: liveSessionId,
        userId: USER_ID,
      }),
    ).resolves.toBe(true);
    await expect(
      UserSessionService.isSessionLive({
        sessionId: revokedSessionId,
        userId: USER_ID,
      }),
    ).resolves.toBe(false);
  });

  // "We could not find out" must reach the caller, which refuses the request.
  test("rejects when the read fails, and does not keep the failure", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    findOneById.mockRejectedValueOnce(
      new Error("database unavailable") as never,
    );

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).rejects.toThrow("database unavailable");

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(true);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });
});

describe("the requests after the first touch no database", () => {
  test("a live session is answered from this server's memory, however many requests ask", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    for (let request: number = 0; request < 50; request++) {
      await expect(
        UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
      ).resolves.toBe(true);
    }

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("an ended session is too", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    findOneById.mockResolvedValue(
      storedSession({ id: sessionId, isRevoked: true }) as never,
    );

    for (let request: number = 0; request < 50; request++) {
      await expect(
        UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
      ).resolves.toBe(false);
    }

    expect(findOneById).toHaveBeenCalledTimes(1);
  });
});

describe("how long one server keeps what it read", () => {
  test("a live session for a minute: within it the row is not read again, after it it is", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const startedAt: number = Date.now();
    const now: jest.SpyInstance = jest.spyOn(Date, "now");

    now.mockReturnValue(startedAt);
    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(true);

    // Another server ended it, and this one was not told.
    findOneById.mockResolvedValue(
      storedSession({ id: sessionId, isRevoked: true }) as never,
    );

    now.mockReturnValue(startedAt + LIVE_SESSION_CACHE_TTL_MS - 1);
    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(true);
    expect(findOneById).toHaveBeenCalledTimes(1);

    now.mockReturnValue(startedAt + LIVE_SESSION_CACHE_TTL_MS + 1);
    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("an ended session for as long as any access token of it can live", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const startedAt: number = Date.now();
    const now: jest.SpyInstance = jest.spyOn(Date, "now");

    findOneById.mockResolvedValue(
      storedSession({ id: sessionId, isRevoked: true }) as never,
    );

    now.mockReturnValue(startedAt);
    await UserSessionService.isSessionLive({ sessionId, userId: USER_ID });

    now.mockReturnValue(startedAt + ENDED_SESSION_CACHE_TTL_MS - 1);
    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  // The bound on a server the end never reached: not the token's 15 minutes.
  test("a live session is kept a minute", () => {
    expect(LIVE_SESSION_CACHE_TTL_MS).toBe(60 * 1000);
  });

  test("an ended one as long as an access token lives", () => {
    expect(ENDED_SESSION_CACHE_TTL_MS).toBe(
      UserSessionServiceClass.ACCESS_TOKEN_LIFETIME_IN_SECONDS * 1000,
    );
  });
});

describe("a session that ends is refused at once, on this server and every other", () => {
  test("revoked here - a sign-out, a revocation, a new password, a sweep: refused without a read", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(true);

    await hooks().onUpdateSuccess(revocationOf([sessionId]), [sessionId]);

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("revoked here: every other server is told which sessions ended", async () => {
    const sessionIds: Array<ObjectID> = [
      ObjectID.generate(),
      ObjectID.generate(),
    ];

    await hooks().onUpdateSuccess(revocationOf(sessionIds), sessionIds);

    expect(announced).toEqual([
      {
        kind: RealtimeAccessChangeKind.SessionsEnded,
        sessionIds: sessionIds.map((sessionId: ObjectID): string => {
          return sessionId.toString();
        }),
      },
    ]);
  });

  test("deleted here: refused at once, and every other server is told", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await UserSessionService.isSessionLive({ sessionId, userId: USER_ID });

    await hooks().onDeleteSuccess(deletionOf([sessionId]), [sessionId]);

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(announced).toEqual([
      {
        kind: RealtimeAccessChangeKind.SessionsEnded,
        sessionIds: [sessionId.toString()],
      },
    ]);
  });

  // An update that is no revocation (a renewal, a touch) changes nothing.
  test("an update that does not revoke leaves the session live", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await UserSessionService.isSessionLive({ sessionId, userId: USER_ID });

    const touch: OnUpdate<UserSession> = revocationOf([sessionId]);
    touch.updateBy.data = {
      lastActiveAt: new Date(),
    } as unknown as UpdateBy<UserSession>["data"];

    await hooks().onUpdateSuccess(touch, [sessionId]);

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(true);
    expect(announced).toEqual([]);
  });

  /*
   * What another server does when it hears it: the announcement's message,
   * as it arrives from Valkey with another server's origin.
   */
  test("ended on another server: refused here as soon as this server hears it, without a read", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(true);

    RealtimeAccessChanges.receive(
      messageFromAnotherServer({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        sessionIds: [sessionId.toString()],
      }),
    );

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  /*
   * The read was on the wire when the session ended. Its answer still goes
   * to the request that asked, which was made before the end, but it is not
   * kept, or it would hide the end for a minute.
   */
  test("a read in flight while the session ends does not keep its answer", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const staleRow: Deferred<UserSession> = deferred<UserSession>();
    findOneById.mockReturnValueOnce(staleRow.promise as never);

    const inFlight: Promise<boolean> = UserSessionService.isSessionLive({
      sessionId,
      userId: USER_ID,
    });

    await hooks().onUpdateSuccess(revocationOf([sessionId]), [sessionId]);

    staleRow.resolve(storedSession({ id: sessionId }));
    await expect(inFlight).resolves.toBe(true);

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  /*
   * A session this server never read needs nothing kept: its next request
   * reads it, ended, from the database - and a sweep that ends thousands of
   * sessions fills no server's memory with them.
   */
  test("a session this server does not know of is read from the database at its next request", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    UserSessionService.forgetEndedSessions([sessionId]);

    findOneById.mockResolvedValue(
      storedSession({ id: sessionId, isRevoked: true }) as never,
    );

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("an end named in capitals reaches the session", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await UserSessionService.isSessionLive({ sessionId, userId: USER_ID });

    UserSessionService.forgetEndedSessions([
      sessionId.toString().toUpperCase(),
    ]);

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
  });

  test("only the sessions that ended", async () => {
    const endedSessionId: ObjectID = ObjectID.generate();
    const otherDeviceSessionId: ObjectID = ObjectID.generate();

    await UserSessionService.isSessionLive({
      sessionId: endedSessionId,
      userId: USER_ID,
    });
    await UserSessionService.isSessionLive({
      sessionId: otherDeviceSessionId,
      userId: USER_ID,
    });

    await hooks().onUpdateSuccess(revocationOf([endedSessionId]), [
      endedSessionId,
    ]);

    await expect(
      UserSessionService.isSessionLive({
        sessionId: otherDeviceSessionId,
        userId: USER_ID,
      }),
    ).resolves.toBe(true);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });
});

describe("every session of a person ends when their account is deleted", () => {
  /*
   * Deleting an account deletes its sessions with it, in the database
   * (ON DELETE CASCADE), so no session hook runs: the account's delete
   * announces every session of the person instead (UserService).
   */
  test("on this server: the account's delete makes the next request read each session again", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(true);

    findOneById.mockResolvedValue(null as never);

    const userHooks: UserServiceInternals =
      UserService as unknown as UserServiceInternals;

    await userHooks.onDeleteSuccess(
      {
        deleteBy: {
          query: {
            _id: USER_ID.toString(),
          } as unknown as DeleteBy<User>["query"],
          props: { isRoot: true },
          limit: 1,
          skip: 0,
        },
        carryForward: null,
      },
      [USER_ID],
    );

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("on a server that hears it: the same", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await UserSessionService.isSessionLive({ sessionId, userId: USER_ID });

    findOneById.mockResolvedValue(null as never);

    RealtimeAccessChanges.receive(
      messageFromAnotherServer({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        userId: USER_ID.toString(),
      }),
    );

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
  });

  test("leaves everybody else's sessions as they were", async () => {
    const othersSessionId: ObjectID = ObjectID.generate();

    findOneById.mockResolvedValue(
      storedSession({ id: othersSessionId, userId: OTHER_USER_ID }) as never,
    );

    await UserSessionService.isSessionLive({
      sessionId: othersSessionId,
      userId: OTHER_USER_ID,
    });

    UserSessionService.forgetSessionsOfUser(USER_ID);

    await expect(
      UserSessionService.isSessionLive({
        sessionId: othersSessionId,
        userId: OTHER_USER_ID,
      }),
    ).resolves.toBe(true);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  // An ended session never comes back: there is nothing to read again.
  test("a session already held as ended stays ended without a read", async () => {
    const sessionId: ObjectID = ObjectID.generate();

    await UserSessionService.isSessionLive({ sessionId, userId: USER_ID });
    UserSessionService.forgetEndedSessions([sessionId]);

    UserSessionService.forgetSessionsOfUser(USER_ID);

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("a read of theirs in flight does not keep its answer", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const staleRow: Deferred<UserSession> = deferred<UserSession>();
    findOneById.mockReturnValueOnce(staleRow.promise as never);

    const inFlight: Promise<boolean> = UserSessionService.isSessionLive({
      sessionId,
      userId: USER_ID,
    });

    UserSessionService.forgetSessionsOfUser(USER_ID);

    staleRow.resolve(storedSession({ id: sessionId }));
    await expect(inFlight).resolves.toBe(true);

    findOneById.mockResolvedValue(null as never);

    await expect(
      UserSessionService.isSessionLive({ sessionId, userId: USER_ID }),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });
});
