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
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import UserType from "../../../Types/UserType";

/*
 * Tests for CommonAPI.assertAuthenticatedProjectMember — the shared auth
 * guard for custom endpoints that disclose project data (Teams / Slack
 * channel browsing, etc.). getUserMiddleware lets unauthenticated requests
 * through as "public" and takes the tenant id from a caller-supplied
 * header, so this guard must reject anything that is not an authenticated
 * member of the tenant project.
 *
 * HOW it rejects matters as much as THAT it rejects. A caller with no
 * credentials at all gets NotAuthenticatedException (401) before anything
 * else is looked at, including the tenant header; every other refusal keeps
 * its old status (400 for a missing tenant, 422 for "not a member" / "not
 * permitted"). That split is what fixed the customer report: the dashboard's
 * access-token cookie expires with the JWT inside it, so an idle tab's next
 * request arrives anonymous, and the browser client only refreshes the
 * session and replays the request on a 401. Answering that request with a
 * 422 left a signed-in admin staring at "You are not authorized to access
 * this project's data." Assertions below therefore pin the exception class
 * AND its code, because the code is the HTTP status the client acts on.
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
  userType?: UserType | undefined;
  userTenantAccessPermission?:
    | Dictionary<UserTenantAccessPermission>
    | undefined;
}): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = {
    tenantId: overrides?.tenantId,
    userId: overrides?.userId,
    userType: overrides?.userType,
    userTenantAccessPermission: overrides?.userTenantAccessPermission,
  };
  return props;
}

/*
 * The props a project API key produces. ProjectMiddleware sets userType API,
 * the tenant the KEY belongs to, and the permissions granted to the key - and
 * never a userId, which is the whole reason API keys need their own cases in
 * this file: "no userId" alone does not mean "anonymous".
 */
function buildApiKeyProps(projectId: ObjectID): DatabaseCommonInteractionProps {
  return buildProps({
    tenantId: projectId,
    userId: undefined,
    userType: UserType.API,
    userTenantAccessPermission: {
      [projectId.toString()]: buildTenantPermission(projectId),
    },
  });
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

/*
 * The refusal an expired session must get: NotAuthenticatedException, code
 * 401, with the shared message. Checked on the class, the code and the text,
 * because each is load-bearing somewhere different - the class for the
 * server's error middleware, the code for the HTTP status the browser client
 * keys its refresh-and-replay on, the text for what a user sees if the
 * refresh itself fails.
 */
function expectAuthenticationRequired(thrown: unknown): void {
  expect(thrown).toBeInstanceOf(NotAuthenticatedException);
  expect(thrown).not.toBeInstanceOf(NotAuthorizedException);
  expect(thrown).not.toBeInstanceOf(BadDataException);
  expect((thrown as Exception).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect((thrown as Exception).code).toBe(401);
  expect((thrown as Exception).message).toBe(
    CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
  );
}

// An authenticated caller refused access: the pre-existing 422.
function expectNotAuthorized(thrown: unknown, message?: string): void {
  expect(thrown).toBeInstanceOf(NotAuthorizedException);
  expect(thrown).not.toBeInstanceOf(NotAuthenticatedException);
  expect((thrown as Exception).code).toBe(ExceptionCode.NotAuthorizedException);
  expect((thrown as Exception).code).toBe(422);

  if (message !== undefined) {
    expect((thrown as Exception).message).toBe(message);
  }
}

// An authenticated caller that named no project: the pre-existing 400.
function expectBadData(thrown: unknown, messageFragment: string): void {
  expect(thrown).toBeInstanceOf(BadDataException);
  expect((thrown as Exception).code).toBe(ExceptionCode.BadDataException);
  expect((thrown as Exception).code).toBe(400);
  expect((thrown as Exception).message).toContain(messageFragment);
}

const NOT_AUTHORIZED_MESSAGE: string =
  "You are not authorized to access this project's data.";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CommonAPI.assertAuthenticatedProjectMember", () => {
  describe("missing tenant id", () => {
    /*
     * The caller is logged in (a userId), so this pins the 400 an
     * authenticated caller has always had for forgetting the header. The same
     * request WITHOUT a userId is an expired session and is pinned as a 401
     * below; before the credential check existed both got this 400.
     */
    test("an authenticated user with no tenantId gets BadDataException 'Project ID is required' (400)", () => {
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: undefined,
        userId: ObjectID.generate(),
      });

      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(BadDataException);
      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow("Project ID is required");

      expectBadData(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(props);
        }),
        "Project ID is required",
      );
    });

    test("missing tenantId wins over the membership check — a user holding permissions for some project still gets BadDataException", () => {
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

    /*
     * Was a BadDataException (400) before the credential check. An empty
     * props object is the most anonymous caller there is, and "who are you?"
     * now comes before "which project?": a 400 would not make the browser
     * refresh the session, a 401 does.
     */
    test("a completely empty props object is anonymous: NotAuthenticatedException (401), not the missing-tenant 400", () => {
      const props: DatabaseCommonInteractionProps = {};

      expectAuthenticationRequired(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(props);
        }),
      );
    });
  });

  describe("unauthenticated / unauthorized callers", () => {
    /*
     * The customer's request, exactly: the tab sat idle, the access-token
     * cookie expired and stopped being sent, so getUserMiddleware produced a
     * Public request that still carries the tenant header. Previously a 422
     * "not authorized"; now a 401 the client answers by refreshing.
     */
    test("tenantId present but no userId and no credentialed userType (an expired session) throws NotAuthenticatedException (401)", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userId: undefined,
        userTenantAccessPermission: {
          [projectId.toString()]: buildTenantPermission(projectId),
        },
      });

      expectAuthenticationRequired(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(props);
        }),
      );
    });

    test("an explicit UserType.Public caller with a tenant header gets the same 401", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userType: UserType.Public,
      });

      expectAuthenticationRequired(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(props);
        }),
      );
    });

    /*
     * The original intent of the "no userId" case, kept: a caller with tenant
     * permissions but no user is still not a logged-in member. A project API
     * key IS authenticated, though, so it keeps the 422 - a 401 would send an
     * API client off to refresh a session it never had.
     */
    test("a project API key (tenant permissions, no userId) is still refused with NotAuthorizedException (422)", () => {
      const projectId: ObjectID = ObjectID.generate();

      expectNotAuthorized(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(
            buildApiKeyProps(projectId),
          );
        }),
        NOT_AUTHORIZED_MESSAGE,
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

    // Was NotAuthorizedException (422) before the credential check.
    test("no userId AND no permission map (public caller) throws NotAuthenticatedException (401)", () => {
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: ObjectID.generate(),
        userId: undefined,
        userTenantAccessPermission: undefined,
      });

      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(NotAuthenticatedException);
      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE);

      expectAuthenticationRequired(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(props);
        }),
      );
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
       * access to these endpoints. They do not count as credentials either:
       * with no userId and no API / MasterAdmin userType this is an anonymous
       * caller, so the refusal is now the 401 (it was a 422 before the
       * credential check existed). Still refused, which is what matters.
       */
      expect(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }).toThrow(NotAuthenticatedException);

      expectAuthenticationRequired(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(props);
        }),
      );
    });

    test("a logged-in member keeps working when the request also carries isRoot / isMasterAdmin flags", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = {
        ...buildProps({
          tenantId: projectId,
          userId: ObjectID.generate(),
          userTenantAccessPermission: {
            [projectId.toString()]: buildTenantPermission(projectId),
          },
        }),
        isRoot: true,
        isMasterAdmin: true,
      };

      expect(CommonAPI.assertAuthenticatedProjectMember(props)).toBe(projectId);
    });
  });

  /*
   * The credential check is the FIRST thing the guard does, and each refusal
   * a caller can get has a fixed status. These tests pin the precedence
   * directly: every pair differs in exactly one fact about the caller.
   */
  describe("refusal precedence and status codes", () => {
    test("anonymous with no tenant header: 401 wins over the missing-tenant 400", () => {
      expectAuthenticationRequired(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(
            buildProps({ tenantId: undefined, userId: undefined }),
          );
        }),
      );
    });

    test("authenticated with no tenant header: still the 400", () => {
      expectBadData(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(
            buildProps({
              tenantId: undefined,
              userId: ObjectID.generate(),
              userType: UserType.User,
            }),
          );
        }),
        "Project ID is required",
      );
    });

    test("an API key with no tenant: the 400, because a key is a credential", () => {
      expectBadData(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(
            buildProps({ tenantId: undefined, userType: UserType.API }),
          );
        }),
        "Project ID is required",
      );
    });

    test("a logged-in member of ANOTHER project: still the 422", () => {
      const requestedProjectId: ObjectID = ObjectID.generate();
      const otherProjectId: ObjectID = ObjectID.generate();

      expectNotAuthorized(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(
            buildProps({
              tenantId: requestedProjectId,
              userId: ObjectID.generate(),
              userType: UserType.User,
              userTenantAccessPermission: {
                [otherProjectId.toString()]:
                  buildTenantPermission(otherProjectId),
              },
            }),
          );
        }),
        NOT_AUTHORIZED_MESSAGE,
      );
    });

    test("a master-admin session with no userId is credentialed, so it gets the member check's 422 rather than a 401", () => {
      const projectId: ObjectID = ObjectID.generate();

      expectNotAuthorized(
        captureThrown(() => {
          CommonAPI.assertAuthenticatedProjectMember(
            buildProps({
              tenantId: projectId,
              userType: UserType.MasterAdmin,
            }),
          );
        }),
        NOT_AUTHORIZED_MESSAGE,
      );
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
    /*
     * An authenticated caller: with no credentials at all the guard now asks
     * for a login instead (pinned below), so `{}` no longer reaches the
     * header message this test is about.
     */
    const thrown: unknown = captureThrown(() => {
      CommonAPI.assertTenantScoped(buildProps({ userId: ObjectID.generate() }));
    });

    /*
     * The whole point of the guard: whatever it says must not look like the
     * permissions error it replaces.
     */
    expect((thrown as Exception).message).toContain("tenantid");
    expect((thrown as Exception).message).not.toContain("permission");
  });

  test("an API key with no tenant gets the header message too", () => {
    expectBadData(
      captureThrown(() => {
        CommonAPI.assertTenantScoped(buildProps({ userType: UserType.API }));
      }),
      "tenantid",
    );
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

    /*
     * userType API is what ProjectMiddleware sets for a key, and it is now
     * what tells the guard this caller is credentialed. Without it the same
     * props are an anonymous request (see the 401 cases below).
     */
    const props: DatabaseCommonInteractionProps = buildProps({
      tenantId: projectId,
      userId: undefined,
      userType: UserType.API,
      userTenantAccessPermission: permissions,
    });

    expect(() => {
      CommonAPI.assertTenantScoped(props);
    }).not.toThrow();
    expect(CommonAPI.assertTenantScoped(props)).toBe(projectId);
  });

  test("does not require membership — that stays with the tenant-scoped read", () => {
    /*
     * assertTenantScoped is a diagnostic for a missing header, not an
     * authorization check. A logged-in caller who sends a tenant id for a
     * project they are not a member of passes here and is rejected by the
     * read itself, so adding this guard cannot loosen or tighten access for
     * an authenticated caller. (This used to be shown with a caller carrying
     * no userId at all; that caller is anonymous and is now a 401, below.)
     */
    const props: DatabaseCommonInteractionProps = buildProps({
      tenantId: ObjectID.generate(),
      userId: ObjectID.generate(),
      userTenantAccessPermission: undefined,
    });

    expect(() => {
      CommonAPI.assertTenantScoped(props);
    }).not.toThrow();

    // Nor for an API key that has no grants in the project it named.
    expect(() => {
      CommonAPI.assertTenantScoped(
        buildProps({
          tenantId: ObjectID.generate(),
          userType: UserType.API,
          userTenantAccessPermission: undefined,
        }),
      );
    }).not.toThrow();
  });

  /*
   * A tenant header on its own proves nothing. Before the credential check,
   * the guard let this caller through to a tenant-scoped read that then
   * failed as "You do not have permissions to read <model>" - the permissions
   * message this guard exists to avoid - or, for a custom route, to whatever
   * refusal the route produced. Now the caller is told to log in.
   */
  test("an anonymous caller carrying only a tenant header is refused with NotAuthenticatedException (401)", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertTenantScoped(
          buildProps({ tenantId: ObjectID.generate() }),
        );
      }),
    );
  });

  test("an explicit UserType.Public caller with a tenant header is the same 401", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertTenantScoped(
          buildProps({
            tenantId: ObjectID.generate(),
            userType: UserType.Public,
          }),
        );
      }),
    );
  });

  test("anonymous with no tenant header: 401 wins over the missing-tenant 400", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertTenantScoped({});
      }),
    );
  });

  test("a master-admin session is admitted without a userId", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(
      CommonAPI.assertTenantScoped(
        buildProps({ tenantId: projectId, userType: UserType.MasterAdmin }),
      ),
    ).toBe(projectId);
  });
});

/*
 * Tests for CommonAPI.assertAuthenticatedProjectPrincipal — the member guard
 * that ALSO admits a project API key, for endpoints meant to be automatable.
 * Same precedence as the member guard: credentials first (401), then the
 * tenant (400), then access to that tenant (422).
 */
describe("CommonAPI.assertAuthenticatedProjectPrincipal", () => {
  test("admits a logged-in member of the tenant project", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(
      CommonAPI.assertAuthenticatedProjectPrincipal(
        buildProps({
          tenantId: projectId,
          userId: ObjectID.generate(),
          userType: UserType.User,
          userTenantAccessPermission: {
            [projectId.toString()]: buildTenantPermission(projectId),
          },
        }),
      ),
    ).toBe(projectId);
  });

  test("admits a project API key with permissions in the tenant project", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(
      CommonAPI.assertAuthenticatedProjectPrincipal(
        buildApiKeyProps(projectId),
      ),
    ).toBe(projectId);
  });

  test("an API key with no permission entry for the tenant is still the 422", () => {
    expectNotAuthorized(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectPrincipal(
          buildProps({
            tenantId: ObjectID.generate(),
            userType: UserType.API,
            userTenantAccessPermission: {},
          }),
        );
      }),
      NOT_AUTHORIZED_MESSAGE,
    );
  });

  test("a logged-in member of ANOTHER project is still the 422", () => {
    const requestedProjectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    expectNotAuthorized(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectPrincipal(
          buildProps({
            tenantId: requestedProjectId,
            userId: ObjectID.generate(),
            userTenantAccessPermission: {
              [otherProjectId.toString()]:
                buildTenantPermission(otherProjectId),
            },
          }),
        );
      }),
      NOT_AUTHORIZED_MESSAGE,
    );
  });

  test("an authenticated caller with no tenant is still the 400", () => {
    expectBadData(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectPrincipal(
          buildProps({ userId: ObjectID.generate() }),
        );
      }),
      "Project ID is required",
    );

    expectBadData(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectPrincipal(
          buildProps({ userType: UserType.API }),
        );
      }),
      "Project ID is required",
    );
  });

  test("an anonymous caller with a tenant header and a permission map is refused with 401", () => {
    /*
     * The permission map is there to prove it is not what decides this: an
     * anonymous request never legitimately carries one, but if it did, the
     * missing credential still wins.
     */
    const projectId: ObjectID = ObjectID.generate();

    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectPrincipal(
          buildProps({
            tenantId: projectId,
            userTenantAccessPermission: {
              [projectId.toString()]: buildTenantPermission(projectId),
            },
          }),
        );
      }),
    );
  });

  test("anonymous with no tenant header: 401 wins over the missing-tenant 400", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectPrincipal({});
      }),
    );
  });

  test("isRoot / isMasterAdmin flags are not credentials", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectPrincipal({
          tenantId: ObjectID.generate(),
          isRoot: true,
          isMasterAdmin: true,
        });
      }),
    );
  });
});

/*
 * Tests for CommonAPI.assertPermittedInProject — the third guard in the set.
 *
 * assertAuthenticatedProjectMember answers "are you in this project?" and
 * assertResourceBelongsToProject answers "is this row in that project?".
 * Neither answers "are you allowed to read this KIND of thing?", which is the
 * question a CRUD read answers from the model's own access control lists and
 * a custom route reading with `isRoot: true` skips entirely.
 *
 * The subtle part, and the reason this has its own tests: models routinely
 * list Permission.Public as a reader (LlmProvider does, so the shared global
 * providers stay visible), while getUserPermissions merges Public into EVERY
 * caller's permission set — anonymous ones included. Intersecting the two
 * lists as they come would therefore admit anybody. The guard first narrows
 * the model's list to the permissions a team can actually grant inside a
 * project.
 */
function buildPermittedProps(data: {
  projectId: ObjectID;
  granted: Array<Permission>;
  blocked?: Array<Permission> | undefined;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const permissions: Array<UserPermission> = data.granted.map(
    (permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    },
  );

  for (const blocked of data.blocked || []) {
    permissions.push({
      _type: "UserPermission",
      permission: blocked,
      labelIds: [],
      isBlockPermission: true,
    } as UserPermission);
  }

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: permissions,
  } as UserTenantAccessPermission;

  const dictionary: Dictionary<UserTenantAccessPermission> = {};
  dictionary[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: ObjectID.generate(),
    userTenantAccessPermission: dictionary,
    isMasterAdmin: data.isMasterAdmin,
  };
}

describe("CommonAPI.assertPermittedInProject", () => {
  test("admits a caller holding one of the allowed permissions", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [Permission.ProjectMember],
        }),
        allowedPermissions: [Permission.ProjectOwner, Permission.ProjectMember],
      });
    }).not.toThrow();
  });

  test("admits a caller holding any one of several allowed permissions", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [Permission.ReadProjectIncident, Permission.SettingsViewer],
        }),
        allowedPermissions: [
          Permission.ProjectOwner,
          Permission.SettingsViewer,
        ],
      });
    }).not.toThrow();
  });

  test("refuses a member of the project who holds none of them", () => {
    const projectId: ObjectID = ObjectID.generate();

    const thrown: unknown = captureThrown(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [Permission.ReadProjectIncident],
        }),
        allowedPermissions: [Permission.ProjectOwner, Permission.ProjectAdmin],
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Exception).message).toBe(
      "You do not have permission to access this project's data.",
    );
  });

  test("uses the caller-supplied message when one is given", () => {
    const projectId: ObjectID = ObjectID.generate();

    const thrown: unknown = captureThrown(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [],
        }),
        allowedPermissions: [Permission.ProjectOwner],
        errorMessage:
          "You do not have permission to read this project's AI providers.",
      });
    });

    expect((thrown as Exception).message).toBe(
      "You do not have permission to read this project's AI providers.",
    );
  });

  /*
   * The regression this guard exists to prevent. Public is in many models'
   * read lists and in every caller's permission set, so a naive intersection
   * would always succeed.
   */
  test("Permission.Public in the allowed list does not admit an ordinary member", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [Permission.ReadProjectIncident],
        }),
        allowedPermissions: [Permission.Public, Permission.ProjectOwner],
      });
    }).toThrow(NotAuthorizedException);
  });

  /*
   * Still refused - and now refused as what it is. This caller was a 422 from
   * the permission intersection; the credential check answers it with a 401
   * before the permission lists are even read.
   */
  test("Permission.Public in the allowed list does not admit an anonymous caller: NotAuthenticatedException (401)", () => {
    const props: DatabaseCommonInteractionProps = {
      tenantId: ObjectID.generate(),
    };

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: [Permission.Public],
      });
    }).toThrow(NotAuthenticatedException);

    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertPermittedInProject({
          databaseProps: props,
          allowedPermissions: [Permission.Public],
        });
      }),
    );
  });

  test("an anonymous caller is asked to log in even when the route supplied its own refusal message", () => {
    /*
     * errorMessage words the "not permitted" refusal; it must not leak onto
     * the 401, whose text is the shared log-in prompt.
     */
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertPermittedInProject({
          databaseProps: { tenantId: ObjectID.generate() },
          allowedPermissions: [Permission.ProjectOwner],
          errorMessage:
            "You do not have permission to read this project's AI providers.",
        });
      }),
    );
  });

  test("the refusal for an authenticated member without the permission keeps its 422", () => {
    const projectId: ObjectID = ObjectID.generate();

    expectNotAuthorized(
      captureThrown(() => {
        CommonAPI.assertPermittedInProject({
          databaseProps: buildPermittedProps({
            projectId: projectId,
            granted: [Permission.ProjectMember],
          }),
          allowedPermissions: [Permission.ProjectOwner],
        });
      }),
      "You do not have permission to access this project's data.",
    );
  });

  test("Permission.CurrentUser, which every logged-in caller carries, does not admit them either", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [Permission.ReadProjectIncident],
        }),
        allowedPermissions: [Permission.CurrentUser, Permission.ProjectOwner],
      });
    }).toThrow(NotAuthorizedException);
  });

  test("an allowed list with nothing tenant-assignable in it denies everyone", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [Permission.ProjectOwner],
        }),
        allowedPermissions: [Permission.Public, Permission.CurrentUser],
      });
    }).toThrow(NotAuthorizedException);
  });

  test("an empty allowed list denies everyone", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [Permission.ProjectOwner],
        }),
        allowedPermissions: [],
      });
    }).toThrow(NotAuthorizedException);
  });

  /*
   * userTenantAccessPermission holds grants AND denials in one array,
   * discriminated only by isBlockPermission. Reading it raw would count a
   * team's explicit block row as a grant.
   */
  test("a BLOCK row for an allowed permission is not counted as a grant of it", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [Permission.ReadProjectIncident],
          blocked: [Permission.ProjectOwner, Permission.ProjectMember],
        }),
        allowedPermissions: [Permission.ProjectOwner, Permission.ProjectMember],
      });
    }).toThrow(NotAuthorizedException);
  });

  test("permissions granted in ANOTHER project do not count", () => {
    const callersProjectId: ObjectID = ObjectID.generate();
    const targetProjectId: ObjectID = ObjectID.generate();

    const props: DatabaseCommonInteractionProps = buildPermittedProps({
      projectId: callersProjectId,
      granted: [Permission.ProjectOwner],
    });

    // The header names the target project; the grants are for another one.
    props.tenantId = targetProjectId;

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: [Permission.ProjectOwner],
      });
    }).toThrow(NotAuthorizedException);
  });

  test("a master admin bypasses the permission check", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: buildPermittedProps({
          projectId: projectId,
          granted: [],
          isMasterAdmin: true,
        }),
        allowedPermissions: [Permission.ProjectOwner],
      });
    }).not.toThrow();
  });

  test("a master-admin session (userType MasterAdmin, no userId) bypasses the permission check", () => {
    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: {
          tenantId: ObjectID.generate(),
          userType: UserType.MasterAdmin,
          isMasterAdmin: true,
        },
        allowedPermissions: [Permission.ProjectOwner],
      });
    }).not.toThrow();
  });

  /*
   * The bypass is for a master admin, and being one is a credential. The
   * isMasterAdmin FLAG on its own, on a request with no user and no
   * MasterAdmin userType, is not - so it is asked to log in rather than
   * waved through.
   */
  test("the isMasterAdmin flag without credentials is a 401, not a bypass", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertPermittedInProject({
          databaseProps: {
            tenantId: ObjectID.generate(),
            isMasterAdmin: true,
          },
          allowedPermissions: [Permission.ProjectOwner],
        });
      }),
    );
  });

  test("an API key holding an allowed permission is admitted", () => {
    const projectId: ObjectID = ObjectID.generate();
    const props: DatabaseCommonInteractionProps = buildPermittedProps({
      projectId: projectId,
      granted: [Permission.ProjectOwner],
    });

    props.userId = undefined;
    props.userType = UserType.API;

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: [Permission.ProjectOwner],
      });
    }).not.toThrow();
  });

  /*
   * The guard answers one question only. Membership is assertAuthenticated-
   * ProjectMember's job, and a route must call both — this test documents
   * that calling only this one is not enough.
   *
   * The caller that proves it is one assertAuthenticatedProjectMember would
   * refuse: no userId. It is an API key here (userType API) because a caller
   * with no userId AND no credentialed userType is anonymous, and every
   * guard, this one included, now answers that with a 401 first - pinned at
   * the end of this test.
   */
  test("does not itself check membership — that stays with assertAuthenticatedProjectMember", () => {
    const projectId: ObjectID = ObjectID.generate();
    const props: DatabaseCommonInteractionProps = buildPermittedProps({
      projectId: projectId,
      granted: [Permission.ProjectOwner],
    });

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: [Permission.ProjectOwner],
      });
    }).not.toThrow();

    props.userId = undefined;
    props.userType = UserType.API;

    expect(() => {
      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: [Permission.ProjectOwner],
      });
    }).not.toThrow();

    // The member guard, by contrast, refuses this caller.
    expectNotAuthorized(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      }),
      NOT_AUTHORIZED_MESSAGE,
    );

    // With the credential gone too, the grants no longer matter: 401.
    props.userType = undefined;

    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertPermittedInProject({
          databaseProps: props,
          allowedPermissions: [Permission.ProjectOwner],
        });
      }),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The credential helpers every guard above is built on.
 * ---------------------------------------------------------------------------
 */

/*
 * isAnonymous decides who gets a 401. It must be exactly "no user, no API
 * key, no master key": too narrow and an expired session keeps getting 422s
 * the browser will not refresh on; too wide and an API client gets a 401 it
 * answers by trying to refresh a session it never had.
 */
describe("CommonAPI.isAnonymous", () => {
  type IsAnonymousCase = {
    name: string;
    props: DatabaseCommonInteractionProps;
    expected: boolean;
  };

  const cases: Array<IsAnonymousCase> = [
    {
      name: "a userId and nothing else (a logged-in user)",
      props: { userId: ObjectID.generate() },
      expected: false,
    },
    {
      name: "a userId with userType User",
      props: { userId: ObjectID.generate(), userType: UserType.User },
      expected: false,
    },
    {
      name: "userType API with no userId (a project API key)",
      props: { userType: UserType.API },
      expected: false,
    },
    {
      name: "userType MasterAdmin with no userId (the master API key)",
      props: { userType: UserType.MasterAdmin },
      expected: false,
    },
    {
      name: "userType Public (getUserMiddleware found no token)",
      props: { userType: UserType.Public },
      expected: true,
    },
    {
      name: "userType Public with a tenant header",
      props: { userType: UserType.Public, tenantId: ObjectID.generate() },
      expected: true,
    },
    {
      name: "userType User WITHOUT a userId",
      props: { userType: UserType.User },
      expected: true,
    },
    {
      name: "no userType and no userId at all",
      props: { userType: undefined, userId: undefined },
      expected: true,
    },
    {
      name: "an empty props object",
      props: {},
      expected: true,
    },
    {
      name: "isRoot without a userType or userId",
      props: { isRoot: true },
      expected: true,
    },
    {
      name: "isMasterAdmin without a userType or userId",
      props: { isMasterAdmin: true },
      expected: true,
    },
    {
      name: "isRoot and isMasterAdmin together, with a tenant and permissions",
      props: {
        isRoot: true,
        isMasterAdmin: true,
        tenantId: ObjectID.generate(),
        userTenantAccessPermission: {},
      },
      expected: true,
    },
  ];

  test.each(cases)(
    "$name -> anonymous: $expected",
    (testCase: IsAnonymousCase) => {
      expect(CommonAPI.isAnonymous(testCase.props)).toBe(testCase.expected);
    },
  );

  test("a userId makes the caller non-anonymous whatever the userType says", () => {
    expect(
      CommonAPI.isAnonymous({
        userId: ObjectID.generate(),
        userType: UserType.Public,
      }),
    ).toBe(false);
  });
});

describe("CommonAPI.assertCredentialsPresent", () => {
  test("the shared message is the exact log-in prompt", () => {
    expect(CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE).toBe(
      "Authentication required. Please log in to access this resource.",
    );
  });

  test("the 401 is ExceptionCode.NotAuthenticatedException, distinct from the 422 and the 400", () => {
    /*
     * Pinned numerically because the numbers are the contract with the
     * browser client, which refreshes on 401 and on nothing else.
     */
    expect(ExceptionCode.NotAuthenticatedException).toBe(401);
    expect(ExceptionCode.NotAuthorizedException).toBe(422);
    expect(ExceptionCode.BadDataException).toBe(400);
  });

  test("throws NotAuthenticatedException (401) with the exact message for an anonymous caller", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertCredentialsPresent({});
      }),
    );
  });

  test("throws for a UserType.Public caller carrying a tenant and a permission map", () => {
    const projectId: ObjectID = ObjectID.generate();

    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertCredentialsPresent(
          buildProps({
            tenantId: projectId,
            userType: UserType.Public,
            userTenantAccessPermission: {
              [projectId.toString()]: buildTenantPermission(projectId),
            },
          }),
        );
      }),
    );
  });

  test("throws for isRoot / isMasterAdmin flags with no credentials", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertCredentialsPresent({
          isRoot: true,
          isMasterAdmin: true,
        });
      }),
    );
  });

  test("passes for a logged-in user", () => {
    expect(() => {
      CommonAPI.assertCredentialsPresent({
        userId: ObjectID.generate(),
        userType: UserType.User,
      });
    }).not.toThrow();
  });

  test("passes for a project API key", () => {
    expect(() => {
      CommonAPI.assertCredentialsPresent({ userType: UserType.API });
    }).not.toThrow();
  });

  test("passes for a master admin", () => {
    expect(() => {
      CommonAPI.assertCredentialsPresent({ userType: UserType.MasterAdmin });
    }).not.toThrow();
  });

  test("does not look at the tenant: a credentialed caller with no tenant passes", () => {
    /*
     * The tenant is the NEXT question, asked by the guard that needs it. This
     * helper answers "who are you?" only.
     */
    expect(() => {
      CommonAPI.assertCredentialsPresent({
        userId: ObjectID.generate(),
        tenantId: undefined,
      });
    }).not.toThrow();
  });
});

/*
 * For routes that act AS a person. Three outcomes: no credentials -> 401,
 * credentials that are not a person (an API key) -> 422, a person -> their
 * userId.
 */
describe("CommonAPI.assertAuthenticatedUser", () => {
  test("returns the caller's userId", () => {
    const userId: ObjectID = ObjectID.generate();

    const returned: ObjectID = CommonAPI.assertAuthenticatedUser({
      userId: userId,
      userType: UserType.User,
    });

    expect(returned).toBe(userId);
  });

  test("returns the userId of a master admin who has one", () => {
    const userId: ObjectID = ObjectID.generate();

    expect(
      CommonAPI.assertAuthenticatedUser({
        userId: userId,
        userType: UserType.MasterAdmin,
      }),
    ).toBe(userId);
  });

  test("an anonymous caller is NotAuthenticatedException (401)", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedUser({ tenantId: ObjectID.generate() });
      }),
    );
  });

  test("an anonymous caller gets the log-in prompt, never the route's not-a-user message", () => {
    expectAuthenticationRequired(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedUser(
          { userType: UserType.Public },
          "A logged-in user is required.",
        );
      }),
    );
  });

  test("a project API key is NotAuthorizedException (422) with the default message", () => {
    expectNotAuthorized(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedUser(
          buildApiKeyProps(ObjectID.generate()),
        );
      }),
      "A logged-in user session is required.",
    );
  });

  test("a project API key gets the route's own message when one is given", () => {
    expectNotAuthorized(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedUser(
          { userType: UserType.API },
          "AI readiness requires a logged-in user session.",
        );
      }),
      "AI readiness requires a logged-in user session.",
    );
  });

  test("a master-key caller (MasterAdmin, no userId) is credentialed but not a person: 422", () => {
    expectNotAuthorized(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedUser({ userType: UserType.MasterAdmin });
      }),
      "A logged-in user session is required.",
    );
  });

  test("an empty custom message falls back to the default", () => {
    expectNotAuthorized(
      captureThrown(() => {
        CommonAPI.assertAuthenticatedUser({ userType: UserType.API }, "");
      }),
      "A logged-in user session is required.",
    );
  });
});

/*
 * One table across all four project guards: the anonymous caller is a 401 in
 * every shape it can arrive in, and nothing about the tenant or the grants it
 * claims changes that.
 */
describe("every project guard answers an anonymous caller with 401", () => {
  type GuardCase = {
    name: string;
    run: (props: DatabaseCommonInteractionProps) => void;
  };

  const guards: Array<GuardCase> = [
    {
      name: "assertAuthenticatedProjectMember",
      run: (props: DatabaseCommonInteractionProps): void => {
        CommonAPI.assertAuthenticatedProjectMember(props);
      },
    },
    {
      name: "assertAuthenticatedProjectPrincipal",
      run: (props: DatabaseCommonInteractionProps): void => {
        CommonAPI.assertAuthenticatedProjectPrincipal(props);
      },
    },
    {
      name: "assertTenantScoped",
      run: (props: DatabaseCommonInteractionProps): void => {
        CommonAPI.assertTenantScoped(props);
      },
    },
    {
      name: "assertPermittedInProject",
      run: (props: DatabaseCommonInteractionProps): void => {
        CommonAPI.assertPermittedInProject({
          databaseProps: props,
          allowedPermissions: [Permission.ProjectOwner, Permission.Public],
        });
      },
    },
    {
      name: "assertAuthenticatedUser",
      run: (props: DatabaseCommonInteractionProps): void => {
        CommonAPI.assertAuthenticatedUser(props);
      },
    },
  ];

  test.each(guards)("$name: no tenant header", (guard: GuardCase) => {
    expectAuthenticationRequired(
      captureThrown(() => {
        guard.run({});
      }),
    );
  });

  test.each(guards)(
    "$name: tenant header only (the expired-session request)",
    (guard: GuardCase) => {
      expectAuthenticationRequired(
        captureThrown(() => {
          guard.run({
            tenantId: ObjectID.generate(),
            userType: UserType.Public,
          });
        }),
      );
    },
  );

  test.each(guards)(
    "$name: tenant header plus a permission map claiming ProjectOwner",
    (guard: GuardCase) => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildPermittedProps({
        projectId: projectId,
        granted: [Permission.ProjectOwner],
      });

      props.userId = undefined;

      expectAuthenticationRequired(
        captureThrown(() => {
          guard.run(props);
        }),
      );
    },
  );

  test.each(guards)(
    "$name: a logged-in owner of the project is not refused as anonymous",
    (guard: GuardCase) => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildPermittedProps({
        projectId: projectId,
        granted: [Permission.ProjectOwner],
      });

      props.userType = UserType.User;

      expect(() => {
        guard.run(props);
      }).not.toThrow();
    },
  );
});
