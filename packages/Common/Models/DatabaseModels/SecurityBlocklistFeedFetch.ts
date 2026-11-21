import Project from "./Project";
import SecurityBlocklistFeed from "./SecurityBlocklistFeed";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
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
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE FETCH OF A BLOCKLIST FEED (#10345): when a firewall read it, from
 * where, with what, how it proved it had the secret, and whether the list
 * had changed since the fetch before. Written by the feed's route as it
 * answers (SecurityBlocklistFeedServe), kept 30 days (the
 * SecurityBlocklist:PurgeFeedFetches job), and read by the feed's page and
 * by the check that a firewall still reads the feed.
 *
 * It is the evidence: a block is enforced at a feed only once a fetch after
 * the block was made returned it. Nobody writes it but OneUptime, and
 * nobody changes it.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityBlocklistFeed,
];

const serverColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/security-blocklist-feed-fetch"))
@Entity({
  name: "SecurityBlocklistFeedFetch",
})
@TableMetadata({
  tableName: "SecurityBlocklistFeedFetch",
  singularName: "Blocklist Feed Fetch",
  pluralName: "Blocklist Feed Fetches",
  icon: IconProp.CloudArrowDown,
  tableDescription:
    "Each time a firewall fetched a blocklist feed: when, from where, with what, and whether the list had changed. Kept 30 days.",
})
// A feed's fetches, the latest first: its page, and how often its firewall reads it.
@Index(["securityBlocklistFeedId", "fetchedAt"])
// The fetches past the 30 days the log keeps.
@Index(["fetchedAt"])
export default class SecurityBlocklistFeedFetch extends BaseModel {
  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this fetch belongs to.",
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

  @ColumnAccessControl(serverColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this fetch belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityBlocklistFeedId",
    type: TableColumnType.Entity,
    modelType: SecurityBlocklistFeed,
    title: "Blocklist Feed",
    description: "The feed that was fetched.",
  })
  @ManyToOne(
    () => {
      return SecurityBlocklistFeed;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityBlocklistFeedId" })
  public securityBlocklistFeed?: SecurityBlocklistFeed = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Blocklist Feed ID",
    description: "ID of the feed that was fetched.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityBlocklistFeedId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Fetched At",
    description: "When the feed was fetched.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public fetchedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Source Address",
    description: "The address the feed was fetched from.",
    example: "203.0.113.7",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public sourceIp?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    computed: true,
    title: "User Agent",
    description:
      "What the feed was fetched with: the firewall or tool that read it.",
    example: "PAN-OS",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public userAgent?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "File",
    description:
      "What was fetched: the plain list (blocklist.txt, with ?comments=1 when it carried comments), its MD5, the nftables script or the nginx include.",
    example: "blocklist.txt",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public file?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Secret Sent As",
    description:
      "How the firewall sent the secret: as a password (Basic), a bearer token (Bearer) or in the URL (Path).",
    example: "Basic",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public authMethod?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    title: "Used Previous Secret",
    description:
      "Whether the firewall sent the secret a rotation replaced, which stops working a day after the rotation.",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public usedPreviousSecret?: boolean = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    title: "Status Code",
    description:
      "What the feed answered: 200 with the list, or 304 when the firewall already held it (If-None-Match).",
    example: 200,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public statusCode?: number = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    title: "List Changed",
    description:
      "Whether the list was different from the one the fetch before was answered with.",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isChanged?: boolean = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    title: "Entry Count",
    description: "How many addresses and ranges the list held.",
    example: 12,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public entryCount?: number = undefined;
}
