import CloudApp from "./CloudApp";
import CloudResource from "./CloudResource";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One revision an App Platforms app ran: an ECS task definition revision, a
 * Cloud Run revision, an App Engine version, a Container Apps revision, or
 * the service.version an app reports where its platform names none. Written
 * by the telemetry ingest the first time an instance reports it, and
 * refreshed while instances still do. A revision recorded after the app's
 * first is a deploy: it names the revision the app ran before it.
 *
 * Together they are the app's deploy history - what changed and when - the
 * way a Kubernetes Deployment's ReplicaSets are. Not user-editable.
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/cloud-app-revision"))
@TableMetadata({
  tableName: "CloudAppRevision",
  singularName: "App Revision",
  pluralName: "App Revisions",
  icon: IconProp.Cube,
  tableDescription:
    "The revisions an App Platforms app ran, as its instances reported them: its deploy history. Written by the ingest pipeline; not user-editable.",
})
@Index(["projectId", "cloudAppId", "revision"], {
  unique: true,
})
@Entity({
  name: "CloudAppRevision",
})
export default class CloudAppRevision extends BaseModel {
  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project this revision belongs to.",
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

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the Project this revision belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "cloudResourceId",
    type: TableColumnType.Entity,
    modelType: CloudResource,
    title: "Cloud Environment",
    description: "The App Platforms environment the app runs in.",
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

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Cloud Environment ID",
    description: "ID of the App Platforms environment the app runs in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudResourceId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "cloudAppId",
    type: TableColumnType.Entity,
    modelType: CloudApp,
    title: "App",
    description: "The app that ran this revision.",
  })
  @ManyToOne(
    () => {
      return CloudApp;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudAppId" })
  public cloudApp?: CloudApp = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "App ID",
    description: "ID of the app that ran this revision.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudAppId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Revision",
    description:
      "The revision as the platform names it: a task definition revision, a Cloud Run revision, a version.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public revision?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Previous Revision",
    description:
      "The revision the app ran before this one was deployed. Empty for the first revision OneUptime saw.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public previousRevision?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "First Seen At",
    description:
      "When an instance first reported this revision: when it was deployed.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public firstSeenAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description: "When an instance last reported this revision.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Service Version",
    description: "The service.version the revision's instances reported.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public serviceVersion?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Image",
    description:
      "The container image and tag the revision's instances reported.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public image?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this row (ingest writes as root).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this row.",
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this row.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
