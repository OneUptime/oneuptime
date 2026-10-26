import SecurityCaseAPI, {
  MAX_REQUEST_LOG_RESOURCES,
  readLogResources,
  readOptionalDate,
} from "../../../Server/API/SecurityCaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import IncidentSecurity from "../../../Server/Utils/SecurityEvent/Connections/IncidentSecurity";
import ResourceSecurity from "../../../Server/Utils/SecurityEvent/Connections/ResourceSecurity";
import SecurityConnections from "../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SECURITY_CONNECTION_MAX_ENTITIES,
  SecurityConnectionKind,
  SecurityConnectionsJson,
} from "../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import ServiceType from "../../../Types/Telemetry/ServiceType";

/*
 * The routes behind Security Events' connections - a case's Connected
 * Signals, an event's and an entity's, a record page's Security card and
 * an incident's: who may call each (a reader without Security access sees
 * no security data on any other page), that each reads inside the caller's
 * project with the caller's own permissions, and what each refuses.
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
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const HOST_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const CONNECTIONS: string = "/security-case/connections";
const RESOURCE: string = "/security-case/resource-security";
const INCIDENT: string = "/security-case/incident-security";

const ANSWER: SecurityConnectionsJson = {
  windowStart: "2026-10-25T08:30:00.000Z",
  windowEnd: "2026-10-25T10:30:00.000Z",
  resources: [],
  hasMoreResources: false,
  unmatched: [],
  unreadableKinds: [],
  failedKinds: [],
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
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermissions(Permission.SecurityViewer);
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
  test.each([CONNECTIONS, RESOURCE, INCIDENT])(
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

describe("POST /security-case/connections", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ReadSecurityEvent,
  ])(
    "answers %s with a case's connections, read as them",
    async (permission: Permission) => {
      setPermissions(permission);
      const forCase: jest.SpyInstance = jest
        .spyOn(SecurityConnections, "forCase")
        .mockResolvedValue(ANSWER);

      await route(CONNECTIONS)(
        request({ caseId: CASE_ID.toString() }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(forCase).toHaveBeenCalledWith({
        projectId: PROJECT,
        securityCaseId: CASE_ID,
        props,
      });
      expect(answered()).toEqual(ANSWER);
    },
  );

  test.each([
    Permission.ProjectMember,
    Permission.TelemetryAdmin,
    Permission.ReadHost,
    Permission.ReadProjectIncident,
  ])(
    "refuses %s: no Security access, so no security data - not even which hosts a case names",
    async (permission: Permission) => {
      setPermissions(permission);
      const forCase: jest.SpyInstance = jest.spyOn(
        SecurityConnections,
        "forCase",
      );
      const forEntities: jest.SpyInstance = jest.spyOn(
        SecurityConnections,
        "forEntities",
      );

      await route(CONNECTIONS)(
        request({ caseId: CASE_ID.toString() }),
        res,
        next,
      );
      await route(CONNECTIONS)(
        request({ entities: [{ type: "Host", value: "web-1" }] }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledTimes(2);
      expect(next.mock.calls[0]![0]).toBeInstanceOf(NotAuthorizedException);
      expect(forCase).not.toHaveBeenCalled();
      expect(forEntities).not.toHaveBeenCalled();
    },
  );

  test("a case the caller cannot read, or of another project, is not found", async () => {
    jest.spyOn(SecurityConnections, "forCase").mockResolvedValue(null);

    await route(CONNECTIONS)(
      request({ caseId: CASE_ID.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });

  test("a case ID that is not one is refused before any read", async () => {
    const forCase: jest.SpyInstance = jest.spyOn(
      SecurityConnections,
      "forCase",
    );

    for (const caseId of ["case-1", 42, { id: "x" }]) {
      next.mockClear();
      await route(CONNECTIONS)(request({ caseId } as never), res, next);
      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    }

    expect(forCase).not.toHaveBeenCalled();
  });

  test("an event's values: its entities (a case's worth at most), its time and the record its line was sent under", async () => {
    const forEntities: jest.SpyInstance = jest
      .spyOn(SecurityConnections, "forEntities")
      .mockResolvedValue(ANSWER);
    const many: Array<JSONObject> = [];

    for (let index: number = 0; index < 80; index++) {
      many.push({ type: "Host", value: `host-${index}` });
    }

    await route(CONNECTIONS)(
      request({
        entities: [
          { type: "Host", value: "web-1" },
          { type: "Nonsense", value: "kept as Other" },
          { value: "" },
          "not an entity",
          ...many,
        ],
        time: "2026-10-25T10:00:00.000Z",
        logResources: [
          { type: ServiceType.Host, id: HOST_ID.toString() },
          { type: ServiceType.Monitor, id: HOST_ID.toString() },
          { type: ServiceType.Host, id: "project-1" },
        ],
      } as never),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();

    const args: {
      projectId: ObjectID;
      entities: Array<{ type: string; value: string }>;
      time: Date;
      logResources: Array<{ type: string; id: string }>;
      readLogResources: boolean;
      props: DatabaseCommonInteractionProps;
    } = forEntities.mock.calls[0]![0] as never;

    expect(args.projectId).toBe(PROJECT);
    expect(args.props).toBe(props);
    expect(args.entities.length).toBe(SECURITY_CONNECTION_MAX_ENTITIES);
    expect(args.entities.slice(0, 2)).toEqual([
      { type: SecurityEntityType.Host, value: "web-1" },
      { type: SecurityEntityType.Other, value: "kept as Other" },
    ]);
    expect(args.time).toEqual(new Date("2026-10-25T10:00:00.000Z"));
    expect(args.logResources).toEqual([
      { type: ServiceType.Host, id: HOST_ID.toString() },
    ]);
    expect(args.readLogResources).toBe(false);
  });

  test("an entity's page asks for the logs behind its events too", async () => {
    const forEntities: jest.SpyInstance = jest
      .spyOn(SecurityConnections, "forEntities")
      .mockResolvedValue(ANSWER);

    await route(CONNECTIONS)(
      request({
        entities: [{ type: "User", value: "k@acme.example" }],
        readLogResources: true,
      }),
      res,
      next,
    );

    expect(forEntities.mock.calls[0]![0]).toMatchObject({
      readLogResources: true,
      time: undefined,
    });
  });
});

describe("POST /security-case/resource-security", () => {
  test("answers whoever may read security events with the record's security, read as them", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(ResourceSecurity, "read")
      .mockResolvedValue({ isInUse: false } as never);

    await route(RESOURCE)(
      request({ kind: SecurityConnectionKind.Host, id: HOST_ID.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith({
      projectId: PROJECT,
      kind: SecurityConnectionKind.Host,
      id: HOST_ID,
      props,
    });
    expect(answered()).toEqual({ isInUse: false });
  });

  test.each([Permission.ProjectMember, Permission.ReadHost, Permission.Viewer])(
    "refuses %s: a host's page shows its Security card only to who may read security events",
    async (permission: Permission) => {
      setPermissions(permission);
      const read: jest.SpyInstance = jest.spyOn(ResourceSecurity, "read");

      await route(RESOURCE)(
        request({ kind: SecurityConnectionKind.Host, id: HOST_ID.toString() }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
      expect(read).not.toHaveBeenCalled();
    },
  );

  test("a kind it does not know, or an ID that is not one, is refused before any read", async () => {
    const read: jest.SpyInstance = jest.spyOn(ResourceSecurity, "read");

    for (const body of [
      { kind: "Monitor", id: HOST_ID.toString() },
      { kind: SecurityConnectionKind.Host, id: "host-1" },
      { id: HOST_ID.toString() },
    ]) {
      next.mockClear();
      await route(RESOURCE)(request(body), res, next);
      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    }

    expect(read).not.toHaveBeenCalled();
  });

  test("a record the caller cannot read, or of another project, is not found", async () => {
    jest.spyOn(ResourceSecurity, "read").mockResolvedValue(null);

    await route(RESOURCE)(
      request({ kind: SecurityConnectionKind.User, id: HOST_ID.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });
});

describe("POST /security-case/incident-security", () => {
  test("answers whoever may read security cases, read as them", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(IncidentSecurity, "read")
      .mockResolvedValue({
        declaredBy: [],
        namingItsResources: [],
        namingItsResourcesCount: 0,
      });

    await route(INCIDENT)(
      request({ incidentId: HOST_ID.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith({
      projectId: PROJECT,
      incidentId: HOST_ID,
      props,
    });
  });

  test("a role that may read cases alone is enough: the card lists cases, not events", async () => {
    setPermissions(Permission.ReadSecurityCase);
    const read: jest.SpyInstance = jest
      .spyOn(IncidentSecurity, "read")
      .mockResolvedValue({
        declaredBy: [],
        namingItsResources: [],
        namingItsResourcesCount: 0,
      });

    await route(INCIDENT)(
      request({ incidentId: HOST_ID.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalled();
  });

  test.each([
    Permission.ProjectMember,
    Permission.ReadProjectIncident,
    Permission.ReadSecurityEvent,
  ])(
    "refuses %s: an incident's page shows no security case to who may not read cases",
    async (permission: Permission) => {
      setPermissions(permission);
      const read: jest.SpyInstance = jest.spyOn(IncidentSecurity, "read");

      await route(INCIDENT)(
        request({ incidentId: HOST_ID.toString() }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
      expect(read).not.toHaveBeenCalled();
    },
  );

  test("an incident ID that is not one, or one that is not found", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(IncidentSecurity, "read")
      .mockResolvedValue(null);

    await route(INCIDENT)(request({ incidentId: "INC-7" }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(read).not.toHaveBeenCalled();

    next.mockClear();
    await route(INCIDENT)(
      request({ incidentId: HOST_ID.toString() }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });
});

describe("reading a request", () => {
  test("readOptionalDate: a time a person could mean, or nothing", () => {
    expect(readOptionalDate("2026-10-25T10:00:00.000Z")).toEqual(
      new Date("2026-10-25T10:00:00.000Z"),
    );
    expect(readOptionalDate("yesterday")).toBeUndefined();
    expect(readOptionalDate("")).toBeUndefined();
    expect(readOptionalDate(1761386400000)).toBeUndefined();
    expect(readOptionalDate("2".repeat(80))).toBeUndefined();
  });

  test("readLogResources: known kinds and real ids, a few at most", () => {
    const many: Array<JSONObject> = [];

    for (let index: number = 0; index < 9; index++) {
      many.push({ type: ServiceType.Host, id: HOST_ID.toString() });
    }

    expect(readLogResources(many).length).toBe(MAX_REQUEST_LOG_RESOURCES);
    expect(readLogResources("nope" as never)).toEqual([]);
    expect(
      readLogResources([
        null,
        [],
        { type: ServiceType.Host },
        { type: "Nonsense", id: HOST_ID.toString() },
      ] as never),
    ).toEqual([]);
  });
});
