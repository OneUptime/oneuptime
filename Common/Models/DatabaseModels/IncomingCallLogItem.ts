import IncomingCallLog from "./IncomingCallLog";
import IncomingCallPolicyEscalationRule from "./IncomingCallPolicyEscalationRule";
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
    Permission.ReadProjectIncomingCallLogItem,
    Permission.ReadAllProjectResources,
  ],
  delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
  update: [Permission.ProjectOwner, Permission.ProjectAdmin],
})
@CrudApiEndpoint(new Route("/incoming-call-log-item"))
@Entity({
  name: "IncomingCallLogItem",
})
@TableMetadata({
  tableName: "IncomingCallLogItem",
  singularName: "Incoming Call Log Item",
  pluralName: "Incoming Call Log Items",
  icon: IconProp.Call,
  tableDescription:
    "Child log for each escalation attempt / user ring within a call.",
})
export default class IncomingCallLogItem extends BaseModel {
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incomingCallLogId",
    type: TableColumnType.Entity,
    modelType: IncomingCallLog,
    title: "Incoming Call Log",
    description: "Relation to the parent Incoming Call Log",
  })
  @ManyToOne(
    () => {
      return IncomingCallLog;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incomingCallLogId" })
  public incomingCallLog?: IncomingCallLog = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Incoming Call Log ID",
    description: "ID of the parent Incoming Call Log",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incomingCallLogId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incomingCallPolicyEscalationRuleId",
    type: TableColumnType.Entity,
    modelType: IncomingCallPolicyEscalationRule,
    title: "Escalation Rule",
    description: "Which escalation rule was used",
  })
  @ManyToOne(
    () => {
      return IncomingCallPolicyEscalationRule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incomingCallPolicyEscalationRuleId" })
  public incomingCallPolicyEscalationRule?: IncomingCallPolicyEscalationRule =
    undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Escalation Rule ID",
    description: "ID of the escalation rule used",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incomingCallPolicyEscalationRuleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "User who was called",
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

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description: "User ID who was called",
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Phone,
    title: "User Phone Number",
    description: "Phone number that was dialed",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    transformer: Phone.getDatabaseTransformer(),
  })
  public userPhoneNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description: "Status of this dial attempt",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: IncomingCallStatus.Ringing,
  })
  public status?: IncomingCallStatus = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
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
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Dial Duration (Seconds)",
    description: "How long this dial lasted in seconds",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public dialDurationInSeconds?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Call Cost (USD Cents)",
    description: "Cost for this dial attempt in USD cents",
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
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Started At",
    description: "When dial started",
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
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Ended At",
    description: "When dial ended",
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
      Permission.ReadProjectIncomingCallLogItem,
      Permission.ReadAllProjectResources,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is Answered",
    description: "Whether this user answered the call",
    defaultValue: false,
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public isAnswered?: boolean = undefined;
}
