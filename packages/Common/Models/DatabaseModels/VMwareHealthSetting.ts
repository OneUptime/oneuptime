import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
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
import { DEFAULT_VMWARE_HEALTH_RULES } from "../../Types/VMware/VMwareHealthRules";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Where a project's VMware health rules turn amber and red (#11157): one row
 * per project, made with every default the first time VMware > Settings >
 * Health Rules is opened, read by every vCenter page that says what needs
 * attention (Common/Types/VMware/VMwareHealthRules says what each threshold
 * is). A threshold left empty turns its rule off. A project with no row has
 * the defaults.
 *
 * Who may change it: those who may change a vCenter.
 */
const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadVMwareVCenter,
];

const EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditVMwareVCenter,
];

const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: EDITORS,
  read: READERS,
  update: EDITORS,
};

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: EDITORS,
  read: READERS,
  update: [],
};

@EnableDocumentation()
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/vmware-health-setting"))
@Entity({
  name: "VMwareHealthSetting",
})
@TableMetadata({
  tableName: "VMwareHealthSetting",
  singularName: "VMware Health Setting",
  pluralName: "VMware Health Settings",
  icon: IconProp.Settings,
  tableDescription:
    "Where a project's VMware health rules mark an ESXi host, datastore, VM or resource pool as needing a look or someone now. An empty threshold turns its rule off.",
})
@TableAccessControl({
  create: EDITORS,
  read: READERS,
  update: EDITORS,
  delete: EDITORS,
})
@Index(["projectId"], { unique: true })
export default class VMwareHealthSetting extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project these settings belong to.",
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

  // The unique index on the class is the index this column needs.
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project these settings belong to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "Host CPU Warning Above",
    description:
      "An ESXi host whose CPU is busier than this percent needs a look. Empty: a busy CPU marks no host.",
    defaultValue: DEFAULT_VMWARE_HEALTH_RULES.hostCpuWarningPercent,
    isDefaultValueColumn: true,
    example: "90",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.hostCpuWarningPercent,
  })
  public hostCpuWarningPercent?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "Host Memory Warning Above",
    description:
      "An ESXi host whose memory is busier than this percent needs a look. Empty: busy memory marks no host.",
    defaultValue: DEFAULT_VMWARE_HEALTH_RULES.hostMemoryWarningPercent,
    isDefaultValueColumn: true,
    example: "90",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.hostMemoryWarningPercent,
  })
  public hostMemoryWarningPercent?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "Datastore Warning Above",
    description:
      "A datastore fuller than this percent needs a look. Empty: no datastore is marked for it.",
    defaultValue: DEFAULT_VMWARE_HEALTH_RULES.datastoreWarningPercent,
    isDefaultValueColumn: true,
    example: "80",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.datastoreWarningPercent,
  })
  public datastoreWarningPercent?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "Datastore Critical Above",
    description:
      "A datastore fuller than this percent needs someone now. Empty: no datastore is critical for it.",
    defaultValue: DEFAULT_VMWARE_HEALTH_RULES.datastoreCriticalPercent,
    isDefaultValueColumn: true,
    example: "90",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.datastoreCriticalPercent,
  })
  public datastoreCriticalPercent?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "VM Swapping Out Critical Above",
    description:
      "A VM whose memory the host swaps out to disk faster than this many KiB/s is under memory pressure now, and needs someone. 0: any swapping out. Empty: off.",
    defaultValue: DEFAULT_VMWARE_HEALTH_RULES.vmSwapOutCriticalKibPerSecond,
    isDefaultValueColumn: true,
    example: "0",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.vmSwapOutCriticalKibPerSecond,
  })
  public vmSwapOutCriticalKibPerSecond?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "VM Swapping In Warning Above",
    description:
      "A VM reading its swapped memory back from the host's swap file faster than this many KiB/s needs a look. Empty: off.",
    defaultValue: DEFAULT_VMWARE_HEALTH_RULES.vmSwapInWarningKibPerSecond,
    isDefaultValueColumn: true,
    example: "1024",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.vmSwapInWarningKibPerSecond,
  })
  public vmSwapInWarningKibPerSecond?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "VM Swapped Memory Warning Above",
    description:
      "A VM with more than this many MiB of memory left in the host's swap file from earlier, while nothing is swapped out now, needs a look. Empty: off.",
    defaultValue: DEFAULT_VMWARE_HEALTH_RULES.vmSwappedWarningMebibytes,
    isDefaultValueColumn: true,
    example: "1024",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.vmSwappedWarningMebibytes,
  })
  public vmSwappedWarningMebibytes?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "VM Ballooned Memory Warning Above",
    description:
      "A VM the host takes more than this many MiB of memory back from by ballooning needs a look. 0: any ballooning. Empty: off.",
    defaultValue: DEFAULT_VMWARE_HEALTH_RULES.vmBalloonedWarningMebibytes,
    isDefaultValueColumn: true,
    example: "0",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.vmBalloonedWarningMebibytes,
  })
  public vmBalloonedWarningMebibytes?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "VM CPU Ready Warning Above",
    description:
      "A VM that waits for a free physical CPU more than this percent of the time needs a look. Empty: off.",
    defaultValue: DEFAULT_VMWARE_HEALTH_RULES.vmCpuReadyWarningPercent,
    isDefaultValueColumn: true,
    example: "10",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.vmCpuReadyWarningPercent,
  })
  public vmCpuReadyWarningPercent?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "Resource Pool Swapping Out Warning Above",
    description:
      "A resource pool whose VMs' memory the host swaps out faster than this many KiB/s needs a look. 0: any swapping out. Empty: off.",
    defaultValue:
      DEFAULT_VMWARE_HEALTH_RULES.resourcePoolSwapOutWarningKibPerSecond,
    isDefaultValueColumn: true,
    example: "0",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: DEFAULT_VMWARE_HEALTH_RULES.resourcePoolSwapOutWarningKibPerSecond,
  })
  public resourcePoolSwapOutWarningKibPerSecond?: number = undefined;
}
