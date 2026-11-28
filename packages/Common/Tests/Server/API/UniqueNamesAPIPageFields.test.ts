import CommonAPI from "../../../Server/API/CommonAPI";
import "../../../Server/API/UniqueNamesAPI";
import MonitorService from "../../../Server/Services/MonitorService";
import OpenStackBudgetService from "../../../Server/Services/OpenStackBudgetService";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import RequiredUniqueNames from "../../../Server/Utils/Database/RequiredUniqueNames";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import OpenStackBudget from "../../../Models/DatabaseModels/OpenStackBudget";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import {
  DuplicateNamesOfKind,
  UNIQUE_NAME_CHECK_ROUTE,
  UNIQUE_NAME_DUPLICATES_ROUTE,
  UniqueNameCheckAnswer,
} from "../../../Types/Database/RequiredUniqueNames";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE RECORDS GET /unique-names/check AND /unique-names/duplicates NAME,
 * WITH WHAT THEIR PAGES NEED (#11020).
 *
 * An OpenStack budget opens under its cloud, a workspace summary under its
 * workspace's page: each record the routes name carries what its page's
 * address needs (pageFields), read with the caller's own props - a cloud's
 * id only when the caller may read that cloud. A kind whose page needs
 * only its id carries nothing, and nothing more is read for it.
 */

jest.mock("../../../Server/Utils/Express", () => {
  const helpers: typeof import("./Helpers") =
    jest.requireActual<typeof import("./Helpers")>("./Helpers");

  return {
    getRouter: () => {
      return helpers.mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

// The registry the routes walk: the two kinds opened under another, a monitor, and the budgets' clouds.
jest.mock("../../../Server/Services/Index", () => {
  return {
    __esModule: true,
    default: [
      jest.requireActual<{ default: unknown }>(
        "../../../Server/Services/OpenStackBudgetService",
      ).default,
      jest.requireActual<{ default: unknown }>(
        "../../../Server/Services/WorkspaceNotificationSummaryService",
      ).default,
      jest.requireActual<{ default: unknown }>(
        "../../../Server/Services/MonitorService",
      ).default,
      jest.requireActual<{ default: unknown }>(
        "../../../Server/Services/OpenStackCloudService",
      ).default,
    ],
  };
});

const BUDGET: string = "b0000000-0000-4000-8000-000000011020";
const HIDDEN_CLOUD_BUDGET: string = "b1111111-0000-4000-8000-000000011020";
const CLOUD: string = "c0000000-0000-4000-8000-000000011020";
const HIDDEN_CLOUD: string = "c1111111-0000-4000-8000-000000011020";
const SUMMARY: string = "50000000-0000-4000-8000-000000011020";
const MONITOR: string = "70000000-0000-4000-8000-000000011020";

let projectId: ObjectID;
let userId: ObjectID;

function buildProps(): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {
    [projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: [Permission.ProjectMember].map(
        (permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        },
      ),
    },
  };

  return {
    tenantId: projectId,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  } as DatabaseCommonInteractionProps;
}

async function callRoute(
  route: string,
  query: Record<string, unknown> = {},
): Promise<unknown> {
  const req: ExpressRequest = {
    params: {},
    query: query,
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("GET", route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return next.mock.calls[0] ? next.mock.calls[0][0] : undefined;
}

function answered(): JSONObject {
  return (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
    .calls[0]![2] as JSONObject;
}

interface RecordedFind {
  props: DatabaseCommonInteractionProps;
}

function stubFind<T>(service: unknown, records: Array<T>): Array<RecordedFind> {
  const finds: Array<RecordedFind> = [];

  jest
    .spyOn(service as typeof MonitorService, "findBy")
    .mockImplementation((async (findBy: RecordedFind): Promise<Array<T>> => {
      finds.push(findBy);
      return records;
    }) as never);

  return finds;
}

function budget(id: string, cloudId: string): OpenStackBudget {
  const model: OpenStackBudget = new OpenStackBudget(new ObjectID(id));
  model.openStackCloudId = new ObjectID(cloudId);
  return model;
}

beforeEach(() => {
  jest.clearAllMocks();
  projectId = ObjectID.generate();
  userId = ObjectID.generate();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(buildProps());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /unique-names/check names the record that has the name with what its page needs", () => {
  function holder(id: string, name: string): UniqueNameCheckAnswer {
    return {
      isRequired: true,
      takenBy: { id: id, name: name, isArchived: false },
      isTakenByUnreadable: false,
    };
  }

  test("an OpenStack budget, with its cloud's id: the reader may read that cloud", async () => {
    jest
      .spyOn(RequiredUniqueNames, "checkName")
      .mockResolvedValue(holder(BUDGET, "Compute"));
    const budgetFinds: Array<RecordedFind> = stubFind(OpenStackBudgetService, [
      budget(BUDGET, CLOUD),
    ]);
    const cloudFinds: Array<RecordedFind> = stubFind(OpenStackCloudService, [
      new OpenStackCloud(new ObjectID(CLOUD)),
    ]);

    expect(
      await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
        tableName: "OpenStackBudget",
        name: "compute",
      }),
    ).toBeUndefined();

    expect(answered()).toEqual({
      isRequired: true,
      takenBy: {
        id: BUDGET,
        name: "Compute",
        isArchived: false,
        pageFields: { openStackCloudId: CLOUD },
      },
      isTakenByUnreadable: false,
    });

    // Read with the caller's own props, never as root.
    for (const find of [...budgetFinds, ...cloudFinds]) {
      expect(find.props.userId?.toString()).toBe(userId.toString());
      expect(find.props.isRoot).toBeFalsy();
    }
  });

  test("a budget whose cloud the reader may not read is named without what would open it", async () => {
    jest
      .spyOn(RequiredUniqueNames, "checkName")
      .mockResolvedValue(holder(BUDGET, "Compute"));
    stubFind(OpenStackBudgetService, [budget(BUDGET, HIDDEN_CLOUD)]);
    stubFind(OpenStackCloudService, []);

    await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "OpenStackBudget",
      name: "compute",
    });

    expect(answered()).toEqual({
      isRequired: true,
      takenBy: { id: BUDGET, name: "Compute", isArchived: false },
      isTakenByUnreadable: false,
    });
    expect(JSON.stringify(answered())).not.toContain(HIDDEN_CLOUD);
  });

  test("a workspace summary, with its workspace and its type", async () => {
    jest
      .spyOn(RequiredUniqueNames, "checkName")
      .mockResolvedValue(holder(SUMMARY, "Morning"));
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary(new ObjectID(SUMMARY));
    summary.workspaceType = WorkspaceType.Slack;
    summary.summaryType = WorkspaceNotificationSummaryType.Incident;
    stubFind(WorkspaceNotificationSummaryService, [summary]);

    await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "WorkspaceNotificationSummary",
      name: "morning",
    });

    expect(
      (answered()["takenBy"] as JSONObject)["pageFields"] as JSONObject,
    ).toEqual({ workspaceType: "Slack", summaryType: "Incident" });
  });

  test("a kind whose page needs only its id carries nothing, and nothing more is read", async () => {
    jest
      .spyOn(RequiredUniqueNames, "checkName")
      .mockResolvedValue(holder(MONITOR, "API"));
    const finds: Array<RecordedFind> = stubFind(MonitorService, []);

    await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "Monitor",
      name: "api",
    });

    expect(answered()["takenBy"]).toEqual({
      id: MONITOR,
      name: "API",
      isArchived: false,
    });
    expect(finds).toHaveLength(0);
  });

  test("a name nobody the reader may read has: nothing to link, and nothing more is read", async () => {
    jest.spyOn(RequiredUniqueNames, "checkName").mockResolvedValue({
      isRequired: true,
      takenBy: null,
      isTakenByUnreadable: true,
    });
    const finds: Array<RecordedFind> = stubFind(OpenStackBudgetService, []);

    await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "OpenStackBudget",
      name: "compute",
    });

    expect(answered()).toEqual({
      isRequired: true,
      takenBy: null,
      isTakenByUnreadable: true,
    });
    expect(finds).toHaveLength(0);
  });
});

describe("GET /unique-names/duplicates lists each record with what its page needs", () => {
  const BUDGETS: DuplicateNamesOfKind = {
    tableName: "OpenStackBudget",
    pluralName: "OpenStack Budgets",
    groupCount: 1,
    groups: [
      {
        name: "Compute",
        count: 2,
        records: [
          { id: BUDGET, name: "Compute", createdAt: null, isArchived: false },
          {
            id: HIDDEN_CLOUD_BUDGET,
            name: "compute",
            createdAt: null,
            isArchived: false,
          },
        ],
      },
    ],
  };

  test("a budget whose cloud the reader may read is linked; one whose cloud they may not, is not", async () => {
    jest
      .spyOn(RequiredUniqueNames, "findDuplicatesOfKind")
      .mockImplementation((async (data: {
        service: unknown;
      }): Promise<DuplicateNamesOfKind | null> => {
        return data.service === OpenStackBudgetService ? BUDGETS : null;
      }) as never);
    jest
      .spyOn(RequiredUniqueNames, "isRequiredInProject")
      .mockResolvedValue(true);
    stubFind(OpenStackBudgetService, [
      budget(BUDGET, CLOUD),
      budget(HIDDEN_CLOUD_BUDGET, HIDDEN_CLOUD),
    ]);
    stubFind(OpenStackCloudService, [new OpenStackCloud(new ObjectID(CLOUD))]);

    expect(await callRoute(UNIQUE_NAME_DUPLICATES_ROUTE)).toBeUndefined();

    expect(answered()).toEqual({
      requireUniqueNames: true,
      kinds: [
        {
          tableName: "OpenStackBudget",
          pluralName: "OpenStack Budgets",
          groupCount: 1,
          groups: [
            {
              name: "Compute",
              count: 2,
              records: [
                {
                  id: BUDGET,
                  name: "Compute",
                  createdAt: null,
                  isArchived: false,
                  pageFields: { openStackCloudId: CLOUD },
                },
                {
                  id: HIDDEN_CLOUD_BUDGET,
                  name: "compute",
                  createdAt: null,
                  isArchived: false,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(answered())).not.toContain(HIDDEN_CLOUD);
  });

  test("a kind whose page needs only its id is listed as it was, and nothing more is read", async () => {
    const MONITORS: DuplicateNamesOfKind = {
      tableName: "Monitor",
      pluralName: "Monitors",
      groupCount: 1,
      groups: [
        {
          name: "API",
          count: 2,
          records: [
            { id: MONITOR, name: "API", createdAt: null, isArchived: false },
            {
              id: "71111111-0000-4000-8000-000000011020",
              name: "api",
              createdAt: null,
              isArchived: false,
            },
          ],
        },
      ],
    };

    jest
      .spyOn(RequiredUniqueNames, "findDuplicatesOfKind")
      .mockImplementation((async (data: {
        service: unknown;
      }): Promise<DuplicateNamesOfKind | null> => {
        return data.service === MonitorService ? MONITORS : null;
      }) as never);
    jest
      .spyOn(RequiredUniqueNames, "isRequiredInProject")
      .mockResolvedValue(false);
    const finds: Array<RecordedFind> = stubFind(MonitorService, []);

    await callRoute(UNIQUE_NAME_DUPLICATES_ROUTE);

    expect((answered()["kinds"] as Array<JSONObject>)[0]).toEqual(MONITORS);
    expect(finds).toHaveLength(0);
  });
});
