import IncomingCallPolicy from "./IncomingCallPolicy";
import Project from "./Project";
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
import IncomingCallStatus from "../../Types/IncomingCall/IncomingCallStatus";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Phone from "../../Types/Phone";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [Permission.ProjectOwner, Permission.ProjectAdmin],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadProjectIncomingCallLog,
  ],
  delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
  update: [Permission.ProjectOwner, Permission.ProjectAdmin],
})
@CrudApiEndpoint(new Route("/incoming-call-log"))
@Entity({
  name: "IncomingCallLog",
})
@TableMetadata({
  tableName: "IncomingCallLog",
  singularName: "Incoming Call Log",
  pluralName: "Incoming Call Logs",
  icon: IconProp.Call,
  tableDescription:
    "Parent log for each incoming call instance. Groups all escalation attempts together.",
})
export default class IncomingCallLog extends BaseModel {
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incomingCallPolicyId",
    type: TableColumnType.Entity,
    modelType: IncomingCallPolicy,
    title: "Incoming Call Policy",
    description: "Relation to the Incoming Call Policy",
  })
  @ManyToOne(
    () => {
      return IncomingCallPolicy;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incomingCallPolicyId" })
  public incomingCallPolicy?: IncomingCallPolicy = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Incoming Call Policy ID",
    description: "ID of the Incoming Call Policy",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incomingCallPolicyId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Phone,
    title: "Caller Phone Number",
    description: "Incoming caller's phone number",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    transformer: Phone.getDatabaseTransformer(),
  })
  public callerPhoneNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Phone,
    title: "Routing Phone Number",
    description: "The routing number that was called",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    transformer: Phone.getDatabaseTransformer(),
  })
  public routingPhoneNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Call Provider Call ID",
    description: "Call provider's call identifier",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public callProviderCallId?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description: "Current status of the incoming call",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: IncomingCallStatus.Initiated,
  })
  public status?: IncomingCallStatus = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Status Message",
    description: "Additional status information",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public statusMessage?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Call Duration (Seconds)",
    description: "Total call duration in seconds",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public callDurationInSeconds?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Call Cost (USD Cents)",
    description: "Total cost for this call in USD cents",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public callCostInUSDCents?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Incoming Call Cost (USD Cents)",
    description: "Cost for incoming leg in USD cents",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public incomingCallCostInUSDCents?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Outgoing Call Cost (USD Cents)",
    description: "Cost for all forwarding attempts in USD cents",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public outgoingCallCostInUSDCents?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Started At",
    description: "When the call started",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public startedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Ended At",
    description: "When the call ended",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public endedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    manyToOneRelationColumn: "answeredByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Answered By User",
    description: "User who answered the call",
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
  @JoinColumn({ name: "answeredByUserId" })
  public answeredByUser?: User = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Answered By User ID",
    description: "User ID who answered the call",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public answeredByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Current Escalation Rule Order",
    description: "The current escalation rule order being processed",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 1,
  })
  public currentEscalationRuleOrder?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLog,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Repeat Count",
    description: "Number of times the policy has been repeated",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public repeatCount?: number = undefined;
}
