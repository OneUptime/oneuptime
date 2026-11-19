import UserSession from "../../../Models/DatabaseModels/UserSession";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  getSessionEndAuditLogAction,
  SESSION_END_CAUSE_DESCRIPTIONS,
} from "../../../Types/AuditLog/AuditLogSessionEvent";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import ObjectID from "../../../Types/ObjectID";
import {
  getSessionEndCauseRevokedReason,
  readSessionEndCause,
  SessionEndCause,
} from "../../../Types/UserSession/SessionEndCause";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * SIGNING OUT EVERYONE WHO SIGNED IN WITHOUT SSO (#6116).
 *
 * While the whole server requires SSO, a session that signed in another way
 * opens no project but lives on. A master admin can end them all at once:
 * every live session that is not an SSO sign-in - one that says it is not,
 * and one that does not say - of everyone but master admins, a batch at a
 * time, revoked with words of their own, through the same path the session
 * lengths end theirs (so live updates end and the audit log records each).
 * The count the card shows first counts the same sessions' people.
 */

const SESSION_A: string = "81818181-8181-4181-8181-818181818181";
const SESSION_B: string = "82828282-8282-4282-8282-828282828282";

const LIVE: Array<string> = [
  "session.isRevoked = false",
  "session.refreshTokenExpiresAt > NOW()",
];
const NOT_SSO: string = `(session.additionalInfo ->> 'isGlobalLogin') IS DISTINCT FROM 'false'`;
const NOT_A_MASTER_ADMIN: string = `session.userId NOT IN (SELECT "masterAdmin"."_id" FROM "User" "masterAdmin" WHERE "masterAdmin"."isMasterAdmin" = true)`;

// A query builder that remembers what it was asked and answers in turn.
class FakeQuery {
  public conditions: Array<string> = [];
  public selects: Array<string> = [];
  private batches: Array<Array<string>>;
  private count: unknown;

  public constructor(data: {
    batches?: Array<Array<string>>;
    count?: unknown;
  }) {
    this.batches = data.batches || [];
    this.count = data.count;
  }

  public parameters: Record<string, unknown> = {};

  public where(condition: string): this {
    return this.andWhere(condition);
  }

  public andWhere(
    condition: string,
    parameters?: Record<string, unknown> | undefined,
  ): this {
    this.conditions.push(condition);
    Object.assign(this.parameters, parameters || {});
    return this;
  }

  public select(selection: string): this {
    this.selects.push(selection);
    return this;
  }

  public limit(): this {
    return this;
  }

  public async getRawMany(): Promise<Array<{ sessionId: string }>> {
    return (this.batches.shift() || []).map(
      (sessionId: string): { sessionId: string } => {
        return { sessionId };
      },
    );
  }

  public async getRawOne(): Promise<{ peopleCount?: unknown }> {
    return { peopleCount: this.count };
  }
}

function stubQueries(answers: Array<FakeQuery>): Array<FakeQuery> {
  const asked: Array<FakeQuery> = [];

  jest.spyOn(UserSessionService, "getQueryBuilder").mockImplementation((() => {
    const query: FakeQuery = answers.shift() || new FakeQuery({});
    asked.push(query);
    return query;
  }) as never);

  return asked;
}

function stubUpdates(): Array<UpdateBy<UserSession>> {
  const updates: Array<UpdateBy<UserSession>> = [];

  jest.spyOn(UserSessionService, "updateBy").mockImplementation((async (
    updateBy: UpdateBy<UserSession>,
  ) => {
    updates.push(updateBy);
    return 0;
  }) as never);

  return updates;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how many people are signed in without SSO", () => {
  test("counts the people, not the sessions, of the live sessions that are not SSO sign-ins, master admins left out", async () => {
    const asked: Array<FakeQuery> = stubQueries([
      new FakeQuery({ count: "3" }),
    ]);

    await expect(
      UserSessionService.countPeopleSignedInWithoutSso(),
    ).resolves.toBe(3);

    expect(asked[0]!.conditions).toEqual([
      ...LIVE,
      NOT_SSO,
      NOT_A_MASTER_ADMIN,
    ]);
    expect(asked[0]!.selects).toEqual(['COUNT(DISTINCT session."userId")']);
  });

  test("nobody when there is no such session", async () => {
    stubQueries([new FakeQuery({ count: undefined })]);

    await expect(
      UserSessionService.countPeopleSignedInWithoutSso(),
    ).resolves.toBe(0);
  });
});

describe("signing out everyone who signed in without SSO", () => {
  test("ends the same sessions, by id, revoked with words of their own", async () => {
    const asked: Array<FakeQuery> = stubQueries([
      new FakeQuery({ batches: [[SESSION_A, SESSION_B]] }),
    ]);
    const updates: Array<UpdateBy<UserSession>> = stubUpdates();

    await expect(
      UserSessionService.endSessionsSignedInWithoutSso(),
    ).resolves.toBe(2);

    expect(asked[0]!.conditions).toEqual([
      ...LIVE,
      NOT_SSO,
      NOT_A_MASTER_ADMIN,
    ]);
    expect(updates).toHaveLength(1);

    const update: UpdateBy<UserSession> = updates[0]!;

    expect(update.data).toMatchObject({
      isRevoked: true,
      revokedReason: getSessionEndCauseRevokedReason(
        SessionEndCause.SignedInWithoutSso,
      ),
    });
    expect(update.data.revokedAt).toBeInstanceOf(Date);
    // Only sessions still live are written.
    expect((update.query as Record<string, unknown>)["isRevoked"]).toBe(false);
    expect(
      JSON.stringify((update.query as Record<string, unknown>)["_id"]),
    ).toContain(SESSION_A);
    expect(update.props).toEqual({ isRoot: true });
  });

  test("works through more sessions than one batch holds, a batch at a time", async () => {
    const fullBatch: Array<string> = Array.from({ length: 500 }, (): string => {
      return ObjectID.generate().toString();
    });

    const asked: Array<FakeQuery> = stubQueries([
      new FakeQuery({ batches: [fullBatch] }),
      new FakeQuery({ batches: [[SESSION_A]] }),
    ]);
    const updates: Array<UpdateBy<UserSession>> = stubUpdates();

    await expect(
      UserSessionService.endSessionsSignedInWithoutSso(),
    ).resolves.toBe(501);

    expect(asked).toHaveLength(2);
    expect(updates).toHaveLength(2);
  });

  test("writes nothing when nobody signed in without SSO", async () => {
    stubQueries([new FakeQuery({ batches: [[]] })]);
    const updates: Array<UpdateBy<UserSession>> = stubUpdates();

    await expect(
      UserSessionService.endSessionsSignedInWithoutSso(),
    ).resolves.toBe(0);

    expect(updates).toHaveLength(0);
  });
});

/*
 * SIGNING OUT THE PEOPLE WHOSE SIGN-IN SETTINGS A MASTER ADMIN CLEARED
 * (#9762, Utils/LocalSignInClearing): their sessions not signed in with SSO
 * end with the password or key they were signed in with, through the same
 * path - and theirs alone, a master admin cleared by name included. A
 * session signed in with SSO stays.
 */
describe("signing out the people whose sign-in settings were cleared", () => {
  const PERSON_A: ObjectID = new ObjectID(
    "91919191-9191-4191-8191-919191919191",
  );
  const PERSON_B: ObjectID = new ObjectID(
    "92929292-9292-4292-8292-929292929292",
  );
  const THESE_PEOPLE: string = "session.userId IN (:...clearedUserIds)";

  test("ends only these people's live sessions that are not SSO sign-ins, revoked with words of their own", async () => {
    const asked: Array<FakeQuery> = stubQueries([
      new FakeQuery({ batches: [[SESSION_A, SESSION_B]] }),
    ]);
    const updates: Array<UpdateBy<UserSession>> = stubUpdates();

    await expect(
      UserSessionService.endSessionsOfPeopleSignedInWithoutSso([
        PERSON_A,
        PERSON_B,
      ]),
    ).resolves.toBe(2);

    expect(asked[0]!.conditions).toEqual([...LIVE, NOT_SSO, THESE_PEOPLE]);
    expect(asked[0]!.parameters["clearedUserIds"]).toEqual([
      PERSON_A.toString(),
      PERSON_B.toString(),
    ]);
    // A master admin cleared by name is signed out too: nobody is left out.
    expect(asked[0]!.conditions).not.toContain(NOT_A_MASTER_ADMIN);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.data).toMatchObject({
      isRevoked: true,
      revokedReason: getSessionEndCauseRevokedReason(
        SessionEndCause.SignInSettingsCleared,
      ),
    });
    expect(updates[0]!.data.revokedAt).toBeInstanceOf(Date);
    expect((updates[0]!.query as Record<string, unknown>)["isRevoked"]).toBe(
      false,
    );
    expect(updates[0]!.props).toEqual({ isRoot: true });
  });

  test("nobody to sign out asks nothing and ends nothing", async () => {
    const asked: Array<FakeQuery> = stubQueries([]);
    const updates: Array<UpdateBy<UserSession>> = stubUpdates();

    await expect(
      UserSessionService.endSessionsOfPeopleSignedInWithoutSso([]),
    ).resolves.toBe(0);

    expect(asked).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  test("works through more of their sessions than one batch holds", async () => {
    const fullBatch: Array<string> = Array.from({ length: 500 }, (): string => {
      return ObjectID.generate().toString();
    });

    stubQueries([
      new FakeQuery({ batches: [fullBatch] }),
      new FakeQuery({ batches: [[SESSION_A]] }),
    ]);
    const updates: Array<UpdateBy<UserSession>> = stubUpdates();

    await expect(
      UserSessionService.endSessionsOfPeopleSignedInWithoutSso([PERSON_A]),
    ).resolves.toBe(501);
    expect(updates).toHaveLength(2);
  });

  test("the audit log records each as a session revoked, saying a server admin cleared their sign-in settings", () => {
    const reason: string = getSessionEndCauseRevokedReason(
      SessionEndCause.SignInSettingsCleared,
    );

    expect(reason.length).toBeLessThanOrEqual(100);
    expect(readSessionEndCause(reason)).toBe(
      SessionEndCause.SignInSettingsCleared,
    );
    expect(
      getSessionEndAuditLogAction(SessionEndCause.SignInSettingsCleared),
    ).toBe(AuditLogAction.SessionRevoked);
    expect(
      SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.SignInSettingsCleared],
    ).toBe("Signed out by a server admin who cleared their sign-in settings");
  });
});

describe("what such an end is kept and recorded as", () => {
  test("its revoked reason reads back as its cause, and fits the column", () => {
    const reason: string = getSessionEndCauseRevokedReason(
      SessionEndCause.SignedInWithoutSso,
    );

    expect(reason).toBe("Signed in without SSO");
    expect(reason.length).toBeLessThanOrEqual(100);
    expect(readSessionEndCause(reason)).toBe(
      SessionEndCause.SignedInWithoutSso,
    );
  });

  test("the audit log records it as a session revoked, saying why", () => {
    expect(
      getSessionEndAuditLogAction(SessionEndCause.SignedInWithoutSso),
    ).toBe(AuditLogAction.SessionRevoked);
    expect(
      SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.SignedInWithoutSso],
    ).toBe("Signed out by a server admin because single sign-on is required");
  });
});
