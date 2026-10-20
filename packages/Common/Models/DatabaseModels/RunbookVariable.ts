import Runbook from "./Runbook";
import Runner from "./Runner";
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
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
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
 * A RUNBOOK VARIABLE: a value runbooks use, named in their steps.
 *
 * A plain value - a host, a namespace, a URL - or a secret: an SSH key, a
 * password, a kubeconfig, an API token. It belongs to the project (runbookId
 * empty: a global variable, which every runbook in the project may use) or
 * to one runbook (a local variable, which only that runbook may use). A step
 * names one as {{global.variables.NAME}} or {{local.variables.NAME}}
 * (Types/Runbook/RunbookVariableReference), as a workflow names a workflow
 * variable, and the Runner that takes the step gets it filled in.
 *
 * Runbook secrets and runbook credentials were merged into variables: every
 * secret became a global secret variable of the same name, and every
 * credential a runbook step used became the secret variables its key,
 * password or kubeconfig went into (Server/Utils/Runbook/RunbookVariablesMove).
 * Credentials stay for what OneUptime AI's own commands reach through a
 * Runner (RunbookCredential).
 *
 * A SECRET is write-only, as a secret and a credential were:
 *   - its value goes into secretValue, encrypted at rest, with `read: []`,
 *     so no API caller reads it back - not even its owner - and it is
 *     decrypted in exactly one place, when a Runner takes a step that names
 *     it (RunnerIngress, through RunbookVariableResolver);
 *   - it reaches only the Runners it lists (runners) and, when
 *     isAvailableToGlobalRunners is on, the global Runners - for a step of
 *     its own project only;
 *   - it is redacted from what the step prints (Types/Runbook/
 *     SecretOutputRedaction), by the Runner and again by the server.
 * Whether a variable is a secret is fixed when it is made: a secret never
 * becomes readable.
 *
 * A PLAIN value is in `value`, readable by whoever may read the variable,
 * and any of the project's Runners - global Runners included - gets it.
 *
 * The permissions keep the names they had as the runbook secret permissions
 * (CreateRunbookSecret and the rest), so every team that managed secrets
 * manages variables, with nothing to migrate; their titles say variables.
 * Runbook Admins read them too - names, plain values and who may use a
 * secret, never a secret's value - since they write the steps that name
 * them; making and changing them takes Project Admin, as secrets did.
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
    Permission.CreateRunbookSecret,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadRunbookSecret,
    Permission.RunbookAdmin,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteRunbookSecret,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditRunbookSecret,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/runbook-variable"))
@TableMetadata({
  tableName: "RunbookVariable",
  singularName: "Runbook Variable",
  pluralName: "Runbook Variables",
  icon: IconProp.Variable,
  tableDescription:
    "A value runbook steps use: a host, a namespace or a URL, or a secret such as an SSH key, a password, a kubeconfig or an API token. It belongs to the project, which every runbook can use, or to one runbook. A secret value is encrypted and can never be read back through the API; it reaches only the Runners it lets use it, when they take a step that names it.",
})
@Entity({
  name: "RunbookVariable",
})
export default class RunbookVariable extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
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
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  /*
   * The runbook a local variable belongs to; empty for a global variable,
   * which every runbook of the project may use. Fixed when the variable is
   * made: a variable named in one runbook's steps never moves to another.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "runbookId",
    type: TableColumnType.Entity,
    modelType: Runbook,
    title: "Runbook",
    description:
      "The runbook this variable belongs to. Empty for a global variable, which every runbook of the project can use.",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @ManyToOne(
    () => {
      return Runbook;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "runbookId" })
  public runbook?: Runbook = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Runbook ID",
    description:
      "ID of the runbook this variable belongs to. Empty for a global variable, which every runbook of the project can use.",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public runbookId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookSecret,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Letters, numbers, hyphens and underscores. Steps use the variable by this name: {{global.variables.NAME}} for a global variable, {{local.variables.NAME}} for one of the runbook's own.",
    example: "PROD_DB_SSH_KEY",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy(["runbookId", "projectId"])
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookSecret,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example: "Private key of the deploy user on the database hosts",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  /*
   * Whether the value is a secret. Fixed when the variable is made: a plain
   * value is readable, so a variable made plain then marked secret would
   * have been read already, and a secret made plain would be read from then
   * on. To change it, make a new variable under the same name.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Secret",
    description:
      "A secret is encrypted, can never be read back, and is hidden in step output. It cannot be changed later.",
    defaultValue: false,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isSecret?: boolean = undefined;

  // A plain variable's value. Empty for a secret, whose value is secretValue.
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookSecret,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Value",
    description:
      "The value of a variable that is not a secret. A secret's value is Secret Value.",
    example: "10.0.4.21",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public value?: string = undefined;

  /*
   * A secret variable's value. Write-only: `read: []` is the whole mechanism
   * that keeps an encrypted value from being served back in plaintext by
   * the CRUD API.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookSecret,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Secret Value",
    description:
      "The value of a secret variable. Encrypted at rest and never returned by the API.",
    example: "-----BEGIN OPENSSH PRIVATE KEY-----",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public secretValue?: string = undefined;

  /*
   * The project's own Runners a secret reaches, when they take a step that
   * names it. A plain value lists none: any of the project's Runners gets it.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookSecret,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Runner,
    title: "Runners",
    description:
      "The Runners of your own that may use this secret. A step that names it must run on one of them.",
    example: '["5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e"]',
  })
  @ManyToMany(
    () => {
      return Runner;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookVariableRunner",
    inverseJoinColumn: {
      name: "runnerId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookVariableId",
      referencedColumnName: "_id",
    },
  })
  public runners?: Array<Runner> = undefined;

  /*
   * Whether a step of this variable's project that runs on a global Runner -
   * one the OneUptime server runs for every project - gets this secret. Only
   * ever for a step of the variable's own project (and, for a local
   * variable, of its own runbook), and never while the project has turned
   * global Runners off. Off unless someone who may write the variable turns
   * it on. A plain value needs no switch: global Runners get it.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookSecret,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Global Runners Can Use It",
    description:
      "Whether steps of this project that run on a global Runner get this secret. Global Runners are the ones OneUptime runs for every project; a step of another project never gets it.",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isAvailableToGlobalRunners?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
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
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
      Permission.ReadRunbookSecret,
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
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
      Permission.ReadRunbookSecret,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
