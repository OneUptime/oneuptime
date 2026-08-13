import Project from "./Project";
import User from "./User";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import EntitySource from "../../Types/Telemetry/EntitySource";
import EntityType from "../../Types/Telemetry/EntityType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import DatabaseBaseModel from "./DatabaseBaseModel/DatabaseBaseModel";

/*
 * Reusable access-control sets. A InventoryItem is a project-scoped
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
@CrudApiEndpoint(new Route("/inventory-item"))
/*
 * Audit logging is scoped to changes a person made.
 *
 * `create` is off because ingest creates one row per discovered entity: on a
 * churning Kubernetes estate that is a new row per pod, and the resulting
 * flood of "created" entries says nothing the `firstSeenAt` column does not
 * already say. `update` and `delete` are on and cost nothing at ingest
 * volume, because the reconciler bumps `lastSeenAt` through
 * `updateColumnsByIdIfUnlockedWithoutHooks` and the prune sweep removes rows
 * through `hardDeleteBy` — neither of which reaches the audit-log hook. What
 * is left is exactly the user-initiated edits and deletions.
 */
@EnableAuditLog({ create: false, update: true, delete: true })
@TableMetadata({
  tableName: "InventoryItem",
  singularName: "Inventory Item",
  pluralName: "Inventory Items",
  icon: IconProp.Cube,
  tableDescription:
    "Catalog of everything OneUptime knows about your estate (service, host, k8s.pod, container, network device, ...), discovered from telemetry resource attributes, mirrored from inventory tables, or registered by hand.",
})
@Entity({ name: "InventoryItem" })
// Natural key + upsert conflict target for the throttled ingest reconciler.
@Index(["projectId", "entityType", "entityKey"], { unique: true })
// List-by-type (entity explorer) and reverse lookup from a typed resource row.
@Index(["projectId", "entityType"])
@Index(["projectId", "resourceType", "resourceId"])
/*
 * Every list view filters on `isArchived`, so it belongs in the same index as
 * the tenant column rather than being scanned per row.
 */
@Index(["projectId", "isArchived"])
export default class InventoryItem extends DatabaseBaseModel {
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
    description: "Human-readable name shown in the Inventory list.",
    example: "checkout-7d9f",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public displayName?: string = undefined;

  /*
   * Immutable after create (`update: []`): the value decides whether
   * PruneStaleEntities may reap the row, so letting it be edited would let a
   * user flip a manual CI into a TTL-pruned one — or quietly make a
   * discovered row immortal. Re-create the row instead.
   */
  @ColumnAccessControl({ create: CREATE_PERMS, read: READ_PERMS, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Source",
    description:
      "How this row came to exist: discovered from telemetry, mirrored from a OneUptime inventory table, or created manually by a user. Determines whether stale-entity pruning applies.",
    example: "discovered",
  })
  @Index()
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: EntitySource.Discovered,
  })
  public source?: EntitySource = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Description",
    description:
      "Free-text description. Primarily for manually created entities, where there are no telemetry attributes to explain what the thing is.",
    example: "Stripe payments API - vendor managed, no telemetry.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public description?: string = undefined;

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

  /*
   * Archiving is the disposal route that actually works for this table.
   *
   * Deleting a discovered or mirrored row does not stick — ingest re-creates
   * it on the next reconcile, the poller re-mirrors it on the next sweep. So
   * "I have seen this and I do not want it in my list" had no expression at
   * all before this column: the only button available was one that undoes
   * itself. Archiving is a user annotation the reconciler never writes (its
   * update is the `lastSeenAt` bump plus an attribute merge, and neither
   * touches this), so it survives re-registration.
   *
   * The row keeps its identity and keeps collecting telemetry; it is only
   * hidden from the default list.
   */
  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Archived",
    description:
      "Is this item archived? Archived items are hidden from the default list but keep their identity and keep collecting telemetry.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  /*
   * Stamped server-side from the `isArchived` write (see
   * DatabaseService.sanitizeCreateOrUpdate), which is why these two are
   * read-only to the client.
   */
  @ColumnAccessControl({ create: [], read: READ_PERMS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Archived At",
    description: "When this item was archived.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public archivedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "archivedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Archived by User",
    description:
      "Relation to User who archived this object (if this object was archived by a User)",
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
  @JoinColumn({ name: "archivedByUserId" })
  public archivedByUser?: User = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMS, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Archived by User ID",
    description:
      "User ID who archived this object (if this object was archived by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public archivedByUserId?: ObjectID = undefined;

  /*
   * Project-defined fields, whose shape lives in InventoryItemCustomField.
   * Useful here in a way it is not on most tables: an estate catalog is
   * exactly where an organisation wants to hang its own vocabulary — owner
   * team, cost centre, compliance scope — on rows OneUptime discovered
   * rather than rows a person filled in.
   */
  @ColumnAccessControl({
    create: CREATE_PERMS,
    read: READ_PERMS,
    update: UPDATE_PERMS,
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Custom Fields",
    description: "Custom fields on this item.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public customFields?: JSONObject = undefined;

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
