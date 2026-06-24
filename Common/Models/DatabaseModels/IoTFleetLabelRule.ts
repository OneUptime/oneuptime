import Label from "./Label";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateIoTFleetLabelRule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadIoTFleetLabelRule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteIoTFleetLabelRule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditIoTFleetLabelRule,
  ],
})
@CrudApiEndpoint(new Route("/iot-fleet-label-rule"))
@Entity({
  name: "IoTFleetLabelRule",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "IoTFleetLabelRule",
  singularName: "IoT Fleet Label Rule",
  pluralName: "IoT Fleet Label Rules",
  icon: IconProp.Tag,
  tableDescription:
    "Configure rules for automatically attaching labels to IoT fleets when matching IoT fleets are created",
})
export default class IoTFleetLabelRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
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
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
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
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIoTFleetLabelRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this IoT fleet label rule",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIoTFleetLabelRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this IoT fleet label rule",
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
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIoTFleetLabelRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Whether this rule is enabled",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  // Match Criteria

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIoTFleetLabelRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "IoT Fleet Labels",
    description:
      "Only trigger for IoT fleets that already have at least one of these labels. Leave empty to match regardless of labels.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IoTFleetLabelRuleIoTFleetLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "iotFleetLabelRuleId",
      referencedColumnName: "_id",
    },
  })
  public iotFleetLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIoTFleetLabelRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "IoT Fleet Name Pattern",
    description:
      "Regex (case-insensitive) matched against the IoT fleet name. Leave empty to match any name.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public iotFleetNamePattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIoTFleetLabelRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "IoT Fleet Description Pattern",
    description:
      "Regex (case-insensitive) matched against the IoT fleet description. Leave empty to match any description.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public iotFleetDescriptionPattern?: string = undefined;

  // Action: Labels to add

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIoTFleetLabelRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels to Add",
    description:
      "Labels to attach to the IoT fleet when this rule matches. Already-attached labels are not duplicated.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IoTFleetLabelRuleLabelToAdd",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "iotFleetLabelRuleId",
      referencedColumnName: "_id",
    },
  })
  public labelsToAdd?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
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
      Permission.CreateIoTFleetLabelRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadIoTFleetLabelRule,
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
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
