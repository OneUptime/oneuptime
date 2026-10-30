import DataStore from "./DataStore";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
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
import Color from "../../Types/Color";
import ColumnLength from "../../Types/Database/ColumnLength";

/*
 * Every state change worth remembering about a data store. The overview page
 * answers "what does this data store look like right now"; the feed answers
 * "how did it get that way" - who created it (or whether telemetry ingest
 * discovered it on its own), who was added or removed as an owner, and which
 * owner / label rule put them there.
 */
export enum DataStoreFeedEventType {
  DataStoreCreated = "DataStoreCreated",
  DataStoreUpdated = "DataStoreUpdated",
  DataStoreArchived = "DataStoreArchived",
  DataStoreRestored = "DataStoreRestored",
  OwnerUserAdded = "OwnerUserAdded",
  OwnerUserRemoved = "OwnerUserRemoved",
  OwnerTeamAdded = "OwnerTeamAdded",
  OwnerTeamRemoved = "OwnerTeamRemoved",
  OwnerRuleExecuted = "OwnerRuleExecuted",
  LabelRuleExecuted = "LabelRuleExecuted",
  // A response action changed the store's cloud configuration (DataSecurityResponse).
  ResponseActionTaken = "ResponseActionTaken",
}

@EnableDocumentation()
@CanAccessIfCanReadOn("dataStore")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.CreateDataStoreFeed,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ReadDataStoreFeed,
  ],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/data-store-feed"))
@OwnedThrough("dataStoreId", DataStore)
@Entity({
  name: "DataStoreFeed",
})
@TableMetadata({
  tableName: "DataStoreFeed",
  singularName: "Data Store Feed",
  pluralName: "Data Store Feeds",
  icon: IconProp.List,
  tableDescription:
    "Log of everything that happened to this data store - creation, updates, owner changes and the rules that made them.",
})
@Index(["dataStoreId", "postedAt"]) // Data Store feed page: feed sorted by postedAt
export default class DataStoreFeed extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
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

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "dataStoreId",
    type: TableColumnType.Entity,
    modelType: DataStore,
    title: "Data Store",
    description: "Relation to Data Store in which this resource belongs",
    example: "e5f6a7b8-d9c0-1234-5678-901234efab56",
  })
  @ManyToOne(
    () => {
      return DataStore;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataStoreId" })
  public dataStore?: DataStore = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Data Store ID",
    description: "Relation to Data Store ID in which this resource belongs",
    example: "e5f6a7b8-d9c0-1234-5678-901234efab56",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataStoreId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
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
    example: "b2c3d4e5-a6b7-8901-2345-678901bcdef0",
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
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "b2c3d4e5-a6b7-8901-2345-678901bcdef0",
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
    example: "c3d4e5f6-b7c8-9012-3456-789012cdef01",
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
    example: "c3d4e5f6-b7c8-9012-3456-789012cdef01",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: true,
    title: "Log (in Markdown)",
    description: "Log of the data store change in Markdown",
    example: "👨🏻‍💻 Added **Jane Doe** as the owner of this data store.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: false,
    unique: false,
  })
  public feedInfoInMarkdown?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    title: "More Information (in Markdown)",
    description: "More information in Markdown",
    example:
      "### Additional Context\n\nThis data store was discovered from incoming telemetry.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
    unique: false,
  })
  public moreInformationInMarkdown?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Data Store Feed Event",
    description: "Data Store Feed Event",
    example: "DataStoreCreated",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    unique: false,
  })
  public dataStoreFeedEventType?: DataStoreFeedEventType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Color,
    required: true,
    title: "Color",
    description: "Display color for this feed item",
    example: "#3498db",
  })
  @Column({
    type: ColumnType.Color,
    length: ColumnLength.Color,
    nullable: false,
    unique: false,
    transformer: Color.getDatabaseTransformer(),
  })
  public displayColor?: Color = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description:
      "Relation to User who this feed belongs to (if this feed belongs to a User)",
    example: "d4e5f6a7-c8d9-0123-4567-890123def012",
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
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description:
      "User who this feed belongs to (if this feed belongs to a User)",
    example: "d4e5f6a7-c8d9-0123-4567-890123def012",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateDataStoreFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadDataStoreFeed,
    ],
    update: [],
  })
  @TableColumn({
    title: "Feed Posted At",
    description: "Date and time when the feed was posted",
    type: TableColumnType.Date,
    example: "2024-01-15T10:30:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public postedAt?: Date = undefined;
}
