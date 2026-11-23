import Dashboard from "./Dashboard";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import Email from "../../Types/Email";
import HashedString from "../../Types/HashedString";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A dashboard's private user (#10250): somebody who may open the public
 * link of a dashboard that asks its visitors to sign in
 * (Dashboard.requireSignIn, Types/Dashboard/DashboardAccess) - on
 * OneUptime's own address and on every custom domain of the dashboard -
 * with no OneUptime account. The dashboard's team adds them, and each is
 * emailed an invitation whose link sets their first password
 * (DashboardPrivateUserService). Its single sign-on (DashboardSso,
 * DashboardOidc) adds the people it lets in as private users too, marked
 * isSsoUser.
 *
 * A private user is a dashboard's, never a project's or another
 * dashboard's: the same address invited to two dashboards is two private
 * users, each with a password and sessions of its own
 * (DashboardPrivateUserSession), and signing in to one opens nothing else.
 *
 * As a status page's private users are (StatusPagePrivateUser), with the
 * dashboard's own permissions: only who may change who views a dashboard -
 * its project's owners and admins, or the Dashboard Private User
 * permissions given on purpose - may invite or remove one.
 */

const CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateDashboardPrivateUser,
];

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ReadDashboardPrivateUser,
];

const DELETE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeleteDashboardPrivateUser,
];

const UPDATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditDashboardPrivateUser,
];

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@CanAccessIfCanReadOn("dashboard")
@TenantColumn("projectId")
@TableAccessControl({
  create: [...CREATE_PERMISSIONS],
  read: [...READ_PERMISSIONS],
  delete: [...DELETE_PERMISSIONS],
  update: [...UPDATE_PERMISSIONS],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/dashboard-private-user"))
@TableMetadata({
  tableName: "DashboardPrivateUser",
  singularName: "Dashboard Private User",
  pluralName: "Dashboard Private Users",
  icon: IconProp.User,
  tableDescription:
    "People who can sign in to open a dashboard's public link when it asks its visitors to sign in.",
})
@OwnedThrough("dashboardId", Dashboard)
@Entity({
  name: "DashboardPrivateUser",
})
export default class DashboardPrivateUser extends BaseModel {
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
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
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
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
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "dashboardId",
    type: TableColumnType.Entity,
    modelType: Dashboard,
    title: "Dashboard",
    description: "The dashboard this private user may sign in to.",
  })
  @ManyToOne(
    () => {
      return Dashboard;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dashboardId" })
  public dashboard?: Dashboard = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Dashboard ID",
    description: "ID of the dashboard this private user may sign in to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dashboardId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Email,
    title: "Email",
    description: "The address this private user signs in with.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    transformer: Email.getDatabaseTransformer(),
  })
  public email?: Email = undefined;

  /*
   * Set by the private user, from the link their invitation or a password
   * reset emailed them - never shown, and never readable through the API.
   * A teammate may write a new one (it ends every session of the user,
   * DashboardPrivateUserService), never read one.
   */
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    title: "Password",
    hashed: true,
    hashSaltColumn: "passwordSalt",
    type: TableColumnType.HashedString,
    description:
      "The private user's password, stored as a salted hash and never shown.",
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
   * write path on every password write - never by an API caller, hence the
   * empty access control and `computed: true`.
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

  /*
   * Whether this private user has a password: set by the write path
   * whenever `password` is written (DashboardPrivateUserService), so the
   * Private Users list can tell somebody who accepted their invitation from
   * somebody who has only been sent it - without reading the password.
   */
  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    computed: true,
    type: TableColumnType.Boolean,
    title: "Has Password",
    description: "Whether this private user has set a password.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public hasPassword?: boolean = undefined;

  /*
   * The latest password reset link emailed to this user - the invitation's
   * too: the hash of its token, never the token, which is only ever mailed.
   * Cleared by the reset that uses it, by any other new password and by a
   * new email address, and replaced by the next link asked for.
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
  public resetPasswordToken?: string = undefined;

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
  public resetPasswordExpires?: Date = undefined;

  /*
   * When this user last signed in - with a password or single sign-on
   * (DashboardPrivateUserSessionService). Readable by whoever can read the
   * user, so the Private Users list can tell somebody who signs in with
   * single sign-on from somebody who never accepted their invitation; only
   * sign-in writes it.
   */
  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Last Signed In",
    description: "When this private user last signed in to the dashboard.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public lastActive?: Date = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
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
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
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

  /*
   * Added by the dashboard's single sign-on the first time it let them in,
   * rather than invited: such a user is sent no invitation and signs in
   * only through single sign-on.
   */
  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "SSO User",
    description: "Whether the dashboard's single sign-on added this user.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isSsoUser?: boolean = undefined;
}
