import CodeFixRunAPI from "../../../Server/API/CodeFixRunAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Project from "../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * A CODE-FIX RUN IS READ ONLY BY A MEMBER OF ITS OWN PROJECT.
 *
 * The routes read a run, and its event trail, as root by the project the
 * request names (tenantid), once they have asked whether the caller may
 * read that project - by reading it with the caller's props. A request
 * that also carried is-multi-tenant-query had that read answered across
 * the caller's own projects, and for Project (whose tenant column is its
 * _id) "read project A" came back as one of them: someone outside A who
 * knew a run's id read A's run summary and its trail.
 *
 * The routes now require a member of the project named, and ask about it
 * in that project alone. Here ProjectService answers whatever it is asked,
 * as the read across projects did, so only the routes' own checks stand
 * between the caller and the run.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const TARGET_PROJECT_ID: ObjectID = new ObjectID(
  "8d1e0000-0000-4000-8000-0000000000a1",
);
const CALLERS_OWN_PROJECT_ID: ObjectID = new ObjectID(
  "8d1e0000-0000-4000-8000-0000000000b2",
);
const USER_ID: ObjectID = new ObjectID("8d1e0000-0000-4000-8000-000000000001");
const RUN_ID: ObjectID = new ObjectID("8d1e0000-0000-4000-8000-0000000000c3");

const ROUTES: Array<string> = [
  "/code-fix-run/get/:runId",
  "/code-fix-run/logs/:runId",
];

function memberships(
  projectIds: Array<ObjectID>,
): Record<string, UserTenantAccessPermission> {
  return Object.fromEntries(
    projectIds.map((projectId: ObjectID) => {
      return [
        projectId.toString(),
        {
          projectId: projectId,
          permissions: [
            {
              permission: Permission.ProjectOwner,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission" as const,
            },
          ],
          _type: "UserTenantAccessPermission" as const,
        },
      ];
    }),
  );
}

/*
 * What CommonAPI handed the routes before the request middleware refused
 * a request with both headers: the project the request named, and the
 * caller's own projects as the ones they hold permissions in.
 */
function outsiderAcrossProjects(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: TARGET_PROJECT_ID,
    isMultiTenantRequest: true,
    userGlobalAccessPermission: {
      projectIds: [CALLERS_OWN_PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.CurrentUser],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: memberships([CALLERS_OWN_PROJECT_ID]),
  };
}

async function callRoute(
  route: string,
  props: DatabaseCommonInteractionProps,
): Promise<{ next: jest.Mock; answered: boolean }> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const next: jest.Mock = jest.fn();

  await mockRouter.match("post", route).handlerFunction(
    {
      params: { runId: RUN_ID.toString() },
      body: {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    next,
    answered:
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock.calls
        .length > 0,
  };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new CodeFixRunAPI();
});

beforeEach(() => {
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  // Answers every read of a project, as the read across projects did.
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(new Project());
  jest.spyOn(AIRunService, "findOneBy").mockImplementation(async () => {
    const run: AIRun = new AIRun();
    run._id = RUN_ID.toString();
    run.status = AIRunStatus.Completed;
    return run;
  });
  jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
  jest.spyOn(LlmLogService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ROUTES)("%s", (route: string) => {
  test("someone outside the project, asking across their own projects, is refused before the project or the run is read", async () => {
    const { next, answered } = await callRoute(route, outsiderAcrossProjects());

    expect(answered).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(NotAuthorizedException);

    expect(ProjectService.findOneById).not.toHaveBeenCalled();
    expect(AIRunService.findOneBy).not.toHaveBeenCalled();
    expect(AIRunEventService.findBy).not.toHaveBeenCalled();
  });

  test("someone outside the project, in one project, is refused before anything is read", async () => {
    const { next, answered } = await callRoute(route, {
      ...outsiderAcrossProjects(),
      isMultiTenantRequest: false,
    });

    expect(answered).toBe(false);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(NotAuthorizedException);
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
    expect(AIRunService.findOneBy).not.toHaveBeenCalled();
  });

  test("a member's request across projects is asked about, and read in, the project it names alone", async () => {
    const props: DatabaseCommonInteractionProps = {
      ...outsiderAcrossProjects(),
      userTenantAccessPermission: memberships([
        CALLERS_OWN_PROJECT_ID,
        TARGET_PROJECT_ID,
      ]),
    };

    const { next, answered } = await callRoute(route, props);

    expect(next).not.toHaveBeenCalled();
    expect(answered).toBe(true);

    const projectRead: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = (ProjectService.findOneById as unknown as jest.Mock).mock
      .calls[0]![0] as never;

    expect(projectRead.id.toString()).toBe(TARGET_PROJECT_ID.toString());
    expect(projectRead.props.isMultiTenantRequest).toBe(false);
    expect(projectRead.props.tenantId?.toString()).toBe(
      TARGET_PROJECT_ID.toString(),
    );

    const runRead: { query: { projectId: ObjectID } } = (
      AIRunService.findOneBy as unknown as jest.Mock
    ).mock.calls[0]![0] as never;

    expect(runRead.query.projectId.toString()).toBe(
      TARGET_PROJECT_ID.toString(),
    );
  });
});
