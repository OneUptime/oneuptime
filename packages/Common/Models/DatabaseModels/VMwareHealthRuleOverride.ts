import Project from "./Project";
import VMwareVCenter from "./VMwareVCenter";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  VMwareHealthRuleOverrideRules,
  VMwareHealthRuleScope,
} from "../../Types/VMware/VMwareHealthRuleOverrides";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Health rules of their own for one vCenter, cluster, ESXi host or VM
 * (#11469), replacing some of the project's (VMwareHealthSetting) for what
 * the part covers: a lab vCenter, a cluster of batch hosts meant to run hot.
 * Rule by rule, the most specific override wins
 * (Common/Types/VMware/VMwareHealthRuleOverrides says how they apply).
 *
 * `rules` holds a value for each rule it sets - a threshold, or null for
 * off; a rule it does not hold is inherited. Where the part sits (its name,
 * datacenter, cluster and host) is copied from its VMwareResource row when
 * the override is made, by the service: the VMs on a host and the hosts of
 * a cluster are found by those names, and the list says them even once the
 * part is gone from the vCenter. One override per part.
 *
 * Who may change one: those who may change the project's health rules.
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

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: EDITORS,
  read: READERS,
  update: [],
};

// Written by the service from the part's row, never by the caller.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: READERS,
  update: [],
};

@EnableDocumentation()
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/vmware-health-rule-override"))
@Entity({
  name: "VMwareHealthRuleOverride",
})
@TableMetadata({
  tableName: "VMwareHealthRuleOverride",
  singularName: "VMware Health Rule Override",
  pluralName: "VMware Health Rule Overrides",
  icon: IconProp.Settings,
  tableDescription:
    "VMware health rules of their own for one vCenter, cluster, ESXi host or VM, replacing some of the project's for what it covers. The most specific override of a rule wins.",
})
@TableAccessControl({
  create: EDITORS,
  read: READERS,
  update: EDITORS,
  delete: EDITORS,
})
@Index(["projectId", "vmwareVCenterId", "scope", "resourceExternalId"], {
  unique: true,
  where: '"deletedAt" IS NULL AND "resourceExternalId" IS NOT NULL',
})
@Index(["projectId", "vmwareVCenterId", "scope"], {
  unique: true,
  where: '"deletedAt" IS NULL AND "resourceExternalId" IS NULL',
})
export default class VMwareHealthRuleOverride extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this override belongs to.",
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

  // The unique indexes on the class start with this column.
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this override belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "vmwareVCenterId",
    type: TableColumnType.Entity,
    modelType: VMwareVCenter,
    title: "vCenter",
    description: "The vCenter the overridden part is in.",
  })
  @ManyToOne(
    () => {
      return VMwareVCenter;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "vmwareVCenterId" })
  public vmwareVCenter?: VMwareVCenter = undefined;

  @Index()
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "vCenter ID",
    description: "ID of the vCenter the overridden part is in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public vmwareVCenterId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Applies To",
    description:
      "What the override covers: VCenter (everything in it), Cluster (the cluster, its hosts, their VMs and its resource pools), Host (the host and its VMs) or VirtualMachine (one VM).",
    allowedValues: Object.values(VMwareHealthRuleScope),
    example: "Cluster",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public scope?: VMwareHealthRuleScope = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Resource External ID",
    description:
      "The cluster's, host's or VM's id in the vCenter (its VMware resource's External ID: cluster/<datacenter>/<cluster>, host/<datacenter>/<host>, vm/<instance uuid>). Empty for a whole vCenter.",
    example: "cluster/dc-north/cluster-alpha",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public resourceExternalId?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Resource Name",
    description:
      "The cluster's, host's or VM's name when the override was made.",
    example: "cluster-alpha",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public resourceName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Datacenter Name",
    description: "The datacenter the overridden part is in.",
    example: "dc-north",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public datacenterName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Cluster Name",
    description:
      "The cluster the overridden part is, or is in: its hosts and VMs are found by it.",
    example: "cluster-alpha",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public clusterName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Host Name",
    description:
      "The ESXi host the overridden part is, or runs on: its VMs are found by it.",
    example: "esx-node-07.acme.lan",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public hostName?: string = undefined;

  @ColumnAccessControl({
    create: EDITORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    canReadOnRelationQuery: true,
    title: "Rules",
    description:
      "The rules this override sets, by the project's rule names (hostCpuWarningPercent, vmSwapEvaluationMinutes, ...): a number, or null to turn a threshold off. A rule it does not hold is the next override's, or the project's.",
    example: '{"hostCpuWarningPercent": 95, "vmCpuReadyWarningPercent": null}',
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public rules?: VMwareHealthRuleOverrideRules = undefined;
}
