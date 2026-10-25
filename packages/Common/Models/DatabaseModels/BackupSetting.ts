import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import BackupDestinationType from "../../Types/Backup/BackupDestinationType";
import { BackupProvider } from "../../Types/Backup/BackupDestinationCatalog";
import {
  BackupFrequency,
  DEFAULT_BACKUP_DAY_OF_WEEK,
  DEFAULT_BACKUP_FREQUENCY,
  DEFAULT_BACKUP_RETENTION_IN_DAYS,
  DEFAULT_BACKUP_TIME_OF_DAY,
} from "../../Types/Backup/BackupSchedule";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableEditionAccessControl from "../../Types/Database/AccessControl/TableEditionAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";

/*
 * How the instance backs itself up: where the backups go (an S3 bucket,
 * S3-compatible storage, Google Cloud Storage or Azure Blob Storage), how
 * often, how long they are kept and whether ClickHouse's telemetry is in
 * them. One row for the instance, set up by a master admin in the Admin
 * Dashboard (Settings > Backups); nobody else can read or write it (the
 * empty access lists below leave it to master admins and OneUptime itself).
 *
 * This is enterprise configuration (TableEditionAccessControl): creating or
 * changing it needs the Enterprise Edition and a license that includes
 * backups, while reading and deleting never do. The backups themselves are
 * made, kept and restored by the Enterprise Edition (ee/Server/Backup); the
 * Community Edition has none of it.
 *
 * The destination decides which keys `config` and `secrets` carry
 * (BackupDestinationCatalog); the server checks them on save. `secrets` is
 * encrypted at rest and never returned by the API, to anyone.
 *
 * nextBackupAt and lastFailureNotifiedAt are the scheduler's bookkeeping,
 * written by OneUptime alone.
 */
export const BACKUP_SETTING_BOOKKEEPING_COLUMNS: Array<string> = [
  "nextBackupAt",
  "lastFailureNotifiedAt",
];

@TableEditionAccessControl({
  requiresEnterprise: true,
})
@CrudApiEndpoint(new Route("/backup-setting"))
@Entity({
  name: "BackupSetting",
})
@TableMetadata({
  tableName: "BackupSetting",
  singularName: "Backup Setting",
  pluralName: "Backup Settings",
  icon: IconProp.Database,
  tableDescription:
    "Where the instance's PostgreSQL and ClickHouse backups go, how often they run and how long they are kept.",
})
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
export default class BackupSetting extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Destination",
    description:
      "Where backups go: s3, s3-compatible, google-cloud-storage or azure-blob-storage.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public destinationType?: BackupDestinationType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Provider",
    description:
      "The recommended destination picked, such as cloudflare-r2 or minio. Empty means the storage's own.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public destinationProvider?: BackupProvider = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Configuration",
    description:
      "The destination's settings that are not secret, such as the bucket and the folder.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public config?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credentials",
    description:
      "The destination's secrets as a JSON object. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public secrets?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Back Up On Schedule",
    description:
      "Whether backups run on the schedule. Off, nothing runs but Back up now.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Frequency",
    description:
      "How often backups run: every-hour, every-6-hours, every-12-hours, daily or weekly.",
    defaultValue: DEFAULT_BACKUP_FREQUENCY,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: DEFAULT_BACKUP_FREQUENCY,
  })
  public frequency?: BackupFrequency = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Time Of Day",
    description:
      "When backups run, as HH:MM in UTC. Hourly schedules keep its minutes.",
    defaultValue: DEFAULT_BACKUP_TIME_OF_DAY,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: DEFAULT_BACKUP_TIME_OF_DAY,
  })
  public timeOfDay?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Day Of Week",
    description: "For weekly backups: 0 (Sunday) to 6 (Saturday).",
    defaultValue: DEFAULT_BACKUP_DAY_OF_WEEK,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: DEFAULT_BACKUP_DAY_OF_WEEK,
  })
  public dayOfWeek?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Keep Backups For (Days)",
    description:
      "Backups older than this are deleted, except the newest one that succeeded.",
    defaultValue: DEFAULT_BACKUP_RETENTION_IN_DAYS,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: DEFAULT_BACKUP_RETENTION_IN_DAYS,
  })
  public retentionInDays?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Back Up ClickHouse",
    description:
      "Whether backups hold ClickHouse's telemetry too. PostgreSQL is always backed up.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public includesClickhouse?: boolean = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Next Backup At",
    description: "When the schedule runs the next backup.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public nextBackupAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Failure Notified At",
    description:
      "When master admins were last emailed that a backup failed. Cleared by the next backup that succeeds.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastFailureNotifiedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who set backups up.",
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
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who set backups up.",
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
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who removed the backup settings.",
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

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who removed the backup settings.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
