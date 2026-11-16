import { describe, expect, test } from "@jest/globals";
import IncomingRequestSecret from "../../../../../Models/DatabaseModels/IncomingRequestSecret";
import Project from "../../../../../Models/DatabaseModels/Project";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "../../../../../Types/BaseDatabase/Query";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import MonitorSecretAccess from "../../../../../Types/Monitor/MonitorSecretAccess";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../../../Types/Permission";
import { getPermissionPropsAllowedInCustomRole } from "../../../../../Types/Team/CustomRole";

/*
 * A custom role and a project's incoming request secrets (issue #8502), down
 * to the server: the real gates of the database layer on the real models'
 * lists, as a request's own props reach them.
 *
 *   - the four Incoming Request Secret permissions are offered to a custom
 *     role, under Monitor, and each opens exactly its operation;
 *   - Edit Incoming Request Secret also turns the project's requirement on
 *     or off - and changes nothing else of the project;
 *   - a role without them - none at all, or every monitor permission, or a
 *     Monitor Admin - can do none of it.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

const SECRET_QUERY: Query<IncomingRequestSecret> = {
  projectId: PROJECT_ID,
} as Query<IncomingRequestSecret>;

/*
 * A member holding these: every member of a project holds Project User too
 * (AccessTokenService), which reads the project itself and none of this.
 */
function propsHolding(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userTeamIds: [],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [Permission.ProjectUser, ...permissions].map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission,
              labelIds: [],
              scope: PermissionScope.All,
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

const ALL_FOUR: Array<Permission> = [
  Permission.CreateIncomingRequestSecret,
  Permission.ReadIncomingRequestSecret,
  Permission.EditIncomingRequestSecret,
  Permission.DeleteIncomingRequestSecret,
];

const MANAGER: DatabaseCommonInteractionProps = propsHolding(ALL_FOUR);

// Roles that must open none of it.
const WITHOUT: Array<[string, DatabaseCommonInteractionProps]> = [
  ["no permission", propsHolding([])],
  [
    "every monitor permission",
    propsHolding([
      Permission.CreateProjectMonitor,
      Permission.ReadProjectMonitor,
      Permission.EditProjectMonitor,
      Permission.DeleteProjectMonitor,
      Permission.CreateMonitorSecret,
      Permission.ReadMonitorSecret,
      Permission.EditMonitorSecret,
      Permission.DeleteMonitorSecret,
    ]),
  ],
  ["Monitor Admin", propsHolding([Permission.MonitorAdmin])],
  ["Project Member", propsHolding([Permission.ProjectMember])],
];

const newSecret: () => IncomingRequestSecret = (): IncomingRequestSecret => {
  const secret: IncomingRequestSecret = new IncomingRequestSecret();
  secret.projectId = PROJECT_ID;
  secret.name = "Tenant A";
  secret.monitorAccess = MonitorSecretAccess.AllMonitors;
  return secret;
};

const readSecrets: (
  props: DatabaseCommonInteractionProps,
) => Promise<unknown> = (
  props: DatabaseCommonInteractionProps,
): Promise<unknown> => {
  return ModelPermission.checkReadQueryPermission(
    IncomingRequestSecret,
    SECRET_QUERY,
    {
      _id: true,
      name: true,
      secretValue: true,
      monitorAccess: true,
      lastUsedAt: true,
    },
    props,
  );
};

const renameSecret: (
  props: DatabaseCommonInteractionProps,
) => Promise<unknown> = (
  props: DatabaseCommonInteractionProps,
): Promise<unknown> => {
  return ModelPermission.checkUpdateQueryPermissions(
    IncomingRequestSecret,
    SECRET_QUERY,
    { name: "Tenant B", monitorAccess: MonitorSecretAccess.SpecificMonitors },
    props,
  );
};

const deleteSecret: (
  props: DatabaseCommonInteractionProps,
) => Promise<unknown> = (
  props: DatabaseCommonInteractionProps,
): Promise<unknown> => {
  return ModelPermission.checkDeleteQueryPermission(
    IncomingRequestSecret,
    SECRET_QUERY,
    props,
  );
};

describe("the Incoming Request Secret permissions", () => {
  test("are offered to a custom role, under Monitor, saying what each opens", () => {
    const offered: Map<Permission, PermissionProps> = new Map(
      getPermissionPropsAllowedInCustomRole().map(
        (props: PermissionProps): [Permission, PermissionProps] => {
          return [props.permission, props];
        },
      ),
    );

    for (const permission of ALL_FOUR) {
      const props: PermissionProps | undefined = offered.get(permission);

      expect({ permission, offered: Boolean(props) }).toEqual({
        permission,
        offered: true,
      });
      expect(props!.group).toBe(PermissionGroup.Monitor);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(props!.isRolePermission).toBe(false);
      expect(props!.title).toContain("Incoming Request Secret");
      expect(props!.description).toContain("incoming request secret");
    }

    // Reading them is reading the values: the picker says so.
    expect(
      offered.get(Permission.ReadIncomingRequestSecret)!.description,
    ).toContain("values included");
    // Edit is what turns the requirement on or off.
    expect(
      offered.get(Permission.EditIncomingRequestSecret)!.description,
    ).toContain("Require a secret on every request");
  });

  test("no built-in role below the admins holds them", () => {
    const roles: Array<Permission> = PermissionHelper.getRolePermissionProps()
      .map((props: PermissionProps): Permission => {
        return props.permission;
      })
      .filter((role: Permission): boolean => {
        return (
          role !== Permission.ProjectOwner && role !== Permission.ProjectAdmin
        );
      });

    const secret: IncomingRequestSecret = new IncomingRequestSecret();

    for (const role of roles) {
      for (const list of [
        secret.getCreatePermissions(),
        secret.getReadPermissions(),
        secret.getUpdatePermissions(),
        secret.getDeletePermissions(),
      ]) {
        expect({ role, listed: list.includes(role) }).toEqual({
          role,
          listed: false,
        });
      }
    }
  });
});

describe("a custom role holding them", () => {
  test("reads the secrets, their values included", async () => {
    await expect(readSecrets(MANAGER)).resolves.toBeDefined();
  });

  test("creates one", () => {
    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncomingRequestSecret,
        newSecret(),
        MANAGER,
      );
    }).not.toThrow();
  });

  test("renames one and changes which monitors it covers", async () => {
    await expect(renameSecret(MANAGER)).resolves.toBeDefined();
  });

  test("deletes one", async () => {
    await expect(deleteSecret(MANAGER)).resolves.toBeDefined();
  });

  test("turns the project's requirement on or off", async () => {
    await expect(
      ModelPermission.checkUpdateQueryPermissions(
        Project,
        { _id: PROJECT_ID.toString() } as Query<Project>,
        { requireIncomingRequestSecret: true },
        propsHolding([Permission.EditIncomingRequestSecret]),
      ),
    ).resolves.toBeDefined();
  });

  test("changes nothing else of the project with it", async () => {
    await expect(
      ModelPermission.checkUpdateQueryPermissions(
        Project,
        { _id: PROJECT_ID.toString() } as Query<Project>,
        { name: "Renamed by the secrets manager" },
        propsHolding([Permission.EditIncomingRequestSecret]),
      ),
    ).rejects.toThrow(/not allowed to update on name column of Project/);
  });

  test("each permission opens its own operation alone", async () => {
    // Read alone: reads, writes nothing.
    const readOnly: DatabaseCommonInteractionProps = propsHolding([
      Permission.ReadIncomingRequestSecret,
    ]);

    await expect(readSecrets(readOnly)).resolves.toBeDefined();
    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncomingRequestSecret,
        newSecret(),
        readOnly,
      );
    }).toThrow(NotAuthorizedException);
    await expect(renameSecret(readOnly)).rejects.toThrow(
      NotAuthorizedException,
    );
    await expect(deleteSecret(readOnly)).rejects.toThrow(
      NotAuthorizedException,
    );

    // Create alone: creates, reads nothing back.
    const createOnly: DatabaseCommonInteractionProps = propsHolding([
      Permission.CreateIncomingRequestSecret,
    ]);

    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncomingRequestSecret,
        newSecret(),
        createOnly,
      );
    }).not.toThrow();
    await expect(readSecrets(createOnly)).rejects.toThrow(
      NotAuthorizedException,
    );
  });
});

describe.each(WITHOUT)(
  "a role with %s",
  (_name: string, props: DatabaseCommonInteractionProps) => {
    test("reads no secret", async () => {
      await expect(readSecrets(props)).rejects.toThrow(NotAuthorizedException);
    });

    test("creates none", () => {
      expect(() => {
        ModelPermission.checkCreatePermissions(
          IncomingRequestSecret,
          newSecret(),
          props,
        );
      }).toThrow(NotAuthorizedException);
    });

    test("changes none", async () => {
      await expect(renameSecret(props)).rejects.toThrow(NotAuthorizedException);
    });

    test("deletes none", async () => {
      await expect(deleteSecret(props)).rejects.toThrow(NotAuthorizedException);
    });

    test("cannot turn the requirement on or off", async () => {
      await expect(
        ModelPermission.checkUpdateQueryPermissions(
          Project,
          { _id: PROJECT_ID.toString() } as Query<Project>,
          { requireIncomingRequestSecret: false },
          props,
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });
  },
);
