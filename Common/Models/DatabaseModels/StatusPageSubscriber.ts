import Project from "./Project";
import StatusPage from "./StatusPage";
import StatusPageResource from "./StatusPageResource";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import Email from "../../Types/Email";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Phone from "../../Types/Phone";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";
import StatusPageEventType from "../../Types/StatusPage/StatusPageEventType";

@EnableDocumentation()
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CanAccessIfCanReadOn("statusPage")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateStatusPageSubscriber,
    Permission.Public,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadStatusPageSubscriber,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteStatusPageSubscriber,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditStatusPageSubscriber,
  ],
})
@CrudApiEndpoint(new Route("/status-page-subscriber"))
@SlugifyColumn("name", "slug")
@TableMetadata({
  tableName: "StatusPageSubscriber",
  singularName: "Status Page Subscriber",
  pluralName: "Status Page Subscribers",
  icon: IconProp.Team,
  tableDescription: "Subscriber that subscribed to your status page",
})
@Entity({
  name: "StatusPageSubscriber",
})
export default class StatusPageSubscriber extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
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
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
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
      Permission.CreateStatusPageSubscriber,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
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
      Permission.CreateStatusPageSubscriber,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
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
    example: "b2c3d4e5-f6a7-8901-bcde-f1234567890a",
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
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Email,
    title: "Email",
    description: "Email address of the subscriber.",
    example: "subscriber@example.com",
  })
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    transformer: Email.getDatabaseTransformer(),
  })
  public subscriberEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Phone,
    title: "Phone",
    description: "Phone number of subscriber",
  })
  @Column({
    nullable: true,
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    transformer: Phone.getDatabaseTransformer(),
  })
  public subscriberPhone?: Phone = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortURL,
    title: "Webhook",
    description: "Webhook to ping when events happen on Status Page",
    example: "https://example.com/webhook",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public subscriberWebhook?: URL = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortURL,
    title: "Slack Incoming Webhook URL",
    description:
      "Slack incoming webhook URL to send notifications to Slack channel",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public slackIncomingWebhookUrl?: URL = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Slack Workspace Name",
    description:
      "Name of the Slack workspace for validation and identification",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public slackWorkspaceName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongURL,
    title: "Microsoft Teams Incoming Webhook URL",
    description:
      "Microsoft Teams incoming webhook URL to send notifications to Teams channel",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public microsoftTeamsIncomingWebhookUrl?: URL = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Microsoft Teams Workspace Name",
    description:
      "Name of the Microsoft Teams workspace for validation and identification",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public microsoftTeamsWorkspaceName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
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
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "c3d4e5f6-a7b8-9012-cdef-234567890abc",
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
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is Subscription Confirmed",
    description:
      "Has subscriber confirmed their subscription? (for example, by clicking on a confirmation link in an email)",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isSubscriptionConfirmed?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
    ],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.ShortText,
    title: "Subscription Confirmation Token",
    description:
      "Token used to confirm subscription. This is a random token that is sent to the subscriber's email address to confirm their subscription.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
  })
  public subscriptionConfirmationToken?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is Unsubscribed",
    description: "Is Subscriber Unsubscribed?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isUnsubscribed?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Send You Have Subscribed Message",
    description: "Send You Have Subscribed Message when subscriber is created?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public sendYouHaveSubscribedMessage?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is Subscribed to All Resources",
    description:
      "Is Subscriber Subscribed to All Resources on this status page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public isSubscribedToAllResources?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is Subscribed to All Event Types",
    description:
      "Is Subscriber Subscribed to All Event Types (like Incidents, Scheduled Events, Announcements) on this status page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public isSubscribedToAllEventTypes?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: StatusPageResource,
    title: "Subscribed to Resources",
    description:
      "Relation to Status Page Resources where this subscriber is subscribed to",
  })
  @ManyToMany(
    () => {
      return StatusPageResource;
    },
    { eager: false },
  )
  @JoinTable({
    name: "StatusPageSubscriberStatusPageResource",
    inverseJoinColumn: {
      name: "statusPageResourceId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "statusPageSubscriberId",
      referencedColumnName: "_id",
    },
  })
  public statusPageResources?: Array<StatusPageResource> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Subscribed to Event Types",
    description:
      "Which event types is the subscriber subscribed to (like Incidents, Scheduled Events, Announcements)",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    default: [],
  })
  public statusPageEventTypes?: Array<StatusPageEventType> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPageSubscriber,
      Permission.Public,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPageSubscriber,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPageSubscriber,
    ],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    title: "Notes",
    description:
      "Any notes or text you would like to add to this subscriber object. This is for internal use only.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
    unique: false,
  })
  public internalNote?: string = undefined;
}
