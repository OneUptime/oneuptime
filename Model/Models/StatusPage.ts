import File from "./File";
import Label from "./Label";
import MonitorStatus from "./MonitorStatus";
import Project from "./Project";
import ProjectCallSMSConfig from "./ProjectCallSMSConfig";
import ProjectSmtpConfig from "./ProjectSmtpConfig";
import User from "./User";
import BaseModel from "Common/Models/BaseModel";
import Route from "Common/Types/API/Route";
import { PlanSelect } from "Common/Types/Billing/SubscriptionPlan";
import Color from "Common/Types/Color";
import ColumnAccessControl from "Common/Types/Database/AccessControl/ColumnAccessControl";
import ColumnBillingAccessControl from "Common/Types/Database/AccessControl/ColumnBillingAccessControl";
import TableAccessControl from "Common/Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "Common/Types/Database/AccessControlColumn";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ColumnType from "Common/Types/Database/ColumnType";
import CrudApiEndpoint from "Common/Types/Database/CrudApiEndpoint";
import EnableDocumentation from "Common/Types/Database/EnableDocumentation";
import EnableWorkflow from "Common/Types/Database/EnableWorkflow";
import SlugifyColumn from "Common/Types/Database/SlugifyColumn";
import TableColumn from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import TableMetadata from "Common/Types/Database/TableMetadata";
import TenantColumn from "Common/Types/Database/TenantColumn";
import UniqueColumnBy from "Common/Types/Database/UniqueColumnBy";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@EnableDocumentation()
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
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @Index()
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
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
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
      onDelete: "CASCADE",
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
      onDelete: "CASCADE",
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
    read: PlanSelect.Free,
    update: PlanSelect.Growth,
    create: PlanSelect.Free,
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
    read: PlanSelect.Free,
    update: PlanSelect.Growth,
    create: PlanSelect.Free,
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
    read: PlanSelect.Free,
    update: PlanSelect.Growth,
    create: PlanSelect.Free,
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
    read: PlanSelect.Free,
    update: PlanSelect.Growth,
    create: PlanSelect.Free,
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
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  @ColumnBillingAccessControl({
    read: PlanSelect.Free,
    update: PlanSelect.Growth,
    create: PlanSelect.Free,
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
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanSelect.Free,
    update: PlanSelect.Growth,
    create: PlanSelect.Free,
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
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanSelect.Free,
    update: PlanSelect.Growth,
    create: PlanSelect.Free,
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
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanSelect.Free,
    update: PlanSelect.Scale,
    create: PlanSelect.Free,
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
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanSelect.Free,
    update: PlanSelect.Growth,
    create: PlanSelect.Free,
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
      onDelete: "CASCADE",
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
      onDelete: "CASCADE",
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
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    title: "Are Owners Notified Of Resource Creation?",
    description: "Are owners notified of when this resource is created?",
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
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanSelect.Free,
    update: PlanSelect.Scale,
    create: PlanSelect.Free,
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
}
