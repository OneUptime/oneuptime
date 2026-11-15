import UserSession from "../../../Models/DatabaseModels/UserSession";
import UserSessionService from "../../../Server/Services/UserSessionService";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import RequestOrigin from "../../../Types/RequestOrigin";
import {
  getSessionEndCauseRevokedReason,
  SessionEndCause,
} from "../../../Types/UserSession/SessionEndCause";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * ENDING A SESSION AT A SIGN-OUT, BY ITS REFRESH TOKEN OR BY ITS OWN ACCESS
 * TOKEN (issue #8592).
 *
 * The server rotates the refresh token at every renewal and keeps only the
 * new one. A renewal whose answer never reached the client leaves it holding
 * the refresh token the renewal replaced, which matches no session, so a
 * sign-out with it ended nothing and the session stayed signed in on the
 * server. POST /identity/logout now falls back to the session its own
 * access token names: revokeSessionByRefreshToken answers whether it ended
 * one, and revokeLiveSessionOfUser ends a live session of the token's user
 * by its id, and nothing else.
 *
 * The real service; its database calls are stand-ins that keep what was
 * asked.
 */

const SESSION_ID: ObjectID = new ObjectID(
  "81818181-8181-4181-8181-818181818181",
);
const USER_ID: ObjectID = new ObjectID("82828282-8282-4282-8282-828282828282");

const ORIGIN: RequestOrigin = {
  ipAddress: "203.0.113.9",
} as RequestOrigin;

function liveSession(): UserSession {
  const session: UserSession = new UserSession();
  session.id = SESSION_ID;
  session.userId = USER_ID;
  session.isRevoked = false;
  return session;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("revokeSessionByRefreshToken", () => {
  test("ends the live session the refresh token belongs to, and says it did", async () => {
    jest
      .spyOn(UserSessionService, "findActiveSessionByRefreshToken")
      .mockResolvedValue(liveSession() as never);
    const revoke: SpyInstance<typeof UserSessionService.revokeSessionById> =
      jest
        .spyOn(UserSessionService, "revokeSessionById")
        .mockResolvedValue(undefined);

    expect(
      await UserSessionService.revokeSessionByRefreshToken("current-token", {
        cause: SessionEndCause.SignedOut,
        requestOrigin: ORIGIN,
      }),
    ).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke.mock.calls[0]![0].toString()).toBe(SESSION_ID.toString());
    expect(revoke.mock.calls[0]![1]).toEqual({
      cause: SessionEndCause.SignedOut,
      requestOrigin: ORIGIN,
    });
  });

  test("a refresh token that matches no live session - one a renewal rotated - ends nothing, and says so", async () => {
    jest
      .spyOn(UserSessionService, "findActiveSessionByRefreshToken")
      .mockResolvedValue(null as never);
    const revoke: SpyInstance<typeof UserSessionService.revokeSessionById> =
      jest
        .spyOn(UserSessionService, "revokeSessionById")
        .mockResolvedValue(undefined);

    expect(
      await UserSessionService.revokeSessionByRefreshToken("rotated-token"),
    ).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  test("looks the token up by its hash, among live sessions only", async () => {
    const findOneBy: SpyInstance<typeof UserSessionService.findOneBy> = jest
      .spyOn(UserSessionService, "findOneBy")
      .mockResolvedValue(null as never);

    await UserSessionService.revokeSessionByRefreshToken("some-token");

    const query: Record<string, unknown> = findOneBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["isRevoked"]).toBe(false);
    expect(query["refreshToken"]).toBeInstanceOf(HashedString);
    expect(String(query["refreshToken"])).not.toContain("some-token");
  });
});

describe("revokeLiveSessionOfUser", () => {
  test("ends the live session of that user by its id, as a sign-out from where it came, and says it did", async () => {
    const findOneBy: SpyInstance<typeof UserSessionService.findOneBy> = jest
      .spyOn(UserSessionService, "findOneBy")
      .mockResolvedValue(liveSession() as never);
    const revoke: SpyInstance<typeof UserSessionService.revokeSessionById> =
      jest
        .spyOn(UserSessionService, "revokeSessionById")
        .mockResolvedValue(undefined);

    expect(
      await UserSessionService.revokeLiveSessionOfUser(
        { userId: USER_ID, sessionId: SESSION_ID },
        { cause: SessionEndCause.SignedOut, requestOrigin: ORIGIN },
      ),
    ).toBe(true);

    // Only a live session, only this user's, only this one.
    const asked: Record<string, unknown> = findOneBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(String(asked["_id"])).toBe(SESSION_ID.toString());
    expect(String(asked["userId"])).toBe(USER_ID.toString());
    expect(asked["isRevoked"]).toBe(false);
    expect(findOneBy.mock.calls[0]![0].props).toEqual({ isRoot: true });

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke.mock.calls[0]![0].toString()).toBe(SESSION_ID.toString());
    expect(revoke.mock.calls[0]![1]).toEqual({
      cause: SessionEndCause.SignedOut,
      requestOrigin: ORIGIN,
    });
  });

  test("a session of somebody else, one already over, or none: nothing ended, nothing recorded", async () => {
    jest
      .spyOn(UserSessionService, "findOneBy")
      .mockResolvedValue(null as never);
    const revoke: SpyInstance<typeof UserSessionService.revokeSessionById> =
      jest
        .spyOn(UserSessionService, "revokeSessionById")
        .mockResolvedValue(undefined);

    expect(
      await UserSessionService.revokeLiveSessionOfUser({
        userId: USER_ID,
        sessionId: SESSION_ID,
      }),
    ).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  test("the session's end is kept with the sign-out's words, as any sign-out's", async () => {
    jest
      .spyOn(UserSessionService, "findOneBy")
      .mockResolvedValue(liveSession() as never);
    const updateOneById: SpyInstance<typeof UserSessionService.updateOneById> =
      jest
        .spyOn(UserSessionService, "updateOneById")
        .mockResolvedValue(undefined as never);

    await UserSessionService.revokeLiveSessionOfUser(
      { userId: USER_ID, sessionId: SESSION_ID },
      { cause: SessionEndCause.SignedOut, requestOrigin: ORIGIN },
    );

    const update: {
      id: ObjectID;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
    } = updateOneById.mock.calls[0]![0] as unknown as {
      id: ObjectID;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(update.id.toString()).toBe(SESSION_ID.toString());
    expect(update.data["isRevoked"]).toBe(true);
    expect(update.data["revokedReason"]).toBe(
      getSessionEndCauseRevokedReason(SessionEndCause.SignedOut),
    );
    expect(update.props).toEqual({ isRoot: true, requestOrigin: ORIGIN });
  });
});
