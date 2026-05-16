import Label from "./Label";
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
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateIncomingCallPolicyOwnerRule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadIncomingCallPolicyOwnerRule,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteIncomingCallPolicyOwnerRule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditIncomingCallPolicyOwnerRule,
  ],
})
@CrudApiEndpoint(new Route("/incoming-call-policy-owner-rule"))
@Entity({
  name: "IncomingCallPolicyOwnerRule",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "IncomingCallPolicyOwnerRule",
  singularName: "Incoming Call Policy Owner Rule",
  pluralName: "Incoming Call Policy Owner Rules",
  icon: IconProp.User,
  tableDescription:
    "Configure rules for automatically assigning owner users and teams when matching incoming call policies are created",
})
export default class IncomingCallPolicyOwnerRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncomingCallPolicyOwnerRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this incoming call policy owner rule",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncomingCallPolicyOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this incoming call policy owner rule",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncomingCallPolicyOwnerRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Whether this rule is enabled",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncomingCallPolicyOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Notify Owners",
    description:
      "Send notifications to owner users and teams when they are added by this rule",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public notifyOwners?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncomingCallPolicyOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Incoming Call Policy Labels",
    description:
      "Only trigger for incoming call policies that have at least one of these labels. Leave empty to match regardless of labels.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncomingCallPolicyOwnerRuleMatchLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incomingCallPolicyOwnerRuleId",
      referencedColumnName: "_id",
    },
  })
  public incomingCallPolicyLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncomingCallPolicyOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Incoming Call Policy Name Pattern",
    description:
      "Regex (case-insensitive) matched against the incoming call policy name. Leave empty to match any name.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public incomingCallPolicyNamePattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncomingCallPolicyOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Incoming Call Policy Description Pattern",
    description:
      "Regex (case-insensitive) matched against the incoming call policy description. Leave empty to match any description.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public incomingCallPolicyDescriptionPattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncomingCallPolicyOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: User,
    title: "Owner Users",
    description:
      "Users to add as owners on the incoming call policy when this rule matches.",
  })
  @ManyToMany(
    () => {
      return User;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncomingCallPolicyOwnerRuleOwnerUser",
    inverseJoinColumn: {
      name: "userId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incomingCallPolicyOwnerRuleId",
      referencedColumnName: "_id",
    },
  })
  public ownerUsers?: Array<User> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncomingCallPolicyOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Owner Teams",
    description:
      "Teams to add as owners on the incoming call policy when this rule matches.",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncomingCallPolicyOwnerRuleOwnerTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incomingCallPolicyOwnerRuleId",
      referencedColumnName: "_id",
    },
  })
  public ownerTeams?: Array<Team> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncomingCallPolicyOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIncomingCallPolicyOwnerRule,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
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
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
