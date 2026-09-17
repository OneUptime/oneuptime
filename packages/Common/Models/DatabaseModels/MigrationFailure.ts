import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import { Column, Entity, Index } from "typeorm";

/*
 * Persistent log of migrations that FAILED to apply. Neither the TypeORM
 * `migrations` table nor the `DataMigrations` table records failures — they
 * only ever gain a row on SUCCESS — so without this table the admin health
 * page can show that a migration is pending but never why. Each failed attempt
 * appends a row here (name + redacted error + when it ran), which the
 * migration-status endpoint reads back to explain a stuck / behind schema.
 *
 * Access control is empty (root-only): rows are written by the migration
 * runners and read by the master-admin health endpoint via raw/isRoot queries,
 * never by tenant users, so no CRUD API is exposed.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "MigrationFailure",
  singularName: "Migration Failure",
  pluralName: "Migration Failures",
  icon: IconProp.Database,
  tableDescription:
    "Log of database migrations that failed to apply, with the error and when they were attempted.",
})
@Entity({
  name: "MigrationFailure",
})
export default class MigrationFailure extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Migration Name",
    description: "Name of the migration that failed to apply.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public migrationName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Migration Type",
    description:
      "Which runner the migration belongs to: 'PostgresSchema' (TypeORM schema migration) or 'DataMigration' (ClickHouse / data backfill).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public migrationType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    title: "Error Message",
    description:
      "The error message from the failed attempt (credentials redacted).",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public errorMessage?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Error Stack",
    description:
      "The stack trace from the failed attempt, if available (credentials redacted).",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public errorStack?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Attempted At",
    description: "When this migration was attempted (and failed).",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public attemptedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Host Name",
    description: "Hostname / pod that ran the failed migration.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public hostName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "App Version",
    description: "Build / app version that attempted the migration.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public appVersion?: string = undefined;
}
