import Project from "./Project";
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
import ServerOwned from "../../Types/Database/ServerOwned";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import HashedString from "../../Types/HashedString";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import {
  SecurityBlocklistFeedFamily,
  SecurityBlocklistFeedFirewall,
} from "../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A BLOCKLIST FEED (#10345): a secret URL a firewall or a proxy reads the
 * project's blocklist from, on a schedule (Types/SecurityBlocklist/
 * SecurityBlocklistFeed). Pull, not push: the firewall reaches OneUptime,
 * so OneUptime never needs a route into the customer's network or a
 * firewall admin's credentials.
 *
 * Each feed is a destination of the blocklist (Server/Utils/
 * SecurityBlocklist/SecurityBlocklistFeedDestination). What it holds is
 * what the firewall fetched last - servedValues, confirmed at
 * servedConfirmedAt - so a block counts as enforced at the feed only once
 * the firewall has fetched a list that holds it, and only while it keeps
 * fetching. Every fetch is logged (SecurityBlocklistFeedFetch), for 30 days.
 *
 * The secret is OneUptime's to make (PresentedKey.generate: 256 random
 * bits), and shown once, as a project API key is: in the answer to the
 * create that makes the feed and to a rotation, and never again. It is kept
 * only as its hash, with its last four characters (secretHint) to tell it
 * by. A rotation keeps the secret it replaced working for a day, so the
 * firewall can be given the new one without a gap; revoking ends both at
 * once. A firewall sends it as a password (basic auth), as a bearer token,
 * or in the URL's path, for the firewalls that can send neither.
 *
 * Making, changing and deleting a feed is a Security Admin's, a Project
 * Admin's or a Project Owner's, as connecting a security connection is:
 * the secret reads the blocklist, and its URL decides where it is enforced.
 * Every security role reads the feeds - never a secret.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityBlocklistFeed,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.CreateSecurityBlocklistFeed,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.EditSecurityBlocklistFeed,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteSecurityBlocklistFeed,
];

// What a person sets: its name, its firewall, what it serves, who may read it.
const settingColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
};

/*
 * The secret's own columns: written only by the service's rotate and revoke
 * (SecurityBlocklistFeedService), with the caller's props, so they ask what
 * changing the feed asks; never by a request that names them.
 */
const secretColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: updatePermissions,
};

// What OneUptime writes as firewalls fetch the feed; people read it.
const serverColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

// What only OneUptime reads: what the firewall was served last.
const serverOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: [],
  update: [],
};

@EnableDocumentation()
@EnableAuditLog({
  resourceNameColumns: ["name"],
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
@CrudApiEndpoint(new Route("/security-blocklist-feed"))
@Entity({
  name: "SecurityBlocklistFeed",
})
@TableMetadata({
  tableName: "SecurityBlocklistFeed",
  singularName: "Blocklist Feed",
  pluralName: "Blocklist Feeds",
  icon: IconProp.CloudArrowDown,
  tableDescription:
    "A secret URL a firewall or a proxy reads the project's blocklist from, on a schedule: Palo Alto, FortiGate, Check Point, Cisco, OPNsense, pfSense, nftables, nginx and others.",
})
export default class SecurityBlocklistFeed extends BaseModel {
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
    description: "Relation to the project this feed belongs to.",
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
    description: "ID of the project this feed belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(settingColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What the feed is called where it is enforced: the firewall or proxy that reads it, such as Palo Alto edge firewall.",
    example: "Palo Alto edge firewall",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl(settingColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(SecurityBlocklistFeedFirewall),
    isDefaultValueColumn: true,
    defaultValue: SecurityBlocklistFeedFirewall.Other,
    canReadOnRelationQuery: true,
    title: "Firewall",
    description:
      "The firewall or proxy that reads the feed, whose setup steps its page opens on. Any of them can read any feed.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlocklistFeedFirewall.Other,
  })
  public firewall?: SecurityBlocklistFeedFirewall = undefined;

  @ColumnAccessControl(settingColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(SecurityBlocklistFeedFamily),
    isDefaultValueColumn: true,
    defaultValue: SecurityBlocklistFeedFamily.Both,
    canReadOnRelationQuery: true,
    title: "Serves",
    description:
      "What the feed serves: IPv4 and IPv6 addresses (Both), or one of them, for a firewall that keeps them apart.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlocklistFeedFamily.Both,
  })
  public family?: SecurityBlocklistFeedFamily = undefined;

  // Up to 50 addresses and ranges, each as long as an IPv6 range (43 characters): text, not 500 characters.
  @ColumnAccessControl(settingColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Allowed Source Addresses",
    description:
      "The only addresses and ranges the feed answers, one a line: the firewall's own. Empty to answer any address that has the secret.",
    example: "203.0.113.7\n198.51.100.0/24",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public allowedSourceAddresses?: string = undefined;

  /*
   * The secret, hashed: the SHA-256 of it with the server's
   * ENCRYPTION_SECRET, as a project API key's is. Shown once (shownOnce):
   * in the answer to the create that makes the feed, and to a rotation of it
   * (POST /security-blocklist-feed/:id/rotate-secret), and never again.
   * Nobody reads it, or its hash, through the API. Empty once revoked.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.HashedString,
    shownOnce: true,
    computed: true,
    title: "Secret",
    description:
      "The feed's secret, which a firewall sends as a password, as a bearer token or in the URL. Shown once: in the answer to the create that makes the feed, or to a rotation of it. OneUptime keeps only its hash.",
    example: "4f1c0e5d8a7b6c3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e",
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    nullable: true,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public secret?: HashedString = undefined;

  // The secret's last four characters, shown in its place: "ends in 9e2b". Never enough to use it.
  @ColumnAccessControl(secretColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Secret Hint",
    description:
      "The last four characters of the feed's secret, shown in its place so a person can tell which secret a firewall holds. Never enough to use it.",
    example: "0d9e",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public secretHint?: string = undefined;

  @ColumnAccessControl(secretColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Secret Made At",
    description: "When the feed's current secret was made.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public secretMadeAt?: Date = undefined;

  /*
   * The secret a rotation replaced, hashed: it keeps working until
   * previousSecretExpiresAt, a day after the rotation, so every firewall can
   * be given the new one without a gap. Never read through the API.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.HashedString,
    computed: true,
    hideColumnInDocumentation: true,
    title: "Previous Secret",
    description:
      "The hash of the secret the last rotation replaced, which keeps working until Previous Secret Expires At.",
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    nullable: true,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public previousSecret?: HashedString = undefined;

  @ColumnAccessControl(secretColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Previous Secret Expires At",
    description:
      "When the secret the last rotation replaced stops working: a day after the rotation, or at once when the feed's secret is revoked.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public previousSecretExpiresAt?: Date = undefined;

  @ColumnAccessControl(secretColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Revoked At",
    description:
      "When the feed's secret was revoked. A revoked feed answers no firewall until a new secret is made.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public revokedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    serverOwned: ServerOwned.Always,
    title: "Last Fetched At",
    description: "When a firewall last fetched the feed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastFetchedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    serverOwned: ServerOwned.Always,
    title: "Last Fetched From",
    description: "The address the feed was last fetched from.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public lastFetchSourceIp?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    computed: true,
    serverOwned: ServerOwned.Always,
    title: "Last Fetched By",
    description:
      "The user agent the feed was last fetched with: the firewall or tool that read it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public lastFetchUserAgent?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    serverOwned: ServerOwned.Always,
    title: "Usual Fetch Interval In Seconds",
    description:
      "How often the firewall usually fetches the feed: the median gap between its latest fetches. Three times it without a fetch, and the firewall has stopped reading the feed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public usualFetchIntervalInSeconds?: number = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    serverOwned: ServerOwned.Always,
    title: "Stopped Reading Told At",
    description:
      "When the Project Owners were told the firewall stopped reading the feed. Cleared when it reads it again, so they are told once each time.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public stoppedReadingToldAt?: Date = undefined;

  /*
   * What the firewall holds: the entries of the last list it fetched, as
   * blocks are written. Only OneUptime reads it: it is what the feed's
   * destination reads back.
   */
  @ColumnAccessControl(serverOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    computed: true,
    hideColumnInDocumentation: true,
    serverOwned: ServerOwned.Always,
    title: "Served Values",
    description:
      "The addresses and ranges of the last list a firewall fetched: what it holds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public servedValues?: JSONArray = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    serverOwned: ServerOwned.Always,
    title: "Served Count",
    description:
      "How many addresses and ranges the last list a firewall fetched held.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public servedCount?: number = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    serverOwned: ServerOwned.Always,
    title: "Served Confirmed At",
    description:
      "When a firewall last fetched the feed and was found to hold its last list: the time its blocks were last confirmed there.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public servedConfirmedAt?: Date = undefined;

  // The MD5 of the last list served in full: what Cisco holds when it asks for the MD5 again.
  @ColumnAccessControl(serverOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    hideColumnInDocumentation: true,
    serverOwned: ServerOwned.Always,
    title: "Served Body MD5",
    description: "The MD5 of the last list a firewall fetched in full.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public servedBodyMd5?: string = undefined;
}
