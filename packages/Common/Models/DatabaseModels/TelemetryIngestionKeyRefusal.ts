import Project from "./Project";
import TelemetryIngestionKey from "./TelemetryIngestionKey";
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
 * Telemetry the ingest guards refused, counted per ingestion key, reason and
 * surface (issue #6378): how many requests, and when the first and the
 * latest were refused. One row per (key, reason, surface), added to in
 * batches by TelemetryIngestRefusalRecorder - a second after the first
 * refusal, then at most once per five minutes per process - never once per
 * refused request; nobody edits it.
 *
 * Read by the RUM setup check and its empty charts (what was refused, when,
 * how to fix it) and by the key's own page. A refusal is counted against
 * the key that sent it, not an application: the guards refuse before the
 * payload is read, so before anything in it names one.
 *
 * Whoever may read the key may read what it was refused, and nobody else:
 * the rows name the key.
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadTelemetryIngestionKey,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/telemetry-ingestion-key-refusal"))
@TableMetadata({
  tableName: "TelemetryIngestionKeyRefusal",
  singularName: "Ingestion Key Refusal",
  pluralName: "Ingestion Key Refusals",
  // Was "Telemetry Ingestion Key Refusal" (#6817): its CLI name stays.
  apiSingularName: "Telemetry Ingestion Key Refusal",
  apiPluralName: "Telemetry Ingestion Key Refusals",
  icon: IconProp.Code,
  tableDescription:
    "Telemetry the ingest endpoints refused, counted per ingestion key, reason and ingest surface: how many requests, and when the first and the latest were refused. Written by the ingest endpoints; not user-editable.",
})
@Index(["telemetryIngestionKeyId", "reason", "surface"], {
  unique: true,
})
@Entity({
  name: "TelemetryIngestionKeyRefusal",
})
export default class TelemetryIngestionKeyRefusal extends BaseModel {
  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the Project the refused key belongs to.",
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
    description: "ID of the Project the refused key belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "telemetryIngestionKeyId",
    type: TableColumnType.Entity,
    modelType: TelemetryIngestionKey,
    title: "Ingestion Key",
    description: "The ingestion key the refused telemetry was sent with.",
  })
  @ManyToOne(
    () => {
      return TelemetryIngestionKey;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "telemetryIngestionKeyId" })
  public telemetryIngestionKey?: TelemetryIngestionKey = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Ingestion Key ID",
    description: "ID of the ingestion key the refused telemetry was sent with.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public telemetryIngestionKeyId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Reason",
    description:
      "Why the telemetry was refused (TelemetryIngestRefusalReason): key-disabled, key-expired, origin-not-allowed, browser-key-not-allowed-here, pinned-key-not-allowed-here, key-requests-per-minute, key-daily-budget, key-ingestion-rate, project-daily-budget, project-ingestion-rate, payment-required or project-blocked.",
    example: "key-disabled",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public reason?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Surface",
    description:
      "The ingest surface that refused it (TelemetryIngestSurface), such as otel-traces, otel-logs or session-replay; unnamed for an endpoint that names none.",
    example: "otel-traces",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public surface?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Refused Count",
    description:
      "How many requests were refused for this reason since the first one, as the ingest endpoints counted them. Stops counting at 2147483647.",
    example: 120,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
  })
  public refusedCount?: number = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "First Refused At",
    description: "When the first request was refused for this reason.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public firstRefusedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Refused At",
    description:
      "When the latest request was refused for this reason. Written a few minutes behind at most: refusals are counted in memory and written in batches.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public lastRefusedAt?: Date = undefined;

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
