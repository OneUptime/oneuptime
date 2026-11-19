import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import WorkflowService from "../../../Server/Services/WorkflowService";
import WorkflowVariableService from "../../../Server/Services/WorkflowVariableService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { WorkflowRunAs } from "../../../Types/Workflow/WorkflowRunAs";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A VARIABLE OF A WORKFLOW THAT RUNS AS MORE THAN DEFAULT IS THE
 * WORKFLOW'S (#9695): its steps read it, so it steers what they do with
 * the workflow's permissions. It is created, changed and deleted only by a
 * person who may change the workflow - who holds what it runs as - and
 * that person becomes the workflow's giver, as saving its steps makes
 * them. A variable of a workflow that runs as Default, and the project's
 * global variables, are held as before. Both tables are held in memory;
 * the services, their hooks and the permission checks are the real ones.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "98950000-0000-4000-8000-000000000001",
);
const DEFAULT_WORKFLOW_ID: string = "98950000-0000-4000-8000-0000000000f1";
const OWNER_WORKFLOW_ID: string = "98950000-0000-4000-8000-0000000000f2";
const DEFAULT_VARIABLE_ID: string = "98950000-0000-4000-8000-0000000000e1";
const OWNER_VARIABLE_ID: string = "98950000-0000-4000-8000-0000000000e2";
const GLOBAL_VARIABLE_ID: string = "98950000-0000-4000-8000-0000000000e3";
const FIRST_GIVER_ID: string = "98950000-0000-4000-8000-0000000000a1";

const OWNER_REFUSAL: string =
  "This variable belongs to a workflow that runs as Project Owner, so only Project Owners can change it.";

function member(
  permissions: Array<Permission>,
  userId: ObjectID = ObjectID.generate(),
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
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
    },
  };
}

const WORKFLOW_ADMIN: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return member([Permission.WorkflowAdmin]);
  };

const OWNER: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return member([Permission.ProjectOwner]);
  };

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("It was not refused.");
}

describe("a workflow's variables, by what it runs as", () => {
  let workflows: InMemoryTable;
  let variables: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});

    workflows = useInMemoryTable(WorkflowService, [
      {
        _id: DEFAULT_WORKFLOW_ID,
        projectId: PROJECT_ID.toString(),
        name: "Close stale incidents",
        slug: "close-stale-incidents",
        runAs: WorkflowRunAs.Default,
        version: 1,
      },
      {
        _id: OWNER_WORKFLOW_ID,
        projectId: PROJECT_ID.toString(),
        name: "Give new teams their role",
        slug: "give-new-teams-their-role",
        runAs: WorkflowRunAs.ProjectOwner,
        runAsGivenByUserId: FIRST_GIVER_ID,
        runAsGivenAt: new Date("2026-11-01T10:00:00.000Z"),
        version: 1,
      },
    ]);

    // Who gave a workflow its permissions is written without hooks.
    getJestSpyOn(
      WorkflowService,
      "updateColumnsByIdWithoutHooks",
    ).mockImplementation(
      async (write: { id: ObjectID; data: StoredRow }): Promise<void> => {
        Object.assign(workflows.get(write.id) || {}, write.data);
      },
    );

    variables = useInMemoryTable(WorkflowVariableService, [
      {
        _id: DEFAULT_VARIABLE_ID,
        projectId: PROJECT_ID.toString(),
        workflowId: DEFAULT_WORKFLOW_ID,
        name: "STALE_AFTER_DAYS",
        content: "7",
        isSecret: false,
        variableType: "Static",
        version: 1,
      },
      {
        _id: OWNER_VARIABLE_ID,
        projectId: PROJECT_ID.toString(),
        workflowId: OWNER_WORKFLOW_ID,
        name: "ROLE_ID",
        content: "role-of-new-teams",
        isSecret: false,
        variableType: "Static",
        version: 1,
      },
      {
        _id: GLOBAL_VARIABLE_ID,
        projectId: PROJECT_ID.toString(),
        workflowId: null,
        name: "SLACK_URL",
        content: "https://hooks.example.com/1",
        isSecret: false,
        variableType: "Static",
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function giverOf(workflowId: string): string {
    return String(
      workflows.get(workflowId)?.["runAsGivenByUserId"],
    ).toLowerCase();
  }

  async function createVariable(
    workflowId: string | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    const variable: WorkflowVariable = new WorkflowVariable();
    variable.projectId = PROJECT_ID;
    variable.name = `NEW_${Math.floor(Math.random() * 1_000_000)}`;
    variable.content = "value";

    if (workflowId) {
      variable.workflowId = new ObjectID(workflowId);
    }

    await WorkflowVariableService.create({ data: variable, props: props });
  }

  test("of a workflow that runs as Default: created, changed and deleted by a Workflow Admin, as before", async () => {
    await createVariable(DEFAULT_WORKFLOW_ID, WORKFLOW_ADMIN());

    await WorkflowVariableService.updateOneById({
      id: new ObjectID(DEFAULT_VARIABLE_ID),
      data: { content: "14" } as never,
      props: WORKFLOW_ADMIN(),
    });

    await WorkflowVariableService.deleteOneById({
      id: new ObjectID(DEFAULT_VARIABLE_ID),
      props: WORKFLOW_ADMIN(),
    });

    expect(variables.inserts).toHaveLength(1);
    expect(workflows.get(DEFAULT_WORKFLOW_ID)?.["runAsGivenByUserId"]).toBe(
      undefined,
    );
  });

  test("the project's global variables: as before, whatever any workflow runs as", async () => {
    await createVariable(null, WORKFLOW_ADMIN());

    await WorkflowVariableService.updateOneById({
      id: new ObjectID(GLOBAL_VARIABLE_ID),
      data: { content: "https://hooks.example.com/2" } as never,
      props: WORKFLOW_ADMIN(),
    });

    expect(variables.get(GLOBAL_VARIABLE_ID)?.["content"]).toBe(
      "https://hooks.example.com/2",
    );
  });

  test("of a workflow that runs as Project Owner: a Workflow Admin may not create, change or delete one", async () => {
    expect(
      (await refusal(createVariable(OWNER_WORKFLOW_ID, WORKFLOW_ADMIN())))
        .message,
    ).toBe(OWNER_REFUSAL);

    expect(
      (
        await refusal(
          WorkflowVariableService.updateOneById({
            id: new ObjectID(OWNER_VARIABLE_ID),
            data: { content: "role-of-the-owners" } as never,
            props: WORKFLOW_ADMIN(),
          }),
        )
      ).message,
    ).toBe(OWNER_REFUSAL);

    expect(
      (
        await refusal(
          WorkflowVariableService.deleteOneById({
            id: new ObjectID(OWNER_VARIABLE_ID),
            props: WORKFLOW_ADMIN(),
          }),
        )
      ).message,
    ).toBe(OWNER_REFUSAL);

    expect(variables.inserts).toEqual([]);
    expect(variables.get(OWNER_VARIABLE_ID)?.["content"]).toBe(
      "role-of-new-teams",
    );
    expect(variables.deletes).toEqual([]);
    expect(giverOf(OWNER_WORKFLOW_ID)).toBe(FIRST_GIVER_ID);
  });

  test("of a workflow that runs as Project Owner: a Project Owner changes one, and gives the workflow their permissions", async () => {
    const owner: DatabaseCommonInteractionProps = OWNER();

    await WorkflowVariableService.updateOneById({
      id: new ObjectID(OWNER_VARIABLE_ID),
      data: { content: "role-of-responders" } as never,
      props: owner,
    });

    expect(variables.get(OWNER_VARIABLE_ID)?.["content"]).toBe(
      "role-of-responders",
    );
    expect(giverOf(OWNER_WORKFLOW_ID)).toBe(
      owner.userId!.toString().toLowerCase(),
    );
  });

  test("of a workflow that runs as Project Owner: a Project Owner creates and deletes one, giving it their permissions each time", async () => {
    const creator: DatabaseCommonInteractionProps = OWNER();

    await createVariable(OWNER_WORKFLOW_ID, creator);

    expect(giverOf(OWNER_WORKFLOW_ID)).toBe(
      creator.userId!.toString().toLowerCase(),
    );

    const deleter: DatabaseCommonInteractionProps = OWNER();

    await WorkflowVariableService.deleteOneById({
      id: new ObjectID(OWNER_VARIABLE_ID),
      props: deleter,
    });

    expect(giverOf(OWNER_WORKFLOW_ID)).toBe(
      deleter.userId!.toString().toLowerCase(),
    );
  });
});
