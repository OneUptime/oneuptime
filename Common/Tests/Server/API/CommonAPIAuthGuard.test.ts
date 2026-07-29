import { describe, expect, test, afterEach } from "@jest/globals";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Exception from "../../../Types/Exception/Exception";

/*
 * Tests for CommonAPI.assertAuthenticatedProjectMember — the shared auth
 * guard for custom endpoints that disclose project data (Teams / Slack
 * channel browsing, etc.). getUserMiddleware lets unauthenticated requests
 * through as "public" and takes the tenant id from a caller-supplied
 * header, so this guard must reject anything that is not an authenticated
 * member of the tenant project.
 */

function buildTenantPermission(
  projectId: ObjectID,
): UserTenantAccessPermission {
  const memberPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: [],
  };

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [memberPermission],
  };

  return tenantPermission;
}

function buildProps(overrides?: {
  tenantId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
  userTenantAccessPermission?:
    | Dictionary<UserTenantAccessPermission>
    | undefined;
}): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = {
    tenantId: overrides?.tenantId,
    userId: overrides?.userId,
    userTenantAccessPermission: overrides?.userTenantAccessPermission,
  };
  return props;
}

/*
 * The guard is synchronous, so failures are captured with try/catch (via
 * this helper) or expect(() => ...).toThrow — never .rejects.
 */
function captureThrown(fn: () => void): unknown {
  try {
    fn();
  } catch (err: unknown) {
    return err;
  }
  return undefined;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CommonAPI.assertAuthenticatedProjectMember", () => {
  describe("missing tenant id", () => {
    test("throws BadDataException with 'Project ID is required' when tenantId is undefined", () => {
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: undefined,
      });

      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(BadDataException);
      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow("Project ID is required");
    });

    test("missing tenantId wins over everything else — even a fully authenticated user gets BadDataException", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: undefined,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [projectId.toString()]: buildTenantPermission(projectId),
        },
      });

      const thrown: unknown = captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown).not.toBeInstanceOf(NotAuthorizedException);
      expect((thrown as BadDataException).message).toBe(
        "Project ID is required",
      );
    });

    test("completely empty props object throws BadDataException", () => {
      const props: DatabaseCommonInteractionProps = {};

      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(BadDataException);
    });
  });

  describe("unauthenticated / unauthorized callers", () => {
    test("tenantId present but no userId throws NotAuthorizedException", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userId: undefined,
        userTenantAccessPermission: {
          [projectId.toString()]: buildTenantPermission(projectId),
        },
      });

      const thrown: unknown = captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect((thrown as NotAuthorizedException).message).toBe(
        "You are not authorized to access this project's data.",
      );
    });

    test("userId present but no userTenantAccessPermission map throws NotAuthorizedException", () => {
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: ObjectID.generate(),
        userId: ObjectID.generate(),
        userTenantAccessPermission: undefined,
      });

      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(NotAuthorizedException);
    });

    test("permission map keyed by a DIFFERENT project id throws NotAuthorizedException", () => {
      const requestedProjectId: ObjectID = ObjectID.generate();
      const otherProjectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: requestedProjectId,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [otherProjectId.toString()]: buildTenantPermission(otherProjectId),
        },
      });

      const thrown: unknown = captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect((thrown as NotAuthorizedException).message).toBe(
        "You are not authorized to access this project's data.",
      );
    });

    test("empty-object permission map throws NotAuthorizedException", () => {
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: ObjectID.generate(),
        userId: ObjectID.generate(),
        userTenantAccessPermission: {},
      });

      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(NotAuthorizedException);
    });

    test("the not-authorized error is a NotAuthorizedException, not a BadDataException", () => {
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: ObjectID.generate(),
        userId: ObjectID.generate(),
        userTenantAccessPermission: {},
      });

      const thrown: unknown = captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect(thrown).not.toBeInstanceOf(BadDataException);
      expect(thrown).toBeInstanceOf(Exception);
      expect(thrown).toBeInstanceOf(Error);
    });

    test("no userId AND no permission map throws NotAuthorizedException (public caller)", () => {
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: ObjectID.generate(),
        userId: undefined,
        userTenantAccessPermission: undefined,
      });

      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(NotAuthorizedException);
      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow("You are not authorized to access this project's data.");
    });
  });

  describe("authorized callers", () => {
    test("happy path returns the exact same ObjectID instance that was passed as tenantId", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [projectId.toString()]: buildTenantPermission(projectId),
        },
      });

      const returned: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      expect(returned).toBe(projectId);
      expect(returned.toString()).toBe(projectId.toString());
    });

    test("happy path does not throw", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [projectId.toString()]: buildTenantPermission(projectId),
        },
      });

      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).not.toThrow();
    });

    test("happy path with multiple projects in the permission map returns the requested tenant", () => {
      const projectA: ObjectID = ObjectID.generate();
      const projectB: ObjectID = ObjectID.generate();
      const projectC: ObjectID = ObjectID.generate();
      const permissionMap: Dictionary<UserTenantAccessPermission> = {
        [projectA.toString()]: buildTenantPermission(projectA),
        [projectB.toString()]: buildTenantPermission(projectB),
        [projectC.toString()]: buildTenantPermission(projectC),
      };
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectB,
        userId: ObjectID.generate(),
        userTenantAccessPermission: permissionMap,
      });

      const returned: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      expect(returned).toBe(projectB);
    });

    test("a DIFFERENT ObjectID instance with the same string value is still authorized (lookup is by string)", () => {
      const projectIdString: string = ObjectID.generate().toString();
      const tenantInstance: ObjectID = new ObjectID(projectIdString);
      const permissionKeyInstance: ObjectID = new ObjectID(projectIdString);
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: tenantInstance,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [permissionKeyInstance.toString()]: buildTenantPermission(
            permissionKeyInstance,
          ),
        },
      });

      const returned: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      /*
       * The instance returned is the tenantId from props, not the one the
       * permission map was built from.
       */
      expect(returned).toBe(tenantInstance);
      expect(returned).not.toBe(permissionKeyInstance);
      expect(returned.toString()).toBe(projectIdString);
    });

    test("extra unrelated props (isRoot, isMasterAdmin) do not bypass the membership check", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = {
        tenantId: projectId,
        userId: undefined,
        userTenantAccessPermission: undefined,
        isRoot: true,
        isMasterAdmin: true,
      };

      /*
       * Pin current behavior: the guard checks userId + the tenant access
       * permission map ONLY — root / master-admin flags do not grant
       * access to these endpoints.
       */
      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(NotAuthorizedException);
    });
  });
});

/*
 * Tests for CommonAPI.assertResourceBelongsToProject — the companion guard
 * for custom routes whose path carries a resource id.
 * assertAuthenticatedProjectMember only proves the caller belongs to the
 * project it claimed in the `tenantid` header; without this second check a
 * member of project A could hand the route project B's resource id and have
 * it acted on as root.
 */
describe("CommonAPI.assertResourceBelongsToProject", () => {
  test("does not throw when the resource belongs to the authorized project", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(() => {
      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: projectId,
        projectId: projectId,
      });
    }).not.toThrow();
  });

  test("compares by string value, not by ObjectID instance", () => {
    const projectIdString: string = ObjectID.generate().toString();

    expect(() => {
      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: new ObjectID(projectIdString),
        projectId: new ObjectID(projectIdString),
      });
    }).not.toThrow();
  });

  test("throws NotAuthorizedException when the resource belongs to another project", () => {
    const thrown: unknown = captureThrown(() => {
      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: ObjectID.generate(),
        projectId: ObjectID.generate(),
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Exception).message).toBe(
      "You are not authorized to access this project's data.",
    );
  });

  /*
   * A row that was not found reaches the guard as undefined. It must be
   * rejected exactly like a cross-project row, so the endpoint cannot be
   * used to tell "id exists in another project" apart from "id does not
   * exist".
   */
  test("throws NotAuthorizedException when the resource was not found", () => {
    const thrown: unknown = captureThrown(() => {
      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: undefined,
        projectId: ObjectID.generate(),
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Exception).message).toBe(
      "You are not authorized to access this project's data.",
    );
  });

  test("throws NotAuthorizedException when the resource carries a null projectId", () => {
    expect(() => {
      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: null,
        projectId: ObjectID.generate(),
      });
    }).toThrow(NotAuthorizedException);
  });
});

/*
 * Tests for CommonAPI.assertTenantScoped — the lighter guard for custom
 * endpoints whose path carries only a resource id, so the project can only
 * come from the `tenantid` header. Without it the request still reaches the
 * handler, just with no tenant permissions, and the eventual tenant-scoped
 * read fails as "You do not have permissions to read <model>" — a message
 * that sends project owners hunting for a role they already hold. The guard
 * exists to surface the real cause (a missing header) instead.
 */
describe("CommonAPI.assertTenantScoped", () => {
  test("throws BadDataException naming the tenantid header when tenantId is missing", () => {
    const props: DatabaseCommonInteractionProps = buildProps({
      tenantId: undefined,
      userId: ObjectID.generate(),
    });

    const thrown: unknown = captureThrown(() => {
      CommonAPI.assertTenantScoped(props);
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Exception).message).toContain("Project ID is required");
    expect((thrown as Exception).message).toContain("tenantid");
  });

  test("the message points at the header rather than at permissions", () => {
    const thrown: unknown = captureThrown(() => {
      CommonAPI.assertTenantScoped({});
    });

    /*
     * The whole point of the guard: whatever it says must not look like the
     * permissions error it replaces.
     */
    expect((thrown as Exception).message).toContain("tenantid");
    expect((thrown as Exception).message).not.toContain("permission");
  });

  test("returns the tenant id when the request is project scoped", () => {
    const projectId: ObjectID = ObjectID.generate();
    const props: DatabaseCommonInteractionProps = buildProps({
      tenantId: projectId,
      userId: ObjectID.generate(),
    });

    expect(CommonAPI.assertTenantScoped(props)).toBe(projectId);
  });

  /*
   * API-key callers are authenticated by ProjectMiddleware, which sets
   * userType/tenantId and the tenant permission map but never userId. This
   * guard must not lock them out — that is what separates it from
   * assertAuthenticatedProjectMember.
   */
  test("accepts an API-key caller that has a tenant but no userId", () => {
    const projectId: ObjectID = ObjectID.generate();
    const permissions: Dictionary<UserTenantAccessPermission> = {};
    permissions[projectId.toString()] = buildTenantPermission(projectId);

    const props: DatabaseCommonInteractionProps = buildProps({
      tenantId: projectId,
      userId: undefined,
      userTenantAccessPermission: permissions,
    });

    expect(() => {
      CommonAPI.assertTenantScoped(props);
    }).not.toThrow();
  });

  test("does not require membership — that stays with the tenant-scoped read", () => {
    /*
     * assertTenantScoped is a diagnostic for a missing header, not an
     * authorization check. A caller who sends a tenant id for a project they
     * are not a member of passes here and is rejected by the read itself, so
     * adding this guard cannot loosen or tighten access.
     */
    const props: DatabaseCommonInteractionProps = buildProps({
      tenantId: ObjectID.generate(),
      userId: undefined,
      userTenantAccessPermission: undefined,
    });

    expect(() => {
      CommonAPI.assertTenantScoped(props);
    }).not.toThrow();
  });
});
