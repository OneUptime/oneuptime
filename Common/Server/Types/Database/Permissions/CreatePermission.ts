import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "./ColumnPermission";
import TablePermission from "./TablePermission";
import TenantPermission from "./TenantPermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class CreatePermission {
  @CaptureSpan()
  public static checkCreatePermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): void {
    // If system is making this query then let the query run!
    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    // check block permissions, if any. Block permission get precedence over allow permissions.
    this.checkCreateBlockPermissions(modelType, props);

    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Create,
    );

    ColumnPermissions.checkDataColumnPermissions(
      modelType,
      data,
      props,
      DatabaseRequestType.Create,
    );

    CreatePermission.checkCreateOwnership(modelType, data, props);
  }

  /**
   * Constrain the VALUE of a user-scoped model's ownership column, not merely
   * whether the caller is allowed to write that column at all.
   *
   * Read, update and delete all convert Permission.CurrentUser into a row
   * predicate: TenantPermission.addCurrentUserScopeToQuery rewrites the query to
   * `userId = me` and rejects any operation that named somebody else. Create had
   * no equivalent. The three checks above answer "may this caller write to this
   * table" and "may this caller write to these COLUMNS" — neither receives the
   * ownership value, and TablePermission.checkTableLevelPermissions is not even
   * handed the data object. So @CurrentUserCanAccessRecordBy was effectively
   * dead metadata on this path, and the carve-out is explicit in the sibling
   * code: TenantPermission's misconfiguration guard reads
   * `isAccessGrantedOnlyByCurrentUser && type !== DatabaseRequestType.Create`.
   *
   * The consequence was that a caller could write a row owned by somebody else
   * on any model whose create list is CurrentUser-only — fourteen of them, all
   * "my own X" resources: notification rules and every notification method
   * behind them, sessions, TOTP and WebAuthn credentials. On the notification
   * models that is not a bookkeeping error. A row's ownership column decides
   * whose on-call pages select it, while the delivery address is read from the
   * method relation the row points at, so a mismatched pair sends one person's
   * pages to another person's address. Some services also seed further rows from
   * whatever ownership value they are handed, which propagates the mistake
   * without any further request.
   *
   * The check is permission-AWARE rather than a blanket stamp, and that
   * distinction is load-bearing. Stamping `data[userColumn] = props.userId`
   * unconditionally would make legitimate on-behalf-of creation impossible for
   * an administrator who genuinely holds a role permission in the model's create
   * list — so instead this mirrors exactly the condition the query-side scope
   * uses. When CurrentUser is the ONLY thing letting the caller through, they
   * may create rows for themselves and nobody else. When they hold a real role
   * permission, this returns and that permission's own rules apply.
   *
   * props.isRoot short-circuits before this runs, so internal seeding (default
   * notification rules, invitation acceptance, migrations) is unaffected.
   */
  private static checkCreateOwnership<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): void {
    const model: BaseModel = new modelType();
    const userColumn: string | null = model.getUserColumn();

    if (!userColumn) {
      // The model does not scope rows by user; there is no ownership to enforce.
      return;
    }

    const isAccessGrantedOnlyByCurrentUser: boolean =
      TenantPermission.isAccessGrantedOnlyByCurrentUser(
        modelType,
        props,
        DatabaseRequestType.Create,
      );

    if (!isAccessGrantedOnlyByCurrentUser) {
      /*
       * The caller holds a role permission that appears in this model's create
       * list, so they are not here purely as "some logged-in user". Whatever
       * that permission is allowed to do is decided by the permission itself.
       */
      return;
    }

    /*
     * CurrentUser is auto-granted to every authenticated caller, including API
     * keys, which have no user identity. Such a grant can never be resolved to
     * an owner, so reject it rather than writing an unowned row. This mirrors
     * the equivalent guard on the query side.
     */
    if (!props.userId) {
      throw new NotAuthorizedException(
        `A user session is required to create ${model.singularName}.`,
      );
    }

    /*
     * The ownership column has TWO spellings and both write the same database
     * column.
     *
     * A user-scoped model declares a scalar (`userId`) and a ManyToOne relation
     * (`user`) whose @JoinColumn names that same scalar. Both are separately
     * decorated, both are separately creatable, and TypeORM resolves either into
     * the one join column. Checking only the scalar would therefore close
     * nothing: a payload sending `user: { _id: <someone else> }` and no `userId`
     * reaches this method with the scalar absent, gets the caller's own id
     * stamped onto it, and then hands the persistence layer two disagreeing
     * instructions about who owns the row.
     *
     * So the relation is validated identically and then CLEARED. Clearing rather
     * than merely rejecting a mismatch removes the ambiguity entirely — after
     * this method the scalar is the single source of ownership, and no
     * TypeORM-version-dependent precedence rule between the two spellings can
     * change who the row belongs to.
     *
     * The relation's property name is the scalar minus its `Id` suffix, which
     * holds for every user-scoped model in the schema. A model that does not
     * follow it simply has no relation to clear, and the scalar check below
     * still applies.
     */
    const relationColumn: string = userColumn.endsWith("Id")
      ? userColumn.slice(0, -2)
      : "";

    const suppliedOwnerRelation: unknown = relationColumn
      ? data.getColumnValue(relationColumn)
      : undefined;

    if (
      suppliedOwnerRelation !== undefined &&
      suppliedOwnerRelation !== null &&
      typeof suppliedOwnerRelation === "object"
    ) {
      const relationOwnerId: unknown = (
        suppliedOwnerRelation as Record<string, unknown>
      )["_id"];

      if (
        relationOwnerId !== undefined &&
        relationOwnerId !== null &&
        String(relationOwnerId) !== (props.userId as ObjectID).toString()
      ) {
        throw new NotAuthorizedException(
          `You do not have permission to create another user's ${model.singularName}.`,
        );
      }

      data.setColumnValue(relationColumn, undefined);
    }

    const suppliedOwner: unknown = data.getColumnValue(userColumn);

    if (suppliedOwner === undefined || suppliedOwner === null) {
      /*
       * Omitting the column is the common case for a first-party client, which
       * has no reason to send its own id back. Stamp it rather than leaving the
       * row unowned — an unowned row is invisible to every scoped read, so it
       * would be undeletable through the API that created it.
       */
      data.setColumnValue(userColumn, props.userId);

      return;
    }

    const suppliedOwnerId: string =
      suppliedOwner instanceof ObjectID
        ? suppliedOwner.toString()
        : String(suppliedOwner);

    if (suppliedOwnerId !== (props.userId as ObjectID).toString()) {
      throw new NotAuthorizedException(
        `You do not have permission to create another user's ${model.singularName}.`,
      );
    }
  }

  @CaptureSpan()
  public static checkCreateBlockPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
  ): void {
    // If system is making this query then let the query run!
    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    TablePermission.checkTableLevelBlockPermissions(
      modelType,
      props,
      DatabaseRequestType.Create,
    );
  }
}
