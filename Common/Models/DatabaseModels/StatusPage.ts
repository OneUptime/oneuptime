import File from "./File";
import Label from "./Label";
import MonitorStatus from "./MonitorStatus";
import Project from "./Project";
import ProjectCallSMSConfig from "./ProjectCallSMSConfig";
import ProjectSmtpConfig from "./ProjectSmtpConfig";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import Color from "../../Types/Color";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import ColumnBillingAccessControl from "../../Types/Database/AccessControl/ColumnBillingAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import Recurring from "../../Types/Events/Recurring";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Timezone from "../../Types/Timezone";
import HashedString from "../../Types/HashedString";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";

@EnableDocumentation()
@EnableMCP()
@AccessControlColumn("labels")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateProjectStatusPage,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadProjectStatusPage,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteProjectStatusPage,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditProjectStatusPage,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/status-page"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "StatusPage",
})
@TableMetadata({
  tableName: "StatusPage",
  singularName: "Status Page",
  pluralName: "Status Pages",
  icon: IconProp.CheckCircle,
  tableDescription: "Manage status pages for your project.",
})
export default class StatusPage extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @UniqueColumnBy("projectId")
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "Any friendly name of this object",
    canReadOnRelationQuery: true,
    example: "Acme Corp Status Page",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Page Title",
    description: "Title of your Status Page. This is used for SEO.",
    example: "Acme Corp System Status",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public pageTitle?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Page Description",
    description: "Description of your Status Page. This is used for SEO.",
    example:
      "Current status and uptime information for all Acme Corp services and infrastructure.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public pageDescription?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example: "Public status page for Acme Corp customer-facing services",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
    unique: true,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Relation to Labels Array where this object is categorized in.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "StatusPageLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "statusPageId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  //// Branding Files.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "faviconFileId",
    type: TableColumnType.Entity,
    modelType: File,
    title: "Favicon",
    description: "Status Page Favicon",
  })
  @ManyToOne(
    () => {
      return File;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "faviconFileId" })
  public faviconFile?: File = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Favicon",
    description: "Status Page Favicon File ID",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public faviconFileId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "logoFileId",
    type: TableColumnType.Entity,
    modelType: File,
    title: "Logo",
    description: "Status Page Logo",
  })
  @ManyToOne(
    () => {
      return File;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "logoFileId" })
  public logoFile?: File = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Logo",
    description: "Status Page Logo File ID",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public logoFileId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "coverImageFileId",
    type: TableColumnType.Entity,
    modelType: File,
    title: "Cover Image",
    description: "Status Page Cover Image",
  })
  @ManyToOne(
    () => {
      return File;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "coverImageFileId" })
  public coverImageFile?: File = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Cover Image",
    description: "Status Page Cover Image ID",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public coverImageFileId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.HTML,
    title: "Header HTML",
    description: "Status Page Custom HTML Header",
  })
  @Column({
    nullable: true,
    type: ColumnType.HTML,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public headerHTML?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.HTML,
    title: "Footer HTML",
    description: "Status Page Custom HTML Footer",
  })
  @Column({
    nullable: true,
    type: ColumnType.HTML,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public footerHTML?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.CSS,
    title: "CSS",
    description: "Status Page Custom CSS Header",
  })
  @Column({
    nullable: true,
    type: ColumnType.CSS,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public customCSS?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JavaScript,
    title: "JavaScript",
    description:
      "Status Page Custom JavaScript. This runs when the status page is loaded.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JavaScript,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public customJavaScript?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Public Status Page",
    description: "Is this status page public?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public isPublicStatusPage?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Master Password",
    description:
      "Require visitors to enter a master password before viewing a private status page.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public enableMasterPassword?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],

    // This is a hashed column. So, reading the value is does not affect anything.
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    title: "Master Password",
    description:
      "Password required to unlock a private status page. This value is stored as a secure hash.",
    hashed: true,
    type: TableColumnType.HashedString,
    placeholder: "Enter a new master password",
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    nullable: true,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public masterPassword?: HashedString = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show Incident Labels",
    description: "Show Incident Labels on Status Page?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public showIncidentLabelsOnStatusPage?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show Scheduled Event Labels",
    description: "Show Scheduled Event Labels on Status Page?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public showScheduledEventLabelsOnStatusPage?: boolean = undefined;

  // This column is Deprectaed.
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Subscribers",
    description: "Can subscribers subscribe to this Status Page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public enableSubscribers?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Email Subscribers",
    description: "Can email subscribers subscribe to this Status Page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public enableEmailSubscribers?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Allow Subscribers to Choose Resources",
    description: "Can subscribers choose which resources to subscribe to?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Free,
  })
  public allowSubscribersToChooseResources?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Allow Subscribers to subscribe to event types",
    description:
      "Can subscribers choose which event type like Announcements, Incidents, Scheduled Events to subscribe to?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Free,
  })
  public allowSubscribersToChooseEventTypes?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable SMS Subscribers",
    description: "Can SMS subscribers subscribe to this Status Page?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public enableSmsSubscribers?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Slack Subscribers",
    description: "Can Slack subscribers subscribe to this Status Page?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Free,
  })
  public enableSlackSubscribers?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Microsoft Teams Subscribers",
    description:
      "Can Microsoft Teams subscribers subscribe to this Status Page?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Free,
  })
  public enableMicrosoftTeamsSubscribers?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.ShortText,
    title: "Copyright Text",
    description: "Copyright Text",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
  })
  public copyrightText?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Custom Fields",
    description: "Custom Fields on this resource.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public customFields?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.Public,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    isDefaultValueColumn: true,
    description: "Should SSO be required to login to Private Status Page",
    title: "Require SSO",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public requireSsoForLogin?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "smtpConfigId",
    type: TableColumnType.Entity,
    modelType: ProjectSmtpConfig,
    title: "SMTP Config",
    description:
      "Relation to SMTP Config Resource which is used to send email to subscribers.",
  })
  @ManyToOne(
    () => {
      return ProjectSmtpConfig;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "smtpConfigId" })
  public smtpConfig?: ProjectSmtpConfig = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "SMTP Config ID",
    description:
      "ID of your SMTP Config Resource which is used to send email to subscribers.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public smtpConfigId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "callSmsConfigId",
    type: TableColumnType.Entity,
    modelType: ProjectCallSMSConfig,
    title: "Call/SMS Config",
    description:
      "Relation to Call/SMS Config Resource which is used to send SMS to subscribers.",
  })
  @ManyToOne(
    () => {
      return ProjectCallSMSConfig;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "callSmsConfigId" })
  public callSmsConfig?: ProjectCallSMSConfig = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Call/SMS Config ID",
    description:
      "ID of your Call/SMS Config Resource which is used to send SMS to subscribers.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public callSmsConfigId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    hideColumnInDocumentation: true,
    required: true,
    isDefaultValueColumn: true,
    title: "Are Owners Notified Of Resource Creation?",
    description: "Are owners notified of when this resource is created?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isOwnerNotifiedOfResourceCreation?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    isDefaultValueColumn: true,
    defaultValue: 14,
    title: "Show incident history in days",
    description:
      "How many days of incident history should be shown on the status page (in days)?",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 14,
  })
  public showIncidentHistoryInDays?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    isDefaultValueColumn: true,
    defaultValue: 14,
    title: "Show announcement history in days",
    description:
      "How many days of announcement history should be shown on the status page (in days)?",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 14,
  })
  public showAnnouncementHistoryInDays?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    isDefaultValueColumn: true,
    defaultValue: 14,
    title: "Show scheduled event history in days",
    description:
      "How many days of scheduled event history should be shown on the status page (in days)?",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 14,
  })
  public showScheduledEventHistoryInDays?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    isDefaultValueColumn: false,
    title: "Overview Page Description",
    description:
      "Overview Page description for your status page. This is a markdown field.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public overviewPageDescription?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Hide Powered By OneUptime Branding",
    description: "Hide Powered By OneUptime Branding?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Free,
  })
  public hidePoweredByOneUptimeBranding?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    title: "Default Bar Color",
    required: false,
    unique: false,
    type: TableColumnType.Color,
    canReadOnRelationQuery: true,
    description: "Default color of the bar on the overview page",
  })
  @Column({
    type: ColumnType.Color,
    length: ColumnLength.Color,
    unique: false,
    nullable: true,
    transformer: Color.getDatabaseTransformer(),
  })
  public defaultBarColor?: Color = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: MonitorStatus,
    isDefaultValueColumn: true,
    computed: true,
    title: "Downtime Monitor Statuses",
    description:
      'List of monitors statuses that are considered as "down" for this status page.',
  })
  @ManyToMany(
    () => {
      return MonitorStatus;
    },
    { eager: false },
  )
  @JoinTable({
    name: "StatusPageDownMonitorStatus",
    inverseJoinColumn: {
      name: "monitorStatusId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "statusPageId",
      referencedColumnName: "_id",
    },
  })
  public downtimeMonitorStatuses?: Array<MonitorStatus> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Subscriber Timezones",
    description: "Timezones of subscribers to this status page.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public subscriberTimezones?: Array<Timezone> = undefined;

  // Status Page Report Starts from here.
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is Report Enabled",
    description: "Is Report Enabled for this Status Page?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public isReportEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Report Start Date Time",
    description: "When would you like to send the first report?",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public reportStartDateTime?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Report Recurring Interval",
    description: "How often would you like to send the report?",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    transformer: Recurring.getDatabaseTransformer(),
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public reportRecurringInterval?: Recurring = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Send Next Report By",
    description: "When should the next report be sent?",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public sendNextReportBy?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    defaultValue: 30,
    title: "Report data for the last N days",
    description: "How many days of data should be included in the report?",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 30,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public reportDataInDays?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show Overall Uptime Percent on Status Page",
    description: "Show Overall Uptime Percent on Status Page?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Free,
  })
  public showOverallUptimePercentOnStatusPage?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Overall Uptime Percent Precision",
    required: false,
    defaultValue: UptimePrecision.TWO_DECIMAL,
    description: "Overall Precision of uptime percent for this status page.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    default: UptimePrecision.TWO_DECIMAL,
  })
  public overallUptimePercentPrecision?: UptimePrecision = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Subscriber Email Notification Footer Text",
    description: "Text to send to subscribers in the footer of the email.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public subscriberEmailNotificationFooterText?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Custom Subscriber Email Notification Footer Text",
    description: "Enable custom footer text in subscriber email notifications.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
    nullable: false,
  })
  public enableCustomSubscriberEmailNotificationFooterText?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show Incidents on Status Page",
    description: "Show Incidents on Status Page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
    nullable: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public showIncidentsOnStatusPage?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show Announcements on Status Page",
    description: "Show Announcements on Status Page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
    nullable: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public showAnnouncementsOnStatusPage?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show Scheduled Maintenance Events on Status Page",
    description: "Show Scheduled Maintenance Events on Status Page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
    nullable: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public showScheduledMaintenanceEventsOnStatusPage?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show Subscriber Page on Status Page",
    description: "Show Subscriber Page on Status Page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
    nullable: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public showSubscriberPageOnStatusPage?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.VeryLongText,
    title: "IP Whitelist",
    description:
      "IP Whitelist for this Status Page. One IP per line. Only used if the status page is private.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Free,
  })
  public ipWhitelist?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Embedded Overall Status Badge",
    description:
      "Enable embedded overall status badge that can be displayed on external websites?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
    nullable: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public enableEmbeddedOverallStatus?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Embedded Overall Status Token",
    description:
      "Security token required to access the embedded overall status badge. This token must be provided in the URL.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Growth,
    create: PlanType.Free,
  })
  public embeddedOverallStatusToken?: string = undefined;
}
