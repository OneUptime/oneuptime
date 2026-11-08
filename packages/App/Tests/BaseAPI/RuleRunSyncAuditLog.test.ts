import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseService from "Common/Server/Services/DatabaseService";
import ServiceLevelObjectiveFeedService from "Common/Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import Response from "Common/Server/Utils/Response";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import { RuleRunType } from "Common/Types/Rules/RuleRun";
import UserType from "Common/Types/UserType";
import FeedMarkdown from "Common/Utils/Markdown/FeedMarkdown";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A STATUS PAGE OR SLO MONITOR RULE'S RUN NOW, FROM THE ROUTE TO THE WRITES
 * (issue #6324).
 *
 * The route, its permission check (RuleRunPermission), the runner and both
 * sync engines are real; only the database is answered here, in memory.
 * What a person's Run now changes - the page's resources, the SLO's
 * monitors - is written on their behalf, so the audit log records it as
 * theirs. Who may run a rule is unchanged: a caller the route refuses
 * writes nothing.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: { sendJsonObjectResponse: jest.fn() },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: { getUserMiddleware: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

// Importing the module registers its route on the mocked router.
import RuleRunAPI from "../../FeatureSet/BaseAPI/API/RuleRun";

new RuleRunAPI().getRouter();

const ROUTE: string = "/rule-run/:ruleType/:ruleId/run";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SLO_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RUNNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const MONITOR_A_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const RESOURCE_B_ID: ObjectID = new ObjectID(
  "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
);
const KEY_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

type AnyMock = jest.Mock<(...args: Array<any>) => any>;

interface Write {
  table: string;
  method: string;
  props: DatabaseCommonInteractionProps;
}

let writes: Array<Write>;

function grantsOf(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): DatabaseCommonInteractionProps["userTenantAccessPermission"] {
  const row: (
    permission: Permission,
    isBlockPermission: boolean,
  ) => UserPermission = (
    permission: Permission,
    isBlockPermission: boolean,
  ): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: isBlockPermission,
    } as UserPermission;
  };

  return {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        ...permissions.map((permission: Permission): UserPermission => {
          return row(permission, false);
        }),
        ...blocked.map((permission: Permission): UserPermission => {
          return row(permission, true);
        }),
      ],
    },
  } as unknown as DatabaseCommonInteractionProps["userTenantAccessPermission"];
}

function person(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: RUNNER_ID,
    userType: UserType.User,
    isMasterAdmin: false,
    userTenantAccessPermission: grantsOf(permissions, blocked),
  };
}

const ON_THEIR_BEHALF: DatabaseCommonInteractionProps = {
  isRoot: true,
  userId: RUNNER_ID,
  userType: UserType.User,
};

function monitor(id: ObjectID, name: string): Record<string, unknown> {
  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    name: name,
    labels: [],
  };
}

/*
 * The page's rule claims every monitor, and A is new to the page; B's
 * resource is the rule's, but B is gone from the project. The SLO's rules
 * claim every monitor, and the SLO holds none yet.
 */
function answer(table: string, method: string): unknown {
  switch (`${table}.${method}`) {
    case "StatusPageMonitorRule.findOneBy":
    case "StatusPageMonitorRule.findOneById":
      return {
        id: RULE_ID,
        _id: RULE_ID.toString(),
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        isEnabled: true,
        monitorLabels: [],
        monitorNamePattern: ".*",
      };
    case "ServiceLevelObjectiveMonitorRule.findOneBy":
      return {
        id: RULE_ID,
        _id: RULE_ID.toString(),
        isEnabled: true,
        serviceLevelObjectiveId: SLO_ID,
      };
    case "ServiceLevelObjectiveMonitorRule.findBy":
      return [
        {
          id: RULE_ID,
          _id: RULE_ID.toString(),
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          isEnabled: true,
          monitorLabels: [],
          monitorNamePattern: ".*",
        },
      ];
    case "ServiceLevelObjective.findOneById":
      return {
        id: SLO_ID,
        _id: SLO_ID.toString(),
        projectId: PROJECT_ID,
        name: "Checkout",
        monitors: [],
        autoAddedMonitors: [],
      };
    case "Monitor.findBy":
      return [monitor(MONITOR_A_ID, "api-gateway")];
    case "Monitor.findOneById":
      return null;
    case "StatusPageResource.findBy":
      return [
        {
          id: RESOURCE_B_ID,
          _id: RESOURCE_B_ID.toString(),
          monitorId: MONITOR_B_ID,
          statusPageMonitorRuleId: RULE_ID,
        },
      ];
    default:
      return method === "findBy" ? [] : null;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  writes = [];

  for (const method of ["findOneById", "findOneBy", "findBy"] as const) {
    jest
      .spyOn(DatabaseService.prototype, method)
      .mockImplementation(async function (
        this: DatabaseService<BaseModel>,
      ): Promise<unknown> {
        return answer(this.getModel().tableName || "", method);
      } as never);
  }

  for (const method of ["create", "updateOneById", "deleteOneById"] as const) {
    jest
      .spyOn(DatabaseService.prototype, method)
      .mockImplementation(async function (
        this: DatabaseService<BaseModel>,
        data: { data?: BaseModel; props: DatabaseCommonInteractionProps },
      ): Promise<unknown> {
        writes.push({
          table: this.getModel().tableName || "",
          method: method,
          props: data.props,
        });
        return method === "create" ? data.data : 1;
      } as never);
  }

  jest
    .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
    .mockResolvedValue(FeedMarkdown.asMarkdown("[Checkout](https://x.test)"));
  jest
    .spyOn(
      ServiceLevelObjectiveFeedService,
      "createServiceLevelObjectiveFeedItem",
    )
    .mockResolvedValue(undefined);
});

async function run(
  ruleType: RuleRunType,
  props: DatabaseCommonInteractionProps,
): Promise<NextFunction> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("post", ROUTE).handlerFunction(
    {
      params: { ruleType: ruleType, ruleId: RULE_ID.toString() },
      body: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next,
  );

  return next;
}

// What the run changed: the page's resources, or the SLO.
function changes(table: string): Array<Write> {
  return writes.filter((write: Write): boolean => {
    return write.table === table;
  });
}

describe("a status page monitor rule's Run now, from the route to the writes", () => {
  test("adds and removes the page's resources on the behalf of the person who ran it", async () => {
    const next: NextFunction = await run(
      RuleRunType.StatusPageMonitorRule,
      person([Permission.EditStatusPageMonitorRule]),
    );

    expect(next).not.toHaveBeenCalled();
    expect(
      changes("StatusPageResource").map((write: Write): string => {
        return write.method;
      }),
    ).toEqual(["deleteOneById", "create"]);

    for (const write of changes("StatusPageResource")) {
      expect(write.props).toEqual(ON_THEIR_BEHALF);
    }

    const answered: JSONObject = (
      Response.sendJsonObjectResponse as unknown as AnyMock
    ).mock.calls[0]![2] as JSONObject;
    expect(answered["itemsAdded"]).toBe(1);
    expect(answered["itemsRemoved"]).toBe(1);
  });

  test("an API key that may run it is credited as the key", async () => {
    await run(RuleRunType.StatusPageMonitorRule, {
      tenantId: PROJECT_ID,
      userType: UserType.API,
      apiKeyId: KEY_ID,
      apiKeyName: "Terraform",
      userTenantAccessPermission: grantsOf([
        Permission.EditStatusPageMonitorRule,
      ]),
    });

    expect(changes("StatusPageResource")).toHaveLength(2);

    for (const write of changes("StatusPageResource")) {
      expect(write.props).toEqual({
        isRoot: true,
        userType: UserType.API,
        apiKeyId: KEY_ID,
        apiKeyName: "Terraform",
      });
    }
  });

  test.each([
    ["who may only read the rule", [Permission.ReadStatusPageMonitorRule], []],
    [
      "whose team blocks editing the rule",
      [Permission.EditStatusPageMonitorRule],
      [Permission.EditStatusPageMonitorRule],
    ],
    ["with no permission at all", [], []],
  ])(
    "a caller %s writes nothing",
    async (
      _name: string,
      permissions: Array<Permission>,
      blocked: Array<Permission>,
    ) => {
      const next: NextFunction = await run(
        RuleRunType.StatusPageMonitorRule,
        person(permissions, blocked),
      );

      expect((next as unknown as AnyMock).mock.calls).toHaveLength(1);
      expect(writes).toEqual([]);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );
});

describe("an SLO monitor rule's Run now, from the route to the writes", () => {
  test("attaches the SLO's monitors on the behalf of the person who ran it", async () => {
    const next: NextFunction = await run(
      RuleRunType.ServiceLevelObjectiveMonitorRule,
      person([Permission.EditServiceLevelObjectiveMonitorRule]),
    );

    expect(next).not.toHaveBeenCalled();
    expect(changes("ServiceLevelObjective")).toEqual([
      {
        table: "ServiceLevelObjective",
        method: "updateOneById",
        props: ON_THEIR_BEHALF,
      },
    ]);
  });

  test.each([
    // A project member may edit a status page's monitor rules, not an SLO's.
    ["a project member", [Permission.ProjectMember], []],
    [
      "whose team blocks editing the rule",
      [Permission.EditServiceLevelObjectiveMonitorRule],
      [Permission.EditServiceLevelObjectiveMonitorRule],
    ],
    [
      "who may only read the rule",
      [Permission.ReadServiceLevelObjectiveMonitorRule],
      [],
    ],
  ])(
    "a caller who is %s writes nothing",
    async (
      _name: string,
      permissions: Array<Permission>,
      blocked: Array<Permission>,
    ) => {
      const next: NextFunction = await run(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        person(permissions, blocked),
      );

      expect((next as unknown as AnyMock).mock.calls).toHaveLength(1);
      expect(writes).toEqual([]);
    },
  );

  test("an anonymous caller writes nothing", async () => {
    const next: NextFunction = await run(
      RuleRunType.ServiceLevelObjectiveMonitorRule,
      { tenantId: PROJECT_ID, userType: UserType.Public },
    );

    expect((next as unknown as AnyMock).mock.calls).toHaveLength(1);
    expect(writes).toEqual([]);
  });
});
