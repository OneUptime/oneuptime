import WorkflowRunAccess, {
  WorkflowRunRequest,
} from "../../../FeatureSet/Workflow/Utils/WorkflowRunAccess";
import BillingPermissions from "Common/Server/Types/Database/Permissions/BillingPermission";
import TablePermission from "Common/Server/Types/Database/Permissions/TablePermission";
import DatabaseRequestType from "Common/Server/Types/BaseDatabase/DatabaseRequestType";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { WORKFLOW_RUN_ONLY_PERMISSIONS } from "Common/Types/Workflow/WorkflowRunPermissions";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WorkflowRunAccess.propsHoldingOnly: the caller's props with only their
 * rows of some permissions, which the manual run reads a workflow with to
 * ask whether the caller's Workflow Member grant - and no other - reaches
 * it. A Viewer row would otherwise widen a Workflow Member limited to some
 * labels to every workflow they can see.
 */

const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const teamId: ObjectID = ObjectID.generate();
const labelId: ObjectID = ObjectID.generate();

function row(
  permission: Permission,
  options?: { isBlock?: boolean; labelIds?: Array<ObjectID> },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelIds || [],
    isBlockPermission: Boolean(options?.isBlock),
  };
}

function request(rows: Array<UserPermission>): WorkflowRunRequest {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: rows,
  };

  const other: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: otherProjectId,
    permissions: [row(Permission.ProjectOwner)],
  };

  return {
    databaseProps: {
      userId: userId,
      tenantId: projectId,
      userType: UserType.User,
      userTeamIds: [teamId],
      userTenantAccessPermission: {
        [projectId.toString()]: tenant,
        [otherProjectId.toString()]: other,
      },
    },
    projectId: projectId,
    workflowId: ObjectID.generate(),
  };
}

function rowsOf(props: DatabaseCommonInteractionProps): Array<UserPermission> {
  return (
    props.userTenantAccessPermission?.[projectId.toString()]?.permissions || []
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkflowRunAccess.propsHoldingOnly", () => {
  test("keeps only the rows of the permissions asked for, allows and blocks alike", () => {
    const input: WorkflowRunRequest = request([
      row(Permission.Viewer),
      row(Permission.WorkflowMember, { labelIds: [labelId] }),
      row(Permission.WorkflowMember, { isBlock: true, labelIds: [labelId] }),
      row(Permission.ReadAllOperationalResources),
      row(Permission.ProjectUser),
    ]);

    const rows: Array<UserPermission> = rowsOf(
      WorkflowRunAccess.propsHoldingOnly(input, WORKFLOW_RUN_ONLY_PERMISSIONS),
    );

    expect(
      rows.map((candidate: UserPermission) => {
        return [
          candidate.permission,
          Boolean(candidate.isBlockPermission),
          candidate.labelIds.map((id: ObjectID) => {
            return id.toString();
          }),
        ];
      }),
    ).toEqual([
      [Permission.WorkflowMember, false, [labelId.toString()]],
      [Permission.WorkflowMember, true, [labelId.toString()]],
    ]);
  });

  test("holds none of the caller's global permissions: the read adds back the ones everybody holds", () => {
    const input: WorkflowRunRequest = request([row(Permission.WorkflowMember)]);

    input.databaseProps.userGlobalAccessPermission = {
      _type: "UserGlobalAccessPermission",
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [projectId, otherProjectId],
    };

    const props: DatabaseCommonInteractionProps =
      WorkflowRunAccess.propsHoldingOnly(input, WORKFLOW_RUN_ONLY_PERMISSIONS);

    expect(props.userGlobalAccessPermission?.globalPermissions).toEqual([]);
    expect(
      props.userGlobalAccessPermission?.projectIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([projectId.toString()]);
  });

  test("keeps who the caller is: user, project, teams, kind", () => {
    const input: WorkflowRunRequest = request([row(Permission.WorkflowMember)]);

    const props: DatabaseCommonInteractionProps =
      WorkflowRunAccess.propsHoldingOnly(input, WORKFLOW_RUN_ONLY_PERMISSIONS);

    expect(props.userId?.toString()).toBe(userId.toString());
    expect(props.tenantId?.toString()).toBe(projectId.toString());
    expect(props.userType).toBe(UserType.User);
    expect(
      props.userTeamIds?.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([teamId.toString()]);
    expect(props.isRoot).toBeFalsy();
  });

  // Another project's grants have nothing to do with this project's workflow.
  test("drops every other project's permissions", () => {
    const props: DatabaseCommonInteractionProps =
      WorkflowRunAccess.propsHoldingOnly(
        request([row(Permission.WorkflowMember)]),
        WORKFLOW_RUN_ONLY_PERMISSIONS,
      );

    expect(Object.keys(props.userTenantAccessPermission || {})).toEqual([
      projectId.toString(),
    ]);
  });

  test("leaves the caller's own props as they were", () => {
    const input: WorkflowRunRequest = request([
      row(Permission.Viewer),
      row(Permission.WorkflowMember),
    ]);

    WorkflowRunAccess.propsHoldingOnly(input, WORKFLOW_RUN_ONLY_PERMISSIONS);

    expect(rowsOf(input.databaseProps)).toHaveLength(2);
    expect(
      Object.keys(input.databaseProps.userTenantAccessPermission!),
    ).toEqual([projectId.toString(), otherProjectId.toString()]);
  });

  test("a caller with no rows in the project gets none", () => {
    const input: WorkflowRunRequest = request([]);

    delete input.databaseProps.userTenantAccessPermission![
      projectId.toString()
    ];

    expect(
      rowsOf(
        WorkflowRunAccess.propsHoldingOnly(
          input,
          WORKFLOW_RUN_ONLY_PERMISSIONS,
        ),
      ),
    ).toEqual([]);
  });

  /*
   * What the narrowed props are for: a read of the workflow that the
   * Workflow Member grant passes - it is on the Workflow's read list - and
   * that nothing else in the caller's hand can pass for them.
   */
  test("the narrowed props pass the workflow's read check on the Workflow Member grant, and only on it", () => {
    jest
      .spyOn(BillingPermissions, "checkBillingPermissions")
      .mockImplementation((): void => {
        return undefined;
      });

    const member: DatabaseCommonInteractionProps =
      WorkflowRunAccess.propsHoldingOnly(
        request([row(Permission.Viewer), row(Permission.WorkflowMember)]),
        WORKFLOW_RUN_ONLY_PERMISSIONS,
      );

    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Workflow,
        member,
        DatabaseRequestType.Read,
      );
    }).not.toThrow();

    // A Viewer alone is let into nothing once narrowed: no run grant, no read.
    const viewer: DatabaseCommonInteractionProps =
      WorkflowRunAccess.propsHoldingOnly(
        request([row(Permission.Viewer)]),
        WORKFLOW_RUN_ONLY_PERMISSIONS,
      );

    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Workflow,
        viewer,
        DatabaseRequestType.Read,
      );
    }).toThrow();
  });
});
