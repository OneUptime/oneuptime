import EnableRealtimeEventsOn from "../../../Types/Realtime/EnableRealtimeEventsOn";
import Route from "../../../Types/API/Route";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Projection from "../../../Types/AnalyticsDatabase/Projection";
import MaterializedView from "../../../Types/AnalyticsDatabase/MaterializedView";
import {
  ColumnAccessControl,
  TableAccessControl,
} from "../../../Types/BaseDatabase/AccessControl";
import ColumnBillingAccessControl from "../../../Types/BaseDatabase/ColumnBillingAccessControl";
import EnableWorkflowOn from "../../../Types/BaseDatabase/EnableWorkflowOn";
import ModelPermission from "../../../Types/BaseDatabase/ModelPermission";
import TableBillingAccessControl from "../../../Types/BaseDatabase/TableBillingAccessControl";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Text from "../../../Types/Text";
import CommonModel from "./CommonModel";

export type AnalyticsBaseModelType = { new (): AnalyticsBaseModel };

export default class AnalyticsBaseModel extends CommonModel {
  public constructor(data: {
    tableName: string;
    singularName: string;
    pluralName: string;
    tableEngine?: AnalyticsTableEngine | undefined;
    tableColumns: Array<AnalyticsTableColumn>;
    crudApiPath: Route;
    allowAccessIfSubscriptionIsUnpaid?: boolean | undefined;
    tableBillingAccessControl?: TableBillingAccessControl | undefined;
    accessControl?: TableAccessControl | undefined;
    primaryKeys: Array<string>; // this should be the subset of tableColumns
    sortKeys: Array<string>; // this should be the subset of tableColumns
    enableWorkflowOn?: EnableWorkflowOn | undefined;
    enableRealtimeEventsOn?: EnableRealtimeEventsOn | undefined;
    partitionKey: string;
    projections?: Array<Projection> | undefined;
    materializedViews?: Array<MaterializedView> | undefined;
    enableMCP?: boolean | undefined;
  }) {
    super({
      tableColumns: data.tableColumns,
    });

    this.tableName = data.tableName;

    const columns: Array<AnalyticsTableColumn> = [...data.tableColumns];

    if (data.tableEngine) {
      this.tableEngine = data.tableEngine;
    }

    columns.push(
      new AnalyticsTableColumn({
        key: "_id",
        title: "ID",
        description: "ID of this object",
        required: true,
        type: TableColumnType.ObjectID,
      }),
    );

    columns.push(
      new AnalyticsTableColumn({
        key: "createdAt",
        title: "Created",
        description: "Date and Time when the object was created.",
        required: true,
        type: TableColumnType.Date,
      }),
    );

    columns.push(
      new AnalyticsTableColumn({
        key: "updatedAt",
        title: "Updated",
        description: "Date and Time when the object was updated.",
        required: true,
        type: TableColumnType.Date,
      }),
    );

    if (!data.primaryKeys || data.primaryKeys.length === 0) {
      throw new BadDataException("Primary keys are required");
    }

    // check if primary keys are subset of tableColumns

    data.primaryKeys.forEach((primaryKey: string) => {
      const column: AnalyticsTableColumn | undefined = columns.find(
        (column: AnalyticsTableColumn) => {
          return column.key === primaryKey;
        },
      );

      if (!column) {
        throw new BadDataException(
          "Primary key " + primaryKey + " is not part of tableColumns",
        );
      }

      if (!column.required) {
        throw new BadDataException(
          "Primary key " +
            primaryKey +
            " is not required. Primary keys must be required.",
        );
      }
    });

    // check if sort keys are subset of tableColumns

    data.sortKeys.forEach((sortKey: string) => {
      const column: AnalyticsTableColumn | undefined = columns.find(
        (column: AnalyticsTableColumn) => {
          return column.key === sortKey;
        },
      );

      if (!column) {
        throw new BadDataException(
          "Sort key " + sortKey + " is not part of tableColumns",
        );
      }
    });

    this.primaryKeys = data.primaryKeys;
    this.sortKeys = data.sortKeys;
    this.tableColumns = columns;
    this.singularName = data.singularName;
    this.pluralName = data.pluralName;
    this.tableBillingAccessControl = data.tableBillingAccessControl;
    this.allowAccessIfSubscriptionIsUnpaid =
      data.allowAccessIfSubscriptionIsUnpaid || false;
    this.accessControl = data.accessControl;
    this.enableWorkflowOn = data.enableWorkflowOn;
    this.crudApiPath = data.crudApiPath;
    this.enableRealtimeEventsOn = data.enableRealtimeEventsOn;
    this.partitionKey = data.partitionKey;
    this.projections = data.projections || [];
    this.materializedViews = data.materializedViews || [];
    this.enableMCP = data.enableMCP || false;
  }

  private _enableWorkflowOn: EnableWorkflowOn | undefined;
  public get enableWorkflowOn(): EnableWorkflowOn | undefined {
    return this._enableWorkflowOn;
  }
  public set enableWorkflowOn(v: EnableWorkflowOn | undefined) {
    this._enableWorkflowOn = v;
  }

  private _accessControl: TableAccessControl | undefined;
  public get accessControl(): TableAccessControl | undefined {
    return this._accessControl;
  }
  public set accessControl(v: TableAccessControl | undefined) {
    this._accessControl = v;
  }

  private _tableEngine: AnalyticsTableEngine = AnalyticsTableEngine.MergeTree;
  public get tableEngine(): AnalyticsTableEngine {
    return this._tableEngine;
  }
  public set tableEngine(v: AnalyticsTableEngine) {
    this._tableEngine = v;
  }

  private _enableRealtimeEventsOn: EnableRealtimeEventsOn | undefined;
  public get enableRealtimeEventsOn(): EnableRealtimeEventsOn | undefined {
    return this._enableRealtimeEventsOn;
  }
  public set enableRealtimeEventsOn(v: EnableRealtimeEventsOn | undefined) {
    this._enableRealtimeEventsOn = v;
  }

  private _primaryKeys: Array<string> = [];
  public get primaryKeys(): Array<string> {
    return this._primaryKeys;
  }
  public set primaryKeys(v: Array<string>) {
    this._primaryKeys = v;
  }

  private _partitionKey: string = "";
  public get partitionKey(): string {
    return this._partitionKey;
  }
  public set partitionKey(v: string) {
    this._partitionKey = v;
  }

  private _sortKeys: Array<string> = [];
  public get sortKeys(): Array<string> {
    return this._sortKeys;
  }
  public set sortKeys(v: Array<string>) {
    this._sortKeys = v;
  }

  private _singularName: string = "";
  public get singularName(): string {
    return this._singularName;
  }
  public set singularName(v: string) {
    this._singularName = v;
  }

  private _pluralName: string = "";
  public get pluralName(): string {
    return this._pluralName;
  }
  public set pluralName(v: string) {
    this._pluralName = v;
  }

  private _tableBillingAccessControl: TableBillingAccessControl | undefined;
  public get tableBillingAccessControl():
    | TableBillingAccessControl
    | undefined {
    return this._tableBillingAccessControl;
  }
  public set tableBillingAccessControl(
    v: TableBillingAccessControl | undefined,
  ) {
    this._tableBillingAccessControl = v;
  }

  private _allowAccessIfSubscriptionIsUnpaid: boolean = false;
  public get allowAccessIfSubscriptionIsUnpaid(): boolean {
    return this._allowAccessIfSubscriptionIsUnpaid;
  }
  public set allowAccessIfSubscriptionIsUnpaid(v: boolean) {
    this._allowAccessIfSubscriptionIsUnpaid = v;
  }

  private _tableName: string = "";
  public get tableName(): string {
    return this._tableName;
  }
  public set tableName(v: string) {
    this._tableName = v;
  }

  private _crudApiPath!: Route;
  public get crudApiPath(): Route {
    return this._crudApiPath;
  }
  public set crudApiPath(v: Route) {
    this._crudApiPath = v;
  }

  private _projections: Array<Projection> = [];
  public get projections(): Array<Projection> {
    return this._projections;
  }
  public set projections(v: Array<Projection>) {
    this._projections = v;
  }

  private _materializedViews: Array<MaterializedView> = [];
  public get materializedViews(): Array<MaterializedView> {
    return this._materializedViews;
  }
  public set materializedViews(v: Array<MaterializedView>) {
    this._materializedViews = v;
  }

  private _enableMCP: boolean = false;
  public get enableMCP(): boolean {
    return this._enableMCP;
  }
  public set enableMCP(v: boolean) {
    this._enableMCP = v;
  }

  public getTenantColumn(): AnalyticsTableColumn | null {
    const column: AnalyticsTableColumn | undefined = this.tableColumns.find(
      (column: AnalyticsTableColumn) => {
        return column.isTenantId;
      },
    );

    if (!column) {
      return null;
    }

    return column;
  }

  public getTenantColumnValue(): ObjectID | null {
    const column: AnalyticsTableColumn | null = this.getTenantColumn();

    if (!column) {
      return null;
    }

    return this.getColumnValue(column.key) as ObjectID | null;
  }

  public getRequiredColumns(): Array<AnalyticsTableColumn> {
    return this.tableColumns.filter((column: AnalyticsTableColumn) => {
      return column.required;
    });
  }

  public isDefaultValueColumn(columnName: string): boolean {
    const column: AnalyticsTableColumn | null = this.getTableColumn(columnName);

    if (!column) {
      return false;
    }

    return column.isDefaultValueColumn;
  }

  public getDefaultValueForColumn(columnName: string): JSONValue {
    const column: AnalyticsTableColumn | null = this.getTableColumn(columnName);

    if (!column) {
      throw new BadDataException("Column " + columnName + " not found");
    }

    return column.defaultValue;
  }

  public getColumnBillingAccessControl(
    columnName: string,
  ): ColumnBillingAccessControl | null {
    const column: AnalyticsTableColumn | null = this.getTableColumn(columnName);

    if (!column) {
      return null;
    }

    return column.billingAccessControl || null;
  }

  public get id(): ObjectID | undefined {
    return this.getColumnValue("_id") as ObjectID | undefined;
  }
  public set id(v: ObjectID | undefined) {
    this.setColumnValue("_id", v);
  }

  public get _id(): ObjectID | undefined {
    return this.getColumnValue("_id") as ObjectID | undefined;
  }
  public set _id(v: ObjectID | undefined) {
    this.setColumnValue("_id", v);
  }

  public get createdAt(): Date | undefined {
    return this.getColumnValue("createdAt") as Date | undefined;
  }

  public set createdAt(v: Date | undefined) {
    this.setColumnValue("createdAt", v);
  }

  public get updatedAt(): Date | undefined {
    return this.getColumnValue("updatedAt") as Date | undefined;
  }

  public set updatedAt(v: Date | undefined) {
    this.setColumnValue("updatedAt", v);
  }

  public getAPIDocumentationPath(): string {
    return Text.pascalCaseToDashes(this.tableName);
  }

  public getColumnAccessControlFor(
    columnName: string,
  ): ColumnAccessControl | null {
    const tableColumn: AnalyticsTableColumn | undefined =
      this.tableColumns.find((column: AnalyticsTableColumn) => {
        return column.key === columnName;
      });

    if (!tableColumn || !tableColumn.accessControl) {
      return null;
    }

    return tableColumn.accessControl;
  }

  public getColumnAccessControlForAllColumns(): Dictionary<ColumnAccessControl> {
    const dictionary: Dictionary<ColumnAccessControl> = {};

    for (const column of this.tableColumns) {
      if (column.accessControl) {
        dictionary[column.key] = column.accessControl;
      }
    }

    return dictionary;
  }

  public getReadPermissions(): Array<Permission> {
    return this.accessControl?.read || [];
  }

  public getCreatePermissions(): Array<Permission> {
    return this.accessControl?.create || [];
  }

  public getUpdatePermissions(): Array<Permission> {
    return this.accessControl?.update || [];
  }

  public getDeletePermissions(): Array<Permission> {
    return this.accessControl?.delete || [];
  }

  public getReadBillingPlan(): PlanType | null {
    return this.tableBillingAccessControl?.read || null;
  }

  public getCreateBillingPlan(): PlanType | null {
    return this.tableBillingAccessControl?.create || null;
  }

  public getUpdateBillingPlan(): PlanType | null {
    return this.tableBillingAccessControl?.update || null;
  }

  public getDeleteBillingPlan(): PlanType | null {
    return this.tableBillingAccessControl?.delete || null;
  }

  public isEntityColumn(_columnName: string): boolean {
    // Analytics model does not suppprt entity columns.
    return false;
  }

  public hasColumn(columnName: string): boolean {
    return this.tableColumns.some((column: AnalyticsTableColumn) => {
      return column.key === columnName;
    });
  }

  public isFileColumn(_columnName: string): boolean {
    // Analytics model does not suppprt file columns.
    return false;
  }

  public hasCreatePermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    columnName?: string,
  ): boolean {
    let modelPermission: Array<Permission> = this.accessControl?.create || [];

    if (columnName) {
      const columnAccessControl: ColumnAccessControl | null =
        this.getColumnAccessControlFor(columnName);
      if (columnAccessControl) {
        modelPermission = columnAccessControl.create;
      }
    }

    return ModelPermission.hasPermissions(
      userProjectPermissions,
      modelPermission,
    );
  }

  public hasReadPermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    columnName?: string,
  ): boolean {
    let modelPermission: Array<Permission> = this.accessControl?.read || [];

    if (columnName) {
      const columnAccessControl: ColumnAccessControl | null =
        this.getColumnAccessControlFor(columnName);
      if (columnAccessControl) {
        modelPermission = columnAccessControl.read;
      }
    }

    return ModelPermission.hasPermissions(
      userProjectPermissions,
      modelPermission,
    );
  }

  public hasDeletePermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
  ): boolean {
    const modelPermission: Array<Permission> = this.accessControl?.delete || [];
    return ModelPermission.hasPermissions(
      userProjectPermissions,
      modelPermission,
    );
  }

  public hasUpdatePermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    columnName?: string,
  ): boolean {
    let modelPermission: Array<Permission> = this.accessControl?.update || [];

    if (columnName) {
      const columnAccessControl: ColumnAccessControl | null =
        this.getColumnAccessControlFor(columnName);
      if (columnAccessControl) {
        modelPermission = columnAccessControl.update;
      }
    }

    return ModelPermission.hasPermissions(
      userProjectPermissions,
      modelPermission,
    );
  }
}
