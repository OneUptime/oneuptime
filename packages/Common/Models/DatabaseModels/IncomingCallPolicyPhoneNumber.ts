import IncomingCallPolicy from "./IncomingCallPolicy";
import Project from "./Project";
import ProjectCallSMSConfig from "./ProjectCallSMSConfig";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
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
import Phone from "../../Types/Phone";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadProjectIncomingCallPolicy,
];

@EnableDocumentation()
@CanAccessIfCanReadOn("incomingCallPolicy")
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/incoming-call-policy-phone-number"))
@TableMetadata({
  tableName: "IncomingCallPolicyPhoneNumber",
  singularName: "Incoming Call Policy Phone Number",
  pluralName: "Incoming Call Policy Phone Numbers",
  icon: IconProp.Call,
  tableDescription:
    "Phone numbers that route incoming calls to an incoming call policy.",
})
@Entity({
  name: "IncomingCallPolicyPhoneNumber",
})
@Index("IDX_INCOMING_CALL_POLICY_PHONE_NUMBER_UNIQUE", ["phoneNumber"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index(
  "IDX_INCOMING_CALL_POLICY_PROVIDER_PHONE_NUMBER_UNIQUE",
  ["projectCallSMSConfigId", "callProviderPhoneNumberId"],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
@Index(["incomingCallPolicyId", "projectId"])
export default class IncomingCallPolicyPhoneNumber extends BaseModel {
  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Project that owns this incoming call phone number.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project that owns this phone number.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "incomingCallPolicyId",
    type: TableColumnType.Entity,
    modelType: IncomingCallPolicy,
    title: "Incoming Call Policy",
    description: "Incoming call policy that receives calls to this number.",
  })
  @ManyToOne(
    () => {
      return IncomingCallPolicy;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incomingCallPolicyId" })
  public incomingCallPolicy?: IncomingCallPolicy = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Incoming Call Policy ID",
    description: "ID of the policy that receives calls to this number.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incomingCallPolicyId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectCallSMSConfigId",
    type: TableColumnType.Entity,
    modelType: ProjectCallSMSConfig,
    title: "Project Call/SMS Config",
    description: "Call provider configuration that owns this phone number.",
  })
  @ManyToOne(
    () => {
      return ProjectCallSMSConfig;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectCallSMSConfigId" })
  public projectCallSMSConfig?: ProjectCallSMSConfig = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project Call/SMS Config ID",
    description: "ID of the call provider configuration that owns this number.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectCallSMSConfigId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Phone,
    canReadOnRelationQuery: true,
    title: "Phone Number",
    description: "Phone number that routes calls to the policy.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    transformer: Phone.getDatabaseTransformer(),
  })
  public phoneNumber?: Phone = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Call Provider Phone Number ID",
    description: "The call provider identifier for this phone number.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public callProviderPhoneNumberId?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Country Code",
    description: "Country code associated with this phone number.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public countryCode?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Area Code",
    description: "Area code associated with this phone number.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public areaCode?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Purchased At",
    description: "When this phone number was attached to the policy.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public phoneNumberPurchasedAt?: Date = undefined;
}
