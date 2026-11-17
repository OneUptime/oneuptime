import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallDutyPolicyAPI from "../../../Server/API/OnCallDutyPolicyAPI";
import OnCallDutyPolicyService, {
  OnDutyPolicies,
} from "../../../Server/Services/OnCallDutyPolicyService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock, SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

/*
 * MY ON-CALL POLICIES ASKS ONCE, FOR EVERY PROJECT (#8124).
 *
 * GET /on-call-duty-policy/current-on-duty-escalation-policies answers for
 * the project the request names - the dashboard's header asks it on every
 * page. My On-Call Policies used to ask it once per project, one project
 * after another. With the is-multi-tenant-query header it now answers for
 * every project the person may open, in one response:
 *
 *   - the projects getUserMiddleware gave the request a permission set in
 *     (every project the person is a member of that is not blocked), each
 *     checked on its own: one whose Require SSO to Sign In the person has
 *     not met holds only what every signed-in user holds, and is left out,
 *     as a request in it would be refused; so is one whose membership a
 *     block takes away;
 *   - the same three lists, every project's rows in them, each row naming
 *     its project;
 *   - who is asking first: no credentials is 401, and a credential with no
 *     person is "Invalid userId.", as in one project.
 */

const ROUTE: string =
  "/on-call-duty-policy/current-on-duty-escalation-policies";

const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PAYMENTS: ObjectID = new ObjectID("0d140000-0000-4000-8000-0000000000a1");
const SEARCH: ObjectID = new ObjectID("0d140000-0000-4000-8000-0000000000a2");
const SSO_LOCKED: ObjectID = new ObjectID(
  "0d140000-0000-4000-8000-0000000000a3",
);
const BLOCKED_MEMBERSHIP: ObjectID = new ObjectID(
  "0d140000-0000-4000-8000-0000000000a4",
);

function row(
  permission: Permission,
  isBlockPermission: boolean = false,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: isBlockPermission,
  } as UserPermission;
}

// A member's set: what every signed-in user holds, membership, and a role.
function memberOf(projectId: ObjectID): UserTenantAccessPermission {
  return UserPermissionUtil.withProjectUserPermission({
    ...UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId),
    permissions: [
      ...UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId)
        .permissions,
      row(Permission.ProjectMember),
    ],
  });
}

function permissionsIn(
  sets: Array<UserTenantAccessPermission>,
): Dictionary<UserTenantAccessPermission> {
  const dictionary: Dictionary<UserTenantAccessPermission> = {};

  for (const set of sets) {
    dictionary[set.projectId.toString()] = set;
  }

  return dictionary;
}

function withProps(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

function acrossProjectsAs(
  sets: Array<UserTenantAccessPermission>,
): DatabaseCommonInteractionProps {
  return {
    userType: UserType.User,
    userId: USER_ID,
    isMultiTenantRequest: true,
    userTenantAccessPermission: permissionsIn(sets),
  };
}

// An escalation rule's row - of a person, a team or a schedule - in a project.
function rule<
  T extends {
    id: ObjectID | null;
    projectId?: ObjectID | undefined;
    onCallDutyPolicy?: OnCallDutyPolicy | undefined;
  },
>(modelType: { new (): T }, projectId: ObjectID, policyName: string): T {
  const item: T = new modelType();
  item.id = ObjectID.generate();
  item.projectId = projectId;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = ObjectID.generate();
  policy.name = policyName;
  item.onCallDutyPolicy = policy;

  return item;
}

interface RouteCall {
  thrown: unknown;
  nextCallCount: number;
}

async function callRoute(): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: {},
    headers: { "is-multi-tenant-query": "true" },
  } as unknown as ExpressRequest;

  const next: Mock = jest.fn();

  await mockRouter
    .match("get", ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

function sentJson(): JSONObject {
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  expect(sendJson).toHaveBeenCalledTimes(1);

  return sendJson.mock.calls[0]![2] as JSONObject;
}

let acrossProjects: SpyInstance<
  typeof OnCallDutyPolicyService.getOnCallPoliciesWhereUserIsOnCallDutyInProjects
>;
let oneProject: SpyInstance<
  typeof OnCallDutyPolicyService.getOnCallPoliciesWhereUserIsOnCallDuty
>;

beforeAll(() => {
  new OnCallDutyPolicyAPI();
});

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  acrossProjects = jest
    .spyOn(
      OnCallDutyPolicyService,
      "getOnCallPoliciesWhereUserIsOnCallDutyInProjects",
    )
    .mockImplementation(
      async (data: {
        projectIds: Array<ObjectID>;
      }): Promise<Map<string, OnDutyPolicies>> => {
        const answers: Map<string, OnDutyPolicies> = new Map();

        for (const projectId of data.projectIds) {
          answers.set(projectId.toString().toLowerCase(), {
            escalationRulesByUser: [],
            escalationRulesByTeam: [],
            escalationRulesBySchedule: [],
          });
        }

        return answers;
      },
    );

  oneProject = jest.spyOn(
    OnCallDutyPolicyService,
    "getOnCallPoliciesWhereUserIsOnCallDuty",
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function projectsAskedFor(): Array<string> {
  expect(acrossProjects).toHaveBeenCalledTimes(1);

  return acrossProjects.mock.calls[0]![0].projectIds.map(
    (projectId: ObjectID): string => {
      return projectId.toString();
    },
  );
}

describe(`GET ${ROUTE} across projects - which projects`, () => {
  test("every project the person may open, in one lookup, and nothing asked project by project", async () => {
    withProps(acrossProjectsAs([memberOf(PAYMENTS), memberOf(SEARCH)]));

    const call: RouteCall = await callRoute();

    expect(call.nextCallCount).toBe(0);
    expect(projectsAskedFor()).toEqual([
      PAYMENTS.toString(),
      SEARCH.toString(),
    ]);
    expect(acrossProjects.mock.calls[0]![0].userId).toEqual(USER_ID);
    expect(oneProject).not.toHaveBeenCalled();
  });

  test("a project whose sign-in rules the person has not met is left out, as a request in it is refused", async () => {
    withProps(
      acrossProjectsAs([
        memberOf(PAYMENTS),
        UserPermissionUtil.getDefaultUserTenantAccessPermission(SSO_LOCKED),
      ]),
    );

    await callRoute();

    expect(projectsAskedFor()).toEqual([PAYMENTS.toString()]);
  });

  test("a project whose membership a block takes away is left out", async () => {
    const blocked: UserTenantAccessPermission = memberOf(BLOCKED_MEMBERSHIP);
    blocked.permissions = [
      ...blocked.permissions,
      row(Permission.ProjectUser, true),
    ];

    withProps(acrossProjectsAs([memberOf(SEARCH), blocked]));

    await callRoute();

    expect(projectsAskedFor()).toEqual([SEARCH.toString()]);
  });

  test("a project the request holds no permission set in is never asked", async () => {
    // getUserMiddleware leaves out blocked projects and those the person is not in.
    withProps(acrossProjectsAs([memberOf(PAYMENTS)]));

    await callRoute();

    expect(projectsAskedFor()).not.toContain(SEARCH.toString());
  });

  test("a member of no project: no project is looked up, and the lists are empty", async () => {
    withProps(acrossProjectsAs([]));

    await callRoute();

    expect(projectsAskedFor()).toEqual([]);
    expect(sentJson()).toEqual({
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    });
  });

  test("a key that is not a project id is not a project", async () => {
    const props: DatabaseCommonInteractionProps = acrossProjectsAs([
      memberOf(PAYMENTS),
    ]);
    props.userTenantAccessPermission!["not-a-project"] = memberOf(SEARCH);

    withProps(props);

    await callRoute();

    expect(projectsAskedFor()).toEqual([PAYMENTS.toString()]);
  });
});

describe(`GET ${ROUTE} across projects - the answer`, () => {
  test("every project's rules in the three lists, project by project, each naming its project", async () => {
    const paymentsByUser: OnCallDutyPolicyEscalationRuleUser = rule(
      OnCallDutyPolicyEscalationRuleUser,
      PAYMENTS,
      "Payments",
    );
    const searchByTeam: OnCallDutyPolicyEscalationRuleTeam = rule(
      OnCallDutyPolicyEscalationRuleTeam,
      SEARCH,
      "Search",
    );
    const paymentsBySchedule: OnCallDutyPolicyEscalationRuleSchedule = rule(
      OnCallDutyPolicyEscalationRuleSchedule,
      PAYMENTS,
      "Payments",
    );
    const searchBySchedule: OnCallDutyPolicyEscalationRuleSchedule = rule(
      OnCallDutyPolicyEscalationRuleSchedule,
      SEARCH,
      "Search",
    );

    acrossProjects.mockResolvedValue(
      new Map<string, OnDutyPolicies>([
        [
          SEARCH.toString().toLowerCase(),
          {
            escalationRulesByUser: [],
            escalationRulesByTeam: [searchByTeam],
            escalationRulesBySchedule: [searchBySchedule],
          },
        ],
        [
          PAYMENTS.toString().toLowerCase(),
          {
            escalationRulesByUser: [paymentsByUser],
            escalationRulesByTeam: [],
            escalationRulesBySchedule: [paymentsBySchedule],
          },
        ],
      ]),
    );

    withProps(acrossProjectsAs([memberOf(PAYMENTS), memberOf(SEARCH)]));

    await callRoute();

    const answer: JSONObject = sentJson();

    const projectsOf: (list: string) => Array<string> = (
      list: string,
    ): Array<string> => {
      return (answer[list] as JSONArray).map((item: unknown): string => {
        return String(
          ((item as JSONObject)["projectId"] as JSONObject)["value"],
        );
      });
    };

    expect(projectsOf("escalationRulesByUser")).toEqual([PAYMENTS.toString()]);
    expect(projectsOf("escalationRulesByTeam")).toEqual([SEARCH.toString()]);
    // In the order of the projects, whatever order the lookup answered in.
    expect(projectsOf("escalationRulesBySchedule")).toEqual([
      PAYMENTS.toString(),
      SEARCH.toString(),
    ]);
    expect(
      ((answer["escalationRulesByUser"] as JSONArray)[0] as JSONObject)[
        "onCallDutyPolicy"
      ],
    ).toMatchObject({ name: "Payments" });
  });

  test("a lookup that fails is the request's error", async () => {
    acrossProjects.mockRejectedValue(new Error("pool exhausted"));
    withProps(acrossProjectsAs([memberOf(PAYMENTS)]));

    const call: RouteCall = await callRoute();

    expect(call.nextCallCount).toBe(1);
    expect((call.thrown as Error).message).toBe("pool exhausted");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe(`GET ${ROUTE} across projects - who is asking`, () => {
  test("no credentials: 401, before anything is looked up", async () => {
    withProps({ userType: UserType.Public, isMultiTenantRequest: true });

    const call: RouteCall = await callRoute();

    expect(call.thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(acrossProjects).not.toHaveBeenCalled();
  });

  test("a master-admin session with no person: 'Invalid userId.', as in one project", async () => {
    withProps({
      userType: UserType.MasterAdmin,
      isMasterAdmin: true,
      isMultiTenantRequest: true,
      userTenantAccessPermission: permissionsIn([memberOf(PAYMENTS)]),
    });

    const call: RouteCall = await callRoute();

    expect(call.nextCallCount).toBe(0);

    const sendError: jest.Mock =
      Response.sendErrorResponse as unknown as jest.Mock;
    expect(sendError).toHaveBeenCalledTimes(1);
    expect(sendError.mock.calls[0]![2]).toBeInstanceOf(BadDataException);
    expect((sendError.mock.calls[0]![2] as BadDataException).message).toBe(
      "Invalid userId.",
    );
    expect(acrossProjects).not.toHaveBeenCalled();
  });
});

describe(`GET ${ROUTE} in one project, as before`, () => {
  test("a request that names a project asks that project alone", async () => {
    oneProject.mockResolvedValue({
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    });

    withProps({
      tenantId: PAYMENTS,
      userType: UserType.User,
      userId: USER_ID,
      userTenantAccessPermission: permissionsIn([memberOf(PAYMENTS)]),
    });

    await callRoute();

    expect(oneProject).toHaveBeenCalledWith({
      projectId: PAYMENTS,
      userId: USER_ID,
    });
    expect(acrossProjects).not.toHaveBeenCalled();
  });
});

describe("OnCallDutyPolicyAPI.getProjectsTheCallerMayOpen", () => {
  test("a member's projects, once each, however the dictionary writes them", () => {
    const props: DatabaseCommonInteractionProps = acrossProjectsAs([
      memberOf(PAYMENTS),
      memberOf(SEARCH),
    ]);

    expect(
      OnCallDutyPolicyAPI.getProjectsTheCallerMayOpen(props).map(
        (projectId: ObjectID): string => {
          return projectId.toString();
        },
      ),
    ).toEqual([PAYMENTS.toString(), SEARCH.toString()]);
  });

  test("none for a request with no permission sets", () => {
    expect(
      OnCallDutyPolicyAPI.getProjectsTheCallerMayOpen({
        userType: UserType.User,
        userId: USER_ID,
      }),
    ).toEqual([]);
  });
});
