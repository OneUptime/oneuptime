import Project from "./Project";
import User from "./User";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
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
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import EntityType from "../../Types/Telemetry/EntityType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import DatabaseBaseModel from "./DatabaseBaseModel/DatabaseBaseModel";

/*
 * Reusable access-control sets. A TelemetryEntity is a project-scoped
 * catalog row (like Service / MetricType), machine-populated at ingest, so
 * it reuses the telemetry-service permissions rather than introducing a
 * new permission family.
 */
const READ_PERMS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadTelemetryService,
];
const CREATE_PERMS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.CreateTelemetryService,
];
const UPDATE_PERMS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.EditTelemetryService,
];

/**
 * A discovered OpenTelemetry entity — the generalized, polymorphic catalog
 * behind the multi-entity model (Internal/Docs/OpenTelemetryEntities.md,
 * phase 2). One row per `(projectId, entityType, entityKey)`: a `service`,
 * `host`, `k8s.pod`, `container`, ... derived from resource attributes at
 * ingest. The rich typed tables (Service / Host / DockerHost /
 * KubernetesCluster) remain the specializations; this registry catches the
 * long tail (pods, nodes, processes) and links back to a typed row via the
 * polymorphic `(resourceType, resourceId)` pointer when one exists.
 *
 * Populated forward-only and throttled at ingest (no historical backfill):
 * an active entity re-registers on its next telemetry batch, so the catalog
 * converges within the throttle window without a migration sweep.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateTelemetryService,
  ],
  read: READ_PERMS,
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteTelemetryService,
  ],
  update: UPDATE_PERMS,
})
@CrudApiEndpoint(new Route("/telemetry-entity"))
@TableMetadata({
  tableName: "TelemetryEntity",
  singularName: "Telemetry Entity",
  pluralName: "Telemetry Entities",
  icon: IconProp.Cube,
  tableDescription:
    "Catalog of OpenTelemetry entities (service, host, k8s.pod, container, ...) discovered from telemetry resource attributes.",
})
@Entity({ name: "TelemetryEntity" })
// Natural key + upsert conflict target for the throttled ingest reconciler.
@Index(["projectId", "entityType", "entityKey"], { unique: true })
// List-by-type (entity explorer) and reverse lookup from a typed resource row.
@Index(["projectId", "entityType"])
@Index(["projectId", "resourceType", "resourceId"])
export default class TelemetryEntity extends DatabaseBaseModel {
  @ColumnAccessControl({ create: CREATE_PERMS, read: READ_PERMS, update: [] })
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

  @ColumnAccessControl({ create: CREATE_PERMS, read: READ_PERMS, update: [] })
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

  @ColumnAccessControl({ create: CREATE_PERMS, read: READ_PERMS, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Entity Type",
    description:
      "The OpenTelemetry entity type (service, host, k8s.pod, container, ...).",
    example: "k8s.pod",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public entityType?: EntityType = undefined;

  @ColumnAccessControl({ create: CREATE_PERMS, read: READ_PERMS, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Entity Key",
    description:
      "Stable identity hash derived from the entity's identifying attributes (matches the keys stamped into signal entityKeys columns).",
    example: "210dac24142f1baa",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public entityKey?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Display Name",
    description: "Human-readable name derived for the entity explorer UI.",
    example: "checkout-7d9f",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public displayName?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Identifying Attributes",
    description:
      "The immutable identifying attribute set (the entity's identity). Descriptive attributes are deliberately excluded so they can change without changing the entity key.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public identifyingAttributes?: JSONObject = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Descriptive Attributes",
    description:
      "Mutable descriptive metadata (image tag, version, IP, ...) merged last-writer-wins. Never part of the identity.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public descriptiveAttributes?: JSONObject = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Labels",
    description:
      "Labels observed on this entity's telemetry (e.g. promoted from oneuptime.label.* resource attributes), merged as a set union. Simple string array in v1 — a relation to the Label table is a follow-up.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public labels?: Array<string> = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Resource Type",
    description:
      "Polymorphic pointer type to a rich typed row, if one exists (Service / Host / DockerHost / KubernetesCluster).",
    example: "Host",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public resourceType?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Resource ID",
    description:
      "Polymorphic pointer id to the rich typed row named by resourceType, if any.",
    example: "d4e5f6a7-b8c9-0123-def1-234567890123",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public resourceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "First Seen At",
    description: "When this entity was first observed in telemetry.",
    example: "2025-12-10T08:15:00.000Z",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public firstSeenAt?: Date = undefined;

  @Index()
  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Seen At",
    description:
      "Most recent time this entity was observed in telemetry (bumped, throttled). Drives staleness pruning.",
    example: "2025-12-12T16:20:00.000Z",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({ create: CREATE_PERMS, read: READ_PERMS, update: [] })
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

  @ColumnAccessControl({ create: CREATE_PERMS, read: READ_PERMS, update: [] })
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
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
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
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
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
