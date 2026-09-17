import {
  RUNBOOK_ADVANCE_PERMISSIONS,
  RUNBOOK_EXECUTE_PERMISSIONS,
  assertCanAdvanceRunbookExecutions,
  assertCanExecuteRunbooks,
} from "../../../../Server/Utils/Runbook/RunbookExecutePermission";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";

/*
 * These are the pure authorization gates that stand in for RunbookExecution's
 * create/update ACLs on the runbook-execution routes. The tests below pin the
 * three things that are easy to regress by hand-editing the permission lists:
 * that an allowed permission grants, that a BLOCK row never grants, and that a
 * grant in one project never leaks into another.
 */

const PROJECT_ID: ObjectID = new ObjectID("60f7d9b0a1b2c3d4e5f60001");
const OTHER_PROJECT_ID: ObjectID = new ObjectID("60f7d9b0a1b2c3d4e5f60002");

function userPermission(
  permission: Permission,
  overrides?: Partial<UserPermission>,
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    ...overrides,
  };
}

function propsWith(
  permissions: Array<UserPermission>,
  projectId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId,
    permissions,
  };

  return {
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

describe("RunbookExecutePermission", () => {
  describe("permission list invariants", () => {
    test("execute list contains RunbookExecution's create ACL roles", () => {
      expect(RUNBOOK_EXECUTE_PERMISSIONS).toContain(Permission.ProjectOwner);
      expect(RUNBOOK_EXECUTE_PERMISSIONS).toContain(Permission.ProjectAdmin);
      expect(RUNBOOK_EXECUTE_PERMISSIONS).toContain(Permission.ProjectMember);
      expect(RUNBOOK_EXECUTE_PERMISSIONS).toContain(
        Permission.CreateRunbookExecution,
      );
      expect(RUNBOOK_EXECUTE_PERMISSIONS).toContain(Permission.RunbookAdmin);
      expect(RUNBOOK_EXECUTE_PERMISSIONS).toContain(Permission.RunbookMember);
    });

    test("advance list is a strict superset of the execute list", () => {
      for (const permission of RUNBOOK_EXECUTE_PERMISSIONS) {
        expect(RUNBOOK_ADVANCE_PERMISSIONS).toContain(permission);
      }
      expect(RUNBOOK_ADVANCE_PERMISSIONS).toContain(
        Permission.EditRunbookExecution,
      );
      expect(RUNBOOK_ADVANCE_PERMISSIONS.length).toBe(
        RUNBOOK_EXECUTE_PERMISSIONS.length + 1,
      );
    });

    test("EditRunbookExecution advances but does not start executions", () => {
      // It is documented as the tick-off-without-starting permission.
      expect(RUNBOOK_ADVANCE_PERMISSIONS).toContain(
        Permission.EditRunbookExecution,
      );
      expect(RUNBOOK_EXECUTE_PERMISSIONS).not.toContain(
        Permission.EditRunbookExecution,
      );
    });
  });

  describe("assertCanExecuteRunbooks", () => {
    test.each(RUNBOOK_EXECUTE_PERMISSIONS)(
      "grants when the user holds %s",
      (permission: Permission) => {
        const props: DatabaseCommonInteractionProps = propsWith([
          userPermission(permission),
        ]);

        expect(() => {
          return assertCanExecuteRunbooks(props, PROJECT_ID);
        }).not.toThrow();
      },
    );

    test("denies when the user holds no runbook permission", () => {
      const props: DatabaseCommonInteractionProps = propsWith([
        userPermission(Permission.MonitorViewer),
      ]);

      expect(() => {
        return assertCanExecuteRunbooks(props, PROJECT_ID);
      }).toThrow(NotAuthorizedException);
    });

    test("denies when the only matching row is a block permission", () => {
      const props: DatabaseCommonInteractionProps = propsWith([
        userPermission(Permission.ProjectOwner, { isBlockPermission: true }),
      ]);

      expect(() => {
        return assertCanExecuteRunbooks(props, PROJECT_ID);
      }).toThrow(NotAuthorizedException);
    });

    test("EditRunbookExecution alone cannot start an execution", () => {
      const props: DatabaseCommonInteractionProps = propsWith([
        userPermission(Permission.EditRunbookExecution),
      ]);

      expect(() => {
        return assertCanExecuteRunbooks(props, PROJECT_ID);
      }).toThrow(NotAuthorizedException);
    });

    test("denies when there is no tenant access permission at all", () => {
      expect(() => {
        return assertCanExecuteRunbooks({}, PROJECT_ID);
      }).toThrow(NotAuthorizedException);
    });

    test("denies when the permission set is empty", () => {
      const props: DatabaseCommonInteractionProps = propsWith([]);

      expect(() => {
        return assertCanExecuteRunbooks(props, PROJECT_ID);
      }).toThrow(NotAuthorizedException);
    });

    test("a grant in another project does not leak into this one", () => {
      // User is a ProjectOwner in OTHER_PROJECT_ID but not in PROJECT_ID.
      const props: DatabaseCommonInteractionProps = propsWith(
        [userPermission(Permission.ProjectOwner)],
        OTHER_PROJECT_ID,
      );

      expect(() => {
        return assertCanExecuteRunbooks(props, PROJECT_ID);
      }).toThrow(NotAuthorizedException);
    });

    test("uses the start-runbook denial message", () => {
      expect(() => {
        return assertCanExecuteRunbooks(propsWith([]), PROJECT_ID);
      }).toThrow("You do not have permission to start runbook executions");
    });

    test("an allow row still grants alongside an unrelated block row", () => {
      const props: DatabaseCommonInteractionProps = propsWith([
        userPermission(Permission.MonitorViewer, { isBlockPermission: true }),
        userPermission(Permission.RunbookMember),
      ]);

      expect(() => {
        return assertCanExecuteRunbooks(props, PROJECT_ID);
      }).not.toThrow();
    });
  });

  describe("assertCanAdvanceRunbookExecutions", () => {
    test("grants for EditRunbookExecution (advance-only permission)", () => {
      const props: DatabaseCommonInteractionProps = propsWith([
        userPermission(Permission.EditRunbookExecution),
      ]);

      expect(() => {
        return assertCanAdvanceRunbookExecutions(props, PROJECT_ID);
      }).not.toThrow();
    });

    test("grants for a RunbookMember who could also start the run", () => {
      const props: DatabaseCommonInteractionProps = propsWith([
        userPermission(Permission.RunbookMember),
      ]);

      expect(() => {
        return assertCanAdvanceRunbookExecutions(props, PROJECT_ID);
      }).not.toThrow();
    });

    test("denies when the user holds neither execute nor edit rights", () => {
      const props: DatabaseCommonInteractionProps = propsWith([
        userPermission(Permission.MonitorViewer),
      ]);

      expect(() => {
        return assertCanAdvanceRunbookExecutions(props, PROJECT_ID);
      }).toThrow(NotAuthorizedException);
    });

    test("denies when the matching row is a block permission", () => {
      const props: DatabaseCommonInteractionProps = propsWith([
        userPermission(Permission.EditRunbookExecution, {
          isBlockPermission: true,
        }),
      ]);

      expect(() => {
        return assertCanAdvanceRunbookExecutions(props, PROJECT_ID);
      }).toThrow(NotAuthorizedException);
    });

    test("uses the change-runbook denial message", () => {
      expect(() => {
        return assertCanAdvanceRunbookExecutions(propsWith([]), PROJECT_ID);
      }).toThrow("You do not have permission to change runbook executions");
    });
  });
});
