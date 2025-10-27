import { WorkflowHostname } from "../EnvironmentConfig";
import ClickhouseDatabase, {
  ClickhouseAppInstance,
  ClickhouseClient,
} from "../Infrastructure/ClickhouseDatabase";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import CountBy from "../Types/AnalyticsDatabase/CountBy";
import CreateBy from "../Types/AnalyticsDatabase/CreateBy";
import CreateManyBy from "../Types/AnalyticsDatabase/CreateManyBy";
import DeleteBy from "../Types/AnalyticsDatabase/DeleteBy";
import FindBy from "../Types/AnalyticsDatabase/FindBy";
import FindOneBy from "../Types/AnalyticsDatabase/FindOneBy";
import FindOneByID from "../Types/AnalyticsDatabase/FindOneByID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  DatabaseTriggerType,
  OnCreate,
  OnDelete,
  OnFind,
  OnUpdate,
} from "../Types/AnalyticsDatabase/Hooks";
import ModelPermission, {
  CheckReadPermissionType,
} from "../Types/AnalyticsDatabase/ModelPermission";
import Select from "../Types/AnalyticsDatabase/Select";
import UpdateBy from "../Types/AnalyticsDatabase/UpdateBy";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../Utils/AnalyticsDatabase/StatementGenerator";
import logger from "../Utils/Logger";
import Realtime from "../Utils/Realtime";
import StreamUtil from "../Utils/Stream";
import BaseService from "./BaseService";
import { ExecResult, ResponseJSON, ResultSet } from "@clickhouse/client";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { WorkflowRoute } from "../../ServiceRoute";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import ExceptionCode from "../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Text from "../../Types/Text";
import Typeof from "../../Types/Typeof";
import API from "../../Utils/API";
import { Stream } from "node:stream";
import AggregateBy from "../Types/AnalyticsDatabase/AggregateBy";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import Sort from "../Types/AnalyticsDatabase/Sort";
import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import ModelEventType from "../../Types/Realtime/ModelEventType";

export type Results = ResultSet<"JSON">;
export type DbJSONResponse = ResponseJSON<{
  data?: Array<JSONObject>;
}>;

export default class AnalyticsDatabaseService<
  TBaseModel extends AnalyticsBaseModel,
> extends BaseService {
  public modelType!: { new (): TBaseModel };
  public database!: ClickhouseDatabase;
  public model!: TBaseModel;
  public databaseClient!: ClickhouseClient;
  public statementGenerator!: StatementGenerator<TBaseModel>;

  public constructor(data: {
    modelType: { new (): TBaseModel };
    database?: ClickhouseDatabase | undefined;
  }) {
    super();
    this.modelType = data.modelType;
    this.model = new this.modelType();
    if (data.database) {
      this.database = data.database; // used for testing.
    } else {
      this.database = ClickhouseAppInstance; // default database
    }

    this.databaseClient = this.database.getDataSource() as ClickhouseClient;

    this.statementGenerator = new StatementGenerator<TBaseModel>({
      modelType: this.modelType,
      database: this.database,
    });
  }

  @CaptureSpan()
  public async insertJsonRows(rows: Array<JSONObject>): Promise<void> {
    if (!rows || rows.length === 0) {
      return;
    }

    if (!this.databaseClient) {
      throw new Exception(
        ExceptionCode.DatabaseNotConnectedException,
        "ClickHouse client is not connected",
      );
    }

    const tableName: string = this.model.tableName;

    if (!tableName) {
      throw new Exception(
        ExceptionCode.BadDataException,
        "Analytics model table name not configured",
      );
    }

    try {
      await this.databaseClient.insert({
        table: tableName,
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: 0,
        },
      });
    } catch (error) {
      logger.error(
        `ClickHouse insert failed for table ${tableName} at ${OneUptimeDate.toString(OneUptimeDate.getCurrentDate())}`,
      );
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public async doesColumnExistInDatabase(columnName: string): Promise<boolean> {
    const statement: string =
      this.statementGenerator.toDoesColumnExistStatement(columnName);

    const dbResult: ExecResult<Stream> = await this.execute(statement);

    const strResult: string = await StreamUtil.convertStreamToText(
      dbResult.stream,
    );

    return strResult.trim().length > 0;
  }

  @CaptureSpan()
  public async getColumnTypeInDatabase(
    column: AnalyticsTableColumn,
  ): Promise<TableColumnType | null> {
    if (!column) {
      return null;
    }

    const columnName: string = column.key;

    if (!this.doesColumnExistInDatabase(columnName)) {
      return null;
    }

    const statement: string =
      this.statementGenerator.getColumnTypesStatement(columnName);

    const dbResult: ExecResult<Stream> = await this.execute(statement);

    let strResult: string = await StreamUtil.convertStreamToText(
      dbResult.stream,
    );

    // if strResult includes Nullable(type) then extract type.

    if (strResult.includes("Nullable")) {
      let type: string = strResult.split("Nullable(")[1] as string;
      type = type.split(")")[0] as string;
      strResult = type;
    }

    return (
      (this.statementGenerator.toTableColumnType(
        strResult.trim(),
      ) as TableColumnType) || null
    );
  }

  @CaptureSpan()
  public async countBy(countBy: CountBy<TBaseModel>): Promise<PositiveNumber> {
    try {
      const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
        await ModelPermission.checkReadPermission(
          this.modelType,
          countBy.query,
          null,
          countBy.props,
        );

      countBy.query = checkReadPermissionType.query;

      const countStatement: Statement = this.toCountStatement(countBy);

      const dbResult: ResultSet<"JSON"> =
        await this.executeQuery(countStatement);

      logger.debug(`${this.model.tableName} Count Statement executed`);
      logger.debug(countStatement);

      const resultInJSON: ResponseJSON<JSONObject> =
        await dbResult.json<JSONObject>();

      let countPositive: PositiveNumber = new PositiveNumber(0);
      if (
        resultInJSON.data &&
        resultInJSON.data[0] &&
        resultInJSON.data[0]["count"] &&
        typeof resultInJSON.data[0]["count"] === "string"
      ) {
        countPositive = new PositiveNumber(
          resultInJSON.data[0]["count"] as string,
        );
      }

      logger.debug(`Result: `);
      logger.debug(countPositive.toNumber());

      countPositive = await this.onCountSuccess(countPositive);
      return countPositive;
    } catch (error) {
      await this.onCountError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  @CaptureSpan()
  public async addColumnInDatabase(
    column: AnalyticsTableColumn,
  ): Promise<void> {
    const statement: Statement =
      this.statementGenerator.toAddColumnStatement(column);
    await this.execute(statement);
  }

  @CaptureSpan()
  public async dropColumnInDatabase(columnName: string): Promise<void> {
    await this.execute(
      this.statementGenerator.toDropColumnStatement(columnName),
    );
  }

  @CaptureSpan()
  public async findBy(findBy: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {
    return await this._findBy(findBy);
  }

  @CaptureSpan()
  public async aggregateBy(
    aggregateBy: AggregateBy<TBaseModel>,
  ): Promise<AggregatedResult> {
    return await this._aggregateBy(aggregateBy);
  }

  private async _aggregateBy(
    aggregateBy: AggregateBy<TBaseModel>,
  ): Promise<AggregatedResult> {
    try {
      if (!aggregateBy.sort || Object.keys(aggregateBy.sort).length === 0) {
        aggregateBy.sort = {
          [aggregateBy.aggregationTimestampColumnName as keyof TBaseModel]:
            SortOrder.Descending,
        } as Sort<TBaseModel>;
      }

      if (!aggregateBy.limit) {
        aggregateBy.limit = 10;
      }

      if (!aggregateBy.aggregationType) {
        throw new BadDataException("aggregationType is required");
      }

      if (!aggregateBy.aggregationTimestampColumnName) {
        throw new BadDataException(
          "aggregationTimestampColumnName is required",
        );
      }

      if (!aggregateBy.aggregateColumnName) {
        throw new BadDataException("aggregateColumnName is required");
      }

      const result: CheckReadPermissionType<TBaseModel> =
        await ModelPermission.checkReadPermission(
          this.modelType,
          aggregateBy.query,
          {
            [aggregateBy.aggregateColumnName]: true,
            [aggregateBy.aggregationTimestampColumnName]: true,
          } as Select<TBaseModel>,
          aggregateBy.props,
        );

      aggregateBy.query = result.query;

      const findStatement: {
        statement: Statement;
        columns: Array<string>;
      } = this.toAggregateStatement(aggregateBy);

      const dbResult: ResultSet<"JSON"> = await this.executeQuery(
        findStatement.statement,
      );

      logger.debug(`${this.model.tableName} Aggregate Statement executed`);

      const responseJSON: ResponseJSON<JSONObject> =
        await dbResult.json<JSONObject>();

      const items: Array<JSONObject> = responseJSON.data
        ? responseJSON.data
        : [];

      const aggregatedItems: Array<AggregatedModel> = [];

      // convert date column from string to date.

      const groupByColumnName: keyof TBaseModel | undefined =
        aggregateBy.groupBy && Object.keys(aggregateBy.groupBy).length > 0
          ? (Object.keys(aggregateBy.groupBy)[0] as keyof TBaseModel)
          : undefined;

      for (const item of items) {
        if (
          !(item as JSONObject)[
            aggregateBy.aggregationTimestampColumnName as string
          ]
        ) {
          continue;
        }

        // if value is of type string then convert it to number.

        if (
          typeof (item as JSONObject)[
            aggregateBy.aggregateColumnName as string
          ] === Typeof.String
        ) {
          (item as JSONObject)[aggregateBy.aggregateColumnName as string] =
            Number.parseFloat(
              (item as JSONObject)[
                aggregateBy.aggregateColumnName as string
              ] as string,
            );
        }

        const aggregatedModel: AggregatedModel = {
          timestamp: OneUptimeDate.fromString(
            (item as JSONObject)[
              aggregateBy.aggregationTimestampColumnName as string
            ] as string,
          ),
          value: (item as JSONObject)[
            aggregateBy.aggregateColumnName as string
          ] as number,
          [groupByColumnName as string]: (item as JSONObject)[
            groupByColumnName as string
          ],
        };

        aggregatedItems.push(aggregatedModel);
      }

      return {
        data: aggregatedItems,
      };
    } catch (error) {
      await this.onFindError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  private async _findBy(
    findBy: FindBy<TBaseModel>,
  ): Promise<Array<TBaseModel>> {
    try {
      if (!findBy.sort || Object.keys(findBy.sort).length === 0) {
        findBy.sort = {
          createdAt: SortOrder.Descending,
        };

        if (!findBy.select) {
          findBy.select = {} as any;
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

      const result: CheckReadPermissionType<TBaseModel> =
        await ModelPermission.checkReadPermission(
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

      const findStatement: {
        statement: Statement;
        columns: Array<string>;
      } = this.toFindStatement(onBeforeFind);

      const dbResult: ResultSet<"JSON"> = await this.executeQuery(
        findStatement.statement,
      );

      logger.debug(`${this.model.tableName} Find Statement executed`);
      logger.debug(findStatement.statement);

      const responseJSON: ResponseJSON<JSONObject> =
        await dbResult.json<JSONObject>();

      const jsonItems: Array<JSONObject> = responseJSON.data;

      let items: Array<TBaseModel> =
        AnalyticsBaseModel.fromJSONArray<TBaseModel>(jsonItems, this.modelType);

      if (!findBy.props.ignoreHooks) {
        items = await (
          await this.onFindSuccess({ findBy, carryForward }, items)
        ).carryForward;
      }

      return items;
    } catch (error) {
      await this.onFindError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  public convertSelectReturnedDataToJson(
    strResult: string,
    columns: string[],
  ): JSONObject[] {
    if (!strResult || !strResult.trim()) {
      return [];
    }

    const jsonItems: Array<JSONObject> = [];

    const rows: Array<string> = strResult.split("\n");

    for (const row of rows) {
      if (!row) {
        continue;
      }

      const jsonItem: JSONObject = {};
      const values: Array<string> = row.split("\t");

      for (let i: number = 0; i < columns.length; i++) {
        jsonItem[columns[i]!] = values[i];

        if (values[i] === "NULL") {
          jsonItem[columns[i]!] = null;
        }

        if (values[i] === "\\N") {
          jsonItem[columns[i]!] = null;
        }
      }

      jsonItems.push(jsonItem);
    }

    return jsonItems;
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

  public toCountStatement(countBy: CountBy<TBaseModel>): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      countBy.query,
    );

    /* eslint-disable prettier/prettier */
    const statement: Statement = SQL`
            SELECT
                count(`;

    if (countBy.groupBy && Object.keys(countBy.groupBy).length > 0) {
      const groupByKey: string = Object.keys(countBy.groupBy)[0] as string;

      statement.append(
        SQL`DISTINCT ${groupByKey}`
      );
    }

    statement
      .append(
        SQL`) as count
            FROM ${databaseName}.${this.model.tableName}
            WHERE TRUE `
      )
      .append(whereStatement);

    if (countBy.limit) {
      statement.append(SQL`
            LIMIT ${{
              value: Number(countBy.limit),
              type: TableColumnType.Number,
            }}
            `);
    }

    if (countBy.skip) {
      statement.append(SQL`
            OFFSET ${{
              value: Number(countBy.skip),
              type: TableColumnType.Number,
            }}
            `);
    }
    logger.debug(`${this.model.tableName} Count Statement`);
    logger.debug(statement);

    return statement;
  }

  public toAggregateStatement(aggregateBy: AggregateBy<TBaseModel>): {
    statement: Statement;
    columns: Array<string>;
  } {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const select: { statement: Statement; columns: Array<string> } =
      this.statementGenerator.toAggregateSelectStatement(aggregateBy);

    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      aggregateBy.query
    );

    const sortStatement: Statement = this.statementGenerator.toSortStatement(
      aggregateBy.sort!
    );

    const statement: Statement = SQL``;

    statement.append(SQL`SELECT `.append(select.statement));
    statement.append(SQL` FROM ${databaseName}.${this.model.tableName}`);
    statement.append(SQL` WHERE TRUE `).append(whereStatement);

    statement
      .append(SQL` GROUP BY `)
      .append(`${aggregateBy.aggregationTimestampColumnName.toString()}`);

    if (aggregateBy.groupBy && Object.keys(aggregateBy.groupBy).length > 0) {
      statement
        .append(SQL` , `)
        .append(
          this.statementGenerator.toGroupByStatement(aggregateBy.groupBy)
        );
    }

    statement.append(SQL` ORDER BY `).append(sortStatement);

    statement.append(
      SQL` LIMIT ${{
        value: Number(aggregateBy.limit),
        type: TableColumnType.Number,
      }}`
    );

    statement.append(SQL` OFFSET ${{
      value: Number(aggregateBy.skip),
      type: TableColumnType.Number,
    }}
        `);

    logger.debug(`${this.model.tableName} Aggregate Statement`);
    logger.debug(statement);

    return { statement, columns: select.columns };
  }

  public toFindStatement(findBy: FindBy<TBaseModel>): {
    statement: Statement;
    columns: Array<string>;
  } {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;
    let groupByStatement: Statement | null = null;

    if (findBy.groupBy && Object.keys(findBy.groupBy).length > 0) {
      // overwrite select object
      findBy.select = {
        ...findBy.groupBy,
      };

      groupByStatement = this.statementGenerator.toGroupByStatement(
        findBy.groupBy
      );
    }

    const select: { statement: Statement; columns: Array<string> } =
      this.statementGenerator.toSelectStatement(findBy.select!);

    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      findBy.query
    );

    const sortStatement: Statement = this.statementGenerator.toSortStatement(
      findBy.sort!
    );

    const statement: Statement = SQL``;

    statement.append(SQL`SELECT `.append(select.statement));
    statement.append(SQL` FROM ${databaseName}.${this.model.tableName}`);
    statement.append(SQL` WHERE TRUE `).append(whereStatement);

    if (groupByStatement) {
      statement.append(SQL` GROUP BY `).append(groupByStatement);
    }

    statement.append(SQL` ORDER BY `).append(sortStatement);

    statement.append(
      SQL` LIMIT ${{
        value: Number(findBy.limit),
        type: TableColumnType.Number,
      }}`
    );

    statement.append(SQL` OFFSET ${{
      value: Number(findBy.skip),
      type: TableColumnType.Number,
    }}
        `);

    logger.debug(`${this.model.tableName} Find Statement`);
    logger.debug(statement);

    return { statement, columns: select.columns };
  }

  public toDeleteStatement(deleteBy: DeleteBy<TBaseModel>): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;
    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      deleteBy.query
    );

    /* eslint-disable prettier/prettier */
    const statement: Statement = SQL`
            ALTER TABLE ${databaseName}.${this.model.tableName}
            DELETE WHERE TRUE `.append(whereStatement);

    logger.debug(`${this.model.tableName} Delete Statement`);
    logger.debug(statement);

    return statement;
  }

  @CaptureSpan()
  public async findOneBy(
    findOneBy: FindOneBy<TBaseModel>
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
  public async deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<void> {
    return await this._deleteBy(deleteBy);
  }

  private async _deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<void> {
    try {
      const onDelete: OnDelete<TBaseModel> = deleteBy.props.ignoreHooks
        ? { deleteBy, carryForward: [] }
        : await this.onBeforeDelete(deleteBy);

      const beforeDeleteBy: DeleteBy<TBaseModel> = onDelete.deleteBy;

      beforeDeleteBy.query = await ModelPermission.checkDeletePermission(
        this.modelType,
        beforeDeleteBy.query,
        deleteBy.props
      );

      const select: Select<TBaseModel> = {};

      const tenantColumnName: string | null =
        this.getModel().getTenantColumn()?.key || null;

      if (tenantColumnName) {
        (select as any)[tenantColumnName] = true;
      }

      const deleteStatement: Statement = this.toDeleteStatement(beforeDeleteBy);

      await this.execute(deleteStatement);

      logger.debug(`${this.model.tableName} Delete Statement executed`);
      logger.debug(deleteStatement);
    } catch (error) {
      await this.onDeleteError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  @CaptureSpan()
  public async findOneById(
    findOneById: FindOneByID<TBaseModel>
  ): Promise<TBaseModel | null> {
    if (!findOneById.id) {
      throw new BadDataException("findOneById.id is required");
    }

    return await this.findOneBy({
      query: {
        _id: findOneById.id,
      },
      select: findOneById.select || {},
      props: findOneById.props,
    });
  }

  @CaptureSpan()
  public async updateBy(updateBy: UpdateBy<TBaseModel>): Promise<void> {
    await this._updateBy(updateBy);
  }

  private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<void> {
    try {
      const onUpdate: OnUpdate<TBaseModel> = updateBy.props.ignoreHooks
        ? { updateBy, carryForward: [] }
        : await this.onBeforeUpdate(updateBy);

      const beforeUpdateBy: UpdateBy<TBaseModel> = onUpdate.updateBy;

      beforeUpdateBy.query = await ModelPermission.checkUpdatePermissions(
        this.modelType,
        beforeUpdateBy.query,
        beforeUpdateBy.data,
        beforeUpdateBy.props
      );

      const select: Select<TBaseModel> = {};

      const tenantColumnName: string | null =
        this.getModel().getTenantColumn()?.key || null;

      if (tenantColumnName) {
        (select as any)[tenantColumnName] = true;
      }

      const statement: Statement =
        this.statementGenerator.toUpdateStatement(beforeUpdateBy);

      await this.execute(statement);

      logger.debug(`${this.model.tableName} Update Statement executed`);
      logger.debug(statement);
    } catch (error) {
      await this.onUpdateError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  protected generateDefaultValues(data: TBaseModel): TBaseModel {
    const tableColumns: Array<AnalyticsTableColumn> = data.getTableColumns();

    for (const column of tableColumns) {
      if (column.forceGetDefaultValueOnCreate) {
        data.setColumnValue(column.key, column.forceGetDefaultValueOnCreate());
      }
    }

    return data;
  }

  public useDefaultDatabase(): void {
    this.database = ClickhouseAppInstance;
    this.databaseClient = this.database.getDataSource() as ClickhouseClient;
  }

  @CaptureSpan()
  public async execute(
    statement: Statement | string
  ): Promise<ExecResult<Stream>> {
    if (!this.databaseClient) {
      this.useDefaultDatabase();
    }

    const query: string =
      statement instanceof Statement ? statement.query : statement;
    const queryParams: Record<string, unknown> | undefined =
      statement instanceof Statement ? statement.query_params : undefined;

    return (await this.databaseClient.exec({
      query: query,
      query_params: queryParams || (undefined as any), // undefined is not specified in the type for query_params, but its ok to pass undefined.
    })) as ExecResult<Stream>;
  }

  @CaptureSpan()
  public async executeQuery(
    statement: Statement | string
  ): Promise<ResultSet<"JSON">> {
    if (!this.databaseClient) {
      this.useDefaultDatabase();
    }

    const query: string =
      statement instanceof Statement ? statement.query : statement;
    const queryParams: Record<string, unknown> | undefined =
      statement instanceof Statement ? statement.query_params : undefined;

    return await this.databaseClient.query({
      query: query,
      format: "JSON",
      query_params: queryParams || (undefined as any), // undefined is not specified in the type for query_params, but its ok to pass undefined.
    });
  }

  protected async onUpdateSuccess(
    onUpdate: OnUpdate<TBaseModel>,
    _updatedItemIds: Array<ObjectID>
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
    _itemIdsBeforeDelete: Array<ObjectID>
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
    items: Array<TBaseModel>
  ): Promise<OnFind<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({ ...onFind, carryForward: items });
  }

  protected async onFindError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onCountSuccess(
    count: PositiveNumber
  ): Promise<PositiveNumber> {
    // A place holder method used for overriding.
    return Promise.resolve(count);
  }

  protected async onCountError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onCreateSuccess(
    _onCreate: OnCreate<TBaseModel>,
    createdItem: TBaseModel
  ): Promise<TBaseModel> {
    // A place holder method used for overriding.
    return Promise.resolve(createdItem);
  }

  protected async onBeforeCreate(
    createBy: CreateBy<TBaseModel>
  ): Promise<OnCreate<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({
      createBy: createBy as CreateBy<TBaseModel>,
      carryForward: undefined,
    });
  }

  private async _onBeforeCreate(
    createBy: CreateBy<TBaseModel>
  ): Promise<OnCreate<TBaseModel>> {
    // Private method that runs before create.
    const projectIdColumn: string | null =
      this.model.getTenantColumn()?.key || null;

    if (projectIdColumn && createBy.props.tenantId) {
      (createBy.data as any)[projectIdColumn] = createBy.props.tenantId;
    }

    return await this.onBeforeCreate(createBy);
  }

  @CaptureSpan()
  public async createMany(
    createBy: CreateManyBy<TBaseModel>
  ): Promise<Array<TBaseModel>> {
    // add tenantId if present.
    const tenantColumnName: string | null =
      this.model.getTenantColumn()?.key || null;

    const items: Array<TBaseModel> = [];
    const carryForwards: Array<any> = [];

    for (const item of createBy.items) {
      let data: TBaseModel = item;

      const onCreate: OnCreate<TBaseModel> = createBy.props.ignoreHooks
        ? {
            createBy: {
              data: data,
              props: createBy.props,
            },
            carryForward: [],
          }
        : await this._onBeforeCreate({
            data: data,
            props: createBy.props,
          });

      data = onCreate.createBy.data;

      const carryForward: any = onCreate.carryForward;

      carryForwards.push(carryForward);

      if (tenantColumnName && createBy.props.tenantId) {
        data.setColumnValue(tenantColumnName, createBy.props.tenantId);
      }

      data = this.sanitizeCreate(data);
      data = this.generateDefaultValues(data);
      data = this.checkRequiredFields(data);

      if (!this.isValid(data)) {
        throw new BadDataException("Data is not valid");
      }

      // check total items by

      ModelPermission.checkCreatePermissions(
        this.modelType,
        data,
        createBy.props
      );

      items.push(data);
    }

    try {
      const insertStatement: string = this.statementGenerator.toCreateStatement(
        { item: items }
      );

      await this.execute(insertStatement);

      logger.debug(`${this.model.tableName} Create Statement executed`);
      logger.debug(insertStatement);

      if (!createBy.props.ignoreHooks) {
        for (let i: number = 0; i < items.length; i++) {
          if (!items[i]) {
            continue;
          }

          items[i] = await this.onCreateSuccess(
            {
              createBy: {
                data: items[i]!,
                props: createBy.props,
              },
              carryForward: carryForwards[i],
            },
            items[i]!
          );
        }
      }

      // hit workflow.;
      if (this.getModel().enableWorkflowOn?.create) {
        let tenantId: ObjectID | undefined = createBy.props.tenantId;

        for (const item of items) {
          if (!tenantId && this.getModel().getTenantColumn()) {
            tenantId = item.getColumnValue<ObjectID>(
              this.getModel().getTenantColumn()!.key
            );
          }

          if (tenantId) {
            await this.onTrigger(item.id!, tenantId, "on-create");
          }
        }
      }

      // emit realtime events to the client.
      if (
        this.getModel().enableRealtimeEventsOn?.create &&
        this.model.getTenantColumn()
      ) {
        if (Realtime.isInitialized()) {
          const promises: Array<Promise<void>> = [];

          for (const item of items) {
            const tenantId: ObjectID | null = item.getTenantColumnValue();

            if (!tenantId) {
              continue;
            }

            promises.push(
              Realtime.emitModelEvent({
                modelId: item.id!,
                tenantId: tenantId,
                eventType: ModelEventType.Create,
                modelType: this.modelType,
              })
            );
          }

          await Promise.allSettled(promises);
        } else {
          logger.warn(
            `Realtime is not initialized. Skipping emitModelEvent for ${
              this.getModel().tableName
            }`
          );
        }
      }

      return createBy.items;
    } catch (error) {
      await this.onCreateError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  @CaptureSpan()
  public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {
    const items: Array<TBaseModel> = await this.createMany({
      props: createBy.props,
      items: [createBy.data],
    });

    const item: TBaseModel | undefined = items[0];

    if (!item) {
      throw new BadDataException("Item not created");
    }

    return item;
  }

  private sanitizeCreate<TBaseModel extends AnalyticsBaseModel>(
    data: TBaseModel
  ): TBaseModel {
    if (!data.id) {
      data.id = ObjectID.generate();
    }

    data.createdAt = OneUptimeDate.getCurrentDate();
    data.updatedAt = OneUptimeDate.getCurrentDate();

    return data;
  }

  protected async getException(error: Exception): Promise<void> {
    throw error;
  }

  protected async onCreateError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected isValid(data: TBaseModel): boolean {
    if (!data) {
      throw new BadDataException("Data cannot be null");
    }

    return true;
  }

  @CaptureSpan()
  public async onTrigger(
    id: ObjectID,
    projectId: ObjectID,
    triggerType: DatabaseTriggerType
  ): Promise<void> {
    if (this.getModel().enableWorkflowOn) {
      API.post({
        url: new URL(
          Protocol.HTTP,
          WorkflowHostname,
          new Route(
            `/${WorkflowRoute.toString()}/analytics-model/${projectId.toString()}/${Text.pascalCaseToDashes(
              this.getModel().tableName!
            )}/${triggerType}`
          )
        ),
        data: {
          _id: id.toString(),
        },
        headers: {
          ...ClusterKeyAuthorization.getClusterKeyHeaders(),
        },
      }).catch((error: Error) => {
        logger.error(error);
      });
    }
  }

  protected checkRequiredFields(data: TBaseModel): TBaseModel {
    // Check required fields.

    for (const columns of data.getRequiredColumns()) {
      const requiredField: string = columns.key;
      if (typeof (data as any)[requiredField] === Typeof.Boolean) {
        if (
          !(data as any)[requiredField] &&
          (data as any)[requiredField] !== false &&
          data.isDefaultValueColumn(requiredField)
        ) {
          data.setColumnValue(
            requiredField,
            data.getDefaultValueForColumn(requiredField)
          );
        } else {
          throw new BadDataException(`${requiredField} is required`);
        }
      } else if (
        ((data as any)[requiredField] === null ||
          (data as any)[requiredField] === undefined) &&
        data.isDefaultValueColumn(requiredField)
      ) {
        // add default value.
        data.setColumnValue(
          requiredField,
          data.getDefaultValueForColumn(requiredField)
        );
      } else if (
        ((data as any)[requiredField] === null ||
          (data as any)[requiredField] === undefined) &&
        !data.isDefaultValueColumn(requiredField)
      ) {
        throw new BadDataException(`${requiredField} is required`);
      }
    }

    return data;
  }

  public getModel(): TBaseModel {
    return this.model;
  }
}
