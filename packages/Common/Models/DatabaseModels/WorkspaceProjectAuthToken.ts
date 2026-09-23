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
import Permission from "../../Types/Permission";

export interface MiscData {
  [key: string]: any;
}

export interface MicrosoftTeamsTeam {
  id: string;
  name: string;
}

export type MicrosoftTeamsChatType = "personal" | "groupChat";

export interface MicrosoftTeamsChat {
  id: string; // Teams conversation id (e.g. 19:...@thread.v2)
  name: string;
  chatType: MicrosoftTeamsChatType;
  serviceUrl?: string | undefined; // Bot Framework service URL captured when the bot was added.
  addedAt?: string | undefined;
  /*
   * Microsoft Entra object ids of the human members, captured from the chat
   * roster. What lets a personal chat be matched back to the OneUptime user
   * it belongs to (WorkspaceUserAuthToken.workspaceUserId is the same id), so
   * user direct-message notifications can reuse the existing chat instead of
   * creating a new conversation. Absent on records captured before this
   * shipped.
   */
  memberAadObjectIds?: Array<string> | undefined;
}

/*
 * A team the OneUptime app has actually been installed into, captured from the
 * bot's install / conversationUpdate events.
 *
 * Graph can list every team in the tenant with app-only permissions, but the
 * Bot Framework will only accept a proactive post into a team the app is a
 * roster member of. Listing a team is therefore NOT evidence that we can post
 * to it — this record is, which is why channel sends check it before calling
 * the Bot Framework.
 *
 * A Teams team has TWO ids and they are not interchangeable. Bot activities
 * carry the thread id (channelData.team.id, "19:...@thread.tacv2"); Graph — and
 * therefore every team picker, notification rule and channel URL in OneUptime —
 * uses the AAD group id (a GUID, channelData.team.aadGroupId). Records used to
 * be keyed by the thread id and looked up by the group id, so the lookup could
 * never hit. Both are stored explicitly now so neither side has to guess which
 * one it holds.
 */
export interface MicrosoftTeamsInstalledTeam {
  /*
   * Map key. The Graph team id when we could resolve it, otherwise the Teams
   * thread id — a record written before this shipped, or one whose group id
   * could not be resolved, keeps the thread id here so uninstall still matches.
   * Read it through MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId rather
   * than assuming which id space it is in.
   */
  id: string;
  graphTeamId?: string | undefined; // AAD group id — what Graph and notification rules use. Absent on unresolved records.
  teamsThreadId?: string | undefined; // channelData.team.id ("19:...@thread.tacv2") — what bot activities carry.
  name?: string | undefined;
  serviceUrl?: string | undefined; // Bot Framework service URL captured on install. Required for GCC/DoD.
  addedAt?: string | undefined;
}

export interface SlackMiscData extends MiscData {
  teamId: string;
  teamName: string;
  botUserId: string;
  channelCache?: {
    [channelName: string]: {
      id: string;
      name: string;
      lastUpdated: string;
    };
  };
}

/*
 * The Microsoft Graph app token is NOT part of this. It is the row's
 * `authToken`, with its expiry in `authTokenExpiresAt` — both server-only
 * columns. miscData is readable by every project Viewer, so it must never
 * hold a credential.
 */
export interface MicrosoftTeamsMiscData extends MiscData {
  tenantId: string;
  teamId: string;
  teamName: string;
  botId: string;
  adminConsentGranted?: boolean;
  adminConsentGrantedAt?: string;
  adminConsentGrantedBy?: string;
  availableTeams?: Record<string, MicrosoftTeamsTeam>; // keyed by team id. Every team Graph can see in the tenant.
  availableChats?: Record<string, MicrosoftTeamsChat>; // keyed by chat id. Chats the OneUptime app has been added to.
  installedTeams?: Record<string, MicrosoftTeamsInstalledTeam>; // keyed by MicrosoftTeamsInstalledTeam.id — see that type, the key is not always a Graph team id.
}

export type WorkspaceMiscData = SlackMiscData | MicrosoftTeamsMiscData;

/*
 * Keys that older releases wrote into miscData and that must never be served
 * from it again. They held the tenant's live Microsoft Graph app token, and
 * miscData is readable by every project Viewer. The token now lives only in
 * the server-only `authToken` / `authTokenExpiresAt` columns; the service
 * strips these on every read in case a row still carries them.
 */
export const LegacyServerOnlyMiscDataKeys: ReadonlyArray<string> = [
  "appAccessToken",
  "appAccessTokenExpiresAt",
  "lastAppTokenIssuedAt",
];

/*
 * This row is the binding everything downstream trusts: which Slack workspace
 * or Microsoft 365 tenant a project's bot token belongs to. For Teams the
 * server even mints a fresh Graph app token for whatever tenant
 * `workspaceProjectId` names. So it is created only by the Slack / Microsoft
 * Teams connect flows, which prove the workspace or tenant before writing it
 * (see WorkspaceOAuthState), and never through the CRUD API — where it could
 * name any tenant at all.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
  ],
  delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
  ],
})
@CrudApiEndpoint(new Route("/workspace-project-auth-token"))
@Entity({
  name: "WorkspaceProjectAuthToken",
})
@TableMetadata({
  tableName: "WorkspaceProjectAuthToken",
  singularName: "Workspace Project Auth Token",
  pluralName: "Workspace Project Auth Tokens",
  icon: IconProp.Lock,
  tableDescription: "Third Party Auth Token for the Project",
})
class WorkspaceProjectAuthToken extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
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
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
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
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "Auth Token",
    required: true,
    unique: false,
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.VeryLongText,
    unique: false,
    nullable: false,
  })
  public authToken?: string = undefined;

  /*
   * When `authToken` stops working, for workspaces whose token expires. For
   * Microsoft Teams `authToken` is the tenant's Graph app token and this is
   * when the server has to mint a new one. Null when the expiry is unknown,
   * which the Teams path treats as "refresh now".
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "Auth Token Expires At",
    description: "When the auth token expires, if it expires.",
    required: false,
    type: TableColumnType.Date,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public authTokenExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    title: "Workspace Type",
    description: "Type of Workspace - slack, microsoft teams etc.",
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
  public workspaceType?: WorkspaceType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    // Repointing a connection to another workspace or tenant is server-only; see the table comment.
    update: [],
  })
  @TableColumn({
    title: "Project ID in Workspace",
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
  public workspaceProjectId?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
  })
  /*
   * Readable by every project Viewer, so it must never hold a credential.
   * Tokens go in `authToken` / `authTokenExpiresAt`, which are server-only.
   */
  @TableColumn({
    title: "Misc Data",
    required: true,
    unique: false,
    type: TableColumnType.JSON,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.JSON,
    unique: false,
    nullable: false,
  })
  public miscData?: MiscData = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
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
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
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

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
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
}

export default WorkspaceProjectAuthToken;
