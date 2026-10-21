import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import { Service as VideoCallConnectionServiceType } from "../../../Server/Services/VideoCallConnectionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import VideoCallMeetingFactory from "../../../Server/Utils/VideoCall/VideoCallMeetingFactory";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A video call connection is checked when it is saved, so the first time a
 * provider is used in anger is not the first time its settings are read.
 * Its credentials are write-only: an edit form can never show them, so an
 * update merges what it sends over what is stored. And every call it starts
 * leaves its health on the connection - when it last worked, or why not.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CONNECTION_ID: ObjectID = ObjectID.generate();

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<VideoCallConnection>,
  ) => Promise<OnCreate<VideoCallConnection>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<VideoCallConnection>,
  ) => Promise<OnUpdate<VideoCallConnection>>;
};

function build(): {
  service: VideoCallConnectionServiceType;
  internals: ServiceInternals;
} {
  const service: VideoCallConnectionServiceType =
    new VideoCallConnectionServiceType();
  return {
    service,
    internals: service as unknown as ServiceInternals,
  };
}

function zoomConnection(data: {
  config?: JSONObject;
  secrets?: JSONObject | string;
}): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection.projectId = PROJECT_ID;
  connection.name = "Incident Zoom";
  connection.provider = VideoCallProvider.Zoom;
  connection.config = data.config || {
    accountId: "acct",
    clientId: "client",
    hostEmail: "incidents@acme.com",
  };
  connection.secrets = (typeof data.secrets === "string"
    ? data.secrets
    : data.secrets || { clientSecret: "secret" }) as unknown as string;
  return connection;
}

beforeEach(() => {
  jest.spyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue();
  jest.spyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VideoCallConnectionService.onBeforeCreate", () => {
  test("stores validated settings, with the secrets as JSON text for encryption", async () => {
    const { internals } = build();

    const onCreate: OnCreate<VideoCallConnection> =
      await internals.onBeforeCreate({
        data: zoomConnection({}),
        props: { isRoot: true },
      });

    expect(onCreate.createBy.data.provider).toBe(VideoCallProvider.Zoom);
    expect(onCreate.createBy.data.config).toEqual({
      accountId: "acct",
      clientId: "client",
      hostEmail: "incidents@acme.com",
    });
    expect(JSON.parse(onCreate.createBy.data.secrets!)).toEqual({
      clientSecret: "secret",
    });
  });

  test("accepts settings sent as JSON text", async () => {
    const { internals } = build();

    const connection: VideoCallConnection = zoomConnection({
      secrets: JSON.stringify({ clientSecret: "secret" }),
    });
    connection.config = JSON.stringify({
      accountId: "acct",
      clientId: "client",
      hostEmail: "incidents@acme.com",
    }) as unknown as JSONObject;

    const onCreate: OnCreate<VideoCallConnection> =
      await internals.onBeforeCreate({
        data: connection,
        props: { isRoot: true },
      });

    expect(onCreate.createBy.data.config?.["hostEmail"]).toBe(
      "incidents@acme.com",
    );
  });

  test("fills a dropdown left out with its default", async () => {
    const { internals } = build();

    const connection: VideoCallConnection = new VideoCallConnection();
    connection.projectId = PROJECT_ID;
    connection.name = "Teams";
    connection.provider = VideoCallProvider.MicrosoftTeams;
    connection.config = {
      tenantId: "11111111-2222-3333-4444-555555555555",
      clientId: "11111111-2222-3333-4444-555555555555",
      organizerUserId: "11111111-2222-3333-4444-555555555555",
    };
    connection.secrets = { clientSecret: "s" } as unknown as string;

    const onCreate: OnCreate<VideoCallConnection> =
      await internals.onBeforeCreate({
        data: connection,
        props: { isRoot: true },
      });

    expect(onCreate.createBy.data.config?.["lobbyBypass"]).toBe("organization");
  });

  test.each([
    [
      "a Slack huddle, which needs no connection",
      VideoCallProvider.SlackHuddle,
    ],
    ["an unknown provider", "Webex"],
  ])("refuses %s", async (_label: string, provider: string) => {
    const { internals } = build();
    const connection: VideoCallConnection = zoomConnection({});
    connection.provider = provider as VideoCallProvider;

    await expect(
      internals.onBeforeCreate({ data: connection, props: { isRoot: true } }),
    ).rejects.toThrow("Provider must be one of");
  });

  test("refuses a connection without its secret", async () => {
    const { internals } = build();

    await expect(
      internals.onBeforeCreate({
        data: zoomConnection({ secrets: {} }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Client secret is required for Zoom.");
  });

  test("refuses a provider rule the form would also refuse", async () => {
    const { internals } = build();

    await expect(
      internals.onBeforeCreate({
        data: zoomConnection({
          config: {
            accountId: "acct",
            clientId: "client",
            hostEmail: "not an email",
          },
        }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Meeting host must be the email address of a Zoom user");
  });
});

describe("VideoCallConnectionService.onBeforeUpdate", () => {
  function stored(): VideoCallConnection {
    const connection: VideoCallConnection = new VideoCallConnection(
      CONNECTION_ID,
    );
    connection.provider = VideoCallProvider.Zoom;
    connection.config = {
      accountId: "acct",
      clientId: "client",
      hostEmail: "incidents@acme.com",
    };
    connection.secrets = JSON.stringify({ clientSecret: "stored-secret" });
    return connection;
  }

  test("never changes a connection's provider", async () => {
    const { internals } = build();

    await expect(
      internals.onBeforeUpdate({
        query: { _id: CONNECTION_ID.toString() },
        data: { provider: VideoCallProvider.GoogleMeet },
        props: { isRoot: true },
      } as unknown as UpdateBy<VideoCallConnection>),
    ).rejects.toThrow("cannot be changed");
  });

  test("leaves the settings alone when an update does not touch them", async () => {
    const { service, internals } = build();
    const find: SpyInstance<typeof service.findOneById> = jest.spyOn(
      service,
      "findOneById",
    );

    const onUpdate: OnUpdate<VideoCallConnection> =
      await internals.onBeforeUpdate({
        query: { _id: CONNECTION_ID.toString() },
        data: { name: "Renamed" },
        props: { isRoot: true },
      } as unknown as UpdateBy<VideoCallConnection>);

    expect(find).not.toHaveBeenCalled();
    expect((onUpdate.updateBy.data as unknown as JSONObject)["name"]).toBe(
      "Renamed",
    );
  });

  test("keeps the stored secret when the form leaves it blank", async () => {
    const { service, internals } = build();
    jest.spyOn(service, "findOneById").mockResolvedValue(stored());

    const onUpdate: OnUpdate<VideoCallConnection> =
      await internals.onBeforeUpdate({
        query: { _id: CONNECTION_ID.toString() },
        data: {
          config: {
            accountId: "acct",
            clientId: "client",
            hostEmail: "oncall@acme.com",
          },
          secrets: { clientSecret: "" },
        },
        props: { isRoot: true },
      } as unknown as UpdateBy<VideoCallConnection>);

    const data: JSONObject = onUpdate.updateBy.data as unknown as JSONObject;
    expect((data["config"] as JSONObject)["hostEmail"]).toBe("oncall@acme.com");
    expect(JSON.parse(data["secrets"] as string)).toEqual({
      clientSecret: "stored-secret",
    });
  });

  test("replaces the stored secret with a new one", async () => {
    const { service, internals } = build();
    jest.spyOn(service, "findOneById").mockResolvedValue(stored());

    const onUpdate: OnUpdate<VideoCallConnection> =
      await internals.onBeforeUpdate({
        query: { _id: CONNECTION_ID.toString() },
        data: { secrets: { clientSecret: "rotated" } },
        props: { isRoot: true },
      } as unknown as UpdateBy<VideoCallConnection>);

    expect(
      JSON.parse(
        (onUpdate.updateBy.data as unknown as JSONObject)["secrets"] as string,
      ),
    ).toEqual({ clientSecret: "rotated" });
  });

  test("refuses clearing a required secret", async () => {
    const { service, internals } = build();
    jest.spyOn(service, "findOneById").mockResolvedValue(stored());

    await expect(
      internals.onBeforeUpdate({
        query: { _id: CONNECTION_ID.toString() },
        data: { secrets: { clientSecret: null } },
        props: { isRoot: true },
      } as unknown as UpdateBy<VideoCallConnection>),
    ).rejects.toThrow("Client secret is required for Zoom.");
  });

  test("refuses changing the settings of many connections at once", async () => {
    const { internals } = build();

    await expect(
      internals.onBeforeUpdate({
        query: { projectId: PROJECT_ID },
        data: { secrets: { clientSecret: "x" } },
        props: { isRoot: true },
      } as unknown as UpdateBy<VideoCallConnection>),
    ).rejects.toThrow("one connection at a time");
  });
});

describe("VideoCallConnectionService.startMeeting", () => {
  function stubStored(service: VideoCallConnectionServiceType): void {
    const connection: VideoCallConnection = new VideoCallConnection(
      CONNECTION_ID,
    );
    connection.projectId = PROJECT_ID;
    connection.name = "Incident Zoom";
    connection.provider = VideoCallProvider.Zoom;
    connection.config = {
      accountId: "acct",
      clientId: "client",
      hostEmail: "incidents@acme.com",
    };
    connection.secrets = JSON.stringify({ clientSecret: "secret" });

    jest.spyOn(service, "findOneBy").mockResolvedValue(connection);
  }

  test("starts a meeting with the decrypted settings and records the success", async () => {
    const { service } = build();
    stubStored(service);

    const createMeeting: SpyInstance<
      typeof VideoCallMeetingFactory.createMeeting
    > = jest.spyOn(VideoCallMeetingFactory, "createMeeting").mockResolvedValue({
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://zoom.us/j/1",
    });

    const update: SpyInstance<typeof service.updateOneById> = jest
      .spyOn(service, "updateOneById")
      .mockResolvedValue(1);

    const result: Awaited<ReturnType<typeof service.startMeeting>> =
      await service.startMeeting({
        connectionId: CONNECTION_ID,
        projectId: PROJECT_ID,
        request: { title: "INC-1" },
      });

    expect(result.meeting.joinUrl).toBe("https://zoom.us/j/1");
    expect(result.connection.name).toBe("Incident Zoom");
    expect(createMeeting.mock.calls[0]![0].settings).toEqual({
      provider: VideoCallProvider.Zoom,
      config: {
        accountId: "acct",
        clientId: "client",
        hostEmail: "incidents@acme.com",
      },
      secrets: { clientSecret: "secret" },
    });

    const recorded: JSONObject = update.mock.calls[0]![0]
      .data as unknown as JSONObject;
    expect(recorded["lastCallStartedAt"]).toBeInstanceOf(Date);
    expect(recorded["lastError"]).toBe(null);
    expect(update.mock.calls[0]![0].props).toEqual({
      isRoot: true,
      ignoreHooks: true,
    });
  });

  test("records why a call failed, then rethrows it", async () => {
    const { service } = build();
    stubStored(service);

    jest
      .spyOn(VideoCallMeetingFactory, "createMeeting")
      .mockRejectedValue(new BadDataException("Zoom rejected the Client ID"));

    const update: SpyInstance<typeof service.updateOneById> = jest
      .spyOn(service, "updateOneById")
      .mockResolvedValue(1);

    await expect(
      service.startMeeting({
        connectionId: CONNECTION_ID,
        projectId: PROJECT_ID,
        request: { title: "INC-1" },
      }),
    ).rejects.toThrow("Zoom rejected the Client ID");

    const recorded: JSONObject = update.mock.calls[0]![0]
      .data as unknown as JSONObject;
    expect(recorded["lastError"]).toBe("Zoom rejected the Client ID");
    expect(recorded["lastErrorAt"]).toBeInstanceOf(Date);
  });

  test("a failure to record never turns a started call into a failed one", async () => {
    const { service } = build();
    stubStored(service);

    jest.spyOn(VideoCallMeetingFactory, "createMeeting").mockResolvedValue({
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://zoom.us/j/1",
    });
    jest
      .spyOn(service, "updateOneById")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      service.startMeeting({
        connectionId: CONNECTION_ID,
        projectId: PROJECT_ID,
        request: { title: "INC-1" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        meeting: {
          provider: VideoCallProvider.Zoom,
          joinUrl: "https://zoom.us/j/1",
        },
      }),
    );
  });

  test("refuses a connection of another project, or one that was deleted", async () => {
    const { service } = build();
    const find: SpyInstance<typeof service.findOneBy> = jest
      .spyOn(service, "findOneBy")
      .mockResolvedValue(null);

    await expect(
      service.startMeeting({
        connectionId: CONNECTION_ID,
        projectId: PROJECT_ID,
        request: { title: "INC-1" },
      }),
    ).rejects.toThrow("The video call connection no longer exists.");

    // Looked up within the project only.
    expect(
      (find.mock.calls[0]![0].query as unknown as JSONObject)["projectId"],
    ).toBe(PROJECT_ID);
  });
});

describe("VideoCallConnectionService.getErrorMessage", () => {
  test("reads an error, a string or anything else", () => {
    expect(
      VideoCallConnectionServiceType.getErrorMessage(new Error("boom")),
    ).toBe("boom");
    expect(VideoCallConnectionServiceType.getErrorMessage("plain")).toBe(
      "plain",
    );
    expect(VideoCallConnectionServiceType.getErrorMessage(42)).toBe(
      "The call could not be started.",
    );
  });

  test("shortens a long message", () => {
    const message: string = VideoCallConnectionServiceType.getErrorMessage(
      new Error("x".repeat(5000)),
    );

    expect(message.length).toBe(1000);
    expect(message.endsWith("…")).toBe(true);
  });

  test("redacts a token that leaked into a message", () => {
    expect(
      VideoCallConnectionServiceType.getErrorMessage(
        new Error(
          "failed with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlc2lnbmF0dXJl",
        ),
      ),
    ).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });
});
