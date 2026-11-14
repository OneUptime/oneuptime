import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import ListOrderColumn from "../../Types/Database/ListOrderColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PublicNoteApprovalEventType } from "../../Types/StatusPage/PublicNoteApproval";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

/*
 * One step of a project's public note approval
 * (Types/StatusPage/PublicNoteApproval): the people and teams any one of
 * whom may approve a public note for the step. The steps of a kind of event
 * - incidents (their episodes' notes too) or scheduled maintenance - are
 * gone through in their order, a note published once the last one approves
 * it. Most projects have one.
 *
 * Who approves is a project's decision about what it tells the people
 * outside the team, so only its owners and admins set it, as they set the
 * switch that asks for approval (Project.requireApprovalFor*PublicNotes).
 * Everyone who reads the notes reads who approves them.
 */
const WRITE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
  Permission.ScheduledMaintenanceViewer,
];

@EnableDocumentation()
@TenantColumn("projectId")
@ListOrderColumn({ column: "order", scopeColumns: ["projectId", "eventType"] })
@TableAccessControl({
  create: WRITE_PERMISSIONS,
  read: READ_PERMISSIONS,
  delete: WRITE_PERMISSIONS,
  update: WRITE_PERMISSIONS,
})
@CrudApiEndpoint(new Route("/public-note-approval-step"))
@Entity({
  name: "PublicNoteApprovalStep",
})
@TableMetadata({
  tableName: "PublicNoteApprovalStep",
  singularName: "Public Note Approval Step",
  pluralName: "Public Note Approval Steps",
  icon: IconProp.CheckCircle,
  tableDescription:
    "Who approves public notes before they are published on status pages and sent to subscribers, step by step",
})
export default class PublicNoteApprovalStep extends BaseModel {
  @ColumnAccessControl({
    create: WRITE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
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
    create: WRITE_PERMISSIONS,
    read: READ_PERMISSIONS,
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

  /*
   * Whose public notes the step approves: Incident (an incident's and an
   * episode's) or ScheduledMaintenance. A step stays with the kind it was
   * made for.
   */
  @ColumnAccessControl({
    create: WRITE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    allowedValues: Object.values(PublicNoteApprovalEventType),
    title: "Event Type",
    description:
      "Whose public notes this step approves: Incident (the public notes of incidents and incident episodes) or ScheduledMaintenance (the public notes of maintenance events).",
    example: "Incident",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public eventType?: PublicNoteApprovalEventType = undefined;

  @ColumnAccessControl({
    create: WRITE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: WRITE_PERMISSIONS,
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What the step is called, shown to approvers and authors (for example, Legal). Optional.",
    example: "Communications",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: WRITE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: WRITE_PERMISSIONS,
  })
  @Index()
  @TableColumn({
    required: false,
    isDefaultValueColumn: false,
    type: TableColumnType.Number,
    title: "Order",
    description:
      "Where this step sits among the approval steps, lowest number first: a public note goes through them in this order. A new step is added to the end. Setting a number another step already has puts it in that place, and the ones in the way move one place along to make room. In the dashboard, drag the rows to reorder them.",
    canReadOnRelationQuery: true,
    example: 1,
  })
  @Column({
    type: ColumnType.Number,
  })
  public order?: number = undefined;

  @ColumnAccessControl({
    create: WRITE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: WRITE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: User,
    title: "Approvers",
    description:
      "People who may approve a public note for this step. Any one of them, or of the members of the teams below, is enough.",
  })
  @ManyToMany(
    () => {
      return User;
    },
    { eager: false },
  )
  @JoinTable({
    name: "PublicNoteApprovalStepUser",
    inverseJoinColumn: {
      name: "userId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "publicNoteApprovalStepId",
      referencedColumnName: "_id",
    },
  })
  public approverUsers?: Array<User> = undefined;

  @ColumnAccessControl({
    create: WRITE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: WRITE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Approver Teams",
    description:
      "Teams whose members may approve a public note for this step. Someone added to a team can decide on the notes already waiting.",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "PublicNoteApprovalStepTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "publicNoteApprovalStepId",
      referencedColumnName: "_id",
    },
  })
  public approverTeams?: Array<Team> = undefined;

  @ColumnAccessControl({
    create: WRITE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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
    create: WRITE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "7c8d9e0f-a1b2-3c4d-9e5f-8a9b0c1d2e3f",
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
    example: "9d0e1f2a-b3c4-5d6e-af7b-8c9d0e1f2a3b",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
