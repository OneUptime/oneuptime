import ExternalMcpServer from "./ExternalMcpServer";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who marks a tool read-only, and who takes a mark away: project owners and
 * admins, the people who add and change external MCP servers. A mark lets
 * OneUptime AI call the tool with nobody asking - in investigations, in
 * Slack and Microsoft Teams, at once in Ask AI - so it is theirs alone.
 */
const ADMINS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

// Who sees which tools are marked, by whom and when: whoever sees the servers.
const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

/*
 * A PROJECT ADMIN'S WORD THAT ONE TOOL OF AN EXTERNAL MCP SERVER ONLY
 * READS, when its server does not say (issue #11081).
 *
 * OneUptime AI calls a tool with nobody asking only when it only reads, and
 * goes by the server's own word on it (annotations.readOnlyHint). kAgent's
 * tool server says nothing about any of its tools, so not even
 * k8s_get_resources helped an investigation, and in Ask AI each of its reads
 * waited for a card. A mark is how a Project Owner or Project Admin who
 * knows a tool only reads says so, on the server's Tools card:
 *
 *   - one tool at a time: a mark names one tool of one server, and is made
 *     by a person signed in, never by an API key (ExternalMcpToolReadOnlyMarkService);
 *   - only a tool its server says nothing about, and nothing about which
 *     says it changes something (Types/AI/ExternalMcpServer/
 *     ExternalMcpToolReadOnlyMark);
 *   - for the tool as OneUptime last read it: the fingerprint of its name,
 *     description and input schema (toolFingerprint), taken from the
 *     server's tools when it is made, never from the request. Every run
 *     reads the tools anew, and a mark whose tool changed since holds no
 *     longer, until someone marks the tool again;
 *   - who made it and when are the row's own (createdByUserId, createdAt),
 *     and making and taking away a mark are in the audit log, as every
 *     write of a person's is. A mark is never changed: marking a tool
 *     again makes a new mark in place of the old.
 */
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Free,
  update: PlanType.Growth,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: ADMINS,
  read: READERS,
  delete: ADMINS,
  update: [],
})
@CrudApiEndpoint(new Route("/external-mcp-tool-read-only-mark"))
@Entity({
  name: "ExternalMcpToolReadOnlyMark",
})
@TableMetadata({
  tableName: "ExternalMcpToolReadOnlyMark",
  singularName: "MCP Tool Read-Only Mark",
  pluralName: "MCP Tool Read-Only Marks",
  icon: IconProp.PuzzlePiece,
  tableDescription:
    "A Project Admin's word that one tool of an external MCP server only reads, when the server does not say. OneUptime AI then calls the tool without asking, until the server changes it.",
})
export default class ExternalMcpToolReadOnlyMark extends BaseModel {
  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this mark belongs to.",
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
    create: ADMINS,
    read: READERS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this mark belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "externalMcpServerId",
    type: TableColumnType.Entity,
    modelType: ExternalMcpServer,
    title: "External MCP Server",
    description: "The MCP server whose tool is marked read-only.",
  })
  @ManyToOne(
    () => {
      return ExternalMcpServer;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "externalMcpServerId" })
  public externalMcpServer?: ExternalMcpServer = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "External MCP Server ID",
    description: "ID of the MCP server whose tool is marked read-only.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public externalMcpServerId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Tool Name",
    description:
      "The tool's name, exactly as the server calls it, such as k8s_get_resources.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public toolName?: string = undefined;

  /*
   * Written by OneUptime from the tool as it last read it: a value a
   * request sends is replaced (ExternalMcpToolReadOnlyMarkService).
   */
  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Tool Fingerprint",
    description:
      "The fingerprint of the tool's name, description and input schema when it was marked. The mark holds only while the server's tool still has it. Set by OneUptime: a value sent is replaced.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public toolFingerprint?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Marked By User",
    description: "Relation to the user who marked the tool read-only.",
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
    read: READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Marked By User ID",
    description: "ID of the user who marked the tool read-only.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
