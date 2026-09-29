import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import WorkflowVariableService from "../../../../Server/Services/WorkflowVariableService";
import logger from "../../../../Server/Utils/Logger";
import OAuth2TokenClient, {
  OAuth2TokenHttpRequest,
  OAuth2TokenHttpResponse,
  OAuth2TokenRequestException,
} from "../../../../Server/Utils/Workflow/OAuth2TokenClient";
import WorkflowVariableOAuthToken, {
  WORKFLOW_VARIABLE_OAUTH_LOCK_NAMESPACE,
  WorkflowVariableAccessToken,
} from "../../../../Server/Utils/Workflow/WorkflowVariableOAuthToken";
import WorkflowVariable from "../../../../Models/DatabaseModels/WorkflowVariable";
import ObjectID from "../../../../Types/ObjectID";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../../Types/Workflow/WorkflowVariableOAuth";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WorkflowVariableOAuthToken decides whether an OAuth variable's cached token
 * will do, fetches a new one when it will not, stores what came back, and
 * serialises refreshes per variable so concurrent runs cannot waste - or, with
 * rotating refresh tokens, destroy - each other's work.
 *
 * The database is an in-memory row behind findOneById/updateOneById, the
 * identity provider is a fake transport, and the Redis mutex is replaced by an
 * in-process one with the same contract (one holder at a time, FIFO waiters).
 */

/*
 * Structurally typed: @jest/globals and the ambient jest types disagree about
 * spy types.
 */
interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

interface MockableSpy {
  mockImplementation: (implementation: () => Promise<unknown>) => void;
}

const VARIABLE_ID: ObjectID = new ObjectID(
  "cccc1111-1111-4111-8111-111111111111",
);

interface Row {
  _id: string;
  name: string;
  variableType: WorkflowVariableType;
  oauthGrantType: OAuth2GrantType;
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthClientSecret?: string | undefined;
  oauthRefreshToken?: string | undefined;
  oauthScope?: string | undefined;
  oauthAdditionalParameters?: Record<string, unknown> | undefined;
  oauthClientAuthenticationMethod?:
    | OAuth2ClientAuthenticationMethod
    | undefined;
  oauthAccessToken?: string | null | undefined;
  oauthAccessTokenExpiresAt?: Date | null | undefined;
  oauthLastRefreshedAt?: Date | null | undefined;
  oauthLastRefreshError?: string | null | undefined;
  oauthLastRefreshErrorAt?: Date | null | undefined;
}

let row: Row;
let updates: Array<{ data: Record<string, unknown>; props: unknown }>;
let tokenRequests: Array<OAuth2TokenHttpRequest>;

function baseRow(overrides?: Partial<Row>): Row {
  return {
    _id: VARIABLE_ID.toString(),
    name: "API_TOKEN",
    variableType: WorkflowVariableType.OAuth2,
    oauthGrantType: OAuth2GrantType.ClientCredentials,
    oauthTokenUrl: "https://login.example.com/oauth2/token",
    oauthClientId: "client-123",
    oauthClientSecret: "client-secret",
    ...overrides,
  };
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function asModel(source: Row): WorkflowVariable {
  const model: WorkflowVariable = new WorkflowVariable();

  for (const [key, value] of Object.entries(source)) {
    (model as unknown as Record<string, unknown>)[key] = value;
  }

  return model;
}

function stubDatabase(): void {
  jest
    .spyOn(WorkflowVariableService, "findOneById")
    .mockImplementation(async () => {
      return row ? asModel(row) : null;
    });

  jest
    .spyOn(WorkflowVariableService, "updateOneById")
    .mockImplementation(async (input: unknown) => {
      const typed: { data: Record<string, unknown>; props: unknown } =
        input as { data: Record<string, unknown>; props: unknown };

      updates.push({ data: { ...typed.data }, props: typed.props });

      Object.assign(row, typed.data);

      return 1 as never;
    });
}

function respondWith(
  responses: Array<OAuth2TokenHttpResponse | Error>,
  delayInMs: number = 0,
): void {
  jest
    .spyOn(OAuth2TokenClient, "transport")
    .mockImplementation(async (request: OAuth2TokenHttpRequest) => {
      tokenRequests.push(request);

      if (delayInMs) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, delayInMs);
        });
      }

      const next: OAuth2TokenHttpResponse | Error | undefined =
        responses.shift();

      if (!next) {
        throw new Error("The fake identity provider ran out of answers.");
      }

      if (next instanceof Error) {
        throw next;
      }

      return next;
    });
}

function tokenResponse(body: Record<string, unknown>): OAuth2TokenHttpResponse {
  return {
    statusCode: 200,
    bodyText: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

/*
 * An in-process stand-in for the Redis mutex: one holder at a time, waiters
 * served in order. It records what the manager asked for, so the tests can
 * check the key and timeouts as well as the exclusion.
 */
interface LockRecorder {
  lockCalls: Array<Record<string, unknown>>;
  releases: number;
  maxConcurrentHolders: number;
}

function stubInProcessLock(): LockRecorder {
  const recorder: LockRecorder = {
    lockCalls: [],
    releases: 0,
    maxConcurrentHolders: 0,
  };

  let tail: Promise<void> = Promise.resolve();
  let holders: number = 0;

  jest.spyOn(Semaphore, "lock").mockImplementation(async (data: unknown) => {
    recorder.lockCalls.push(data as Record<string, unknown>);

    let release!: () => void;
    const released: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    const previous: Promise<void> = tail;
    tail = previous.then(() => {
      return released;
    });

    await previous;

    holders++;
    recorder.maxConcurrentHolders = Math.max(
      recorder.maxConcurrentHolders,
      holders,
    );

    return {
      release: async (): Promise<void> => {
        holders--;
        release();
      },
    } as unknown as SemaphoreMutex;
  });

  jest
    .spyOn(Semaphore, "release")
    .mockImplementation(async (mutex: SemaphoreMutex) => {
      recorder.releases++;
      await (mutex as unknown as { release: () => Promise<void> }).release();
    });

  return recorder;
}

describe("WorkflowVariableOAuthToken.getAccessToken", () => {
  let lock: LockRecorder;

  beforeEach(() => {
    row = baseRow();
    updates = [];
    tokenRequests = [];
    stubDatabase();
    lock = stubInProcessLock();
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a cached token that will do", () => {
    test("is returned without asking the identity provider", async () => {
      const expiresAt: Date = secondsFromNow(1800);
      const refreshedAt: Date = secondsFromNow(-1800);

      row = baseRow({
        oauthAccessToken: "cached-token",
        oauthAccessTokenExpiresAt: expiresAt,
        oauthLastRefreshedAt: refreshedAt,
      });
      respondWith([]);

      const token: WorkflowVariableAccessToken =
        await WorkflowVariableOAuthToken.getAccessToken({
          variableId: VARIABLE_ID,
        });

      expect(token).toEqual({
        accessToken: "cached-token",
        expiresAt,
        refreshedAt,
        didRefresh: false,
      });
      expect(tokenRequests).toHaveLength(0);
      expect(updates).toHaveLength(0);
    });

    /*
     * An unknown expiry is trusted only for a token fetched at or after the
     * cut-off the runner passes (its start time), so one run fetches it once
     * and every later step of that run shares it.
     */
    test("includes a token with no expiry fetched after the cut-off", async () => {
      const cutOff: Date = secondsFromNow(-10);

      row = baseRow({
        oauthAccessToken: "no-expiry-token",
        oauthAccessTokenExpiresAt: null,
        oauthLastRefreshedAt: secondsFromNow(-5),
      });
      respondWith([]);

      const token: WorkflowVariableAccessToken =
        await WorkflowVariableOAuthToken.getAccessToken({
          variableId: VARIABLE_ID,
          acceptTokenRefreshedAtOrAfter: cutOff,
        });

      expect(token.accessToken).toBe("no-expiry-token");
      expect(token.didRefresh).toBe(false);
      expect(tokenRequests).toHaveLength(0);
    });
  });

  describe("a token that will not do", () => {
    test("is fetched and stored when there is none", async () => {
      respondWith([
        tokenResponse({ access_token: "fresh-token", expires_in: 3600 }),
      ]);

      const before: number = Date.now();

      const token: WorkflowVariableAccessToken =
        await WorkflowVariableOAuthToken.getAccessToken({
          variableId: VARIABLE_ID,
        });

      expect(token.accessToken).toBe("fresh-token");
      expect(token.didRefresh).toBe(true);
      expect(token.expiresAt!.getTime()).toBeGreaterThanOrEqual(
        before + 3600 * 1000,
      );

      expect(tokenRequests).toHaveLength(1);
      expect(tokenRequests[0]!.url).toBe(
        "https://login.example.com/oauth2/token",
      );
      expect(tokenRequests[0]!.body).toEqual({
        grant_type: "client_credentials",
      });

      expect(updates).toHaveLength(1);
      expect(updates[0]!.data).toEqual({
        oauthAccessToken: "fresh-token",
        oauthAccessTokenExpiresAt: token.expiresAt,
        oauthLastRefreshedAt: token.refreshedAt,
        oauthLastRefreshError: null,
        oauthLastRefreshErrorAt: null,
      });
    });

    /*
     * The write goes through the normal update path as root with hooks off:
     * root because nobody may write these columns through the API, hooks off
     * because the service's update hook would clear a token whenever the OAuth
     * settings change - and encryption, which _updateBy applies outside the
     * hook branch, still happens.
     */
    test("is stored as root, with the service hooks skipped", async () => {
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      });

      expect(updates[0]!.props).toEqual({ isRoot: true, ignoreHooks: true });
    });

    test("is fetched when the cached one has expired", async () => {
      row = baseRow({
        oauthAccessToken: "stale-token",
        oauthAccessTokenExpiresAt: secondsFromNow(-60),
        oauthLastRefreshedAt: secondsFromNow(-3660),
      });
      respondWith([
        tokenResponse({ access_token: "fresh-token", expires_in: 3600 }),
      ]);

      const token: WorkflowVariableAccessToken =
        await WorkflowVariableOAuthToken.getAccessToken({
          variableId: VARIABLE_ID,
        });

      expect(token.accessToken).toBe("fresh-token");
      expect(row.oauthAccessToken).toBe("fresh-token");
    });

    test("is fetched when the cached one is inside the refresh margin", async () => {
      row = baseRow({
        oauthAccessToken: "about-to-expire",
        oauthAccessTokenExpiresAt: secondsFromNow(30),
        oauthLastRefreshedAt: secondsFromNow(-3570),
      });
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      expect(
        (
          await WorkflowVariableOAuthToken.getAccessToken({
            variableId: VARIABLE_ID,
          })
        ).accessToken,
      ).toBe("fresh-token");
    });

    test("is fetched when its expiry is unknown and it predates the cut-off", async () => {
      row = baseRow({
        oauthAccessToken: "old-no-expiry-token",
        oauthAccessTokenExpiresAt: null,
        oauthLastRefreshedAt: secondsFromNow(-600),
      });
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      const token: WorkflowVariableAccessToken =
        await WorkflowVariableOAuthToken.getAccessToken({
          variableId: VARIABLE_ID,
          acceptTokenRefreshedAtOrAfter: secondsFromNow(-60),
        });

      expect(token.accessToken).toBe("fresh-token");
      // The new token reports no expiry either, and is stored as such.
      expect(token.expiresAt).toBeNull();
      expect(updates[0]!.data["oauthAccessTokenExpiresAt"]).toBeNull();
    });

    test("forceRefresh ignores a perfectly good cached token", async () => {
      row = baseRow({
        oauthAccessToken: "cached-token",
        oauthAccessTokenExpiresAt: secondsFromNow(3000),
        oauthLastRefreshedAt: secondsFromNow(-600),
      });
      respondWith([tokenResponse({ access_token: "forced-token" })]);

      const token: WorkflowVariableAccessToken =
        await WorkflowVariableOAuthToken.getAccessToken({
          variableId: VARIABLE_ID,
          forceRefresh: true,
        });

      expect(token.accessToken).toBe("forced-token");
      expect(tokenRequests).toHaveLength(1);
    });
  });

  describe("the request it makes", () => {
    test("uses every setting on the variable", async () => {
      row = baseRow({
        oauthClientAuthenticationMethod:
          OAuth2ClientAuthenticationMethod.RequestBody,
        oauthScope: "api.read",
        oauthAdditionalParameters: { audience: "https://api.example.com" },
      });
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      });

      expect(tokenRequests[0]!.body).toEqual({
        audience: "https://api.example.com",
        grant_type: "client_credentials",
        client_id: "client-123",
        client_secret: "client-secret",
        scope: "api.read",
      });
    });

    test("passes the caller's timeout on", async () => {
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
        timeoutInMs: 4321,
      });

      expect(tokenRequests[0]!.timeoutInMs).toBe(4321);
    });

    test("reads the credentials as root", async () => {
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      });

      const findCall: { props: unknown; select: Record<string, unknown> } = (
        WorkflowVariableService.findOneById as unknown as {
          mock: {
            calls: Array<[{ props: unknown; select: Record<string, unknown> }]>;
          };
        }
      ).mock.calls[0]![0];

      expect(findCall.props).toEqual({ isRoot: true });
      expect(findCall.select).toEqual(
        expect.objectContaining({
          oauthClientSecret: true,
          oauthRefreshToken: true,
          oauthAccessToken: true,
          oauthAccessTokenExpiresAt: true,
        }),
      );
    });
  });

  describe("refresh token rotation", () => {
    beforeEach(() => {
      row = baseRow({
        oauthGrantType: OAuth2GrantType.RefreshToken,
        oauthRefreshToken: "refresh-1",
      });
    });

    test("stores the refresh token the provider rotated to", async () => {
      respondWith([
        tokenResponse({
          access_token: "fresh-token",
          expires_in: 3600,
          refresh_token: "refresh-2",
        }),
      ]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      });

      expect(tokenRequests[0]!.body["refresh_token"]).toBe("refresh-1");
      expect(updates[0]!.data["oauthRefreshToken"]).toBe("refresh-2");
      expect(row.oauthRefreshToken).toBe("refresh-2");
    });

    /*
     * RFC 6749 section 6 lets a provider keep the old refresh token valid and
     * say nothing. Clearing the stored one then would break every later
     * refresh.
     */
    test("keeps the stored refresh token when the provider sends none", async () => {
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      });

      expect(updates[0]!.data).not.toHaveProperty("oauthRefreshToken");
      expect(row.oauthRefreshToken).toBe("refresh-1");
    });

    test("does not rewrite a refresh token the provider echoed unchanged", async () => {
      respondWith([
        tokenResponse({
          access_token: "fresh-token",
          refresh_token: "refresh-1",
        }),
      ]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      });

      expect(updates[0]!.data).not.toHaveProperty("oauthRefreshToken");
    });
  });

  describe("when the identity provider says no", () => {
    test("records why on the variable and fails with the same reason", async () => {
      row = baseRow({
        oauthAccessToken: "stale-token",
        oauthAccessTokenExpiresAt: secondsFromNow(-60),
        oauthLastRefreshedAt: secondsFromNow(-3660),
      });
      respondWith([
        {
          statusCode: 401,
          bodyText: JSON.stringify({ error: "invalid_client" }),
          headers: {},
        },
      ]);

      const error: unknown = await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      }).catch((err: unknown) => {
        return err;
      });

      expect(error).toBeInstanceOf(OAuth2TokenRequestException);
      expect((error as Error).message).toContain("invalid_client");

      expect(updates).toHaveLength(1);
      expect(updates[0]!.data["oauthLastRefreshError"]).toBe(
        (error as Error).message,
      );
      expect(updates[0]!.data["oauthLastRefreshErrorAt"]).toBeInstanceOf(Date);
      expect(updates[0]!.props).toEqual({ isRoot: true, ignoreHooks: true });

      // The cached token is left alone; it is not this call's to throw away.
      expect(updates[0]!.data).not.toHaveProperty("oauthAccessToken");
      expect(row.oauthAccessToken).toBe("stale-token");
    });

    test("clears a recorded failure on the next success", async () => {
      row = baseRow({
        oauthLastRefreshError: "invalid_client",
        oauthLastRefreshErrorAt: secondsFromNow(-60),
      });
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      });

      expect(row.oauthLastRefreshError).toBeNull();
      expect(row.oauthLastRefreshErrorAt).toBeNull();
    });

    test("caps a very long reason before storing it", async () => {
      respondWith([new Error("x".repeat(5000))]);

      await expect(
        WorkflowVariableOAuthToken.getAccessToken({ variableId: VARIABLE_ID }),
      ).rejects.toThrow(OAuth2TokenRequestException);

      expect(
        (updates[0]!.data["oauthLastRefreshError"] as string).length,
      ).toBeLessThanOrEqual(2000);
    });

    /*
     * The caller is already failing with the provider's reason. A database
     * error while recording it must not replace that reason.
     */
    test("still reports the provider's reason when recording it fails", async () => {
      respondWith([
        {
          statusCode: 400,
          bodyText: JSON.stringify({ error: "invalid_scope" }),
          headers: {},
        },
      ]);

      (
        WorkflowVariableService.updateOneById as unknown as MockableSpy
      ).mockImplementation(async () => {
        throw new Error("database is down");
      });

      await expect(
        WorkflowVariableOAuthToken.getAccessToken({ variableId: VARIABLE_ID }),
      ).rejects.toThrow("invalid_scope");

      expect(logger.error).toHaveBeenCalled();
    });

    test("does not send a request for a variable that is missing its secret", async () => {
      row = baseRow({ oauthClientSecret: undefined });
      respondWith([]);

      await expect(
        WorkflowVariableOAuthToken.getAccessToken({ variableId: VARIABLE_ID }),
      ).rejects.toThrow("The client secret is not set.");

      expect(tokenRequests).toHaveLength(0);
      expect(updates[0]!.data["oauthLastRefreshError"]).toContain(
        "The client secret is not set.",
      );
    });
  });

  describe("refusals", () => {
    test("a variable that does not exist", async () => {
      row = null as unknown as Row;
      respondWith([]);

      await expect(
        WorkflowVariableOAuthToken.getAccessToken({ variableId: VARIABLE_ID }),
      ).rejects.toThrow("Workflow variable not found.");
    });

    test("a Static variable", async () => {
      row = baseRow({ variableType: WorkflowVariableType.Static });
      respondWith([]);

      await expect(
        WorkflowVariableOAuthToken.getAccessToken({ variableId: VARIABLE_ID }),
      ).rejects.toThrow('"API_TOKEN" is not an OAuth 2.0 variable');

      expect(tokenRequests).toHaveLength(0);
    });
  });

  describe("the per-variable lock", () => {
    test("is taken on the variable's id and released afterwards", async () => {
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      });

      expect(lock.lockCalls).toHaveLength(1);
      expect(lock.lockCalls[0]).toEqual(
        expect.objectContaining({
          key: VARIABLE_ID.toString(),
          namespace: WORKFLOW_VARIABLE_OAUTH_LOCK_NAMESPACE,
        }),
      );
      // Longer than one token request, so a waiter outlasts the holder.
      expect(lock.lockCalls[0]!["acquireTimeout"]).toBeGreaterThan(20000);
      expect(lock.releases).toBe(1);
    });

    test("is released when the refresh fails", async () => {
      respondWith([new Error("connection refused")]);

      await expect(
        WorkflowVariableOAuthToken.getAccessToken({ variableId: VARIABLE_ID }),
      ).rejects.toThrow("connection refused");

      expect(lock.releases).toBe(1);
    });

    test("is released when the token will do and nothing is fetched", async () => {
      row = baseRow({
        oauthAccessToken: "cached-token",
        oauthAccessTokenExpiresAt: secondsFromNow(1800),
      });
      respondWith([]);

      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: VARIABLE_ID,
      });

      expect(lock.releases).toBe(1);
    });

    /*
     * The heart of it. Five runs reach an expired token together. The first to
     * get the lock fetches; the other four wait, re-read the row once they get
     * it, find the token the first one stored, and make no request. With a
     * rotating refresh token, four more requests would have been four
     * invalid_grant failures - and possibly a lost refresh token.
     */
    test("makes concurrent callers share one refresh", async () => {
      row = baseRow({
        oauthGrantType: OAuth2GrantType.RefreshToken,
        oauthRefreshToken: "refresh-1",
        oauthAccessToken: "stale-token",
        oauthAccessTokenExpiresAt: secondsFromNow(-60),
        oauthLastRefreshedAt: secondsFromNow(-3660),
      });
      respondWith(
        [
          tokenResponse({
            access_token: "shared-token",
            expires_in: 3600,
            refresh_token: "refresh-2",
          }),
        ],
        50,
      );

      const tokens: Array<WorkflowVariableAccessToken> = await Promise.all(
        [1, 2, 3, 4, 5].map(() => {
          return WorkflowVariableOAuthToken.getAccessToken({
            variableId: VARIABLE_ID,
          });
        }),
      );

      expect(tokenRequests).toHaveLength(1);
      expect(
        tokens.map((token: WorkflowVariableAccessToken) => {
          return token.accessToken;
        }),
      ).toEqual([
        "shared-token",
        "shared-token",
        "shared-token",
        "shared-token",
        "shared-token",
      ]);
      expect(
        tokens.filter((token: WorkflowVariableAccessToken) => {
          return token.didRefresh;
        }),
      ).toHaveLength(1);
      expect(row.oauthRefreshToken).toBe("refresh-2");
      expect(lock.maxConcurrentHolders).toBe(1);
      expect(lock.releases).toBe(5);
    });

    /*
     * Without Redis (or with a lock nobody releases in time) there is nothing
     * to serialise on. Failing every run would be worse than the rare double
     * refresh, so the refresh goes ahead - and says so in the log.
     */
    test("goes ahead without a lock when one cannot be had", async () => {
      jest.restoreAllMocks();
      stubDatabase();
      jest.spyOn(logger, "warn").mockImplementation((): void => {
        return undefined;
      });
      jest
        .spyOn(Semaphore, "lock")
        .mockRejectedValue(new Error("Redis client is not connected"));
      const release: RecordedSpy = jest.spyOn(
        Semaphore,
        "release",
      ) as unknown as RecordedSpy;
      respondWith([tokenResponse({ access_token: "unlocked-token" })]);

      const token: WorkflowVariableAccessToken =
        await WorkflowVariableOAuthToken.getAccessToken({
          variableId: VARIABLE_ID,
        });

      expect(token.accessToken).toBe("unlocked-token");
      expect(release).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "without a lock: Redis client is not connected",
        ),
      );
    });

    test("a lock that cannot be released does not cost the caller its token", async () => {
      (Semaphore.release as unknown as MockableSpy).mockImplementation(
        async () => {
          throw new Error("Redis went away");
        },
      );
      respondWith([tokenResponse({ access_token: "fresh-token" })]);

      const token: WorkflowVariableAccessToken =
        await WorkflowVariableOAuthToken.getAccessToken({
          variableId: VARIABLE_ID,
        });

      expect(token.accessToken).toBe("fresh-token");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not release the OAuth token lock"),
      );
    });
  });
});
