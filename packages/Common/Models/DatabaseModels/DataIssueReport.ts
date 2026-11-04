import DataAsset from "./DataAsset";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Someone saying a table's data looks wrong. Whether OneUptime had already
 * raised it is how "caught first" is measured: of the problems people
 * notice, the share it noticed before them.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadDataAsset,
];

const writePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.EditDataAsset,
];

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: [],
};

const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/data-issue-report"))
@OwnedThrough("dataAssetId", DataAsset)
@Entity({
  name: "DataIssueReport",
})
@TableMetadata({
  tableName: "DataIssueReport",
  singularName: "Data Issue Report",
  pluralName: "Data Issue Reports",
  icon: IconProp.Alert,
  tableDescription:
    "Someone saying a table's data looks wrong, and whether OneUptime had already raised it.",
})
@TableAccessControl({
  create: writePermissions,
  read: readPermissions,
  update: [],
  delete: writePermissions,
})
@Index(["projectId", "createdAt"])
export default class DataIssueReport extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this report belongs to.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this report belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataAssetId",
    type: TableColumnType.Entity,
    modelType: DataAsset,
    title: "Table",
    description: "The table whose data looks wrong.",
  })
  @ManyToOne(
    () => {
      return DataAsset;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataAssetId" })
  public dataAsset?: DataAsset = undefined;

  @Index()
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Table ID",
    description: "ID of the table whose data looks wrong.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataAssetId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    title: "What Looks Wrong",
    description: "What looks wrong, in the words of whoever noticed.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public note?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    canReadOnRelationQuery: true,
    title: "Was Caught First",
    description:
      "Whether an alert on this table, or a table upstream of it, was already open when this was reported.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public wasCaughtFirst?: boolean = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Reported By",
    description: "Who reported it.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Reported By User ID",
    description: "ID of who reported it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
