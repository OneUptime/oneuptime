import StateChangeFollowOn from "../../../Server/Utils/StateChangeFollowOn";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";

/*
 * StateChangeFollowOn.getEventWriteProps: the props a saved state change
 * writes its own event with - its current state and what follows from it -
 * once the caller's create of the timeline row has passed its checks. They
 * are OneUptime's (root), named for the caller for the audit trail only,
 * and carry nothing that would make the write one sent to the event by the
 * caller.
 */

const PROJECT_ID: ObjectID = new ObjectID("6b000000-0000-4000-8000-000000000001");
const USER_ID: ObjectID = new ObjectID("6b000000-0000-4000-8000-000000000002");
const API_KEY_ID: ObjectID = new ObjectID("6b000000-0000-4000-8000-000000000003");
const GRANT_ID: ObjectID = new ObjectID("6b000000-0000-4000-8000-000000000004");
const WORKFLOW_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000005",
);

// A member changing the state from the Dashboard.
const MEMBER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      projectId: PROJECT_ID,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.CreateIncidentStateTimeline,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.All,
        },
      ],
    },
  },
  currentPlan: PlanType.Enterprise,
  isSubscriptionUnpaid: false,
};

describe("StateChangeFollowOn.getEventWriteProps", () => {
  test("is OneUptime's write, named for the person who changed the state", () => {
    expect(StateChangeFollowOn.getEventWriteProps(MEMBER)).toEqual({
      isRoot: true,
      userId: USER_ID,
      userType: UserType.User,
    });
  });

  test("carries no project, no permissions and no plan of the caller's: it is no write the caller sends to the event", () => {
    const props: DatabaseCommonInteractionProps =
      StateChangeFollowOn.getEventWriteProps(MEMBER);

    expect(props.tenantId).toBeUndefined();
    expect(props.userTenantAccessPermission).toBeUndefined();
    expect(props.userGlobalAccessPermission).toBeUndefined();
    expect(props.currentPlan).toBeUndefined();
    expect(props.isMasterAdmin).toBeUndefined();
    expect(props.ignoreHooks).toBeUndefined();
  });

  test("names the credential the change was made with: an API key", () => {
    expect(
      StateChangeFollowOn.getEventWriteProps({
        tenantId: PROJECT_ID,
        userType: UserType.API,
        apiKeyId: API_KEY_ID,
        apiKeyName: "Terraform",
      }),
    ).toEqual({
      isRoot: true,
      userType: UserType.API,
      apiKeyId: API_KEY_ID,
      apiKeyName: "Terraform",
    });
  });

  test("an MCP client acting for a member", () => {
    expect(
      StateChangeFollowOn.getEventWriteProps({
        ...MEMBER,
        mcpOAuthGrantId: GRANT_ID,
        mcpClientName: "Claude",
      }),
    ).toEqual({
      isRoot: true,
      userId: USER_ID,
      userType: UserType.User,
      mcpOAuthGrantId: GRANT_ID,
      mcpClientName: "Claude",
    });
  });

  test("a workflow step", () => {
    expect(
      StateChangeFollowOn.getEventWriteProps({
        tenantId: PROJECT_ID,
        userType: UserType.Workflow,
        workflowId: WORKFLOW_ID,
        workflowName: "Resolve on recovery",
      }),
    ).toEqual({
      isRoot: true,
      userType: UserType.Workflow,
      workflowId: WORKFLOW_ID,
      workflowName: "Resolve on recovery",
    });
  });

  test("OneUptime's own change stays OneUptime's", () => {
    expect(StateChangeFollowOn.getEventWriteProps({ isRoot: true })).toEqual({
      isRoot: true,
    });
  });

  test("a read-only credential's change never got this far, and the flag is not carried", () => {
    expect(
      StateChangeFollowOn.getEventWriteProps({
        ...MEMBER,
        isReadOnlyCredential: true,
      }).isReadOnlyCredential,
    ).toBeUndefined();
  });
});
