import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import logger from "../../../Server/Utils/Logger";
import {
  CreateSessionOptions,
  Service,
  SessionMetadata,
  STATUS_PAGE_LOGIN_CODE_TTL_MINUTES,
} from "../../../Server/Services/StatusPagePrivateUserSessionService";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator, Repository, UpdateResult } from "typeorm";

/*
 * The SAML/OIDC callback now hands the status-page origin a short-lived,
 * single-use login code instead of putting an access token in browser-readable
 * state. These tests pin the security boundary at the service that creates and
 * consumes that code:
 *
 *  - it is recognisably a login code and expires in five minutes;
 *  - the page and purpose are both checked before redemption;
 *  - redemption is one atomic compare-and-swap on the old code hash;
 *  - the replacement credential is already hashed when it reaches TypeORM;
 *  - only the replacement plaintext can be looked up after redemption.
 *
 * The final group uses a small in-memory repository boundary. It models the
 * predicates PostgreSQL evaluates in the UPDATE, which lets two real
 * exchangeLoginCode calls race without requiring a database for this unit
 * suite. If the old hash, expiry, purpose, or affected-row check is removed,
 * those tests fail for the same reason the production exchange becomes
 * replayable.
 */

const PURPOSE_KEY: string = "oneuptimeStatusPageSessionPurpose";
const PURPOSE_VALUE: string = "login-code";
const FROZEN_NOW: Date = new Date("2026-08-31T10:00:00.000Z");
const ONE_MINUTE_IN_MILLISECONDS: number = 60 * 1000;
const ONE_DAY_IN_MILLISECONDS: number = 24 * 60 * ONE_MINUTE_IN_MILLISECONDS;

type SessionIds = {
  projectId: ObjectID;
  statusPageId: ObjectID;
  privateUserId: ObjectID;
  sessionId: ObjectID;
};

type LoginSessionOptions = {
  ids: SessionIds;
  loginCode: string;
  purpose?: string | undefined;
  statusPageId?: ObjectID | undefined;
  expiresAt?: Date | undefined;
  additionalInfo?: JSONObject | undefined;
};

type CasWhere = {
  _id: string;
  statusPageId: ObjectID;
  refreshToken: HashedString;
  refreshTokenExpiresAt: FindOperator<Date>;
  isRevoked: boolean;
  additionalInfo: FindOperator<JSONObject>;
};

type CasCall = {
  where: CasWhere;
  data: Partial<StatusPagePrivateUserSession>;
};

type InMemoryBoundary = {
  casCalls: Array<CasCall>;
  replacementWasPreHashed: Array<boolean>;
};

const buildIds: () => SessionIds = (): SessionIds => {
  return {
    projectId: ObjectID.generate(),
    statusPageId: ObjectID.generate(),
    privateUserId: ObjectID.generate(),
    sessionId: ObjectID.generate(),
  };
};

const cloneSession: (
  source: StatusPagePrivateUserSession,
) => StatusPagePrivateUserSession = (
  source: StatusPagePrivateUserSession,
): StatusPagePrivateUserSession => {
  const clone: StatusPagePrivateUserSession =
    new StatusPagePrivateUserSession();

  Object.assign(clone, source);

  if (source.additionalInfo) {
    clone.additionalInfo = { ...source.additionalInfo } as JSONObject;
  }

  return clone;
};

const buildLoginSession: (
  options: LoginSessionOptions,
) => Promise<StatusPagePrivateUserSession> = async (
  options: LoginSessionOptions,
): Promise<StatusPagePrivateUserSession> => {
  const session: StatusPagePrivateUserSession =
    new StatusPagePrivateUserSession();

  session.id = options.ids.sessionId;
  session.projectId = options.ids.projectId;
  session.statusPageId = options.statusPageId || options.ids.statusPageId;
  session.statusPagePrivateUserId = options.ids.privateUserId;
  session.refreshToken = new HashedString(
    await HashedString.hashValue(options.loginCode, EncryptionSecret),
    true,
  );
  session.refreshTokenExpiresAt =
    options.expiresAt ||
    new Date(
      FROZEN_NOW.getTime() +
        STATUS_PAGE_LOGIN_CODE_TTL_MINUTES * ONE_MINUTE_IN_MILLISECONDS,
    );
  session.lastActiveAt = FROZEN_NOW;
  session.isRevoked = false;
  session.additionalInfo = {
    ...(options.additionalInfo || {}),
    ...(options.purpose === undefined
      ? { [PURPOSE_KEY]: PURPOSE_VALUE }
      : options.purpose
        ? { [PURPOSE_KEY]: options.purpose }
        : {}),
  } as JSONObject;

  return session;
};

const asCasWhere: (value: unknown) => CasWhere = (value: unknown): CasWhere => {
  return value as CasWhere;
};

const asPartialSession: (
  value: unknown,
) => Partial<StatusPagePrivateUserSession> = (
  value: unknown,
): Partial<StatusPagePrivateUserSession> => {
  return value as Partial<StatusPagePrivateUserSession>;
};

const makeUpdateResult: (affected: number) => UpdateResult = (
  affected: number,
): UpdateResult => {
  return {
    affected,
    generatedMaps: [],
    raw: [],
  };
};

const installInMemoryBoundary: (
  service: Service,
  row: StatusPagePrivateUserSession,
  synchronizeFirstTwoReads?: boolean,
) => InMemoryBoundary = (
  service: Service,
  row: StatusPagePrivateUserSession,
  synchronizeFirstTwoReads: boolean = false,
): InMemoryBoundary => {
  const casCalls: Array<CasCall> = [];
  const replacementWasPreHashed: Array<boolean> = [];
  let matchingReadCount: number = 0;
  let releaseReads: (() => void) | undefined;
  const readsReleased: Promise<void> = new Promise<void>(
    (resolve: () => void): void => {
      releaseReads = resolve;
    },
  );

  getJestSpyOn(service, "findOneBy").mockImplementation(
    async (
      request: FindOneBy<StatusPagePrivateUserSession>,
    ): Promise<StatusPagePrivateUserSession | null> => {
      const requestedHash: HashedString = request.query[
        "refreshToken"
      ] as HashedString;

      if (
        !row.refreshToken ||
        row.refreshToken.toString() !== requestedHash.toString() ||
        row.isRevoked !== false
      ) {
        return null;
      }

      // A database read returns a snapshot, not the mutable stored-row object.
      const snapshot: StatusPagePrivateUserSession = cloneSession(row);

      if (synchronizeFirstTwoReads && matchingReadCount < 2) {
        matchingReadCount++;

        if (matchingReadCount === 2) {
          releaseReads!();
        }

        await readsReleased;
      }

      return snapshot;
    },
  );

  const update: (
    whereValue: unknown,
    dataValue: unknown,
  ) => Promise<UpdateResult> = async (
    whereValue: unknown,
    dataValue: unknown,
  ): Promise<UpdateResult> => {
    const where: CasWhere = asCasWhere(whereValue);
    const data: Partial<StatusPagePrivateUserSession> =
      asPartialSession(dataValue);

    casCalls.push({ where, data });
    replacementWasPreHashed.push(Boolean(data.refreshToken?.isValueHashed()));

    const requiredInfo: JSONObject = where.additionalInfo.value;
    const containsRequiredInfo: boolean = Object.entries(requiredInfo).every(
      ([key, value]: [string, unknown]): boolean => {
        return row.additionalInfo?.[key] === value;
      },
    );

    const matches: boolean = Boolean(
      row._id === where._id &&
        row.statusPageId?.toString() === where.statusPageId.toString() &&
        row.refreshToken?.toString() === where.refreshToken.toString() &&
        row.refreshTokenExpiresAt &&
        row.refreshTokenExpiresAt > where.refreshTokenExpiresAt.value &&
        row.isRevoked === where.isRevoked &&
        containsRequiredInfo,
    );

    if (!matches) {
      return makeUpdateResult(0);
    }

    Object.assign(row, data);
    return makeUpdateResult(1);
  };

  getJestSpyOn(service, "getRepository").mockReturnValue({
    update,
  } as unknown as Repository<StatusPagePrivateUserSession>);

  return { casCalls, replacementWasPreHashed };
};

describe("StatusPagePrivateUserSessionService sign-in and login-code exchange", () => {
  let privateUserUpdate: ReturnType<
    typeof jest.fn<() => Promise<UpdateResult>>
  >;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(FROZEN_NOW);
    privateUserUpdate = jest.fn(async (): Promise<UpdateResult> => {
      return makeUpdateResult(1);
    });
    getJestSpyOn(StatusPagePrivateUserService, "getRepository").mockReturnValue(
      {
        update: privateUserUpdate,
      } as unknown as Repository<StatusPagePrivateUser>,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test.each(["password", "SSO"])(
    "records private-user lastActive after successful %s sign-in",
    async (provider: string) => {
      const service: Service = new Service();
      const ids: SessionIds = buildIds();
      const create: jest.SpyInstance = getJestSpyOn(
        service,
        "create",
      ).mockImplementation(
        async (
          request: CreateBy<StatusPagePrivateUserSession>,
        ): Promise<StatusPagePrivateUserSession> => {
          expect(privateUserUpdate).not.toHaveBeenCalled();
          request.data.id = ids.sessionId;
          return request.data;
        },
      );
      const options: CreateSessionOptions = {
        projectId: ids.projectId,
        statusPageId: ids.statusPageId,
        statusPagePrivateUserId: ids.privateUserId,
      };

      if (provider === "password") {
        await service.createSession(options);
      } else {
        await service.createLoginCodeSession(options);
      }

      expect(create).toHaveBeenCalledTimes(1);
      expect(privateUserUpdate).toHaveBeenCalledTimes(1);
      expect(privateUserUpdate).toHaveBeenCalledWith(
        {
          _id: ids.privateUserId.toString(),
          projectId: ids.projectId,
          statusPageId: ids.statusPageId,
          deletedAt: expect.objectContaining({ _type: "isNull" }),
        },
        { lastActive: FROZEN_NOW },
      );
    },
  );

  test("does not record a sign-in when session creation fails", async () => {
    const service: Service = new Service();
    const ids: SessionIds = buildIds();
    getJestSpyOn(service, "create").mockRejectedValue(
      new Error("Session creation failed"),
    );

    await expect(
      service.createSession({
        projectId: ids.projectId,
        statusPageId: ids.statusPageId,
        statusPagePrivateUserId: ids.privateUserId,
      }),
    ).rejects.toThrow("Session creation failed");
    expect(privateUserUpdate).not.toHaveBeenCalled();
  });

  test.each(["session creation", "login-code exchange"])(
    "%s remains successful when activity bookkeeping fails",
    async (flow: string) => {
      const service: Service = new Service();
      const ids: SessionIds = buildIds();
      const loginCode: string = ObjectID.generate().toString();
      const session: StatusPagePrivateUserSession = await buildLoginSession({
        ids,
        loginCode,
      });
      const warn: jest.SpyInstance = getJestSpyOn(
        logger,
        "warn",
      ).mockImplementation((): void => {});
      privateUserUpdate.mockRejectedValue(
        new Error("Failed write containing private-user@example.com"),
      );

      if (flow === "session creation") {
        getJestSpyOn(service, "create").mockResolvedValue(session);
        await expect(
          service.createSession({
            projectId: ids.projectId,
            statusPageId: ids.statusPageId,
            statusPagePrivateUserId: ids.privateUserId,
          }),
        ).resolves.toEqual(expect.objectContaining({ session }));
      } else {
        installInMemoryBoundary(service, session);
        await expect(
          service.exchangeLoginCode(loginCode, {
            statusPageId: ids.statusPageId,
          }),
        ).resolves.not.toBeNull();
      }

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        `Failed to record sign-in activity for status page private user ${ids.privateUserId.toString()}`,
      );
    },
  );

  test("refresh and session activity do not count as a new sign-in", async () => {
    const service: Service = new Service();
    const ids: SessionIds = buildIds();
    const session: StatusPagePrivateUserSession = await buildLoginSession({
      ids,
      loginCode: ObjectID.generate().toString(),
      purpose: "",
    });
    getJestSpyOn(service, "updateOneByIdAndFetch").mockResolvedValue(session);
    getJestSpyOn(service, "updateOneById").mockResolvedValue(1);

    await service.renewSessionWithNewRefreshToken({ session });
    await service.touchSession(ids.sessionId, {});

    expect(privateUserUpdate).not.toHaveBeenCalled();
  });

  test("creates a purpose-marked login code that expires after five minutes", async () => {
    const service: Service = new Service();
    const ids: SessionIds = buildIds();
    const loginCode: string = ObjectID.generate().toString();
    const created: StatusPagePrivateUserSession =
      new StatusPagePrivateUserSession();

    const createSessionSpy: jest.SpyInstance = getJestSpyOn(
      service,
      "createSession",
    ).mockImplementation(
      async (options: CreateSessionOptions): Promise<SessionMetadata> => {
        created.id = ids.sessionId;
        created.additionalInfo = options.additionalInfo || {};

        return {
          session: created,
          refreshToken: loginCode,
          refreshTokenExpiresAt: options.refreshTokenExpiresAt!,
        };
      },
    );

    const result: SessionMetadata = await service.createLoginCodeSession({
      projectId: ids.projectId,
      statusPageId: ids.statusPageId,
      statusPagePrivateUserId: ids.privateUserId,
      additionalInfo: { identityProvider: "saml" },
    });

    expect(STATUS_PAGE_LOGIN_CODE_TTL_MINUTES).toBe(5);
    expect(createSessionSpy).toHaveBeenCalledTimes(1);

    const options: CreateSessionOptions = createSessionSpy.mock.calls[0]![0];
    expect(options.refreshToken).toBeUndefined();
    expect(options.refreshTokenExpiresAt).toEqual(
      new Date(FROZEN_NOW.getTime() + 5 * ONE_MINUTE_IN_MILLISECONDS),
    );
    expect(options.additionalInfo).toEqual({
      identityProvider: "saml",
      [PURPOSE_KEY]: PURPOSE_VALUE,
    });
    expect(service.isLoginCodeSession(result.session)).toBe(true);
  });

  test("rejects a malformed code before attempting a session lookup", async () => {
    const service: Service = new Service();
    const findActiveSessionSpy: jest.SpyInstance = getJestSpyOn(
      service,
      "findActiveSessionByRefreshToken",
    );

    await expect(
      service.exchangeLoginCode("not-a-uuid", {
        statusPageId: ObjectID.generate(),
      }),
    ).resolves.toBeNull();
    expect(findActiveSessionSpy).not.toHaveBeenCalled();
    expect(privateUserUpdate).not.toHaveBeenCalled();
  });

  test("rejects an ordinary refresh session with no login-code purpose", async () => {
    const service: Service = new Service();
    const ids: SessionIds = buildIds();
    const loginCode: string = ObjectID.generate().toString();
    const session: StatusPagePrivateUserSession = await buildLoginSession({
      ids,
      loginCode,
      purpose: "",
    });
    const update: CallableFunction = jest.fn();

    getJestSpyOn(service, "findActiveSessionByRefreshToken").mockResolvedValue(
      session,
    );
    getJestSpyOn(service, "getRepository").mockReturnValue({
      update,
    } as unknown as Repository<StatusPagePrivateUserSession>);

    await expect(
      service.exchangeLoginCode(loginCode, {
        statusPageId: ids.statusPageId,
      }),
    ).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(privateUserUpdate).not.toHaveBeenCalled();
  });

  test("rejects a valid login code presented for another status page", async () => {
    const service: Service = new Service();
    const ids: SessionIds = buildIds();
    const loginCode: string = ObjectID.generate().toString();
    const session: StatusPagePrivateUserSession = await buildLoginSession({
      ids,
      loginCode,
    });
    const update: CallableFunction = jest.fn();

    getJestSpyOn(service, "findActiveSessionByRefreshToken").mockResolvedValue(
      session,
    );
    getJestSpyOn(service, "getRepository").mockReturnValue({
      update,
    } as unknown as Repository<StatusPagePrivateUserSession>);

    await expect(
      service.exchangeLoginCode(loginCode, {
        statusPageId: ObjectID.generate(),
      }),
    ).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(privateUserUpdate).not.toHaveBeenCalled();
  });

  test.each(["statusPagePrivateUserId", "projectId"] as const)(
    "rejects a login code missing %s without changing any user's activity",
    async (missingField: "statusPagePrivateUserId" | "projectId") => {
      const service: Service = new Service();
      const ids: SessionIds = buildIds();
      const loginCode: string = ObjectID.generate().toString();
      const session: StatusPagePrivateUserSession = await buildLoginSession({
        ids,
        loginCode,
      });
      Object.assign(session, { [missingField]: undefined });
      getJestSpyOn(
        service,
        "findActiveSessionByRefreshToken",
      ).mockResolvedValue(session);
      const repository: jest.SpyInstance = getJestSpyOn(
        service,
        "getRepository",
      );

      await expect(
        service.exchangeLoginCode(loginCode, {
          statusPageId: ids.statusPageId,
        }),
      ).resolves.toBeNull();

      expect(repository).not.toHaveBeenCalled();
      expect(privateUserUpdate).not.toHaveBeenCalled();
    },
  );

  test.each(["expired", "revoked"])(
    "a %s login code cannot update private-user lastActive",
    async (state: string) => {
      const service: Service = new Service();
      const ids: SessionIds = buildIds();
      const loginCode: string = ObjectID.generate().toString();
      const session: StatusPagePrivateUserSession = await buildLoginSession({
        ids,
        loginCode,
      });

      if (state === "expired") {
        session.refreshTokenExpiresAt = new Date(FROZEN_NOW.getTime() - 1);
      } else {
        session.isRevoked = true;
      }

      const boundary: InMemoryBoundary = installInMemoryBoundary(
        service,
        session,
      );

      await expect(
        service.exchangeLoginCode(loginCode, {
          statusPageId: ids.statusPageId,
        }),
      ).resolves.toBeNull();

      expect(boundary.casCalls).toHaveLength(0);
      expect(privateUserUpdate).not.toHaveBeenCalled();
    },
  );

  test("binds the atomic exchange to the old hash, expiry, purpose, and revocation state", async () => {
    const service: Service = new Service();
    const ids: SessionIds = buildIds();
    const loginCode: string = ObjectID.generate().toString();
    const session: StatusPagePrivateUserSession = await buildLoginSession({
      ids,
      loginCode,
      additionalInfo: { identityProvider: "oidc", retained: true },
    });
    let call: CasCall | undefined;

    const update: (
      whereValue: unknown,
      dataValue: unknown,
    ) => Promise<UpdateResult> = async (
      whereValue: unknown,
      dataValue: unknown,
    ): Promise<UpdateResult> => {
      call = {
        where: asCasWhere(whereValue),
        data: asPartialSession(dataValue),
      };
      return makeUpdateResult(1);
    };

    getJestSpyOn(service, "findActiveSessionByRefreshToken").mockResolvedValue(
      session,
    );
    getJestSpyOn(service, "getRepository").mockReturnValue({
      update,
    } as unknown as Repository<StatusPagePrivateUserSession>);

    const result: SessionMetadata | null = await service.exchangeLoginCode(
      loginCode,
      {
        statusPageId: ids.statusPageId,
        ipAddress: "192.0.2.10",
        additionalInfo: { exchangedBy: "status-page-origin" },
      },
    );

    expect(result).not.toBeNull();
    expect(call).toBeDefined();

    const where: CasWhere = call!.where;
    const data: Partial<StatusPagePrivateUserSession> = call!.data;
    const oldHash: string = await HashedString.hashValue(
      loginCode,
      EncryptionSecret,
    );

    expect(where._id).toBe(ids.sessionId.toString());
    expect(where.statusPageId.toString()).toBe(ids.statusPageId.toString());
    expect(where.refreshToken.toString()).toBe(oldHash);
    expect(where.refreshToken.isValueHashed()).toBe(true);
    expect(where.refreshTokenExpiresAt.type).toBe("moreThan");
    expect(where.refreshTokenExpiresAt.value).toEqual(FROZEN_NOW);
    expect(where.isRevoked).toBe(false);
    expect(where.additionalInfo.type).toBe("jsonContains");
    expect(where.additionalInfo.value).toEqual({
      [PURPOSE_KEY]: PURPOSE_VALUE,
    });

    const replacementHash: string = await HashedString.hashValue(
      result!.refreshToken,
      EncryptionSecret,
    );
    expect(data.refreshToken).toBeInstanceOf(HashedString);
    expect(data.refreshToken?.isValueHashed()).toBe(true);
    expect(data.refreshToken?.toString()).toBe(replacementHash);
    expect(data.refreshToken?.toString()).not.toBe(result!.refreshToken);
    expect(result!.session.refreshToken?.isValueHashed()).toBe(true);
    expect(result!.session.refreshToken?.toString()).toBe(replacementHash);
    expect(data.refreshTokenExpiresAt).toEqual(
      new Date(FROZEN_NOW.getTime() + 30 * ONE_DAY_IN_MILLISECONDS),
    );
    expect(data.additionalInfo).toEqual({
      identityProvider: "oidc",
      retained: true,
      exchangedBy: "status-page-origin",
    });
    expect(data.additionalInfo?.[PURPOSE_KEY]).toBeUndefined();
    expect(result!.session.additionalInfo?.[PURPOSE_KEY]).toBeUndefined();
    expect(privateUserUpdate).toHaveBeenCalledWith(
      {
        _id: ids.privateUserId.toString(),
        projectId: ids.projectId,
        statusPageId: ids.statusPageId,
        deletedAt: expect.objectContaining({ _type: "isNull" }),
      },
      { lastActive: FROZEN_NOW },
    );
  });

  test("returns null when the compare-and-swap affects no row", async () => {
    const service: Service = new Service();
    const ids: SessionIds = buildIds();
    const loginCode: string = ObjectID.generate().toString();
    const session: StatusPagePrivateUserSession = await buildLoginSession({
      ids,
      loginCode,
    });
    const update: CallableFunction = jest.fn(
      async (): Promise<UpdateResult> => {
        return makeUpdateResult(0);
      },
    );

    getJestSpyOn(service, "findActiveSessionByRefreshToken").mockResolvedValue(
      session,
    );
    getJestSpyOn(service, "getRepository").mockReturnValue({
      update,
    } as unknown as Repository<StatusPagePrivateUserSession>);

    await expect(
      service.exchangeLoginCode(loginCode, {
        statusPageId: ids.statusPageId,
      }),
    ).resolves.toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
    expect(privateUserUpdate).not.toHaveBeenCalled();
  });

  test("allows exactly one of two concurrent redemptions", async () => {
    const service: Service = new Service();
    const ids: SessionIds = buildIds();
    const loginCode: string = ObjectID.generate().toString();
    const row: StatusPagePrivateUserSession = await buildLoginSession({
      ids,
      loginCode,
      additionalInfo: { identityProvider: "saml" },
    });
    const boundary: InMemoryBoundary = installInMemoryBoundary(
      service,
      row,
      true,
    );

    const results: Array<SessionMetadata | null> = await Promise.all([
      service.exchangeLoginCode(loginCode, {
        statusPageId: ids.statusPageId,
        deviceBrowser: "first contender",
      }),
      service.exchangeLoginCode(loginCode, {
        statusPageId: ids.statusPageId,
        deviceBrowser: "second contender",
      }),
    ]);

    const successful: Array<SessionMetadata> = results.filter(
      (result: SessionMetadata | null): result is SessionMetadata => {
        return result !== null;
      },
    );

    expect(successful).toHaveLength(1);
    expect(
      results.filter((result: SessionMetadata | null) => {
        return !result;
      }),
    ).toHaveLength(1);
    expect(boundary.casCalls).toHaveLength(2);
    expect(boundary.replacementWasPreHashed).toEqual([true, true]);
    expect(row.additionalInfo).toEqual({ identityProvider: "saml" });
    expect(row.additionalInfo?.[PURPOSE_KEY]).toBeUndefined();
    expect(privateUserUpdate).toHaveBeenCalledTimes(1);
  });

  test("resolves the rotated plaintext credential but never the consumed code", async () => {
    const service: Service = new Service();
    const ids: SessionIds = buildIds();
    const loginCode: string = ObjectID.generate().toString();
    const oldHash: string = await HashedString.hashValue(
      loginCode,
      EncryptionSecret,
    );
    const row: StatusPagePrivateUserSession = await buildLoginSession({
      ids,
      loginCode,
    });
    const boundary: InMemoryBoundary = installInMemoryBoundary(service, row);

    const exchanged: SessionMetadata | null = await service.exchangeLoginCode(
      loginCode,
      { statusPageId: ids.statusPageId },
    );

    expect(exchanged).not.toBeNull();
    expect(boundary.casCalls).toHaveLength(1);
    expect(boundary.replacementWasPreHashed).toEqual([true]);
    expect(row.refreshToken?.toString()).not.toBe(oldHash);

    const rotated: StatusPagePrivateUserSession | null =
      await service.findActiveSessionByRefreshToken(exchanged!.refreshToken);
    const consumed: StatusPagePrivateUserSession | null =
      await service.findActiveSessionByRefreshToken(loginCode);

    expect(rotated?.id?.toString()).toBe(ids.sessionId.toString());
    expect(consumed).toBeNull();

    await expect(
      service.exchangeLoginCode(loginCode, {
        statusPageId: ids.statusPageId,
      }),
    ).resolves.toBeNull();
    expect(boundary.casCalls).toHaveLength(1);
    expect(privateUserUpdate).toHaveBeenCalledTimes(1);
  });
});
