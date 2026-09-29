import Project from "./Project";
import User from "./User";
import Workflow from "./Workflow";
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
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../Types/Workflow/WorkflowVariableOAuth";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@CanAccessIfCanReadOn("workflow")
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TenantColumn("projectId")
@TableAccessControl({
  /*
   * Mirrors Workflow's own create list. Anyone who can create a workflow can
   * create the variables that workflow needs — the create-from-template wizard
   * writes both in one go, and a member who could do the first but not the
   * second was left with a saved workflow whose {{local.variables.…}}
   * references resolved to nothing. Unresolved references are not an error at
   * run time (VMAPI leaves the literal text in place), so that workflow looked
   * healthy and posted braces to Slack.
   */
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateWorkflowVariable,
    Permission.ProjectMember,
    Permission.WorkflowAdmin,
    Permission.WorkflowMember,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.WorkflowAdmin,
    Permission.WorkflowMember,
    Permission.WorkflowViewer,
    Permission.ReadWorkflowVariable,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteWorkflowVariable,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflowVariable,
  ],
})
@CrudApiEndpoint(new Route("/workflow-variable"))
@OwnedThrough("workflowId", Workflow)
@Entity({
  name: "WorkflowVariable",
})
@TableMetadata({
  tableName: "WorkflowVariable",
  singularName: "Workflow Variable",
  pluralName: "Workflow Variables",
  icon: IconProp.Variable,
  tableDescription:
    "Store environment variables or secrets for your workflows.",
})
export default class WorkflowVariable extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
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
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
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
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "workflowId",
    type: TableColumnType.Entity,
    modelType: Workflow,
    title: "Workflow",
    description:
      "Workflow this variable belong to. If this is null then this variable will be a global variable",
  })
  @ManyToOne(
    () => {
      return Workflow;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "workflowId" })
  public workflow?: Workflow = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Workflow ID",
    description:
      "ID of Workflow this variable belong to. If this is null then this variable will be a global variable",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public workflowId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Variable Name",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy(["workflowId", "projectId"])
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  /*
   * Required for a Static variable only. An OAuth 2.0 variable has no value to
   * type in - its value is the access token OneUptime fetches - so the
   * requirement moved to WorkflowVariableService.onBeforeCreate, which knows
   * the variable's type. The column itself stays NOT NULL; an OAuth variable
   * stores the empty string here.
   */
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Content",
    description:
      "Content of the variable. Required for Static variables. Not used by OAuth 2.0 variables, whose value is the access token OneUptime fetches.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public content?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    /*
     * Same list as name, description and content. isSecret decides one thing
     * only - whether this variable's value is redacted out of the logs a
     * workflow writes (getSecretWorkflowVariableValues in
     * App/FeatureSet/Workflow/Utils/SecretRedaction.ts). It is not an encryption
     * switch and nothing is re-encrypted when it flips, so leaving it
     * create-only bought no safety in the direction that matters: it only meant
     * a variable saved without the toggle kept leaking its value into every run
     * log until someone deleted and recreated it.
     *
     * The other direction does matter, and this list does not govern it.
     * `content` is unreadable through the API by anyone, so a caller who may
     * write a variable but not read it could clear this flag, trigger a run and
     * read the value out of the log. WorkflowVariableService.onBeforeUpdate
     * therefore lets a variable be marked secret but refuses to un-mark one -
     * a ratchet the column ACL has no way to express.
     */
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Secret",
    description:
      "Is this variable a secret. If true, then it'll not be in the logs",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public isSecret?: string = undefined;

  /*
   * Static or OAuth 2.0. Fixed at creation: the two kinds store different
   * things, and turning one into the other in place would leave a Static
   * variable with credentials nobody entered or an OAuth variable with a
   * pasted value that is silently ignored. Delete and recreate under the same
   * name instead - workflows refer to a variable by name, so they keep
   * working.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Variable Type",
    description:
      "Static: the content you save is used as is. OAuth 2.0: OneUptime fetches an access token from your identity provider and refreshes it automatically when a workflow uses it after it has expired.",
    defaultValue: WorkflowVariableType.Static,
    example: "OAuth 2.0",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: WorkflowVariableType.Static,
  })
  public variableType?: WorkflowVariableType = undefined;

  /*
   * Fixed at creation for the same reason as variableType: the two grants need
   * different credentials, and the edit form cannot collect a refresh token
   * (it is write-only), so switching grant in place would produce a variable
   * that fails on its first use.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "OAuth Grant Type",
    description:
      "OAuth 2.0 variables only. Client Credentials for machine-to-machine access, or Refresh Token to keep delegated access alive with a refresh token you obtained once.",
    example: "Client Credentials",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public oauthGrantType?: OAuth2GrantType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongURL,
    title: "OAuth Token URL",
    description:
      "OAuth 2.0 variables only. The token endpoint of your identity provider.",
    example:
      "https://login.microsoftonline.com/your-tenant-id/oauth2/v2.0/token",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongURL,
  })
  public oauthTokenUrl?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "OAuth Client ID",
    description:
      "OAuth 2.0 variables only. The client ID of the application registered with your identity provider.",
    example: "12345678-1234-1234-1234-123456789012",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public oauthClientId?: string = undefined;

  /*
   * Write-only, like content: nobody can read it back through the API, not
   * even a project owner. Encrypted at rest.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "OAuth Client Secret",
    description:
      "OAuth 2.0 variables only. The client secret of the application. Required for the Client Credentials grant; optional for the Refresh Token grant (public clients have none). Encrypted, and never readable through the API.",
    example: "your-client-secret",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public oauthClientSecret?: string = undefined;

  /*
   * Write-only and encrypted. OneUptime replaces it with the new refresh token
   * whenever the identity provider rotates it during a refresh.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "OAuth Refresh Token",
    description:
      "OAuth 2.0 variables using the Refresh Token grant only. OneUptime exchanges it for access tokens and stores the replacement when your identity provider rotates it. Encrypted, and never readable through the API.",
    example: "1//0g-refresh-token",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public oauthRefreshToken?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "OAuth Scope",
    description:
      "OAuth 2.0 variables only. Space-separated scopes to request. Leave empty to use the scopes your identity provider grants by default.",
    example: "https://graph.microsoft.com/.default",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public oauthScope?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "OAuth Additional Parameters",
    description:
      "OAuth 2.0 variables only. Extra form parameters sent with every token request, such as audience for Auth0 or resource for Azure AD v1. Readable by anyone who can read the variable, so do not put secrets here.",
    example: '{"audience": "https://api.example.com"}',
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public oauthAdditionalParameters?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "OAuth Client Authentication",
    description:
      "OAuth 2.0 variables only. How the client ID and secret are sent: in an HTTP Basic header (client_secret_basic, the default) or in the request body (client_secret_post).",
    example: "HTTP Basic Header",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public oauthClientAuthenticationMethod?: OAuth2ClientAuthenticationMethod =
    undefined;

  /*
   * The cached access token. Written only by OneUptime
   * (WorkflowVariableOAuthToken), never through the API in either direction,
   * and encrypted at rest.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "OAuth Access Token",
    description:
      "The access token OneUptime last fetched for this OAuth 2.0 variable. Managed by OneUptime, encrypted, and never readable through the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public oauthAccessToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "OAuth Access Token Expires At",
    description:
      "When the cached access token expires, as reported by the identity provider (expires_in) or by the token itself (the JWT exp claim). Empty when neither says.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public oauthAccessTokenExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "OAuth Last Refreshed At",
    description:
      "When OneUptime last fetched an access token for this variable. Cleared when the OAuth settings change.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public oauthLastRefreshedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "OAuth Last Refresh Error",
    description:
      "Why the last attempt to fetch an access token failed. Cleared by the next successful refresh.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public oauthLastRefreshError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "OAuth Last Refresh Error At",
    description:
      "When the last failed attempt to fetch an access token happened.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public oauthLastRefreshErrorAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
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
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
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

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
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
}
