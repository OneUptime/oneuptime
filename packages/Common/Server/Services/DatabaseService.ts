import { EncryptionSecret, WorkflowHostname } from "../EnvironmentConfig";
import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import AggregateBy, {
  AggregateColumn,
  AggregateRow,
} from "../Types/Database/AggregateBy";
import CountBy from "../Types/Database/CountBy";
import FindAllBy from "../Types/Database/FindAllBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import DeleteById from "../Types/Database/DeleteById";
import DeleteOneBy from "../Types/Database/DeleteOneBy";
import FindBy from "../Types/Database/FindBy";
import FindOneBy from "../Types/Database/FindOneBy";
import FindOneByID from "../Types/Database/FindOneByID";
import {
  DatabaseTriggerType,
  OnCreate,
  OnDelete,
  OnFind,
  OnUpdate,
} from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import PublicPermission from "../Types/Database/Permissions/PublicPermission";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import OwnerOnlyColumnPermission from "../Types/Database/Permissions/OwnerOnlyColumnPermission";
import { CheckReadPermissionType } from "../Types/Database/Permissions/ReadPermission";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationSelect from "../Types/Database/RelationSelect";
import SearchBy from "../Types/Database/SearchBy";
import SearchResult from "../Types/Database/SearchResult";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import UpdateByID from "../Types/Database/UpdateByID";
import UpdateByIDAndFetch from "../Types/Database/UpdateByIDAndFetch";
import UpdateOneBy from "../Types/Database/UpdateOneBy";
import Encryption from "../Utils/Encryption";
import PasswordHash from "../Utils/PasswordHash";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import logger, { LogAttributes } from "../Utils/Logger";
import ConfigLogLevel from "../Types/ConfigLogLevel";
import BaseService from "./BaseService";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RelationOnlyRuleBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/RelationOnlyRuleBaseModel";
import RuleBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import { WorkflowRoute } from "../../ServiceRoute";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import Sort from "../../Types/BaseDatabase/Sort";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { getMaxLengthFromTableColumnType } from "../../Types/Database/ColumnLength";
import Columns from "../../Types/Database/Columns";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { getUniqueColumnsBy } from "../../Types/Database/UniqueColumnBy";
import UserAttribution, {
  ATTRIBUTED_SWITCHES,
  CREATED_BY_USER_ID_COLUMN,
} from "../../Types/Database/UserAttribution";
import QueryOperator from "../../Types/BaseDatabase/QueryOperator";
import OneUptimeDate from "../../Types/Date";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import Exception from "../../Types/Exception/Exception";
import HashedString from "../../Types/HashedString";
import { JSONObject, JSONValue, ObjectType } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import TelemetryContext from "../Utils/Telemetry/TelemetryContext";
import PositiveNumber from "../../Types/PositiveNumber";
import Text from "../../Types/Text";
import Typeof from "../../Types/Typeof";
import API from "../../Utils/API";
import Slug from "../../Utils/Slug";
import { getRuleCriteriaValidationError } from "../../Utils/Rules/RuleCriteriaMatcher";
import { getMonitorTypeCriteriaValidationError } from "../../Utils/Rules/MonitorTypeRuleCriteria";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RuleCriteriaOperator,
} from "../../Types/Rules/RuleCriteria";
import { getRuleCriteriaFieldsForModel } from "../../Types/Rules/RuleCriteriaFieldRegistry";
import {
  DataSource,
  Driver,
  EntityManager,
  Repository,
  SelectQueryBuilder,
  UpdateResult,
} from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import { ObjectLiteral } from "typeorm/common/ObjectLiteral";
import { FindWhere } from "../../Types/BaseDatabase/Query";
import Realtime from "../Utils/Realtime";
import ModelEventType from "../../Types/Realtime/ModelEventType";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import type AuditLogServiceType from "./AuditLogService";
import EnableAuditLogOn from "../../Types/BaseDatabase/EnableAuditLogOn";
import RelationValueUtil from "../Utils/Database/RelationValueUtil";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import RelationNames from "../Utils/Database/RelationNames";
import ListOrderMaintainer, {
  ListOrderCreatePlan,
  ListOrderScope,
} from "../Utils/Database/ListOrderMaintainer";
import { ListOrderSettings } from "../../Types/Database/ListOrderColumn";
import { toListOrderNumber } from "../../Utils/ListOrder";
import FileOwnership, {
  FileReferenceCheck,
  FileReferenceColumn,
  FileReferenceOwner,
  normalizeFileId,
} from "../Utils/File/FileOwnership";
import RelatedFileAccess, {
  RelatedFileReader,
} from "../Utils/File/RelatedFileAccess";
import PublishedImages, { CascadedRow } from "../Utils/File/PublishedImages";
import StatusPageOverviewCache from "../Utils/StatusPage/StatusPageOverviewCache";
import CallerPlan from "../Utils/Billing/CallerPlan";

const RULE_CRITERIA_RELATION_OPERATORS: ReadonlySet<RuleCriteriaOperator> =
  new Set<RuleCriteriaOperator>([
    RuleCriteriaOperator.HasAnyOf,
    RuleCriteriaOperator.HasAllOf,
    RuleCriteriaOperator.HasNoneOf,
  ]);

/*
 * A switch an update turns, and the who and when columns the server stamped
 * for it (see stampSwitchAttribution).
 */
interface SwitchStamp {
  switchColumn: string;
  isOn: boolean;
  stampedColumns: Array<string>;
}

// A hook-free write to one row by id, ready to run (see buildColumnsByIdUpdateStatement).
interface ColumnsByIdUpdateStatement {
  tableName: string;
  primaryColumnName: string;
  setSql: string;
  whereSql: string;
  params: Array<unknown>;
}

/*
 * The query a write's hooks are handed in place of the one sent (see
 * pinQueryToRows), and whether it names the rows themselves by _id.
 */
interface PinnedQuery<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  namesTheRows: boolean;
}

class DatabaseService<TBaseModel extends BaseModel> extends BaseService {
  public modelType!: { new (): TBaseModel };
  private model!: TBaseModel;
  private modelName!: string;
  private userAttributionColumns: Array<string> | null = null;

  private _hardDeleteItemByColumnName: string = "";
  public get hardDeleteItemByColumnName(): string {
    return this._hardDeleteItemByColumnName;
  }
  public set hardDeleteItemByColumnName(v: string) {
    this._hardDeleteItemByColumnName = v;
  }

  private _hardDeleteItemsOlderThanDays: number = 0;
  public get hardDeleteItemsOlderThanDays(): number {
    return this._hardDeleteItemsOlderThanDays;
  }
  public set hardDeleteItemsOlderThanDays(v: number) {
    this._hardDeleteItemsOlderThanDays = v;
  }

  public doNotAllowDelete: boolean = false;

  public constructor(modelType: { new (): TBaseModel }) {
    super();
    this.modelType = modelType;
    this.model = new modelType();
    this.modelName = modelType.name;
  }

  public setDoNotAllowDelete(doNotAllowDelete: boolean): void {
    this.doNotAllowDelete = doNotAllowDelete;
  }

  public hardDeleteItemsOlderThanInDays(
    columnName: string,
    olderThan: number,
  ): void {
    this.hardDeleteItemByColumnName = columnName;
    this.hardDeleteItemsOlderThanDays = olderThan;
  }

  public getModel(): TBaseModel {
    return this.model;
  }

  public getQueryBuilder(modelName: string): SelectQueryBuilder<TBaseModel> {
    return this.getRepository().createQueryBuilder(modelName);
  }

  public getRepository(): Repository<TBaseModel> {
    if (!PostgresAppInstance.isConnected()) {
      throw new DatabaseNotConnectedException();
    }

    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (dataSource) {
      return dataSource.getRepository<TBaseModel>(this.modelType.name);
    }

    throw new DatabaseNotConnectedException();
  }

  public async executeTransaction<TResult>(
    runInTransaction: (entityManager: EntityManager) => Promise<TResult>,
  ): Promise<TResult> {
    if (!PostgresAppInstance.isConnected()) {
      throw new DatabaseNotConnectedException();
    }

    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new DatabaseNotConnectedException();
    }

    return await dataSource.transaction(runInTransaction);
  }

  protected isValid(data: TBaseModel): boolean {
    if (!data) {
      throw new BadDataException("Data cannot be null");
    }

    return true;
  }

  protected generateDefaultValues(data: TBaseModel): TBaseModel {
    const tableColumns: Array<string> = data.getTableColumns().columns;

    for (const column of tableColumns) {
      const metadata: TableColumnMetadata = data.getTableColumnMetadata(column);
      if (metadata.forceGetDefaultValueOnCreate) {
        (data as any)[column] = metadata.forceGetDefaultValueOnCreate();
      }
    }

    return data;
  }

  protected async checkForUniqueValues(data: TBaseModel): Promise<TBaseModel> {
    const tableColumns: Array<string> = data.getTableColumns().columns;

    for (const columnName of tableColumns) {
      const metadata: TableColumnMetadata =
        data.getTableColumnMetadata(columnName);
      if (metadata.unique && data.getColumnValue(columnName)) {
        // check for unique values.
        const count: PositiveNumber = await this.countBy({
          query: {
            [columnName]: data.getColumnValue(columnName),
          } as any,
          props: {
            isRoot: true,
          },
        });

        if (count.toNumber() > 0) {
          throw new BadDataException(
            `${metadata.title} ${data
              .getColumnValue(columnName)
              ?.toString()} already exists. Please choose a different ${
              metadata.title
            }`,
          );
        }
      }
    }

    return data;
  }

  protected checkRequiredFields(data: TBaseModel): TBaseModel {
    // Check required fields.

    const relationalColumns: Dictionary<string> = {};

    const tableColumns: Array<string> = data.getTableColumns().columns;

    for (const column of tableColumns) {
      const metadata: TableColumnMetadata = data.getTableColumnMetadata(column);
      if (metadata.manyToOneRelationColumn) {
        relationalColumns[metadata.manyToOneRelationColumn] = column;
      }
    }

    for (const requiredField of data.getRequiredColumns().columns) {
      if (typeof (data as any)[requiredField] === Typeof.Boolean) {
        if (
          !(data as any)[requiredField] &&
          (data as any)[requiredField] !== false &&
          !data.isDefaultValueColumn(requiredField)
        ) {
          throw new BadDataException(`${requiredField} is required`);
        }
      } else if (
        !(data as any)[requiredField] &&
        !data.isDefaultValueColumn(requiredField)
      ) {
        const metadata: TableColumnMetadata =
          data.getTableColumnMetadata(requiredField);

        if (
          metadata &&
          metadata.manyToOneRelationColumn &&
          metadata.type === TableColumnType.Entity &&
          data.getColumnValue(metadata.manyToOneRelationColumn)
        ) {
          continue;
        }

        if (
          relationalColumns[requiredField] &&
          data.getColumnValue(relationalColumns[requiredField] as string)
        ) {
          continue;
        }

        throw new BadDataException(`${requiredField} is required`);
      } else if (
        (data as any)[requiredField] === null &&
        data.isDefaultValueColumn(requiredField)
      ) {
        delete (data as any)[requiredField];
      }
    }

    return data;
  }

  /*
   * The refusals that do not depend on what a hook would do, made BEFORE the
   * hooks run instead of only after them.
   *
   * The login check: the hooks run first, and many of them key off
   * props.userId: a missing one reads as "userId is required" (400), "User
   * should be logged in" (422), or, for Project reads, an empty list with a
   * 200. For an anonymous caller that is almost always a dashboard tab whose
   * access-token cookie expired, and only a 401 makes the browser client
   * refresh the session and replay the request. Everything this admits, the
   * permission check would have admitted too (same condition, same exemptions
   * for API keys and public models), so it only changes which refusal an
   * anonymous caller gets, and it keeps hooks with side effects from running
   * for them at all.
   *
   * The read-only credential check, for the same reason: a create, update or
   * delete made with a credential that may only read is going to be refused
   * whatever the caller's permissions are (the permission entry points ask
   * the same question), so no hook - several of which write on the caller's
   * behalf - should have run for it first.
   *
   * And for a create, update or delete, whether the caller may write this
   * table at all in the project the request is made in: the first question
   * the full permission check asks after the hooks, asked here as well, so a
   * hook never acts - unsetting the project's default, making room in an
   * order, deleting child rows - for someone the write is refused to.
   *
   * For a create or an update, `writeData` is what the caller asked to
   * write: below a table's update plan the one update allowed is the one
   * that only switches records off (BillingPermission), and the data is
   * what says so; a create or update writing a column a plan sells needs
   * the project's plan.
   *
   * Returns the props the rest of the operation goes on with: the caller's
   * own, with their project's plan when they act in it without one and the
   * operation is one a plan decides (CallerPlan.withPlanFor). The plan is
   * read after the refusals that need no lookup, so a read-only credential
   * or an anonymous caller is refused without one.
   */
  private async checkCallerBeforeHooks(
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    writeData?: unknown,
  ): Promise<DatabaseCommonInteractionProps> {
    if (type !== DatabaseRequestType.Read) {
      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);
    }

    if (props.isRoot || props.isMasterAdmin) {
      return props;
    }

    PublicPermission.checkIfUserIsLoggedIn(this.modelType, props, type);

    const propsWithPlan: DatabaseCommonInteractionProps =
      await CallerPlan.withPlanFor({
        props: props,
        modelType: this.modelType,
        type: type,
        data: writeData,
      });

    if (
      type === DatabaseRequestType.Create ||
      type === DatabaseRequestType.Update ||
      type === DatabaseRequestType.Delete
    ) {
      ModelPermission.checkTableWritePermission(
        this.modelType,
        propsWithPlan,
        type,
        type === DatabaseRequestType.Update ? writeData : undefined,
      );
    }

    return propsWithPlan;
  }

  /*
   * Before the hooks of an update or delete: the rows of it this caller may
   * write. A service's onBeforeUpdate / onBeforeDelete reads the rows the
   * write names to act on them - it unsets the other defaults of their
   * project, closes the gap they leave in an order, deletes their child rows,
   * carries them forward to the success hook - and it is handed the query the
   * caller sent, before the permission check narrows it. So the query is
   * narrowed here first, the same way that check narrows it, and the rows
   * found are the only ones the hooks get to see:
   *
   *  - none: the write changes nothing, so it returns at once and no hook
   *    runs - neither the before nor the success hook (the same 0 it
   *    returned before, without anything done first);
   *  - some: the query handed on names only them (see pinQueryToRows), so a
   *    hook reading "the rows this write names" reads only those.
   *
   * The full check still runs after the hooks, on whatever they hand back.
   * Root and master admin callers write any row, so nothing changes for
   * them; nor with ignoreHooks, or for a service with no hook for this kind
   * of write, where nothing runs that could act on the rows. Returns whether
   * there is anything left to write.
   */
  private async keepRowsCallerMayWrite(
    write: {
      query: Query<TBaseModel>;
      skip: PositiveNumber | number;
      limit: PositiveNumber | number;
      props: DatabaseCommonInteractionProps;
      // What an update writes, for its plan check (BillingPermission).
      data?: unknown;
    },
    type: DatabaseRequestType.Update | DatabaseRequestType.Delete,
    options: { withDeleted?: boolean } = {},
  ): Promise<boolean> {
    if (
      write.props.isRoot ||
      write.props.isMasterAdmin ||
      write.props.ignoreHooks ||
      !this.hasHooksFor(type)
    ) {
      return true;
    }

    const query: Query<TBaseModel> = this.getRuleCriteriaEffectiveEnabledQuery(
      write.query,
    );

    const writableQuery: Query<TBaseModel> =
      type === DatabaseRequestType.Delete
        ? await ModelPermission.checkDeleteQueryPermission(
            this.modelType,
            query,
            write.props,
          )
        : await ModelPermission.getUpdatableQuery(
            this.modelType,
            query,
            write.props,
            write.data,
          );

    const rows: Array<TBaseModel> = await this._findBy(
      {
        query: writableQuery,
        select: { _id: true } as Select<TBaseModel>,
        skip: this.normalizePositiveNumber(write.skip) ?? 0,
        limit: this.normalizePositiveNumber(write.limit) ?? LIMIT_MAX,
        props: { isRoot: true, ignoreHooks: true },
      },
      options.withDeleted,
    );

    const rowIds: Array<string> = [];

    for (const row of rows) {
      if (row._id) {
        rowIds.push(row._id.toString());
      }
    }

    if (rowIds.length === 0) {
      return false;
    }

    const pinned: PinnedQuery<TBaseModel> | null = this.pinQueryToRows(
      write.query,
      rowIds,
      write.props,
    );

    if (pinned) {
      write.query = pinned.query;

      /*
       * A query that names the rows by _id needs no window but them. One that
       * is only scoped to the project keeps the window it was sent with, so
       * the write still covers the rows it covered.
       */
      if (pinned.namesTheRows) {
        write.skip = 0;
        write.limit = rowIds.length;
      }
    }

    return true;
  }

  /*
   * A record may point only at its own files: a project's record at files
   * uploaded in its project, a person at a picture they uploaded (see
   * FileOwnership). Asked of every create and update that points one of the
   * model's File columns at a file - root and hook-free writes too, since a
   * workflow or an API call can carry any id - once the caller is known to
   * be allowed the write, so a refusal tells nobody else anything. The
   * refusal is the same for a file of another owner, of none, or one that
   * does not exist.
   */
  private async assertFileReferencesOwnedOnCreate(
    data: TBaseModel,
  ): Promise<void> {
    const columns: Array<FileReferenceColumn> =
      FileOwnership.getFileReferenceColumns(this.model);

    if (columns.length === 0) {
      return;
    }

    const checks: Array<FileReferenceCheck> = [];
    let owner: FileReferenceOwner | null | undefined = undefined;

    for (const column of columns) {
      const fileIds: Array<ObjectID> | null = FileOwnership.readWrittenFileIds(
        data,
        column,
      );

      if (!fileIds || fileIds.length === 0) {
        continue;
      }

      if (owner === undefined) {
        // The record's project as it will be saved: the tenant is stamped.
        owner = FileOwnership.getOwner(this.model, data);
      }

      if (owner === null) {
        // A record outside any project (a global probe or AI agent).
        return;
      }

      checks.push({ owner, column, fileIds });
    }

    await FileOwnership.assertOwned(checks);
  }

  /*
   * A row just created, as stored: the columns asked for, read as root since
   * the row is the write's own - for a value the write left to its column
   * default. Null when the row has no id, or is gone already.
   */
  private async readStoredColumns(
    row: TBaseModel,
    columns: Array<string>,
  ): Promise<Record<string, unknown> | null> {
    const rowId: string = (row?._id || row?.id || "").toString();

    if (!rowId || columns.length === 0) {
      return null;
    }

    const select: Dictionary<boolean> = { _id: true };

    for (const column of columns) {
      select[column] = true;
    }

    const stored: Array<TBaseModel> = await this._findBy({
      query: { _id: rowId } as Query<TBaseModel>,
      select: select as Select<TBaseModel>,
      skip: 0,
      limit: 1,
      props: { isRoot: true, ignoreHooks: true },
    });

    return stored[0] ? (stored[0] as unknown as Record<string, unknown>) : null;
  }

  /*
   * The values an update writes the columns of getRowWriteSql with: each
   * its expression, as TypeORM takes raw SQL. The expressions are the
   * service's own, never a caller's.
   */
  private toRowWriteSqlValues(
    rowWriteSql: Dictionary<string>,
    columns: Array<string>,
  ): Dictionary<() => string> {
    const values: Dictionary<() => string> = {};

    for (const column of columns) {
      const expression: string | undefined = rowWriteSql[column];

      if (expression) {
        values[column] = (): string => {
          return expression;
        };
      }
    }

    return values;
  }

  /*
   * The row an update handed back (RETURNING), by column, as the database
   * stored it - read by the columns' names in the database. Undefined when
   * it handed back none.
   */
  private readRowReturnedByWrite(
    result: UpdateResult | undefined,
    columns: Array<string>,
  ): Record<string, unknown> | undefined {
    const rows: unknown = result?.raw;
    const row: unknown = Array.isArray(rows) ? rows[0] : undefined;

    if (!row || typeof row !== "object") {
      return undefined;
    }

    const metadata: EntityMetadata | undefined = (
      this.getRepository() as Repository<TBaseModel> | undefined
    )?.metadata;

    const stored: Record<string, unknown> = {};

    for (const column of columns) {
      const databaseName: string =
        metadata?.findColumnWithPropertyName?.(column)?.databaseName || column;

      if (Object.prototype.hasOwnProperty.call(row, databaseName)) {
        stored[column] = (row as Record<string, unknown>)[databaseName];
      }
    }

    return stored;
  }

  /*
   * The rows a delete removes, with what they show to everyone - their
   * project and the columns PublishedImages reads - read as root, the
   * deleted rows included, since a hard delete removes those too. The rows
   * as given for a table that shows nothing, or when the read fails.
   */
  private async readRowsShowingImages(
    items: Array<TBaseModel>,
  ): Promise<Array<TBaseModel>> {
    const columns: Array<string> = PublishedImages.getColumns(
      this.model.tableName,
    );

    if (columns.length === 0 || items.length === 0) {
      return items;
    }

    const select: Dictionary<boolean> = { _id: true };
    const tenantColumn: string | null = this.getModel().getTenantColumn();

    if (tenantColumn) {
      select[tenantColumn] = true;
    }

    for (const column of columns) {
      select[column] = true;
    }

    try {
      return await this._findBy(
        {
          query: {
            _id: QueryHelper.any(
              items.map((item: TBaseModel) => {
                return item.id!;
              }),
            ),
          } as Query<TBaseModel>,
          select: select as Select<TBaseModel>,
          skip: 0,
          limit: items.length,
          props: { isRoot: true, ignoreHooks: true },
        },
        true,
      );
    } catch (err) {
      logger.error(
        `Failed to read what deleted ${String(this.model.tableName)} rows showed: ${String(err)}`,
      );

      return items;
    }
  }

  /*
   * The rows showing images to everyone that the database deletes along
   * with these (the notes of an incident, the groups of a status page),
   * read while they are still there. See PublishedImages.
   */
  private async readRowsDeletedWith(
    items: Array<TBaseModel>,
  ): Promise<Array<CascadedRow>> {
    return await PublishedImages.readCascadedRows({
      tableName: this.model.tableName,
      ids: items.map((item: TBaseModel) => {
        return item.id!;
      }),
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        return await this.getRepository().manager.query(sql, parameters);
      },
    });
  }

  /*
   * The update's half of assertFileReferencesOwnedOnCreate, on the rows the
   * update reads before it writes them - each row's project (the tenant
   * column) and the files it points at now (the written columns, read as
   * they are) - so the rows checked are the rows written. Only the files a
   * row does not point at already are checked: nothing about a file can
   * change once it is uploaded, and a record saved before files had owners
   * keeps saving the file it has. Returns the checks; the caller runs them
   * before it writes anything.
   */
  private getFileReferenceChecksOnUpdate(data: {
    data: PartialEntity<TBaseModel>;
    rows: Array<TBaseModel>;
  }): Array<FileReferenceCheck> {
    const columns: Array<FileReferenceColumn> =
      FileOwnership.getFileReferenceColumns(this.model);

    if (columns.length === 0) {
      return [];
    }

    const written: Array<{
      column: FileReferenceColumn;
      fileIds: Array<ObjectID>;
    }> = [];

    for (const column of columns) {
      const fileIds: Array<ObjectID> | null = FileOwnership.readWrittenFileIds(
        data.data,
        column,
      );

      if (fileIds && fileIds.length > 0) {
        written.push({ column, fileIds });
      }
    }

    if (written.length === 0) {
      return [];
    }

    const rows: Array<TBaseModel> = data.rows;

    const checks: Array<FileReferenceCheck> = [];

    for (const row of rows) {
      const owner: FileReferenceOwner | null = FileOwnership.getOwner(
        this.model,
        row,
      );

      if (!owner) {
        continue;
      }

      for (const { column, fileIds } of written) {
        const held: Set<string> = FileOwnership.readStoredFileIds(row, column);

        const added: Array<ObjectID> = fileIds.filter(
          (fileId: ObjectID): boolean => {
            return !held.has(normalizeFileId(fileId));
          },
        );

        if (added.length > 0) {
          checks.push({ owner, column, fileIds: added });
        }
      }
    }

    return checks;
  }

  /*
   * Whether this service has a hook for an update or a delete - before it or
   * after it - that could act on the rows it names.
   */
  private hasHooksFor(
    type: DatabaseRequestType.Update | DatabaseRequestType.Delete,
  ): boolean {
    const hookNames: Array<string> =
      type === DatabaseRequestType.Update
        ? ["onBeforeUpdate", "onUpdateSuccess"]
        : ["onBeforeDelete", "onDeleteSuccess"];

    return hookNames.some((hookName: string): boolean => {
      return (
        (this as unknown as Record<string, unknown>)[hookName] !==
        (DatabaseService.prototype as unknown as Record<string, unknown>)[
          hookName
        ]
      );
    });
  }

  /*
   * The query a write's hooks are handed, so that it names only the rows the
   * caller may write - in a shape hooks already read:
   *
   *  - a query naming its one row by a plain _id (updateOneById and
   *    deleteOneById send that) is kept as it was sent;
   *  - one that names rows by _id some other way gets _id set to them: a
   *    plain id for one row, an "any of" for several;
   *  - one that does not name _id gets the one row's plain id, when it
   *    matched one row. When it matched several, _id is left out - hooks
   *    that refuse a write without one, or read it as an id, keep doing what
   *    they did - and it is scoped to the caller's project instead, in the
   *    window it was sent with.
   *
   * null when none of these applies, and the query is left as it is.
   */
  private pinQueryToRows(
    query: Query<TBaseModel>,
    rowIds: Array<string>,
    props: DatabaseCommonInteractionProps,
  ): PinnedQuery<TBaseModel> | null {
    const oneRowId: string | null = rowIds.length === 1 ? rowIds[0]! : null;

    if (Array.isArray(query)) {
      return {
        query: {
          _id: oneRowId || QueryHelper.any(rowIds),
        } as Query<TBaseModel>,
        namesTheRows: true,
      };
    }

    const sentId: unknown = (query as Record<string, unknown>)["_id"];

    if (sentId !== undefined && sentId !== null) {
      if (
        oneRowId &&
        (typeof sentId === "string" || sentId instanceof ObjectID) &&
        sentId.toString().toLowerCase() === oneRowId.toLowerCase()
      ) {
        return { query: query, namesTheRows: true };
      }

      return {
        query: {
          ...query,
          _id: oneRowId || QueryHelper.any(rowIds),
        } as Query<TBaseModel>,
        namesTheRows: true,
      };
    }

    if (oneRowId) {
      return {
        query: { ...query, _id: oneRowId } as Query<TBaseModel>,
        namesTheRows: true,
      };
    }

    const tenantColumn: string | null = this.getModel().getTenantColumn();

    if (tenantColumn && props.tenantId && !props.isMultiTenantRequest) {
      return {
        query: {
          ...query,
          [tenantColumn]: props.tenantId,
        } as Query<TBaseModel>,
        namesTheRows: false,
      };
    }

    return null;
  }

  protected async onBeforeCreate(
    createBy: CreateBy<TBaseModel>,
  ): Promise<OnCreate<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({
      createBy: createBy as CreateBy<TBaseModel>,
      carryForward: undefined,
    });
  }

  private async _onBeforeCreate(
    createBy: CreateBy<TBaseModel>,
  ): Promise<OnCreate<TBaseModel>> {
    // Private method that runs before create.
    this.stampTenantOnCreate(createBy.data, createBy.props);

    return await this.onBeforeCreate(createBy);
  }

  /*
   * BasicForm wraps every FormFieldSchemaType.Password value in a HashedString
   * before submit, so a model form can post one straight at a hashed column.
   * The same field also collects secrets that are stored rather than hashed —
   * a TAXII feed token, data source credentials, a webhook signing secret —
   * and those columns want the string the user typed. Left wrapped, encrypt()
   * walked the HashedString's own fields as if it were a JSON column, and the
   * Postgres driver serialized the object through toJSON(), so the column
   * held '{"_type":"HashedString","value":"<ciphertext>"}' instead of the
   * ciphertext. https://github.com/OneUptime/oneuptime/issues/3807
   *
   * Runs before the hooks, so they validate the same string that is saved.
   */
  private unwrapHashedStringsForUnhashedColumns(
    data: TBaseModel | PartialEntity<TBaseModel>,
  ): void {
    for (const columnName of Object.keys(data)) {
      const value: unknown = (data as Record<string, unknown>)[columnName];

      if (
        value instanceof HashedString &&
        this.model.isTableColumn(columnName) &&
        !this.model.isHashedStringColumn(columnName)
      ) {
        (data as Record<string, unknown>)[columnName] = value.toString();
      }
    }
  }

  /*
   * Query operators (StartsWith, NotNull, Search, GreaterThan, Includes...)
   * belong in the `query` of a read/update, never in the `data` of a write.
   * They can reach create/update data because JSONFunctions.deserialize - run
   * on every request body while building the model - turns
   * `{"_type":"StartsWith","value":"a"}` into a real operator instance, and
   * DatabaseBaseModel._fromJSON assigns it to an id/text column unchanged.
   *
   * An operator is never a valid stored value, and leaving one on a write
   * payload also feeds it to the lookups built from that data - the uniqueness
   * check here and the findBy/countBy calls in service hooks - where QueryUtil
   * turns the intended exact comparison into a pattern match, quietly matching
   * rows the caller never named. Refuse such a write up front instead. JSON
   * columns are exempt: they legitimately hold arbitrary objects, and their
   * values are not used to build a query.
   */
  private rejectQueryOperatorsInData(
    data: TBaseModel | PartialEntity<TBaseModel>,
  ): void {
    for (const columnName of Object.keys(data)) {
      const value: unknown = (data as Record<string, unknown>)[columnName];

      if (!(value instanceof QueryOperator)) {
        continue;
      }

      if (!this.model.isTableColumn(columnName)) {
        continue;
      }

      const metadata: TableColumnMetadata =
        this.model.getTableColumnMetadata(columnName);

      if (metadata && metadata.type === TableColumnType.JSON) {
        continue;
      }

      throw new BadDataException(
        `Invalid value for ${columnName}. A query operator cannot be used as a value when creating or updating ${this.model.singularName}.`,
      );
    }
  }

  /*
   * Rows written before the fix above hold their ciphertext inside that
   * HashedString envelope. Decrypting the envelope itself is not just wrong
   * but random — it carries no OpenSSL salt, so crypto-js derives the key
   * from a fresh random one on every call and returns "" or throws
   * "Malformed UTF-8 data". A ciphertext is base64 and never starts with
   * "{", so the envelope is unambiguous: unwrap it and those rows decrypt
   * without anyone re-entering the secret.
   */
  private static unwrapHashedStringEnvelope(storedValue: string): string {
    if (typeof storedValue !== "string" || !storedValue.startsWith("{")) {
      return storedValue;
    }

    try {
      const parsed: JSONValue = JSON.parse(storedValue);

      if (
        parsed &&
        typeof parsed === Typeof.Object &&
        (parsed as JSONObject)["_type"] === ObjectType.HashedString &&
        typeof (parsed as JSONObject)["value"] === Typeof.String
      ) {
        return (parsed as JSONObject)["value"] as string;
      }
    } catch {
      // Not JSON, so not the envelope.
    }

    return storedValue;
  }

  protected async encrypt(
    data: TBaseModel | PartialEntity<TBaseModel>,
  ): Promise<TBaseModel | PartialEntity<TBaseModel>> {
    for (const key of this.model.getEncryptedColumns().columns) {
      if (!(data as any)[key]) {
        continue;
      }

      // If data is an object.
      if (typeof (data as any)[key] === Typeof.Object) {
        const dataObj: JSONObject = (data as any)[key] as JSONObject;

        for (const key in dataObj) {
          dataObj[key] = await Encryption.encrypt(dataObj[key] as string);
        }

        (data as any)[key] = dataObj;
      } else {
        //If its string or other type.
        (data as any)[key] = await Encryption.encrypt(
          (data as any)[key] as string,
        );
      }
    }

    return data;
  }

  /*
   * Hash one HashedString column in place.
   *
   * Declaring `hashSaltColumn` on a column is what marks it a CREDENTIAL —
   * a low-entropy, human-chosen secret. Those go through scrypt (see
   * PasswordHash): deliberately slow and memory-hard, with a fresh per-record
   * salt minted into the sibling column named by the metadata.
   *
   * Columns without a salt column are high-entropy values the server itself
   * generated — session refresh tokens and the like. They keep the fast
   * SHA-256 hash, which is the right tool for them: there is nothing to guess,
   * and they have to stay searchable by hash because that is how they are
   * looked up. Every human-chosen credential, including dashboard and status
   * page master passwords, declares a salt column and takes the scrypt path.
   *
   * The salt is written onto the SAME payload as the hash, so the pair can
   * never be persisted out of step with each other.
   *
   * The salt column grants nobody create or update rights, so it has to get
   * past the column-permission check some other way on each path. On update
   * it does so by timing — sanitizeCreateOrUpdate runs after the check. On
   * create the check runs after `hash()`, so the salt column relies on being
   * declared `computed: true`, which checkDataColumnPermissions skips on
   * create. A salt column that forgets that flag breaks every non-root
   * create of a row carrying a password.
   */
  private async hashColumnValue(data: {
    payload: TBaseModel | PartialEntity<TBaseModel>;
    columnName: string;
    columnValue: HashedString;
  }): Promise<void> {
    const saltColumnName: string | undefined =
      this.model.getTableColumnMetadata(data.columnName)?.hashSaltColumn;

    if (!saltColumnName) {
      await data.columnValue.hashValue(EncryptionSecret);
      return;
    }

    const salt: string = PasswordHash.generateSalt();
    (data.payload as any)[saltColumnName] = salt;

    data.columnValue.setHashedValue(
      await PasswordHash.hash({
        plainValue: data.columnValue.toString(),
        salt: salt,
      }),
    );
  }

  protected async hash(data: TBaseModel): Promise<TBaseModel> {
    const columns: Columns = data.getHashedColumns();

    for (const key of columns.columns) {
      if (
        data.hasValue(key) &&
        !(data.getValue(key) as HashedString).isValueHashed()
      ) {
        await this.hashColumnValue({
          payload: data,
          columnName: key,
          columnValue: (data as any)[key] as HashedString,
        });
      }
    }

    return data;
  }

  /*
   * Check a plaintext secret (a password) against a hashed column on a row
   * that has already been read out of the database, and re-hash the stored
   * value in place when it was not written by today's scheme.
   *
   * The row must have been selected with BOTH the hashed column and its salt
   * column. Without the salt a scrypt hash cannot be checked at all, and an
   * older SHA-256 one would be checked against the wrong scheme — either way
   * a perfectly good password gets rejected. PasswordHash.verify throws
   * rather than silently returning false for the scrypt case, because a
   * missing SELECT is a bug and must not look like a bad password.
   *
   * Why the caller cannot just query by the hash any more: with a per-user
   * salt the hash is not computable until the row's own salt is known, so
   * `WHERE password = <hash>` has nothing to bind. Read the row by its
   * identity (email, id) and verify here.
   *
   * THE UPGRADE. Anything that is not exactly what PasswordHash writes today
   * is re-hashed once the password is known to be correct: the two SHA-256
   * schemes that preceded scrypt, and any scrypt hash whose cost parameters
   * have since been raised. That is what makes raising the cost a one-line
   * change — users migrate as they log in, with no reset and no migration.
   *
   * The write is deliberately hook-free and leaves updatedAt alone: the user
   * did not change their password, the server changed how it stores it.
   * Firing the password-change hooks would revoke every session and mail the
   * user about a change they did not make. A failed upgrade is logged and
   * swallowed — a correct password must not be rejected because a
   * bookkeeping write lost a race.
   */
  @CaptureSpan()
  public async verifyHashedColumnValue(data: {
    item: TBaseModel;
    columnName: string;
    plainValue: string;
  }): Promise<boolean> {
    const storedHash: string | undefined = (data.item as any)[
      data.columnName
    ]?.toString();

    if (!storedHash || !data.plainValue) {
      return false;
    }

    const saltColumnName: string | undefined =
      this.model.getTableColumnMetadata(data.columnName)?.hashSaltColumn;

    const salt: string | null = saltColumnName
      ? ((data.item as any)[saltColumnName] as string | undefined) || null
      : null;

    const isValid: boolean = await PasswordHash.verify({
      plainValue: data.plainValue,
      storedValue: storedHash,
      salt: salt,
    });

    if (!isValid) {
      return false;
    }

    if (
      saltColumnName &&
      data.item.id &&
      PasswordHash.needsUpgrade(storedHash)
    ) {
      try {
        const newSalt: string = PasswordHash.generateSalt();

        await this.updateColumnsByIdWithoutHooks({
          id: data.item.id,
          data: {
            [data.columnName]: await PasswordHash.hash({
              plainValue: data.plainValue,
              salt: newSalt,
            }),
            [saltColumnName]: newSalt,
          } as unknown as PartialEntity<TBaseModel>,
          expectedData: {
            [data.columnName]: storedHash,
            [saltColumnName]: salt,
          } as unknown as PartialEntity<TBaseModel>,
          skipUpdateDateColumn: true,
        });
      } catch (err) {
        /*
         * `data.item` is deliberately left holding the old hash and old salt,
         * so it stays an internally consistent pair whether or not the write
         * above landed.
         */
        logger.error(err);
      }
    }

    return true;
  }

  protected async decrypt(data: TBaseModel): Promise<TBaseModel> {
    for (const key of data.getEncryptedColumns().columns) {
      if (!data.hasValue(key)) {
        continue;
      }

      // If data is an object.
      if (typeof data.getValue(key) === Typeof.Object) {
        const dataObj: JSONObject = data.getValue(key) as JSONObject;

        for (const key in dataObj) {
          dataObj[key] = await Encryption.decrypt(dataObj[key] as string);
        }

        data.setValue(key, dataObj);
      } else {
        //If its string or other type.
        data.setValue(
          key,
          await Encryption.decrypt(
            DatabaseService.unwrapHashedStringEnvelope((data as any)[key]),
          ),
        );
      }
    }

    return data;
  }

  protected async onBeforeDelete(
    deleteBy: DeleteBy<TBaseModel>,
  ): Promise<OnDelete<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({ deleteBy, carryForward: null });
  }

  protected async onBeforeUpdate(
    updateBy: UpdateBy<TBaseModel>,
  ): Promise<OnUpdate<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({ updateBy, carryForward: null });
  }

  protected async onBeforeFind(
    findBy: FindBy<TBaseModel>,
  ): Promise<OnFind<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({ findBy, carryForward: null });
  }

  /*
   * Runs on a create once the caller has passed the permission checks, just
   * before the @UniqueColumnBy and @UniqueColumnsTogether checks, which
   * refuse a clash with an existing row as "<Model> with the same <column>
   * already exists.". Override it to refuse a clash in words of your own:
   * the caller may create the row, so a refusal may say what exists (see
   * DiscoveredResourceCreate.refuseClash). Skipped with ignoreHooks.
   */
  protected async onBeforeCreateUniqueCheck(
    _createBy: CreateBy<TBaseModel>,
  ): Promise<void> {
    // A place holder method used for overriding.
    return Promise.resolve();
  }

  /*
   * The same for an update: runs once the caller has passed the permission
   * checks, with the query already narrowed to the rows they may write and
   * before the data is serialized, so it may still adjust what is written.
   * Unlike onBeforeUpdate - which runs before any check - a refusal here
   * may say what exists (see DiscoveredResourceUpdate.checkMatchColumn).
   * Skipped with ignoreHooks.
   */
  protected async onBeforeUpdateUniqueCheck(
    _updateBy: UpdateBy<TBaseModel>,
  ): Promise<void> {
    // A place holder method used for overriding.
    return Promise.resolve();
  }

  /*
   * The last hook before an update is written: the caller has passed every
   * permission check, the query is narrowed to the rows they may write, and
   * the clash checks have run. A side effect the update must make before
   * it is written - and must never make for an update that is refused -
   * belongs here; one it may make afterwards belongs in onUpdateSuccess. A
   * throw here refuses the update. Skipped with ignoreHooks.
   */
  protected async onUpdatePermitted(
    _updateBy: UpdateBy<TBaseModel>,
  ): Promise<void> {
    // A place holder method used for overriding.
    return Promise.resolve();
  }

  /*
   * Columns each row of an update is written with as an SQL expression, in
   * place of the update's own value, for a rule between columns that a read
   * made before the write cannot keep: the database works each value out in
   * the row's own write, from the row as it holds it then - under the row's
   * lock - so no write landing in between, however close, is overtaken (a
   * record is shown on status pages only while it is not private:
   * StatusPageVisibility). Keyed by column; each an expression over the
   * row's own columns, written by the service, never by a caller.
   *
   * The write hands back what it stored of them (RETURNING), and that is
   * what the row's workflow trigger, realtime event and audit log entry are
   * told it was written with, and what PublishedImages decides the row's
   * images by. None by default. Skipped with ignoreHooks.
   */
  protected getRowWriteSql(
    _data: PartialEntity<TBaseModel>,
  ): Dictionary<string> {
    return {};
  }

  protected async onCreateSuccess(
    _onCreate: OnCreate<TBaseModel>,
    createdItem: TBaseModel,
  ): Promise<TBaseModel> {
    // A place holder method used for overriding.
    return Promise.resolve(createdItem);
  }

  protected async onCreateError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onUpdateSuccess(
    onUpdate: OnUpdate<TBaseModel>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve(onUpdate);
  }

  protected async onUpdateError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onDeleteSuccess(
    onDelete: OnDelete<TBaseModel>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve(onDelete);
  }

  protected async onDeleteError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onFindSuccess(
    onFind: OnFind<TBaseModel>,
    items: Array<TBaseModel>,
  ): Promise<OnFind<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({ ...onFind, carryForward: items });
  }

  protected async onFindError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onCountSuccess(
    count: PositiveNumber,
  ): Promise<PositiveNumber> {
    // A place holder method used for overriding.
    return Promise.resolve(count);
  }

  protected async onCountError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  /*
   * Rethrow hook for the catch blocks below. MUST stay synchronous and
   * `never`-returning: the call sites use `throw this.getException(error)`,
   * so if this were `async` it would return a Promise that `throw` then
   * throws verbatim (never awaited) — the real exception is lost, callers up
   * the stack catch a bare Promise (surfacing as "[object Promise]"), and the
   * un-awaited rejection becomes an unhandled rejection. Throwing directly
   * propagates the original exception on the synchronous throw path.
   */
  protected getException(error: Exception): never {
    throw PostgresErrorTranslator.translateException(error);
  }

  /*
   * Both halves of @SlugifyColumn are resolved BY NAME off the object rather
   * than through the schema, so a name matching no declared column misfires
   * silently: a missing source reads `undefined` and Slug.getSlug answers with
   * a random Faker name, and a missing destination is assigned to a property
   * TypeORM drops on insert. ModelRegistryInvariants sweeps every model for
   * both, so the pairing is guaranteed by a test rather than by this code.
   *
   * The ceiling comes from the DESTINATION column, not from Slug: getSlug
   * appends a dash and ten random digits, and checkMaxLengthOfFields -- which
   * runs later in the same create -- THROWS on overflow rather than
   * truncating. Sources are routinely wider than the slug they feed
   * (Incident.title is varchar(500) against a varchar(100) slug), so without
   * this a long title would be a failed insert rather than a long slug.
   */
  private generateSlug(createBy: CreateBy<TBaseModel>): CreateBy<TBaseModel> {
    const slugifyColumn: string | null = createBy.data.getSlugifyColumn();
    const saveSlugToColumn: string | null = createBy.data.getSaveSlugToColumn();

    if (!slugifyColumn || !saveSlugToColumn) {
      return createBy;
    }

    const source: JSONValue = (createBy.data as any)[slugifyColumn];

    (createBy.data as any)[saveSlugToColumn] = Slug.getSlug(
      source ? String(source) : null,
      this.getMaxLengthOfColumn(saveSlugToColumn),
    );

    return createBy;
  }

  /*
   * The declared width of a column, or undefined for a column that declares
   * none -- including a name that is not a column at all, which is what
   * getTableColumnMetadata answers for.
   */
  private getMaxLengthOfColumn(columnName: string): number | undefined {
    const columnType: TableColumnType | undefined =
      this.model.getTableColumnMetadata(columnName)?.type;

    return columnType ? getMaxLengthFromTableColumnType(columnType) : undefined;
  }

  private validateRuleCriteriaForModel(criteria: RuleCriteria): void {
    const allowedFields: ReadonlyArray<string> | undefined =
      getRuleCriteriaFieldsForModel(this.modelName);

    if (!allowedFields) {
      throw new BadDataException(
        `Rule criteria fields are not registered for ${this.modelName}.`,
      );
    }

    if (
      criteria.isEnabled !== undefined &&
      !(this.model instanceof RelationOnlyRuleBaseModel)
    ) {
      throw new BadDataException(
        `Rule criteria isEnabled is only supported for relation-only rules.`,
      );
    }

    for (const filter of criteria.filters) {
      if (!allowedFields.includes(filter.field)) {
        throw new BadDataException(
          `Rule criteria field "${filter.field}" is not supported for ${this.modelName}.`,
        );
      }

      const metadata: TableColumnMetadata | undefined =
        this.model.getTableColumnMetadata(filter.field);

      if (!metadata) {
        throw new BadDataException(
          `Rule criteria field "${filter.field}" is not a column on ${this.modelName}.`,
        );
      }

      if (metadata.type === TableColumnType.MonitorType) {
        const validationError: string | null =
          getMonitorTypeCriteriaValidationError(filter);

        if (validationError) {
          throw new BadDataException(validationError);
        }
      }

      const isRelationField: boolean =
        metadata.type === TableColumnType.EntityArray;
      const isRelationOperator: boolean = RULE_CRITERIA_RELATION_OPERATORS.has(
        filter.operator,
      );

      if (isRelationOperator && !isRelationField) {
        throw new BadDataException(
          `Rule criteria field "${filter.field}" does not support relation operators.`,
        );
      }

      if (!isRelationOperator && isRelationField) {
        throw new BadDataException(
          `Rule criteria field "${filter.field}" requires a relation operator.`,
        );
      }

      if (
        isRelationOperator &&
        (filter.value as Array<string>).some((value: string): boolean => {
          return !ObjectID.isValidUUID(value);
        })
      ) {
        throw new BadDataException(
          `Rule criteria field "${filter.field}" requires valid resource IDs.`,
        );
      }
    }
  }

  private getRuleCriteriaEffectiveEnabledQuery(
    query: Query<TBaseModel>,
  ): Query<TBaseModel> {
    if (!(this.model instanceof RelationOnlyRuleBaseModel)) {
      return query;
    }

    const requestedEnabledState: unknown = (query as Record<string, unknown>)[
      "isEnabled"
    ];

    if (typeof requestedEnabledState !== "boolean") {
      return query;
    }

    return {
      ...query,
      isEnabled: QueryHelper.booleanForCriteriaBackedRule(
        "criteria",
        requestedEnabledState,
      ),
    } as Query<TBaseModel>;
  }

  private addRuleCriteriaEffectiveEnabledToSelect(
    select: Select<TBaseModel> | null | undefined,
  ): boolean {
    if (
      !(this.model instanceof RelationOnlyRuleBaseModel) ||
      !select ||
      !(select as Record<string, unknown>)["isEnabled"]
    ) {
      return false;
    }

    const criteriaWasSelected: boolean = Boolean(
      (select as Record<string, unknown>)["criteria"],
    );
    (select as Record<string, unknown>)["criteria"] = true;

    return !criteriaWasSelected;
  }

  private applyRuleCriteriaEffectiveEnabledToItem(
    item: TBaseModel,
    mapEffectiveEnabled: boolean = true,
    removeInternallySelectedCriteria: boolean = false,
  ): void {
    if (!(this.model instanceof RelationOnlyRuleBaseModel)) {
      return;
    }

    const relationOnlyRule: RelationOnlyRuleBaseModel =
      item as unknown as RelationOnlyRuleBaseModel;

    if (
      mapEffectiveEnabled &&
      relationOnlyRule.criteria !== undefined &&
      relationOnlyRule.criteria !== null
    ) {
      (item as Record<string, unknown>)["isEnabled"] =
        (item as Record<string, unknown>)["isEnabled"] === null;
    }

    if (removeInternallySelectedCriteria) {
      delete (item as Record<string, unknown>)["criteria"];
    }
  }

  private applyRelationOnlyRuleRolloutState(
    data: TBaseModel | PartialEntity<TBaseModel>,
    options: {
      hasConfiguredCriteria: boolean;
      isUpdate: boolean;
    },
  ): void {
    if (!(this.model instanceof RelationOnlyRuleBaseModel)) {
      return;
    }

    if (!options.hasConfiguredCriteria) {
      return;
    }

    const record: Record<string, unknown> = data as Record<string, unknown>;
    const criteria: RuleCriteria = record["criteria"] as RuleCriteria;
    const requestedEnabledState: unknown =
      typeof criteria.isEnabled === "boolean"
        ? criteria.isEnabled
        : record["isEnabled"];

    if (options.isUpdate && typeof requestedEnabledState !== "boolean") {
      throw new BadDataException(
        "isEnabled must be supplied when updating criteria for this rule.",
      );
    }

    const logicalEnabledState: boolean =
      typeof requestedEnabledState === "boolean" ? requestedEnabledState : true;

    record["criteria"] = {
      ...criteria,
      isEnabled: logicalEnabledState,
    };
    record["isEnabled"] = logicalEnabledState ? null : false;
  }

  private applyLegacyRuleCriteriaSafetyShadow(
    data: TBaseModel | PartialEntity<TBaseModel>,
  ): void {
    const allowedFields: ReadonlyArray<string> | undefined =
      getRuleCriteriaFieldsForModel(this.modelName);

    if (!allowedFields) {
      return;
    }

    if (this.model instanceof RelationOnlyRuleBaseModel) {
      /*
       * Omit legacy many-to-many fields from the server-side write. An empty
       * array would clear existing junction rows and route updates through
       * repository.save(), whose upsert semantics can resurrect a deleted row.
       * The fail-closed isEnabled shadow keeps these rules hidden from older
       * workers without touching their legacy relations.
       */
      for (const field of allowedFields) {
        delete (data as Record<string, unknown>)[field];
      }

      return;
    }

    /*
     * Scalar rule families can expose a never-matching regular expression to
     * older workers. Relation-only criteria rules encode enabled as null and
     * disabled as false; older workers query true and therefore see neither.
     */
    const safetyPatternField: string | undefined = allowedFields.find(
      (field: string): boolean => {
        const metadata: TableColumnMetadata | undefined =
          this.model.getTableColumnMetadata(field);

        return (
          metadata?.type !== TableColumnType.EntityArray &&
          field.match(/(pattern|regex)/i) !== null
        );
      },
    );

    if (!safetyPatternField) {
      return;
    }

    for (const field of allowedFields) {
      const metadata: TableColumnMetadata | undefined =
        this.model.getTableColumnMetadata(field);

      if (!metadata) {
        continue;
      }

      if (metadata.type === TableColumnType.EntityArray) {
        // Preserve existing junction rows and keep this on repository.update().
        delete (data as Record<string, unknown>)[field];
      } else {
        (data as Record<string, unknown>)[field] = null;
      }
    }

    (data as Record<string, unknown>)[safetyPatternField] =
      RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN;
  }

  /*
   * Whether this model's tenant column is its own primary key - true of
   * Project alone (`@TenantColumn("_id")`). A project IS its tenant, so its
   * reads, updates and deletes are scoped to the request's project by `_id`.
   * A create is the exception: it mints a new tenant, and the request's
   * tenant is some other project that already exists.
   */
  private isTenantColumnPrimaryKey(): boolean {
    return this.model.getTenantColumn() === "_id";
  }

  /*
   * Writes the request's tenant onto a row being created, so a create made in
   * a project lands in that project whatever the payload said.
   *
   * Skipped for a model whose tenant column is its own primary key. There the
   * stamp hands the new row the id of the project the request was made in,
   * and save() takes an entity carrying an existing id as an UPDATE of that
   * row: POST /api/project with a tenantid header answered 500 only because
   * the stamped value was an ObjectID, which Postgres could not read as a
   * uuid, instead of overwriting the project the header named.
   *
   * The tenant is ignored for that create, not refused. It names the project
   * the caller is working in, which says nothing about a project that does
   * not exist yet, and some callers cannot leave it off: an API key's or an
   * MCP grant's tenant comes from the credential. Whether the caller may
   * create a project at all is for the permission checks and ProjectService's
   * hooks to answer. (The Dashboard sends no tenant for this create - see
   * isMultiTenantRequest in ProjectPicker.)
   */
  private stampTenantOnCreate(
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): void {
    const tenantColumn: string | null = this.model.getTenantColumn();

    if (!tenantColumn || !props.tenantId || this.isTenantColumnPrimaryKey()) {
      return;
    }

    data.setColumnValue(tenantColumn, props.tenantId);
  }

  /*
   * The last check a create makes before save(), on the entity save() is
   * actually handed. save() chooses between INSERT and UPDATE by that
   * entity's primary key: one carrying the id of an existing row is loaded
   * and UPDATEd in place, so a create that reaches it with an id rewrites a
   * record nobody asked to change.
   *
   * create() refuses a caller-supplied id up front, but the hooks, the tenant
   * stamp and the rest of the pipeline all write to the same entity after
   * that check - the tenant stamp is how a new Project came to carry the id
   * of the project the request was made in. So, once more, here:
   *
   *  - a non-root create may not carry an id, whatever put it there;
   *  - no create, root included, of a model whose tenant column is its own
   *    primary key may carry the request tenant's id. Root callers may
   *    assign ids, but this one can only come from a generic tenant stamp -
   *    workflow components create as root WITH a tenant, after
   *    applyTenantColumn has written the tenant column - and it would make
   *    the create an update of the caller's own project.
   *
   * The ids are compared as text, case-insensitively: the id may be an
   * ObjectID or a plain string, and Postgres reads a uuid in either case.
   */
  private assertCreateWillInsert(
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): void {
    const suppliedId: unknown = data._id;

    if (!suppliedId) {
      return;
    }

    if (!props.isRoot && !props.isMasterAdmin) {
      throw new BadDataException(
        `An id cannot be supplied when creating ${this.model.singularName}.`,
      );
    }

    if (
      this.isTenantColumnPrimaryKey() &&
      props.tenantId &&
      String(suppliedId).toLowerCase() ===
        props.tenantId.toString().toLowerCase()
    ) {
      throw new BadDataException(
        `A new ${this.model.singularName} cannot take the id of the ${this.model.singularName} this request is made in.`,
      );
    }
  }

  /*
   * A tenant model declares its tenant TWICE: a scalar column (e.g.
   * `projectId`) AND a ManyToOne relation (`project`) whose @JoinColumn names
   * that same scalar. Both are separately writable through the public API, and
   * both land on the entity that reaches getRepository().save()/update().
   * TypeORM (metadata/ColumnMetadata.js getEntityValue) resolves the relation
   * object to the join-column value with PRECEDENCE over the scalar, so a
   * request carrying `project: { _id: <another project> }` is persisted under
   * THAT project even though create() has just stamped the scalar to
   * props.tenantId. That is a cross-tenant write of the whole row (reproduced
   * end to end: the generated INSERT binds `projectId` to the relation's id,
   * not the stamped scalar).
   *
   * The stamped scalar is the authoritative tenant for every non-root write,
   * and no `project` relation in the schema legitimately points at a project
   * other than the tenant (every one joins on `projectId`; there is no second,
   * foreign-project reference to preserve). So neutralize the relation
   * spelling: reject a tenant relation that points anywhere other than the
   * request tenant, then delete it so the scalar is the single source of truth
   * and no TypeORM precedence rule between the two can move the row. This is
   * the framework-level generalisation of the per-service fixes already
   * shipped in ApiKeyPermissionService and UserTelegramService.
   *
   * Root / master-admin / internal callers are left untouched — they have no
   * request tenant (props.tenantId is unset) and legitimately set the tenant
   * relation for another project during seeding, migrations and
   * invitation-acceptance. This mirrors the create() scalar stamp, which is
   * likewise gated on props.tenantId.
   */
  private enforceTenantRelationMatchesScalar(
    data: TBaseModel | PartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    const tenantColumn: string | null = this.model.getTenantColumn();

    if (!tenantColumn || !props.tenantId) {
      return;
    }

    const tenantRelationProperty: string | null =
      this.getTenantRelationProperty(tenantColumn);

    if (!tenantRelationProperty) {
      /*
       * e.g. Project itself, whose tenant column is its own `_id`, has no such
       * relation; global (non-tenant) models return null from getTenantColumn.
       */
      return;
    }

    const suppliedRelation: unknown = (data as Record<string, unknown>)[
      tenantRelationProperty
    ];

    if (suppliedRelation === undefined) {
      return;
    }

    const relationTenantId: ObjectID | null = RelationIdUtil.read(
      data as Record<string, unknown>,
      [tenantRelationProperty],
    );

    if (
      relationTenantId &&
      relationTenantId.toString() !== props.tenantId.toString()
    ) {
      throw new BadDataException(
        `The ${tenantRelationProperty} relation does not belong to this project.`,
      );
    }

    delete (data as Record<string, unknown>)[tenantRelationProperty];
  }

  /*
   * A reference has two names a write can use: the relation (`monitor`,
   * which the dashboard's forms post) and its ID column (`monitorId`, which
   * the API reference, Terraform and server-side callers use). They are one
   * database column, and when a write carries both TypeORM stores the
   * relation's id, while a hook that checks or decides on the reference may
   * read the ID column. So a write made in a project - through the API, a
   * workflow or the admin dashboard - whose two names of one reference hold
   * different values (two records, or a record and a clear) is refused here,
   * before any hook reads it; a reference sent under one name, or the same
   * id under both, is written as it was. See RelationNames.
   *
   * OneUptime's own writes - root, with no project on the request - name
   * their references in code and are left alone; the services that check a
   * reference themselves read both names with RelationIdUtil.readConsistent,
   * which refuses the same for every write.
   */
  private assertRelationNamesAgree(
    data: TBaseModel | PartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (this.isWriteOneUptimeMakesItself(props)) {
      return;
    }

    RelationNames.assertNamesAgree(this.model, data);
  }

  /*
   * A create that names a record only by its relation - `statusPage: { _id }`,
   * which the dashboard's forms send - gets that id in the ID column
   * (`statusPageId`) as well, before the hooks. TypeORM stores the relation's
   * id without setting the ID column on the row it hands back, so a hook
   * reading the ID column, a success hook reading the saved row, and the
   * checks after the hooks would otherwise see a create that names nothing.
   * The relation stays, so the two names hold the same id, which is what
   * TypeORM stores. Each name is still checked against its own create list,
   * and a relation shares its ID column's (UpdatePermissionLists names the
   * few kept apart, whose relation nobody may send).
   *
   * An ID column the create sets already is left as it is: a request whose
   * two names disagree has been refused just before this, and a write
   * OneUptime makes itself is saved as it was named. The project (the tenant
   * relation) is not one of these: it is stamped from the request.
   */
  private fillIdColumnsFromRelations(
    data: TBaseModel | PartialEntity<TBaseModel>,
  ): void {
    const record: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    for (const reference of RelationNames.getSingleRelations(this.model)) {
      if (record[reference.idColumn] !== undefined) {
        continue;
      }

      const id: ObjectID | null = RelationIdUtil.read(record, [
        reference.relation,
      ]);

      if (id) {
        record[reference.idColumn] = id;
      }
    }
  }

  /*
   * A write OneUptime makes itself: root, with no project on the request - a
   * job, an engine, a service acting for someone it names in code. A
   * workflow writes as root too, but in its project: that is a write made in
   * a project, like a request through the API or the admin dashboard.
   */
  private isWriteOneUptimeMakesItself(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return Boolean(props.isRoot) && !props.tenantId;
  }

  // This model's columns that say who did something to a record. See UserAttribution.
  private getUserAttributionColumns(): Array<string> {
    if (!this.userAttributionColumns) {
      this.userAttributionColumns = UserAttribution.getColumns(this.model);
    }

    return this.userAttributionColumns;
  }

  /*
   * Who did something to a record - created it, archived it, acknowledged
   * it, triggered it - and when a switch was turned (UserAttribution) is not
   * a write's to say. So a write made in a project - a person's request, an
   * API key's, Terraform's, a workflow's, the admin dashboard's - has every
   * such column cleared, under both of its names, before the ID columns are
   * filled from the relations (fillIdColumnsFromRelations) and before any
   * hook reads it. Cleared rather than deleted: `data` is the caller's model
   * instance (see BaseAPI.createItem).
   *
   * The record is then created by the person making the write, stamped after
   * the permission check (sanitizeCreateOrUpdate), and by nobody when there
   * is no person: a record an API key or a workflow creates names no creator.
   * The services stamp the person into the columns that are about the
   * request itself - who triggered a policy, who added an incident to an
   * episode - in their hooks, which run after this. A value a request sends
   * is dropped, not refused, so a client that still sends one keeps working.
   *
   * OneUptime's own writes name the person they act for - a Slack action
   * posts a note as the person who clicked, an invitation records who
   * invited - and keep it. With a person on such a write, that person is
   * still its creator, so a relation over `createdByUserId` beside the stamp
   * goes: TypeORM stores a relation in place of its ID column.
   */
  private decideUserAttributionOnCreate(
    data: TBaseModel | PartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    const record: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    const isOwnWrite: boolean = this.isWriteOneUptimeMakesItself(props);

    for (const column of this.getUserAttributionColumns()) {
      if (record[column] === undefined) {
        continue;
      }

      if (
        !isOwnWrite ||
        (props.userId &&
          this.model.getTableColumnMetadata(column)?.manyToOneRelationColumn ===
            CREATED_BY_USER_ID_COLUMN)
      ) {
        record[column] = undefined;
      }
    }
  }

  /*
   * An update made in a project changes none of them either: they are taken
   * out of the write (a plain object by now - see sanitizeUpdateData), under
   * both names, before anything reads it, and the columns taken out are
   * returned. Turning a switch stamps who turned it, and when
   * (stampSwitchAttribution). OneUptime's own writes keep what they name.
   */
  private decideUserAttributionOnUpdate(
    data: TBaseModel | PartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Array<string> {
    if (this.isWriteOneUptimeMakesItself(props)) {
      return [];
    }

    const record: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    const takenOut: Array<string> = [];

    for (const column of this.getUserAttributionColumns()) {
      if (record[column] !== undefined) {
        takenOut.push(column);
      }

      delete record[column];
    }

    return takenOut;
  }

  /*
   * An update that asked for nothing but columns OneUptime decides changes
   * nothing. Answering that with "no rows to update" would read as a
   * missing record or a refused permission, so it says which fields are
   * OneUptime's instead.
   */
  private assertUpdateChangesSomething(
    takenOut: Array<string>,
    data: TBaseModel | PartialEntity<TBaseModel>,
  ): void {
    if (takenOut.length === 0 || Object.keys(data).length > 0) {
      return;
    }

    throw new BadDataException(
      `${takenOut.join(", ")} ${
        takenOut.length === 1 ? "is" : "are"
      } recorded by OneUptime and cannot be changed.`,
    );
  }

  /*
   * Who turned a switch, and when, from the update that turns it
   * (ATTRIBUTED_SWITCHES). Runs after the permission check, like the
   * creator's stamp, so the person is never asked for access to a column
   * they did not send. A write OneUptime makes itself keeps a value it
   * names. Returns what it stamped, so a row whose switch already stands
   * where the update puts it keeps the who and when it has
   * (keepSwitchAttributionOfUnturnedRow).
   */
  private stampSwitchAttribution(
    data: TBaseModel | PartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Array<SwitchStamp> {
    const record: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    const stamps: Array<SwitchStamp> = [];

    for (const entry of ATTRIBUTED_SWITCHES) {
      if (record[entry.switchColumn] === undefined) {
        continue;
      }

      const isOn: boolean = Boolean(record[entry.switchColumn]);

      const stampedColumns: Array<string> = [
        this.stampSwitchColumn(
          record,
          entry.atColumn,
          isOn ? OneUptimeDate.getCurrentDate() : null,
          props,
        ),
        this.stampSwitchColumn(
          record,
          entry.byUserColumn,
          isOn && props.userId ? props.userId : null,
          props,
        ),
      ].filter((column: string | null): column is string => {
        return column !== null;
      });

      if (stampedColumns.length > 0) {
        stamps.push({
          switchColumn: entry.switchColumn,
          isOn: isOn,
          stampedColumns: stampedColumns,
        });
      }
    }

    return stamps;
  }

  // Stamps one column of a switch, and says which, or null when it did not.
  private stampSwitchColumn(
    record: Record<string, unknown>,
    column: string,
    value: unknown,
    props: DatabaseCommonInteractionProps,
  ): string | null {
    if (!this.model.hasColumn(column)) {
      return null;
    }

    if (
      this.isWriteOneUptimeMakesItself(props) &&
      record[column] !== undefined
    ) {
      return null;
    }

    record[column] = value;

    return column;
  }

  /*
   * Re-sending a switch as it stands - Terraform sends a resource's whole
   * state on every apply, an edit form re-sends what it shows - turns
   * nothing, so the row keeps who turned it, and when. Only a row whose
   * switch really turns takes the stamps.
   */
  private keepSwitchAttributionOfUnturnedRow(
    dataForItem: PartialEntity<TBaseModel>,
    item: TBaseModel,
    stamps: Array<SwitchStamp>,
  ): Array<string> {
    const kept: Array<string> = [];

    for (const stamp of stamps) {
      const wasOn: boolean = Boolean(
        (item as unknown as Record<string, unknown>)[stamp.switchColumn],
      );

      if (wasOn !== stamp.isOn) {
        continue;
      }

      for (const column of stamp.stampedColumns) {
        delete (dataForItem as Record<string, unknown>)[column];
        kept.push(column);
      }
    }

    return kept;
  }

  /*
   * Property name of the ManyToOne relation that shares the tenant scalar
   * column as its join column (`project` for the `projectId` tenant column),
   * or null when the model has no such relation.
   */
  private getTenantRelationProperty(tenantColumn: string): string | null {
    for (const columnName of this.model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        this.model.getTableColumnMetadata(columnName);

      if (
        metadata &&
        metadata.type === TableColumnType.Entity &&
        metadata.manyToOneRelationColumn === tenantColumn
      ) {
        return columnName;
      }
    }

    return null;
  }

  private async sanitizeCreateOrUpdate(
    data: TBaseModel | PartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    isUpdate: boolean = false,
  ): Promise<TBaseModel | PartialEntity<TBaseModel>> {
    const criteriaValue: unknown = (data as Record<string, unknown>)[
      "criteria"
    ];
    const hasConfiguredCriteria: boolean =
      criteriaValue !== undefined && criteriaValue !== null;

    if (
      this.model instanceof RelationOnlyRuleBaseModel &&
      isUpdate &&
      criteriaValue === null
    ) {
      throw new BadDataException(
        "Configured criteria cannot be cleared from this rule. Save an empty criteria set to match every resource.",
      );
    }

    if (this.model instanceof RuleBaseModel && hasConfiguredCriteria) {
      const validationError: string | null =
        getRuleCriteriaValidationError(criteriaValue);

      if (validationError) {
        throw new BadDataException(validationError);
      }

      this.validateRuleCriteriaForModel(criteriaValue as RuleCriteria);
    }

    this.applyRelationOnlyRuleRolloutState(data, {
      hasConfiguredCriteria: hasConfiguredCriteria,
      isUpdate: isUpdate,
    });

    if (this.model instanceof RuleBaseModel && hasConfiguredCriteria) {
      this.applyLegacyRuleCriteriaSafetyShadow(data);
    }

    data = this.checkMaxLengthOfFields(data as TBaseModel);

    const columns: Columns = this.model.getTableColumns();

    for (const columnName of columns.columns) {
      const tableColumnMetadata: TableColumnMetadata =
        this.model.getTableColumnMetadata(columnName);

      if (this.model.isEntityColumn(columnName)) {
        const columnValue: JSONValue = (data as any)[columnName];

        if (
          data &&
          columnName &&
          tableColumnMetadata.modelType &&
          columnValue &&
          tableColumnMetadata.type === TableColumnType.Entity &&
          (typeof columnValue === "string" || columnValue instanceof ObjectID)
        ) {
          const relatedType: BaseModel = new tableColumnMetadata.modelType();
          relatedType._id = columnValue.toString();
          (data as any)[columnName] = relatedType;
        }

        if (
          data &&
          Array.isArray(columnValue) &&
          columnValue.length > 0 &&
          tableColumnMetadata.modelType &&
          columnValue &&
          tableColumnMetadata.type === TableColumnType.EntityArray
        ) {
          const itemsArray: Array<BaseModel> = [];
          for (const item of columnValue) {
            if (typeof item === "string" || item instanceof ObjectID) {
              const basemodelItem: BaseModel =
                new tableColumnMetadata.modelType();
              basemodelItem._id = item.toString();
              itemsArray.push(basemodelItem);
            } else if (
              item &&
              typeof item === Typeof.Object &&
              (item as JSONObject)["_id"] &&
              typeof (item as JSONObject)["_id"] === Typeof.String
            ) {
              const basemodelItem: BaseModel =
                new tableColumnMetadata.modelType();
              basemodelItem._id = (
                (item as JSONObject)["_id"] as string
              ).toString();
              itemsArray.push(basemodelItem);
            } else if (
              item &&
              typeof item === Typeof.Object &&
              (item as JSONObject)["id"] &&
              typeof (item as JSONObject)["id"] === Typeof.String
            ) {
              const basemodelItem: BaseModel =
                new tableColumnMetadata.modelType();
              basemodelItem._id = (
                (item as JSONObject)["id"] as string
              ).toString();
              itemsArray.push(basemodelItem);
            } else if (item instanceof BaseModel) {
              itemsArray.push(item);
            }
          }
          (data as any)[columnName] = itemsArray;
        }
      }

      if (this.model.isHashedStringColumn(columnName)) {
        const columnValue: JSONValue = (data as any)[columnName];

        /*
         * A salted column's hash and its salt are only ever correct as a
         * pair. A write that supplies the column as a bare string skips the
         * hashing branch below, leaving the row's existing salt attached to
         * a value it was not computed from — which locks the account out
         * silently, at the next login, far from whatever wrote it. Refuse
         * instead. Callers pass a HashedString; the write path hashes it.
         */
        if (
          data &&
          columnName &&
          columnValue &&
          !(columnValue instanceof HashedString) &&
          this.model.getTableColumnMetadata(columnName)?.hashSaltColumn
        ) {
          throw new BadDataException(
            `${columnName} is a salted column and must be supplied as a HashedString, not a pre-hashed value.`,
          );
        }

        if (
          data &&
          columnName &&
          columnValue &&
          columnValue instanceof HashedString
        ) {
          if (!columnValue.isValueHashed()) {
            /*
             * The update path never runs `hash()`, so this is where an
             * updated password gets both hashed and salted. The salt lands
             * on `data`, which the caller turns into the SET list, so the
             * new hash and the salt it was computed with are written by the
             * same statement.
             *
             * An update matching several rows writes the same salt to all of
             * them, which is correct: they are all being set to the same
             * value by one statement. Per-row salts come from per-row
             * writes.
             */
            await this.hashColumnValue({
              payload: data,
              columnName: columnName,
              columnValue: columnValue,
            });
          }

          (data as any)[columnName] = columnValue.toString();
        }
      }

      // if its a Date column and if date is null then set it to null.
      if (
        (data as any)[columnName] === "" &&
        tableColumnMetadata.type === TableColumnType.Date
      ) {
        (data as any)[columnName] = null;
      }

      // if table columntype is file and file is base64 stirng then convert to buffer to save.
      if (
        tableColumnMetadata.type === TableColumnType.File &&
        (data as any)[columnName] &&
        typeof (data as any)[columnName] === Typeof.String
      ) {
        const fileBuffer: Buffer = Buffer.from(
          (data as any)[columnName] as string,
          "base64",
        );
        (data as any)[columnName] = fileBuffer;
      }
    }

    /*
     * The record's creator: the person making the write, stamped here,
     * after the permission check, so a person is never asked for create
     * access to a column they did not send. A write with no person on it
     * names nobody - decideUserAttributionOnCreate took out whatever a
     * request named - unless OneUptime makes it itself and names the person
     * it acts for.
     */
    if (!isUpdate && props.userId) {
      (data as any)[CREATED_BY_USER_ID_COLUMN] = props.userId;
    }

    return data;
  }

  @CaptureSpan()
  public async onTriggerRealtime(
    modelId: ObjectID,
    projectId: ObjectID,
    modelEventType: ModelEventType,
  ): Promise<void> {
    logger.debug("Realtime Events Enabled", {
      projectId: projectId?.toString(),
    } as LogAttributes);
    logger.debug(this.model.enableRealtimeEventsOn, {
      projectId: projectId?.toString(),
    } as LogAttributes);

    if (Realtime.isInitialized() && this.model.enableRealtimeEventsOn) {
      logger.debug("Emitting realtime event", {
        projectId: projectId?.toString(),
      } as LogAttributes);
      let shouldEmitEvent: boolean = false;

      if (
        this.model.enableRealtimeEventsOn.create &&
        modelEventType === ModelEventType.Create
      ) {
        shouldEmitEvent = true;
      }

      if (
        this.model.enableRealtimeEventsOn.update &&
        modelEventType === ModelEventType.Update
      ) {
        shouldEmitEvent = true;
      }

      if (
        this.model.enableRealtimeEventsOn.delete &&
        modelEventType === ModelEventType.Delete
      ) {
        shouldEmitEvent = true;
      }

      if (!shouldEmitEvent) {
        logger.debug("Realtime event not enabled for this event type", {
          projectId: projectId?.toString(),
        } as LogAttributes);
        return;
      }

      logger.debug("Emitting realtime event", {
        projectId: projectId?.toString(),
      } as LogAttributes);
      Realtime.emitModelEvent({
        tenantId: projectId,
        eventType: modelEventType,
        modelId: modelId,
        modelType: this.modelType,
      }).catch((err: Error) => {
        logger.error("Cannot emit realtime event", {
          projectId: projectId?.toString(),
        } as LogAttributes);
        logger.error(err, {
          projectId: projectId?.toString(),
        } as LogAttributes);
      });
    }
  }

  @CaptureSpan()
  public async onTriggerWorkflow(
    id: ObjectID,
    projectId: ObjectID,
    triggerType: DatabaseTriggerType,
    miscData?: JSONObject | undefined, // miscData is used for passing data to workflow.
  ): Promise<void> {
    if (this.getModel().enableWorkflowOn) {
      API.post({
        url: new URL(
          Protocol.HTTP,
          WorkflowHostname,
          new Route(
            `/${WorkflowRoute.toString()}/model/${projectId.toString()}/${Text.pascalCaseToDashes(
              this.getModel().tableName!,
            )}/${triggerType}`,
          ),
        ),
        data: {
          data: {
            _id: id.toString(),
            miscData: miscData,
          },
        },
        headers: {
          ...ClusterKeyAuthorization.getClusterKeyHeaders(),
        },
      }).catch((error: Error) => {
        logger.error(error, {
          projectId: projectId?.toString(),
        } as LogAttributes);
      });
    }
  }

  /**
   * Derive the telemetry attribute key for this model's primary id, e.g.
   * `Incident` -> `incidentId`, `Monitor` -> `monitorId`. Matches the keys in
   * TelemetryContextAttributes so dashboards/queries stay consistent.
   */
  private getInventoryItemIdKey(): string {
    const name: string = this.modelName || "entity";
    return name.charAt(0).toLowerCase() + name.slice(1) + "Id";
  }

  /**
   * Seed the ambient telemetry context with the project (tenant) of an
   * operation so worker/cron/service spans and logs — which run outside the
   * HTTP request scope — still carry projectId. Best-effort and safe to call
   * anywhere.
   */
  protected setTelemetryContextFromProps(
    props: DatabaseCommonInteractionProps | undefined,
  ): void {
    try {
      if (props?.tenantId) {
        TelemetryContext.setAttributes({
          projectId: props.tenantId.toString(),
        });
      }
    } catch {
      // Telemetry must never break a database operation.
    }
  }

  /**
   * Seed the ambient telemetry context from a concrete model instance: the
   * project (tenant) and the entity's own id (e.g. incidentId, monitorId).
   * Used on create, where a new entity id is minted. Best-effort and safe.
   */
  protected setTelemetryContextFromItem(item: TBaseModel | undefined): void {
    try {
      if (!item) {
        return;
      }

      const attributes: { [key: string]: string } = {};

      const tenantColumn: string | null = this.model.getTenantColumn();
      if (tenantColumn) {
        const tenantValue: unknown = item.getColumnValue(tenantColumn);
        if (tenantValue) {
          attributes["projectId"] = String(tenantValue);
        }
      }

      if (item.id) {
        attributes[this.getInventoryItemIdKey()] = item.id.toString();
      }

      if (Object.keys(attributes).length > 0) {
        TelemetryContext.setAttributes(attributes);
      }
    } catch {
      // Telemetry must never break a database operation.
    }
  }

  @CaptureSpan()
  public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {
    // With the project's plan where the create needs it. See the helper.
    createBy.props = await this.checkCallerBeforeHooks(
      createBy.props,
      DatabaseRequestType.Create,
      createBy.data,
    );

    /*
     * A non-root create must not pin the row's own primary key. save() treats
     * an entity carrying an existing id as an update of that row rather than an
     * insert, so a supplied `_id` turns a create into an in-place modification
     * of a record the caller never named. BaseAPI.createItem already strips it;
     * this guards every other non-root caller (custom routes, workflow
     * components) too. Root/internal seeding legitimately assigns ids and is
     * exempt. Only the top-level primary key is checked - nested relation
     * `_id`s reference existing related rows and are fine. Asked again just
     * before save(), once the hooks and the tenant stamp have had their turn
     * (assertCreateWillInsert).
     */
    if (
      !createBy.props.isRoot &&
      !createBy.props.isMasterAdmin &&
      (createBy.data as TBaseModel)._id
    ) {
      throw new BadDataException(
        `An id cannot be supplied when creating ${this.model.singularName}.`,
      );
    }

    // Query operators are for queries, not for write payloads. See the helper.
    this.rejectQueryOperatorsInData(createBy.data);

    this.unwrapHashedStringsForUnhashedColumns(createBy.data);

    // Who did something to the record is OneUptime's to say. See the helper.
    this.decideUserAttributionOnCreate(createBy.data, createBy.props);

    // One reference, one value, whichever name it is sent under. See the helper.
    this.assertRelationNamesAgree(createBy.data, createBy.props);

    // A record named only by its relation, in its ID column too. See the helper.
    this.fillIdColumnsFromRelations(createBy.data);

    const onCreate: OnCreate<TBaseModel> = createBy.props.ignoreHooks
      ? { createBy, carryForward: [] }
      : await this._onBeforeCreate(createBy);

    let _createdBy: CreateBy<TBaseModel> = onCreate.createBy;

    const carryForward: any = onCreate.carryForward;

    _createdBy = this.generateSlug(_createdBy);

    let data: TBaseModel = _createdBy.data;

    // add tenantId if present, unless it is the row's own id. See the helper.
    this.stampTenantOnCreate(data, _createdBy.props);

    /*
     * The tenant scalar has just been stamped to the request tenant, but the
     * matching tenant RELATION object (e.g. `project`) is still whatever the
     * caller sent, and TypeORM lets that relation override the scalar on the
     * INSERT. Force the relation to agree with — or be dropped in favour of —
     * the stamped scalar so a caller cannot write the row into another tenant.
     */
    this.enforceTenantRelationMatchesScalar(data, _createdBy.props);

    data = this.generateDefaultValues(data);

    data = this.checkRequiredFields(data);

    await this.checkForUniqueValues(data);

    if (!this.isValid(data)) {
      throw new BadDataException("Data is not valid");
    }

    // check total items by.

    await this.checkTotalItemsBy(_createdBy);

    // Encrypt data
    data = (await this.encrypt(data)) as TBaseModel;

    // hash data
    data = await this.hash(data);

    ModelPermission.checkCreatePermissions(
      this.modelType,
      data,
      _createdBy.props,
    );

    // Only the record's own files. See the helper.
    await this.assertFileReferencesOwnedOnCreate(data);

    /*
     * A drag-ordered list (@ListOrderColumn): the new row goes to the end of
     * its list, or to the place the caller asked for. Planned after the
     * permission check, so a number the server picks is not held against the
     * caller's column permissions - a number the caller sent was checked as
     * sent - and before the save, so the row is written with its number.
     */
    const listOrderPlan: ListOrderCreatePlan | null =
      await this.planListOrderForCreate(data);

    createBy.data = data;

    // A service's own words for a clash, before the generic checks below.
    if (!createBy.props.ignoreHooks) {
      await this.onBeforeCreateUniqueCheck(createBy);
    }

    // check uniqueColumns by:
    createBy = await this.checkUniqueColumnBy(createBy);

    await this.checkUniqueColumnsTogether(createBy.data);

    // serialize.
    createBy.data = (await this.sanitizeCreateOrUpdate(
      createBy.data,
      createBy.props,
    )) as TBaseModel;

    // Whatever has written to it since the top of create(), this must INSERT.
    this.assertCreateWillInsert(createBy.data, createBy.props);

    try {
      createBy.data = await this.getRepository().save(createBy.data);
      this.applyRuleCriteriaEffectiveEnabledToItem(createBy.data);

      // Seed telemetry context with projectId + <model>Id for this create.
      this.setTelemetryContextFromItem(createBy.data);

      // The rows that make room for it, now that it exists.
      await this.applyListOrderCreatePlan(listOrderPlan);

      /*
       * The images a record shows to everyone are public from now on,
       * before anything announces it. See PublishedImages.
       */
      await PublishedImages.afterCreate({
        tableName: this.model.tableName,
        row: createBy.data,
        readStored: async (
          columns: Array<string>,
        ): Promise<Record<string, unknown> | null> => {
          return await this.readStoredColumns(createBy.data, columns);
        },
      });

      if (!createBy.props.ignoreHooks) {
        createBy.data = await this.onCreateSuccess(
          {
            createBy,
            carryForward,
          },
          createBy.data,
        );
      }

      /*
       * Auto-owner-on-create for @OperationalResource models. Inserts the
       * creating user into <Model>OwnerUser so the Owned permission scope
       * covers the newly-created resource on the next request. See
       * Internal/Docs/PermissionsSimplification.md. Best-effort: failures
       * are logged but do not roll back the create.
       */
      if (!createBy.props.ignoreHooks) {
        await this.autoOwnerOnCreate(createBy.data, createBy.props);
      }

      let tenantId: ObjectID | undefined = createBy.props.tenantId;

      if (!tenantId && this.getModel().getTenantColumn()) {
        tenantId = createBy.data.getValue<ObjectID>(
          this.getModel().getTenantColumn()!,
        );
      }

      // hit workflow.;
      if (this.getModel().enableWorkflowOn?.create && tenantId) {
        await this.onTriggerWorkflow(createBy.data.id!, tenantId, "on-create");
      }

      if (tenantId) {
        await this.onTriggerRealtime(
          createBy.data.id!,
          tenantId,
          ModelEventType.Create,
        );
      }

      if (
        !createBy.props.ignoreHooks &&
        this.getModel().enableAuditLogOn?.create
      ) {
        /*
         * Lazy require to avoid circular dependency between DatabaseService and
         * AuditLogService (which depends on ProjectService/UserService, both of
         * which extend DatabaseService). A top-level import leaves
         * DatabaseService undefined at class-extension time for subclasses.
         */
        const auditLogService: typeof AuditLogServiceType =
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("./AuditLogService").default;
        await auditLogService.recordCreate({
          model: this.getModel(),
          createdItem: createBy.data,
          props: createBy.props,
        });
      }

      return createBy.data;
    } catch (error) {
      await this.onCreateError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  /*
   * Inserts the creating user into the resource's *OwnerUser table for
   * operational resources. Mirrors the existing OwnerRule behavior for user
   * assignment and gives the creator immediate access under the `Owned`
   * permission scope.
   */
  private async autoOwnerOnCreate(
    createdItem: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    /*
     * System/root creates don't get an owner; non-user callers (API keys,
     * Probes) have no userId either. Both evaluate Owned as All elsewhere.
     */
    if (props.isRoot || props.isMasterAdmin || !props.userId) {
      return;
    }

    // The @OperationalResource() decorator sets this on the model prototype.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(createdItem as any).isOperationalResource) {
      return;
    }

    const modelName: string = this.modelType.name;

    /*
     * Lazy require to avoid circular dependency: owner services extend
     * DatabaseService, so importing them at top-level leaves DatabaseService
     * undefined at class-extension time.
     */
    const ownerTableRegistry: Map<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ownerUserService: any; ownerTeamService: any; fkColumn: string }
    > =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../Types/Database/Permissions/OwnerTableRegistry").default;

    const entry:
      | {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ownerUserService: any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ownerTeamService: any;
          fkColumn: string;
        }
      | undefined = ownerTableRegistry.get(modelName);
    if (!entry) {
      /*
       * Operational but no registered owner tables — not a configuration we
       * know how to auto-own. Skip silently.
       */
      return;
    }

    const resourceId: ObjectID | undefined = createdItem.id || undefined;
    if (!resourceId) {
      logger.error(
        `auto-owner-on-create: created ${modelName} has no id; skipping`,
      );
      return;
    }

    const tenantColumnName: string | null = createdItem.getTenantColumn();
    let projectId: ObjectID | undefined = undefined;
    if (tenantColumnName) {
      projectId =
        createdItem.getValue<ObjectID>(tenantColumnName) || props.tenantId;
    } else {
      projectId = props.tenantId;
    }

    if (!projectId) {
      logger.error(
        `auto-owner-on-create: no projectId for ${modelName} ${resourceId.toString()}; skipping`,
      );
      return;
    }

    try {
      /*
       * A new row every time. getModel() is the owner service's own shared
       * instance, and a save writes the generated _id back onto whatever it
       * was handed - so reusing it would turn the next auto-owner insert into
       * an update of this row.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ownerModel: any = new entry.ownerUserService.modelType();
      ownerModel[entry.fkColumn] = resourceId;
      ownerModel.userId = props.userId;
      ownerModel.projectId = projectId;

      await entry.ownerUserService.create({
        data: ownerModel,
        props: { isRoot: true },
      });
    } catch (err) {
      /*
       * The create form can name the creator as an owner too, and that path
       * may have added them first. They are an owner either way.
       */
      if (PostgresErrorTranslator.isUniqueViolation(err)) {
        return;
      }

      logger.error(
        `auto-owner-on-create failed for ${modelName} ${resourceId.toString()}`,
      );
      logger.error(err as Error);
    }
  }

  private checkMaxLengthOfFields<TBaseModel extends BaseModel>(
    data: TBaseModel,
  ): TBaseModel {
    // Check required fields.

    const tableColumns: Array<string> = this.model.getTableColumns().columns;

    for (const column of tableColumns) {
      const metadata: TableColumnMetadata =
        this.model.getTableColumnMetadata(column);
      if (
        (data as any)[column] &&
        metadata.type &&
        getMaxLengthFromTableColumnType(metadata.type)
      ) {
        if (
          (data as any)[column].toString().length >
          getMaxLengthFromTableColumnType(metadata.type)!
        ) {
          throw new BadDataException(
            `${column} length cannot be more than ${getMaxLengthFromTableColumnType(
              metadata.type,
            )} characters`,
          );
        }
      }
    }

    return data;
  }

  /*
   * Clamp string values to the max length their column declares, instead of
   * rejecting the whole write the way checkMaxLengthOfFields does.
   *
   * For machine-stamped metadata harvested from OpenTelemetry resource
   * attributes there is no user to show a validation error to, and the
   * write these values ride along with also carries liveness columns
   * (lastSeenAt / otelCollectorStatus). Letting one oversized optional
   * attribute abort that statement strands a healthy resource as
   * "disconnected" — the failure mode in issue #3006. A clipped display
   * string is strictly better than a lost heartbeat.
   *
   * Only string values on columns with a declared max length are touched;
   * `text` columns (VeryLongText and friends) declare none and pass
   * through untouched, as do numbers, dates and ObjectIDs.
   *
   * The raw, hook-free write paths (updateColumnsByIdWithoutHooks and
   * atomicAddToColumnsByIdWithoutHooks) call this themselves, so callers do
   * NOT need to — and must not rely on being able to skip it by writing a
   * new raw path of their own. It is NOT a substitute for sizing a column
   * correctly: if a field is legitimately long, widen the column.
   */
  public truncateStringColumnsToMaxLength(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    for (const column of Object.keys(data)) {
      const value: unknown = data[column];

      if (typeof value !== "string" || value.length === 0) {
        continue;
      }

      /*
       * Returns undefined for an unmapped column name despite its type —
       * leave those alone and let the write path complain about them.
       */
      const metadata: TableColumnMetadata | undefined =
        this.model.getTableColumnMetadata(column);

      if (!metadata?.type) {
        continue;
      }

      const maxLength: number | undefined = getMaxLengthFromTableColumnType(
        metadata.type,
      );

      if (maxLength !== undefined && value.length > maxLength) {
        data[column] = value.substring(0, maxLength);
      }
    }

    return data;
  }

  /*
   * ---------------------------------------------------------------------
   * Drag-ordered lists (@ListOrderColumn)
   * ---------------------------------------------------------------------
   *
   * A model marked with @ListOrderColumn is a list people put in order by
   * dragging its rows, and its number column is kept here for every caller:
   * a new row without a number goes to the end of its list, and a row given a
   * number another row of its list holds takes that place while the rows in
   * the way step aside. Numbers nobody collides with are kept as written. The
   * arithmetic is Common/Utils/ListOrder, the database work
   * ListOrderMaintainer. None of it runs for any other model.
   */
  private async planListOrderForCreate(
    data: TBaseModel,
  ): Promise<ListOrderCreatePlan | null> {
    const settings: ListOrderSettings | null = ListOrderMaintainer.getSettings(
      this.getModel(),
    );

    if (!settings) {
      return null;
    }

    const plan: ListOrderCreatePlan | null =
      await ListOrderMaintainer.planCreate({
        service: this,
        settings: settings,
        row: data,
      });

    if (plan) {
      data.setColumnValue(settings.column, plan.value);
    }

    return plan;
  }

  /*
   * The new row is saved; now the rows in its way step aside. Never fails the
   * create that already happened: a list left with a shared number still
   * shows every row, and the next move in it sorts the pair out.
   */
  private async applyListOrderCreatePlan(
    plan: ListOrderCreatePlan | null,
  ): Promise<void> {
    const settings: ListOrderSettings | null = ListOrderMaintainer.getSettings(
      this.getModel(),
    );

    if (!plan || !settings || plan.siblingChanges.length === 0) {
      return;
    }

    try {
      await ListOrderMaintainer.writeChanges({
        service: this,
        settings: settings,
        changes: plan.siblingChanges,
      });
    } catch (err) {
      logger.error(
        `Could not make room in the ${this.getModel().tableName || "list"} order for a new row: ${(err as Error)?.message || err}`,
      );
    }
  }

  /*
   * The model's list settings when an update writes the number column or
   * moves a row to another list, null otherwise - so an ordinary edit of a
   * row costs nothing extra.
   */
  private getListOrderSettingsTouchedBy(
    dataKeys: Array<string>,
  ): ListOrderSettings | null {
    const settings: ListOrderSettings | null = ListOrderMaintainer.getSettings(
      this.getModel(),
    );

    if (!settings) {
      return null;
    }

    if (dataKeys.includes(settings.column)) {
      return settings;
    }

    const scopeKeys: Array<string> = [...settings.scopeColumns];

    for (const column of this.getModel().getTableColumns().columns) {
      const relationOf: string | undefined =
        this.getModel().getTableColumnMetadata(column)?.manyToOneRelationColumn;

      if (relationOf && settings.scopeColumns.includes(relationOf)) {
        scopeKeys.push(column);
      }
    }

    const movesToAnotherList: boolean = scopeKeys.some((key: string) => {
      return dataKeys.includes(key);
    });

    return movesToAnotherList ? settings : null;
  }

  private addListOrderColumnsToSelect(
    select: Dictionary<unknown>,
    settings: ListOrderSettings,
  ): void {
    select[settings.column] = true;

    // The project too: a list is its parent's rows in that project.
    for (const column of ListOrderMaintainer.getScopeColumns({
      model: this.getModel(),
      settings: settings,
    })) {
      select[column] = true;
    }
  }

  /*
   * After an update wrote a row's number: the rows of its list that held that
   * number step aside. A row that moved to another list takes the number it
   * was given there (with the same stepping aside), or the end of that list
   * when it was given none.
   *
   * Like the create, it never fails the update that already happened.
   */
  private async placeUpdatedRowsInListOrder(input: {
    settings: ListOrderSettings;
    rowsBeforeUpdate: Array<TBaseModel>;
    data: PartialEntity<TBaseModel>;
  }): Promise<void> {
    const settings: ListOrderSettings = input.settings;
    const dataRecord: Record<string, unknown> = input.data as Record<
      string,
      unknown
    >;
    const writesNumber: boolean = Object.prototype.hasOwnProperty.call(
      dataRecord,
      settings.column,
    );

    for (const rowBeforeUpdate of input.rowsBeforeUpdate) {
      if (!rowBeforeUpdate._id) {
        continue;
      }

      try {
        const before: Record<string, unknown> =
          rowBeforeUpdate as unknown as Record<string, unknown>;

        const previousScope: ListOrderScope<TBaseModel> | null =
          ListOrderMaintainer.getScope({
            model: this.getModel(),
            settings: settings,
            row: before,
          });

        const nextScope: ListOrderScope<TBaseModel> | null =
          ListOrderMaintainer.getScope({
            model: this.getModel(),
            settings: settings,
            row: { ...before, ...dataRecord },
          });

        if (!nextScope) {
          continue;
        }

        const id: ObjectID = new ObjectID(rowBeforeUpdate._id.toString());
        const isNewToList: boolean = Boolean(
          previousScope && previousScope.key !== nextScope.key,
        );

        if (isNewToList && !writesNumber) {
          await ListOrderMaintainer.appendRow({
            service: this,
            settings: settings,
            scope: nextScope,
            id: id,
          });

          continue;
        }

        if (!writesNumber) {
          continue;
        }

        const previousValue: unknown = isNewToList
          ? null
          : before[settings.column];

        const requestedValue: unknown = dataRecord[settings.column];

        if (
          !isNewToList &&
          toListOrderNumber(requestedValue) !== null &&
          toListOrderNumber(requestedValue) === toListOrderNumber(previousValue)
        ) {
          // Saved where it already was - an edit form re-sending it, say.
          continue;
        }

        if (toListOrderNumber(requestedValue) === null) {
          /*
           * The number was cleared: the row goes to the end of its list, as
           * a row created without one does.
           */
          await ListOrderMaintainer.appendRow({
            service: this,
            settings: settings,
            scope: nextScope,
            id: id,
          });

          continue;
        }

        await ListOrderMaintainer.makeRoomForRow({
          service: this,
          settings: settings,
          scope: nextScope,
          id: id,
          previousValue: previousValue,
          requestedValue: requestedValue,
        });
      } catch (err) {
        logger.error(
          `Could not reorder the ${this.getModel().tableName || "list"} list after an update: ${(err as Error)?.message || err}`,
        );
      }
    }
  }

  /*
   * Numbers every list of this model that has rows without a number, or two
   * rows sharing one, 1..n in the order it is shown in today; lists whose
   * numbers are unique are left alone. Does nothing for a model that is not
   * a drag-ordered list. Used by the NormalizeListOrder data migration.
   */
  @CaptureSpan()
  public async normalizeListOrders(): Promise<{
    lists: number;
    rowsChanged: number;
  }> {
    const settings: ListOrderSettings | null = ListOrderMaintainer.getSettings(
      this.getModel(),
    );

    if (!settings) {
      return { lists: 0, rowsChanged: 0 };
    }

    return await ListOrderMaintainer.normalizeEveryList({
      service: this,
      settings: settings,
    });
  }

  private async checkTotalItemsBy(
    createdBy: CreateBy<TBaseModel>,
  ): Promise<void> {
    const totalItemsColumnName: string | null =
      this.model.getTotalItemsByColumnName();
    const totalItemsNumber: number | null = this.model.getTotalItemsNumber();
    const errorMessage: string | null =
      this.model.getTotalItemsByErrorMessage();

    if (!totalItemsColumnName || !totalItemsNumber || !errorMessage) {
      return;
    }

    /*
     * The record the limit counts rows for (a status page's links), under
     * either name the write used for it: a write that sent only the relation
     * counts against the same limit.
     */
    const totalItemsColumnValue: unknown = this.getWrittenColumnValue(
      createdBy.data,
      totalItemsColumnName,
    );

    if (totalItemsColumnValue) {
      const count: PositiveNumber = await this.countBy({
        query: {
          [totalItemsColumnName]: totalItemsColumnValue,
        } as FindWhere<TBaseModel>,
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      if (count.positiveNumber > totalItemsNumber - 1) {
        throw new BadDataException(errorMessage);
      }
    }
  }

  private async checkUniqueColumnBy(
    createBy: CreateBy<TBaseModel>,
  ): Promise<CreateBy<TBaseModel>> {
    let existingItemsWithSameNameCount: number = 0;

    const uniqueColumnsBy: Dictionary<string | Array<string>> =
      getUniqueColumnsBy(createBy.data);

    for (const key in uniqueColumnsBy) {
      if (!uniqueColumnsBy[key]) {
        continue;
      }

      if (typeof uniqueColumnsBy[key] === Typeof.String) {
        uniqueColumnsBy[key] = [uniqueColumnsBy[key] as string];
      }

      const query: Query<TBaseModel> = {};

      for (const uniqueByColumnName of uniqueColumnsBy[key] as Array<string>) {
        /*
         * A reference the name is unique within (a status page, a network
         * device) is read under either of its names: a write that sent only
         * the relation is checked against its own list, not the rows with
         * none.
         */
        const columnValue: unknown = this.getWrittenColumnValue(
          createBy.data,
          uniqueByColumnName as string,
        );
        if (columnValue === null || columnValue === undefined) {
          (query as any)[uniqueByColumnName] = QueryHelper.isNull();
        } else {
          (query as any)[uniqueByColumnName] = columnValue;
        }
      }

      existingItemsWithSameNameCount = (
        await this.countBy({
          query: {
            [key]: QueryHelper.findWithSameText(
              (createBy.data as any)[key]
                ? ((createBy.data as any)[key]! as string)
                : "",
            ),
            ...query,
          },
          props: {
            isRoot: true,
          },
        })
      ).toNumber();

      if (existingItemsWithSameNameCount > 0) {
        throw new BadDataException(
          `${this.model.singularName} with the same ${key} already exists.`,
        );
      }

      existingItemsWithSameNameCount = 0;
    }

    return Promise.resolve(createBy);
  }

  /*
   * Enforces @UniqueColumnsTogether before the row is written, so a duplicate
   * is rejected with the model's own message and never reaches
   * onCreateSuccess (and whatever feed items or notifications it sends).
   *
   * A key column can arrive as its id column (`teamId`) or only as the
   * relation that fills it (`team`), so both are read. When a value is
   * missing altogether there is nothing to compare; the unique index decides.
   */
  private async checkUniqueColumnsTogether(data: TBaseModel): Promise<void> {
    for (const constraint of this.model.getUniqueColumnsTogether()) {
      const query: Dictionary<ObjectID | JSONValue> = {};
      let isKeyComplete: boolean = true;

      for (const columnName of constraint.columnNames) {
        const value: ObjectID | JSONValue | null = this.getUniqueKeyValue(
          data,
          columnName,
        );

        if (value === null) {
          isKeyComplete = false;
          break;
        }

        query[columnName] = value;
      }

      if (!isKeyComplete) {
        continue;
      }

      const count: PositiveNumber = await this.countBy({
        query: query as Query<TBaseModel>,
        props: {
          isRoot: true,
        },
      });

      if (count.toNumber() > 0) {
        throw PostgresErrorTranslator.createUniqueViolationException(
          constraint.errorMessage,
        );
      }
    }
  }

  private getUniqueKeyValue(
    data: TBaseModel,
    columnName: string,
  ): ObjectID | JSONValue | null {
    const metadata: TableColumnMetadata | undefined =
      this.model.getTableColumnMetadata(columnName);

    if (metadata?.type !== TableColumnType.ObjectID) {
      const value: JSONValue = (data as any)[columnName];
      return value === undefined || value === null ? null : value;
    }

    const value: unknown = this.getWrittenColumnValue(data, columnName);

    if (value instanceof ObjectID) {
      return value;
    }

    const id: string | null = RelationValueUtil.getRelationId(value);

    return id ? new ObjectID(id) : null;
  }

  /*
   * What a write gives one column, for a check that runs before it is saved
   * (a limit, a name unique in its scope, keys unique together). An ID
   * column is one database column with the relation stored in it, and a
   * write may name the record under either, so for an ID column this is its
   * own value when it holds an id, else the id of that relation - the
   * project's relation included, for a write OneUptime makes itself that
   * names its project that way. Any other column is read as it is.
   *
   * Nothing is refused here. A request whose two names disagree is refused
   * before the hooks (assertRelationNamesAgree), a create naming a record
   * only by the relation has its ID column filled there too
   * (fillIdColumnsFromRelations), and a hook writes a reference with
   * RelationIdUtil.stamp, which leaves one name. A write OneUptime makes
   * itself is left alone there, and here too.
   */
  private getWrittenColumnValue(
    data: TBaseModel | PartialEntity<TBaseModel>,
    columnName: string,
  ): unknown {
    const record: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    const value: unknown = record[columnName];

    if (RelationValueUtil.getRelationId(value)) {
      return value;
    }

    const relationColumn: string | undefined =
      this.getRelationStoredIn(columnName);

    const relationId: string | null = relationColumn
      ? RelationValueUtil.getRelationId(record[relationColumn])
      : null;

    return relationId ? new ObjectID(relationId) : value;
  }

  // The relation stored in `columnName` (`project` in `projectId`), if any.
  private getRelationStoredIn(columnName: string): string | undefined {
    return this.model
      .getTableColumns()
      .columns.find((column: string): boolean => {
        const metadata: TableColumnMetadata =
          this.model.getTableColumnMetadata(column);

        return (
          metadata.type === TableColumnType.Entity &&
          metadata.manyToOneRelationColumn === columnName
        );
      });
  }

  @CaptureSpan()
  public async countBy({
    query,
    skip,
    limit,
    props,
    groupBy,
    distinctOn,
  }: CountBy<TBaseModel>): Promise<PositiveNumber> {
    try {
      if (groupBy && Object.keys(groupBy).length > 0) {
        throw new BadDataException("Group By is not supported for countBy");
      }

      if (!skip) {
        skip = new PositiveNumber(0);
      }

      if (!limit) {
        limit = new PositiveNumber(Infinity);
      }

      if (!(skip instanceof PositiveNumber)) {
        skip = new PositiveNumber(skip);
      }

      if (!(limit instanceof PositiveNumber)) {
        limit = new PositiveNumber(limit);
      }

      query = this.getRuleCriteriaEffectiveEnabledQuery(query);

      const findBy: FindBy<TBaseModel> = {
        query,
        skip,
        limit,
        props,
      };

      const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
        await ModelPermission.checkReadQueryPermission(
          this.modelType,
          query,
          null,
          props,
        );

      findBy.query = checkReadPermissionType.query;
      let count: number = 0;

      if (distinctOn) {
        const queryBuilder: SelectQueryBuilder<TBaseModel> =
          this.getQueryBuilder(this.modelName)
            .where(findBy.query)
            .skip(skip.toNumber())
            .take(limit.toNumber());

        if (distinctOn) {
          queryBuilder.groupBy(`${this.modelName}.${distinctOn}`);
        }

        count = await queryBuilder.getCount();
      } else {
        count = await this.getRepository().count({
          where: findBy.query as any,
          skip: (findBy.skip as PositiveNumber).toNumber(),
          take: (findBy.limit as PositiveNumber).toNumber(),
        });
      }

      let countPositive: PositiveNumber = new PositiveNumber(count);
      countPositive = await this.onCountSuccess(countPositive);
      return countPositive;
    } catch (error) {
      await this.onCountError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  /*
   * A plain identifier, because an alias is interpolated into `AS "..."` and
   * is structure rather than data — there is no parameter form for it.
   */
  private static readonly aggregateAliasPattern: RegExp =
    /^[a-zA-Z][a-zA-Z0-9_]*$/;

  /**
   * Answers a question ABOUT the matched rows — how many, how much, how many
   * of each — without loading them.
   *
   * Same permission pipeline as `findBy` and `countBy`: the query is run
   * through `checkReadQueryPermission` first, so tenant scoping and
   * label-block filtering apply exactly as they do to a list read (a blocked
   * label produces the same relation join here that it produces there — the
   * count cannot see rows the list would hide).
   *
   * Returns one row per group, or exactly one row when `groupBy` is omitted.
   * Values come back as the driver produced them; read them through
   * `AggregateResultUtil` rather than indexing in directly, because Postgres
   * hands COUNT and SUM back as strings.
   *
   * See `AggregateBy` for the trust boundary on `expression`: constants only,
   * every dynamic value through `parameters`.
   */
  @CaptureSpan()
  public async aggregateBy(
    aggregateBy: AggregateBy<TBaseModel>,
  ): Promise<Array<AggregateRow>> {
    try {
      this.setTelemetryContextFromProps(aggregateBy.props);

      if (!aggregateBy.select || aggregateBy.select.length === 0) {
        throw new BadDataException(
          "aggregateBy needs at least one aggregate column to select.",
        );
      }

      const groupByColumns: Array<AggregateColumn> = aggregateBy.groupBy || [];

      /*
       * Grouped columns are selected as well as grouped on. Doing it here
       * rather than making callers list them twice is what keeps a group key
       * and the bucket it labels from ever drifting apart.
       */
      const selectColumns: Array<AggregateColumn> = [
        ...groupByColumns,
        ...aggregateBy.select,
      ];

      const seenAliases: Set<string> = new Set<string>();

      for (const column of selectColumns) {
        DatabaseService.assertSafeAggregateExpression(column.expression);

        if (!DatabaseService.aggregateAliasPattern.test(column.alias)) {
          throw new BadDataException(
            `Invalid aggregate alias: ${column.alias}. Aliases must be plain identifiers.`,
          );
        }

        if (seenAliases.has(column.alias)) {
          throw new BadDataException(
            `Duplicate aggregate alias: ${column.alias}.`,
          );
        }

        seenAliases.add(column.alias);
      }

      /*
       * Validated here rather than in the loop that applies them, so every
       * expression in the request is checked BEFORE anything reaches the
       * database — and so the check is reachable without a live connection,
       * which is what makes it testable.
       */
      for (const order of aggregateBy.orderBy || []) {
        DatabaseService.assertSafeAggregateExpression(order.expression);
      }

      const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
        await ModelPermission.checkReadQueryPermission(
          this.modelType,
          this.getRuleCriteriaEffectiveEnabledQuery(aggregateBy.query),
          null,
          aggregateBy.props,
        );

      const queryBuilder: SelectQueryBuilder<TBaseModel> =
        this.buildAggregateScope(checkReadPermissionType.query);

      let isFirstColumn: boolean = true;

      for (const column of selectColumns) {
        if (isFirstColumn) {
          queryBuilder.select(column.expression, column.alias);
          isFirstColumn = false;
        } else {
          queryBuilder.addSelect(column.expression, column.alias);
        }
      }

      for (const column of groupByColumns) {
        queryBuilder.addGroupBy(column.expression);
      }

      for (const order of aggregateBy.orderBy || []) {
        queryBuilder.addOrderBy(
          order.expression,
          order.sortOrder === SortOrder.Ascending ? "ASC" : "DESC",
        );
      }

      if (aggregateBy.parameters) {
        queryBuilder.setParameters(aggregateBy.parameters);
      }

      if (aggregateBy.limit !== undefined) {
        if (!Number.isInteger(aggregateBy.limit) || aggregateBy.limit < 0) {
          throw new BadDataException(
            `Invalid aggregate limit: ${aggregateBy.limit}. It must be a non-negative integer.`,
          );
        }

        /*
         * `.limit`, not `.take`: this is a raw read, and `take` is the
         * entity-hydrating pagination that would wrap the whole aggregate in
         * a distinct-id subquery.
         */
        queryBuilder.limit(aggregateBy.limit);
      }

      return (await queryBuilder.getRawMany()) as Array<AggregateRow>;
    } catch (error) {
      await this.onCountError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  /**
   * A query builder scoped to exactly the rows this read may see, and — this
   * is the whole point — scoped so that each of them appears ONCE.
   *
   * The permission pipeline expresses a label-scoped ALLOW as a condition on
   * the access-control RELATION — `{ labels: [permittedIds] }`, which
   * QueryUtil.serializeQuery then nests into `{ labels: { _id: <a set
   * membership operator> } }`. Handed to TypeORM's FindOptions machinery that
   * becomes a join through the many-to-many junction table — and a join
   * multiplies rows. A device carrying two permitted labels comes back twice.
   *
   * A label BLOCK no longer takes that route, and it is worth being precise
   * about why, because the shape reads like the allow half's mirror image and
   * is not. A relation condition cannot express "has NONE of these labels" at
   * all: a device labelled {blocked, other} still matches the join through its
   * "other" row. So ReadPermission writes the block as a flat predicate on the
   * owner's own id instead — `_id NOT IN (SELECT ownerId FROM the junction
   * table WHERE labelId IN (...))`. Flat means no join, which means no
   * duplicate rows, which means the block half needs nothing from this method
   * beyond the cheap path below.
   *
   * The allow half is not the only producer of relation-keyed conditions
   * either. `@CanAccessIfCanReadOn` makes BasePermission write
   * `query[relation] = { <the related model's access-control column>: ids }`
   * for StatusPageResource, IncidentInternalNote, AlertEpisodeMember and
   * others, and that arrives here indistinguishable from a label allow.
   *
   * `findBy` never notices, because entity hydration de-duplicates by primary
   * key on the way out. An aggregate has no such step: COUNT(*) would report
   * that device as two devices and SUM("interfacesDown") would double its dark
   * ports — silently, and only for the label-scoped enterprise users who are
   * least able to spot it. (Verified against Postgres: one device, two
   * permitted labels, `COUNT(*) = 2`, `SUM = 2` for a stored value of 1.)
   *
   * `COUNT(DISTINCT _id)` would fix the counts and do nothing for the sums, so
   * the de-duplication happens one level down instead: when the scoped query
   * touches a relation at all, the aggregate runs over the base table filtered
   * by a DISTINCT subquery of ids. The joins live inside that subquery, where
   * duplicate rows collapse before anything is added up.
   *
   * The subquery is skipped when the query is flat — every read by a user with
   * no label-scoped allow grant and no `@CanAccessIfCanReadOn` relation, which
   * is the hot path, and the block half above with it — so the ordinary
   * full-fleet aggregate stays a single sequential scan.
   */
  private buildAggregateScope(
    query: Query<TBaseModel>,
  ): SelectQueryBuilder<TBaseModel> {
    if (!this.queryTouchesARelation(query)) {
      const flatBuilder: SelectQueryBuilder<TBaseModel> = this.getQueryBuilder(
        this.modelName,
      );

      flatBuilder.setFindOptions({ where: query as any });

      return flatBuilder;
    }

    /*
     * A separate alias, so the subquery's joins cannot collide with the outer
     * statement's table reference.
     */
    const scopeAlias: string = `${this.modelName}_aggregate_scope`;

    const scopeBuilder: SelectQueryBuilder<TBaseModel> =
      this.getQueryBuilder(scopeAlias);

    scopeBuilder.setFindOptions({ where: query as any });
    scopeBuilder.select(`DISTINCT "${scopeAlias}"."_id"`, "_id");

    const queryBuilder: SelectQueryBuilder<TBaseModel> = this.getQueryBuilder(
      this.modelName,
    );

    /*
     * The alias is QUOTED. TypeORM renders it quoted everywhere else, and an
     * unquoted `NetworkDevice."_id"` in a raw fragment is folded to lower case
     * by Postgres — which then does not match the quoted alias at all.
     */
    queryBuilder.where(
      `"${this.modelName}"."_id" IN (${scopeBuilder.getQuery()})`,
    );
    /*
     * The subquery's own bound values, copied across under whatever names they
     * already carry. Two naming schemes reach this line: TypeORM auto-names
     * the parameters it creates itself (`orm_param_N`), but a label predicate
     * arrives as a `Raw` operator carrying its own object-literal parameters,
     * and TypeORM registers those verbatim — QueryHelper names them with ten
     * random characters apiece. Neither can clash with the outer builder,
     * which generates no parameters of its own here: its only WHERE is the raw
     * string above. Caller-supplied parameters are named and applied later.
     */
    queryBuilder.setParameters(scopeBuilder.getParameters());

    return queryBuilder;
  }

  /*
   * Whether any top-level key of the query names a RELATION rather than a
   * column — the shape that turns into a join.
   *
   * Deliberately conservative in both directions: a many-to-one relation joins
   * at most one row and would not actually multiply anything, and metadata
   * being unavailable is treated as "yes, there might be one". Both err
   * towards the de-duplicating path, which is always correct and merely
   * slower.
   */
  private queryTouchesARelation(query: Query<TBaseModel>): boolean {
    let metadata: EntityMetadata;

    try {
      metadata = this.getRepository().metadata;
    } catch {
      return true;
    }

    for (const key of Object.keys(query as Record<string, unknown>)) {
      if (metadata.findRelationWithPropertyPath(key)) {
        return true;
      }
    }

    return false;
  }

  /*
   * A tripwire on the constants-only contract, not a sanitizer: an expression
   * assembled from request data can be perfectly valid SQL and still be an
   * injection. What this catches is the one shape that turns a leaked value
   * into a second statement.
   */
  private static assertSafeAggregateExpression(expression: string): void {
    if (!expression || !expression.trim()) {
      throw new BadDataException("Aggregate expression cannot be empty.");
    }

    if (expression.includes(";")) {
      throw new BadDataException(
        "Aggregate expressions cannot contain statement separators.",
      );
    }
  }

  @CaptureSpan()
  public async deleteOneById(deleteById: DeleteById): Promise<number> {
    await ModelPermission.checkDeletePermissionByModel({
      modelType: this.modelType,
      fetchModelWithAccessControlIds: async () => {
        const selectModel: Select<TBaseModel> = {};
        const accessControlColumn: string | null =
          this.getModel().getAccessControlColumn();

        if (accessControlColumn) {
          (selectModel as any)[accessControlColumn] = {
            _id: true,
            name: true,
          };
        }

        return await this.findOneById({
          id: deleteById.id,
          select: selectModel,
          props: {
            isRoot: true,
          },
        });
      },
      props: deleteById.props,
    });

    return await this.deleteOneBy({
      query: {
        _id: deleteById.id.toString(),
      } as any,
      deletedByUser: deleteById.deletedByUser,
      deletionReason: deleteById.deletionReason,
      props: deleteById.props,
    });
  }

  @CaptureSpan()
  public async deleteOneBy(
    deleteOneBy: DeleteOneBy<TBaseModel>,
  ): Promise<number> {
    return await this._deleteBy({ ...deleteOneBy, limit: 1, skip: 0 });
  }

  @CaptureSpan()
  public async deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<number> {
    return await this._deleteBy(deleteBy);
  }

  @CaptureSpan()
  public async hardDeleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<number> {
    try {
      deleteBy.props = await this.checkCallerBeforeHooks(
        deleteBy.props,
        DatabaseRequestType.Delete,
      );

      /*
       * Only the rows the caller may delete reach the hook. See the helper.
       * A hard delete also purges soft-deleted rows, so they count too.
       */
      if (
        !(await this.keepRowsCallerMayWrite(
          deleteBy,
          DatabaseRequestType.Delete,
          { withDeleted: true },
        ))
      ) {
        return 0;
      }

      const onDelete: OnDelete<TBaseModel> = deleteBy.props.ignoreHooks
        ? { deleteBy, carryForward: [] }
        : await this.onBeforeDelete(deleteBy);
      const beforeDeleteBy: DeleteBy<TBaseModel> = onDelete.deleteBy;

      beforeDeleteBy.query = this.getRuleCriteriaEffectiveEnabledQuery(
        beforeDeleteBy.query,
      );

      beforeDeleteBy.query = await ModelPermission.checkDeleteQueryPermission(
        this.modelType,
        beforeDeleteBy.query,
        deleteBy.props,
      );

      if (!(beforeDeleteBy.skip instanceof PositiveNumber)) {
        beforeDeleteBy.skip = new PositiveNumber(beforeDeleteBy.skip);
      }

      if (!(beforeDeleteBy.limit instanceof PositiveNumber)) {
        beforeDeleteBy.limit = new PositiveNumber(beforeDeleteBy.limit);
      }

      /*
       * With their project, so a delete that takes something off a status
       * page always says whose (StatusPageOverviewCache).
       */
      const lookupSelect: Dictionary<boolean> = {};
      const lookupTenantColumn: string | null =
        this.getModel().getTenantColumn();

      if (lookupTenantColumn) {
        lookupSelect[lookupTenantColumn] = true;
      }

      const items: Array<TBaseModel> = await this._findBy(
        {
          query: beforeDeleteBy.query,
          skip: beforeDeleteBy.skip.toNumber(),
          limit: beforeDeleteBy.limit.toNumber(),
          select: lookupSelect as Select<TBaseModel>,
          props: { ...beforeDeleteBy.props, ignoreHooks: true },
        },
        true,
      );

      let numberOfDocsAffected: number = 0;

      if (items.length > 0) {
        beforeDeleteBy.query = {
          ...beforeDeleteBy.query,
          _id: QueryHelper.any(
            items.map((i: TBaseModel) => {
              return i.id!;
            }),
          ),
        };

        // What the rows, and the rows deleted with them, showed to everyone.
        const rowsDeleted: Array<TBaseModel> =
          await this.readRowsShowingImages(items);
        const cascaded: Array<CascadedRow> =
          await this.readRowsDeletedWith(items);

        numberOfDocsAffected =
          (await this.getRepository().delete(beforeDeleteBy.query as any))
            .affected || 0;

        /*
         * Their images are private again, unless another record still shows
         * them - a retention purge included. See PublishedImages.
         */
        await PublishedImages.afterDelete({
          tableName: this.model.tableName,
          rowsDeleted: rowsDeleted,
          cascaded: cascaded,
        });

        // Gone from every status page at once. See StatusPageOverviewCache.
        await StatusPageOverviewCache.afterDelete({
          tableName: this.model.tableName,
          rows: rowsDeleted,
        });
      }

      return numberOfDocsAffected;
    } catch (error) {
      await this.onDeleteError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  private async _deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<number> {
    try {
      this.setTelemetryContextFromProps(deleteBy.props);

      deleteBy.props = await this.checkCallerBeforeHooks(
        deleteBy.props,
        DatabaseRequestType.Delete,
      );

      if (this.doNotAllowDelete && !deleteBy.props.isRoot) {
        throw new BadDataException("Delete not allowed");
      }

      // Only the rows the caller may delete reach the hook. See the helper.
      if (
        !(await this.keepRowsCallerMayWrite(
          deleteBy,
          DatabaseRequestType.Delete,
        ))
      ) {
        return 0;
      }

      const onDelete: OnDelete<TBaseModel> = deleteBy.props.ignoreHooks
        ? { deleteBy, carryForward: [] }
        : await this.onBeforeDelete(deleteBy);

      const beforeDeleteBy: DeleteBy<TBaseModel> = onDelete.deleteBy;

      const carryForward: any = onDelete.carryForward;

      beforeDeleteBy.query = this.getRuleCriteriaEffectiveEnabledQuery(
        beforeDeleteBy.query,
      );

      beforeDeleteBy.query = await ModelPermission.checkDeleteQueryPermission(
        this.modelType,
        beforeDeleteBy.query,
        deleteBy.props,
      );

      if (!(beforeDeleteBy.skip instanceof PositiveNumber)) {
        beforeDeleteBy.skip = new PositiveNumber(beforeDeleteBy.skip);
      }

      if (!(beforeDeleteBy.limit instanceof PositiveNumber)) {
        beforeDeleteBy.limit = new PositiveNumber(beforeDeleteBy.limit);
      }

      const select: Select<TBaseModel> = {};

      if (this.getModel().getTenantColumn()) {
        (select as any)[this.getModel().getTenantColumn() as string] = true;
      }

      // What the rows show to everyone, to take it back. See PublishedImages.
      for (const column of PublishedImages.getColumns(this.model.tableName)) {
        (select as Dictionary<unknown>)[column] = true;
      }

      /*
       * If audit logging on delete is enabled, fetch all scalar columns so we
       * can record a full snapshot of the record before it is deleted.
       */
      if (this.getModel().enableAuditLogOn?.delete) {
        const allColumns: Array<string> =
          this.getModel().getTableColumns().columns;
        for (const columnName of allColumns) {
          (select as any)[columnName] = true;
        }
      }

      const items: Array<TBaseModel> = await this._findBy({
        query: beforeDeleteBy.query,
        skip: beforeDeleteBy.skip.toNumber(),
        limit: beforeDeleteBy.limit.toNumber(),
        select: select,
        props: {
          isRoot: true, // isRoot because query has already been checked for permissions.
          ignoreHooks: true,
        },
      });

      /*
       * We are hard deleting anyway. So, this does not make sense. Please uncomment if
       * we change the code to soft-delete.
       */

      /*
       * await this._updateBy({
       *     query: deleteBy.query,
       *     data: {
       *         deletedByUserId: deleteBy.props.userId,
       *     } as any,
       *     limit: deleteBy.limit,
       *     skip: deleteBy.skip,
       *     props: {
       *         isRoot: true,
       *         ignoreHooks: true,
       *     },
       * });
       */

      let numberOfDocsAffected: number = 0;

      if (items.length > 0) {
        const query: Query<TBaseModel> = {
          _id: QueryHelper.any(
            items.map((i: TBaseModel) => {
              return i.id!;
            }),
          ),
        };

        // The rows the database deletes along with these, while they are there.
        const cascaded: Array<CascadedRow> =
          await this.readRowsDeletedWith(items);

        numberOfDocsAffected =
          (await this.getRepository().delete(query as any)).affected || 0;

        /*
         * The images the deleted rows - and the rows deleted with them -
         * showed to everyone are private again, unless another record still
         * shows them. See PublishedImages.
         */
        await PublishedImages.afterDelete({
          tableName: this.model.tableName,
          rowsDeleted: items,
          cascaded: cascaded,
        });

        // Gone from every status page at once. See StatusPageOverviewCache.
        await StatusPageOverviewCache.afterDelete({
          tableName: this.model.tableName,
          rows: items,
        });
      }

      // hit workflow.
      if (
        this.getModel().enableWorkflowOn?.delete &&
        (deleteBy.props.tenantId || this.getModel().getTenantColumn())
      ) {
        for (const item of items) {
          if (this.getModel().enableWorkflowOn?.create) {
            let tenantId: ObjectID | undefined = deleteBy.props.tenantId;

            if (!tenantId && this.getModel().getTenantColumn()) {
              tenantId = item.getValue<ObjectID>(
                this.getModel().getTenantColumn()!,
              );
            }

            if (tenantId) {
              await this.onTriggerWorkflow(item.id!, tenantId, "on-delete");
              await this.onTriggerRealtime(
                item.id!,
                tenantId,
                ModelEventType.Delete,
              );
            }
          }
        }
      }

      if (!deleteBy.props.ignoreHooks) {
        await this.onDeleteSuccess(
          { deleteBy, carryForward },
          items.map((i: TBaseModel) => {
            return new ObjectID(i._id!);
          }),
        );
      }

      if (this.getModel().enableAuditLogOn?.delete && items.length > 0) {
        const auditLogService: typeof AuditLogServiceType =
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("./AuditLogService").default;
        for (const item of items) {
          if (item.id) {
            await auditLogService.recordDelete({
              model: this.getModel(),
              deletedItem: item,
              itemId: item.id,
              props: deleteBy.props,
            });
          }
        }
      }

      return numberOfDocsAffected;
    } catch (error) {
      await this.onDeleteError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  @CaptureSpan()
  public async findAllBy(
    findAllBy: FindAllBy<TBaseModel>,
  ): Promise<Array<TBaseModel>> {
    const { limit, skip, ...rest } = findAllBy;

    let remaining: number | undefined = this.normalizePositiveNumber(limit);
    let currentSkip: number = this.normalizePositiveNumber(skip) || 0;

    const results: Array<TBaseModel> = [];

    while (true) {
      const currentBatchSize: number =
        remaining !== undefined
          ? Math.min(LIMIT_MAX, Math.max(remaining, 0))
          : LIMIT_MAX;

      if (currentBatchSize <= 0) {
        break;
      }

      const page: Array<TBaseModel> = await this.findBy({
        ...rest,
        skip: currentSkip,
        limit: currentBatchSize,
      });

      if (page.length === 0) {
        break;
      }

      results.push(...page);

      currentSkip += page.length;

      if (remaining !== undefined) {
        remaining -= page.length;

        if (remaining <= 0) {
          break;
        }
      }

      if (page.length < currentBatchSize) {
        break;
      }
    }

    return results;
  }

  private normalizePositiveNumber(
    value?: PositiveNumber | number,
  ): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (value instanceof PositiveNumber) {
      return value.toNumber();
    }

    if (typeof value === "number") {
      return value;
    }

    return undefined;
  }

  @CaptureSpan()
  public async findBy(findBy: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {
    return await this._findBy(findBy);
  }

  private async _findBy(
    findBy: FindBy<TBaseModel>,
    withDeleted?: boolean | undefined,
  ): Promise<Array<TBaseModel>> {
    try {
      this.setTelemetryContextFromProps(findBy.props);

      findBy.props = await this.checkCallerBeforeHooks(
        findBy.props,
        DatabaseRequestType.Read,
      );

      // Who is asking, as they asked: whose files they may see.
      const fileReader: RelatedFileReader | null = RelatedFileAccess.getReader(
        findBy.props,
      );

      if (!findBy.sort || Object.keys(findBy.sort).length === 0) {
        findBy.sort = {
          createdAt: SortOrder.Descending,
        };
      }

      const onFind: OnFind<TBaseModel> = findBy.props.ignoreHooks
        ? { findBy, carryForward: [] }
        : await this.onBeforeFind(findBy);
      const onBeforeFind: FindBy<TBaseModel> = { ...onFind.findBy };
      const carryForward: any = onFind.carryForward;

      if (
        !onBeforeFind.select ||
        Object.keys(onBeforeFind.select).length === 0
      ) {
        onBeforeFind.select = {} as any;
      }

      if (!(onBeforeFind.select as any)["_id"]) {
        (onBeforeFind.select as any)["_id"] = true;
      }

      onBeforeFind.query = this.getRuleCriteriaEffectiveEnabledQuery(
        onBeforeFind.query,
      );

      const result: {
        query: Query<TBaseModel>;
        select: Select<TBaseModel> | null;
        relationSelect: RelationSelect<TBaseModel> | null;
      } = await ModelPermission.checkReadQueryPermission(
        this.modelType,
        onBeforeFind.query,
        onBeforeFind.select || null,
        onBeforeFind.props,
      );

      onBeforeFind.query = result.query;
      onBeforeFind.select = result.select || undefined;

      const mapEffectiveEnabled: boolean = Boolean(
        (onBeforeFind.select as Record<string, unknown> | undefined)?.[
          "isEnabled"
        ],
      );
      const removeInternallySelectedCriteria: boolean =
        this.addRuleCriteriaEffectiveEnabledToSelect(onBeforeFind.select);

      const sortColumnsAddedToSelect: Array<string> =
        this.addSortColumnsToSelect(onBeforeFind);

      if (!(onBeforeFind.skip instanceof PositiveNumber)) {
        onBeforeFind.skip = new PositiveNumber(onBeforeFind.skip);
      }

      if (!(onBeforeFind.limit instanceof PositiveNumber)) {
        onBeforeFind.limit = new PositiveNumber(onBeforeFind.limit);
      }

      if (
        onBeforeFind.groupBy &&
        Object.keys(onBeforeFind.groupBy).length > 0
      ) {
        throw new BadDataException("GroupBy is currently not supported");
      }

      /*
       * Complete the caller's sort into a TOTAL order.
       *
       * Everything here pages with LIMIT/OFFSET, and OFFSET only means
       * anything against an ordering that has no ties: rows that compare
       * equal may come back in any order, and Postgres is free to return them
       * differently for the two queries that fetch page 1 and page 2. A tied
       * row can therefore be served on both pages while another is served on
       * neither — the same row apparently listed twice.
       *
       * Ties are not exotic. The Inventory list sorts on `lastSeenAt`, which
       * the entity reconciler rewrites for every live entity every few
       * minutes, and the inventory mirror stamps one identical timestamp
       * across a whole page of rows; "created at" sorts tie for anything
       * bulk-inserted in one statement. Appending the primary key breaks
       * every tie deterministically and costs nothing — `_id` is the PK, and
       * it is already in the select (see above), so this adds no column to
       * the projection and nothing to strip afterwards.
       */
      const sortSoFar: Dictionary<SortOrder> =
        (onBeforeFind.sort as Dictionary<SortOrder> | undefined) || {};

      if (!sortSoFar["_id"]) {
        // Copied, never mutated: callers reuse their sort objects across queries.
        onBeforeFind.sort = {
          ...sortSoFar,
          _id: SortOrder.Ascending,
        } as Sort<TBaseModel>;
      }

      const items: Array<TBaseModel> = await this.getRepository().find({
        skip: onBeforeFind.skip.toNumber(),
        take: onBeforeFind.limit.toNumber(),
        where: onBeforeFind.query as any,
        order: onBeforeFind.sort as any,
        relations: result.relationSelect as any,
        select: onBeforeFind.select as any,
        withDeleted: withDeleted || false,
      });

      let decryptedItems: Array<TBaseModel> = [];

      for (const item of items) {
        this.applyRuleCriteriaEffectiveEnabledToItem(
          item,
          mapEffectiveEnabled,
          removeInternallySelectedCriteria,
        );
        decryptedItems.push(await this.decrypt(item));
      }

      decryptedItems = this.sanitizeFindByItems(decryptedItems, onBeforeFind);

      /*
       * A record's files only for someone who may see them; anyone else
       * gets the record without them. See RelatedFileAccess.
       */
      await RelatedFileAccess.keepReadableFiles({
        model: this.model,
        rows: decryptedItems,
        select: onBeforeFind.select,
        reader: fileReader,
      });

      for (const item of decryptedItems) {
        for (const sortColumn of sortColumnsAddedToSelect) {
          delete (item as any)[sortColumn];
        }
      }

      if (!findBy.props.ignoreHooks) {
        decryptedItems = await (
          await this.onFindSuccess({ findBy, carryForward }, decryptedItems)
        ).carryForward;
      }

      return decryptedItems;
    } catch (error) {
      await this.onFindError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  /**
   * Adds every sorted column to the select, and returns the ones it added so
   * `_findBy` can strip them back off the results.
   *
   * A column can be ordered by without being selected in a plain SELECT, but
   * not once a relation is also selected: the join sends the query down
   * TypeORM's paginated path, which wraps it and orders the outer SELECT by a
   * column the inner query only emits when that column was selected. The
   * request then fails outright with `column distinctAlias.<Alias>_<column>
   * does not exist`. Callers should not have to know that, so close the gap
   * here for every sort rather than leaving each call site to remember.
   *
   * Deliberately runs *after* the read-permission check. ORDER BY is not
   * permission-checked, so a column being sorted on is already reaching the
   * database - adding it to the select must not be able to turn a query that
   * worked into a permission error. The values never reach the caller.
   *
   * That last sentence is exactly why owner-only columns are excluded below.
   * Running after the gate means anything added here was never gated, so
   * `sort: { webhookUrl: "ASC" }` is a way of writing a column into the select
   * that ModelPermission has already finished looking at. The column is
   * stripped off the returned rows again, but "the caller only learns the
   * ORDER of everyone's webhook URLs" is not a defence - order is a comparison
   * oracle, and a handful of paged requests reconstructs the value. A caller
   * who may genuinely read the column has already put it in the select
   * themselves, in which case the first filter clause below has already
   * returned false and nothing here applies to them.
   */
  private addSortColumnsToSelect(findBy: FindBy<TBaseModel>): Array<string> {
    /*
     * No select at all means every column is selected, so there is nothing to
     * fill in.
     */
    if (!findBy.select) {
      return [];
    }

    /*
     * Root and master admin keep the existing behaviour untouched: they are
     * past every permission check by definition, and notification delivery
     * reads and orders these columns as root in order to actually page people.
     */
    const isPrivilegedInternalRead: boolean =
      Boolean(findBy.props.isRoot) || Boolean(findBy.props.isMasterAdmin);

    const sortColumnsToAdd: Array<string> = Object.keys(
      findBy.sort || {},
    ).filter((sortColumn: string) => {
      if ((findBy.select as any)[sortColumn] !== undefined) {
        return false;
      }

      if (
        !isPrivilegedInternalRead &&
        OwnerOnlyColumnPermission.isOwnerOnlyColumnOnModel(
          this.modelType,
          sortColumn,
        )
      ) {
        return false;
      }

      /*
       * Sorting by a relation orders through the joined table, which has its
       * own alias - adding the relation to the select here would instead turn
       * it into a fetched relation.
       */
      return (
        this.model.hasColumn(sortColumn) &&
        !this.model.isEntityColumn(sortColumn)
      );
    });

    if (sortColumnsToAdd.length === 0) {
      return [];
    }

    /*
     * Copied rather than mutated: sanitizeSelect hands back the caller's own
     * select object, and callers reuse those across queries.
     */
    findBy.select = { ...(findBy.select as any) };

    for (const sortColumn of sortColumnsToAdd) {
      (findBy.select as any)[sortColumn] = true;
    }

    return sortColumnsToAdd;
  }

  private sanitizeFindByItems(
    items: Array<TBaseModel>,
    findBy: FindBy<TBaseModel>,
  ): Array<TBaseModel> {
    // if there's no select then there's nothing to do.
    if (!findBy.select) {
      return items;
    }

    for (const key in findBy.select) {
      // for each key in select check if there's nested properties, this indicates there's a relation.
      if (typeof findBy.select[key] === Typeof.Object) {
        // get meta data to check if this column is an entity array.
        const tableColumnMetadata: TableColumnMetadata =
          this.model.getTableColumnMetadata(key);

        if (!tableColumnMetadata.modelType) {
          throw new BadDataException(
            "Select not supported on " +
              key +
              " of " +
              this.model.singularName +
              " because this column modelType is not found.",
          );
        }

        const relatedModel: BaseModel = new tableColumnMetadata.modelType();
        if (tableColumnMetadata.type === TableColumnType.EntityArray) {
          const tableColumns: Array<string> =
            relatedModel.getTableColumns().columns;
          const columnsToKeep: Array<string> = Object.keys(
            (findBy.select as any)[key],
          );

          for (const item of items) {
            if (item[key] && Array.isArray(item[key])) {
              const relatedArray: Array<BaseModel> = item[key] as any;
              const newArray: Array<BaseModel> = [];
              // now we need to sanitize data.

              for (const relatedArrayItem of relatedArray) {
                for (const column of tableColumns) {
                  if (!columnsToKeep.includes(column)) {
                    (relatedArrayItem as any)[column] = undefined;
                  }
                }
                newArray.push(relatedArrayItem);
              }

              (item[key] as any) = newArray;
            }
          }
        }
      }
    }

    return items;
  }

  @CaptureSpan()
  public async findOneBy(
    findOneBy: FindOneBy<TBaseModel>,
  ): Promise<TBaseModel | null> {
    const findBy: FindBy<TBaseModel> = findOneBy as FindBy<TBaseModel>;
    findBy.limit = new PositiveNumber(1);
    findBy.skip = new PositiveNumber(0);

    const documents: Array<TBaseModel> = await this._findBy(findBy);

    if (documents && documents[0]) {
      return documents[0];
    }
    return null;
  }

  @CaptureSpan()
  public async findOneById(
    findOneById: FindOneByID<TBaseModel>,
  ): Promise<TBaseModel | null> {
    if (!findOneById.id) {
      throw new BadDataException("findOneById.id is required");
    }

    return await this.findOneBy({
      query: {
        _id: findOneById.id.toString() as any,
      },
      select: findOneById.select || {},
      props: findOneById.props,
    });
  }

  /*
   * Update `data` may arrive as a full model instance rather than a plain
   * partial — the QueryDeepPartialEntity type structurally admits both, and
   * callers do construct `new Model()` payloads. A model instance carries
   * non-column own properties from DatabaseBaseModel (every column
   * initializer plus `isPermissionIf = {}`), and _updateBy turns every data
   * key into a select column for its internal find, so the extra keys made
   * that find throw `TableColumnMetadata not found for isPermissionIf
   * column` and fail the whole update. Strip a model instance down to its
   * set table columns; plain objects pass through untouched so a typo'd
   * column name in a literal still fails loudly instead of being silently
   * dropped.
   *
   * `_id`, `createdAt`, `updatedAt` and `version` are dropped for model
   * instances the same way BaseAPI drops them from client payloads: the row
   * is located by the update query (spreading a foreign `_id` into the save
   * payload would redirect the write), timestamps are database-managed, and
   * `version` is TypeORM's optimistic-concurrency counter.
   */
  public sanitizeUpdateData(
    data: UpdateBy<TBaseModel>["data"],
  ): UpdateBy<TBaseModel>["data"] {
    if (!(data instanceof BaseModel)) {
      return data;
    }

    const plainData: JSONObject = {};

    for (const key of Object.keys(data)) {
      if (!this.model.isTableColumn(key)) {
        continue;
      }

      if (
        key === "_id" ||
        key === "createdAt" ||
        key === "updatedAt" ||
        key === "version"
      ) {
        continue;
      }

      const value: JSONValue = (data as any)[key];

      // Unset columns must not become writes (or select columns).
      if (value === undefined) {
        continue;
      }

      plainData[key] = value;
    }

    return plainData as UpdateBy<TBaseModel>["data"];
  }

  private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {
    try {
      this.setTelemetryContextFromProps(updateBy.props);

      // A model becomes the columns it writes before anything judges it.
      updateBy.data = this.sanitizeUpdateData(updateBy.data);

      updateBy.props = await this.checkCallerBeforeHooks(
        updateBy.props,
        DatabaseRequestType.Update,
        updateBy.data,
      );

      // Query operators are for queries, not for write payloads. See the helper.
      this.rejectQueryOperatorsInData(updateBy.data);

      /*
       * Defense in depth for the tenant confused-deputy on the update path.
       * Unlike create(), _updateBy() never re-stamps the tenant scalar, and a
       * tenant relation object would likewise override the scalar join column
       * on the UPDATE. Today the tenant columns carry `update: []` so the
       * column-permission check rejects them first, but that is incidental —
       * this keeps the row's tenant immutable even if a model ever grants
       * update on the tenant relation. Runs before the permission check so the
       * ACL stays a redundant second line rather than the only one.
       */
      this.enforceTenantRelationMatchesScalar(updateBy.data, updateBy.props);

      this.unwrapHashedStringsForUnhashedColumns(updateBy.data);

      // Who did something to the record is OneUptime's to say. See the helpers.
      this.assertUpdateChangesSomething(
        this.decideUserAttributionOnUpdate(updateBy.data, updateBy.props),
        updateBy.data,
      );

      // One reference, one value, whichever name it is sent under. See the helper.
      this.assertRelationNamesAgree(updateBy.data, updateBy.props);

      // Only the rows the caller may update reach the hook. See the helper.
      if (
        !(await this.keepRowsCallerMayWrite(
          updateBy,
          DatabaseRequestType.Update,
        ))
      ) {
        return 0;
      }

      const onUpdate: OnUpdate<TBaseModel> = updateBy.props.ignoreHooks
        ? { updateBy, carryForward: [] }
        : await this.onBeforeUpdate(updateBy);

      // Encrypt data
      updateBy.data = (await this.encrypt(
        updateBy.data,
      )) as PartialEntity<TBaseModel>;

      const beforeUpdateBy: UpdateBy<TBaseModel> = onUpdate.updateBy;
      const carryForward: any = onUpdate.carryForward;

      beforeUpdateBy.query = this.getRuleCriteriaEffectiveEnabledQuery(
        beforeUpdateBy.query,
      );

      beforeUpdateBy.query = await ModelPermission.checkUpdateQueryPermissions(
        this.modelType,
        beforeUpdateBy.query,
        beforeUpdateBy.data,
        beforeUpdateBy.props,
      );

      // A service's own words for a clash, now the caller may make the write.
      if (!updateBy.props.ignoreHooks) {
        await this.onBeforeUpdateUniqueCheck(beforeUpdateBy);
        await this.onUpdatePermitted(beforeUpdateBy);
      }

      const data: PartialEntity<TBaseModel> =
        (await this.sanitizeCreateOrUpdate(
          beforeUpdateBy.data,
          updateBy.props,
          true,
        )) as PartialEntity<TBaseModel>;

      // Who archived or resolved it, and when, from the switch it turns.
      const switchStamps: Array<SwitchStamp> = this.stampSwitchAttribution(
        data,
        updateBy.props,
      );

      if (!(updateBy.skip instanceof PositiveNumber)) {
        updateBy.skip = new PositiveNumber(updateBy.skip);
      }

      if (!(updateBy.limit instanceof PositiveNumber)) {
        updateBy.limit = new PositiveNumber(updateBy.limit);
      }

      const dataColumns: [string, boolean][] = [];
      const dataKeys: string[] = Object.keys(data);

      /*
       * An update that carries no columns writes nothing, yet it would still
       * match rows - so returning the matched count reported a write that
       * never happened. Treat it like a query that matched nothing instead.
       */
      const hasColumnsToUpdate: boolean = dataKeys.length > 0;

      for (const key of dataKeys) {
        dataColumns.push([key, true]);
      }
      /*
       * Select the `_id` column and the columns in `data`.
       * `_id` is used for locating database records for updates, and `data`
       * columns are used for checking if the update causes a change in values.
       */
      const selectColumns: Select<TBaseModel> = {
        _id: true,
        ...Object.fromEntries(dataColumns),
      };

      if (
        this.model instanceof RelationOnlyRuleBaseModel &&
        typeof (data as Record<string, unknown>)["isEnabled"] === "boolean" &&
        (data as Record<string, unknown>)["criteria"] === undefined
      ) {
        (selectColumns as Record<string, unknown>)["criteria"] = true;
      }

      if (this.getModel().getTenantColumn()) {
        (selectColumns as any)[this.getModel().getTenantColumn()!.toString()] =
          true;
      }

      if (this.getModel().enableAuditLogOn?.update) {
        this.addAuditLogColumnsToUpdateSelect(selectColumns, dataKeys);
      }

      /*
       * What each row shows to everyone before the write - all of it, not
       * only the columns written - to tell what it starts and stops
       * showing. See PublishedImages.
       */
      const publishedColumns: Array<string> = PublishedImages.isWrittenBy(
        this.model.tableName,
        dataKeys,
      )
        ? PublishedImages.getColumns(this.model.tableName)
        : [];

      for (const column of publishedColumns) {
        (selectColumns as Dictionary<unknown>)[column] = true;
      }

      /*
       * The columns the database works out in each row's own write, and
       * what that write hands back of the row as it stored it: those
       * columns, and what the row shows to everyone. See getRowWriteSql.
       */
      const rowWriteSql: Dictionary<string> = updateBy.props.ignoreHooks
        ? {}
        : this.getRowWriteSql(data);

      const rowWriteSqlColumns: Array<string> = Object.keys(rowWriteSql).filter(
        (column: string): boolean => {
          return dataKeys.includes(column);
        },
      );

      const returnedColumns: Array<string> = Array.from(
        new Set<string>([...rowWriteSqlColumns, ...publishedColumns]),
      );

      /*
       * A drag-ordered list needs each row's place and list as they were
       * BEFORE this write, to move it from there afterwards.
       */
      const listOrderSettings: ListOrderSettings | null =
        this.getListOrderSettingsTouchedBy(dataKeys);

      if (listOrderSettings) {
        this.addListOrderColumnsToSelect(
          selectColumns as Dictionary<unknown>,
          listOrderSettings,
        );
      }

      const items: Array<TBaseModel> = hasColumnsToUpdate
        ? await this._findBy({
            query: beforeUpdateBy.query,
            skip: updateBy.skip.toNumber(),
            limit: updateBy.limit.toNumber(),
            select: selectColumns,
            props: { isRoot: true, ignoreHooks: true },
          })
        : [];

      /*
       * Only each record's own files, checked on the very rows this write
       * is about to write, as they are before it. See the helper.
       */
      await FileOwnership.assertOwned(
        this.getFileReferenceChecksOnUpdate({ data: data, rows: items }),
      );

      /*
       * save() has upsert semantics: if the located row is hard-deleted by a
       * concurrent request between the _findBy above and the write below,
       * save() INSERTs a resurrected "zombie" row carrying only the update's
       * columns. Zombies with enough NOT NULL columns persist and then hold
       * foreign keys forever (e.g. a probe status-update racing a monitor
       * delete resurrected the Monitor and permanently blocked deleting the
       * MonitorStatus it referenced). Updates therefore go through
       * repository.update(), which never inserts and simply affects zero
       * rows when the target is gone.
       *
       * Only EntityArray (many-to-many) columns still need save(), because
       * their junction rows cannot be written by a plain UPDATE. Entity
       * (many-to-one) columns must NOT route to save(): they are ordinary
       * foreign-key columns on this same table, and TypeORM's update()
       * resolves a relation property to its join columns
       * (EntityMetadata.findColumnsWithPropertyPath). Routing them to save()
       * left the resurrection hole open for any caller that expressed the
       * write as the relation member rather than the scalar id — e.g.
       * Monitor.currentMonitorStatus vs Monitor.currentMonitorStatusId,
       * which are two decorated members over the SAME physical column.
       */
      const relationColumnNames: Set<string> = new Set<string>(
        this.getModel()
          .getTableColumns()
          .columns.filter((column: string) => {
            const metadata: TableColumnMetadata | undefined =
              this.getModel().getTableColumnMetadata(column);
            return metadata?.type === TableColumnType.EntityArray;
          }),
      );
      const hasRelationUpdates: boolean = dataKeys.some((key: string) => {
        return relationColumnNames.has(key);
      });

      /*
       * Rows the write actually touched. A row hard-deleted between the find
       * above and the write is reported by update() as zero rows affected;
       * it must not fire success hooks (they re-read the row and would
       * dereference null) nor be counted as updated.
       */
      const affectedItems: Array<TBaseModel> = [];

      /*
       * A query that names the row's version is a compare-and-set: the row
       * is written only while it still holds that version. The find above is
       * a statement of its own, so the UPDATE asks again - a write landing
       * between the two would otherwise be overwritten by values computed
       * from what the row held before it. The workflow Update steps merge
       * custom fields this way (CustomFieldsArgument). Rows written through
       * save(), for a many-to-many column, are not guarded.
       */
      const expectedVersion: unknown = (
        beforeUpdateBy.query as Dictionary<unknown>
      )["version"];

      /*
       * The per-item debug payload below is a pretty-printed JSON.stringify
       * of every matched row; skip building it entirely unless the log level
       * is DEBUG, since logger.debug() no-ops at any other level.
       */
      const isDebugLogEnabled: boolean =
        logger.getLogLevel() === ConfigLogLevel.DEBUG;

      /*
       * Each affected row as its own write left it, in the order of
       * affectedItems: what the write handed back (returnedColumns), for
       * PublishedImages to decide the row's images by.
       */
      const rowsAsWritten: Array<Record<string, unknown>> = [];

      // The expressions the database works the columns out by. See getRowWriteSql.
      const rowWriteSqlValues: Dictionary<() => string> =
        this.toRowWriteSqlValues(rowWriteSql, rowWriteSqlColumns);

      for (const item of items) {
        /*
         * _id must be set AFTER the spread: update data can carry an
         * explicit `_id: undefined` (sanitizeUpdateData strips it from model
         * instances, but a plain object can still hold it), and spreading it
         * after _id would clobber the located row's id — save() then sees no
         * primary key, INSERTs instead of updating, and dies on the first
         * NOT NULL column.
         */
        const dataForItem: PartialEntity<TBaseModel> = {
          ...data,
        };

        // Only a row whose switch really turns takes its stamps. See the helper.
        const keptSwitchColumns: Array<string> =
          this.keepSwitchAttributionOfUnturnedRow(
            dataForItem,
            item,
            switchStamps,
          );

        /*
         * What this row is written with, for the workflow and the audit log.
         * A column the database works out (getRowWriteSql) is recorded as
         * it stored it, once the write hands it back.
         */
        const writtenData: PartialEntity<TBaseModel> = {
          ...data,
        };

        for (const column of keptSwitchColumns) {
          delete (writtenData as Record<string, unknown>)[column];
        }

        if (
          this.model instanceof RelationOnlyRuleBaseModel &&
          (data as Record<string, unknown>)["criteria"] === undefined &&
          typeof (data as Record<string, unknown>)["isEnabled"] === "boolean" &&
          (item as unknown as RelationOnlyRuleBaseModel).criteria !==
            undefined &&
          (item as unknown as RelationOnlyRuleBaseModel).criteria !== null
        ) {
          const logicalEnabled: boolean = (data as Record<string, unknown>)[
            "isEnabled"
          ] as boolean;
          const existingCriteria: RuleCriteria = (
            item as unknown as RelationOnlyRuleBaseModel
          ).criteria!;

          /*
           * Keep the transport shadow synchronized with the physical state.
           * Otherwise a later criteria edit that round-trips this JSON without
           * a top-level isEnabled value can restore a stale enabled state.
           */
          (dataForItem as Record<string, unknown>)["criteria"] = {
            ...existingCriteria,
            isEnabled: logicalEnabled,
          };
          (dataForItem as Record<string, unknown>)["isEnabled"] = logicalEnabled
            ? null
            : false;
        }

        const updatedItem: any = {
          ...dataForItem,
          _id: item._id!,
        } as any;
        const updatedItemForComparison: any = { ...updatedItem };
        const updateCriteriaValue: unknown = (data as Record<string, unknown>)[
          "criteria"
        ];
        const existingCriteriaValue: unknown = (
          item as unknown as RelationOnlyRuleBaseModel
        ).criteria;
        const isCriteriaBackedComparison: boolean =
          (updateCriteriaValue !== undefined && updateCriteriaValue !== null) ||
          (updateCriteriaValue === undefined &&
            existingCriteriaValue !== undefined &&
            existingCriteriaValue !== null);

        if (
          this.model instanceof RelationOnlyRuleBaseModel &&
          typeof (data as Record<string, unknown>)["isEnabled"] === "boolean" &&
          isCriteriaBackedComparison
        ) {
          updatedItemForComparison.isEnabled = (
            data as Record<string, unknown>
          )["isEnabled"];
        }

        if (isDebugLogEnabled) {
          logger.debug("Updated Item", {
            projectId: updateBy.props.tenantId?.toString(),
          } as LogAttributes);
          logger.debug(JSON.stringify(updatedItem, null, 2), {
            projectId: updateBy.props.tenantId?.toString(),
          } as LogAttributes);
        }

        // The row as its write stored it, where the write handed it back.
        let storedByWrite: Record<string, unknown> | undefined = undefined;

        if (hasRelationUpdates) {
          /*
           * save() writes values, never an expression: the columns the
           * database works out are left out of it and written by a
           * statement of their own, which decides them on the row as it is
           * then, under its lock, and hands them back. save() never writes
           * Private alongside them (a write of Private decides both switches
           * itself: StatusPageVisibility.normalizeWrite), so nothing stored
           * between the two statements is both private and visible.
           */
          const savedItem: any = { ...updatedItem };

          for (const column of rowWriteSqlColumns) {
            delete savedItem[column];
          }

          await this.getRepository().save(savedItem);

          if (rowWriteSqlColumns.length > 0) {
            storedByWrite = this.readRowReturnedByWrite(
              await this.getRepository().update(
                { _id: item._id! } as any,
                {
                  ...rowWriteSqlValues,
                  /*
                   * save() moved the version on already; update() moves it
                   * again unless it is written, so it is written as it is.
                   */
                  version: () => {
                    return '"version"';
                  },
                } as any,
                { returning: returnedColumns },
              ),
              returnedColumns,
            );
          } else if (returnedColumns.length > 0) {
            /*
             * Nothing to work out, but what the row shows to everyone is
             * still decided by what it holds once written - read back right
             * after save(), never the read made before it.
             */
            storedByWrite =
              (await this.readStoredColumns(item, returnedColumns)) ||
              undefined;
          }
        } else {
          const { _id, ...updateData } = updatedItem;
          /*
           * The row, at the version the query named, if it named one (see
           * expectedVersion above).
           */
          const criteria: any = {
            _id: _id,
            ...(typeof expectedVersion === "number"
              ? { version: expectedVersion }
              : {}),
          };

          const values: any = {
            ...updateData,
            // Never the update's own value: see getRowWriteSql.
            ...rowWriteSqlValues,
            /*
             * save() bumps the @VersionColumn automatically; update() does
             * not, so emulate it to keep the audit counter behaviour
             * identical.
             */
            version: () => {
              return '"version" + 1';
            },
          };

          const updateResult: UpdateResult =
            returnedColumns.length > 0
              ? await this.getRepository().update(criteria, values, {
                  returning: returnedColumns,
                })
              : await this.getRepository().update(criteria, values);

          /*
           * The row was hard-deleted between the find above and this write,
           * or moved past the version the query named. Nothing was updated,
           * so skip the success hooks for it: they re-read the row and would
           * dereference null (and would report a change that never happened).
           */
          if (updateResult.affected === 0) {
            continue;
          }

          if (returnedColumns.length > 0) {
            storedByWrite = this.readRowReturnedByWrite(
              updateResult,
              returnedColumns,
            );
          }
        }

        /*
         * A column the database worked out is recorded as it stored it - in
         * the workflow trigger, the realtime event and the audit log entry,
         * and in what decides whether anything changed. One it did not hand
         * back is not claimed at all: never as the update asked for it.
         */
        const rowAsWritten: Record<string, unknown> = {
          ...(storedByWrite || {}),
        };

        for (const column of rowWriteSqlColumns) {
          const storedValue: unknown = storedByWrite?.[column];

          if (storedValue === undefined) {
            delete (writtenData as Record<string, unknown>)[column];
            delete updatedItemForComparison[column];
            // Not known, so never taken as on. See PublishedImages.
            rowAsWritten[column] = null;
            continue;
          }

          (writtenData as Record<string, unknown>)[column] = storedValue;
          updatedItemForComparison[column] = storedValue;
        }

        affectedItems.push(item);
        rowsAsWritten.push(rowAsWritten);

        // hit workflow.
        if (
          this.getModel().enableWorkflowOn?.update &&
          // Only trigger workflow if there's a change in values
          !this.hasSameValues({ item, updatedItem: updatedItemForComparison })
        ) {
          let tenantId: ObjectID | undefined = updateBy.props.tenantId;

          if (!tenantId && this.getModel().getTenantColumn()) {
            tenantId = item.getValue<ObjectID>(
              this.getModel().getTenantColumn()!,
            );
          }

          if (tenantId) {
            await this.onTriggerWorkflow(item.id!, tenantId, "on-update", {
              updatedFields: JSONFunctions.serialize(writtenData as JSONObject),
            });

            await this.onTriggerRealtime(
              item.id!,
              tenantId,
              ModelEventType.Update,
            );
          }
        }

        if (
          this.getModel().enableAuditLogOn?.update &&
          !this.hasSameValues({
            item,
            updatedItem: updatedItemForComparison,
          }) &&
          item.id
        ) {
          const auditLogService: typeof AuditLogServiceType =
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
            require("./AuditLogService").default;
          await auditLogService.recordUpdate({
            model: this.getModel(),
            before: item,
            updatedFields: writtenData as JSONObject,
            itemId: item.id,
            props: updateBy.props,
          });
        }
      }

      /*
       * Cant Update relations.
       * https://github.com/typeorm/typeorm/issues/2821
       */

      /*
       * const numberOfDocsAffected: number =
       *     (
       *         await this.getRepository().update(
       *             query as any,
       *             data
       *         )
       *     ).affected || 0;
       */

      /*
       * The images each row shows to everyone now are public, and those it
       * stopped showing private, unless another record still shows them -
       * decided on each row as its own write stored it. Before
       * onUpdateSuccess, so nothing a hook sends links to an image that is
       * not public yet. See PublishedImages.
       */
      await PublishedImages.afterUpdate({
        tableName: this.model.tableName,
        rowsBefore: affectedItems,
        written: data,
        rowsAfter: rowsAsWritten,
      });

      /*
       * A status page that showed one of these records stops showing it at
       * once, not when its cached overview runs out. See the helper.
       */
      await StatusPageOverviewCache.afterUpdate({
        tableName: this.model.tableName,
        rows: affectedItems,
        written: data,
      });

      /*
       * Before onUpdateSuccess, so a service hook that reads the list (an
       * escalation order, a roster) sees it in its new order.
       */
      if (listOrderSettings) {
        await this.placeUpdatedRowsInListOrder({
          settings: listOrderSettings,
          rowsBeforeUpdate: affectedItems,
          data: data,
        });
      }

      /*
       * onUpdateSuccess fires whenever onBeforeUpdate did - even when nothing
       * matched, which subclasses rely on - but it is handed only the rows
       * the write actually affected, so a row deleted mid-update never
       * appears as a phantom id that hooks would then fail to re-read. (For a
       * caller who may write none of the rows a write names, neither hook
       * runs: see keepRowsCallerMayWrite.)
       */
      if (!updateBy.props.ignoreHooks) {
        await this.onUpdateSuccess(
          { updateBy, carryForward },
          affectedItems.map((i: TBaseModel) => {
            return new ObjectID(i._id!);
          }),
        );
      }

      return affectedItems.length;
    } catch (error) {
      await this.onUpdateError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  /*
   * The `before` row an update loads is sparse on purpose - the columns the
   * write touches, plus `_id` and the tenant column - so everything
   * AuditLogService reads off it has to be requested here:
   *   - the resource's display name, even when the update does not touch it;
   *   - the parent id a child's entries roll up to (rootResource);
   *   - the id of the row that names a nameless row (resourceNameRelation);
   *   - the related rows' names for relation columns the write touches, so
   *     the diff reads "Production -> Staging" rather than as two ids. A
   *     relation selected as `true` loads only `_id`.
   */
  private addAuditLogColumnsToUpdateSelect(
    select: Select<TBaseModel>,
    dataKeys: Array<string>,
  ): void {
    const model: TBaseModel = this.getModel();
    const auditLogOn: EnableAuditLogOn | undefined = model.enableAuditLogOn;
    const selectRecord: Record<string, unknown> = select as unknown as Record<
      string,
      unknown
    >;

    for (const candidate of ["name", "title", "displayName"]) {
      if (model.isTableColumn(candidate)) {
        selectRecord[candidate] = true;
      }
    }

    const rootColumn: string | undefined = auditLogOn?.rootResource?.column;

    if (rootColumn && model.isTableColumn(rootColumn)) {
      selectRecord[rootColumn] = true;
    }

    const nameRelation: string | undefined = auditLogOn?.resourceNameRelation;

    if (nameRelation && model.isTableColumn(nameRelation)) {
      const nameRelationIdColumn: string | undefined =
        model.getTableColumnMetadata(nameRelation)?.manyToOneRelationColumn;

      if (nameRelationIdColumn && model.isTableColumn(nameRelationIdColumn)) {
        selectRecord[nameRelationIdColumn] = true;
      }
    }

    for (const key of dataKeys) {
      if (!model.isTableColumn(key)) {
        continue;
      }

      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(key);

      if (
        !metadata?.modelType ||
        (metadata.type !== TableColumnType.EntityArray &&
          metadata.type !== TableColumnType.Entity)
      ) {
        continue;
      }

      selectRecord[key] = new metadata.modelType().isTableColumn("name")
        ? { _id: true, name: true }
        : { _id: true };
    }
  }

  private hasSameValues(data: { item: TBaseModel; updatedItem: any }): boolean {
    const { item, updatedItem } = data;
    const columns: string[] = Object.keys(updatedItem);
    for (const column of columns) {
      const currentValue: unknown = item.getColumnValue(column);
      const updatedValue: unknown = updatedItem[column];
      const columnType: TableColumnType | undefined =
        item.getTableColumnMetadata(column)?.type;
      const isJSONColumn: boolean = columnType === TableColumnType.JSON;

      /*
       * A relation value is a model instance (or an array of them), and those
       * stringify as "[object Object]" too - so swapping a resource's labels
       * A,B for C,D compared as unchanged, and the update fired neither its
       * workflow nor its audit entry. Compare the referenced ids, as sets:
       * the order a relation comes back in means nothing. When either side
       * has no ids to compare (the relation was not loaded, or holds something
       * that is not a reference), fall through to the comparison below.
       */
      if (
        columnType === TableColumnType.EntityArray ||
        columnType === TableColumnType.Entity
      ) {
        const sameRelationIds: boolean | null =
          RelationValueUtil.haveSameRelationIds(currentValue, updatedValue);

        if (sameRelationIds === false) {
          return false;
        }

        if (sameRelationIds === true) {
          continue;
        }
      }

      /*
       * Plain JSON objects all stringify through Object.toString as
       * "[object Object]". Compare their contents instead, while ignoring
       * insignificant object-key ordering.
       */
      if (
        isJSONColumn &&
        !JSONFunctions.deepEqual(currentValue, updatedValue)
      ) {
        return false;
      }

      if (
        !isJSONColumn &&
        /*
         * `toString()` is necessary so we can compare wrapped values
         * (e.g. `ObjectID`) with raw values (e.g. `string`)
         */
        currentValue?.toString() !== updatedValue?.toString()
      ) {
        return false;
      }
    }
    return true;
  }

  @CaptureSpan()
  public async updateOneBy(
    updateOneBy: UpdateOneBy<TBaseModel>,
  ): Promise<number> {
    return await this._updateBy({ ...updateOneBy, limit: 1, skip: 0 });
  }

  @CaptureSpan()
  public async updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {
    return await this._updateBy(updateBy);
  }

  /*
   * Returns how many rows the update actually matched. Callers that need to
   * tell "saved" apart from "matched nothing" must check it: the permission
   * layer narrows the query after the caller builds it (tenant scope, access
   * control labels, owned scope), so an update can legitimately reach here
   * and write nothing at all.
   */
  @CaptureSpan()
  public async updateOneById(
    updateById: UpdateByID<TBaseModel>,
  ): Promise<number> {
    if (!updateById.id) {
      throw new BadDataException("updateById.id is required");
    }

    await ModelPermission.checkUpdatePermissionByModel({
      modelType: this.modelType,
      fetchModelWithAccessControlIds: async () => {
        return await this.findWithAccessControlIds(updateById.id);
      },
      props: updateById.props,
      /*
       * Below the table's update plan, a switch-off still passes: judged on
       * the columns the update writes, as _updateBy judges it.
       */
      updateData: this.sanitizeUpdateData(updateById.data),
    });

    return await this.updateOneBy({
      query: {
        _id: updateById.id.toString() as any,
      },
      data: updateById.data as any,
      miscDataProps: updateById.miscDataProps,
      props: updateById.props,
    });
  }

  /*
   * A row with every one of its access-control labels, read as root: the
   * team block list is checked against all of them, not only the ones the
   * caller may see.
   */
  private async findWithAccessControlIds(
    id: ObjectID,
  ): Promise<TBaseModel | null> {
    const selectModel: Select<TBaseModel> = {};
    const accessControlColumn: string | null =
      this.getModel().getAccessControlColumn();

    if (accessControlColumn) {
      (selectModel as any)[accessControlColumn] = {
        _id: true,
        name: true,
      };
    }

    return await this.findOneById({
      id: id,
      select: selectModel,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The row `id`, read as root with `select`, when `props` may update it -
   * or null when it does not exist, or is outside what the caller may
   * update. For a custom route whose side effect only somebody who could
   * edit the row may cause (an action that changes it as root).
   *
   * Asked the way an update asks it: updateOneById's checks on the row (the
   * team block list against all of its labels, the table's update
   * permissions), then the query an update is narrowed to
   * (ModelPermission.getUpdatableQuery: the caller's project, labels and
   * Owned scope, and the labels of the record a table is read through). A
   * credential that may only read is refused. Throws what the update would
   * throw when the caller may not update this table at all.
   */
  @CaptureSpan()
  public async findOneUpdatableById(data: {
    id: ObjectID;
    select: Select<TBaseModel>;
    props: DatabaseCommonInteractionProps;
  }): Promise<TBaseModel | null> {
    // Set when the block list asked for the row and it was not there.
    const lookup: { isMissing: boolean } = { isMissing: false };

    try {
      await ModelPermission.checkUpdatePermissionByModel({
        modelType: this.modelType,
        fetchModelWithAccessControlIds:
          async (): Promise<TBaseModel | null> => {
            const row: TBaseModel | null = await this.findWithAccessControlIds(
              data.id,
            );

            lookup.isMissing = !row;

            return row;
          },
        props: data.props,
      });
    } catch (error) {
      if (lookup.isMissing && error instanceof BadDataException) {
        return null;
      }

      throw error;
    }

    const updatableQuery: Query<TBaseModel> =
      await ModelPermission.getUpdatableQuery(
        this.modelType,
        {
          _id: data.id.toString(),
        } as Query<TBaseModel>,
        data.props,
      );

    return await this.findOneBy({
      query: updatableQuery,
      select: data.select,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async updateOneByIdAndFetch(
    updateById: UpdateByIDAndFetch<TBaseModel>,
  ): Promise<TBaseModel | null> {
    await this.updateOneById(updateById);
    return this.findOneById({
      id: updateById.id,
      select: updateById.select,
      props: updateById.props,
    });
  }

  /*
   * Fast, side-effect-free single-statement column update by id.
   *
   * `updateOneById` is heavy: an access-control pre-check SELECT, then
   * `_updateBy` (a `_findBy` SELECT to load the row, `getRepository().save()`,
   * then workflow / realtime / audit-log hooks). That is several round
   * trips, each holding the row's write lock and pinning a pool connection.
   * On a hot row written on every ingest batch — e.g. a telemetry
   * liveness/heartbeat timestamp — that pipeline becomes the head of a
   * Postgres lock convoy: one slow writer (or a save() transaction left open
   * across other async work) blocks every other writer of the same row, and
   * the waiters each pin a pool connection until the whole pool is starved.
   *
   * This issues exactly ONE auto-committed UPDATE (raw parameterized SQL).
   * The row's write lock is held only for that statement, so the write can
   * never head a convoy and never spans other async work. It deliberately
   * runs NO hooks, workflow triggers, realtime events, audit-log writes, or
   * access-control checks, and does NOT bump the optimistic-lock `version`
   * column. (We can't use the entity-aware QueryBuilder for the
   * no-version-bump part: TypeORM resolves even a table-name string back to
   * the entity metadata, whose UpdateQueryBuilder branch always appends
   * `version = version + 1`.) `updatedAt` is refreshed to preserve the
   * behaviour of the normal update path.
   *
   * Column and table identifiers are taken from entity metadata (never from
   * the caller), and every value is bound as a parameter, so this is not an
   * injection surface. Use ONLY for trusted, internal, side-effect-free
   * column writes where the full pipeline is pure overhead.
   *
   * Oversized strings are CLAMPED here (truncateStringColumnsToMaxLength)
   * rather than rejected. Skipping the hooks also skips
   * checkMaxLengthOfFields, so before this an over-long value reached
   * Postgres raw and failed the ENTIRE statement — including whatever else
   * rode along with it. On the telemetry liveness writes that is fatal: one
   * over-long OpenTelemetry resource attribute took `lastSeenAt` down with
   * it and markDisconnected* stranded a healthy resource as "disconnected"
   * 15 minutes later while its data kept arriving (issue #3006). Clamping
   * in here, at the choke point, is what makes that unforgettable — every
   * caller of this path gets it, including ones not written yet.
   */
  @CaptureSpan()
  public async updateColumnsByIdWithoutHooks(input: {
    id: ObjectID;
    data: PartialEntity<TBaseModel>;
    /*
     * Optional compare-and-set guard. Every supplied property is added to
     * the WHERE clause with null-safe equality, so the update is skipped if
     * another writer changed the row after the caller read it. Password-hash
     * upgrades use this to avoid overwriting a concurrently changed
     * credential with a re-hash of the old password.
     */
    expectedData?: PartialEntity<TBaseModel>;
    /*
     * Leave `updatedAt` untouched. For passive bookkeeping writes (liveness
     * timestamps, ingest health markers) where consumers key change
     * detection off updatedAt - e.g. the session replay configEpoch - a
     * refreshed updateDate would broadcast "configuration changed" on every
     * heartbeat.
     */
    skipUpdateDateColumn?: boolean;
  }): Promise<void> {
    const statement: ColumnsByIdUpdateStatement | null =
      this.buildColumnsByIdUpdateStatement(
        input,
        "updateColumnsByIdWithoutHooks",
      );

    if (!statement) {
      return;
    }

    const sql: string = `UPDATE "${statement.tableName}" SET ${statement.setSql} WHERE ${statement.whereSql}`;

    await this.getRepository().manager.query(sql, statement.params);
  }

  /*
   * The same single-statement, hook-free, no-version-bump write as
   * `updateColumnsByIdWithoutHooks` with its `expectedData` guard, which
   * also says whether it happened: true when the row matched every expected
   * value and was written, false when another writer had changed it first
   * (or it no longer exists).
   *
   * This is what lets two workers race for one row and have exactly one of
   * them win - a job claiming a Pending notification by moving it to
   * InProgress, say, where both would otherwise send it. The check and the
   * write are one statement, so there is no window between them.
   *
   * The UPDATE sits in a CTE so the statement is a SELECT of the rows it
   * wrote (see updateColumnsByIdIfUnlockedWithoutHooks for why a bare
   * UPDATE ... RETURNING cannot tell the two cases apart through TypeORM).
   */
  @CaptureSpan()
  public async compareAndSetColumnsByIdWithoutHooks(input: {
    id: ObjectID;
    data: PartialEntity<TBaseModel>;
    expectedData: PartialEntity<TBaseModel>;
    skipUpdateDateColumn?: boolean;
  }): Promise<boolean> {
    const statement: ColumnsByIdUpdateStatement | null =
      this.buildColumnsByIdUpdateStatement(
        input,
        "compareAndSetColumnsByIdWithoutHooks",
      );

    if (!statement) {
      return false;
    }

    const sql: string = `WITH "updated" AS (UPDATE "${statement.tableName}" SET ${statement.setSql} WHERE ${statement.whereSql} RETURNING "${statement.primaryColumnName}") SELECT "${statement.primaryColumnName}" FROM "updated"`;

    const result: unknown = await this.getRepository().manager.query(
      sql,
      statement.params,
    );

    return Array.isArray(result) && result.length > 0;
  }

  /*
   * The SET and WHERE clauses of a hook-free write to one row by id, with
   * every value bound as a parameter. Null when there is nothing to set.
   * `methodName` is the public method the errors are reported under.
   */
  private buildColumnsByIdUpdateStatement(
    input: {
      id: ObjectID;
      data: PartialEntity<TBaseModel>;
      expectedData?: PartialEntity<TBaseModel> | undefined;
      skipUpdateDateColumn?: boolean | undefined;
    },
    methodName: string,
  ): ColumnsByIdUpdateStatement | null {
    if (!input.id) {
      throw new BadDataException("id is required");
    }

    const repository: Repository<TBaseModel> = this.getRepository();
    const metadata: EntityMetadata = repository.metadata;
    const driver: Driver = repository.manager.connection.driver;

    const setClauses: Array<string> = [];
    const params: Array<unknown> = [];

    /*
     * Clamp on a shallow COPY: callers must not have their own object
     * mutated behind their back (a liveness-only retry, for instance,
     * rebuilds its payload from the same source values).
     */
    const data: ObjectLiteral = this.truncateStringColumnsToMaxLength({
      ...(input.data as ObjectLiteral),
    });

    for (const [propertyName, value] of Object.entries(data)) {
      const column: ColumnMetadata | undefined =
        metadata.findColumnWithPropertyName(propertyName);
      if (!column) {
        throw new BadDataException(
          `${methodName}: unknown column "${propertyName}" on "${metadata.tableName}"`,
        );
      }
      /*
       * PartialEntity permits `() => string` SQL-expression values, but this
       * raw bind path can only parameterize literals (and the save()-based
       * updateOneById it replaces doesn't support expressions either). Fail
       * loudly rather than binding a function object.
       */
      if (typeof value === "function") {
        throw new BadDataException(
          `${methodName}: SQL-expression values are not supported (column "${propertyName}"); pass a literal value.`,
        );
      }
      /*
       * Run the value through the driver's persist path so column
       * transformers (e.g. ObjectID <-> uuid), JSON stringification, and
       * boolean/date coercion are applied exactly as getRepository().save()
       * would. Without this, the raw bind below would write an ObjectID
       * object (or a raw JS object) straight to Postgres.
       */
      params.push(driver.preparePersistentValue(value, column));
      setClauses.push(`"${column.databaseName}" = $${params.length}`);
    }

    if (setClauses.length === 0) {
      return null;
    }

    // The raw path has no entity machinery to touch updateDate — do it here.
    if (metadata.updateDateColumn && !input.skipUpdateDateColumn) {
      setClauses.push(
        `"${metadata.updateDateColumn.databaseName}" = CURRENT_TIMESTAMP`,
      );
    }

    const primaryColumnName: string =
      metadata.primaryColumns[0]?.databaseName || "_id";
    params.push(input.id.toString());

    const whereClauses: Array<string> = [
      `"${primaryColumnName}" = $${params.length}`,
    ];

    for (const [propertyName, value] of Object.entries(
      (input.expectedData || {}) as ObjectLiteral,
    )) {
      const column: ColumnMetadata | undefined =
        metadata.findColumnWithPropertyName(propertyName);

      if (!column) {
        throw new BadDataException(
          `${methodName}: unknown expected column "${propertyName}" on "${metadata.tableName}"`,
        );
      }

      if (typeof value === "function") {
        throw new BadDataException(
          `${methodName}: SQL-expression expected values are not supported (column "${propertyName}"); pass a literal value.`,
        );
      }

      params.push(driver.preparePersistentValue(value, column));
      whereClauses.push(
        `"${column.databaseName}" IS NOT DISTINCT FROM $${params.length}`,
      );
    }

    return {
      tableName: metadata.tableName,
      primaryColumnName: primaryColumnName,
      setSql: setClauses.join(", "),
      whereSql: whereClauses.join(" AND "),
      params: params,
    };
  }

  /*
   * Same single-statement, hook-free, no-version-bump write as
   * `updateColumnsByIdWithoutHooks`, except it YIELDS instead of queueing:
   * if another transaction already holds the row's lock, this write is
   * abandoned and the method returns false. It never waits.
   *
   * Why this exists. A single-statement UPDATE holds its row lock for a very
   * short time, but "short" does not mean "safe" once the arrival rate on ONE
   * row exceeds the service rate. Postgres queues lock waiters strictly, so
   * every waiter pins a backend for the sum of everyone ahead of it — the
   * classic convoy. In the outage this was written for, ~25K concurrent
   * ingest jobs across 100 worker pods funnelled onto ~2,300 Service rows and
   * produced 1,017 active connections with 892 of them parked on row locks;
   * the tail had been waiting 3.7 hours. Nothing about that is fixable by
   * making the statement faster, and no Postgres tier changes it: the queue
   * is the bug.
   *
   * `FOR UPDATE SKIP LOCKED` inverts it. A contended writer does zero work
   * and returns immediately, so the number of backends blocked on any single
   * row is capped at ONE no matter how many workers arrive together. The
   * convoy cannot form — and cannot form even if every upstream throttle
   * fails open at once (Redis down, fence bug, cache flush). That is the
   * point: this is the structural backstop underneath the throttles, not a
   * second copy of them.
   *
   * Use ONLY where losing the write is harmless because a concurrent writer
   * is writing the same thing — liveness timestamps and other idempotent
   * bookkeeping, whose contended value is by construction the value the
   * winner is already storing. It is the WRONG primitive for a write carrying
   * information the winner does not have (a changed attribute); for those the
   * caller must re-attempt, and `false` is the signal to do it. Returning a
   * boolean rather than swallowing the skip is deliberate: a silent drop here
   * would be indistinguishable from a successful write at the call site,
   * which is exactly how a "reliable" heartbeat quietly stops beating.
   *
   * Returns true when the row was updated, false when it was locked (or no
   * longer exists).
   */
  @CaptureSpan()
  public async updateColumnsByIdIfUnlockedWithoutHooks(input: {
    id: ObjectID;
    data: PartialEntity<TBaseModel>;
    skipUpdateDateColumn?: boolean;
  }): Promise<boolean> {
    if (!input.id) {
      throw new BadDataException("id is required");
    }

    const repository: Repository<TBaseModel> = this.getRepository();
    const metadata: EntityMetadata = repository.metadata;
    const driver: Driver = repository.manager.connection.driver;

    const setClauses: Array<string> = [];
    const params: Array<unknown> = [];

    // Clamp on a shallow COPY — see updateColumnsByIdWithoutHooks.
    const data: ObjectLiteral = this.truncateStringColumnsToMaxLength({
      ...(input.data as ObjectLiteral),
    });

    for (const [propertyName, value] of Object.entries(data)) {
      const column: ColumnMetadata | undefined =
        metadata.findColumnWithPropertyName(propertyName);
      if (!column) {
        throw new BadDataException(
          `updateColumnsByIdIfUnlockedWithoutHooks: unknown column "${propertyName}" on "${metadata.tableName}"`,
        );
      }
      if (typeof value === "function") {
        throw new BadDataException(
          `updateColumnsByIdIfUnlockedWithoutHooks: SQL-expression values are not supported (column "${propertyName}"); pass a literal value.`,
        );
      }
      params.push(driver.preparePersistentValue(value, column));
      setClauses.push(`"${column.databaseName}" = $${params.length}`);
    }

    if (setClauses.length === 0) {
      return false;
    }

    if (metadata.updateDateColumn && !input.skipUpdateDateColumn) {
      setClauses.push(
        `"${metadata.updateDateColumn.databaseName}" = CURRENT_TIMESTAMP`,
      );
    }

    const primaryColumnName: string =
      metadata.primaryColumns[0]?.databaseName || "_id";
    params.push(input.id.toString());

    /*
     * The lock is taken by the sub-SELECT and inherited by the UPDATE within
     * the same implicit transaction, so the outer write never blocks either.
     *
     * The UPDATE sits in a CTE so the statement is a SELECT of the rows it
     * wrote. TypeORM's postgres `query()` answers a top-level UPDATE with
     * `[rows, rowCount]` - an array of length 2 whether or not anything was
     * written - so a bare `UPDATE ... RETURNING` made every skipped write
     * read as applied. A SELECT comes back as its rows: one when the row
     * was written, none when it was locked or no longer exists.
     */
    const sql: string = `WITH "updated" AS (UPDATE "${
      metadata.tableName
    }" SET ${setClauses.join(", ")} WHERE "${primaryColumnName}" IN (SELECT "${
      primaryColumnName
    }" FROM "${metadata.tableName}" WHERE "${primaryColumnName}" = $${
      params.length
    } FOR UPDATE SKIP LOCKED) RETURNING "${primaryColumnName}") SELECT "${
      primaryColumnName
    }" FROM "updated"`;

    const result: unknown = await repository.manager.query(sql, params);

    return Array.isArray(result) && result.length > 0;
  }

  /*
   * Atomically add to numeric columns and set literal columns for one row,
   * in a SINGLE auto-committed UPDATE, with no hooks and no `version` bump.
   *
   * This is the counter-flush primitive. `updateColumnsByIdWithoutHooks`
   * can't express it (a read-modify-write would lose concurrent writers'
   * increments, and the value isn't known to the caller), and
   * `getRepository().increment()` can't either: it goes through
   * UpdateQueryBuilder, which always appends `version = version + 1`, so an
   * ingest-driven counter bump would fight the optimistic lock on a row a
   * human may be editing — and it can't set a second column in the same
   * statement.
   *
   * `COALESCE(col, 0)` so a NULL counter starts from zero rather than
   * staying NULL forever.
   *
   * Column and table identifiers come from entity metadata (never from the
   * caller) and every value is bound as a parameter, so this is not an
   * injection surface. Use ONLY for trusted, internal, side-effect-free
   * column writes.
   *
   * `set` values are clamped to their column widths for the same reason
   * updateColumnsByIdWithoutHooks clamps: this path also skips
   * checkMaxLengthOfFields, and an over-long string here would abort the
   * counter increments riding in the same statement.
   */
  @CaptureSpan()
  public async atomicAddToColumnsByIdWithoutHooks(input: {
    id: ObjectID;
    add: Partial<Record<keyof TBaseModel, number>>;
    set?: PartialEntity<TBaseModel> | undefined;
  }): Promise<void> {
    if (!input.id) {
      throw new BadDataException("id is required");
    }

    const repository: Repository<TBaseModel> = this.getRepository();
    const metadata: EntityMetadata = repository.metadata;
    const driver: Driver = repository.manager.connection.driver;

    const setClauses: Array<string> = [];
    const params: Array<unknown> = [];

    const columnFor: (propertyName: string) => ColumnMetadata = (
      propertyName: string,
    ): ColumnMetadata => {
      const column: ColumnMetadata | undefined =
        metadata.findColumnWithPropertyName(propertyName);
      if (!column) {
        throw new BadDataException(
          `atomicAddToColumnsByIdWithoutHooks: unknown column "${propertyName}" on "${metadata.tableName}"`,
        );
      }
      return column;
    };

    for (const [propertyName, delta] of Object.entries(
      input.add as ObjectLiteral,
    )) {
      if (typeof delta !== "number" || !Number.isFinite(delta)) {
        throw new BadDataException(
          `atomicAddToColumnsByIdWithoutHooks: "${propertyName}" delta must be a finite number`,
        );
      }

      const column: ColumnMetadata = columnFor(propertyName);
      params.push(delta);
      const quoted: string = `"${column.databaseName}"`;
      setClauses.push(`${quoted} = COALESCE(${quoted}, 0) + $${params.length}`);
    }

    // Shallow copy — never mutate the caller's object. See the clamp note above.
    const set: ObjectLiteral = this.truncateStringColumnsToMaxLength({
      ...((input.set || {}) as ObjectLiteral),
    });

    for (const [propertyName, value] of Object.entries(set)) {
      if (typeof value === "function") {
        throw new BadDataException(
          `atomicAddToColumnsByIdWithoutHooks: SQL-expression values are not supported (column "${propertyName}"); pass a literal value.`,
        );
      }

      const column: ColumnMetadata = columnFor(propertyName);
      params.push(driver.preparePersistentValue(value, column));
      setClauses.push(`"${column.databaseName}" = $${params.length}`);
    }

    if (setClauses.length === 0) {
      return;
    }

    if (metadata.updateDateColumn) {
      setClauses.push(
        `"${metadata.updateDateColumn.databaseName}" = CURRENT_TIMESTAMP`,
      );
    }

    const primaryColumnName: string =
      metadata.primaryColumns[0]?.databaseName || "_id";
    params.push(input.id.toString());

    const sql: string = `UPDATE "${metadata.tableName}" SET ${setClauses.join(
      ", ",
    )} WHERE "${primaryColumnName}" = $${params.length}`;

    await repository.manager.query(sql, params);
  }

  /*
   * Add one to a numeric column and return what it became, in a SINGLE
   * statement.
   *
   * This exists for counters that GATE something, where the read and the
   * write cannot be allowed to come apart. The motivating case is the failed
   * attempt counter on a notification-channel verification code: read the
   * count, decide, then write it back, and N requests racing each other all
   * read the same pre-increment value and all decide they are under the
   * limit — which is precisely the shape an attacker running a brute-force
   * loop produces. `atomicAddToColumnsByIdWithoutHooks` closes the
   * lost-update half of that but cannot answer "and what is it now?", and
   * `getRepository().increment()` cannot either.
   *
   * RETURNING makes the increment and the observation the same operation, so
   * every concurrent caller gets a distinct value and the k-th attempt is
   * refused no matter how the requests interleave.
   *
   * COALESCE so a NULL counter starts from zero rather than staying NULL.
   *
   * The column and table identifiers come from entity metadata, never from
   * the caller, and the id is bound as a parameter. Hooks, the `version`
   * bump and access control are all skipped: use ONLY for trusted internal
   * counter writes.
   */
  @CaptureSpan()
  public async atomicIncrementColumnValueByOneAndGetValue(data: {
    id: ObjectID;
    columnName: keyof TBaseModel;
  }): Promise<number> {
    if (!data.id) {
      throw new BadDataException("id is required");
    }

    const repository: Repository<TBaseModel> = this.getRepository();
    const metadata: EntityMetadata = repository.metadata;

    const column: ColumnMetadata | undefined =
      metadata.findColumnWithPropertyName(data.columnName as string);

    if (!column) {
      throw new BadDataException(
        `atomicIncrementColumnValueByOneAndGetValue: unknown column "${String(
          data.columnName,
        )}" on "${metadata.tableName}"`,
      );
    }

    const primaryColumnName: string =
      metadata.primaryColumns[0]?.databaseName || "_id";

    const quoted: string = `"${column.databaseName}"`;

    const sql: string = `UPDATE "${metadata.tableName}" SET ${quoted} = COALESCE(${quoted}, 0) + 1 WHERE "${primaryColumnName}" = $1 RETURNING ${quoted}`;

    const result: unknown = await repository.manager.query(sql, [
      data.id.toString(),
    ]);

    /*
     * TypeORM's Postgres driver returns `[rows, affectedCount]` for an UPDATE
     * and a bare row array for everything else, so both shapes are unwrapped
     * rather than one being assumed.
     */
    const rows: Array<unknown> = Array.isArray(result)
      ? Array.isArray(result[0])
        ? (result[0] as Array<unknown>)
        : (result as Array<unknown>)
      : [];

    const row: unknown = rows[0];

    if (!row || typeof row !== "object" || Array.isArray(row)) {
      /*
       * Nothing came back, so the row does not exist — deleted underneath us,
       * or never there. Callers gate on the returned count, so this must be an
       * error and not a zero, which would read as a fresh allowance.
       */
      throw new BadDataException(
        `Item with ID ${data.id.toString()} not found`,
      );
    }

    const value: unknown = (row as Record<string, unknown>)[
      column.databaseName
    ];

    const parsed: number =
      typeof value === "number" ? value : parseInt(String(value), 10);

    if (!Number.isFinite(parsed)) {
      throw new BadDataException(
        `atomicIncrementColumnValueByOneAndGetValue: "${String(
          data.columnName,
        )}" did not return a number`,
      );
    }

    return parsed;
  }

  @CaptureSpan()
  protected async atomicIncrementColumnValueByOne(data: {
    id: ObjectID;
    columnName: keyof TBaseModel;
  }): Promise<void> {
    await this.getRepository().increment(
      { _id: data.id.toString() } as any,
      data.columnName as string,
      1,
    );
  }

  /*
   * Atomically subtract `value` from a numeric column in a single UPDATE
   * (SET col = col - value) so concurrent callers never lose each other's
   * writes the way a read-modify-write would. The column can go negative;
   * callers that gate on a non-negative balance simply reject the next
   * request rather than silently forgiving the overage.
   */
  protected async atomicDecrementColumnValueBy(data: {
    id: ObjectID;
    columnName: keyof TBaseModel;
    value: number;
  }): Promise<void> {
    await this.getRepository().decrement(
      { _id: data.id.toString() } as any,
      data.columnName as string,
      data.value,
    );
  }

  @CaptureSpan()
  public async searchBy({
    skip,
    limit,
    select,
    props,
  }: SearchBy<TBaseModel>): Promise<SearchResult<TBaseModel>> {
    const query: Query<TBaseModel> = {};

    // query[column] = RegExp(`^${text}`, 'i');

    const [items, count]: [Array<TBaseModel>, PositiveNumber] =
      await Promise.all([
        this.findBy({
          query,
          skip,
          limit,
          select,
          props: props,
        }),
        this.countBy({
          query,
          skip: new PositiveNumber(0),
          limit: new PositiveNumber(Infinity),
          props: props,
        }),
      ]);

    return { items, count };
  }
}

export default DatabaseService;
export { EntityManager };
