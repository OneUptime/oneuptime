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
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import UserAttribution from "../../../../Types/Database/UserAttribution";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
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

// The labelled records a label-less model's rows name, by key column.
export interface LabelledReferences {
  keys: Array<{ column: string; modelTypes: Array<{ new (): BaseModel }> }>;
  /*
   * Key columns whose record cannot be told: a block with labels on the
   * model refuses its reads rather than let rows naming a blocked record
   * through.
   */
  unresolvedColumns: Array<string>;
}

/*
 * Plain id columns, by "<table>.<column>", that name a record carrying no
 * labels although their names do not say which: a project's single sign-on
 * provider, an ingestion key, the instance, a digest batch.
 */
export const PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS: ReadonlySet<string> =
  new Set<string>([
    "Project.requireSsoWithSsoProviderId",
    "McpOAuthGrant.ssoProviderId",
    "KubernetesAiAgent.registeredWithIngestionKeyId",
    "ResourceAiAgent.registeredWithIngestionKeyId",
    "GlobalConfig.instanceId",
    "UserNotificationEmailRollupItem.rollupBatchId",
  ]);

// Worked out once per model class: the columns do not change.
const labelledReferencesCache: WeakMap<
  { new (): BaseModel },
  LabelledReferences
> = new WeakMap<{ new (): BaseModel }, LabelledReferences>();

interface ModelByTableName {
  lowerTableName: string;
  modelType: { new (): BaseModel };
}

let modelsByTableName: Array<ModelByTableName> | null = null;

// Every model by table name, longest first, for getModelNamedByColumn.
function getModelsByTableName(): Array<ModelByTableName> {
  if (!modelsByTableName) {
    modelsByTableName = AllModelTypes.map(
      (modelType: { new (): BaseModel }): ModelByTableName => {
        return {
          lowerTableName: (new modelType().tableName || "").toLowerCase(),
          modelType: modelType,
        };
      },
    )
      .filter((entry: ModelByTableName): boolean => {
        return entry.lowerTableName.length > 0;
      })
      .sort((a: ModelByTableName, b: ModelByTableName): number => {
        return b.lowerTableName.length - a.lowerTableName.length;
      });
  }

  return modelsByTableName;
}

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
       * such a record through the labelled records it belongs to or names -
       * a note is left out with its incident, an announcement with its
       * status pages, an exception group with the service it was seen on,
       * an AI run with its monitor (see addParentLabelBlockToQuery). A
       * record that names no labelled record carries no label at all, so a
       * block with labels takes nothing of it away; a block with no labels
       * is what takes a whole table away (refused above).
       */
      return {
        query: this.addParentLabelBlockToQuery(
          modelType,
          query,
          labelIds,
          blockPermissionsBelongToThisModel[0]!.permission,
        ),
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
   * Leaves out the records of a label-less model that belong to, or name, a
   * record carrying one of `labelIds`:
   *
   *   - the parent its model names (canAccessIfCanReadOn) - an incident
   *     note's incident, an announcement's status pages;
   *   - every record it names by key (getLabelledReferences) - the resource
   *     its owner key names, a many-to-one relation's record, a plain id
   *     column's record (an AI run's monitor, an on-call time log's
   *     schedule).
   *
   * A row whose key is empty names nothing there and stays. A model that
   * names a parent it does not have is misconfigured and refused; a model
   * with a key column whose record cannot be told (a resource id shared by
   * several kinds of resource) is refused as a block with no labels refuses
   * it, rather than let rows naming a blocked record through.
   */
  private static addParentLabelBlockToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    labelIds: Array<ObjectID>,
    blockedPermission: Permission,
  ): Query<TBaseModel> {
    const model: TBaseModel = new modelType();
    const declaredParent: string | null = model.canAccessIfCanReadOn;
    let declaredColumn: TableColumnMetadata | undefined = undefined;

    if (declaredParent) {
      declaredColumn = model.getTableColumnMetadata(declaredParent);

      if (
        !declaredColumn ||
        !declaredColumn.modelType ||
        (declaredColumn.type !== TableColumnType.Entity &&
          declaredColumn.type !== TableColumnType.EntityArray)
      ) {
        throw new BadDataException(
          "Cannot apply read label restrictions without access-control relation metadata.",
        );
      }
    }

    const references: LabelledReferences =
      ReadPermission.getLabelledReferences(modelType);

    if (references.unresolvedColumns.length > 0) {
      throw new NotAuthorizedException(
        `You are not authorized to read ${model.singularName} because ${blockedPermission} is in your team's permission block list.`,
      );
    }

    // A parent through a join table (an announcement's status pages).
    if (
      declaredParent &&
      declaredColumn &&
      declaredColumn.type === TableColumnType.EntityArray
    ) {
      query = this.addRelationLabelBlockToQuery(
        modelType,
        query,
        labelIds,
        declaredParent,
        declaredColumn,
      );
    }

    // Every record named by key, the declared parent's key among them.
    for (const reference of references.keys) {
      for (const parentModelType of reference.modelTypes) {
        query = this.addForeignKeyLabelBlockToQuery(
          modelType,
          query,
          labelIds,
          reference.column,
          parentModelType,
        );
      }
    }

    return query;
  }

  /*
   * THE LABELLED RECORDS A ROW OF A LABEL-LESS MODEL NAMES BY KEY, by column:
   *
   *   - a many-to-one relation's key, to the relation's model;
   *   - the owner key (@OwnedThrough), to each kind of resource it can name;
   *   - a plain id column, to the model its name ends with (`monitorId`,
   *     `triggeredByIncidentId`, `currentActiveAlertId`), matched on a word
   *     boundary, longest name first.
   *
   * Only models that carry labels are kept. Who did something to the row
   * (`createdByUserId`) names a user, and users carry no labels. A plain id
   * column whose name says nothing (`resourceId`, which several kinds of
   * resource share) is unresolved, unless it is known to name a record that
   * carries no labels (PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS).
   */
  public static getLabelledReferences(modelType: {
    new (): BaseModel;
  }): LabelledReferences {
    const cached: LabelledReferences | undefined =
      labelledReferencesCache.get(modelType);

    if (cached) {
      return cached;
    }

    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const keys: Map<string, Set<{ new (): BaseModel }>> = new Map();
    const keyColumns: Set<string> = new Set<string>();

    const addKey: (
      column: string,
      referencedModelType: { new (): BaseModel },
    ) => void = (
      column: string,
      referencedModelType: { new (): BaseModel },
    ): void => {
      if (!new referencedModelType().getAccessControlColumn()) {
        return;
      }

      const modelTypes: Set<{ new (): BaseModel }> =
        keys.get(column) || new Set<{ new (): BaseModel }>();
      modelTypes.add(referencedModelType);
      keys.set(column, modelTypes);
    };

    for (const columnName of Object.keys(columns)) {
      const column: TableColumnMetadata | undefined = columns[columnName];

      if (
        column &&
        column.type === TableColumnType.Entity &&
        column.manyToOneRelationColumn
      ) {
        keyColumns.add(column.manyToOneRelationColumn);

        if (column.modelType) {
          addKey(
            column.manyToOneRelationColumn,
            column.modelType as unknown as { new (): BaseModel },
          );
        }
      }
    }

    const ownedThrough: OwnedThroughMetadata | undefined = (
      model as unknown as { ownedThrough?: OwnedThroughMetadata }
    ).ownedThrough;

    if (ownedThrough) {
      keyColumns.add(ownedThrough.fkColumn);

      for (const parentModel of ownedThrough.parentModels) {
        addKey(
          ownedThrough.fkColumn,
          parentModel as unknown as { new (): BaseModel },
        );
      }
    }

    const unresolvedColumns: Array<string> = [];

    for (const columnName of Object.keys(columns)) {
      const column: TableColumnMetadata | undefined = columns[columnName];

      if (
        !column ||
        column.type !== TableColumnType.ObjectID ||
        !columnName.endsWith("Id") ||
        keyColumns.has(columnName) ||
        UserAttribution.isColumn(columnName) ||
        PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS.has(
          `${model.tableName}.${columnName}`,
        )
      ) {
        continue;
      }

      const namedModelType: { new (): BaseModel } | null =
        ReadPermission.getModelNamedByColumn(columnName);

      if (!namedModelType) {
        unresolvedColumns.push(columnName);
        continue;
      }

      addKey(columnName, namedModelType);
    }

    const references: LabelledReferences = {
      keys: Array.from(keys.entries()).map(
        ([column, modelTypes]: [string, Set<{ new (): BaseModel }>]) => {
          return { column: column, modelTypes: Array.from(modelTypes) };
        },
      ),
      unresolvedColumns: unresolvedColumns,
    };

    labelledReferencesCache.set(modelType, references);

    return references;
  }

  /*
   * The model a plain id column's name ends with - `currentActiveAlertId`
   * names an Alert, `aiAgentId` an AIAgent - matched on a word boundary
   * (the start of the name, or a capital letter), longest table name first.
   * Null when no model's name ends it.
   */
  private static getModelNamedByColumn(columnName: string): {
    new (): BaseModel;
  } | null {
    const base: string = columnName.slice(0, -"Id".length);
    const lowerBase: string = base.toLowerCase();

    for (const entry of getModelsByTableName()) {
      if (!lowerBase.endsWith(entry.lowerTableName)) {
        continue;
      }

      const start: number = base.length - entry.lowerTableName.length;
      const firstLetter: string = base.charAt(start);

      if (start === 0 || firstLetter !== firstLetter.toLowerCase()) {
        return entry.modelType;
      }
    }

    return null;
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
  public static getSupportedFilter(
    serialized: unknown,
    refusal: string = "Cannot combine read label restrictions with an unsupported ID filter.",
  ): unknown {
    if (
      serialized !== undefined &&
      typeof serialized !== "string" &&
      !(serialized instanceof FindOperator)
    ) {
      throw new BadDataException(refusal);
    }

    return serialized;
  }
}
