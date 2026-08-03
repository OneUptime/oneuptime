import RunbookAgent from "./RunbookAgent";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
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
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
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
 * How a runbook reaches infrastructure that is not the Runner's own host.
 *
 * A Bash step can only act where the Runner already has ambient credentials,
 * which is why "restart the pod" used to mean provisioning a kubeconfig onto
 * the Runner host by hand. A credential is that access made into a managed
 * object: encrypted at rest, write-only over the API, assigned to specific
 * Runners, and referenced by id from an SSH or Kubernetes step.
 *
 * The secret fields carry `read: []` — the same write-only contract as
 * RunbookSecret. They are decrypted in exactly one place, the claim path,
 * where they are handed to the one Runner the step targets. A non-empty read
 * ACL on an encrypted column serves decrypted plaintext over the CRUD API,
 * which is precisely what this must never do.
 *
 * Workflows are deliberately NOT enabled: a workflow that could read a
 * credential would be a way around the write-only contract.
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateRunbookCredential,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadRunbookCredential,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteRunbookCredential,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditRunbookCredential,
  ],
})
@CrudApiEndpoint(new Route("/runbook-credential"))
@TableMetadata({
  tableName: "RunbookCredential",
  singularName: "Runbook Credential",
  pluralName: "Runbook Credentials",
  icon: IconProp.Key,
  tableDescription:
    "Access to a system a runbook needs to act on — an SSH host, or a Kubernetes cluster. Secret material is encrypted at rest and can never be read back through the API; it is decrypted only when handed to an assigned Runner as it claims a step.",
})
@Entity({
  name: "RunbookCredential",
})
export default class RunbookCredential extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
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
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
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
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Any friendly name of this object",
    example: "prod-cluster",
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
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
  })
  public description?: string = undefined;

  /*
   * Which shape the secret columns below are in. Immutable after creation:
   * changing it would leave a credential holding the previous type's fields.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Credential Type",
    description: "SSH, or Kubernetes.",
    example: "SSH",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
  })
  public credentialType?: RunbookCredentialType = undefined;

  // ---------------------------------------------------------------- SSH

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SSH Hostname",
    description: "Hostname or IP address the Runner connects to.",
    example: "10.0.4.21",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public sshHostname?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "SSH Port",
    description: "Defaults to 22 when unset.",
    example: 22,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public sshPort?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SSH Username",
    description: "The user the Runner authenticates as.",
    example: "deploy",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public sshUsername?: string = undefined;

  /*
   * Write-only, like every secret column here: `read: []` is the whole
   * mechanism that keeps an encrypted value from being served back in
   * plaintext by the CRUD API.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "SSH Private Key",
    description:
      "PEM private key used to authenticate. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public sshPrivateKey?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "SSH Private Key Passphrase",
    description:
      "Passphrase protecting the private key, when it has one. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public sshPassphrase?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "SSH Password",
    description:
      "Password authentication, for hosts without key access. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public sshPassword?: string = undefined;

  // --------------------------------------------------------- Kubernetes

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Kubernetes API Server URL",
    description: "For example https://10.0.0.1:6443",
    example: "https://10.0.0.1:6443",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.LongText,
  })
  public kubernetesApiServerUrl?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Kubernetes Service Account Token",
    description:
      "Bearer token of a service account bound to a role that permits only the actions your runbooks need. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public kubernetesServiceAccountToken?: string = undefined;

  /*
   * Not secret, but stored alongside the token because it is useless without
   * it: the cluster's CA, so the Runner can verify the API server instead of
   * trusting it blindly.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Kubernetes CA Certificate",
    description:
      "PEM certificate authority for the API server. Leave empty only if the API server presents a certificate your Runner already trusts.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public kubernetesCaCertificate?: string = undefined;

  // -------------------------------------------------------------- Shared

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookCredential,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: RunbookAgent,
    title: "Runners",
    description:
      "The Runners allowed to use this credential. A step referencing it must target one of them.",
  })
  @ManyToMany(
    () => {
      return RunbookAgent;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookCredentialRunbookAgent",
    inverseJoinColumn: {
      name: "runbookAgentId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookCredentialId",
      referencedColumnName: "_id",
    },
  })
  public runbookAgents?: Array<RunbookAgent> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookCredential,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookCredential,
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
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
    modelType: User,
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
