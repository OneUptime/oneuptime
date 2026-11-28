import CloudAccount from "./CloudAccount";
import CloudResource from "./CloudResource";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
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
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A new cloud resource found without a required tag (#11012): which tags
 * it lacks and the value OneUptime suggests for each, who created it (the
 * caller its account's change log names, and the OneUptime user that is,
 * when one is), when it was found, when the people were told, and when it
 * carried every required tag again.
 *
 * One row a resource: a resource is new once. Written only by the watcher
 * (CloudTagWatcher); people read it on Cloud > Tags and an account's Tags.
 */

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/cloud-tag-finding"))
@TableMetadata({
  tableName: "CloudTagFinding",
  singularName: "New Resource Without Required Tags",
  pluralName: "New Resources Without Required Tags",
  icon: IconProp.Tag,
  tableDescription:
    "New cloud resources found without a required tag: which tags each lacks, the value OneUptime suggests, who created it and when they were told.",
})
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@Index(["projectId", "resolvedAt"])
@Entity({
  name: "CloudTagFinding",
})
export default class CloudTagFinding extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
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

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudResourceId",
    type: TableColumnType.Entity,
    modelType: CloudResource,
    title: "Cloud Resource",
    description: "The new resource.",
  })
  @ManyToOne(
    () => {
      return CloudResource;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudResourceId" })
  public cloudResource?: CloudResource = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @Index({ unique: true })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Cloud Resource ID",
    description: "ID of the new resource.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudResourceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudAccountId",
    type: TableColumnType.Entity,
    modelType: CloudAccount,
    title: "Cloud Account",
    description: "The account the resource is in.",
  })
  @ManyToOne(
    () => {
      return CloudAccount;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudAccountId" })
  public cloudAccount?: CloudAccount = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Cloud Account ID",
    description: "ID of the account the resource is in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudAccountId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Missing Tags",
    description:
      "Each required tag the resource lacks or carries a value not allowed for, with the value OneUptime suggests and where it comes from.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public missingTags?: JSONArray = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Created By (Cloud)",
    description:
      "Who created the resource, as its account's change log names the caller: an IAM user or role, an Azure caller, a Google principal.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public creatorActor?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "creatorUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By",
    description:
      "The member of the project who created the resource, when its change log names one by their email.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "creatorUserId" })
  public creatorUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Created By ID",
    description:
      "ID of the member of the project who created the resource, when its change log names one.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public creatorUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Found At",
    description: "When OneUptime found the resource without its tags.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public foundAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "People Told At",
    description:
      "When the people who are told were emailed about it. Empty: not yet.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public notifiedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Tagged At",
    description:
      "When the resource was found carrying every required tag, or gone. Empty: it still lacks one.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public resolvedAt?: Date = undefined;
}
