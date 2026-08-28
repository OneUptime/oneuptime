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
import { WorkflowRoute } from "../../ServiceRoute";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { getMaxLengthFromTableColumnType } from "../../Types/Database/ColumnLength";
import Columns from "../../Types/Database/Columns";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { getUniqueColumnsBy } from "../../Types/Database/UniqueColumnBy";
import OneUptimeDate from "../../Types/Date";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import Exception from "../../Types/Exception/Exception";
import HashedString from "../../Types/HashedString";
import { JSONObject, JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import TelemetryContext from "../Utils/Telemetry/TelemetryContext";
import PositiveNumber from "../../Types/PositiveNumber";
import Text from "../../Types/Text";
import Typeof from "../../Types/Typeof";
import API from "../../Utils/API";
import Slug from "../../Utils/Slug";
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

class DatabaseService<TBaseModel extends BaseModel> extends BaseService {
  public modelType!: { new (): TBaseModel };
  private model!: TBaseModel;
  private modelName!: string;

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
    const projectIdColumn: string | null = this.model.getTenantColumn();

    if (projectIdColumn && createBy.props.tenantId) {
      (createBy.data as any)[projectIdColumn] = createBy.props.tenantId;
    }

    return await this.onBeforeCreate(createBy);
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
        data.setValue(key, await Encryption.decrypt((data as any)[key]));
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

  private generateSlug(createBy: CreateBy<TBaseModel>): CreateBy<TBaseModel> {
    if (createBy.data.getSlugifyColumn()) {
      (createBy.data as any)[createBy.data.getSaveSlugToColumn() as string] =
        Slug.getSlug(
          (createBy.data as any)[createBy.data.getSlugifyColumn() as string]
            ? ((createBy.data as any)[
                createBy.data.getSlugifyColumn() as string
              ] as string)
            : null,
        );
    }

    return createBy;
  }

  private async sanitizeCreateOrUpdate(
    data: TBaseModel | PartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    isUpdate: boolean = false,
  ): Promise<TBaseModel | PartialEntity<TBaseModel>> {
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

    // check createByUserId.

    if (!isUpdate && props.userId) {
      (data as any)["createdByUserId"] = props.userId;
    }

    /*
     * Stamp archive audit fields when a resource is being (un)archived.
     * The client only ever sends `isArchived`; we stamp `archivedAt` and
     * `archivedByUserId` here — which runs after column update-permission
     * checks — so these audit fields are server-controlled and cannot be
     * spoofed, exactly like `createdByUserId` above.
     */
    if (isUpdate && (data as any)["isArchived"] !== undefined) {
      const isArchivedValue: boolean = Boolean((data as any)["isArchived"]);

      if (this.model.hasColumn("archivedAt")) {
        (data as any)["archivedAt"] = isArchivedValue
          ? OneUptimeDate.getCurrentDate()
          : null;
      }

      if (this.model.hasColumn("archivedByUserId")) {
        (data as any)["archivedByUserId"] =
          isArchivedValue && props.userId ? props.userId : null;
      }
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
    const onCreate: OnCreate<TBaseModel> = createBy.props.ignoreHooks
      ? { createBy, carryForward: [] }
      : await this._onBeforeCreate(createBy);

    let _createdBy: CreateBy<TBaseModel> = onCreate.createBy;

    const carryForward: any = onCreate.carryForward;

    _createdBy = this.generateSlug(_createdBy);

    let data: TBaseModel = _createdBy.data;

    // add tenantId if present.
    const tenantColumnName: string | null = data.getTenantColumn();

    if (tenantColumnName && _createdBy.props.tenantId) {
      data.setColumnValue(tenantColumnName, _createdBy.props.tenantId);
    }

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

    createBy.data = data;

    // check uniqueColumns by:
    createBy = await this.checkUniqueColumnBy(createBy);

    // serialize.
    createBy.data = (await this.sanitizeCreateOrUpdate(
      createBy.data,
      createBy.props,
    )) as TBaseModel;

    try {
      createBy.data = await this.getRepository().save(createBy.data);

      // Seed telemetry context with projectId + <model>Id for this create.
      this.setTelemetryContextFromItem(createBy.data);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ownerModel: any = entry.ownerUserService.getModel();
      ownerModel[entry.fkColumn] = resourceId;
      ownerModel.userId = props.userId;
      ownerModel.projectId = projectId;

      await entry.ownerUserService.create({
        data: ownerModel,
        props: { isRoot: true },
      });
    } catch (err) {
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

  private async checkTotalItemsBy(
    createdBy: CreateBy<TBaseModel>,
  ): Promise<void> {
    const totalItemsColumnName: string | null =
      this.model.getTotalItemsByColumnName();
    const totalItemsNumber: number | null = this.model.getTotalItemsNumber();
    const errorMessage: string | null =
      this.model.getTotalItemsByErrorMessage();

    if (
      totalItemsColumnName &&
      totalItemsNumber &&
      errorMessage &&
      createdBy.data.getColumnValue(totalItemsColumnName)
    ) {
      const count: PositiveNumber = await this.countBy({
        query: {
          [totalItemsColumnName]:
            createdBy.data.getColumnValue(totalItemsColumnName),
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
        const columnValue: JSONValue = (createBy.data as any)[
          uniqueByColumnName as string
        ];
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
          aggregateBy.query,
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
   * The permission pipeline expresses a label-scoped read as a condition on
   * the access-control RELATION: `{ labels: [permittedIds] }` for an allow
   * permission, `{ labels: { _id: NotIn([...]) } }` for a block. Handed to
   * TypeORM's FindOptions machinery those become a join through the
   * many-to-many junction table — and a join multiplies rows. A device
   * carrying two permitted labels comes back twice.
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
   * The subquery is skipped when the query is flat — which is every read by a
   * user whose permissions are not label-scoped, i.e. the hot path — so the
   * ordinary full-fleet aggregate stays a single sequential scan.
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
     * The subquery's own bound values. Its placeholders are auto-named
     * (`orm_param_N`) and the outer builder generates none of its own here —
     * its only WHERE is the raw string above — so there is nothing to clash
     * with. Caller-supplied parameters are named and applied later.
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
      const onDelete: OnDelete<TBaseModel> = deleteBy.props.ignoreHooks
        ? { deleteBy, carryForward: [] }
        : await this.onBeforeDelete(deleteBy);
      const beforeDeleteBy: DeleteBy<TBaseModel> = onDelete.deleteBy;

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

      const items: Array<TBaseModel> = await this._findBy(
        {
          query: beforeDeleteBy.query,
          skip: beforeDeleteBy.skip.toNumber(),
          limit: beforeDeleteBy.limit.toNumber(),
          select: {},
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

        numberOfDocsAffected =
          (await this.getRepository().delete(beforeDeleteBy.query as any))
            .affected || 0;
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

      if (this.doNotAllowDelete && !deleteBy.props.isRoot) {
        throw new BadDataException("Delete not allowed");
      }

      const onDelete: OnDelete<TBaseModel> = deleteBy.props.ignoreHooks
        ? { deleteBy, carryForward: [] }
        : await this.onBeforeDelete(deleteBy);

      const beforeDeleteBy: DeleteBy<TBaseModel> = onDelete.deleteBy;

      const carryForward: any = onDelete.carryForward;

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

        numberOfDocsAffected =
          (await this.getRepository().delete(query as any)).affected || 0;
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
        decryptedItems.push(await this.decrypt(item));
      }

      decryptedItems = this.sanitizeFindByItems(decryptedItems, onBeforeFind);

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

      updateBy.data = this.sanitizeUpdateData(updateBy.data);

      const onUpdate: OnUpdate<TBaseModel> = updateBy.props.ignoreHooks
        ? { updateBy, carryForward: [] }
        : await this.onBeforeUpdate(updateBy);

      // Encrypt data
      updateBy.data = (await this.encrypt(
        updateBy.data,
      )) as PartialEntity<TBaseModel>;

      const beforeUpdateBy: UpdateBy<TBaseModel> = onUpdate.updateBy;
      const carryForward: any = onUpdate.carryForward;

      beforeUpdateBy.query = await ModelPermission.checkUpdateQueryPermissions(
        this.modelType,
        beforeUpdateBy.query,
        beforeUpdateBy.data,
        beforeUpdateBy.props,
      );

      const data: PartialEntity<TBaseModel> =
        (await this.sanitizeCreateOrUpdate(
          beforeUpdateBy.data,
          updateBy.props,
          true,
        )) as PartialEntity<TBaseModel>;

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

      if (this.getModel().getTenantColumn()) {
        (selectColumns as any)[this.getModel().getTenantColumn()!.toString()] =
          true;
      }

      /*
       * When audit logging on update is enabled, ensure the resource's display
       * name is loaded on the `before` snapshot so the audit entry records the
       * human-readable resource name even when the update doesn't touch it.
       */
      if (this.getModel().enableAuditLogOn?.update) {
        const nameCandidates: ReadonlyArray<string> = [
          "name",
          "title",
          "displayName",
        ];
        const modelColumns: Array<string> =
          this.getModel().getTableColumns().columns;
        for (const candidate of nameCandidates) {
          if (modelColumns.includes(candidate)) {
            (selectColumns as any)[candidate] = true;
          }
        }
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
       * The per-item debug payload below is a pretty-printed JSON.stringify
       * of every matched row; skip building it entirely unless the log level
       * is DEBUG, since logger.debug() no-ops at any other level.
       */
      const isDebugLogEnabled: boolean =
        logger.getLogLevel() === ConfigLogLevel.DEBUG;

      for (const item of items) {
        /*
         * _id must be set AFTER the spread: update data can carry an
         * explicit `_id: undefined` (sanitizeUpdateData strips it from model
         * instances, but a plain object can still hold it), and spreading it
         * after _id would clobber the located row's id — save() then sees no
         * primary key, INSERTs instead of updating, and dies on the first
         * NOT NULL column.
         */
        const updatedItem: any = {
          ...data,
          _id: item._id!,
        } as any;

        if (isDebugLogEnabled) {
          logger.debug("Updated Item", {
            projectId: updateBy.props.tenantId?.toString(),
          } as LogAttributes);
          logger.debug(JSON.stringify(updatedItem, null, 2), {
            projectId: updateBy.props.tenantId?.toString(),
          } as LogAttributes);
        }

        if (hasRelationUpdates) {
          await this.getRepository().save(updatedItem);
        } else {
          const { _id, ...updateData } = updatedItem;
          const updateResult: UpdateResult = await this.getRepository().update(
            { _id: _id } as any,
            {
              ...updateData,
              /*
               * save() bumps the @VersionColumn automatically; update() does
               * not, so emulate it to keep the audit counter behaviour
               * identical.
               */
              version: () => {
                return '"version" + 1';
              },
            } as any,
          );

          /*
           * The row was hard-deleted between the find above and this write.
           * Nothing was updated, so skip the success hooks for it: they
           * re-read the row and would dereference null (and would report a
           * change that never happened).
           */
          if (updateResult.affected === 0) {
            continue;
          }
        }

        affectedItems.push(item);

        // hit workflow.
        if (
          this.getModel().enableWorkflowOn?.update &&
          // Only trigger workflow if there's a change in values
          !this.hasSameValues({ item, updatedItem })
        ) {
          let tenantId: ObjectID | undefined = updateBy.props.tenantId;

          if (!tenantId && this.getModel().getTenantColumn()) {
            tenantId = item.getValue<ObjectID>(
              this.getModel().getTenantColumn()!,
            );
          }

          if (tenantId) {
            await this.onTriggerWorkflow(item.id!, tenantId, "on-update", {
              updatedFields: JSONFunctions.serialize(data as JSONObject),
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
          !this.hasSameValues({ item, updatedItem }) &&
          item.id
        ) {
          const auditLogService: typeof AuditLogServiceType =
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
            require("./AuditLogService").default;
          await auditLogService.recordUpdate({
            model: this.getModel(),
            before: item,
            updatedFields: data as JSONObject,
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
       * onUpdateSuccess always fires — subclasses rely on it being called
       * even when nothing matched — but it is handed only the rows the write
       * actually affected, so a row deleted mid-update never appears as a
       * phantom id that hooks would then fail to re-read.
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

  private hasSameValues(data: { item: TBaseModel; updatedItem: any }): boolean {
    const { item, updatedItem } = data;
    const columns: string[] = Object.keys(updatedItem);
    for (const column of columns) {
      if (
        /*
         * `toString()` is necessary so we can compare wrapped values
         * (e.g. `ObjectID`) with raw values (e.g. `string`)
         */
        item.getColumnValue(column)?.toString() !==
        updatedItem[column]?.toString()
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
          id: updateById.id,
          select: selectModel,
          props: {
            isRoot: true,
          },
        });
      },
      props: updateById.props,
    });

    return await this.updateOneBy({
      query: {
        _id: updateById.id.toString() as any,
      },
      data: updateById.data as any,
      props: updateById.props,
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
          `updateColumnsByIdWithoutHooks: unknown column "${propertyName}" on "${metadata.tableName}"`,
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
          `updateColumnsByIdWithoutHooks: SQL-expression values are not supported (column "${propertyName}"); pass a literal value.`,
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
      return;
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
          `updateColumnsByIdWithoutHooks: unknown expected column "${propertyName}" on "${metadata.tableName}"`,
        );
      }

      if (typeof value === "function") {
        throw new BadDataException(
          `updateColumnsByIdWithoutHooks: SQL-expression expected values are not supported (column "${propertyName}"); pass a literal value.`,
        );
      }

      params.push(driver.preparePersistentValue(value, column));
      whereClauses.push(
        `"${column.databaseName}" IS NOT DISTINCT FROM $${params.length}`,
      );
    }

    const sql: string = `UPDATE "${metadata.tableName}" SET ${setClauses.join(
      ", ",
    )} WHERE ${whereClauses.join(" AND ")}`;

    await repository.manager.query(sql, params);
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
     * RETURNING is how the affected-row count comes back: TypeORM's `query()`
     * surfaces the driver's rows and a bare UPDATE returns none, so without it
     * a skipped write is indistinguishable from an applied one.
     */
    const sql: string = `UPDATE "${metadata.tableName}" SET ${setClauses.join(
      ", ",
    )} WHERE "${primaryColumnName}" IN (SELECT "${primaryColumnName}" FROM "${
      metadata.tableName
    }" WHERE "${primaryColumnName}" = $${
      params.length
    } FOR UPDATE SKIP LOCKED) RETURNING "${primaryColumnName}"`;

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
