import Incident from "./Incident";
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
import { JSONObject } from "../../Types/JSON";
import {
  CallSummaryStatus,
  RootCauseSuggestionStatus,
} from "../../Types/VideoCall/CallSummary";
import { CallTranscriptFetchStatus } from "../../Types/VideoCall/CallTranscriptAutoFetch";
import VideoCallProvider from "../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailableReason,
} from "../../Types/VideoCall/VideoCallTranscript";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.CreateIncidentVideoCall,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.ReadIncidentVideoCall,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.DeleteIncidentVideoCall,
];

/*
 * A video call held for an incident: a meeting a provider created for it,
 * the huddle of its Slack channel, or a link a responder added. Started by
 * a workspace notification rule when the incident is declared, or from the
 * incident page; its join link is posted wherever the incident's updates
 * go.
 *
 * A call's meeting is never edited - a different call is a new row - so it
 * can be trusted as the record of what was posted. What is added to a call
 * later is its transcript and what OneUptime AI read in it, and only
 * OneUptime writes those, through the call's transcript routes
 * (IncidentVideoCallAPI): read from Zoom or Google Meet, or added by a
 * person, then read by OneUptime AI, whose suggested root cause stays a
 * suggestion until a person uses it or dismisses it (CallSummary). With
 * Record and transcribe incident calls on, OneUptime also asks the provider
 * for the transcript by itself once the call is over, and keeps where that
 * stands on the call (transcriptFetch*, CallTranscriptAutoFetch).
 */
@EnableDocumentation()
@CanAccessIfCanReadOn("incident")
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: [],
})
@CrudApiEndpoint(new Route("/incident-video-call"))
@OwnedThrough("incidentId", Incident)
@Entity({
  name: "IncidentVideoCall",
})
@TableMetadata({
  tableName: "IncidentVideoCall",
  singularName: "Incident Video Call",
  pluralName: "Incident Video Calls",
  icon: IconProp.VideoCamera,
  tableDescription:
    "Video calls for an incident: a Zoom, Google Meet or Microsoft Teams meeting, a Slack huddle, or a meeting link.",
})
@Index(["incidentId", "createdAt"])
export default class IncidentVideoCall extends BaseModel {
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
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description: "Relation to the incident this call is for.",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentId" })
  public incident?: Incident = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Incident ID",
    description: "ID of the incident this call is for.",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

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
      "ID of the Zoom, Google Meet, Microsoft Teams or meeting link connection to start the call with. Leave it out to add a link of your own, or to start the huddle of the incident's Slack channel.",
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
      "What the call is called. A meeting a provider creates is named for the incident.",
    example: "INC-42: Checkout API is down",
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
    required: false,
    type: TableColumnType.LongText,
    computed: true,
    title: "Provider Calendar Event ID",
    description:
      "The calendar event the meeting belongs to: a Microsoft Teams meeting OneUptime put on its organizer's calendar, as it does while Record and transcribe incident calls is on, so that it can read the meeting's transcript. Empty for every other call.",
    example: "AAMkAGI2THVSAAA=",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public externalCalendarEventId?: string = undefined;

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
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    computed: true,
    title: "Transcript",
    description:
      "What was said on the call, one remark a line: how far into the call (HH:MM:SS, empty when unknown), a tab, who spoke (empty when unknown), a tab, and the words. Read from Zoom or Google Meet, or added by a person, through the call's transcript routes.",
    example:
      "00:12:03\tPriya Shah\tThe pool maxes at 50 and we just went to 100 workers.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public transcript?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    computed: true,
    title: "Transcript Source",
    description:
      "Where the transcript came from: Provider when OneUptime read it from Zoom or Google Meet, Upload when a person added it.",
    example: "Provider",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public transcriptSource?: VideoCallTranscriptSource = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    computed: true,
    title: "Transcript Info",
    description:
      "How long the transcript is - remarks, speakers, characters and how many seconds it spans - and the name of the file it was added from, so the call can be described without reading the transcript.",
    example: {
      lineCount: 312,
      speakerCount: 6,
      characterCount: 48210,
      durationInSeconds: 3120,
    },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public transcriptInfo?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    computed: true,
    title: "Transcript Added At",
    description: "When the transcript was added to the call.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public transcriptAddedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "transcriptAddedByUserId",
    type: TableColumnType.Entity,
    computed: true,
    modelType: User,
    title: "Transcript Added by User",
    description:
      "The person who added the transcript, or had OneUptime read it from the provider. Empty when an API key added it.",
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
  @JoinColumn({ name: "transcriptAddedByUserId" })
  public transcriptAddedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    title: "Transcript Added by User ID",
    description: "ID of the person who added the transcript.",
    example: "7c8d9e0f-a1b2-3c4d-9e5f-8a9b0c1d2e3f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public transcriptAddedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    computed: true,
    title: "Call Summary",
    description:
      "What OneUptime AI read in the transcript: the root cause the call points at (a suggestion, or that the call did not discuss it enough), what was found, tried, decided and left to do, and open questions - each with the transcript lines it rests on.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public callSummary?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    computed: true,
    title: "Call Summary Status",
    description:
      "Where OneUptime AI's reading of the transcript stands: Pending while it reads, Ready, Failed (Call Summary Status Message says why), or Skipped when AI is off for the project.",
    example: "Ready",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public callSummaryStatus?: CallSummaryStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    computed: true,
    title: "Call Summary Status Message",
    description:
      "Why OneUptime AI did not read the transcript, or could not finish reading it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public callSummaryStatusMessage?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    computed: true,
    title: "Call Summary Updated At",
    description:
      "When the Call Summary Status last changed: when OneUptime AI started reading the transcript, or finished.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public callSummaryUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    computed: true,
    title: "Root Cause Suggestion Status",
    description:
      "What a person did with the root cause OneUptime AI suggested from the call: Suggested while it waits, Accepted once used as the incident's root cause, Dismissed. Empty when nothing was suggested.",
    example: "Suggested",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public rootCauseSuggestionStatus?: RootCauseSuggestionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    computed: true,
    title: "Root Cause Suggestion Reviewed At",
    description:
      "When a person accepted or dismissed the root cause suggested from the call.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public rootCauseSuggestionReviewedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "rootCauseSuggestionReviewedByUserId",
    type: TableColumnType.Entity,
    computed: true,
    modelType: User,
    title: "Root Cause Suggestion Reviewed by User",
    description:
      "The person who accepted or dismissed the root cause suggested from the call.",
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
  @JoinColumn({ name: "rootCauseSuggestionReviewedByUserId" })
  public rootCauseSuggestionReviewedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    title: "Root Cause Suggestion Reviewed by User ID",
    description:
      "ID of the person who accepted or dismissed the root cause suggested from the call.",
    example: "7c8d9e0f-a1b2-3c4d-9e5f-8a9b0c1d2e3f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public rootCauseSuggestionReviewedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    computed: true,
    title: "Transcript Fetch Status",
    description:
      "Whether OneUptime gets the call's transcript from Zoom, Google Meet or Microsoft Teams by itself, as it does for the calls it starts while Record and transcribe incident calls is on: Waiting while it asks the provider (again at Transcript Fetch Next Attempt At), Stopped once it no longer asks, or when the provider could not be set up to record the call (Transcript Fetch Reason says why). Empty for a call it does not ask about, and once it has the transcript.",
    example: "Waiting",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public transcriptFetchStatus?: CallTranscriptFetchStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    computed: true,
    title: "Transcript Fetch Reason",
    description:
      "Why the provider had no transcript to give when OneUptime last asked: NotReady (still preparing it), NotTranscribed (nothing recorded or transcribed yet), NoMeeting, Expired, PermissionMissing, ConnectionProblem or NotSupported. Empty when the provider did not answer.",
    example: "NotReady",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public transcriptFetchReason?: VideoCallTranscriptUnavailableReason =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    computed: true,
    title: "Transcript Fetch Checked At",
    description:
      "When OneUptime last asked the provider for the call's transcript.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public transcriptFetchCheckedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  // The Workers job finds the calls it is due to ask about by it.
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    computed: true,
    title: "Transcript Fetch Next Attempt At",
    description:
      "When OneUptime next asks the provider for the call's transcript, while the Transcript Fetch Status is Waiting.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public transcriptFetchNextAttemptAt?: Date = undefined;

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
