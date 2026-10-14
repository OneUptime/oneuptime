import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPageService, {
  assertStatusPageWriteValues,
} from "../../../Server/Services/StatusPageService";
import { Service } from "../../../Server/Services/StatusPagePrivateUserSessionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import {
  MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS,
  PRIVATE_USER_SESSION_LENGTH_PROBLEM,
} from "../../../Types/StatusPage/PrivateUserSessionLength";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Repository, SelectQueryBuilder, UpdateResult } from "typeorm";

/*
 * SIGN READERS OUT AFTER, AS THE SESSIONS OF A PRIVATE STATUS PAGE KEEP IT
 * (StatusPagePrivateUserSessionService, Types/StatusPage/
 * PrivateUserSessionLength): a session counts only while fewer hours than
 * the page's limit have passed since it signed in, however active the
 * reader is.
 *
 *   - every read of the page asks it, with the page's limit
 *     (addSignInRule), and a refresh or login code asks it with the limit
 *     the page holds now (doesSignInStillCount);
 *   - a session is issued, exchanged from a login code and renewed with
 *     its refresh token expiring at the end of its limit at the latest, so
 *     the browser drops it on time;
 *   - a write may hold only a whole number of hours from 1 to a year, or
 *     nothing for no limit.
 *
 * The SQL itself is run against Postgres in
 * StatusPagePrivateUserSessionLengthPostgres.test.ts.
 */

const FROZEN_NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
/*
 * Thirty days from the frozen now, counted as the service counts them:
 * calendar days, so a change of clocks in between is not an hour off.
 */
const thirtyDaysFromNow: () => number = (): number => {
  return OneUptimeDate.getSomeDaysAfter(30).getTime();
};
const CREATED_AT_RULE: string =
  "session.createdAt > NOW() - make_interval(hours => CAST(:sessionLengthInHours AS integer))";

type RecordedCall = { method: string; args: Array<unknown> };

interface FakeQuery {
  query: SelectQueryBuilder<StatusPagePrivateUserSession>;
  calls: Array<RecordedCall>;
  getOne: jest.Mock<() => Promise<StatusPagePrivateUserSession | null>>;
}

// A query builder that records how it is built, and answers with getOne.
const buildFakeQuery: (
  answer?: StatusPagePrivateUserSession | null,
) => FakeQuery = (
  answer: StatusPagePrivateUserSession | null = null,
): FakeQuery => {
  const calls: Array<RecordedCall> = [];
  const getOne: jest.Mock<() => Promise<StatusPagePrivateUserSession | null>> =
    jest.fn(async (): Promise<StatusPagePrivateUserSession | null> => {
      return answer;
    });

  const query: Record<string, unknown> = {};

  for (const method of [
    "select",
    "innerJoin",
    "leftJoin",
    "where",
    "andWhere",
  ]) {
    query[method] = (...args: Array<unknown>): unknown => {
      calls.push({ method, args });
      return query;
    };
  }

  query["getOne"] = getOne;

  return {
    query: query as unknown as SelectQueryBuilder<StatusPagePrivateUserSession>,
    calls,
    getOne,
  };
};

// The conditions a query was given as plain SQL strings, in order.
const conditionsOf: (calls: Array<RecordedCall>) => Array<string> = (
  calls: Array<RecordedCall>,
): Array<string> => {
  return calls
    .filter((call: RecordedCall): boolean => {
      return (
        (call.method === "where" || call.method === "andWhere") &&
        typeof call.args[0] === "string"
      );
    })
    .map((call: RecordedCall): string => {
      return call.args[0] as string;
    });
};

const pageWithLength: (lengthInHours: number | null) => StatusPage = (
  lengthInHours: number | null,
): StatusPage => {
  const page: StatusPage = new StatusPage();
  page.id = ObjectID.generate();
  (page as unknown as Record<string, unknown>)[
    "privateUserSessionLengthInHours"
  ] = lengthInHours;
  return page;
};

describe("a page read counts a session only within the page's limit", () => {
  test.each([null, undefined])(
    "with no limit (%p), no time condition is added",
    (sessionLengthInHours: unknown) => {
      const service: Service = new Service();
      const fake: FakeQuery = buildFakeQuery();

      service.addSignInRule(fake.query, {
        requiresSso: false,
        sessionLengthInHours,
      });

      expect(conditionsOf(fake.calls)).not.toContain(CREATED_AT_RULE);
    },
  );

  test.each([1, 8, 24, 720, MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS])(
    "with %p hours, the session must have signed in within them, by the database's clock",
    (sessionLengthInHours: number) => {
      const service: Service = new Service();
      const fake: FakeQuery = buildFakeQuery();

      service.addSignInRule(fake.query, {
        requiresSso: false,
        sessionLengthInHours,
      });

      const timeCondition: RecordedCall | undefined = fake.calls.find(
        (call: RecordedCall): boolean => {
          return call.args[0] === CREATED_AT_RULE;
        },
      );

      expect(timeCondition).toBeDefined();
      expect(timeCondition!.method).toBe("andWhere");
      expect(timeCondition!.args[1]).toEqual({ sessionLengthInHours });
    },
  );

  test("the limit is added on top of the sign-in rule, whichever way the page asks for SSO", () => {
    for (const requiresSso of [true, false]) {
      const service: Service = new Service();
      const fake: FakeQuery = buildFakeQuery();

      service.addSignInRule(fake.query, {
        requiresSso,
        sessionLengthInHours: 12,
      });

      // The provider tables are joined, then the rule, then the limit.
      expect(
        fake.calls.filter((call: RecordedCall): boolean => {
          return call.method === "leftJoin";
        }),
      ).toHaveLength(2);
      expect(conditionsOf(fake.calls)).toEqual([CREATED_AT_RULE]);
    }
  });

  test.each([0, -1, MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS + 1, 2.5, "12"])(
    "a stored value that could not have been written (%p) is no limit, so nobody is locked out",
    (sessionLengthInHours: unknown) => {
      const service: Service = new Service();
      const fake: FakeQuery = buildFakeQuery();

      service.addSignInRule(fake.query, {
        requiresSso: false,
        sessionLengthInHours,
      });

      expect(conditionsOf(fake.calls)).not.toContain(CREATED_AT_RULE);
    },
  );
});

describe("a refresh or login code counts a session only within the limit the page holds now", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the session's own page is joined, and its limit asked in the same read", async () => {
    const service: Service = new Service();
    const fake: FakeQuery = buildFakeQuery(new StatusPagePrivateUserSession());
    getJestSpyOn(service, "getQueryBuilder").mockReturnValue(fake.query);

    expect(
      await service.doesSignInStillCount({ sessionId: ObjectID.generate() }),
    ).toBe(true);

    const pageJoin: RecordedCall | undefined = fake.calls.find(
      (call: RecordedCall): boolean => {
        return call.method === "innerJoin";
      },
    );

    expect(pageJoin!.args[0]).toBe(StatusPage);
    expect(pageJoin!.args[1]).toBe("sessionStatusPage");

    const limitCondition: string | undefined = conditionsOf(fake.calls).find(
      (condition: string): boolean => {
        return condition.includes("privateUserSessionLengthInHours");
      },
    );

    expect(limitCondition).toBe(
      `(sessionStatusPage.privateUserSessionLengthInHours IS NULL OR sessionStatusPage.privateUserSessionLengthInHours < 1 OR sessionStatusPage.privateUserSessionLengthInHours > ${MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS} OR session.createdAt > NOW() - make_interval(hours => sessionStatusPage.privateUserSessionLengthInHours))`,
    );
  });

  test("a session past its limit does not count", async () => {
    const service: Service = new Service();
    const fake: FakeQuery = buildFakeQuery(null);
    getJestSpyOn(service, "getQueryBuilder").mockReturnValue(fake.query);

    expect(
      await service.doesSignInStillCount({ sessionId: ObjectID.generate() }),
    ).toBe(false);
  });
});

describe("a session's refresh token expires by the end of its limit", () => {
  let pageRead: jest.SpiedFunction<typeof StatusPageService.findOneById>;
  let page: StatusPage;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(FROZEN_NOW);
    page = pageWithLength(null);
    pageRead = getJestSpyOn(
      StatusPageService,
      "findOneById",
    ).mockImplementation(async (): Promise<StatusPage | null> => {
      return page;
    }) as unknown as jest.SpiedFunction<typeof StatusPageService.findOneById>;
    getJestSpyOn(StatusPagePrivateUserService, "getRepository").mockReturnValue(
      {
        update: jest.fn(async (): Promise<UpdateResult> => {
          return { affected: 1, generatedMaps: [], raw: [] };
        }),
      } as unknown as Repository<StatusPagePrivateUser>,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const createSessionWith: (
    service: Service,
    statusPageId: ObjectID,
  ) => Promise<StatusPagePrivateUserSession> = async (
    service: Service,
    statusPageId: ObjectID,
  ): Promise<StatusPagePrivateUserSession> => {
    const create: jest.SpiedFunction<typeof service.create> = getJestSpyOn(
      service,
      "create",
    ).mockImplementation(
      async (
        request: CreateBy<StatusPagePrivateUserSession>,
      ): Promise<StatusPagePrivateUserSession> => {
        request.data.id = ObjectID.generate();
        return request.data;
      },
    ) as unknown as jest.SpiedFunction<typeof service.create>;

    await service.createSession({
      projectId: ObjectID.generate(),
      statusPageId,
      statusPagePrivateUserId: ObjectID.generate(),
    });

    return (create.mock.calls[0]![0] as CreateBy<StatusPagePrivateUserSession>)
      .data;
  };

  test("a new sign-in on a page with no limit keeps the 30 days", async () => {
    const service: Service = new Service();
    const session: StatusPagePrivateUserSession = await createSessionWith(
      service,
      page.id!,
    );

    expect(session.refreshTokenExpiresAt!.getTime()).toBe(thirtyDaysFromNow());
  });

  test.each([1, 8, 24, 168])(
    "a new sign-in on a page that signs readers out after %p hours expires then",
    async (lengthInHours: number) => {
      page = pageWithLength(lengthInHours);
      const service: Service = new Service();
      const session: StatusPagePrivateUserSession = await createSessionWith(
        service,
        page.id!,
      );

      expect(session.refreshTokenExpiresAt!.getTime()).toBe(
        FROZEN_NOW.getTime() + lengthInHours * HOUR,
      );
    },
  );

  test("a limit longer than 30 days leaves a new session its 30 days", async () => {
    page = pageWithLength(MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS);
    const service: Service = new Service();
    const session: StatusPagePrivateUserSession = await createSessionWith(
      service,
      page.id!,
    );

    expect(session.refreshTokenExpiresAt!.getTime()).toBe(thirtyDaysFromNow());
  });

  test("the page asked is the session's own, read as the server", async () => {
    const service: Service = new Service();
    const statusPageId: ObjectID = page.id!;
    await createSessionWith(service, statusPageId);

    expect(pageRead).toHaveBeenCalledTimes(1);
    expect(pageRead.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        id: statusPageId,
        select: { privateUserSessionLengthInHours: true },
        props: { isRoot: true },
      }),
    );
  });

  test("a login code keeps its five minutes and reads no page", async () => {
    page = pageWithLength(1);
    const service: Service = new Service();
    const create: jest.SpiedFunction<typeof service.create> = getJestSpyOn(
      service,
      "create",
    ).mockImplementation(
      async (
        request: CreateBy<StatusPagePrivateUserSession>,
      ): Promise<StatusPagePrivateUserSession> => {
        request.data.id = ObjectID.generate();
        return request.data;
      },
    ) as unknown as jest.SpiedFunction<typeof service.create>;

    await service.createLoginCodeSession({
      projectId: ObjectID.generate(),
      statusPageId: page.id!,
      statusPagePrivateUserId: ObjectID.generate(),
    });

    const written: StatusPagePrivateUserSession = (
      create.mock.calls[0]![0] as CreateBy<StatusPagePrivateUserSession>
    ).data;

    expect(written.refreshTokenExpiresAt!.getTime()).toBe(
      FROZEN_NOW.getTime() + 5 * 60 * 1000,
    );
    expect(pageRead).not.toHaveBeenCalled();
  });

  const sessionStartedHoursAgo: (
    hours: number,
  ) => StatusPagePrivateUserSession = (
    hours: number,
  ): StatusPagePrivateUserSession => {
    const session: StatusPagePrivateUserSession =
      new StatusPagePrivateUserSession();
    session.id = ObjectID.generate();
    session.statusPageId = page.id!;
    session.createdAt = new Date(FROZEN_NOW.getTime() - hours * HOUR);
    return session;
  };

  test("a refresh never renews a session past the end of its limit", async () => {
    page = pageWithLength(12);
    const service: Service = new Service();
    const update: jest.SpiedFunction<typeof service.updateOneByIdAndFetch> =
      getJestSpyOn(service, "updateOneByIdAndFetch").mockImplementation(
        async (): Promise<StatusPagePrivateUserSession> => {
          return new StatusPagePrivateUserSession();
        },
      ) as unknown as jest.SpiedFunction<typeof service.updateOneByIdAndFetch>;
    const session: StatusPagePrivateUserSession = sessionStartedHoursAgo(3);

    const renewed: { refreshTokenExpiresAt: Date } =
      await service.renewSessionWithNewRefreshToken({ session });

    const expectedEnd: number = session.createdAt!.getTime() + 12 * HOUR;

    expect(renewed.refreshTokenExpiresAt.getTime()).toBe(expectedEnd);
    expect(
      (
        update.mock.calls[0]![0] as {
          data: { refreshTokenExpiresAt: Date };
        }
      ).data.refreshTokenExpiresAt.getTime(),
    ).toBe(expectedEnd);
  });

  test("a refresh on a page with no limit renews the 30 days from now", async () => {
    const service: Service = new Service();
    getJestSpyOn(service, "updateOneByIdAndFetch").mockImplementation(
      async (): Promise<StatusPagePrivateUserSession> => {
        return new StatusPagePrivateUserSession();
      },
    );

    const renewed: { refreshTokenExpiresAt: Date } =
      await service.renewSessionWithNewRefreshToken({
        session: sessionStartedHoursAgo(20 * 24),
      });

    expect(renewed.refreshTokenExpiresAt.getTime()).toBe(thirtyDaysFromNow());
  });

  test("a refresh of a session whose sign-in time is unknown keeps the 30 days and reads no page", async () => {
    page = pageWithLength(1);
    const service: Service = new Service();
    getJestSpyOn(service, "updateOneByIdAndFetch").mockImplementation(
      async (): Promise<StatusPagePrivateUserSession> => {
        return new StatusPagePrivateUserSession();
      },
    );
    const session: StatusPagePrivateUserSession = sessionStartedHoursAgo(0);
    delete (session as unknown as Record<string, unknown>)["createdAt"];

    const renewed: { refreshTokenExpiresAt: Date } =
      await service.renewSessionWithNewRefreshToken({ session });

    expect(renewed.refreshTokenExpiresAt.getTime()).toBe(thirtyDaysFromNow());
    expect(pageRead).not.toHaveBeenCalled();
  });

  test("an expiry the caller chose is kept as it is", async () => {
    page = pageWithLength(1);
    const service: Service = new Service();
    getJestSpyOn(service, "updateOneByIdAndFetch").mockImplementation(
      async (): Promise<StatusPagePrivateUserSession> => {
        return new StatusPagePrivateUserSession();
      },
    );
    const chosen: Date = new Date(FROZEN_NOW.getTime() + 2 * DAY);

    const renewed: { refreshTokenExpiresAt: Date } =
      await service.renewSessionWithNewRefreshToken({
        session: sessionStartedHoursAgo(0),
        refreshTokenExpiresAt: chosen,
      });

    expect(renewed.refreshTokenExpiresAt).toEqual(chosen);
    expect(pageRead).not.toHaveBeenCalled();
  });

  test("a login code is exchanged for a session that ends by its limit, counted from the sign-in", async () => {
    page = pageWithLength(8);
    const service: Service = new Service();
    const loginCode: string = ObjectID.generate().toString();
    const session: StatusPagePrivateUserSession = sessionStartedHoursAgo(0);
    session.createdAt = new Date(FROZEN_NOW.getTime() - 2 * 60 * 1000);
    session.projectId = ObjectID.generate();
    session.statusPagePrivateUserId = ObjectID.generate();
    session.isRevoked = false;
    session.refreshToken = new HashedString(
      await HashedString.hashValue(loginCode, EncryptionSecret),
      true,
    );
    session.refreshTokenExpiresAt = new Date(
      FROZEN_NOW.getTime() + 3 * 60 * 1000,
    );
    session.additionalInfo = {
      oneuptimeStatusPageSessionPurpose: "login-code",
    };

    getJestSpyOn(service, "findOneBy").mockResolvedValue(session);
    const repositoryUpdate: jest.Mock<
      (where: unknown, data: unknown) => Promise<UpdateResult>
    > = jest.fn(async (): Promise<UpdateResult> => {
      return { affected: 1, generatedMaps: [], raw: [] };
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({
      update: repositoryUpdate,
    } as unknown as Repository<StatusPagePrivateUserSession>);

    const exchanged: { refreshTokenExpiresAt: Date } | null =
      await service.exchangeLoginCode(loginCode, {
        statusPageId: page.id!,
      });

    const expectedEnd: number = session.createdAt.getTime() + 8 * HOUR;

    expect(exchanged!.refreshTokenExpiresAt.getTime()).toBe(expectedEnd);
    expect(
      (
        repositoryUpdate.mock.calls[0]![1] as { refreshTokenExpiresAt: Date }
      ).refreshTokenExpiresAt.getTime(),
    ).toBe(expectedEnd);
  });
});

describe("what a status page write may hold", () => {
  test.each([null, 1, 12, MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS])(
    "%p is accepted",
    (value: number | null) => {
      expect(() => {
        assertStatusPageWriteValues({ privateUserSessionLengthInHours: value });
      }).not.toThrow();
    },
  );

  test("a write that leaves the setting alone is accepted", () => {
    expect(() => {
      assertStatusPageWriteValues({ name: "Status" });
    }).not.toThrow();
  });

  test.each([0, -3, MAX_PRIVATE_USER_SESSION_LENGTH_IN_HOURS + 1, 1.25, "8"])(
    "%p is refused with what is allowed",
    (value: unknown) => {
      let thrown: unknown = null;

      try {
        assertStatusPageWriteValues({ privateUserSessionLengthInHours: value });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as BadDataException).message).toBe(
        PRIVATE_USER_SESSION_LENGTH_PROBLEM,
      );
    },
  );

  test("a create and an update are both checked before anything is looked up", async () => {
    const service: typeof StatusPageService = StatusPageService;
    const checks: {
      checkCreateBeforeReferences: (
        createBy: CreateBy<StatusPage>,
      ) => Promise<void>;
      checkUpdateBeforeReferences: (
        updateBy: UpdateBy<StatusPage>,
      ) => Promise<void>;
    } = service as unknown as {
      checkCreateBeforeReferences: (
        createBy: CreateBy<StatusPage>,
      ) => Promise<void>;
      checkUpdateBeforeReferences: (
        updateBy: UpdateBy<StatusPage>,
      ) => Promise<void>;
    };

    const badPage: StatusPage = pageWithLength(0);

    await expect(
      checks.checkCreateBeforeReferences.call(service, {
        data: badPage,
        props: { isRoot: true },
      } as CreateBy<StatusPage>),
    ).rejects.toThrow(PRIVATE_USER_SESSION_LENGTH_PROBLEM);

    await expect(
      checks.checkUpdateBeforeReferences.call(service, {
        query: { _id: ObjectID.generate().toString() },
        data: { privateUserSessionLengthInHours: 9000 },
        props: { isRoot: true },
      } as unknown as UpdateBy<StatusPage>),
    ).rejects.toThrow(PRIVATE_USER_SESSION_LENGTH_PROBLEM);

    await expect(
      checks.checkUpdateBeforeReferences.call(service, {
        query: { _id: ObjectID.generate().toString() },
        data: { privateUserSessionLengthInHours: 24 },
        props: { isRoot: true },
      } as unknown as UpdateBy<StatusPage>),
    ).resolves.toBeUndefined();
  });
});
