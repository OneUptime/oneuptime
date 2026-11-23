import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import { DATA_SECURITY_ISSUE_GROUP_CAUSES } from "../../Types/DataSecurity/DataSecurityIssueGroup";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * DATA SECURITY ISSUES ONE MISTAKE MADE (#10370): one group of issues of the
 * same check whose stores share what made them - the code that declares
 * them, the CloudFormation stack, a tag that names their module, the
 * identity that created them, a name pattern
 * (Types/DataSecurity/DataSecurityIssueGroup) - so the cause is fixed once:
 * one pull request to the module, or one approval for what was made in the
 * console.
 *
 * OneUptime writes it alone (Server/Utils/DataSecurity/DataSecurityIssueGrouper,
 * after each evaluation): the facts decide it, OneUptime AI only names it.
 * Each issue names its group (DataSecurityIssue.dataSecurityIssueGroupId),
 * and keeps it once it resolves, so the group says how many are fixed and
 * how many are left, and follows its issues to the end.
 *
 * Nobody reads or writes it through the API: a group's name and facts come
 * from many stores' tags and names, so Data Security's own routes answer it
 * only to a reader of Data Security issues across the whole project, with
 * each of its issues as that reader may read it
 * (Server/Utils/DataSecurity/DataSecurityIssueGroups). It goes with its
 * project; a group nothing holds any more is deleted by the grouping.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "DataSecurityIssueGroup",
  singularName: "Data Security Issue Group",
  pluralName: "Data Security Issue Groups",
  icon: IconProp.Squares,
  tableDescription:
    "Data Security issues of one check whose stores share what made them, so the cause is fixed once: what they share, OneUptime AI's name for it, how many are fixed, and the pull request that fixes it.",
})
// One group per fact in a project: how the grouping finds it again.
@Index(["projectId", "groupKey"], { unique: true })
@Entity({
  name: "DataSecurityIssueGroup",
})
export default class DataSecurityIssueGroup extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "The project the group's issues are in.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project the group's issues are in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    title: "Group Key",
    description:
      "What the group is of: its check, its cloud and the fact its stores share, such as access-not-logged|aws|tag:module=static-site. Stable while that fact holds.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public groupKey?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Check",
    description: "The check every issue of the group failed, by its id.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public checkId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: [...DATA_SECURITY_ISSUE_GROUP_CAUSES],
    required: true,
    title: "Cause",
    description:
      "The fact the group's stores share: DeclaredCode (the file or module that declares them), Stack, Tags, Creator or NamePattern.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public cause?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Facts",
    description:
      "What every store of the group shares: the tag, stack, identity or name pattern, the code that declares them, their kind and place.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public facts?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Name",
    description:
      "OneUptime AI's name for the group and its cause, written from its facts only and held to them; empty while it has none, and the group goes by its cause's own words.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public name?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Name Facts Hash",
    description:
      "What the name was written from: a group is named again only when its facts change, never as its issues open and resolve.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public nameFactsHash?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Name Language",
    description: "The language the name is written in, such as en or de.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public nameLanguage?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Named At",
    description: "When OneUptime AI last named the group.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public namedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    title: "Issue Count",
    description:
      "How many issues the group holds, open or not, as last grouped.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public issueCount?: number = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    title: "Open Issue Count",
    description: "How many of its issues were open, as last grouped.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public openIssueCount?: number = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Fixed At",
    description:
      "When the last of its open issues resolved; empty while one is open.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public fixedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Grouped At",
    description: "When the grouping last looked at it.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public groupedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Code Task ID",
    description:
      "The task in Code that opens the group's pull request: its first turn's run. Each of the group's issues keeps it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeTaskId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Fix Requested At",
    description: "When the group's fix was last asked for.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public fixRequestedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    manyToOneRelationColumn: "fixRequestedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Fix Requested By",
    description: "Who last asked for the group's fix; empty for OneUptime AI.",
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
  @JoinColumn({ name: "fixRequestedByUserId" })
  public fixRequestedByUser?: User = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Fix Requested By User ID",
    description: "ID of who last asked for the group's fix.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public fixRequestedByUserId?: ObjectID = undefined;
}
