import CloudCostView from "./CloudCostView";
import KubernetesCluster from "./KubernetesCluster";
import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import ListOrderColumn from "../../Types/Database/ListOrderColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import {
  CloudCostSharedPercentages,
  CloudCostSharedSplit,
} from "../../Types/Cloud/CloudCostAllocation";
import { CloudCostRule } from "../../Types/Cloud/CloudCostRules";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A COST GROUP: one team, product or cost center of a cost view, and the
 * rules that say which costs are its own - "Payments: tag team is
 * payments, or account 1234-5678, or owned by the Payments team"
 * (Types/Cloud/CloudCostRules). A cost falls into the first group of its
 * view that matches it, in the order the groups are dragged into, so
 * nothing is counted twice.
 *
 * A group can be linked to its team: its page then says whose it is, and
 * a team member who may read the cloud's spend opens it to see only the
 * group's. A SHARED group - a support plan, a shared cluster - keeps none
 * of its costs: they are split across the view's other groups, evenly, by
 * their share of the month's spend, or by fixed percentages.
 *
 * The groups of a view made per tag value or per owner team are made by
 * OneUptime (automaticKey); their rules are its own, and the rest of them
 * is yours: the name, the team, whether it is shared.
 *
 * Budgets (#11008) and reports (#11009) name a group by its ID and read
 * its spend through the allocation (CloudCostAllocation.readGroup).
 */

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateCloudResource,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditCloudResource,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteCloudResource,
];

@EnableDocumentation()
@EnableMCP()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/cloud-cost-group"))
@ListOrderColumn({ column: "order", scopeColumns: ["cloudCostViewId"] })
@TableMetadata({
  tableName: "CloudCostGroup",
  singularName: "Cloud Cost Group",
  pluralName: "Cloud Cost Groups",
  icon: IconProp.RectangleStack,
  tableDescription:
    "A team, product or cost center of a cost view, and the rules that say which cloud costs are its own. A cost falls into the first group whose rules match it.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@Index(["cloudCostViewId", "order"])
@Entity({
  name: "CloudCostGroup",
})
export default class CloudCostGroup extends BaseModel {
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this group belongs to.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this group belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudCostViewId",
    type: TableColumnType.Entity,
    modelType: CloudCostView,
    title: "Cost View",
    description: "The view the group is one of.",
  })
  @ManyToOne(
    () => {
      return CloudCostView;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudCostViewId" })
  public cloudCostView?: CloudCostView = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Cost View ID",
    description: "The view the group is one of.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudCostViewId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "The team, product or cost center the group is.",
    example: "Payments",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("cloudCostViewId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "What the group is, in your team's words.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  /*
   * The group's rules: a cost is the group's when any rule matches it, and
   * a rule matches when all its conditions do (CloudCostRules). Checked on
   * every write (CloudCostGroupService).
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Rules",
    description:
      'Which costs are the group\'s: a list of rules, any of which matches. A rule is {"conditions": [...]}, all of which must match; a condition is {"field", "operator", "values"} and, for a tag, "key". Fields: account, provider, service, region, resource, tag, ownerTeam, label, environment, app, kubernetesCluster, kubernetesNamespace. Operators: is, isNot, contains, doesNotContain, startsWith, endsWith, and for a tag exists and doesNotExist.',
    example:
      '[{"conditions":[{"field":"tag","key":"team","operator":"is","values":["payments"]}]}]',
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public rules?: Array<CloudCostRule> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Order",
    required: false,
    description:
      "Where the group is among its view's groups, lowest number first: a cost falls into the first group whose rules match it. A new group is added to the end of the list. Setting a number places it there and moves no other one: two at one number are read the older first. In the dashboard, drag the rows to reorder them.",
  })
  @Column({
    type: ColumnType.Number,
  })
  public order?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "teamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Team",
    description: "The team the group's spend belongs to.",
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
  @JoinColumn({ name: "teamId" })
  public team?: Team = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Team ID",
    description: "ID of the team the group's spend belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public teamId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Shared",
    description:
      "Whether the group's costs are split across the view's other groups, as a support plan or a shared cluster is.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isShared?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Split",
    description:
      "How a shared group's costs are split across the other groups: Even, Proportional (by each one's share of the month's cloud spend), Fixed (by Shared Percentages) or Kubernetes (by what each namespace of Kubernetes Cluster cost that month).",
    defaultValue: CloudCostSharedSplit.Proportional,
    isDefaultValueColumn: true,
    allowedValues: Object.values(CloudCostSharedSplit),
    example: "Proportional",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: CloudCostSharedSplit.Proportional,
  })
  public sharedSplit?: CloudCostSharedSplit = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Shared Percentages",
    description:
      'For a shared group split by fixed percentages: each other group\'s ID and its percent, together 100, such as {"<group ID>": 60, "<group ID>": 40}.',
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public sharedPercentages?: CloudCostSharedPercentages = undefined;

  /*
   * For a shared group split by a Kubernetes cluster's namespaces: the
   * cluster whose cost engine says what each namespace cost.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "kubernetesClusterId",
    type: TableColumnType.Entity,
    modelType: KubernetesCluster,
    title: "Kubernetes Cluster",
    description:
      "For a shared group split by Kubernetes namespaces: the cluster whose namespaces' costs split it.",
  })
  @ManyToOne(
    () => {
      return KubernetesCluster;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "kubernetesClusterId" })
  public kubernetesCluster?: KubernetesCluster = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Kubernetes Cluster ID",
    description:
      "ID of the cluster whose namespaces' costs split a shared group.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public kubernetesClusterId?: ObjectID = undefined;

  /*
   * What OneUptime made the group for, in a view made per tag value or per
   * owner team: the tag's value, or the team's ID. Its rules are then
   * OneUptime's (CloudCostViewSync). Empty for a group written by hand.
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Made For",
    description:
      "In a view made per tag value or per owner team: the tag value or the team's ID OneUptime made the group for. Empty for a group written by hand.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public automaticKey?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description: "Relation to the user who created this group.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description: "ID of the user who created this group.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
