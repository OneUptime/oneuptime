import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import RelationSelect from "../RelationSelect";
import Select from "../Select";
import SelectUtil from "../SelectUtil";
import AccessControlPermission from "./AccessControlPermission";
import BasePermission, { CheckPermissionBaseInterface } from "./BasePermission";
import TablePermission from "./TablePermission";
import ArrayUtil from "../../../../Utils/Array";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
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
   * Key columns whose record's kind cannot be told from the column (a
   * resource id several kinds of resource share). Each is weighed against
   * the labels of every model that carries labels, in one condition: a
   * record id names one record in the whole database, so it can only match
   * the labels of the record it names.
   */
  anyKindColumns: Array<string>;
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
let labelledModelTypes: Array<{ new (): BaseModel }> | null = null;

// Every model whose records carry labels.
function getLabelledModelTypes(): Array<{ new (): BaseModel }> {
  if (!labelledModelTypes) {
    labelledModelTypes = AllModelTypes.filter(
      (modelType: { new (): BaseModel }): boolean => {
        return Boolean(new modelType().getAccessControlColumn());
      },
    );
  }

  return labelledModelTypes;
}

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

/*
 * The two halves of the label rule (see addLabelRulesToQuery). A block
 * takes away the records carrying its labels; a grant limited to labels
 * gives only the records carrying them.
 */
export enum LabelRule {
  Block = "Block",
  Grant = "Grant",
}

// The operations a query narrows: a create names no record yet.
export type RecordOperation =
  | DatabaseRequestType.Read
  | DatabaseRequestType.Update
  | DatabaseRequestType.Delete;

export default class ReadPermission {
  @CaptureSpan()
  public static async checkReadPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<CheckReadPermissionType<TBaseModel>> {
    // The base permission check adds predicates to the query.
    query = { ...query };

    /*
     * A block with no labels refuses the read before anything else. A block
     * with labels narrows the rows, with the rest of the label rule, where
     * every read, update and delete is narrowed - in each project of a read
     * across projects with that project's own rows (BasePermission
     * .addRecordScopeToQuery).
     */
    if (!props.isRoot && !props.isMasterAdmin) {
      TablePermission.checkTableLevelBlockPermissions(
        modelType,
        props,
        DatabaseRequestType.Read,
      );
    }

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

  /*
   * A team's block, on a read the CRUD path does not make itself (a pin's
   * own lookup): a block with no labels on one of the table's read
   * permissions refuses the read; a block with labels leaves out the records
   * carrying them, and the records of a label-less model that name such a
   * record (addLabelBlockToQuery). Every read, update and delete of the CRUD
   * path applies the same rule where it narrows its rows
   * (BasePermission.addRecordScopeToQuery).
   */
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

    return {
      query: this.addLabelBlockToQuery(
        modelType,
        query,
        props,
        DatabaseRequestType.Read,
      ),
    };
  }

  /*
   * THE LABEL RULE, on a read, an update or a delete: both of its halves,
   * for the rows `props` reach in one project.
   *
   *   - A block with labels on one of the operation's permissions takes away
   *     the records carrying those labels (addLabelBlockToQuery).
   *   - A grant limited to labels gives a label-less model's rows only where
   *     the labelled records they belong to or name carry one of those
   *     labels (addLabelGrantToQuery). A labelled model's own labels are
   *     weighed by AccessControlPermission.addAccessControlIdsToQuery.
   *
   * Both halves follow the same records (getLabelledReferences). A block
   * with no labels refuses the table before this (TablePermission).
   */
  public static addLabelRulesToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: RecordOperation,
  ): Query<TBaseModel> {
    query = this.addLabelGrantToQuery(modelType, query, props, type);

    return this.addLabelBlockToQuery(modelType, query, props, type);
  }

  /*
   * The caller's block rows with labels on one of the permissions the
   * operation accepts on this model.
   */
  public static getLabelledBlockRows(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: RecordOperation,
  ): Array<UserPermission> {
    if (props.isRoot || props.isMasterAdmin) {
      return [];
    }

    const modelPermissions: Array<string> = TablePermission.getTablePermission(
      modelType,
      type,
    ).map((permission: Permission): string => {
      return permission.toString();
    });

    return DatabaseCommonInteractionPropsUtil.getUserPermissions(
      props,
      PermissionType.Block,
    ).filter((row: UserPermission): boolean => {
      return (
        Boolean(row.labelIds && row.labelIds.length > 0) &&
        modelPermissions.includes(row.permission.toString())
      );
    });
  }

  // The labels the caller's blocks take away for the operation on this model.
  public static getBlockedLabelIds(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: RecordOperation,
  ): Array<ObjectID> {
    const labelIds: Array<ObjectID> = [];

    for (const row of this.getLabelledBlockRows(modelType, props, type)) {
      labelIds.push(...(row.labelIds || []));
    }

    return ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);
  }

  /*
   * The labels the caller's grants for the operation on this model are
   * limited to: none when one of those grants reaches the whole project, or
   * when none of them is limited to labels
   * (AccessControlPermission.getAccessControlIdsForModel).
   */
  public static getGrantedLabelIds(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: RecordOperation,
  ): Array<ObjectID> {
    if (props.isRoot || props.isMasterAdmin) {
      return [];
    }

    return AccessControlPermission.getAccessControlIdsForModel(
      modelType,
      props,
      type,
    );
  }

  /*
   * A block with labels, on a read, an update or a delete: the records
   * carrying one of its labels are left out - a labelled model's by its own
   * labels, a label-less model's through the labelled records it belongs to
   * or names: a note is left out with its incident, an announcement with its
   * status pages, an exception group with the service it was seen on, an AI
   * run with its monitor (addReferenceLabelRuleToQuery). A record that names
   * no labelled record carries no label at all, so a block with labels takes
   * nothing of it away; a block with no labels is what takes a whole table
   * away (TablePermission).
   */
  public static addLabelBlockToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: RecordOperation,
  ): Query<TBaseModel> {
    const labelIds: Array<ObjectID> = this.getBlockedLabelIds(
      modelType,
      props,
      type,
    );

    if (labelIds.length === 0) {
      return query;
    }

    const model: TBaseModel = new modelType();
    const accessControlColumn: string | null = model.getAccessControlColumn();

    if (!accessControlColumn) {
      return this.addReferenceLabelRuleToQuery(
        modelType,
        query,
        labelIds,
        LabelRule.Block,
      );
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
    const existingIdFilter: unknown = this.getSupportedFilter(idQuery._id);

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

    return query;
  }

  /*
   * A grant limited to labels, on a label-less model: when every grant the
   * caller holds for the operation is limited to labels, a row is kept only
   * where each labelled record it belongs to or names carries one of those
   * labels - the mirror of a block, through the same records
   * (addReferenceLabelRuleToQuery). A row that names no labelled record is
   * about none of them and stays. A grant over the whole project narrows
   * nothing; a labelled model's own labels are weighed by
   * AccessControlPermission.addAccessControlIdsToQuery.
   */
  public static addLabelGrantToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: RecordOperation,
  ): Query<TBaseModel> {
    if (new modelType().getAccessControlColumn()) {
      return query;
    }

    const labelIds: Array<ObjectID> = this.getGrantedLabelIds(
      modelType,
      props,
      type,
    );

    if (labelIds.length === 0) {
      return query;
    }

    return this.addReferenceLabelRuleToQuery(
      modelType,
      query,
      labelIds,
      LabelRule.Grant,
    );
  }

  /*
   * THE LABEL RULE ON A LABEL-LESS MODEL, through the labelled records its
   * rows belong to or name:
   *
   *   - the parent its model names (canAccessIfCanReadOn) - an incident
   *     note's incident, an announcement's status pages;
   *   - every record it names by key (getLabelledReferences) - the resource
   *     its owner key names, a many-to-one relation's record, a plain id
   *     column's record (an AI run's monitor, an on-call time log's
   *     schedule), and the record a resource id of any kind names (an
   *     inventory item's resource).
   *
   * A block leaves out the rows that belong to, or name, a record carrying
   * one of `labelIds`. A grant keeps only the rows whose every such record
   * carries one of them. Either way a row whose key is empty names nothing
   * there, and stays. A model that names a parent it does not have is
   * misconfigured and refused.
   */
  private static addReferenceLabelRuleToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    labelIds: Array<ObjectID>,
    rule: LabelRule,
  ): Query<TBaseModel> {
    const model: TBaseModel = new modelType();
    const declaredParent: string | null = model.canAccessIfCanReadOn;
    let declaredColumn: TableColumnMetadata | undefined = undefined;

    if (declaredParent) {
      declaredColumn = model.getTableColumnMetadata(declaredParent);

      /*
       * A parent is one record named by a key column, or several through a
       * join table. Anything else names nothing the rule could follow.
       */
      if (
        !declaredColumn ||
        !declaredColumn.modelType ||
        (declaredColumn.type !== TableColumnType.Entity &&
          declaredColumn.type !== TableColumnType.EntityArray) ||
        (declaredColumn.type === TableColumnType.Entity &&
          !declaredColumn.manyToOneRelationColumn)
      ) {
        throw new BadDataException(
          "Cannot apply read label restrictions without access-control relation metadata.",
        );
      }
    }

    const references: LabelledReferences =
      ReadPermission.getLabelledReferences(modelType);

    // A parent through a join table (an announcement's status pages).
    if (
      declaredParent &&
      declaredColumn &&
      declaredColumn.type === TableColumnType.EntityArray
    ) {
      query = this.addRelationLabelRuleToQuery(
        modelType,
        query,
        labelIds,
        declaredParent,
        declaredColumn,
        rule,
      );
    }

    // Every record named by key, the declared parent's key among them.
    for (const reference of references.keys) {
      if (rule === LabelRule.Grant) {
        query = this.addForeignKeyLabelGrantToQuery(
          modelType,
          query,
          labelIds,
          reference.column,
          reference.modelTypes,
        );
        continue;
      }

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

    // A record id of any kind, against the labels of every labelled model.
    for (const column of references.anyKindColumns) {
      query = this.addAnyKindLabelRuleToQuery(
        modelType,
        query,
        labelIds,
        column,
        rule,
      );
    }

    return query;
  }

  /*
   * The rule on a `foreignKey` that is a record id of any kind, in one
   * condition over the label join tables of every model that carries
   * labels: a block leaves out the records whose key names a record carrying
   * one of `labelIds`, a grant keeps only those whose key names a record
   * carrying one of them. A record whose key is empty stays.
   */
  private static addAnyKindLabelRuleToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    labelIds: Array<ObjectID>,
    foreignKey: string,
    rule: LabelRule,
  ): Query<TBaseModel> {
    const joinTables: Array<ManyToManyMetadata> = [];

    for (const labelledModelType of getLabelledModelTypes()) {
      const labelsMeta: ManyToManyMetadata | null =
        this.getLabelsMetadata(labelledModelType);

      if (labelsMeta) {
        joinTables.push(labelsMeta);
      }
    }

    const keyQuery: Query<TBaseModel> = QueryUtil.serializeQuery(modelType, {
      [foreignKey]: (query as any)[foreignKey],
    } as Query<TBaseModel>);

    (query as any)[foreignKey] = combineWithPrivacyClause(
      this.getSupportedFilter((keyQuery as any)[foreignKey]),
      rule === LabelRule.Grant
        ? QueryHelper.linkedToAnyInAnyManyToMany({
            values: labelIds,
            joinTables: joinTables,
          })
        : QueryHelper.linkedToNoneInAnyManyToMany({
            values: labelIds,
            joinTables: joinTables,
          }),
    );

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
   * resource share) names a record of any kind: it is weighed against every
   * model that carries labels (anyKindColumns), unless it is known to name
   * a record that carries no labels (PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS).
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

    const anyKindColumns: Array<string> = [];

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
        anyKindColumns.push(columnName);
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
      anyKindColumns: anyKindColumns,
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
   * The rule on a `relation` (one record, or several through a join table):
   * a block leaves out the records whose related record carries one of
   * `labelIds`; a grant keeps only those whose every related record carries
   * one of them. A related model with no labels decides nothing.
   */
  private static addRelationLabelRuleToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    labelIds: Array<ObjectID>,
    relation: string,
    relationColumn: TableColumnMetadata,
    rule: LabelRule,
  ): Query<TBaseModel> {
    const parentModelType: { new (): BaseModel } =
      relationColumn.modelType as unknown as { new (): BaseModel };

    if (
      relationColumn.type === TableColumnType.Entity &&
      relationColumn.manyToOneRelationColumn
    ) {
      return rule === LabelRule.Grant
        ? this.addForeignKeyLabelGrantToQuery(
            modelType,
            query,
            labelIds,
            relationColumn.manyToOneRelationColumn,
            [parentModelType],
          )
        : this.addForeignKeyLabelBlockToQuery(
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

    const parentLinks: {
      values: Array<ObjectID>;
      parentJoinTableName: string;
      parentOwnerColumnName: string;
      parentRelationColumnName: string;
      joinTableName: string;
      ownerColumnName: string;
      relationColumnName: string;
    } = {
      values: labelIds,
      parentJoinTableName: parentLinkMeta.joinTableName,
      parentOwnerColumnName: parentLinkMeta.ownerColumnName,
      parentRelationColumnName: parentLinkMeta.relationColumnName,
      ...parentLabelsMeta,
    };

    (query as any)._id = combineWithPrivacyClause(
      this.getSupportedFilter(idQuery._id),
      rule === LabelRule.Grant
        ? QueryHelper.everyParentLinkedToAnyInManyToMany(parentLinks)
        : QueryHelper.noParentLinkedToAnyInManyToMany(parentLinks),
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
   * Keeps only the records whose `foreignKey` names a record, of one of
   * `parentModelTypes`, carrying one of `labelIds` - in one condition: a key
   * that can name several kinds of resource names one record, of one kind.
   * A record whose key is empty stays.
   */
  private static addForeignKeyLabelGrantToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    labelIds: Array<ObjectID>,
    foreignKey: string,
    parentModelTypes: Array<{ new (): BaseModel }>,
  ): Query<TBaseModel> {
    const joinTables: Array<ManyToManyMetadata> = [];

    for (const parentModelType of parentModelTypes) {
      const parentLabelsMeta: ManyToManyMetadata | null =
        this.getLabelsMetadata(parentModelType);

      if (parentLabelsMeta) {
        joinTables.push(parentLabelsMeta);
      }
    }

    if (joinTables.length === 0) {
      return query;
    }

    const keyQuery: Query<TBaseModel> = QueryUtil.serializeQuery(modelType, {
      [foreignKey]: (query as any)[foreignKey],
    } as Query<TBaseModel>);

    (query as any)[foreignKey] = combineWithPrivacyClause(
      this.getSupportedFilter((keyQuery as any)[foreignKey]),
      QueryHelper.linkedToAnyInAnyManyToMany({
        values: labelIds,
        joinTables: joinTables,
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
