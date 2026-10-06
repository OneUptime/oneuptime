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
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";

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
       * such a record only through the labelled record it belongs to - a
       * note is left out with its incident, an announcement with its status
       * pages - the way a label grant reaches it (canAccessIfCanReadOn). A
       * record that belongs to no labelled record carries no label at all,
       * so a block with labels takes nothing of it away; a block with no
       * labels is what takes a whole table away (refused above).
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
   * Leaves out the records of a label-less model whose parent (the record
   * named by canAccessIfCanReadOn) carries one of `labelIds`. A model with
   * no such parent, or whose parent carries no labels either, is left as it
   * is.
   */
  private static addParentLabelBlockToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    labelIds: Array<ObjectID>,
  ): Query<TBaseModel> {
    const model: TBaseModel = new modelType();
    const parentRelation: string | null = model.canAccessIfCanReadOn;

    if (!parentRelation) {
      return query;
    }

    const parentColumn: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(parentRelation);

    if (!parentColumn || !parentColumn.modelType) {
      return query;
    }

    const parentModelType: { new (): BaseModel } =
      parentColumn.modelType as unknown as { new (): BaseModel };
    const parentLabelsColumn: string | null =
      new parentModelType().getAccessControlColumn();

    if (!parentLabelsColumn) {
      return query;
    }

    const parentLabelsMeta: ReturnType<
      typeof QueryUtil.getManyToManyRelationMetadata
    > = QueryUtil.getManyToManyRelationMetadata(
      parentModelType,
      parentLabelsColumn,
    );

    // The parent declares labels it cannot resolve: refuse, as for a model's own.
    if (!parentLabelsMeta) {
      throw new BadDataException(
        "Cannot apply read label restrictions without access-control relation metadata.",
      );
    }

    if (
      parentColumn.type === TableColumnType.Entity &&
      parentColumn.manyToOneRelationColumn
    ) {
      const foreignKey: string = parentColumn.manyToOneRelationColumn;
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

    if (parentColumn.type === TableColumnType.EntityArray) {
      const parentLinkMeta: ReturnType<
        typeof QueryUtil.getManyToManyRelationMetadata
      > = QueryUtil.getManyToManyRelationMetadata(modelType, parentRelation);

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
    }

    return query;
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
