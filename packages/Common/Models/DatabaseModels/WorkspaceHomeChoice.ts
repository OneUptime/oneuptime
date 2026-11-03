import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnsTogether from "../../Types/Database/UniqueColumnsTogether";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * THE PROJECT SOMEBODY CHOSE FOR THEIR SLACK OR MICROSOFT TEAMS HOME.
 *
 * A Slack workspace or a Microsoft 365 organization can be connected to
 * more than one project. Somebody whose chat account is connected to a
 * member in two or more of them sees the app's Home for one of them at a
 * time, with a Switch project menu of the others (SlackHome,
 * MicrosoftTeamsHome). A row says when they last chose this project there:
 * their Home opens on the project of theirs they chose last - while their
 * account is still connected to a current member there, which the Home
 * reads again every time it is drawn (WorkspaceHomeProject).
 *
 * One row per project and chat account, written again on every choice. It
 * decides nothing about access: it only says which of the projects the
 * person may already see their Home shows first. It lives in Postgres, not
 * the cache, because the cache keeps nothing across a restart of Valkey,
 * and a choice the person made should not be forgotten by one.
 *
 * Written and read only by the server (WorkspaceHomeChoiceService), as
 * OneUptime, when a person picks a project in the menu of a signed request
 * from Slack or Microsoft Teams: no client can read or write a row, it has
 * no API, and it goes with its project.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Entity({
  name: "WorkspaceHomeChoice",
})
@TableMetadata({
  tableName: "WorkspaceHomeChoice",
  singularName: "Workspace Home Choice",
  pluralName: "Workspace Home Choices",
  icon: IconProp.Chat,
  tableDescription:
    "Internal record of the project a person last chose for their Slack or Microsoft Teams Home, in a workspace connected to several projects.",
})
@Index(["projectId", "workspaceType", "workspaceUserId"], { unique: true })
@UniqueColumnsTogether(
  ["projectId", "workspaceType", "workspaceUserId"],
  "This chat account's Home choice of this project is recorded already.",
)
export default class WorkspaceHomeChoice extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "The project the person chose for their Home",
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
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project the person chose for their Home",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(WorkspaceType),
    title: "Workspace Type",
    description: "The chat the Home is in: Slack or Microsoft Teams.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public workspaceType?: WorkspaceType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Workspace User ID",
    description:
      "The person's chat account: a Slack user id, or a Microsoft Entra object id.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public workspaceUserId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Chosen At",
    description: "When the person last chose this project for their Home.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public chosenAt?: Date = undefined;
}
