import MonitorTemplate from "./MonitorTemplate";
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
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import NetworkAlertPolicyScope from "../../Types/NetworkDevice/NetworkAlertPolicyScope";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * "Alert on a SET of devices."
 *
 * Every Network Device monitor watches exactly one device, so before this
 * table an operator with two hundred warehouse switches who wanted
 * "unreachable -> incident" on all of them created two hundred monitors by
 * hand — and a two-hundred-and-first when the next switch was discovered.
 * A policy says it once: WHICH devices (the scope: sites, roles, labels) and
 * WHAT to alert on (a Network Device monitor template), and the engine keeps
 * one monitor per matching device provisioned from that template as devices
 * are added, re-sited, re-labelled and removed.
 *
 * The row is the intent; the monitors are the consequence. Nothing about a
 * monitor is stored here — the engine (NetworkAlertPolicyEngineService)
 * finds a policy's monitors by their provenance and owns their lifecycle.
 *
 * WHO MAY WRITE ONE. Creating a policy provisions monitors, and monitors are
 * what the plan is billed on: an unscoped policy in a large estate is
 * thousands of monitors from a single form submit. Create, update and delete
 * are therefore held to ProjectOwner / ProjectAdmin and the policy's own
 * granular permissions — no ProjectMember, no Viewer, and none of the
 * Settings* roles that can edit a device role or a site type, because those
 * are labels and this is spend. A member who needs to run policies is
 * handed CreateNetworkAlertPolicy explicitly. Reading stays open to every
 * project role: the policy list is how anybody finds out why a monitor
 * exists.
 *
 * ONE POLICY PER TEMPLATE PER PROJECT, enforced by the partial unique index
 * below. A provisioned monitor's provenance is (device, template) — the
 * unique index Monitor itself carries — so that pair is the only key the
 * engine has for "is this monitor mine?". A template used by two policies
 * would make ownership of every (device, template) monitor ambiguous: both
 * would claim it, the second to provision would fail on Monitor's index
 * forever, and neither could safely tear it down when a device left its
 * scope. Partial, so soft-deleted policies release their template and a
 * template-less policy (after SET NULL) never collides with another.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateNetworkAlertPolicy,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadNetworkAlertPolicy,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteNetworkAlertPolicy,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditNetworkAlertPolicy,
  ],
})
@CrudApiEndpoint(new Route("/network-alert-policy"))
@Index(
  "IDX_network_alert_policy_project_template_unique",
  ["projectId", "monitorTemplateId"],
  {
    unique: true,
    where: '"deletedAt" IS NULL AND "monitorTemplateId" IS NOT NULL',
  },
)
@TableMetadata({
  tableName: "NetworkAlertPolicy",
  singularName: "Network Alert Policy",
  pluralName: "Network Alert Policies",
  icon: IconProp.Alert,
  tableDescription:
    "Alert on a set of network devices at once: every device matching the policy's sites, roles and labels gets a Network Device monitor provisioned from the policy's monitor template, and kept as devices come and go.",
})
@Entity({
  name: "NetworkAlertPolicy",
})
export default class NetworkAlertPolicy extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
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
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
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
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditNetworkAlertPolicy,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Any friendly name of this object",
    example: "Warehouse switches - reachability",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditNetworkAlertPolicy,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example:
      "Every switch in a warehouse site raises an incident when unreachable.",
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
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditNetworkAlertPolicy,
    ],
  })
  /*
   * The pause switch. Off means the engine stops provisioning for this
   * policy and stands down what it provisioned; the row, its scope and its
   * template survive, so switching it back on restores the same set. This
   * is the operator's way to take a policy out of service — clearing the
   * template is not offered for that (see monitorTemplate).
   */
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Enabled",
    description:
      "Whether this policy is active. Disable it to stop provisioning monitors for matching devices without deleting the policy.",
    defaultValue: true,
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
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadMonitorTemplate,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditNetworkAlertPolicy,
    ],
  })
  /*
   * WHAT every matching device is alerted on: a Network Device monitor
   * template, cloned once per device by the engine.
   *
   * Required to the operator, nullable to the database — and the gap is
   * deliberate. The FK is SET NULL rather than CASCADE because a template is
   * configuration and a policy is intent: deleting "Reachability v1" must
   * not silently delete the six policies that used it, taking their scopes
   * and names with them. Instead those policies lose their template, the
   * engine treats a policy with no template exactly as it treats a disabled
   * one (nothing to provision from, so nothing is provisioned), and the
   * settings table can show "template deleted — pick another" against a row
   * the operator can still recognise and repair. The service refuses to
   * write the null itself; only the cascade produces it.
   *
   * Read permissions are the MonitorTemplate's own (the
   * NetworkDeviceAutoImportRule precedent): selecting this relation reads a
   * template's name and type, so it takes the permission that reading the
   * template takes.
   */
  @TableColumn({
    manyToOneRelationColumn: "monitorTemplateId",
    type: TableColumnType.Entity,
    modelType: MonitorTemplate,
    required: true,
    title: "Monitor Template",
    description:
      "The Network Device monitor template every matching device gets a monitor cloned from. Deleting the template disables the policy rather than deleting it.",
  })
  @ManyToOne(
    () => {
      return MonitorTemplate;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "monitorTemplateId" })
  public monitorTemplate?: MonitorTemplate = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadMonitorTemplate,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditNetworkAlertPolicy,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Monitor Template ID",
    description:
      "ID of the Network Device monitor template every matching device gets a monitor cloned from. Null only after the template was deleted, which disables the policy.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorTemplateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditNetworkAlertPolicy,
    ],
  })
  /*
   * WHICH devices: a NetworkAlertPolicyScope — site ids, device-role ids and
   * label ids, ANDed across kinds and ORed within one, an empty kind
   * matching everything. See Common/Types/NetworkDevice/
   * NetworkAlertPolicyScope.ts for the rule and for why this is one jsonb
   * column rather than three join tables.
   *
   * NOT NULL with a `{}` default: `{}` is "all devices", which is a real
   * policy and the widest one, so the column must always hold a readable
   * scope for the engine to evaluate. The service normalizes every write, so
   * what is stored is always the canonical deduplicated form.
   */
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.JSON,
    title: "Scope",
    description:
      "Which devices this policy covers: site ids, device role ids and label ids. A device must match every kind that is listed (AND) and any id within a kind (OR); a kind left empty matches every device. Empty altogether means every device in the project.",
    defaultValue: {},
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
    default: () => {
      return "'{}'";
    },
  })
  public scope?: NetworkAlertPolicyScope = undefined;

  /*
   * THE ENGINE'S FOUR COLUMNS. Written only by NetworkAlertPolicyEngineService,
   * as root, after each reconciliation pass; the API can read them and can
   * never set them (create and update are empty, the
   * Monitor.autoProvisionedNetworkDeviceId pairing). They are what the
   * settings table shows against a policy so an operator can tell a policy
   * that is quietly working from one that has been failing since Tuesday,
   * without opening the monitor list to count.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    canReadOnRelationQuery: true,
    title: "Last Sync At",
    description:
      "When the engine last reconciled this policy's monitors against its matching devices. Managed by the engine.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSyncAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
    update: [],
  })
  /*
   * The last pass's failure, verbatim, or null after a clean one. Kept on
   * the row rather than only in the logs because the operator reading the
   * settings table is the one who can fix it — a deleted template, a
   * monitor limit reached — and the log line is not where they are.
   */
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Last Sync Error",
    description:
      "Why the engine's last reconciliation of this policy failed, if it did. Cleared by the next successful pass. Managed by the engine.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public lastSyncError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
    update: [],
  })
  /*
   * How many devices the policy covered at its last pass — the number the
   * settings table puts beside the scope sentence, so "Devices in 2 sites"
   * reads "Devices in 2 sites (37)". A count, stamped, rather than a live
   * query: the list page renders every policy at once and must not walk
   * the device table per row to do it.
   */
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    isDefaultValueColumn: true,
    canReadOnRelationQuery: true,
    title: "Covered Device Count",
    description:
      "How many devices matched this policy's scope at the engine's last reconciliation. Managed by the engine.",
    defaultValue: 0,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public coveredDeviceCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
    update: [],
  })
  /*
   * When the policy's monitors were last brought in line with the TEMPLATE
   * (as opposed to with the device set, which is lastSyncAt). A template
   * edit changes what every provisioned monitor should look like; this is
   * how the engine knows whether the fleet has caught up with it.
   */
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    canReadOnRelationQuery: true,
    title: "Template Synced At",
    description:
      "When this policy's provisioned monitors were last re-synced from the monitor template. Managed by the engine.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public templateSyncedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
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
      Permission.CreateNetworkAlertPolicy,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadNetworkAlertPolicy,
    ],
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
