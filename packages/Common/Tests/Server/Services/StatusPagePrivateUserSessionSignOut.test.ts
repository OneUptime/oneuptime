import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import StatusPagePrivateUserSessionService from "../../../Server/Services/StatusPagePrivateUserSessionService";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * ENDING A STATUS PAGE SESSION AT ITS SIGN-OUT, BY ITS REFRESH TOKEN OR BY
 * THE PAGE'S SIGN-OUT COOKIE (issue #8671).
 *
 * A private status page's refresh token is rotated at every renewal and
 * only the new one kept. A renewal whose answer never reached the browser
 * leaves it holding the one the renewal replaced, which matches no session,
 * so the page's sign-out ended nothing. POST
 * /status-page-identity-api/logout/<page> now falls back to the session the
 * page's sign-out cookie names: revokeSessionByRefreshToken answers whether
 * it ended one, and revokeLiveSessionOfPrivateUser ends a live session of
 * that reader on that page by its id, and nothing else.
 *
 * The real service; its database calls are stand-ins that keep what was
 * asked.
 */

const SESSION_ID: ObjectID = new ObjectID(
  "91919191-9191-4191-8191-919191919191",
);
const READER_ID: ObjectID = new ObjectID(
  "92929292-9292-4292-8292-929292929292",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "93939393-9393-4393-8393-939393939393",
);

function liveSession(
  additionalInfo?: Record<string, string>,
): StatusPagePrivateUserSession {
  const session: StatusPagePrivateUserSession =
    new StatusPagePrivateUserSession();
  session.id = SESSION_ID;
  session.statusPageId = STATUS_PAGE_ID;
  session.statusPagePrivateUserId = READER_ID;
  session.isRevoked = false;

  if (additionalInfo) {
    session.additionalInfo = additionalInfo;
  }

  return session;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("revokeSessionByRefreshToken", () => {
  test("ends the live session the refresh token belongs to, and says it did", async () => {
    jest
      .spyOn(
        StatusPagePrivateUserSessionService,
        "findActiveSessionByRefreshToken",
      )
      .mockResolvedValue(liveSession() as never);
    const revoke: jest.SpiedFunction<
      typeof StatusPagePrivateUserSessionService.revokeSessionById
    > = jest
      .spyOn(StatusPagePrivateUserSessionService, "revokeSessionById")
      .mockResolvedValue(undefined);

    expect(
      await StatusPagePrivateUserSessionService.revokeSessionByRefreshToken(
        "current-token",
        { reason: "User logged out" },
      ),
    ).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke.mock.calls[0]![0].toString()).toBe(SESSION_ID.toString());
    expect(revoke.mock.calls[0]![1]).toEqual({ reason: "User logged out" });
  });

  test("a refresh token that matches no live session - one a renewal rotated - ends nothing, and says so", async () => {
    jest
      .spyOn(
        StatusPagePrivateUserSessionService,
        "findActiveSessionByRefreshToken",
      )
      .mockResolvedValue(null as never);
    const revoke: jest.SpiedFunction<
      typeof StatusPagePrivateUserSessionService.revokeSessionById
    > = jest
      .spyOn(StatusPagePrivateUserSessionService, "revokeSessionById")
      .mockResolvedValue(undefined);

    expect(
      await StatusPagePrivateUserSessionService.revokeSessionByRefreshToken(
        "rotated-token",
      ),
    ).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  test("looks the token up by its hash, among live sessions only", async () => {
    const findOneBy: jest.SpiedFunction<
      typeof StatusPagePrivateUserSessionService.findOneBy
    > = jest
      .spyOn(StatusPagePrivateUserSessionService, "findOneBy")
      .mockResolvedValue(null as never);

    await StatusPagePrivateUserSessionService.revokeSessionByRefreshToken(
      "some-token",
    );

    const query: Record<string, unknown> = findOneBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["isRevoked"]).toBe(false);
    expect(query["refreshToken"]).toBeInstanceOf(HashedString);
    expect(String(query["refreshToken"])).not.toContain("some-token");
  });
});

describe("revokeLiveSessionOfPrivateUser", () => {
  test("ends the live session of that reader on that page by its id, and says it did", async () => {
    const findOneBy: jest.SpiedFunction<
      typeof StatusPagePrivateUserSessionService.findOneBy
    > = jest
      .spyOn(StatusPagePrivateUserSessionService, "findOneBy")
      .mockResolvedValue(liveSession() as never);
    const revoke: jest.SpiedFunction<
      typeof StatusPagePrivateUserSessionService.revokeSessionById
    > = jest
      .spyOn(StatusPagePrivateUserSessionService, "revokeSessionById")
      .mockResolvedValue(undefined);

    expect(
      await StatusPagePrivateUserSessionService.revokeLiveSessionOfPrivateUser(
        {
          statusPageId: STATUS_PAGE_ID,
          statusPagePrivateUserId: READER_ID,
          sessionId: SESSION_ID,
        },
        { reason: "User logged out" },
      ),
    ).toBe(true);

    // Only a live session, only this page's, only this reader's, only this one.
    const asked: Record<string, unknown> = findOneBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(String(asked["_id"])).toBe(SESSION_ID.toString());
    expect(String(asked["statusPageId"])).toBe(STATUS_PAGE_ID.toString());
    expect(String(asked["statusPagePrivateUserId"])).toBe(READER_ID.toString());
    expect(asked["isRevoked"]).toBe(false);
    expect(Object.keys(asked).sort()).toEqual([
      "_id",
      "isRevoked",
      "statusPageId",
      "statusPagePrivateUserId",
    ]);
    expect(findOneBy.mock.calls[0]![0].props).toEqual({ isRoot: true });

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke.mock.calls[0]![0].toString()).toBe(SESSION_ID.toString());
    expect(revoke.mock.calls[0]![1]).toEqual({ reason: "User logged out" });
  });

  test("a session of somebody else, of another page, one already over, or none: nothing ended", async () => {
    jest
      .spyOn(StatusPagePrivateUserSessionService, "findOneBy")
      .mockResolvedValue(null as never);
    const revoke: jest.SpiedFunction<
      typeof StatusPagePrivateUserSessionService.revokeSessionById
    > = jest
      .spyOn(StatusPagePrivateUserSessionService, "revokeSessionById")
      .mockResolvedValue(undefined);

    expect(
      await StatusPagePrivateUserSessionService.revokeLiveSessionOfPrivateUser({
        statusPageId: STATUS_PAGE_ID,
        statusPagePrivateUserId: READER_ID,
        sessionId: SESSION_ID,
      }),
    ).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  test("a login code not yet exchanged is no session to sign out of: left as it is", async () => {
    jest
      .spyOn(StatusPagePrivateUserSessionService, "findOneBy")
      .mockResolvedValue(
        liveSession({
          oneuptimeStatusPageSessionPurpose: "login-code",
        }) as never,
      );
    const revoke: jest.SpiedFunction<
      typeof StatusPagePrivateUserSessionService.revokeSessionById
    > = jest
      .spyOn(StatusPagePrivateUserSessionService, "revokeSessionById")
      .mockResolvedValue(undefined);

    expect(
      await StatusPagePrivateUserSessionService.revokeLiveSessionOfPrivateUser({
        statusPageId: STATUS_PAGE_ID,
        statusPagePrivateUserId: READER_ID,
        sessionId: SESSION_ID,
      }),
    ).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  test("the session's end is kept with the sign-out's reason, as any sign-out's", async () => {
    jest
      .spyOn(StatusPagePrivateUserSessionService, "findOneBy")
      .mockResolvedValue(liveSession() as never);
    const updateOneById: jest.SpiedFunction<
      typeof StatusPagePrivateUserSessionService.updateOneById
    > = jest
      .spyOn(StatusPagePrivateUserSessionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await StatusPagePrivateUserSessionService.revokeLiveSessionOfPrivateUser(
      {
        statusPageId: STATUS_PAGE_ID,
        statusPagePrivateUserId: READER_ID,
        sessionId: SESSION_ID,
      },
      { reason: "User logged out" },
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
    expect(update.data["revokedReason"]).toBe("User logged out");
    expect(update.props).toEqual({ isRoot: true });
  });
});
