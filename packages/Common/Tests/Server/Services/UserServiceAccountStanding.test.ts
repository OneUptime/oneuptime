import UserService, {
  ACCOUNT_STANDING_CACHE_TTL_MS,
} from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import RealtimeAccessChanges, {
  RealtimeAccessChange,
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * ---------------------------------------------------------------------------
 * WHETHER SOMEONE IS A MASTER ADMIN IS READ FROM THEIR ACCOUNT, AND A CHANGE
 * TO IT REACHES EVERY SERVER AT ONCE.
 *
 * A session's access token says whether its person was a master admin when
 * it was signed, up to 15 minutes ago. Every authenticated request now holds
 * that to the account (UserAuthorization.readRequestSession), through
 * UserService.isUserMasterAdmin. This file pins what UserService owns:
 *
 *   1. one primary-key read answers both questions every request asks -
 *      whether the person is blocked, and whether they are a master admin -
 *      so asking the second costs nothing more;
 *   2. the answer is kept per server for ACCOUNT_STANDING_CACHE_TTL_MS, and
 *      dropped at once by a write to either column (onUpdateSuccess) on the
 *      server that wrote it, and by the announcement every other server
 *      hears (RealtimeAccessChanges, AccountChanged);
 *   3. a read that fails is an error, never "yes", and is not kept.
 *
 * No database: findOneById, the session revocation and the announcement's
 * channel are stubbed, and the protected hook is reached through a cast.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("51515151-5151-4151-8151-515151515151");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "52525252-5252-4252-8252-525252525252",
);

interface UserServiceInternals {
  onUpdateSuccess: (
    onUpdate: OnUpdate<User>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<User>>;
}

function hooks(): UserServiceInternals {
  return UserService as unknown as UserServiceInternals;
}

function storedUser(data: {
  isMasterAdmin: unknown;
  isBlocked?: boolean;
}): User {
  const user: User = new User();
  user.id = USER_ID;
  user.isBlocked = data.isBlocked === true;
  (user as unknown as { isMasterAdmin: unknown }).isMasterAdmin =
    data.isMasterAdmin;
  return user;
}

function updateOf(patch: Record<string, unknown>): OnUpdate<User> {
  const updateBy: UpdateBy<User> = {
    query: { _id: USER_ID.toString() } as unknown as UpdateBy<User>["query"],
    data: patch as unknown as UpdateBy<User>["data"],
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };

  return { updateBy, carryForward: [] };
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

let findOneById: jest.SpyInstance;
let announced: Array<RealtimeAccessChange>;

beforeEach(() => {
  UserService.forgetAccountStanding(USER_ID);
  UserService.forgetAccountStanding(OTHER_USER_ID);

  findOneById = jest
    .spyOn(UserService, "findOneById")
    .mockResolvedValue(storedUser({ isMasterAdmin: true }) as never);

  jest
    .spyOn(UserSessionService, "revokeAllSessionsByUserId")
    .mockResolvedValue(undefined as never);

  /*
   * What is announced to the other servers is recorded, and still applied
   * here as on every server (no Valkey is connected, so nothing is sent).
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

describe("UserService.isUserMasterAdmin", () => {
  test("reads isMasterAdmin from the user row, with isBlocked and nothing else", async () => {
    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledWith({
      id: USER_ID,
      select: { isBlocked: true, isMasterAdmin: true },
      props: { isRoot: true },
    });
  });

  test("is false for someone who is not a master admin", async () => {
    findOneById.mockResolvedValue(
      storedUser({ isMasterAdmin: false }) as never,
    );

    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(false);
  });

  test("is false for an account that no longer exists", async () => {
    findOneById.mockResolvedValue(null as never);

    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(false);
  });

  // Only the boolean true is a master admin: anything else is not.
  test.each([
    ["no value", undefined],
    ["null", null],
    ["the text 'true'", "true"],
    ["the number 1", 1],
  ])("is false for a row that holds %s", async (_: string, value: unknown) => {
    findOneById.mockResolvedValue(
      storedUser({ isMasterAdmin: value }) as never,
    );

    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(false);
  });

  /*
   * Every authenticated request asks whether the person is blocked, and a
   * session that says master admin asks this too: one read answers both.
   */
  test("shares its read with isUserBlocked: one query answers both", async () => {
    findOneById.mockResolvedValue(
      storedUser({ isMasterAdmin: true, isBlocked: false }) as never,
    );

    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(false);
    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);
    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("shares one query between concurrent requests for the same person", async () => {
    const row: Deferred<User> = deferred<User>();
    findOneById.mockReturnValue(row.promise as never);

    const answers: Promise<Array<boolean>> = Promise.all([
      UserService.isUserMasterAdmin(USER_ID),
      UserService.isUserBlocked(USER_ID),
      UserService.isUserMasterAdmin(USER_ID),
    ]);

    row.resolve(storedUser({ isMasterAdmin: true }));

    await expect(answers).resolves.toEqual([true, false, true]);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("keeps people apart", async () => {
    findOneById.mockImplementation((async (data: { id: ObjectID }) => {
      return storedUser({
        isMasterAdmin: data.id.toString() === USER_ID.toString(),
      });
    }) as never);

    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);
    await expect(UserService.isUserMasterAdmin(OTHER_USER_ID)).resolves.toBe(
      false,
    );
  });

  // "We could not find out" must reach the caller, which refuses the request.
  test("rejects when the read fails, and does not keep the failure", async () => {
    findOneById.mockRejectedValueOnce(
      new Error("database unavailable") as never,
    );

    await expect(UserService.isUserMasterAdmin(USER_ID)).rejects.toThrow(
      "database unavailable",
    );

    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });
});

describe("how long one server keeps what it read", () => {
  test("a minute: within it the row is not read again, after it it is", async () => {
    const startedAt: number = Date.now();
    const now: jest.SpyInstance = jest.spyOn(Date, "now");

    now.mockReturnValue(startedAt);
    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);

    // Another server removed the access, and this one was not told.
    findOneById.mockResolvedValue(
      storedUser({ isMasterAdmin: false }) as never,
    );

    now.mockReturnValue(startedAt + ACCOUNT_STANDING_CACHE_TTL_MS - 1);
    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);
    expect(findOneById).toHaveBeenCalledTimes(1);

    now.mockReturnValue(startedAt + ACCOUNT_STANDING_CACHE_TTL_MS + 1);
    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  // Not the access token's 15 minutes: that is what this replaces.
  test("is a minute", () => {
    expect(ACCOUNT_STANDING_CACHE_TTL_MS).toBe(60 * 1000);
  });
});

describe("removing someone's master admin access reaches the next request at once", () => {
  test("on this server: the write drops what it held", async () => {
    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);

    findOneById.mockResolvedValue(
      storedUser({ isMasterAdmin: false }) as never,
    );

    await hooks().onUpdateSuccess(updateOf({ isMasterAdmin: false }), [
      USER_ID,
    ]);

    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(false);
  });

  test("on every other server: the write announces it, once per person", async () => {
    await hooks().onUpdateSuccess(updateOf({ isMasterAdmin: false }), [
      USER_ID,
      OTHER_USER_ID,
    ]);

    expect(announced).toEqual([
      {
        kind: RealtimeAccessChangeKind.AccountChanged,
        userId: USER_ID.toString(),
      },
      {
        kind: RealtimeAccessChangeKind.AccountChanged,
        userId: OTHER_USER_ID.toString(),
      },
    ]);
  });

  /*
   * What another server does when it hears it: the announcement's message,
   * as it arrives from Valkey with another server's origin, drops what this
   * server held.
   */
  test("on a server that hears it: the announcement drops what it held", async () => {
    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);

    findOneById.mockResolvedValue(
      storedUser({ isMasterAdmin: false }) as never,
    );

    RealtimeAccessChanges.receive(
      JSON.stringify({
        origin: ObjectID.generate().toString(),
        change: {
          kind: RealtimeAccessChangeKind.AccountChanged,
          userId: USER_ID.toString(),
        },
      }),
    );

    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("making someone a master admin is read the same way", async () => {
    findOneById.mockResolvedValue(
      storedUser({ isMasterAdmin: false }) as never,
    );
    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(false);

    findOneById.mockResolvedValue(storedUser({ isMasterAdmin: true }) as never);

    await hooks().onUpdateSuccess(updateOf({ isMasterAdmin: true }), [USER_ID]);

    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(true);
  });

  /*
   * The read was on the wire when the access was removed. Its answer still
   * goes to the request that asked, but it is not kept, or it would hide the
   * change for a minute.
   */
  test("a read in flight while the access is removed does not keep its answer", async () => {
    const staleRow: Deferred<User> = deferred<User>();
    findOneById.mockReturnValueOnce(staleRow.promise as never);

    const inFlight: Promise<boolean> = UserService.isUserMasterAdmin(USER_ID);

    await hooks().onUpdateSuccess(updateOf({ isMasterAdmin: false }), [
      USER_ID,
    ]);

    staleRow.resolve(storedUser({ isMasterAdmin: true }));
    await expect(inFlight).resolves.toBe(true);

    findOneById.mockResolvedValue(
      storedUser({ isMasterAdmin: false }) as never,
    );

    await expect(UserService.isUserMasterAdmin(USER_ID)).resolves.toBe(false);
  });

  // Nobody is signed out: the person goes on as the member they are.
  test("ends nobody's sessions", async () => {
    await hooks().onUpdateSuccess(updateOf({ isMasterAdmin: false }), [
      USER_ID,
    ]);

    expect(UserSessionService.revokeAllSessionsByUserId).not.toHaveBeenCalled();
    expect(
      announced.filter((change: RealtimeAccessChange): boolean => {
        return change.kind === RealtimeAccessChangeKind.SessionsEnded;
      }),
    ).toEqual([]);
  });

  test("a write that touches neither column keeps what was read, and announces nothing", async () => {
    await UserService.isUserMasterAdmin(USER_ID);

    await hooks().onUpdateSuccess(updateOf({ name: "Renamed" }), [USER_ID]);

    await UserService.isUserMasterAdmin(USER_ID);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(announced).toEqual([]);
  });
});
