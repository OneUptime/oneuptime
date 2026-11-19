import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE USER OVERRIDE API HOLDS A TEAM-SCOPED CALLER TO THEIR TEAM (issue
 * #9733): POST /on-call-duty-policy-user-override, PUT and DELETE
 * /on-call-duty-policy-user-override/:id and POST .../:id/end-now - the
 * routes the dashboard, the API reference, Terraform and the mobile app
 * all write overrides through - for a caller whose only permission to
 * manage overrides is Manage On-Call Policy User Overrides for Own Team.
 *
 * Each request runs its route's own handler, the real service behind it
 * (its permission checks and hooks) and the world of
 * TestingUtils/UserOverrideTeamWorld: Alice manages the overrides of
 * Payments' people (Alice, Bob, Dave); Carol is of Mobile. An override
 * naming somebody outside Payments is refused, saying why, and nothing is
 * written; one of Payments' people is written as for anyone; a project API
 * key holding the permission through no team writes nothing; a caller whose
 * permission reaches everyone writes as before.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallDutyPolicyUserOverrideAPI from "../../../Server/API/OnCallDutyPolicyUserOverrideAPI";
import CreateScopeException from "../../../Server/Types/Database/Permissions/CreateScopeException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import {
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_COVER_REFUSAL,
  USER_OVERRIDE_TEAM_DELETE_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
  USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import Permission from "../../../Types/Permission";
import { InMemoryTable } from "../TestingUtils/InMemoryRepository";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  ADD_ENDS,
  ADD_STARTS,
  ALICE,
  BOB,
  CAROL,
  DAVE,
  EVERYONE,
  OUTSIDER_AWAY,
  OUTSIDER_COVERS,
  PROJECT,
  RUNNING_OUTSIDER,
  RUNNING_TEAM,
  TEAM_GLOBAL,
  TEAM_PERMISSION,
  UserOverrideTeamWorld,
  apiKey,
  installUserOverrideTeamWorld,
  member,
  row,
  teamScoped,
} from "../TestingUtils/UserOverrideTeamWorld";

const PATH: string = "/on-call-duty-policy-user-override";

let world: UserOverrideTeamWorld;
let table: InMemoryTable;
let props: DatabaseCommonInteractionProps;
let next: ReturnType<typeof jest.fn>;

// A request to one of the API's routes, as the caller in `props`.
const send: (data: {
  method: "post" | "put" | "delete";
  uri: string;
  params?: Record<string, string>;
  body?: JSONObject;
}) => Promise<void> = async (data: {
  method: "post" | "put" | "delete";
  uri: string;
  params?: Record<string, string>;
  body?: JSONObject;
}): Promise<void> => {
  next = jest.fn();

  await mockRouter.match(data.method, data.uri).handlerFunction(
    {
      headers: {},
      query: {},
      params: data.params || {},
      body: data.body || {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );
};

// What the route answered with when it refused: the error it handed on.
const refusal: () => Error = (): Error => {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0] as Error;
};

const accepted: () => void = (): void => {
  expect(next).not.toHaveBeenCalled();
};

// An override as an API client (Terraform, the API reference) sends it.
const createBody: (data: {
  away: string;
  covers?: string;
}) => JSONObject = (data: { away: string; covers?: string }): JSONObject => {
  return {
    data: {
      projectId: PROJECT,
      overrideUserId: data.away,
      ...(data.covers ? { routeAlertsToUserId: data.covers } : {}),
      startsAt: ADD_STARTS.toISOString(),
      endsAt: ADD_ENDS.toISOString(),
    },
  };
};

const storedCover: (id: string) => string | null = (
  id: string,
): string | null => {
  const value: unknown = table.get(id)?.["routeAlertsToUserId"];
  return value ? String(value).toLowerCase() : null;
};

beforeEach(() => {
  mockRouter.routes.length = 0;
  new OnCallDutyPolicyUserOverrideAPI();

  world = installUserOverrideTeamWorld();
  table = world.table;
  everyServerProductIsOn();

  props = teamScoped();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /on-call-duty-policy-user-override", () => {
  test("adds an override of two people of the caller's team", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: BOB, covers: DAVE }),
    });

    accepted();
    expect(table.inserts).toHaveLength(1);
    expect(Response.sendEntityResponse).toHaveBeenCalledTimes(1);
  });

  test("refuses somebody of another team away, saying why, and writes nothing", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: CAROL, covers: BOB }),
    });

    expect(refusal()).toBeInstanceOf(CreateScopeException);
    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(table.inserts).toHaveLength(0);
  });

  test("refuses somebody of another team covering", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: BOB, covers: CAROL }),
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_COVER_REFUSAL);
    expect(table.inserts).toHaveLength(0);
  });

  test("a project API key holding the permission through no team adds nothing, and says what to give it instead", async () => {
    props = apiKey([row(Permission.OnCallViewer), row(TEAM_PERMISSION)]);

    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: BOB, covers: DAVE }),
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL);
    expect(table.inserts).toHaveLength(0);
  });

  test("an API key with a permission that reaches everyone adds one, as before", async () => {
    props = apiKey([row(Permission.OnCallMember)]);

    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: CAROL, covers: BOB }),
    });

    accepted();
    expect(table.inserts).toHaveLength(1);
  });
});

describe("PUT /on-call-duty-policy-user-override/:id", () => {
  test("changes who covers to another teammate", async () => {
    await send({
      method: "put",
      uri: `${PATH}/:id`,
      params: { id: TEAM_GLOBAL },
      body: { data: { routeAlertsToUserId: ALICE } },
    });

    accepted();
    expect(storedCover(TEAM_GLOBAL)).toBe(ALICE);
  });

  test("refuses to change who covers to somebody of another team", async () => {
    await send({
      method: "put",
      uri: `${PATH}/:id`,
      params: { id: TEAM_GLOBAL },
      body: { data: { routeAlertsToUserId: CAROL } },
    });

    expect(refusal()).toBeInstanceOf(NotAuthorizedException);
    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_COVER_REFUSAL);
    expect(storedCover(TEAM_GLOBAL)).toBe(DAVE);
  });

  test("refuses any change of an override that names somebody of another team", async () => {
    await send({
      method: "put",
      uri: `${PATH}/:id`,
      params: { id: OUTSIDER_COVERS },
      body: { data: { routeAlertsToUserId: BOB } },
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
    expect(storedCover(OUTSIDER_COVERS)).toBe(CAROL);
  });

  test("a caller whose permission reaches everyone changes it, as before", async () => {
    props = member([row(Permission.OnCallMember, { teamId: EVERYONE })]);

    await send({
      method: "put",
      uri: `${PATH}/:id`,
      params: { id: OUTSIDER_COVERS },
      body: { data: { routeAlertsToUserId: BOB } },
    });

    accepted();
    expect(storedCover(OUTSIDER_COVERS)).toBe(BOB);
  });
});

describe("POST /on-call-duty-policy-user-override/:id/end-now", () => {
  test("ends a teammate's override under way", async () => {
    await send({
      method: "post",
      uri: `${PATH}/:id/end-now`,
      params: { id: RUNNING_TEAM },
    });

    accepted();
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });

  test("refuses to end an outsider's override", async () => {
    await send({
      method: "post",
      uri: `${PATH}/:id/end-now`,
      params: { id: RUNNING_OUTSIDER },
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
  });
});

describe("DELETE /on-call-duty-policy-user-override/:id", () => {
  test("deletes an override of the team's people", async () => {
    await send({
      method: "delete",
      uri: `${PATH}/:id`,
      params: { id: TEAM_GLOBAL },
    });

    accepted();
    expect(table.get(TEAM_GLOBAL)).toBeUndefined();
  });

  test("refuses to delete one that names somebody of another team, and keeps it", async () => {
    await send({
      method: "delete",
      uri: `${PATH}/:id`,
      params: { id: OUTSIDER_AWAY },
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_DELETE_REFUSAL);
    expect(table.get(OUTSIDER_AWAY)).toBeDefined();
    expect(world.feedItemCount()).toBe(0);
  });
});
