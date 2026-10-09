import Semaphore, {
  SemaphoreMutex,
} from "../../../../../Server/Infrastructure/Semaphore";
import VideoCallConnectionService from "../../../../../Server/Services/VideoCallConnectionService";
import {
  VideoCallOAuthAccessToken,
  VideoCallOAuthApp,
  VideoCallOAuthSecrets,
  VideoCallOAuthTokens,
} from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallOAuthApps from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuthApps";
import VideoCallOAuthTokenStore from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuthTokenStore";
import VideoCallConnection from "../../../../../Models/DatabaseModels/VideoCallConnection";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import VideoCallAuthMethod from "../../../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A connection made by signing in starts every call with a current access
 * token. Zoom spends a refresh token the moment it is used, so a refresh
 * happens once, under the account's lock, from the newest copy of the
 * sign-in, and is stored in every connection signed in as the account
 * before the token is handed out.
 */

const CONNECTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SIBLING_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ACCOUNT_ID: string = "KdYKjnimT4KPd8FFgQt9FQ";

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function connectionWith(data: {
  id?: ObjectID;
  secrets: VideoCallOAuthSecrets | JSONObject;
  accountId?: string | undefined;
}): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection.id = data.id || CONNECTION_ID;
  connection.secrets = JSON.stringify(data.secrets);
  connection.connectedAccountId =
    data.accountId === undefined ? ACCOUNT_ID : data.accountId;
  return connection;
}

const STALE: VideoCallOAuthSecrets = {
  refreshToken: "refresh-1",
  accessToken: "access-old",
  accessTokenExpiresAt: minutesFromNow(1),
  tokensRefreshedAt: "2026-10-01T00:00:00.000Z",
  apiBaseUrl: "https://api.zoom.us/v2",
  externalUserId: ACCOUNT_ID,
};

let refresh: jest.Mock<
  (data: {
    secrets: VideoCallOAuthSecrets;
    accountLabel: string;
  }) => Promise<VideoCallOAuthTokens>
>;
let mutex: SemaphoreMutex;

beforeEach(() => {
  refresh = jest.fn(async () => {
    return {
      accessToken: "access-new",
      refreshToken: "refresh-2",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  });

  jest.spyOn(VideoCallOAuthApps, "getOrThrow").mockReturnValue({
    provider: VideoCallProvider.Zoom,
    getAuthorizationUrl: jest.fn(),
    exchangeCode: jest.fn(),
    refresh,
    revoke: jest.fn(),
  } as unknown as VideoCallOAuthApp);

  mutex = { identifier: "m" } as unknown as SemaphoreMutex;
  jest.spyOn(Semaphore, "lock").mockResolvedValue(mutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

  jest.spyOn(VideoCallConnectionService, "updateBy").mockResolvedValue(1);
  jest
    .spyOn(VideoCallConnectionService, "updateOneById")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function getAccessToken(): Promise<VideoCallOAuthAccessToken> {
  return VideoCallOAuthTokenStore.getAccessToken({
    connectionId: CONNECTION_ID,
    provider: VideoCallProvider.Zoom,
    accountLabel: "incidents@acme.com",
  });
}

describe("VideoCallOAuthTokenStore.getAccessToken", () => {
  test("hands out the stored access token while it lasts, without a refresh or a lock", async () => {
    jest.spyOn(VideoCallConnectionService, "findOneById").mockResolvedValue(
      connectionWith({
        secrets: { ...STALE, accessTokenExpiresAt: minutesFromNow(30) },
      }),
    );

    await expect(getAccessToken()).resolves.toEqual({
      accessToken: "access-old",
      apiBaseUrl: "https://api.zoom.us/v2",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(Semaphore.lock).not.toHaveBeenCalled();
  });

  test("refreshes a token about to run out under the account's lock, and stores it in every connection signed in as the account", async () => {
    jest
      .spyOn(VideoCallConnectionService, "findOneById")
      .mockResolvedValue(connectionWith({ secrets: STALE }));
    jest
      .spyOn(VideoCallConnectionService, "findBy")
      .mockResolvedValue([connectionWith({ secrets: STALE })]);

    await expect(getAccessToken()).resolves.toEqual({
      accessToken: "access-new",
      apiBaseUrl: "https://api.zoom.us/v2",
    });

    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `${VideoCallProvider.Zoom}-${ACCOUNT_ID}`,
        namespace: VideoCallOAuthTokenStore.LOCK_NAMESPACE,
      }),
    );
    expect(refresh).toHaveBeenCalledWith({
      secrets: expect.objectContaining({ refreshToken: "refresh-1" }),
      accountLabel: "incidents@acme.com",
    });

    const write: { query: JSONObject; data: { secrets: string } } = (
      VideoCallConnectionService.updateBy as jest.Mock
    ).mock.calls[0]![0] as { query: JSONObject; data: { secrets: string } };
    expect(write.query).toEqual({
      provider: VideoCallProvider.Zoom,
      authMethod: VideoCallAuthMethod.OAuth,
      connectedAccountId: ACCOUNT_ID,
    });
    expect(JSON.parse(write.data.secrets)).toEqual(
      expect.objectContaining({
        refreshToken: "refresh-2",
        accessToken: "access-new",
        externalUserId: ACCOUNT_ID,
        apiBaseUrl: "https://api.zoom.us/v2",
      }),
    );
    expect(Semaphore.release).toHaveBeenCalledWith(mutex);
  });

  test("refreshes from the newest copy of the sign-in, never one a failed write left behind", async () => {
    jest
      .spyOn(VideoCallConnectionService, "findOneById")
      .mockResolvedValue(connectionWith({ secrets: STALE }));
    jest.spyOn(VideoCallConnectionService, "findBy").mockResolvedValue([
      connectionWith({ secrets: STALE }),
      connectionWith({
        id: SIBLING_ID,
        secrets: {
          ...STALE,
          refreshToken: "refresh-newer",
          tokensRefreshedAt: "2026-10-05T00:00:00.000Z",
        },
      }),
    ]);

    await getAccessToken();

    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: expect.objectContaining({ refreshToken: "refresh-newer" }),
      }),
    );
  });

  test("uses the token another call refreshed while this one waited for the lock", async () => {
    jest
      .spyOn(VideoCallConnectionService, "findOneById")
      .mockResolvedValue(connectionWith({ secrets: STALE }));
    jest.spyOn(VideoCallConnectionService, "findBy").mockResolvedValue([
      connectionWith({
        secrets: {
          ...STALE,
          accessToken: "access-refreshed-meanwhile",
          accessTokenExpiresAt: minutesFromNow(59),
          tokensRefreshedAt: new Date().toISOString(),
        },
      }),
    ]);

    await expect(getAccessToken()).resolves.toEqual(
      expect.objectContaining({ accessToken: "access-refreshed-meanwhile" }),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(VideoCallConnectionService.updateBy).not.toHaveBeenCalled();
  });

  test("goes ahead without the lock when Valkey cannot give one", async () => {
    (Semaphore.lock as jest.Mock).mockRejectedValue(
      new Error("Redis client is not connected") as never,
    );
    jest
      .spyOn(VideoCallConnectionService, "findOneById")
      .mockResolvedValue(connectionWith({ secrets: STALE }));
    jest
      .spyOn(VideoCallConnectionService, "findBy")
      .mockResolvedValue([connectionWith({ secrets: STALE })]);

    await expect(getAccessToken()).resolves.toEqual(
      expect.objectContaining({ accessToken: "access-new" }),
    );
    expect(Semaphore.release).not.toHaveBeenCalled();
  });

  test("tries a failed write again: Zoom has already retired the old refresh token", async () => {
    jest
      .spyOn(VideoCallConnectionService, "findOneById")
      .mockResolvedValue(connectionWith({ secrets: STALE }));
    jest
      .spyOn(VideoCallConnectionService, "findBy")
      .mockResolvedValue([connectionWith({ secrets: STALE })]);
    (VideoCallConnectionService.updateBy as jest.Mock)
      .mockRejectedValueOnce(new Error("connection reset") as never)
      .mockResolvedValueOnce(1 as never);

    await expect(getAccessToken()).resolves.toEqual(
      expect.objectContaining({ accessToken: "access-new" }),
    );
    expect(VideoCallConnectionService.updateBy).toHaveBeenCalledTimes(2);
  });

  test("a connection stored without an account refreshes and stores only itself", async () => {
    const legacy: VideoCallConnection = connectionWith({
      secrets: STALE,
      accountId: "",
    });
    jest
      .spyOn(VideoCallConnectionService, "findOneById")
      .mockResolvedValue(legacy);
    const findBy: jest.SpiedFunction<typeof VideoCallConnectionService.findBy> =
      jest.spyOn(VideoCallConnectionService, "findBy");

    await getAccessToken();

    expect(findBy).not.toHaveBeenCalled();
    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `connection-${CONNECTION_ID.toString()}`,
      }),
    );
    expect(VideoCallConnectionService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONNECTION_ID }),
    );
    expect(VideoCallConnectionService.updateBy).not.toHaveBeenCalled();
  });

  test("a signed-out connection says to reconnect", async () => {
    jest
      .spyOn(VideoCallConnectionService, "findOneById")
      .mockResolvedValue(connectionWith({ secrets: {} }));

    const error: unknown = await getAccessToken().catch((err: unknown) => {
      return err;
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain("is signed out");
    expect((error as Error).message).toContain("Reconnect Zoom");
  });
});

describe("VideoCallOAuthTokenStore keep-alive", () => {
  test("refreshes a sign-in not refreshed for a week, and leaves a newer one alone", async () => {
    const now: Date = new Date("2026-10-09T12:00:00.000Z");

    expect(
      VideoCallOAuthTokenStore.isDueForKeepAlive(
        { refreshToken: "r", tokensRefreshedAt: "2026-10-01T12:00:00.000Z" },
        now,
      ),
    ).toBe(true);
    expect(
      VideoCallOAuthTokenStore.isDueForKeepAlive(
        { refreshToken: "r", tokensRefreshedAt: "2026-10-08T12:00:00.000Z" },
        now,
      ),
    ).toBe(false);
    expect(
      VideoCallOAuthTokenStore.isDueForKeepAlive({ refreshToken: "r" }, now),
    ).toBe(true);
  });

  test("keeps each sign-in alive once, and records a sign-in that is gone on its connections", async () => {
    const first: VideoCallConnection = new VideoCallConnection();
    first.id = CONNECTION_ID;
    first.provider = VideoCallProvider.Zoom;
    first.connectedAccount = "incidents@acme.com";
    first.connectedAccountId = ACCOUNT_ID;

    // Signed in as the same account in another project.
    const sibling: VideoCallConnection = new VideoCallConnection();
    sibling.id = SIBLING_ID;
    sibling.provider = VideoCallProvider.Zoom;
    sibling.connectedAccount = "incidents@acme.com";
    sibling.connectedAccountId = ACCOUNT_ID;

    // Signed out: nothing to keep.
    const signedOut: VideoCallConnection = new VideoCallConnection();
    signedOut.id = new ObjectID("55555555-5555-4555-8555-555555555555");
    signedOut.provider = VideoCallProvider.GoogleMeet;

    jest
      .spyOn(VideoCallConnectionService, "findAllBy")
      .mockResolvedValue([first, sibling, signedOut]);
    const keepAlive: jest.SpiedFunction<
      typeof VideoCallOAuthTokenStore.keepAlive
    > = jest
      .spyOn(VideoCallOAuthTokenStore, "keepAlive")
      .mockRejectedValue(
        new BadDataException(
          "Zoom no longer accepts OneUptime's sign-in",
        ) as never,
      );
    const recordSignInProblem: jest.SpiedFunction<
      typeof VideoCallConnectionService.recordSignInProblem
    > = jest
      .spyOn(VideoCallConnectionService, "recordSignInProblem")
      .mockResolvedValue(undefined);

    await VideoCallOAuthTokenStore.keepAllAlive();

    expect(VideoCallConnectionService.findAllBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { authMethod: VideoCallAuthMethod.OAuth },
      }),
    );
    expect(keepAlive).toHaveBeenCalledTimes(1);
    expect(recordSignInProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: VideoCallProvider.Zoom,
        accountId: ACCOUNT_ID,
        connectionId: CONNECTION_ID,
      }),
    );
  });
});
