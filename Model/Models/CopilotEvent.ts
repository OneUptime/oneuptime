import CodeRepository from "./CodeRepository";
import Project from "./Project";
import ServiceCatalog from "./ServiceCatalog";
import ServiceRepository from "./ServiceRepository";
import User from "./User";
import BaseModel from "Common/Models/BaseModel";
import Route from "Common/Types/API/Route";
import CopilotEventStatus from "Common/Types/Copilot/CopilotEventStatus";
import CopilotEventType from "Common/Types/Copilot/CopilotEventType";
import ColumnAccessControl from "Common/Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "Common/Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "Common/Types/Database/CanAccessIfCanReadOn";
import ColumnType from "Common/Types/Database/ColumnType";
import CrudApiEndpoint from "Common/Types/Database/CrudApiEndpoint";
import EnableDocumentation from "Common/Types/Database/EnableDocumentation";
import EnableWorkflow from "Common/Types/Database/EnableWorkflow";
import TableColumn from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import TableMetadata from "Common/Types/Database/TableMetadata";
import TenantColumn from "Common/Types/Database/TenantColumn";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@CanAccessIfCanReadOn("codeRepository")
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadCopilotEvent,
  ],
  delete: [],
  update: [],
})
@EnableWorkflow({
  create: true,
  delete: false,
  update: true,
  read: false,
})
@CrudApiEndpoint(new Route("/copilot-event"))
@TableMetadata({
  tableName: "CopilotEvent",
  singularName: "Copilot Event",
  pluralName: "Copilot Events",
  icon: IconProp.Bolt,
  tableDescription: "Copilot Event Resource",
})
@Entity({
  name: "CopilotEvent",
})
export default class CopilotEvent extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
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
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
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

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "codeRepositoryId",
    type: TableColumnType.Entity,
    modelType: CodeRepository,
    title: "Code Repository",
    description:
      "Relation to CodeRepository Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return CodeRepository;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "codeRepositoryId" })
  public codeRepository?: CodeRepository = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Code Repository ID",
    description:
      "ID of your OneUptime Code Repository in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeRepositoryId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
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

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "File Path in Code Repository",
    required: true,
    description: "File Path in Code Repository where this event was triggered",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: false,
  })
  public filePath?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Commit Hash",
    description:
      "Commit Hash of the commit for this file in Code Repository where this event was triggered",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: false,
  })
  public commitHash?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Copilot Event Type",
    description:
      "Type of Copilot Event that was triggered for this file in Code Repository",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
  })
  public copilotEventType?: CopilotEventType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "serviceCatalogId",
    type: TableColumnType.Entity,
    modelType: ServiceCatalog,
    title: "Service Catalog",
    description:
      "Relation to Service Catalog Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return ServiceCatalog;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceCatalogId" })
  public serviceCatalog?: ServiceCatalog = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Service Catalog ID",
    description:
      "ID of your OneUptime ServiceCatalog in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceCatalogId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "serviceRepositoryId",
    type: TableColumnType.Entity,
    modelType: ServiceRepository,
    title: "Service Repository",
    description:
      "Relation to Service Repository Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return ServiceRepository;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceRepositoryId" })
  public serviceRepository?: ServiceRepository = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Service Repository ID",
    description:
      "ID of your OneUptime Service Repository in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceRepositoryId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    isDefaultValueColumn: false,
    title: "Pull Request ID",
    description:
      "ID of Pull Request in the repository where this event was executed and then PR was created.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
  })
  public pullRequestId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadCopilotEvent,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Copilot Event Status",
    description:
      "Status of Copilot Event that was triggered for this file in Code Repository",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
  })
  public copilotEventStatus?: CopilotEventStatus = undefined;
}
