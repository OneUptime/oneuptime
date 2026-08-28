import Project from "./Project";
import Service from "./Service";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
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

@EnableDocumentation()
@CanAccessIfCanReadOn("service")
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/telemetry-source-map"))
@Entity({
  name: "TelemetrySourceMap",
})
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateTelemetrySourceMap,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.TelemetryAdmin,
    Permission.TelemetryMember,
    Permission.TelemetryViewer,
    Permission.ReadTelemetrySourceMap,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteTelemetrySourceMap,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditTelemetrySourceMap,
  ],
})
@TableMetadata({
  tableName: "TelemetrySourceMap",
  singularName: "Source Map",
  pluralName: "Source Maps",
  icon: IconProp.Code,
  tableDescription:
    "Source maps uploaded for telemetry services. Used to resolve minified browser exception stack traces back to the original source code. Maps are matched to exceptions by service and release (the service.version OpenTelemetry resource attribute).",
})
/*
 * The resolver looks maps up by (projectId, serviceId, serviceVersion) on
 * every exception detail view, so that tuple carries the index. bundlePath
 * is deliberately NOT part of a unique constraint: the upload path
 * replaces same-bundle rows itself, and a racing double upload leaving two
 * rows behind is harmless (resolution picks the newest) while a unique
 * violation would fail a CI upload.
 */
@Index(["projectId", "serviceId", "serviceVersion"])
export default class TelemetrySourceMap extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadTelemetrySourceMap,
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
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadTelemetrySourceMap,
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
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadTelemetrySourceMap,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "serviceId",
    type: TableColumnType.Entity,
    modelType: Service,
    required: true,
    title: "Service",
    description: "Telemetry service this source map belongs to",
  })
  @ManyToOne(
    () => {
      return Service;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceId" })
  public service?: Service = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadTelemetrySourceMap,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Service ID",
    description: "ID of the telemetry service this source map belongs to",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadTelemetrySourceMap,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Service Version",
    description:
      "The release this source map belongs to. Must exactly match the service.version OpenTelemetry resource attribute sent with the telemetry.",
    example: "1.4.2",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public serviceVersion?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadTelemetrySourceMap,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Bundle Path",
    description:
      "Path or file name of the minified bundle this map was generated for (for example main.a8f1b2.js). Stack frames are matched against this by path suffix, so the file name alone is enough.",
    example: "main.a8f1b2.js",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public bundlePath?: string = undefined;

  /*
   * The raw source map JSON. Read access is restricted to the same
   * permissions that can create maps (not the broad telemetry-viewer set):
   * when built with sourcesContent the map contains the full original
   * source code of the application, which is exactly what teams using
   * hidden source maps are trying not to publish.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadTelemetrySourceMap,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    title: "Source Map Content",
    description: "The source map JSON (version 3) for this bundle",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public content?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadTelemetrySourceMap,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Size in Bytes",
    description: "Size of the source map JSON in bytes",
    example: "1048576",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public sizeInBytes?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadTelemetrySourceMap,
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
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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
      Permission.CreateTelemetrySourceMap,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadTelemetrySourceMap,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
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
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
