import Project from "./Project";
import Service from "./Service";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
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
 * WHAT A SERVICE'S TEAM TELLS ONEUPTIME AI ABOUT IT (#7672) - "checkout's
 * database failover takes five minutes; don't page for it", "a 502 here is
 * the payments provider, check its status page first".
 *
 * OneUptime AI learns a service's recurring failures from its resolved
 * incidents and alerts (Server/Utils/AI/SRE/ServiceKnowledge), and the
 * service's page shows what it learned. What a team knows that no incident
 * recorded has no place there, so people write it here, a note at a time,
 * on the service's page. Every investigation of an incident or an alert on
 * the service reads its notes beside what was learned - as data a person
 * wrote, quoted, never as an instruction (ServiceKnowledge.buildNotesSection).
 *
 * Read like the service: a note is part of what its service says, so it is
 * read by whoever may read the service, and a role limited to some labels
 * or to what its members own reads the notes of those services only
 * (OwnedThrough). Written, edited and deleted by whoever may write about the
 * service; every change is in the service's audit log, named by the note.
 */

export const SERVICE_AI_NOTE_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadServiceAINote,
];

export const SERVICE_AI_NOTE_CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateServiceAINote,
];

export const SERVICE_AI_NOTE_UPDATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditServiceAINote,
];

export const SERVICE_AI_NOTE_DELETE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteServiceAINote,
];

// The longest note: a few sentences a person would tell a new engineer.
export const MAX_SERVICE_AI_NOTE_LENGTH: number = 2000;

@EnableDocumentation()
@CanAccessIfCanReadOn("service")
@TenantColumn("projectId")
@TableAccessControl({
  create: SERVICE_AI_NOTE_CREATE_PERMISSIONS,
  read: SERVICE_AI_NOTE_READ_PERMISSIONS,
  delete: SERVICE_AI_NOTE_DELETE_PERMISSIONS,
  update: SERVICE_AI_NOTE_UPDATE_PERMISSIONS,
})
@EnableAuditLog({
  rootResource: { resourceType: "Service", column: "serviceId" },
  resourceNameColumns: ["note"],
})
@CrudApiEndpoint(new Route("/service-ai-note"))
@OwnedThrough("serviceId", Service)
@Entity({
  name: "ServiceAINote",
})
@TableMetadata({
  tableName: "ServiceAINote",
  singularName: "Service AI Note",
  pluralName: "Service AI Notes",
  icon: IconProp.Sparkles,
  tableDescription:
    "What a service's team tells OneUptime AI about it. Every investigation of an incident or an alert on the service reads its notes.",
})
// A service's notes, the newest first.
@Index(["serviceId", "createdAt"])
export default class ServiceAINote extends BaseModel {
  @ColumnAccessControl({
    create: SERVICE_AI_NOTE_CREATE_PERMISSIONS,
    read: SERVICE_AI_NOTE_READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this note belongs to.",
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
    create: SERVICE_AI_NOTE_CREATE_PERMISSIONS,
    read: SERVICE_AI_NOTE_READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this note belongs to.",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: SERVICE_AI_NOTE_CREATE_PERMISSIONS,
    read: SERVICE_AI_NOTE_READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "serviceId",
    type: TableColumnType.Entity,
    modelType: Service,
    title: "Service",
    description: "The service the note is about.",
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
    create: SERVICE_AI_NOTE_CREATE_PERMISSIONS,
    read: SERVICE_AI_NOTE_READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Service ID",
    description: "ID of the service the note is about.",
    example: "e5f6a7b8-d9c0-1234-5678-901234efab56",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: SERVICE_AI_NOTE_CREATE_PERMISSIONS,
    read: SERVICE_AI_NOTE_READ_PERMISSIONS,
    update: SERVICE_AI_NOTE_UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Note",
    description: `What the team knows about the service that OneUptime AI should read when it investigates it, in plain text, at most ${MAX_SERVICE_AI_NOTE_LENGTH} characters.`,
    example:
      "Checkout's database failover takes five minutes; don't page for it.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
  })
  public note?: string = undefined;

  @ColumnAccessControl({
    create: SERVICE_AI_NOTE_CREATE_PERMISSIONS,
    read: SERVICE_AI_NOTE_READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person who wrote the note.",
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
    create: SERVICE_AI_NOTE_CREATE_PERMISSIONS,
    read: SERVICE_AI_NOTE_READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the person who wrote the note.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: SERVICE_AI_NOTE_READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "The person who deleted the note.",
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
    read: SERVICE_AI_NOTE_READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the person who deleted the note.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
