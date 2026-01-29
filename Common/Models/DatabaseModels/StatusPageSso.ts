import Project from "./Project";
import StatusPage from "./StatusPage";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
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
import DigestMethod from "../../Types/SSO/DigestMethod";
import SignatureMethod from "../../Types/SSO/SignatureMethod";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Scale,
  read: PlanType.Scale,
  update: PlanType.Scale,
  delete: PlanType.Scale,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateStatusPageSSO,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectUser,
    Permission.Public,
    Permission.ProjectAdmin,
    Permission.ReadStatusPageSSO,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteStatusPageSSO,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditStatusPageSSO,
  ],
})
@CrudApiEndpoint(new Route("/status-page-sso"))
@TableMetadata({
  tableName: "StatusPageSSO",
  singularName: "Status Page SSO",
  pluralName: "Status Page SSO",
  icon: IconProp.Lock,
  tableDescription: "Configure Status Page SSO",
})
@Entity({
  name: "StatusPageSSO",
})
export default class StatusPageSSO extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectUser,
      Permission.Public,
      Permission.ReadStatusPageSSO,
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
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectUser,
      Permission.Public,
      Permission.ReadStatusPageSSO,
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
      Permission.ProjectMember,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPageId",
    type: TableColumnType.Entity,
    modelType: StatusPage,
    title: "Status Page",
    description:
      "Relation to Status Page Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return StatusPage;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "statusPageId" })
  public statusPage?: StatusPage = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Status Page ID",
    description: "ID of your Status Page resource where this object belongs",
    example: "a1b2c3d4-e5f6-7890-a1b2-c3d4e5f67890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public statusPageId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectUser,
      Permission.Public,
      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditStatusPageSSO,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Any friendly name of this object",
    example: "Corporate SSO",
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
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectUser,
      Permission.Public,
      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditStatusPageSSO,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    example: "SSO configuration for status page authentication using SAML 2.0",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,

      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditStatusPageSSO,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    example: "RSA-SHA256",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public signatureMethod?: SignatureMethod = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,

      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditStatusPageSSO,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    example: "SHA256",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public digestMethod?: DigestMethod = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadStatusPageSSO,
      Permission.ProjectUser,
      Permission.Public,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditStatusPageSSO,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongURL,
    canReadOnRelationQuery: true,
    example: "https://idp.example.com/saml/sso",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongURL,
    transformer: URL.getDatabaseTransformer(),
  })
  @UniqueColumnBy("projectId")
  public signOnURL?: URL = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,

      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditStatusPageSSO,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongURL,
    canReadOnRelationQuery: true,
    example: "https://idp.example.com/saml/metadata",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public issuerURL?: URL = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,

      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditStatusPageSSO,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: true,
    example:
      "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKL0UG+mRKU...\n-----END CERTIFICATE-----",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public publicCertificate?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,

      Permission.ReadStatusPageSSO,
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
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,

      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "b2c3d4e5-f6a7-8901-b2c3-d4e5f6a78901",
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

      Permission.ReadStatusPageSSO,
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

      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "c3d4e5f6-a7b8-9012-c3d4-e5f6a7b89012",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectUser,
      Permission.Public,
      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditStatusPageSSO,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isEnabled?: boolean = undefined;

  // Is this integration tested?
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateStatusPageSSO,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,

      Permission.ReadStatusPageSSO,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isTested?: boolean = undefined;
}
