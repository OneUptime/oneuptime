import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import BaseNotificationRule from "../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import Permission from "../../Types/Permission";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateWorkspaceNotificationRule,
  ],
  read: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadWorkspaceNotificationRule,
  ],
  delete: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.DeleteWorkspaceNotificationRule,
  ],
  update: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditWorkspaceNotificationRule,
  ],
})
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
  // Posts after a downgrade: readable on every plan.
  readableBelowPlan: true,
})
@CrudApiEndpoint(new Route("/workspace-notification-rule"))
@Entity({
  name: "WorkspaceNotificationRule",
})
@TableMetadata({
  tableName: "WorkspaceNotificationRule",
  singularName: "Workspace Notification Rule",
  pluralName: "Workspace Notification Rules",
  icon: IconProp.Logs,
  tableDescription: "Notification Rule for Third Party Workspaces",
})
class WorkspaceNotificationRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
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
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
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
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Rule Name",
    description: "Name of the Notification Rule",
    required: true,
    unique: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    unique: false,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Rule Description",
    description: "Description of the Notification Rule",
    required: false,
    unique: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    unique: false,
    nullable: true,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Workspace Notification Rules",
    /*
     * What the API reference, the OpenAPI spec, the Terraform provider and
     * MCP's tools say about the rule's JSON. The values updatesToPost takes
     * are NotificationRuleUpdateKind's: the API refuses a rule saved with
     * one its kind of rule cannot choose (NotificationRuleUpdates
     * .getValidationError). An on-call policy rule's
     * shouldMentionWhoIsOnCall is true or false, and true on no other kind
     * of rule (getMentionValidationError, issue #7968). The last sentence is
     * the conditions': the API refuses people, teams and policies of another
     * project (NotificationRuleConditionIds). No Dashboard form shows this
     * text: the rule form's steps draw their own words
     * (hideColumnDescription).
     *
     * A new on-call policy rule that leaves updatesToPost out starts on the
     * key updates, as the Dashboard's does, and an edit that leaves it out
     * keeps the rule's (NotificationRuleUpdates.withNewRuleUpdates,
     * withKeptUpdates, issue #7971): null asks for every update.
     */
    description:
      "The rule, as JSON: the events it is for (filters, filterCondition), where it posts, and for incident, alert, incident episode, alert episode, scheduled maintenance, on-call policy and security case rules, updatesToPost: the updates it posts after the record's first message, any of ResolvedAndReopened, StateChanges, SeverityChanges, PublicNotes, PrivateNotes, Owners, Paging, EpisodeMembers, Postmortem, AI, Edits, CustomFields, Reminders and Other - for an on-call policy rule, any of OnCallNow, OnCallNext, NobodyOnCall, Overrides, PolicyChanges and Owners; for a security case rule, any of PriorityReached, Assigned, ApprovalRequested and ResponseTargets - as its kind of rule allows. null posts every update, and so does leaving it out, except on an on-call policy rule: a new one that leaves it out posts the key updates, OnCallNow and NobodyOnCall, as one made in the Dashboard does, and an edit that leaves it out keeps the updates the rule posts. The first message, and a video call's Join button, are posted whatever it lists. An on-call policy rule that posts OnCallNow can set shouldMentionWhoIsOnCall to true: its hand-off line then mentions the person who comes on call, where they connected their chat account. Owner and On-Call Policy conditions in filters name people, teams and policies of this project by ID.",
    required: true,
    unique: false,
    type: TableColumnType.JSON,
    canReadOnRelationQuery: true,
    /*
     * An incident rule that posts to an existing channel and, there, only
     * the key updates. updatesToPost is for incident, alert, episode,
     * scheduled maintenance, on-call policy and security case rules: left
     * out, the rule posts every update - an on-call policy rule's key
     * updates, when it is new (NotificationRuleUpdates).
     */
    example: {
      _type: "IncidentNotificationRule",
      filterCondition: "All",
      filters: [],
      shouldPostToExistingChannel: true,
      existingChannelNames: "executive-alerts",
      shouldCreateNewChannel: false,
      inviteTeamsToNewChannel: [],
      inviteUsersToNewChannel: [],
      shouldInviteOwnersToNewChannel: false,
      shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
      archiveChannelAutomatically: false,
      updatesToPost: [
        "ResolvedAndReopened",
        "SeverityChanges",
        "PublicNotes",
        "Postmortem",
      ],
    },
  })
  @Column({
    type: ColumnType.JSON,
    unique: false,
    nullable: false,
  })
  public notificationRule?: BaseNotificationRule = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Workspace Event Type",
    description:
      "Event Type for the Workspace like Incident Created, Monitor Status Updated, etc.",
    required: true,
    unique: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(NotificationRuleEventType),
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    unique: false,
    nullable: false,
  })
  public eventType?: NotificationRuleEventType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Workspace Type",
    description: "Type of Workspace - slack, microsoft teams etc.",
    required: true,
    unique: false,
    type: TableColumnType.LongText,
    allowedValues: Object.values(WorkspaceType),
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    unique: false,
    nullable: false,
  })
  public workspaceType?: WorkspaceType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditWorkspaceNotificationRule,
    ],
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
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRule,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditWorkspaceNotificationRule,
    ],
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
}

export default WorkspaceNotificationRule;
