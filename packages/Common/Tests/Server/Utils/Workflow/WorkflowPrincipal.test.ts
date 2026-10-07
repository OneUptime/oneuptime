import ProjectService from "../../../../Server/Services/ProjectService";
import PublicPermission from "../../../../Server/Types/Database/Permissions/PublicPermission";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../../Server/Types/Database/Permissions/TablePermission";
import RelatedFileAccess, {
  RelatedFileReader,
} from "../../../../Server/Utils/File/RelatedFileAccess";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import Incident from "../../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT A WORKFLOW STEP ACTS AS (WorkflowPrincipal).
 *
 * A step of a workflow reads and writes its project's records as a Project
 * Admin of that project, on the project's plan, and as no person. These pin
 * the props it is handed:
 *
 *   - the workflow's own project, and nothing else, is the tenant;
 *   - its permissions are a Project Admin's and no more: no owner, billing or
 *     delete-project permission, and no block rows of anyone's;
 *   - it is no person - no userId, never root, never a server admin - yet
 *     signed in, like an API key;
 *   - it carries the project's plan on a server with billing, read through
 *     ProjectService, and nothing is read without billing;
 *   - it names the workflow, for the audit trail;
 *   - each step gets a fresh object, so nothing one step hands down reaches
 *     the next.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000002",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000003",
);

let getCurrentPlan: SpyInstance<typeof ProjectService.getCurrentPlan>;

function heldBy(props: DatabaseCommonInteractionProps): HeldPermissions {
  return HeldPermissionsUtil.fromRows({
    rows: DatabaseCommonInteractionPropsUtil.getPermissionRows(props),
  });
}

function principal(): DatabaseCommonInteractionProps {
  return WorkflowPrincipal.getPropsWithoutPlan({
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
    workflowName: "Close stale incidents",
  });
}

beforeEach(() => {
  setTestBillingEnabled(false);
  getCurrentPlan = jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue({ plan: PlanType.Growth, isSubscriptionUnpaid: false });
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("the project", () => {
  test("is the workflow's own, and the only one the props reach", () => {
    const props: DatabaseCommonInteractionProps = principal();

    expect(props.tenantId).toBe(PROJECT_ID);
    expect(props.isMultiTenantRequest).toBeFalsy();
    expect(
      Object.keys(props.userTenantAccessPermission || {}).map(
        (projectId: string): string => {
          return projectId.toLowerCase();
        },
      ),
    ).toEqual([PROJECT_ID.toString().toLowerCase()]);
    expect(
      (props.userGlobalAccessPermission?.projectIds || []).map(
        (projectId: ObjectID): string => {
          return projectId.toString();
        },
      ),
    ).toEqual([PROJECT_ID.toString()]);
  });

  test("holds nothing in any other project", () => {
    const props: DatabaseCommonInteractionProps = {
      ...principal(),
      tenantId: OTHER_PROJECT_ID,
    };

    expect(
      HeldPermissionsUtil.isGrantedAny(heldBy(props), [
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ProjectOwner,
      ]),
    ).toBe(false);
  });
});

describe("the permissions", () => {
  test("are a Project Admin's", () => {
    const held: HeldPermissions = heldBy(principal());

    expect(
      HeldPermissionsUtil.isGrantedAny(held, [Permission.ProjectAdmin]),
    ).toBe(true);
    expect(
      HeldPermissionsUtil.isGrantedAny(held, [Permission.ProjectUser]),
    ).toBe(true);
    expect(WorkflowPrincipal.PERMISSION).toBe(Permission.ProjectAdmin);
  });

  test("and no more: no owner, billing or delete-project permission", () => {
    const held: HeldPermissions = heldBy(principal());

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
      Permission.DeleteProject,
      Permission.BillingAdmin,
    ]) {
      expect(HeldPermissionsUtil.isGrantedAny(held, [permission])).toBe(false);
    }
  });

  test("the project-wide grant has no labels, and there are no block rows", () => {
    const props: DatabaseCommonInteractionProps = principal();
    const rows: Array<UserPermission> =
      props.userTenantAccessPermission![PROJECT_ID.toString()]!.permissions;

    const admin: UserPermission | undefined = rows.find(
      (row: UserPermission): boolean => {
        return row.permission === Permission.ProjectAdmin;
      },
    );

    expect(admin).toBeDefined();
    expect(admin!.labelIds).toEqual([]);
    expect(admin!.isBlockPermission).toBe(false);
    expect(
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      ),
    ).toEqual([]);
  });

  test("let it create an incident, which every Project Admin may", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Incident,
        principal(),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });
});

describe("the principal", () => {
  test("is no person, never root and never a server admin", () => {
    const props: DatabaseCommonInteractionProps = principal();

    expect(props.userId).toBeUndefined();
    expect(props.isRoot).toBeFalsy();
    expect(props.isMasterAdmin).toBeFalsy();
    expect(props.userType).toBe(UserType.Workflow);
    expect(WorkflowPrincipal.isWorkflow(props)).toBe(true);
    expect(WorkflowPrincipal.isWorkflow({ isRoot: true })).toBe(false);
  });

  test("is signed in, as an API key is, though it is no person", () => {
    const props: DatabaseCommonInteractionProps = principal();

    expect(DatabaseCommonInteractionPropsUtil.isAnonymous(props)).toBe(false);
    expect(
      DatabaseCommonInteractionPropsUtil.isProjectPrincipalWithoutPerson(props),
    ).toBe(true);
    expect(() => {
      PublicPermission.checkIfUserIsLoggedIn(
        Incident,
        props,
        DatabaseRequestType.Read,
      );
    }).not.toThrow();
  });

  test("reads the files its project may see, as any caller does", () => {
    const reader: RelatedFileReader | null =
      RelatedFileAccess.getReader(principal());

    expect(reader).not.toBeNull();
    expect(
      reader!.projectIds.map((projectId: ObjectID | string): string => {
        return projectId.toString().toLowerCase();
      }),
    ).toEqual([PROJECT_ID.toString().toLowerCase()]);
    expect(reader!.userId).toBeNull();
  });

  test("names the workflow, for the audit trail", () => {
    const props: DatabaseCommonInteractionProps = principal();

    expect(props.workflowId).toBe(WORKFLOW_ID);
    expect(props.workflowName).toBe("Close stale incidents");
  });

  test("leaves the name out when the workflow has none", () => {
    const props: DatabaseCommonInteractionProps =
      WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
      });

    expect("workflowName" in props).toBe(false);
  });
});

describe("the plan", () => {
  test("is read for the project on a server with billing", async () => {
    setTestBillingEnabled(true);

    const props: DatabaseCommonInteractionProps =
      await WorkflowPrincipal.getProps({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
      });

    expect(getCurrentPlan).toHaveBeenCalledTimes(1);
    expect(getCurrentPlan.mock.calls[0]![0].toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(props.currentPlan).toBe(PlanType.Growth);
    expect(props.isSubscriptionUnpaid).toBe(false);
  });

  test("an unpaid subscription comes with it", async () => {
    setTestBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Scale,
      isSubscriptionUnpaid: true,
    });

    const props: DatabaseCommonInteractionProps =
      await WorkflowPrincipal.getProps({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
      });

    expect(props.isSubscriptionUnpaid).toBe(true);
  });

  test("nothing is read without billing", async () => {
    const props: DatabaseCommonInteractionProps =
      await WorkflowPrincipal.getProps({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
      });

    expect(getCurrentPlan).not.toHaveBeenCalled();
    expect(props.currentPlan).toBeUndefined();
  });

  test("a project whose plan cannot be read gets no props at all", async () => {
    setTestBillingEnabled(true);
    getCurrentPlan.mockRejectedValue(new Error("Project ID is invalid"));

    await expect(
      WorkflowPrincipal.getProps({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
      }),
    ).rejects.toThrow("Project ID is invalid");
  });
});

describe("every step", () => {
  test("gets a fresh object, so nothing one step changes reaches the next", async () => {
    const first: DatabaseCommonInteractionProps =
      await WorkflowPrincipal.getProps({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
      });

    first.userTenantAccessPermission![PROJECT_ID.toString()]!.permissions.push({
      permission: Permission.ProjectOwner,
      labelIds: [],
      isBlockPermission: false,
      _type: "UserPermission",
    });
    first.isRoot = true;

    const second: DatabaseCommonInteractionProps =
      await WorkflowPrincipal.getProps({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
      });

    expect(second).not.toBe(first);
    expect(second.isRoot).toBeFalsy();
    expect(
      HeldPermissionsUtil.isGrantedAny(heldBy(second), [
        Permission.ProjectOwner,
      ]),
    ).toBe(false);
  });
});
