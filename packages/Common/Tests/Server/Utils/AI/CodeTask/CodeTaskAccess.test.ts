import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import CodeTaskAccess, {
  CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE,
  CODE_TASK_REPOSITORY_SELECT,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import Label from "../../../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A task belongs to the repository it works in, so the repository decides:
 * reading a repository's tasks takes read access to it, under the caller's
 * own permissions; asking AI to work in it takes what changing it takes -
 * its update list, its labels and team blocks - as an edit is weighed. The
 * permission checks here are the real ones (ModelPermission); only the
 * repository rows are stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const USER_ID: ObjectID = new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
const BACKEND_LABEL_ID: ObjectID = new ObjectID(
  "8b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
);
const FRONTEND_LABEL_ID: ObjectID = new ObjectID(
  "9c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
);

function row(permission: Permission, labelIds: Array<ObjectID> = []): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds,
    isBlockPermission: false,
  } as UserPermission;
}

function callerWith(rows: Array<UserPermission>): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    currentPlan: PlanType.Scale,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  } as DatabaseCommonInteractionProps;
}

let repositoryLabels: Array<ObjectID>;
let repositoryProjectId: ObjectID;

function repository(): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value._id = REPOSITORY_ID.toString();
  value.projectId = repositoryProjectId;
  value.labels = repositoryLabels.map((id: ObjectID): Label => {
    const label: Label = new Label();
    label._id = id.toString();
    return label;
  });
  return value;
}

beforeEach(() => {
  repositoryLabels = [];
  repositoryProjectId = PROJECT_ID;

  // The root read of the repository's labels, for the edit check.
  jest
    .spyOn(CodeRepositoryService, "findOneById")
    .mockImplementation(async () => {
      return repository();
    });

  /*
   * The read of the repository through the query an edit is allowed on:
   * the row is there unless the query holds it to labels it does not carry.
   */
  jest
    .spyOn(CodeRepositoryService, "findOneBy")
    .mockImplementation(async () => {
      return repository();
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function canAsk(props: DatabaseCommonInteractionProps): Promise<boolean> {
  return await CodeTaskAccess.canAskInRepository({
    props,
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
  });
}

describe("who may ask AI to work in a repository", () => {
  test.each([
    ["a project owner", Permission.ProjectOwner],
    ["a project admin", Permission.ProjectAdmin],
    ["a project member", Permission.ProjectMember],
  ])("%s may", async (_who: string, permission: Permission) => {
    expect(await canAsk(callerWith([row(permission)]))).toBe(true);
  });

  test("a role that may read and edit code repositories may", async () => {
    expect(
      await canAsk(
        callerWith([
          row(Permission.ReadCodeRepository),
          row(Permission.EditCodeRepository),
        ]),
      ),
    ).toBe(true);
  });

  test("editing without reading is no edit, as everywhere in OneUptime", async () => {
    expect(
      await canAsk(callerWith([row(Permission.EditCodeRepository)])),
    ).toBe(false);
  });

  test.each([
    ["a viewer", Permission.Viewer],
    ["a role that may only read code repositories", Permission.ReadCodeRepository],
    ["a settings viewer", Permission.SettingsViewer],
  ])("%s may not: they read its tasks", async (_who: string, permission: Permission) => {
    expect(await canAsk(callerWith([row(permission)]))).toBe(false);
  });

  test("a role limited to labels the repository does not carry may not", async () => {
    repositoryLabels = [FRONTEND_LABEL_ID];

    expect(
      await canAsk(
        callerWith([
          row(Permission.ReadCodeRepository, [BACKEND_LABEL_ID]),
          row(Permission.EditCodeRepository, [BACKEND_LABEL_ID]),
        ]),
      ),
    ).toBe(false);
  });

  test("a role limited to a label the repository carries may", async () => {
    repositoryLabels = [BACKEND_LABEL_ID];

    expect(
      await canAsk(
        callerWith([
          row(Permission.ReadCodeRepository, [BACKEND_LABEL_ID]),
          row(Permission.EditCodeRepository, [BACKEND_LABEL_ID]),
        ]),
      ),
    ).toBe(true);
  });

  test("a repository of another project is never one to ask in", async () => {
    repositoryProjectId = OTHER_PROJECT_ID;

    expect(await canAsk(callerWith([row(Permission.ProjectOwner)]))).toBe(false);
  });

  test("a repository that is gone is never one to ask in", async () => {
    (CodeRepositoryService.findOneById as unknown as jest.Mock).mockImplementation(
      async () => {
        return null;
      },
    );

    expect(await canAsk(callerWith([row(Permission.ProjectOwner)]))).toBe(false);
  });

  test("the server and a master admin may", async () => {
    expect(await canAsk({ isRoot: true })).toBe(true);
    expect(
      await canAsk({
        userId: USER_ID,
        tenantId: PROJECT_ID,
        isMasterAdmin: true,
        userType: UserType.MasterAdmin,
      }),
    ).toBe(true);
  });

  test("a plan below the repositories' own is a refusal, not an error", async () => {
    jest
      .spyOn(ModelPermission, "checkUpdatePermissionByModel")
      .mockRejectedValue(
        new PaymentRequiredException("Code repositories need Growth."),
      );

    await expect(
      canAsk(callerWith([row(Permission.ProjectOwner)])),
    ).resolves.toBe(false);
  });

  test("anything else that goes wrong is not taken for a refusal", async () => {
    jest
      .spyOn(ModelPermission, "checkUpdatePermissionByModel")
      .mockRejectedValue(new Error("connection reset"));

    await expect(
      canAsk(callerWith([row(Permission.ProjectOwner)])),
    ).rejects.toThrow("connection reset");
  });
});

describe("who may read a repository's tasks", () => {
  test("the repository is read under the caller's own permissions, in this project", async () => {
    const props: DatabaseCommonInteractionProps = callerWith([
      row(Permission.Viewer),
    ]);

    const found: CodeRepository | null =
      await CodeTaskAccess.findReadableRepository({
        props,
        projectId: PROJECT_ID,
        repositoryId: REPOSITORY_ID,
      });

    expect(found?.id?.toString()).toBe(REPOSITORY_ID.toString());

    const call: {
      query: Record<string, unknown>;
      select: unknown;
      props: unknown;
    } = (CodeRepositoryService.findOneBy as unknown as jest.Mock).mock
      .calls[0]![0] as never;

    expect(call.props).toBe(props);
    expect(call.query["_id"]).toBe(REPOSITORY_ID.toString());
    expect((call.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(call.select).toBe(CODE_TASK_REPOSITORY_SELECT);
  });

  test("never asks for the GitHub installation id, which not every reader may read", () => {
    expect(
      (CODE_TASK_REPOSITORY_SELECT as Record<string, unknown>)[
        "gitHubAppInstallationId"
      ],
    ).toBeUndefined();
  });

  test("a repository the caller may not read is not found - the same answer as one that does not exist", async () => {
    (CodeRepositoryService.findOneBy as unknown as jest.Mock).mockImplementation(
      async () => {
        return null;
      },
    );

    await expect(
      CodeTaskAccess.getReadableRepository({
        props: callerWith([row(Permission.Viewer)]),
        projectId: PROJECT_ID,
        repositoryId: REPOSITORY_ID,
      }),
    ).rejects.toThrow(new NotFoundException(CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE));
  });

  test("tasks with no repository are read with the AI runs' own read permission", () => {
    const runReaders: Array<Permission> = new AIRun().getReadPermissions();

    expect(
      CodeTaskAccess.mayReadTasksWithoutRepository(
        callerWith([row(runReaders[0]!)]),
      ),
    ).toBe(true);
    expect(
      CodeTaskAccess.mayReadTasksWithoutRepository(
        callerWith([row(Permission.ReadCodeRepository)]),
      ),
    ).toBe(runReaders.includes(Permission.ReadCodeRepository));
    expect(CodeTaskAccess.mayReadTasksWithoutRepository({ isRoot: true })).toBe(
      true,
    );
  });
});
