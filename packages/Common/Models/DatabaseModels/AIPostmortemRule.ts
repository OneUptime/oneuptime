import IncidentPostmortemTemplate from "./IncidentPostmortemTemplate";
import IncidentSeverity from "./IncidentSeverity";
import Label from "./Label";
import LlmProvider from "./LlmProvider";
import Monitor from "./Monitor";
import Project from "./Project";
import User from "./User";
import RuleBaseModel from "./DatabaseBaseModel/RuleBaseModel";
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
 * Which resolved incidents OneUptime AI drafts a postmortem for, and which
 * postmortem templates each draft may follow.
 *
 * With no rule, every incident that resolves gets a draft while "Draft a
 * postmortem when an incident resolves" is on, in OneUptime AI's standard
 * outline - as before rules existed. With rules, only the incidents that
 * match one do, and the first enabled rule that matches, from the top of
 * the list down, decides which templates the draft may follow: none (the
 * standard outline), one, or several for OneUptime AI to pick the one that
 * fits the incident best (Server/Utils/AI/SRE/PostmortemRules).
 *
 * A rule's conditions are the ones the project's incident AI rules offer,
 * read the same way (IncidentAlertRuleMatcher). The switch stays the one way to turn drafting
 * off. Changing what AI does is the AI settings' business, so a rule takes
 * what changing those takes: Project Owner or Project Admin.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@ListOrderColumn({ column: "order", scopeColumns: ["projectId"] })
@TableAccessControl({
  create: [Permission.ProjectOwner, Permission.ProjectAdmin],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
  ],
  delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
  update: [Permission.ProjectOwner, Permission.ProjectAdmin],
})
@CrudApiEndpoint(new Route("/ai-postmortem-rule"))
@Entity({
  name: "AIPostmortemRule",
})
@TableMetadata({
  tableName: "AIPostmortemRule",
  singularName: "Postmortem Rule",
  pluralName: "Postmortem Rules",
  icon: IconProp.Sparkles,
  tableDescription:
    "Choose which resolved incidents OneUptime AI drafts a postmortem for, and the templates a draft may follow. With no rule, every resolved incident gets a draft; with rules, the first rule that matches decides.",
})
export default class AIPostmortemRule extends RuleBaseModel {
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
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
      Permission.Viewer,
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
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this postmortem rule.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this postmortem rule.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description:
      "Whether this rule is enabled. A disabled rule is skipped, as if it were not there.",
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Order",
    description:
      "Where this rule sits in the list. Rules are evaluated from the top of the list down, lowest number first, and the first one that matches wins. A new rule is added to the end of the list. Setting a number another one already has puts it in that place, and the ones in the way move one place along to make room. In the dashboard, drag the rows to reorder them.",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 1,
  })
  public order?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description:
      "Match only incidents from these monitors. Leave empty to match any monitor.",
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIPostmortemRuleMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiPostmortemRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: IncidentSeverity,
    title: "Incident Severities",
    description:
      "Match only incidents with these severities. Leave empty to match any severity.",
  })
  @ManyToMany(
    () => {
      return IncidentSeverity;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIPostmortemRuleIncidentSeverity",
    inverseJoinColumn: {
      name: "incidentSeverityId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiPostmortemRuleId",
      referencedColumnName: "_id",
    },
  })
  public incidentSeverities?: Array<IncidentSeverity> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Match only incidents that carry at least one of these labels. Leave empty to match any label.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIPostmortemRuleLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiPostmortemRuleId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Monitor Labels",
    description:
      "Match only when one of the incident's monitors carries at least one of these labels - the natural way to scope rules to environments (e.g. staging vs production). Leave empty to match any monitor label.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIPostmortemRuleMonitorLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiPostmortemRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitorLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Title Pattern",
    description:
      "Case-insensitive regex matched against the incident's title. Leave empty to match any title.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public titlePattern?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description Pattern",
    description:
      "Case-insensitive regex matched against the incident's description. Leave empty to match any description.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public descriptionPattern?: string = undefined;

  /*
   * What the rule does: the templates a draft for the incidents it matches
   * may follow. None: OneUptime AI's standard outline. One: that template.
   * Several: OneUptime AI picks the one that fits the incident best.
   */
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: IncidentPostmortemTemplate,
    title: "Postmortem Templates",
    description:
      "The postmortem templates a draft for the incidents this rule matches may follow. Leave empty for OneUptime AI's standard outline. With more than one, OneUptime AI picks the one that fits the incident best. At most 10.",
  })
  @ManyToMany(
    () => {
      return IncidentPostmortemTemplate;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIPostmortemRuleIncidentPostmortemTemplate",
    inverseJoinColumn: {
      name: "incidentPostmortemTemplateId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiPostmortemRuleId",
      referencedColumnName: "_id",
    },
  })
  public postmortemTemplates?: Array<IncidentPostmortemTemplate> = undefined;

  /*
   * The LLM provider OneUptime AI drafts the postmortems of the incidents
   * this rule matches with: one of the project's own providers, or a global
   * one. None picked is the project's default provider, else the global
   * one. The first rule that matches decides, as it decides the templates
   * (Server/Utils/AI/SRE/PostmortemRules; Types/AI/LlmProviderChoice).
   */
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    manyToOneRelationColumn: "llmProviderId",
    type: TableColumnType.Entity,
    modelType: LlmProvider,
    title: "LLM Provider",
    description:
      "The LLM provider OneUptime AI uses for everything this rule drafts: one of the project's providers or a global one. Empty: the project's default provider, else the global one.",
  })
  @ManyToOne(
    () => {
      return LlmProvider;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "llmProviderId" })
  public llmProvider?: LlmProvider = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "LLM Provider ID",
    description:
      "ID of the LLM provider OneUptime AI uses for everything this rule drafts. Empty: the project's default provider, else the global one.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public llmProviderId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description: "User ID who created this object.",
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
    description: "User ID who deleted this object.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
