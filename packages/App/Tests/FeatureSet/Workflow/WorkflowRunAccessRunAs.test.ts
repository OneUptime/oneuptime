import WorkflowRunAccess, {
  WorkflowRunRequest,
} from "../../../FeatureSet/Workflow/Utils/WorkflowRunAccess";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowService from "Common/Server/Services/WorkflowService";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { WorkflowRunAs } from "Common/Types/Workflow/WorkflowRunAs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * RUNNING A WORKFLOW THAT RUNS AS MORE THAN DEFAULT BY HAND (#9695): the
 * whole of it, one step of it or again (WorkflowRunAccess) - only by a
 * person who holds what it runs as. A run by hand chooses what the
 * workflow starts with, and its steps act with the workflow's permissions:
 * a Workflow Member or an editor who holds less may not, and nor may a
 * master admin who is no Project Owner of the project. A workflow that
 * runs as Default is run by hand as before.
 *
 * The workflow is read as OneUptime; whether the caller may change it or
 * reach it is the update and read scope, which have tests of their own and
 * are answered "yes" here, so what is held is what it runs as.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aa950000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "aa950000-0000-4000-8000-000000000002",
);

const RUN_REFUSAL: string =
  "This workflow runs as Project Owner, so only Project Owners can run it by hand.";

function request(
  permissions: Array<Permission>,
  extra?: { isMasterAdmin?: boolean },
): WorkflowRunRequest {
  return {
    databaseProps: {
      userId: ObjectID.generate(),
      tenantId: PROJECT_ID,
      userType: extra?.isMasterAdmin ? UserType.MasterAdmin : UserType.User,
      isMasterAdmin: Boolean(extra?.isMasterAdmin),
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
    },
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
  };
}

// The workflow, of the project, as every read of it answers it.
function theWorkflow(runAs: WorkflowRunAs): void {
  const row: Workflow = new Workflow();
  row._id = WORKFLOW_ID.toString();
  row.projectId = PROJECT_ID;
  row.runAs = runAs;

  jest.spyOn(WorkflowService, "findOneById").mockResolvedValue(row as never);
  jest
    .spyOn(WorkflowService, "findOneUpdatableById")
    .mockResolvedValue(row as never);
}

async function refusal(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return err as Error;
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a workflow that runs as Default is run by hand as before", () => {
  test("by a Workflow Member, the whole of it; by an editor, one step of it", async () => {
    theWorkflow(WorkflowRunAs.Default);

    expect(
      await refusal(
        WorkflowRunAccess.assertMayRunWorkflow(
          request([Permission.WorkflowMember]),
        ),
      ),
    ).toBeNull();
    expect(
      await refusal(
        WorkflowRunAccess.assertMayRunStep(request([Permission.WorkflowAdmin])),
      ),
    ).toBeNull();
  });
});

describe("a workflow that runs as Project Owner", () => {
  test("is run by hand - the whole of it, or one step - by a Project Owner", async () => {
    theWorkflow(WorkflowRunAs.ProjectOwner);

    expect(
      await refusal(
        WorkflowRunAccess.assertMayRunWorkflow(
          request([Permission.ProjectOwner]),
        ),
      ),
    ).toBeNull();
    expect(
      await refusal(
        WorkflowRunAccess.assertMayRunStep(request([Permission.ProjectOwner])),
      ),
    ).toBeNull();
  });

  test("not by a Workflow Member, a Workflow Admin or a Project Admin, who are told who may", async () => {
    theWorkflow(WorkflowRunAs.ProjectOwner);

    for (const permissions of [
      [Permission.WorkflowMember],
      [Permission.WorkflowAdmin],
      [Permission.ProjectAdmin],
      [Permission.EditWorkflow, Permission.ReadWorkflow],
    ]) {
      const error: Error | null = await refusal(
        WorkflowRunAccess.assertMayRunWorkflow(request(permissions)),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toBe(RUN_REFUSAL);
    }

    const stepError: Error | null = await refusal(
      WorkflowRunAccess.assertMayRunStep(request([Permission.WorkflowAdmin])),
    );

    expect(stepError?.message).toBe(RUN_REFUSAL);
  });

  test("not by a master admin who is no Project Owner of the project: the pass reaches every check but this one", async () => {
    theWorkflow(WorkflowRunAs.ProjectOwner);

    const error: Error | null = await refusal(
      WorkflowRunAccess.assertMayRunWorkflow(
        request([], { isMasterAdmin: true }),
      ),
    );

    expect(error?.message).toBe(RUN_REFUSAL);
    expect(
      await refusal(
        WorkflowRunAccess.assertMayRunWorkflow(
          request([Permission.ProjectOwner], { isMasterAdmin: true }),
        ),
      ),
    ).toBeNull();
  });
});
