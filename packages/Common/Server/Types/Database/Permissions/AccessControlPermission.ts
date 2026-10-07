import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import Select from "../Select";
import TablePermission from "./TablePermission";
import ReadPermission, { RecordOperation } from "./ReadPermission";
import AccessControlModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/AccessControlModel";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ArrayUtil from "../../../../Utils/Array";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import Dictionary from "../../../../Types/Dictionary";

/*
 * Built once per invocation and threaded through the per-column loop; never
 * cached on props or module scope (the multi-tenant path re-enters with
 * different per-tenant props and must rebuild fresh).
 */
type AccessControlPermissionContext = {
  nonAccessControlPermissions: Array<Permission>;
  accessControlPermissions: Array<UserPermission>;
  // What the caller holds, for the wildcards the grants count.
  held: HeldPermissions;
};

export default class AccessControlPermission {
  @CaptureSpan()
  public static async checkAccessControlBlockPermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    type: DatabaseRequestType;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { modelType, props, type } = data;

    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    TablePermission.checkTableLevelBlockPermissions(modelType, props, type);

    /*
     * The block rows with labels that weigh this operation: on one of the
     * model's own permissions for it, or on its wildcard while the wildcard
     * is what grants (ReadPermission.getLabelledBlockRows) - the rows the
     * record rule leaves records out by.
     */
    const blockPermissionsBelongToThisModel: Array<UserPermission> =
      ReadPermission.getLabelledBlockRows(
        modelType,
        props,
        type as RecordOperation,
      );

    if (blockPermissionsBelongToThisModel.length === 0) {
      return;
    }

    /*
     * A record with no labels of its own is weighed here only where the
     * caller can look it up under the rule (isRecordFound); otherwise the
     * query the operation runs with applies the rule
     * (BasePermission.addRecordScopeToQuery), and nothing need be read.
     */
    if (!new modelType().getAccessControlColumn() && !data.isRecordFound) {
      return;
    }

    // now check if the user has any of these labels in the block list, for this we need to fetch the model first.
    const fetchedModel: TBaseModel | null =
      await this.fetchRecordInCallerProject(data);

    if (!fetchedModel) {
      throw new NotFoundException(`${new modelType().singularName} not found.`);
    }

    /*
     * A record with no labels of its own carries the labels of the records
     * it names: it is refused when the label rule leaves it out - a note of
     * an incident carrying a blocked label (ReadPermission
     * .addLabelBlockToQuery) - as a labelled record carrying one is below.
     */
    if (!fetchedModel.getAccessControlColumn()) {
      if (
        !(await this.isRecordKeptByLabelRule({
          record: fetchedModel,
          isRecordFound: data.isRecordFound,
          narrow: (query: Query<TBaseModel>): Query<TBaseModel> => {
            return ReadPermission.addLabelBlockToQuery(
              modelType,
              query,
              props,
              type as RecordOperation,
            );
          },
        }))
      ) {
        /*
         * The rule weighs every one of these block rows at once, so the
         * refusal names their permissions and says one of them holds for
         * this record, not which.
         */
        const blockedPermissions: Array<string> = Array.from(
          new Set<string>(
            blockPermissionsBelongToThisModel.map(
              (blockPermission: UserPermission): string => {
                return blockPermission.permission.toString();
              },
            ),
          ),
        );

        throw new NotAuthorizedException(
          `You are not authorized to ${type.toLowerCase()} this ${
            fetchedModel.singularName
          } because ${
            blockedPermissions.length === 1
              ? blockedPermissions[0]
              : `one of ${blockedPermissions.join(", ")}`
          } is in your team's permission block list.`,
        );
      }

      return;
    }

    for (const blockPermissionBelongToThisModel of blockPermissionsBelongToThisModel) {
      const blockPermissionLabelIds: Array<ObjectID> =
        blockPermissionBelongToThisModel.labelIds || [];

      const blockPermissionLabelIdAsString: Array<string> =
        blockPermissionLabelIds.map((id: ObjectID) => {
          return id.toString();
        });

      if (blockPermissionLabelIds.length === 0) {
        continue;
      }

      const model: TBaseModel = fetchedModel;

      const modelAccessControlColumnName: string | null =
        model.getAccessControlColumn();

      if (modelAccessControlColumnName) {
        const modelAccessControl: Array<AccessControlModel> =
          (model.getColumnValue(
            modelAccessControlColumnName,
          ) as Array<AccessControlModel>) || [];

        for (const accessControl of modelAccessControl) {
          if (!accessControl.id) {
            continue;
          }

          if (
            blockPermissionLabelIdAsString.includes(accessControl.id.toString())
          ) {
            throw new NotAuthorizedException(
              `You are not authorized to ${type.toLowerCase()} this ${
                model.singularName
              } because ${
                blockPermissionBelongToThisModel.permission
              } is in your team's permission block list.`,
            );
          }
        }
      }
    }
  }

  /*
   * `updateData` is what an update writes, when the caller has it, for the
   * plan check: an update that only switches the record off passes it below
   * the table's update plan (BillingPermission).
   */
  @CaptureSpan()
  public static async checkAccessControlPermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
    updateData?: unknown;
  }): Promise<void> {
    const { modelType, props, type } = data;

    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    // Check if the user has permission to delete or update the object in this table.
    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      type,
      data.updateData,
    );

    // if the control is here, then the user has table level permissions.
    const model: TBaseModel = new modelType();
    const modelAccessControlColumnName: string | null =
      model.getAccessControlColumn();

    if (modelAccessControlColumnName) {
      const accessControlIdsWhichUserHasAccessTo: Array<ObjectID> =
        this.getAccessControlIdsForModel(modelType, props, type);

      if (accessControlIdsWhichUserHasAccessTo.length === 0) {
        return; // The user has access to all resources, if no labels are specified.
      }

      const fetchedModel: TBaseModel | null =
        await this.fetchRecordInCallerProject(data);

      if (!fetchedModel) {
        throw new NotFoundException(`${model.singularName} not found.`);
      }

      const accessControlIdsWhichUserHasAccessToAsStrings: Array<string> =
        accessControlIdsWhichUserHasAccessTo.map((id: ObjectID) => {
          return id.toString();
        }) || [];

      // Check if the object has any of these access control ids.  if not, then throw an error.
      const modelAccessControl: Array<AccessControlModel> =
        (fetchedModel.getColumnValue(
          modelAccessControlColumnName,
        ) as Array<AccessControlModel>) || [];

      const modelAccessControlNames: Array<string> = [];

      for (const accessControl of modelAccessControl) {
        if (!accessControl.id) {
          continue;
        }

        if (
          accessControlIdsWhichUserHasAccessToAsStrings.includes(
            accessControl.id.toString(),
          )
        ) {
          return;
        }

        const accessControlName: string = accessControl.getColumnValue(
          "name",
        ) as string;

        if (accessControlName) {
          modelAccessControlNames.push(accessControlName);
        }
      }

      let errorString: string = `You do not have permission to ${type.toLowerCase()} this ${
        model.singularName
      }.`;

      if (modelAccessControlNames.length > 0) {
        errorString += ` You need to have one of the following labels: ${modelAccessControlNames.join(
          ", ",
        )}.`;
      } else {
        errorString = ` You do not have permission to ${type.toLowerCase()} ${
          model.singularName
        } without any labels.`;
      }

      throw new NotAuthorizedException(errorString);
    }

    /*
     * A record with no labels of its own, under grants limited to labels:
     * only one whose named records carry them may be written (ReadPermission
     * .addLabelGrantToQuery), as only a labelled record carrying one may.
     */
    if (
      !data.isRecordFound ||
      ReadPermission.getGrantedLabelIds(
        modelType,
        props,
        type as RecordOperation,
      ).length === 0
    ) {
      return;
    }

    const fetchedRecord: TBaseModel | null =
      await this.fetchRecordInCallerProject(data);

    if (!fetchedRecord) {
      throw new NotFoundException(`${model.singularName} not found.`);
    }

    if (
      !(await this.isRecordKeptByLabelRule({
        record: fetchedRecord,
        isRecordFound: data.isRecordFound,
        narrow: (query: Query<TBaseModel>): Query<TBaseModel> => {
          return ReadPermission.addLabelGrantToQuery(
            modelType,
            query,
            props,
            type as RecordOperation,
          );
        },
      }))
    ) {
      throw new NotAuthorizedException(
        `You do not have permission to ${type.toLowerCase()} this ${
          model.singularName
        }.`,
      );
    }
  }

  /*
   * Every check of one record by model, for an update or a delete by id
   * (UpdatePermission, DeletePermission), on one read of the record:
   *
   *   - the table: a block with no labels, the operation's grant, and - a
   *     write needs a read - a read grant
   *     (TablePermission.checkTableLevelReadForWrite);
   *   - THE RECORD IS ONE THE CALLER MAY READ, by the read's label grants
   *     and blocks. One they may not read - missing, of another project, or
   *     outside their read - is answered as missing (NotFoundException),
   *     its labels neither weighed nor named;
   *   - then the team's blocks and the grants limited to labels of the
   *     operation itself, which say why a record the caller may read is not
   *     one they may change or delete.
   *
   * A record with no labels of its own is weighed by lookups
   * (`isRecordFound`): one lookup under every rule at once, and the others
   * only when it is refused, to say why. The owners and the parent a record
   * is read through are weighed by the query the operation runs with
   * (BasePermission.addRecordScopeToQuery).
   *
   * `fetchModelWithAccessControlIds` reads the record as root with its
   * labels and its project (the tenant column): a record read without its
   * project is answered as missing to a caller the checks weigh it for
   * (fetchRecordInCallerProject), since whose record it is cannot be told.
   * DatabaseService.findWithAccessControlIds reads it so.
   */
  @CaptureSpan()
  public static async checkRecordByModel<TBaseModel extends BaseModel>(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
    updateData?: unknown;
  }): Promise<void> {
    const checked: typeof data = {
      ...data,
      fetchModelWithAccessControlIds: this.fetchOnce(
        data.fetchModelWithAccessControlIds,
      ),
    };

    if (await this.isRecordKeptByEveryRule<TBaseModel>(checked)) {
      return;
    }

    await this.checkAccessControlBlockPermissionByModel<TBaseModel>(checked);
    await this.checkAccessControlPermissionByModel<TBaseModel>(checked);
  }

  /*
   * The table's checks and the record's read rule (checkRecordByModel):
   * throws when the caller may not do the operation on the table at all,
   * NotFoundException when the record is not one they may read. True when
   * the record is kept by every label rule of the read and the operation -
   * nothing else to look at - and false when the operation's own checks
   * are to weigh it, and say why it is refused.
   */
  private static async isRecordKeptByEveryRule<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
    updateData?: unknown;
  }): Promise<boolean> {
    const { modelType, props, type } = data;

    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    TablePermission.checkTableLevelBlockPermissions(modelType, props, type);
    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      type,
      data.updateData,
    );

    const operation: RecordOperation = type as RecordOperation;

    if (type !== DatabaseRequestType.Read) {
      TablePermission.checkTableLevelReadForWrite(modelType, props, type);
    }

    const model: TBaseModel = new modelType();
    const operations: Array<RecordOperation> =
      ReadPermission.getNarrowingOperations(operation);

    const grantedLabelIds: Dictionary<Array<ObjectID>> = {};
    const blockedLabelIds: Dictionary<Array<ObjectID>> = {};

    for (const each of operations) {
      grantedLabelIds[each] = model.getAccessControlColumn()
        ? this.getAccessControlIdsForModel(modelType, props, each)
        : ReadPermission.getGrantedLabelIds(modelType, props, each);
      blockedLabelIds[each] = ReadPermission.getBlockedLabelIds(
        modelType,
        props,
        each,
      );
    }

    const isNarrowed: boolean = operations.some(
      (each: RecordOperation): boolean => {
        return (
          (grantedLabelIds[each] || []).length > 0 ||
          (blockedLabelIds[each] || []).length > 0
        );
      },
    );

    // No label rule weighs this record: the query the operation runs with does the rest.
    if (!isNarrowed) {
      return true;
    }

    // Every rule of the read and the operation, on a label-less model's rows.
    const narrowByEveryRule: (query: Query<TBaseModel>) => Query<TBaseModel> = (
      query: Query<TBaseModel>,
    ): Query<TBaseModel> => {
      return this.addRecordLabelRulesToQuery(
        modelType,
        query,
        operations.map((each: RecordOperation): Array<ObjectID> => {
          return grantedLabelIds[each] || [];
        }),
        operations.flatMap((each: RecordOperation): Array<ObjectID> => {
          return blockedLabelIds[each] || [];
        }),
      );
    };

    if (!model.getAccessControlColumn()) {
      /*
       * A label-less record nobody can look up here, or one whose model
       * names no labelled record the rules could follow, is weighed by that
       * query too: nothing is read for it.
       */
      if (!data.isRecordFound) {
        return true;
      }

      const probeId: string = ObjectID.getZeroObjectID().toString();
      const probe: Query<TBaseModel> = narrowByEveryRule({
        _id: probeId,
      } as Query<TBaseModel>);

      if (
        Object.keys(probe).length === 1 &&
        (probe as Dictionary<unknown>)["_id"] === probeId
      ) {
        return true;
      }
    }

    const record: TBaseModel | null =
      await this.fetchRecordInCallerProject(data);

    if (!record) {
      throw new NotFoundException(`${model.singularName} not found.`);
    }

    const readGrants: Array<ObjectID> =
      grantedLabelIds[DatabaseRequestType.Read] || [];
    const readBlocks: Array<ObjectID> =
      blockedLabelIds[DatabaseRequestType.Read] || [];

    // A record with labels of its own: weighed by them, with no lookup.
    if (model.getAccessControlColumn()) {
      const recordLabelIds: Array<string> = this.getRecordLabelIds(record);

      const isReadable: boolean =
        (readGrants.length === 0 ||
          readGrants.some((labelId: ObjectID): boolean => {
            return recordLabelIds.includes(labelId.toString());
          })) &&
        !readBlocks.some((labelId: ObjectID): boolean => {
          return recordLabelIds.includes(labelId.toString());
        });

      if (!isReadable) {
        throw new NotFoundException(`${model.singularName} not found.`);
      }

      // The operation's own checks weigh the same labels, read already.
      return false;
    }

    // One lookup under every rule at once: the read's and the operation's.
    if (
      await this.isRecordKeptByLabelRule({
        record: record,
        isRecordFound: data.isRecordFound,
        narrow: narrowByEveryRule,
      })
    ) {
      return true;
    }

    // Refused: a record the caller may not read is answered as missing.
    if (
      !(await this.isRecordKeptByLabelRule({
        record: record,
        isRecordFound: data.isRecordFound,
        narrow: (query: Query<TBaseModel>): Query<TBaseModel> => {
          return this.addRecordLabelRulesToQuery(
            modelType,
            query,
            [readGrants],
            readBlocks,
          );
        },
      }))
    ) {
      throw new NotFoundException(`${model.singularName} not found.`);
    }

    // One they may read: the operation's own checks say why it is refused.
    return false;
  }

  /*
   * A label-less model's label rule over several operations' label lists:
   * each grant's labels a condition of its own, every block's labels in one.
   */
  private static addRecordLabelRulesToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    grantedLabelLists: Array<Array<ObjectID>>,
    blockedLabelIds: Array<ObjectID>,
  ): Query<TBaseModel> {
    for (const labelIds of grantedLabelLists) {
      query = ReadPermission.addGrantedLabelsToQuery(
        modelType,
        query,
        labelIds,
      );
    }

    return ReadPermission.addBlockedLabelsToQuery(
      modelType,
      query,
      ArrayUtil.removeDuplicatesFromObjectIDArray(blockedLabelIds),
    );
  }

  // The ids of the labels a record read with its labels carries.
  private static getRecordLabelIds<TBaseModel extends BaseModel>(
    record: TBaseModel,
  ): Array<string> {
    const accessControlColumn: string | null = record.getAccessControlColumn();

    if (!accessControlColumn) {
      return [];
    }

    return (
      (record.getColumnValue(accessControlColumn) as
        | Array<AccessControlModel>
        | undefined) || []
    )
      .map((label: AccessControlModel): string => {
        return label.id ? label.id.toString() : "";
      })
      .filter((labelId: string): boolean => {
        return labelId.length > 0;
      });
  }

  // `fetch`, read once however often it is asked.
  private static fetchOnce<TBaseModel extends BaseModel>(
    fetch: () => Promise<TBaseModel | null>,
  ): () => Promise<TBaseModel | null> {
    let fetched: Promise<TBaseModel | null> | null = null;

    return (): Promise<TBaseModel | null> => {
      if (!fetched) {
        fetched = fetch();
      }

      return fetched;
    };
  }

  /*
   * The record a check by model is about, as `fetchModelWithAccessControlIds`
   * reads it - or null when it is not a record of the project the caller
   * acts in: such a record is answered as a missing one, and its labels are
   * never weighed or named in a refusal. The record is read with its
   * project (DatabaseService.findWithAccessControlIds reads it in the
   * caller's project already); one read without it is answered as missing
   * too, for its project cannot be told.
   */
  private static async fetchRecordInCallerProject<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    props: DatabaseCommonInteractionProps;
  }): Promise<TBaseModel | null> {
    const record: TBaseModel | null =
      await data.fetchModelWithAccessControlIds();

    if (!record || !data.props.tenantId || data.props.isMultiTenantRequest) {
      return record;
    }

    const tenantColumn: string | null = record.getTenantColumn();

    if (!tenantColumn) {
      return record;
    }

    const recordProjectId: unknown = (record as unknown as Dictionary<unknown>)[
      tenantColumn
    ];

    if (recordProjectId === undefined || recordProjectId === null) {
      return null;
    }

    return String(recordProjectId).toLowerCase() ===
      data.props.tenantId.toString().toLowerCase()
      ? record
      : null;
  }

  /*
   * Whether the label rule `narrow` adds to a query keeps `record`, a record
   * with no labels of its own that carries those of the records it names
   * (ReadPermission.addLabelBlockToQuery, addLabelGrantToQuery). When the
   * rule adds nothing to a query by the record's id - its model names no
   * labelled record - the record is kept without a lookup. A caller with no
   * `isRecordFound` leaves the rule to the query it runs the operation
   * with, which applies it (BasePermission.addRecordScopeToQuery).
   */
  private static async isRecordKeptByLabelRule<
    TBaseModel extends BaseModel,
  >(data: {
    record: TBaseModel;
    isRecordFound?:
      | ((query: Query<TBaseModel>) => Promise<boolean>)
      | undefined;
    narrow: (query: Query<TBaseModel>) => Query<TBaseModel>;
  }): Promise<boolean> {
    if (!data.isRecordFound || !data.record.id) {
      return true;
    }

    const recordId: string = data.record.id.toString();

    const narrowed: Query<TBaseModel> = data.narrow({
      _id: recordId,
    } as Query<TBaseModel>);

    if (
      Object.keys(narrowed).length === 1 &&
      (narrowed as Dictionary<unknown>)["_id"] === recordId
    ) {
      return true;
    }

    return await data.isRecordFound(narrowed);
  }

  /*
   * A labelled model's records narrowed by one operation's own grants
   * limited to labels. The record rule narrows a write by its read's grants
   * as well, and so asks the two halves itself
   * (BasePermission.addRecordScopeToQuery: getAccessControlIdsForQuery per
   * operation, then addLabelIdsToQuery).
   */
  @CaptureSpan()
  public static async addAccessControlIdsToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    if (!new modelType().getAccessControlColumn()) {
      return query;
    }

    return this.addLabelIdsToQuery(
      modelType,
      query,
      this.getAccessControlIdsForQuery(modelType, query, select, props, type),
    );
  }

  /*
   * Keeps, of a labelled model's records, those carrying one of
   * `accessControlIds` - the labels a grant is limited to
   * (addAccessControlIdsToQuery). Nothing for no labels, a grant over the
   * whole project, or for a model that carries no labels. Asked again with
   * another list, the records must carry one label of each.
   */
  public static addLabelIdsToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    accessControlIds: Array<ObjectID>,
  ): Query<TBaseModel> {
    const model: BaseModel = new modelType();

    // if the model has access control column, then add the access control labels to the query.
    if (model.getAccessControlColumn()) {
      if (accessControlIds.length > 0) {
        const accessControlColumn: string =
          model.getAccessControlColumn() as string;
        const existingFilter: unknown = (query as any)[accessControlColumn];

        if (existingFilter === undefined || existingFilter === null) {
          (query as any)[accessControlColumn] = accessControlIds;
        } else {
          /*
           * The caller already filters on the access-control column (e.g.
           * "show monitors with label X"). Overwriting that filter with the
           * permitted set would silently widen it to "any permitted label".
           * Both predicates must hold independently — a record with labels
           * {X, Y} (X requested, Y permitted) must match even when X itself
           * is not permitted — so keep the caller's filter on the relation
           * key and AND the permitted-set predicate onto _id as a join-table
           * subquery.
           */
          const manyToManyMeta: {
            joinTableName: string;
            ownerColumnName: string;
            relationColumnName: string;
          } | null = QueryUtil.getManyToManyRelationMetadata(
            modelType,
            accessControlColumn,
          );

          if (manyToManyMeta) {
            (query as any)._id = combineWithPrivacyClause(
              (query as any)._id,
              QueryHelper.anyOfEntitiesInManyToMany({
                values: accessControlIds,
                joinTableName: manyToManyMeta.joinTableName,
                ownerColumnName: manyToManyMeta.ownerColumnName,
                relationColumnName: manyToManyMeta.relationColumnName,
              }),
            );
          } else {
            /*
             * Join metadata unavailable — fail closed to the permitted set.
             * The caller's filter is dropped, but access never widens: a
             * list already there (another grant's labels, asked first) keeps
             * only the labels on both.
             */
            const permittedIds: Array<ObjectID> = Array.isArray(existingFilter)
              ? AccessControlPermission.getLabelsOnBoth(
                  existingFilter as Array<ObjectID>,
                  accessControlIds,
                )
              : accessControlIds;

            if (permittedIds.length > 0) {
              (query as any)[accessControlColumn] = permittedIds;
            } else {
              // No label on both: no record carries one of each.
              (query as any)._id = QueryHelper.equalTo(
                ObjectID.getZeroObjectID().toString(),
              );
            }
          }
        }
      }
    }

    return query;
  }

  // The labels of `labelIds` that are also in `within`.
  private static getLabelsOnBoth(
    labelIds: Array<ObjectID>,
    within: Array<ObjectID>,
  ): Array<ObjectID> {
    const withinIds: Set<string> = new Set<string>(
      within.map((labelId: ObjectID): string => {
        return labelId.toString();
      }),
    );

    return labelIds.filter((labelId: ObjectID): boolean => {
      return withinIds.has(labelId.toString());
    });
  }

  /*
   * The labels the caller's grants for an operation on a model are limited
   * to: none when one of them reaches the whole project, or when none is
   * limited to labels. The grants are the rows the table check counts
   * (TablePermission.getGrantingPermissions): the model's own permissions
   * for the operation and, on an operational resource, its
   * *AllOperationalResources wildcard - so a wildcard limited to labels
   * narrows the records to those labels, as one of the model's own
   * permissions limited to them does, and a wildcard over the whole
   * project reaches every record.
   */
  @CaptureSpan()
  public static getAccessControlIdsForModel(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    context?: AccessControlPermissionContext,
  ): Array<ObjectID> {
    context = context ?? this.buildPermissionContext(props);

    return ArrayUtil.removeDuplicatesFromObjectIDArray(
      this.getAccessControlIdsByPermissions(
        HeldPermissionsUtil.getGrantingPermissions(context.held, {
          modelPermissions: TablePermission.getTablePermission(modelType, type),
          wildcard: TablePermission.getModelWildcard(modelType, type),
        }),
        context,
      ),
    );
  }

  /*
   * The permissions whose allow rows grant an operation on one column: the
   * column's own list for it and, for a column that lets in everyone its
   * table does, the table's wildcard (HeldPermissionsUtil.getColumnWildcard)
   * - as the column check counts them (ColumnPermission).
   */
  private static getColumnGrantingPermissions(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
    columnPermissions: Array<Permission>,
    held: HeldPermissions,
  ): Array<Permission> {
    return HeldPermissionsUtil.getGrantingPermissions(held, {
      modelPermissions: columnPermissions,
      wildcard: HeldPermissionsUtil.getColumnWildcard({
        isOperationalResource: new modelType().isOperationalResource,
        operation: type,
        tablePermissions: TablePermission.getTablePermission(modelType, type),
        columnPermissions: columnPermissions,
      }),
    });
  }

  @CaptureSpan()
  public static getAccessControlIdsForQuery<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Array<ObjectID> {
    const model: BaseModel = new modelType();

    let labelIds: Array<ObjectID> = [];

    let columnsToCheckPermissionFor: Array<string> = Object.keys(query);

    if (select) {
      columnsToCheckPermissionFor = [
        ...columnsToCheckPermissionFor,
        ...Object.keys(select),
      ];
    }

    // Build the permission context once — not per column.
    const context: AccessControlPermissionContext =
      this.buildPermissionContext(props);

    labelIds = this.getAccessControlIdsForModel(
      modelType,
      props,
      type,
      context,
    );

    const columnAccessControlDictionary: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of columnsToCheckPermissionFor) {
      const accessControl: ColumnAccessControl | null =
        columnAccessControlDictionary[column] || null;

      if (!accessControl) {
        continue;
      }

      const columnPermissions: Array<Permission> | undefined =
        type === DatabaseRequestType.Read
          ? accessControl.read
          : type === DatabaseRequestType.Create
            ? accessControl.create
            : type === DatabaseRequestType.Update
              ? accessControl.update
              : undefined;

      if (!columnPermissions) {
        continue;
      }

      labelIds = [
        ...labelIds,
        ...this.getAccessControlIdsByPermissions(
          this.getColumnGrantingPermissions(
            modelType,
            type,
            columnPermissions,
            context.held,
          ),
          context,
        ),
      ];
    }

    // get distinct labelIds
    const distinctLabelIds: Array<ObjectID> =
      ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);
    return distinctLabelIds;
  }

  private static buildPermissionContext(
    props: DatabaseCommonInteractionProps,
  ): AccessControlPermissionContext {
    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    return {
      nonAccessControlPermissions:
        PermissionHelper.getNonAccessControlPermissions(userPermissions),
      accessControlPermissions:
        PermissionHelper.getAccessControlPermissions(userPermissions),
      // The rows the table check reads (TablePermission.getHeldPermissions).
      held: HeldPermissionsUtil.fromRows({
        rows: [
          ...userPermissions,
          ...DatabaseCommonInteractionPropsUtil.getUserPermissions(
            props,
            PermissionType.Block,
          ),
        ],
      }),
    };
  }

  private static getAccessControlIdsByPermissions(
    permissions: Array<Permission>,
    context: AccessControlPermissionContext,
  ): Array<ObjectID> {
    let labelIds: Array<ObjectID> = [];

    if (
      PermissionHelper.doesPermissionsIntersect(
        permissions,
        context.nonAccessControlPermissions,
      )
    ) {
      return []; // if this is intersecting, then return empty array. We dont need to check for access control.
    }

    for (const permission of permissions) {
      for (const accessControlPermission of context.accessControlPermissions) {
        if (
          accessControlPermission.permission === permission &&
          accessControlPermission.labelIds.length > 0
        ) {
          labelIds = [...labelIds, ...accessControlPermission.labelIds];
        }
      }
    }

    // remove duplicates
    labelIds = ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);

    return labelIds;
  }
}
