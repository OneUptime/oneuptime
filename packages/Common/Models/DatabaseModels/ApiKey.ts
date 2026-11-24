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
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import HashedString from "../../Types/HashedString";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
  /*
   * Kept after a downgrade, but stops authenticating until the project is
   * back on the plan (Types/Billing/PlanCutoffCredentials): readable on
   * every plan, to see what stopped and delete it.
   */
  readableBelowPlan: true,
})
@EnableDocumentation()
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/api-key"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "ApiKey",
})
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateProjectApiKey,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadProjectApiKey,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteProjectApiKey,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditProjectApiKeyPermissions,
    Permission.EditProjectApiKey,
  ],
})
/*
 * The key is kept as its hash, which nobody reads, and the audit log (read
 * by other roles too, and exported) records only that it changed - a reset.
 */
@EnableAuditLog({ redactColumns: ["apiKey"] })
@TableMetadata({
  tableName: "ApiKey",
  singularName: "API Key",
  pluralName: "API Keys",
  icon: IconProp.Code,
  tableDescription: "Manage API Keys for your project",
})
export default class ApiKey extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectApiKey,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
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
      Permission.CreateProjectApiKey,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
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
      Permission.CreateProjectApiKey,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKey,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "Any friendly name of this object",
    canReadOnRelationQuery: true,
    example: "Production API Key",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectApiKey,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKey,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example:
      "API key used for production environment monitoring and alerting integrations",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectApiKey,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
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
      Permission.CreateProjectApiKey,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectApiKey,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKey,
    ],
  })
  @TableColumn({
    title: "Expires At",
    type: TableColumnType.Date,
    required: true,
    description: "Date and Time when this API Key expires.",
    example: "2025-12-31T23:59:59Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public expiresAt?: Date = undefined;

  /*
   * The key, hashed (#8902): the SHA-256 of the key with the server's
   * ENCRYPTION_SECRET (Common/Server/Utils/APIKey/HashedApiKey), as the
   * server's master API key and its other minted tokens are kept. A request
   * names its key, so a key is looked up by its hash
   * (ApiKeyService.findApiKey) - which no ciphertext could be.
   *
   * So the key itself is shown once (shownOnce): in the answer to the
   * create that makes it, and to a reset of it (POST /api-key/:id/reset-key,
   * ApiKeyService.resetApiKey), and never again. Nobody reads it, or its
   * hash, through the API: the generic API drops it from what a caller
   * selects (ApiKeyService.onBeforeFind) and refuses a filter on it, and
   * refuses any write of it but OneUptime's own
   * (ApiKeyService.assertKeyWrittenByOneUptime). Its update access is the
   * one a reset asks of the person who resets it.
   *
   * A key stored before it was hashed is a uuid, until the
   * HashProjectApiKeys data migration hashes it; the lookup takes that too.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKey,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.HashedString,
    shownOnce: true,
    isDefaultValueColumn: false,
    title: "API Key",
    computed: true,
    description:
      "The secret key, sent in the ApiKey header of each request. Shown once: in the answer to the create that makes it, or to a reset of it. OneUptime keeps only its hash.",
    example: "c3d4e5f6-a7b8-4012-8def-123456789012",
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    nullable: false,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public apiKey?: HashedString = undefined;

  /*
   * The key's last four characters (#8903), written with its hash when the
   * key is made or reset, and by HashProjectApiKeys for a key made before:
   * the key's pages show "ends in 2b34" in place of the key, so a person can
   * tell it from the project's other keys, and match it against the key they
   * hold. Never enough to use the key.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKey,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "API Key Hint",
    description:
      "The key's last four characters, to tell it from the project's other keys. Never enough to use the key.",
    example: "2b34",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public apiKeyHint?: string = undefined;
}
