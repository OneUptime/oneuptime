import CodeFixRunAPI from "../../../Server/API/CodeFixRunAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
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
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Project from "../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * A task's run log (its Log page in Code, and the trail behind it) is the
 * task's repository's to show, as Code's own pages are: a run that works in
 * a repository the caller may not read - a team whose Read Code Repository
 * is limited by labels - answers "not found", like a run that does not
 * exist. A run with no repository is the project's, as before.
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

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const RUN_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");

// A member of the project, as getUserMiddleware leaves them.
const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      projectId: PROJECT_ID,
      permissions: [
        {
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
          _type: "UserPermission",
        },
      ],
      _type: "UserTenantAccessPermission",
    },
  },
};

let repositoryReadable: boolean;
let runRepositoryId: ObjectID | undefined;

async function read(
  route: string,
): Promise<{ next: jest.Mock; answered: boolean }> {
  const next: jest.Mock = jest.fn();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

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
  repositoryReadable = true;
  runRepositoryId = REPOSITORY_ID;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(PROPS);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(new Project());
  jest.spyOn(AIRunService, "findOneBy").mockImplementation(async () => {
    const run: AIRun = new AIRun();
    run._id = RUN_ID.toString();
    run.status = AIRunStatus.Completed;
    if (runRepositoryId) {
      run.codeRepositoryId = runRepositoryId;
    }
    return run;
  });
  jest
    .spyOn(CodeRepositoryService, "findOneBy")
    .mockImplementation(async () => {
      if (!repositoryReadable) {
        return null;
      }
      const repository: CodeRepository = new CodeRepository();
      repository._id = REPOSITORY_ID.toString();
      return repository;
    });
  jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
  jest.spyOn(LlmLogService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([["/code-fix-run/get/:runId"], ["/code-fix-run/logs/:runId"]])(
  "%s",
  (route: string) => {
    test("a run in a repository the caller may read is shown", async () => {
      const { next, answered } = await read(route);

      expect(next).not.toHaveBeenCalled();
      expect(answered).toBe(true);

      const call: {
        query: JSONObject;
        props: unknown;
      } = (CodeRepositoryService.findOneBy as unknown as jest.Mock).mock
        .calls[0]![0] as never;

      // The repository is read as the caller, in their project alone.
      expect(call.props).toEqual({ ...PROPS, isMultiTenantRequest: false });
      expect(call.query["_id"]).toBe(REPOSITORY_ID.toString());
      expect((call.query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
    });

    test("a run in a repository the caller may not read is not found, and nothing of it is read", async () => {
      repositoryReadable = false;

      const { next, answered } = await read(route);

      expect(answered).toBe(false);
      expect(next).toHaveBeenCalledTimes(1);

      const error: Error = next.mock.calls[0]![0] as Error;

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "Code fix run not found (or it does not belong to this project).",
      );
      expect(AIRunEventService.findBy).not.toHaveBeenCalled();
    });

    test("a run with no repository is the project's, as before", async () => {
      runRepositoryId = undefined;
      repositoryReadable = false;

      const { answered } = await read(route);

      expect(answered).toBe(true);
      expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
    });
  },
);
