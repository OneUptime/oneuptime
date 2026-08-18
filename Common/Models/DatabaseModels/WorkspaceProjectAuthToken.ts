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

export interface MicrosoftTeamsMiscData extends MiscData {
  tenantId: string;
  teamId: string;
  teamName: string;
  botId: string;
  appAccessToken?: string;
  adminConsentGranted?: boolean;
  lastAppTokenIssuedAt?: string;
  adminConsentGrantedAt?: string;
  adminConsentGrantedBy?: string;
  availableTeams?: Record<string, MicrosoftTeamsTeam>; // keyed by team id. Every team Graph can see in the tenant.
  appAccessTokenExpiresAt?: string;
  availableChats?: Record<string, MicrosoftTeamsChat>; // keyed by chat id. Chats the OneUptime app has been added to.
  installedTeams?: Record<string, MicrosoftTeamsInstalledTeam>; // keyed by MicrosoftTeamsInstalledTeam.id — see that type, the key is not always a Graph team id.
}

export type WorkspaceMiscData = SlackMiscData | MicrosoftTeamsMiscData;

@TenantColumn("projectId")
@TableAccessControl({
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
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
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
