import Project from "./Project";
import User from "./User";
import BaseModel from "Common/Models/BaseModel";
import Route from "Common/Types/API/Route";
import ColumnAccessControl from "Common/Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "Common/Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ColumnType from "Common/Types/Database/ColumnType";
import CrudApiEndpoint from "Common/Types/Database/CrudApiEndpoint";
import EnableDocumentation from "Common/Types/Database/EnableDocumentation";
import EnableWorkflow from "Common/Types/Database/EnableWorkflow";
import TableColumn from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import TableMetadata from "Common/Types/Database/TableMetadata";
import TenantColumn from "Common/Types/Database/TenantColumn";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateIncidentNoteTemplate,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadIncidentNoteTemplate,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteIncidentNoteTemplate,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditIncidentNoteTemplate,
  ],
})
@CrudApiEndpoint(new Route("/incident-note-template"))
@Entity({
  name: "IncidentNoteTemplate",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "IncidentNoteTemplate",
  singularName: "Incident Note Template",
  pluralName: "Incident Note Templates",
  icon: IconProp.Alert,
  tableDescription: "Manage incident note templates for your project",
})
export default class IncidentNoteTemplate extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentNoteTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentNoteTemplate,
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
      Permission.CreateIncidentNoteTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentNoteTemplate,
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
      Permission.CreateIncidentNoteTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentNoteTemplate,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditIncidentNoteTemplate,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Markdown,
    title: "Note",
    description:
      "Note template for public or private notes. This is in markdown.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: false,
    unique: false,
  })
  public note?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentNoteTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentNoteTemplate,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditIncidentNoteTemplate,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of the Incident Template",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public templateName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentNoteTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentNoteTemplate,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditIncidentNoteTemplate,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Template Description",
    description: "Description of the Incident Template",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public templateDescription?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentNoteTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentNoteTemplate,
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
      onDelete: "CASCADE",
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
      Permission.CreateIncidentNoteTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentNoteTemplate,
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
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
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
      onDelete: "CASCADE",
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
}
