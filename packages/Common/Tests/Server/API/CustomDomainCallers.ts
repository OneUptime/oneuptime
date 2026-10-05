import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * A signed-in caller of the custom domain routes: a user in one project,
 * holding exactly `permissions` there - scoped to `labelIds` when given -
 * and `blocks` as their team's block rows (unlabelled, so table-wide). The
 * route suites run the server's own permission checks on it rather than a
 * stub of them.
 *
 * A fresh object per call: the permission layer adds the Public and Current
 * User permissions to the props it is handed.
 */
export function customDomainCaller(data: {
  permissions: Array<Permission>;
  projectId?: ObjectID | undefined;
  labelIds?: Array<ObjectID> | undefined;
  blocks?: Array<Permission> | undefined;
  isReadOnlyCredential?: boolean | undefined;
  isMasterAdmin?: boolean | undefined;
  // A project API key: no user, the key's own permissions.
  isApiKey?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const projectId: ObjectID = data.projectId || ObjectID.generate();

  const grants: Array<UserPermission> = [
    ...data.permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: data.labelIds || [],
        isBlockPermission: false,
      };
    }),
    ...(data.blocks || []).map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ];

  const props: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: grants,
      },
    },
  };

  if (data.isApiKey) {
    delete props.userId;
    props.userType = UserType.API;
  }

  if (data.isReadOnlyCredential) {
    props.isReadOnlyCredential = true;
  }

  if (data.isMasterAdmin) {
    props.isMasterAdmin = true;
  }

  return props;
}
