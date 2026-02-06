import { EncryptionSecret, WorkflowHostname } from "../EnvironmentConfig";
import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
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
import logger from "../Utils/Logger";
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
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import Exception from "../../Types/Exception/Exception";
import HashedString from "../../Types/HashedString";
import { JSONObject, JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Text from "../../Types/Text";
import Typeof from "../../Types/Typeof";
import API from "../../Utils/API";
import Slug from "../../Utils/Slug";
import {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from "typeorm";
import { FindWhere } from "../../Types/BaseDatabase/Query";
import Realtime from "../Utils/Realtime";
import ModelEventType from "../../Types/Realtime/ModelEventType";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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

  protected async hash(data: TBaseModel): Promise<TBaseModel> {
    const columns: Columns = data.getHashedColumns();

    for (const key of columns.columns) {
      if (
        data.hasValue(key) &&
        !(data.getValue(key) as HashedString).isValueHashed()
      ) {
        await ((data as any)[key] as HashedString).hashValue(EncryptionSecret);
      }
    }

    return data;
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

  protected async getException(error: Exception): Promise<void> {
    throw error;
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

        if (
          data &&
          columnName &&
          columnValue &&
          columnValue instanceof HashedString
        ) {
          if (!columnValue.isValueHashed()) {
            await columnValue.hashValue(EncryptionSecret);
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

    return data;
  }

  @CaptureSpan()
  public async onTriggerRealtime(
    modelId: ObjectID,
    projectId: ObjectID,
    modelEventType: ModelEventType,
  ): Promise<void> {
    logger.debug("Realtime Events Enabled");
    logger.debug(this.model.enableRealtimeEventsOn);

    if (Realtime.isInitialized() && this.model.enableRealtimeEventsOn) {
      logger.debug("Emitting realtime event");
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
        logger.debug("Realtime event not enabled for this event type");
        return;
      }

      logger.debug("Emitting realtime event");
      Realtime.emitModelEvent({
        tenantId: projectId,
        eventType: modelEventType,
        modelId: modelId,
        modelType: this.modelType,
      }).catch((err: Error) => {
        logger.error("Cannot emit realtime event");
        logger.error(err);
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
        logger.error(error);
      });
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

      if (!createBy.props.ignoreHooks) {
        createBy.data = await this.onCreateSuccess(
          {
            createBy,
            carryForward,
          },
          createBy.data,
        );
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

      return createBy.data;
    } catch (error) {
      await this.onCreateError(error as Exception);
      throw this.getException(error as Exception);
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
      let automaticallyAddedCreatedAtInSelect: boolean = false;

      if (!findBy.sort || Object.keys(findBy.sort).length === 0) {
        findBy.sort = {
          createdAt: SortOrder.Descending,
        };

        if (!findBy.select) {
          findBy.select = {} as any;
        }

        if (!(findBy.select as any)["createdAt"]) {
          (findBy.select as any)["createdAt"] = true;
          automaticallyAddedCreatedAtInSelect = true;
        }
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
        if (automaticallyAddedCreatedAtInSelect) {
          delete (item as any).createdAt;
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

  private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {
    try {
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

      const items: Array<TBaseModel> = await this._findBy({
        query: beforeUpdateBy.query,
        skip: updateBy.skip.toNumber(),
        limit: updateBy.limit.toNumber(),
        select: selectColumns,
        props: { isRoot: true, ignoreHooks: true },
      });

      for (const item of items) {
        const updatedItem: any = {
          _id: item._id!,
          ...data,
        } as any;

        logger.debug("Updated Item");
        logger.debug(JSON.stringify(updatedItem, null, 2));

        await this.getRepository().save(updatedItem);

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

      if (!updateBy.props.ignoreHooks) {
        await this.onUpdateSuccess(
          { updateBy, carryForward },
          items.map((i: TBaseModel) => {
            return new ObjectID(i._id!);
          }),
        );
      }

      return items.length;
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

  @CaptureSpan()
  public async updateOneById(
    updateById: UpdateByID<TBaseModel>,
  ): Promise<void> {
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

    await this.updateOneBy({
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
