import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import RelationSelect from "../RelationSelect";
import Select from "../Select";
import SelectUtil from "../SelectUtil";
import BasePermission, { CheckPermissionBaseInterface } from "./BasePermission";
import TablePermission from "./TablePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Permission, { UserPermission } from "../../../../Types/Permission";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";
import { FindOperator } from "typeorm";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../../Types/Database/TableColumn";
import { OwnedThroughMetadata } from "../../../../Types/Database/AccessControl/OwnedThrough";
import Dictionary from "../../../../Types/Dictionary";
import TableColumnType from "../../../../Types/Database/TableColumnType";

// A many-to-many join table: its name and the columns on each side.
type ManyToManyMetadata = NonNullable<
  ReturnType<typeof QueryUtil.getManyToManyRelationMetadata>
>;

export interface CheckReadPermissionType<TBaseModel extends BaseModel>
  extends CheckPermissionBaseInterface<TBaseModel> {
  select: Select<TBaseModel> | null;
  relationSelect: RelationSelect<TBaseModel> | null;
}

export default class ReadPermission {
  @CaptureSpan()
  public static async checkReadPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<CheckReadPermissionType<TBaseModel>> {
    // Block and base permission checks both add predicates to the query.
    query = { ...query };

    // check block permission first.
    await this.checkReadBlockPermission(modelType, query, props);

    const baseFunctionReturn: CheckPermissionBaseInterface<TBaseModel> =
      await BasePermission.checkPermissions(
        modelType,
        query,
        select,
        props,
        DatabaseRequestType.Read,
      );

    // upate query
    query = baseFunctionReturn.query;

    let relationSelect: RelationSelect<TBaseModel> = {};

    if (select) {
      const result: {
        select: Select<TBaseModel>;
        relationSelect: RelationSelect<TBaseModel>;
      } = SelectUtil.sanitizeSelect(modelType, select);
      select = result.select;
      relationSelect = result.relationSelect;
    }

    return { query, select, relationSelect };
  }

  @CaptureSpan()
  public static async checkReadBlockPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<CheckPermissionBaseInterface<TBaseModel>> {
    // If system is making this query then let the query run!
    if (props.isRoot || props.isMasterAdmin) {
      return { query };
    }

    TablePermission.checkTableLevelBlockPermissions(
      modelType,
      props,
      DatabaseRequestType.Read,
    );

    const blockPermissionWithLabels: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      ).filter((permission: UserPermission) => {
        return permission.labelIds && permission.labelIds.length > 0;
      });

    if (blockPermissionWithLabels.length === 0) {
      return { query };
    }

    const modelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, DatabaseRequestType.Read);

    const blockPermissionsBelongToThisModel: Array<UserPermission> =
      blockPermissionWithLabels.filter((blockPermission: UserPermission) => {
        let isModelPermission: boolean = false;

        for (const permission of modelPermissions) {
          if (permission.toString() === blockPermission.permission.toString()) {
            isModelPermission = true;
            break;
          }
        }

        return isModelPermission;
      });

    if (blockPermissionsBelongToThisModel.length === 0) {
      return { query };
    }

    let labelIds: Array<ObjectID> = [];

    for (const blockPermissionBelongToThisModel of blockPermissionsBelongToThisModel) {
      if (blockPermissionBelongToThisModel.labelIds) {
        labelIds = [...labelIds, ...blockPermissionBelongToThisModel.labelIds];
      }
    }

    const model: TBaseModel = new modelType();
    const accessControlColumn: string | null = model.getAccessControlColumn();

    if (!accessControlColumn) {
      /*
       * This model's records carry no labels of their own. A block with
       * labels takes away the records carrying those labels, so it reaches
       * such a record through the labelled records it belongs to - a note
       * is left out with its incident, an announcement with its status
       * pages, an exception group with the service it was seen on (see
       * addParentLabelBlockToQuery). A record that belongs to no labelled
       * record carries no label at all, so a block with labels takes
       * nothing of it away; a block with no labels is what takes a whole
       * table away (refused above).
       */
      return {
        query: this.addParentLabelBlockToQuery(modelType, query, labelIds),
      };
    }

    const manyToManyMeta: ReturnType<
      typeof QueryUtil.getManyToManyRelationMetadata
    > = QueryUtil.getManyToManyRelationMetadata(modelType, accessControlColumn);

    /*
     * A model that declares an access-control column but whose label
     * relation cannot be resolved is misconfigured: refuse rather than let
     * the blocked records through.
     */
    if (!manyToManyMeta) {
      throw new BadDataException(
        "Cannot apply read label restrictions without access-control relation metadata.",
      );
    }

    const idQuery: Query<TBaseModel> = QueryUtil.serializeQuery(modelType, {
      _id: query._id,
    } as Query<TBaseModel>);
    const existingIdFilter: unknown = idQuery._id;
    if (
      existingIdFilter !== undefined &&
      typeof existingIdFilter !== "string" &&
      !(existingIdFilter instanceof FindOperator)
    ) {
      throw new BadDataException(
        "Cannot combine read label restrictions with an unsupported ID filter.",
      );
    }

    /*
     * Keep the caller's label selection intact. Blocking labels is a separate
     * condition on the owner: it must have none of the blocked label links.
     * Applying that condition to _id also lets grouped dashboard label filters
     * and existing record selectors reach QueryUtil without being replaced.
     * Serialize the ID condition first because QueryUtil does not descend into
     * the database AND operator to convert application query operators later.
     */
    (query as any)._id = combineWithPrivacyClause(
      existingIdFilter,
      QueryHelper.noneEntitiesInManyToMany({
        values: labelIds,
        ...manyToManyMeta,
      }),
    );

    return { query };
  }

  /*
   * Leaves out the records of a label-less model that belong to a record
   * carrying one of `labelIds`. The records a row belongs to are, in this
   * order:
   *
   *   1. the one its model names (canAccessIfCanReadOn) - an incident note's
   *      incident, an announcement's status pages;
   *   2. else the resource its owner key names (@OwnedThrough) - an on-call
   *      time log's policy, an exception group's service, host or cluster,
   *      whichever kind the key holds;
   *   3. else every labelled record it points to by a many-to-one relation -
   *      an owner row's monitor, a call log's incident or alert.
   *
   * A row whose key is empty belongs to nothing there and stays. A model
   * that names a parent it does not have is misconfigured, and refused
   * rather than read as if it had none.
   */
  private static addParentLabelBlockToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    labelIds: Array<ObjectID>,
  ): Query<TBaseModel> {
    const model: TBaseModel = new modelType();
    const declaredParent: string | null = model.canAccessIfCanReadOn;

    if (declaredParent) {
      const parentColumn: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(declaredParent);

      if (
        !parentColumn ||
        !parentColumn.modelType ||
        (parentColumn.type !== TableColumnType.Entity &&
          parentColumn.type !== TableColumnType.EntityArray)
      ) {
        throw new BadDataException(
          "Cannot apply read label restrictions without access-control relation metadata.",
        );
      }

      return this.addRelationLabelBlockToQuery(
        modelType,
        query,
        labelIds,
        declaredParent,
        parentColumn,
      );
    }

    const ownedThrough: OwnedThroughMetadata | undefined = (
      model as unknown as { ownedThrough?: OwnedThroughMetadata }
    ).ownedThrough;

    if (ownedThrough) {
      for (const parentModel of ownedThrough.parentModels) {
        query = this.addForeignKeyLabelBlockToQuery(
          modelType,
          query,
          labelIds,
          ownedThrough.fkColumn,
          parentModel as unknown as { new (): BaseModel },
        );
      }

      return query;
    }

    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    for (const columnName of Object.keys(columns)) {
      const column: TableColumnMetadata | undefined = columns[columnName];

      if (
        column &&
        column.type === TableColumnType.Entity &&
        column.manyToOneRelationColumn &&
        column.modelType
      ) {
        query = this.addRelationLabelBlockToQuery(
          modelType,
          query,
          labelIds,
          columnName,
          column,
        );
      }
    }

    return query;
  }

  /*
   * Leaves out the records whose `relation` (one record, or several through
   * a join table) carries one of `labelIds`. A related model with no labels
   * takes nothing away.
   */
  private static addRelationLabelBlockToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    labelIds: Array<ObjectID>,
    relation: string,
    relationColumn: TableColumnMetadata,
  ): Query<TBaseModel> {
    const parentModelType: { new (): BaseModel } =
      relationColumn.modelType as unknown as { new (): BaseModel };

    if (
      relationColumn.type === TableColumnType.Entity &&
      relationColumn.manyToOneRelationColumn
    ) {
      return this.addForeignKeyLabelBlockToQuery(
        modelType,
        query,
        labelIds,
        relationColumn.manyToOneRelationColumn,
        parentModelType,
      );
    }

    if (relationColumn.type !== TableColumnType.EntityArray) {
      return query;
    }

    const parentLabelsMeta: ManyToManyMetadata | null =
      this.getLabelsMetadata(parentModelType);

    if (!parentLabelsMeta) {
      return query;
    }

    const parentLinkMeta: ManyToManyMetadata | null =
      QueryUtil.getManyToManyRelationMetadata(modelType, relation);

    if (!parentLinkMeta) {
      throw new BadDataException(
        "Cannot apply read label restrictions without access-control relation metadata.",
      );
    }

    const idQuery: Query<TBaseModel> = QueryUtil.serializeQuery(modelType, {
      _id: query._id,
    } as Query<TBaseModel>);

    (query as any)._id = combineWithPrivacyClause(
      this.getSupportedFilter(idQuery._id),
      QueryHelper.noParentLinkedToAnyInManyToMany({
        values: labelIds,
        parentJoinTableName: parentLinkMeta.joinTableName,
        parentOwnerColumnName: parentLinkMeta.ownerColumnName,
        parentRelationColumnName: parentLinkMeta.relationColumnName,
        ...parentLabelsMeta,
      }),
    );

    return query;
  }

  /*
   * Leaves out the records whose `foreignKey` names a `parentModelType`
   * record carrying one of `labelIds`; a record whose key is empty, or names
   * a record without those labels, stays. Several conditions on one key (a
   * key that can name several kinds of resource) all hold.
   */
  private static addForeignKeyLabelBlockToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    labelIds: Array<ObjectID>,
    foreignKey: string,
    parentModelType: { new (): BaseModel },
  ): Query<TBaseModel> {
    const parentLabelsMeta: ManyToManyMetadata | null =
      this.getLabelsMetadata(parentModelType);

    if (!parentLabelsMeta) {
      return query;
    }

    const keyQuery: Query<TBaseModel> = QueryUtil.serializeQuery(modelType, {
      [foreignKey]: (query as any)[foreignKey],
    } as Query<TBaseModel>);

    (query as any)[foreignKey] = combineWithPrivacyClause(
      this.getSupportedFilter((keyQuery as any)[foreignKey]),
      QueryHelper.parentLinkedToNoneInManyToMany({
        values: labelIds,
        ...parentLabelsMeta,
      }),
    );

    return query;
  }

  /*
   * The join table holding a model's labels, or null for a model that
   * carries none. A model that declares labels it cannot resolve is
   * refused, as for a model's own labels.
   */
  private static getLabelsMetadata(modelType: {
    new (): BaseModel;
  }): ManyToManyMetadata | null {
    const labelsColumn: string | null =
      new modelType().getAccessControlColumn();

    if (!labelsColumn) {
      return null;
    }

    const labelsMeta: ManyToManyMetadata | null =
      QueryUtil.getManyToManyRelationMetadata(modelType, labelsColumn);

    if (!labelsMeta) {
      throw new BadDataException(
        "Cannot apply read label restrictions without access-control relation metadata.",
      );
    }

    return labelsMeta;
  }

  /*
   * A caller's filter on a column a block's condition is added to, once
   * serialized: nothing, one value or a database operator. Any other shape
   * cannot be kept next to the condition, so the read is refused rather
   * than the caller's filter dropped.
   */
  private static getSupportedFilter(serialized: unknown): unknown {
    if (
      serialized !== undefined &&
      typeof serialized !== "string" &&
      !(serialized instanceof FindOperator)
    ) {
      throw new BadDataException(
        "Cannot combine read label restrictions with an unsupported ID filter.",
      );
    }

    return serialized;
  }
}
