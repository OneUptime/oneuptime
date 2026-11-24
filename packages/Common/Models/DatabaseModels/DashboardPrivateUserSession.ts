import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Project from "./Project";
import Dashboard from "./Dashboard";
import DashboardPrivateUser from "./DashboardPrivateUser";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import HashedString from "../../Types/HashedString";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@AllowAccessIfSubscriptionIsUnpaid()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@CanAccessIfCanReadOn("dashboard")
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/dashboard-private-user-session"))
@OwnedThrough("dashboardId", Dashboard)
@Entity({
  name: "DashboardPrivateUserSession",
})
@TableMetadata({
  tableName: "DashboardPrivateUserSession",
  singularName: "Dashboard Private User Session",
  pluralName: "Dashboard Private User Sessions",
  icon: IconProp.Lock,
  tableDescription:
    "Stores dashboard private user sessions, refresh tokens, and device metadata for secure access control.",
})
export default class DashboardPrivateUserSession extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Project that owns this dashboard private user session.",
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
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "Project identifier for this session.",
    required: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "dashboardId",
    type: TableColumnType.Entity,
    modelType: Dashboard,
    title: "Dashboard",
    description: "Dashboard associated with this session.",
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
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Dashboard ID",
    description: "Identifier for the dashboard.",
    required: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dashboardId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "dashboardPrivateUserId",
    type: TableColumnType.Entity,
    modelType: DashboardPrivateUser,
    title: "Dashboard Private User",
    description: "Dashboard private user record associated with this session.",
  })
  @ManyToOne(
    () => {
      return DashboardPrivateUser;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "dashboardPrivateUserId" })
  public dashboardPrivateUser?: DashboardPrivateUser = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Dashboard Private User ID",
    description: "Identifier for the dashboard private user.",
    required: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dashboardPrivateUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index({ unique: true })
  @TableColumn({
    type: TableColumnType.HashedString,
    title: "Refresh Token",
    description: "Hashed refresh token for the private user session.",
    required: true,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    nullable: false,
    unique: true,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public refreshToken?: HashedString = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Refresh Token Expires At",
    description: "Expiration timestamp for the refresh token.",
    required: true,
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public refreshTokenExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Last Active At",
    description: "Last time this session was active.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastActiveAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device Name",
    description: "Friendly name for the device used to open the dashboard.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device Type",
    description: "Type of device (desktop, mobile, etc).",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device OS",
    description: "Operating system reported for this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceOS?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Browser",
    description: "Browser or client application used for the session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceBrowser?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "IP Address",
    description: "IP address recorded for this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public ipAddress?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "User Agent",
    description: "User agent string supplied by the client.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public userAgent?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Is Revoked",
    description: "Indicates if the session has been revoked.",
    isDefaultValueColumn: true,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isRevoked?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Revoked At",
    description: "Timestamp when the session was revoked, if applicable.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public revokedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Revoked Reason",
    description: "Reason provided for revoking this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public revokedReason?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Additional Info",
    description: "Flexible JSON payload for storing structured metadata.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public additionalInfo?: JSONObject = undefined;

  /*
   * The dashboard SAML provider that signed this session in, when one did
   * (the SSO sign-in's callback writes it). The session counts only while
   * that provider vouches for it: it is still the dashboard's, it is on,
   * and it was not turned off after the session began
   * (DashboardPrivateUserSessionService.addSignInRule). Not a foreign key:
   * a provider deleted leaves the id behind, and the session stops counting.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Dashboard SSO ID",
    description:
      "Internal: the dashboard SAML provider that signed this session in, if one did.",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dashboardSsoId?: ObjectID = undefined;

  /*
   * The dashboard OIDC provider that signed this session in, when one did.
   * Read the same way as dashboardSsoId.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Dashboard OIDC ID",
    description:
      "Internal: the dashboard OIDC provider that signed this session in, if one did.",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dashboardOidcId?: ObjectID = undefined;
}
