import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import VideoCallProvider from "../../Types/VideoCall/VideoCallProvider";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Connecting a provider means holding a credential that creates meetings in
 * someone's Zoom, Google Workspace or Microsoft 365 account, so it stays
 * with the people who administer the project's settings.
 */
const adminPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SettingsAdmin,
];

/*
 * Who may see that a connection exists, by name and provider: everyone who
 * can start a call for an incident or an alert picks one from a list, and
 * everyone who reads a call sees which connection started it.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.AlertAdmin,
  Permission.AlertMember,
  Permission.AlertViewer,
  Permission.ReadVideoCallConnection,
];

/*
 * Who may read how a connection is set up - the account, app and user ids,
 * a standing bridge's link - and why its last call failed: the people who
 * look after the project's settings.
 */
const settingsReadPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadVideoCallConnection,
];

/*
 * One provider a project starts incident and alert video calls with: a Zoom
 * Server-to-Server OAuth app, a Google service account, a Microsoft Entra
 * app registration, or a standing meeting link. The provider decides which
 * keys `config` and `secrets` carry - see VideoCallProviderCatalog - and
 * which meeting client creates the calls.
 *
 * Slack huddles need no connection: the huddle of an incident's Slack
 * channel starts when someone opens its link.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/video-call-connection"))
@Entity({
  name: "VideoCallConnection",
})
@TableMetadata({
  tableName: "VideoCallConnection",
  singularName: "Video Call Connection",
  pluralName: "Video Call Connections",
  icon: IconProp.VideoCamera,
  tableDescription:
    "Zoom, Google Meet, Microsoft Teams or a standing meeting link, used to start a dedicated video call for incidents and alerts.",
})
@TableAccessControl({
  create: [...adminPermissions, Permission.CreateVideoCallConnection],
  read: readPermissions,
  delete: [...adminPermissions, Permission.DeleteVideoCallConnection],
  update: [...adminPermissions, Permission.EditVideoCallConnection],
})
export default class VideoCallConnection extends BaseModel {
  @ColumnAccessControl({
    create: [...adminPermissions, Permission.CreateVideoCallConnection],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this connection belongs to.",
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
    create: [...adminPermissions, Permission.CreateVideoCallConnection],
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this connection belongs to.",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [...adminPermissions, Permission.CreateVideoCallConnection],
    read: readPermissions,
    update: [...adminPermissions, Permission.EditVideoCallConnection],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Friendly name for this connection, shown wherever a call is started, e.g. 'Incident Zoom'.",
    example: "Incident Zoom",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [...adminPermissions, Permission.CreateVideoCallConnection],
    read: readPermissions,
    update: [...adminPermissions, Permission.EditVideoCallConnection],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "What this connection is for.",
    example: "Zoom meetings for Sev1 and Sev2 incidents.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [...adminPermissions, Permission.CreateVideoCallConnection],
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Provider",
    description:
      "Which provider this connection starts calls with: Zoom, GoogleMeet, MicrosoftTeams or CustomLink. Fixed once created.",
    example: "Zoom",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: VideoCallProvider = undefined;

  @ColumnAccessControl({
    create: [...adminPermissions, Permission.CreateVideoCallConnection],
    read: settingsReadPermissions,
    update: [...adminPermissions, Permission.EditVideoCallConnection],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Configuration",
    description:
      "Provider-specific, non-secret settings such as the Zoom account and meeting host, the Google Workspace user or the Microsoft Entra tenant and organizer. Keys are defined by the provider catalog.",
    example: {
      accountId: "aBcDeFgHiJkLmNoPqRsTuV",
      clientId: "aBcDeFgHiJkLmNoPqRsTuV",
      hostEmail: "incidents@example.com",
    },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public config?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [...adminPermissions, Permission.CreateVideoCallConnection],
    read: [],
    update: [...adminPermissions, Permission.EditVideoCallConnection],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credentials",
    description:
      "Provider-specific secrets (a client secret or a service account key) as a JSON object. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public secrets?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Call Started At",
    required: false,
    type: TableColumnType.Date,
    description: "When this connection last started a call.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastCallStartedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: settingsReadPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Error",
    required: false,
    type: TableColumnType.VeryLongText,
    description:
      "Why the most recent call could not be started, with credentials redacted. Cleared when a call starts.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public lastError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: settingsReadPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Error At",
    required: false,
    type: TableColumnType.Date,
    description: "When the most recent call could not be started.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastErrorAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this connection.",
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
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this connection.",
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
