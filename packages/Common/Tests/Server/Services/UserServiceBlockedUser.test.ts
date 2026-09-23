import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * BLOCKING A USER ENDS THEIR SESSIONS, AND THE REQUEST PATH CAN SEE THE BLOCK.
 *
 * The master-admin "Block" action used to write `User.isBlocked` and nothing
 * else: the user's sessions carried on, and so did every access token and
 * refresh token they held. This file pins the two halves UserService owns:
 *
 *   1. `onUpdateSuccess` revokes every session of a user the write blocked,
 *      so /refresh-token refuses them from that moment;
 *   2. `isUserBlocked` answers the question for the request middleware, from
 *      a per-node cache that a write to `isBlocked` drops at once.
 *
 * No database: `findOneById` and the session revocation are jest.spyOn stubs,
 * and the protected hook is reached through a structural cast.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface UserServiceInternals {
  onUpdateSuccess: (
    onUpdate: OnUpdate<User>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<User>>;
}

function userService(): UserServiceInternals {
  return UserService as unknown as UserServiceInternals;
}

function storedUser(data: { isBlocked: boolean }): User {
  const user: User = new User();
  user.id = USER_ID;
  user.isBlocked = data.isBlocked;
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
let revokeAllSessionsByUserId: jest.SpyInstance;

beforeEach(() => {
  UserService.forgetBlockedStatus(USER_ID);
  UserService.forgetBlockedStatus(OTHER_USER_ID);

  findOneById = jest
    .spyOn(UserService, "findOneById")
    .mockResolvedValue(storedUser({ isBlocked: false }) as never);

  revokeAllSessionsByUserId = jest
    .spyOn(UserSessionService, "revokeAllSessionsByUserId")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserService.onUpdateSuccess — blocking a user", () => {
  test("revokes every session of the user the write blocked", async () => {
    await userService().onUpdateSuccess(updateOf({ isBlocked: true }), [
      USER_ID,
    ]);

    expect(revokeAllSessionsByUserId).toHaveBeenCalledTimes(1);
    expect(revokeAllSessionsByUserId).toHaveBeenCalledWith(USER_ID, {
      reason: "User blocked",
    });
  });

  // The Admin Dashboard's bulk action blocks one user per request, but updateBy can match many.
  test("revokes the sessions of every user a bulk write blocked", async () => {
    await userService().onUpdateSuccess(updateOf({ isBlocked: true }), [
      USER_ID,
      OTHER_USER_ID,
    ]);

    expect(revokeAllSessionsByUserId).toHaveBeenCalledTimes(2);
    expect(revokeAllSessionsByUserId).toHaveBeenCalledWith(USER_ID, {
      reason: "User blocked",
    });
    expect(revokeAllSessionsByUserId).toHaveBeenCalledWith(OTHER_USER_ID, {
      reason: "User blocked",
    });
  });

  test("revokes nothing when the write matched no user", async () => {
    await userService().onUpdateSuccess(updateOf({ isBlocked: true }), []);

    expect(revokeAllSessionsByUserId).not.toHaveBeenCalled();
  });

  test("does not revoke the sessions of a user being unblocked", async () => {
    await userService().onUpdateSuccess(updateOf({ isBlocked: false }), [
      USER_ID,
    ]);

    expect(revokeAllSessionsByUserId).not.toHaveBeenCalled();
  });

  test("does not revoke sessions on a write that does not touch isBlocked", async () => {
    await userService().onUpdateSuccess(updateOf({ name: "Renamed" }), [
      USER_ID,
    ]);

    expect(revokeAllSessionsByUserId).not.toHaveBeenCalled();
  });

  test("fails the write when the sessions cannot be revoked", async () => {
    revokeAllSessionsByUserId.mockRejectedValue(
      new Error("session table unavailable") as never,
    );

    await expect(
      userService().onUpdateSuccess(updateOf({ isBlocked: true }), [USER_ID]),
    ).rejects.toThrow("session table unavailable");
  });
});

describe("UserService.isUserBlocked", () => {
  test("reads isBlocked from the user row, and only that column", async () => {
    findOneById.mockResolvedValue(storedUser({ isBlocked: true }) as never);

    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(true);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledWith({
      id: USER_ID,
      select: { isBlocked: true },
      props: { isRoot: true },
    });
  });

  test("reports a user who is not blocked as not blocked", async () => {
    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(false);
  });

  test("reports a user that no longer exists as not blocked", async () => {
    findOneById.mockResolvedValue(null as never);

    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(false);
  });

  test("answers repeat requests from the cache, including a cached 'not blocked'", async () => {
    await UserService.isUserBlocked(USER_ID);
    await UserService.isUserBlocked(USER_ID);
    await UserService.isUserBlocked(USER_ID);

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("shares one query between concurrent requests for the same user", async () => {
    const row: Deferred<User> = deferred<User>();
    findOneById.mockReturnValue(row.promise as never);

    const answers: Promise<Array<boolean>> = Promise.all([
      UserService.isUserBlocked(USER_ID),
      UserService.isUserBlocked(USER_ID),
      UserService.isUserBlocked(USER_ID),
    ]);

    row.resolve(storedUser({ isBlocked: true }));

    await expect(answers).resolves.toEqual([true, true, true]);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("keeps the users apart", async () => {
    findOneById.mockImplementation((async (data: { id: ObjectID }) => {
      return storedUser({
        isBlocked: data.id.toString() === USER_ID.toString(),
      });
    }) as never);

    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(true);
    await expect(UserService.isUserBlocked(OTHER_USER_ID)).resolves.toBe(false);
  });

  // "We could not find out" must reach the caller, which refuses the request.
  test("rejects when the lookup fails, and does not cache the failure", async () => {
    findOneById.mockRejectedValueOnce(
      new Error("database unavailable") as never,
    );

    await expect(UserService.isUserBlocked(USER_ID)).rejects.toThrow(
      "database unavailable",
    );

    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });
});

describe("a write to isBlocked reaches isUserBlocked on this node at once", () => {
  test("blocking replaces a cached 'not blocked'", async () => {
    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(false);

    findOneById.mockResolvedValue(storedUser({ isBlocked: true }) as never);

    await userService().onUpdateSuccess(updateOf({ isBlocked: true }), [
      USER_ID,
    ]);

    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(true);
  });

  test("unblocking replaces a cached 'blocked'", async () => {
    findOneById.mockResolvedValue(storedUser({ isBlocked: true }) as never);

    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(true);

    findOneById.mockResolvedValue(storedUser({ isBlocked: false }) as never);

    await userService().onUpdateSuccess(updateOf({ isBlocked: false }), [
      USER_ID,
    ]);

    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(false);
  });

  test("a write that does not touch isBlocked leaves the cached answer alone", async () => {
    await UserService.isUserBlocked(USER_ID);

    await userService().onUpdateSuccess(updateOf({ name: "Renamed" }), [
      USER_ID,
    ]);

    await UserService.isUserBlocked(USER_ID);

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  /*
   * The lookup read the row before the block committed. Its answer is still
   * handed to the request that asked, but it must not be cached, or it would
   * hide the block for the whole TTL.
   */
  test("a lookup that was in flight during the block does not cache its stale answer", async () => {
    const staleRow: Deferred<User> = deferred<User>();
    findOneById.mockReturnValueOnce(staleRow.promise as never);

    const inFlight: Promise<boolean> = UserService.isUserBlocked(USER_ID);

    await userService().onUpdateSuccess(updateOf({ isBlocked: true }), [
      USER_ID,
    ]);

    staleRow.resolve(storedUser({ isBlocked: false }));
    await expect(inFlight).resolves.toBe(false);

    findOneById.mockResolvedValue(storedUser({ isBlocked: true }) as never);

    await expect(UserService.isUserBlocked(USER_ID)).resolves.toBe(true);
  });
});
