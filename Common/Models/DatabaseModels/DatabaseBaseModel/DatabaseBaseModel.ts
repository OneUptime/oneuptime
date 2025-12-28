import EnableRealtimeEventsOn from "../../../Types/Realtime/EnableRealtimeEventsOn";
import Route from "../../../Types/API/Route";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ColumnBillingAccessControl from "../../../Types/BaseDatabase/ColumnBillingAccessControl";
import EnableWorkflowOn from "../../../Types/BaseDatabase/EnableWorkflowOn";
import ModelPermission from "../../../Types/BaseDatabase/ModelPermission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import { getColumnBillingAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnBillingAccessControl";
import Columns from "../../../Types/Database/Columns";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumn, {
  TableColumnMetadata,
  getTableColumn,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getFirstColorFieldColumn } from "../../../Types/Database/ColorField";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import PositiveNumber from "../../../Types/PositiveNumber";
import Text from "../../../Types/Text";
import {
  BaseEntity,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from "typeorm";

export type DbTypes =
  | string
  | number
  | PositiveNumber
  | Email
  | HashedString
  | URL
  | Phone
  | JSONObject
  | ObjectID
  | JSONArray
  | Buffer;

export default class DatabaseBaseModel extends BaseEntity {
  @TableColumn({
    title: "ID",
    type: TableColumnType.ObjectID,
    description: "ID of this object",
    computed: true,
    canReadOnRelationQuery: true,
  })
  @PrimaryGeneratedColumn("uuid")
  public _id?: string = undefined;

  @TableColumn({
    title: "Created At",
    type: TableColumnType.Date,
    computed: true,
    description: "Date and Time when the object was created.",
  })
  @CreateDateColumn({
    type: ColumnType.Date,
  })
  public createdAt?: Date = undefined;

  @TableColumn({
    title: "Updated At",
    type: TableColumnType.Date,
    computed: true,
    description: "Date and Time when the object was updated.",
  })
  @UpdateDateColumn({
    type: ColumnType.Date,
  })
  public updatedAt?: Date = undefined;

  @TableColumn({
    title: "Deleted At",
    type: TableColumnType.Date,
    computed: true,
    description: "Date and Time when the object was deleted.",
  })
  @DeleteDateColumn({
    type: ColumnType.Date,
  })
  public deletedAt?: Date = undefined;

  @TableColumn({
    title: "Version",
    type: TableColumnType.Number,
    computed: true,
    description: "Object version",
    hideColumnInDocumentation: true,
  })
  @VersionColumn()
  public version?: number = undefined;

  public createRecordPermissions!: Array<Permission>;
  public readRecordPermissions!: Array<Permission>;
  public deleteRecordPermissions!: Array<Permission>;
  public updateRecordPermissions!: Array<Permission>;

  // Billing Plans.
  public createBillingPlan!: PlanType | null;
  public readBillingPlan!: PlanType | null;
  public updateBillingPlan!: PlanType | null;
  public deleteBillingPlan!: PlanType | null;

  public allowAccessIfSubscriptionIsUnpaid!: boolean;

  public enableWorkflowOn!: EnableWorkflowOn;

  public enableDocumentation!: boolean;
  public isMasterAdminApiDocs!: boolean;

  public enableMCP!: boolean;

  public currentUserCanAccessColumnBy!: string | null;
  public slugifyColumn!: string | null;
  public saveSlugToColumn!: string | null;
  public singularName!: string | null;
  public pluralName!: string | null;

  // realtime events.
  public enableRealtimeEventsOn!: EnableRealtimeEventsOn | null;

  // total items  by
  public totalItemsByColumnName!: string | null;
  public totalItemsNumber!: number | null;
  public totalItemsErrorMessage!: string | null;

  public isPermissionIf: Dictionary<JSONObject> = {};

  public isMultiTenantRequestAllowed!: boolean | null;
  public allowUserQueryWithoutTenant!: boolean | null;

  public crudApiPath!: Route | null;

  // If this resource is by projectId, which column does projectId belong to?
  public tenantColumn!: string | null;

  public accessControlColumn!: string | null;

  public icon!: IconProp | null;

  public tableDescription!: string | null;

  public tableName!: string | null;

  public canAccessIfCanReadOn!: string | null;

  public constructor(id?: ObjectID) {
    super();
    if (id) {
      this.id = id;
    }
  }

  public getHashedColumns(): Columns {
    const dictionary: Dictionary<TableColumnMetadata> = getTableColumns(this);
    const columns: Array<string> = [];
    for (const key in dictionary) {
      if (dictionary[key]?.hashed) {
        columns.push(key);
      }
    }

    return new Columns(columns);
  }

  public getDisplayColumnPlaceholderAs(columnName: string): string | null {
    return getTableColumn(this, columnName)?.placeholder || null;
  }

  public getDisplayColumnTitleAs(columnName: string): string | null {
    return getTableColumn(this, columnName)?.title || null;
  }

  public getDisplayColumnDescriptionAs(columnName: string): string | null {
    return getTableColumn(this, columnName)?.description || null;
  }

  public getEncryptedColumns(): Columns {
    const dictionary: Dictionary<TableColumnMetadata> = getTableColumns(this);
    const columns: Array<string> = [];
    for (const key in dictionary) {
      if (dictionary[key]?.encrypted) {
        columns.push(key);
      }
    }

    return new Columns(columns);
  }

  public getTableColumns(): Columns {
    return new Columns(Object.keys(getTableColumns(this)));
  }

  public getFirstColorColumn(): string | null {
    return getFirstColorFieldColumn(this);
  }

  public canQueryMultiTenant(): boolean {
    return Boolean(this.isMultiTenantRequestAllowed);
  }

  public isUserQueryWithoutTenantAllowed(): boolean {
    return Boolean(this.allowUserQueryWithoutTenant);
  }

  public getTableColumnMetadata(columnName: string): TableColumnMetadata {
    const dictionary: Dictionary<TableColumnMetadata> = getTableColumns(this);
    return dictionary[columnName] as TableColumnMetadata;
  }

  public hasColumn(columnName: string): boolean {
    return Boolean(getTableColumn(this, columnName));
  }

  public getColumnBillingAccessControl(
    columnName: string,
  ): ColumnBillingAccessControl {
    const dictionary: Dictionary<ColumnBillingAccessControl> =
      getColumnBillingAccessControlForAllColumns(this);
    return dictionary[columnName] as ColumnBillingAccessControl;
  }

  public getColumnAccessControlFor(
    columnName: string,
  ): ColumnAccessControl | null {
    return this.getColumnAccessControlForAllColumns()[columnName] || null;
  }

  public getColumnAccessControlForAllColumns(): Dictionary<ColumnAccessControl> {
    const dictionary: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(this);

    const defaultColumns: Array<string> = [
      "_id",
      "createdAt",
      "deletedAt",
      "updatedAt",
    ];

    for (const key of defaultColumns) {
      dictionary[key] = {
        read: this.readRecordPermissions,
        create: this.createRecordPermissions,
        update: this.updateRecordPermissions,
      };
    }

    return dictionary;
  }

  public hasValue(columnName: string): boolean {
    return Boolean((this as any)[columnName]);
  }

  public getValue<T extends DbTypes>(columnName: string): T {
    return (this as any)[columnName] as T;
  }

  public setValue<T extends DbTypes>(columnName: string, value: T): void {
    (this as any)[columnName] = value;
  }

  public removeValue(columnName: string): void {
    (this as any)[columnName] = undefined;
  }

  public doesPermissionHaveConditions(
    permission: Permission,
  ): JSONObject | null {
    return this.isPermissionIf[permission]
      ? (this.isPermissionIf[permission] as JSONObject)
      : null;
  }

  public getUniqueColumns(): Columns {
    const dictionary: Dictionary<TableColumnMetadata> = getTableColumns(this);
    const columns: Array<string> = [];
    for (const key in dictionary) {
      if (dictionary[key]?.unique) {
        columns.push(key);
      }
    }

    return new Columns(columns);
  }

  public setSlugifyColumn(columnName: string): void {
    this.slugifyColumn = columnName;
  }

  public getTotalItemsByColumnName(): string | null {
    return this.totalItemsByColumnName;
  }

  public getTotalItemsByErrorMessage(): string | null {
    return this.totalItemsErrorMessage;
  }

  public getTotalItemsNumber(): number | null {
    return this.totalItemsNumber;
  }

  public getRequiredColumns(): Columns {
    const dictionary: Dictionary<TableColumnMetadata> = getTableColumns(this);
    const columns: Array<string> = [];
    for (const key in dictionary) {
      if (dictionary[key]?.required) {
        columns.push(key);
      }
    }

    return new Columns(columns);
  }

  public getSlugifyColumn(): string | null {
    return this.slugifyColumn;
  }

  public getCrudApiPath(): Route | null {
    return this.crudApiPath;
  }

  public getSaveSlugToColumn(): string | null {
    return this.saveSlugToColumn;
  }

  public getTenantColumn(): string | null {
    return this.tenantColumn;
  }

  public getAccessControlColumn(): string | null {
    return this.accessControlColumn;
  }

  public getUserColumn(): string | null {
    return this.currentUserCanAccessColumnBy;
  }

  public get id(): ObjectID | null {
    return this._id ? new ObjectID(this._id) : null;
  }

  public set id(value: ObjectID | null) {
    if (value) {
      this._id = value.toString();
    }
  }

  public isDefaultValueColumn(columnName: string): boolean {
    return Boolean(getTableColumn(this, columnName).isDefaultValueColumn);
  }

  public getColumnValue(
    columnName: string,
  ): JSONValue | DatabaseBaseModel | Array<DatabaseBaseModel> | null {
    if (getTableColumn(this, columnName) && (this as any)[columnName]) {
      return (this as any)[columnName] as JSONValue;
    }

    return null;
  }

  public setColumnValue(
    columnName: string,
    value: JSONValue | DatabaseBaseModel | Array<DatabaseBaseModel>,
  ): void {
    if (getTableColumn(this, columnName)) {
      return ((this as any)[columnName] = value as any);
    }
  }

  public isTableColumn(columnName: string): boolean {
    return Boolean(getTableColumn(this, columnName));
  }

  public isEntityColumn(columnName: string): boolean {
    const tableColumnType: TableColumnMetadata = getTableColumn(
      this,
      columnName,
    );

    if (!tableColumnType) {
      throw new BadDataException(
        "TableColumnMetadata not found for " + columnName + " column",
      );
    }

    return Boolean(
      tableColumnType.type === TableColumnType.Entity ||
        tableColumnType.type === TableColumnType.EntityArray,
    );
  }

  public isHashedStringColumn(columnName: string): boolean {
    const tableColumnType: TableColumnMetadata = getTableColumn(
      this,
      columnName,
    );

    if (!tableColumnType) {
      throw new BadDataException(
        "TableColumnMetadata not found for " + columnName + " column",
      );
    }

    return Boolean(tableColumnType.type === TableColumnType.HashedString);
  }

  public isFileColumn(columnName: string): boolean {
    const tableColumnType: TableColumnMetadata = getTableColumn(
      this,
      columnName,
    );

    if (!tableColumnType || !tableColumnType.modelType) {
      return false;
    }

    const fileModel: DatabaseBaseModel = new tableColumnType.modelType();

    if (fileModel.isFileModel()) {
      return true;
    }

    return false;
  }

  public hasPermission(_permissions: Array<Permission>): boolean {
    return false;
  }

  public isTenantModel(): boolean {
    return false;
  }

  public isFileModel(): boolean {
    return false;
  }

  public isAccessControlModel(): boolean {
    return false;
  }

  public isUserModel(): boolean {
    return false;
  }

  public hasCreatePermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    columnName?: string,
  ): boolean {
    let modelPermission: Array<Permission> = this.createRecordPermissions;

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

  public getReadPermissions(): Array<Permission> {
    return this.readRecordPermissions;
  }

  public getReadBillingPlan(): PlanType | null {
    return this.readBillingPlan;
  }

  public getCreateBillingPlan(): PlanType | null {
    return this.createBillingPlan;
  }

  public getUpdateBillingPlan(): PlanType | null {
    return this.updateBillingPlan;
  }

  public getDeleteBillingPlan(): PlanType | null {
    return this.deleteBillingPlan;
  }

  public getCreatePermissions(): Array<Permission> {
    return this.createRecordPermissions;
  }

  public getUpdatePermissions(): Array<Permission> {
    return this.updateRecordPermissions;
  }

  public getDeletePermissions(): Array<Permission> {
    return this.deleteRecordPermissions;
  }

  public hasReadPermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    columnName?: string,
  ): boolean {
    let modelPermission: Array<Permission> = this.readRecordPermissions;

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
    const modelPermission: Array<Permission> = this.deleteRecordPermissions;
    return ModelPermission.hasPermissions(
      userProjectPermissions,
      modelPermission,
    );
  }

  public hasUpdatePermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    columnName?: string,
  ): boolean {
    let modelPermission: Array<Permission> = this.updateRecordPermissions;

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

  public getAPIDocumentationPath(): string {
    return Text.pascalCaseToDashes(this.tableName as string);
  }

  public static toJSON(
    model: DatabaseBaseModel,
    modelType: DatabaseBaseModelType,
  ): JSONObject {
    const json: JSONObject = this.toJSONObject(model, modelType);
    return JSONFunctions.serialize(json);
  }

  public static toJSONObject(
    model: DatabaseBaseModel,
    modelType: DatabaseBaseModelType,
  ): JSONObject {
    const json: JSONObject = {};

    const vanillaModel: DatabaseBaseModel = new modelType();

    for (const key of vanillaModel.getTableColumns().columns) {
      if ((model as any)[key] === undefined) {
        continue;
      }

      const tableColumnMetadata: TableColumnMetadata =
        vanillaModel.getTableColumnMetadata(key);

      if (tableColumnMetadata) {
        if (
          (model as any)[key] &&
          tableColumnMetadata.modelType &&
          tableColumnMetadata.type === TableColumnType.Entity &&
          (model as any)[key] instanceof DatabaseBaseModel
        ) {
          (json as any)[key] = this.toJSONObject(
            (model as any)[key],
            tableColumnMetadata.modelType,
          );
        } else if (
          (model as any)[key] &&
          Array.isArray((model as any)[key]) &&
          (model as any)[key].length > 0 &&
          tableColumnMetadata.modelType &&
          tableColumnMetadata.type === TableColumnType.EntityArray
        ) {
          (json as any)[key] = this.toJSONObjectArray(
            (model as any)[key] as Array<DatabaseBaseModel>,
            tableColumnMetadata.modelType,
          );
        } else {
          (json as any)[key] = (model as any)[key];
        }
      }
    }

    return json;
  }

  public static toJSONObjectArray(
    list: Array<DatabaseBaseModel>,
    modelType: DatabaseBaseModelType,
  ): JSONArray {
    const array: JSONArray = [];

    for (const item of list) {
      array.push(this.toJSONObject(item, modelType));
    }

    return array;
  }

  public static toJSONArray(
    list: Array<DatabaseBaseModel>,
    modelType: DatabaseBaseModelType,
  ): JSONArray {
    const array: JSONArray = [];

    for (const item of list) {
      array.push(this.toJSON(item, modelType));
    }

    return array;
  }

  private static _fromJSON<T extends DatabaseBaseModel>(
    json: JSONObject | T,
    type: { new (): T },
  ): T {
    if (json instanceof DatabaseBaseModel) {
      return json;
    }

    json = JSONFunctions.deserialize(json);
    const baseModel: T = new type();

    for (let key of Object.keys(json)) {
      if (key === "id") {
        key = "_id";
        json["_id"] = json["id"];
        delete json["id"];
      }

      const tableColumnMetadata: TableColumnMetadata =
        baseModel.getTableColumnMetadata(key);
      if (tableColumnMetadata) {
        if (
          json[key] &&
          tableColumnMetadata.modelType &&
          tableColumnMetadata.type === TableColumnType.Entity
        ) {
          if (
            json[key] &&
            Array.isArray(json[key]) &&
            (json[key] as Array<any>).length > 0
          ) {
            json[key] = (json[key] as Array<any>)[0];
          }

          (baseModel as any)[key] = this.fromJSON(
            json[key] as JSONObject,
            tableColumnMetadata.modelType,
          );
        } else if (
          json[key] &&
          tableColumnMetadata.modelType &&
          tableColumnMetadata.type === TableColumnType.EntityArray
        ) {
          if (json[key] && !Array.isArray(json[key])) {
            json[key] = [json[key]];
          }

          (baseModel as any)[key] = this.fromJSONArray(
            json[key] as JSONArray,
            tableColumnMetadata.modelType,
          );
        } else {
          (baseModel as any)[key] = json[key];
        }
      }
    }

    return baseModel as T;
  }

  public static fromJSON<T extends DatabaseBaseModel>(
    json: JSONObject | JSONArray | DatabaseBaseModel | Array<DatabaseBaseModel>,
    type: { new (): T },
  ): T | Array<T> {
    if (Array.isArray(json)) {
      const arr: Array<T> = [];

      for (const item of json) {
        if (item instanceof DatabaseBaseModel) {
          arr.push(item as T);
          continue;
        }

        arr.push(this._fromJSON<T>(item, type));
      }

      return arr;
    }

    if (json instanceof DatabaseBaseModel) {
      return json as T;
    }

    return this._fromJSON<T>(json, type);
  }

  public static fromJSONObject<T extends DatabaseBaseModel>(
    json: JSONObject | T,
    type: { new (): T },
  ): T {
    if (json instanceof DatabaseBaseModel) {
      return json;
    }

    return this.fromJSON<T>(json, type) as T;
  }

  public static fromJSONArray<T extends DatabaseBaseModel>(
    json: Array<JSONObject | T>,
    type: { new (): T },
  ): Array<T> {
    const arr: Array<T> = [];

    for (const item of json) {
      arr.push(this._fromJSON<T>(item, type));
    }

    return arr;
  }
}

export type DatabaseBaseModelType = { new (): DatabaseBaseModel };
