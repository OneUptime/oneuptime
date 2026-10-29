import Project from "./Project";
import ThreatIntelFeed from "./ThreatIntelFeed";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { SecurityEntityType } from "../../Types/SecurityCase/SecurityEntity";
import { SecurityWatchlistSource } from "../../Types/SecurityEvent/SecurityWatchlist";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A list a team keeps that detection and correlation rules match against:
 * VIP users, critical hosts, known-bad file hashes, the addresses admins may
 * sign in from. A rule reads it by name - `principalUser|expand:
 * '%vip_users%'` - and its values come from the team (SecurityWatchlistItem,
 * added by hand or imported) or from a threat intel feed it follows
 * (Types/SecurityEvent/SecurityWatchlist has the rules).
 *
 * A watchlist changes what the rules that read it see, so it is kept like
 * the rules themselves: whoever may create, edit or delete detection rules
 * creates, edits or deletes watchlists, and every Security tier reads them.
 * Every change is audited.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadProjectDetectionRule,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateProjectDetectionRule,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditProjectDetectionRule,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.DeleteProjectDetectionRule,
];

const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
};

@EnableDocumentation()
/*
 * How many values a list holds is the server's own count, kept as values
 * come and go: a recount alone records nothing.
 */
@EnableAuditLog({
  ignoreColumns: ["valueCount"],
})
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@CrudApiEndpoint(new Route("/security-watchlist"))
@Entity({
  name: "SecurityWatchlist",
})
@TableMetadata({
  tableName: "SecurityWatchlist",
  singularName: "Watchlist",
  pluralName: "Watchlists",
  icon: IconProp.QueueList,
  tableDescription:
    "Lists a team keeps that detection rules match against, such as VIP users, critical hosts, known-bad file hashes and allowed admin addresses.",
})
export default class SecurityWatchlist extends BaseModel {
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
    description: "Relation to the project this watchlist belongs to.",
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
    description: "ID of the project this watchlist belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What rules call the list, between % signs: a rule reads vip_users as principalUser|expand: '%vip_users%'. Letters, digits and underscores, starting with a letter; unique in the project whatever the case.",
    example: "vip_users",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  @Index()
  public name?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "What the list is for, for whoever reads it later.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  /*
   * Chosen when the list is created, and kept: every value on the list was
   * checked against it.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Holds",
    description:
      "What the list holds: User, Host, IP Address, File Hash, Domain, URL, Process or Other. It decides which values the list takes - an IP address list takes addresses and ranges such as 10.20.0.0/16 - and which indicators a threat intel feed gives it.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public entityType?: SecurityEntityType = undefined;

  // Chosen when the list is created, and kept.
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Source",
    description:
      "Where the values come from: Values (added by hand or imported) or Threat Intel Feed (the feed's active indicators of the list's kind).",
    defaultValue: SecurityWatchlistSource.Values,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityWatchlistSource.Values,
  })
  public source?: SecurityWatchlistSource = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "threatIntelFeedId",
    type: TableColumnType.Entity,
    modelType: ThreatIntelFeed,
    title: "Threat Intel Feed",
    description:
      "For a list that follows a feed: the feed whose active indicators are the list's values.",
  })
  @ManyToOne(
    () => {
      return ThreatIntelFeed;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "threatIntelFeedId" })
  public threatIntelFeed?: ThreatIntelFeed = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Threat Intel Feed ID",
    description:
      "For a list that follows a feed: the ID of the feed whose active indicators are the list's values.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public threatIntelFeedId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Value Count",
    description:
      "How many values the list holds, counted by OneUptime as values are added and removed. 0 for a list that follows a threat intel feed.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: 0,
  })
  public valueCount?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person who created the watchlist.",
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
    title: "Created By User ID",
    description: "ID of the person who created the watchlist.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "The person who deleted the watchlist.",
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
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the person who deleted the watchlist.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
