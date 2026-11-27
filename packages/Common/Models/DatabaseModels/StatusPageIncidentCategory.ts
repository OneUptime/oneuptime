import Label from "./Label";
import Project from "./Project";
import StatusPage from "./StatusPage";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

// Status-page categories expose only an owner-approved name and description.
@EnableDocumentation()
@CanAccessIfCanReadOn("statusPage")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.CreateStatusPageHeaderLink,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.StatusPageViewer,
    Permission.ReadStatusPageHeaderLink,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.DeleteStatusPageHeaderLink,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.EditStatusPageHeaderLink,
  ],
})
@EnableWorkflow({ create: true, delete: true, update: true, read: true })
@CrudApiEndpoint(new Route("/status-page-incident-category"))
@OwnedThrough("statusPageId", StatusPage)
@TableMetadata({
  tableName: "StatusPageIncidentCategory",
  singularName: "Status Page Incident Category",
  pluralName: "Status Page Incident Categories",
  icon: IconProp.Label,
  tableDescription: "Choose public incident categories for a status page",
})
@Entity({ name: "StatusPageIncidentCategory" })
export default class StatusPageIncidentCategory extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageHeaderLink,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageHeaderLink,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Project that owns this category",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    { nullable: false, onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageHeaderLink,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageHeaderLink,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Project ID",
    description: "Owning project ID",
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
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageHeaderLink,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageHeaderLink,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPageId",
    type: TableColumnType.Entity,
    modelType: StatusPage,
    title: "Status Page",
    description: "Status page where this category is shown",
  })
  @ManyToOne(
    () => {
      return StatusPage;
    },
    { nullable: false, onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "statusPageId" })
  public statusPage?: StatusPage = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageHeaderLink,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageHeaderLink,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Status Page ID",
    description: "Status page ID",
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
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageHeaderLink,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageHeaderLink,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "labelId",
    type: TableColumnType.Entity,
    modelType: Label,
    title: "Internal Label",
    description: "Incident label used internally to assign this category",
  })
  @ManyToOne(
    () => {
      return Label;
    },
    { nullable: false, onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "labelId" })
  public label?: Label = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageHeaderLink,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageHeaderLink,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Label ID",
    description: "Internal incident label ID",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  @UniqueColumnBy("statusPageId")
  public labelId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageHeaderLink,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageHeaderLink,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageHeaderLink,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Public Name",
    description: "Name shown to status page visitors",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  @UniqueColumnBy("statusPageId")
  public publicName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageHeaderLink,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageHeaderLink,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageHeaderLink,
    ],
  })
  @TableColumn({
    type: TableColumnType.Description,
    required: false,
    title: "Public Description",
    description: "Description shown to status page visitors",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public publicDescription?: string | undefined = undefined;
}
