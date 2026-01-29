import Project from "./Project";
import Incident from "./Incident";
import Alert from "./Alert";
import ScheduledMaintenance from "./ScheduledMaintenance";
import StatusPage from "./StatusPage";
import StatusPageAnnouncement from "./StatusPageAnnouncement";
import User from "./User";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "./OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicySchedule from "./OnCallDutyPolicySchedule";
import Team from "./Team";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Phone from "../../Types/Phone";
import WhatsAppStatus from "../../Types/WhatsAppStatus";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadWhatsAppLog,
    Permission.ReadAllProjectResources,
  ],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/whatsapp-log"))
@Entity({
  name: "WhatsAppLog",
})
@EnableWorkflow({
  create: true,
  delete: false,
  update: false,
})
@TableMetadata({
  tableName: "WhatsAppLog",
  singularName: "WhatsApp Log",
  pluralName: "WhatsApp Logs",
  icon: IconProp.WhatsApp,
  tableDescription:
    "Logs of all the WhatsApp messages sent out to all users and subscribers for this project.",
})
export default class WhatsAppLog extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
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
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Phone,
    title: "To Number",
    description: "Phone Number WhatsApp message was sent to",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    transformer: Phone.getDatabaseTransformer(),
  })
  public toNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Phone,
    title: "From Number",
    description:
      "Phone Number WhatsApp message was sent from (Business Number ID)",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    transformer: Phone.getDatabaseTransformer(),
  })
  public fromNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Message Text",
    description: "Text content of the WhatsApp message",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public messageText?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Status Message",
    description: "Status Message (if any)",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public statusMessage?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "WhatsApp Message ID",
    description: "Message ID returned by Meta's API",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public whatsAppMessageId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status of the WhatsApp Message",
    description: "Status of the WhatsApp message sent",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: WhatsAppStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "WhatsApp Cost",
    description: "WhatsApp Message Cost in USD Cents",
    canReadOnRelationQuery: false,
    isDefaultValueColumn: true,
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    default: 0,
    type: ColumnType.Number,
  })
  public whatsAppCostInUSDCents?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description: "Incident associated with this message (if any)",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentId" })
  public incident?: Incident = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Incident ID",
    description: "ID of Incident associated with this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "User who initiated this message (if any)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of User who initiated this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertId",
    type: TableColumnType.Entity,
    modelType: Alert,
    title: "Alert",
    description: "Alert associated with this message (if any)",
  })
  @ManyToOne(
    () => {
      return Alert;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertId" })
  public alert?: Alert = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Alert ID",
    description: "ID of Alert associated with this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenance,
    title: "Scheduled Maintenance",
    description: "Scheduled Maintenance associated with this message (if any)",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenance;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "scheduledMaintenanceId" })
  public scheduledMaintenance?: ScheduledMaintenance = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Scheduled Maintenance ID",
    description:
      "ID of Scheduled Maintenance associated with this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenanceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPageId",
    type: TableColumnType.Entity,
    modelType: StatusPage,
    title: "Status Page",
    description: "Status Page associated with this message (if any)",
  })
  @ManyToOne(
    () => {
      return StatusPage;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "statusPageId" })
  public statusPage?: StatusPage = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Status Page ID",
    description: "ID of Status Page associated with this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public statusPageId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPageAnnouncementId",
    type: TableColumnType.Entity,
    modelType: StatusPageAnnouncement,
    title: "Status Page Announcement",
    description:
      "Status Page Announcement associated with this message (if any)",
  })
  @ManyToOne(
    () => {
      return StatusPageAnnouncement;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "statusPageAnnouncementId" })
  public statusPageAnnouncement?: StatusPageAnnouncement = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Status Page Announcement ID",
    description:
      "ID of Status Page Announcement associated with this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public statusPageAnnouncementId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "teamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Team",
    description: "Team associated with this message (if any)",
  })
  @ManyToOne(
    () => {
      return Team;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "teamId" })
  public team?: Team = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Team ID",
    description: "ID of Team associated with this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public teamId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicy,
    title: "On-Call Duty Policy",
    description: "On-Call Duty Policy associated with this message (if any)",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicy;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyId" })
  public onCallDutyPolicy?: OnCallDutyPolicy = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "On-Call Duty Policy ID",
    description:
      "ID of On-Call Duty Policy associated with this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyEscalationRuleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicyEscalationRule,
    title: "On-Call Duty Policy Escalation Rule",
    description:
      "On-Call Duty Policy Escalation Rule associated with this message (if any)",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicyEscalationRule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyEscalationRuleId" })
  public onCallDutyPolicyEscalationRule?: OnCallDutyPolicyEscalationRule =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "On-Call Duty Policy Escalation Rule ID",
    description:
      "ID of On-Call Duty Policy Escalation Rule associated with this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyEscalationRuleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyScheduleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicySchedule,
    title: "On-Call Duty Policy Schedule",
    description:
      "On-Call Duty Policy Schedule associated with this message (if any)",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicySchedule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyScheduleId" })
  public onCallDutyPolicySchedule?: OnCallDutyPolicySchedule = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadWhatsAppLog,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "On-Call Duty Policy Schedule ID",
    description:
      "ID of On-Call Duty Policy Schedule associated with this message (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyScheduleId?: ObjectID = undefined;

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
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
