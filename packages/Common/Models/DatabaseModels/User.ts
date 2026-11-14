import File from "./File";
import Project from "./Project";
import UserModel from "../../Models/DatabaseModels/DatabaseBaseModel/UserModel";
import Route from "../../Types/API/Route";
import CompanySize from "../../Types/Company/CompanySize";
import JobRole from "../../Types/Company/JobRole";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AllowUserQueryWithoutTenant from "../../Types/Database/AllowUserQueryWithoutTenant";
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
import { JSONObject } from "../../Types/JSON";
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
@AllowUserQueryWithoutTenant(true)
@CurrentUserCanAccessRecordBy("_id")
class User extends UserModel {
  @ColumnAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    example: "John Smith",
  })
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
    example: "john.smith@company.com",
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
    example: "john-smith",
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
    hashSaltColumn: "passwordSalt",
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

  /*
   * Per-user salt mixed into `password`'s hash. Written by the database
   * write path on every password write — never by an API caller, hence the
   * empty access control and `computed: true`.
   *
   * Nullable on purpose: rows that predate per-user salts have none, and are
   * verified against the legacy unsalted scheme until the next successful
   * login re-hashes them with a fresh salt.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "Password Salt",
    description: "Per-user random salt mixed into this user's password hash.",
    computed: true,
    type: TableColumnType.ShortText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: true,
  })
  public passwordSalt?: string = undefined;

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
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(JobRole),
  })
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
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CompanySize),
  })
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
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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

  /*
   * The latest password reset link emailed to this account: the hash of its
   * token, never the token, which is only ever mailed. Cleared by the reset
   * that uses it, by any other new password and by a new email address, and
   * replaced by the next link asked for.
   */
  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({
    secret: true,
    type: TableColumnType.ShortText,
  })
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

  /*
   * The latest sign-in link emailed to this account (Types/Accounts/
   * MagicLink): the hash of its token, never the token, which is only ever
   * mailed - like resetPasswordToken. Cleared by the sign-in that uses it,
   * by a new password and by a new email address, and replaced by the next
   * link asked for.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    secret: true,
    type: TableColumnType.ShortText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public magicLinkToken?: string = undefined;

  // When the sign-in link in magicLinkToken stops working.
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Date, hideColumnInDocumentation: true })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public magicLinkExpires?: Date = undefined;

  /*
   * TWO challenge slots, not one, and the split is the whole point.
   *
   * A WebAuthn challenge is a one-shot value: the server issues it, the
   * authenticator signs it, and the server compares what came back against
   * what it stored. Registration and signing in are separate flows that each
   * need one, and they used to share a single `webauthnChallenge` column --
   * so whichever flow wrote last silently destroyed the other's.
   *
   * That is not a theoretical race. Registration is keyed by the session's
   * user and signing in is keyed by an email address, so both land on the
   * SAME row: a user adding a second key in one tab while a stale sign-in page
   * in another asks for a fresh challenge loses the registration they were
   * halfway through, and gets "No pending WebAuthn challenge found" for a key
   * they are holding and touching. The anonymous
   * /generate-authentication-options route made it reachable by strangers as
   * well as by the user's own second tab.
   *
   * Named for their purposes rather than one being left as the bare
   * `webauthnChallenge`, because a slot whose name does not say which flow
   * owns it is exactly how the two came to share one.
   */
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
  public webauthnRegistrationChallenge?: string = undefined;

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
  public webauthnRegistrationChallengeExpiresAt?: Date = undefined;

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
  public webauthnAuthenticationChallenge?: string = undefined;

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
  public webauthnAuthenticationChallengeExpiresAt?: Date = undefined;

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

  /*
   * The language OneUptime writes to this person in, and the Dashboard
   * starts in on every browser they sign in on (Types/UserLanguage): one
   * of the codes OneUptime writes in ("de", "zh-TW"), or empty for none -
   * English, and the browser's language on the Dashboard, as before.
   * Their own to set: User Profile's Language, or the Dashboard's
   * language menu while they are signed in.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Language",
    description:
      "The language OneUptime writes this person's on-call pages in, and the Dashboard starts in. Empty means English.",
    example: "de",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public language?: string = undefined;

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
  public utmId?: string = undefined;

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
  public utmSourcePlatform?: string = undefined;

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
  public utmCreativeFormat?: string = undefined;

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
  public utmMarketingTactic?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
    title: "Google Ads Source",
    description:
      "gad_source from the landing URL of the visit that led to signup: which of Google's surfaces showed the ad, as Google Ads adds it to its ad clicks.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public gadSource?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
    title: "Google Ads Campaign ID",
    description:
      "gad_campaignid from the landing URL of the visit that led to signup: the Google Ads campaign of the ad, which Google Ads adds to its ad clicks whether or not the ad carries UTM parameters.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public gadCampaignId?: string = undefined;

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
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    hideColumnInDocumentation: true,
    title: "Ad Click IDs",
    description:
      "Ad platform click identifiers (gclid, fbclid, msclkid, etc.) captured on the visit that led to signup. Used for offline conversion uploads to ad platforms.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public clickIds?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [Permission.Public],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    hideColumnInDocumentation: true,
    title: "First Touch Attribution",
    description:
      "UTM parameters, click IDs, landing URL and referrer from the visitor's first attributed visit. The utm* columns hold last-touch values.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public firstTouchAttribution?: JSONObject = undefined;

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
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    title: "Created by User",
    modelType: User,
    description:
      "Relation to the User who created (invited) this user, if this user was invited to OneUptime by another user.",
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
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created (invited) this user, if this user was invited to OneUptime by another user.",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
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
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
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

  /*
   * "Ask me how things went" (issue #6832), on while this is false: the
   * question at the end of a guided setup, Was this clear? and the
   * first-week check-in. Their own to switch off, on User Profile or with
   * "Don't ask me again" on a question. Give feedback in Help stays: the
   * person opens it.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    title: "Disable Feedback Questions",
    description:
      "When true, OneUptime never asks this person how things went: no question at the end of a guided setup, no Was this clear?, no first-week check-in.",
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public disableFeedbackQuestions?: boolean = undefined;

  /*
   * "Record how I use the setup pages" (issue #6834), on while this is
   * false: on OneUptime Cloud, and only once the person pressed "Accept
   * all", OneUptime may record their use of the Dashboard's first-run
   * pages, with everything typed or stored masked. Their own to switch off,
   * on User Profile beside the feedback questions. A self-hosted server
   * never records anybody, whatever this says.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    title: "Disable Dashboard Recording",
    description:
      "When true, OneUptime never records how this person uses the dashboard. Recording happens only on OneUptime Cloud, only for people who accepted analytics, and only on the setup pages, with what they type or store masked.",
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public disableDashboardRecording?: boolean = undefined;

  /*
   * The questions OneUptime asked this person, and when: question key
   * (`setup_flow:website_down`, `check_in:<project id>`) to an ISO date
   * (Types/ProductFeedback/ProductFeedback, readAskedQuestions). Each is
   * asked once, and at most one a week. Written by OneUptime only
   * (ProductFeedbackService, as root), when it asks.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "Feedback Questions Asked",
    description:
      "The questions OneUptime asked this person about how things went, and when, so none is asked twice and at most one a week.",
    type: TableColumnType.JSON,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public feedbackQuestionsAsked?: JSONObject = undefined;

  /*
   * The sample project this person was made up for (issue #6808): one of
   * the "sample people" who staff its on-call policy and own its
   * incidents. Not a real person, and never one:
   *
   *   - they can never sign in: blocked, with no password and an address
   *     on the reserved .invalid domain (SamplePeople), which every
   *     sign-in path and MailService refuse;
   *   - they are members of their sample project only, written without
   *     hooks, so no invitation, notification method or rule is made for
   *     them, and TeamMemberService refuses them in any other project;
   *   - they are left out of every count of people on the server: the
   *     license's seats, its user-count report and the self-hosted
   *     marketplace's user-hours;
   *   - the database deletes them with the project (ON DELETE CASCADE),
   *     whatever deletes it.
   *
   * Null for everyone real. Written by OneUptime only, as root, when the
   * sample is made (SampleProjectService), and never read through the API.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "sampleProjectId",
    type: TableColumnType.Entity,
    // Lazy: Project imports User back (see modelTypeThunk).
    modelTypeThunk: () => {
      return Project;
    },
    title: "Sample Project",
    description:
      "The sample project this made-up person belongs to. Set only for the sample people of a sample project.",
    hideColumnInDocumentation: true,
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "sampleProjectId" })
  public sampleProject?: Project = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Sample Project ID",
    description:
      "ID of the sample project this made-up person belongs to. Set only for the sample people of a sample project.",
    hideColumnInDocumentation: true,
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public sampleProjectId?: ObjectID = undefined;
}

export default User;
