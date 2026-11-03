import AnalyticsBaseModel from "../../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../../../Models/AnalyticsModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseModels from "../../../../../Models/DatabaseModels/Index";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import HeldPermissionsUtil from "../../../../../Types/HeldPermissions";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../../../Types/Permission";

/*
 * WHAT A SCOPE NARROWS, WORKED OUT FROM THE MODELS BY THE SERVER'S RULES -
 * what Types/Database/AccessControl/PermissionScopeNarrowing writes down for
 * the dashboard, which carries no server code.
 *
 * For every operation a model lists permissions for (and the
 * *AllOperationalResources wildcard an operational resource accepts beside
 * them, as the CRUD path does):
 *
 *   - labels narrow it on a database model whose records carry labels, or
 *     belong to or name records that do - the condition a grant limited to
 *     labels keeps the rows of a label-less model by
 *     (ReadPermission.getGrantedLabelsCondition), which is null for a model
 *     whose rows name no labelled record: "a grant limited to labels reaches
 *     every one";
 *   - owners narrow it where the Owned scope holds the operation to owners
 *     (OwnedScopePermission.narrowsRecords);
 *   - on an analytics model, both narrow it when its rows belong to a
 *     resource (@OwnedThrough), whose labels and owners the telemetry scope
 *     reads (Server/Types/AnalyticsDatabase/ModelPermission.getReadScope);
 *     without one, neither does.
 *
 * Kept to what a team, a custom role or an API key can be given
 * (isAssignableToTenant) and a scope can narrow at all
 * (PermissionHelper.isScopeApplicable: not Project Owner, Project Admin or
 * the Settings and Billing roles, which reach the whole project whatever
 * their row says).
 */

export interface ScopeNarrowingFromModels {
  byLabels: Set<Permission>;
  byOwners: Set<Permission>;
}

const OPERATIONS: Array<DatabaseRequestType> = [
  DatabaseRequestType.Create,
  DatabaseRequestType.Read,
  DatabaseRequestType.Update,
  DatabaseRequestType.Delete,
];

// Any label: the condition depends on the model, not on which labels.
const A_LABEL: ObjectID = new ObjectID("0d0c0de0-0000-4000-8000-00000000a001");

interface ModelWithPermissions {
  isOperationalResource: boolean;
  getCreatePermissions: () => Array<Permission>;
  getReadPermissions: () => Array<Permission>;
  getUpdatePermissions: () => Array<Permission>;
  getDeletePermissions: () => Array<Permission>;
}

/*
 * The permissions an operation on a model accepts: its own list, and the
 * operation's wildcard on an operational resource - which never opens an
 * operation nobody may do (an empty list).
 */
const getOperationPermissions: (
  model: ModelWithPermissions,
  operation: DatabaseRequestType,
) => Array<Permission> = (
  model: ModelWithPermissions,
  operation: DatabaseRequestType,
): Array<Permission> => {
  const listed: Array<Permission> =
    (operation === DatabaseRequestType.Create
      ? model.getCreatePermissions()
      : operation === DatabaseRequestType.Read
        ? model.getReadPermissions()
        : operation === DatabaseRequestType.Update
          ? model.getUpdatePermissions()
          : model.getDeletePermissions()) || [];

  if (listed.length === 0) {
    return [];
  }

  const wildcard: Permission | null = HeldPermissionsUtil.getModelWildcard({
    isOperationalResource: model.isOperationalResource,
    operation: operation,
  });

  return wildcard ? [...listed, wildcard] : listed;
};

export const getScopeNarrowingFromModels: () => ScopeNarrowingFromModels =
  (): ScopeNarrowingFromModels => {
    const byLabels: Set<Permission> = new Set<Permission>();
    const byOwners: Set<Permission> = new Set<Permission>();

    const add: (
      permissions: Array<Permission>,
      narrowedBy: { labels: boolean; owners: boolean },
    ) => void = (
      permissions: Array<Permission>,
      narrowedBy: { labels: boolean; owners: boolean },
    ): void => {
      for (const permission of permissions) {
        if (narrowedBy.labels) {
          byLabels.add(permission);
        }

        if (narrowedBy.owners) {
          byOwners.add(permission);
        }
      }
    };

    for (const modelType of DatabaseModels) {
      const model: BaseModel = new modelType();
      const labels: boolean =
        Boolean(model.getAccessControlColumn()) ||
        ReadPermission.getGrantedLabelsCondition(modelType, [A_LABEL]) !== null;

      for (const operation of OPERATIONS) {
        add(getOperationPermissions(model, operation), {
          labels: labels,
          owners: OwnedScopePermission.narrowsRecords(modelType, operation),
        });
      }
    }

    for (const modelType of AnalyticsModels) {
      const model: AnalyticsBaseModel = new modelType();
      const ofAResource: boolean = Boolean(
        (model as unknown as { ownedThrough?: unknown }).ownedThrough,
      );

      for (const operation of OPERATIONS) {
        add(getOperationPermissions(model, operation), {
          labels: ofAResource,
          owners: ofAResource,
        });
      }
    }

    const scopable: Set<Permission> = new Set<Permission>(
      PermissionHelper.getTenantPermissionProps()
        .filter((props: PermissionProps): boolean => {
          return PermissionHelper.isScopeApplicable(props.permission);
        })
        .map((props: PermissionProps): Permission => {
          return props.permission;
        }),
    );

    const keepScopable: (permissions: Set<Permission>) => Set<Permission> = (
      permissions: Set<Permission>,
    ): Set<Permission> => {
      return new Set<Permission>(
        Array.from(permissions).filter((permission: Permission): boolean => {
          return scopable.has(permission);
        }),
      );
    };

    return {
      byLabels: keepScopable(byLabels),
      byOwners: keepScopable(byOwners),
    };
  };
