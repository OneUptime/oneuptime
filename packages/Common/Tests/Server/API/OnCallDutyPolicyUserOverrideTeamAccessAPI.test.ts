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
  ERIN,
  EVERYONE,
  OTHER_POLICY,
  OUTSIDER_AWAY,
  OUTSIDER_COVERS,
  PAT,
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

/*
 * "Skip until..." beside a person on a schedule's layers (issue #9884)
 * saves time away for them with nobody named to cover - a skip - as a
 * global override, or, for a caller whose permission covers only some
 * policies, one on each policy offered. The page locks the button beside
 * the people outside the caller's teams because the server refuses each of
 * these saves for them; here are the saves as the page sends them.
 */
describe("Skip until... on a schedule's layers, as the page saves it", () => {
  test("skips a teammate: nobody named to cover, the rotation covers", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: BOB }),
    });

    accepted();
    expect(table.inserts).toHaveLength(1);
    expect(table.inserts[0]?.["routeAlertsToUserId"] ?? null).toBeNull();
  });

  test("refuses to skip somebody of another team, saying why, and writes nothing", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: CAROL }),
    });

    expect(refusal()).toBeInstanceOf(CreateScopeException);
    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(table.inserts).toHaveLength(0);
  });

  test("refuses to skip somebody who shares only a team that gives the permission to nobody", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: ERIN }),
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(table.inserts).toHaveLength(0);
  });

  test("refuses to skip somebody whose invitation to the team is not accepted yet", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: PAT }),
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(table.inserts).toHaveLength(0);
  });

  test("on a policy it is added on, the same: a teammate is skipped, somebody of another team refused", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: {
        data: {
          ...(createBody({ away: BOB })["data"] as JSONObject),
          onCallDutyPolicyId: OTHER_POLICY,
        },
      },
    });

    accepted();
    expect(table.inserts).toHaveLength(1);

    await send({
      method: "post",
      uri: PATH,
      body: {
        data: {
          ...(createBody({ away: CAROL })["data"] as JSONObject),
          onCallDutyPolicyId: OTHER_POLICY,
        },
      },
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(table.inserts).toHaveLength(1);
  });

  test("a caller whose permission reaches everyone skips anybody, as before", async () => {
    props = member([row(Permission.OnCallMember, { teamId: EVERYONE })]);

    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: CAROL }),
    });

    accepted();
    expect(table.inserts).toHaveLength(1);
  });
});

/*
 * The mobile app's cover sheets (issue #9883) send these: "Cover for me"
 * names the caller away and the person picked covering; "I'll take over"
 * the person picked away and the caller covering; Edit sends who covers
 * from now on - nobody, for the rotation - or a new end. The app offers
 * only the caller's teams' people, and locks Edit, End now and Cancel on
 * an override naming anyone else, because the server refuses each of these
 * for them; End now and Cancel are the routes above.
 */
describe("the mobile app's cover, as the app sends it", () => {
  test("Cover for me, a teammate covering, is added", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: ALICE, covers: BOB }),
    });

    accepted();
    expect(table.inserts).toHaveLength(1);
  });

  test("Cover for me, somebody of another team covering, is refused, saying why", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: ALICE, covers: CAROL }),
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_COVER_REFUSAL);
    expect(table.inserts).toHaveLength(0);
  });

  test("I'll take over, for somebody of another team, is refused, saying why", async () => {
    await send({
      method: "post",
      uri: PATH,
      body: createBody({ away: CAROL, covers: ALICE }),
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(table.inserts).toHaveLength(0);
  });

  test("Edit hands a teammate's cover to the rotation", async () => {
    await send({
      method: "put",
      uri: `${PATH}/:id`,
      params: { id: TEAM_GLOBAL },
      body: { data: { routeAlertsToUserId: null } },
    });

    accepted();
    expect(storedCover(TEAM_GLOBAL)).toBeNull();
  });

  test("Edit is refused on an override naming somebody of another team, even to hand it to the rotation", async () => {
    await send({
      method: "put",
      uri: `${PATH}/:id`,
      params: { id: OUTSIDER_COVERS },
      body: { data: { routeAlertsToUserId: null } },
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
    expect(storedCover(OUTSIDER_COVERS)).toBe(CAROL);
  });

  test("Edit is refused on one whose person away is of another team, even only its end", async () => {
    const endsAt: Date = new Date("2026-11-20T15:00:00.000Z");

    await send({
      method: "put",
      uri: `${PATH}/:id`,
      params: { id: OUTSIDER_AWAY },
      body: { data: { endsAt: endsAt.toISOString() } },
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
    expect(
      new Date(String(table.get(OUTSIDER_AWAY)?.["endsAt"])).toISOString(),
    ).toBe("2026-11-20T17:00:00.000Z");
  });

  test("Cancel is refused on an upcoming one whose cover is of another team, and keeps it", async () => {
    await send({
      method: "delete",
      uri: `${PATH}/:id`,
      params: { id: OUTSIDER_COVERS },
    });

    expect(refusal().message).toBe(USER_OVERRIDE_TEAM_DELETE_REFUSAL);
    expect(table.get(OUTSIDER_COVERS)).toBeDefined();
  });
});
