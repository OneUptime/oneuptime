import SecurityCaseAPI from "../../../Server/API/SecurityCaseAPI";
import SecurityEventDestinationAPI from "../../../Server/API/SecurityEventDestinationAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityEventDestination from "../../../Models/DatabaseModels/SecurityEventDestination";
import SecurityEventDestinationService, {
  Service as SecurityEventDestinationServiceClass,
} from "../../../Server/Services/SecurityEventDestinationService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import SecuritySetup from "../../../Server/Utils/SecurityEvent/SecuritySetup";
import SecurityEventDestinationRegistry from "../../../Server/Utils/SecurityEvent/Destinations/SecurityEventDestinationRegistry";
import {
  SecurityEventDestinationSettings,
  SecurityEventSender,
} from "../../../Server/Utils/SecurityEvent/Destinations/Types";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SecurityEventDestinationProvider from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";

/*
 * The routes of the one-click setup (the Overview's "Get started") and the
 * destination test: who may call each, that each reads and writes as the
 * caller and within the caller's project, and what each answers.
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
const DESTINATION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_PROJECT: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const SETTINGS: SecurityEventDestinationSettings = {
  provider: SecurityEventDestinationProvider.GoogleSecOps,
  config: {
    region: "us",
    instanceResourceName: "projects/p/locations/us/instances/i",
  },
  secrets: { serviceAccountJson: '{"client_email":"a","private_key":"b"}' },
};

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
const res: ExpressResponse = {} as ExpressResponse;

function setPermissions(...permissions: Array<Permission>): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    },
  } as never;
}

function route(uri: string): Handler {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === uri;
    });
  expect(found).toBeDefined();
  return found!.handlers[found!.handlers.length - 1]!;
}

function request(body: JSONObject = {}): ExpressRequest {
  return { params: {}, body } as unknown as ExpressRequest;
}

function answered(): JSONObject {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  return mock.mock.calls[mock.mock.calls.length - 1]![2] as JSONObject;
}

beforeAll(() => {
  new SecurityCaseAPI();
  new SecurityEventDestinationAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermissions(Permission.SecurityAdmin);
  next = jest.fn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("route registration", () => {
  test.each([
    "/security-case/setup/status",
    "/security-case/setup/turn-on-recommended",
    "/security-case/setup/test",
    "/security-event-destination/test",
  ])(
    "%s resolves the user and requires authentication first",
    (uri: string) => {
      const found: { uri: string; handlers: Array<Handler> } | undefined =
        recordedRoutes.find((item: { uri: string }) => {
          return item.uri === uri;
        });

      expect(found?.handlers.slice(0, 2)).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
      expect(found?.handlers).toHaveLength(3);
    },
  );
});

describe("POST /security-case/setup/status", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
  ])(
    "answers %s with the pipeline, read as them",
    async (permission: Permission) => {
      setPermissions(permission);
      const status: jest.SpyInstance = jest
        .spyOn(SecuritySetup, "getStatus")
        .mockResolvedValue({ openCases: 2 } as never);

      await route("/security-case/setup/status")(request(), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith({ projectId: PROJECT, props });
      expect(answered()).toEqual({ openCases: 2 });
    },
  );

  test.each([Permission.TelemetryAdmin, Permission.ProjectMember])(
    "refuses %s, who cannot read cases",
    async (permission: Permission) => {
      setPermissions(permission);
      const status: jest.SpyInstance = jest.spyOn(SecuritySetup, "getStatus");

      await route("/security-case/setup/status")(request(), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(status).not.toHaveBeenCalled();
    },
  );
});

describe("POST /security-case/setup/turn-on-recommended", () => {
  test("a security admin turns everything on, as themself", async () => {
    const turnOn: jest.SpyInstance = jest
      .spyOn(SecuritySetup, "turnOnRecommended")
      .mockResolvedValue({
        rulesAdded: 19,
        rulesTurnedOn: 0,
        logsTurnedOn: true,
        playbookAdded: true,
      } as never);

    await route("/security-case/setup/turn-on-recommended")(
      request(),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(turnOn).toHaveBeenCalledWith({
      projectId: PROJECT,
      props,
      options: { logs: true, detections: true, playbook: true },
    });
    expect(answered()["rulesAdded"]).toBe(19);
  });

  test("only what the body asks for", async () => {
    const turnOn: jest.SpyInstance = jest
      .spyOn(SecuritySetup, "turnOnRecommended")
      .mockResolvedValue({} as never);

    await route("/security-case/setup/turn-on-recommended")(
      request({ logs: false, playbook: false }),
      res,
      next,
    );

    expect(turnOn).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { logs: false, detections: true, playbook: false },
      }),
    );
  });

  test("a security member may turn the rules on, but not your logs or a playbook", async () => {
    setPermissions(Permission.SecurityMember);
    const turnOn: jest.SpyInstance = jest
      .spyOn(SecuritySetup, "turnOnRecommended")
      .mockResolvedValue({} as never);

    await route("/security-case/setup/turn-on-recommended")(
      request(),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(turnOn).not.toHaveBeenCalled();

    next.mockClear();

    await route("/security-case/setup/turn-on-recommended")(
      request({ logs: false, playbook: false }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(turnOn).toHaveBeenCalledTimes(1);
  });

  test("a security viewer may not turn anything on", async () => {
    setPermissions(Permission.SecurityViewer);
    const turnOn: jest.SpyInstance = jest.spyOn(
      SecuritySetup,
      "turnOnRecommended",
    );

    await route("/security-case/setup/turn-on-recommended")(
      request({ logs: false, playbook: false }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(turnOn).not.toHaveBeenCalled();
  });
});

describe("POST /security-case/setup/test", () => {
  test.each([Permission.SecurityAdmin, Permission.SecurityMember])(
    "%s runs the test, and is told the case it opened",
    async (permission: Permission) => {
      setPermissions(permission);
      const runTest: jest.SpyInstance = jest
        .spyOn(SecuritySetup, "runTest")
        .mockResolvedValue({
          eventsSent: 12,
          caseId: "55555555-5555-4555-8555-555555555555",
          caseNumber: "CASE-1",
          ruleAdded: false,
        } as never);

      await route("/security-case/setup/test")(request(), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(runTest).toHaveBeenCalledWith({ projectId: PROJECT, props });
      expect(answered()["caseNumber"]).toBe("CASE-1");
    },
  );

  test("a security viewer cannot run it: it writes events and may add a rule", async () => {
    setPermissions(Permission.SecurityViewer);
    const runTest: jest.SpyInstance = jest.spyOn(SecuritySetup, "runTest");

    await route("/security-case/setup/test")(request(), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(runTest).not.toHaveBeenCalled();
  });
});

describe("POST /security-event-destination/test", () => {
  function installSender(
    answer: () => Promise<void> = async () => {
      return undefined;
    },
  ): { tested: Array<SecurityEventDestinationSettings> } {
    const tested: Array<SecurityEventDestinationSettings> = [];
    const sender: SecurityEventSender = {
      validateSettings: (): void => {
        return undefined;
      },
      send: jest.fn() as never,
      sendTestEvent: async (
        settings: SecurityEventDestinationSettings,
      ): Promise<void> => {
        tested.push(settings);
        await answer();
      },
    };

    jest
      .spyOn(SecurityEventDestinationRegistry, "getSender")
      .mockReturnValue(sender);
    jest
      .spyOn(SecurityEventDestinationServiceClass, "validateSettings")
      .mockImplementation(
        (data: {
          provider: unknown;
          config: JSONObject;
          secrets: JSONObject;
        }): SecurityEventDestinationSettings => {
          return {
            provider: data.provider as SecurityEventDestinationProvider,
            config: data.config,
            secrets: data.secrets,
          };
        },
      );

    return { tested };
  }

  test("tests settings never saved, and says the event is on its way", async () => {
    const { tested } = installSender();

    await route("/security-event-destination/test")(
      request({
        provider: SETTINGS.provider,
        config: SETTINGS.config,
        secrets: SETTINGS.secrets,
      }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(tested).toEqual([SETTINGS]);
    expect(answered()).toEqual({
      isSuccessful: true,
      message:
        "A test event was sent. It shows in your SIEM within a few minutes.",
    });
  });

  test("a SIEM that refuses the test says what to fix, as an answer not an error", async () => {
    installSender(async () => {
      throw new Error("Grant it chronicle.events.import");
    });

    await route("/security-event-destination/test")(
      request({
        provider: SETTINGS.provider,
        config: SETTINGS.config,
        secrets: SETTINGS.secrets,
      }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(answered()).toEqual({
      isSuccessful: false,
      message: "Grant it chronicle.events.import",
    });
  });

  test("a saved destination is tested with its stored key when the form left it blank", async () => {
    const { tested } = installSender();
    const visible: SecurityEventDestination = new SecurityEventDestination();
    visible.id = DESTINATION;
    visible.projectId = PROJECT;
    const findOneBy: jest.SpyInstance = jest
      .spyOn(SecurityEventDestinationService, "findOneBy")
      .mockResolvedValue(visible);
    const stored: SecurityEventDestination = new SecurityEventDestination();
    stored.id = DESTINATION;
    stored.provider = SecurityEventDestinationProvider.GoogleSecOps;
    jest
      .spyOn(SecurityEventDestinationService, "findOneById")
      .mockResolvedValue(stored);
    jest
      .spyOn(SecurityEventDestinationService, "getSettings")
      .mockResolvedValue(SETTINGS);

    await route("/security-event-destination/test")(
      request({
        destinationId: DESTINATION.toString(),
        secrets: { serviceAccountJson: "" },
      }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    // Looked up as the caller, inside their project.
    expect(findOneBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { _id: DESTINATION.toString(), projectId: PROJECT },
        props,
      }),
    );
    expect(tested[0]!.secrets["serviceAccountJson"]).toBe(
      SETTINGS.secrets["serviceAccountJson"],
    );
  });

  test("a destination of another project is never tested", async () => {
    const { tested } = installSender();
    const elsewhere: SecurityEventDestination = new SecurityEventDestination();
    elsewhere.id = DESTINATION;
    elsewhere.projectId = OTHER_PROJECT;
    jest
      .spyOn(SecurityEventDestinationService, "findOneBy")
      .mockResolvedValue(elsewhere);

    await route("/security-event-destination/test")(
      request({ destinationId: DESTINATION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(tested).toHaveLength(0);
  });

  test("a destination id that is not one is refused", async () => {
    const { tested } = installSender();

    await route("/security-event-destination/test")(
      request({ destinationId: "not-an-id" }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(tested).toHaveLength(0);
  });

  test.each([Permission.SecurityMember, Permission.SecurityViewer])(
    "refuses %s, who cannot configure destinations",
    async (permission: Permission) => {
      setPermissions(permission);
      const { tested } = installSender();

      await route("/security-event-destination/test")(
        request({
          provider: SETTINGS.provider,
          config: SETTINGS.config,
          secrets: SETTINGS.secrets,
        }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(tested).toHaveLength(0);
    },
  );
});
