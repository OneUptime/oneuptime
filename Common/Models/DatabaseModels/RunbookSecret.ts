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
    Permission.ReadAllProjectResources,
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
@CrudApiEndpoint(new Route("/runbook-secret"))
@TableMetadata({
  tableName: "RunbookSecret",
  singularName: "Runbook Secret",
  pluralName: "Runbook Secrets",
  icon: IconProp.Lock,
  tableDescription:
    "Runbook Secret is a secret variable that can be used by runbook agents. For example you can store auth tokens, passwords, etc. in Runbook Secret and use them in your runbook steps. Runbook Secret is encrypted and only accessible by the assigned agent.",
})
@Entity({
  name: "RunbookSecret",
})
export default class RunbookSecret extends BaseModel {
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
      Permission.ReadAllProjectResources,
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
      Permission.ReadAllProjectResources,
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
      Permission.ReadAllProjectResources,
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
    description: "Any friendly name of this object",
    example: "API_AUTH_TOKEN",
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

      Permission.CreateRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,

      Permission.ReadRunbookSecret,
      Permission.ReadAllProjectResources,
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
    example: "API authentication token for third-party service integration",
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
      "Secret value that you want to store in this object. This value will be encrypted and only accessible by the assigned runbook agent.",
    example: "sk_test_1234567890abcdefghijklmnop",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public secretValue?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.ReadAllProjectResources,
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
    modelType: RunbookAgent,
    title: "Runbook Agents",
    description: "List of runbook agents that can access this secret",
    example: '["5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e"]',
  })
  @ManyToMany(
    () => {
      return RunbookAgent;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookSecretRunbookAgent",
    inverseJoinColumn: {
      name: "runbookAgentId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookSecretId",
      referencedColumnName: "_id",
    },
  })
  public runbookAgents?: Array<RunbookAgent> = undefined;

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
      Permission.ReadAllProjectResources,
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
      Permission.ReadAllProjectResources,
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
      Permission.ReadAllProjectResources,
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
      Permission.ReadAllProjectResources,
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
