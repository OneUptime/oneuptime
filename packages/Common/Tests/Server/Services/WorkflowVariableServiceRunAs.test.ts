import Workflow from "../../../Models/DatabaseModels/Workflow";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import WorkflowService from "../../../Server/Services/WorkflowService";
import WorkflowVariableService from "../../../Server/Services/WorkflowVariableService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
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

  test("of a workflow that runs as Project Owner: an API key holding Project Owner changes one, and the key gives the workflow its permissions (#9765)", async () => {
    const keyId: ObjectID = ObjectID.generate();

    await WorkflowVariableService.updateOneById({
      id: new ObjectID(OWNER_VARIABLE_ID),
      data: { content: "role-of-responders" } as never,
      props: apiKey([Permission.ProjectOwner], keyId),
    });

    expect(variables.get(OWNER_VARIABLE_ID)?.["content"]).toBe(
      "role-of-responders",
    );
    expect(
      String(
        workflows.get(OWNER_WORKFLOW_ID)?.["runAsGivenByApiKeyId"],
      ).toLowerCase(),
    ).toBe(keyId.toString().toLowerCase());
    expect(workflows.get(OWNER_WORKFLOW_ID)?.["runAsGivenByUserId"]).toBeNull();
  });

  test("of a workflow that runs as Project Owner: an API key holding less may not create, change or delete one", async () => {
    const key: DatabaseCommonInteractionProps = apiKey([
      Permission.WorkflowAdmin,
      Permission.ProjectAdmin,
    ]);

    expect(
      (await refusal(createVariable(OWNER_WORKFLOW_ID, key))).message,
    ).toBe(OWNER_REFUSAL);
    expect(
      (
        await refusal(
          WorkflowVariableService.updateOneById({
            id: new ObjectID(OWNER_VARIABLE_ID),
            data: { content: "role-of-the-owners" } as never,
            props: key,
          }),
        )
      ).message,
    ).toBe(OWNER_REFUSAL);
    expect(
      (
        await refusal(
          WorkflowVariableService.deleteOneById({
            id: new ObjectID(OWNER_VARIABLE_ID),
            props: key,
          }),
        )
      ).message,
    ).toBe(OWNER_REFUSAL);

    expect(variables.get(OWNER_VARIABLE_ID)?.["content"]).toBe(
      "role-of-new-teams",
    );
    expect(giverOf(OWNER_WORKFLOW_ID)).toBe(FIRST_GIVER_ID);
  });

  /*
   * A variable names its workflow under its ID column or its relation
   * (RelationIdUtil, ReferenceNamesReadTogether), and the check reads both:
   * a create that names the workflow by the relation alone, whatever handed
   * the hook the write, is held to the workflow's holders as well.
   */
  describe("the workflow, named either way", () => {
    function variableOf(workflow: {
      workflowId?: string;
      workflow?: string;
    }): WorkflowVariable {
      const variable: WorkflowVariable = new WorkflowVariable();
      variable.projectId = PROJECT_ID;
      variable.name = `NEW_${Math.floor(Math.random() * 1_000_000)}`;
      variable.content = "value";

      if (workflow.workflowId) {
        variable.workflowId = new ObjectID(workflow.workflowId);
      }

      if (workflow.workflow) {
        variable.workflow = new Workflow(new ObjectID(workflow.workflow));
      }

      return variable;
    }

    // The hook as DatabaseService runs it once the create may be made.
    async function createPermitted(
      variable: WorkflowVariable,
      props: DatabaseCommonInteractionProps,
    ): Promise<OnCreate<WorkflowVariable>> {
      const onCreate: OnCreate<WorkflowVariable> = {
        createBy: { data: variable, props: props },
        carryForward: null,
      };

      await (
        WorkflowVariableService as unknown as {
          onCreatePermitted: (
            onCreate: OnCreate<WorkflowVariable>,
          ) => Promise<void>;
        }
      ).onCreatePermitted(onCreate);

      return onCreate;
    }

    test("named by the relation alone, a raised workflow's variable is refused to a Workflow Admin, as one named by its ID is", async () => {
      expect(
        (
          await refusal(
            createPermitted(
              variableOf({ workflow: OWNER_WORKFLOW_ID }),
              WORKFLOW_ADMIN(),
            ),
          )
        ).message,
      ).toBe(OWNER_REFUSAL);
    });

    test("named by the relation alone, a Project Owner's create carries the workflow forward, to make them its giver", async () => {
      const onCreate: OnCreate<WorkflowVariable> = await createPermitted(
        variableOf({ workflow: OWNER_WORKFLOW_ID }),
        OWNER(),
      );

      expect(
        (onCreate.carryForward as Array<ObjectID>).map(
          (id: ObjectID): string => {
            return id.toString().toLowerCase();
          },
        ),
      ).toEqual([OWNER_WORKFLOW_ID]);
    });

    test("through the whole create, a variable named by the relation is refused to a Workflow Admin, and nothing is saved", async () => {
      expect(
        (
          await refusal(
            WorkflowVariableService.create({
              data: variableOf({ workflow: OWNER_WORKFLOW_ID }),
              props: WORKFLOW_ADMIN(),
            }),
          )
        ).message,
      ).toBe(OWNER_REFUSAL);
      expect(variables.inserts).toEqual([]);
    });

    test("two names that disagree are refused before anything is checked or saved", async () => {
      const error: Error = await refusal(
        createPermitted(
          variableOf({
            workflowId: DEFAULT_WORKFLOW_ID,
            workflow: OWNER_WORKFLOW_ID,
          }),
          OWNER(),
        ),
      );

      expect(error.message).toBe(
        "Conflicting Workflow references were provided. workflowId and workflow are names for the same field and must hold the same value: send only one of them, or the same id in each.",
      );
      expect(variables.inserts).toEqual([]);
    });
  });
});

// An API key of the project holding `permissions` (#9765).
function apiKey(
  permissions: Array<Permission>,
  apiKeyId: ObjectID = ObjectID.generate(),
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userType: UserType.API,
    apiKeyId: apiKeyId,
    apiKeyName: "Terraform",
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
