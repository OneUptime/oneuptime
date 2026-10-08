import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import AccessControlPermission from "./AccessControlPermission";
import BasePermission from "./BasePermission";
import ColumnPermissions from "./ColumnPermission";
import EditionPermissions from "./EditionPermission";
import OwnedScopePermission from "./OwnedScopePermission";
import PublicPermission from "./PublicPermission";
import ReadPermission from "./ReadPermission";
import TablePermission from "./TablePermission";
import TenantPermission from "./TenantPermission";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Dictionary from "../../../../Types/Dictionary";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import { applyAlertSelfPrivacyFilter } from "../../../Utils/Alert/AlertPrivacyFilter";
import { applyAlertEpisodeSelfPrivacyFilter } from "../../../Utils/AlertEpisode/AlertEpisodePrivacyFilter";
import {
  getReferenceRefusalMessage,
  normalizeReferenceId,
  resolveReferenceIds,
  UnreadableParentException,
} from "../../../Utils/Database/ProjectScopedReferenceRefusal";
import RelationIdUtil from "../../../Utils/Database/RelationIdUtil";
import { applyIncidentSelfPrivacyFilter } from "../../../Utils/Incident/IncidentPrivacyFilter";
import { applyIncidentEpisodeSelfPrivacyFilter } from "../../../Utils/IncidentEpisode/IncidentEpisodePrivacyFilter";
import { shouldBypassRecordPrivacy } from "../../../Utils/PrivacyFilterUtil";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/*
 * The record a model's rows are read through (@CanAccessIfCanReadOn), as a
 * create names it: one record by a key column, under its two names (an
 * incident note's `incident` and `incidentId`), or several through a join
 * table (an announcement's `statusPages`).
 */
export interface CreateParent {
  parentModelType: DatabaseBaseModelType;
  // "incident", "statusPages".
  relation: string;
  // "incidentId"; null for a join table.
  idColumn: string | null;
  isList: boolean;
  // How a refusal names the field: the relation's title, "Incident".
  title: string;
  // Read by its own rule by a caller who reads no parent (isParentReadOptional).
  isParentReadOptional: boolean;
}

/*
 * Of `ids` (each a valid uuid), the parents the caller may read, read as
 * the caller in the project the record is created in: `query` names them,
 * with the parent table's rule for its private records
 * (getParentLookupQuery). DatabaseService hands it in: it reads with the
 * read rule of the parent's own table.
 */
export type ReadableParentIdsFinder = (data: {
  parentModelType: DatabaseBaseModelType;
  ids: Array<string>;
  query: Query<BaseModel>;
  props: DatabaseCommonInteractionProps;
}) => Promise<Array<string>>;

/*
 * Of `ids` (each a valid uuid), the records of `modelType` that `query`
 * finds, read by OneUptime rather than by the caller - in the project the
 * write is made in, whatever the caller may read. For a record whose read
 * the caller is not held to, which need only be a record of the project
 * (CreatePermission.checkParentIds, RelationListPermission). DatabaseService
 * hands it in.
 */
export type RecordIdsFinder = (data: {
  modelType: DatabaseBaseModelType;
  ids: Array<string>;
  query: Query<BaseModel>;
  props: DatabaseCommonInteractionProps;
}) => Promise<Array<string>>;

// A parent table's rule for its private records, added to a query of it.
type SelfPrivacyFilter = <TQuery>(
  query: TQuery,
  props: DatabaseCommonInteractionProps,
) => TQuery;

/*
 * The parent tables that hold private records - an incident, an alert or an
 * episode marked private - by table name, with the rule each one's service
 * adds to every read of it (IncidentService.onBeforeFind and the others): a
 * private record is read only by the people it names and by those who see
 * every private record of the project (shouldBypassRecordPrivacy).
 */
const PARENT_PRIVACY_FILTERS: Dictionary<SelfPrivacyFilter> = {
  Incident: applyIncidentSelfPrivacyFilter,
  Alert: applyAlertSelfPrivacyFilter,
  IncidentEpisode: applyIncidentEpisodeSelfPrivacyFilter,
  AlertEpisode: applyAlertEpisodeSelfPrivacyFilter,
};

/*
 * A parent table's rules a create is checked against: the rule for its
 * private records, and whether it is itself read through another record.
 */
interface ParentTableFacts {
  privacyFilter: SelfPrivacyFilter | null;
  isReadThroughAnother: boolean;
}

export default class CreatePermission {
  @CaptureSpan()
  public static checkCreatePermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): void {
    /*
     * Master admins skip every table-level check below, but not the edition
     * check: creating enterprise configuration (a master admin can create
     * SCIM configuration and team compliance settings on any project) needs
     * the license for them too. Everyone else gets the same check through
     * TablePermission.
     */
    if (props.isMasterAdmin && !props.isRoot) {
      EditionPermissions.checkEditionPermissions(
        modelType,
        props,
        DatabaseRequestType.Create,
      );
      EditionPermissions.checkEnterpriseColumnPermissions(
        modelType,
        props,
        DatabaseRequestType.Create,
        data,
      );
    }

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

    EditionPermissions.checkEnterpriseColumnPermissions(
      modelType,
      props,
      DatabaseRequestType.Create,
      data,
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

  /*
   * A RECORD READ THROUGH ANOTHER ONE IS CREATED ONLY UNDER A PARENT ITS
   * CREATOR MAY READ.
   *
   * The rows of a model read through another record (@CanAccessIfCanReadOn
   * - an incident's notes and state timeline, a status page's announcements
   * and domains) are read, changed and deleted only through the parents
   * their caller may read (BasePermission.addParentAccessToQuery). A create
   * names its parent itself, so it is held to the same rule, before anything
   * is written:
   *
   *   - a caller who may read none of the parent's records - who holds none
   *     of its read permissions, or whose block with no labels takes one of
   *     them away - is refused, naming the permission they need
   *     (BasePermission.isHeldToParentRead). A model whose parent read is
   *     optional (isParentReadOptional) is created by its own rule, as
   *     before, by a caller who holds none of the parent's read permissions:
   *     the parent need only be a record of the project;
   *   - every parent the create names, under either of its names, must be
   *     one a read of the parent's table finds for the caller: in the
   *     project the record is created in, carrying a label their read is
   *     limited to, not carrying a label a block takes away, owned by them
   *     or one of their teams when their read reaches only what they own,
   *     and - for a private incident, alert or episode - one they may see
   *     (checkParentIds). A parent that is not is answered like one that
   *     does not exist, in the words every reference check answers with;
   *   - a create that names no parent (an override for every policy, a
   *     variable of no workflow) makes a record of the whole project, which
   *     a read limited to some of the parents does not reach
   *     (addParentAccessToQuery): it needs a read of the parents that
   *     reaches the whole project. It is asked about once the hooks have
   *     run, as a hook may name the parent, and a parent the record cannot
   *     be created without is the required-field check's to answer.
   *
   * Root and master admin callers are left alone - OneUptime's engines and
   * workers create these rows as root - as is a model read through no
   * other record. DatabaseService asks before the create hooks run and
   * again after them (`checkedParentIds`: the ids the first ask returned),
   * which looks a parent up only when a hook named other parents. An update
   * that gives a record a parent it does not have is held to the same rule
   * (UpdatePermission.checkParentPermission). Returns the parent ids the
   * create names.
   */
  @CaptureSpan()
  public static async checkParentPermission<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
    findReadableParentIds: ReadableParentIdsFinder;
    // Reads parents as OneUptime, in the record's project. See checkParentIds.
    findParentIdsInProject: RecordIdsFinder;
    // Whether the write's own service holds it to its project. See checkParentIds.
    referencesCheckedInProject: boolean;
    checkedParentIds?: Array<string> | undefined;
  }): Promise<Array<string>> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return [];
    }

    const parent: CreateParent | null = CreatePermission.getCreateParent(
      data.modelType,
    );

    if (!parent) {
      return [];
    }

    const parentIds: Array<string> = CreatePermission.getNamedParentIds(
      parent,
      data.data,
    );

    const isAfterHooks: boolean = data.checkedParentIds !== undefined;

    // The parents asked about before the hooks, which named no others.
    if (
      isAfterHooks &&
      parentIds.length > 0 &&
      CreatePermission.isSameIdSet(parentIds, data.checkedParentIds || [])
    ) {
      return parentIds;
    }

    // No parent named yet: asked about after the hooks. See the comment above.
    if (parentIds.length === 0 && !isAfterHooks) {
      CreatePermission.checkParentReadHeld(
        data.modelType,
        parent,
        data.props,
        DatabaseRequestType.Create,
      );

      return parentIds;
    }

    if (parentIds.length === 0) {
      if (
        CreatePermission.checkParentReadHeld(
          data.modelType,
          parent,
          data.props,
          DatabaseRequestType.Create,
        )
      ) {
        CreatePermission.checkParentlessWrite(
          data.modelType,
          parent,
          data.props,
          DatabaseRequestType.Create,
        );
      }

      return parentIds;
    }

    await CreatePermission.checkParentIds({
      modelType: data.modelType,
      parent: parent,
      ids: parentIds,
      props: data.props,
      type: DatabaseRequestType.Create,
      findReadableParentIds: data.findReadableParentIds,
      findParentIdsInProject: data.findParentIdsInProject,
      referencesCheckedInProject: data.referencesCheckedInProject,
    });

    return parentIds;
  }

  /*
   * Whether the caller is held to the read of the parent `modelType`'s rows
   * are read through, after the checks that refuse them outright: reading
   * the parent needs someone signed in, a person or an API key - a caller
   * with neither (a publicly creatable model's anonymous create) is
   * answered with the 401 that read would give them - and one of the
   * parent's read permissions, unblocked (BasePermission.isHeldToParentRead,
   * which throws). False for a model whose parent read is optional, by a
   * caller who holds none of the parent's read permissions.
   */
  public static checkParentReadHeld(
    modelType: DatabaseBaseModelType,
    parent: CreateParent,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType.Create | DatabaseRequestType.Update,
  ): boolean {
    if (!parent.isParentReadOptional) {
      PublicPermission.checkIfUserIsLoggedIn(
        parent.parentModelType,
        props,
        DatabaseRequestType.Read,
      );
    }

    return BasePermission.isHeldToParentRead(
      modelType,
      parent.parentModelType,
      props,
      type,
    );
  }

  /*
   * EVERY PARENT A WRITE NAMES, IN ITS PROJECT AND WITHIN THE CALLER'S READ
   * of the parent's table - the parents a create puts the record under, or
   * an update moves it to (`ids`, each as sent). Refused, all of them, with
   * the words every reference check answers with when one is not
   * (UnreadableParentException), so a parent the caller may not read reads
   * exactly like one in another project, or one that does not exist:
   *
   *   - a caller held to the parent's read (checkParentReadHeld) reads each
   *     parent as themselves (`findReadableParentIds`, the read rule of the
   *     parent's own table, with getParentLookupQuery). A caller whose read
   *     of the parents is narrowed by nothing (readsEveryParent) is not
   *     looked up when the write's own service holds every reference it
   *     names to its project (`referencesCheckedInProject`:
   *     ProjectReferencesService), which answers in the same words; a
   *     service without such a check has every parent looked up;
   *   - a caller who holds no permission to read the parent, on a model
   *     whose parent read is optional, is held to nothing but the project:
   *     the service's own reference check, or, for a service without one,
   *     a lookup by OneUptime in the record's project
   *     (`findParentIdsInProject`).
   *
   * A malformed id names no record and is refused unread.
   */
  @CaptureSpan()
  public static async checkParentIds(data: {
    modelType: DatabaseBaseModelType;
    parent: CreateParent;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType.Create | DatabaseRequestType.Update;
    findReadableParentIds: ReadableParentIdsFinder;
    findParentIdsInProject: RecordIdsFinder;
    referencesCheckedInProject: boolean;
  }): Promise<void> {
    if (data.ids.length === 0) {
      return;
    }

    const isHeld: boolean = CreatePermission.checkParentReadHeld(
      data.modelType,
      data.parent,
      data.props,
      data.type,
    );

    if (
      data.referencesCheckedInProject &&
      (!isHeld ||
        CreatePermission.readsEveryParent(
          data.parent.parentModelType,
          data.props,
        ))
    ) {
      return;
    }

    // A malformed id names no record; it is not looked up.
    const lookupIds: Array<string> = data.ids.filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    let foundIds: Array<string> = [];

    if (lookupIds.length > 0 && isHeld) {
      foundIds = await data.findReadableParentIds({
        parentModelType: data.parent.parentModelType,
        ids: lookupIds,
        query: CreatePermission.getParentLookupQuery({
          parentModelType: data.parent.parentModelType,
          ids: lookupIds,
          props: data.props,
        }),
        props: data.props,
      });
    } else if (lookupIds.length > 0) {
      foundIds = await data.findParentIdsInProject({
        modelType: data.parent.parentModelType,
        ids: lookupIds,
        query: {
          _id: QueryHelper.any(lookupIds),
        } as Query<BaseModel>,
        props: data.props,
      });
    }

    const found: Set<string> = new Set<string>(
      foundIds.map(normalizeReferenceId),
    );

    const refusedIds: Array<string> = data.ids.filter((id: string): boolean => {
      return !found.has(normalizeReferenceId(id));
    });

    if (refusedIds.length > 0) {
      throw CreatePermission.getMissingParentRefusal(
        data.modelType,
        data.parent,
        refusedIds,
      );
    }
  }

  // The parent of each model asked about, read from its metadata once.
  private static createParents: Map<
    DatabaseBaseModelType,
    CreateParent | null
  > = new Map();

  /*
   * The record `modelType`'s rows are read through, as a create names it.
   * Null for a model read through none. A declared relation that names no
   * parent model is a misconfigured model - ParentOwnedScopeCoverage holds
   * every model to one the read rule follows - and is refused rather than
   * created unchecked.
   */
  public static getCreateParent(
    modelType: DatabaseBaseModelType,
  ): CreateParent | null {
    if (CreatePermission.createParents.has(modelType)) {
      return CreatePermission.createParents.get(modelType) || null;
    }

    const parent: CreateParent | null =
      CreatePermission.readCreateParent(modelType);

    CreatePermission.createParents.set(modelType, parent);

    return parent;
  }

  // See getCreateParent.
  private static readCreateParent(
    modelType: DatabaseBaseModelType,
  ): CreateParent | null {
    const model: BaseModel = new modelType();
    const relation: string | null = model.canAccessIfCanReadOn;

    if (!relation) {
      return null;
    }

    const column: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(relation);

    if (
      !column ||
      !column.modelType ||
      (column.type !== TableColumnType.Entity &&
        column.type !== TableColumnType.EntityArray)
    ) {
      throw new BadDataException(
        `${model.singularName} is read through ${relation}, which names no record to check a create against.`,
      );
    }

    const isList: boolean = column.type === TableColumnType.EntityArray;

    return {
      parentModelType: column.modelType as DatabaseBaseModelType,
      relation: relation,
      idColumn: isList ? null : column.manyToOneRelationColumn || null,
      isList: isList,
      title: column.title || new column.modelType().singularName || relation,
      isParentReadOptional: model.isParentReadOptional,
    };
  }

  /*
   * The parents a create's data names, each once, as the caller wrote them:
   * a key under both of its names - the ID column and the relation, which
   * must agree (RelationIdUtil.readConsistent refuses two that do not) - or
   * every record of a join table's list, as model instances, `{ _id }`
   * objects, ObjectIDs or plain ids (resolveReferenceIds, as the reference
   * checks read them). None for a create that names no parent.
   */
  public static getNamedParentIds(
    parent: CreateParent,
    data: BaseModel,
  ): Array<string> {
    const record: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    if (!parent.isList) {
      const id: ObjectID | null = RelationIdUtil.readConsistent(
        record,
        parent.idColumn
          ? [parent.idColumn, parent.relation]
          : [parent.relation],
        parent.title,
      );

      return id ? [id.toString().trim()] : [];
    }

    const seen: Set<string> = new Set<string>();
    const ids: Array<string> = [];

    for (const entry of resolveReferenceIds(record[parent.relation])) {
      const id: string = entry.toString().trim();

      if (seen.has(normalizeReferenceId(id))) {
        continue;
      }

      seen.add(normalizeReferenceId(id));
      ids.push(id);
    }

    return ids;
  }

  /*
   * Whether a read of `parentModelType` by the caller reaches every record
   * of it in the project, so that a lookup could only tell whether a parent
   * is a record of the project: none of the narrowings the read rule applies
   * to a read of it (BasePermission.addRecordScopeToQuery) - a grant limited
   * to labels (on a label-less parent, to the labels of what it names), a
   * block with labels, grants limited to owned records, a read only the
   * CurrentUser permission grants, a parent that is read through another
   * record of its own, or a parent table whose private records the caller
   * sees only when they are named on them.
   */
  public static readsEveryParent(
    parentModelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return (
      !CreatePermission.getParentTableFacts(parentModelType)
        .isReadThroughAnother &&
      !CreatePermission.isHeldToParentPrivacy(parentModelType, props) &&
      CreatePermission.reachesRecordsOfNoParent(parentModelType, props) &&
      ReadPermission.getBlockedLabelIds(
        parentModelType,
        props,
        DatabaseRequestType.Read,
      ).length === 0 &&
      !TenantPermission.isAccessGrantedOnlyByCurrentUser(
        parentModelType,
        props,
        DatabaseRequestType.Read,
      )
    );
  }

  /*
   * The read a lookup of `ids` makes as the caller: the ids, and the parent
   * table's rule for its private records, which its own service adds to
   * every read of it - a lookup through a plain service would leave it out.
   */
  public static getParentLookupQuery(data: {
    parentModelType: DatabaseBaseModelType;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Query<BaseModel> {
    const query: Query<BaseModel> = {
      _id: QueryHelper.any(data.ids),
    } as Query<BaseModel>;

    const privacyFilter: SelfPrivacyFilter | null =
      CreatePermission.getParentPrivacyFilter(data.parentModelType);

    return privacyFilter ? privacyFilter(query, data.props) : query;
  }

  // The rule for the private records of a parent table; null if it holds none.
  public static getParentPrivacyFilter(
    parentModelType: DatabaseBaseModelType,
  ): SelfPrivacyFilter | null {
    return CreatePermission.getParentTableFacts(parentModelType).privacyFilter;
  }

  // What each parent table's rules come to, read from its metadata once.
  private static parentTableFacts: Map<
    DatabaseBaseModelType,
    ParentTableFacts
  > = new Map();

  private static getParentTableFacts(
    parentModelType: DatabaseBaseModelType,
  ): ParentTableFacts {
    let facts: ParentTableFacts | undefined =
      CreatePermission.parentTableFacts.get(parentModelType);

    if (!facts) {
      const parentModel: BaseModel = new parentModelType();

      facts = {
        privacyFilter:
          PARENT_PRIVACY_FILTERS[parentModel.tableName || ""] || null,
        isReadThroughAnother: Boolean(parentModel.canAccessIfCanReadOn),
      };

      CreatePermission.parentTableFacts.set(parentModelType, facts);
    }

    return facts;
  }

  /*
   * Whether the caller sees only some private records of a parent table:
   * the ones they are named on. Project owners and admins see them all.
   */
  public static isHeldToParentPrivacy(
    parentModelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return (
      CreatePermission.getParentPrivacyFilter(parentModelType) !== null &&
      !shouldBypassRecordPrivacy(props)
    );
  }

  /*
   * Whether the caller reaches the rows of a model read through
   * `parentModelType` that name no parent at all: their read of the parent
   * is limited neither to labels nor to what they or their teams own - the
   * two narrowings of the rows read through a parent that leave out a row
   * of no parent (BasePermission.addParentAccessToQuery). A block with
   * labels takes away only the parents carrying them, so a row of no parent
   * is still reached.
   */
  public static reachesRecordsOfNoParent(
    parentModelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return (
      AccessControlPermission.getAccessControlIdsForQuery(
        parentModelType,
        {},
        { _id: true },
        props,
        DatabaseRequestType.Read,
      ).length === 0 &&
      !OwnedScopePermission.isLimitedToOwnedRecords(
        parentModelType,
        props,
        DatabaseRequestType.Read,
      )
    );
  }

  /*
   * See checkParentPermission: a create that names no parent, or an update
   * that leaves a record with none (UpdatePermission.checkParentPermission),
   * makes a record of the whole project.
   */
  public static checkParentlessWrite(
    modelType: DatabaseBaseModelType,
    parent: CreateParent,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType.Create | DatabaseRequestType.Update,
  ): void {
    if (
      CreatePermission.reachesRecordsOfNoParent(parent.parentModelType, props)
    ) {
      return;
    }

    const model: BaseModel = new modelType();
    const parentModel: BaseModel = new parent.parentModelType();

    throw new NotAuthorizedException(
      `A ${model.singularName} you ${
        type === DatabaseRequestType.Create ? "create" : "change"
      } must belong to a ${parentModel.singularName} you can read: your access to ${parentModel.pluralName} covers only some of them.`,
    );
  }

  /*
   * The refusal of parents the caller may not read: the one every reference
   * check answers with (getReferenceRefusalMessage), naming the field and
   * the ids as sent - so a parent the caller may not read reads exactly like
   * one in another project, or one that does not exist.
   */
  private static getMissingParentRefusal(
    modelType: DatabaseBaseModelType,
    parent: CreateParent,
    refusedIds: Array<string>,
  ): UnreadableParentException {
    return new UnreadableParentException(
      getReferenceRefusalMessage({
        subject: (new modelType().singularName || "record").toLowerCase(),
        described: refusedIds.map((id: string): string => {
          return `${parent.title} "${id}"`;
        }),
      }),
    );
  }

  // Whether two lists of ids name the same records, in any order or case.
  private static isSameIdSet(
    ids: Array<string>,
    otherIds: Array<string>,
  ): boolean {
    const normalized: Set<string> = new Set<string>(
      ids.map(normalizeReferenceId),
    );
    const otherNormalized: Set<string> = new Set<string>(
      otherIds.map(normalizeReferenceId),
    );

    if (normalized.size !== otherNormalized.size) {
      return false;
    }

    for (const id of normalized) {
      if (!otherNormalized.has(id)) {
        return false;
      }
    }

    return true;
  }
}
