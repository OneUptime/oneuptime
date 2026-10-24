import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import BackupDestinationType from "../../Types/Backup/BackupDestinationType";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
} from "../../Types/Backup/BackupRunTypes";
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
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One backup of the instance's databases, or one restore of a backup, and
 * how it went: queued, running (and on which step, how far), done, failed
 * (and why). Written by the Enterprise Edition's runner (ee/Server/Backup)
 * as it goes, read by the Admin Dashboard's Backups page. Master admins
 * read them; only OneUptime writes them (BackupRunService refuses anyone
 * else), and a backup is started, restored, cancelled or deleted through
 * the Enterprise Edition's routes, which do what the row says at the
 * destination as well.
 *
 * A backup's own record is its manifest at the destination
 * (BackupManifest); this row mirrors it, and is rebuilt from it after a
 * restore takes the table back in time, or on a new installation that
 * finds the backups of the one it replaces.
 */

// Sizes run past 2 GB, so the columns are bigint, read back as numbers.
const bigNumberTransformer: {
  to: (value: number | null | undefined) => string | null | undefined;
  from: (value: string | null | undefined) => number | null | undefined;
} = {
  to: (value: number | null | undefined): string | null | undefined => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    return Math.trunc(value).toString();
  },
  from: (value: string | null | undefined): number | null | undefined => {
    if (value === undefined || value === null) {
      return value;
    }

    return Number(value);
  },
};

@TableEditionAccessControl({
  requiresEnterprise: true,
})
@CrudApiEndpoint(new Route("/backup-run"))
@Entity({
  name: "BackupRun",
})
@TableMetadata({
  tableName: "BackupRun",
  singularName: "Backup Run",
  pluralName: "Backup Runs",
  icon: IconProp.Database,
  tableDescription:
    "Each backup of the instance's PostgreSQL and ClickHouse databases, and each restore of one.",
})
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
export default class BackupRun extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Kind",
    description: "backup, or restore.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: BackupRunKind = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Started By",
    description:
      "What started it: scheduled, manual, before-restore or found-at-destination.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public trigger?: BackupRunTrigger = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description: "queued, running, succeeded, failed or cancelled.",
    defaultValue: BackupRunStatus.Queued,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: BackupRunStatus.Queued,
  })
  public status?: BackupRunStatus = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "PostgreSQL",
    description: "Whether it backs up, or restores, PostgreSQL.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public includesPostgres?: boolean = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "ClickHouse",
    description: "Whether it backs up, or restores, ClickHouse.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public includesClickhouse?: boolean = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Name",
    description:
      "A backup's folder at the destination, such as 20261024T020000Z-3f2a9c1b.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Location",
    description:
      "Where the backup is, such as s3://bucket/oneuptime/backups/<name>/. Never a credential.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public location?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Destination",
    description:
      "The storage the backup is in: s3, s3-compatible, google-cloud-storage or azure-blob-storage.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public destinationType?: BackupDestinationType = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Destination Fingerprint",
    description:
      "Which destination it is at (a hash of the storage, bucket and folder), to tell a previous destination's backups apart.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public destinationFingerprint?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Steps",
    description:
      "What the run does, step by step, with each step's status, times, progress and outcome.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public steps?: JSONArray = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Started At",
    description: "When the run started.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public startedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Finished At",
    description: "When the run succeeded, failed or was cancelled.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public finishedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Heartbeat At",
    description:
      "When the worker running it last said it was alive. A running run whose heartbeat stops is failed.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public heartbeatAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Cancel Requested At",
    description: "When a master admin asked to cancel it.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public cancelRequestedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.BigPositiveNumber,
    required: false,
    title: "PostgreSQL Size (Bytes)",
    description: "The size of the PostgreSQL dump at the destination.",
  })
  @Column({
    type: ColumnType.BigPositiveNumber,
    nullable: true,
    transformer: bigNumberTransformer,
  })
  public postgresSizeInBytes?: number = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.BigPositiveNumber,
    required: false,
    title: "ClickHouse Size (Bytes)",
    description: "The size of the ClickHouse backup at the destination.",
  })
  @Column({
    type: ColumnType.BigPositiveNumber,
    nullable: true,
    transformer: bigNumberTransformer,
  })
  public clickhouseSizeInBytes?: number = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Manifest",
    description:
      "A backup's manifest: versions, checksums and what it holds, as written next to it.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public manifest?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Error",
    description:
      "Why it failed, in words an operator can act on, with credentials redacted.",
  })
  @Column({ type: ColumnType.VeryLongText, nullable: true })
  public error?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Restored Backup ID",
    description: "For a restore: the backup it restores.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public restoredBackupRunId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Backup Before Restore ID",
    description:
      "For a restore: the backup it took of the current data before replacing it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public safetyBackupRunId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description:
      "Relation to the master admin who started it. Empty for scheduled backups.",
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

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description:
      "ID of the master admin who started it. Empty for scheduled backups.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the master admin who deleted the backup.",
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

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the master admin who deleted the backup.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
