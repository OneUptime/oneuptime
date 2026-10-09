import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import { Service as VideoCallConnectionServiceType } from "../../../Server/Services/VideoCallConnectionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import {
  VideoCallOAuthAccess,
  VideoCallOAuthApp,
  VideoCallOAuthGrant,
} from "../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallOAuthApps from "../../../Server/Utils/VideoCall/OAuth/VideoCallOAuthApps";
import VideoCallOAuthTokenStore from "../../../Server/Utils/VideoCall/OAuth/VideoCallOAuthTokenStore";
import VideoCallMeetingFactory from "../../../Server/Utils/VideoCall/VideoCallMeetingFactory";
import { VideoCallConnectionSettings } from "../../../Server/Utils/VideoCall/VideoCallConnectionSettings";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import VideoCallAuthMethod from "../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
/*
 * jest itself is the global one: @jest/globals types spyOn and fn as mocks
 * the global jest.SpiedFunction and jest.Mock annotations here do not accept.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A connection made by signing in is made only by the sign-in, never
 * through the API; its credentials are the sign-in's, which an edit never
 * writes back; and one account's sign-in is shared by every connection
 * signed in as it, so a new sign-in replaces it everywhere.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ACCOUNT_ID: string = "KdYKjnimT4KPd8FFgQt9FQ";

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<VideoCallConnection>,
  ) => Promise<OnCreate<VideoCallConnection>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<VideoCallConnection>,
  ) => Promise<OnUpdate<VideoCallConnection>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<VideoCallConnection>,
  ) => Promise<OnDelete<VideoCallConnection>>;
  onDeleteSuccess: (
    onDelete: OnDelete<VideoCallConnection>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<VideoCallConnection>>;
};

function build(): {
  service: VideoCallConnectionServiceType;
  internals: ServiceInternals;
} {
  const service: VideoCallConnectionServiceType =
    new VideoCallConnectionServiceType();
  return { service, internals: service as unknown as ServiceInternals };
}

const GRANT: VideoCallOAuthGrant = {
  tokens: {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: new Date("2026-10-09T13:00:00.000Z"),
    scope: "meeting:write:meeting user:read:user",
    apiBaseUrl: "https://api.zoom.us/v2",
  },
  account: {
    label: "incidents@acme.com",
    externalUserId: ACCOUNT_ID,
    externalAccountId: "acct-1",
  },
};

function signedIn(data?: {
  provider?: VideoCallProvider;
  secrets?: JSONObject;
}): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection(
    CONNECTION_ID,
  );
  connection.projectId = PROJECT_ID;
  connection.name = "Zoom";
  connection.provider = data?.provider || VideoCallProvider.Zoom;
  connection.authMethod = VideoCallAuthMethod.OAuth;
  connection.connectedAccount = "incidents@acme.com";
  connection.connectedAccountId = ACCOUNT_ID;
  connection.config = {};
  connection.secrets = JSON.stringify(
    data?.secrets || { refreshToken: "refresh-0", externalUserId: ACCOUNT_ID },
  );
  return connection;
}

beforeEach(() => {
  jest.spyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue();
  jest.spyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue();
  jest.spyOn(VideoCallOAuthTokenStore, "takeLock").mockResolvedValue(null);
  jest.spyOn(VideoCallOAuthTokenStore, "giveBack").mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a connection made by signing in", () => {
  function oauthConnection(): VideoCallConnection {
    const connection: VideoCallConnection = new VideoCallConnection();
    connection.projectId = PROJECT_ID;
    connection.name = "Zoom";
    connection.provider = VideoCallProvider.Zoom;
    connection.authMethod = VideoCallAuthMethod.OAuth;
    connection.config = {};
    connection.secrets = JSON.stringify({ refreshToken: "refresh-1" });
    return connection;
  }

  test("is refused through the API: nobody can type a sign-in in", async () => {
    const { internals } = build();

    await expect(
      internals.onBeforeCreate({
        data: oauthConnection(),
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "A connection made by signing in is created by signing in",
    );
  });

  test("is made by the sign-in, with the tokens it came back with", async () => {
    const { internals } = build();

    const onCreate: OnCreate<VideoCallConnection> =
      await internals.onBeforeCreate({
        data: oauthConnection(),
        props: { isRoot: true },
      });

    expect(onCreate.createBy.data.authMethod).toBe(VideoCallAuthMethod.OAuth);
    expect(onCreate.createBy.data.config).toEqual({});
    expect(JSON.parse(onCreate.createBy.data.secrets!)).toEqual({
      refreshToken: "refresh-1",
    });
  });

  test("needs the sign-in's tokens", async () => {
    const { internals } = build();
    const connection: VideoCallConnection = oauthConnection();
    connection.secrets = JSON.stringify({});

    await expect(
      internals.onBeforeCreate({ data: connection, props: { isRoot: true } }),
    ).rejects.toThrow("needs the sign-in's tokens");
  });

  test("a connection made with the project's own app says so, and a meeting link says nothing", async () => {
    const { internals } = build();

    const zoom: VideoCallConnection = new VideoCallConnection();
    zoom.projectId = PROJECT_ID;
    zoom.name = "Zoom";
    zoom.provider = VideoCallProvider.Zoom;
    zoom.config = {
      accountId: "acct",
      clientId: "client",
      hostEmail: "incidents@acme.com",
    };
    zoom.secrets = { clientSecret: "s" } as unknown as string;

    expect(
      (await internals.onBeforeCreate({ data: zoom, props: { isRoot: true } }))
        .createBy.data.authMethod,
    ).toBe(VideoCallAuthMethod.AppCredentials);

    const link: VideoCallConnection = new VideoCallConnection();
    link.projectId = PROJECT_ID;
    link.name = "Bridge";
    link.provider = VideoCallProvider.CustomLink;
    link.config = { joinUrl: "https://acme.zoom.us/j/1" };

    expect(
      (await internals.onBeforeCreate({ data: link, props: { isRoot: true } }))
        .createBy.data.authMethod,
    ).toBe(null);
  });

  test("refuses an auth method it does not know", async () => {
    const { internals } = build();
    const connection: VideoCallConnection = oauthConnection();
    connection.authMethod = "Magic" as VideoCallAuthMethod;

    await expect(
      internals.onBeforeCreate({
        data: connection,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Auth method must be AppCredentials");
  });
});

describe("editing a connection made by signing in", () => {
  test("never writes its credentials: an edit could put back a spent refresh token", async () => {
    const { service, internals } = build();
    jest
      .spyOn(service, "findOneById")
      .mockResolvedValue(signedIn({ provider: VideoCallProvider.GoogleMeet }));

    const onUpdate: OnUpdate<VideoCallConnection> =
      await internals.onBeforeUpdate({
        query: { _id: CONNECTION_ID.toString() },
        data: { config: { accessType: "OPEN" } },
        props: { isRoot: true },
      } as unknown as UpdateBy<VideoCallConnection>);

    const data: JSONObject = onUpdate.updateBy.data as unknown as JSONObject;
    expect(data["config"]).toEqual({ accessType: "OPEN" });
    expect(data["secrets"]).toBeUndefined();
  });

  test("refuses credentials sent with the edit", async () => {
    const { service, internals } = build();
    jest.spyOn(service, "findOneById").mockResolvedValue(signedIn());

    await expect(
      internals.onBeforeUpdate({
        query: { _id: CONNECTION_ID.toString() },
        data: { secrets: { refreshToken: "typed-in" } },
        props: { isRoot: true },
      } as unknown as UpdateBy<VideoCallConnection>),
    ).rejects.toThrow("are kept by OneUptime");
  });

  test("refuses an app-credential setting", async () => {
    const { service, internals } = build();
    jest.spyOn(service, "findOneById").mockResolvedValue(signedIn());

    await expect(
      internals.onBeforeUpdate({
        query: { _id: CONNECTION_ID.toString() },
        data: { config: { hostEmail: "someone@acme.com" } },
        props: { isRoot: true },
      } as unknown as UpdateBy<VideoCallConnection>),
    ).rejects.toThrow('unknown setting "hostEmail"');
  });
});

describe("starting a call with a connection made by signing in", () => {
  test("hands the factory the connection's sign-in, for the account it is", async () => {
    const { service } = build();
    jest.spyOn(service, "findOneBy").mockResolvedValue(signedIn());
    jest.spyOn(service, "updateOneById").mockResolvedValue(undefined as never);

    let given: {
      settings: VideoCallConnectionSettings;
      oauth?: VideoCallOAuthAccess | undefined;
    } | null = null;

    jest
      .spyOn(VideoCallMeetingFactory, "createMeeting")
      .mockImplementation(async (data: JSONObject | any) => {
        given = data;
        return {
          provider: VideoCallProvider.Zoom,
          joinUrl: "https://zoom.us/j/1",
        };
      });

    await service.startMeeting({
      connectionId: CONNECTION_ID,
      projectId: PROJECT_ID,
      request: { title: "INC-1" },
    });

    expect(given!.settings.authMethod).toBe(VideoCallAuthMethod.OAuth);
    expect(given!.oauth?.accountLabel).toBe("incidents@acme.com");
  });
});

describe("VideoCallConnectionService.connectWithSignIn", () => {
  test("makes a new connection named after the provider, signed in as the account", async () => {
    const { service } = build();
    jest.spyOn(service, "findOneBy").mockResolvedValue(null);
    jest.spyOn(service, "findBy").mockResolvedValue([]);
    const create: jest.SpiedFunction<typeof service.create> = jest
      .spyOn(service, "create")
      .mockImplementation(async (data: CreateBy<VideoCallConnection>) => {
        const created: VideoCallConnection = data.data;
        created.id = CONNECTION_ID;
        return created;
      });
    const updateBy: jest.SpiedFunction<typeof service.updateBy> = jest
      .spyOn(service, "updateBy")
      .mockResolvedValue(1);

    const connection: VideoCallConnection = await service.connectWithSignIn({
      projectId: PROJECT_ID,
      userId: USER_ID,
      provider: VideoCallProvider.Zoom,
      grant: GRANT,
    });

    expect(connection.id).toEqual(CONNECTION_ID);

    const createBy: CreateBy<VideoCallConnection> = create.mock.calls[0]![0];
    expect(createBy.props.isRoot).toBe(true);
    expect(createBy.data.name).toBe("Zoom");
    expect(createBy.data.provider).toBe(VideoCallProvider.Zoom);
    expect(createBy.data.authMethod).toBe(VideoCallAuthMethod.OAuth);
    expect(createBy.data.connectedAccount).toBe("incidents@acme.com");
    expect(createBy.data.connectedAccountId).toBe(ACCOUNT_ID);
    expect(createBy.data.createdByUserId).toEqual(USER_ID);
    expect(JSON.parse(createBy.data.secrets!)).toEqual(
      expect.objectContaining({
        refreshToken: "refresh-1",
        accessToken: "access-1",
        externalUserId: ACCOUNT_ID,
        externalAccountId: "acct-1",
      }),
    );

    // Every connection signed in as the account gets the new sign-in.
    expect(updateBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          provider: VideoCallProvider.Zoom,
          authMethod: VideoCallAuthMethod.OAuth,
          connectedAccountId: ACCOUNT_ID,
        },
        props: { isRoot: true, ignoreHooks: true },
      }),
    );
  });

  test("names a second one so the two can be told apart", async () => {
    const { service } = build();
    jest.spyOn(service, "findOneBy").mockResolvedValue(null);
    const taken: VideoCallConnection = new VideoCallConnection();
    taken.name = "Zoom";
    jest.spyOn(service, "findBy").mockResolvedValue([taken]);
    const create: jest.SpiedFunction<typeof service.create> = jest
      .spyOn(service, "create")
      .mockImplementation(async (data: CreateBy<VideoCallConnection>) => {
        return data.data;
      });
    jest.spyOn(service, "updateBy").mockResolvedValue(1);

    await service.connectWithSignIn({
      projectId: PROJECT_ID,
      userId: USER_ID,
      provider: VideoCallProvider.Zoom,
      grant: GRANT,
    });

    expect(create.mock.calls[0]![0].data.name).toBe("Zoom 2");
  });

  test("signs in again the project's connection already signed in as the account, rather than making another", async () => {
    const { service } = build();
    jest.spyOn(service, "findOneBy").mockResolvedValue(signedIn());
    const create: jest.SpiedFunction<typeof service.create> = jest.spyOn(
      service,
      "create",
    );
    const updateOneById: jest.SpiedFunction<typeof service.updateOneById> = jest
      .spyOn(service, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest.spyOn(service, "updateBy").mockResolvedValue(1);

    const connection: VideoCallConnection = await service.connectWithSignIn({
      projectId: PROJECT_ID,
      userId: USER_ID,
      provider: VideoCallProvider.Zoom,
      grant: GRANT,
    });

    expect(connection.id).toEqual(CONNECTION_ID);
    expect(create).not.toHaveBeenCalled();
    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONNECTION_ID,
        data: expect.objectContaining({
          connectedAccount: "incidents@acme.com",
          connectedAccountId: ACCOUNT_ID,
          lastError: null,
        }),
        props: { isRoot: true, ignoreHooks: true },
      }),
    );
  });

  test("reconnects the connection it was asked to, in the project", async () => {
    const { service } = build();
    const findOneBy: jest.SpiedFunction<typeof service.findOneBy> = jest
      .spyOn(service, "findOneBy")
      .mockResolvedValue(signedIn());
    jest.spyOn(service, "updateOneById").mockResolvedValue(undefined as never);
    jest.spyOn(service, "updateBy").mockResolvedValue(1);

    await service.connectWithSignIn({
      projectId: PROJECT_ID,
      userId: USER_ID,
      provider: VideoCallProvider.Zoom,
      grant: GRANT,
      connectionId: CONNECTION_ID,
    });

    expect(findOneBy.mock.calls[0]![0].query).toEqual({
      _id: CONNECTION_ID,
      projectId: PROJECT_ID,
    });
  });

  test("refuses to reconnect a connection that is not one made by signing in to that provider", async () => {
    const { service } = build();
    const credentialConnection: VideoCallConnection = signedIn();
    credentialConnection.authMethod = VideoCallAuthMethod.AppCredentials;
    jest.spyOn(service, "findOneBy").mockResolvedValue(credentialConnection);

    await expect(
      service.connectWithSignIn({
        projectId: PROJECT_ID,
        userId: USER_ID,
        provider: VideoCallProvider.Zoom,
        grant: GRANT,
        connectionId: CONNECTION_ID,
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("holds the account's lock while it writes, and gives it back", async () => {
    const { service } = build();
    jest.spyOn(service, "findOneBy").mockResolvedValue(signedIn());
    jest.spyOn(service, "updateOneById").mockResolvedValue(undefined as never);
    jest.spyOn(service, "updateBy").mockResolvedValue(1);

    await service.connectWithSignIn({
      projectId: PROJECT_ID,
      userId: USER_ID,
      provider: VideoCallProvider.Zoom,
      grant: GRANT,
    });

    expect(VideoCallOAuthTokenStore.takeLock).toHaveBeenCalledWith(
      expect.objectContaining({
        signInKey: `${VideoCallProvider.Zoom}-${ACCOUNT_ID}`,
      }),
    );
    expect(VideoCallOAuthTokenStore.giveBack).toHaveBeenCalled();
  });
});

describe("removing an account's sign-in", () => {
  test("deletes the sign-in and who it was from every connection signed in as the account", async () => {
    const { service } = build();
    const updateBy: jest.SpiedFunction<typeof service.updateBy> = jest
      .spyOn(service, "updateBy")
      .mockResolvedValue(2);

    await expect(
      service.removeSignIn({
        provider: VideoCallProvider.Zoom,
        accountId: ACCOUNT_ID,
        reason: "removed",
      }),
    ).resolves.toBe(2);

    const call: JSONObject = updateBy.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(call["query"]).toEqual({
      provider: VideoCallProvider.Zoom,
      authMethod: VideoCallAuthMethod.OAuth,
      connectedAccountId: ACCOUNT_ID,
    });
    const data: JSONObject = call["data"] as JSONObject;
    expect(data["secrets"]).toBe("{}");
    expect(data["connectedAccount"]).toBe(null);
    expect(data["connectedAccountId"]).toBe(null);
    expect(data["lastError"]).toBe("removed");
  });

  test("does nothing for an account it cannot name", async () => {
    const { service } = build();
    const updateBy: jest.SpiedFunction<typeof service.updateBy> = jest.spyOn(
      service,
      "updateBy",
    );

    await expect(
      service.removeSignIn({
        provider: VideoCallProvider.Zoom,
        accountId: "",
        reason: "removed",
      }),
    ).resolves.toBe(0);
    expect(updateBy).not.toHaveBeenCalled();
  });
});

describe("deleting a connection made by signing in", () => {
  function revokingApp(): jest.Mock {
    const revoke: jest.Mock = jest.fn(async () => {
      return undefined;
    });
    jest.spyOn(VideoCallOAuthApps, "get").mockReturnValue({
      revoke,
    } as unknown as VideoCallOAuthApp);
    return revoke;
  }

  test("withdraws its sign-in at the provider once nothing else uses it", async () => {
    const { service, internals } = build();
    const revoke: jest.Mock = revokingApp();
    jest.spyOn(service, "findBy").mockResolvedValue([signedIn()]);
    jest.spyOn(service, "countBy").mockResolvedValue(new PositiveNumber(0));

    const onDelete: OnDelete<VideoCallConnection> =
      await internals.onBeforeDelete({
        query: { _id: CONNECTION_ID },
        props: { isRoot: true },
      } as unknown as DeleteBy<VideoCallConnection>);

    await internals.onDeleteSuccess(onDelete, [CONNECTION_ID]);

    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "refresh-0" }),
    );
  });

  test("keeps a sign-in another connection still uses", async () => {
    const { service, internals } = build();
    const revoke: jest.Mock = revokingApp();
    jest.spyOn(service, "findBy").mockResolvedValue([signedIn()]);
    jest.spyOn(service, "countBy").mockResolvedValue(new PositiveNumber(1));

    const onDelete: OnDelete<VideoCallConnection> =
      await internals.onBeforeDelete({
        query: { _id: CONNECTION_ID },
        props: { isRoot: true },
      } as unknown as DeleteBy<VideoCallConnection>);

    await internals.onDeleteSuccess(onDelete, [CONNECTION_ID]);

    expect(revoke).not.toHaveBeenCalled();
  });

  test("a provider that refuses the withdrawal never fails the delete", async () => {
    const { service, internals } = build();
    const revoke: jest.Mock = revokingApp();
    revoke.mockRejectedValue(new Error("Zoom is down") as never);
    jest.spyOn(service, "findBy").mockResolvedValue([signedIn()]);
    jest.spyOn(service, "countBy").mockResolvedValue(new PositiveNumber(0));

    const onDelete: OnDelete<VideoCallConnection> =
      await internals.onBeforeDelete({
        query: { _id: CONNECTION_ID },
        props: { isRoot: true },
      } as unknown as DeleteBy<VideoCallConnection>);

    await expect(
      internals.onDeleteSuccess(onDelete, [CONNECTION_ID]),
    ).resolves.toBeDefined();
  });
});
