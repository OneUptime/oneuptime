import Alert from "./Alert";
import Project from "./Project";
import User from "./User";
import VideoCallConnection from "./VideoCallConnection";
import WorkspaceNotificationRule from "./WorkspaceNotificationRule";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
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
import VideoCallProvider from "../../Types/VideoCall/VideoCallProvider";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.AlertAdmin,
  Permission.AlertMember,
  Permission.CreateAlertVideoCall,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.AlertAdmin,
  Permission.AlertMember,
  Permission.AlertViewer,
  Permission.ReadAlertVideoCall,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.AlertAdmin,
  Permission.AlertMember,
  Permission.DeleteAlertVideoCall,
];

/*
 * A video call held for an alert: a meeting a provider created for it, the
 * huddle of its Slack channel, or a link a responder added. Started by a
 * workspace notification rule when the alert is created, or from the alert
 * page; its join link is posted wherever the alert's updates go.
 *
 * A call is never edited - a different call is a new row - so it can be
 * trusted as the record of what was posted.
 */
@EnableDocumentation()
@CanAccessIfCanReadOn("alert")
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: [],
})
@CrudApiEndpoint(new Route("/alert-video-call"))
@OwnedThrough("alertId", Alert)
@Entity({
  name: "AlertVideoCall",
})
@TableMetadata({
  tableName: "AlertVideoCall",
  singularName: "Alert Video Call",
  pluralName: "Alert Video Calls",
  icon: IconProp.VideoCamera,
  tableDescription:
    "Video calls for an alert: a Zoom, Google Meet or Microsoft Teams meeting, a Slack huddle, or a meeting link.",
})
@Index(["alertId", "createdAt"])
export default class AlertVideoCall extends BaseModel {
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
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
    create: createPermissions,
    read: readPermissions,
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertId",
    type: TableColumnType.Entity,
    modelType: Alert,
    title: "Alert",
    description: "Relation to the alert this call is for.",
  })
  @ManyToOne(
    () => {
      return Alert;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertId" })
  public alert?: Alert = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Alert ID",
    description: "ID of the alert this call is for.",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Provider",
    description:
      "Where the call is held: Zoom, GoogleMeet, MicrosoftTeams, SlackHuddle, or CustomLink for a link a person provided. Taken from the connection when one is given.",
    example: "Zoom",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: VideoCallProvider = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "videoCallConnectionId",
    type: TableColumnType.Entity,
    modelType: VideoCallConnection,
    title: "Video Call Connection",
    description:
      "The connection that started this call, when it was started with one.",
  })
  @ManyToOne(
    () => {
      return VideoCallConnection;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "videoCallConnectionId" })
  public videoCallConnection?: VideoCallConnection = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Video Call Connection ID",
    description:
      "ID of the Zoom, Google Meet, Microsoft Teams or meeting link connection to start the call with. Leave it out to add a link of your own, or to start the huddle of the alert's Slack channel.",
    example: "7c8d9e0f-a1b2-3c4d-9e5f-8a9b0c1d2e3f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public videoCallConnectionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Title",
    description:
      "What the call is called. A meeting a provider creates is named for the alert.",
    example: "ALT-17: High error rate on checkout",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public title?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Join Link",
    description:
      "The link responders open to join the call. Set by OneUptime for a call started with a connection or a Slack huddle; required, as an https link, when you add a link of your own.",
    example: "https://us02web.zoom.us/j/85746065432?pwd=abc",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public joinUrl?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    computed: true,
    title: "Provider Meeting ID",
    description:
      "The provider's own id for the meeting: a Zoom meeting id, a Google Meet space name, a Microsoft Teams online meeting id or a Slack channel id.",
    example: "85746065432",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public externalMeetingId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "workspaceNotificationRuleId",
    type: TableColumnType.Entity,
    computed: true,
    modelType: WorkspaceNotificationRule,
    title: "Workspace Notification Rule",
    description:
      "The Slack or Microsoft Teams notification rule that started this call, when a rule started it.",
  })
  @ManyToOne(
    () => {
      return WorkspaceNotificationRule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "workspaceNotificationRuleId" })
  public workspaceNotificationRule?: WorkspaceNotificationRule = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    title: "Workspace Notification Rule ID",
    description:
      "ID of the Slack or Microsoft Teams notification rule that started this call.",
    example: "3a4b5c6d-7e8f-9a0b-1c2d-3e4f5a6b7c8d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public workspaceNotificationRuleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "7c8d9e0f-a1b2-3c4d-9e5f-8a9b0c1d2e3f",
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
    example: "9d0e1f2a-b3c4-5d6e-af7b-8c9d0e1f2a3b",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
