import File from "./File";
import UserModel from "../../Models/DatabaseModels/DatabaseBaseModel/UserModel";
import Route from "../../Types/API/Route";
import CompanySize from "../../Types/Company/CompanySize";
import JobRole from "../../Types/Company/JobRole";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import Email from "../../Types/Email";
import HashedString from "../../Types/HashedString";
import IconProp from "../../Types/Icon/IconProp";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Phone from "../../Types/Phone";
import Timezone from "../../Types/Timezone";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation({
  isMasterAdminApiDocs: true,
})
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "User",
})
@TableMetadata({
  tableName: "User",
  singularName: "User",
  pluralName: "Users",
  icon: IconProp.User,
  tableDescription: "A signed up or invited OneUptime user.",
})
@CurrentUserCanAccessRecordBy("_id")
class User extends UserModel {
  @ColumnAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({ type: TableColumnType.Name, canReadOnRelationQuery: true })
  @Column({
    type: ColumnType.Name,
    length: ColumnLength.Name,
    nullable: true,
    unique: false,
    transformer: Name.getDatabaseTransformer(),
  })
  public name?: Name = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({
    title: "Email",
    required: true,
    unique: true,
    type: TableColumnType.Email,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    unique: true,
    nullable: false,
    transformer: Email.getDatabaseTransformer(),
  })
  public email?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({ type: TableColumnType.Email })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    unique: false,
    nullable: true,
    transformer: Email.getDatabaseTransformer(),
  })
  public newUnverifiedTemporaryEmail?: string = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [],
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
    unique: true,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({
    title: "Password",
    hashed: true,
    type: TableColumnType.HashedString,
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    unique: false,
    nullable: true,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public password?: HashedString = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],

    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isEmailVerified?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public companyName?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public jobRole?: JobRole = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public companySize?: CompanySize = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public referral?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({ type: TableColumnType.Phone })
  @Column({
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    nullable: true,
    unique: false,
    transformer: Phone.getDatabaseTransformer(),
  })
  public companyPhoneNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({
    manyToOneRelationColumn: "profilePictureId",
    type: TableColumnType.Entity,
    modelType: File,
  })
  @ManyToOne(
    () => {
      return File;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "profilePictureId" })
  public profilePictureFile?: File = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public profilePictureId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
    nullable: false,
    unique: false,
  })
  public twoFactorAuthEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public paymentProviderCustomerId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public resetPasswordToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public resetPasswordExpires?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public timezone?: Timezone = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public lastActive?: Date = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],

    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public promotionName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CustomerSupport],

    update: [Permission.CustomerSupport],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isDisabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public paymentFailedDate?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isMasterAdmin?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CustomerSupport],

    update: [Permission.CustomerSupport],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isBlocked?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],

    update: [Permission.CurrentUser],
  })
  @TableColumn({ type: TableColumnType.Phone })
  @Column({
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    nullable: true,
    unique: false,
  })
  public alertPhoneNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({
    type: TableColumnType.OTP,
    computed: true,
  })
  @Column({
    type: ColumnType.OTP,
    length: ColumnLength.OTP,
    nullable: true,
    unique: false,
  })
  public alertPhoneVerificationCode?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmSource?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmMedium?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmCampaign?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmTerm?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmContent?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmUrl?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public alertPhoneVerificationCodeRequestTime?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({ type: TableColumnType.Phone })
  @Column({
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    nullable: true,
    unique: false,
  })
  public tempAlertPhoneNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
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

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    title: "Two Factor Auth Enabled",
    description: "Is two factor authentication enabled?",
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public enableTwoFactorAuth?: boolean = undefined;
}

export default User;
