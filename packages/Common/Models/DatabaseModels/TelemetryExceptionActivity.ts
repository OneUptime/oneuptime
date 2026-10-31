import Project from "./Project";
import Team from "./Team";
import TelemetryException from "./TelemetryException";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * What an entry on an exception's activity timeline records. Each value is
 * its own name. "This exception" is the one the entry is on; the related
 * exception, for a merge, is the other one.
 */
export enum TelemetryExceptionActivityType {
  Resolved = "Resolved",
  // Resolved, waiting out the release named (Resolve in next release).
  ResolvedInNextRelease = "ResolvedInNextRelease",
  // Reopened by hand.
  Reopened = "Reopened",
  /*
   * Came back after it was resolved: an occurrence at ingest, or OneUptime's
   * check that a fix did not hold in production.
   */
  Regressed = "Regressed",
  Archived = "Archived",
  Unarchived = "Unarchived",
  // Assigned to the person or team named, or handed from one to another.
  Assigned = "Assigned",
  // Nobody owns it any more; the entry names who did.
  Unassigned = "Unassigned",
  // The related exception was merged into this one.
  Merged = "Merged",
  // This exception was merged into the related one.
  MergedInto = "MergedInto",
  // The related exception was unmerged from this one.
  Unmerged = "Unmerged",
  // This exception was unmerged from the related one.
  UnmergedFrom = "UnmergedFrom",
}

/*
 * AN EXCEPTION'S ACTIVITY: WHO DID WHAT TO IT, AND WHEN.
 *
 * Written by OneUptime as each change lands, whoever made it - a person on
 * the exception's page, a row's menu, Bulk Actions, an API key, OneUptime
 * itself (an occurrence after a resolve, an AI fix merged, an auto-archive)
 * - from the one place every change goes through: TelemetryExceptionService
 * for triage and assignment, TelemetryExceptionMerge for merges, and the
 * ingest upsert for regressions. Nobody writes, edits or deletes an entry
 * through the API: a timeline that can be rewritten is no record.
 *
 * An entry is read as its exception is: only by someone who may read that
 * exception, under the same scope (TelemetryExceptionActivityService). It
 * records facts, not sentences, so the Dashboard says it in its reader's
 * language.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadTelemetryException,
];

const columnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/telemetry-exception-activity"))
@Entity({
  name: "TelemetryExceptionActivity",
})
@TableMetadata({
  tableName: "TelemetryExceptionActivity",
  singularName: "Exception Activity",
  pluralName: "Exception Activity",
  icon: IconProp.List,
  tableDescription:
    "The activity of an exception: who resolved, reopened, archived, assigned, merged or unmerged it and when, and when it came back after it was resolved. Read one exception's activity at a time, by its telemetryExceptionId.",
})
// One exception's timeline, newest first.
@Index(["telemetryExceptionId", "createdAt"])
export default class TelemetryExceptionActivity extends BaseModel {
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this entry belongs to.",
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

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this entry belongs to.",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "telemetryExceptionId",
    type: TableColumnType.Entity,
    modelType: TelemetryException,
    title: "Exception",
    description: "The exception this entry is about.",
  })
  @ManyToOne(
    () => {
      return TelemetryException;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "telemetryExceptionId" })
  public telemetryException?: TelemetryException = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Exception ID",
    description: "ID of the exception this entry is about.",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public telemetryExceptionId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Activity Type",
    description:
      "What happened: Resolved, ResolvedInNextRelease, Reopened, Regressed, Archived, Unarchived, Assigned, Unassigned, Merged, MergedInto, Unmerged or UnmergedFrom.",
    example: "Resolved",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public activityType?: TelemetryExceptionActivityType = undefined;

  // Who did it. Neither a person nor an API key: OneUptime did.
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "The person who did it, when a person did.",
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

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of the person who did it, when a person did.",
    example: "e5f6a7b8-c9d0-1234-efab-234567890124",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "API Key Name",
    description:
      "The name the API key that made the change had at the time, when an API key did.",
    example: "Deploy pipeline",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public apiKeyName?: string = undefined;

  // Assigned: who it was assigned to. Unassigned: who it was taken from.
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "assigneeUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Assignee User",
    description:
      "For Assigned, the person it was assigned to; for Unassigned, the person it was taken from.",
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
  @JoinColumn({ name: "assigneeUserId" })
  public assigneeUser?: User = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Assignee User ID",
    description:
      "For Assigned, ID of the person it was assigned to; for Unassigned, of the person it was taken from.",
    example: "e5f6a7b8-c9d0-1234-efab-234567890124",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public assigneeUserId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "assigneeTeamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Assignee Team",
    description:
      "For Assigned, the team it was assigned to; for Unassigned, the team it was taken from.",
  })
  @ManyToOne(
    () => {
      return Team;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "assigneeTeamId" })
  public assigneeTeam?: Team = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Assignee Team ID",
    description:
      "For Assigned, ID of the team it was assigned to; for Unassigned, of the team it was taken from.",
    example: "f6a7b8c9-d0e1-2345-fabc-345678901235",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public assigneeTeamId?: ObjectID = undefined;

  // For a merge or an unmerge: the other exception.
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "relatedTelemetryExceptionId",
    type: TableColumnType.Entity,
    modelType: TelemetryException,
    title: "Related Exception",
    description:
      "For a merge or an unmerge, the other exception: the one merged into or unmerged from this one, or the one this one was merged into or unmerged from.",
  })
  @ManyToOne(
    () => {
      return TelemetryException;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "relatedTelemetryExceptionId" })
  public relatedTelemetryException?: TelemetryException = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Related Exception ID",
    description: "For a merge or an unmerge, ID of the other exception.",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567891",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public relatedTelemetryExceptionId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Release",
    description:
      "For ResolvedInNextRelease, the release it waits out; for Regressed, the release of the occurrence that brought it back, when it names one.",
    example: "v1.4.0",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public release?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person whose action wrote the entry.",
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

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the person whose action wrote the entry.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Unused: activity entries are not deleted.",
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

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "Unused: activity entries are not deleted.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
