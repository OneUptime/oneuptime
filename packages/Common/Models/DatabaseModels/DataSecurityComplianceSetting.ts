import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
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
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import ColumnLength from "../../Types/Database/ColumnLength";
import {
  ALL_COMPLIANCE_SETTING_FRAMEWORKS,
  ComplianceSettingFramework,
} from "../../Types/DataSecurity/ComplianceSettingFramework";
import { DataStoreResourceKind } from "../../Types/DataSecurity/DataStoreResource";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * What one resource turned off of a compliance framework (#9555): the whole
 * framework, or one of its requirements, for a Kubernetes cluster, a Docker
 * or Podman host, a database, a cloud resource or a service
 * (Types/DataSecurity/DataStoreResource). It takes the stores whose
 * compliance that resource owns out of the framework's scope, or out of
 * that requirement's, on the resource's Compliance page and on the
 * project's (Types/DataSecurity/ComplianceScope). A framework with no row
 * applies as the data says it does.
 *
 * Turning one off makes a row; turning it on again sets the row's isEnabled,
 * so whoever may turn a framework off for a resource may turn it back on.
 *
 * A Kubernetes cluster is also scored itself, against the Pod Security
 * Standards and the CIS Kubernetes Benchmark (#9627,
 * Types/Kubernetes/Compliance): a row can turn one of those, or one of their
 * controls, off for the cluster - or, naming a namespace, for that namespace
 * alone, as Pod Security Admission exempts a namespace.
 *
 * It tunes how Data Security scores what its checks found, as a check
 * setting tunes the checks themselves, so the same permissions read and
 * change it: the Security tiers, and a custom role given the check setting
 * permissions.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataSecurityCheckSetting,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateDataSecurityCheckSetting,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataSecurityCheckSetting,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteDataSecurityCheckSetting,
];

// Columns OneUptime writes; people read them.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
};

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@EnableMCP()
/*
 * Every change is recorded: who turned a framework or requirement off, on
 * or back, and the reason written for it (#9629). An entry is named by the
 * framework and requirement ("PCI DSS 3.4"), never by the setting's id.
 */
@EnableAuditLog({
  create: true,
  update: true,
  delete: true,
  resourceNameColumns: ["framework", "requirement", "namespace"],
})
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/data-security-compliance-setting"))
@Entity({
  name: "DataSecurityComplianceSetting",
})
@TableMetadata({
  tableName: "DataSecurityComplianceSetting",
  singularName: "Compliance Setting",
  pluralName: "Compliance Settings",
  icon: IconProp.ClipboardDocumentCheck,
  tableDescription:
    "A compliance framework, or one of its requirements, a resource turned off for its own data stores.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
  delete: deletePermissions,
})
// A resource's settings, read together on its Compliance page.
@Index(["projectId", "resourceType", "resourceId"])
export default class DataSecurityComplianceSetting extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this compliance setting belongs to.",
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

  @ColumnAccessControl(createOnlyColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this compliance setting belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataStoreResourceKind),
    required: true,
    canReadOnRelationQuery: true,
    title: "Resource Type",
    description:
      "The kind of resource that turned the framework off: KubernetesCluster, DockerHost, PodmanHost, DatabaseServer, CloudResource or Service.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public resourceType?: DataStoreResourceKind = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Resource ID",
    description: "The ID of the resource that turned the framework off.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public resourceId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: [...ALL_COMPLIANCE_SETTING_FRAMEWORKS],
    required: true,
    canReadOnRelationQuery: true,
    title: "Framework",
    description:
      "The compliance framework this setting changes for the resource: GDPR, CCPA, HIPAA, PCI DSS, SOC 2, ISO 27001, NIST CSF, LGPD or DPDP, or for a Kubernetes cluster PSS Baseline, PSS Restricted or CIS Kubernetes.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public framework?: ComplianceSettingFramework = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Requirement",
    description:
      "One requirement of the framework, as Data Security names it (for example Art. 32 or CC6.1). Empty for the whole framework.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public requirement?: string = undefined;

  /*
   * A namespace of the Kubernetes cluster the setting names (#9627): the
   * cluster's own frameworks, or one of their controls, turned off for that
   * namespace alone. Empty for the whole resource; only a Kubernetes
   * framework's setting names one.
   */
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Namespace",
    description:
      "For a Kubernetes cluster's PSS Baseline, PSS Restricted or CIS Kubernetes setting, the one namespace it is for. Empty for the whole resource.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public namespace?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description:
      "Whether the framework or requirement applies to the resource. Off takes the resource's data stores out of its scope.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Note",
    description: "Why it does not apply to the resource.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public note?: string = undefined;

  /*
   * Who last turned it off, and when (#9629): an auditor's first question
   * about a framework that does not apply here. The row is made the first
   * time it is turned off and only changed after that, so who made it may
   * not be who turned it off last. OneUptime writes both whenever it goes
   * from on to off, and clears them when it is turned on again.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "turnedOffByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Turned Off By User",
    description:
      "Relation to the user who last turned the framework or requirement off for the resource.",
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
  @JoinColumn({ name: "turnedOffByUserId" })
  public turnedOffByUser?: User = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Turned Off By User ID",
    description:
      "ID of the user who last turned the framework or requirement off for the resource. Empty while it applies, or when an API key turned it off.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public turnedOffByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Turned Off At",
    description:
      "When the framework or requirement was last turned off for the resource. Empty while it applies.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public turnedOffAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this compliance setting.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this compliance setting.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this compliance setting.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this compliance setting.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
