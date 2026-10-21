import VideoCallConnectionAPI, {
  TEST_MEETING_REQUEST,
} from "../../../Server/API/VideoCallConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import VideoCallConnectionService from "../../../Server/Services/VideoCallConnectionService";
import VideoCallMeetingFactory from "../../../Server/Utils/VideoCall/VideoCallMeetingFactory";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";

/*
 * POST /video-call-connection/test starts a real test meeting, so the
 * permission gate comes before any lookup and any provider request, a
 * connection is only ever read within the caller's project, and only a
 * saved connection tested exactly as stored writes its health back.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;
const recordedRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];
jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ uri, handlers });
        },
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const ZOOM_CONFIG: JSONObject = {
  accountId: "acct",
  clientId: "client",
  hostEmail: "incidents@acme.com",
};

let props: DatabaseCommonInteractionProps;
let testHandler: Handler;
let next: jest.Mock;
const res: ExpressResponse = {} as ExpressResponse;

function setPermission(permission: Permission): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  };
}

function request(body: JSONObject): ExpressRequest {
  return { body } as unknown as ExpressRequest;
}

beforeAll(() => {
  new VideoCallConnectionAPI();
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === "/video-call-connection/test";
    });
  expect(found).toBeDefined();
  testHandler = found!.handlers.slice(-1)[0]!;
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermission(Permission.ProjectAdmin);
  next = jest.fn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  const accessible: VideoCallConnection = new VideoCallConnection();
  accessible.id = CONNECTION;
  accessible.projectId = PROJECT;
  jest
    .spyOn(VideoCallConnectionService, "findOneBy")
    .mockResolvedValue(accessible);

  jest.spyOn(VideoCallConnectionService, "startMeeting").mockResolvedValue({
    meeting: {
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://zoom.us/j/stored",
    },
    connection: accessible,
  });

  jest.spyOn(VideoCallConnectionService, "getSettings").mockResolvedValue({
    connection: accessible,
    settings: {
      provider: VideoCallProvider.Zoom,
      config: ZOOM_CONFIG,
      secrets: { clientSecret: "stored-secret" },
    },
  });

  jest.spyOn(VideoCallMeetingFactory, "createMeeting").mockResolvedValue({
    provider: VideoCallProvider.Zoom,
    joinUrl: "https://zoom.us/j/test",
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test("the route resolves the user and requires authentication before its handler", () => {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === "/video-call-connection/test";
    });

  expect(found!.handlers.slice(0, 2)).toEqual([
    UserMiddleware.getUserMiddleware,
    UserMiddleware.requireUserAuthentication,
  ]);
  expect(found!.handlers).toHaveLength(3);
});

describe("unsaved settings", () => {
  test("starts a test meeting with them and answers with its link", async () => {
    const req: ExpressRequest = request({
      provider: VideoCallProvider.Zoom,
      config: ZOOM_CONFIG,
      secrets: { clientSecret: "new-secret" },
    });

    await testHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(VideoCallMeetingFactory.createMeeting).toHaveBeenCalledWith({
      settings: {
        provider: VideoCallProvider.Zoom,
        config: ZOOM_CONFIG,
        secrets: { clientSecret: "new-secret" },
      },
      request: TEST_MEETING_REQUEST,
    });
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, {
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://zoom.us/j/test",
    });
    // Settings that were never saved say nothing about a connection.
    expect(VideoCallConnectionService.startMeeting).not.toHaveBeenCalled();
  });

  test("are validated before any request to the provider", async () => {
    await testHandler(
      request({
        provider: VideoCallProvider.Zoom,
        config: { accountId: "acct", clientId: "client" },
        secrets: { clientSecret: "x" },
      }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Meeting host is required for Zoom.",
      }),
    );
    expect(VideoCallMeetingFactory.createMeeting).not.toHaveBeenCalled();
  });
});

describe("a saved connection", () => {
  test("tested as stored starts the meeting through the service, which records its health", async () => {
    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(VideoCallConnectionService.findOneBy).toHaveBeenCalledWith({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      select: { _id: true, projectId: true },
      props,
    });
    expect(VideoCallConnectionService.startMeeting).toHaveBeenCalledWith({
      connectionId: CONNECTION,
      projectId: PROJECT,
      request: TEST_MEETING_REQUEST,
    });
    expect(VideoCallMeetingFactory.createMeeting).not.toHaveBeenCalled();
  });

  test("tested with the form's unsaved values merges them over the stored secrets", async () => {
    await testHandler(
      request({
        connectionId: CONNECTION.toString(),
        config: { ...ZOOM_CONFIG, hostEmail: "oncall@acme.com" },
        secrets: { clientSecret: "" },
      }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(VideoCallMeetingFactory.createMeeting).toHaveBeenCalledWith({
      settings: {
        provider: VideoCallProvider.Zoom,
        config: { ...ZOOM_CONFIG, hostEmail: "oncall@acme.com" },
        // A blank secret keeps the stored one.
        secrets: { clientSecret: "stored-secret" },
      },
      request: TEST_MEETING_REQUEST,
    });
    expect(VideoCallConnectionService.startMeeting).not.toHaveBeenCalled();
  });

  test("of another project is refused without starting anything", async () => {
    jest.spyOn(VideoCallConnectionService, "findOneBy").mockResolvedValue(null);

    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(VideoCallConnectionService.startMeeting).not.toHaveBeenCalled();
    expect(VideoCallMeetingFactory.createMeeting).not.toHaveBeenCalled();
  });

  test("named by an id that is not one is refused", async () => {
    await testHandler(request({ connectionId: "../etc" }), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "A valid connection ID is required.",
      }),
    );
    expect(VideoCallConnectionService.findOneBy).not.toHaveBeenCalled();
  });
});

describe("who may test", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SettingsAdmin,
    Permission.CreateVideoCallConnection,
    Permission.EditVideoCallConnection,
  ])("allows %s", async (permission: Permission) => {
    setPermission(permission);

    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(VideoCallConnectionService.startMeeting).toHaveBeenCalled();
  });

  test.each([
    Permission.ProjectMember,
    Permission.SettingsMember,
    Permission.Viewer,
    Permission.ReadVideoCallConnection,
    Permission.IncidentMember,
  ])(
    "denies %s before any lookup or provider request",
    async (permission: Permission) => {
      setPermission(permission);

      await testHandler(
        request({ connectionId: CONNECTION.toString() }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(VideoCallConnectionService.findOneBy).not.toHaveBeenCalled();
      expect(VideoCallConnectionService.startMeeting).not.toHaveBeenCalled();
      expect(VideoCallMeetingFactory.createMeeting).not.toHaveBeenCalled();
    },
  );

  test("rejects a request with no project", async () => {
    props.tenantId = undefined;

    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(VideoCallConnectionService.findOneBy).not.toHaveBeenCalled();
  });
});
