import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BillingPermissions from "./BillingPermission";
import EditionPermissions from "./EditionPermission";
import PublicPermission from "./PublicPermission";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";

export default class TablePermission {
  @CaptureSpan()
  public static getTablePermission(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
  ): Array<Permission> {
    let modelPermissions: Array<Permission> = [];
    const model: BaseModel = new modelType();

    if (type === DatabaseRequestType.Create) {
      modelPermissions = model.createRecordPermissions;
    }

    if (type === DatabaseRequestType.Update) {
      modelPermissions = model.updateRecordPermissions;
    }

    if (type === DatabaseRequestType.Delete) {
      modelPermissions = model.deleteRecordPermissions;
    }

    if (type === DatabaseRequestType.Read) {
      modelPermissions = model.readRecordPermissions;
    }

    return modelPermissions;
  }

  /*
   * `updateData` is what an update writes, for the plan check: below a
   * table's update plan, an update that only switches records off is still
   * allowed, and only the data shows whether it does (BillingPermission).
   * Without it, such an update is refused.
   */
  @CaptureSpan()
  public static checkTableLevelPermissions(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    updateData?: unknown,
  ): void {
    // 1 CHECK: PUBLIC check -- Check if this is a public request and if public is allowed.
    PublicPermission.checkIfUserIsLoggedIn(modelType, props, type);

    // 2nd CHECK: Is user project in active state, and on the plan this needs?
    BillingPermissions.checkBillingPermissions(
      modelType,
      props,
      type,
      type === DatabaseRequestType.Update ? updateData : undefined,
    );

    /*
     * 3rd CHECK: Is this a create of enterprise configuration that the
     * edition or the license does not allow? (Reads and deletes always pass.)
     * Updates are checked by UpdatePermission.checkUpdatePermissions instead,
     * which every update runs and which sees what the update writes: an
     * update that only tightens security (rotating a SCIM token) needs no
     * license, and this check, which is not handed the data, could only
     * refuse it.
     */
    if (type !== DatabaseRequestType.Update) {
      EditionPermissions.checkEditionPermissions(modelType, props, type);
    }

    /*
     * 4th CHECK: Does user have access to CRUD data on this model - an allow
     * row for one of its permissions, or for the operational-resource
     * wildcard (HeldPermissionsUtil). Blocks are refused in a step of their
     * own (checkTableLevelBlockPermissions).
     */
    const modelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, type);

    if (
      !HeldPermissionsUtil.isGrantedAny(
        TablePermission.getHeldPermissions(props),
        modelPermissions,
        { wildcard: TablePermission.getModelWildcard(modelType, type) },
      )
    ) {
      const permissions: Array<string> =
        PermissionHelper.getPermissionTitles(modelPermissions);

      if (permissions.length === 0) {
        throw new NotAuthorizedException(
          `${type} on ${new modelType().singularName} is not allowed.`,
        );
      }

      throw new NotAuthorizedException(
        `You do not have permissions to ${type} ${
          new modelType().singularName
        }. You need one of these permissions: ${permissions.join(", ")}`,
      );
    }
  }

  /*
   * What the caller holds, read as the CRUD path reads it: the allow rows
   * and global permissions (Public among them for everyone) and the block
   * rows (DatabaseCommonInteractionPropsUtil.getPermissionRows).
   */
  public static getHeldPermissions(
    props: DatabaseCommonInteractionProps,
  ): HeldPermissions {
    return HeldPermissionsUtil.fromRows({
      rows: DatabaseCommonInteractionPropsUtil.getPermissionRows(props),
    });
  }

  /*
   * The *AllOperationalResources wildcard an operation on the model accepts
   * as well (ReadAllOperationalResources for read, EditAllOperationalResources
   * for update, ...): models marked @OperationalResource only. Scope
   * (All/Owned/Labels) on the permission row is evaluated in a later step,
   * not here.
   */
  public static getModelWildcard(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
  ): Permission | null {
    return HeldPermissionsUtil.getModelWildcard({
      isOperationalResource: new modelType().isOperationalResource,
      operation: type,
    });
  }

  /*
   * The permissions whose allow rows grant this operation
   * (HeldPermissionsUtil.getGrantingPermissions): the model's own list, and
   * its wildcard unless a block with no labels takes the wildcard away or
   * the list is empty (nobody may do the operation). For a later step that
   * weighs the scope of the rows that grant (OwnedScopePermission).
   */
  public static getGrantingPermissions(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
    props: DatabaseCommonInteractionProps,
  ): Array<Permission> {
    return HeldPermissionsUtil.getGrantingPermissions(
      TablePermission.getHeldPermissions(props),
      {
        modelPermissions: TablePermission.getTablePermission(modelType, type),
        wildcard: TablePermission.getModelWildcard(modelType, type),
      },
    );
  }

  /*
   * A WRITE NEEDS A READ. An update or a delete reaches only records the
   * caller may read (BasePermission.addRecordScopeToQuery), so a caller who
   * may read none of the table's records changes and deletes none of them:
   * one who holds none of the table's read permissions (nor its read
   * wildcard), or whose block with no labels takes one of them away. Refused
   * like a missing write permission, naming the read permissions it needs.
   */
  @CaptureSpan()
  public static checkTableLevelReadForWrite(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): void {
    const model: BaseModel = new modelType();
    const readPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, DatabaseRequestType.Read);
    const held: HeldPermissions = TablePermission.getHeldPermissions(props);

    const blockedReadPermission: Permission | undefined = readPermissions.find(
      (permission: Permission): boolean => {
        return held.blocked.includes(permission);
      },
    );

    if (blockedReadPermission) {
      throw new NotAuthorizedException(
        `You are not authorized to ${type} ${model.singularName} because you may not read it: ${blockedReadPermission} is in your team's permission block list.`,
      );
    }

    if (
      HeldPermissionsUtil.isGrantedAny(held, readPermissions, {
        wildcard: TablePermission.getModelWildcard(
          modelType,
          DatabaseRequestType.Read,
        ),
      })
    ) {
      return;
    }

    const titles: Array<string> =
      PermissionHelper.getPermissionTitles(readPermissions);

    if (titles.length === 0) {
      throw new NotAuthorizedException(
        `${type} on ${model.singularName} is not allowed: nobody may read it.`,
      );
    }

    throw new NotAuthorizedException(
      `You do not have permissions to ${type} ${
        model.singularName
      }: changing or deleting a record needs permission to read it too. You need one of these permissions: ${titles.join(
        ", ",
      )}`,
    );
  }

  @CaptureSpan()
  public static checkTableLevelBlockPermissions(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): void {
    // 1 CHECK: PUBLIC check -- Check if this is a public request and if public is allowed.
    PublicPermission.checkIfUserIsLoggedIn(modelType, props, type);

    // 2nd CHECK: Does user have access to CRUD data on this model.
    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      );

    const modelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, type);

    /*
     * The user gets one block row per TeamPermission across all of their
     * teams, unmerged and unordered, so the same permission can be blocked
     * both for some labels and for the whole table. A row without labels
     * blocks the whole table and must win whichever row comes first:
     * ReadPermission and AccessControlPermission only enforce the labelled
     * rows, so an unlabelled row missed here is enforced nowhere.
     */
    const tableWideBlock: UserPermission | undefined = userPermissions.find(
      (userPermission: UserPermission) => {
        return (
          modelPermissions.includes(userPermission.permission) &&
          (!userPermission.labelIds || userPermission.labelIds.length === 0)
        );
      },
    );

    if (tableWideBlock) {
      throw new NotAuthorizedException(
        `You are not authorized to ${type} ${
          new modelType().singularName
        } because ${
          tableWideBlock.permission
        } is in your team's permission block list.`,
      );
    }
  }
}
