import Query from "../Query";
import Select from "../Select";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  getOwnerOnlyColumns,
  isOwnerOnlyColumn,
} from "../../../../Types/Database/AccessControl/OwnerOnlyColumn";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/*
 * THE RULE, IN ONE SENTENCE.
 *
 * A column marked @OwnerOnlyColumn() may be read only when the query that
 * reaches its row is pinned to the caller's own id. The owner reading their own
 * settings passes. An administrator reading somebody else's does not - whether
 * they come at the column directly, or sideways through a relation, or by
 * ordering on it, or by probing it in a WHERE clause.
 *
 * WHY A COLUMN-PERMISSION LIST CANNOT EXPRESS THIS. Permission.CurrentUser is
 * auto-granted to every authenticated caller, so it never means "only my own
 * row" in a COLUMN list - row scoping comes from the TABLE list alone. This
 * class therefore ignores permissions entirely and looks at the QUERY: not who
 * is asking, but which rows the request is allowed to touch.
 *
 * THE FOUR ROUTES INTO A MARKED COLUMN. All four are closed here, because
 * closing three of them is the same as closing none:
 *
 *   1. A top-level select - `select: { webhookUrl: true }` on UserWebhook.
 *      checkSelectPermission(), called from BasePermission.
 *
 *   2. A select nested through a relation - `select: { userWebhook: {
 *      webhookUrl: true } }` on UserNotificationRule. checkRelationSelect(),
 *      called from inside QueryPermission's relation traversal. This is the
 *      route an earlier attempt missed, and it is the one that matters most:
 *      widening a rule table's read to administrators does not widen the method
 *      tables' reads, so a nested select is how the credential escapes without
 *      anything appearing to have been widened at all.
 *
 *   3. A sort key - `sort: { webhookUrl: "ASC" }`. DatabaseService adds sorted
 *      columns to the select AFTER the permission layer has run, so the gate is
 *      simply not in the path; isOwnerOnlyColumnOnModel() lets that code refuse
 *      to add a marked column.
 *
 *   4. A WHERE predicate - `query: { webhookUrl: "https://..." }`. Equality on a
 *      secret is a value oracle: enough queries and the value is read out one
 *      guess at a time, with nothing ever selected. checkQueryPermission().
 *
 * FAIL CLOSED. No caller identity, no ownership column on the model, a query
 * shape this code does not recognise, or an ownership predicate that names
 * anything other than exactly one id - the caller's - all refuse. The cost of a
 * false refusal is a visible error on a settings page. The cost of a false
 * allowance is a colleague's phone number.
 */
export default class OwnerOnlyColumnPermission {
  /**
   * Route 1 - a marked column named directly in the select of the model that
   * owns it.
   */
  @CaptureSpan()
  public static checkSelectPermission<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    select: Select<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (OwnerOnlyColumnPermission.isPrivilegedInternalRead(props)) {
      return;
    }

    const model: BaseModel = new modelType();

    for (const columnName in select) {
      if (!isOwnerOnlyColumn(model, columnName)) {
        continue;
      }

      if (
        !OwnerOnlyColumnPermission.isQueryPinnedToCurrentUser(
          modelType,
          query,
          props,
        )
      ) {
        throw OwnerOnlyColumnPermission.refusal(model, columnName);
      }
    }
  }

  /**
   * Route 2 - a marked column named through a relation, where the OUTER query
   * is the only thing that decides whether the related rows belong to the
   * caller.
   *
   * The outer query is what gets checked, and it has to be. By the time the
   * traversal reaches `userWebhook: { webhookUrl: true }` there is no separate
   * permission pass over UserWebhook at all: the related rows are whichever
   * rows the outer query's join drags in. So the question is not "may this
   * caller read UserWebhook" - it is "is the outer query confined to rows this
   * caller owns", and that is answered by the outer model's own ownership
   * column.
   */
  @CaptureSpan()
  public static checkRelationSelect(data: {
    modelType: DatabaseBaseModelType;
    relationColumnName: string;
    relatedModelType: DatabaseBaseModelType;
    relatedColumnName: string;
    query: Query<BaseModel>;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (OwnerOnlyColumnPermission.isPrivilegedInternalRead(data.props)) {
      return;
    }

    const relatedModel: BaseModel = new data.relatedModelType();

    if (!isOwnerOnlyColumn(relatedModel, data.relatedColumnName)) {
      return;
    }

    if (
      OwnerOnlyColumnPermission.isQueryPinnedToCurrentUser(
        data.modelType,
        data.query,
        data.props,
      )
    ) {
      return;
    }

    const model: BaseModel = new data.modelType();

    throw new NotAuthorizedException(
      `You do not have permissions to read ${data.relatedColumnName} of ${relatedModel.singularName} through ${data.relationColumnName} on ${model.singularName}. This column belongs to the user it was created for, so it can only be read by a query restricted to your own records.`,
    );
  }

  /**
   * Route 4 - a marked column used as a query predicate. Reading a value and
   * guessing it are the same disclosure given enough attempts, so a WHERE on a
   * marked column is held to the identical standard as a select on it. Nested
   * relation filters are walked too, because `{ userWebhook: { webhookUrl: x } }`
   * probes exactly the same value from one level out.
   */
  @CaptureSpan()
  public static checkQueryPermission<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (OwnerOnlyColumnPermission.isPrivilegedInternalRead(props)) {
      return;
    }

    const model: BaseModel = new modelType();

    for (const columnName in query) {
      if (isOwnerOnlyColumn(model, columnName)) {
        if (
          !OwnerOnlyColumnPermission.isQueryPinnedToCurrentUser(
            modelType,
            query,
            props,
          )
        ) {
          throw OwnerOnlyColumnPermission.refusal(model, columnName);
        }

        continue;
      }

      const value: unknown = (query as Record<string, unknown>)[columnName];

      if (!OwnerOnlyColumnPermission.isPlainObject(value)) {
        continue;
      }

      const tableColumnMetadata: TableColumnMetadata =
        model.getTableColumnMetadata(columnName);

      if (
        !tableColumnMetadata ||
        !tableColumnMetadata.modelType ||
        (tableColumnMetadata.type !== TableColumnType.Entity &&
          tableColumnMetadata.type !== TableColumnType.EntityArray)
      ) {
        continue;
      }

      const relatedModel: BaseModel = new tableColumnMetadata.modelType();

      for (const relatedColumnName in value as Record<string, unknown>) {
        if (!isOwnerOnlyColumn(relatedModel, relatedColumnName)) {
          continue;
        }

        if (
          !OwnerOnlyColumnPermission.isQueryPinnedToCurrentUser(
            modelType,
            query,
            props,
          )
        ) {
          throw new NotAuthorizedException(
            `You do not have permissions to query on ${relatedColumnName} of ${relatedModel.singularName} through ${columnName} on ${model.singularName}. This column belongs to the user it was created for, so it can only be queried by a request restricted to your own records.`,
          );
        }
      }
    }
  }

  /**
   * Route 3's building block. DatabaseService injects sorted columns into the
   * select after the permission layer has already run, and it has no query it
   * can trust by then (the query has been serialized into Raw operators), so it
   * asks the only question it can answer safely: is this column marked. A
   * marked column that the caller legitimately selected is already in the
   * select and is never re-added, so refusing here costs a legitimate reader
   * nothing.
   */
  public static isOwnerOnlyColumnOnModel(
    modelType: DatabaseBaseModelType,
    columnName: string,
  ): boolean {
    return isOwnerOnlyColumn(new modelType(), columnName);
  }

  public static getOwnerOnlyColumnsOnModel(
    modelType: DatabaseBaseModelType,
  ): Array<string> {
    return getOwnerOnlyColumns(new modelType());
  }

  /**
   * "Pinned to the caller" means the query constrains this model's
   * @CurrentUserCanAccessRecordBy column to exactly one id, and that id is the
   * caller's.
   *
   * Every part of that sentence is load bearing:
   *
   *   - props.userId absent - an API key or a system caller can hold the
   *     auto-granted CurrentUser permission with no user identity at all. There
   *     is no id to pin to, so there is no pinning.
   *
   *   - no ownership column - the model has no notion of an owner, so no query
   *     against it can be owner-scoped. A marked column on such a model is a
   *     modelling mistake; refuse rather than invent a scope.
   *
   *   - exactly one id - operators are the trap. NotEqual, Includes, IsNull and
   *     friends all stringify to (or contain) the id they wrap, so comparing
   *     string values alone would let `userId != me` pass itself off as `userId
   *     = me` while selecting every OTHER row in the project. Compare the TYPE
   *     first: only a bare string or ObjectID is an exact predicate. This is the
   *     same test, and for the same reason, as TenantPermission.isExactUserScope.
   *
   *   - an array of queries is refused outright. That shape is produced only by
   *     the multi-tenant fan-out in TenantPermission, which re-enters the whole
   *     permission stack once per project and so has already applied this check
   *     per project with a real single query. Recognising the array here would
   *     mean reasoning about a shape whose ownership predicate has already been
   *     rewritten into a Raw operator; refusing it is both safe and, in
   *     practice, unreachable.
   */
  public static isQueryPinnedToCurrentUser<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): boolean {
    if (!props.userId) {
      return false;
    }

    if (!query || typeof query !== "object" || Array.isArray(query)) {
      return false;
    }

    const model: BaseModel = new modelType();
    const ownershipColumn: string | null = model.getUserColumn();

    if (!ownershipColumn) {
      return false;
    }

    const ownershipPredicate: unknown = (query as Record<string, unknown>)[
      ownershipColumn
    ];

    if (!OwnerOnlyColumnPermission.isExactUserScope(ownershipPredicate)) {
      return false;
    }

    return ownershipPredicate.toString() === props.userId.toString();
  }

  /**
   * Root and master admin short-circuit before any of this. Notification
   * delivery reads these exact columns as root in order to actually send the
   * page - a phone number it cannot read is a phone that never rings - and the
   * whole on-call system stops if that path is closed.
   */
  private static isPrivilegedInternalRead(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return Boolean(props.isRoot) || Boolean(props.isMasterAdmin);
  }

  private static isExactUserScope(value: unknown): value is string | ObjectID {
    return typeof value === "string" || value instanceof ObjectID;
  }

  /**
   * A plain `{}` literal, as opposed to a query operator instance such as
   * Includes or NotEqual, which are also objects but carry their own class.
   */
  private static isPlainObject(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }

  private static refusal(
    model: BaseModel,
    columnName: string,
  ): NotAuthorizedException {
    return new NotAuthorizedException(
      `You do not have permissions to read ${columnName} on ${model.singularName}. This column belongs to the user it was created for, so it can only be read by a query restricted to your own records.`,
    );
  }
}
