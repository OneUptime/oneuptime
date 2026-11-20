jest.mock("../../../Server/Utils/Logger");

/*
 * The monitor's incident path pulls the native isolated-vm addon through
 * its template renderer; nothing here runs it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import AlertAPI from "../../../Server/API/AlertAPI";
import AlertEpisodeAPI from "../../../Server/API/AlertEpisodeAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import IncidentEpisodeAPI from "../../../Server/API/IncidentEpisodeAPI";
import RecordAccessRoute from "../../../Server/API/RecordAccessRoute";
import ScheduledMaintenanceAPI from "../../../Server/API/ScheduledMaintenanceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import RecordAccessBuilder from "../../../Server/Utils/RecordAccess/RecordAccessBuilder";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RecordAccess, {
  RecordAccessKind,
  RecordAccessResult,
} from "../../../Types/RecordAccess/RecordAccess";
import UserType from "../../../Types/UserType";
import { tenantPermissionsFor } from "./PermissionRows";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test - GET /<record>/record-access/:recordId
 * (Server/API/RecordAccessRoute, #10272): what the reader may do on one
 * incident, alert, episode or maintenance event and on its parts, which
 * the record's page asks once as it opens.
 *
 * Each record's API registers it on its own router, behind the session
 * guards. The handler reads the project from the request's tenant and the
 * record from the path, hands them to the builder as the caller - whose
 * checks decide every operation - and answers the verdicts as JSON, never
 * cached. Which verdict is the builder's (RecordAccessOverHttp,
 * RecordAccessPostgres).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10272000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("10272000-0000-4000-8000-0000000000b1");
const INCIDENT_ID: string = "10272000-0000-4000-8000-0000000000a1";

type RouteFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> | void;

interface Registration {
  path: string;
  functions: Array<RouteFunction>;
}

// A router that records what is registered on it.
function recordingRouter(): {
  router: ExpressRouter;
  gets: Array<Registration>;
  writes: Array<Registration>;
} {
  const gets: Array<Registration> = [];
  const writes: Array<Registration> = [];

  const write: (path: string, ...functions: Array<RouteFunction>) => void = (
    path: string,
    ...functions: Array<RouteFunction>
  ): void => {
    writes.push({ path, functions });
  };

  const router: ExpressRouter = {
    get: (path: string, ...functions: Array<RouteFunction>) => {
      gets.push({ path, functions });
    },
    post: write,
    put: write,
    delete: write,
  } as unknown as ExpressRouter;

  return { router, gets, writes };
}

const MEMBER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
  userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, [
    Permission.ProjectMember,
  ]),
};

const RESULT: RecordAccessResult = {
  kind: RecordAccessKind.Incident,
  recordId: INCIDENT_ID,
  tables: {
    Incident: { update: RecordAccess.allowed() },
  },
};

interface Answer {
  sent: jest.SpiedFunction<typeof Response.sendJsonObjectResponse>;
  noCache: jest.SpiedFunction<typeof Response.setNoCacheHeaders>;
  build: jest.SpiedFunction<typeof RecordAccessBuilder.build>;
  next: jest.Mock;
}

/*
 * Registers the route, then runs its handler with this caller and path, as
 * Express would once the session guards let it through.
 */
async function ask(data: {
  props: DatabaseCommonInteractionProps;
  recordId: unknown;
  kind?: RecordAccessKind;
}): Promise<Answer> {
  const { router, gets } = recordingRouter();

  RecordAccessRoute.register({
    router: router,
    apiPath: "/incident",
    kind: data.kind || RecordAccessKind.Incident,
  });

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(data.props);

  const sent: Answer["sent"] = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {
      return undefined;
    }) as never);
  const noCache: Answer["noCache"] = jest
    .spyOn(Response, "setNoCacheHeaders")
    .mockImplementation((() => {
      return undefined;
    }) as never);
  const build: Answer["build"] = jest
    .spyOn(RecordAccessBuilder, "build")
    .mockResolvedValue(RESULT);

  const next: jest.Mock = jest.fn();
  const handler: RouteFunction = gets[0]!.functions[2]!;

  await handler(
    { params: { recordId: data.recordId } } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { sent, noCache, build, next };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the record access route", () => {
  it("is a GET under the record API's path, by the record's ID, behind the session guards", () => {
    const { router, gets, writes } = recordingRouter();

    RecordAccessRoute.register({
      router: router,
      apiPath: "/incident",
      kind: RecordAccessKind.Incident,
    });

    expect(writes).toHaveLength(0);
    expect(gets).toHaveLength(1);
    expect(gets[0]!.path).toBe("/incident/record-access/:recordId");
    expect(gets[0]!.functions).toHaveLength(3);
    expect(gets[0]!.functions[0]).toBe(UserMiddleware.getUserMiddleware);
    expect(gets[0]!.functions[1]).toBe(
      UserMiddleware.requireUserAuthentication,
    );
  });

  it("answers the verdicts, as JSON, never cached", async () => {
    const answer: Answer = await ask({ props: MEMBER, recordId: INCIDENT_ID });

    expect(answer.next).not.toHaveBeenCalled();
    expect(answer.noCache).toHaveBeenCalledTimes(1);
    expect(answer.sent).toHaveBeenCalledTimes(1);
    expect(answer.sent.mock.calls[0]![2]).toEqual(RecordAccess.toJSON(RESULT));
  });

  it("works it out for the record in the path, of the route's kind, as the caller", async () => {
    const answer: Answer = await ask({
      props: MEMBER,
      recordId: INCIDENT_ID.toUpperCase(),
      kind: RecordAccessKind.ScheduledMaintenance,
    });

    expect(answer.build).toHaveBeenCalledTimes(1);

    const call: Parameters<typeof RecordAccessBuilder.build>[0] =
      answer.build.mock.calls[0]![0];

    expect(call.kind).toBe(RecordAccessKind.ScheduledMaintenance);
    expect(call.recordId.toString().toLowerCase()).toBe(INCIDENT_ID);
    expect(call.props).toBe(MEMBER);
  });

  it.each([
    ["no ID", undefined],
    ["an empty ID", ""],
    ["something that is not an ID", "INC-18"],
  ])(
    "refuses %s in words that say what to send, and asks nothing",
    async (_name: string, recordId: unknown) => {
      const answer: Answer = await ask({ props: MEMBER, recordId: recordId });

      expect(answer.build).not.toHaveBeenCalled();
      expect(answer.sent).not.toHaveBeenCalled();
      expect(answer.next).toHaveBeenCalledTimes(1);

      const error: unknown = answer.next.mock.calls[0]![0];

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        "The record to ask about is not named by an ID. Ask again with the ID of the record.",
      );
    },
  );

  it("refuses a request that names no project, and asks nothing", async () => {
    const answer: Answer = await ask({
      props: { ...MEMBER, tenantId: undefined },
      recordId: INCIDENT_ID,
    });

    expect(answer.build).not.toHaveBeenCalled();
    expect(answer.next).toHaveBeenCalledTimes(1);
  });
});

describe("each record's API registers it, for its own kind", () => {
  it.each([
    [
      "/incident",
      RecordAccessKind.Incident,
      () => {
        return new IncidentAPI();
      },
    ],
    [
      "/alert",
      RecordAccessKind.Alert,
      () => {
        return new AlertAPI();
      },
    ],
    [
      "/incident-episode",
      RecordAccessKind.IncidentEpisode,
      () => {
        return new IncidentEpisodeAPI();
      },
    ],
    [
      "/alert-episode",
      RecordAccessKind.AlertEpisode,
      () => {
        return new AlertEpisodeAPI();
      },
    ],
    [
      "/scheduled-maintenance",
      RecordAccessKind.ScheduledMaintenance,
      () => {
        return new ScheduledMaintenanceAPI();
      },
    ],
  ])(
    "%s",
    (apiPath: string, kind: RecordAccessKind, makeApi: () => unknown) => {
      const register: jest.SpiedFunction<typeof RecordAccessRoute.register> =
        jest.spyOn(RecordAccessRoute, "register");

      makeApi();

      expect(register).toHaveBeenCalledTimes(1);
      expect(register.mock.calls[0]![0].apiPath).toBe(apiPath);
      expect(register.mock.calls[0]![0].kind).toBe(kind);
    },
  );
});
